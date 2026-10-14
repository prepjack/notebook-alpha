# CHECKPOINT — PHASE 7 (cleanup) — LAST PHASE, project complete

## What was changed
Phase 7 was done in 2 steps. Base: Phase 6 commit `58f1d9c` (Phase 6 checkpoint file).

**Gate (done first, no assumption):** Apps Script function `auditBilingualRows()` (READ-ONLY, only writes to the log) was added to `google-sheet-template/Code.gs` just above `applyCollectionExtras_`. Live result: 3 question rows, 3 one-row bilingual, **0 rows with `question_group_id`**, 0 problems. So legacy code could be removed. (No Code.gs deploy needed for a read-only function that is only run from the editor.)

**7A — `js/mcq.js`, `js/mcq-parse.js`** (commit `6c6ccfb`, no Code.gs change)
- `buildMcqSlots`: only the one-row path remains (a row with `question_alt` = ONE slot with two variants; every other row = its own slot). Grouped-row branch removed.
- `mapMcqRow`, `getMcqLanguages`, preview table: no more `question_group_id` / 🔗 "Linked" branch.
- AI prompt: the 3+ language "MULTI-LANGUAGE INSTRUCTION" + `@group` branch removed; only 1 language or 2 languages (one-block bilingual) remain. "How many languages?" select is now 1 or 2 (clamp in `renderMcqLanguageSelects` = 2). `@group` line removed from "Tag format reference". "?" Field Guide text for the language count updated.
- `js/mcq-parse.js`: `@group` handling, `_groupKey` / `_langSlug` / `_bilingual` internals and the group post-pass removed. `mcq_id` format UNCHANGED (`mcq_<collection-slug>_q<question_no>`, hash of question when no collection). Output still carries `question_group_id: ""` so the sheet column is never blanked/dropped. New soft warning when two blocks in one file share the same mcq_id ("would overwrite each other"). An old `@group` tag is silently ignored.
- Kept: `mcqActiveLanguageByGroup` (still used for one-row slots, key `row:<id>`), the `question_group_id` COLUMN in the sheet (never delete columns), the `MCQ_BANK_NEW_COLUMNS_` entry in Code.gs.

**7B — docs + help** (`PROJECT_GUIDE.md`, `COLUMN_MAP.md`, `js/mcq.js`)
- PROJECT_GUIDE.md: old "Language-linking" section replaced by "MCQ one-row-per-question design" (schema, source fields, missing-info rule, 1-2 languages only, mcq_id, bilingual tag grammar, where editing happens, delete / re-import procedure, `auditBilingualRows()`).
- COLUMN_MAP.md: `question_group_id` marked legacy/unused; status note listing which action edits which new column (`update_mcq_meta`, `update_mcq_content`, `update_collection_info`).
- "?" Field Guide (`MCQ_GUIDE_POINTS`): new point "Origin and paper details" (13 points, `MCQ_GUIDE_COLORS` 13 entries, Fetch & Preview stays red). Closes the issue open since Phase 3.
- Code comment "next to Paper Sources" corrected.

## What was verified
By Claude: `node --check` OK on both JS files; old vs new `parseMcqMarkdown` on the same sample (bilingual, normal, no-collection) gives identical rows except key order; `@group` file ignored + duplicate warning works; `buildMcqSlots` / `getMcqLanguages` extracted and run on sample rows; each diff `git apply --check` on a fresh clone (7B on top of pushed 7A).
By Mahender (real site): `auditBilingualRows()` run on live sheet (gate = 0, problems = 0); "7A pass"; "7B pass". Committed and pushed.

## Deviations from PHASE_7 file
1. Added `auditBilingualRows()` BEFORE the gate (plan listed it as item 5) so the gate could be read from the log instead of by eye.
2. `mcqActiveLanguageByGroup` was NOT removed (plan said "group branch"): the one-row bilingual slots still use it. Only legacy group code was removed.
3. Language-count select limited to 1-2 (not disabled-with-note): 3+ language sets are now a new project, as the plan allows.
4. Parser keeps `question_group_id: ""` in its output on purpose (sheet column stays intact).
5. Added a duplicate-mcq_id soft warning (not in plan) because a pasted old two-block file would otherwise overwrite silently.

## Open issues / things to know
- Live sheet had only 3 question rows at gate time (fresh start). Normal single-language rows were not present to regression-test on the live site; the code path for them is unchanged.
- Test collection "TEST Bilingual Demo Paper (delete me)" may still exist — Mahender decides when to delete.
- Keep the Google Sheet backup copy for a few weeks.
- A single-language question still cannot get a second language through the pencil (Phase 6 decision); re-import from `.md` instead.
- Old bilingual papers imported the old way have TWO Collections rows; "Edit paper info" edits only one (Phase 6 note, now moot once old sets are gone).

## Final audit (grep)
`question_group_id` remains only in: `js/mcq-parse.js` (header comment + `question_group_id: ""`) and `Code.gs` `MCQ_BANK_NEW_COLUMNS_`. `@group`: only in a comment saying it is ignored.

## Markers (if anyone re-checks later)
- `git log` shows `6c6ccfb` (7A) and the 7B commit on top of `58f1d9c`.
- `grep -n "function auditBilingualRows" google-sheet-template/Code.gs` → 1 hit.
- `grep -c "question_group_id" js/mcq.js` → 0.
- `grep -n "buildMcqSlots" -A25 js/mcq.js` → no `byGroup`.
- Add MCQs "How many languages?" shows only 1 and 2.

## Status
All 7 phases of the one-row-per-question redesign are DONE. No next phase.
