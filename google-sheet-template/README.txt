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

7. ALPHA-PLUS — CONTENT LINK (Google Drive .md, fetched live)
--------------------------------------------------------------------
The only way to add rich content through the website UI now. No new
sheet, no file upload:

    content_type = "md_file"
    content      = the Google Drive share link (or a bare Drive file
                   ID, or a filename inside a designated "study
                   content" Drive folder, for manual entry)

This is written by the SAME "save_core" action as every other
content_type (definition/explanation/example/index_terms/md_file) —
"Add Content Link" in the website UI just calls it with
content_type = "md_file" and the pasted link as content. Nothing is
ever uploaded through the browser; the .md file stays in the user's
own Drive, shared as "Anyone with the link can view".

You can also skip the website entirely and paste a Drive .md link (or
bare file ID, or filename) straight into this row/cell yourself —
reload the site and it renders exactly the same way.

At render time, if a node has a `md_file` link, the website calls the
Apps Script `get_markdown` GET action with that link and renders the
returned Markdown text live (through the same renderRichContent() as
everything else). If a node has no `md_file` link but does have
`explanation` text saved directly (from the older, now-removed
Upload Markdown flow), that keeps rendering exactly as before — the
two are not mutually exclusive in the data model, but `md_file`
takes priority when both are present. "Remove Content" clears both.

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

These fences are plain text — they paste into a single Google Sheets cell
exactly like everything else, and render automatically on the website via
js/richcontent.js (Markdown -> marked.js + DOMPurify, mermaid -> mermaid.js,
chart -> Chart.js). If a cell has no fences, it just renders as formatted
Markdown text — nothing breaks for topics that don't use diagrams/charts.
