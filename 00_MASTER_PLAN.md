# MCQ one-row-per-question redesign — MASTER PLAN (Notebook Alpha)

Repo: https://github.com/prepjack/notebook-alpha  (Claude: clone fresh every session; read PROJECT_GUIDE.md first)
Owner: Mahender — does NOT code, writes Hinglish. Reply to him in simple Hinglish. He applies changes as FIND / REPLACE patches.

## Why
Today a bilingual question = TWO sheet rows (English, Hindi) tied by `question_group_id`. Result: attempts are logged per
row id, totals count rows, so a 30-question bilingual paper shows "31 / 60 attempted"; deleting one language row leaves
a half pair. Fix at the root: ONE row = ONE question, holding both languages.

## Decisions already made (do not re-open)
1. One sheet row per question. Primary language in the existing columns (`language` says which, normally English).
   Second language in new `*_alt` columns. ONE shared `correct_option`. Option ORDER IS IDENTICAL in both languages.
2. Existing single-language rows (incl. Hindi-only) stay untouched. Sets with 3+ languages keep the legacy grouped-row way.
3. Google Sheet stays the database. No per-question .md files (Drive file-per-question = one slow call each, 6-min Apps Script
   limit). One .md per paper set, produced by the AI prompt, parsed by js/mcq-parse.js into rows.
4. Paper-level facts live ONCE in the `Collections` sheet (PDF link, source website link/path, answer key, remark).
   Question-level facts live in the `MCQs` row (source Question ID, page, remark, extra link).
5. Keep source data simple: only the paper's Question ID (+ question number). NO option IDs.
6. ⓘ button = READ-ONLY, two sections (Question details / Original source). Editing stays in the pencil.
8. MISSING SOURCE INFO IS NORMAL. Every source field (source_qid, source_page, year, session, pdf_url, source_url, source_path, answer_key_url,
   remark, extra_link) is OPTIONAL at every level: parser, modal, save, ⓘ, edit. Nothing is ever blocked or auto-filled because a field is empty.
   - AI must leave a tag out if the source does not print it (no guessing a year, shift or Question ID).
   - Warnings are soft: ONE summary line per paper ("12 questions have no source Question ID"), never one per question, and only for origin = pyq.
   - Use `origin` honestly: "Original PYQ" only when Mahender is sure it is a real exam question; otherwise "Book" / "AI practice" / "Unchecked".
   - Paper-level and question-level info are independent (a paper can have a PDF link but no question IDs, and the other way round).
7. AI must NEVER invent links. Drive PDF link and website URL/path are filled by Mahender (or AI only if it really opened the page).

## Schema (built in Phase 1)
MCQs — new columns:
  alt_language, question_alt, option_a_alt … option_f_alt (6), explanation_alt, explanation_a_alt … explanation_f_alt (6),
  source_qid, source_page, remark, extra_link, extra_link_label
Collections — new columns: pdf_url, answer_key_url, source_url, source_path, remark
MCQ_Passages — new column: content_alt

## When a column is added (old or new) — everything that must be touched (use as a checklist in every phase)
1. Code.gs: setup/ensure-columns list · `MCQ_TEXT_COLUMNS_` (text protection) · `MCQ_META_EDITABLE_COLUMNS` or `MCQ_CONTENT_EDITABLE_COLUMNS` · `saveMcqsBulk` (header-based, usually automatic)
   · Collections create (`ensureCollection_` is positional!) · `handleGetMcqs` (returns all headers, automatic).
2. js/mcq-parse.js: tag → field in the output object (+ warnings). 3. js/mcq.js: `mapMcqRow` (copies fields ONE BY ONE — a new column is invisible until added there),
   preview table, edit modal, ⓘ. 4. Sheet: column format (Plain text for IDs). 5. PROJECT_GUIDE.md + COLUMN_MAP.md (created in Phase 1, Step 0).
Column order: never physically reorder live columns; use header colours / freeze / hide for a tidy view.

