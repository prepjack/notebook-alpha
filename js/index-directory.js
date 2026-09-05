/* =========================================================
   INDEX DIRECTORY PAGE — separate tab/window
   A dedicated, book-style A-Z index of every term (topic titles
   + "also known as" aliases) across the whole notebook, laid
   out across up to 3 scrollable columns with no rule between
   them. This page is self-contained (same pattern as mcq.html /
   js/mcq.js) so it does not depend on the main notebook's DOM.

   Clicking a term navigates back to the main notebook at that
   exact topic (index.html?openNode=<id>), reusing the very same
   selectNodeById() the Table of Contents and the in-panel Index
   already use — there is still only one place topic content
   actually lives.
   ========================================================= */

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

/* -----------------------------------------------------
   DATA LOADING — same shape/fallback chain as the main
   notebook (js/app.js): Google Sheets -> local JSON ->
   data/study-data.js's window.STUDY_DATA_FALLBACK.
   ----------------------------------------------------- */

const GOOGLE_SHEET_API =
    "https://script.google.com/macros/s/AKfycbzE7zuqKXMmvfoP6LNCRw159odJsqWW9O0hEWm7uHIelnQJz4x7iFMnbTDKvm8lpIw5QA/exec";

async function loadStudyData() {
    try {
        const response = await fetch(GOOGLE_SHEET_API);

        if (!response.ok) {
            throw new Error(`Google Sheet API failed (${response.status})`);
        }

        const apiData = await response.json();
        return convertApiDataToStudyData(apiData);

    } catch (error) {
        console.warn(
            "Index directory: Google Sheets API unavailable; using local JSON fallback.",
            error
        );

        try {
            const response = await fetch("data/study-data.json");

            if (!response.ok) {
                throw new Error(`Could not load study-data.json (${response.status})`);
            }

            return await response.json();

        } catch (jsonError) {
            console.warn(
                "Index directory: JSON fetch unavailable; using local fallback.",
                jsonError
            );

            return window.STUDY_DATA_FALLBACK || null;
        }
    }
}

function convertApiDataToStudyData(apiData) {

    const nodes = apiData.nodes || [];
    const contentRows = apiData.content || [];
    const resourceRows = apiData.resources || [];
    const communityRows = apiData.community || [];

    const nodeMap = {};

    nodes.forEach(row => {
        nodeMap[row.node_id] = {
            id: row.node_id,
            title: row.title,
            type: row.node_type,
            parentId: row.parent_id || null,
            children: [],
            community: [],
            resources: [],
        };
    });

    nodes.forEach(row => {
        const node = nodeMap[row.node_id];
        if (!node) return;

        if (row.parent_id && nodeMap[row.parent_id]) {
            nodeMap[row.parent_id].children.push(node);
        }
    });

    contentRows.forEach(row => {
        const node = nodeMap[row.node_id];
        if (!node) return;

        if (!node.content) node.content = {};

        const type = row.content_type;

        if (type === "key_points") {
            if (!node.content.keyPoints) node.content.keyPoints = [];

            if (row.content) {
                String(row.content)
                    .split(/\r?\n/)
                    .map(x => x.trim())
                    .filter(Boolean)
                    .forEach(point => node.content.keyPoints.push(point));
            }
        } else {
            node.content[type] = row.content || "";
        }
    });

    resourceRows.forEach(row => {
        const node = nodeMap[row.node_id];
        if (!node) return;

        node.resources.push({
            id: row.resource_id,
            title: row.title,
            type: String(row.resource_type || "").toLowerCase(),
            url: row.url,
            description: row.description || "",
            source: row.resource_type,
            locationRef: row.location_ref || "",
            pageRef: row.location_ref || "",
            openMode: "new-tab"
        });
    });

    communityRows.forEach(row => {
        const node = nodeMap[row.node_id];
        if (!node) return;

        node.community.push({
            id: row.contribution_id,
            type: row.contribution_type,
            title: row.title,
            content: row.content,
            source: row.source || "",
            contributorId: row.contributor_id || ""
        });
    });

    const subjects = nodes
        .filter(row => row.node_type === "subject" && !row.parent_id)
        .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
        .map(row => nodeMap[row.node_id]);

    return {
        subjects,
        indexTerms: apiData.index_terms || [],
        indexLinks: apiData.index_links || []
    };
}

