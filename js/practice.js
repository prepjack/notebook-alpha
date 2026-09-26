/* =========================================================
   PRACTICE PAGE (practice.html)

   Phase 2 shell (see phase-2-new-shell.md). Two panels, like the Index
   page: the LEFT panel is a small menu, the RIGHT panel shows whatever
   is picked there. Three top-level entries:

     Plan Today   placeholder only — Phase 5 builds the SMART day plan.
     Queue view   sub-nav (still in the left panel): Read, Flashcards,
                  MCQ, Future, in that fixed order. Each is a placeholder
                  for now — Phase 4 builds the real cross-topic queues.
     Tree view    the same ToC that powers the home page, unchanged in
                  structure. Clicking a LEAF topic opens the 4-square
                  panel (Read | Flashcards | MCQ | Future) from Phase 1,
                  scoped to that topic, right there in the tree. Clicking
                  a non-leaf node (Subject/Course/Unit/Chapter) shows a
                  "select a topic" placeholder — real aggregation is
                  Phase 3, not built here.

   Progress comes from localStorage (kept in step across devices by
   js/progress-sync.js); a card id starts with its topic id. Topic names,
   the tree and each topic's content link come from the notebook data,
   loaded like js/index-directory.js does (Google Sheets API ->
   data/study-data.json -> data/study-data.js fallback).

   "Review" loads that topic's flashcard deck from Drive on demand
   (get_markdown: flashcards.md companion, else the deck at the end of
   content.md) and opens the normal flashcard modal, which shows only the
   cards that are due.

   Deep links: practice.html?view=plan|tree|queue-read|queue-flashcards|
               queue-mcq|queue-future&topic=<id>
   Old links (practice.html?view=due|flashcards|mcq) from before this
   phase still work — see LEGACY_VIEW_MAP below — so nothing linking here
   from index.html / revision.html / reading-tools.js silently breaks.
   ========================================================= */

// progress-sync.js reads this global when it syncs.
const GOOGLE_SHEET_API =
    "https://script.google.com/macros/s/AKfycbzE7zuqKXMmvfoP6LNCRw159odJsqWW9O0hEWm7uHIelnQJz4x7iFMnbTDKvm8lpIw5QA/exec";

const PRACTICE_WIDTH_KEY = "practice:leftWidth";
const PRACTICE_COLLAPSED_KEY = "practice:leftCollapsed";
const MOBILE_MAX = 900;

const VIEW_HEADINGS = {
    plan: "PLAN TODAY",
    tree: "TREE VIEW",
    "queue-read": "QUEUE VIEW · READ",
    "queue-flashcards": "QUEUE VIEW · FLASHCARDS",
    "queue-mcq": "QUEUE VIEW · MCQ",
    "queue-future": "QUEUE VIEW · FUTURE"
};

// Old flat-tab view ids (before this phase) -> closest new view. Keeps
// existing links (index.html's Practice button, revision.html's
// redirect, reading-tools.js's "jump to due") working without editing
// every caller in the same pass as this high-risk phase.
const LEGACY_VIEW_MAP = {
    due: "queue-flashcards",
    flashcards: "queue-flashcards",
    mcq: "queue-mcq"
};

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function plural(n, word) {
    return n + " " + word + (n === 1 ? "" : "s");
}

