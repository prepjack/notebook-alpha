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

  // ALPHA-PLUS — AUTO DRIVE FOLDERS: on-demand folder fetch/create.
  // This must be a GET endpoint because the frontend opens/fetches the
  // folder URL directly. Existing get_markdown behaviour remains unchanged.
  if (action === "get_or_create_node_folder") {
    try {
      const result = getNodeFolderInfo_(e.parameter.node_id);
      return jsonResponse_(result);
    } catch (error) {
      return jsonResponse_({
        success: false,
        error: error.message
      });
    }
  }

  if (action === "get_drive_migration_status") return jsonResponse_(getDriveFolderMigrationStatus());

  if (action === "get_markdown") {
    return handleGetMarkdown(e.parameter.ref);
  }

  // ALPHA-PLUS — DRIVE ASSET PROXY: Lottie/JSON assets cannot reliably
  // be loaded by lottie-web directly from Google Drive because Drive may
  // return an HTML viewer/download response or block the browser's CORS
  // request. The frontend therefore fetches JSON through this Apps Script
  // endpoint and passes the parsed Bodymovin object to lottie-web.
  if (action === "get_drive_asset") {
    return handleGetDriveAsset_(e.parameter.file_id);
  }

  // MCQ BANK — PHASE 5: lazy get_mcqs action.
  // MCQs are intentionally excluded from the default dump below.
  if (action === "get_mcqs") {
    return handleGetMcqs(e.parameter);
  }

  // ALPHA-PLUS — MCQ LINK: folder mode. Same idea as get_markdown's
  // folder mode for Content, but an MCQ source folder may hold MULTIPLE
  // .md files (one per paper/collection), so this returns every .md
  // file's content instead of picking just one. See handleGetMcqSource_.
  if (action === "get_mcq_source") {
    return handleGetMcqSource_(e.parameter.ref);
  }

  // AUTO DRIVE FOLDERS: on-demand folder creation/opening for a node.
  if (action === "get_or_create_node_folder") {
    return jsonResponse_(getNodeFolderInfo_(e.parameter.node_id));
  }

  if (action === "get_storage_status") {
    return jsonResponse_(getStorageStatus_());
  }

  // ALPHA-PLUS — INDEX TERMS (subtopic-scoped tab): every term (both
  // {{}}-auto and manual right-click) currently linked to one node,
  // read fresh from Index_Terms/Index_Node — same registry the global
  // A-Z glossary uses, just filtered to one node_id server-side.
  if (action === "get_index_terms_for_node") {
    return jsonResponse_(getIndexTermsForNode_(e.parameter.node_id));
  }

  // ALPHA-PLUS — INDEX TERMS: lightweight refresh for the GLOBAL
  // views (Full A-Z Glossary in the main app, index-directory.html) —
  // just the two index sheets, not the full Nodes/Content/Resources
  // dump. Without this, invalidateIndexCache() only cleared a LOCAL
  // rebuild cache and never actually re-fetched anything from the
  // server, so a term synced mid-session (via {{}} or right-click)
  // only ever showed up in "This Topic" (which does its own live
  // fetch) and never in the global views until a full page reload.
  if (action === "get_index_registry") {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    return jsonResponse_({
      success: true,
      index_terms: getSheetDataSafe_(ss, "Index_Terms"),
      index_links: getSheetDataSafe_(ss, "Index_Node")
    });
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

    // ALPHA-PLUS — INDEX TERMS (auto {{}} + manual right-click write
    // path). Frontend POSTs here are sent with mode:"no-cors" (same as
    // every other write action in this file), so the response is never
    // actually read by the browser — this single action therefore does
    // BOTH the find-or-create AND the link server-side in one round
    // trip, since a separate create-then-link round trip would need a
    // readable POST response we don't have.
    // source_type: "content" for {{}} auto-detected terms, "manual"
    // for right-click marks. Idempotent: safe to call repeatedly for
    // the same (term, node) pair (e.g. every time a topic re-renders).
    if (data.action === "sync_index_term") {
      if (!checkIndexWriteRateLimit_()) {
        return jsonResponse_({ success: false, error: "Rate limit exceeded. Please slow down." });
      }
      const result = syncIndexTerm_(data.term, data.node_id, data.source_type);
      return jsonResponse_(result);
    }

    // REMOVED (2026-09-06): "add_index_term_standalone" — this served
    // index-directory.html's old "Add a term" (standalone, no topic
    // link) button. That UI was removed from the frontend earlier;
    // this backend path became dead/unreachable code and has been
    // deleted along with it. findOrCreateIndexTerm_ itself is still
    // used elsewhere (migrateIndexTerms, syncIndexTerm_,
    // fixDuplicateIndexTermIds) — only this one unreachable API
    // action was removed.

    // ALPHA-PLUS — INDEX TERMS: full delete (index-directory.html's
    // "×" per row) — removes the Index_Terms row AND every Index_Node
    // link to it. Different from unlink_index_term, which only removes
    // ONE (term, node) link and leaves the term + its other links alone.
    if (data.action === "delete_index_term") {
      if (!checkIndexWriteRateLimit_()) {
        return jsonResponse_({ success: false, error: "Rate limit exceeded. Please slow down." });
      }
      const result = deleteIndexTermCascade_(data.index_id);
      return jsonResponse_(result);
    }

    // ALPHA-PLUS — INDEX TERMS: removes ONE (term, node) link only —
    // e.g. "Unmark as index term" on one subtopic. The term itself
    // (and any of its OTHER node links) is left untouched, since the
    // same term may legitimately be marked on several subtopics.
    if (data.action === "unlink_index_term") {
      if (!checkIndexWriteRateLimit_()) {
        return jsonResponse_({ success: false, error: "Rate limit exceeded. Please slow down." });
      }
      const result = unlinkIndexTermByTerm_(data.term, data.node_id);
      return jsonResponse_(result);
    }

    // FIX (2026-09-07): called by removeTopicContent() in app.js right
    // after it wipes a topic's content — cleans up every index link
    // that pointed at this node, since the content those terms were
    // found in no longer exists.
    if (data.action === "unlink_all_terms_for_node") {
      if (!checkIndexWriteRateLimit_()) {
        return jsonResponse_({ success: false, error: "Rate limit exceeded. Please slow down." });
      }
      const nodeLock = LockService.getScriptLock();
      nodeLock.waitLock(10000);
      let result;
      try {
        result = unlinkAllTermsForNode_(data.node_id);
      } finally {
        nodeLock.releaseLock();
      }
      return jsonResponse_(result);
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

    // ALPHA-PLUS — MCQ delete/edit trio.
    // update_mcq_meta above deliberately never touches question/option/
    // answer text ("Source/content fields are intentionally not editable
    // here"); these three actions cover the rest: a real (non-archive)
    // single-row delete, a bulk collection wipe, and a separate
    // content-editable patch — kept as its own action so update_mcq_meta's
    // narrow allow-list stays exactly as conservative as it already was.

    // Permanently removes ONE row from MCQs. Different from setting
    // status: "archived" via update_mcq_meta (which only hides a
    // question from practice while keeping the row) — this actually
    // deletes it, no undo.
    if (data.action === "delete_mcq") {
      const result = deleteMcqRow(data);
      return jsonResponse_(result);
    }

    // Wipes an entire collection in one call: every MCQ row whose
    // collection_id matches, the Collections row itself, and any
    // MCQ_Passages row that was ONLY referenced by that collection's
    // questions (a passage still used by some other collection's
    // questions is left alone).
    if (data.action === "delete_mcq_collection") {
      const result = deleteMcqCollection(data);
      return jsonResponse_(result);
    }

    // Field-level patch for question/options/answer/explanation —
    // the content fields update_mcq_meta explicitly excludes. Same
    // fixed-allow-list shape as updateMcqMeta() so nothing outside
    // MCQ_CONTENT_EDITABLE_COLUMNS can ever be written this way.
    if (data.action === "update_mcq_content") {
      const result = updateMcqContent(data);
      return jsonResponse_(result);
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

/* =========================================================
   ALPHA-PLUS — AUTO DRIVE STORAGE

   Every structure node gets its own managed Drive folder, nested under
   its parent's folder. The folder ID is stored in Nodes.drive_folder_id.

   IMPORTANT STORAGE NOTE:
   DriveApp runs under the Google account that authorizes this Apps Script.
   Adding another Gmail address to a configuration table does NOT by itself
   make DriveApp write against that account's quota. Multi-account quota
   rotation therefore needs separately authorized execution endpoints.
   This phase keeps the storage root configurable and the node/folder
   mapping stable so that such a migration can be added later safely.
   ========================================================= */

const STUDY_ROOT_FOLDER_NAME_ = "Study Notebook Content";
const STORAGE_CONFIG_SHEET_ = "Storage_Config";

function ensureNodesDriveFolderColumn_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Nodes");
  if (!sheet) throw new Error("Nodes sheet not found.");

  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  let col = headers.indexOf("drive_folder_id");

  if (col === -1) {
    col = headers.length;
    sheet.getRange(1, col + 1).setValue("drive_folder_id");
    col += 1;
  } else {
    col += 1;
  }

  return col;
}

function ensureStorageConfigSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(STORAGE_CONFIG_SHEET_);

  if (!sheet) {
    sheet = ss.insertSheet(STORAGE_CONFIG_SHEET_);
    sheet.appendRow([
      "slot", "label", "root_folder_id", "threshold_gb", "status",
      "notes", "created_at", "updated_at"
    ]);
  }

  return sheet;
}

function ensureRootFolder_() {
  const props = PropertiesService.getScriptProperties();
  let rootId = props.getProperty("STUDY_ROOT_FOLDER_ID");

  if (rootId) {
    try {
      return DriveApp.getFolderById(rootId);
    } catch (e) {
      // Stored ID is stale/inaccessible. Recreate below.
    }
  }

  const root = DriveApp.createFolder(STUDY_ROOT_FOLDER_NAME_);
  root.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  props.setProperty("STUDY_ROOT_FOLDER_ID", root.getId());

  const storageSheet = ensureStorageConfigSheet_();
  const values = storageSheet.getDataRange().getValues();
  const headers = values[0].map(String);
  const slotIndex = headers.indexOf("slot");
  const rootIndex = headers.indexOf("root_folder_id");
  let found = false;

  for (let i = 1; i < values.length; i++) {
    if (String(values[i][slotIndex]) === "1") {
      storageSheet.getRange(i + 1, rootIndex + 1).setValue(root.getId());
      storageSheet.getRange(i + 1, headers.indexOf("status") + 1).setValue("ACTIVE");
      storageSheet.getRange(i + 1, headers.indexOf("updated_at") + 1).setValue(new Date());
      found = true;
      break;
    }
  }

  if (!found) {
    const now = new Date();
    storageSheet.appendRow([
      1, "Primary Drive", root.getId(), 12, "ACTIVE",
      "Created automatically by Apps Script. Multi-account rotation requires separately authorized execution endpoints.",
      now, now
    ]);
  }

  return root;
}

function findOrCreateSubfolder_(parentFolder, title) {
  const safeTitle = String(title || "Untitled").trim() || "Untitled";
  const existing = parentFolder.getFoldersByName(safeTitle);
  if (existing.hasNext()) return existing.next();

  const folder = parentFolder.createFolder(safeTitle);
  folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return folder;
}

function getNodeRecordMap_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Nodes");
  if (!sheet) throw new Error("Nodes sheet not found.");

  const values = sheet.getDataRange().getValues();
  if (!values.length) return { sheet: sheet, headers: [], rows: [], byId: {} };

  const headers = values[0].map(String);
  const idCol = headers.indexOf("node_id");
  const parentCol = headers.indexOf("parent_id");
  const titleCol = headers.indexOf("title");
  const folderCol = headers.indexOf("drive_folder_id");

  if (idCol === -1 || parentCol === -1 || titleCol === -1) {
    throw new Error("Required Nodes columns not found.");
  }

  const byId = {};
  for (let i = 1; i < values.length; i++) {
    const id = String(values[i][idCol] || "");
    if (!id) continue;
    byId[id] = {
      rowNumber: i + 1,
      nodeId: id,
      parentId: String(values[i][parentCol] || ""),
      title: String(values[i][titleCol] || "Untitled").trim() || "Untitled",
      folderId: folderCol === -1 ? "" : String(values[i][folderCol] || "")
    };
  }

  return { sheet: sheet, headers: headers, rows: values, byId: byId };
}

