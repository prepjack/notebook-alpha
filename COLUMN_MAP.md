# COLUMN_MAP.md — Notebook Alpha (Phase 1, Step 0 audit)
Source: live headers pasted by Mahender (2026-10-12) + repo check (HEAD 637a3b3). Nothing here is a code change.
Legend: **W** = who writes · **R** = who reads · **UI** = editable in UI · **Safe** = goes through `safeSheetText_` today

## Sheet MCQs — 39 live columns (existing)
| # | Column | Purpose | W | R | UI edit | Safe | Note |
|---|--------|---------|---|---|---------|------|------|
| 1 | mcq_id | row id | save_mcqs_bulk | mapMcqRow (`id`), attempts | no | – | key |
| 2 | node_id | topic link | bulk, update_mcq_meta | mapMcqRow | meta | no | |
| 3 | question | question text | bulk, update_mcq_content | mapMcqRow | content | yes | |
| 4-7 | option_a..d | options | bulk, update_mcq_content | mapMcqRow | content | yes | |
| 8 | correct_option | answer | bulk, update_mcq_content | mapMcqRow (correctToIndex) | content | no | letter, not text |
| 9 | explanation | main explanation | bulk, update_mcq_content | mapMcqRow | content | yes | |
| 10 | status | active/archived | bulk, update_mcq_meta | mapMcqRow | meta | no | |
| 11 | author_id | who added | bulk | – | no | no | not in mapMcqRow |
| 12-13 | created_at / updated_at | timestamps | bulk, update_* | – | no | no | |
| 14 | question_type | simple / passage | bulk | mapMcqRow | no | no | |
| 15 | passage_id | link to MCQ_Passages | bulk | mapMcqRow | no | no | |
| 16 | collection_id | link to Collections | bulk (ensureCollection_) | mapMcqRow | no | no | |
| 17 | question_no | number inside paper | bulk | mapMcqRow | no | no | |
| 18 | difficulty | – | bulk, update_mcq_meta | mapMcqRow | meta | no | |
| 19 | language | row language | bulk, update_mcq_meta | mapMcqRow | meta | no | primary language in new design |
| 20 | tags | – | bulk, update_mcq_meta | mapMcqRow | meta | no | unprotected text |
| 21 | description | – | bulk, update_mcq_meta | mapMcqRow | meta | no | unprotected text |
| 22-24 | exam / year / session | paper facts per question | bulk | not in mapMcqRow | no | no | ALSO exist on Collections (duplicate info) |
| 25 | source | free-text source | bulk | preview (mcq.js ~2507) | no | no | overlaps new `remark`/`source_*` — keep, don't delete |
| 26 | source_question_no | question number printed in source | parser tag `@source_question_no` | not in mapMcqRow | no | no | DIFFERENT from new `source_qid` (qid = paper's Question ID). Keep both |
| 27-28 | orphaned_at / orphan_reason | content-removed flag | Code.gs orphan logic | – | no | no | |
| 29 | question_group_id | ties legacy EN+HI rows | bulk | mapMcqRow | no | no | LEGACY — keep until Phase 7 |
| 30-33 | explanation_a..d | per-option notes | bulk, update_mcq_content | mapMcqRow (optionNotes) | content | yes | |
| 34-35 | option_e / option_f | 5th/6th option | bulk, update_mcq_content | mapMcqRow | content | yes | |
| 36-37 | explanation_e / explanation_f | notes | bulk, update_mcq_content | mapMcqRow | content | yes | |
| 38 | origin | pyq / book / ai … | bulk, update_mcq_content | mapMcqRow (normalizeMcqOrigin) | content | no | |
| 39 | derived_from | – | bulk, update_mcq_content | mapMcqRow | content | yes | |

Not reaching the site (never copied by `mapMcqRow`): author_id, created_at, updated_at, exam, year, session, source, source_question_no, orphaned_at, orphan_reason. Fine today.

## Sheet Collections — 12 live columns
collection_id · title · normalized_title · description · exam · year · session · paper · subject · language · created_at · updated_at
- W: `ensureCollection_` (**positional** appendRow — order above must never change), delete via `deleteMcqCollection`.
- Dedup key = `normalized_title` (returns early if found → new fields need a merge step).
- Description/exam/year… editable in UI today: no (new action `update_collection_info` in this phase).

## Sheet MCQ_Passages — 6 live columns
passage_id · node_id · kind · content · created_at · updated_at
- W: `upsertRows_` (header-based, **no** text protection). R: handleGetMcqs → passages.

## NEW columns (added by `setupBilingualRowSchema`, at END of row 1)
- **MCQs (23):** alt_language, question_alt, option_a_alt … option_f_alt (6), explanation_alt, explanation_a_alt … explanation_f_alt (6), source_qid, source_page, remark, extra_link, extra_link_label
- **Collections (5):** pdf_url, answer_key_url, source_url, source_path, remark
- **MCQ_Passages (1):** content_alt
- New columns are added to: `MCQ_BANK_NEW_COLUMNS_` list pattern (setup), `MCQ_TEXT_COLUMNS_`, `MCQ_META_EDITABLE_COLUMNS` / `MCQ_CONTENT_EDITABLE_COLUMNS`, later `mapMcqRow` (Phase 4).

## Flags
1. Duplicate-ish: exam/year/session on MCQs **and** Collections; `source` vs new `remark`. Not deleting anything.
2. Existing gap: `tags`, `description`, `source`, `source_question_no` are not protected from "=…" formula bug. Phase 1 only protects NEW fields (scope rule); tell me if you want these too.
3. Plan correction: the "route block twice (~165 and ~4266)" — line ~4266 is only a **comment** (WIRING notes). Live routes: `doGet` line 71, `doPost` line 188 (update_mcq_meta at ~347). So only one place to add `update_collection_info`.
4. Existing setup pattern: `MCQ_BANK_NEW_COLUMNS_` (line ~2982) + `ensureMcqColumns_` (~3003). The new function will follow it.
