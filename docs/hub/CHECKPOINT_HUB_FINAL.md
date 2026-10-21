# CHECKPOINT — MCQ Hub FINAL (H1–H5 summary)

**Project status: COMPLETE** (H5 waits for Mahender's manual tests). Date: 2026-10-21.
Design: `00_HUB_MASTER_PLAN.md`. Phase list: `README.md`. Per-phase detail: `CHECKPOINT_HUB_H1…H5.md`.

## What the Hub does
One button `🗂️ MCQ Hub` (`#mcq-hub-open`) opens a full-screen (phone) / large (desktop) panel with a paper selector, a selection chip (`✔ N selected`) and tabs:
- **Papers** — papers of the loaded topic: question count, origin summary, `⚑ N need check` badge, View in order / Info.
- **Info** — paper facts (PDF links, source, answer key, remark) + ✏️ Edit paper info (Collections sheet).
- **Import** — launcher for the existing Add MCQs modal (`.md` from Drive → preview → save). First import only.
- **Correct** — Answer key (grid of chips + paste key like `1-A 2-C`), Review (edit question/options/answer/explanation, both languages), AI correction (build a prompt, paste the AI reply back, before/after preview — never saved directly), Needs check (queue of flagged questions).
- **Export** — copy, print / save as PDF (browser print, so Hindi works), .md, .csv; fields: question / options / answer / explanation; language EN / HI / both; scope selected / whole paper / current view.
Also: tick box on every question card (`mcqSelectedIds`, shared by Export, Correct, Review), ⚑ flag toggle on every card, ⓘ info and ✏️ pencil (unchanged), Full paper banner with `🗂️ Open in Hub`, `Include sub-topics` checkbox beside the Hub button.

## Data flow
`.md` → Fetch and Save (`save_mcqs_bulk`) → **Sheet = truth** → site reads it live (`get_mcqs`, no cache). Corrections: Hub → `update_mcq_content_bulk` → Sheet → re-read and compare → "✔ confirmed". Never re-run Fetch and Save to correct.

## Files
`mcq.html` (script order: … mcq.js → mcq-export.js → mcq-correct.js → mcq-review.js → mcq-hub.js) · `js/mcq.js` (selection, flag, cards, switches) · `js/mcq-hub.js` (shell) · `js/mcq-export.js` · `js/mcq-correct.js` (`mcqBulkSaveAndVerify`, answer key) · `js/mcq-review.js` (Review, AI, Needs check) · `css/style.css` · `google-sheet-template/Code.gs` · `docs/hub/*` (tests: `node docs/hub/test-*.js`).

## Backend actions (Code.gs `doPost`)
`save_mcqs_bulk` (first import; never writes `needs_check`) · `update_mcq_content` (single row; allow-list `MCQ_CONTENT_EDITABLE_COLUMNS`) · `update_mcq_content_bulk` (1–200 updates, lock, `dry_run`, returns `{success, updated, cells, unchanged, not_found[], skipped[]}`) · `update_mcq_meta` · `update_collection_info` · `delete_mcq` · `delete_mcq_collection`. Read: `get_mcqs`. Apps Script helpers (press Run): `setupMcqBankSheets()`, `auditBilingualRows()`, `auditMcqNeedsCheck()`, `testUpdateMcqContentBulk()`.

## Key switches (top of `js/mcq.js`)
`MCQ_SHOW_FLAG_TO_VISITORS` (default `true`) · `MCQ_OWNER_TOOLS_ALWAYS` (default `true`).

## Known limits
- **No login.** The Apps Script endpoint accepts any POST from anyone who knows its URL (it is in `js/app.js` on GitHub). The owner switch only hides buttons.
- Browser POSTs are `no-cors`: the reply is unreadable, so "saved" is proven only by re-reading the Sheet (3 tries, 2 s apart). A slow Sheet can show a false warning — use Reload.
- The Hub works on the questions loaded for the current topic; the paper list and flag counts come from that list (flags of papers outside the topic are not counted until that topic is opened).
- Options cannot be added or removed in Review (only text). Origin / source fields stay in the ✏️ pencil.
- Two people editing the same question at once: last write wins (the Sheet lock only serialises saves).
- Undo is in memory (lost on reload) and covers the last save of answers/text, not flag taps.
- `needs_check` cannot be set by an import and is ignored if a `.md` carries it.
- Phone layout was checked only by CSS review and jsdom, not on a real device.

## Ideas for later
Secret-token check in `doPost` (real protection) · per-question "last corrected" note · filter practice to "flagged only" · Hub shortcut to open the Sheet row · batch "mark whole paper as checked" · import tab as its own full flow instead of the launcher.