/* -----------------------------------------------------
   INDEX ENTRIES — same term/alias model as the in-panel Index
   on the main notebook page. Term-building/dedup itself now
   lives in js/index-data.js (loaded before this file), shared
   with js/app.js — see that file for the server-registry vs.
   local-fallback details.
   ----------------------------------------------------- */

/* -----------------------------------------------------
   RENDER — every term, grouped by letter, flowing across
   the right panel's CSS columns.
   ----------------------------------------------------- */

/* -----------------------------------------------------
   SCOPE FILTER — Subject > Course > Unit > Chapter cascading
   dropdowns (left panel, MORE TOOLS). Selecting a level narrows
   BOTH the A-Z list and the By Subject tree down to that branch
   (filter) and switches to/scrolls the By Subject tree to it
   (jump) — the same node.id set is reused by both list renderers
   below, no separate filtering logic per view.
   ----------------------------------------------------- */

let scopeFilterNodeId = null;

function findNodeById(nodes, targetId) {
    for (const node of nodes || []) {
        if (node.id === targetId) return node;
        const found = findNodeById(node.children, targetId);
        if (found) return found;
    }
    return null;
}

function collectNodeAndDescendantIds(node, set = new Set()) {
    if (!node) return set;
    set.add(node.id);
    (node.children || []).forEach(child => collectNodeAndDescendantIds(child, set));
    return set;
}

// Applied after filterIndexRegistry() in both list renderers below —
// a term stays in the list if ANY of its matches falls inside the
// active scope (itself or a descendant), same many-to-many registry
// data every other view already reads.
function applyScopeToGroups(groups) {
    if (!scopeFilterNodeId) return groups;
    const node = findNodeById(window.__studyData?.subjects || [], scopeFilterNodeId);
    if (!node) return groups;
    const scopeIds = collectNodeAndDescendantIds(node);
    return groups.filter(g => g.matches.some(m => scopeIds.has(m.nodeId)));
}

function rerenderCurrentIndexView() {
    const query = document.getElementById("index-directory-search")?.value.trim().toLowerCase() || "";
    if (indexDirectorySort === "hierarchy") renderIndexHierarchy(query); else renderIndexColumns(query);
}

function renderIndexColumns(filterText = "") {
    const container = document.getElementById("index-directory-columns");
    const countEl = document.getElementById("index-directory-count");
    if (!container) return;

    const groups = applyScopeToGroups(filterIndexRegistry(filterText));

    if (countEl) {
        countEl.textContent = `${groups.length} term${groups.length === 1 ? "" : "s"}`;
    }

    container.innerHTML = "";

    if (!groups.length) {
        container.innerHTML = `<p class="index-empty-note">${
            filterText ? "No index entries match your search." : "No index entries yet."
        }</p>`;
        return;
    }

    const byLetter = {};
    groups.forEach(group => {
        const first = group.term.trim().charAt(0).toUpperCase();
        const letter = /[A-Z]/.test(first) ? first : "#";
        (byLetter[letter] = byLetter[letter] || []).push(group);
    });

    Object.keys(byLetter).sort().forEach(letter => {
        const letterGroup = document.createElement("div");
        letterGroup.className = "index-letter-group";

        const heading = document.createElement("h4");
        heading.className = "index-letter-heading";
        heading.textContent = letter;
        letterGroup.appendChild(heading);

        byLetter[letter].forEach(group => {
            const row = document.createElement("div");
            row.className = "index-term-row";

            const singleMatch = group.matches.length === 1 ? group.matches[0] : null;
            row.innerHTML = `
                <span class="index-term-name">${escapeHtml(group.term)}</span>
                ${singleMatch && singleMatch.isAlias
                    ? `<span class="index-term-alias-of">see ${escapeHtml(singleMatch.nodeTitle)}</span>`
                    : ""}
                ${group.matches.length > 1
                    ? `<span class="index-term-alias-of">${group.matches.length} locations</span>`
                    : ""}
                <button type="button" class="index-term-delete-btn" title="Delete this term" aria-label="Delete this term">×</button>
            `;

            row.querySelector(".index-term-name").addEventListener("click", () => handleIndexGroupClick(group));
            row.querySelector(".index-term-alias-of")?.addEventListener("click", () => handleIndexGroupClick(group));
            row.querySelector(".index-term-delete-btn").addEventListener("click", (event) => {
                event.stopPropagation();
                deleteIndexTerm(group);
            });
            letterGroup.appendChild(row);
        });

        container.appendChild(letterGroup);
    });
}

