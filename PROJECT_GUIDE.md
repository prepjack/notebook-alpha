# Alpha Study Notebook — Project Guide

## Purpose
This is the current frozen UI prototype before Google Sheets + Apps Script integration.

## Main architecture
- `index.html` — main Study Notebook interface.
- `css/style.css` — main visual styling for the notebook, MCQ interface and the Index directory page.
- `js/app.js` — main notebook behaviour: subject/tree/index, content, resources, user additions/deletions.
- `js/reading-tools.js` — reading UI helpers on the CONTENT panel: "Read time" button, reading-progress bar, and the Start Read / End Read timer with the post-read strip (Take Test / Revise / Flashcard / Read Again). Flashcard is real (opens `js/flashcards.js`); Revise is real too (opens `practice.html?view=due&topic=<id>` in a new tab via `openPracticePage()`; its label is "Open practice in new tab ↗"); only Take Test is still an inert stub (`handlePostReadStub`).
- `js/flashcards.js` — per-topic bilingual flashcards with a fixed 5-box Leitner schedule (see "Learning aids: prompts, companion files & flashcards" below). Also parses the flashcard deck format and registers with progress sync.
- `practice.html` + `js/practice.js` — the Practice page (two panels: menu + detail): Progress (Tree view / Due view), Flashcards, MCQs (see "Practice page" below). Uses the same `css/style.css`, header and footer pattern as the Index page. `revision.html` is now only a forwarding page to `practice.html?view=due`.
- `js/progress-sync.js` — learner-progress sync across the owner's devices plus manual Export/Import backup (see "Progress sync & backup" below). Load order in `index.html`: `app.js` → `progress-sync.js` → `flashcards.js`.
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
- a real language filter/dropdown (`js/mcq.js` `MCQ_LANGUAGES` — English
  + all 22 Eighth Schedule languages), populated from whatever
  `@language` values actually exist in the loaded topic's MCQs — this
  supersedes an earlier placeholder note in this file; translation
  itself is authored per question via `@language`, not machine-translated.

