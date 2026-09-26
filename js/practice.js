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
let mcqBuilt = false;                       // unused post-Phase-2 (see ensureMcqFrame note below), kept for Phase 4

// Tree view: the node whose 4-square panel (or non-leaf placeholder) is
// open, and which of the 4 squares is expanded to its full detail render.
// Both reset together when a different node is selected, so only one
// node's panel and only one square's detail are ever open at once.
let selectedNode = null;
let expandedSquare = null;      // "read" | "flashcards" | "mcq" | "future" | null
let nodeAutoSelected = false;   // auto-open ?topic= once the tree has loaded, like treeAutoExpanded

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
        aggregateMcqEventStats: aggregateMcqEventStats
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

   Built now, not wired into any view yet: Queue view (Phase 4) is what
   will actually put this above its flat lists. Deliberately reuses the
   real childrenOf tree (same data Tree view walks) so a branch that is
   deeper than Subject > Course > Unit > Chapter > Topic > Subtopic
   needs no change here — each step just asks "does the currently
   selected node have children?" and stops the moment the answer is no
   (isLeaf), instead of assuming a fixed number of levels.

   Adapted from the spec's renderScopeFilter(onChange) pseudocode to a
   (container, onChange) signature: this file's existing components
   (bindEvents, etc.) all wire real DOM via delegated listeners rather
   than a callback that returns a string, and a set of <select> chains
   needs to react to its OWN change events, not just call back on paint.
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

   Everything below this point up to "Render + navigation" (dueViewHtml,
   flashcardsViewHtml, the MCQ iframe embed) was the old flat-tab
   content. Phase 2's Queue view sub-tabs are placeholders instead (see
   queuePlaceholderHtml near render()) — Phase 4 designs the real
   cross-topic queues from scratch per phase-2-new-shell.md, so these are
   left here unwired rather than deleted, in case any of the logic
   (grouping, sorting, the topicRowHtml layout) is worth reusing then.
   ----------------------------------------------------- */

// ---- Due view: by WHEN ----
function dueViewHtml(summary) {
    const ids = Object.keys(summary.topics);
    let html = "";

    if (summary.total > 0) {
        const dueTopics = ids.filter(id => dueNowOf(summary.topics[id]) > 0).length;
        html += '<div class="practice-summary"><span class="practice-summary-big">' + plural(summary.total, "card") + "</span> for review, from " +
            plural(dueTopics, "topic") + ". " +
            (summary.overdue ? '<span class="practice-chip practice-chip-overdue">' + summary.overdue + " overdue</span> " : "") +
            (summary.dueToday ? '<span class="practice-chip practice-chip-today">' + summary.dueToday + " due today</span>" : "") + "</div>";
    } else if (!ids.length) {
        html += '<div class="practice-summary">No practice data yet. Review some flashcards inside a topic; each card comes back here when it is due.</div>';
    } else {
        html += '<div class="practice-summary">Nothing is due right now.</div>';
    }

    // Note when arriving from a topic's "open practice" button.
    const topicId = topicParam();
    if (topicId) {
        const info = topicInfo(topicId);
        const label = info.known ? info.title : "This topic";
        const t = summary.topics[topicId];
        let text = "";
        if (!t) text = label + ": no flashcard progress yet. Open the topic and review its cards first.";
        else if (dueNowOf(t) === 0) text = label + ": nothing due" + (t.nextFuture ? ". Next review: " + prettyDateTime(t.nextFuture) + "." : ".");
        if (text) html += '<div class="practice-note">' + escapeHtml(text) + "</div>";
    }

    if (!treeLoaded && ids.length) return html + loadingHtml();

    const buckets = [
        { title: "Overdue", pick: t => t.overdue, review: true, field: "overdue" },
        { title: "Due today", pick: t => t.dueToday, review: true, field: "dueToday" },
        { title: "Next 7 days", pick: t => t.upcoming, review: false, field: "upcoming" },
        { title: "Later", pick: t => t.later, review: false, field: "later" }
    ];
    buckets.forEach(bucket => {
        const inBucket = ids.filter(id => bucket.pick(summary.topics[id]) > 0);
        if (!inBucket.length) return;
        html += '<div class="practice-group-title">' + bucket.title + " · " + plural(inBucket.reduce((n, id) => n + bucket.pick(summary.topics[id]), 0), "card") + "</div>";
        html += sortTopicIds(inBucket, summary).map(id => {
            const t = summary.topics[id];
            const count = bucket.pick(t);
            const chip = {};
            chip[bucket.field] = count;
            const extra = bucket.field === "later" && t.nextFuture ? "Next: " + escapeHtml(prettyDateTime(t.nextFuture)) : "";
            // ONE Review button per topic, carrying the topic's whole due-now count
            // (a session always opens every due card of the topic): on its Overdue
            // row, or on its Due-today row when nothing is overdue.
            let reviewCount = 0;
            if (bucket.field === "overdue") reviewCount = dueNowOf(t);
            else if (bucket.field === "dueToday" && !t.overdue) reviewCount = t.dueToday;
            return topicRowHtml(id, chip, reviewCount, { extra: extra });
        }).join("");
    });
    return html;
}

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

