# CHECKPOINT — PHASE 2 (Parser: one block = one bilingual question)

## What was changed
- File: `js/mcq-parse.js` only (+113 / −6 lines). Delivered as `patch.diff` (applied with `git apply`). No change to mcq.js, practice.js, Code.gs.
- `parseMcqMarkdown(text)` now understands a bilingual block:
  - A block with `@alt_question` (or, for assertion_reason, `@alt_assertion` / `@alt_reason`) = ONE mcq, ONE id.
  - mcq_id stays in the normal legacy format (no `_language` suffix), `question_group_id` = "".
  - Bilingual blocks are excluded from `@group` pairing (`_bilingual` internal flag, removed in post-pass).
- New tags parsed: `@alt_language`, `@alt_question`, `@alt_options`, `@alt_explanation`, `@alt_why_1..6`, `@source_qid`, `@source_page`, `@alt_passage_text`, `@source_path`.
- New output fields on mcq (bilingual block): `alt_language`, `question_alt`, `option_a_alt..option_f_alt`, `explanation_alt`, `explanation_a_alt..explanation_f_alt`, `source_qid`, `source_page` (all always present, "" if tag missing).
- Passage object: `content_alt` (only when `@alt_passage_text` given).
- Collection object: `source_path` (always present, "" if not given; first non-empty wins).
- Result object now also has top-level `warnings: []` (paper-level summary lines).
- New helper: `lastFilled_(list)`.
- @group / old format code is untouched.

## Warnings added (all soft)
Per mcq `warnings[]`:
- `@alt_question without @alt_options`
- `@alt_options without @alt_question — second language ignored`
- `IMPORTANT: @alt_options has N options but @options has M ...` (count mismatch)
- `@alt_question present but @alt_language missing — defaulted to Hindi`
- assertion_reason alt: `missing @alt_assertion` / `missing @alt_reason`
Top-level `result.warnings[]` (one line per paper, pyq only):
- `<collection title>: N questions have no source Question ID`

## What was verified
By Claude (node): demo sample -> 1 mcq, 0 warnings; remove @alt_options -> warning; 3 alt options -> mismatch warning; no @alt_language -> Hindi + warning; 2 pyq without @source_qid -> ONE summary line; old two-block `@group` sample -> still 2 rows with same question_group_id; full old-format output identical to the old parser (apart from new optional fields). `node --check` OK; patch applied cleanly on a fresh clone.
By Mahender: applied `patch.diff` and said he committed + pushed. (Site test "MCQ page + one old attempt" — Mahender to confirm.)

## Deviations / choices made (not in plan text)
1. Non-bilingual blocks only get `source_qid` / `source_page` when given (so old .md re-imports never blank saved values). Bilingual blocks always carry them.
2. assertion_reason alt text uses the SAME English labels `**Assertion (A):**` / `**Reason (R):**` as the primary (mirrors how primary is built).
3. For assertion_reason with no `@alt_options`, there is no Hindi default option list — warning only.
4. `@alt_options` without `@alt_question` -> alt side ignored entirely (not stored), warning only.
5. `pdf_url`, `source_url`, `answer_key_url`, `remark`, `extra_link`, `extra_link_label` are NOT parsed (modal adds them in Phase 3). Collection objects do not contain those keys at all.
6. The pyq-without-source_qid summary counts ALL pyq questions (also single-language ones).

## Open issues / noticed
- `phase1_batch1.diff` is still in the repo root on GitHub (old file). Safe to delete via commit + push.
- Header comment at top of mcq-parse.js still says "PHASE 2 of 7" from an older numbering — harmless.
- Duplicate `question_no` inside one collection gives the same mcq_id (same as old behaviour, not guarded).

## Markers for Phase 3 "Previous phase check"
`grep -n "alt_question\|paperWarnings\|source_path\|content_alt\|lastFilled_" js/mcq-parse.js` -> should find all five.
`git log -3` should show the Phase 2 commit on top of `0f0f2d3`.

## Corrections for PHASE_3 file
- Preview must also show the top-level `result.warnings[]` (paper summary), not only per-mcq `warnings`.
- Save step must pass `source_path` for the collection and `content_alt` for passages; modal adds `pdf_url`, `source_url`, `answer_key_url`, `remark` (collection-level) itself.
- mcq objects from a bilingual block already contain all `*_alt` fields + `source_qid`/`source_page`; non-bilingual objects may NOT have these keys (use `|| ""`).
