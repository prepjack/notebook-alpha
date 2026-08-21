ALPHA GOOGLE SHEET DATA CONTRACT

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

5. RICH CONTENT SYNTAX (definition / explanation / example columns)
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
