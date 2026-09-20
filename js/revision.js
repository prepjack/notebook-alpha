/* =========================================================
   REVISION PAGE (revision.html) — Stage 1

   Lists every topic that has flashcards due, straight from the review
   progress (localStorage, kept in step across devices by
   js/progress-sync.js). It needs NO card text: a card's id starts with
   its topic id, and topic names/paths come from the notebook tree, loaded
   the same way index-directory.js loads it (Google Sheets API ->
   data/study-data.json -> data/study-data.js fallback).

   "Open topic" goes to index.html?openNode=<id>, the deep link the main
   notebook already supports; the Flashcard button there shows only that
   topic's due cards.

   ?topic=<id> (used by the Revise button in the reading strip) highlights
   one topic, or says why it isn't listed.
   ========================================================= */

// progress-sync.js reads this global when it syncs.
const GOOGLE_SHEET_API =
    "https://script.google.com/macros/s/AKfycbzE7zuqKXMmvfoP6LNCRw159odJsqWW9O0hEWm7uHIelnQJz4x7iFMnbTDKvm8lpIw5QA/exec";

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

/* -----------------------------------------------------
   Tree: only ids, titles and parents are needed.
   ----------------------------------------------------- */

let nodesById = {};      // id -> { id, title, parentId }
let treeLoaded = false;

function mapFromApiNodes(rows) {
    const map = {};
    (rows || []).forEach(row => {
        if (!row || !row.node_id) return;
        map[String(row.node_id)] = {
            id: String(row.node_id),
            title: String(row.title || ""),
            parentId: row.parent_id ? String(row.parent_id) : null
        };
    });
    return map;
}

function mapFromSubjects(subjects) {
    const map = {};
    (function walk(list, parentId) {
        (list || []).forEach(node => {
            if (!node || node.id === undefined || node.id === null) return;
            map[String(node.id)] = { id: String(node.id), title: String(node.title || ""), parentId: parentId };
            walk(node.children, String(node.id));
        });
    })(subjects, null);
    return map;
}