### Language-linking (question pairs shown as one question with a toggle)
When the same question is authored in 2+ languages (e.g. via the "How
many languages?" multi-language AI-prompt flow in the Add MCQ popup),
each language's question can carry a matching `@group: <id>` tag
(`js/mcq-parse.js`) so they resolve to one shared `question_group_id`.
The practice page (`js/mcq.js` `buildMcqSlots` / `activateSlotLanguage`)
groups such rows into a single "slot" shown as ONE question with a
small language-toggle pill row above it, instead of as separate
questions — switching the pill swaps the displayed question/options/
explanation in place without losing the answer already selected
(tracked by slot position, not by row id). A question with no `@group`
match, or only one language, behaves exactly as before (its own single
slot, no toggle shown). This is additive/backward-compatible: existing
single-language MCQs keep their original `mcq_id`; only a real 2+-member
group gets a language-suffixed id (see the file header comment in
`js/mcq-parse.js` for the exact resolution rules and the
"MULTI-LANGUAGE INSTRUCTION" section of `buildMcqAiPrompt` in
`js/mcq.js` for how the AI prompt asks for matching `@group` values).

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
  language block into a `<span class="rc-index-suggestion">` (a
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
  data on every render (topic switch, language switch, reload), so
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
  simple GLOBAL rate limit (40 writes/60s across all visitors, via
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
| Flashcard deck (companion file) | Saved BY HAND as `flashcards.md` (AI output of the Flashcard prompt) in the topic's Drive folder — no website action registers it | Nothing in Sheets. Read live by `get_markdown` folder mode (`companions.flashcards`) |
| Learner progress | Reviewing a flashcard (automatic), "Sync now", or Import backup | A `localStorage` entry on the device; after sync also an entry in `notebook-alpha-progress.json` in the owner's My Drive |

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

### Flashcards & progress (added 2026-09-20)

- **Flashcard deck / `flashcards.md`**: lives in the topic's Drive folder, so it follows the folder. "Delete topic" (#1) trashes the folder and the file with it; a Drive-side folder deletion (#2) takes it too. "Remove all content" (#3) only clears the Sheet row, so the Drive files (including `flashcards.md`) stay, same as the main `.md`.
- **Progress entries are never cleaned up** when a topic or a card is deleted: entries for cards that no longer exist just sit in `localStorage` and in `notebook-alpha-progress.json`, harmless but unused. There are no tombstones, so a deletion is not synced either. Known gap, fine for now.

## Learning aids: AI prompts, companion files & flashcards (2026-09-20)

Goal of this whole area: fix the "content dead-end / low retention" problem (read a topic, then nothing brings you back to it) with zero-cost tooling — no live AI API, no server-side user data beyond the single-owner progress file. AI does the *authoring* offline through copy-paste prompts; the site only reads the results.

### The four prompts (one prompt per job — decided 2026-09-20)

Why separate prompts: a very long prompt makes AI drop instructions (index markers were missing in some outputs), and the aids are derived from the FINISHED article, so they should be regenerable without touching it. **Rule of thumb:** anything that sits *inside* the article at an exact spot (`{{Term}}`, images, headings) stays in `content.md`; anything *derived from* the article that can be edited on its own gets its own companion file.

| # | Prompt | Where it lives | What the AI returns | Status |
|---|---|---|---|---|
| 1 | **Content Generation** | `CONTENT_LINK_AI_PROMPT` in `js/app.js`; popup "Copy Content Generation Prompt" (plain copy; renamed from "Copy AI Prompt" 2026-09-20) | ZIP: `content.md` (EN / HI / AI blocks, inline `{{Term}}` index markers) + assets | Live, deliberately unchanged (~17.6k chars, ~4.4k tokens). Flashcards are NOT part of it. |
| 2 | **Flashcards** | `FLASHCARD_AI_PROMPT` in `js/app.js`; popup "Copy Flashcard Prompt" (+ "EN only" checkbox) | The deck as TEXT in one code block. The AI does not create the file; the owner saves it as `flashcards.md` in the topic's Drive folder | Live, confirmed working by the owner |
| 3 | **`index-term.md`** | not built | Per-term language forms + short hover intro | Planned; blocked on an open decision, see Roadmap |
| 4 | **Small quiz** | `QUIZ_AI_PROMPT` in `js/app.js`; popup "Copy Small Quiz Prompt" (+ "EN only") | A 10-question bilingual interactive quiz shown inside Gemini (works on mobile) | Live (not yet tested in Gemini by the assistant); the quiz itself is not a site feature |

**Popup layout (2026-09-20):** the Add Content popup has the 3 Drive steps, an "Open Topic Folder" button, then THREE prompt blocks (`.prompt-block`), each = a copy button + a "What it does" line + a "What to do" line: Content Generation Prompt, Flashcard Prompt (+ EN only), Small Quiz Prompt (+ EN only). Flashcard and quiz share ONE builder, `copyTopicContentPrompt(kind)` with a config per kind in `TOPIC_PROMPT_KINDS` (template, button id, EN-only checkbox id, name, next-step text); `copyFlashcardPrompt()` / `copyQuizPrompt()` are thin wrappers used by the buttons. A new "prompt + this topic's text" aid = one template constant + one config entry + one block in the popup markup.

**Flashcard prompt mechanics** (`copyTopicContentPrompt("flashcard")` in `js/app.js`; text cleaner `cleanContentForPrompt()`, formerly `stripForFlashcardPrompt`): fills topic name + breadcrumb (`buildTopicBreadcrumb`) and pastes the CURRENTLY LOADED text of the open topic (EN + HI, or EN only) into the prompt, so it can be pasted into any AI with no file attached. `stripForFlashcardPrompt()` removes mermaid/lottie/chart fences, image links and `{{ }}` brackets from the COPY only (the article is never changed). Placeholders are replaced with function replacers so `$&`-style text inside the content can't corrupt the result. If the clipboard is blocked a select-all textarea appears; over ~30k characters the alert suggests "EN only". The AI block is never included (only EN + HI: Hindi terminology comes from the HI block).

**Card count rule** (only in the prompt, the site does not enforce it): one card per key concept/definition/classification/sequence/distinction actually taught, minimum 5, maximum 20 (about 5–8 for short topics, 15–20 for long ones), in the content's order, no duplicates, nothing that isn't in the content.

**Wording rule (added 2026-09-20, the most important rule of the flashcard prompt):** the cards are for REVISION, and a reader remembers the content's exact words in the order they read them, so cards must reuse the content's own wording instead of paraphrasing it. In the prompt: default card = sentence completion (question = the content's own lead-in words + at most a minimal stem like "is?" / "क्या है?"; answer = the rest of the sentence copied word for word, cutting only whole words/clauses from the very start or end); lists, classifications and sequences are copied complete, in the content's order, with its numbering and terms; terms, names, numbers and years exactly as written; nothing added that isn't in the content; every card must be traceable to a source sentence; the English side comes from the EN block and the Hindi side from the HI block's own sentence (not a fresh translation, unless no Hindi content was pasted). The prompt includes one GOOD vs BAD example and a "check before you answer" list. AI can still drift, so spot-check a few cards against the article. An automatic "verify deck against article" check was suggested but not built.

**Small quiz prompt** (live as `QUIZ_AI_PROMPT`; the text below is the original draft, the shipped version adds TOPIC/PATH lines, "do not ask me questions first", and "if no Hindi content is provided, write the Hindi yourself"; not yet tested in Gemini):

```
You are a quiz generator for UGC NET (Library & Information Science) practice.

TASK:
Using ONLY the study content at the bottom, create a short interactive practice quiz and show it right here in a live preview (Canvas / interactive view). If this interface cannot render HTML, give me one complete self-contained HTML file in a single code block instead.

QUIZ:
- 10 multiple-choice questions, 4 options each, exactly one correct answer.
- Cover the whole content evenly; do not cluster on one section.
- UGC NET style: definitions, distinctions, classifications, sequences, "which of the following..." plus a few application-type questions.
- Wrong options must be plausible (common confusions from the content), never silly.
- Never use a fact that is not in the content. If unsure about a question, skip it.
- Every question in English with the Hindi version directly below it (Devanagari; keep standard English technical terms). Options likewise bilingual and short.
- Ignore image links, Mermaid/chart blocks and {{ }} markers; use only the text.

BEHAVIOUR:
- One question at a time, with progress like "3 / 10".
- Tapping an option instantly shows correct/wrong (green/red) and a one-line explanation (EN + HI); then lock the answer and show a "Next" button.
- Shuffle option order. Never use "all of the above" or "none of the above".
- End screen: score, the questions missed with correct answers, and a "Try again" button that reshuffles.

DESIGN:
- Mobile-first: single column, large tap targets (min 48px), readable font, works in portrait.
- One self-contained file: inline CSS + JS, no external libraries, fonts, images or network calls, no localStorage.
- Clean, calm, light background.

CONTENT (topic: <TOPIC NAME>, path: <HIERARCHY PATH>):
<PASTE EN + HI CONTENT HERE>
```

The quiz is NOT a site feature: no quiz code, no score storage. (An MCQ-format quiz plugged into the MCQ system was considered and rejected by the owner: this is only for quick practice.)

### Companion files (`Code.gs`, `get_markdown` folder mode)

A topic folder may hold extra learning-aid files next to the main `.md`:

| File name(s), case-insensitive | Purpose | Status |
|---|---|---|
| `flashcards.md` or `_flashcards.md` | the topic's flashcard deck | in use |
| `index-term.md` or `_index-term.md` | per-term language forms / hover intro | reserved, already returned by the server, the site ignores it |

- `handleGetContentFolder_` now returns `companions: { "flashcards": "...", "index-term": "..." }` (plain names, only those that exist) in addition to `content`, `assets`, `assetData`. Only FOLDER links return companions; a single-file link never does.
- **Naming rule:** companion files, and ANY `.md` whose name starts with `_`, are never chosen as the main article and never appear in `assets` (helpers: `companionKeyForFile_`, `isUnderscoreMd_`). Before this, "first `.md` Drive returns" could have picked `flashcards.md` as the article. Main file choice is unchanged otherwise: `content.md` / `index.md` preferred, else the first remaining `.md`.
- If both `x.md` and `_x.md` exist, `_x.md` wins (it sorts first).
- The AI does not create these files. The owner saves the AI's text under the right name. Name typos matter: `flashcard.md` (no "s") is NOT recognised and could even be picked as the main article.
- Site side (`js/app.js`): the fetch stores `companions` in `markdownCache`, `applyMdTextToContentPanel(..., companions)` keeps them in `currentContentCompanions`, and `renderCurrentLanguageBlock()` hands the deck to `Flashcards.setContext()`. **Precedence: `flashcards.md` companion wins over a deck pasted at the end of `content.md`.**

### Flashcard deck format and behaviour (`js/flashcards.js`)

**One deck per topic, bilingual, independent of the EN/HI/AI toggle.** The Flashcard button is enabled exactly when the open topic has a deck.

Deck source, either of:
1. `flashcards.md` in the topic folder (file may or may not start with the marker line), or
2. a section at the very END of `content.md`, starting with `<!--===FLASHCARDS===-->`. `splitContentByLanguage()` cuts everything from the first marker off the whole file BEFORE splitting into language blocks (`separateFlashcards()`), so it can never leak into an article or attach to the last language block.

Format:
```
<!--===FLASHCARDS===-->
<!--CARD-->
Q: English question / हिंदी प्रश्न
A: English answer / हिंदी उत्तर
```
- Q and A may span several lines. Parsing is tolerant: `<!--CARD-->` ends a card, and so does a new `Q:` after an `A:` (AI often forgets the separator). Cards missing a Q or an A are dropped.
- **English/Hindi split** (`splitBilingual`): a `/` is the separator only if there is NO Devanagari before it and SOME after it; if several qualify, the LAST one wins. So `input/output / इनपुट`, Hindi-side alternates (`a/b/c`) and a Hindi side that starts with "1. उत्पादन" all work. Multi-line fields where several lines each carry their own pair are split line by line into two clean lists. No Hindi at all = English only.
- **Rendering:** English on top, thin divider, Hindi below, on both faces. Single-line text renders inline (so `1. Generation → 2. Collection` isn't turned into a one-item list), multi-line text renders as normal Markdown; spaced `->` / `–>` become `→`. Sanitised through marked + DOMPurify.
- **Card ID** = `topicId::hash(lowercased, whitespace-normalised ENGLISH front)`, no language part. Editing the Hindi wording or an answer keeps the review history; editing the English question makes a brand-new card. A duplicate English question inside one topic keeps only the first.
- **Scheduling (Leitner, fixed):** 5 boxes with intervals 1 / 3 / 7 / 15 / 30 days. A card with no entry is NEW and implicitly in box 1, so its first "Yaad tha ✓" moves it to box 2 (due in 3 days). "Yaad tha ✓" = box + 1 (max 5); "Bhool gaya ✗" = box 1, due tomorrow. A session shows the cards that are due (or never reviewed) at the moment the modal opens, each answer is saved immediately (closing early loses nothing), and there are two end states ("Session complete!" / "All caught up! Next review due <date>").
- **Storage:** `localStorage["flashcards:decks:v1"]` = `{ topicId: [cardIds] }` (ids of each topic's current deck, refreshed whenever the topic is opened; used to ignore ghost progress entries). Progress: `localStorage["flashcards:leitner:v1"]` = `{ cardId: { box, dueDate: "yyyy-mm-dd", lastReviewed: "yyyy-mm-dd", ts: <ms> } }`. `ts` (added with progress sync) says exactly when the entry last changed.
- **Unlimited flips:** every tap / Space / Enter turns the card over again, question ↔ answer, as often as wanted (each face shows a "tap to flip" / "tap to flip back" hint). "Yaad tha ✓ / Bhool gaya ✗" appear the first time the answer side is shown and then STAY visible, even while the question faces you again. A card can't be graded before its answer has been seen (`revealed` flag in `open()`). Esc closes. Modal reuses `.add-resource-overlay` / `.add-resource-modal` / `.bottom-strip-btn`; flip-card CSS is at the end of `css/style.css`.
- Code touchpoints: `js/flashcards.js` (`splitArticleAndCards`, `parseFlashcards`, `splitBilingual`, `setContext`, `open`, Leitner `onKnewIt`/`onForgot`), `js/app.js` (`separateFlashcards`, `splitContentByLanguage`, `renderCurrentLanguageBlock`, the `onNewArticle()` call sites and `hideLanguageToggleRow`), `js/reading-tools.js` (Flashcard button click).
- Not verified in a real browser by the assistant: everything was tested in Node + jsdom; the owner confirmed on the live site that flashcards work.

## Progress sync & backup (2026-09-20)

What it is: the owner's learner progress (today only flashcard boxes) follows them across their own devices AND browsers without any login and without a key, plus a manual JSON backup. `localStorage` stays the source of truth on every device/browser (each browser has its own storage, so each one needs syncing once); the server only ever MERGES.

**History:** the first version used a shared `SYNC_KEY` (Script Property, `setupSyncKey()`, a key field in the panel). The owner decided on 2026-09-20 to drop it: nothing else in `Code.gs` is protected by a key either, and typing it into every browser was friction. The key code was removed everywhere; the client deletes any old `notebookAlpha:syncKey` it finds, and a leftover `SYNC_KEY` Script Property is ignored (safe to delete).

### Data shape (versioned; each feature adds one namespace)
```
{ "v": 1, "exportedAt": "...",
  "flashcards": { "<cardId>": { "box": 2, "dueDate": "2026-09-23", "lastReviewed": "2026-09-20", "ts": 1758350000000 } } }
```
**Merge rule (client, server and import all use it):** per entry, the one with the newest `ts` wins; entries without `ts` (written before sync existed) fall back to the `lastReviewed` date at midnight. On an exact tie the copy already stored is kept. Never overwrite, so phone + laptop reviews and old backups can't erase newer work. Incoming entries are validated (`box` 1–5, `dueDate` yyyy-mm-dd) before being accepted.

### Pieces
- **Client `js/progress-sync.js`** (`window.ProgressSync`): `register(name, { export, merge })` for features, `markDirty()` when a feature changes data, `sync()`, `snapshot()`, `mergeSnapshot()`, `exportBackup()`, `importBackupText()`, `openPanel()`. `js/flashcards.js` registers `"flashcards"` and calls `markDirty()` after each answer.
- **UI:** header button `#progress-sync-btn` ("⟳ Sync", in `.header-subjects`) shows a "•" while changes are waiting, the last sync errored, or this browser never synced. **Clicking it opens the panel AND immediately runs a sync**, so it is never silent. The panel has "Sync now", a result line, "Latest sync: <time>", Export backup and Import backup.
- **Tooltip** on the header button is built from the CURRENT state (`tooltipText()`: syncing / error or pending message / "Changes on this device are waiting to sync" / "Not synced on this browser yet" / "Synced. Latest sync: …"), not from the last result text, so it can't say "Up to date" after another review. `markDirty()` also clears a stale "ok" status.
- **Messages (`describeOk`)**: "✓ Up to date. This device and the cloud already have the same latest progress." / "✓ Synced. Sent N card(s) from this device to the cloud." / "✓ Synced. Received N card update(s) from your other devices." / both / "Nothing to sync yet…" / offline ("Couldn't reach the cloud… safe on this device; it will retry") / not-confirmed-yet / errors.
- **Background syncs** (after reviews, on page load) show a short toast (`#progress-sync-toast`) only when something was sent/received or something went wrong; nothing changed = no toast. If the panel is open its status line is used instead.
- **First-run banner** (`#progress-sync-banner`): a browser with no `notebookAlpha:lastSync` and no `notebookAlpha:syncIntroDone` gets a card ("First time on this browser?") with "⟳ Sync now" (runs a sync and shows the result inside the banner) and "Skip for now" (hides the banner for good; the header button keeps its "•" until this browser syncs, which is the lasting reminder). Why it matters: reviewing cards on a fresh browser BEFORE syncing gives those cards a newer timestamp, which replaces their older history. Banner state is cleared by any successful sync.
- **localStorage keys:** `flashcards:leitner:v1` (the data), `notebookAlpha:lastSync`, `notebookAlpha:syncDirty`, `notebookAlpha:syncIntroDone`.
- **Server (`Code.gs`, section "PROGRESS SYNC")**: GET `?action=get_progress` (returns `data` + `server_time`) and POST `save_progress` `{data}`; functions `checkProgressRateLimit_` (global 60/minute), `getProgressFile_`, `readProgress_`, `progressEntryTs_`, `isValidProgressEntry_`, `sanitizeIncomingProgress_`, `mergeProgress_`, `countProgressEntries_`, `handleGetProgress_`, `handleSaveProgress_` (takes `LockService` around read-merge-write, like `syncIndexTerm_`). Script Property: `PROGRESS_FILE_ID`.
- **The file** `notebook-alpha-progress.json` is created by `DriveApp.createFile` in the ROOT of the owner's My Drive on purpose, NOT inside "Study Notebook Content" (that tree is shared "anyone with the link can view" and children inherit it). Its sharing was not verified by the assistant: check it in Drive once.
- **Future features need no server change:** unknown namespaces (`reread`, `mcq`, ...) that are `{ id: entry }` objects are preserved. They only need `register()` + `markDirty()` on the client, and their entries must carry `ts`.

### Sync flow
- `sync()`: GET the server copy, merge it into local data, count local entries the server lacks (or holds older); if any, POST the full local snapshot (`mode:"no-cors"`, response unreadable like every write in `Code.gs`), wait 1.8 s, GET again and CHECK the server now covers everything. If not confirmed the dirty flag stays and a retry runs after 12 s (max 3 automatic retries; a manual sync resets the count; the browser's `online` event also triggers a sync when changes are pending).
- After the last review, `markDirty()` waits 5 s (debounce) then syncs, so a whole review session is about one sync. A browser that has synced before also syncs ~1.5 s after page load to pick up other devices' progress.
- Entries stamped more than a day ahead of the SERVER clock are clamped by the server; the client compares against `server_time` so such an entry counts as delivered instead of leaving sync stuck "pending".

### If a device dies or is lost
- **Any number of devices and browsers** can sync; all merge into the one file. One that was offline for weeks merges per card, it doesn't overwrite.
- **Laptop dead / new phone / new browser:** open the site; the first-run banner appears; press "⟳ Sync now" (or the header ⟳ Sync). All progress comes back from the Drive file. Same laptop, different browser = a new browser, sync there once too.
- **Drive file deleted/trashed:** the next sync from any device recreates it from that device's local copy (`getProgressFile_(true)`). If the file AND every browser's local data are gone, only a backup helps: keep an occasional **Export backup**.
- Verified in the Node/jsdom test harness against the real `Code.gs`: conflict resolution, disjoint merges, stale-backup import, invalid/oversized/far-future input, offline + retry, trashed file, new browser, first-run banner, click-always-shows-a-message.

### Limits and honest caveats
- **No key = anyone who has the web-app URL (it is in `js/app.js` on GitHub) could read the progress or overwrite entries** with a timestamp up to a day ahead of the server clock. The server only limits damage (rate limit, size/entry caps, entry validation, future-timestamp clamp). The data is low-value review schedules, but keep a backup. If that ever matters, a key or Google Sign-in can be added back without changing the data format.
- **Single-user design.** Everyone using the site would share ONE progress file. When the site becomes "by public for public", per-user progress needs real identity (e.g. Google Sign-in + each user's own Drive/app-data). Keep the JSON format; it carries over.
- Conflicts are decided by each device's own clock (`ts = Date.now()`): a device with a badly wrong clock can make an older review win.
- After 3 failed automatic retries a device stays "dirty" until the `online` event, a page load, a new review or a manual sync.
- No deletions are synced (no tombstones), see the lifecycle note.
- The file grows ~100 bytes per card. Apps Script quotas and execution time limits were not verified.
- iPhone Safari may open the exported JSON in a tab instead of downloading it: use Share → Save to Files.
- Only tested in Node/jsdom against mocked Apps Script services, not on real Drive.

## Practice page (2026-09-20)

Everything you DO to remember what you learned lives on ONE page, `practice.html` (the name was chosen over Progress / Recall / Exercise: it covers MCQs, flashcards, quizzes and the "what is due" view). It replaces the earlier Revision page; `revision.html` remains only as a forwarding page (`practice.html?view=due`, keeping `?topic=`).

**Layout (decided with the owner):** two panels like the Index page. LEFT = a small menu, RIGHT = whatever is picked. Menu: **Progress** (its sub-options **Tree view** and **Due view** appear under it when it is active), **Flashcards**, **MCQs**. Count badges on Progress and Flashcards (cards due). Desktop: side by side, drag the divider (default width about 28%, min 220 px, right panel min 300 px; remembered in `practice:leftWidth`), collapse button (52 px column, remembered in `practice:leftCollapsed`). Phones/tablets (<= 900 px): the menu is the screen; picking an item shows the detail full-screen with a "← Menu" button. Same drag/collapse code pattern as `js/index-directory.js` (pointer events).

**Deep links:** `practice.html?view=due|tree|flashcards|mcq&topic=<id>` (`selectView` keeps `?view=` in the URL with `history.replaceState`). `?topic=` highlights that topic (Due/Tree/Flashcards), expands the Tree down to it, adds an explanatory note in the Due view when it has nothing due, and scopes the MCQ iframe (`mcq.html?topic=<id>`).

**Views (`js/practice.js`)**
- **Due view (by WHEN):** summary line + sections Overdue / Due today / Next 7 days / Later, each with a card count; rows = topic title, parent path, chips, "Open topic" (`index.html?openNode=<id>`) and **one** "Review N cards" button per topic (on its Overdue row, or its Due-today row if nothing is overdue; N = the topic's whole due-now count).
- **Tree view (by WHERE):** Subject → Course → Unit → Chapter → Topic built from the notebook tree (siblings ordered by `sort_order`), only branches that contain reviewed cards, with due counts rolled up at every level ("N reviewed" chip too). Branches with due cards start expanded; toggle per row, Expand all / Collapse all. Progress of topics no longer in the tree is listed under "Not in the tree any more".
- **Flashcards:** "Ready to review" (topics with due cards, with Review) and "Reviewed, not due yet" (next review date).
- **MCQs:** the existing `mcq.html` embedded in an iframe with an "Open in new tab ↗" link; built once and kept alive when switching views so an attempt in progress isn't reset. (Step 2 below merges the real MCQ code in.)

**Review (cross-topic, no card-text cache):** "Review" fetches that topic's deck from Drive at that moment: `get_markdown` with the topic's content link, using the `flashcards.md` companion if present, else the deck at the end of `content.md`; then `Flashcards.setContext(topicId, raw)` + `Flashcards.open()` (the normal modal). The session shows the topic's due cards plus its never-reviewed cards (same rule as the home Flashcard button), so it can be larger than the count on the button. Errors show a message in the right panel ("Couldn't start the review: …", "No flashcards found for this topic…"). A topic without a content link gets no Review button.

**Data:** due counts come from `Flashcards.getDueSummary()`, per topic `{overdue, dueToday, upcoming (next 7 days), later, reviewed, nextFuture}`, from progress in `localStorage` (a card id is `topicId::hash`; ghost cards of rewritten decks are ignored via `flashcards:decks:v1`). Only cards reviewed at least once appear; NEW cards live inside their topic. Topic names, the tree and content links come from the Google Sheets API dump (`nodes` + `content` rows with `content_type: "md_file"`, ignoring rows with `orphaned_at`) -> `data/study-data.json` -> `window.STUDY_DATA_FALLBACK` (then `node.content.md_file`). The full dump is heavy; a lighter action in `Code.gs` is a possible later optimisation.

**Entry points:** home header "Practice · N" link (`#practice-link` / `#practice-badge`, next to ⟳ Sync), the post-read strip's "Open practice in new tab ↗" button (`data-post-read-action="revise"`), footer links. `index.html` and `index-directory.html` footers got `<a href="practice.html">Practice</a>`; `mcq.html` still needs it (and still shows its own "MCQ Practice" links until the merge).

**Live refresh:** `writeStore()` in `flashcards.js` dispatches `flashcards-progress-changed` (own answers and progress merged in by a sync), which refreshes the badges and the page. The page has its own ⟳ Sync button; a brand-new browser sees the first-run banner.

**Next steps for this page:** (2) merge the real MCQ code into `practice.html` (needs `mcq.html`; `mcq.js` depends on that page's markup and body class) and turn `mcq.html` into a forwarding page too; (3) save MCQ results as a new progress-sync namespace and add them to the Progress views; later, re-read reminders as another namespace. Suggested but not built: auto-collapse the menu when a session/MCQ starts, a small always-visible due chip if the home restructure moves the header badge into a Progress tab.

Tested in Node/jsdom only (views, rollups, deep links, review flow incl. failures, mobile swap, drag/collapse persistence, forwarding page, Revise button).

## Roadmap & open decisions (as of 2026-09-20)

**Done:** flashcards (bilingual deck, Leitner, unlimited flip, modal), flashcard prompt + popup button, companion-file support in `Code.gs`, progress sync + backup, Practice page step 1 (two-panel shell with Progress Tree/Due views, Flashcards with cross-topic Review, MCQs embedded, header badge, Revise button; not yet confirmed live). Deployed and confirmed by the owner: `Code.gs` (new version), `app.js`, `flashcards.js`, `style.css` up to the flashcard work. The sync work (`progress-sync.js`, `index.html`, the PROGRESS SYNC part of `Code.gs`, first with a key, then key-less on 2026-09-20) was delivered after that and is not yet confirmed live; if it was deployed in its key version, redeploy `Code.gs` as a New version and replace the site files.

**Next, in the agreed order:**
1. **Practice page steps 2 and 3:** merge the MCQ code in (needs `mcq.html`), then MCQ result tracking, see the Practice page section. **Home restructure (agreed direction, not built):** home becomes tree + content + right panel with References | Index | Progress (MCQ moves under Progress; the Progress tab shows this topic's flashcard/MCQ launchers, the due count and sync, and "Open Practice ↗"); header keeps only title + subjects (+ a tiny due chip so the count stays visible when the right panel is collapsed); the post-read strip keeps Start/End Read and Read Again plus at most one nudge button. Pending: whether MCQ progress goes in Practice (yes, planned: new `mcq` namespace).
2. **Re-read reminders:** End Read stores topic id + date, same 1/3/7/15/30 schedule, as a new sync namespace (`reread`).
3. **MCQ revise:** `js/mcq.js` (received 2026-09-20) keeps attempts ONLY in memory (`attemptedQuestions`, marks, results; the only `localStorage` key is the font size), by earlier design. Revising wrong answers therefore needs a decision first: start saving per-question results (ids + right/wrong + a Leitner-style due date) as a new progress-sync namespace (`mcq`), then list them on the Revision page.
4. **Popup (mostly done 2026-09-20):** shared builder + Small Quiz button + descriptions are built. Still open: an optional "Copy content only" button, and testing the quiz prompt in mobile Gemini. The index-term button waits for item 5.
5. **`index-term.md`:** design leaning: the Sheet keeps a term's IDENTITY (Index_Terms/Index_Node, manual right-click only), the file only ENRICHES it (language forms EN/HI/AI, short hover intro; tap on mobile). Blocked on the owner's decision: should the hover intro be per-topic or one global definition per term (global would need a Sheet column + `Code.gs` change)? Files needed before starting: `js/richcontent.js`, `js/index-data.js`, and the `Index_Terms` / `Index_Node` header rows (`index-directory.html` and `js/index-directory.js` were received 2026-09-20). Risks noted: Hindi text-matching is fragile (inflection), so the prompt must say "copy the term exactly from that block" and unmatched terms should be flagged; the same term in HI/AI blocks would become separate Sheet terms unless an alias model exists; that alias idea is the seed for the deferred right-click scopes.
6. **Content prompt hygiene:** `{{Term}}` markers are working again (dotted underline confirmed by the owner). AI still tends to mark terms only in the EN block. Cheap fixes if it keeps happening: a checklist line near "FINAL PACKAGE OUTPUT RULES" ("`{{Term}}` in every language block?") and a console warning when a block renders zero `.rc-index-suggestion` spans. Moving index terms to a separate file was judged not worth it for prompt length alone (~12% of the prompt).

**Deferred / stubs:** the Take Test button (inert; to be replaced by the Progress/Practice launchers), right-click index scopes, Google Sign-in for a public multi-user version, cleanup of progress entries for deleted topics.

## Working notes for a future AI session

- **Owner:** Mahender, sole developer/author, communicates in Hinglish (Hindi-English) and likes the explanation first, then the implementation. UGC NET (Library & Information Science) prep site. Financial constraint = architectural rule: no live AI API, static hosting (GitHub Pages `prepjack/notebook-alpha`), `localStorage` over server-side user data, zero-cost solutions.
- **Deploying `Code.gs`:** paste, save, then Deploy → Manage deployments → Edit → Version: **New version** → Deploy. Ctrl+S alone does not update the live URL. The owner usually wants the COMPLETE `Code.gs` back, not a patch.
- **Before working on X, ask for these files:** index terms / hover intro → `js/richcontent.js`, `js/index-data.js`, `js/index-directory.js`, `index-directory.html`, sheet headers; MCQ features → `js/mcq.js`, `js/mcq-parse.js`, `mcq.html`; content rendering → `js/richcontent.js`; anything that changes behaviour of an existing file → the latest version of that file (the owner edits between sessions).
- **Conventions:** every write from the site is a `no-cors` POST whose response is unreadable, so success is verified with a follow-up GET (index terms, progress sync). GET responses ARE readable. No endpoint uses a key; public write endpoints have only a global rate limit (`checkIndexWriteRateLimit_` 40/60 s, `checkProgressRateLimit_` 60/min). New sheet columns are added lazily with `getOrAddColumn_`.
- **Testing done so far:** Node + jsdom harnesses (real `Code.gs` run against mocked Apps Script services, two simulated devices) for flashcards, companion files and sync. These are not in the repo and nothing has been verified against real Drive/Apps Script by the assistant; ask the owner to test on the live site after each deploy.
- **Keep this guide current:** whenever something in this file changes, update the relevant section in the same change (the Data lifecycle tables are the model for that).
