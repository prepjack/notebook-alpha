# CHECKPOINT — MCQ Hub H3 (Correct tab: answer key + bulk save)

**Status:** DONE — tested by Mahender, "H3 pass" (2026-10-20).
**Commit:** `feat(mcq): update_mcq_content_bulk + Hub Correct tab answer-key grid, paste key, verify, undo (H3)`
**Code.gs:** changed (2 FIND→REPLACE blocks) and deployed as a new version. Sheet backup was made before.

## Files changed
- `google-sheet-template/Code.gs` — NEW `updateMcqContentBulk(data)`, const `MCQ_BULK_MAX_UPDATES_` (200), `testUpdateMcqContentBulk()` (dry-run only), and a `doPost` route right after `update_mcq_content`. No existing function changed.
- `js/mcq-correct.js` — NEW. Part 1 pure functions (node-testable), Part 2 `mcqBulkSaveAndVerify`, Part 3 Correct tab UI. Loaded after mcq-export.js, before mcq-hub.js.
- `js/mcq-hub.js` — CORRECT tab added (order: Papers · Info · Import · Correct · Export); `closeMcqHub(force)` now returns false when the person keeps unsaved answer changes; same guard on paper `<select>` change and on Papers-tab "Info"; close button/overlay use `() => closeMcqHub()`; `openMcqHub` calls `closeMcqHub(true)`.
- `js/mcq.js` — `mcqUpdateSelectionUi_` also calls `window.mcqCorrectOnSelectionChange_?.()`.
- `mcq.html` — `<script src="js/mcq-correct.js">`.
- `css/style.css` — `.mcq-key-*` rules (grid, chips, diff, result, sticky save bar).
- `docs/hub/test-correct.js` — node test (`node docs/hub/test-correct.js` → ALL TESTS PASSED).

## Backend contract — `update_mcq_content_bulk` (H4/H5 depend on this)
```
POST (no-cors, JSON string body)
{ "action": "update_mcq_content_bulk",
  "updates": [ { "mcq_id": "...", "fields": { "correct_option": 3, ... } }, ... ],   // 1..200
  "dry_run": false }

Response (unreadable from the browser because of no-cors; visible in Apps Script / dry-run test):
{ "success": true, "updated": <rows changed>, "cells": <cells changed>,
  "unchanged": <cells already equal>, "not_found": [mcq_id], 
  "skipped": [ { "mcq_id", "field", "reason" } ], "dry_run": bool }
```
- Empty list or >200 updates → error (thrown, so `doPost`'s error handling applies).
- Only `MCQ_CONTENT_EDITABLE_COLUMNS` are written; other columns → `skipped: "column not allowed"` (mcq_id, collection_id, created_at can never be written).
- `correct_option`: A–F / 1–6 → number; `""` clears the answer; a non-empty invalid value (e.g. `Z`, `0`) → skipped, never written. 0 vs `""` counts as unchanged.
- `origin` → `normalizeMcqOrigin_`; all other fields → `safeSheetText_`.
- ONE sheet read; only changed cells written with `setValue`; `updated_at` set on each changed row; `LockService.getScriptLock()` (`waitLock(20000)`) taken BEFORE the read on real runs, released in `finally`; dry-run takes no lock and writes nothing.
- Same cell requested twice: later wins; if it ends equal to the sheet value it is dropped.

## Frontend contract — `mcqBulkSaveAndVerify(paperId, updates, opts?)`
- `updates`: `[{ mcq_id, fields: { <content column>: value } }]`; `opts`: `{ isUndo: boolean }`.
- Flow: (1) GET paper from the Sheet (+ cache-buster) to remember previous values and prove the Sheet is reachable — if it fails it throws "Could not reach the Sheet. Nothing was saved…"; (2) POST in chunks of 100; (3) re-read and compare up to 3 times, 2 s apart (`mcqBulkVerify_`); (4) refresh `allLoadedMcqs` and `mcqApiData.mcqs` in place via `mapMcqRow`, drop `mcqExportCache_[paperId]`, call `applyMcqPracticeFilters()` (keeps the current question index; resets the running attempt/timer because answers changed).
- Returns `{ ok, saved, total, mismatches:[{mcq_id,field,expected,got}], notFound:[ids], attempts, rows }` (`rows` = fresh mapped rows of the paper sorted by `question_no`). Throws a friendly Error only when the pre-read fails, or when the post-save re-read fails entirely.
- Global `lastBulkUndo = { paperId, updates:[{mcq_id, fields:<previous values>}] }` (memory only). Set after every non-undo save; cleared after a clean undo. Previous `correct_option` of "none/0" is stored as `""`.
- Compare rules: `correct_option` as numbers (""/0 = none), text trimmed, a leading `'` tolerated on text that starts with `= + -`.
- Pure helpers exported for node: `parseAnswerKey`, `buildAnswerKeyChanges_`, `formatAnswerKeyChange_`, `mcqCorrectSavedOption_`, `mcqBulkChunk_`, `mcqBulkCompare_`, `mcqBulkVerify_`, `mcqBulkPrevValue_`, `mcqKeyLetter_`.

## `parseAnswerKey(text, questionNos, optionCounts)`
Returns `{ applied:[{qno, option 1-6}], unknown:[qno], invalid:[token], outOfRange:["3-E"], duplicates:[qno], compact:boolean, compactMismatch:null|{got,expected} }`.
Accepts `1-A 2-C`, `1.A`, `1) a`, `1:3`, `1 A`, `Q1-A`, Devanagari digits, comma/newline/space separated. Matches by paper question number. A plain letter list (`ACBDA`) is accepted only when its length equals the number of questions (UI asks `confirm()` first). Never saves.

## Correct tab behaviour
- Needs a paper; always loads fresh from the Sheet (reuses the loaded data for 30 s; "🔄 Reload from Sheet").
- Row: `Q<no>` · first ~60 chars of Language 1 · chips for the real option count (2–6) · saved answer green · unsaved change orange with "was B" · `no answer` flag in red. Same chip again = revert.
- Diff list ("Q7: B → D", "Q9: (none) → A"), sticky `Save N changes` bar, `confirm()` when N > 10, `Only selected (N)` toggle.
- Result: `✔ Saved 7/7 and confirmed from the Sheet` or mismatch list + 🔁 Retry (hint: new Apps Script version may not be deployed); ↩️ Undo last save; "Answer changed — check the explanation too" + `Select these N for review` (adds ids to `mcqSelectedIds`; Review mode is H4).
- Unsaved changes: guard on Hub close, paper switch, Papers-tab Info; `beforeunload` warning.
- Hooks exposed: `mcqCorrectHasUnsaved_()`, `mcqCorrectConfirmDiscard_()`, `mcqCorrectOnSelectionChange_()`.

## Tests
- node: `docs/hub/test-correct.js` (parser formats, messy input, unknown 99, invalid 5-Z, out-of-range on 4-option questions, compact string, diff, chunking, compare, verify retries) — ALL TESTS PASSED. `docs/hub/test-export.js` (H2) still passes.
- Manual tests 0–8 from the phase file: PASS ("H3 pass").

## Next
**H4** — Review mode for chosen questions (answer + explanation + text) and paste-back of AI-corrected text with before/after preview; reuse `mcqBulkSaveAndVerify` (content columns such as `question`, `option_a…f`, `explanation`, `*_alt` are already in the allow-list) and `mcqSelectedIds`. Open a NEW chat, paste the H4 phase file, say "Do this phase."
