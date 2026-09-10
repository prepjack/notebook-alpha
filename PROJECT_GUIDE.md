# Alpha Study Notebook — Project Guide

## Purpose
This is the current frozen UI prototype before Google Sheets + Apps Script integration.

## Main architecture
- `index.html` — main Study Notebook interface.
- `css/style.css` — main visual styling for the notebook, MCQ interface and the Index directory page.
- `js/app.js` — main notebook behaviour: subject/tree/index, content, resources, user additions/deletions.
- `js/index-data.js` — shared Index registry module (term building/dedup/lookup), used by both `js/app.js` and `js/index-directory.js` so the logic exists in exactly one place. See "Index registry" below.
- `mcq.html` — separate MCQ practice page.
- `js/mcq.js` — MCQ attempt/navigation/display behaviour.
- `index-directory.html` — separate, dedicated full A–Z index page (see "INDEX (right panel tab)" below).
- `js/index-directory.js` — self-contained page behaviour (own data loader, same pattern as js/mcq.js); the actual index term logic comes from js/index-data.js.
- `google-sheet-template/Code.gs` — Apps Script backend, including the new Index Registry sheets/actions (see "Index registry" below and `google-sheet-template/README.txt` section 9).
- Other HTML/JS files in the project are supporting pages/components from the current prototype.

## Current hierarchy
Subject → Course → Unit → Chapter → Topic → Subtopic → Subtopic → ...

(Previously Subject → Part → Chapter → Topic → Subtopic. A "Course" level
was inserted between Subject and the old "Part" level, and "Part" was
renamed "Unit". Chapter/Topic/Subtopic keep their names but each now sits
one level deeper. Existing data needed no restructuring — the label shown
is derived purely from a node's depth in the tree, not from any stored
field, so old nodes automatically picked up their new labels.)

The labels shown before node names are classification labels; the actual node title is shown darker.

## Main notebook panels (Alpha-Plus)
TABLE OF CONTENTS | CONTENT | REFERENCES / INDEX

- TABLE OF CONTENTS (left, was "Index"): the same hierarchical
  Subject → Course → Unit → Chapter → Topic → Subtopic tree, unchanged
  in behaviour — only the visible label changed, since "structural
  navigation tree" is what it actually is, and the word "Index" is now
  used for the alphabetical panel below.
- CONTENT (middle): author/core content, community contribution and
  My Notes layers, plus an "Add Content Link" path for linking a
  topic's content to a .md file — or a whole Drive FOLDER containing
  that .md file plus its images/animations, auto-fetched together —
  already saved in the user's own Google Drive, fetched and rendered
  live (see js/app.js, openAddContentLink / loadAndRenderMdFileContent,
  google-sheet-template/Code.gs handleGetContentFolder_, and
  google-sheet-template/README.txt section 7). The older "Upload
  Markdown" button has been removed from the UI; any topic with
  legacy explanation text saved that way still renders as before.
  The Markdown in that .md file / cell can also include mermaid
  diagrams, Chart.js charts, plain Markdown images (auto-captioned
  from the alt text, click to enlarge), and lottie animation fences —
  all handled by js/richcontent.js; see README.txt section 8 for the
  authoring syntax. A "Copy AI Prompt" button in the same modal copies
  a ready-made prompt (js/app.js CONTENT_LINK_AI_PROMPT) for turning a
  source PDF into this exact syntax, including which image/animation
  filenames to add to the Drive folder.
