# MCQ Hub — phase list and checkpoints

**Status: COMPLETE (H1–H5), 2026-10-21.** Start here, then read `00_HUB_MASTER_PLAN.md` (design) and `CHECKPOINT_HUB_FINAL.md` (full summary).

| Phase | What | Checkpoint | Code.gs | Result |
|-------|------|-----------|---------|--------|
| H1 | Hub shell: one `🗂️ MCQ Hub` button, tabs Papers · Info · Import | [CHECKPOINT_HUB_H1.md](CHECKPOINT_HUB_H1.md) | no | "H1 pass" |
| H2 | Tick-box selection + Export (copy, print/PDF, .md, .csv) | [CHECKPOINT_HUB_H2.md](CHECKPOINT_HUB_H2.md) | no | "H2 pass" |
| H3 | Correct tab: answer-key grid, paste key, `update_mcq_content_bulk`, verify, undo | [CHECKPOINT_HUB_H3.md](CHECKPOINT_HUB_H3.md) | yes | "H3 pass" |
| H4 | Review mode + AI paste-back with before/after preview | [CHECKPOINT_HUB_H4.md](CHECKPOINT_HUB_H4.md) | no | "H4 pass" |
| H5 | `needs_check` flag + Needs-check list, owner switch, cleanup, docs, `auditMcqNeedsCheck()` | [CHECKPOINT_HUB_H5.md](CHECKPOINT_HUB_H5.md) | yes | awaiting Mahender's manual tests |
| — | Everything in one place | [CHECKPOINT_HUB_FINAL.md](CHECKPOINT_HUB_FINAL.md) | | |

Other files here: `00_HUB_MASTER_PLAN.md`, `CODE_GS_H5_BLOCKS.md` (the H5 Code.gs FIND→REPLACE blocks), node tests `test-export.js`, `test-correct.js`, `test-review.js`, `test-needs-check.js` (run each with `node docs/hub/<file>`).

Golden rule: the `.md` is used only for the FIRST import of a paper. After that the Google Sheet is the truth — correct on the site (Hub) or in the Sheet, never by re-running Fetch and Save.
