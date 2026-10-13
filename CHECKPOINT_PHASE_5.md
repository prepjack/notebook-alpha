# CHECKPOINT — PHASE 5 (ⓘ info button, read-only + Paper info)

## What was changed
- Delivered as `patch.diff` (applied with `git apply`, then committed and pushed by Mahender; diff file deleted). Base: Phase 4 commit `d0b3a57`.
- Files: `js/mcq.js` (+126 / −1), `css/style.css` (+27, appended at end), `mcq.html` (button label). No Code.gs change, no sheet change, no new columns.
- New in `js/mcq.js` (inserted just above `mapMcqRow`):
  - `MCQ_ORIGIN_CHIP_LABELS` (pyq "Original PYQ", old "Unchecked", book "Book", ai "AI practice")
  - `mcqSafeUrl_(v)` — returns the link only if it starts with http:// or https://
  - `mcqInfoLinkHtml_(url, text)` — `<a target="_blank" rel="noopener noreferrer">`, empty string if URL unsafe/empty
  - `mcqOriginChipHtml_(q, index)`, `mcqInfoButtonHtml_(index)` — both carry `data-mcq-info="<slot index>"`
  - `mcqInfoRowHtml_(label, html)` — draws nothing for an empty value
  - `mcqInfoHtml_(q)` — builds the two sections from the slot + `getMcqCollectionInfo(...)` (no new network call)
  - `openMcqInfoModal(index)` / `closeMcqInfoModal()` — overlay `#mcq-info-overlay`, closes on outside click, × and Esc
  - ONE delegated document click listener for every `[data-mcq-info]`, plus one Esc keydown listener
- Question header: single view → `.mcq-head-tools` = origin chip + ⓘ + existing pencil; All Questions view → chip + ⓘ (no pencil exists there).
- `renderMcqPaperSourcesToolbar`: each popup entry = paper title + "Open original PDF" / "Open source website" / "Answer key" (only when link is http(s)) + "View full paper in order".
- `mcq.html`: toolbar button text "📄 Paper Sources" → "📄 Paper info" (element id `mcq-paper-sources-btn` unchanged).
- CSS classes: `.mcq-head-tools .mcq-info-btn .mcq-origin-chip(.pyq/.old/.book/.ai) .mcq-info-overlay .mcq-info-panel .mcq-info-close .mcq-info-heading .mcq-info-row .mcq-info-label .mcq-info-value .mcq-info-buttons .mcq-info-link .mcq-info-empty`.

## What was verified
By Claude: all patches matched exactly once; `node --check` OK; `patch.diff` applied cleanly on a fresh clone; node unit test of `mcqInfoHtml_` — empty fields hidden, `javascript:` URL dropped, `<b>` in a title escaped, empty source → single "Source details not recorded…" line, AI "Based on" shows source question text.
By Mahender (real site): Phase 5 tests done and checked, committed and pushed.

## Deviations from PHASE_5 file
1. Chip + ⓘ sit on the RIGHT of the header (with the pencil), not next to the language pills (mobile wrapping).
2. ⓘ + chip also added in All Questions view (no pencil there).
3. Chip labels differ from filter labels: Real PYQ → "Original PYQ", Old bank → "Unchecked". Filter row labels unchanged. `mcqOriginBadgeHtml` banner unchanged, so AI/Book questions show both banner and chip.
4. AI "Based on" is plain text (excerpt of the source question, or "A real exam question" if it is not loaded), not a clickable link.
5. "Paper info" button still appears only when a paper has 2+ questions in the topic (old behaviour kept). A single-question paper is reachable only through ⓘ.
6. Question number row shows whenever `question_no` is non-empty, even for old rows without a collection.

## Open issues / noticed
- "?" Field Guide (MCQ_GUIDE_POINTS) still not updated for the new fields (since Phase 3).
- Test collection "TEST Bilingual Demo Paper (delete me)" may still be in the sheet — Mahender decides when to delete.
- Pencil in the second-language view still opens the FIRST language with an alert (Phase 4 safety) — Phase 6 should replace this.
- Comment at the old "Paper Sources" wording remains in a code comment near the "Include sub-topics" toggle (harmless).

## Markers for Phase 6 "Previous phase check"
`grep -n "openMcqInfoModal\|mcqInfoHtml_\|mcqSafeUrl_\|mcq-head-tools" js/mcq.js` → all found.
`grep -n "Paper info" mcq.html` → 1 hit. `git log -3` shows the Phase 5 commit on top of `d0b3a57`.

## Corrections / notes for PHASE_6 file
- Reuse `mcqSafeUrl_` for validating `extra_link`, `pdf_url`, `source_url`, `answer_key_url` in the edit forms.
- Per-question fields to edit in the pencil: `source_qid`, `source_page`, `remark`, `extra_link`, `extra_link_label`; second-language text (`question_alt`, `option_*_alt`, `explanation*_alt`, `alt_language`). Remove the Phase 4 alert in `#mcq-edit-meta` handler once the second language is editable.
- "Edit paper info" writes Collections columns `pdf_url`, `answer_key_url`, `source_url`, `source_path`, `remark` (+ `exam`, `year`, `session`, `title` already read by ⓘ). Check Code.gs for an existing collection-update action and the `MCQ_*_EDITABLE_COLUMNS` lists before assuming it exists.
- After saving, ⓘ must refresh from `mcqApiData.collections` / `allLoadedMcqs` (ⓘ reads them live at open time, nothing cached).
- Every field optional in edit as well; empty value must clear the cell, never block save.
