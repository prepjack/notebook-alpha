ALPHA GOOGLE SHEET DATA CONTRACT

NOTE ON THIS FILE: Topics.csv / Resources.csv / MCQs.csv in this same
folder are an early, illustrative template (they use "topic_id"). The
site's actual live Apps Script contract — the one js/app.js really talks
to (see convertApiDataToStudyData() and the save_core/save_resource/
save_structure/delete_* actions) — is the Nodes + Content + Resources +
MCQs + Community shape described from section 4 onward below, keyed on
"node_id". Treat node_id as the one canonical, stable ID; nothing in
Alpha-Plus introduces a second/duplicate ID system.

The website should eventually read three logical tables:

1. Topics
subject | topic_id | topic_title | parent_id | explanation | example | key_points

2. Resources
resource_id | topic_id | title | type | source | url | page_ref | description | open_mode

3. MCQs
mcq_id | topic_id | question | option_a | option_b | option_c | option_d | correct_option | explanation

IMPORTANT:
- topic_id is the stable connection between Topics, Resources and MCQs.
- Do not use the visible topic title as the permanent identifier.
- key_points uses " | " as the separator in the current CSV template.
- correct_option is zero-based in the current JSON (0=A, 1=B, 2=C, 3=D).
- Resource URL is always a link. The website does not ask users to upload PDFs/images.\n- page_ref stores the relevant PDF page or page range for the topic (e.g. 23 or 23–27), or a video timestamp (e.g. 04:15–08:30).
- Apps Script will later transform these rows into the JSON shape already consumed by the frontend.
- MCQ attempts are NOT part of these public content tables in Alpha. Attempts remain browser/session-only.

4. Nodes (structure — not yet included as a CSV template here, but this is
   the shape convertApiDataToStudyData() in app.js already expects, and
   what the "save_structure" POST action writes to)
node_id | title | node_type | parent_id | sort_order | status | author_id

- The tree has no hard-coded depth limit: hierarchy is built purely from
  parent_id, so no schema change was needed to add the "Course" level below.
- Hierarchy and matching node_type values, by depth:
    depth 0  Subject   node_type "subject"
    depth 1  Course    node_type "course"
    depth 2  Unit      node_type "unit"
    depth 3  Chapter   node_type "chapter"
    depth 4  Topic     node_type "topic"
    depth 5+ Subtopic  node_type "subtopic"
- The website computes the displayed label from a node's position in the
  tree (its depth), not from node_type. node_type is still stored/sent
  (and used to spot the root "subject" and to auto-select the first
  "topic"-type node on load), so keep it consistent with the table above
  when the Apps Script Nodes sheet is built.

The intended future flow:

Google Sheets
   -> Apps Script
   -> structured JSON response
   -> existing app.js / mcq.js
   -> website

Adding a new row to Resources or MCQs should therefore become the normal
"add content" operation later.

5. ALPHA-PLUS — INDEX TERMS (optional, reuses the Content table above)
--------------------------------------------------------------------
No new sheet is needed for the Index feature. A node can optionally get
one more Content row with:

    content_type = "index_terms"
    content      = "RFID, Radio Frequency Identification, RFID tag"

This is written by the same "save_core" action as definition/explanation/
example/key_points/diagram, and is filled in from the website's existing
"Add / Edit Content" form (field: "Also known as") — nothing new to build
in Apps Script, since content_type is already handled generically:
node.content[content_type] = row.content for any type that isn't
"key_points". Comma or newline separated. Every node's own title is
already an index entry automatically; index_terms only adds ALIASES
that should resolve to the same node/topic without duplicating content.

6. ALPHA-PLUS — MARKDOWN UPLOAD (removed from the UI, data still supported)
--------------------------------------------------------------------
An earlier version of this feature had an "Upload Markdown" button in
the middle panel that read a chosen .md file as plain text in the
browser and saved it as this node's "explanation" content_type through
the existing save_core action. That button has since been REMOVED from
the UI in favor of "Add Content Link" (section 7) — but any topic that
already has text saved this way keeps rendering exactly as before; no
data migration was needed or performed. New content should be added
only via "Add Content Link" going forward.

7. ALPHA-PLUS — CONTENT LINK (Google Drive .md file OR folder, fetched live)
--------------------------------------------------------------------
The only way to add rich content through the website UI now. No new
sheet, no file upload:

    content_type = "md_file"
    content      = the Google Drive share link — either a single .md
                   file, OR a FOLDER containing one .md file plus that
                   topic's images/animations (see "FOLDER MODE" below)
                   (or a bare Drive file ID, or a filename inside a
                   designated "study content" Drive folder, for manual
                   entry)

This is written by the SAME "save_core" action as every other
content_type (definition/explanation/example/index_terms/md_file) —
"Add Content Link" in the website UI just calls it with
content_type = "md_file" and the pasted link as content. Nothing is
ever uploaded through the browser; the file(s) stay in the user's own
Drive, shared as "Anyone with the link can view".

