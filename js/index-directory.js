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

function renderIndexColumns(filterText = "") {
    const container = document.getElementById("index-directory-columns");
    const countEl = document.getElementById("index-directory-count");
    if (!container) return;

    const groups = filterIndexRegistry(filterText);

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
                    ? `<span class="index-term-alias-of">${group.matches.length} topics</span>`
                    : ""}
            `;

            row.addEventListener("click", () => handleIndexGroupClick(group));
            letterGroup.appendChild(row);
        });

        container.appendChild(letterGroup);
    });
}

function handleIndexGroupClick(group) {
    if (group.matches.length === 1) {
        goToNodeInNotebook(group.matches[0].nodeId);
    } else {
        showIndexPicker(group);
    }
}

function goToNodeInNotebook(nodeId) {
    window.location.href = `index.html?openNode=${encodeURIComponent(nodeId)}`;
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
                ${group.matches.map(m => `
                    <button type="button" class="index-picker-option" data-node-id="${escapeHtml(m.nodeId)}">
                        ${escapeHtml(m.nodeTitle)}
                    </button>`).join("")}
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

document.getElementById("index-directory-search")?.addEventListener("input", event => {
    renderIndexColumns(event.target.value.trim().toLowerCase());
});

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
    renderIndexColumns();
}

initIndexDirectory();
