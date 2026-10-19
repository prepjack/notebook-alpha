# MCQ HUB — MASTER PLAN (Notebook Alpha)
Keep this file in the repo as `docs/hub/00_HUB_MASTER_PLAN.md`. Each phase file below is self-contained: paste ONE phase file into a NEW chat (with the repo cloned by Claude) and that chat can do that phase without any other context.

## Goal
Replace `➕ Add MCQs` + `📄 Paper info` with one **🗂️ MCQ Hub** — the workplace for: seeing papers and their info, importing a paper, ticking questions, exporting (copy / PDF / file), correcting answers in bulk, reviewing/editing chosen questions, pasting back AI-corrected text, and flagging questions that need checking. Everything corrected on the website is written straight to the Google Sheet (the source of truth).

## How data flows (so nothing is confused)
- First import only: `.md` (Drive) → Fetch and Save → Sheet. Never used again for corrections.
- Website ← Sheet: read LIVE every time a paper opens (no cache). Typing in the Sheet by hand also works; reload shows it.
- Website → Sheet: new bulk action `update_mcq_content_bulk` (H3). Because POSTs are `no-cors`, the site re-reads the paper after saving to prove it landed.

## Hub layout
Top bar: `🗂️ MCQ Hub` (+ existing "Include sub-topics" checkbox beside it).  Hub panel: header (title, selected-count chip, ×) → paper selector → tabs:
| Tab | Content | Phase |
|---|---|---|
| Papers | papers in this topic (title, question count, origin, needs-check count) → View in order / Info | H1 (+counts H5) |
| Info | paper links (PDF, source, answer key), path, remark; ✏️ Edit paper info | H1 |
| Import | launcher to the existing Add MCQs modal | H1 |
| Export | copy / print-PDF / .md / .csv with options | H2 |
| Correct | Answer-key grid + paste key (H3); Review mode (H4); AI prompt + paste-back (H4); needs-check queue (H5) | H3–H5 |
Also: tick box on each question card (H2); "Open in Hub" button in the Full paper banner (H1).

## Phases (do in this order; checkpoint after each)
| # | File | What | Backend change? | Sheet backup? |
|---|---|---|---|---|
| H1 | PHASE_H1_HUB_SHELL.md | One button + Hub shell: Papers, Info, Import(launcher); retire old popover button | No | No |
| H2 | PHASE_H2_SELECTION_EXPORT.md | Tick boxes + selection bar + Export tab | No | No |
| H3 | PHASE_H3_CORRECT_ANSWER_KEY.md | `update_mcq_content_bulk` + Answer-key grid + paste key + verify + undo | YES (Code.gs) | YES |
| H4 | PHASE_H4_REVIEW_AND_AI_PASTEBACK.md | Review mode (answer+explanation+text) + AI prompt + paste-back preview | No (reuses H3) | No |
| H5 | PHASE_H5_NEEDS_CHECK_POLISH.md | `needs_check` column, flag, queue, counts, docs, cleanup | YES (column + allow-list) | YES |

## Definition of done (whole project)
- Old two buttons gone; nothing they did is lost (links, View full paper, Edit paper info, Add MCQs flow all reachable from Hub).
- Mahender can: tick Q3, Q7, Q12 → export them (copy/PDF); paste an answer key `1-A 2-C …` → preview diff → Save → site re-reads and confirms; open Review mode on chosen questions → edit explanation/options in both languages → Save all; paste AI-corrected text → preview → apply to review drafts → Save.
- No regression: attempts, timer, navigator, ⓘ, pencil, language toggle, Include sub-topics, Full paper view, Delete collection.
- PROJECT_GUIDE.md, COLUMN_MAP.md and the in-app Field Guide updated; final checkpoint written.

## Later ideas (NOT in scope now)
Embedding the full Add MCQs form inside the Import tab; secret-token check in `doPost`; Anki/flashcard export; per-question accuracy stats; "Report error" button for visitors; change log in EventLog.