function findPathToNode(nodes, targetId, path = []) {
    for (const node of nodes || []) {
        const nextPath = [...path, node];
        if (node.id === targetId) return nextPath;

        const found = findPathToNode(node.children, targetId, nextPath);
        if (found) return found;
    }
    return null;
}

// Full Subject → ... → Topic breadcrumb for one match, so a term that
// appears in more than one place can actually be told apart in the
// picker below — a bare leaf title (e.g. two different "Introduction"
// topics under different subjects) isn't enough on its own.
function breadcrumbForNode(nodeId) {
    const path = findPathToNode(window.__studyData?.subjects || [], nodeId);
    return path && path.length
        ? path.map(n => n.title).filter(Boolean).join(" → ")
        : null;
}

function handleIndexGroupClick(group) {
    if (group.matches.length === 1) {
        goToNodeInNotebook(group.matches[0].nodeId);
    } else {
        showIndexPicker(group);
    }
}

// Opens the main notebook in a NEW tab (not location.href) so the
// Index directory page itself stays open — a student browsing several
// terms in a row shouldn't lose their place/scroll position here every
// time they follow one to the notebook.
function goToNodeInNotebook(nodeId) {
    window.open(`index.html?openNode=${encodeURIComponent(nodeId)}`, "_blank");
}

function showIndexPicker(group) {
    document.getElementById("index-picker-modal")?.remove();

    const backdrop = document.createElement("div");
    backdrop.id = "index-picker-modal";
    backdrop.className = "structure-dialog-backdrop";
    backdrop.innerHTML = `
        <div class="structure-dialog">
            <h3>${escapeHtml(group.term)}</h3>
            <p>This term appears in more than one place. Choose the topic you meant:</p>
            <div class="index-picker-list">
                ${group.matches.map(m => {
                    const breadcrumb = breadcrumbForNode(m.nodeId);
                    return `
                    <button type="button" class="index-picker-option" data-node-id="${escapeHtml(m.nodeId)}">
                        <span class="index-picker-option-title">${escapeHtml(m.nodeTitle)}</span>
                        ${breadcrumb ? `<span class="index-picker-option-path">${escapeHtml(breadcrumb)}</span>` : ""}
                    </button>`;
                }).join("")}
            </div>
            <div class="structure-dialog-actions">
                <button type="button" id="index-picker-cancel">Cancel</button>
            </div>
        </div>
    `;

    document.body.appendChild(backdrop);

    backdrop.querySelector("#index-picker-cancel").onclick = () => backdrop.remove();
    backdrop.querySelectorAll(".index-picker-option").forEach(btn => {
        btn.addEventListener("click", () => goToNodeInNotebook(btn.dataset.nodeId));
    });
}

/* -----------------------------------------------------
   DELETE — manual glossary management from this page.
   Removes the Index_Terms row AND every Index_Node link to it
   (cascade) — this is a full delete, not an unlink from one topic
   (that's what "Unmark as index term" in the main notebook is for).
   ----------------------------------------------------- */

async function deleteIndexTerm(group) {
    const confirmed = window.confirm(
        `Delete "${group.term}" from the index?\n\nThis removes it everywhere (all ${group.matches.length || 0} linked topic${group.matches.length === 1 ? "" : "s"}), not just here. This cannot be undone.`
    );
    if (!confirmed) return;

    try {
        await fetch(GOOGLE_SHEET_API, {
            method: "POST",
            mode: "no-cors",
            body: JSON.stringify({ action: "delete_index_term", index_id: group.indexId })
        });

        // Optimistic removal — strip it from this page's own snapshot
        // so it disappears immediately without waiting on a refresh.
        window.__studyData.indexTerms = (window.__studyData.indexTerms || [])
            .filter(row => String(row.index_id) !== String(group.indexId));
        window.__studyData.indexLinks = (window.__studyData.indexLinks || [])
            .filter(row => String(row.index_id) !== String(group.indexId));
        invalidateIndexRegistry();

        const query = document.getElementById("index-directory-search")?.value.trim().toLowerCase() || "";
        if (indexDirectorySort === "hierarchy") renderIndexHierarchy(query); else renderIndexColumns(query);
    } catch (error) {
        console.error("Deleting index term failed:", error);
    }
}