function ensureNodeFolder_(nodeId, stack) {
  const registry = getNodeRecordMap_();
  const node = registry.byId[String(nodeId)];
  if (!node) throw new Error("Node not found: " + nodeId);

  const folderCol = ensureNodesDriveFolderColumn_();
  stack = stack || {};

  if (stack[node.nodeId]) {
    throw new Error("Circular parent_id chain detected at node: " + node.nodeId);
  }
  stack[node.nodeId] = true;

  if (node.folderId) {
    try {
      const existingFolder = DriveApp.getFolderById(node.folderId);
      if (existingFolder.getName() !== node.title) {
        existingFolder.setName(node.title);
      }
      delete stack[node.nodeId];
      return existingFolder.getId();
    } catch (e) {
      // Stale/deleted folder ID — rebuild the folder below.
    }
  }

  let parentFolder;
  if (node.parentId) {
    if (!registry.byId[node.parentId]) {
      throw new Error("Parent node not found: " + node.parentId);
    }
    parentFolder = DriveApp.getFolderById(
      ensureNodeFolder_(node.parentId, stack)
    );
  } else {
    parentFolder = ensureRootFolder_();
  }

  const folder = findOrCreateSubfolder_(parentFolder, node.title);
  registry.sheet.getRange(node.rowNumber, folderCol).setValue(folder.getId());

  delete stack[node.nodeId];
  return folder.getId();
}

// ALPHA-PLUS — REFERENCES/MCQ SUBFOLDERS.
// Every node already gets one managed Drive folder (drive_folder_id,
// above). This adds two FIXED subfolders inside that same folder —
// "References" and "MCQ" — so reference PDFs and MCQ .md source files
// have their own dedicated, trackable place, separate from the node's
// own Content (which still lives at the node folder's root, unchanged).
//
// Deliberately NOT wired into ensureNodeFolder_() itself: that function
// recurses up the parent chain to build ancestor folders as plain
// containers, and calling this from inside it would create References/
// MCQ subfolders on every ancestor (Subject, Course, Unit, Chapter) any
// time a descendant's folder is touched — not what's wanted. Instead
// this only runs for the exact node the caller asked about, via
// ensureNodeFolderWithExtras_() below, exactly the same on-demand shape
// as the main folder itself.
function ensureNodesExtraFolderColumns_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Nodes");
  if (!sheet) throw new Error("Nodes sheet not found.");

  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String);

  function ensureCol(name) {
    let col = headers.indexOf(name);
    if (col === -1) {
      col = headers.length;
      sheet.getRange(1, col + 1).setValue(name);
      headers.push(name);
    }
    return col + 1; // 1-based column index
  }

  return {
    sheet: sheet,
    referencesCol: ensureCol("references_folder_id"),
    mcqCol: ensureCol("mcq_folder_id")
  };
}

function ensureNodeExtraFolders_(node, mainFolderId) {
  const cols = ensureNodesExtraFolderColumns_();
  const rowVals = cols.sheet.getRange(node.rowNumber, 1, 1, cols.sheet.getLastColumn()).getValues()[0];

  const savedRefId = String(rowVals[cols.referencesCol - 1] || "");
  const savedMcqId = String(rowVals[cols.mcqCol - 1] || "");

  const mainFolder = DriveApp.getFolderById(mainFolderId);

  let refFolder = null;
  if (savedRefId) {
    try { refFolder = DriveApp.getFolderById(savedRefId); } catch (e) { refFolder = null; }
  }
  if (!refFolder) {
    refFolder = findOrCreateSubfolder_(mainFolder, "References");
    cols.sheet.getRange(node.rowNumber, cols.referencesCol).setValue(refFolder.getId());
  }

  let mcqFolder = null;
  if (savedMcqId) {
    try { mcqFolder = DriveApp.getFolderById(savedMcqId); } catch (e) { mcqFolder = null; }
  }
  if (!mcqFolder) {
    mcqFolder = findOrCreateSubfolder_(mainFolder, "MCQ");
    cols.sheet.getRange(node.rowNumber, cols.mcqCol).setValue(mcqFolder.getId());
  }

  return { referencesFolderId: refFolder.getId(), mcqFolderId: mcqFolder.getId() };
}

function ensureNodeFolderWithExtras_(nodeId) {
  const mainFolderId = ensureNodeFolder_(nodeId);
  const registry = getNodeRecordMap_();
  const node = registry.byId[String(nodeId)];
  if (!node) throw new Error("Node not found: " + nodeId);
  const extras = ensureNodeExtraFolders_(node, mainFolderId);
  return {
    folderId: mainFolderId,
    referencesFolderId: extras.referencesFolderId,
    mcqFolderId: extras.mcqFolderId
  };
}

function getNodeFolderInfo_(nodeId) {
  const result = ensureNodeFolderWithExtras_(nodeId);
  return {
    success: true,
    node_id: String(nodeId),
    drive_folder_id: result.folderId,
    drive_folder_url: "https://drive.google.com/drive/folders/" + result.folderId,
    references_folder_id: result.referencesFolderId,
    references_folder_url: "https://drive.google.com/drive/folders/" + result.referencesFolderId,
    mcq_folder_id: result.mcqFolderId,
    mcq_folder_url: "https://drive.google.com/drive/folders/" + result.mcqFolderId
  };
}

function trashDriveFolder_(folderId) {
  if (!folderId) return false;
  try {
    const folder = DriveApp.getFolderById(String(folderId));
    folder.setTrashed(true);
    return true;
  } catch (e) {
    // Already deleted/inaccessible: deletion of the Sheet row can continue.
    return false;
  }
}

function getStorageStatus_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(STORAGE_CONFIG_SHEET_);
  if (!sheet) {
    return { success: true, configured: false, slots: [] };
  }

  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return { success: true, configured: true, slots: [] };
  const headers = values[0].map(String);

  return {
    success: true,
    configured: true,
    slots: values.slice(1).filter(function(row) {
      return String(row[headers.indexOf("slot")] || "").trim() !== "";
    }).map(function(row) {
      const out = {};
      headers.forEach(function(h, i) { out[h] = row[i]; });
      return out;
    })
  };
}


/* =========================================================
   ALPHA-PLUS — AUTO DRIVE FOLDERS: OPTIMIZED RESUMABLE MIGRATION
   ========================================================= */