You can also skip the website entirely and paste a Drive link (or bare
file ID, or filename) straight into this row/cell yourself — reload
the site and it renders exactly the same way.

At render time, if a node has a `md_file` link, the website calls the
Apps Script `get_markdown` GET action with that link and renders the
returned Markdown text live (through the same renderRichContent() as
everything else). If a node has no `md_file` link but does have
`explanation` text saved directly (from the older, now-removed
Upload Markdown flow), that keeps rendering exactly as before — the
two are not mutually exclusive in the data model, but `md_file`
takes priority when both are present. "Remove Content" clears both.

FOLDER MODE (images & animations, auto-fetched):
Paste a Drive FOLDER link instead of a single-file link, and put a
.md file (any name ending in .md — content.md or index.md is picked
automatically if present, otherwise the first .md file found) PLUS
that topic's images/animation files all in that one folder, all shared
together as "Anyone with the link can view". `get_markdown` detects a
folder link automatically (handleGetContentFolder_ in Code.gs — see
the URL pattern in extractDriveFolderId_), reads the .md file as the
topic text, and returns every OTHER file in the folder as an
{filename: url} asset map. This lets the .md reference an image or
\`\`\`lottie animation by its PLAIN FILENAME alone — no per-file share
link needed — e.g. ![Neuron structure](neuron.png) or a \`\`\`lottie
fence with "src":"mitosis.json". See section 8 below for the exact
image/animation syntax, and js/richcontent.js resolveAssetRefs() for
how filenames are matched against the asset map (a full http(s)/data:
URL is left untouched either way, so single-file links with
already-hosted image URLs keep working unchanged).

8. RICH CONTENT SYNTAX (definition / explanation / example columns)
--------------------------------------------------------------------
No new columns needed. Type into the SAME cells as before — the website
now renders Markdown instead of plain text. Fill fast in one cell using
Alt+Enter (Windows/Chrome OS) or Ctrl+Enter (Mac) for new lines.

Supported Markdown, typed straight into a Sheets cell:

  ## Heading                -> section heading
  **bold**  *italic*        -> bold / italic text
  - point one               -> bullet list
  - point two
  1. step one               -> numbered list
  2. step two

  | Term | Meaning |         -> a real HTML table
  |------|---------|
  | RAM  | Volatile memory |
  | ROM  | Non-volatile    |

  > Important exam note      -> highlighted quote/callout box

MIND MAPS / DIAGRAMS — put a mermaid code fence in the cell:

  ```mermaid
  graph TD
  A[Information Society] --> B[Digital Divide]
  A --> C[ICT Infrastructure]
  B --> D[Access Gap]
  ```
  (mindmap / graph TD / flowchart LR syntax all work — see mermaid.js docs)

CHARTS / GRAPHS — put a chart code fence with a small JSON spec in the cell:

  ```chart
  {"type":"bar","labels":["Primary","Secondary","Tertiary"],
   "data":[40,35,25],"label":"Source type distribution (%)"}
  ```
  type can be "bar", "line", "pie", or "doughnut".

IMAGES — plain Markdown image syntax, no fence needed:

  ![Neuron structure](https://drive.google.com/uc?export=view&id=FILE_ID)
  ![Neuron structure](neuron.png)   <- if this topic's Content Link is a
                                        FOLDER (section 7), just the plain
                                        filename of an image in that same
                                        folder works, no per-file link needed

  The alt text ("Neuron structure") becomes a caption under the image
  automatically, and clicking the image opens it full-size in a new tab.
  Same "link, don't upload" rule as Resources (see section above) — host
  the image in Google Drive (shared "Anyone with the link", then use the
  uc?export=view&id=... form of the link so it renders directly) or any
  public image URL, and paste the Markdown line into the cell. Or, easiest
  of all, put the image file straight in the topic's Content Link folder
  and reference it by filename as shown above.

ANIMATIONS — put a lottie code fence in the cell, pointing at a hosted
Lottie/Bodymovin JSON animation (e.g. a public file from lottiefiles.com,
a "uc?export=view&id=..." Google Drive link, or — same shortcut as
images above — just the plain filename if this topic's Content Link is
a folder):

  ```lottie
  {"src":"https://assets.lottiefiles.com/packages/lf20_example.json",
   "loop":true,"autoplay":true,"height":220}
  ```
  ```lottie
  {"src":"mitosis.json","loop":true,"autoplay":true,"height":220}
  ```
  loop/autoplay/height are all optional (default: loop on, autoplay on,
  auto height). A full inline Bodymovin JSON export also works directly
  in the fence instead of "src", if you'd rather not host a separate file.
  Lottie animations are small, scalable vector animations — a much
  lighter alternative to uploading GIF/video files for things like
  process/cycle animations.

These fences are plain text — they paste into a single Google Sheets cell
exactly like everything else, and render automatically on the website via
js/richcontent.js (Markdown -> marked.js + DOMPurify, mermaid -> mermaid.js,
chart -> Chart.js, lottie -> lottie-web). If a cell has no fences or images,
it just renders as formatted Markdown text — nothing breaks for topics that
don't use diagrams/charts/images/animations.

9. ALPHA-PLUS — INDEX REGISTRY (Code.gs, TWO NEW OPTIONAL SHEETS)
--------------------------------------------------------------------
This is the redesign described in "Alpha Website — Redesign and
Strengthen the Index System": the Index moves from being derived
fresh from the tree every time (the old buildIndexEntries() behaviour,
still the fallback below) to a canonical term registry with stable
IDs that other features (MCQs, tags, resources...) can reference
later without duplicating text.

Two new sheets, both OPTIONAL — the site works exactly as it always
has if they don't exist yet:

  Index_Terms
    index_id | term | normalized_term | created_at | updated_at

  Index_Node   (many-to-many: one term can link to 0, 1, or many nodes)
    index_id | node_id | source_type | created_at

  source_type is one of: tree | content | alias | manual

TO TURN THIS ON:
  1. Replace your Apps Script project's Code.gs with the version in
     this folder (google-sheet-template/Code.gs). Every existing
     function is byte-for-byte unchanged except doGet (now also
     returns index_terms / index_links — [] if the sheets don't
     exist) and doPost (two new, additive actions — see below).
  2. In the Apps Script editor, pick migrateIndexTerms from the
     function dropdown and click Run, once. It creates both sheets
     if missing, then walks every Nodes row (title -> term,
     source_type "tree") and every Content_Core row with
     content_type = "index_terms" (each alias -> term, source_type
     "alias"), reusing an existing term (by normalized_term) instead
     of duplicating it. Safe to re-run any time you add nodes/aliases
     — it only adds what's missing.
  3. Re-deploy the web app (or it picks up automatically depending on
     your deployment settings) and reload the website. js/index-data.js
     (shared by index.html and index-directory.html) automatically
     prefers this registry once index_terms is non-empty; until then
     it keeps deriving the Index from the tree exactly as before.

NEW doPost ACTIONS (additive — nothing currently calls these yet,
they exist for future manual-add / content-term-review UI):

  save_index_term  { term }
    -> finds-or-creates the Index_Terms row for that term (by
       normalized_term, so re-sending the same term never duplicates
       it) and returns { index_id, term }.

  link_index_term  { index_id, node_id, source_type }
    -> adds an Index_Node row for that pair if it doesn't already
       exist (safe to call repeatedly).

WHY node_id AND index_id STAY SEPARATE: node_id says where something
lives in the syllabus tree; index_id says which concept/term it's
associated with. A term does not have to be a tree node (e.g. "Melvil
Dewey" mentioned inside a topic's Markdown), and one term can
legitimately belong to several different tree nodes — that's exactly
what the Index_Node many-to-many table is for. A future MCQ (or tag,
or resource) that wants to reference concepts should store index_ids,
never the literal term text, so a display-name change never needs to
ripple through every place that referenced it.



8. ALPHA-PLUS — AUTO DRIVE FOLDERS
----------------------------------
Structure nodes now get a managed Google Drive folder automatically when
save_structure runs. The Nodes sheet gains:

    drive_folder_id

Folder hierarchy mirrors the website hierarchy:

    Study Notebook Content /
        Subject /
            Course /
                Unit /
                    Chapter /
                        Topic /
                            Subtopic /

The folder is created under the parent node's folder. Repeated saves reuse
the stored drive_folder_id. If a node title changes, the managed Drive
folder is renamed to match. If an old folder ID becomes inaccessible, the
folder is repaired/recreated on the next ensure operation.

Every managed folder is shared as "Anyone with the link can view" so the
existing folder-mode Markdown reader can read the .md and asset files.
The website now exposes "Open Topic Folder" in the content panel; it calls
get_or_create_node_folder and opens the exact managed folder.

Deleting a structure node also finds all descendants, trashes their managed
Drive folders (recoverable from Google Drive Trash), then deletes the Nodes
rows. This intentionally avoids permanent Drive deletion.

Run setupDriveStorage() ONCE from the Apps Script editor after pasting the
updated Code.gs. It creates/repairs the drive_folder_id column, creates the
root folder "Study Notebook Content" when needed, and creates a
Storage_Config sheet.

IMPORTANT — MULTI-GMAIL STORAGE
--------------------------------
Storage_Config is intentionally a configuration layer, not a claim that one
Apps Script can spend multiple Gmail accounts' Drive quotas merely by listing
their email addresses. DriveApp operates under the account/authorization of
the executing Apps Script. True automatic quota rotation across separate
Gmail accounts requires separately authorized execution endpoints (or a
shared/organizational storage product designed for this purpose).
The current implementation therefore makes the root/folder mapping stable
and migration-friendly without pretending that a second Gmail address alone
changes the Drive quota used by DriveApp.

The existing folder-mode Markdown reader remains unchanged: it detects a
Drive folder link, selects content.md/index.md (or the first .md), and returns
other files as filename-based assets.