// ---- Flashcards view: what to review NOW ----
function flashcardsViewHtml(summary) {
    const ids = Object.keys(summary.topics);
    let html = "";

    if (!ids.length) {
        return '<div class="practice-summary">No flashcards reviewed yet. Open a topic that has flashcards and review them once; they come back here when due.</div>';
    }
    if (!treeLoaded) return loadingHtml();

    const dueIds = ids.filter(id => dueNowOf(summary.topics[id]) > 0);
    const restIds = ids.filter(id => dueNowOf(summary.topics[id]) === 0);

    if (dueIds.length) {
        html += '<div class="practice-summary"><span class="practice-summary-big">' + plural(summary.total, "card") + "</span> ready to review, in " + plural(dueIds.length, "topic") + ".</div>";
        html += '<div class="practice-group-title">Ready to review</div>';
        html += sortTopicIds(dueIds, summary).map(id => topicRowHtml(id, summary.topics[id], dueNowOf(summary.topics[id]))).join("");
    } else {
        html += '<div class="practice-summary">Nothing to review right now.</div>';
    }

    if (restIds.length) {
        html += '<div class="practice-group-title">Reviewed, not due yet</div>';
        html += sortTopicIds(restIds, summary).map(id => {
            const t = summary.topics[id];
            return topicRowHtml(id, t, 0, { showReviewed: true, extra: t.nextFuture ? "Next review: " + escapeHtml(prettyDateTime(t.nextFuture)) : "" });
        }).join("");
    }
    html += '<p class="practice-footnote">Cards you have not reviewed yet stay inside their topic: open it and press Flashcard to start them.</p>';
    return html;
}

// ---- MCQs view: the existing page, embedded once and kept alive ----
function ensureMcqFrame() {
    const host = el("pv-mcq");
    if (!host || mcqBuilt) return;
    mcqBuilt = true;
    const topic = topicParam();
    const url = "mcq.html" + (topic ? "?topic=" + encodeURIComponent(topic) : "");
    host.innerHTML =
        '<div class="practice-mcq-bar"><span id="practice-mcq-label"></span>' +
        '<a href="' + escapeHtml(url) + '" target="_blank" rel="noopener">Open in new tab ↗</a></div>' +
        '<iframe class="practice-mcq-frame" title="MCQ practice" src="' + escapeHtml(url) + '"></iframe>';
    updateMcqLabel();
}

function updateMcqLabel() {
    const label = el("practice-mcq-label");
    if (!label) return;
    const topic = topicParam();
    if (!topic) label.textContent = "All questions";
    else label.textContent = "Topic: " + (topicInfo(topic).known ? topicInfo(topic).title : topic);
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

// ---- Plan Today: placeholder only, Phase 5 builds the real thing ----
function planViewHtml() {
    return '<div class="practice-summary practice-plan-placeholder">SMART Day Plan is coming soon — a morning objective, an evening check-in, ' +
        "and tomorrow's plan, measured automatically from what you do on the site.</div>";
}

const QUEUE_PLACEHOLDER_COPY = {
    "queue-read": "A cross-topic queue of what to (re)read next is coming here.",
    "queue-flashcards": "A cross-topic queue of due flashcards is coming here — replacing the per-topic Start-review button in Tree view with one combined list.",
    "queue-mcq": "A cross-topic MCQ due/retry queue is coming here.",
    "queue-future": "Future practice aspects will queue up here too."
};

// ---- Queue view sub-tabs: placeholders only, Phase 4 builds these ----
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
    else if (view.indexOf("queue-") === 0) {
        const host = el("pv-" + view);
        if (host) host.innerHTML = queuePlaceholderHtml(view);
    }

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
