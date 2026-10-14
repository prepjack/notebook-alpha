# CHECKPOINT — PHASE 6 (edit side: pencil tabs + Edit paper info)

## What was changed
Phase 6 was done in 3 steps. Base: Phase 5 commit `a9d0e02`.

**6A — `google-sheet-template/Code.gs`** (commit `a563cbb`, deployed as a NEW VERSION of the web app by Mahender)
- Router: new action `update_collection_info`, placed right after `update_mcq_content`.
- New `COLLECTION_INFO_EDITABLE_COLUMNS_` (pdf_url, answer_key_url, source_url, source_path, remark, exam, year, session, description) and `COLLECTION_INFO_URL_COLUMNS_` (pdf_url, answer_key_url, source_url).
- New `updateCollectionInfo(data)` (just above `setupBilingualRowSchema`): finds the row by `collection_id`; a field that is NOT sent stays untouched; "" CLEARS the cell; URL columns must start with http:// or https://; everything is checked BEFORE writing (no half save); text goes through `safeSheetText_`; sets `updated_at` if that column exists. `title` is deliberately NOT editable. Returns `{success, collection_id, fields_changed, fields_skipped_missing_column}`.
- Reality check: the Phase 6 plan said the backend action "already exists from Phase 1". It did not — it was created in 6A. (`update_mcq_meta` and `update_mcq_content` allow-lists from Phase 1 were fine, no change.)

**6B — `js/mcq.js`** (commit `225cd22`, no Code.gs change)
- New `setupMcqMetaTabs_(modal, mcq, startTab)`: turns the pencil modal into tabs. It MOVES the existing fields into the "Question" tab (nothing about them changed), then adds:
  - Question tab: `remark`, `extra_link`, `extra_link_label` (just above Status). Ids `mcq-edit-remark`, `mcq-edit-extra-link`, `mcq-edit-extra-link-label`.
  - Source tab: `source_qid`, `source_page`. Ids `mcq-src-qid`, `mcq-src-page`.
  - "Language 2" tab ONLY for a one-row bilingual question (non-empty `question_alt`): `alt_language`, `question_alt`, `option_a..f_alt`, `explanation_alt`, `explanation_a..f_alt`. Ids `mcq-alt-*`. "+ Add option" button; rows follow the Question tab's option count when switching.
- Tabs reuse the existing CSS classes `.content-layer-tabs` / `.content-layer-tab` (no CSS change).
- `openMcqMetaModal(mcq, options)` now takes `{startTab}`; the pencil click handler always edits the PRIMARY row of a one-row question and opens "Language 2" if the second language is on screen. The Phase 4 alert is gone.
- `saveMcqMeta`: remark/extra_link/extra_link_label/source_qid/source_page go to `update_mcq_meta` (only changed fields; empty = clear; `extra_link` must pass `mcqSafeUrl_`). Second-language fields go to `update_mcq_content`. Save is BLOCKED (nothing sent) if: Language 2 question is empty while options are filled; an empty option sits between filled ones; option count differs from the Question tab. Emptying ALL Language 2 fields removes the second language.
- Delete button, Archived option: unchanged.

**6C — `js/mcq.js`** (commit `77ff40a`, no Code.gs change)
- New `MCQ_COLLECTION_EDIT_FIELDS_` and `openMcqCollectionEditModal(collectionId, reopenInfoIndex)` (inserted just above `closeMcqInfoModal`), modal id `mcq-collection-edit-modal`, input ids `mcq-col-<column>`.
- Save: checks all links first with `mcqSafeUrl_`; sends only changed fields via POST `update_collection_info`. First tries a normal request (so a server error message can be shown); if the browser blocks reading the reply (TypeError) it repeats once with `mode: "no-cors"` (same values, harmless).
- After a successful save: `Object.assign` into the in-memory collection (`mcqApiData.collections` and `currentCollectionViewApiBackup.collections`), toolbar redrawn via `renderMcqPaperSourcesToolbar(lastMcqPaperShared_)`, ⓘ reopened if it was opened from ⓘ. No reload needed.
- "✏️ Edit paper info" button added in ⓘ (`mcqInfoHtml_`, data attribute `data-mcq-edit-collection`, handled in the `openMcqInfoModal` overlay click listener) and in each "Paper info" popover entry (`data-edit-collection-id`). New module variable `lastMcqPaperShared_` is set at the start of `renderMcqPaperSourcesToolbar`.