function prettyDate(iso) {
    const [y, m, d] = String(iso).split("-").map(Number);
    if (!y || !m || !d) return iso;
    try {
        return new Date(y, m - 1, d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    } catch (e) {
        return iso;
    }
}

function prettyDateTime(ms) {
    try {
        return new Date(ms).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
    } catch (e) {
        return new Date(ms).toString();
    }
}

/* -----------------------------------------------------
   Notebook data: tree + content links
   ----------------------------------------------------- */

let nodesById = {};   // id -> { id, title, parentId, sort, idx }
let childrenOf = {};  // parentId ("" = root) -> [ids]
let mdLinks = {};     // topicId -> Drive link of its content folder/file
let treeLoaded = false;

function ingestApiData(apiData) {
    nodesById = {};
    mdLinks = {};
    (apiData.nodes || []).forEach((row, idx) => {
        if (!row || !row.node_id) return;
        nodesById[String(row.node_id)] = {
            id: String(row.node_id),
            title: String(row.title || ""),
            parentId: row.parent_id ? String(row.parent_id) : null,
            sort: Number(row.sort_order) || 0,
            idx: idx
        };
    });
    (apiData.content || []).forEach(row => {
        if (!row || row.content_type !== "md_file" || !row.node_id || row.orphaned_at) return;
        const link = String(row.content || "").trim();
        if (link) mdLinks[String(row.node_id)] = link;
    });
}

function ingestSubjects(subjects) {
    nodesById = {};
    mdLinks = {};
    let idx = 0;
    (function walk(list, parentId) {
        (list || []).forEach(node => {
            if (!node || node.id === undefined || node.id === null) return;
            const id = String(node.id);
            nodesById[id] = { id: id, title: String(node.title || ""), parentId: parentId, sort: 0, idx: idx++ };
            const link = node.content && node.content.md_file ? String(node.content.md_file).trim() : "";
            if (link) mdLinks[id] = link;
            walk(node.children, id);
        });
    })(subjects, null);
}

function buildChildren() {
    childrenOf = {};
    Object.keys(nodesById).forEach(id => {
        const n = nodesById[id];
        const parent = n.parentId && nodesById[n.parentId] ? n.parentId : "";
        (childrenOf[parent] = childrenOf[parent] || []).push(id);
    });
    Object.keys(childrenOf).forEach(parent => {
        childrenOf[parent].sort((a, b) => (nodesById[a].sort - nodesById[b].sort) || (nodesById[a].idx - nodesById[b].idx));
    });
    leafIdsCache = new Map(); // content structure just changed: stale entries would be wrong
}

/* -----------------------------------------------------
   Phase 3 — structural leaf + descendant-leaf lookup
   (see phase-3-aggregation.md)

   "Leaf" here means "has no children in the actual content tree" —
   independent of whether a flashcard deck has ever been opened for it
   (that's a separate, localStorage-only notion used elsewhere for the
   Flashcards square's glance text). A Chapter with only one Topic under
   it is still a non-leaf: it aggregates that one topic same as if it
   had ten.
   ----------------------------------------------------- */
function isLeaf(id) {
    return !((childrenOf[id] || []).length);
}

// nodeId -> string[] of every leaf-topic id underneath it (or [nodeId]
// itself, if it already is one). Content structure is fixed at load
// time (see the module docblock), so this is memoized per node and only
// cleared by buildChildren() above when the tree actually reloads.
let leafIdsCache = new Map();
function getDescendantLeafIds(nodeId) {
    if (leafIdsCache.has(nodeId)) return leafIdsCache.get(nodeId);
    const result = [];
    (function walk(id) {
        const kids = childrenOf[id] || [];
        if (!kids.length) { result.push(id); return; }
        kids.forEach(walk);
    })(nodeId);
    leafIdsCache.set(nodeId, result);
    return result;
}

// Every leaf-topic id on the whole site — just getDescendantLeafIds
// starting from the virtual root ("" is childrenOf's key for the
// top-level Subjects, same key buildChildren() already uses).
function getAllLeafIds() {
    return getDescendantLeafIds("");
}

// Builds a scope for ANY node — leaf or not — from the live tree,
// unlike scopeForTopic() above/below which is only ever handed an
// already-known leaf topic id (e.g. the "not in the tree any more"
// orphan list, where there's no node to look up isLeaf against).
function scopeForNode(nodeId) {
    const n = nodesById[nodeId];
    const leaf = isLeaf(nodeId);
    return {
        nodeId: nodeId,
        label: (n && n.title) || nodeId,
        isLeaf: leaf,
        leafIds: leaf ? [nodeId] : getDescendantLeafIds(nodeId)
    };
}

// Sums Leitner box-summaries (state numbers) across a set of leaf
// topics. Returns null if none of them have a known deck yet, same
// "no deck yet" convention boxStripHtml()/squareTileContent() already
// use for a single topic.
function aggregateBoxSummary(leafIds) {
    let total = 0, readyTotal = 0, anyDeck = false;
    const boxReady = [0, 0, 0, 0, 0];
    leafIds.forEach(id => {
        const s = window.Flashcards ? window.Flashcards.getBoxSummary(id) : null;
        if (!s) return;
        anyDeck = true;
        total += s.total;
        readyTotal += s.readyTotal;
        (s.boxes || []).forEach((b, i) => { boxReady[i] += b.readyCount || 0; });
    });
    if (!anyDeck) return null;
    return { total: total, readyTotal: readyTotal, boxes: boxReady.map((readyCount, i) => ({ box: i + 1, readyCount: readyCount })) };
}

// Sums 'mcq' event-log stats (history numbers) across a set of leaf
// topics — raw correct/attempted counts first, THEN divided (see the
// spec's aggregation rule); never an average of each topic's own %.
function aggregateMcqEventStats(leafIds) {
    let attempted = 0, correct = 0;
    leafIds.forEach(id => {
        const s = mcqEventStats(id);
        attempted += s.attempted;
        correct += s.correct;
    });
    return { attempted: attempted, correct: correct, accuracy: attempted ? correct / attempted : null };
}

async function loadTree() {
    try {
        const response = await fetch(GOOGLE_SHEET_API);
        if (!response.ok) throw new Error("Google Sheet API failed (" + response.status + ")");
        ingestApiData(await response.json());
        if (!Object.keys(nodesById).length) throw new Error("API returned no nodes");
    } catch (error) {
        console.warn("Practice: Google Sheets API unavailable; using local fallback.", error);
        try {
            const response = await fetch("data/study-data.json");
            if (!response.ok) throw new Error("study-data.json failed (" + response.status + ")");
            ingestSubjects((await response.json()).subjects);
        } catch (jsonError) {
            ingestSubjects((window.STUDY_DATA_FALLBACK || {}).subjects);
        }
    }
    buildChildren();
    treeLoaded = true;
}

// Root -> topic titles, or null if the topic isn't in the tree.
function pathTitles(topicId) {
    if (!nodesById[topicId]) return null;
    const titles = [];
    const seen = new Set();
    let current = nodesById[topicId];
    while (current && !seen.has(current.id)) {
        seen.add(current.id);
        titles.unshift(current.title || "Untitled");
        current = current.parentId ? nodesById[current.parentId] : null;
    }
    return titles;
}

function topicInfo(topicId) {
    const titles = treeLoaded ? pathTitles(topicId) : null;
    return {
        id: topicId,
        known: !!titles,
        title: titles ? titles[titles.length - 1] : "",
        parents: titles ? titles.slice(0, -1).join(" → ") : ""
    };
}

/* -----------------------------------------------------
   State
   ----------------------------------------------------- */

let view = "tree";
let lastQueueSub = "queue-read";           // which Queue sub-tab to return to from the group button
const expanded = new Set();                // tree PARENT nodes currently opened (children visible)
let treeAutoExpanded = false;               // open the nodes that have due cards, once
let scrolledToTopic = false;

// Tree view: the node whose 4-square panel (or non-leaf placeholder) is
// open, and which of the 4 squares is expanded to its full detail render.
// Both reset together when a different node is selected, so only one
// node's panel and only one square's detail are ever open at once.
let selectedNode = null;
let expandedSquare = null;      // "read" | "flashcards" | "mcq" | "future" | null
let nodeAutoSelected = false;   // auto-open ?topic= once the tree has loaded, like treeAutoExpanded

// Phase 4: Queue view's scope filter, shared across the Read/Flashcards/
// MCQ sub-tabs (switching sub-tab keeps whatever branch you narrowed to
// — deliberate, not an oversight: "show me this chapter's queue" reads
// naturally across all three tools). Same path-of-selected-ids shape the
// Phase 3 scopeFilterHtml() was designed around.
let queueFilterPath = [];
let queueReadShowAll = false;   // Read tab's "Show more" (list caps at 5)

function params() {
    try {
        return new URLSearchParams(window.location.search);
    } catch (e) {
        return new URLSearchParams("");
    }
}
function topicParam() {
    return params().get("topic") || "";
}
function isMobile() {
    return window.innerWidth <= MOBILE_MAX;
}
function el(id) {
    return document.getElementById(id);
}
function dueNowOf(t) {
    return (t.overdue || 0) + (t.dueToday || 0);
}

/* -----------------------------------------------------
   Rendering helpers
   ----------------------------------------------------- */

function chipsHtml(t, showReviewed) {
    const out = [];
    if (t.overdue) out.push('<span class="practice-chip practice-chip-overdue">' + plural(t.overdue, "card") + " overdue</span>");
    if (t.dueToday) out.push('<span class="practice-chip practice-chip-today">' + plural(t.dueToday, "card") + " due today</span>");
    if (t.upcoming) out.push('<span class="practice-chip">' + plural(t.upcoming, "card") + " in the next 7 days</span>");
    if (showReviewed && t.reviewed) out.push('<span class="practice-chip practice-chip-quiet">' + t.reviewed + " reviewed</span>");
    return out.join("");
}

function actionsHtml(topicId, dueNow, known) {
    let html = "";
    if (known) html += '<a class="bottom-strip-btn practice-open" href="index.html?openNode=' + encodeURIComponent(topicId) + '">Open topic</a>';
    if (known && dueNow > 0 && mdLinks[topicId]) {
        html += '<button type="button" class="bottom-strip-btn practice-review" data-review="' + escapeHtml(topicId) + '">Review ' + plural(dueNow, "card") + "</button>";
    }
    return html ? '<div class="practice-row-actions">' + html + "</div>" : "";
}

/* -----------------------------------------------------
   Box-strip: the 5-box Leitner view under each topic
   (Tree view). Data comes straight from
   window.Flashcards.getBoxSummary() — no network calls.
   ----------------------------------------------------- */

// Its own expand/collapse state, separate from the tree's `expanded` Set
// so a box or group toggle never collides with a tree-node toggle.
// Keys: "topicId::box" (box open) and "topicId::box::group" (group open).
const boxToggles = new Set();

function shortId(fullId) {
    const cut = String(fullId).lastIndexOf("::");
    return cut >= 0 ? fullId.slice(cut + 2) : String(fullId);
}

function fmtHMS(ms) {
    const s = Math.floor(ms / 1000);
    const h = String(Math.floor(s / 3600)).padStart(2, "0");
    const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
    const sec = String(s % 60).padStart(2, "0");
    return h + ":" + m + ":" + sec;
}

function cardRowHtml(id, statusHtml) {
    return '<div class="box-card-row"><span class="box-card-id">' + escapeHtml(shortId(id)) +
        '</span><span class="box-card-status">' + statusHtml + "</span></div>";
}

function groupHtml(topicId, boxNum, key, label, rows) {
    if (!rows.length) return "";
    const toggleKey = topicId + "::" + boxNum + "::" + key;
    const isOpen = boxToggles.has(toggleKey);
    let html = '<div class="box-group' + (isOpen ? " box-group-open" : "") + '" data-box-toggle="' + escapeHtml(toggleKey) + '">' +
        '<span class="box-group-label">' + label + " · " + rows.length + "</span>" +
        '<span class="box-group-chev">' + (isOpen ? "▾" : "▸") + "</span></div>";
    if (isOpen) {
        html += '<div class="box-card-list">' + rows.map(r => cardRowHtml(r.id, r.statusHtml)).join("") + "</div>";
    }
    return html;
}

// getBoxSummary() already returns dueAt as an exact epoch-ms value, so
// this is just a pass-through — no calendar-midnight conversion needed
// any more (that's what made every same-day card's timer tick in sync).
function timerSpan(kind, dueAtMs) {
    return '<span class="box-timer box-timer-' + kind + '" data-timer-kind="' + kind + '" data-due-at="' + dueAtMs + '">…</span>';
}

function boxHtml(topicId, box) {
    const boxKey = topicId + "::" + box.box;
    const isOpen = boxToggles.has(boxKey);
    const ready = box.readyCount;
    let html = '<div class="box-card ' + (ready > 0 ? "box-ready" : "box-idle") + '">' +
        '<div class="box-card-head" data-box-toggle="' + escapeHtml(boxKey) + '">' +
        '<span class="box-num">Box ' + box.box + " · " + box.intervalDays + "d</span>" +
        '<span class="box-chev">' + (isOpen ? "▾" : "▸") + "</span></div>" +
        '<div class="box-counts">' +
        '<span class="' + (ready > 0 ? "box-count-ready" : "box-count-idle") + '">' + ready + " ready</span>" +
        '<span class="box-count-waiting">' + box.waitingCount + " waiting</span></div>";
    if (isOpen) {
        html += '<div class="box-expand">';
        html += groupHtml(topicId, box.box, "new", "New", box.ready.new.map(id => ({ id, statusHtml: "new" })));
        html += groupHtml(topicId, box.box, "overdue", "Overdue", box.ready.overdue.map(c => ({ id: c.id, statusHtml: timerSpan("elapsed", c.dueAt) })));
        html += groupHtml(topicId, box.box, "dueToday", "Due today", box.ready.dueToday.map(c => ({ id: c.id, statusHtml: timerSpan("elapsed", c.dueAt) })));
        html += groupHtml(topicId, box.box, "waiting", "Waiting", box.waiting.map(w => ({ id: w.id, statusHtml: timerSpan("waiting", w.dueAt) })));
        html += "</div>";
    }
    html += "</div>";
    return html;
}

function boxStripHtml(topicId) {
    const summary = window.Flashcards.getBoxSummary(topicId);
    if (!summary) return "";
    const breakdown = summary.boxes.map(b => "Box " + b.box + ": " + b.readyCount).join(" · ");
    let html = '<div class="box-strip">' +
        '<div class="box-strip-header"><span class="box-strip-total">' + plural(summary.total, "flashcard") + "</span>" +
        (summary.readyTotal > 0
            ? '<button type="button" class="bottom-strip-btn practice-review" data-review="' + escapeHtml(topicId) + '" title="' + escapeHtml(breakdown) + '">Start review (' + summary.readyTotal + ") ⓘ</button>"
            : '<span class="box-strip-idle" title="' + escapeHtml(breakdown) + '">Nothing ready right now ⓘ</span>') +
        "</div>";
    html += '<div class="box-strip-boxes">' + summary.boxes.map(b => boxHtml(topicId, b)).join("") + "</div></div>";
    return html;
}

/* -----------------------------------------------------
   Phase 1 — reusable scoped "tool" components
   (see phase-1-reusable-component.md)

   A `scope` is any node in the content hierarchy. This phase only
   handles leaf-node scopes (isLeaf: true) — parent-node aggregation is
   Phase 3's job. Shape:
     { nodeId: string, label: string, isLeaf: true }

   Phase 2 wires all four into the live Tree view's 4-square grid (see
   squareGridHtml() below). renderFlashcardsPanel, renderReadPanel and
   renderFuturePanel are used as-is for a square's expanded detail — they
   were already synchronous and self-contained. renderMcqPanel is async
   (it fetches the topic's MCQ total), which doesn't fit a synchronous
   render() pass, so the live grid uses its own sync twin
   (mcqPanelHtmlSync, just below window.PracticeTools) backed by the same
   mcqTotalCache; renderMcqPanel itself is untouched and still exported
   for tests.
   ----------------------------------------------------- */

function scopeForTopic(nodeId, node) {
    return { nodeId: nodeId, label: (node && node.title) || nodeId, isLeaf: true };
}

// ---- Flashcards panel: structural extraction only, no behavior change ----
function renderFlashcardsPanel(scope) {
    if (!scope || !scope.nodeId) return "";
    if (scope.isLeaf === false) return aggregateFlashcardsPanelHtml(scope);
    return boxStripHtml(scope.nodeId);
}

// Phase 3: same square, summed across every descendant leaf topic. No
// "Start review" button here — a parent scope has no single deck to
// open a session against; Phase 4's Queue view is where a real
// cross-topic session gets designed (see phase-3-aggregation.md,
// "Start review (N)" note — deliberately deferred, not a Phase 3 gap).
function aggregateFlashcardsPanelHtml(scope) {
    const leafIds = scope.leafIds || getDescendantLeafIds(scope.nodeId);
    const agg = aggregateBoxSummary(leafIds);
    if (!agg) {
        return '<div class="box-strip box-strip-aggregate"><div class="box-strip-header">' +
            '<span class="box-strip-idle">No flashcard decks opened yet under this node.</span></div></div>';
    }
    const breakdown = agg.boxes.map(b => "Box " + b.box + ": " + b.readyCount).join(" · ");
    return '<div class="box-strip box-strip-aggregate">' +
        '<div class="box-strip-header"><span class="box-strip-total">' + plural(agg.total, "flashcard") + " across " + plural(leafIds.length, "topic") + "</span>" +
        (agg.readyTotal > 0
            ? '<span class="box-strip-idle" title="' + escapeHtml(breakdown) + '">' + agg.readyTotal + " ready across this scope ⓘ</span>"
            : '<span class="box-strip-idle" title="' + escapeHtml(breakdown) + '">Nothing ready right now ⓘ</span>') +
        "</div></div>";
}

// ---- MCQ panel: read-only summary (total / attempted / accuracy) ----
// MCQ due/priority logic is still explicitly deferred; this is just a
// counts display plus a "Solve" button into the existing MCQ flow.

// Session-lifetime cache: the total-questions-in-scope count needs a
// network call (there is no local/synchronous source for it today), so
// don't refetch it every re-render — only once per topic per page load.
const mcqTotalCache = new Map(); // nodeId -> count, or null if unknown

async function fetchMcqTotalForTopic(nodeId) {
    if (mcqTotalCache.has(nodeId)) return mcqTotalCache.get(nodeId);
    let total = null;
    try {
        const res = await fetch(GOOGLE_SHEET_API + "?action=get_mcqs&node_id=" + encodeURIComponent(nodeId));
        if (!res.ok) throw new Error("get_mcqs failed (" + res.status + ")");
        const data = await res.json();
        const rows = (data && data.mcqs) || [];
        // Same "hide archived" rule mcq.js applies when it loads a topic's MCQs.
        total = rows.filter(r => String(r.status || "").trim().toLowerCase() !== "archived").length;
    } catch (err) {
        console.warn("[Notebook Alpha] Could not fetch MCQ total for " + nodeId + ".", err);
        total = null; // unknown, not zero — the panel shows "—" rather than a false 0
    }
    mcqTotalCache.set(nodeId, total);
    return total;
}

// Reads 'mcq' events for one topic out of the Phase 0 event log and
// reduces them to one outcome per question (the LATEST attempt wins,
// mirroring the `changed`-guarded de-dupe mcq.js already applies when
// it *writes* these events on a changed answer) — so re-answering a
// question doesn't inflate "attempted" or skew accuracy.
function mcqEventStats(nodeId) {
    const events = (window.EventLog ? window.EventLog.readLog() : [])
        .filter(e => e && e.type === "mcq" && e.topicId === nodeId);
    const latestByQuestion = new Map();
    events.forEach(e => {
        const prev = latestByQuestion.get(e.questionId);
        if (!prev || e.t > prev.t) latestByQuestion.set(e.questionId, e);
    });
    const attempts = Array.from(latestByQuestion.values());
    const attempted = attempts.length;
    const correct = attempts.filter(e => e.correct).length;
    // Deliberately correct/attempts, NOT an average of per-question
    // percentages — matters once Phase 3 aggregates a parent scope.
    return { attempted: attempted, correct: correct, accuracy: attempted ? correct / attempted : null };
}

async function renderMcqPanel(scope) {
    if (!scope || !scope.nodeId) return "";
    if (scope.isLeaf === false) return aggregateMcqPanelHtml(scope);
    const stats = mcqEventStats(scope.nodeId);
    const total = await fetchMcqTotalForTopic(scope.nodeId);
    const totalLabel = total == null ? "—" : String(total);
    const accLabel = stats.accuracy == null ? "—" : Math.round(stats.accuracy * 100) + "%";
    return '<div class="tool-panel tool-panel-mcq" data-scope="' + escapeHtml(scope.nodeId) + '">' +
        '<div class="tool-panel-title">MCQ</div>' +
        '<div class="tool-panel-sub">' + stats.attempted + " / " + totalLabel + " attempted · " + accLabel + " accuracy</div>" +
        '<button type="button" class="bottom-strip-btn practice-mcq-solve" data-mcq-solve="' + escapeHtml(scope.nodeId) + '">Solve</button>' +
        "</div>";
}

// Phase 3 aggregate twin — totals summed with a real await per leaf (this
// function is already async, unlike the live grid's mcqPanelHtmlSync, so
// it can just fetch instead of needing a cache-and-reconcile dance). No
// "Solve" button: there's no single topic id to hand mcq.html.
async function aggregateMcqPanelHtml(scope) {
    const leafIds = scope.leafIds || getDescendantLeafIds(scope.nodeId);
    const stats = aggregateMcqEventStats(leafIds);
    const totals = await Promise.all(leafIds.map(fetchMcqTotalForTopic));
    const known = totals.filter(t => t != null);
    const totalLabel = known.length ? String(known.reduce((a, b) => a + b, 0)) : "—";
    const accLabel = stats.accuracy == null ? "—" : Math.round(stats.accuracy * 100) + "%";
    return '<div class="tool-panel tool-panel-mcq" data-scope="' + escapeHtml(scope.nodeId) + '">' +
        '<div class="tool-panel-title">MCQ</div>' +
        '<div class="tool-panel-sub">' + stats.attempted + " / " + totalLabel + " attempted · " + accLabel + " accuracy across " + plural(leafIds.length, "topic") + "</div>" +
        "</div>";
}

// ---- Read panel: read-only summary from the event log's 'read' events ----
// NOTE on the New/Continue/Revisit split: the spec describes "Continue"
// as the last session being "very short / below the completion floor
// from Phase 0" — but Phase 0's floor (20s) means anything below it is
// never logged at all, so the event log alone can't distinguish "never
// read" from "read only briefly". Until Phase 4 defines real completion
// tracking, this uses a judgment-call threshold (READ_CONTINUE_CEILING_SECS)
// on the last LOGGED session's length to approximate "started but
// probably didn't get through it". Flagged here so it's easy to find
// and replace when Phase 4 lands.
const READ_CONTINUE_CEILING_SECS = 120;

function readPanelState(nodeId) {
    const events = (window.EventLog ? window.EventLog.readLog() : [])
        .filter(e => e && e.type === "read" && e.topicId === nodeId);
    if (!events.length) return { state: "new", lastReadAt: null, lastSecs: null };
    const last = events.reduce((a, b) => (b.t > a.t ? b : a));
    const state = (Number(last.secs) || 0) < READ_CONTINUE_CEILING_SECS ? "continue" : "revisit";
    return { state: state, lastReadAt: last.t, lastSecs: last.secs };
}

function renderReadPanel(scope) {
    if (!scope || !scope.nodeId) return "";
    if (scope.isLeaf === false) return aggregateReadPanelHtml(scope);
    const info = readPanelState(scope.nodeId);
    let label, sub;
    if (info.state === "new") {
        label = "New";
        sub = "Not opened yet.";
    } else if (info.state === "continue") {
        label = "Continue";
        sub = "Started last time (~" + info.lastSecs + "s).";
    } else {
        const d = Math.floor((Date.now() - info.lastReadAt) / 86400000);
        label = "Revisit";
        sub = "Last read " + (d <= 0 ? "today" : plural(d, "day") + " ago") + ".";
    }
    return '<div class="tool-panel tool-panel-read tool-panel-state-' + info.state + '" data-scope="' + escapeHtml(scope.nodeId) + '">' +
        '<div class="tool-panel-title">Read <span class="tool-panel-state">' + label + "</span></div>" +
        '<div class="tool-panel-sub">' + escapeHtml(sub) + "</div>" +
        '<a class="bottom-strip-btn practice-open" href="index.html?openNode=' + encodeURIComponent(scope.nodeId) + '">Open topic</a>' +
        "</div>";
}

// Phase 3 aggregate twin — "X of Y topics read" instead of one date,
// per the spec (a single last-read date stops meaning anything once a
// scope spans dozens of topics).
function aggregateReadPanelHtml(scope) {
    const leafIds = scope.leafIds || getDescendantLeafIds(scope.nodeId);
    let readCount = 0, revisitCount = 0;
    leafIds.forEach(id => {
        const st = readPanelState(id).state;
        if (st !== "new") readCount++;
        if (st === "revisit") revisitCount++;
    });
    const sub = readCount + " of " + plural(leafIds.length, "topic") + " read" +
        (revisitCount ? " · " + plural(revisitCount, "topic") + " ready to revisit" : "");
    return '<div class="tool-panel tool-panel-read" data-scope="' + escapeHtml(scope.nodeId) + '">' +
        '<div class="tool-panel-title">Read</div>' +
        '<div class="tool-panel-sub">' + escapeHtml(sub) + "</div>" +
        "</div>";
}

// ---- Future/placeholder panel: no logic, just reserves the 4th square ----
function renderFuturePanel(scope) {
    return '<div class="tool-panel tool-panel-future" aria-disabled="true">' +
        '<div class="tool-panel-title">Coming soon</div>' +
        '<div class="tool-panel-sub">A future practice aspect will live here.</div>' +
        "</div>";
}

// Exposed for Phase 2 (which wires these into the new shell) and for
// tests, same spirit as window.Flashcards / window.EventLog elsewhere.
window.PracticeTools = {
    scopeForTopic: scopeForTopic,
    scopeForNode: scopeForNode,
    isLeaf: isLeaf,
    getDescendantLeafIds: getDescendantLeafIds,
    getAllLeafIds: getAllLeafIds,
    renderFlashcardsPanel: renderFlashcardsPanel,
    renderMcqPanel: renderMcqPanel,
    renderReadPanel: renderReadPanel,
    renderFuturePanel: renderFuturePanel,
    renderScopeFilter: renderScopeFilter,
    __test: {
        mcqEventStats: mcqEventStats,
        readPanelState: readPanelState,
        fetchMcqTotalForTopic: fetchMcqTotalForTopic,
        aggregateBoxSummary: aggregateBoxSummary,
        aggregateMcqEventStats: aggregateMcqEventStats,
        readGapState: readGapState,
        snoozeTopic: snoozeTopic,
        markRemembered: markRemembered
    }
};

/* -----------------------------------------------------
   Phase 2 — the 4-square grid (see phase-2-new-shell.md)

   Each square has two independent click targets: its BODY (toggles the
   full detail render below the grid) and its BUTTON (jumps straight
   into the action). Event delegation in bindEvents() keeps these
   independent by checking closest(".practice-square-btn") first and
   skipping the body-toggle branch when it matches — the delegated-click
   equivalent of the button handler calling stopPropagation().
   ----------------------------------------------------- */

// Same total as fetchMcqTotalForTopic, but read synchronously from the
// cache so a render() pass never has to await anything. First call for a
// topic returns "…" and kicks off the real fetch in the background;
// ensureMcqTotalLoaded() re-renders once it lands.
function ensureMcqTotalLoaded(nodeId) {
    if (mcqTotalCache.has(nodeId)) return;
    fetchMcqTotalForTopic(nodeId).then(() => {
        if (selectedNode === nodeId) scheduleRender();
    });
}

// Sync twin of renderMcqPanel (see the Phase 2 note above the Phase 1
// section) — same markup, same data-mcq-solve button, but never awaits.
function mcqPanelHtmlSync(scope) {
    const nodeId = scope.nodeId;
    ensureMcqTotalLoaded(nodeId);
    const stats = mcqEventStats(nodeId);
    const cached = mcqTotalCache.has(nodeId) ? mcqTotalCache.get(nodeId) : undefined;
    const totalLabel = cached === undefined ? "…" : (cached == null ? "—" : String(cached));
    const accLabel = stats.accuracy == null ? "—" : Math.round(stats.accuracy * 100) + "%";
    return '<div class="tool-panel tool-panel-mcq" data-scope="' + escapeHtml(nodeId) + '">' +
        '<div class="tool-panel-title">MCQ</div>' +
        '<div class="tool-panel-sub">' + stats.attempted + " / " + totalLabel + " attempted · " + accLabel + " accuracy</div>" +
        '<button type="button" class="bottom-strip-btn practice-mcq-solve" data-mcq-solve="' + escapeHtml(nodeId) + '">Solve</button>' +
        "</div>";
}

const SQUARE_KINDS = ["read", "flashcards", "mcq", "future"];

// Compact tile content for one square — title, one-line stat, and its
// jump-straight-in button (or none, for Future). Deliberately thinner
// than the full renderXPanel() output, which only shows up once the
// square's body is clicked.
// Phase 3: same tile shape, aggregated across scope.leafIds, and with no
// buttonHtml — a parent scope has no single action to jump straight
// into (see phase-3-aggregation.md's Start-review decision). The
// square's BODY click is the only interaction at this level; it opens
// the one-level children breakdown (childrenSummaryHtml, below) rather
// than the full leaf detail (box-strip / MCQ breakdown / read detail).
function squareTileContentAggregate(kind, scope) {
    const leafIds = scope.leafIds;
    if (kind === "read") {
        let readCount = 0;
        leafIds.forEach(id => { if (readPanelState(id).state !== "new") readCount++; });
        return { title: "Read", stat: readCount + " of " + plural(leafIds.length, "topic") + " read", buttonHtml: "" };
    }
    if (kind === "flashcards") {
        const agg = aggregateBoxSummary(leafIds);
        const stat = !agg ? "No decks yet" : agg.readyTotal > 0 ? plural(agg.readyTotal, "card") + " ready" : "Nothing ready";
        return { title: "Flashcards", stat: stat, buttonHtml: "" };
    }
    if (kind === "mcq") {
        const stats = aggregateMcqEventStats(leafIds);
        const accLabel = stats.accuracy == null ? "—" : Math.round(stats.accuracy * 100) + "%";
        return { title: "MCQ", stat: stats.attempted + " attempted · " + accLabel + " accuracy", buttonHtml: "" };
    }
    return { title: "Future", stat: "Coming soon", buttonHtml: "" };
}

function squareTileContent(kind, scope) {
    const nodeId = scope.nodeId;
    if (scope.isLeaf === false) return squareTileContentAggregate(kind, scope);
    if (kind === "read") {
        const info = readPanelState(nodeId);
        const stat = info.state === "new" ? "Not opened yet"
            : info.state === "continue" ? "Continue reading"
            : "Ready to revisit";
        return { title: "Read", stat: stat,
            buttonHtml: '<a class="practice-square-btn bottom-strip-btn" href="index.html?openNode=' + encodeURIComponent(nodeId) + '">Open topic</a>' };
    }
    if (kind === "flashcards") {
        const summary = window.Flashcards ? window.Flashcards.getBoxSummary(nodeId) : null;
        const ready = summary ? summary.readyTotal : 0;
        const stat = !summary ? "No deck yet" : ready > 0 ? plural(ready, "card") + " ready" : "Nothing ready";
        return { title: "Flashcards", stat: stat,
            buttonHtml: ready > 0
                ? '<button type="button" class="practice-square-btn bottom-strip-btn" data-review="' + escapeHtml(nodeId) + '">Start review (' + ready + ')</button>'
                : "" };
    }
    if (kind === "mcq") {
        const stats = mcqEventStats(nodeId);
        ensureMcqTotalLoaded(nodeId);
        const cached = mcqTotalCache.has(nodeId) ? mcqTotalCache.get(nodeId) : undefined;
        const totalLabel = cached === undefined ? "…" : (cached == null ? "—" : String(cached));
        return { title: "MCQ", stat: stats.attempted + " / " + totalLabel + " attempted",
            buttonHtml: '<button type="button" class="practice-square-btn bottom-strip-btn" data-mcq-solve="' + escapeHtml(nodeId) + '">Solve</button>' };
    }
    return { title: "Future", stat: "Coming soon", buttonHtml: "" };
}

// One compact row's worth of stat text for a given square kind, scoped
// to a single child node (which may itself be a leaf or another
// branch) — used only by childrenSummaryHtml's one-level drill-down.
function childKindStat(kind, childScope) {
    const leafIds = childScope.leafIds;
    if (kind === "read") {
        let readCount = 0;
        leafIds.forEach(id => { if (readPanelState(id).state !== "new") readCount++; });
        return childScope.isLeaf ? squareTileContent("read", childScope).stat : readCount + " of " + plural(leafIds.length, "topic") + " read";
    }
    if (kind === "flashcards") {
        const agg = aggregateBoxSummary(leafIds);
        return !agg ? "No decks yet" : agg.readyTotal > 0 ? plural(agg.readyTotal, "card") + " ready" : "Nothing ready";
    }
    if (kind === "mcq") {
        const stats = aggregateMcqEventStats(leafIds);
        const accLabel = stats.accuracy == null ? "—" : Math.round(stats.accuracy * 100) + "%";
        return stats.attempted + " attempted · " + accLabel;
    }
    return "Coming soon";
}

// Phase 3, section 4: a parent square's body click shows ONE level of
// children (not every descendant leaf's full detail at once). Each row
// is just a name + this square's own key number; clicking a row is a
// navigation action (drill into that child's scope), reusing the same
// data-select-node delegation the tree's own row titles already use —
// distinct from this square's body/button click, same as the spec
// requires.
function childrenSummaryHtml(kind, scope) {
    const kids = childrenOf[scope.nodeId] || [];
    if (!kids.length) return '<div class="practice-summary">No sub-topics here.</div>';
    return '<div class="practice-children-summary">' + kids.map(id => {
        const n = nodesById[id];
        const childScope = scopeForNode(id);
        return '<div class="practice-children-summary-row" data-select-node="' + escapeHtml(id) + '">' +
            '<span class="practice-children-summary-title">' + escapeHtml((n && n.title) || id) + "</span>" +
            '<span class="practice-children-summary-stat">' + escapeHtml(childKindStat(kind, childScope)) + "</span>" +
            "</div>";
    }).join("") + "</div>";
}

function squareDetailHtml(kind, scope) {
    if (scope.isLeaf === false) return childrenSummaryHtml(kind, scope);
    if (kind === "read") return renderReadPanel(scope);
    if (kind === "flashcards") return renderFlashcardsPanel(scope);
    if (kind === "mcq") return mcqPanelHtmlSync(scope);
    return renderFuturePanel(scope);
}

function squareGridHtml(scope) {
    const tiles = SQUARE_KINDS.map(kind => {
        const c = squareTileContent(kind, scope);
        const isFuture = kind === "future";
        const isExpanded = expandedSquare === kind;
        return '<div class="practice-square' + (isExpanded ? " practice-square-expanded" : "") +
            (isFuture ? " practice-square-future" : "") + '"' +
            (isFuture ? "" : ' data-square-body="' + kind + '"') + '>' +
            '<div class="practice-square-title">' + c.title + "</div>" +
            '<div class="practice-square-stat">' + escapeHtml(c.stat) + "</div>" +
            c.buttonHtml +
            "</div>";
    }).join("");

    const detail = expandedSquare
        ? '<div class="practice-square-detail">' + squareDetailHtml(expandedSquare, scope) + "</div>"
        : "";

    return '<div class="practice-square-grid">' + tiles + "</div>" + detail;
}

/* -----------------------------------------------------
   Phase 3, section 5 — recursive scope filter

   Deliberately reuses the real childrenOf tree (same data Tree view
   walks) so a branch that is deeper than Subject > Course > Unit >
   Chapter > Topic > Subtopic needs no change here — each step just
   asks "does the currently selected node have children?" and stops the
   moment the answer is no (isLeaf), instead of assuming a fixed number
   of levels. scopeFilterHtml/scopeFilterOptionsHtml below are the pure,
   reusable part; Queue view (Phase 4, further down) is what actually
   mounts this above its three real lists, driven off the shared
   queueFilterPath state rather than a private closure — see
   renderScopeFilter's own doc comment for why.
   ----------------------------------------------------- */
function scopeFilterOptionsHtml(nodeIds, selectedId) {
    return '<option value="">—</option>' + nodeIds.map(id => {
        const n = nodesById[id];
        return '<option value="' + escapeHtml(id) + '"' + (id === selectedId ? " selected" : "") + ">" +
            escapeHtml((n && n.title) || id) + "</option>";
    }).join("");
}

function scopeFilterHtml(path) {
    let html = '<div class="practice-scope-filter" data-scope-filter="1">';
    let parent = "";
    for (let i = 0; i <= path.length; i++) {
        const options = childrenOf[parent] || [];
        if (!options.length) break; // this branch has nothing left to narrow by
        const selectedId = path[i] || "";
        html += '<select class="practice-scope-filter-step" data-scope-filter-step="' + i + '">' +
            scopeFilterOptionsHtml(options, selectedId) + "</select>";
        if (!selectedId) break; // wait for a pick before offering the next level down
        parent = selectedId;
        if (isLeaf(selectedId)) break; // hit an actual topic: no deeper level exists
    }
    return html + "</div>";
}

// Renders the filter chain into `container` and calls onChange(nodeId
// or null) every time the effective (deepest-selected) scope changes.
// Returns a repaint function so a caller can force a refresh (e.g. after
// a content reload) without re-registering the listener.
//
// NOT used by Queue view (Phase 4) below — see the note at
// queueFilterPath's declaration. Kept only as the literal, reusable
// (container, onChange) component the Phase 3 doc asked for, in case a
// future standalone mount (a modal, a different page) wants one; Queue
// view itself needs the filter's selected path to survive across full
// render() rebuilds, which a private closure here can't do, so it reads
// scopeFilterHtml() directly against the shared queueFilterPath state
// and wires changes through the same delegated listener as everything
// else in this file (see bindEvents' "change" listener).
function renderScopeFilter(container, onChange) {
    let path = [];
    function paint() { container.innerHTML = scopeFilterHtml(path); }
    container.addEventListener("change", event => {
        const select = event.target.closest("[data-scope-filter-step]");
        if (!select) return;
        const step = Number(select.dataset.scopeFilterStep);
        path = path.slice(0, step);
        if (select.value) path.push(select.value);
        paint();
        onChange(path.length ? path[path.length - 1] : null);
    });
    paint();
    return paint;
}

// Live HH:MM:SS ticker for expanded Waiting cards. Re-queries the DOM
// every second rather than tracking timers per render, so it survives
// render() rebuilding the tree without any extra bookkeeping. Cheap: only
// cards inside an OPEN Waiting group exist in the DOM at all.
function tickBoxTimers() {
    const now = Date.now();
    document.querySelectorAll(".box-timer[data-due-at]").forEach(elx => {
        const target = Number(elx.dataset.dueAt);
        const diff = target - now; // positive = target is still in the future
        if (elx.dataset.timerKind === "elapsed") {
            elx.textContent = "+" + fmtHMS(Math.abs(diff)); // overdue/due-today: always in the past
        } else {
            elx.textContent = diff > 0 ? "−" + fmtHMS(diff) : "ready now";
        }
    });
}

function topicRowHtml(topicId, chipSource, dueNow, opts) {
    opts = opts || {};
    const info = topicInfo(topicId);
    const hi = topicParam() === topicId ? " practice-row-highlight" : "";
    const name = info.known
        ? '<div class="practice-row-title">' + escapeHtml(info.title || "Untitled") + "</div>" +
          (info.parents ? '<div class="practice-row-path">' + escapeHtml(info.parents) + "</div>" : "")
        : '<div class="practice-row-title practice-row-unknown">Topic not found <span class="practice-row-id">(' + escapeHtml(topicId) + ")</span></div>" +
          '<div class="practice-row-path">It may have been deleted.</div>';
    const extra = opts.extra ? '<div class="practice-row-path">' + opts.extra + "</div>" : "";
    return '<div class="practice-row' + hi + '" data-topic-id="' + escapeHtml(topicId) + '">' +
        '<div class="practice-row-main">' + name + extra + '<div class="practice-chips">' + chipsHtml(chipSource, opts.showReviewed) + "</div></div>" +
        (opts.noActions ? "" : actionsHtml(topicId, dueNow, info.known)) + "</div>";
}

function sortTopicIds(ids, summary) {
    return ids.slice().sort((a, b) => {
        const ia = topicInfo(a), ib = topicInfo(b);
        const ta = summary.topics[a], tb = summary.topics[b];
        return (dueNowOf(tb) - dueNowOf(ta)) ||
            ((ia.parents + ia.title).localeCompare(ib.parents + ib.title));
    });
}

function loadingHtml() {
    return '<div class="practice-loading">Loading topic names…</div>';
}

/* -----------------------------------------------------
   Views
   ----------------------------------------------------- */

// ---- Tree view: by WHERE ----
function makeStats(summary) {
    const memo = {};
    const visiting = new Set();
    function stats(id) {
        if (memo[id]) return memo[id];
        const st = { overdue: 0, dueToday: 0, upcoming: 0, later: 0, reviewed: 0 };
        if (visiting.has(id)) return st; // corrupt parent loop: don't recurse forever
        visiting.add(id);
        const own = summary.topics[id];
        if (own) {
            ["overdue", "dueToday", "upcoming", "later", "reviewed"].forEach(k => { st[k] += own[k] || 0; });
        }
        (childrenOf[id] || []).forEach(child => {
            const c = stats(child);
            ["overdue", "dueToday", "upcoming", "later", "reviewed"].forEach(k => { st[k] += c[k]; });
        });
        visiting.delete(id);
        memo[id] = st;
        return st;
    }
    return stats;
}

function ancestorsOf(id) {
    const out = [];
    const seen = new Set([id]);
    let current = nodesById[id];
    while (current && current.parentId && nodesById[current.parentId] && !seen.has(current.parentId)) {
        out.push(current.parentId);
        seen.add(current.parentId);
        current = nodesById[current.parentId];
    }
    return out;
}

function expandForDue(knownDeckIds) {
    knownDeckIds.forEach(id => {
        const bs = window.Flashcards.getBoxSummary(id);
        if (bs && bs.readyTotal > 0) ancestorsOf(id).forEach(a => expanded.add(a));
    });
    const topic = topicParam();
    if (topic && nodesById[topic]) ancestorsOf(topic).forEach(a => expanded.add(a));
}

function treeViewHtml(summary) {
    const knownDeckIds = new Set(window.Flashcards ? window.Flashcards.getKnownTopicIds() : []);
    if (!treeLoaded) return loadingHtml();

    if (!treeAutoExpanded) {
        treeAutoExpanded = true;
        expandForDue(knownDeckIds);
    }
    const highlight = topicParam();
    if (!nodeAutoSelected) {
        nodeAutoSelected = true;
        if (highlight && nodesById[highlight]) selectedNode = highlight;
    }

    const stats = makeStats(summary);

    function node(id, depth) {
        // Phase 3: the tree now mirrors the home page ToC in full —
        // every node renders, whether or not a flashcard deck has ever
        // been opened for anything under it (that used to gate display
        // here; see scopeForNode()'s isLeaf, which is the real content
        // hierarchy, not a localStorage notion).
        const kids = (childrenOf[id] || []).map(k => node(k, depth + 1)).join("");
        const n = nodesById[id];
        const isOpen = expanded.has(id);
        const isLeafTopic = isLeaf(id);
        const isSelected = selectedNode === id;
        const toggle = kids
            ? '<button type="button" class="practice-tree-toggle" data-toggle="' + escapeHtml(id) + '" aria-expanded="' + isOpen + '" aria-label="' + (isOpen ? "Collapse" : "Expand") + '">' + (isOpen ? "▾" : "▸") + "</button>"
            : '<span class="practice-tree-toggle practice-tree-leaf" aria-hidden="true"></span>';

        const title = '<div class="practice-row-title practice-row-selectable" data-select-node="' + escapeHtml(id) + '" aria-expanded="' + isSelected + '">' +
            escapeHtml(n.title || "Untitled") + "</div>";

        let body;
        if (isLeafTopic) {
            // One-line glance stays visible either way, so the tree stays
            // scannable without opening every topic's panel at once.
            const bs = knownDeckIds.has(id) && window.Flashcards ? window.Flashcards.getBoxSummary(id) : null;
            const glance = !bs ? "No deck yet" : bs.readyTotal > 0 ? plural(bs.readyTotal, "card") + " ready" : "Nothing ready right now";
            body = title +
                '<div class="practice-row-glance">' + escapeHtml(glance) + "</div>" +
                (isSelected ? squareGridHtml(scopeForNode(id)) : "");
        } else {
            const st = stats(id);
            const chips = (st.overdue || st.dueToday || st.upcoming || st.later || st.reviewed)
                ? '<div class="practice-chips">' + chipsHtml(st, true) + "</div>"
                : "";
            body = title + chips +
                (isSelected ? squareGridHtml(scopeForNode(id)) : "");
        }

        // data-highlight-state: reserved hook only, no styling or logic
        // yet — a later phase decides what "activity in this branch"
        // should mean and paints it (grey/green or otherwise). Kept
        // neutral on purpose so this phase makes no visual change.
        const row = '<div class="practice-tree-row' + (highlight === id ? " practice-row-highlight" : "") + '" data-highlight-state="pending" style="--depth:' + depth + '" data-node-id="' + escapeHtml(id) + '">' +
            toggle +
            '<div class="practice-row-main">' + body + "</div>" +
            "</div>";
        return row + (kids && isOpen ? '<div class="practice-tree-children">' + kids + "</div>" : "");
    }

    let html = '<div class="practice-tree-tools"><button type="button" class="bottom-strip-btn" data-expand-all="1">Expand all</button> <button type="button" class="bottom-strip-btn" data-collapse-all="1">Collapse all</button></div>';
    html += (childrenOf[""] || []).map(id => node(id, 0)).join("");

    // Decks that exist locally but whose topic id is no longer in the tree.
    const orphans = Array.from(knownDeckIds).filter(id => !nodesById[id]);
    if (orphans.length) {
        html += '<div class="practice-group-title">Not in the tree any more</div>' +
            orphans.map(id => '<div class="practice-tree-row" data-node-id="' + escapeHtml(id) + '">' +
                '<span class="practice-tree-toggle practice-tree-leaf" aria-hidden="true"></span>' +
                '<div class="practice-row-main"><div class="practice-row-title practice-row-unknown">Topic not found <span class="practice-row-id">(' + escapeHtml(id) + ")</span></div>" +
                renderFlashcardsPanel(scopeForTopic(id, null)) + "</div></div>").join("");
    }
    return html;
}

/* -----------------------------------------------------
   Render + navigation
   ----------------------------------------------------- */

function getSummary() {
    return window.Flashcards ? window.Flashcards.getDueSummary() : { total: 0, overdue: 0, dueToday: 0, upcoming: 0, later: 0, reviewed: 0, topics: {} };
}

function setBadge(id, count) {
    const badge = el(id);
    if (!badge) return;
    badge.textContent = count > 99 ? "99+" : String(count);
    badge.hidden = count === 0;
}

/* -----------------------------------------------------
   Phase 4 — Queue view: flat, cross-topic, scope-filterable lists
   (see phase-4-queue-view.md)

   Tree view = navigation ("go into this topic"). Queue view = a filter
   on one flat list ("give me the priority list, optionally narrowed") —
   selecting a scope-filter value below never navigates anywhere, it
   just re-renders the same list with a different leafIds set.
   ----------------------------------------------------- */

function currentQueueFilterId() {
    return queueFilterPath.length ? queueFilterPath[queueFilterPath.length - 1] : null;
}

function queueScopeIds() {
    const filterId = currentQueueFilterId();
    return filterId ? getDescendantLeafIds(filterId) : getAllLeafIds();
}

/* ---- Read sub-tab: gap-ladder state ----

   The 1d -> 3d -> 7d -> 21d ladder is derived purely from the event
   log's own 'read' events, so it stays correct across devices for free
   (event-log.js already merges by union across devices) instead of
   needing its own synced store. Only the two genuinely manual actions
   -- "Later" (snooze) and "Remembered" (advance without an actual read)
   -- get their own tiny localStorage entry, since neither could ever be
   represented honestly by a real read event. A "Remembered" click is
   folded into the exact same chronological simulation as a real
   qualifying read (same floor, same "only advances if actually due"
   rule), so the two paths can't drift apart into different logic. */
const READ_GAP_STAGES_DAYS = [1, 3, 7, 21];
const READ_OVERRIDES_KEY = "practice:readOverrides";

function readOverrides() {
    try {
        return JSON.parse(localStorage.getItem(READ_OVERRIDES_KEY) || "{}") || {};
    } catch (e) {
        return {};
    }
}
function saveReadOverrides(map) {
    try { localStorage.setItem(READ_OVERRIDES_KEY, JSON.stringify(map)); } catch (e) { /* storage full/unavailable: override just won't persist */ }
}
function snoozeTopic(topicId) {
    const all = readOverrides();
    all[topicId] = Object.assign({}, all[topicId], { snoozedUntil: Date.now() + 3 * 86400000 });
    saveReadOverrides(all);
}
function markRemembered(topicId) {
    const all = readOverrides();
    const entry = Object.assign({}, all[topicId]);
    entry.remembered = (entry.remembered || []).concat(Date.now());
    all[topicId] = entry;
    saveReadOverrides(all);
}

// One state per topic: "new" (never read/remembered), "continue"
// (started, below the completion floor), "revisit" (gap has passed),
// "settled" (read, gap not passed yet — nothing to do), or "snoozed"
// (manually hidden via "Later"). Only new/continue/revisit belong in
// the Queue list; settled and snoozed are deliberately left out below.
function readGapState(topicId) {
    const events = (window.EventLog ? window.EventLog.readLog() : [])
        .filter(e => e && e.type === "read" && e.topicId === topicId)
        .map(e => ({ t: e.t, secs: Number(e.secs) || 0, manual: false }));
    const override = readOverrideFor(topicId);
    (override.remembered || []).forEach(t => events.push({ t: t, secs: READ_CONTINUE_CEILING_SECS, manual: true }));
    events.sort((a, b) => a.t - b.t);

    if (!events.length) return { state: "new", lastReadAt: null, lastSecs: null, nextRevisitAt: null };

    let stage = -1;           // -1 = ladder not started (no qualifying read yet)
    let nextRevisitAt = null;
    let lastReadAt = null, lastSecs = null, lastWasShort = false;

    events.forEach(e => {
        lastReadAt = e.t;
        lastSecs = e.secs;
        lastWasShort = e.secs < READ_CONTINUE_CEILING_SECS && !e.manual;
        if (lastWasShort) return; // below the floor: doesn't touch the ladder
        if (stage === -1) {
            stage = 0; // first qualifying read starts the ladder at 1 day
        } else if (nextRevisitAt !== null && e.t >= nextRevisitAt) {
            stage = Math.min(stage + 1, READ_GAP_STAGES_DAYS.length - 1); // was actually due, and got read again: advance
        } // else: re-read early, before it was due — ladder doesn't move
        nextRevisitAt = e.t + READ_GAP_STAGES_DAYS[stage] * 86400000;
    });

    if (lastWasShort) return { state: "continue", lastReadAt: lastReadAt, lastSecs: lastSecs, nextRevisitAt: null };
    const now = Date.now();
    if ((override.snoozedUntil || 0) > now) return { state: "snoozed", lastReadAt: lastReadAt, lastSecs: lastSecs, nextRevisitAt: nextRevisitAt };
    if (nextRevisitAt !== null && nextRevisitAt <= now) return { state: "revisit", lastReadAt: lastReadAt, lastSecs: lastSecs, nextRevisitAt: nextRevisitAt };
    return { state: "settled", lastReadAt: lastReadAt, lastSecs: lastSecs, nextRevisitAt: nextRevisitAt };
}
function readOverrideFor(topicId) {
    return readOverrides()[topicId] || {};
}

// Lower sorts first: gently-due (Revisit, most overdue-for-revisit)
// ahead of Continue (already started) ahead of New (never opened) —
// per the doc's "surfaces the most gently due first" rule. New topics
// have no due-by date to rank within, so they fall back to path/title
// order (same tie-break sortTopicIds already uses elsewhere).
function readQueuePriority(gap) {
    if (gap.state === "revisit") return 0;
    if (gap.state === "continue") return 1;
    return 2; // "new"
}

function readQueueItems(leafIds) {
    return leafIds
        .map(id => ({ id: id, gap: readGapState(id) }))
        .filter(item => item.gap.state === "new" || item.gap.state === "continue" || item.gap.state === "revisit")
        .sort((a, b) => {
            const pa = readQueuePriority(a.gap), pb = readQueuePriority(b.gap);
            if (pa !== pb) return pa - pb;
            if (pa === 0) return (Date.now() - a.gap.nextRevisitAt) < (Date.now() - b.gap.nextRevisitAt) ? 1 : -1;
            const ia = topicInfo(a.id), ib = topicInfo(b.id);
            return (ia.parents + ia.title).localeCompare(ib.parents + ib.title);
        });
}

function readQueueRowHtml(id, gap) {
    const info = topicInfo(id);
    let label, sub;
    if (gap.state === "new") { label = "New"; sub = "Not started yet."; }
    else if (gap.state === "continue") { label = "Continue"; sub = "Started last time (~" + gap.lastSecs + "s)."; }
    else {
        const d = Math.floor((Date.now() - gap.lastReadAt) / 86400000);
        label = "Revisit"; sub = "Last read " + (d <= 0 ? "today" : plural(d, "day") + " ago") + ".";
    }
    const name = info.known
        ? '<div class="practice-row-title">' + escapeHtml(info.title || "Untitled") + "</div>" +
          (info.parents ? '<div class="practice-row-path">' + escapeHtml(info.parents) + "</div>" : "")
        : '<div class="practice-row-title practice-row-unknown">Topic not found <span class="practice-row-id">(' + escapeHtml(id) + ")</span></div>";
    return '<div class="practice-row" data-topic-id="' + escapeHtml(id) + '">' +
        '<div class="practice-row-main">' + name +
        '<div class="tool-panel-state tool-panel-state-inline tool-panel-state-' + gap.state + '">' + label + "</div>" +
        '<div class="practice-row-path">' + escapeHtml(sub) + "</div></div>" +
        '<div class="practice-row-actions">' +
        '<a class="bottom-strip-btn practice-open" href="index.html?openNode=' + encodeURIComponent(id) + '">Open topic</a>' +
        '<button type="button" class="bottom-strip-btn practice-queue-secondary" data-queue-later="' + escapeHtml(id) + '">Later</button>' +
        '<button type="button" class="bottom-strip-btn practice-queue-secondary" data-queue-remembered="' + escapeHtml(id) + '">Remembered</button>' +
        "</div></div>";
}

function queueReadViewHtml() {
    const items = readQueueItems(queueScopeIds());
    let html = scopeFilterHtml(queueFilterPath);
    if (!items.length) return html + '<div class="practice-summary">Nothing needs a (re)read right now in this scope.</div>';
    const visible = queueReadShowAll ? items : items.slice(0, 5);
    html += visible.map(it => readQueueRowHtml(it.id, it.gap)).join("");
    if (!queueReadShowAll && items.length > 5) {
        html += '<button type="button" class="bottom-strip-btn" data-queue-read-show-more="1">Show ' + (items.length - 5) + " more</button>";
    }
    return html;
}

/* ---- Flashcards sub-tab: current Leitner state, most-overdue first ----
   Reuses the same summary.topics / topicRowHtml / sortTopicIds the old
   pre-shell flat tabs used (removed once Phase 4 confirmed what was
   worth keeping — see git history for the original dueViewHtml /
   flashcardsViewHtml if needed). Only topics with a known deck have an
   entry in summary.topics at all, so that's the natural "has
   flashcards" filter. */
function queueFlashcardsViewHtml(summary) {
    const ids = queueScopeIds().filter(id => summary.topics[id]);
    let html = scopeFilterHtml(queueFilterPath);
    if (!ids.length) return html + '<div class="practice-summary">No flashcard decks in this scope yet.</div>';
    html += sortTopicIds(ids, summary).map(id => {
        const t = summary.topics[id];
        const extra = dueNowOf(t) === 0 && t.nextFuture ? "Next review: " + escapeHtml(prettyDateTime(t.nextFuture)) : "";
        return topicRowHtml(id, t, dueNowOf(t), { showReviewed: true, extra: extra });
    }).join("");
    return html;
}

/* ---- MCQ sub-tab: pending/attempted/accuracy, no retry-queue logic ----
   Deliberately NOT a full "every leaf topic site-wide" fetch: with no
   scope filter applied, this only lists topics with at least one
   attempt already (free — comes straight out of the event log), so
   opening the tab doesn't fire one get_mcqs network call per leaf topic
   on the whole site. Apply the scope filter to narrow to a branch and
   never-attempted ("pending") topics appear there too, since fetching
   totals for one bounded branch is cheap. This is a deliberate scope
   trade-off, not an oversight — flag it if a bulk totals endpoint ever
   makes the whole-site version cheap too. */
function queueMcqViewHtml() {
    const filterId = currentQueueFilterId();
    const leafIds = queueScopeIds();
    let html = scopeFilterHtml(queueFilterPath);
    const candidateIds = filterId ? leafIds : leafIds.filter(id => mcqEventStats(id).attempted > 0);
    candidateIds.forEach(ensureMcqTotalLoaded);

    const rows = candidateIds.map(id => {
        const stats = mcqEventStats(id);
        const cached = mcqTotalCache.has(id) ? mcqTotalCache.get(id) : undefined;
        const pending = typeof cached === "number" ? Math.max(cached - stats.attempted, 0) : null;
        return { id: id, stats: stats, cached: cached, pending: pending };
    }).filter(r => r.stats.attempted > 0 || r.pending === null || r.pending > 0); // drop confirmed-zero, never-attempted topics

    if (!rows.length) return html + '<div class="practice-summary">No MCQ activity in this scope yet.</div>';

    rows.sort((a, b) => (a.stats.accuracy == null ? 1 : a.stats.accuracy) - (b.stats.accuracy == null ? 1 : b.stats.accuracy) || b.stats.attempted - a.stats.attempted);

    html += rows.map(r => {
        const info = topicInfo(r.id);
        const totalLabel = r.cached === undefined ? "…" : (r.cached == null ? "—" : String(r.cached));
        const accLabel = r.stats.accuracy == null ? "—" : Math.round(r.stats.accuracy * 100) + "%";
        const pendingText = r.pending == null ? "" : " · " + plural(r.pending, "question") + " pending";
        const name = info.known
            ? '<div class="practice-row-title">' + escapeHtml(info.title || "Untitled") + "</div>" +
              (info.parents ? '<div class="practice-row-path">' + escapeHtml(info.parents) + "</div>" : "")
            : '<div class="practice-row-title practice-row-unknown">Topic not found <span class="practice-row-id">(' + escapeHtml(r.id) + ")</span></div>";
        return '<div class="practice-row" data-topic-id="' + escapeHtml(r.id) + '">' +
            '<div class="practice-row-main">' + name +
            '<div class="practice-row-path">' + r.stats.attempted + " / " + totalLabel + " attempted · " + accLabel + " accuracy" + pendingText + "</div></div>" +
            '<div class="practice-row-actions"><button type="button" class="bottom-strip-btn practice-mcq-solve" data-mcq-solve="' + escapeHtml(r.id) + '">Solve</button></div>' +
            "</div>";
    }).join("");
    return html;
}

// ---- Plan Today: placeholder only, Phase 5 builds the real thing ----
function planViewHtml() {
    return '<div class="practice-summary practice-plan-placeholder">SMART Day Plan is coming soon — a morning objective, an evening check-in, ' +
        "and tomorrow's plan, measured automatically from what you do on the site.</div>";
}

const QUEUE_PLACEHOLDER_COPY = {
    "queue-future": "Future practice aspects will queue up here too."
};

// ---- Queue view Future sub-tab: ghost placeholder, no logic needed ----
function queuePlaceholderHtml(subview) {
    return '<div class="practice-summary practice-queue-placeholder">' + escapeHtml(QUEUE_PLACEHOLDER_COPY[subview] || "Coming soon.") + "</div>";
}

function updateMenu(summary) {
    setBadge("practice-badge-queue", summary.total);

    const inQueue = view.indexOf("queue-") === 0;
    document.querySelectorAll("#practice-menu [data-group='queue']").forEach(b => b.classList.toggle("active", inQueue));
    document.querySelectorAll("#practice-menu .practice-menu-item[data-view]").forEach(b => b.classList.toggle("active", b.dataset.view === view));
    document.querySelectorAll("#practice-menu .practice-submenu-item").forEach(b => b.classList.toggle("active", b.dataset.view === view));
    const sub = el("practice-submenu-queue");
    if (sub) sub.hidden = !inQueue;
}

const PRACTICE_VIEW_KEYS = ["plan", "tree", "queue-read", "queue-flashcards", "queue-mcq", "queue-future"];

function render() {
    const summary = getSummary();
    updateMenu(summary);
    const heading = el("practice-right-heading");
    if (heading) heading.textContent = VIEW_HEADINGS[view] || "PRACTICE";

    PRACTICE_VIEW_KEYS.forEach(key => {
        const host = el("pv-" + key);
        if (host) host.hidden = key !== view;
    });

    if (view === "plan") el("pv-plan").innerHTML = planViewHtml();
    else if (view === "tree") el("pv-tree").innerHTML = treeViewHtml(summary);
    else if (view === "queue-read") el("pv-queue-read").innerHTML = queueReadViewHtml();
    else if (view === "queue-flashcards") el("pv-queue-flashcards").innerHTML = queueFlashcardsViewHtml(summary);
    else if (view === "queue-mcq") el("pv-queue-mcq").innerHTML = queueMcqViewHtml();
    else if (view === "queue-future") el("pv-queue-future").innerHTML = queuePlaceholderHtml(view);

    // Bring the highlighted topic (from ?topic=) into view, once. Only
    // Tree view has anything to scroll to.
    if (!scrolledToTopic && view === "tree") {
        const target = document.querySelector("#pv-tree .practice-row-highlight");
        if (target && typeof target.scrollIntoView === "function") {
            scrolledToTopic = true;
            target.scrollIntoView({ block: "center" });
        }
    }
}


let renderTimer = null;
function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(render, 60);
}