## Phase map (strict order; site must keep working after EVERY phase)
| # | File | Touches | Visible change |
|---|------|---------|----------------|
| 1 | PHASE_1_backend_sheet_schema.md | Code.gs only (+ sheet columns) | none |
| 2 | PHASE_2_parser.md | js/mcq-parse.js | none (parser understands new format) |
| 3 | PHASE_3_add_mcqs_modal_and_prompt.md | js/mcq.js (Add MCQs) | new fields + new AI prompt + preview |
| 4 | PHASE_4_practice_screen_one_row.md | js/mcq.js (+ check practice.js) | one-row questions work, stats correct |
| 5 | PHASE_5_info_button.md | js/mcq.js, css | ⓘ button, Paper info |
| 6 | PHASE_6_edit_side.md | js/mcq.js | pencil tabs, Edit paper info |
| 7 | PHASE_7_cleanup.md | js/mcq.js, mcq-parse.js, docs | remove legacy only if safe |

Phases 1-2 need no deletion. Old bilingual sets keep working the old way until re-imported.

## Fresh start (decided by Mahender) — replaces the old "pilot delete" idea
- BEFORE Phase 1 Mahender deletes the 3 old bilingual paper sets and the individual questions he does not understand. No pilot, no re-import of old sets.
  Remaining single-language questions stay and must keep working (Phase 4 must not break them).
- Order for Mahender: (1) Google Sheet → File → Make a copy (backup). (2) Copy ROW 1 of MCQs, Collections, MCQ_Passages + one normal sample row somewhere safe
  (the backup copy also has them). (3) Delete each of the 3 sets with the site's own button: MCQ page → open the topic → "Paper Sources" → "View full paper in order"
  → "🗑️ Delete this entire collection" → confirm. A bilingual paper is TWO collections (English + Hindi) → delete both. This also cleans the Collections row and unused passages.
  (4) Individual questions: pencil → "🗑️ Delete permanently", or delete the row directly in the sheet (fine for MCQs rows). (5) Move the old-format .md files out of the topic's
  Drive MCQ folder (the folder fetch imports EVERY .md inside). (6) Reload the site; old attempt history of deleted questions is ignored automatically.
- Phase 7 gate (no `question_group_id` rows left) will probably pass right away.

## Rules for Claude in EVERY phase (patch route)
1. Start: clone repo, `git log -3`, read PROJECT_GUIDE.md, run the "Previous phase check" in the phase file. If it fails, STOP and tell Mahender.
2. Deliver as numbered PATCHES, never whole-file rewrites (unless he asks):
   PATCH n — file: <path> — (what it does, 1 line)
   FIND (must match exactly ONCE — in VS Code Ctrl+F shows "1 of 1"):  ```text```
   REPLACE WITH: ```text```        or   ADD AFTER <exact line>: ```text```
   For Code.gs the same, using the Apps Script editor's Ctrl+H.
3. Before sending: apply all patches to your own clone, confirm each FIND matched exactly once, run `node --check <file>` on edited JS.
4. Small patches (max ~6 per message). Tell him after which patch to test. Never touch code outside the phase scope; no refactors.
5. Destructive things (delete, sheet column changes) → say clearly + remind backup first.
6. Code.gs change = Save → Deploy → Manage deployments → pencil → Version: New version → Deploy
   (NOT "New deployment", that changes the web app URL). Ctrl+S alone does not update the live site.
7. Sheet text that starts with = + - or @ can be turned into a formula (old bug). Any new text field written to the sheet must go through the same protection the existing code uses.
8. End each message with: test checklist (Hinglish), how to roll back, and "Next: Phase N".
9. CHECKPOINT FILE after every phase: when Mahender confirms the phase tests passed, write `CHECKPOINT_PHASE_<n>.md` (short): what was changed (files, functions, new columns),
   what Mahender verified, any deviation from the plan, open issues / things noticed, the exact markers the next phase's "Previous phase check" should find, and a list of
   corrections needed in the next phase file (if reality differed from the plan, also output the corrected `PHASE_<n+1>_...md`). Mahender saves it and pastes it into the next phase's chat.
   If a phase changed direction or something looks off, make the checkpoint BEFORE continuing and ask Mahender to confirm.
