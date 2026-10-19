# CHECKPOINT — MCQ Hub H2 (Selection + Export tab)

**Status:** DONE — tested by Mahender, "H2 pass" (2026-10-19).
**Commit:** `feat(mcq): question selection and Hub Export tab — copy, print-PDF, .md, .csv (H2)`

## Files changed
- `js/mcq-export.js` — NEW. Part 1 pure functions (node-testable), Part 2 thin Export-tab UI. Loaded after mcq.js, before mcq-hub.js.
- `js/mcq.js` — `mcqSelectedIds` (Set of mcq_id) + `mcqSelectionTopicId_`; `mcqSelectBoxHtml_`, `mcqUpdateSelectionUi_`, `setupMcqSelectionListeners` (delegated change listener, no re-render); Select box in both card headers; `mcq-picked` class on navigator numbers; selection cleared in `applyMcqPracticeFilters` when the topic id changes; `mapMcqRow` now also keeps `correct_option` (raw sheet value, so "no answer" shows `Correct: —`).
- `js/mcq-hub.js` — EXPORT tab, `✔ N selected` chip + menu (Select all in this paper / Select visible / Invert / Clear).
- `mcq.html` — `#mcq-selection-bar`, `<script src="js/mcq-export.js">`.
- `css/style.css` — selection, export, `#mcq-print-root` and `@media print` rules.
- `docs/hub/test-export.js` — node test for the pure functions (`node docs/hub/test-export.js` → ALL TESTS PASSED).

## Added (ids / functions)
- ids: `mcq-selection-bar`, `mcq-hub-sel-chip`, `mcq-hub-sel-menu`, `mcq-exp-scope|layout|lang|preview|copy|print|md|csv|status|hint`, `mcq-print-root`; classes `mcq-select-box`, `mcq-picked`.
- pure: `buildMcqExport(rows, passages, opts)` → `{text, md, csvRows, count}`, `buildMcqPrintHtml`, `mcqExportSortRows_`, `mcqExportCsvString_`, `mcqExportFileName_`, `mcqExportSlug_`.
- UI: `mcqExportTabHtml_`, `mcqExportBind_`, `mcqExportRefresh_`, `mcqExportGetPaper_(paperId)`, `mcqUpdateSelectionUi_()`.
- localStorage: `alpha_mcq_export_opts`.

## Behaviour notes
- Whole-paper scope fetches the paper (`get_mcqs&collection_id=`) if it is not the open Full-paper view; cached per Export-tab open.
- Language 2 falls back to Language 1 for questions without a second language; blank alt options fall back to Language 1 text (same as on screen).
- Print: `body.mcq-printing` + `#mcq-print-root`, cleaned on `afterprint` (120 s safety net). Rich text/KaTeX via `renderRichInline`.
- CSV: UTF-8 with BOM. Code.gs untouched.

## Next
**H3** — next phase file (Correct tab: answer-key grid + paste-key box; needs Code.gs changes, so back up the Google Sheet first). Open a NEW chat, paste that file, say "Do this phase."