document.getElementById("index-directory-search")?.addEventListener("input", event => {
    const query = event.target.value.trim().toLowerCase();
    if (indexDirectorySort === "hierarchy") {
        renderIndexHierarchy(query);
    } else {
        renderIndexColumns(query);
    }
});

/* -----------------------------------------------------
   SORT TOGGLE — A–Z (existing) vs By Subject (new): groups
   every term under its actual Subject → Course → Unit →
   Chapter → Topic location instead of alphabetically, so a
   student can browse the index the same way they browse the
   syllabus tree on the left of the main notebook.
   ----------------------------------------------------- */

let indexDirectorySort = "az";

function initIndexDirectorySort() {
    document.querySelectorAll(".index-sort-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            indexDirectorySort = btn.dataset.indexSort;
            document.querySelectorAll(".index-sort-btn").forEach(b => b.classList.toggle("active", b === btn));

            document.getElementById("index-directory-columns").hidden = indexDirectorySort !== "az";
            document.getElementById("index-directory-hierarchy").hidden = indexDirectorySort !== "hierarchy";

            const query = document.getElementById("index-directory-search")?.value.trim().toLowerCase() || "";
            if (indexDirectorySort === "hierarchy") {
                renderIndexHierarchy(query);
            } else {
                renderIndexColumns(query);
            }
        });
    });
}

const SCOPE_LEVELS = [
    { select: "scope-subject", label: "Subject" },
    { select: "scope-course", label: "Course" },
    { select: "scope-unit", label: "Unit" },
    { select: "scope-chapter", label: "Chapter" }
];

function scopeLevelSelect(i) {
    return document.getElementById(SCOPE_LEVELS[i].select);
}

function populateScopeLevel(i, parentNode) {
    const select = scopeLevelSelect(i);
    if (!select) return;
    const children = parentNode ? (parentNode.children || []) : (window.__studyData?.subjects || []);
    select.innerHTML = `<option value="">${SCOPE_LEVELS[i].label}…</option>` +
        children.map(n => `<option value="${escapeHtml(n.id)}">${escapeHtml(n.title || "(untitled)")}</option>`).join("");
    select.disabled = children.length === 0;
    select.value = "";
}

function resetScopeLevelsFrom(i) {
    for (let j = i; j < SCOPE_LEVELS.length; j++) {
        const select = scopeLevelSelect(j);
        if (!select) continue;
        select.innerHTML = `<option value="">${SCOPE_LEVELS[j].label}…</option>`;
        select.value = "";
        select.disabled = true;
    }
}

// The active scope is always whichever level's dropdown has the
// deepest current selection — a shallower level left blank (e.g. user
// picked a Subject but no Course yet) still counts, it just scopes to
// a wider branch.
function currentScopeNodeId() {
    for (let i = SCOPE_LEVELS.length - 1; i >= 0; i--) {
        const val = scopeLevelSelect(i)?.value;
        if (val) return val;
    }
    return null;
}

// "Jump": switch to the By Subject tree (the only view a branch can be
// scrolled to) and flash the selected branch into view — paired with
// the "filter" applyScopeToGroups() already narrows both views to.
function jumpToScopeBranch(nodeId) {
    indexDirectorySort = "hierarchy";
    document.querySelectorAll(".index-sort-btn").forEach(b =>
        b.classList.toggle("active", b.dataset.indexSort === "hierarchy"));
    document.getElementById("index-directory-columns").hidden = true;
    document.getElementById("index-directory-hierarchy").hidden = false;

    rerenderCurrentIndexView();

    requestAnimationFrame(() => {
        const el = [...document.querySelectorAll(".index-hierarchy-node")]
            .find(n => n.dataset.nodeId === nodeId);
        if (!el) return;
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        el.classList.add("index-hierarchy-node-flash");
        setTimeout(() => el.classList.remove("index-hierarchy-node-flash"), 1600);
    });
}