const DRIVE_MIGRATION_BATCH_SIZE_ = 50;
const DRIVE_MIGRATION_CURSOR_KEY_ = "AUTO_DRIVE_MIGRATION_CURSOR";
const DRIVE_MIGRATION_DONE_KEY_ = "AUTO_DRIVE_MIGRATION_DONE";
const DRIVE_MIGRATION_STATUS_KEY_ = "AUTO_DRIVE_MIGRATION_STATUS";
const DRIVE_MIGRATION_TRIGGER_KEY_ = "AUTO_DRIVE_MIGRATION_TRIGGER_ID";

function buildMigrationRegistry_(sheet) {
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(String);
  const idCol=headers.indexOf("node_id"), parentCol=headers.indexOf("parent_id");
  const titleCol=headers.indexOf("title"), folderCol=headers.indexOf("drive_folder_id");
  if(idCol<0||parentCol<0||titleCol<0) throw new Error("Required Nodes columns not found.");
  const byId={}, ids=[];
  for(let i=1;i<values.length;i++){
    const id=String(values[i][idCol]||""); if(!id) continue;
    byId[id]={rowNumber:i+1,nodeId:id,parentId:String(values[i][parentCol]||""),
      title:String(values[i][titleCol]||"Untitled").trim()||"Untitled",
      folderId:folderCol<0?"":String(values[i][folderCol]||"")};
    ids.push(id);
  }
  return {sheet,headers,byId,ids,folderCol};
}

function ensureNodeFolderFromRegistry_(nodeId, registry, stack, cache) {
  const id=String(nodeId), node=registry.byId[id];
  if(!node) throw new Error("Node not found: "+id);
  stack=stack||{}; cache=cache||{};
  if(cache[id]) return cache[id];
  if(stack[id]) throw new Error("Circular parent_id chain detected at node: "+id);
  stack[id]=true;

  if(node.folderId){
    try{
      const f=DriveApp.getFolderById(node.folderId);
      if(f.getName()!==node.title) f.setName(node.title);
      cache[id]=f.getId(); delete stack[id]; return cache[id];
    }catch(e){}
  }

  let parentFolder;
  if(node.parentId){
    if(!registry.byId[node.parentId]) throw new Error("Parent node not found: "+node.parentId);
    parentFolder=DriveApp.getFolderById(
      ensureNodeFolderFromRegistry_(node.parentId,registry,stack,cache)
    );
  }else parentFolder=ensureRootFolder_();

  const folder=findOrCreateSubfolder_(parentFolder,node.title);
  if(registry.folderCol!==-1)
    registry.sheet.getRange(node.rowNumber,registry.folderCol+1).setValue(folder.getId());
  node.folderId=folder.getId(); cache[id]=folder.getId();
  delete stack[id];
  return folder.getId();
}

function writeMigrationStatus_(x){
  PropertiesService.getScriptProperties().setProperty(DRIVE_MIGRATION_STATUS_KEY_,JSON.stringify(x));
}

function getDriveFolderMigrationStatus(){
  const p=PropertiesService.getScriptProperties(), raw=p.getProperty(DRIVE_MIGRATION_STATUS_KEY_);
  if(raw) try{return JSON.parse(raw)}catch(e){}
  const sh=SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Nodes");
  if(!sh) return {success:false,error:"Nodes sheet not found."};
  const r=buildMigrationRegistry_(sh), total=r.ids.length;
  const cur=Math.min(Math.max(parseInt(p.getProperty(DRIVE_MIGRATION_CURSOR_KEY_)||"0",10)||0,0),total);
  return {success:true,total_nodes:total,processed:cur,remaining:total-cur,
    progress_percent:total?Math.round(cur/total*10000)/100:100,
    status:p.getProperty(DRIVE_MIGRATION_DONE_KEY_)==="true"?"COMPLETE":"NOT_STARTED"};
}

function migrateExistingNodeFoldersBatch(){
  const lock=LockService.getScriptLock();
  if(!lock.tryLock(5000)) return {success:true,skipped:true,message:"Another migration execution is running."};
  try{
    const sh=SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Nodes");
    if(!sh) throw new Error("Nodes sheet not found.");
    ensureNodesDriveFolderColumn_();
    const r=buildMigrationRegistry_(sh), ids=r.ids, total=ids.length, p=PropertiesService.getScriptProperties();
    let cur=parseInt(p.getProperty(DRIVE_MIGRATION_CURSOR_KEY_)||"0",10);
    if(!Number.isFinite(cur)||cur<0) cur=0;
    if(cur>=total||p.getProperty(DRIVE_MIGRATION_DONE_KEY_)==="true"){
      p.setProperty(DRIVE_MIGRATION_CURSOR_KEY_,String(total)); p.setProperty(DRIVE_MIGRATION_DONE_KEY_,"true");
      const done={success:true,total_nodes:total,processed:total,remaining:0,progress_percent:100,status:"COMPLETE",message:"Migration complete."};
      writeMigrationStatus_(done); return done;
    }
    const end=Math.min(cur+DRIVE_MIGRATION_BATCH_SIZE_,total), cache={}, errors=[];
    let existing=0,created=0;
    for(let i=cur;i<end;i++){
      try{
        const n=r.byId[ids[i]], before=n.folderId;
        const fid=ensureNodeFolderFromRegistry_(ids[i],r,{},cache);
        if(before&&String(before)===String(fid)) existing++; else created++;
      }catch(err){errors.push({node_id:ids[i],title:r.byId[ids[i]]?.title||"",error:err.message});}
      p.setProperty(DRIVE_MIGRATION_CURSOR_KEY_,String(i+1));
    }
    const processed=end,remaining=total-processed,complete=remaining===0;
    if(complete)p.setProperty(DRIVE_MIGRATION_DONE_KEY_,"true"); else p.deleteProperty(DRIVE_MIGRATION_DONE_KEY_);
    const out={success:errors.length===0,total_nodes:total,processed,remaining,
      progress_percent:Math.round(processed/total*10000)/100,batch_start:cur+1,batch_end:end,
      existing_folders:existing,created_or_repaired:created,errors,status:complete?"COMPLETE":"RUNNING",
      message:complete?"Migration complete.":"Batch complete."};
    writeMigrationStatus_(out); return out;
  }finally{lock.releaseLock();}
}

function startDriveFolderMigrationAuto(){
  const p=PropertiesService.getScriptProperties();
  if(p.getProperty(DRIVE_MIGRATION_DONE_KEY_)==="true") return getDriveFolderMigrationStatus();
  const result=migrateExistingNodeFoldersBatch();
  if(result.status==="COMPLETE"){removeDriveMigrationTrigger_();return result;}
  ensureSingleDriveMigrationTrigger_();
  return result;
}

function continueDriveFolderMigration_(){
  const result=migrateExistingNodeFoldersBatch();
  if(result.status==="COMPLETE") removeDriveMigrationTrigger_();
  else ensureSingleDriveMigrationTrigger_();
}

function ensureSingleDriveMigrationTrigger_(){
  const p=PropertiesService.getScriptProperties();
  const ts=ScriptApp.getProjectTriggers().filter(t=>t.getHandlerFunction()==="continueDriveFolderMigration_");
  for(let i=1;i<ts.length;i++) ScriptApp.deleteTrigger(ts[i]);
  if(ts.length){p.setProperty(DRIVE_MIGRATION_TRIGGER_KEY_,ts[0].getUniqueId());return;}
  const t=ScriptApp.newTrigger("continueDriveFolderMigration_").timeBased().after(60000).create();
  p.setProperty(DRIVE_MIGRATION_TRIGGER_KEY_,t.getUniqueId());
}

function removeDriveMigrationTrigger_(){
  ScriptApp.getProjectTriggers().forEach(t=>{if(t.getHandlerFunction()==="continueDriveFolderMigration_")ScriptApp.deleteTrigger(t);});
  PropertiesService.getScriptProperties().deleteProperty(DRIVE_MIGRATION_TRIGGER_KEY_);
}

function resetDriveFolderMigration(){
  removeDriveMigrationTrigger_();
  const p=PropertiesService.getScriptProperties();
  p.deleteProperty(DRIVE_MIGRATION_CURSOR_KEY_);p.deleteProperty(DRIVE_MIGRATION_DONE_KEY_);
  const x={success:true,status:"NOT_STARTED",total_nodes:0,processed:0,remaining:0,progress_percent:0,message:"Migration progress reset."};
  writeMigrationStatus_(x);return x;
}

/* =========================================================
   DRIVE HEALTH CHECK (2026-09-10)
   Catches deletions that happen DIRECTLY in Google Drive (deleting a
   topic's folder from the Drive UI/app) instead of through the
   website. Those bypass every doPost action entirely, so nothing else
   in this file can ever see them happen in real time — this is the
   one mechanism that eventually notices, by periodically re-checking
   whether each Nodes row's drive_folder_id still resolves.

   Since MCQs, Resources, and the topic's actual content now all live
   inside that same per-topic Drive folder (per the folder-per-topic
   change), one missing-folder check is enough to know that ALL of a
   topic's content, references, and questions are gone — not just one
   of them. This reuses the exact same flagOrphanedRows_ /
   removeIndexLinksAndFlagOrphans_ helpers the app-driven deletion
   paths use, so a Drive-side deletion ends up flagged identically to
   an app-side one. NEVER deletes any Sheet row, and NEVER touches
   Drive itself (it only reads folder existence — never trashes
   anything, unlike the app's own delete_structure action).

   Self-healing both ways: if a previously-flagged node's folder is
   found again on a later run (e.g. someone restored it from Drive
   Trash), the Nodes row's own orphaned_at is cleared. Index_Terms are
   already self-healed elsewhere the moment a term is marked again
   (see findOrCreateIndexTerm_) — restoring a Drive folder alone
   doesn't re-establish old Index_Node links or un-flag Content_Core/
   Resources/MCQs rows, since the old links are already gone and
   re-linking is a deliberate manual action, same as for any other
   orphaned term.
   ========================================================= */
