# CHECKPOINT — PHASE 3 (Add MCQs modal, AI prompt, preview, save)

## What was changed
Commits on GitHub (main): `8997178` (Phase 2 parser) -> `74d1c7d` (Phase 1 backend, finished during this session) -> `1db47d6` (Phase 3, js/mcq.js).

### A) Phase 1 remainder (was missing — found at Phase 3 start) — google-sheet-template/Code.gs (+82)
- Before this, repo Code.gs only had MCQs constants + text protection (batch 1). The sheet columns and the Collections backend did NOT exist.
- Added: `BILINGUAL_MCQ_COLUMNS_`, `COLLECTION_EXTRA_COLUMNS_`, `BILINGUAL_PASSAGE_COLUMNS_`, `addMissingColumns_()`, `setupBilingualRowSchema()` (run ONCE by Mahender — done, columns exist in the live sheet), `applyCollectionExtras_()`.
- `ensureCollection_` now calls `applyCollectionExtras_` for BOTH an existing and a newly created collection. Blank values never erase saved ones. Values go through `safeSheetText_`.
- `source_qid` / `source_page` columns on MCQs set to Plain text format.
- Deployed to Apps Script as a New version (Mahender confirmed).
- NOT done: the `update_collection_info` action (planned for Phase 6, Edit paper info).

### B) Phase 3 — js/mcq.js (+206 / −7)
- New optional dabba "3b. Paper source details" (details/summary) after the Drive link: ids `mcq-pdf-url`, `mcq-source-url`, `mcq-source-path`, `mcq-answer-key-url`, `mcq-paper-remark`, message `mcq-source-msg`.
- New functions: `readMcqSourceInputs_`, `applyMcqSourceInputs_`, `MCQ_SOURCE_URL_FIELDS_`, `buildMcqBilingualPromptLines_`, `buildMcqWarningLines_`, `renderMcqPreviewNotes_`.
- `submitAddMcq`: validates http(s) (only blocker), `merged.warnings` collected from parser, modal values applied to every collection of the import, `window.__mcqLastParsedCollections` stored.
- `confirmSaveMcqs`: collection objects now carry `pdf_url, source_url, answer_key_url, source_path, remark` (from parsed collection; modal wins, blank keeps .md value).
- `buildMcqAiPrompt`: languages == 2 -> new one-block bilingual prompt; 1 -> unchanged; 3+ -> legacy @group prompt.
- Preview: "N questions — one row each · English + Hindi" line, grouped warnings list, "no PDF link" note, Lang column shows "English + Hindi" for one-row questions.
- Tag format reference updated; @group marked OLD way.

## What was verified
By Claude: node unit tests of the new helpers; sample .md (`TEST_bilingual_paper.md`, 3 questions incl. assertion_reason) parses to 3 mcqs, 0 paper warnings; patches apply cleanly; `node --check` OK.
By Mahender (real site): Add MCQs flow with the test paper worked as described — ONE row per question in MCQs sheet, `_alt` columns filled, Collections row has source details; old flow unaffected. Committed + pushed.

## Deviations from the plan
1. Phase 1 backend was incomplete -> finished here (see A). Phase 3 itself still did not touch Code.gs.
2. Paper header is NOT a separate block: parser turns a header-only block into a bogus empty question (and breaks ids). Prompt tells the AI to put @collection/@exam/@year/@session/@source_path on the FIRST question block (they carry forward). Parser unchanged.
3. The "?" Field Guide panel (MCQ_GUIDE_POINTS) was NOT updated (list is index-numbered; new field is "3b").
4. Modal source details are saved on EVERY collection of one import; preview shows a note when the import has more than one collection.
5. Preview shows the parser's own text for most warnings; only the option-count mismatch is rewritten ("Hindi has 3 options, English has 4").

## Open issues / noticed
- Test collection "TEST Bilingual Demo Paper (delete me)" is STILL in the sheet (3 bilingual rows) — keep it for Phase 4 testing, then delete with "Delete this entire collection".
- The parser warns "no @topic" even when the Study Topic field of the popup later fills node_id (harmless).
- "Practice screen shows no Hindi toggle for one-row questions yet" = Phase 4.
- Old two-row bilingual rows (question_group_id) still exist/keep working the old way until Phase 7 decision.

## Markers for Phase 4 "Previous phase check"
- `grep -n "buildMcqBilingualPromptLines_\|readMcqSourceInputs_\|__mcqLastParsedCollections" js/mcq.js` -> found.
- `grep -n "setupBilingualRowSchema\|applyCollectionExtras_" google-sheet-template/Code.gs` -> found.
- `git log -3` shows `1db47d6` on top. Live sheet MCQs has `question_alt`, `option_a_alt`, `source_qid` etc.; the test collection has 3 rows with those filled.

## Corrections / notes for PHASE_4 file
- `mapMcqRow` copies fields ONE BY ONE: it must now also copy `alt_language, question_alt, option_a_alt..option_f_alt, explanation_alt, explanation_a_alt..explanation_f_alt, source_qid, source_page, remark, extra_link, extra_link_label` (none are copied today).
- One-row questions have `question_group_id` = "" and `question_alt` non-empty; the language toggle must be built from the row itself (primary = `language`, second = `alt_language`) — not from grouped rows.
- Keep the legacy grouped-row path (3+ languages and old rows) untouched.
- Attempt/stat counting must count ROWS (one id per question) — test with the TEST paper (3 questions must show 3, not 6).
- Option ORDER is identical in both languages and `correct_option` is shared: switching language must not change the selected option or the answer.
