# Code.gs changes for H5 (FIND → REPLACE)
Apps Script editor → open Code.gs → for each block use Ctrl+F to find the FIND text (it exists exactly ONCE), select it and replace with the REPLACE text. Save. Then **Deploy → Manage deployments → ✏️ edit → Version: New version → Deploy**. Afterwards copy the live Code.gs into `google-sheet-template/Code.gs` and commit it.
Back up the Sheet first (File → Make a copy).

## Block 1 — 1. new column in setup list

### FIND
```js
  "origin", "derived_from"
];

// Idempotent: adds any of MCQ_BANK_NEW_COLUMNS_ missing from row 1,
```

### REPLACE WITH
```js
  "origin", "derived_from",
  // PHASE H5 — review flag. Blank = fine, "yes" = needs check. NOT the same
  // as `status` (that one means active/archived and filters practice).
  "needs_check"
];

// Idempotent: adds any of MCQ_BANK_NEW_COLUMNS_ missing from row 1,
```

## Block 2 — 2. allow-list + normalizeNeedsCheck_

### FIND
```js
  "explanation_alt",
  "origin", "derived_from"
];

function updateMcqContent(data) {
```

### REPLACE WITH
```js
  "explanation_alt",
  "origin", "derived_from",
  "needs_check"
];

// PHASE H5 — needs_check is ONLY "yes" or blank. Anything else (no, 0, false,
// random text) becomes blank, so the column can never hold a surprise value.
function normalizeNeedsCheck_(v) {
  const s = String(v === undefined || v === null ? "" : v).trim().toLowerCase();
  return (s === "yes" || s === "y" || s === "true" || s === "1") ? "yes" : "";
}

function updateMcqContent(data) {
```

## Block 3 — 3. updateMcqContent

### FIND
```js
    const val = (col === "correct_option") ? normalizeCorrectOption_(fields[col])
      : (col === "origin") ? normalizeMcqOrigin_(fields[col])
      : safeSheetText_(fields[col]);
    sheet.getRange(targetRow, colIndex + 1).setValue(val);
```

### REPLACE WITH
```js
    const val = (col === "correct_option") ? normalizeCorrectOption_(fields[col])
      : (col === "origin") ? normalizeMcqOrigin_(fields[col])
      : (col === "needs_check") ? normalizeNeedsCheck_(fields[col])
      : safeSheetText_(fields[col]);
    sheet.getRange(targetRow, colIndex + 1).setValue(val);
```

## Block 4 — 4. updateMcqContentBulk

### FIND
```js
        } else if (col === "origin") {
          newVal = normalizeMcqOrigin_(raw);
          same = (normalizeMcqOrigin_(current) === newVal);
        } else {
          newVal = safeSheetText_(rawText);
```

### REPLACE WITH
```js
        } else if (col === "origin") {
          newVal = normalizeMcqOrigin_(raw);
          same = (normalizeMcqOrigin_(current) === newVal);
        } else if (col === "needs_check") {
          newVal = normalizeNeedsCheck_(raw);
          same = (normalizeNeedsCheck_(current) === newVal);
        } else {
          newVal = safeSheetText_(rawText);
```

## Block 5 — 5. saveMcqsBulk keeps needs_check

### FIND
```js
    // origin: only a valid value is ever written; an invalid/blank one is
    // dropped so a re-import never wipes an origin already set in the sheet.
```

### REPLACE WITH
```js
    // PHASE H5 — an import never sets or clears the review flag. (The .md parser
    // does not send needs_check; this line makes sure nothing else can either.)
    delete incoming.needs_check;
    // origin: only a valid value is ever written; an invalid/blank one is
    // dropped so a re-import never wipes an origin already set in the sheet.
```

## Block 6 — 6. auditMcqNeedsCheck + (setup stays)

### FIND
```js
// ONE-TIME SETUP — select this in the Apps Script editor's function
// dropdown and click Run, once. Safe to re-run any number of times:
// no duplicate columns, no duplicate sheets.
function setupMcqBankSheets() {
```