- RIGHT PANEL now has three tabs:
  - REFERENCES (was "Resources"): unchanged — links such as Google
    Drive/Web and YouTube, with a page/location reference.
  - MCQ (new): embeds the dedicated mcq.html page (see below) inside
    the right panel via an iframe, scoped to whichever topic is
    currently selected; "Open in new tab ↗" opens that same mcq.html
    full-page instead. No MCQ logic is duplicated — js/mcq.js still
    owns all of it.
  - INDEX: a book-style A–Z index with a search box and suggestions,
    still rendered in-panel exactly as before. Every entry (a node's
    own title, or an optional "Also known as" alias saved via
    content_type "index_terms") resolves back to the SAME node id the
    Table of Contents already uses — clicking an entry calls the same
    selectNodeById() function that expands/highlights the Table of
    Contents and loads the topic into CONTENT. There is only one
    place topic content lives; the Index is an alternate way to find
    it, not a second copy of it. Its "Open in new tab ↗" button opens
    index-directory.html — a separate, dedicated two-panel page: a
    collapsible/draggable left panel (search box, plus reserved space
    for future index tools) and a right panel showing every index
    entry across the whole notebook at once, laid out in up to 3
    scrollable CSS columns with no rule between them. Clicking a term
    there navigates back to index.html?openNode=<id>, which opens (or
    focuses) the main notebook at that exact topic.

## Resource rule
Do not ask the user to upload a PDF. Users add a Google Drive/Web link or YouTube link. A `page_ref` field records the relevant PDF page/range or video timestamp.

## Index registry (index_id, separate from node_id)
The Index is now backed by a canonical term registry, not just a
live derivation from the tree — see the redesign spec "Alpha
Website — Redesign and Strengthen the Index System" for the full
rationale. Summary:

- `node_id` = where something lives in the syllabus tree.
  `index_id` = which concept/term it's associated with. These stay
  separate on purpose — a term does not have to be a tree node
  (e.g. a person's name mentioned inside a topic's content), and one
  term can legitimately belong to several different tree nodes
  (many-to-many).
- `js/index-data.js` (`getIndexRegistry()` / `filterIndexRegistry()`)
  is the single place this is built, shared by `js/app.js` and
  `js/index-directory.js`. It prefers a canonical server registry
  (`data.indexTerms` + `data.indexLinks`, from the Apps Script
  `Index_Terms` / `Index_Node` sheets) when present, and transparently
  falls back to deriving entries straight from the tree + `index_terms`
  aliases (the original behaviour) when it isn't — so nothing breaks
  for a site that hasn't run the migration yet.
- Dedup key is `normalizeTerm()` (trim + collapse whitespace +
  lowercase), not a raw string compare, so "DDC" / "ddc" / " DDC "
  resolve to one entry.
- IDs (`index_id` / `node_id`) are never shown in the UI — only the
  term text and node titles are.
- Turning the server registry on, and future MCQ/tag/resource
  compatibility, is documented in `google-sheet-template/README.txt`
  section 9 and in the comments at the top of
  `google-sheet-template/Code.gs`. Content-derived term suggestion
  (parsing Markdown for candidate terms) and a manual add/merge UI are
  intentionally NOT built yet — the data model (`save_index_term` /
  `link_index_term` actions) is ready for them, per the spec's phased
  approach.

## MCQ interface
The MCQ page has:
- large question/options area on the left;
- collapsible question navigator on the right;
- right navigator collapse gives its freed space to the question area;
- unattempted questions are white;
- attempted/marked questions are green;
- bluish theme distinct from the main notebook;
- A− / A+ text-size controls;
- English/Hindi selector is currently a UI placeholder; actual translation is intentionally deferred.

## Important product direction
The author publishes the initial/core structure and content. Users can extend the structure, maintain My Notes, add resources, and contribute content. The user is the actual builder of their personalized notebook while the author/community layer keeps shared content organized.

## Next phase
Freeze this UI baseline. Next implement:
Google Sheets → Apps Script → JSON/API → Alpha website.

Do not redesign the UI unless explicitly requested. Preserve the current hierarchy and resource/MCQ behaviour while connecting live data.

## Canonical node labels
`Subject → Course → Unit → Chapter → Topic → Subtopic → Subtopic → …`. The visible classification label is derived from the node's depth in the tree (see `getNodeLevelLabel` in `js/app.js`), not from its stored `type` field. Subject, Course, Unit, Chapter and Topic must never be displayed as Subtopic.

## Index Terms — manual-only marking ({{}} is a suggestion marker) + subtopic-scoped tab
Builds on the existing "Index_Terms" / "Index_Node" registry above — this is
the SAME two-sheet schema, not a new one. Manual right-click marking is the
ONLY way a term gets INTO that registry (an earlier {{}}-auto-detection path
was removed — see "Important product direction" below), plus a second UI
lens onto it:

- **{{}} is a visual suggestion only, NOT indexing**: authors can still wrap
  glossary-worthy terms in double curly braces in the .md source (see
  `CONTENT_LINK_AI_PROMPT` in `js/app.js` — INDEX TERM MARKING section) to
  flag candidates for a human editor. `js/richcontent.js`'s
  `extractIndexTerms()` turns the FIRST occurrence per rendered
  depth/language block into a `<span class="rc-index-suggestion">` (a
  dotted underline, non-linking); repeats fall back to plain **bold**.
  This never touches the registry — no sync, no `source_type`, nothing
  saved server-side. It exists purely so a human knows what's worth
  marking next.
- **Manual (right-click) is the only real indexing action**: selecting
  text inside the content panel and choosing "Mark as index term" (custom
  context menu, `js/app.js`) wraps it in `<span class="rc-index-term
  manual">` and syncs it to the registry with `source_type = "manual"`.
  This is synced via POST action **`sync_index_term`**
  (`{term, node_id, source_type}`) — it does find-or-create AND link
  server-side in one call, because POST responses on this public webapp are
  sent with `mode:"no-cors"` and are never actually readable client-side
  (same constraint as every other write in `Code.gs`). "Unmark" calls
  **`unlink_index_term`** (`{term, node_id}`), which removes only that one
  (term, node) link — the term itself, and any of its other node links,
  are left alone. Because the response is opaque, both mark and unmark
  now follow up with a verifying GET (`get_index_terms_for_node`) with one
  retry, rolling back the optimistic DOM/state change and alerting the
  user if the write didn't actually take effect — the old silent-failure
  gap is closed. A manually-marked term also gets re-wrapped from registry
  data on every render (topic switch, language/depth switch, reload), so
  the highlight survives even though the raw markdown carries no marker for
  it. There is no longer a manual-vs-auto distinction shown anywhere in the
  UI (Index Directory badges were removed) since everything indexed is
  manual by definition.
- The Index tab (right panel) now has TWO views: **"This Topic"** (default)
  — only terms linked to the currently open subtopic, fetched via the new
  GET action **`get_index_terms_for_node`** — and **"Full A-Z Glossary"**,
  the original global view (`renderIndexAZList()`, unchanged). Both read the
  same registry; switching scope never re-fetches from a different source.
- Public-write abuse guard: `checkIndexWriteRateLimit_()` in `Code.gs` is a
  simple GLOBAL rate limit (20 writes/60s across all visitors, via
  `CacheService`) applied to `sync_index_term` / `unlink_index_term` only.
  Flagging as a known gap: no OTHER public write action in `Code.gs`
  (`save_core`, `save_resource`, `save_structure`, etc.) has any throttling
  today either — the same helper can be reused there if that becomes a
  real concern.

## Data lifecycle: how things get added & deleted (2026-09-10)

MAINTENANCE NOTE: this section is meant to be a living reference — any
time a new add/edit/delete action is built for Nodes, Content_Core,
Resources, MCQs, or Index_Terms/Index_Node, add a row to the relevant
table below in the same style. Whoever (human or AI) implements a new
lifecycle action should update this section as part of that change,
not as a separate follow-up.

### Addition

Every row in every sheet is created through a **website action**
(an Apps Script `doPost`/`doGet` call) — there is no mechanism that
watches Google Drive and auto-creates a Sheet row when a file/folder
appears there. Dropping a `.md` file into a topic's Drive folder by
itself does **not** register anything; a website action (pasting the
link, clicking Save) is always the trigger. Drive is where some
content's underlying text *lives*, not how it gets *registered*.

