/* =========================================================
   PRACTICE PAGE (practice.html)

   One place for everything you DO to remember what you learned. Two
   panels, like the Index page: the LEFT panel is a small menu, the RIGHT
   panel shows whatever is picked there.

     Progress -> Tree view   every topic that has review progress, grouped
                             Subject -> Course -> Unit -> Chapter -> Topic
                             with due counts rolled up at every level
              -> Due view    Overdue / Due today / Next 7 days / Later
     Flashcards              topics with cards due, each with "Review"
     MCQs                    the existing mcq.html, embedded

   Progress comes from localStorage (kept in step across devices by
   js/progress-sync.js); a card id starts with its topic id. Topic names,
   the tree and each topic's content link come from the notebook data,
   loaded like js/index-directory.js does (Google Sheets API ->
   data/study-data.json -> data/study-data.js fallback).

   "Review" loads that topic's flashcard deck from Drive on demand
   (get_markdown: flashcards.md companion, else the deck at the end of
   content.md) and opens the normal flashcard modal, which shows only the
   cards that are due.

   Deep links: practice.html?view=due|tree|flashcards|mcq&topic=<id>
   ========================================================= */

// progress-sync.js reads this global when it syncs.
const GOOGLE_SHEET_API =
    "https://script.google.com/macros/s/AKfycbzE7zuqKXMmvfoP6LNCRw159odJsqWW9O0hEWm7uHIelnQJz4x7iFMnbTDKvm8lpIw5QA/exec";

const PRACTICE_WIDTH_KEY = "practice:leftWidth";
const PRACTICE_COLLAPSED_KEY = "practice:leftCollapsed";
const MOBILE_MAX = 900;