function setMessage(text, kind) {
    const box = el("practice-message");
    if (!box) return;
    box.textContent = text || "";
    box.dataset.kind = kind || "info";
    box.hidden = !text;
}

function showDetail(open) {
    const shell = el("practice-shell");
    if (shell) shell.classList.toggle("practice-detail-open", !!open);
}

function selectView(next, opts) {
    opts = opts || {};
    const resolved = LEGACY_VIEW_MAP[next] || next;
    view = VIEW_HEADINGS[resolved] ? resolved : "tree";
    if (view.indexOf("queue-") === 0) lastQueueSub = view;
    setMessage("");
    render();

    try {
        const url = new URL(window.location.href);
        url.searchParams.set("view", view);
        window.history.replaceState(null, "", url.pathname + url.search);
    } catch (e) { /* not fatal */ }

    // Phones: the picked view takes over the screen; "← Menu" returns.
    if (opts.showDetail !== false && isMobile()) showDetail(true);
}

/* -----------------------------------------------------
   Review: fetch the topic's deck from Drive, open the modal
   ----------------------------------------------------- */

async function loadDeckRaw(topicId) {
    const link = mdLinks[topicId];
    if (!link) throw new Error("This topic has no linked content yet.");
    const response = await fetch(GOOGLE_SHEET_API + "?action=get_markdown&ref=" + encodeURIComponent(link));
    const json = await response.json();
    if (!json || !json.ok) throw new Error((json && json.error) || "Couldn't load this topic's content.");
    const companion = json.companions && json.companions.flashcards;
    if (companion && String(companion).trim()) return String(companion);
    return window.Flashcards.splitArticleAndCards(String(json.content || "")).cards;
}

