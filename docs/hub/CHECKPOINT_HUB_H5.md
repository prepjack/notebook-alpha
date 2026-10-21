# CHECKPOINT — MCQ Hub H5 (needs_check flag, review queue, polish, docs)

**Status:** BUILT and tested in the container (node + jsdom + mocked Apps Script). Waiting for Mahender's manual tests on the live site/Sheet.
**Commit message:** `feat(mcq): needs_check flag + review queue, Hub polish, docs and cleanup (H5)`
**Code.gs:** changed — 6 FIND→REPLACE blocks in `docs/hub/CODE_GS_H5_BLOCKS.md`, plus new `auditMcqNeedsCheck()`. NOT inside `patch.diff` (Mahender edits Code.gs live, then syncs the local copy). **Back up the Sheet first.**

## Verified before building
H1–H4 checkpoints exist; read the real code: `mcqBulkSaveAndVerify`, `update_mcq_content_bulk` / `updateMcqContentBulk`, Hub tabs (Papers · Info · Import · Correct · Export), Correct sub-views (Answer key · Review · AI correction). Note: the phase file says the Hub has an "Export" tab and a "Correct" tab with an answer-key grid — both found.

## Part 1 — column `needs_check` (column checklist from `docs/archive/00_MASTER_PLAN.md`)
- Code.gs: `MCQ_BANK_NEW_COLUMNS_` (+ `needs_check`, so `setupMcqBankSheets()` creates it) · `MCQ_CONTENT_EDITABLE_COLUMNS` · new `normalizeNeedsCheck_()` (only `yes` or blank) used by `updateMcqContent` and `updateMcqContentBulk` (compare + write) · `saveMcqsBulk`: `delete incoming.needs_check` · NOT added to `MCQ_TEXT_COLUMNS_` (no free text) · `auditMcqNeedsCheck()`.
- `saveMcqsBulk` check: the parser never sends `needs_check`; merge keeps the old cell; the new `delete` line makes this certain. Re-import keeps flags; a NEW row starts unflagged. (Mock test: PASSED.)
- `js/mcq.js` `mapMcqRow`: `needs_check` copied (`"yes"` or `""`).
- Sheet column format: Plain text (same as other text columns).

## Part 2 — UI
- ⚑ toggle on every card (single + All Questions), left of the Select box: instant change, then bulk save + verify via `mcqSetFlags_` → `mcqBulkSaveAndVerify(..., {keepUndo, noReset})`. A running attempt/timer is NOT reset; on failure the card goes back and a red message appears. Toast at the bottom (`#mcq-toast`).
- Visitor label `⚠ being rechecked`: constant `MCQ_SHOW_FLAG_TO_VISITORS` (top of `js/mcq.js`, default `true`).
- Papers tab: `⚑ N need check` badge per paper (tap = open Needs-check list of that paper).
- Correct → new sub-view **Needs check**: list (Q no · text · `✔ Checked`), buttons `Select all flagged`, `Review these N →`, `Export these N`, `Reload`. `Export these` REPLACES the selection with exactly the flagged questions.
- Review footer checkbox `Mark as checked when saved` (default ON): `mcqRvBuildUpdates_(drafts, rows, {clearFlag})` adds `needs_check:""` to the SAME update, only for flagged questions that really changed. Result line shows "⚑ N flags cleared". Flagged question in Review shows a banner with `✔ Mark as checked now`.
- Answer-key result: after a verified save, `⚑ Flag these N for explanation check` (does not replace "Undo last save" for the answers).
- Selection: `Select all flagged` in the selection bar (appears when flagged questions are on screen) and in the Hub `✔ N selected` menu (whole paper).
- Navigator: flagged questions get a small red dot (bottom-right); selected ones keep the orange dot (top-right).

## Part 3 — polish and cleanup
- Owner-tools switch: `MCQ_OWNER_TOOLS_ALWAYS = true` (default = everything visible, owner never locked out). If set `false`: Import and Correct tabs, ⚑ buttons, flagged badge/dots and the Export "AI correction" shortcut show only when `localStorage.alpha_mcq_owner === "1"` (open the page once with `?owner=1`). **This hides buttons only — the Apps Script endpoint has no login. Anyone who knows the web-app URL can still send updates.** Future idea: a secret token checked in `doPost`.
- Dead code removed (grep proved unused): `lastMcqPaperShared_`, `renderMcqPaperSourcesToolbar()` (it only stored a value nobody read and called `mcqHubRefresh`; all 4 callers now call `window.mcqHubRefresh?.()`), the unused "shared papers" counting loop in `renderMcqCollectionNotes`. No old popover CSS/JS was left (grep: no `popover`, `paper-sources`, `mcq-paper-sources-btn` anywhere).
- Phone (≤600 px) CSS: question header, Full paper banner, Hub header/rows and selection bar use the same padding/sizes and wrap instead of overflowing. NOT checked on a real phone from here — see manual test 5.
- Docs: `PROJECT_GUIDE.md` (new "MCQ Hub" section), `COLUMN_MAP.md` (`needs_check`), Field Guide entry "How to correct questions" (English + Hindi, last point of the Add MCQs Field Guide), `docs/hub/README.md`, this file and `CHECKPOINT_HUB_FINAL.md`.