function initScopeFilter() {
    populateScopeLevel(0, null);

    SCOPE_LEVELS.forEach((level, i) => {
        const select = scopeLevelSelect(i);
        select?.addEventListener("change", () => {
            resetScopeLevelsFrom(i + 1);

            if (select.value && i + 1 < SCOPE_LEVELS.length) {
                populateScopeLevel(i + 1, findNodeById(window.__studyData?.subjects || [], select.value));
            }

            scopeFilterNodeId = currentScopeNodeId();
            const clearBtn = document.getElementById("scope-clear-btn");
            if (clearBtn) clearBtn.hidden = !scopeFilterNodeId;

            if (scopeFilterNodeId) {
                jumpToScopeBranch(scopeFilterNodeId);
            } else {
                rerenderCurrentIndexView();
            }
        });
    });

    document.getElementById("scope-clear-btn")?.addEventListener("click", () => {
        scopeFilterNodeId = null;
        resetScopeLevelsFrom(0);
        populateScopeLevel(0, null);
        document.getElementById("scope-clear-btn").hidden = true;
        rerenderCurrentIndexView();
    });
}
// several matches contributes to several nodes, same registry data
// the A-Z view and the picker already use — just re-grouped).
function buildTermsByNode(filterText) {
    const groups = applyScopeToGroups(filterIndexRegistry(filterText));
    const termsByNode = new Map();

    groups.forEach(g => {
        g.matches.forEach(m => {
            if (!termsByNode.has(m.nodeId)) termsByNode.set(m.nodeId, []);
            termsByNode.get(m.nodeId).push(g.term);
        });
    });

    return termsByNode;
}

// A branch (subject/course/unit/chapter) is only worth rendering if
// SOMETHING under it (itself or any descendant) actually has a term —
// otherwise most of the syllabus tree would render as empty headings.
function nodeHasTermsDeep(node, termsByNode, cache) {
    if (cache.has(node.id)) return cache.get(node.id);

    let has = (termsByNode.get(node.id) || []).length > 0;
    (node.children || []).forEach(child => {
        if (nodeHasTermsDeep(child, termsByNode, cache)) has = true;
    });

    cache.set(node.id, has);
    return has;
}

function renderIndexHierarchy(filterText = "") {
    const container = document.getElementById("index-directory-hierarchy");
    const countEl = document.getElementById("index-directory-count");
    if (!container) return;

    const termsByNode = buildTermsByNode(filterText);
    const cache = new Map();
    const roots = window.__studyData?.subjects || [];

    container.innerHTML = "";
    let totalTerms = 0;
    termsByNode.forEach(list => { totalTerms += list.length; });

    if (countEl) {
        countEl.textContent = `${totalTerms} term${totalTerms === 1 ? "" : "s"}`;
    }

    if (!totalTerms) {
        container.innerHTML = `<p class="index-empty-note">${
            filterText ? "No index entries match your search." : "No index entries yet."
        }</p>`;
        return;
    }

    roots.forEach(node => renderHierarchyBranch(node, 0, termsByNode, cache, container));
}

function renderHierarchyBranch(node, depth, termsByNode, cache, container) {
    if (!nodeHasTermsDeep(node, termsByNode, cache)) return;

    const wrap = document.createElement("div");
    wrap.className = `index-hierarchy-node index-hierarchy-depth-${Math.min(depth, 4)}`;
    wrap.dataset.nodeId = node.id;

    const heading = document.createElement("div");
    heading.className = "index-hierarchy-heading";
    heading.textContent = node.title || "(untitled)";
    wrap.appendChild(heading);

    const terms = [...new Set(termsByNode.get(node.id) || [])].sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: "base" })
    );

    if (terms.length) {
        const list = document.createElement("div");
        list.className = "index-hierarchy-terms";
        terms.forEach(term => {
            const row = document.createElement("span");
            row.className = "index-hierarchy-term-chip";
            row.textContent = term;
            // Already know exactly which node this term belongs to here —
            // no ambiguity/picker needed, go straight there.
            row.addEventListener("click", () => goToNodeInNotebook(node.id));
            list.appendChild(row);
        });
        wrap.appendChild(list);
    }

    (node.children || []).forEach(child => renderHierarchyBranch(child, depth + 1, termsByNode, cache, wrap));
    container.appendChild(wrap);
}

