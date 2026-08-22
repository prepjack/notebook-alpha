# Alpha Study Notebook — Project Guide

## Purpose
This is the current frozen UI prototype before Google Sheets + Apps Script integration.

## Main architecture
- `index.html` — main Study Notebook interface.
- `css/style.css` — main visual styling for the notebook and MCQ interface.
- `js/app.js` — main notebook behaviour: subject/tree/index, content, resources, user additions/deletions.
- `mcq.html` — separate MCQ practice page.
- `js/mcq.js` — MCQ attempt/navigation/display behaviour.
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
  topic's content to a .md file already saved in the user's own
  Google Drive, fetched and rendered live (see js/app.js,
  openAddContentLink / loadAndRenderMdFileContent, and
  google-sheet-template/README.txt section 7). The older "Upload
  Markdown" button has been removed from the UI; any topic with
  legacy explanation text saved that way still renders as before.
- RIGHT PANEL now has two tabs:
  - REFERENCES (was "Resources"): unchanged — links such as Google
    Drive/Web and YouTube, with a page/location reference.
  - INDEX (new): a book-style A–Z index with a search box and
    suggestions. Every entry (a node's own title, or an optional
    "Also known as" alias saved via content_type "index_terms")
    resolves back to the SAME node id the Table of Contents already
    uses — clicking an entry calls the same selectNodeById() function
    that expands/highlights the Table of Contents and loads the topic
    into CONTENT. There is only one place topic content lives; the
    Index is an alternate way to find it, not a second copy of it.

## Resource rule
Do not ask the user to upload a PDF. Users add a Google Drive/Web link or YouTube link. A `page_ref` field records the relevant PDF page/range or video timestamp.

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