async function reviewTopic(topicId, button) {
    const original = button ? button.textContent : "";
    if (button) {
        button.disabled = true;
        button.textContent = "Loading deck…";
    }
    setMessage("");
    try {
        const raw = await loadDeckRaw(topicId);
        if (!String(raw || "").trim()) {
            throw new Error("No flashcards found for this topic (looked for flashcards.md and a deck at the end of content.md).");
        }
        window.Flashcards.setContext(topicId, raw);
        window.Flashcards.open();
    } catch (error) {
        setMessage("Couldn't start the review: " + (error && error.message ? error.message : "unknown error"), "error");
    } finally {
        if (button) {
            button.disabled = false;
            button.textContent = original;
        }
    }
}

/* -----------------------------------------------------
   Events
   ----------------------------------------------------- */

function bindEvents() {
    const menu = el("practice-menu");
    menu.addEventListener("click", event => {
        const item = event.target.closest("button");
        if (!item) return;
        if (item.dataset.group === "queue") selectView(lastQueueSub);
        else if (item.dataset.view) selectView(item.dataset.view);
    });

    el("practice-back").addEventListener("click", () => showDetail(false));

    el("practice-right").addEventListener("click", event => {
        // A square's own button (Start review / Solve / Open topic) is
        // inside a [data-square-body] tile, so check it first: when the
        // click landed on the button, skip the body-toggle branch below
        // (the delegated-click equivalent of the button calling
        // stopPropagation()) and let its own branch further down handle it.
        const onSquareBtn = !!event.target.closest(".practice-square-btn");

        const squareBody = !onSquareBtn && event.target.closest("[data-square-body]");
        if (squareBody) {
            const kind = squareBody.dataset.squareBody;
            expandedSquare = expandedSquare === kind ? null : kind;
            render();
            return;
        }
        const selectNode = !onSquareBtn && event.target.closest("[data-select-node]");
        if (selectNode) {
            const id = selectNode.dataset.selectNode;
            if (selectedNode === id) {
                selectedNode = null;
            } else {
                selectedNode = id;
                expandedSquare = null; // fresh node: no square pre-expanded
                // The click may have come from a non-leaf square's
                // one-level children drill-down (childrenSummaryHtml),
                // whose rows can point at a node the tree hasn't
                // expanded down to yet. Without this, selectedNode would
                // change but its square grid would render nowhere
                // visible, hidden behind a collapsed ancestor toggle.
                if (nodesById[id]) ancestorsOf(id).forEach(a => expanded.add(a));
            }
            render();
            return;
        }
        const boxToggle = event.target.closest("[data-box-toggle]");
        if (boxToggle) {
            const key = boxToggle.dataset.boxToggle;
            if (boxToggles.has(key)) boxToggles.delete(key); else boxToggles.add(key);
            render();
            return;
        }
        const toggle = event.target.closest("[data-toggle]");
        if (toggle) {
            const id = toggle.dataset.toggle;
            if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
            render();
            return;
        }
        if (event.target.closest("[data-expand-all]")) {
            Object.keys(nodesById).forEach(id => { if ((childrenOf[id] || []).length) expanded.add(id); });
            render();
            return;
        }
        if (event.target.closest("[data-collapse-all]")) {
            expanded.clear();
            render();
            return;
        }
        const review = event.target.closest("[data-review]");
        if (review) { reviewTopic(review.dataset.review, review); return; }
        const mcqSolve = event.target.closest("[data-mcq-solve]");
        if (mcqSolve) { window.open("mcq.html?topic=" + encodeURIComponent(mcqSolve.dataset.mcqSolve), "_blank", "noopener"); return; }
        const later = event.target.closest("[data-queue-later]");
        if (later) { snoozeTopic(later.dataset.queueLater); render(); return; }
        const remembered = event.target.closest("[data-queue-remembered]");
        if (remembered) { markRemembered(remembered.dataset.queueRemembered); render(); return; }
        if (event.target.closest("[data-queue-read-show-more]")) {
            queueReadShowAll = true;
            render();
            return;
        }
    });

    // Phase 4's scope filter: a chain of <select>s (see scopeFilterHtml).
    // "change" bubbles the same as "click", so one delegated listener
    // here covers every step, same pattern as the click handler above.
    el("practice-right").addEventListener("change", event => {
        const step = event.target.closest("[data-scope-filter-step]");
        if (!step) return;
        const idx = Number(step.dataset.scopeFilterStep);
        queueFilterPath = queueFilterPath.slice(0, idx);
        if (step.value) queueFilterPath.push(step.value);
        queueReadShowAll = false; // scope just changed: restart the Read tab's 5-item cap
        render();
    });

    // A review answer or a sync merge changed progress: refresh.
    window.addEventListener("flashcards-progress-changed", scheduleRender);
}

