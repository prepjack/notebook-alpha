# CHECKPOINT — MCQ Hub H1 (Hub shell)

**Status:** DONE — tested by Mahender, "H1 pass" (2026-10-19).
**Commits:** `feat(mcq): MCQ Hub shell …(H1)` and `fix(mcq): keep MCQ Hub open under Add MCQs; refresh Hub on close (H1)`.

## Files changed
- `mcq.html` — two old buttons replaced by `#mcq-hub-open` (🗂️ MCQ Hub); popover div removed; `<script src="js/mcq-hub.js">` added after mcq.js (no `?v=` convention used on this page).
- `js/mcq.js` — `renderMcqPaperSourcesToolbar(shared)` now only stores `lastMcqPaperShared_` and calls `window.mcqHubRefresh?.()`; popover code + 3 listeners and `#mcq-add-open` listener removed; `setupMcqSubtopicToggle` anchors on `#mcq-hub-open`; Full paper banner gained `#mcq-open-hub-from-banner` (🗂️ Open in Hub → Info tab); `closeAddMcqModal` calls `window.mcqHubRefresh?.()`.
- `js/mcq-hub.js` — NEW.
- `css/style.css` — `.mcq-paper-sources-popover*` removed; `.mcq-hub-*` rules added (full-screen ≤900px).
- `docs/hub/00_HUB_MASTER_PLAN.md` — saved.

## Added (ids / functions)
- ids: `mcq-hub-open`, `mcq-hub-modal`, `mcq-hub-paper`, `mcq-hub-body`, `mcq-hub-close`, `mcq-hub-open-add`, `mcq-open-hub-from-banner`.
- functions: `openMcqHub({paperId, tab})`, `closeMcqHub()`, `window.mcqHubRefresh()`, `mcqHubRender_`, `mcqHubCollectPapers_`, `mcqHubPapersTabHtml_`, `mcqHubInfoTabHtml_`, `mcqHubImportTabHtml_`.
- globals: `mcqHubTab_`, `mcqHubPaperId_` (last tab/paper remembered for the page session).

## Behaviour notes
- Papers list = collections with ≥1 loaded question (old popover needed >1).
- Import tab: Hub stays open under the Add MCQs modal; closing it returns to the Hub; after "Confirm & Save All" the Hub redraws via `applyMcqPracticeFilters → renderMcqCollectionNotes → mcqHubRefresh`.
- Esc closes the top modal first (Add MCQs / Edit paper info), then the Hub.
- Removed: Paper info popover button/div/CSS/listeners, `positionMcqPaperSourcesPopover`, `#mcq-add-open`.
- Code.gs untouched. No sheet backup needed.

## Tests
All 8 manual tests + 4 fix tests: PASS ("H1 pass").

## Next
**H2 — PHASE_H2_SELECTION_EXPORT.md** (tick boxes + selection bar + Export tab). Open a NEW chat, paste that file, say "Do this phase."