## What was verified
By Claude: every FIND matched exactly once; `node --check` OK; each `patch.diff` applied cleanly (`git apply --check`) on a fresh clone; node mock test of `updateCollectionInfo` (clear, `=` protection, `javascript:` blocked, unknown id error); jsdom tests of the tab helper and of the Edit paper info modal (bad link blocked, empty clears, only changed fields sent, cors fallback, server error keeps modal open, no-change sends nothing, title escaped).
By Mahender (real site): 6A deployed; 6B tests passed ("6B pass"); 6C tests passed ("6C pass"). All committed and pushed.

## Deviations from PHASE_6 file
1. Needed an extra sub-phase 6A (backend action `update_collection_info` did not exist).
2. "Edit paper info" shows in ⓘ and in Paper info whenever the paper has a row in Collections — also in All Questions view (where there is no pencil). Not limited to "where the pencil is shown".
3. Paper `title` is not editable (it identifies the paper; renaming is a separate, riskier job). Edit modal fields: exam, year, session, pdf_url, answer_key_url, source_url, source_path, remark, description.
4. Language 2 tab appears only for rows that already have a second language. A single-language question cannot get a second language through the pencil.
5. Old grouped (legacy) bilingual rows still edit one row at a time, with no Language 2 tab (as planned).
6. A bilingual paper imported the old way has TWO Collections rows; "Edit paper info" changes only the one belonging to the question on screen.

## Open issues / noticed
- "?" Field Guide `MCQ_GUIDE_POINTS` (js/mcq.js, around line 2218) is STILL not updated for the new fields (open since Phase 3). Phase 7 or a small separate patch.
- Code comment near the "Include sub-topics" toggle still says "Paper Sources" (js/mcq.js ~line 3609; harmless).
- Test collection "TEST Bilingual Demo Paper (delete me)" may still be in the sheet — Mahender decides when to delete.
- `question_group_id` still appears 6 times in js/mcq.js (legacy grouped-row code) — this is what Phase 7 must judge. Phase 7 gate: no `question_group_id` rows left in the MCQs sheet (Mahender's fresh start probably already passes this; CHECK the sheet, do not assume).
- Phase 6 added no new Code.gs allow-list entries beyond `update_collection_info`; the edit side relies on `update_mcq_meta` / `update_mcq_content` allow-lists from Phase 1.
- A failed save in the Edit paper info modal shows the server's message; a success when the reply cannot be read (no-cors fallback) cannot be confirmed by the page — the real proof is a page reload (done in Mahender's test).

## Markers for Phase 7 "Previous phase check"
- `grep -n "update_collection_info\|function updateCollectionInfo" google-sheet-template/Code.gs` → 2 hits (router + function).
- `grep -n "setupMcqMetaTabs_\|openMcqCollectionEditModal\|MCQ_COLLECTION_EDIT_FIELDS_\|lastMcqPaperShared_" js/mcq.js` → all found.
- `grep -n "Phase 6 mein" js/mcq.js` → NO hit (old alert removed).
- `git log -4` shows `77ff40a`, `225cd22`, `a563cbb` on top of `a9d0e02`.

## Corrections / notes for PHASE_7 file
- Before removing any legacy code, check the MCQs sheet for rows with a non-empty `question_group_id`. If any exist, those questions still use the old two-row way: do NOT delete that code.
- Mahender does not code: keep delivering numbered FIND / REPLACE patches or a `patch.diff` (he applies `git apply patch.diff`, deletes the diff, commits and pushes). Reply in simple Hinglish.
- Update PROJECT_GUIDE.md and COLUMN_MAP.md (Phase 1 checklist item 5) in Phase 7 for all new columns and the new `update_collection_info` action.
- Consider adding the new fields to the "?" Field Guide (`MCQ_GUIDE_POINTS`) here.
