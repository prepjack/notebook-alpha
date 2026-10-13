# CHECKPOINT — PHASE 4 (Practice screen: one-row bilingual questions)

## What was changed
- File: `js/mcq.js` only (+80 / −3 lines). Delivered as `patch.diff` (applied with `git apply`). No change to Code.gs, practice.js, mcq-parse.js, sheet.
- Base commit before the patch: `06ca11d` (Phase 3 checkpoint) on top of `1db47d6`, `74d1c7d`.
- `mapMcqRow`: now copies `alt_language, question_alt, option_a_alt..option_f_alt, explanation_alt, explanation_a_alt..explanation_f_alt, source_qid, source_page, remark, extra_link, extra_link_label` and sets `isAltVariant: false` explicitly (needed because `activateSlotLanguage` uses `Object.assign(slot, variant)`; a missing key would leave a stale `true`).
- New function `buildMcqAltVariant_(row, altKey)`: second-language variant of one row. Same `id`, same answer index, same option ORDER; text from `*_alt` columns; blank alt option / explanation falls back to the first language's text; `isAltVariant: true`.
- `buildMcqSlots`: a row with empty `question_group_id` and non-empty `question_alt` becomes ONE slot (`group_id: "row:" + id`, `primaryKey`, two variants, `languages` = both). If alt language equals primary language, alt key gets " (2)". Alt language blank -> "Hindi". Legacy grouped / single rows: untouched.
- `getMcqLanguages`: one-row questions count for BOTH languages (dropdown shows English and Hindi).
- Passage rendering (`mcqPassageHtml`): Hindi view uses `passage.content_alt`, falls back to `content`.
- Pencil (`mcq-edit-meta` click): if the second language is on screen, an alert is shown and the FIRST-language variant is opened, so Hindi text can never be saved into English columns. (Not in the original plan — safety patch.)

## What was verified
By Claude: all 5 patches matched exactly once; `node --check` OK; node unit test: 4 rows (1 one-row bilingual, 2 old grouped, 1 single) -> 3 slots; toggling English/Hindi keeps `id` and answer index, options order same, `isAltVariant` flips and resets; `getMcqLanguages` = English, Hindi; `patch.diff` applied cleanly on a fresh clone.
By Mahender (real site): Phase 4 test checklist PASSED (count shows once per question, toggle keeps selected option, attempts/total correct, language filter, All Questions / results, old sets and single-language questions still work).

## Audit result (places reading language / question_group_id)
- No change needed: `activateSlotLanguage`, `setSlotLanguage`, language filter (`slot.languages` has both), tag/origin filters, `logMcqAttempt` (logs `q.id` = row id for both variants), counter/grid/All Questions/results (slot-based), selected answers (keyed by slot index), Paper Sources popup (counts by collection -> one entry per one-row paper).
- `js/practice.js`: `fetchMcqTotalForTopic` and `mcqEventStats` read, NOT changed — correct for one-row questions.
- Question-text search: not checked separately.

## Deviations / choices
1. Added Patch 5 (pencil safety) — not in PHASE_4 file.
2. Blank alt option/explanation falls back to the first language's text instead of showing empty.
3. Pencil in Hindi view edits the FIRST language only (alert says so); editing the second language = Phase 6.

## Open issues / noticed
- Test collection "TEST Bilingual Demo Paper (delete me)" still in the sheet — Mahender decides when to delete it (via "Delete this entire collection"). Useful for Phase 5 testing of the ⓘ button first.
- `patch.diff` (Phase 2 `phase1_batch1.diff` too) should not stay in the repo root; delete if committed.
- Delete flow for a one-row question: not changed, deletes by row id (one row) — works.
- "?" Field Guide panel (MCQ_GUIDE_POINTS) still not updated for the new fields (from Phase 3).

## Markers for Phase 5 "Previous phase check"
`grep -n "buildMcqAltVariant_\|isAltVariant\|primaryKey\|question_alt" js/mcq.js` -> all four found.
`git log -3` should show the Phase 4 commit on top of `06ca11d`.
Live sheet: test paper rows have `question_alt` filled; site shows "Question 1 of 3" for it.

## Corrections / notes for PHASE_5 file
- ⓘ must read `source_qid`, `source_page`, `remark`, `extra_link`, `extra_link_label` from the slot/variant — these are now copied by `mapMcqRow` (Phase 4), so no mapping work needed.
- Paper-level info (pdf_url, source_url, source_path, answer_key_url, remark) lives in the Collections sheet: check what the collections fetch in mcq.js already returns; if it does not expose these columns, the ⓘ "Original source" section needs them mapped first.
- Every source field is optional: ⓘ must hide an empty field, never show blanks or errors.
- Slot-level fields (id, source_qid ...) are the same in both language variants, so the ⓘ content does not depend on the active language.
- Rename Paper Sources popup to "Paper info" in this phase (planned).
