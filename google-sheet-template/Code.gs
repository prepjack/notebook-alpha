function testDriveAuth() {
  const file = DriveApp.getFileById("1qWMZwrZl0s1zu0OHa58b-D36AQftGbiK");
  Logger.log(file.getName());
}


function testReadNodes() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Nodes");

  const data = sheet.getDataRange().getValues();

  Logger.log(data);
}

function testReadAllData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const data = {
    nodes: getSheetData(ss, "Nodes"),
    content: getSheetData(ss, "Content_Core"),
    resources: getSheetData(ss, "Resources"),
    mcqs: getSheetData(ss, "MCQs")
  };

  Logger.log(JSON.stringify(data));
}


function getSheetData(ss, sheetName) {
  const sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    throw new Error("Sheet not found: " + sheetName);
  }

  const values = sheet.getDataRange().getValues();

  if (values.length < 2) {
    return [];
  }

  const headers = values[0];

  return values.slice(1).map(function(row) {
    const obj = {};

    headers.forEach(function(header, index) {
      obj[header] = row[index];
    });

    return obj;
  });
}

// ALPHA-PLUS — INDEX REGISTRY: same shape as getSheetData(), but never
// throws if the sheet doesn't exist yet — it just returns []. Used only
// for the two NEW, OPTIONAL sheets (Index_Terms / Index_Node) so that
// sites that haven't run migrateIndexTerms() yet keep working exactly
// as before; every other sheet still uses the strict getSheetData().
function getSheetDataSafe_(ss, sheetName) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];

  try {
    return getSheetData(ss, sheetName);
  } catch (error) {
    return [];
  }
}