## Files changed
`js/mcq.js`, `js/mcq-hub.js`, `js/mcq-correct.js`, `js/mcq-review.js`, `js/mcq-export.js`, `css/style.css`, `PROJECT_GUIDE.md`, `COLUMN_MAP.md`, NEW `docs/hub/{README.md,CHECKPOINT_HUB_H5.md,CHECKPOINT_HUB_FINAL.md,CODE_GS_H5_BLOCKS.md,test-needs-check.js}`. Code.gs: separate blocks.

## New functions / ids
mcq.js: `mcqOwnerToolsOn_`, `mcqIsFlagged_`, `mcqFlagButtonHtml_`, `mcqFlagLabelHtml_`, `mcqToast_`, `mcqApplyFlagLocal_`, `mcqSyncFlagsToSlots_`, `mcqSetFlags_`, `mcqToggleFlagOnCard_` · hub: `mcqHubVisibleTabs_` · correct: `mcqCorrectFlag_` (+ `mcqBulkNorm_` handles `needs_check`; helper options `keepUndo`, `noReset`) · review: `mcqReviewDrawFlag_`, `mcqReviewFlaggedRows_`, `mcqReviewUnflag_`, `window.mcqFlagChanged_` · Code.gs: `normalizeNeedsCheck_`, `auditMcqNeedsCheck`. CSS: `.mcq-flag-btn`, `.mcq-flag-note`, `.mcq-flagged`, `.mcq-toast`, `.mcq-hub-flag-badge`, `.mcq-flag-row`, `.mcq-rv-markchk`.

## Tests run here
- `node --check js/*.js` OK; `git apply --check patch.diff` OK on a fresh clone.
- node: `test-export.js`, `test-correct.js`, `test-review.js`, new `test-needs-check.js` — ALL PASSED.
- Code.gs (mocked Apps Script): flag normalise, single + bulk update, audit report counts, re-import keeps flag / new row unflagged — PASSED.
- jsdom smoke on the real `mcq.html` + scripts with a fake Sheet: ⚑ instant + saved + confirmed, running attempt kept, selection bar "Select all flagged", Hub badge, queue, `✔ Checked`, `Review these`, Review save clears flag (and only the saved one), answer-key → `Flag these`, Undo still restores answers; owner switch OFF hides tabs/buttons; visitor constant OFF hides label — ALL as expected.

## Manual tests for Mahender (numbered)
0. Backup the Sheet. Paste the Code.gs blocks, Save, deploy a NEW version. Run `setupMcqBankSheets()` once (or type header `needs_check` at the END of row 1 of MCQs; set the column format to Plain text). Run `auditMcqNeedsCheck()` → View → Logs shows counts.
1. Flag 2 questions with ⚑ → red ⚑ + toast "confirmed"; Sheet column shows `yes`; Hub → Papers shows `⚑ 2 need check`; the `⚠ being rechecked` label shows. Set `MCQ_SHOW_FLAG_TO_VISITORS = false`, reload → label gone.
2. Hub → Correct → Needs check → Select all flagged → Review these → edit one → Save with "Mark as checked" ON → only that one loses its flag.
3. Re-run Fetch and Save of an old `.md` into a TEST topic → existing flags stay for the same `mcq_id`s.
4. Answer key: change 2 answers → Save → `Flag these 2 for explanation check` → both flagged.
5. Regression of H1–H4 lists; phone (380 px) walk-through of every Hub tab; Hindi shows in UI, export and print.
6. Docs: Field Guide (Add MCQs → guide icon) → last point "How to correct questions".
7. (Optional) set `MCQ_OWNER_TOOLS_ALWAYS = false`: Import/Correct/⚑ disappear; open `mcq.html?owner=1` once → they return. Set back to `true` afterwards.
