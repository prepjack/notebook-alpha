# CHECKPOINT — MCQ Hub H4 (Review mode + AI paste-back)

**Status:** DONE — tested by Mahender, "H4 pass" (2026-10-20).
**Commit:** `feat(mcq): Hub Review mode and AI paste-back with before/after preview (H4)`
**Code.gs:** NOT changed (reuses H3 `update_mcq_content_bulk`).

## Files changed
- `js/mcq-review.js` — NEW. Part 1 pure functions (node-tested), Part 2 UI. Loaded after mcq-correct.js, before mcq-hub.js.
- `js/mcq.js` — NEW const `MCQ_EXPLANATION_FORMAT_RULE_` (the ONE copy of the explanation-style rule; the Add MCQs prompt now uses it); `mcqUpdateSelectionUi_` also calls `window.mcqReviewOnSelectionChange_?.()`.
- `js/mcq-hub.js` — Correct tab now renders `mcqCorrectShellHtml_()` / `mcqCorrectShellBind_(body)` (sub-views Answer key · Review · AI correction).
- `js/mcq-correct.js` — `mcqCorrectConfirmDiscard_` also counts/discards Review drafts (one combined confirm); "Select these N for review" button is now "Review these N →" and opens Review.
- `js/mcq-export.js` — `🤖 AI correction` shortcut button (`#mcq-exp-to-ai`).
- `mcq.html` — `<script src="js/mcq-review.js">`. `css/style.css` — `.mcq-sub-*`, `.mcq-rv-*`, `.mcq-ai-*`.
- `docs/hub/test-review.js` — node test (`node docs/hub/test-review.js` → ALL TESTS PASSED).

## Pure functions (node-exported)
- `buildMcqCorrectionPrompt(rows, {verify, rewrite, typos, translation, extra, passages, paperTitle, explanationRules})` — uses `buildMcqExport` (lang both, A–F, current answer + explanation, passages). Throws if no task ticked, no rows, or explanation rules missing. Explanation rules come from global `MCQ_EXPLANATION_FORMAT_RULE_` (mcq.js).
- `parseMcqCorrectionReply(text, rowsByQuestionNo)` → `{items:[{qno,id,field,name,before,after}], ignored:[{qno,field,reason,text}], questions, fields}`. `field` is the Sheet column (`correct_option` for `correct`; numbers 1–6).
- Draft helpers: `mcqRvSetDraft_`, `mcqRvBuildUpdates_`, `mcqRvValidate_`, `mcqRvPrune_`, `mcqRvAllowedFields_`, `mcqRvSerialize_/Deserialize_`, `mcqRvDraftCount_`, `mcqRvOriginal_`, `mcqRvIsChanged_`, `mcqRvFieldLabel_`.

## Parser rules (manual test 6)
- Block starts at a line that is only `Q7` / `## Q7` / `### Q7` / `**Q7**` (Devanagari digits ok). Whole-line ``` fences are dropped.
- A value runs until the next known `field:` line or next block. Blank lines inside a value are kept; trailing `---` dropped.
- `correct:` is a field only when ONE character follows (B, 2, Z). Longer `correct: ...` text inside a multi-line value is prose.
- Unknown `name:` line: ends single-line fields (correct/option_*) and is ignored; inside question/explanation it stays prose unless the name has `_` or starts with option/question/explanation/answer/correct/why.
- Ignored (never applied): unknown/disallowed field, `option_e/f` beyond real option count, `*_alt` when no second language, unknown Q number, bad answer token, empty value, same-as-current, repeated field (last wins), text before first `##`. `origin`, `derived_from`, `mcq_id` can never come in.

## Review behaviour
- Scope: selected / whole paper / AI-changed; questions with drafts always stay visible. Order by `question_no`.
- Drafts hold only changed fields; saved through `mcqBulkSaveAndVerify`; empty question/option text blocks Save (options cannot be removed); Language 2 options may be emptied.
- Backup `sessionStorage` `alpha_mcq_review_<paperId>` (debounced, flushed on pagehide); cleared after clean save. Guard on Hub close / paper switch.
- Preview toggle uses `mcqFeedbackBodyHtml` (KaTeX via renderRichInline) when explanation contains `$…$`.
- AI Apply overwrites an existing draft for the same field without asking. Nothing is saved from the paste-back screen.
- Prompt: >25 questions shows a "smaller batches" warning. Extra instructions + task ticks remembered in localStorage (`alpha_mcq_ai_extra`, `alpha_mcq_ai_opts`).

## Tests
node: test-review / test-correct / test-export all pass; jsdom smoke (edit, restore, save, undo, AI apply) passed. Manual tests 1–7: PASS ("H4 pass").

## Next
**H5** — needs-check flag (`needs_check` column) + review queue; needs Code.gs change, so back up the Sheet first. Open a NEW chat, paste the H5 phase file, say "Do this phase."