| Entity | Trigger (website action) | What gets created |
|---|---|---|
| Tree/Topic | "Add topic/subtopic" | `Nodes` row + a new per-topic Drive folder |
| Content | Content editor Save / "Add Content Link" (paste a Drive `.md` link) | `Content_Core` row (one per content_type: definition/explanation/example/key_points/diagram/md_file) |
| Reference (Resource) | "Add resource" popup | `Resources` row |
| MCQ | "Add MCQ" popup, or bulk-import from pasted Markdown | `MCQs` row(s) |
| Index Term | Right-click "Mark as index term" | `Index_Terms` row (if new term) + `Index_Node` link row |

### Deletion

Unlike addition, deletion genuinely CAN happen two ways: through the
website, or by deleting a file/folder directly in Google Drive. The
second path bypasses every `doPost` action, so it can only ever be
caught after the fact — a daily scheduled scan (`driveHealthCheck`,
~3 AM) is what notices a missing Drive folder and flags everything
that depended on it.

Most deletions are **soft** (an `orphaned_at` timestamp + a matching
`orphan_reason` label get stamped on the row — the row itself is
never removed). Only a few explicit, single-item "delete this one
thing" actions are **hard** (the row is actually removed). Content_Core
and Index_Terms rows also **self-heal**: if real content/a real link
is saved into a flagged row again later, its flag clears automatically.

| # | Entity | Trigger | Result | `orphan_reason` | Shows up in |
|---|---|---|---|---|---|
| 1 | Tree/Topic | Website "Delete topic" button | **Hard delete** — `Nodes` row removed + Drive folder trashed | — | nowhere (gone) |
| 2 | Tree/Topic | Drive folder deleted directly | Soft flag — `Nodes` row stays | `drive_missing` | `Nodes` |
| 3 | Content | "Remove all content" button (topic not deleted) | Soft flag — row stays, content cleared | `content_removed` | `Content_Core` |
| 4 | Content | Whole topic deleted (#1) | Soft flag (cascade) | `topic_deleted` | `Content_Core` |
| 5 | Content | Drive folder missing (#2) | Soft flag (cascade) | `drive_missing` | `Content_Core` |
| 6 | Reference (Resource) | Individual delete button | **Hard delete** | — | nowhere (gone) |
| 7 | Reference (Resource) | Whole topic deleted | Soft flag (cascade) | `topic_deleted` | `Resources` |
| 8 | Reference (Resource) | Drive folder missing | Soft flag (cascade) | `drive_missing` | `Resources` |
| 9 | MCQ | Individual delete button | **Hard delete** | — | nowhere (gone) |
| 10 | MCQ | Whole topic deleted | Soft flag (cascade) | `topic_deleted` | `MCQs` |
| 11 | MCQ | Drive folder missing | Soft flag (cascade) | `drive_missing` | `MCQs` |
| 12 | Index Term | Single "Unmark" (term ends up 0-linked) | Soft flag — `Index_Node` link removed, `Index_Terms` row stays | `unmarked` | `Index_Terms` |
| 13 | Index Term | "Remove all content" | Soft flag (same mechanism) | `content_removed` | `Index_Terms` |
| 14 | Index Term | Whole topic deleted | Soft flag (cascade) | `topic_deleted` | `Index_Terms` |
| 15 | Index Term | Drive folder missing | Soft flag (cascade) | `drive_missing` | `Index_Terms` |
| 16 | Index Term | Index Directory explicit "×" delete | **Hard delete** — row + all its links removed | — | nowhere (gone) |
| 17 | Any of the above | `backfillAllOrphans` (manual, one-time catch-up for pre-existing orphans) | Soft flag | `backfill_detected` | wherever found |

Relevant `Code.gs` functions: `getOrAddColumn_`, `flagOrphanedRows_`,
`removeIndexLinksAndFlagOrphans_` (shared soft-delete primitives),
`deleteStructureNodeRow` (#1, cascades #4/#7/#10/#14), `driveHealthCheck`
(#2, cascades #5/#8/#11/#15 — installed as a daily trigger via
`installDriveHealthCheckTrigger`), `flagContentRemoved` (#3),
`unlinkIndexTermByTerm_` (#12), `deleteIndexTermCascade_` (#16),
`backfillAllOrphans` (#17, run once after deploying this system and
any time you suspect something predates it).