function driveHealthCheck() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const nodesSheet = ss.getSheetByName("Nodes");
  if (!nodesSheet) return { success: false, message: "Nodes sheet not found." };

  const values = nodesSheet.getDataRange().getValues();
  const headers = values[0].map(String);
  const idIdx = headers.indexOf("node_id");
  const folderIdx = headers.indexOf("drive_folder_id");
  if (idIdx === -1 || folderIdx === -1) {
    return { success: false, message: "Required Nodes columns not found." };
  }

  const orphanedAtCol = getOrAddColumn_(nodesSheet, "orphaned_at"); // 0-based

  const brokenNodeIds = [];
  let checked = 0;
  let restored = 0;

  for (let i = 1; i < values.length; i++) {
    const folderId = values[i][folderIdx];
    if (!folderId) continue; // nothing to check for this node
    checked++;

    let folderExists = false;
    try {
      const folder = DriveApp.getFolderById(String(folderId));
      folderExists = !folder.isTrashed();
    } catch (e) {
      folderExists = false; // inaccessible/deleted
    }

    const currentFlag = values[i][orphanedAtCol];
    if (folderExists) {
      if (currentFlag) {
        nodesSheet.getRange(i + 1, orphanedAtCol + 1).setValue(""); // +1: 1-indexed
        restored++;
      }
      continue;
    }

    if (!currentFlag) {
      nodesSheet.getRange(i + 1, orphanedAtCol + 1).setValue(new Date()); // +1: 1-indexed
    }
    brokenNodeIds.push(String(values[i][idIdx]));
  }

  let contentFlagged = 0, resourcesFlagged = 0, mcqsFlagged = 0, indexResult = { links_removed: 0, terms_flagged_orphaned: 0 };

  if (brokenNodeIds.length) {
    const brokenSet = new Set(brokenNodeIds);

    const contentCoreSheet = ss.getSheetByName("Content_Core");
    if (contentCoreSheet) contentFlagged = flagOrphanedRows_(contentCoreSheet, "node_id", brokenSet);

    const resourcesSheet = ss.getSheetByName("Resources");
    if (resourcesSheet) resourcesFlagged = flagOrphanedRows_(resourcesSheet, "topic_id", brokenSet);

    const mcqsSheet = ss.getSheetByName("MCQs");
    if (mcqsSheet) mcqsFlagged = flagOrphanedRows_(mcqsSheet, "topic_id", brokenSet);

    indexResult = removeIndexLinksAndFlagOrphans_(brokenSet);
  }

  const summary = {
    success: true,
    nodes_checked: checked,
    newly_broken_nodes: brokenNodeIds.length,
    restored_nodes: restored,
    broken_node_ids: brokenNodeIds,
    content_core_flagged_orphaned: contentFlagged,
    resources_flagged_orphaned: resourcesFlagged,
    mcqs_flagged_orphaned: mcqsFlagged,
    index_terms_flagged_orphaned: indexResult.terms_flagged_orphaned,
    index_links_removed: indexResult.links_removed
  };

  Logger.log("Drive health check: %s", JSON.stringify(summary));
  return summary;
}

// Installs a once-daily trigger for driveHealthCheck (runs at
// approximately 3 AM in the script's timezone). Run this ONCE manually
// from the Apps Script editor after deploying — it does not need to be
// re-run on every deployment, since triggers are independent of
// deployment versions. Safe to call more than once: clears any
// existing driveHealthCheck triggers first, so it never creates
// duplicates that would run the check multiple times a day.
function installDriveHealthCheckTrigger() {
  removeDriveHealthCheckTrigger();
  ScriptApp.newTrigger("driveHealthCheck").timeBased().everyDays(1).atHour(3).create();
  return { success: true, message: "Daily Drive health check trigger installed (~3 AM)." };
}

// Removes the daily driveHealthCheck trigger, if one exists. Run this
// manually from the Apps Script editor if you ever want to pause the
// automatic scan (e.g. while doing bulk manual cleanup and don't want
// the scan interleaving with it).
function removeDriveHealthCheckTrigger() {
  let removed = 0;
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === "driveHealthCheck") {
      ScriptApp.deleteTrigger(t);
      removed++;
    }
  });
  return { success: true, removed };
}

function setupDriveStorage() {
  ensureNodesDriveFolderColumn_();
  const root = ensureRootFolder_();
  const sheet = ensureStorageConfigSheet_();
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(String);
  const slotIndex = headers.indexOf("slot");
  const rootIndex = headers.indexOf("root_folder_id");
  let hasSlot1 = false;

  for (let i = 1; i < values.length; i++) {
    if (String(values[i][slotIndex]) === "1") {
      sheet.getRange(i + 1, rootIndex + 1).setValue(root.getId());
      hasSlot1 = true;
      break;
    }
  }

  if (!hasSlot1) {
    const now = new Date();
    sheet.appendRow([1, "Primary Drive", root.getId(), 12, "ACTIVE", "", now, now]);
  }

  return {
    success: true,
    root_folder_id: root.getId(),
    root_folder_url: "https://drive.google.com/drive/folders/" + root.getId()
  };
}

function saveStructureNode(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Nodes");

  if (!sheet) throw new Error("Nodes sheet not found.");

  const now = new Date();
  const nodeId = data.node_id;
  const nodeType = data.node_type;
  const title = data.title;

  if (!nodeId) throw new Error("node_id is required.");
  if (!nodeType) throw new Error("node_type is required.");
  if (!title) throw new Error("title is required.");

  const folderCol = ensureNodesDriveFolderColumn_();
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(String);
  const idIndex = headers.indexOf("node_id");

  if (idIndex === -1) throw new Error("node_id column not found in Nodes sheet.");

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

  // Keep the existing folder ID in the row when updating. ensureNodeFolder_()
  // will validate it and rename the actual Drive folder if the title changed.
  if (existingRow !== -1) {
    const oldRow = values[existingRow - 1];
    const existingFolderIndex = headers.indexOf("drive_folder_id");
    if (existingFolderIndex !== -1) {
      rowData.drive_folder_id = oldRow[existingFolderIndex] || "";
    }
    const createdAtIndex = headers.indexOf("created_at");
    if (createdAtIndex !== -1) rowData.created_at = oldRow[createdAtIndex];

    const row = headers.map(function(header) {
      return rowData[header] !== undefined ? rowData[header] : oldRow[headers.indexOf(header)];
    });

    sheet.getRange(existingRow, 1, 1, headers.length).setValues([row]);
  } else {
    const row = headers.map(function(header) {
      return rowData[header] !== undefined ? rowData[header] : "";
    });
    sheet.appendRow(row);
  }

  // Create/repair/rename the Drive folder after the node is safely present.
  const folderId = ensureNodeFolder_(nodeId);

  // ensureNodeFolder_ may have written a repaired folder ID after the row write.
  return {
    success: true,
    action: existingRow !== -1 ? "updated" : "created",
    node_id: nodeId,
    drive_folder_id: folderId,
    drive_folder_url: "https://drive.google.com/drive/folders/" + folderId
  };
}