async function loadNodesById() {
    try {
        const response = await fetch(GOOGLE_SHEET_API);
        if (!response.ok) throw new Error("Google Sheet API failed (" + response.status + ")");
        const apiData = await response.json();
        const map = mapFromApiNodes(apiData.nodes);
        if (Object.keys(map).length) return map;
        throw new Error("API returned no nodes");
    } catch (error) {
        console.warn("Revision: Google Sheets API unavailable; using local fallback.", error);
        try {
            const response = await fetch("data/study-data.json");
            if (!response.ok) throw new Error("study-data.json failed (" + response.status + ")");
            const json = await response.json();
            return mapFromSubjects(json.subjects);
        } catch (jsonError) {
            return mapFromSubjects((window.STUDY_DATA_FALLBACK || {}).subjects);
        }
    }
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

/* -----------------------------------------------------
   Rendering
   ----------------------------------------------------- */

function prettyDate(iso) {
    const [y, m, d] = String(iso).split("-").map(Number);
    if (!y || !m || !d) return iso;
    try {
        return new Date(y, m - 1, d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    } catch (e) {
        return iso;
    }
}

function plural(n, word) {
    return n + " " + word + (n === 1 ? "" : "s");
}

function highlightedTopicId() {
    try {
        return new URLSearchParams(window.location.search).get("topic") || "";
    } catch (e) {
        return "";
    }
}

function rowInfo(topic) {
    const titles = treeLoaded ? pathTitles(topic.topicId) : null;
    return {
        topic: topic,
        known: !!titles,
        title: titles ? titles[titles.length - 1] : "",
        parents: titles ? titles.slice(0, -1).join(" → ") : ""
    };
}

function chips(topic) {
    const out = [];
    if (topic.overdue) out.push('<span class="revision-chip revision-chip-overdue">' + plural(topic.overdue, "card") + " overdue</span>");
    if (topic.dueToday) out.push('<span class="revision-chip revision-chip-today">' + plural(topic.dueToday, "card") + " due today</span>");
    if (topic.upcoming) out.push('<span class="revision-chip">' + plural(topic.upcoming, "card") + " in the next 7 days</span>");
    return out.join("");
}

function rowHtml(info, highlightId) {
    const t = info.topic;
    const isHighlight = highlightId && t.topicId === highlightId;
    const name = info.known
        ? '<div class="revision-row-title">' + escapeHtml(info.title || "Untitled") + "</div>" +
          (info.parents ? '<div class="revision-row-path">' + escapeHtml(info.parents) + "</div>" : "")
        : '<div class="revision-row-title revision-row-unknown">Topic not found <span class="revision-row-id">(' + escapeHtml(t.topicId) + ")</span></div>" +
          '<div class="revision-row-path">' + (treeLoaded ? "It may have been deleted." : "Topic names couldn't be loaded.") + "</div>";
    const open = info.known
        ? '<a class="bottom-strip-btn revision-open" href="index.html?openNode=' + encodeURIComponent(t.topicId) + '">Open topic</a>'
        : "";
    return '<div class="revision-row' + (isHighlight ? " revision-row-highlight" : "") + '" data-topic-id="' + escapeHtml(t.topicId) + '">' +
        '<div class="revision-row-main">' + name + '<div class="revision-chips">' + chips(t) + "</div></div>" + open + "</div>";
}

function sortRows(a, b) {
    return (b.topic.overdue - a.topic.overdue) ||
        (b.topic.dueToday - a.topic.dueToday) ||
        (a.parents + a.title).localeCompare(b.parents + b.title);
}

function render() {
    const summary = window.Flashcards ? window.Flashcards.getDueSummary() : { total: 0, overdue: 0, dueToday: 0, upcoming: 0, topics: {} };
    const highlightId = highlightedTopicId();

    const infos = Object.keys(summary.topics).map(id => rowInfo(summary.topics[id]));
    const dueNow = infos.filter(i => i.topic.overdue + i.topic.dueToday > 0).sort(sortRows);
    const coming = infos
        .filter(i => i.topic.overdue + i.topic.dueToday === 0 && i.topic.upcoming > 0)
        .sort((a, b) => a.topic.nextFuture.localeCompare(b.topic.nextFuture) || sortRows(a, b));

    const summaryEl = document.getElementById("revision-summary");
    const listEl = document.getElementById("revision-list");
    const noteEl = document.getElementById("revision-note");

    // ---- summary line ----
    if (summary.total > 0) {
        summaryEl.innerHTML = '<span class="revision-summary-big">' + plural(summary.total, "card") + "</span> due now, across " +
            plural(dueNow.length, "topic") + ". " +
            (summary.overdue ? '<span class="revision-chip revision-chip-overdue">' + summary.overdue + " overdue</span> " : "") +
            (summary.dueToday ? '<span class="revision-chip revision-chip-today">' + summary.dueToday + " due today</span>" : "");
    } else if (Object.keys(summary.topics).length === 0) {
        summaryEl.textContent = "No revision data yet. Review some flashcards inside a topic; each card comes back here when it is due.";
    } else {
        summaryEl.textContent = "Nothing is due right now.";
    }

    // ---- note for the highlighted topic (from the Revise button) ----
    if (highlightId) {
        const titles = treeLoaded ? pathTitles(highlightId) : null;
        const label = titles ? titles[titles.length - 1] : "This topic";
        const info = summary.topics[highlightId];
        let text = "";
        if (!info) {
            text = label + ": no flashcard progress yet. Open the topic and review its cards first.";
        } else if (info.overdue + info.dueToday === 0) {
            text = label + ": nothing due" + (info.nextFuture ? ". Next review: " + prettyDate(info.nextFuture) + "." : ".");
        }
        noteEl.hidden = !text;
        noteEl.textContent = text;
    } else {
        noteEl.hidden = true;
    }

    // ---- lists ----
    if (!treeLoaded && infos.length) {
        listEl.innerHTML = '<div class="revision-loading">Loading topic names…</div>';
        return;
    }
    let html = "";
    if (dueNow.length) {
        html += '<div class="revision-group-title">Due now</div>' + dueNow.map(i => rowHtml(i, highlightId)).join("");
    }
    if (coming.length) {
        html += '<div class="revision-group-title">Coming up in the next 7 days</div>' + coming.map(i => rowHtml(i, highlightId)).join("");
    }
    listEl.innerHTML = html;

    const target = listEl.querySelector(".revision-row-highlight");
    if (target && !scrolledToHighlight && typeof target.scrollIntoView === "function") {
        scrolledToHighlight = true;
        target.scrollIntoView({ block: "center" });
    }
}

let scrolledToHighlight = false; // scroll to the highlighted topic once, not on every refresh
let renderTimer = null;
function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(render, 60);
}

async function initRevisionPage() {
    render(); // instant, from local progress (topic names fill in once the tree loads)
    // A sync (or a review in another tab) changes progress: refresh the list.
    window.addEventListener("flashcards-progress-changed", scheduleRender);
    nodesById = await loadNodesById();
    treeLoaded = true;
    render();
}

initRevisionPage();