const VIEW_HEADINGS = {
    due: "PROGRESS · DUE VIEW",
    tree: "PROGRESS · TREE VIEW",
    flashcards: "FLASHCARDS",
    mcq: "MCQS"
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

let view = "due";
let lastProgressView = "due";
const expanded = new Set();     // tree nodes currently opened
let treeAutoExpanded = false;   // open the nodes that have due cards, once
let scrolledToTopic = false;
let mcqBuilt = false;

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

// ---- Due view: by WHEN ----
function dueViewHtml(summary) {
    const ids = Object.keys(summary.topics);
    let html = "";

    if (summary.total > 0) {
        const dueTopics = ids.filter(id => dueNowOf(summary.topics[id]) > 0).length;
        html += '<div class="practice-summary"><span class="practice-summary-big">' + plural(summary.total, "card") + "</span> due now, across " +
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
        else if (dueNowOf(t) === 0) text = label + ": nothing due" + (t.nextFuture ? ". Next review: " + prettyDate(t.nextFuture) + "." : ".");
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
            const extra = bucket.field === "later" && t.nextFuture ? "Next: " + escapeHtml(prettyDate(t.nextFuture)) : "";
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

function expandForDue(summary) {
    Object.keys(summary.topics).forEach(id => {
        if (dueNowOf(summary.topics[id]) > 0) ancestorsOf(id).forEach(a => expanded.add(a));
    });
    const topic = topicParam();
    if (topic && nodesById[topic]) ancestorsOf(topic).forEach(a => expanded.add(a));
}

function treeViewHtml(summary) {
    if (!Object.keys(summary.topics).length) {
        return '<div class="practice-summary">No practice data yet. Review some flashcards inside a topic; each card comes back here when it is due.</div>';
    }
    if (!treeLoaded) return loadingHtml();

    if (!treeAutoExpanded) {
        treeAutoExpanded = true;
        expandForDue(summary);
    }

    const stats = makeStats(summary);
    const highlight = topicParam();

    function node(id, depth) {
        const st = stats(id);
        if (!st.reviewed) return ""; // nothing reviewed in this branch: not shown
        const kids = (childrenOf[id] || []).map(k => node(k, depth + 1)).join("");
        const n = nodesById[id];
        const own = summary.topics[id];
        const isOpen = expanded.has(id);
        const toggle = kids
            ? '<button type="button" class="practice-tree-toggle" data-toggle="' + escapeHtml(id) + '" aria-expanded="' + isOpen + '" aria-label="' + (isOpen ? "Collapse" : "Expand") + '">' + (isOpen ? "▾" : "▸") + "</button>"
            : '<span class="practice-tree-toggle practice-tree-leaf" aria-hidden="true"></span>';
        const row = '<div class="practice-tree-row' + (highlight === id ? " practice-row-highlight" : "") + '" style="--depth:' + depth + '" data-node-id="' + escapeHtml(id) + '">' +
            toggle +
            '<div class="practice-row-main"><div class="practice-row-title">' + escapeHtml(n.title || "Untitled") + '</div><div class="practice-chips">' + chipsHtml(st, true) + "</div></div>" +
            (own ? actionsHtml(id, dueNowOf(own), true) : "") + "</div>";
        return row + (kids && isOpen ? '<div class="practice-tree-children">' + kids + "</div>" : "");
    }

    let html = '<div class="practice-tree-tools"><button type="button" class="bottom-strip-btn" data-expand-all="1">Expand all</button> <button type="button" class="bottom-strip-btn" data-collapse-all="1">Collapse all</button></div>';
    html += (childrenOf[""] || []).map(id => node(id, 0)).join("");

    // Progress that belongs to topics no longer in the tree.
    const orphans = Object.keys(summary.topics).filter(id => !nodesById[id]);
    if (orphans.length) {
        html += '<div class="practice-group-title">Not in the tree any more</div>' +
            orphans.map(id => topicRowHtml(id, summary.topics[id], 0, { showReviewed: true, noActions: true })).join("");
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
            return topicRowHtml(id, t, 0, { showReviewed: true, extra: t.nextFuture ? "Next review: " + escapeHtml(prettyDate(t.nextFuture)) : "" });
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

function updateMenu(summary) {
    setBadge("practice-badge-progress", summary.total);
    setBadge("practice-badge-flashcards", summary.total);

    const inProgress = view === "due" || view === "tree";
    document.querySelectorAll("#practice-menu [data-group='progress']").forEach(b => b.classList.toggle("active", inProgress));
    document.querySelectorAll("#practice-menu .practice-menu-item[data-view]").forEach(b => b.classList.toggle("active", b.dataset.view === view));
    document.querySelectorAll("#practice-menu .practice-submenu-item").forEach(b => b.classList.toggle("active", b.dataset.view === view));
    const sub = el("practice-submenu");
    if (sub) sub.hidden = !inProgress;
}

function render() {
    const summary = getSummary();
    updateMenu(summary);
    const heading = el("practice-right-heading");
    if (heading) heading.textContent = VIEW_HEADINGS[view] || "PRACTICE";

    ["due", "tree", "flashcards", "mcq"].forEach(key => {
        const host = el("pv-" + key);
        if (host) host.hidden = key !== view;
    });

    if (view === "due") el("pv-due").innerHTML = dueViewHtml(summary);
    else if (view === "tree") el("pv-tree").innerHTML = treeViewHtml(summary);
    else if (view === "flashcards") el("pv-flashcards").innerHTML = flashcardsViewHtml(summary);
    else if (view === "mcq") { ensureMcqFrame(); updateMcqLabel(); }

    // Bring the highlighted topic (from ?topic=) into view, once.
    if (!scrolledToTopic && view !== "mcq") {
        const target = document.querySelector("#pv-" + view + " .practice-row-highlight");
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
    view = VIEW_HEADINGS[next] ? next : "due";
    if (view === "due" || view === "tree") lastProgressView = view;
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
        if (item.dataset.group === "progress") selectView(lastProgressView);
        else if (item.dataset.view) selectView(item.dataset.view);
    });

    el("practice-back").addEventListener("click", () => showDetail(false));

    el("practice-right").addEventListener("click", event => {
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
        if (review) reviewTopic(review.dataset.review, review);
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

    const wanted = params().get("view");
    const startView = VIEW_HEADINGS[wanted] ? wanted : "due";
    // On a phone, no ?view= means "show me the menu first".
    selectView(startView, { showDetail: !!wanted });

    await loadTree();
    render();
}

initPracticePage();