### REPLACE WITH
```js
// PHASE H5 — READ-ONLY health report. Press Run, then View -> Logs
// (or Execution log). Writes nothing. Prints, per paper (collection):
//   total questions, flagged needs_check = yes, rows with no correct_option,
//   rows that have options but no explanation.
function auditMcqNeedsCheck() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("MCQs");
  if (!sheet) throw new Error("MCQs sheet not found.");
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(function(h) { return String(h); });
  const col = function(name) { return headers.indexOf(name); };
  const cNeeds = col("needs_check");
  const cColl = col("collection_id");
  const cCorrect = col("correct_option");
  const cExpl = col("explanation");
  const cStatus = col("status");
  const optCols = ["option_a", "option_b", "option_c", "option_d", "option_e", "option_f"].map(col);

  if (cNeeds === -1) {
    Logger.log("needs_check column is MISSING. Run setupMcqBankSheets() once (or add a header named needs_check at the end of row 1 of the MCQs sheet).");
  }

  // collection_id -> title (so the report is readable)
  const titleById = {};
  const collSheet = ss.getSheetByName("Collections");
  if (collSheet) {
    const cv = collSheet.getDataRange().getValues();
    const ch = cv[0].map(function(h) { return String(h); });
    const ci = ch.indexOf("collection_id"), ct = ch.indexOf("title");
    for (let i = 1; i < cv.length; i++) {
      if (ci !== -1 && ct !== -1) titleById[String(cv[i][ci])] = String(cv[i][ct]);
    }
  }

  const per = {};
  let total = 0, flagged = 0, noAnswer = 0, noExpl = 0;
  const noAnswerRows = [], noExplRows = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (cStatus !== -1 && String(row[cStatus]).trim().toLowerCase() === "archived") continue;
    const id = String(row[col("mcq_id")] || "");
    if (!id) continue;
    const cid = cColl !== -1 ? String(row[cColl] || "") : "";
    const key = cid || "(no paper)";
    if (!per[key]) per[key] = { total: 0, flagged: 0, noAnswer: 0, noExpl: 0 };
    per[key].total++; total++;

    if (cNeeds !== -1 && normalizeNeedsCheck_(row[cNeeds]) === "yes") { per[key].flagged++; flagged++; }

    const hasOptions = optCols.some(function(c) { return c !== -1 && String(row[c] || "").trim() !== ""; });
    if (cCorrect !== -1 && normalizeCorrectOption_(row[cCorrect]) === "") {
      per[key].noAnswer++; noAnswer++;
      if (noAnswerRows.length < 30) noAnswerRows.push(id);
    }
    if (hasOptions && cExpl !== -1 && String(row[cExpl] || "").trim() === "") {
      per[key].noExpl++; noExpl++;
      if (noExplRows.length < 30) noExplRows.push(id);
    }
  }

  Logger.log("=== MCQ health report (archived rows skipped) ===");
  Logger.log("Total questions: " + total);
  Logger.log("Flagged needs_check = yes: " + flagged);
  Logger.log("No correct_option: " + noAnswer);
  Logger.log("Has options but no explanation: " + noExpl);
  Object.keys(per).forEach(function(k) {
    const p = per[k];
    Logger.log((titleById[k] || k) + "  |  total " + p.total + "  flagged " + p.flagged +
      "  no-answer " + p.noAnswer + "  no-explanation " + p.noExpl);
  });
  if (noAnswerRows.length) Logger.log("First rows with no answer (mcq_id): " + noAnswerRows.join(", "));
  if (noExplRows.length) Logger.log("First rows with no explanation (mcq_id): " + noExplRows.join(", "));
  return { total: total, flagged: flagged, no_answer: noAnswer, no_explanation: noExpl, per_paper: per };
}

// ONE-TIME SETUP — select this in the Apps Script editor's function
// dropdown and click Run, once. Safe to re-run any number of times:
// no duplicate columns, no duplicate sheets.
function setupMcqBankSheets() {
```