function deleteStructureNodeRow(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Nodes");

  if (!sheet) throw new Error("Nodes sheet not found.");

  const nodeId = data.node_id;
  if (!nodeId) throw new Error("node_id is required.");

  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(String);
  const idIndex = headers.indexOf("node_id");
  const parentIndex = headers.indexOf("parent_id");
  const folderIndex = headers.indexOf("drive_folder_id");

  if (idIndex === -1 || parentIndex === -1) {
    throw new Error("Required Nodes columns not found.");
  }

  // Collect this node and every descendant using the same parent_id tree
  // logic already used by the website. Capture Drive folder IDs BEFORE rows
  // disappear so deletion remains correct even for nested descendants.
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

  const idsToDeleteSet = new Set(Object.keys(idsToDelete));

  // FIX (2026-09-10): deleting a topic/structure subtree used to leave
  // its Content_Core rows, Resources, MCQs, and Index_Terms links all
  // silently orphaned — none of them were ever touched here, so they'd
  // sit forever referencing node_ids that no longer exist in Nodes.
  // This is the same class of bug as the "remove all content" one
  // fixed earlier, just triggered from the "delete whole topic" path
  // instead. Every affected row across these sheets is FLAGGED
  // (orphaned_at), never deleted — consistent with the soft-delete
  // design used everywhere else, so nothing here is unrecoverable if
  // it turns out to be a mistake.
  const contentCoreSheet = ss.getSheetByName("Content_Core");
  const contentFlagged = contentCoreSheet ? flagOrphanedRows_(contentCoreSheet, "node_id", idsToDeleteSet) : 0;

  const resourcesSheet = ss.getSheetByName("Resources");
  const resourcesFlagged = resourcesSheet ? flagOrphanedRows_(resourcesSheet, "topic_id", idsToDeleteSet) : 0;

  const mcqsSheet = ss.getSheetByName("MCQs");
  const mcqsFlagged = mcqsSheet ? flagOrphanedRows_(mcqsSheet, "topic_id", idsToDeleteSet) : 0;

  const indexResult = removeIndexLinksAndFlagOrphans_(idsToDeleteSet);

  const foldersToTrash = [];
  if (folderIndex !== -1) {
    for (let i = 1; i < values.length; i++) {
      const rowId = String(values[i][idIndex]);
      if (idsToDelete[rowId] && values[i][folderIndex]) {
        foldersToTrash.push(String(values[i][folderIndex]));
      }
    }
  }

  // Delete Drive folders first. setTrashed(true) is deliberately used instead
  // of permanent deletion, so accidental website deletions remain recoverable
  // from Google Drive Trash.
  let foldersTrashed = 0;
  foldersToTrash.forEach(function(folderId) {
    if (trashDriveFolder_(folderId)) foldersTrashed++;
  });

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
    rows_deleted: deletedCount,
    drive_folders_trashed: foldersTrashed,
    drive_folder_cleanup: folderIndex === -1 ? "column_missing" : "completed",
    content_core_flagged_orphaned: contentFlagged,
    resources_flagged_orphaned: resourcesFlagged,
    mcqs_flagged_orphaned: mcqsFlagged,
    index_terms_flagged_orphaned: indexResult.terms_flagged_orphaned,
    index_links_removed: indexResult.links_removed
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

// ALPHA-PLUS — real single-row delete (see doPost's delete_mcq route
// above for how this differs from the existing archive/status flow).
function deleteMcqRow(data) {
  if (!data || !data.mcq_id) throw new Error("mcq_id is required.");

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("MCQs");
  if (!sheet) throw new Error("MCQs sheet not found.");

  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const idCol = headers.indexOf("mcq_id");
  if (idCol === -1) throw new Error("mcq_id column not found.");

  for (let i = 1; i < values.length; i++) {
    if (String(values[i][idCol]) === String(data.mcq_id)) {
      sheet.deleteRow(i + 1);
      return { success: true, action: "deleted", mcq_id: data.mcq_id };
    }
  }

  throw new Error("mcq_id not found: " + data.mcq_id);
}

// ALPHA-PLUS — bulk collection delete. Removes every MCQ row whose
// collection_id matches, the Collections row itself, and any
// MCQ_Passages row left with zero remaining references after the MCQ
// rows are gone (a passage still used by another collection's
// questions is kept). Row deletions run bottom-to-top per sheet so
// row numbers stay valid mid-loop.
function deleteMcqCollection(data) {
  if (!data || !data.collection_id) throw new Error("collection_id is required.");

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const collectionId = String(data.collection_id);

  const mcqSheet = ss.getSheetByName("MCQs");
  if (!mcqSheet) throw new Error("MCQs sheet not found.");

  const mcqValues = mcqSheet.getDataRange().getValues();
  const mcqHeaders = mcqValues[0];
  const collCol = mcqHeaders.indexOf("collection_id");
  const passageCol = mcqHeaders.indexOf("passage_id");
  if (collCol === -1) throw new Error("collection_id column not found in MCQs.");

  const rowsToDelete = [];
  const passageIdsInCollection = new Set();
  const passageIdsOutsideCollection = new Set();

  for (let i = 1; i < mcqValues.length; i++) {
    const rowCollId = String(mcqValues[i][collCol] || "");
    const rowPassageId = passageCol !== -1 ? String(mcqValues[i][passageCol] || "") : "";
    if (rowCollId === collectionId) {
      rowsToDelete.push(i + 1);
      if (rowPassageId) passageIdsInCollection.add(rowPassageId);
    } else if (rowPassageId) {
      passageIdsOutsideCollection.add(rowPassageId);
    }
  }

  rowsToDelete.sort(function(a, b) { return b - a; })
    .forEach(function(r) { mcqSheet.deleteRow(r); });

  let deletedPassages = 0;
  const passagesSheet = ss.getSheetByName("MCQ_Passages");
  if (passagesSheet) {
    const pValues = passagesSheet.getDataRange().getValues();
    const pHeaders = pValues[0];
    const pIdCol = pHeaders.indexOf("passage_id");
    if (pIdCol !== -1) {
      const passageRowsToDelete = [];
      for (let i = 1; i < pValues.length; i++) {
        const pid = String(pValues[i][pIdCol]);
        if (passageIdsInCollection.has(pid) && !passageIdsOutsideCollection.has(pid)) {
          passageRowsToDelete.push(i + 1);
        }
      }
      passageRowsToDelete.sort(function(a, b) { return b - a; })
        .forEach(function(r) { passagesSheet.deleteRow(r); deletedPassages++; });
    }
  }

  let collectionRowDeleted = false;
  const collectionsSheet = ss.getSheetByName("Collections");
  if (collectionsSheet) {
    const cValues = collectionsSheet.getDataRange().getValues();
    const cHeaders = cValues[0];
    const cIdCol = cHeaders.indexOf("collection_id");
    if (cIdCol !== -1) {
      for (let i = 1; i < cValues.length; i++) {
        if (String(cValues[i][cIdCol]) === collectionId) {
          collectionsSheet.deleteRow(i + 1);
          collectionRowDeleted = true;
          break;
        }
      }
    }
  }

  return {
    success: true,
    action: "deleted_collection",
    collection_id: collectionId,
    mcqs_deleted: rowsToDelete.length,
    passages_deleted: deletedPassages,
    collection_row_deleted: collectionRowDeleted
  };
}

// ALPHA-PLUS — content patch (question/options/answer/explanation).
// Mirrors updateMcqMeta()'s fixed-allow-list shape exactly, just with
// the content columns that function deliberately excludes.
const MCQ_CONTENT_EDITABLE_COLUMNS = [
  "question", "option_a", "option_b", "option_c", "option_d",
  "correct_option", "explanation"
];

function updateMcqContent(data) {
  if (!data || !data.mcq_id) throw new Error("mcq_id is required.");

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("MCQs");
  if (!sheet) throw new Error("MCQs sheet not found.");

  const values = sheet.getDataRange().getValues();
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

  MCQ_CONTENT_EDITABLE_COLUMNS.forEach(function(col) {
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

    // ALPHA-PLUS — CONTENT LINK: folder mode. A Drive FOLDER link (one
    // .md file + images/lottie animations sitting together) is handled
    // completely separately from the single-.md-file mode below — see
    // handleGetContentFolder_. Detected first so a folder link never
    // falls through to the single-file path.
    const folderId = extractDriveFolderId_(cleanRef);
    if (folderId) {
      return handleGetContentFolder_(folderId);
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
    return jsonResponse_({ ok: true, content: text, assets: {} });

  } catch (error) {
    // Never let an unexpected error surface as a raw failure — always
    // return the same JSON shape the frontend expects.
    return jsonResponse_({
      ok: false,
      error: "Unexpected error reading this file: " + error.message
    });
  }
}

// ALPHA-PLUS — CONTENT LINK: folder mode.
// Reads every file inside a shared Drive folder: the single .md file
// becomes the topic's text, and every OTHER file (images, ```lottie
// animation .json files, etc.) becomes a directly-fetchable asset keyed
// by its plain filename — so the .md can reference "neuron.png" or
// "mitosis.json" by name alone, with no separate per-file share link.
// See README.txt section 7 for the authoring workflow this backs.
function handleGetContentFolder_(folderId) {
  let folder;
  try {
    folder = DriveApp.getFolderById(folderId);
  } catch (notFoundOrNoAccess) {
    return jsonResponse_({
      ok: false,
      error: "Could not open this folder. Check that it's shared as " +
             "\"Anyone with the link can view\" and that the link is correct."
    });
  }

  const iterator = folder.getFiles();
  const allFiles = [];
  while (iterator.hasNext()) allFiles.push(iterator.next());

  // Prefer a file literally named content.md / index.md if one exists;
  // otherwise just take the first .md file Drive returns.
  const mdFiles = allFiles.filter(f => /\.md$/i.test(f.getName()));
  const mdFile = mdFiles.find(f => /^(content|index)\.md$/i.test(f.getName())) || mdFiles[0] || null;

  if (!mdFile) {
    return jsonResponse_({
      ok: false,
      error: "No .md file found in this folder. Add one .md file (e.g. " +
             "content.md) alongside your images/animations, then make sure " +
             "the whole folder is shared as \"Anyone with the link can view\"."
    });
  }

  const assets = {};
  const assetData = {};
  allFiles.forEach(function(f) {
    if (f.getId() === mdFile.getId()) return;
    // Use a browser-friendly URL per asset type. Drive's `view` endpoint can
    // return an HTML viewer for JSON, which breaks Lottie fetch(). Images are
    // better served through the thumbnail endpoint; JSON is downloaded as
    // JSON by the browser. Both still respect the file's Drive sharing.
    var mime = String(f.getMimeType() || "");
    if (mime.indexOf("image/") === 0) {
      assets[f.getName()] = "https://drive.google.com/thumbnail?id=" + f.getId() + "&sz=w1600";
    } else if (mime === "application/json" || /\.json$/i.test(f.getName())) {
      // Lottie/Bodymovin JSON is parsed server-side and sent inline.
      // This completely avoids Drive/Apps-Script CORS, redirect and
      // content-type issues in the browser. The URL remains in `assets`
      // for backwards compatibility, while `assetData` is the preferred
      // rendering path.
      assets[f.getName()] = ScriptApp.getService().getUrl() +
        "?action=get_drive_asset&file_id=" + encodeURIComponent(f.getId());
      try {
        const jsonText = f.getBlob().getDataAsString("UTF-8");
        assetData[f.getName()] = JSON.parse(jsonText);
      } catch (jsonError) {
        // Keep the URL fallback if an asset is not valid JSON.
      }
    } else {
      assets[f.getName()] = "https://drive.google.com/uc?export=download&id=" + f.getId();
    }
  });

  const text = mdFile.getBlob().getDataAsString("UTF-8");
  return jsonResponse_({ ok: true, content: text, assets: assets, assetData: assetData });
}

// Returns a Drive JSON asset as parsed JSON through the same Apps Script
// web app. This is intentionally limited to JSON files and is used by the
// frontend for Lottie/Bodymovin animations.
function handleGetDriveAsset_(fileId) {
  const id = String(fileId || "").trim();
  if (!id) return jsonResponse_({ ok: false, error: "Missing file_id." });

  try {
    const file = DriveApp.getFileById(id);
    const name = file.getName();
    const mime = String(file.getMimeType() || "");
    if (mime !== "application/json" && !/\.json$/i.test(name)) {
      return jsonResponse_({ ok: false, error: "Asset is not a JSON file." });
    }

    const text = file.getBlob().getDataAsString("UTF-8");
    let data;
    try {
      data = JSON.parse(text);
    } catch (parseError) {
      return jsonResponse_({ ok: false, error: "Invalid JSON asset: " + parseError.message });
    }

    return jsonResponse_({ ok: true, name: name, data: data });
  } catch (error) {
    return jsonResponse_({ ok: false, error: "Could not read Drive asset: " + error.message });
  }
}

// Recognizes a Drive FOLDER share link (https://drive.google.com/drive/folders/ID...).
// A plain file link never matches this, so folder vs. file detection in
// handleGetMarkdown() above is unambiguous.
function extractDriveFolderId_(ref) {
  const match = ref.match(/\/folders\/([a-zA-Z0-9_-]{10,})/);
  return match ? match[1] : null;
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

// ALPHA-PLUS — MCQ LINK: folder mode (multiple .md files).
// Mirrors handleGetContentFolder_'s link-detection (folder link vs
// single-file link), but Content wants exactly ONE .md file while an
// MCQ source folder is meant to hold SEVERAL — one per paper/collection,
// accumulated over time in that node's auto-created "MCQ" subfolder.
// Every .md file found is returned; the client (js/mcq.js) parses each
// with parseMcqMarkdown() and merges the results before saving, so
// adding a new .md to the folder later just means fetching again.
// A single-file link still works exactly as before (files: one entry) —
// nothing about the existing single-file import flow changes.
function handleGetMcqSource_(ref) {
  try {
    const cleanRef = String(ref || "").trim();
    if (!cleanRef) {
      return jsonResponse_({ ok: false, error: "No Drive link was provided." });
    }

    const folderId = extractDriveFolderId_(cleanRef);
    if (folderId) {
      let folder;
      try {
        folder = DriveApp.getFolderById(folderId);
      } catch (notFoundOrNoAccess) {
        return jsonResponse_({
          ok: false,
          error: "Could not open this folder. Check that it's shared as " +
                 "\"Anyone with the link can view\" and that the link is correct."
        });
      }

      const iterator = folder.getFiles();
      const mdFiles = [];
      while (iterator.hasNext()) {
        const f = iterator.next();
        if (/\.md$/i.test(f.getName())) mdFiles.push(f);
      }

      if (!mdFiles.length) {
        return jsonResponse_({
          ok: false,
          error: "No .md file found in this folder. Add one or more .md files " +
                 "(each following the MCQ tag format) then make sure the folder " +
                 "is shared as \"Anyone with the link can view\"."
        });
      }

      const files = mdFiles.map(function(f) {
        return { filename: f.getName(), content: f.getBlob().getDataAsString("UTF-8") };
      });
      return jsonResponse_({ ok: true, files: files });
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
    return jsonResponse_({ ok: true, files: [{ filename: file.getName(), content: text }] });

  } catch (error) {
    return jsonResponse_({
      ok: false,
      error: "Unexpected error reading this MCQ source: " + error.message
    });
  }
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

// Reads header row of a sheet and returns the 0-based column index for
// `headerName`, appending a new header cell at the end if it doesn't
// exist yet. Generic — safe to reuse across Index_Terms, Content_Core,
// Resources, MCQs, and Nodes. IMPORTANT: some of these sheets (e.g. the
// live Index_Terms sheet) may already have manual, freeform notes typed
// by the user into columns past the ones this codebase manages — this
// function must never assume a fixed column count or overwrite an
// existing header; it only reads whatever's actually in row 1 and adds
// a new column strictly after the last one currently used.
function getOrAddColumn_(sheet, headerName) {
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  let idx = headers.indexOf(headerName);
  if (idx === -1) {
    idx = headers.length;
    sheet.getRange(1, idx + 1).setValue(headerName);
  }
  return idx; // 0-based
}

// ORPHAN TRACKING (2026-09-09/10): shared soft-delete primitive used
// across Index_Terms, Content_Core, Resources, and MCQs. Never deletes
// a row — only stamps an `orphaned_at` timestamp on rows whose
// `matchColumnName` value is in `matchValueSet` (e.g. every
// Resources/MCQs row whose topic_id belongs to a just-deleted topic
// subtree). Skips rows that are already flagged, so it's always safe
// to call more than once (idempotent). Returns how many rows were
// newly flagged.
function flagOrphanedRows_(sheet, matchColumnName, matchValueSet) {
  if (!matchValueSet || matchValueSet.size === 0) return 0;

  const orphanedAtCol = getOrAddColumn_(sheet, "orphaned_at"); // 0-based
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return 0;

  const headers = values[0].map(String);
  const matchIdx = headers.indexOf(matchColumnName);
  if (matchIdx === -1) return 0;

  const now = new Date();
  let flagged = 0;

  for (let i = 1; i < values.length; i++) {
    const matchValue = String(values[i][matchIdx]);
    if (!matchValueSet.has(matchValue)) continue;
    if (values[i][orphanedAtCol]) continue; // already flagged
    sheet.getRange(i + 1, orphanedAtCol + 1).setValue(now); // +1: 1-indexed sheet coords
    flagged++;
  }

  return flagged;
}

// Finds an existing Index_Terms row for this term (by normalized_term)
// or creates a new one. Always returns { success, index_id, term,
// action: "found" | "created" }. This is the ONLY place a new index_id
// is ever minted, so calling it repeatedly for the same term is safe.
//
// SELF-HEAL (2026-09-10): a term can carry an `orphaned_at` flag (see
// removeIndexLinksAndFlagOrphans_) meaning every topic it was linked to
// is gone. If that same term gets marked again on ANY topic — which is
// exactly what happens here on the "found" path, right before
// linkIndexTerm_ links it — it's clearly active again, so the flag is
// cleared automatically. The row is never lost, and re-using an
// orphaned term needs zero manual cleanup.
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
  const orphanedIndex = headers.indexOf("orphaned_at"); // -1 if column doesn't exist yet

  for (let i = 1; i < values.length; i++) {
    if (String(values[i][normIndex]) === normalized) {
      if (orphanedIndex !== -1 && values[i][orphanedIndex]) {
        termsSheet.getRange(i + 1, orphanedIndex + 1).setValue(""); // +1: 1-indexed sheet coords
      }
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

// ALPHA-PLUS — INDEX TERMS: full delete — the Index_Terms row itself
// AND every Index_Node row linking it to any topic (cascade). Used by
// index-directory.html's per-row "×" — a deliberate, different action
// from unlinkIndexTermByTerm_() above, which only removes one (term,
// node) pair and leaves the term (and its other links) alone.
function deleteIndexTermCascade_(indexId) {
  if (!indexId) throw new Error("index_id is required.");

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const { termsSheet, linksSheet } = ensureIndexSheets_(ss);

  const linkValues = linksSheet.getDataRange().getValues();
  const linkHeaders = linkValues[0];
  const lIdIdx = linkHeaders.indexOf("index_id");

  let unlinkedCount = 0;
  for (let i = linkValues.length - 1; i >= 1; i--) {
    if (String(linkValues[i][lIdIdx]) === String(indexId)) {
      linksSheet.deleteRow(i + 1); // +1: getValues() is 0-indexed, sheet rows are 1-indexed
      unlinkedCount++;
    }
  }

  const termValues = termsSheet.getDataRange().getValues();
  const termHeaders = termValues[0];
  const tIdIdx = termHeaders.indexOf("index_id");

  let deleted = false;
  for (let i = termValues.length - 1; i >= 1; i--) {
    if (String(termValues[i][tIdIdx]) === String(indexId)) {
      termsSheet.deleteRow(i + 1);
      deleted = true;
      break;
    }
  }

  return { success: true, deleted, unlinked_count: unlinkedCount };
}

// FIX (2026-09-07): when a topic's content is completely removed
// (removeTopicContent() in app.js), every index-term link pointing at
// that node stops making sense — the text those terms were found or
// marked in no longer exists there. Nothing previously called this on
// content removal, so those links (both "content" and "manual"
// source_type) were silently orphaned forever, pointing the Index
// Directory at a now-empty topic.
//
// GENERALIZED (2026-09-10): the core logic (remove Index_Node links
// for a set of nodes, flag any Index_Terms row that ends up with zero
// links left ANYWHERE as a result) is now shared via
// removeIndexLinksAndFlagOrphans_, so the exact same behavior can be
// reused for a single node (this function), a whole deleted topic
// subtree (deleteStructureNodeRow), or a batch of Drive-confirmed-
// missing nodes (driveHealthCheck). This function is now a thin
// wrapper for the single-node case, kept because sync_index_term's
// caller (unlink_all_terms_for_node doPost action) already expects
// this exact signature.
function unlinkAllTermsForNode_(nodeId) {
  if (!nodeId) throw new Error("node_id is required.");
  return removeIndexLinksAndFlagOrphans_(new Set([String(nodeId)]));
}

// Shared core: removes every Index_Node row whose node_id is in
// `nodeIdSet`, then flags (via flagOrphanedRows_'s same orphaned_at
// mechanism, applied directly to Index_Terms here since the "still
// linked anywhere" check needs the full Index_Node picture) any
// Index_Terms row that had a link to one of these nodes and now has
// ZERO links left anywhere — not just to these specific nodes. A term
// still linked to some OTHER node outside this set is left completely
// untouched. NEVER deletes an Index_Terms row — only flags it. Safe to
// call with a single-element set or hundreds at once (e.g. a whole
// deleted topic subtree).
function removeIndexLinksAndFlagOrphans_(nodeIdSet) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const { termsSheet, linksSheet } = ensureIndexSheets_(ss);

  const values = linksSheet.getDataRange().getValues();
  const headers = values[0];
  const nodeIdx = headers.indexOf("node_id");
  const idIdx = headers.indexOf("index_id");

  // Every index_id linked to any node in this set, BEFORE removal —
  // these are the only candidates that could become orphaned.
  const affectedIndexIds = new Set();
  for (let i = 1; i < values.length; i++) {
    if (nodeIdSet.has(String(values[i][nodeIdx]))) {
      affectedIndexIds.add(String(values[i][idIdx]));
    }
  }

  const kept = [headers];
  let removed = 0;
  for (let i = 1; i < values.length; i++) {
    if (nodeIdSet.has(String(values[i][nodeIdx]))) {
      removed++;
    } else {
      kept.push(values[i]);
    }
  }

  linksSheet.getRange(1, 1, values.length, headers.length).clearContent();
  linksSheet.getRange(1, 1, kept.length, headers.length).setValues(kept);

  // Of the affected index_ids, find which ones have NO remaining link
  // rows at all — those are now fully orphaned and get flagged.
  const stillLinked = new Set();
  for (let i = 1; i < kept.length; i++) {
    stillLinked.add(String(kept[i][idIdx]));
  }

  const orphanedIndexIds = [...affectedIndexIds].filter(id => !stillLinked.has(id));
  const termsFlagged = flagOrphanedRows_(termsSheet, "index_id", new Set(orphanedIndexIds));

  return {
    success: true,
    links_removed: removed,
    terms_flagged_orphaned: termsFlagged,
    orphaned_index_ids: orphanedIndexIds
  };
}

// ALPHA-PLUS — INDEX TERMS: combined find-or-create + link, for the
// public sync_index_term write path (see doPost). Wraps the two
// existing primitives so the client never needs a readable POST
// response to know the index_id — everything happens server-side.
function syncIndexTerm_(term, nodeId, sourceType) {
  if (!nodeId) throw new Error("node_id is required.");

  // FIX (2026-09-06): this single-term path used to call
  // findOrCreateIndexTerm_ WITHOUT a lock, unlike syncIndexTermsBulk_.
  // Two near-simultaneous right-click "Mark as index term" calls for
  // two DIFFERENT terms could both read the same "current max ID"
  // before either wrote, and both mint the same new index_id for two
  // different terms — a real bug that produced duplicate-ID rows
  // (e.g. one ID shared by 2-4 unrelated terms). Wrapping this in the
  // same script lock as the bulk path closes that race.
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const termResult = findOrCreateIndexTerm_(term);
    const linkResult = linkIndexTerm_(termResult.index_id, nodeId, sourceType || "manual");

    return {
      success: true,
      index_id: termResult.index_id,
      term: termResult.term,
      term_action: termResult.action,
      link_action: linkResult.action
    };
  } finally {
    lock.releaseLock();
  }
}

// ALPHA-PLUS — INDEX TERMS: removes the Index_Node row linking this
// term to this node only (by normalized_term lookup, since the
// client-side "no-cors" write never has an index_id to send back).
// Other nodes linked to the same term, and the Index_Terms row
// itself, are left alone — a term can be legitimately marked on
// more than one subtopic.
//
// UPDATE (2026-09-10): per user decision, a single "Unmark" should be
// flagged the exact same way as the bigger cascade actions if it
// happens to be this term's LAST remaining link — consistency was
// specifically requested here after the earlier silent-orphan bug.
// So after removing the link, this now checks whether the term has
// any links left anywhere; if not, it gets the same `orphaned_at`
// flag (never a delete) that removeIndexLinksAndFlagOrphans_ uses.
function unlinkIndexTermByTerm_(term, nodeId) {
  const cleanTerm = String(term || "").trim();
  if (!cleanTerm) throw new Error("term is required.");
  if (!nodeId) throw new Error("node_id is required.");

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const { termsSheet, linksSheet } = ensureIndexSheets_(ss);
  const normalized = normalizeTerm_(cleanTerm);

  const termValues = termsSheet.getDataRange().getValues();
  const termHeaders = termValues[0];
  const normIdx = termHeaders.indexOf("normalized_term");
  const idIdx = termHeaders.indexOf("index_id");

  let indexId = null;
  for (let i = 1; i < termValues.length; i++) {
    if (String(termValues[i][normIdx]) === normalized) {
      indexId = termValues[i][idIdx];
      break;
    }
  }

  if (!indexId) {
    return { success: true, action: "not_found" };
  }

  const linkValues = linksSheet.getDataRange().getValues();
  const linkHeaders = linkValues[0];
  const lIdIdx = linkHeaders.indexOf("index_id");
  const lNodeIdx = linkHeaders.indexOf("node_id");

  let unlinkedRowIndex = -1;
  for (let i = linkValues.length - 1; i >= 1; i--) {
    if (String(linkValues[i][lIdIdx]) === String(indexId) && String(linkValues[i][lNodeIdx]) === String(nodeId)) {
      unlinkedRowIndex = i;
      break;
    }
  }

  if (unlinkedRowIndex === -1) {
    return { success: true, action: "not_linked" };
  }

  linksSheet.deleteRow(unlinkedRowIndex + 1); // +1: getValues() is 0-indexed, sheet rows are 1-indexed

  // Re-check remaining links for this index_id (post-delete) to decide
  // whether it just became fully orphaned.
  const remainingLinks = linksSheet.getDataRange().getValues();
  const stillHasLink = remainingLinks
    .slice(1)
    .some(row => String(row[lIdIdx]) === String(indexId));

  let termFlaggedOrphaned = false;
  if (!stillHasLink) {
    const flaggedCount = flagOrphanedRows_(termsSheet, "index_id", new Set([String(indexId)]));
    termFlaggedOrphaned = flaggedCount > 0;
  }

  return { success: true, action: "unlinked", index_id: indexId, node_id: nodeId, term_flagged_orphaned: termFlaggedOrphaned };
}

// ALPHA-PLUS — INDEX TERMS: every term currently linked to one node,
// for the subtopic-scoped Index tab. Reuses the same two sheets the
// global A-Z glossary reads, filtered server-side to one node_id.
function getIndexTermsForNode_(nodeId) {
  if (!nodeId) return { success: false, error: "node_id is required." };

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const terms = getSheetDataSafe_(ss, "Index_Terms");
  const links = getSheetDataSafe_(ss, "Index_Node");

  const termById = {};
  terms.forEach(function (row) { termById[row.index_id] = row; });

  const data = links
    .filter(function (link) { return String(link.node_id) === String(nodeId); })
    .map(function (link) {
      const term = termById[link.index_id];
      if (!term) return null;
      return {
        index_id: link.index_id,
        term: term.term,
        id: (typeof slugifyIndexTermServer_ === "function") ? slugifyIndexTermServer_(term.term) : null,
        source_type: link.source_type || "manual"
      };
    })
    .filter(Boolean);

  return { success: true, data: data };
}

// Server-side mirror of js/richcontent.js's slugifyIndexTerm(), so a
// manually-marked term (which may not exist as a live <span> on the
// page yet, e.g. right after adding it on a different render) still
// gets a usable/consistent id for scroll-to-highlight in the Index tab.
function slugifyIndexTermServer_(term) {
  const base = String(term || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return "term-" + (base || "entry");
}

// ALPHA-PLUS — INDEX TERMS: minimal public-write abuse guard.
// This site has no login, so there is no real per-user identity to
// throttle by — this is a deliberately simple GLOBAL rate limit
// (max WRITES_PER_WINDOW index-term writes per WINDOW_SECONDS,
// across all visitors combined) using CacheService, which is the
// only cheap shared counter Apps Script gives a webapp without a
// database write of its own. It stops a runaway script/bot from
// flooding Index_Terms/Index_Node; it will NOT stop a determined
// abuser rotating requests slowly. Flagging as requested: no other
// public write endpoint in this file has ANY throttling today either
// (save_core, save_resource, save_structure, etc. are all wide open)
// — if that's a real concern, the same helper can be reused there.
function checkIndexWriteRateLimit_() {
  const WRITES_PER_WINDOW = 40; // budget kept at 40 (raised from 20 when
  // bulk auto-sync existed; only single-term writes happen now, but
  // 40 is still harmless) — this budget is about guarding against a
  // runaway script/bot, not normal editorial use.
  const WINDOW_SECONDS = 60;
  const cache = CacheService.getScriptCache();
  const key = "idxWriteCount_" + Math.floor(Date.now() / (WINDOW_SECONDS * 1000));

  const current = Number(cache.get(key) || 0);
  if (current >= WRITES_PER_WINDOW) return false;

  cache.put(key, String(current + 1), WINDOW_SECONDS);
  return true;
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

  // NOTE: tree-title scanning (Nodes -> source_type "tree") was
  // deliberately removed. Subject/Course/Unit/Chapter titles are
  // structural TOC labels, not conceptual index entries, and were
  // cluttering the Index Terms directory. See
  // cleanupTreeSourcedIndexTerms() for the one-time removal of the
  // rows this used to create.
  const contentRows = getSheetData(ss, "Content_Core");

  let termsCreated = 0;
  let linksCreated = 0;

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

// ONE-TIME CLEANUP — removes every Index_Node link that was created
// with source_type = "tree" (i.e. added by migrateIndexTerms()'s old
// Nodes-sheet scan), then deletes any Index_Terms row that has ZERO
// remaining links after that removal. A term that also has a
// "content" or "manual" link on some node is left alone — only the
// tree-sourced link is removed from it.
// (Already run once against the live sheet as of this file version —
// safe to re-run any time, it's idempotent: a second run reports 0.)
function cleanupTreeSourcedIndexTerms() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const { termsSheet, linksSheet } = ensureIndexSheets_(ss);

  const linkValues = linksSheet.getDataRange().getValues();
  const linkHeaders = linkValues[0];
  const srcIdx = linkHeaders.indexOf("source_type");
  const idIdx = linkHeaders.indexOf("index_id");

  const keptLinks = [linkHeaders];
  let linksRemoved = 0;
  for (let i = 1; i < linkValues.length; i++) {
    if (String(linkValues[i][srcIdx]) === "tree") {
      linksRemoved++;
    } else {
      keptLinks.push(linkValues[i]);
    }
  }

  linksSheet.getRange(1, 1, linkValues.length, linkHeaders.length).clearContent();
  linksSheet.getRange(1, 1, keptLinks.length, linkHeaders.length).setValues(keptLinks);

  const stillLinked = new Set();
  for (let i = 1; i < keptLinks.length; i++) {
    stillLinked.add(String(keptLinks[i][idIdx]));
  }

  const termValues = termsSheet.getDataRange().getValues();
  const termHeaders = termValues[0];
  const tIdIdx = termHeaders.indexOf("index_id");

  const keptTerms = [termHeaders];
  let termsDeleted = 0;
  for (let i = 1; i < termValues.length; i++) {
    const indexId = String(termValues[i][tIdIdx]);
    if (stillLinked.has(indexId)) {
      keptTerms.push(termValues[i]);
    } else {
      termsDeleted++;
    }
  }

  termsSheet.getRange(1, 1, termValues.length, termHeaders.length).clearContent();
  termsSheet.getRange(1, 1, keptTerms.length, termHeaders.length).setValues(keptTerms);

  const summary = {
    success: true,
    links_removed: linksRemoved,
    terms_deleted_as_orphans: termsDeleted
  };

  Logger.log(JSON.stringify(summary));
  return summary;
}

// ONE-TIME FIX — repairs duplicate index_id rows in Index_Terms
// (caused by the pre-fix race condition in syncIndexTerm_ /
// add_index_term_standalone: two concurrent requests for two
// DIFFERENT terms could mint the same "next" ID before either wrote).
//
// For each index_id shared by 2+ different terms: the FIRST row
// found keeps that id untouched (and keeps whatever Index_Node links
// already point to that id). Every OTHER row with that same id gets
// a fresh, genuinely-unique id instead.
//
// IMPORTANT: Index_Node only stores (index_id, node_id) — it does not
// record which specific term a link was for. So the existing links on
// a collided id cannot be split apart; they all stay with whichever
// term kept the original id. Terms that get a NEW id in this pass
// will have zero links until you re-mark them (right-click -> "Mark
// as index term") on their actual topic page.
//
// Run this ONCE from the Apps Script editor (select
// fixDuplicateIndexTermIds in the function dropdown, then Run).

/* =========================================================
   ORPHAN BACKFILL — ONE-TIME CATCH-UP (2026-09-10)
   The orphaned_at flags above (removeIndexLinksAndFlagOrphans_,
   flagOrphanedRows_, driveHealthCheck) only fire going forward, at
   the moment a deletion happens AFTER this code is deployed. This
   function is the one-time catch-up for everything that was already
   orphaned BEFORE today — e.g. topics deleted via the old
   deleteStructureNodeRow (which never used to touch Index_Terms/
   Resources/MCQs at all), or Drive folders removed manually a while
   ago, or the old {{}} auto-sync era's leftovers.

   Run this ONCE from the Apps Script editor (select
   backfillAllOrphans in the function dropdown, then Run), any time
   after deploying this version. Safe to run more than once —
   already-flagged/already-valid rows are skipped, nothing is ever
   deleted. Check View -> Execution log afterwards for the summary.
   ========================================================= */
function backfillAllOrphans() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Every node_id currently in Nodes — the source of truth for
  // "does this topic still exist at all". Content_Core/Resources/MCQs
  // rows pointing at anything NOT in this set are orphaned by a past
  // topic deletion.
  const nodesSheet = ss.getSheetByName("Nodes");
  const validNodeIds = new Set();
  if (nodesSheet) {
    const nodeValues = nodesSheet.getDataRange().getValues();
    const nodeIdIdx = nodeValues[0].map(String).indexOf("node_id");
    for (let i = 1; i < nodeValues.length; i++) {
      validNodeIds.add(String(nodeValues[i][nodeIdIdx]));
    }
  }

  const results = {};

  // --- Index_Terms: flag any term with zero Index_Node links today ---
  const { termsSheet, linksSheet } = ensureIndexSheets_(ss);
  const linkValues = linksSheet.getDataRange().getValues();
  const linkIdIdx = linkValues[0].map(String).indexOf("index_id");
  const linkedIds = new Set();
  for (let i = 1; i < linkValues.length; i++) {
    linkedIds.add(String(linkValues[i][linkIdIdx]));
  }

  const orphanedAtColTerms = getOrAddColumn_(termsSheet, "orphaned_at");
  const termValues = termsSheet.getDataRange().getValues();
  const termIdIdx = termValues[0].map(String).indexOf("index_id");
  let termsNewlyFlagged = 0, termsStaleCleared = 0;
  for (let i = 1; i < termValues.length; i++) {
    const isLinked = linkedIds.has(String(termValues[i][termIdIdx]));
    const currentFlag = termValues[i][orphanedAtColTerms];
    if (isLinked) {
      if (currentFlag) {
        termsSheet.getRange(i + 1, orphanedAtColTerms + 1).setValue("");
        termsStaleCleared++;
      }
    } else if (!currentFlag) {
      termsSheet.getRange(i + 1, orphanedAtColTerms + 1).setValue(new Date());
      termsNewlyFlagged++;
    }
  }
  results.index_terms = { newly_flagged: termsNewlyFlagged, stale_flags_cleared: termsStaleCleared };

  // --- Content_Core / Resources / MCQs: flag rows whose node_id/
  // topic_id no longer exists in Nodes at all (a past full-topic
  // delete that pre-dates the cascade fix) ---
  function backfillByMissingNode_(sheet, columnName) {
    if (!sheet) return { newly_flagged: 0 };
    const orphanedAtCol = getOrAddColumn_(sheet, "orphaned_at");
    const values = sheet.getDataRange().getValues();
    const headers = values[0].map(String);
    const colIdx = headers.indexOf(columnName);
    if (colIdx === -1) return { newly_flagged: 0 };

    let newlyFlagged = 0;
    for (let i = 1; i < values.length; i++) {
      const refId = String(values[i][colIdx]);
      const currentFlag = values[i][orphanedAtCol];
      if (!validNodeIds.has(refId) && !currentFlag) {
        sheet.getRange(i + 1, orphanedAtCol + 1).setValue(new Date());
        newlyFlagged++;
      }
    }
    return { newly_flagged: newlyFlagged };
  }

  results.content_core = backfillByMissingNode_(ss.getSheetByName("Content_Core"), "node_id");
  results.resources = backfillByMissingNode_(ss.getSheetByName("Resources"), "topic_id");
  results.mcqs = backfillByMissingNode_(ss.getSheetByName("MCQs"), "topic_id");

  const summary = { success: true, ...results };
  Logger.log("Orphan backfill complete: %s", JSON.stringify(summary));
  return summary;
}