/* -----------------------------------------------------
   REFRESH — this page's window.__studyData (and therefore
   getIndexRegistry()'s cache) is only ever fetched once, when
   the page first loads. A term added/edited in the main
   notebook AFTER that won't appear here until this re-fetches.
   ----------------------------------------------------- */

document.getElementById("index-directory-refresh")?.addEventListener("click", async (event) => {
    const btn = event.currentTarget;
    const originalText = btn.textContent;
    btn.textContent = "Refreshing…";
    btn.disabled = true;

    try {
        // Lightweight refresh — just the two index sheets, not the
        // whole Nodes/Content/Resources structure (loadStudyData()
        // would work too, just slower for what's actually needed here).
        const response = await fetch(`${GOOGLE_SHEET_API}?action=get_index_registry`);
        const data = await response.json();

        if (data && data.success) {
            window.__studyData = window.__studyData || {};
            window.__studyData.indexTerms = data.index_terms || [];
            window.__studyData.indexLinks = data.index_links || [];
            invalidateIndexRegistry();

            const query = document.getElementById("index-directory-search")?.value.trim().toLowerCase() || "";
            if (indexDirectorySort === "hierarchy") {
                renderIndexHierarchy(query);
            } else {
                renderIndexColumns(query);
            }
        }
    } catch (error) {
        console.error("Index directory refresh failed:", error);
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
    }
});

/* -----------------------------------------------------
   BOOT
   ----------------------------------------------------- */

async function initIndexDirectory() {
    const data = await loadStudyData();

    if (!data) {
        const container = document.getElementById("index-directory-columns");
        if (container) {
            container.innerHTML =
                `<p class="index-empty-note">Index data could not be loaded.</p>`;
        }
        return;
    }

    window.__studyData = data;
    initIndexDirectorySort();
    initScopeFilter();
    renderIndexColumns();
}

initIndexDirectory();

/* -----------------------------------------------------
   LEFT PANEL — drag-to-resize + collapse, same mechanism
   as the main notebook's left/right panels: collapsing
   hands the freed width straight to the right panel since
   it's the grid's minmax(300px, 1fr) track.
   ----------------------------------------------------- */

(function enableIndexDirectoryPanel() {
    const workspace = document.getElementById("index-directory-workspace");
    const leftPanel = document.getElementById("index-left-panel");
    const resizer = document.getElementById("index-directory-resizer");
    const toggle = document.getElementById("index-directory-toggle");

    if (!workspace || !leftPanel || !resizer) return;

    const MIN_LEFT = 220;
    const MIN_RIGHT = 300;
    const COLLAPSED_WIDTH = 52;
    const DEFAULT_WIDTH = 320;

    let dragging = false;
    let lastWidth = DEFAULT_WIDTH;

    function currentLeftWidth() {
        const styles = getComputedStyle(workspace);
        return parseFloat(styles.gridTemplateColumns.split(" ")[0]);
    }

    function start(event) {
        if (window.innerWidth <= 900) return;
        if (leftPanel.classList.contains("panel-collapsed")) return;
        dragging = true;
        document.body.classList.add("index-directory-resizing");
        event.preventDefault();
    }

    function move(event) {
        if (!dragging) return;
        const rect = workspace.getBoundingClientRect();
        let width = event.clientX - rect.left;
        width = Math.max(MIN_LEFT, Math.min(width, rect.width - MIN_RIGHT));
        workspace.style.setProperty("--idx-left-width", `${width}px`);
    }

    function stop() {
        dragging = false;
        document.body.classList.remove("index-directory-resizing");
    }

    resizer.addEventListener("mousedown", start);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", stop);

    toggle?.addEventListener("click", () => {
        if (window.innerWidth <= 900) return;

        const collapsed = leftPanel.classList.contains("panel-collapsed");

        if (!collapsed) {
            lastWidth = currentLeftWidth() || DEFAULT_WIDTH;
            workspace.style.setProperty("--idx-left-width", `${COLLAPSED_WIDTH}px`);
        } else {
            workspace.style.setProperty("--idx-left-width", `${lastWidth}px`);
        }

        leftPanel.classList.toggle("panel-collapsed", !collapsed);
        toggle.setAttribute("aria-expanded", String(collapsed));
        toggle.title = !collapsed ? "Expand search panel" : "Collapse search panel";
    });
})();