/* -----------------------------------------------------
   LEFT PANEL: drag-to-resize + collapse (same mechanism as the Index page)
   ----------------------------------------------------- */

function enablePanel() {
    const workspace = el("practice-workspace");
    const left = el("practice-left");
    const resizer = el("practice-resizer");
    const toggle = el("practice-toggle");
    if (!workspace || !left || !resizer) return;

    const MIN_LEFT = 220;
    const MIN_RIGHT = 300;
    const COLLAPSED_WIDTH = 52;
    const FALLBACK_WIDTH = 300;

    function safeGet(key) {
        try { return localStorage.getItem(key); } catch (e) { return null; }
    }
    function safeSet(key, value) {
        try { localStorage.setItem(key, value); } catch (e) { /* storage blocked */ }
    }

    // Default: about 28% for the menu, the rest for what you are looking at.
    const saved = Number(safeGet(PRACTICE_WIDTH_KEY));
    const natural = Math.round((workspace.clientWidth || 0) * 0.28);
    let lastWidth = saved >= MIN_LEFT ? saved : Math.max(MIN_LEFT, natural || FALLBACK_WIDTH);

    function setWidth(px) {
        workspace.style.setProperty("--practice-left-width", px + "px");
    }

    function collapse(flag) {
        left.classList.toggle("panel-collapsed", flag);
        setWidth(flag ? COLLAPSED_WIDTH : lastWidth);
        if (toggle) {
            toggle.setAttribute("aria-expanded", String(!flag));
            toggle.title = flag ? "Expand menu" : "Collapse menu";
        }
        safeSet(PRACTICE_COLLAPSED_KEY, flag ? "1" : "0");
    }

    setWidth(lastWidth);
    if (safeGet(PRACTICE_COLLAPSED_KEY) === "1" && !isMobile()) collapse(true);

    let dragging = false;
    resizer.addEventListener("pointerdown", event => {
        if (isMobile() || left.classList.contains("panel-collapsed")) return;
        dragging = true;
        document.body.classList.add("practice-resizing");
        event.preventDefault();
    });
    window.addEventListener("pointermove", event => {
        if (!dragging) return;
        const rect = workspace.getBoundingClientRect();
        const maxLeft = Math.max(MIN_LEFT, (rect.width || 1000) - MIN_RIGHT);
        lastWidth = Math.max(MIN_LEFT, Math.min(event.clientX - rect.left, maxLeft));
        setWidth(lastWidth);
    });
    window.addEventListener("pointerup", () => {
        if (!dragging) return;
        dragging = false;
        document.body.classList.remove("practice-resizing");
        safeSet(PRACTICE_WIDTH_KEY, String(Math.round(lastWidth)));
    });

    if (toggle) {
        toggle.addEventListener("click", () => {
            if (isMobile()) return;
            collapse(!left.classList.contains("panel-collapsed"));
        });
    }
}

/* -----------------------------------------------------
   Start
   ----------------------------------------------------- */

async function initPracticePage() {
    enablePanel();
    bindEvents();
    setInterval(tickBoxTimers, 1000);

    const wanted = params().get("view");
    const resolvedWanted = LEGACY_VIEW_MAP[wanted] || wanted;
    const startView = VIEW_HEADINGS[resolvedWanted] ? resolvedWanted : "tree";
    // On a phone, no ?view= means "show me the menu first".
    selectView(startView, { showDetail: !!wanted });

    await loadTree();
    render();
}

initPracticePage();