function doGet(e) {
  // ALPHA-PLUS — CONTENT LINK: new get_markdown action.
  // Everything else in doGet below this block is completely
  // unchanged — a request with no "action" param (or any action
  // other than get_markdown) still returns the same full JSON dump
  // it always did.
  const action = e && e.parameter ? e.parameter.action : null;

  if (action === "get_markdown") {
    return handleGetMarkdown(e.parameter.ref);
  }

  // MCQ BANK — PHASE 5: lazy get_mcqs action.
  // MCQs are intentionally excluded from the default dump below.
  if (action === "get_mcqs") {
    return handleGetMcqs(e.parameter);
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const data = {
    nodes: getSheetData(ss, "Nodes"),
    content: getSheetData(ss, "Content_Core"),
    resources: getSheetData(ss, "Resources"),
    // Phase 5: MCQs are loaded lazily through ?action=get_mcqs.
    // ALPHA-PLUS — INDEX REGISTRY (redesign spec sections 3/7/8).
    // Optional/additive: [] until migrateIndexTerms() has been run
    // once, so existing clients/behaviour are completely unaffected.
    index_terms: getSheetDataSafe_(ss, "Index_Terms"),
    index_links: getSheetDataSafe_(ss, "Index_Node")
  };

  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {

  try {

    const data = JSON.parse(e.postData.contents);

    // Author Core save
    if (data.action === "save_core") {
      const result = saveCoreContent(data);

      return ContentService
        .createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Author MCQ save
    if (data.action === "save_mcq") {
      const result = saveMcq(data);

      return ContentService
        .createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Public / community Resource save
    if (data.action === "save_resource") {
      const result = saveResource(data);

      return ContentService
        .createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Resource delete
    if (data.action === "delete_resource") {
      const result = deleteResourceRow(data);

      return ContentService
        .createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Structure (Nodes) save - Subject/Course/Unit/Chapter/Topic/Subtopic
    if (data.action === "save_structure") {
      const result = saveStructureNode(data);

      return ContentService
        .createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Structure (Nodes) delete - also removes all descendants
    if (data.action === "delete_structure") {
      const result = deleteStructureNodeRow(data);

      return ContentService
        .createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // ALPHA-PLUS — INDEX REGISTRY: create/reuse a canonical Index term
    // (spec sections 3/4). Not called by any current UI yet — this is
    // the write path a future "add index term manually" (spec section
    // 10 review workflow) or content-term-review UI will call. Safe to
    // ship now: it's additive and nothing existing calls it.
    if (data.action === "save_index_term") {
      const result = findOrCreateIndexTerm_(data.term);

      return ContentService
        .createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // ALPHA-PLUS — INDEX REGISTRY: link an existing Index term to a
    // tree node (many-to-many, spec section 7). source_type mirrors
    // spec section 8: "tree" | "content" | "alias" | "manual".
    if (data.action === "link_index_term") {
      const result = linkIndexTerm_(data.index_id, data.node_id, data.source_type);

      return ContentService
        .createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // MCQ BANK — PHASE 3: bulk import from js/mcq-parse.js's parseMcqMarkdown()
    // output. Not called by any client UI yet (that's Phase 4) — testable via
    // testSaveMcqsBulk() below, same style as testDoPostMcq(). Does not
    // replace/touch the existing single-row "save_mcq" action above.
    if (data.action === "save_mcqs_bulk") {
      const result = saveMcqsBulk(data);

      return ContentService
        .createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // MCQ BANK — PHASE 6: field-level metadata patch.
    // Only the fixed allow-list inside updateMcqMeta() can ever be written.
    if (data.action === "update_mcq_meta") {
      const result = updateMcqMeta(data);
      return ContentService
        .createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Unknown / unhandled action - no legacy Community fallback anymore
    return ContentService
      .createTextOutput(JSON.stringify({
        success: false,
        error: "Unknown action: " + (data.action || "(none provided)")
      }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {

    return ContentService
      .createTextOutput(JSON.stringify({
        success: false,
        error: error.message
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function saveCoreContent(data) {

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Content_Core");

  if (!sheet) {
    throw new Error("Content_Core sheet not found.");
  }

  const now = new Date();

  const nodeId = data.node_id;
  const contentType = data.content_type;

  if (!nodeId) {
    throw new Error("node_id is required.");
  }

  if (!contentType) {
    throw new Error("content_type is required.");
  }

  const values = sheet.getDataRange().getValues();
  const headers = values[0];

  const nodeIndex = headers.indexOf("node_id");
  const typeIndex = headers.indexOf("content_type");

  if (nodeIndex === -1 || typeIndex === -1) {
    throw new Error("Required Content_Core columns not found.");
  }

  // Find existing row for this node + content type
  let existingRow = -1;

  for (let i = 1; i < values.length; i++) {
    if (
      String(values[i][nodeIndex]) === String(nodeId) &&
      String(values[i][typeIndex]) === String(contentType)
    ) {
      existingRow = i + 1;
      break;
    }
  }

  const rowData = {
    content_id:
      data.content_id ||
      "content_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),

    node_id: nodeId,
    content_type: contentType,
    title: data.title || "",
    content: data.content || "",
    status: data.status || "published",
    author_id: data.author_id || "author",
    version: data.version || 1,
    created_at: data.created_at || now,
    updated_at: now
  };

  const row = headers.map(function(header) {
    return rowData[header] !== undefined
      ? rowData[header]
      : "";
  });

  if (existingRow !== -1) {

    // Preserve original content_id and created_at
    const oldRow = values[existingRow - 1];

    const contentIdIndex = headers.indexOf("content_id");
    const createdAtIndex = headers.indexOf("created_at");

    if (contentIdIndex !== -1) {
      row[contentIdIndex] = oldRow[contentIdIndex];
    }

    if (createdAtIndex !== -1) {
      row[createdAtIndex] = oldRow[createdAtIndex];
    }

    sheet.getRange(existingRow, 1, 1, headers.length)
      .setValues([row]);

    return {
      success: true,
      action: "updated",
      content_id: rowData.content_id,
      node_id: nodeId,
      content_type: contentType
    };

  } else {

    sheet.appendRow(row);

    return {
      success: true,
      action: "created",
      content_id: rowData.content_id,
      node_id: nodeId,
      content_type: contentType
    };
  }
}

function saveMcq(data) {

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("MCQs");

  if (!sheet) {
    throw new Error("MCQs sheet not found.");
  }

  const now = new Date();

  const nodeId = data.node_id;

  if (!nodeId) {
    throw new Error("node_id is required.");
  }

  const mcqId =
    data.mcq_id ||
    "mcq_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);

  const values = sheet.getDataRange().getValues();
  const headers = values[0];

  const idIndex = headers.indexOf("mcq_id");

  if (idIndex === -1) {
    throw new Error("mcq_id column not found in MCQs sheet.");
  }

  // Find existing row for this mcq_id (update instead of duplicate)
  let existingRow = -1;

  for (let i = 1; i < values.length; i++) {
    if (String(values[i][idIndex]) === String(mcqId)) {
      existingRow = i + 1;
      break;
    }
  }

  const rowData = {
    mcq_id: mcqId,
    node_id: nodeId,
    question: data.question || "",
    option_a: data.option_a || "",
    option_b: data.option_b || "",
    option_c: data.option_c || "",
    option_d: data.option_d || "",
    correct_option: data.correct_option !== undefined ? data.correct_option : "0",
    explanation: data.explanation || "",
    status: data.status || "published",
    author_id: data.author_id || "author",
    created_at: data.created_at || now,
    updated_at: now
  };

  const row = headers.map(function(header) {
    return rowData[header] !== undefined
      ? rowData[header]
      : "";
  });

  if (existingRow !== -1) {

    const oldRow = values[existingRow - 1];
    const createdAtIndex = headers.indexOf("created_at");

    if (createdAtIndex !== -1) {
      row[createdAtIndex] = oldRow[createdAtIndex];
    }

    sheet.getRange(existingRow, 1, 1, headers.length)
      .setValues([row]);

    return {
      success: true,
      action: "updated",
      mcq_id: mcqId,
      node_id: nodeId
    };

  } else {

    sheet.appendRow(row);

    return {
      success: true,
      action: "created",
      mcq_id: mcqId,
      node_id: nodeId
    };
  }
}

function saveResource(data) {

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Resources");

  if (!sheet) {
    throw new Error("Resources sheet not found.");
  }

  const now = new Date();

  const nodeId = data.node_id;

  if (!nodeId) {
    throw new Error("node_id is required.");
  }

  const resourceId =
    data.resource_id ||
    "res_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);

  const values = sheet.getDataRange().getValues();
  const headers = values[0];

  const idIndex = headers.indexOf("resource_id");

  if (idIndex === -1) {
    throw new Error("resource_id column not found in Resources sheet.");
  }

  // Find existing row for this resource_id (update instead of duplicate)
  let existingRow = -1;

  for (let i = 1; i < values.length; i++) {
    if (String(values[i][idIndex]) === String(resourceId)) {
      existingRow = i + 1;
      break;
    }
  }

  const rowData = {
    resource_id: resourceId,
    node_id: nodeId,
    resource_type: data.resource_type || "Web",
    title: data.title || "",
    url: data.url || "",
    location_ref: data.location_ref || "",
    description: data.description || "",
    status: data.status || "published",
    author_id: data.author_id || "community",
    created_at: data.created_at || now,
    updated_at: now
  };

  const row = headers.map(function(header) {
    return rowData[header] !== undefined
      ? rowData[header]
      : "";
  });

  if (existingRow !== -1) {

    const oldRow = values[existingRow - 1];
    const createdAtIndex = headers.indexOf("created_at");

    if (createdAtIndex !== -1) {
      row[createdAtIndex] = oldRow[createdAtIndex];
    }

    sheet.getRange(existingRow, 1, 1, headers.length)
      .setValues([row]);

    return {
      success: true,
      action: "updated",
      resource_id: resourceId,
      node_id: nodeId
    };

  } else {

    sheet.appendRow(row);

    return {
      success: true,
      action: "created",
      resource_id: resourceId,
      node_id: nodeId
    };
  }
}

function deleteResourceRow(data) {

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Resources");

  if (!sheet) {
    throw new Error("Resources sheet not found.");
  }

  const resourceId = data.resource_id;

  if (!resourceId) {
    throw new Error("resource_id is required.");
  }

  const values = sheet.getDataRange().getValues();
  const headers = values[0];

  const idIndex = headers.indexOf("resource_id");

  if (idIndex === -1) {
    throw new Error("resource_id column not found in Resources sheet.");
  }

  for (let i = 1; i < values.length; i++) {
    if (String(values[i][idIndex]) === String(resourceId)) {
      sheet.deleteRow(i + 1);

      return {
        success: true,
        action: "deleted",
        resource_id: resourceId
      };
    }
  }

  return {
    success: false,
    error: "Resource not found: " + resourceId
  };
}

function saveStructureNode(data) {

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Nodes");

  if (!sheet) {
    throw new Error("Nodes sheet not found.");
  }

  const now = new Date();

  const nodeId = data.node_id;
  const nodeType = data.node_type;
  const title = data.title;

  if (!nodeId) {
    throw new Error("node_id is required.");
  }

  if (!nodeType) {
    throw new Error("node_type is required.");
  }

  if (!title) {
    throw new Error("title is required.");
  }

  const values = sheet.getDataRange().getValues();
  const headers = values[0];

  const idIndex = headers.indexOf("node_id");

  if (idIndex === -1) {
    throw new Error("node_id column not found in Nodes sheet.");
  }

  // Find existing row for this node_id (update instead of duplicate)
  let existingRow = -1;

  for (let i = 1; i < values.length; i++) {
    if (String(values[i][idIndex]) === String(nodeId)) {
      existingRow = i + 1;
      break;
    }
  }

  const rowData = {
    node_id: nodeId,
    parent_id: data.parent_id || "",
    node_type: nodeType,
    title: title,
    sort_order: data.sort_order || 1,
    status: data.status || "active",
    author_id: data.author_id || "user",
    created_at: data.created_at || now,
    updated_at: now
  };

  const row = headers.map(function(header) {
    return rowData[header] !== undefined
      ? rowData[header]
      : "";
  });

  if (existingRow !== -1) {

    const oldRow = values[existingRow - 1];
    const createdAtIndex = headers.indexOf("created_at");

    if (createdAtIndex !== -1) {
      row[createdAtIndex] = oldRow[createdAtIndex];
    }

    sheet.getRange(existingRow, 1, 1, headers.length)
      .setValues([row]);

    return {
      success: true,
      action: "updated",
      node_id: nodeId
    };

  } else {

    sheet.appendRow(row);

    return {
      success: true,
      action: "created",
      node_id: nodeId
    };
  }
}

function deleteStructureNodeRow(data) {

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Nodes");

  if (!sheet) {
    throw new Error("Nodes sheet not found.");
  }

  const nodeId = data.node_id;

  if (!nodeId) {
    throw new Error("node_id is required.");
  }

  const values = sheet.getDataRange().getValues();
  const headers = values[0];

  const idIndex = headers.indexOf("node_id");
  const parentIndex = headers.indexOf("parent_id");

  if (idIndex === -1 || parentIndex === -1) {
    throw new Error("Required Nodes columns not found.");
  }

  // Collect this node and every descendant (recursive via parent_id chain)
  const idsToDelete = {};
  idsToDelete[String(nodeId)] = true;

  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 1; i < values.length; i++) {
      const rowId = String(values[i][idIndex]);
      const rowParent = String(values[i][parentIndex]);

      if (idsToDelete[rowParent] && !idsToDelete[rowId]) {
        idsToDelete[rowId] = true;
        changed = true;
      }
    }
  }

  // Delete matching rows bottom-up so row indices stay valid
  let deletedCount = 0;

  for (let i = values.length - 1; i >= 1; i--) {
    const rowId = String(values[i][idIndex]);
    if (idsToDelete[rowId]) {
      sheet.deleteRow(i + 1);
      deletedCount++;
    }
  }

  return {
    success: true,
    action: "deleted",
    node_id: nodeId,
    rows_deleted: deletedCount
  };
}

/* =========================================================
   ALPHA-PLUS — CONTENT LINK: get_markdown action
   Reads a .md file's text from the user's own Google Drive and
   returns it as JSON. Does not touch Content_Core, Resources,
   Nodes, or any doPost action above.
   ========================================================= */

// Optional: a Drive folder ID used only for the manual/reverse-workflow
// fallback, where someone typed a bare filename (instead of a link or
// file ID) directly into the Sheet. Leave as "" to disable this
// fallback — the link/file-ID path still works either way.
const STUDY_CONTENT_FOLDER_ID = "";

/* =========================================================
   MCQ BANK — PHASE 5 of 7: lazy get_mcqs endpoint
   Returns only the mcqs matching the given filters, plus only
   the passages/collections those specific mcqs reference.
   node_id / collection_id / tag are optional and combine as AND.
   ========================================================= */
/* =========================================================
   MCQ BANK — PHASE 6 of 7: update_mcq_meta
   Field-level patch for manual metadata edits only.
   Source/content fields are intentionally not editable here.
   ========================================================= */
const MCQ_META_EDITABLE_COLUMNS = [
  "node_id", "tags", "description", "difficulty", "language", "status"
];

function updateMcqMeta(data) {
  if (!data || !data.mcq_id) throw new Error("mcq_id is required.");

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("MCQs");
  if (!sheet) throw new Error("MCQs sheet not found.");

  const values = sheet.getDataRange().getValues();
  if (!values.length) throw new Error("MCQs sheet is empty.");

  const headers = values[0];
  const idCol = headers.indexOf("mcq_id");
  if (idCol === -1) throw new Error("mcq_id column not found.");

  let targetRow = -1;
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][idCol]) === String(data.mcq_id)) {
      targetRow = i + 1;
      break;
    }
  }
  if (targetRow === -1) throw new Error("mcq_id not found: " + data.mcq_id);

  const fields = data.fields || {};
  const changed = [];
  const now = new Date();

  MCQ_META_EDITABLE_COLUMNS.forEach(function(col) {
    if (fields[col] === undefined) return;
    const colIndex = headers.indexOf(col);
    if (colIndex === -1) return;
    sheet.getRange(targetRow, colIndex + 1).setValue(fields[col]);
    changed.push(col);
  });

  if (changed.length) {
    const updatedAtCol = headers.indexOf("updated_at");
    if (updatedAtCol !== -1) {
      sheet.getRange(targetRow, updatedAtCol + 1).setValue(now);
    }
  }

  return {
    success: true,
    mcq_id: data.mcq_id,
    fields_changed: changed
  };
}

function handleGetMcqs(params) {
  params = params || {};
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  let mcqs = getSheetData(ss, "MCQs");
  const passages = getSheetDataSafe_(ss, "MCQ_Passages");
  const collections = getSheetDataSafe_(ss, "Collections");

  if (params.node_id) {
    mcqs = mcqs.filter(row => String(row.node_id) === String(params.node_id));
  }
  if (params.collection_id) {
    mcqs = mcqs.filter(row => String(row.collection_id) === String(params.collection_id));
  }
  if (params.tag) {
    const wanted = String(params.tag).toLowerCase();
    mcqs = mcqs.filter(row => String(row.tags || "").toLowerCase()
      .split(",").map(t => t.trim()).includes(wanted));
  }

  const passageIds = new Set(mcqs.map(m => m.passage_id).filter(Boolean));
  const collectionIds = new Set(mcqs.map(m => m.collection_id).filter(Boolean));

  return ContentService
    .createTextOutput(JSON.stringify({
      mcqs: mcqs,
      passages: passages.filter(p => passageIds.has(p.passage_id)),
      collections: collections.filter(c => collectionIds.has(c.collection_id))
    }))
    .setMimeType(ContentService.MimeType.JSON);
}

function handleGetMarkdown(ref) {
  try {
    const cleanRef = String(ref || "").trim();

    if (!cleanRef) {
      return jsonResponse_({ ok: false, error: "No content link is saved for this topic." });
    }

    const fileId = extractDriveFileId_(cleanRef);
    let file = null;

    if (fileId) {
      try {
        file = DriveApp.getFileById(fileId);
      } catch (notFoundOrNoAccess) {
        file = null;
      }
    }

    if (!file && STUDY_CONTENT_FOLDER_ID) {
      file = findFileByNameInFolder_(cleanRef, STUDY_CONTENT_FOLDER_ID);
    }

    if (!file) {
      return jsonResponse_({
        ok: false,
        error: "Could not find or open this file. Check that it's shared as " +
               "\"Anyone with the link can view\" and that the link is correct."
      });
    }

    const text = file.getBlob().getDataAsString("UTF-8");
    return jsonResponse_({ ok: true, content: text });

  } catch (error) {
    // Never let an unexpected error surface as a raw failure — always
    // return the same JSON shape the frontend expects.
    return jsonResponse_({
      ok: false,
      error: "Unexpected error reading this file: " + error.message
    });
  }
}

// Recognizes common Drive share-link formats, or a bare file ID typed
// directly (e.g. pasted straight into the Sheet for the reverse workflow).
function extractDriveFileId_(ref) {
  let match = ref.match(/\/d\/([a-zA-Z0-9_-]{10,})/);   // /file/d/ID/view, /document/d/ID/edit
  if (match) return match[1];

  match = ref.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);      // ?id=ID / &id=ID
  if (match) return match[1];

  if (/^[a-zA-Z0-9_-]{10,}$/.test(ref)) return ref;      // a bare file ID with no slashes

  return null;
}

function findFileByNameInFolder_(filename, folderId) {
  try {
    const folder = DriveApp.getFolderById(folderId);
    const files = folder.getFilesByName(filename);
    if (files.hasNext()) return files.next();
  } catch (folderError) {
    // Missing/inaccessible folder is treated as "not found" upstream.
  }
  return null;
}

function jsonResponse_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* =========================================================
   ALPHA-PLUS — INDEX REGISTRY
   (Redesign spec: "Alpha Website — Redesign and Strengthen the
   Index System")

   Two new sheets, created automatically the first time
   migrateIndexTerms() runs (or by ensureIndexSheets_() the first
   time any of the functions below needs them):

     Index_Terms
       index_id | term | normalized_term | created_at | updated_at

     Index_Node
       index_id | node_id | source_type | created_at

   source_type is one of: "tree" | "content" | "alias" | "manual"
   (spec section 8).

   index_id is generated as "I" + a zero-padded incrementing
   number, based on the highest existing index_id already in the
   sheet — so re-running migrateIndexTerms() is idempotent: an
   existing normalized_term is reused rather than duplicated, and
   a fresh run never collides with IDs a prior run created.
   ========================================================= */

function normalizeTerm_(term) {
  return String(term || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function ensureIndexSheets_(ss) {
  let termsSheet = ss.getSheetByName("Index_Terms");
  if (!termsSheet) {
    termsSheet = ss.insertSheet("Index_Terms");
    termsSheet.appendRow(["index_id", "term", "normalized_term", "created_at", "updated_at"]);
  }

  let linksSheet = ss.getSheetByName("Index_Node");
  if (!linksSheet) {
    linksSheet = ss.insertSheet("Index_Node");
    linksSheet.appendRow(["index_id", "node_id", "source_type", "created_at"]);
  }

  return { termsSheet, linksSheet };
}

function nextIndexId_(termsSheet) {
  const values = termsSheet.getDataRange().getValues();
  let maxNum = 0;

  for (let i = 1; i < values.length; i++) {
    const match = String(values[i][0] || "").match(/^I(\d+)$/);
    if (match) {
      maxNum = Math.max(maxNum, parseInt(match[1], 10));
    }
  }

  return "I" + String(maxNum + 1).padStart(3, "0");
}

// Finds an existing Index_Terms row for this term (by normalized_term)
// or creates a new one. Always returns { success, index_id, term,
// action: "found" | "created" }. This is the ONLY place a new index_id
// is ever minted, so calling it repeatedly for the same term is safe.
function findOrCreateIndexTerm_(term) {
  const cleanTerm = String(term || "").trim();
  if (!cleanTerm) {
    throw new Error("term is required.");
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const { termsSheet } = ensureIndexSheets_(ss);
  const normalized = normalizeTerm_(cleanTerm);

  const values = termsSheet.getDataRange().getValues();
  const headers = values[0];
  const normIndex = headers.indexOf("normalized_term");
  const idIndex = headers.indexOf("index_id");

  for (let i = 1; i < values.length; i++) {
    if (String(values[i][normIndex]) === normalized) {
      return { success: true, action: "found", index_id: values[i][idIndex], term: values[i][headers.indexOf("term")] };
    }
  }

  const now = new Date();
  const indexId = nextIndexId_(termsSheet);

  termsSheet.appendRow([indexId, cleanTerm, normalized, now, now]);

  return { success: true, action: "created", index_id: indexId, term: cleanTerm };
}

// Links an Index term to a tree node if that exact pair doesn't
// already exist (many-to-many, spec section 7 — safe to call more
// than once for the same pair).
function linkIndexTerm_(indexId, nodeId, sourceType) {
  if (!indexId) throw new Error("index_id is required.");
  if (!nodeId) throw new Error("node_id is required.");

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const { linksSheet } = ensureIndexSheets_(ss);

  const values = linksSheet.getDataRange().getValues();
  const headers = values[0];
  const idIdx = headers.indexOf("index_id");
  const nodeIdx = headers.indexOf("node_id");

  for (let i = 1; i < values.length; i++) {
    if (String(values[i][idIdx]) === String(indexId) && String(values[i][nodeIdx]) === String(nodeId)) {
      return { success: true, action: "already_linked", index_id: indexId, node_id: nodeId };
    }
  }

  linksSheet.appendRow([indexId, nodeId, sourceType || "manual", new Date()]);

  return { success: true, action: "linked", index_id: indexId, node_id: nodeId };
}

// ALPHA-PLUS — ONE-SHOT MIGRATION (spec section 16/17, Phase 3).
// Run this ONCE from the Apps Script editor (select migrateIndexTerms
// in the function dropdown, then Run). It is deterministic and
// idempotent — safe to re-run any time (e.g. after adding new nodes
// or new "index_terms" aliases) without creating duplicate Index_Terms
// rows or duplicate Index_Node links.
//
// Walks:
//   1. Every row in "Nodes"          -> term = title,          source_type = "tree"
//   2. Every "Content_Core" row with
//      content_type = "index_terms" -> term = each alias,      source_type = "alias"
//
// Does NOT touch Nodes, Content_Core, Resources, or MCQs.
function migrateIndexTerms() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureIndexSheets_(ss);

  const nodes = getSheetData(ss, "Nodes");
  const contentRows = getSheetData(ss, "Content_Core");

  let termsCreated = 0;
  let linksCreated = 0;

  nodes.forEach(function(node) {
    const title = String(node.title || "").trim();
    if (!title) return;

    const termResult = findOrCreateIndexTerm_(title);
    if (termResult.action === "created") termsCreated++;

    const linkResult = linkIndexTerm_(termResult.index_id, node.node_id, "tree");
    if (linkResult.action === "linked") linksCreated++;
  });

  contentRows
    .filter(function(row) { return row.content_type === "index_terms" && row.content; })
    .forEach(function(row) {
      String(row.content)
        .split(/[,\n]/)
        .map(function(x) { return x.trim(); })
        .filter(Boolean)
        .forEach(function(alias) {
          const termResult = findOrCreateIndexTerm_(alias);
          if (termResult.action === "created") termsCreated++;

          const linkResult = linkIndexTerm_(termResult.index_id, row.node_id, "alias");
          if (linkResult.action === "linked") linksCreated++;
        });
    });

  const summary = {
    success: true,
    nodes_scanned: nodes.length,
    content_rows_scanned: contentRows.length,
    terms_created: termsCreated,
    links_created: linksCreated
  };

  Logger.log(JSON.stringify(summary));
  return summary;
}

function testSaveCoreContent() {

  const result = saveCoreContent({
    node_id: "topic_01",
    content_type: "explanation",
    title: "Test Core Content",
    content: "This is a test written by the Author Core save function.",
    status: "published",
    author_id: "test_author",
    version: 1
  });

  Logger.log(JSON.stringify(result));
}

function testSaveMcq() {

  const result = saveMcq({
    node_id: "topic_01",
    question: "Test question from Apps Script?",
    option_a: "Option A",
    option_b: "Option B",
    option_c: "Option C",
    option_d: "Option D",
    correct_option: "0",
    explanation: "This is a test MCQ.",
    status: "published",
    author_id: "test_author"
  });

  Logger.log(JSON.stringify(result));
}

function testSaveResource() {

  const result = saveResource({
    node_id: "topic_01",
    resource_type: "Web",
    title: "Test resource from Apps Script",
    url: "https://example.com",
    location_ref: "1-2",
    description: "This is a test resource.",
    status: "published",
    author_id: "test_user"
  });

  Logger.log(JSON.stringify(result));
}

function testDoPostCore() {

  const mockEvent = {
    postData: {
      contents: JSON.stringify({
        action: "save_core",
        node_id: "topic_01",
        content_type: "example",
        title: "Test Core Example",
        content: "This is a test example from Author routing.",
        status: "published",
        author_id: "test_author",
        version: 1
      })
    }
  };

  const result = doPost(mockEvent);

  Logger.log(result.getContent());
}

function testDoPostMcq() {

  const mockEvent = {
    postData: {
      contents: JSON.stringify({
        action: "save_mcq",
        node_id: "topic_01",
        question: "Live POST MCQ test?",
        option_a: "A",
        option_b: "B",
        option_c: "C",
        option_d: "D",
        correct_option: "0",
        explanation: "Testing save_mcq routing.",
        status: "published",
        author_id: "test_author"
      })
    }
  };

  const result = doPost(mockEvent);

  Logger.log(result.getContent());
}

function testDeleteResource() {

  const created = saveResource({
    node_id: "topic_01",
    title: "Temp resource to delete",
    url: "https://example.com",
    status: "published",
    author_id: "test_user"
  });

  const result = deleteResourceRow({ resource_id: created.resource_id });

  Logger.log(JSON.stringify(result));
}

function testDoPostResource() {

  const mockEvent = {
    postData: {
      contents: JSON.stringify({
        action: "save_resource",
        node_id: "topic_01",
        resource_type: "Web",
        title: "Live POST Resource test",
        url: "https://example.com",
        location_ref: "1-2",
        description: "Testing save_resource routing.",
        status: "published",
        author_id: "test_user"
      })
    }
  };

  const result = doPost(mockEvent);

  Logger.log(result.getContent());
}

/* =========================================================
   MCQ BANK — PHASE 1 of 7: SCHEMA SETUP (Sheets only)

   Extends the existing "MCQs" sheet with new optional columns and
   adds two new optional sheets ("Collections", "MCQ_Passages"),
   following the exact same additive/idempotent pattern already
   proven by the Index Registry above (ensureIndexSheets_ /
   getSheetDataSafe_ / findOrCreateIndexTerm_):

     - Existing columns/sheets/rows are never touched or reordered.
     - Running the one-time setup function five times in a row
       produces the same end state as running it once.
     - doGet / doPost are NOT touched in this phase — no new
       actions, no API shape change. getSheetData(ss, "MCQs") will
       automatically start returning the new columns (blank on old
       rows) once they exist, since it just reads whatever headers
       are in row 1.

   Run setupMcqBankSheets() ONCE from the Apps Script editor
   (select it in the function dropdown, then Run) to turn this on.
   ========================================================= */

// New columns appended to the end of the existing "MCQs" sheet's
// header row, only if not already present.
const MCQ_BANK_NEW_COLUMNS_ = [
  "question_type", "passage_id", "collection_id", "question_no",
  "difficulty", "language", "tags", "description", "exam", "year",
  "session", "source", "source_question_no"
];

// Idempotent: adds any of MCQ_BANK_NEW_COLUMNS_ missing from row 1,
// leaves everything else (existing columns, their order, all data
// rows) completely untouched.
function ensureMcqColumns_(sheet) {
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String);

  MCQ_BANK_NEW_COLUMNS_.forEach(function(col) {
    if (headers.indexOf(col) === -1) {
      sheet.getRange(1, sheet.getLastColumn() + 1).setValue(col);
      headers.push(col);
    }
  });
}

// Idempotent: creates "Collections" and "MCQ_Passages" sheets with
// their header rows only if they don't already exist. Mirrors
// ensureIndexSheets_ above exactly.
function ensureMcqBankSheets_(ss) {
  let collectionsSheet = ss.getSheetByName("Collections");
  if (!collectionsSheet) {
    collectionsSheet = ss.insertSheet("Collections");
    collectionsSheet.appendRow(["collection_id", "title", "normalized_title",
      "description", "exam", "year", "session", "paper", "subject", "language",
      "created_at", "updated_at"]);
  }

  let passagesSheet = ss.getSheetByName("MCQ_Passages");
  if (!passagesSheet) {
    passagesSheet = ss.insertSheet("MCQ_Passages");
    passagesSheet.appendRow(["passage_id", "node_id", "kind", "content",
      "created_at", "updated_at"]);
  }

  return { collectionsSheet: collectionsSheet, passagesSheet: passagesSheet };
}

// ONE-TIME SETUP — select this in the Apps Script editor's function
// dropdown and click Run, once. Safe to re-run any number of times:
// no duplicate columns, no duplicate sheets.
function setupMcqBankSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  ensureMcqBankSheets_(ss);

  const mcqSheet = ss.getSheetByName("MCQs");
  if (!mcqSheet) {
    throw new Error("MCQs sheet not found.");
  }
  ensureMcqColumns_(mcqSheet);

  Logger.log("MCQ Bank schema ready: MCQs columns extended, Collections + MCQ_Passages sheets present.");
}

/* =========================================================
   MCQ BANK — PHASE 3 of 7: save_mcqs_bulk BACKEND
   (spec: "Phase 3 of 7 — MCQ Bank: save_mcqs_bulk Backend")

   Takes the exact output shape of js/mcq-parse.js's
   parseMcqMarkdown() — { collections, passages, mcqs } — and
   writes it into the MCQs / Collections / MCQ_Passages sheets
   (all created in Phase 1) idempotently:

     - ensureCollection_() finds-or-creates each distinct
       collection title (same find-or-create pattern as
       findOrCreateIndexTerm_ above), so every MCQ row is written
       with a real collection_id, never the raw title string.
     - Existing rows (matched by mcq_id / passage_id) are MERGED
       over, not overwritten — any column the incoming payload
       doesn't mention keeps its current value, which is what
       protects a hand-edited cell (Phase 6) from being blanked
       out by re-importing the same source file later.
     - Everything is read once per sheet, then written back in as
       few range operations as possible (one appendRow-equivalent
       batch write for new rows, one setValues per updated row) —
       never appendRow() in a loop over many rows.

   Nothing here is called by any client UI yet — that's Phase 4.
   testSaveMcqsBulk() below exercises it via a mock doPost, same
   style as testDoPostMcq().
   ========================================================= */

function normalizeCollectionTitle_(title) {
  return String(title || "").trim().toLowerCase().replace(/\s+/g, " ");
}

// Find-or-create a Collections row for this title, returning its
// collection_id. A question with no collection is valid — returns
// null rather than creating an empty/placeholder row.
function ensureCollection_(ss, info) {
  const title = String(info.title || "").trim();
  if (!title) return null;

  let sheet = ss.getSheetByName("Collections");
  if (!sheet) sheet = ensureMcqBankSheets_(ss).collectionsSheet;

  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const normIndex = headers.indexOf("normalized_title");
  const idIndex = headers.indexOf("collection_id");
  const normalized = normalizeCollectionTitle_(title);

  for (let i = 1; i < values.length; i++) {
    if (String(values[i][normIndex]) === normalized) {
      return values[i][idIndex];
    }
  }

  const now = new Date();
  const collectionId = "col_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);

  sheet.appendRow([collectionId, title, normalized, info.description || "",
    info.exam || "", info.year || "", info.session || "", info.paper || "",
    info.subject || "", info.language || "", now, now]);

  return collectionId;
}

// Shared upsert helper — read the sheet once, decide new-vs-update
// in memory, write in one batch for new rows plus one setValues per
// updated row. Any incoming row missing its id column is skipped
// (nothing to key it on). Merge-over-old-row: a column absent from
// the incoming row object keeps whatever the sheet already had.
function upsertRows_(sheet, rows, idColumnName) {
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const idCol = headers.indexOf(idColumnName);

  const existingRowByEntity = {};
  for (let i = 1; i < values.length; i++) {
    existingRowByEntity[String(values[i][idCol])] = i + 1;
  }

  const now = new Date();
  const toAppend = [];
  const results = [];

  rows.forEach(function(row) {
    const id = row[idColumnName];
    if (!id) return;

    const incoming = Object.assign({}, row, { updated_at: now });
    const existingRow = existingRowByEntity[id];

    if (existingRow) {
      const oldRow = values[existingRow - 1];
      const mergedRow = headers.map(function(h, idx) {
        return incoming[h] !== undefined ? incoming[h] : oldRow[idx];
      });
      sheet.getRange(existingRow, 1, 1, headers.length).setValues([mergedRow]);
      results.push({ id: id, action: "updated" });
    } else {
      const newRow = headers.map(function(h) {
        return h === "created_at" ? now : (incoming[h] !== undefined ? incoming[h] : "");
      });
      toAppend.push(newRow);
      results.push({ id: id, action: "created" });
    }
  });

  if (toAppend.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, toAppend.length, headers.length).setValues(toAppend);
  }

  return results;
}

// Bulk-import entry point. `data` is the doPost payload:
// { action: "save_mcqs_bulk", collections: [...], passages: [...], mcqs: [...] }
// matching parseMcqMarkdown()'s output shape exactly.
function saveMcqsBulk(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const mcqSheet = ss.getSheetByName("MCQs");
  if (!mcqSheet) {
    throw new Error("MCQs sheet not found.");
  }

  const passageSheet = ss.getSheetByName("MCQ_Passages") || ensureMcqBankSheets_(ss).passagesSheet;

  // --- 1. Resolve every distinct collection title to a real collection_id first ---
  const collectionIdByTitle = {};
  (data.collections || []).forEach(function(c) {
    if (!c.title) return;
    collectionIdByTitle[c.title] = ensureCollection_(ss, c);
  });

  // --- 2. Upsert passages ---
  const passageResults = upsertRows_(passageSheet, data.passages || [], "passage_id");

  // --- 3. Upsert MCQs (same merge-over-old-row logic as upsertRows_,
  //        inlined here because it also needs to resolve
  //        collection_id_ref -> collection_id and strip warnings) ---
  const mcqValues = mcqSheet.getDataRange().getValues();
  const mcqHeaders = mcqValues[0];
  const idCol = mcqHeaders.indexOf("mcq_id");

  const existingRowByEntity = {};
  for (let i = 1; i < mcqValues.length; i++) {
    existingRowByEntity[String(mcqValues[i][idCol])] = i + 1;
  }

  const now = new Date();
  const toAppend = [];
  const results = [];

  (data.mcqs || []).forEach(function(mcq) {
    const resolvedCollectionId = mcq.collection_id_ref
      ? (collectionIdByTitle[mcq.collection_id_ref] || "")
      : "";

    const incoming = Object.assign({}, mcq, { collection_id: resolvedCollectionId, updated_at: now });
    delete incoming.collection_id_ref; // not a sheet column — resolved above
    delete incoming.warnings;          // preview-only metadata, never written

    const existingRow = existingRowByEntity[mcq.mcq_id];

    if (existingRow) {
      const oldRow = mcqValues[existingRow - 1];
      const mergedRow = mcqHeaders.map(function(h, idx) {
        return incoming[h] !== undefined ? incoming[h] : oldRow[idx];
      });
      mcqSheet.getRange(existingRow, 1, 1, mcqHeaders.length).setValues([mergedRow]);
      results.push({ mcq_id: mcq.mcq_id, action: "updated" });
    } else {
      const newRow = mcqHeaders.map(function(h) {
        return h === "created_at" ? now : (incoming[h] !== undefined ? incoming[h] : "");
      });
      toAppend.push(newRow);
      results.push({ mcq_id: mcq.mcq_id, action: "created" });
    }
  });

  if (toAppend.length) {
    mcqSheet.getRange(mcqSheet.getLastRow() + 1, 1, toAppend.length, mcqHeaders.length).setValues(toAppend);
  }

  return {
    success: true,
    mcq_results: results,
    passage_results: passageResults,
    collections_resolved: collectionIdByTitle
  };
}

/* ---- Verification (Phase 3 "Verify before calling this phase done") ---- */

// Mock doPost call, same style as testDoPostMcq(). Run this three
// times per the spec's verify steps:
//   1st run  -> all 3 mcqs "created", Collections gets exactly 1 new row,
//               the 2 linked rows get a real collection_id, the
//               standalone row's collection_id is blank.
//   2nd run (unchanged) -> all 3 "updated", no new rows anywhere.
//   3rd run (after hand-editing e.g. the "tags" cell on one row in
//   the Sheet UI, since this payload has no tags key) -> confirm the
//   hand-typed value survives (merge-over-old-row, not overwrite).
function testSaveMcqsBulk() {

  const payload = {
    action: "save_mcqs_bulk",
    collections: [
      { title: "UGC NET Dec 2025", description: "", exam: "UGC NET", year: "2025", session: "December" }
    ],
    passages: [],
    mcqs: [
      {
        mcq_id: "mcq_ugc-net-dec-2025_q1",
        node_id: "topic_01",
        question_type: "simple",
        passage_id: "",
        collection_id_ref: "UGC NET Dec 2025",
        question_no: 1,
        question: "Test bulk question 1?",
        option_a: "A", option_b: "B", option_c: "C", option_d: "D",
        correct_option: 0,
        explanation: "",
        // NOTE: "tags" is deliberately OMITTED (not tags: "") on this one
        // row — this is what makes it usable for the spec's verify step 3:
        // re-posting this exact payload must never touch this row's tags
        // column, so a hand-typed value survives re-import (merge, not
        // blind overwrite). Every other optional field is still included.
        difficulty: "", language: "en", description: "",
        exam: "UGC NET", year: "2025", session: "December",
        source: "", source_question_no: ""
      },
      {
        mcq_id: "mcq_ugc-net-dec-2025_q2",
        node_id: "topic_01",
        question_type: "simple",
        passage_id: "",
        collection_id_ref: "UGC NET Dec 2025",
        question_no: 2,
        question: "Test bulk question 2?",
        option_a: "A", option_b: "B", option_c: "C", option_d: "D",
        correct_option: 1,
        explanation: "",
        difficulty: "", language: "en", tags: "", description: "",
        exam: "UGC NET", year: "2025", session: "December",
        source: "", source_question_no: ""
      },
      {
        mcq_id: "mcq_" + "standalonetestquestion",
        node_id: "topic_01",
        question_type: "simple",
        passage_id: "",
        collection_id_ref: "",
        question_no: 1,
        question: "Standalone test question with no collection?",
        option_a: "A", option_b: "B", option_c: "C", option_d: "D",
        correct_option: 2,
        explanation: "",
        difficulty: "", language: "en", tags: "", description: "",
        exam: "", year: "", session: "",
        source: "", source_question_no: ""
      }
    ]
  };

  const mockEvent = { postData: { contents: JSON.stringify(payload) } };
  const result = doPost(mockEvent);

  Logger.log(result.getContent());
}
