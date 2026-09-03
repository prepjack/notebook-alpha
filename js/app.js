/* =========================================================
   PROJECT ALPHA — APPLICATION LOGIC
   Step 3: JSON-driven expandable Index
   ========================================================= */


/* =========================================================
   STEP 2 — HORIZONTAL PANEL RESIZING
   ========================================================= */

(function enablePanelResizing() {
    const workspace = document.getElementById("study-workspace");
    const leftPanel = document.getElementById("left-panel");
    const rightPanel = document.getElementById("right-panel");
    const leftResizer = document.getElementById("left-resizer");
    const rightResizer = document.getElementById("right-resizer");

    if (!workspace || !leftPanel || !rightPanel ||
        !leftResizer || !rightResizer) return;

    let activeSide = null;

    const MIN_LEFT = 240;
    const MIN_RIGHT = 260;
    const MIN_MIDDLE = 300;

    function start(side, event) {
        if (window.innerWidth <= 900) return;
        // A collapsed panel's resizer is hidden via CSS, but guard here
        // too in case start() is ever triggered another way.
        if (side === "left" && leftPanel.classList.contains("panel-collapsed")) return;
        if (side === "right" && rightPanel.classList.contains("panel-collapsed")) return;
        activeSide = side;
        document.body.classList.add("resizing-panels");
        event.preventDefault();
    }

    function move(event) {
        if (!activeSide) return;

        const rect = workspace.getBoundingClientRect();
        const styles = getComputedStyle(workspace);
        const columns = styles.gridTemplateColumns
            .split(" ")
            .map(value => parseFloat(value));

        const currentLeft = columns[0];
        const currentRight = columns[columns.length - 1];

        let leftWidth = currentLeft;
        let rightWidth = currentRight;

        if (activeSide === "left") {
            leftWidth = event.clientX - rect.left;
            leftWidth = Math.max(
                MIN_LEFT,
                Math.min(leftWidth, rect.width - MIN_MIDDLE - currentRight)
            );
        }

        if (activeSide === "right") {
            rightWidth = rect.right - event.clientX;
            rightWidth = Math.max(
                MIN_RIGHT,
                Math.min(rightWidth, rect.width - MIN_MIDDLE - currentLeft)
            );
        }

        workspace.style.setProperty("--left-width", `${leftWidth}px`);
        workspace.style.setProperty("--right-width", `${rightWidth}px`);
    }

    function stop() {
        activeSide = null;
        document.body.classList.remove("resizing-panels");
    }

    leftResizer.addEventListener("mousedown", event => start("left", event));
    rightResizer.addEventListener("mousedown", event => start("right", event));

    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", stop);

    /* -----------------------------------------------------
       STEP 4 — Collapse / expand toggle
       Collapsing a side panel shrinks it to a slim strip; the
       freed width goes to the middle CONTENT panel automatically
       because it is the grid's minmax(300px, 1fr) track. Drag-
       resize (above) is untouched — it keeps working normally
       whenever a panel is expanded, and simply gets disabled/
       hidden while that panel is collapsed.
       ----------------------------------------------------- */
    const leftToggle = document.getElementById("left-panel-toggle");
    const rightToggle = document.getElementById("right-panel-toggle");
    const COLLAPSED_WIDTH = 52;
    const DEFAULT_LEFT_WIDTH = 360;
    const DEFAULT_RIGHT_WIDTH = 360;

    let lastLeftWidth = DEFAULT_LEFT_WIDTH;
    let lastRightWidth = DEFAULT_RIGHT_WIDTH;

    function currentColumnWidths() {
        const styles = getComputedStyle(workspace);
        const columns = styles.gridTemplateColumns
            .split(" ")
            .map(value => parseFloat(value));
        return { left: columns[0], right: columns[columns.length - 1] };
    }

    function setLeftCollapsed(collapsed) {
        if (collapsed) {
            const widths = currentColumnWidths();
            if (widths.left) lastLeftWidth = widths.left;
            workspace.style.setProperty("--left-width", `${COLLAPSED_WIDTH}px`);
        } else {
            workspace.style.setProperty("--left-width", `${lastLeftWidth}px`);
        }
        leftPanel.classList.toggle("panel-collapsed", collapsed);
        if (leftToggle) {
            leftToggle.setAttribute("aria-expanded", String(!collapsed));
            leftToggle.title = collapsed
                ? "Expand Table of Contents"
                : "Collapse Table of Contents";
        }
    }

    function setRightCollapsed(collapsed) {
        if (collapsed) {
            const widths = currentColumnWidths();
            if (widths.right) lastRightWidth = widths.right;
            workspace.style.setProperty("--right-width", `${COLLAPSED_WIDTH}px`);
        } else {
            workspace.style.setProperty("--right-width", `${lastRightWidth}px`);
        }
        rightPanel.classList.toggle("panel-collapsed", collapsed);
        if (rightToggle) {
            rightToggle.setAttribute("aria-expanded", String(!collapsed));
            rightToggle.title = collapsed
                ? "Expand References / Index"
                : "Collapse References / Index";
        }
    }

    leftToggle?.addEventListener("click", () => {
        if (window.innerWidth <= 900) return;
        setLeftCollapsed(!leftPanel.classList.contains("panel-collapsed"));
    });

    rightToggle?.addEventListener("click", () => {
        if (window.innerWidth <= 900) return;
        setRightCollapsed(!rightPanel.classList.contains("panel-collapsed"));
    });
})();


/* =========================================================
   STEP 3 — LOAD JSON AND BUILD THE INDEX
   ========================================================= */

const studyTreeElement = document.getElementById("study-tree");

const GOOGLE_SHEET_API =
    "https://script.google.com/macros/s/AKfycbzE7zuqKXMmvfoP6LNCRw159odJsqWW9O0hEWm7uHIelnQJz4x7iFMnbTDKvm8lpIw5QA/exec";


async function loadStudyData() {

    // 1. Try Google Sheets / Apps Script first
    try {
        const response = await fetch(GOOGLE_SHEET_API);

        if (!response.ok) {
            throw new Error(`Google Sheet API failed (${response.status})`);
        }

        const apiData = await response.json();

        console.log("Google Sheets data loaded:", apiData);

        return convertApiDataToStudyData(apiData);

    } catch (error) {

        console.warn(
            "Google Sheets API unavailable; using local JSON fallback.",
            error
        );

        // 2. Existing local JSON remains our fallback
        try {
            const response = await fetch("data/study-data.json");

            if (!response.ok) {
                throw new Error(
                    `Could not load study-data.json (${response.status})`
                );
            }

            return await response.json();

        } catch (jsonError) {

            console.warn(
                "JSON fetch unavailable; using local fallback.",
                jsonError
            );

            if (window.STUDY_DATA_FALLBACK) {
                return window.STUDY_DATA_FALLBACK;
            }

            studyTreeElement.innerHTML = `
                <p style="color:#9b5c5c;font-family:Arial,sans-serif;font-size:13px;">
                    Study data could not be loaded.
                </p>
            `;

            return null;
        }
    }
}

function convertApiDataToStudyData(apiData) {

    const nodes = apiData.nodes || [];
    const contentRows = apiData.content || [];
    const resourceRows = apiData.resources || [];
    const communityRows = apiData.community || [];

    // Create a node map using stable IDs
    const nodeMap = {};

    nodes.forEach(row => {
        nodeMap[row.node_id] = {
            id: row.node_id,
            title: row.title,
            type: row.node_type,
            parentId: row.parent_id || null,
            driveFolderId: row.drive_folder_id || "",
            children: [],
            community: [],
            resources: []
        };
    });

    // Build hierarchy
    nodes.forEach(row => {

        const node = nodeMap[row.node_id];

        if (!node) return;

        if (row.parent_id && nodeMap[row.parent_id]) {
            nodeMap[row.parent_id].children.push(node);
        }
    });

    // Attach Core Content
    contentRows.forEach(row => {

        const node = nodeMap[row.node_id];

        if (!node) return;

        if (!node.content) {
            node.content = {};
        }

        const type = row.content_type;

        if (type === "key_points") {

            if (!node.content.keyPoints) {
                node.content.keyPoints = [];
            }

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

    // Attach Resources
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

    // Attach Community contributions
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

    // Find top-level subjects
    const subjects = nodes
        .filter(row =>
            row.node_type === "subject" &&
            !row.parent_id
        )
        .sort((a, b) =>
            Number(a.sort_order || 0) -
            Number(b.sort_order || 0)
        )
        .map(row => nodeMap[row.node_id]);

    return {
        subjects: subjects,
        // ALPHA-PLUS — INDEX REGISTRY: present only once the Apps Script
        // has the new "Index_Terms" / "Index_Node" sheets and returns
        // them (see google-sheet-template/Code.gs). Until then these
        // are simply absent and js/index-data.js transparently falls
        // back to deriving the Index from the tree, exactly as before.
        indexTerms: apiData.index_terms || [],
        indexLinks: apiData.index_links || []
    };
}

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

/* =========================================================
   ALPHA-PLUS — SCROLL POSITION MEMORY
   Keeps reading position per topic/language/depth in memory only.
   Same combination restores exact scrollTop.

   Language/depth switches restore by matching the NUMBERED POINT
   (e.g. "1.", "2.", "3." at the start of a heading's text) rather
   than by raw DOM position/index. Index-based matching broke
   whenever a variant had a different total heading count (an
   extra sub-heading in one language, a collapsed section in a
   shorter depth layer) — the point numbers lined up, but "the
   5th heading overall" didn't, since h1–h6 were all counted
   together as one flat list. Matching on the number itself finds
   the correct point regardless of how many other headings exist
   around it in that particular variant. Falls back to the old
   index-based match only for headings with no leading number, and
   to a proportional scrollTop if nothing matches at all.
   ========================================================= */
const contentScrollMemory = new Map();
let pendingScrollRestore = null;

const HEADING_SELECTOR = "#rc-explanation h1, #rc-explanation h2, #rc-explanation h3, #rc-explanation h4, #rc-explanation h5, #rc-explanation h6";

// The content-panel-header (CONTENT button + language/depth row + progress
// line) is position:sticky and stays pinned to the top of #middle-panel's
// scroll viewport, physically covering that much of the top of the visible
// area. Any scroll-to-heading math must clear this — a flat magic number
// under-shoots whenever the row wraps, the language row is hidden, or the
// page is on the narrower mobile layout — so measure it live instead.
function getStickyHeaderOffset() {
    const header = document.querySelector("#middle-panel .content-panel-header");
    return header ? header.getBoundingClientRect().height : 0;
}

// Reads a leading point-number off a heading's own text, e.g.
// "1. Human Memory" -> "1", "2) Encoding" -> "2", "3: Types" -> "3".
// Headings with no such prefix (an unnumbered sub-heading, a plain
// title) return null and fall back to index-based matching.
function extractHeadingNumber(headingText) {
    const match = String(headingText || "").trim().match(/^(\d+)[.):]/);
    return match ? match[1] : null;
}

function contentScrollKey(topicId, language, depth) {
    return `${topicId}::${language}::${depth}`;
}

function findVisibleHeadingInfo(host) {
    const headings = [...document.querySelectorAll(HEADING_SELECTOR)];
    let index = -1;
    let bestTop = -Infinity;
    const hostTop = host.getBoundingClientRect().top;

    headings.forEach((heading, i) => {
        const top = heading.getBoundingClientRect().top;
        if (top <= hostTop + 24 && top > bestTop) {
            bestTop = top;
            index = i;
        }
    });

    return {
        index,
        number: index >= 0 ? extractHeadingNumber(headings[index].textContent) : null
    };
}

function captureContentScrollPosition() {
    const host = document.getElementById("middle-panel");
    if (!host || !selectedTopicNode) return null;

    const info = findVisibleHeadingInfo(host);

    const state = {
        scrollTop: host.scrollTop,
        headingIndex: info.index,
        headingNumber: info.number
    };

    contentScrollMemory.set(
        contentScrollKey(selectedTopicNode.id, currentContentLanguage, currentContentDepth),
        state
    );
    return state;
}

function rememberBeforeContentVariantSwitch() {
    captureContentScrollPosition();
    const host = document.getElementById("middle-panel");
    if (!host || !selectedTopicNode) return;

    const info = findVisibleHeadingInfo(host);
    pendingScrollRestore = {
        mode: "semantic",
        headingIndex: info.index,
        headingNumber: info.number,
        fallbackScrollTop: host.scrollTop
    };
}

function prepareTopicScrollRestore(node) {
    const state = node ? contentScrollMemory.get(contentScrollKey(node.id, "EN", "FULL")) : null;
    // The exact topic/language/depth key is resolved once the new .md file
    // has been parsed. Until then, a new topic starts at the top.
    pendingScrollRestore = { mode: "topic", topicId: node ? node.id : null };
}

function restoreContentScrollPosition() {
    const host = document.getElementById("middle-panel");
    if (!host || !selectedTopicNode || !pendingScrollRestore) return;

    const pending = pendingScrollRestore;
    pendingScrollRestore = null;

    if (pending.mode === "topic") {
        const target = contentScrollMemory.get(
            contentScrollKey(selectedTopicNode.id, currentContentLanguage, currentContentDepth)
        );
        host.scrollTop = target ? target.scrollTop : 0;
        return;
    }

    const headings = [...document.querySelectorAll(HEADING_SELECTOR)];
    const hostRect = host.getBoundingClientRect();

    // 1. Preferred: find the SAME point-number in the new content,
    // wherever it now sits — robust to a different total heading
    // count between variants.
    if (pending.headingNumber) {
        const match = headings.find(h => extractHeadingNumber(h.textContent) === pending.headingNumber);
        if (match) {
            const headingRect = match.getBoundingClientRect();
            host.scrollTop += headingRect.top - hostRect.top - getStickyHeaderOffset() - 12;
            return;
        }
    }

    // 2. Fall back to the old same-position match — only meaningful
    // for headings that never carried a number to begin with.
    if (pending.headingIndex >= 0 && headings[pending.headingIndex]) {
        const headingRect = headings[pending.headingIndex].getBoundingClientRect();
        host.scrollTop += headingRect.top - hostRect.top - getStickyHeaderOffset() - 12;
        return;
    }

    // 3. Last resort: same scrollTop, clamped to the new content's height.
    host.scrollTop = Math.min(pending.fallbackScrollTop || 0, Math.max(0, host.scrollHeight - host.clientHeight));
}

function scheduleContentScrollRestore() {
    requestAnimationFrame(() => {
        restoreContentScrollPosition();
    });
}

function renderTopic(node) {
    if (selectedTopicNode && selectedTopicNode.id !== node.id) {
        captureContentScrollPosition();
    }
    selectedTopicNode = node;
    selectedTopicId = node.id;
    prepareTopicScrollRestore(node);
    renderContentLayer();
}


let activeContentLayer = "core";
let selectedTopicNode = null;

/* =========================================================
   ALPHA-PLUS — CONTENT LINK (Google Drive .md, fetched live)
   Session cache keyed by "<node_id>::<link>" so re-visiting the
   same topic with the same link doesn't re-fetch, but editing the
   link (or the node) always fetches fresh content.
   ========================================================= */
const markdownCache = new Map();

// Bumped on every renderContentLayer() call; any in-flight fetch
// whose token no longer matches the latest one is stale and its
// result is discarded (guards against rapid topic switching).
let contentRequestToken = 0;

function renderContentLayer() {
    const node = selectedTopicNode;
    const el = document.getElementById("topic-content");
    if (!node || !el) return;

    contentRequestToken += 1;
    const myToken = contentRequestToken;

    // Reset the Read Time button / reading-progress line for the
    // (possibly new) topic before its content is even in the DOM, so
    // the previous topic's numbers never briefly carry over.
    if (window.ReadingTools) window.ReadingTools.onNewArticle();

    if (activeContentLayer === "core") {
        const c = node.content || {};
        const diagrams = String(c.diagram || "")
            .split(/\r?\n/)
            .map(x => x.trim())
            .filter(Boolean);

        const mdLink = String(c.md_file || "").trim();
        const legacyText = String(c.explanation || "").trim();
        const hasContent = !!(mdLink || legacyText);

        el.innerHTML = `
            <h2>${escapeHtml(node.title || "")}</h2>

            <div class="content-action-row content-action-row-top">
                <span class="content-status-tag">${hasContent ? "Content added" : "No content yet"}</span>
                <button class="content-action" data-action="add-content-link">
                    🔗 ${mdLink ? "Replace Content Folder" : "Add Content Folder"}
                </button>
                <button class="content-action" data-action="open-drive-folder">
                    📁 Open Topic Folder
                </button>
                ${hasContent ? `
                <button class="content-action resource-delete-btn" data-action="remove-content">
                    🗑 Remove Content
                </button>` : ""}
            </div>

            ${!hasContent ? `
                <div class="empty-content-block">
                    <p>No content available for this topic. Create a content package in this topic's Google Drive folder, then link the <strong>folder</strong> here. The folder can contain Markdown, images, Mermaid diagrams, charts and Lottie animations.</p>
                    <button class="content-action" data-action="add-content-link">🔗 Add Content Folder</button>
                </div>` : ""}

            <div class="topic-section">
                <div class="rich-content" id="rc-explanation"></div>
            </div>

            ${hasContent ? `
                <div class="my-reading-time-row">
                    <button type="button" id="my-reading-time-btn" class="my-reading-time-btn">
                        My reading time
                    </button>
                </div>` : ""}

            ${diagrams.length ? `
                <div class="topic-section">
                    <h3>Diagrams / Graphs</h3>
                    <div class="topic-diagrams">
                        ${diagrams.map(url => `
                            <img src="${escapeHtml(url)}" alt="Diagram"
                                 class="topic-diagram-img" loading="lazy"
                                 onclick="window.open('${escapeHtml(url)}','_blank')">
                        `).join("")}
                    </div>
                </div>` : ""}`;

        const container = document.getElementById("rc-explanation");

        if (mdLink) {
            // New path: content lives in the user's own Google Drive as
            // a .md file; only the link is stored in the Sheet. Fetched
            // live (through Apps Script) and rendered with the exact
            // same renderRichContent() used everywhere else.
            loadAndRenderMdFileContent(node, mdLink, container, myToken);
        } else if (legacyText) {
            // Legacy path: full Markdown text saved directly into the
            // Sheet's "explanation" cell by the older Upload Markdown
            // flow. Routed through the same language-split entry point
            // as the Drive path — a legacy cell with no LANG markers
            // behaves exactly as before (single EN block, toggle row
            // stays hidden).
            applyMdTextToContentPanel(legacyText, container);
        } else {
            hideLanguageToggleRow();
        }
    }
}

async function loadAndRenderMdFileContent(node, mdLink, container, token) {
    if (!container) return;

    const cacheKey = node.id + "::" + mdLink;

    if (markdownCache.has(cacheKey)) {
        const cached = markdownCache.get(cacheKey);
        currentContentDebug = {
            stage: "CACHE HIT",
            mdLink,
            requestUrl: "(no network request — using in-memory cache)",
            responseKeys: "(cached object)",
            assetsKeys: Object.keys(cached.assets || {}),
            assetDataKeys: Object.keys(cached.assetData || {})
        };
        applyMdTextToContentPanel(cached.text, container, cached.assets, cached.assetData);
        return;
    }

    container.innerHTML = `<p class="rc-loading">Loading content…</p>`;
    hideLanguageToggleRow();

    try {
        const url = `${GOOGLE_SHEET_API}?action=get_markdown&ref=${encodeURIComponent(mdLink)}`;
        currentContentDebug = {
            stage: "FETCH START",
            mdLink,
            requestUrl: url,
            responseKeys: [],
            assetsKeys: [],
            assetDataKeys: []
        };
        // A normal (non no-cors) fetch, since the JSON response must
        // actually be readable here — unlike the fire-and-forget
        // save_core/save_resource POSTs elsewhere in this file.
        const response = await fetch(url);

        // Discard if the user has since switched to another topic.
        if (token !== contentRequestToken) return;

        const data = await response.json();

        if (token !== contentRequestToken) return;

        if (data && data.ok) {
            const text = String(data.content || "");
            // ALPHA-PLUS — CONTENT LINK: folder mode. When the saved
            // link points at a Drive FOLDER (not a single .md file),
            // get_markdown also returns an {filename: url} map for every
            // other file in that folder (images, ```lottie animation
            // .json files, ...) — see google-sheet-template/Code.gs
            // handleGetContentFolder_(). A single-file link always
            // returns assets: {}, so this is a no-op for the older flow.
            const assets = (data.assets && typeof data.assets === "object") ? data.assets : {};
            const assetData = (data.assetData && typeof data.assetData === "object") ? data.assetData : {};
            currentContentDebug = {
                stage: "API RESPONSE OK",
                mdLink,
                requestUrl: url,
                responseKeys: data && typeof data === "object" ? Object.keys(data) : [],
                assetsKeys: Object.keys(assets),
                assetDataKeys: Object.keys(assetData),
                rawOk: !!data.ok
            };
            console.log("ALPHA CONTENT DIAGNOSTIC — API response", {
                mdLink, url, responseKeys: currentContentDebug.responseKeys,
                assetsKeys: currentContentDebug.assetsKeys,
                assetDataKeys: currentContentDebug.assetDataKeys, data
            });
            markdownCache.set(cacheKey, { text, assets, assetData });

            if (!text.trim()) {
                container.innerHTML = `<p class="rc-error">This file is empty.</p>`;
                hideLanguageToggleRow();
            } else {
                applyMdTextToContentPanel(text, container, assets, assetData);
            }
        } else {
            const reason = (data && data.error) || "Could not read this file.";
            container.innerHTML = `<p class="rc-error">⚠ ${escapeHtml(reason)}</p>`;
            hideLanguageToggleRow();
        }
    } catch (error) {
        if (token !== contentRequestToken) return;
        console.error("Fetching Drive markdown failed:", error);
        container.innerHTML = `
            <p class="rc-error">⚠ Could not reach the content source. Check your
            connection, then reopen this topic to retry.</p>`;
        hideLanguageToggleRow();
    }
}

/* =========================================================
   CONTENT-LANGUAGE TOGGLE (EN / HI / HINGLISH) — content panel
   only. Splits raw markdown on top-level
     <!-- ===LANG:EN=== -->  <!-- ===LANG:HI=== -->  <!-- ===LANG:HINGLISH=== -->
   marker lines (each must sit alone on its own line). A file
   with none of these markers is treated as a single EN block —
   today's behavior, completely unchanged. Nothing here touches
   renderRichContent()/richcontent.js, the References panel, or
   fires any extra network request: the split runs on text
   that's already fetched/cached.
   ========================================================= */

const LANG_MARKER_RE = /^[ \t]*<!--\s*===LANG:(EN|HI|HINGLISH)===\s*-->[ \t]*$/gm;
const DEPTH_MARKER_RE = /^[ \t]*<!--\s*===DEPTH:(FULL|HALF|MINI)===\s*-->[ \t]*$/gm;

function splitContentByLanguage(rawMarkdown) {
    const text = String(rawMarkdown || "");
    const matches = [...text.matchAll(LANG_MARKER_RE)];

    if (!matches.length) {
        return { en: text, hi: null, hinglish: null, hasLanguageMarkers: false };
    }

    const result = { en: null, hi: null, hinglish: null, hasLanguageMarkers: true };
    const keyByTag = { EN: "en", HI: "hi", HINGLISH: "hinglish" };

    matches.forEach((match, i) => {
        const tag = keyByTag[match[1]];
        const start = match.index + match[0].length;
        const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
        const chunk = text.slice(start, end).trim();
        result[tag] = chunk || null; // an authored-but-empty block still counts as null (nothing to show)
    });

    return result;
}

// The split currently backing the content panel, plus which
// language is active — kept in memory only, nothing persisted to
// the Sheet. Re-rendering on toggle-click reuses this directly, no
// re-fetch and no re-parse of the raw text needed.
let currentLanguageSplit = null;
let currentContentLanguage = "EN";
let currentDepthSplit = null;
let currentContentDepth = "FULL";
// ALPHA-PLUS — CONTENT LINK: folder mode. {filename: url} for whatever
// content is currently loaded — {} for legacy/single-file content, or
// the folder's other files (images/lottie) when loaded via
// loadAndRenderMdFileContent(). See richcontent.js resolveAssetRefs().
let currentContentAssets = {};
let currentContentAssetData = {};
// TEMPORARY LOTTIE/API DIAGNOSTIC — traces the exact runtime path from
// Apps Script response -> extracted maps -> content renderer.
let currentContentDebug = null;

// Remembers the last language actually shown per topic node id, so
// revisiting a topic keeps whatever the user was reading; falls back
// to EN for topics that don't have that language authored.
const lastLanguagePerTopic = new Map();
const lastDepthPerTopicLanguage = new Map();

function splitLayerByDepth(languageBlockText) {
    const text = String(languageBlockText || "");
    const matches = [...text.matchAll(DEPTH_MARKER_RE)];

    if (!matches.length) {
        return { full: text, half: null, mini: null, hasDepthMarkers: false };
    }

    const result = { full: null, half: null, mini: null, hasDepthMarkers: true };
    const keyByTag = { FULL: "full", HALF: "half", MINI: "mini" };

    matches.forEach((match, i) => {
        const tag = keyByTag[match[1]];
        const start = match.index + match[0].length;
        const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
        const chunk = text.slice(start, end).trim();
        result[tag] = chunk || null;
    });

    return result;
}

function applyMdTextToContentPanel(rawText, container, assets, assetData) {
    currentContentAssets = (assets && typeof assets === "object") ? assets : {};
    currentContentAssetData = (assetData && typeof assetData === "object") ? assetData : {};
    currentContentDebug = {
        ...(currentContentDebug || {}),
        stage: (currentContentDebug && currentContentDebug.stage) || "APPLY CONTENT",
        applyAssetsKeys: Object.keys(currentContentAssets),
        applyAssetDataKeys: Object.keys(currentContentAssetData)
    };
    currentLanguageSplit = splitContentByLanguage(rawText);

    const preferred = (selectedTopicNode && lastLanguagePerTopic.get(selectedTopicNode.id)) || "EN";
    currentContentLanguage = languageBlockFor(preferred, currentLanguageSplit) ? preferred : "EN";

    const depthKey = selectedTopicNode ? `${selectedTopicNode.id}::${currentContentLanguage}` : null;
    const preferredDepth = (depthKey && lastDepthPerTopicLanguage.get(depthKey)) || "FULL";
    currentDepthSplit = splitLayerByDepth(languageBlockFor(currentContentLanguage, currentLanguageSplit) || "");
    currentContentDepth = depthBlockFor(preferredDepth, currentDepthSplit) ? preferredDepth : "FULL";

    renderCurrentLanguageBlock(container);
    updateLanguageToggleUI();
    updateDepthToggleUI();
}

function languageBlockFor(lang, split) {
    if (!split) return null;
    if (lang === "HI") return split.hi;
    if (lang === "HINGLISH") return split.hinglish;
    return split.en;
}

function depthBlockFor(depth, split) {
    if (!split) return null;
    if (depth === "HALF") return split.half;
    if (depth === "MINI") return split.mini;
    return split.full;
}

function renderCurrentLanguageBlock(container) {
    if (!container || !currentLanguageSplit) return;
    const languageText = languageBlockFor(currentContentLanguage, currentLanguageSplit) || currentLanguageSplit.en || "";
    currentDepthSplit = splitLayerByDepth(languageText);
    const text = depthBlockFor(currentContentDepth, currentDepthSplit) || currentDepthSplit.full || "";
    renderRichContent(text, container, currentContentAssets, currentContentAssetData);
    renderAlphaContentDiagnostic(container);
    if (window.ReadingTools) window.ReadingTools.onContentRendered();
    scheduleContentScrollRestore();
    buildContentTocPanel();
    syncAndRenderScopedIndex();
}

function renderAlphaContentDiagnostic(container) {
    // Production: diagnostics intentionally hidden; loading logic remains unchanged.
    return;
}

// Languages that get their own segment (button + depth dropdown) in the
// content-toggle-row. Each language remembers its own last-used depth via
// lastDepthPerTopicLanguage, so every segment's dropdown reflects that
// language's own Full/Half/Mini choice independently of the others.
const CONTENT_LANGUAGES = ["EN", "HI", "HINGLISH"];
const LANG_SEGMENT_SUFFIX = { EN: "en", HI: "hi", HINGLISH: "hinglish" };

// Picking a depth from a language's own dropdown switches to that language
// (if not already active) AND applies that depth, in one action.
function selectLanguageDepth(lang, depth) {
    if (!currentLanguageSplit) return;
    if (lang !== currentContentLanguage) {
        if (!languageBlockFor(lang, currentLanguageSplit)) return;
        switchContentLanguage(lang, depth);
    } else {
        switchContentDepth(depth);
    }
    closeAllLangDepthDropdowns();
}

function toggleLangDepthDropdown(lang) {
    const suffix = LANG_SEGMENT_SUFFIX[lang];
    const list = document.getElementById(`depth-list-${suffix}`);
    const caret = document.getElementById(`lang-caret-${suffix}`);
    if (!list || !caret) return;
    const wasOpen = !list.hidden;
    closeAllLangDepthDropdowns();
    if (!wasOpen) {
        list.hidden = false;
        caret.setAttribute("aria-expanded", "true");
    }
}

function closeAllLangDepthDropdowns() {
    CONTENT_LANGUAGES.forEach(lang => {
        const suffix = LANG_SEGMENT_SUFFIX[lang];
        const list = document.getElementById(`depth-list-${suffix}`);
        const caret = document.getElementById(`lang-caret-${suffix}`);
        if (list) list.hidden = true;
        if (caret) caret.setAttribute("aria-expanded", "false");
    });
}

document.addEventListener("click", e => {
    const row = document.getElementById("content-toggle-row");
    if (row && !row.contains(e.target)) closeAllLangDepthDropdowns();

    const tocBtn = document.getElementById("content-toc-btn");
    const tocPanel = document.getElementById("content-toc-panel");
    if (tocPanel && !tocPanel.hidden && tocBtn
        && !tocBtn.contains(e.target) && !tocPanel.contains(e.target)) {
        closeContentTocPanel();
    }
});

document.addEventListener("keydown", e => {
    if (e.key === "Escape") {
        closeAllLangDepthDropdowns();
        closeContentTocPanel();
    }
});

/* =========================================================
   CONTENT outline (table of contents) panel — lists every
   heading of the currently rendered variant, indented by
   level; clicking one scrolls the article to that heading.
   Rebuilt on every render (topic load, language switch, depth
   switch) so it always matches what's on screen right now.
   ========================================================= */
function buildContentTocPanel() {
    const btn = document.getElementById("content-toc-btn");
    const panel = document.getElementById("content-toc-panel");
    const list = document.getElementById("content-toc-list");
    if (!btn || !panel || !list) return;

    const headings = [...document.querySelectorAll(HEADING_SELECTOR)]
        .filter(h => h.textContent.trim());

    list.innerHTML = "";

    if (!headings.length) {
        btn.disabled = true;
        btn.classList.add("content-toc-empty");
        btn.setAttribute("aria-expanded", "false");
        closeContentTocPanel();
        return;
    }

    btn.disabled = false;
    btn.classList.remove("content-toc-empty");

    headings.forEach(h => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = `content-toc-item content-toc-level-${h.tagName.charAt(1)}`;
        item.textContent = h.textContent.trim();
        item.addEventListener("click", () => {
            closeContentTocPanel();
            scrollContentToHeading(h);
        });
        list.appendChild(item);
    });
}

function scrollContentToHeading(headingEl) {
    // #middle-panel is the actual scrollable element (.panel has
    // overflow:auto) — same host restoreContentScrollPosition() uses,
    // NOT #topic-content, which has no scroll of its own.
    const host = document.getElementById("middle-panel");
    if (!host || !headingEl) return;
    const hostRect = host.getBoundingClientRect();
    const headingRect = headingEl.getBoundingClientRect();
    host.scrollTop += headingRect.top - hostRect.top - getStickyHeaderOffset() - 12;
}

function toggleContentTocPanel() {
    const btn = document.getElementById("content-toc-btn");
    const panel = document.getElementById("content-toc-panel");
    if (!btn || !panel || btn.disabled) return;
    if (panel.hidden) {
        closeAllLangDepthDropdowns();
        panel.hidden = false;
        btn.setAttribute("aria-expanded", "true");
        btn.classList.add("active");
    } else {
        closeContentTocPanel();
    }
}

function closeContentTocPanel() {
    const btn = document.getElementById("content-toc-btn");
    const panel = document.getElementById("content-toc-panel");
    if (panel) panel.hidden = true;
    if (btn) {
        btn.setAttribute("aria-expanded", "false");
        btn.classList.remove("active");
    }
}

function switchContentLanguage(lang, forceDepth) {
    if (!currentLanguageSplit) return;
    if (!languageBlockFor(lang, currentLanguageSplit)) return; // not authored for this topic — button should be disabled anyway
    if (lang === currentContentLanguage) return;

    rememberBeforeContentVariantSwitch();
    currentContentLanguage = lang;
    if (selectedTopicNode) lastLanguagePerTopic.set(selectedTopicNode.id, lang);

    const depthKey = selectedTopicNode ? `${selectedTopicNode.id}::${lang}` : null;
    const languageText = languageBlockFor(lang, currentLanguageSplit) || "";
    const depthSplit = splitLayerByDepth(languageText);
    // A depth picked directly from this language's own dropdown (selectLanguageDepth)
    // wins over the remembered last-used depth for that language.
    const preferredDepth = forceDepth || (depthKey && lastDepthPerTopicLanguage.get(depthKey)) || "FULL";
    currentDepthSplit = depthSplit;
    currentContentDepth = depthBlockFor(preferredDepth, depthSplit) ? preferredDepth : "FULL";
    if (selectedTopicNode && depthKey) lastDepthPerTopicLanguage.set(depthKey, currentContentDepth);

    const container = document.getElementById("rc-explanation");
    if (!container) return;

    // Reset/recompute reading-time state before rendering the newly selected
    // language/depth content, so all reading tools use the live DOM.
    if (window.ReadingTools) window.ReadingTools.onNewArticle();
    renderCurrentLanguageBlock(container);
    updateLanguageToggleUI();
    updateDepthToggleUI();
}

function switchContentDepth(depth) {
    if (!currentLanguageSplit) return;

    const languageText = languageBlockFor(currentContentLanguage, currentLanguageSplit) || "";
    const depthSplit = splitLayerByDepth(languageText);
    if (!depthBlockFor(depth, depthSplit)) return;
    if (depth === currentContentDepth) return;

    rememberBeforeContentVariantSwitch();
    currentDepthSplit = depthSplit;
    currentContentDepth = depth;
    if (selectedTopicNode) {
        lastDepthPerTopicLanguage.set(`${selectedTopicNode.id}::${currentContentLanguage}`, depth);
    }

    const container = document.getElementById("rc-explanation");
    if (!container) return;

    if (window.ReadingTools) window.ReadingTools.onNewArticle();
    renderCurrentLanguageBlock(container);
    updateLanguageToggleUI();
    updateDepthToggleUI();
}

function updateLanguageToggleUI() {
    const row = document.getElementById("content-toggle-row");
    if (!row) return;

    if (!currentLanguageSplit) {
        row.hidden = true;
        return;
    }

    row.hidden = false;

    const langButtons = {
        EN: document.getElementById("lang-toggle-en"),
        HI: document.getElementById("lang-toggle-hi"),
        HINGLISH: document.getElementById("lang-toggle-hinglish")
    };

    CONTENT_LANGUAGES.forEach(lang => {
        const btn = langButtons[lang];
        const segment = document.getElementById(`lang-segment-${LANG_SEGMENT_SUFFIX[lang]}`);
        const authored = !!languageBlockFor(lang, currentLanguageSplit);
        if (btn) {
            btn.disabled = !authored;
            btn.classList.toggle("active", lang === currentContentLanguage);
        }
        if (segment) segment.classList.toggle("lang-segment-unavailable", !authored);
    });
}

function updateDepthToggleUI() {
    if (!currentLanguageSplit) return;

    CONTENT_LANGUAGES.forEach(lang => {
        const suffix = LANG_SEGMENT_SUFFIX[lang];
        const languageText = languageBlockFor(lang, currentLanguageSplit) || "";
        // For the active language reuse the already-computed split; for the
        // others (whose panel isn't rendered) compute it fresh — cheap, and
        // needed so each language's own dropdown can disable Full/Half/Mini
        // options that weren't authored for it.
        const depthSplit = lang === currentContentLanguage
            ? currentDepthSplit
            : splitLayerByDepth(languageText);
        if (!depthSplit) return;

        const depthKey = selectedTopicNode ? `${selectedTopicNode.id}::${lang}` : null;
        const shownDepth = lang === currentContentLanguage
            ? currentContentDepth
            : ((depthKey && lastDepthPerTopicLanguage.get(depthKey)) || "FULL");

        const buttons = {
            FULL: document.getElementById(`depth-toggle-full-${suffix}`),
            HALF: document.getElementById(`depth-toggle-half-${suffix}`),
            MINI: document.getElementById(`depth-toggle-mini-${suffix}`)
        };

        Object.keys(buttons).forEach(depth => {
            const btn = buttons[depth];
            if (!btn) return;
            const disabled = !depthBlockFor(depth, depthSplit);
            const active = depth === shownDepth;
            btn.disabled = disabled;
            btn.classList.toggle("active", active);
            btn.setAttribute("aria-selected", String(active));
        });
    });
}

function hideLanguageToggleRow() {
    currentLanguageSplit = null;
    currentDepthSplit = null;
    currentContentDepth = "FULL";
    const row = document.getElementById("content-toggle-row");
    if (row) row.hidden = true;
    closeAllLangDepthDropdowns();
    closeContentTocPanel();
    const tocList = document.getElementById("content-toc-list");
    if (tocList) tocList.innerHTML = "";
    const tocBtn = document.getElementById("content-toc-btn");
    if (tocBtn) {
        tocBtn.disabled = true;
        tocBtn.classList.add("content-toc-empty");
    }
}

document.addEventListener("click", e => {
    const action = e.target.closest("[data-action]");
    if (action && selectedTopicNode) {
        if (action.dataset.action === "contribute") {
            openContributionModal();
            return;
        }

        if (action.dataset.action === "add-content-link") {
            openAddContentLink();
            return;
        }

        if (action.dataset.action === "open-drive-folder") {
            openTopicDriveFolder();
            return;
        }

        if (action.dataset.action === "remove-content") {
            removeTopicContent();
            return;
        }
    }
});

async function openTopicDriveFolder() {
    if (!selectedTopicNode) return;

    try {
        const url = `${GOOGLE_SHEET_API}?action=get_or_create_node_folder&node_id=${encodeURIComponent(selectedTopicNode.id)}&_=${Date.now()}`;
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) throw new Error(`Folder API failed (${response.status})`);

        const data = await response.json();
        if (!data || !data.drive_folder_url) {
            throw new Error(data?.error || "Drive folder URL was not returned.");
        }

        selectedTopicNode.driveFolderId = data.drive_folder_id || selectedTopicNode.driveFolderId || "";
        window.open(data.drive_folder_url, "_blank", "noopener,noreferrer");
    } catch (error) {
        console.error("Open topic folder failed:", error);
        alert("Could not open/create this topic's Drive folder. Please check the Apps Script Drive authorization.");
    }
}

async function removeTopicContent() {
    if (!selectedTopicNode) return;
    if (!confirm("Remove all content for this topic? This cannot be undone.")) return;

    // Clearing "md_file" only unlinks the reference from the Sheet — it
    // never touches or deletes anything in the user's actual Google Drive.
    const clearedFields = ["definition", "explanation", "example", "key_points", "diagram", "md_file"];

    try {
        for (const content_type of clearedFields) {
            await fetch(GOOGLE_SHEET_API, {
                method: "POST",
                mode: "no-cors",
                body: JSON.stringify({
                    action: "save_core",
                    node_id: selectedTopicNode.id,
                    content_type,
                    title: selectedTopicNode.title,
                    content: "",
                    status: "published",
                    author_id: "author",
                    version: 1
                })
            });
        }

        clearMarkdownCacheForNode(selectedTopicNode.id);

        const c = selectedTopicNode.content || {};
        selectedTopicNode.content = {
            definition: "", explanation: "", example: "", keyPoints: [], diagram: "", md_file: "",
            index_terms: c.index_terms || ""
        };
        invalidateIndexCache();
        renderContentLayer();

    } catch (error) {
        console.error("Remove content failed:", error);
        alert("Could not remove content. Please try again.");
    }
}

function clearMarkdownCacheForNode(nodeId) {
    const prefix = nodeId + "::";
    [...markdownCache.keys()]
        .filter(key => key.startsWith(prefix))
        .forEach(key => markdownCache.delete(key));
}

/* =========================================================
   ALPHA-PLUS — ADD CONTENT LINK MODAL
   Same visual pattern as the "Add Reference" modal (same overlay/
   modal/close CSS classes). Saves a Google Drive .md link as plain
   text through the existing generic save_core action, exactly like
   definition/explanation/example already work — content_type is
   just "md_file" instead. No file ever leaves the user's own Drive
   and no file is uploaded through the browser here.
   ========================================================= */

const CONTENT_LINK_AI_PROMPT = `You are helping me create a complete study-content package for Notebook Alpha / Project Alpha, an AI-powered exam-preparation website.

The website uses ONE Google Drive FOLDER as a self-contained content package for this topic. I will place your generated Markdown file and every related asset inside that same folder, then link the FOLDER to the website.

SOURCE MATERIAL:
I will attach or paste a PDF (or other source material) in this same chat. Treat it as authoritative. Follow SOURCE FIDELITY below.

TOPIC CONTEXT:
Full hierarchy path:
<PUT HIERARCHY PATH HERE>

Topic:
<PUT TOPIC NAME HERE>

====================================================
CONTENT PACKAGE ARCHITECTURE — CRITICAL
====================================================
Create content intended for one self-contained folder:

Topic Folder/
├── content.md
├── image-1.png                 (genuinely useful)
├── diagram-1.png               (genuinely useful)
├── animation-1.json            (genuinely useful)
└── other supported assets

The main Markdown file may have any filename ending in .md. All referenced assets must be placed in the SAME folder.

Use only relative plain filenames for local assets.

Correct image reference:
![Information Lifecycle](information-lifecycle.png)

Correct Lottie block:
\`\`\`lottie
{
  "src": "study-process.json",
  "autoplay": true,
  "loop": true,
  "height": 220
}
\`\`\`

Incorrect Lottie syntax:
\`\`\`lottie
study-process.json
\`\`\`

Do NOT use made-up external URLs or Google Drive URLs inside the Markdown.
Every filename referenced in Markdown must exactly match a real asset filename in the same folder.

====================================================
MARKDOWN + VISUAL SUPPORT
====================================================
The file is rendered using marked.js (GitHub-flavored Markdown). Use:

- ## / ### headings
- **bold** and *italic*
- bullet lists and numbered lists
- standard Markdown tables
- > blockquotes for important exam callouts
- Mermaid diagrams
- Chart blocks
- Markdown images
- Lottie animations using the exact JSON configuration format above
- {{Term}} double-curly-brace wrapping for key terminologies, concepts,
  and definitions that belong in a glossary/index — see INDEX TERM
  MARKING below for how to use this

INDEX TERM MARKING:
As you write, identify the important terminologies, key concepts, and
definitions in this topic — the kind that would belong in a glossary
or index for a student revising this chapter. Wrap each such term in
double curly braces the FIRST time it appears WITHIN EACH depth
section (Full/Half/Mini), e.g. {{Mental Processes}} — each depth
section is rendered on its own, so the "first occurrence" rule resets
at the start of every FULL/HALF/MINI block, not just once for the
whole file. Do not wrap every bolded phrase — only wrap terms that
are genuinely index-worthy standalone concepts, not general emphasis.
Wrap a given term only once per depth section, at its first occurrence
there; leave all later mentions of the same term in that same section
as plain text (still use **bold** for emphasis on repeat mentions if
needed). Keep the exact same set of terms wrapped across EN, HI, and
HINGLISH versions of the same depth section, so the glossary stays
consistent regardless of which language the student is reading. Aim
for the natural set of key terms a student would want in a quick-
reference glossary for this topic — typically a handful per depth
section, not every noun phrase.

MERMAID:
Use \`\`\`mermaid fenced blocks for processes, hierarchies, cycles, relationships, flowcharts, or mind maps when they genuinely improve understanding.

CHART:
Use \`\`\`chart blocks only when numerical/comparative visualization is useful. Example:
\`\`\`chart
{"type":"bar","labels":["Primary","Secondary"],"data":[40,35]}
\`\`\`

IMAGES:
Use images only when they genuinely improve learning. Prefer Mermaid for structural diagrams that can be expressed directly in Markdown. Use simple lowercase-hyphenated filenames such as information-lifecycle.png.

LOTTIE:
Use a Lottie animation because it genuinely adds learning value. The .json animation file must be in the same folder and the Markdown block MUST contain a valid JSON configuration object with a "src" filename, as shown above.

Do not add visuals merely for decoration.

====================================================
SCOPE AND EDUCATIONAL QUALITY
====================================================
Using the hierarchy above, calibrate depth and scope to this exact topic. Stay within this topic's boundaries and avoid repeating content that belongs primarily to sibling or parent topics.

Create clear, serious, exam-oriented notes. Where relevant include:
- definitions
- core concepts
- explanations and relationships
- classifications/components/processes
- examples
- comparisons and tables
- important facts and exam-oriented points
- memory aids or recall cues where genuinely useful
- quick revision points and concise summary where appropriate

Do not use generic filler, excessive motivational language, decorative sections, or unnecessary repetition.
Do not use HTML.

====================================================
LANGUAGE + DEPTH ARCHITECTURE — CRITICAL
====================================================
The website has TWO independent controls:
1. Language: EN / HI / HINGLISH
2. Content depth: Full Read / Half Read / Mini Read

Therefore generate THREE depth versions for EACH language in ONE .md file, using this exact marker order:

<!-- ===LANG:EN=== -->
<!-- ===DEPTH:FULL=== -->
...English Full Read...
<!-- ===DEPTH:HALF=== -->
...English Half Read...
<!-- ===DEPTH:MINI=== -->
...English Mini Read...

<!-- ===LANG:HI=== -->
<!-- ===DEPTH:FULL=== -->
...Hindi Full Read...
<!-- ===DEPTH:HALF=== -->
...Hindi Half Read...
<!-- ===DEPTH:MINI=== -->
...Hindi Mini Read...

<!-- ===LANG:HINGLISH=== -->
<!-- ===DEPTH:FULL=== -->
...Hinglish Full Read...
<!-- ===DEPTH:HALF=== -->
...Hinglish Half Read...
<!-- ===DEPTH:MINI=== -->
...Hinglish Mini Read...

MARKER RULES:
- Copy every marker exactly.
- Every marker must be alone on its own line.
- Do not add spaces, punctuation, headings, or fences on marker lines.
- Do not omit any of the nine depth sections.
- Keep language order EN → HI → HINGLISH.
- Keep depth order FULL → HALF → MINI inside every language.
- Do not create separate files for languages or depths.

SECTION NUMBERING FOR TOGGLE SYNC — CRITICAL:
- Every ## heading in FULL must start with a strictly increasing major number: "1. Title", "2. Title", "3. Title".
- HALF and MINI must reuse the same numbers for the same concepts; do not independently renumber.
- If concepts are merged, keep the smaller original number.
- Numbering must be identical concept-for-concept across EN, HI, and HINGLISH.
- Never reuse one number for two different concepts.
- ### headings may optionally use decimals such as 2.1, 2.2.

DEPTH RULES:

FULL READ:
- Most complete and authoritative version.
- Preserve important source structure, sequence, terminology, definitions, examples, classifications, relationships, and exam-relevant detail.
- Explain concepts clearly rather than listing keywords.
- Add useful clarification, analogies, cross-links, or "why it matters" notes only when genuinely helpful and not factually invented.

HALF READ:
- Keep the same major heading order and conceptual coverage as FULL.
- Roughly half the reading time of FULL.
- Compress repetition and secondary detail while retaining definitions, core concepts, classifications, relationships, key examples, and exam-relevant facts.
- Must stand alone; never say "see Full Read".

MINI READ:
- Fastest revision version.
- Keep the same major heading order and numbering as FULL.
- Reduce each section to essential recall points, short definitions, one-line explanations, comparisons, rules/formulas where relevant, and recall cues.
- Roughly half the reading time of HALF.
- Must stand alone; never say "see Full Read" or "see Half Read".

All depths must remain factually consistent. Do not introduce facts in HALF or MINI that are absent from FULL/source material.

====================================================
LANGUAGE INSTRUCTIONS
====================================================
EN:
Write natural, clear English suitable for exam preparation. Preserve important technical and standard terminology.

HI:
Write fully in Hindi using Devanagari script. For important or difficult technical/academic terms, include the English term alongside the correct Hindi equivalent where useful, e.g. "सूचना संगठन (Information Organization)". Prefer terminology established in the source when available. Do not turn the section into Roman-script Hindi.

HINGLISH:
Don't add HINGLISH unless specifically told to do so.
Write natural spoken Hinglish using Devanagari sentence structure for Hindi grammar/connectors while keeping subject-specific and technical English terms in Roman script. Do not write the whole section in Roman-script Hindi and do not mechanically translate every technical term.
Example style:
"Mental Processes का मतलब है कि हमारा दिमाग कैसे काम करता है — जैसे Thinking, Learning और Remembering जैसी चीज़ें इसमें आती हैं।"

Maintain the SAME underlying content, heading order, examples, classifications, numbering, and depth relationship across EN, HI, and HINGLISH. Only language/style should change.

====================================================
SOURCE FIDELITY
====================================================
- Treat the uploaded/original source material as authoritative.
- Do not invent facts, dates, classifications, quotations, references, or source claims.
- Preserve important terminology, names, numbers, headings, and ordering.
- If a figure/table/diagram contains important information, represent it faithfully in Markdown, Mermaid, a chart, or a clearly specified asset where possible.
- Do not silently replace source terminology with unrelated general-knowledge terminology.
- Any explanatory analogy must be clearly educational and must not be presented as a source fact.

====================================================
FINAL ZIP FOLDER OUTPUT RULES
====================================================
- Return ONLY the Markdown content for the main .md file.
- Do not wrap the entire answer in a \`\`\`markdown fence.
- Do not add a preface, commentary, or "Here is your file" text.
- Keep the marker lines exactly intact.
- If you reference external assets by filename, after all Markdown content add a short plain section titled exactly:

Files needed in this folder:

List every required filename and what it should contain. This list is an instruction for assembling the folder and is NOT part of any language/depth block.

Before finishing, verify:
- all 9 language/depth blocks exist if Hinglish is requested otherwise 6 language/depth blocks
- marker order is exact
- section numbering sync is preserved
- Markdown references are valid
- Mermaid syntax is valid
- chart JSON is valid
- every image filename is consistent
- every Lottie block contains valid JSON configuration, not a bare filename
- every referenced asset filename is listed in "Files needed in this folder:"
- no unnecessary external URLs are used
- {{}} is used only for genuine glossary-worthy terms, once per depth section, and the same terms are wrapped consistently across EN/HI/HINGLISH

Create the complete Notebook Alpha study-content package for the topic and source material provided in zip folder.`;

function openAddContentLink() {
    if (!selectedTopicNode) return;
    document.getElementById("add-content-link-modal")?.remove();

    const existingLink = String((selectedTopicNode.content || {}).md_file || "");

    const modal = document.createElement("div");
    modal.id = "add-content-link-modal";
    modal.innerHTML = `
        <div class="add-resource-overlay">
            <div class="add-resource-modal content-link-modal-clean">
                <button type="button" class="modal-close" onclick="closeAddContentLink()">×</button>
                <h2>🔗 Add Content Folder</h2>
                <p class="add-resource-scope">Adding to: <strong>${escapeHtml(selectedTopicNode.title)}</strong></p>

                <div class="content-folder-steps">
                    <div class="content-folder-step"><span>1</span><div><strong>Copy the AI prompt</strong><small>Generate the Markdown and any images/animations needed for this topic.</small></div></div>
                    <div class="content-folder-step"><span>2</span><div><strong>Open this topic's Google Drive folder</strong><small>Upload the generated <code>.md</code> file and all referenced assets into that same folder.</small></div></div>
                    <div class="content-folder-step"><span>3</span><div><strong>Share the folder and paste its link below</strong><small>Set the folder to <strong>Anyone with the link can view</strong>.</small></div></div>
                </div>

                <div class="content-action-row content-folder-tools">
                    <button type="button" class="content-action primary" onclick="copyContentLinkAiPrompt()">📋 Copy AI Prompt</button>
                    <button type="button" class="content-action" onclick="openTopicDriveFolder()">📁 Open Topic Folder</button>
                </div>

                <label for="content-link-url">Google Drive folder link</label>
                <input id="content-link-url" type="url" value="${escapeHtml(existingLink)}"
                       placeholder="https://drive.google.com/drive/folders/...">
                <p class="drive-note"><strong>Paste the topic folder link here — not the individual .md file link.</strong><br>
                    The folder should contain one <code>.md</code> file plus any images, Lottie <code>.json</code> files, or other assets referenced by that Markdown.</p>

                <details class="content-link-guide">
                    <summary>Supported content formats</summary>
                    <pre class="content-link-guide-body">## Heading
**bold**  *italic*
- bullet point
1. numbered step

| Term | Meaning |
|------|---------|
| RAM  | Volatile |

> Important exam note

\`\`\`mermaid
flowchart TD
A[Concept] --> B[Explanation]
\`\`\`

\`\`\`chart
{"type":"bar","labels":["A","B"],"data":[40,60]}
\`\`\`

![Caption](image-file.png)

\`\`\`lottie
{"src":"animation-file.json","autoplay":true,"loop":true,"height":220}
\`\`\`

All local filenames above must exist in the same linked folder.</pre>
                </details>

                <button class="resource-submit-btn" type="button" onclick="submitContentLink()">Save Folder Link</button>
            </div>
        </div>`;
    document.body.appendChild(modal);
}

function closeAddContentLink() {
    document.getElementById("add-content-link-modal")?.remove();
}

// Build the exact hierarchy path for the selected node.
// This intentionally uses the actual loaded tree, so the AI prompt always
// receives the same Subject → Course → Unit → Chapter → Topic context that
// the user is currently working inside.
function buildTopicBreadcrumb(node) {
    if (!node) return "";

    const path = findPathToNode(
        window.__studyData?.subjects || [],
        node.id
    );

    if (path && path.length) {
        return path.map(item => item.title).filter(Boolean).join(" → ");
    }

    // Safe fallback for partially loaded/local data.
    const chain = [];
    let current = node;
    const seen = new Set();

    while (current && !seen.has(current.id)) {
        chain.unshift(current.title || "");
        seen.add(current.id);
        current = current.parentId
            ? findNodeById(window.__studyData?.subjects || [], current.parentId)
            : null;
    }

    return chain.filter(Boolean).join(" → ") || (node.title || "");
}

function copyContentLinkAiPrompt() {
    if (!selectedTopicNode) {
        alert("Please select a topic before copying the AI prompt.");
        return;
    }

    const topicTitle = selectedTopicNode.title || "<PUT TOPIC NAME HERE>";
    const breadcrumb = buildTopicBreadcrumb(selectedTopicNode);
    const prompt = CONTENT_LINK_AI_PROMPT
        .replace("<PUT HIERARCHY PATH HERE>", breadcrumb)
        .replace("<PUT TOPIC NAME HERE>", topicTitle);

    const button = document.querySelector(
        "#add-content-link-modal button[onclick='copyContentLinkAiPrompt()']"
    );
    const originalLabel = button?.innerHTML || "📋 Copy AI Prompt";

    const done = () => {
        if (button) {
            button.innerHTML = "✓ Prompt Copied";
            button.disabled = true;
            setTimeout(() => {
                if (button && document.body.contains(button)) {
                    button.innerHTML = originalLabel;
                    button.disabled = false;
                }
            }, 1800);
        }

        alert("Prompt copied! Paste it into ChatGPT, Claude, Gemini, or any AI tool, then attach or paste the source PDF (or other material) in the same message.");
    };

    const manual = () => {
        // Last-resort manual fallback: open a selectable prompt instead of
        // silently failing on browsers that block clipboard access.
        const modal = document.createElement("textarea");
        modal.value = prompt;
        modal.style.cssText = [
            "position:fixed",
            "inset:8%",
            "width:84%",
            "height:70%",
            "z-index:99999",
            "padding:16px",
            "font-family:monospace",
            "font-size:13px",
            "background:#fff",
            "border:2px solid #2f5b52",
            "border-radius:10px"
        ].join(";");
        document.body.appendChild(modal);
        modal.focus();
        modal.select();
        alert("Automatic clipboard access was blocked. The full prompt is selected in the text box — press Ctrl+C (or Cmd+C) to copy it, then close the box.");
        modal.addEventListener("blur", () => setTimeout(() => modal.remove(), 300));
    };

    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(prompt)
            .then(done)
            .catch(() => fallbackCopyText(prompt, done, manual));
    } else {
        fallbackCopyText(prompt, done, manual);
    }
}

function fallbackCopyText(text, onSuccess, onFailure) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    ta.style.top = "0";
    ta.style.opacity = "0";
    document.body.appendChild(ta);

    ta.focus();
    ta.select();
    ta.setSelectionRange(0, ta.value.length);

    try {
        const copied = document.execCommand("copy");
        if (copied) onSuccess();
        else onFailure();
    } catch (error) {
        onFailure();
    } finally {
        ta.remove();
    }
}

async function submitContentLink() {
    const url = document.getElementById("content-link-url")?.value.trim();
    if (!url) { alert("Please paste the Google Drive folder link containing this topic's content package."); return; }
    if (!selectedTopicNode) return;

    const submitBtn = document.querySelector("#add-content-link-modal .resource-submit-btn");
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Saving..."; }

    try {
        await fetch(GOOGLE_SHEET_API, {
            method: "POST",
            mode: "no-cors",
            body: JSON.stringify({
                action: "save_core",
                node_id: selectedTopicNode.id,
                content_type: "md_file",
                title: selectedTopicNode.title,
                content: url,
                status: "published",
                author_id: "author",
                version: 1
            })
        });

        clearMarkdownCacheForNode(selectedTopicNode.id);

        selectedTopicNode.content = { ...(selectedTopicNode.content || {}), md_file: url };
        invalidateIndexCache();
        closeAddContentLink();
        renderContentLayer();

    } catch (error) {
        console.error("Content link save failed:", error);
        alert("Could not save this link. Please check your connection and try again.");
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Save Folder Link"; }
    }
}




/* =========================================================
   RESOURCE PANEL — simple, per-topic, writes directly to Sheets
   ========================================================= */

let currentResourceType = null;


function getHierarchyLabel(type) {
    // Legacy/type-string based lookup, kept for compatibility.
    // Prefer getNodeLevelLabel(node, depth) wherever a node reference
    // is available — it reflects true tree position and cannot drift
    // out of sync the way a stored `type` string can.
    return {
        subject: "Subject",
        course: "Course",
        exam: "Course",
        paper: "Course",
        unit: "Unit",
        chapter: "Chapter",
        module: "Chapter",
        topic: "Topic",
        subtopic: "Subtopic",
        child: "Subtopic"
    }[type] || "Subtopic";
}

function getAncestorChain(node) {
    const chain = [node];
    let current = node;
    while (current && current.parentId) {
        const parent = findNodeById(window.__studyData?.subjects || [], current.parentId);
        if (!parent) break;
        chain.unshift(parent);
        current = parent;
    }
    return chain;
}

function getResourcesForTopic(node) {
    const merged = [];
    getAncestorChain(node).forEach(ancestor => {
        const ancestorDepth = getNodeDepth(ancestor.id);
        (ancestor.resources || []).forEach(resource => {
            merged.push({
                ...resource,
                levelLabel: getNodeLevelLabel(ancestor, ancestorDepth ?? 0),
                ownerNodeId: ancestor.id
            });
        });
    });
    return merged;
}

function renderResources(node) {
    const container = document.getElementById("resources");
    if (!container || !node) return;

    const list = getResourcesForTopic(node);

    container.innerHTML = `
        <div class="resource-group">
            <div class="resource-group-summary">
                <span>References <span class="resource-count">${list.length}</span></span>
                <button class="add-resource-btn" type="button" onclick="openAddResource()">
                    + Add Reference
                </button>
            </div>
            <div id="resource-preview-area"></div>
            <div class="resource-group-content">
                ${list.length ? list.map(resource => {
                    const type = String(resource.type || "").toLowerCase();
                    const icon = type === "youtube" ? "▶️" : "🌐";
                    return `
                        <div class="resource-card">
                            <div class="resource-level-tag">${escapeHtml(resource.levelLabel || "")}</div>
                            <div class="resource-title">${icon} ${escapeHtml(resource.title || "Untitled resource")}</div>
                            ${resource.pageRef ? `<div class="resource-page-ref">📍 ${escapeHtml(resource.pageRef)}</div>` : ""}
                            ${resource.description ? `<div class="resource-description">${escapeHtml(resource.description)}</div>` : ""}
                            <div class="resource-actions">
                                ${resource.url ? `
                                    <button type="button" onclick="previewResource('${escapeHtml(resource.id)}')">Side View</button>
                                    <button type="button" onclick="openResource('${escapeHtml(resource.id)}')">Original ↗</button>
                                ` : `<span class="resource-missing">Resource link not available</span>`}
                                <button type="button" class="resource-delete-btn" onclick="deleteResource('${escapeHtml(resource.id)}')">Delete</button>
                            </div>
                        </div>`;
                }).join("") : `<p class="resource-empty">No references added yet.</p>`}
            </div>
        </div>
    `;
}

function findDisplayedResource(id) {
    return getResourcesForTopic(selectedTopicNode || {}).find(r => String(r.id) === String(id)) || null;
}


function openAddResource() {
    if (!selectedTopicNode) return;
    document.getElementById("add-resource-modal")?.remove();

    const modal = document.createElement("div");
    modal.id = "add-resource-modal";
    modal.innerHTML = `
        <div class="add-resource-overlay">
            <div class="add-resource-modal">
                <button type="button" class="modal-close" onclick="closeAddResource()">×</button>
                <h2>➕ Add Reference</h2>
                <p class="add-resource-scope">Adding to: <strong>${escapeHtml(selectedTopicNode.title)}</strong></p>
                <div class="resource-type-options">
                    <button type="button" onclick="selectResourceType('youtube')">▶️ YouTube</button>
                    <button type="button" onclick="selectResourceType('web')">🌐 Google Drive / Web Link</button>
                </div>
                <div id="resource-form-area"><p>Choose what you want to add.</p></div>
            </div>
        </div>`;
    document.body.appendChild(modal);
}

function closeAddResource(){ document.getElementById("add-resource-modal")?.remove(); }

function selectResourceType(type){
    currentResourceType=type;
    const area=document.getElementById("resource-form-area");
    if(!area)return;

    const common = `
        <label>Title</label>
        <input id="resource-title" type="text" placeholder="e.g. Information Society — Reference PDF">

        <label>Resource URL</label>
        <input id="resource-url" type="url"
               placeholder="${type==="youtube"
                   ? "https://www.youtube.com/watch?v=..."
                   : "https://drive.google.com/..."}">

        <label>Page / Location for this topic</label>
        <input id="resource-page" type="text"
               placeholder="${type==="youtube"
                   ? "Optional: 04:15–08:30"
                   : "e.g. 23 or 23–27"}">

        <label>Why is this resource useful? <span class="field-optional">(optional)</span></label>
        <textarea id="resource-description"
                  placeholder="Short note about what this resource covers..."></textarea>

        <button class="resource-submit-btn" type="button" onclick="submitResource()">Add Reference</button>
    `;

    if(type==="youtube"){
        area.innerHTML=`<h3>▶️ Add YouTube Resource</h3>${common}`;
    }else{
        area.innerHTML=`<h3>🌐 Add Google Drive / Web Resource</h3>${common}`;
    }
}

async function submitResource(){
    const title=document.getElementById("resource-title")?.value.trim();
    const url=document.getElementById("resource-url")?.value.trim();
    const pageRef=document.getElementById("resource-page")?.value.trim();
    const description=document.getElementById("resource-description")?.value.trim();

    if(!title){alert("Please enter a title.");return;}
    if(!url){alert("Please enter the resource URL.");return;}
    if(!selectedTopicNode)return;

    const resourceId =
        "res_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7);

    const submitBtn = document.querySelector(".resource-submit-btn");
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Adding..."; }

    try {
        await fetch(GOOGLE_SHEET_API, {
            method: "POST",
            mode: "no-cors",
            body: JSON.stringify({
                action: "save_resource",
                resource_id: resourceId,
                node_id: selectedTopicNode.id,
                resource_type: currentResourceType === "youtube" ? "YouTube" : "Web",
                title,
                url,
                location_ref: pageRef,
                description,
                status: "published",
                author_id: "community"
            })
        });

        // Optimistic local display; the row is now saved in Sheets for everyone else too.
        selectedTopicNode.resources = selectedTopicNode.resources || [];
        selectedTopicNode.resources.push({
            id: resourceId,
            title,
            type: currentResourceType,
            url,
            pageRef,
            description
        });

        closeAddResource();
        renderResources(selectedTopicNode);

    } catch (error) {
        console.error("Resource save failed:", error);
        alert("Could not save this resource. Please check your connection and try again.");
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Add Reference"; }
    }
}

async function deleteResource(resourceId) {
    if (!selectedTopicNode) return;
    if (!confirm("Delete this resource? This cannot be undone.")) return;

    const owner = getAncestorChain(selectedTopicNode)
        .find(ancestor => (ancestor.resources || []).some(r => String(r.id) === String(resourceId)));

    try {
        await fetch(GOOGLE_SHEET_API, {
            method: "POST",
            mode: "no-cors",
            body: JSON.stringify({
                action: "delete_resource",
                resource_id: resourceId,
                node_id: owner ? owner.id : selectedTopicNode.id
            })
        });

        if (owner) {
            owner.resources = (owner.resources || []).filter(r => String(r.id) !== String(resourceId));
        }

        renderResources(selectedTopicNode);

    } catch (error) {
        console.error("Delete resource failed:", error);
        alert("Could not delete this resource. Please try again.");
    }
}

async function previewResource(resourceId) {
    const resource = findDisplayedResource(resourceId);
    if (!resource) return;

    const area = document.getElementById("resource-preview-area");
    if (!area) return;

    area.innerHTML = `
        <div class="resource-preview-inline">
            <div class="preview-header">
                <strong>${escapeHtml(resource.title || "Resource")}</strong>
                <button type="button" onclick="closeResourcePreview()">✕ Close</button>
            </div>
            <div class="resource-preview-body">
                <div class="resource-preview-loading">Loading resource...</div>
            </div>
        </div>
    `;

    // Bring the inline preview comfortably into view within the right panel.
    requestAnimationFrame(() => {
        area.scrollIntoView({ behavior: "smooth", block: "center" });
    });

    const body = area.querySelector(".resource-preview-body");

    if (!resource.url) {
        body.innerHTML = `<p class="resource-preview-loading">Resource link is not available.</p>`;
        return;
    }

    let url = resource.url;
    const isYoutube = String(resource.type).toLowerCase() === "youtube";

    if (isYoutube) {
        url = convertYouTubeUrl(url);
    } else if (url.includes("drive.google.com")) {
        url = convertDriveUrlForEmbed(url);
    }

    const iframe = document.createElement("iframe");
    iframe.className = isYoutube ? "resource-frame youtube-frame" : "resource-frame";
    iframe.src = url;
    iframe.title = resource.title || "Resource preview";
    iframe.loading = "lazy";
    iframe.allowFullscreen = true;

    body.innerHTML = "";
    body.appendChild(iframe);

    // Re-center once the frame has taken its final size.
    requestAnimationFrame(() => {
        area.scrollIntoView({ behavior: "smooth", block: "center" });
    });
}

function closeResourcePreview(){
    const area = document.getElementById("resource-preview-area");
    if (area) area.innerHTML = "";
}

async function openResource(resourceId){
    const resource=findDisplayedResource(resourceId);
    if(!resource)return;
    if((resource.type==="pdf"||resource.type==="image")&&resource.fileId){
        try{const file=await getLocalFile(resource.fileId);if(file)window.open(URL.createObjectURL(file),"_blank");else alert("Local resource file could not be found.");}catch(e){console.error(e);alert("Could not open this resource.");}
        return;
    }
    if(resource.url)window.open(resource.url,"_blank","noopener,noreferrer");
}

function convertYouTubeUrl(url){
    if(!url)return "";
    if(url.includes("youtube.com/watch?v="))return "https://www.youtube.com/embed/"+url.split("v=")[1].split("&")[0];
    if(url.includes("youtu.be/"))return "https://www.youtube.com/embed/"+url.split("youtu.be/")[1].split("?")[0];
    return url;
}

function convertDriveUrlForEmbed(url) {
    if (!url) return url;
    // Handles /file/d/FILE_ID/... and open?id=FILE_ID / uc?id=FILE_ID formats.
    const idMatch =
        url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) ||
        url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (idMatch) {
        return `https://drive.google.com/file/d/${idMatch[1]}/preview`;
    }
    return url;
}

function openResourceFileDB(){
    return new Promise((resolve,reject)=>{
        const req=indexedDB.open("study-notebook-alpha-files",1);
        req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains("files"))req.result.createObjectStore("files");};
        req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
    });
}
function saveLocalFile(id,file){
    return openResourceFileDB().then(db=>new Promise((resolve,reject)=>{const tx=db.transaction("files","readwrite");tx.objectStore("files").put(file,id);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);}));
}
function getLocalFile(id){
    return openResourceFileDB().then(db=>new Promise((resolve,reject)=>{const tx=db.transaction("files","readonly");const req=tx.objectStore("files").get(id);req.onsuccess=()=>resolve(req.result||null);req.onerror=()=>reject(req.error);}));
}
function deleteLocalFile(id){
    return openResourceFileDB().then(db=>new Promise((resolve,reject)=>{const tx=db.transaction("files","readwrite");tx.objectStore("files").delete(id);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);}));
}


function findParentNode(nodes, childId) {
    for (const node of nodes || []) {
        if ((node.children || []).some(child => child.id === childId)) {
            return node;
        }
        const found = findParentNode(node.children || [], childId);
        if (found) return found;
    }
    return null;
}

function deleteStructureNode(node) {
    const isSubject = node.type === "subject";
    const message = isSubject
        ? `Delete subject "${node.title}" and everything inside it?`
        : `Delete "${node.title}" and everything under it?`;

    if (!confirm(message)) return;

    if (isSubject) {
        window.__studyData.subjects =
            (window.__studyData.subjects || []).filter(x => x.id !== node.id);
    } else {
        const parent = findParentNode(window.__studyData.subjects || [], node.id);
        if (parent) {
            parent.children = (parent.children || [])
                .filter(x => x.id !== node.id);
        }
    }

    selectedStructureNode = null;
    persistAlphaContent();
    renderSubjectStrip();
    renderStudyTree(window.__studyData);

    (async () => {
        try {
            await fetch(GOOGLE_SHEET_API, {
                method: "POST",
                mode: "no-cors",
                body: JSON.stringify({
                    action: "delete_structure",
                    node_id: node.id
                })
            });
        } catch (error) {
            console.error("Structure delete failed:", error);
        }
    })();

    const firstSubject = window.__studyData.subjects?.[0];
    if (firstSubject) {
        selectedStructureNode = firstSubject;
        activeSubjectId = firstSubject.id;
        refreshStructureSelection(firstSubject);
    }
}

function createTreeNode(node, depth = 0) {
    const wrapper = document.createElement("div");
    wrapper.className = "tree-node";

    const row = document.createElement("div");
    row.className = "tree-row";

    const hasChildren = Array.isArray(node.children) && node.children.length > 0;

    const toggle = document.createElement("button");
    toggle.className = "tree-toggle";
    toggle.type = "button";
    // Every node starts COLLAPSED. Children are only revealed one level
    // at a time (see below) so opening a Subject never cascades all the
    // way down to Subtopics — that's what was making the index so long.
    toggle.textContent = hasChildren ? "▸" : "·";

    const label = document.createElement("button");
    label.className = "tree-label";
    label.type = "button";
    label.dataset.nodeId = node.id;
    const levelLabel = getNodeLevelLabel(node, depth);

    // Titles get ellipsis-truncated in the narrow index panel, so a
    // native tooltip on hover shows the full, untruncated name.
    label.title = `${levelLabel}: ${node.title}`;

    label.innerHTML =
        `<span class="tree-level-label">${escapeHtml(levelLabel)}</span>` +
        `<span class="tree-node-title">${escapeHtml(node.title)}</span>`;

    const add = document.createElement("button");
    add.className = "tree-node-add";
    add.type = "button";
    add.textContent = "+";
    add.title = "Add " + getNodeLevelLabel(node, depth + 1);

    add.addEventListener("click", (event) => {
        event.stopPropagation();
        selectedStructureNode = node;
        openStructureDialog(node.type);
    });

    const del = document.createElement("button");
    del.className = "tree-node-delete";
    del.type = "button";
    del.textContent = "×";
    del.title = "Delete this node";

    del.addEventListener("click", (event) => {
        event.stopPropagation();
        deleteStructureNode(node);
    });

    row.append(toggle, label, add, del);
    wrapper.appendChild(row);

    if (hasChildren) {
        const children = document.createElement("div");
        children.className = "tree-children";
        // Grandchildren (and deeper) are built recursively so they exist
        // in the DOM, but every nested "tree-children" container starts
        // hidden (see createTreeNode's own children.hidden = true below).
        // That's what keeps expanding a Subject from also expanding its
        // Courses' Units, Chapters, Topics, etc. all at once.
        node.children.forEach(child =>
            children.appendChild(createTreeNode(child, depth + 1))
        );
        children.hidden = true;
        wrapper.appendChild(children);

        const openChildren = () => {
            children.hidden = false;
            toggle.textContent = "▾";
        };
        const closeChildren = () => {
            children.hidden = true;
            toggle.textContent = "▸";
        };

        toggle.addEventListener("click", (event) => {
            event.stopPropagation();
            if (children.hidden) openChildren(); else closeChildren();
        });

        // Clicking the row's label (selecting it) also reveals just its
        // immediate children — mirrors clicking the toggle arrow, but
        // never auto-collapses on re-click since selection is idempotent.
        label.addEventListener("click", () => {
            if (children.hidden) openChildren();
        });
    } else {
        toggle.addEventListener("click", (event) => event.stopPropagation());
    }

    label.addEventListener("click", () => {
        document.querySelectorAll(".tree-label.active")
            .forEach(item => item.classList.remove("active"));
        label.classList.add("active");
        refreshStructureSelection(node);
        renderTopic(node);
        renderResources(node);
        renderMcqs(node);
        label.scrollIntoView({ block: "nearest" });
    });

    return wrapper;
}

function getNodeLevelLabel(node, depth) {
    // Classification is based on the node's position in the tree.
    // This repairs legacy/local data whose stored `type` may be incorrect.
    // Hierarchy: Subject → Course → Unit → Chapter → Topic → Subtopic → Subtopic → …
    if (depth === 0) return "Subject";
    if (depth === 1) return "Course";
    if (depth === 2) return "Unit";
    if (depth === 3) return "Chapter";
    if (depth === 4) return "Topic";
    return "Subtopic";
}

function renderStudyTree(data) {
    renderSubjectStrip();
    studyTreeElement.innerHTML = "";

    const subjects = data.subjects || [];

    if (!subjects.some(s => s.id === activeSubjectId)) {
        // Selected subject got deleted (or nothing was selected yet) —
        // drop back to showing every subject rather than filtering to
        // a subject that no longer exists.
        activeSubjectId = null;
        subjectFilterActive = false;
    }

    // Default view: list every Subject in the INDEX (each collapsed —
    // see createTreeNode). Only once a chip in the top ribbon is clicked
    // do we narrow down to that one Subject's branch.
    const visibleSubjects = subjectFilterActive
        ? subjects.filter(subject => subject.id === activeSubjectId)
        : subjects;

    visibleSubjects.forEach(subject => {
        studyTreeElement.appendChild(createTreeNode(subject, 0));
    });
}

function renderMcqs(node) { /* MCQ practice is handled by mcq.html. */ }

/* =========================================================
   ALPHA-PLUS — RIGHT PANEL: REFERENCES | MCQ | INDEX TABS
   MCQ practice opens INSIDE the right panel (embedded via the
   existing dedicated mcq.html page in an iframe, so none of its
   logic is duplicated) with its own "Open in new tab" action.
   The Index tab keeps its existing in-panel behaviour and also
   gets an "Open in new tab" action, which reopens this same
   notebook page with the Index tab pre-selected (Index has no
   separate page of its own — it's just an alternate way into
   the SAME tree/content the Table of Contents already renders).
   ========================================================= */

function getMcqUrl() {
    const topicId = selectedTopicId ||
        findFirstTopic(window.__studyData?.subjects)?.id;

    return topicId
        ? `mcq.html?topic=${encodeURIComponent(topicId)}`
        : "mcq.html";
}

let mcqFrameLoadedFor = null;

function loadMcqFrame() {
    const frame = document.getElementById("mcq-panel-frame");
    if (!frame) return;

    const url = getMcqUrl();
    // Refresh the embedded MCQ only when the relevant topic actually
    // changed since it was last loaded — switching tabs back and forth
    // shouldn't reset an attempt already in progress.
    if (mcqFrameLoadedFor === url) return;

    frame.src = url;
    mcqFrameLoadedFor = url;
}

function initRightPanelTabs() {
    const tabs = document.querySelectorAll(".right-panel-tab");
    if (!tabs.length) return;

    tabs.forEach(btn => {
        btn.addEventListener("click", () => selectRightPanelTab(btn.dataset.rightTab));
    });
}

function selectRightPanelTab(tab) {
    const tabs = document.querySelectorAll(".right-panel-tab");
    tabs.forEach(b => b.classList.toggle("active", b.dataset.rightTab === tab));

    document.getElementById("right-tab-references").hidden = tab !== "references";
    document.getElementById("right-tab-mcq").hidden = tab !== "mcq";
    document.getElementById("right-tab-index").hidden = tab !== "index";

    if (tab === "mcq") {
        loadMcqFrame();
    }

    if (tab === "index") {
        const query = document.getElementById("index-search-input")?.value.trim().toLowerCase() || "";
        if (indexTabScope === "global") {
            renderIndexAZList(query);
        } else {
            renderScopedIndexList(query);
        }
    }
}

document.getElementById("mcq-open-newtab")?.addEventListener("click", () => {
    window.open(getMcqUrl(), "_blank", "noopener");
});

document.getElementById("index-open-newtab")?.addEventListener("click", () => {
    window.open("index-directory.html", "_blank", "noopener");
});

/* =========================================================
   ALPHA-PLUS — INDEX
   The Index is NOT a separate content store. Every entry simply
   points back at an existing node id from the SAME tree the Table
   of Contents already renders. Clicking an entry reuses the exact
   selection path a Table of Contents click uses (selectNodeById),
   so there is only ever one place topic content actually lives.

   Entries come from two places, both already part of the existing
   data model:
     1. Every node's own title (Subject/Course/Unit/Chapter/Topic/
        Subtopic) — zero extra authoring effort.
     2. An optional "Also known as" alias list, stored using the
        SAME generic content_type mechanism as definition/
        explanation/example (content_type = "index_terms"), so it
        needs no new Google Sheets columns and no Apps Script changes.
   Several different terms (RFID / Radio Frequency Identification /
   RFID tag) can therefore resolve to the very same node id without
   duplicating any content.

   Term-building/dedup itself lives in js/index-data.js (shared with
   js/index-directory.js) — getIndexRegistry() / filterIndexRegistry()
   there return the SAME { indexId, term, normalizedTerm, matches }
   shape the old local groupIndexEntries()/getIndexEntries() returned,
   so nothing below needed restructuring. invalidateIndexCache() is
   kept as the name every existing call site already uses.
   ========================================================= */

// ALPHA-PLUS — INDEX TERMS: unlike the local cache-clear this name
// originally only did, this NOW also re-fetches index_terms/index_links
// fresh from the server (via the lightweight get_index_registry action)
// before rebuilding the registry — otherwise "Full A-Z Glossary" would
// never see a term synced during THIS session (window.__studyData was
// only ever populated once, at app start). "This Topic" is unaffected
// either way since it already does its own always-live fetch.
async function invalidateIndexCache() {
    try {
        const url = `${GOOGLE_SHEET_API}?action=get_index_registry`;
        const response = await fetch(url);
        const data = await response.json();
        if (data && data.success) {
            window.__studyData = window.__studyData || {};
            window.__studyData.indexTerms = data.index_terms || [];
            window.__studyData.indexLinks = data.index_links || [];
        }
    } catch (error) {
        console.error("Refreshing index registry failed:", error);
    }
    invalidateIndexRegistry();
    // Full A-Z Glossary is only actually visible while that sub-tab is
    // active — re-render it now so an open glossary updates live too,
    // not just on the next manual tab switch.
    if (typeof indexTabScope !== "undefined" && indexTabScope === "global") {
        renderIndexAZList(document.getElementById("index-search-input")?.value.trim().toLowerCase() || "");
    }
}

function renderIndexAZList(filterText = "") {
    const container = document.getElementById("index-az-list");
    if (!container) return;

    const groups = filterIndexRegistry(filterText);

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
        selectNodeById(group.matches[0].nodeId);
    } else {
        showIndexPicker(group);
    }
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
                    const path = findPathToNode(window.__studyData?.subjects || [], m.nodeId);
                    const breadcrumb = path && path.length
                        ? path.map(n => n.title).filter(Boolean).join(" → ")
                        : null;
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
        btn.addEventListener("click", () => {
            const nodeId = btn.dataset.nodeId;
            backdrop.remove();
            selectNodeById(nodeId);
        });
    });
}

// Finds the full root-to-node path by walking the actual nested
// children arrays (works regardless of whether parentId is present,
// so it's reliable for both the Sheets-driven data and the local
// JSON fallback).
function findPathToNode(nodes, targetId, path = []) {
    for (const node of nodes || []) {
        const nextPath = [...path, node];
        if (node.id === targetId) return nextPath;

        const found = findPathToNode(node.children, targetId, nextPath);
        if (found) return found;
    }
    return null;
}

// The single mechanism ANY entry point (Table of Contents click, Index
// click, or a future MCQ "related topic" link) should use to select a
// topic. It reuses the exact same rendering path as a direct tree click.
function selectNodeById(nodeId) {
    const path = findPathToNode(window.__studyData?.subjects || [], nodeId);
    if (!path) {
        console.warn("Index: could not locate node", nodeId);
        return false;
    }

    const rootSubject = path[0];

    // Make sure the owning Subject's branch is actually present in the
    // Table of Contents DOM (it may currently be filtered out by the
    // subject ribbon), then rebuild so ancestors start collapsed and we
    // expand exactly the ones we need below.
    activeSubjectId = rootSubject.id;
    subjectFilterActive = true;
    renderStudyTree(window.__studyData);

    const label = document.querySelector(
        `.tree-label[data-node-id="${cssEscapeId(nodeId)}"]`
    );
    if (!label) return false;

    // Expand every ancestor .tree-children container up to the root so
    // the target label is actually visible before we click it.
    let current = label.closest(".tree-node");
    while (current) {
        const childrenContainer = current.parentElement;
        if (childrenContainer && childrenContainer.classList.contains("tree-children")) {
            childrenContainer.hidden = false;
            const parentWrapper = childrenContainer.closest(".tree-node");
            const toggle = parentWrapper?.querySelector(":scope > .tree-row > .tree-toggle");
            if (toggle) toggle.textContent = "▾";
            current = parentWrapper;
        } else {
            current = null;
        }
    }

    label.scrollIntoView({ block: "center" });
    label.click();
    return true;
}

function cssEscapeId(id) {
    return (window.CSS && CSS.escape) ? CSS.escape(id) : String(id).replace(/["\\]/g, "\\$&");
}

/* =========================================================
   ALPHA-PLUS — INDEX TERMS: subtopic-scoped Index tab
   Adds a SECOND view to the Index tab, alongside the existing
   global A-Z glossary above: "This Topic", listing only the terms
   linked to whichever subtopic is currently open (auto {{}} terms
   picked up by richcontent.js's extraction pass, PLUS anything
   marked manually via right-click below). Both views read/write the
   SAME Index_Terms/Index_Node registry — there is only ever one
   source of truth; this is just a filtered lens onto it.
   ========================================================= */

let indexTabScope = "topic"; // "topic" | "global"
let currentScopedIndexTerms = []; // [{ index_id, term, id, source_type }]
// nodeId -> signature of the {{}} term set last successfully sent to
// sync_index_terms_bulk THIS session — skips re-sending an unchanged
// set (e.g. just toggling EN/HI/depth re-renders the same {{}} terms
// every time; no need to hit the network again for identical data).
const syncedTermSignatureByNode = new Map();

function initIndexScopeToggle() {
    document.querySelectorAll(".index-scope-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            indexTabScope = btn.dataset.indexScope;
            document.querySelectorAll(".index-scope-btn").forEach(b => b.classList.toggle("active", b === btn));

            document.getElementById("index-scoped-list").hidden = indexTabScope !== "topic";
            document.getElementById("index-az-list").hidden = indexTabScope !== "global";
            const suggestions = document.getElementById("index-suggestions");
            if (suggestions) suggestions.hidden = true;

            const query = document.getElementById("index-search-input")?.value.trim().toLowerCase() || "";
            if (indexTabScope === "global") {
                renderIndexAZList(query);
            } else {
                renderScopedIndexList(query);
            }
        });
    });
}

// Called right after every content render (renderCurrentLanguageBlock).
// The current render's {{}} extraction is the ONLY source of truth for
// which auto terms exist in this node's content RIGHT NOW — so this
// also RECONCILES the registry: any previously-synced "content" term
// that this render no longer contains (removed from the .md, or the
// .md itself was swapped out/regenerated) gets unlinked, so it stops
// showing up as a dead, unclickable entry in the Index tab. Manual
// (right-click) terms are never touched by this reconciliation — only
// "content"-sourced links are ever added or removed automatically.
async function syncAndRenderScopedIndex() {
    const node = selectedTopicNode;
    if (!node) {
        currentScopedIndexTerms = [];
        renderScopedIndexList();
        return;
    }

    const nodeId = node.id;
    const autoTerms = window.lastRenderedIndexTerms || [];
    const autoNormalized = new Set(autoTerms.map(t => t.term.trim().toLowerCase()));

    const existing = await fetchIndexTermsForNode(nodeId);

    const stale = existing.filter(t =>
        t.source_type === "content" && !autoNormalized.has(String(t.term).trim().toLowerCase())
    );

    // Build the displayed list from what we just computed rather than
    // re-fetching immediately — the bulk write below is fire-and-forget
    // ("no-cors"), so a GET right after it could race and momentarily
    // show pre-write data. Also collapse any duplicate term TEXT here
    // (defensive display-level dedupe) — a couple of older entries may
    // still have two Index_Terms rows for the same normalized term
    // from before the bulk endpoint below existed to prevent that race.
    const staleIds = new Set(stale.map(t => t.index_id));
    const keptExisting = existing.filter(t => !staleIds.has(t.index_id));
    const existingNormalized = new Set(keptExisting.map(t => String(t.term).trim().toLowerCase()));
    const newlyAdded = autoTerms
        .filter(t => !existingNormalized.has(t.term.trim().toLowerCase()))
        .map(t => ({ term: t.term, id: t.id, source_type: "content" }));

    const combined = [...keptExisting, ...newlyAdded];
    const seenNormalized = new Set();
    currentScopedIndexTerms = combined.filter(t => {
        const key = String(t.term).trim().toLowerCase();
        if (seenNormalized.has(key)) return false;
        seenNormalized.add(key);
        return true;
    });
    renderScopedIndexList(document.getElementById("index-search-input")?.value.trim().toLowerCase() || "");

    // Only actually hit the network if this exact {{}} term set for this
    // node hasn't already been synced this session, and there's
    // something to send.
    const signature = [...autoNormalized].sort().join("|");
    const alreadySyncedThisSession = syncedTermSignatureByNode.get(nodeId) === signature;

    if (!alreadySyncedThisSession && (stale.length || newlyAdded.length)) {
        syncedTermSignatureByNode.set(nodeId, signature);
        syncIndexTermsBulkToRegistry(
            nodeId,
            newlyAdded.map(t => ({ term: t.term, source_type: "content" })),
            stale.map(t => t.term)
        );
    }
}

// Fire-and-forget bulk write — one HTTP round trip for a whole topic's
// {{}} term set (create/link new ones + unlink stale ones together),
// instead of one request per term. See sync_index_terms_bulk in
// Code.gs for why this replaced the old per-term loop.
//
// Reliability: the write itself is still "no-cors" fire-and-forget (the
// response can never be read) — that architecture is unchanged. What's
// added is a check AFTER the fact: wait briefly, re-fetch this node's
// terms fresh from the server, and compare against what was just
// requested. Silent on success. One mismatch is retried once (it may
// just have been a slow write); still mismatched after that gets a
// small non-blocking warning — see showIndexSyncWarning(). Nothing here
// ever shows a blocking alert for normal operation.
async function syncIndexTermsBulkToRegistry(nodeId, terms, unlinkTerms, attempt = 1) {
    if (!terms.length && !unlinkTerms.length) return;

    try {
        await fetch(GOOGLE_SHEET_API, {
            method: "POST",
            mode: "no-cors",
            body: JSON.stringify({ action: "sync_index_terms_bulk", node_id: nodeId, terms, unlink: unlinkTerms })
        });
        invalidateIndexCache();
        verifyIndexSyncForNode(nodeId, terms.map(t => t.term), unlinkTerms, attempt);
    } catch (error) {
        console.error("Bulk index term sync failed:", error);
    }
}

// Confirms a just-fired bulk write actually landed. There's no other
// signal for this (the write is fire-and-forget), so: wait briefly,
// re-fetch this node's terms, diff against what was just requested.
async function verifyIndexSyncForNode(nodeId, expectedAdded, expectedRemoved, attempt) {
    await new Promise(resolve => setTimeout(resolve, 1200));

    // The user may have already moved to a different topic by the time
    // this fires — checking/retrying against the node they left would
    // be pointless, and a retry could even re-add a term to the wrong
    // context if they'd meanwhile unmarked it there.
    if (!selectedTopicNode || selectedTopicNode.id !== nodeId) return;

    const current = await fetchIndexTermsForNode(nodeId);
    const currentNormalized = new Set(current.map(t => String(t.term).trim().toLowerCase()));

    const stillMissing = expectedAdded.filter(t => !currentNormalized.has(String(t).trim().toLowerCase()));
    const stillLinked = expectedRemoved.filter(t => currentNormalized.has(String(t).trim().toLowerCase()));

    if (!stillMissing.length && !stillLinked.length) return; // landed — done, silently

    if (attempt === 1) {
        syncIndexTermsBulkToRegistry(
            nodeId,
            stillMissing.map(t => ({ term: t, source_type: "content" })),
            stillLinked,
            2
        );
        return;
    }

    showIndexSyncWarning();
}

// One small, self-dismissing, non-blocking corner note — shown only
// when a bulk index-term write still hasn't landed after a retry.
// Never requires dismissal and never interrupts what the user's doing.
let indexSyncWarningEl = null;
function showIndexSyncWarning() {
    if (indexSyncWarningEl) return; // one at a time — don't stack

    const el = document.createElement("div");
    el.className = "index-sync-warning";
    el.textContent = "Some index terms for this topic may not have saved. They'll sync next time you open it.";
    document.body.appendChild(el);
    indexSyncWarningEl = el;

    setTimeout(() => {
        el.remove();
        indexSyncWarningEl = null;
    }, 5000);
}

// Pure fetch, no side effects on currentScopedIndexTerms/the UI — used
// by syncAndRenderScopedIndex() above to read the PRE-reconciliation
// state for whichever node id is passed in (never the stale, possibly
// different-topic, currentScopedIndexTerms left over from before).
async function fetchIndexTermsForNode(nodeId) {
    try {
        const url = `${GOOGLE_SHEET_API}?action=get_index_terms_for_node&node_id=${encodeURIComponent(nodeId)}`;
        const response = await fetch(url);
        const data = await response.json();
        return (data && data.success && Array.isArray(data.data)) ? data.data : [];
    } catch (error) {
        console.error("Fetching scoped index terms failed:", error);
        return [];
    }
}

// Fire-and-forget, same "no-cors" pattern every other write in this file
// uses — the response is never read (Apps Script webapp POST responses
// aren't reliably readable cross-origin), so the backend's sync_index_term
// action does the find-or-create AND the link in one call server-side.
async function unlinkIndexTermFromRegistry(term, nodeId) {
    try {
        await fetch(GOOGLE_SHEET_API, {
            method: "POST",
            mode: "no-cors",
            body: JSON.stringify({ action: "unlink_index_term", term, node_id: nodeId })
        });
        invalidateIndexCache();
    } catch (error) {
        console.error("Index term unlink failed:", term, error);
    }
}

function renderScopedIndexList(filterText = "") {
    const container = document.getElementById("index-scoped-list");
    if (!container) return;

    let terms = currentScopedIndexTerms;
    if (filterText) {
        terms = terms.filter(t => t.term.toLowerCase().includes(filterText));
    }

    if (!selectedTopicNode) {
        container.innerHTML = `<p class="index-empty-note">Open a topic to see its index terms.</p>`;
        return;
    }

    if (!terms.length) {
        container.innerHTML = `<p class="index-empty-note">${
            filterText ? "No index entries match your search." : "No index terms marked in this topic yet."
        }</p>`;
        return;
    }

    container.innerHTML = "";
    terms
        .slice()
        .sort((a, b) => a.term.localeCompare(b.term, undefined, { sensitivity: "base" }))
        .forEach(t => {
            const row = document.createElement("div");
            row.className = "index-term-row";
            row.innerHTML = `
                <span class="index-term-name">${escapeHtml(t.term)}</span>
                ${t.source_type === "manual" ? `<span class="index-term-alias-of">manual</span>` : ""}
            `;
            row.addEventListener("click", () => scrollToScopedIndexTerm(t));
            container.appendChild(row);
        });
}

// Clicking a "This Topic" entry scrolls WITHIN the already-open content
// (unlike the global glossary's rows, which navigate to a different
// node entirely) — matches Part 2 of the original spec.
function scrollToScopedIndexTerm(termEntry) {
    const el = termEntry.id ? document.getElementById(cssEscapeId(termEntry.id)) : null;

    if (!el) {
        // Best-effort text match fallback for manually-marked terms whose
        // span isn't present in the CURRENT render (different depth/
        // language block than when it was marked) — still listed above,
        // just nothing to scroll to yet.
        return;
    }

    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("rc-index-term-flash");
    setTimeout(() => el.classList.remove("rc-index-term-flash"), 1600);
}

/* =========================================================
   ALPHA-PLUS — INDEX TERMS: manual right-click marking
   Custom context menu on the content panel — no browser default.
   Selecting text -> "Mark as index term" wraps it in the same
   .rc-index-term span the {{}} auto-detection produces (source_type
   "manual" server-side) so both kinds of terms behave identically
   everywhere else (Index tab list, click-to-scroll, styling).
   ========================================================= */

let indexContextMenuEl = null;

function initIndexTermContextMenu() {
    const panel = document.getElementById("middle-panel");
    if (!panel) return;

    panel.addEventListener("contextmenu", (event) => {
        const contentEl = document.getElementById("rc-explanation");
        if (!contentEl || !contentEl.contains(event.target)) return;

        const selection = window.getSelection();
        const selectedText = selection ? selection.toString().trim() : "";
        if (!selectedText) return;

        event.preventDefault();

        const range = selection.rangeCount ? selection.getRangeAt(0) : null;
        const existingSpan = range ? findEnclosingIndexTermSpan(range, contentEl) : null;

        showIndexContextMenu(event.pageX, event.pageY, {
            mode: existingSpan ? "unmark" : "mark",
            selectedText,
            range,
            existingSpan
        });
    });

    document.addEventListener("click", closeIndexContextMenu);
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") closeIndexContextMenu();
    });
}

// A selection only qualifies for "unmark" if BOTH its start and end sit
// inside the same single .rc-index-term span (a partial/crossing
// selection is treated as a fresh "mark" instead, matching Part 3).
function findEnclosingIndexTermSpan(range, contentEl) {
    const startSpan = range.startContainer.nodeType === 3
        ? range.startContainer.parentElement?.closest(".rc-index-term")
        : range.startContainer.closest?.(".rc-index-term");
    const endSpan = range.endContainer.nodeType === 3
        ? range.endContainer.parentElement?.closest(".rc-index-term")
        : range.endContainer.closest?.(".rc-index-term");

    if (startSpan && startSpan === endSpan && contentEl.contains(startSpan)) {
        return startSpan;
    }
    return null;
}

function closeIndexContextMenu() {
    if (indexContextMenuEl) {
        indexContextMenuEl.remove();
        indexContextMenuEl = null;
    }
}

function showIndexContextMenu(x, y, ctx) {
    closeIndexContextMenu();

    const menu = document.createElement("div");
    menu.className = "index-context-menu";
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;

    const option = document.createElement("button");
    option.type = "button";
    option.className = "index-context-menu-item";
    option.textContent = ctx.mode === "unmark" ? "Unmark as index term" : "Mark as index term";
    option.addEventListener("click", (event) => {
        event.stopPropagation();
        closeIndexContextMenu();
        if (ctx.mode === "unmark") {
            unmarkIndexTermSpan(ctx.existingSpan);
        } else {
            markSelectionAsIndexTerm(ctx.selectedText, ctx.range);
        }
    });

    menu.appendChild(option);
    document.body.appendChild(menu);
    indexContextMenuEl = menu;

    // Keep the menu on-screen if it was opened near the right/bottom edge.
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = `${x - rect.width}px`;
    if (rect.bottom > window.innerHeight) menu.style.top = `${y - rect.height}px`;
}

function markSelectionAsIndexTerm(term, range) {
    if (!selectedTopicNode || !range) return;

    const existingIds = new Set(
        [...document.querySelectorAll("#rc-explanation [id]")].map(el => el.id)
    );
    let id = window.slugifyIndexTerm ? window.slugifyIndexTerm(term) : `term-${Date.now()}`;
    let suffix = 2;
    while (existingIds.has(id)) {
        id = `${window.slugifyIndexTerm(term)}-${suffix++}`;
    }

    const span = document.createElement("span");
    span.className = "rc-index-term manual";
    span.dataset.term = term;
    span.id = id;

    try {
        range.surroundContents(span);
    } catch (error) {
        // Selection crosses element boundaries (spans two <p> tags, etc.)
        // — surroundContents() can't wrap a non-contiguous range safely,
        // so fall back to just extracting+re-inserting the plain text.
        span.textContent = range.toString();
        range.deleteContents();
        range.insertNode(span);
    }

    window.getSelection()?.removeAllRanges();

    // Optimistic UI: show it in the Index tab immediately, sync in the
    // background, and roll back the DOM + list if the save fails.
    const nodeId = selectedTopicNode.id;
    currentScopedIndexTerms = [...currentScopedIndexTerms, { term, id, source_type: "manual" }];
    renderScopedIndexList(document.getElementById("index-search-input")?.value.trim().toLowerCase() || "");

    fetch(GOOGLE_SHEET_API, {
        method: "POST",
        mode: "no-cors",
        body: JSON.stringify({ action: "sync_index_term", term, node_id: nodeId, source_type: "manual" })
    })
        .then(() => invalidateIndexCache())
        .catch((error) => {
            console.error("Marking index term failed, rolling back:", term, error);
            span.replaceWith(document.createTextNode(span.textContent));
            currentScopedIndexTerms = currentScopedIndexTerms.filter(t => t.id !== id);
            renderScopedIndexList(document.getElementById("index-search-input")?.value.trim().toLowerCase() || "");
        });
}

function unmarkIndexTermSpan(span) {
    if (!span || !selectedTopicNode) return;

    const term = span.dataset.term || span.textContent;
    const id = span.id;
    const nodeId = selectedTopicNode.id;

    span.replaceWith(document.createTextNode(span.textContent));

    currentScopedIndexTerms = currentScopedIndexTerms.filter(t => t.id !== id);
    renderScopedIndexList(document.getElementById("index-search-input")?.value.trim().toLowerCase() || "");

    unlinkIndexTermFromRegistry(term, nodeId);
}

function initIndexSearch() {
    const input = document.getElementById("index-search-input");
    const suggestions = document.getElementById("index-suggestions");
    if (!input || !suggestions) return;

    input.addEventListener("input", () => {
        const query = input.value.trim().toLowerCase();
        if (indexTabScope === "global") {
            renderIndexAZList(query);
            renderIndexSuggestions(query);
        } else {
            renderScopedIndexList(query);
        }
    });

    input.addEventListener("focus", () => {
        if (indexTabScope === "global" && input.value.trim()) {
            renderIndexSuggestions(input.value.trim().toLowerCase());
        }
    });

    document.addEventListener("click", (event) => {
        if (!suggestions.contains(event.target) && event.target !== input) {
            suggestions.hidden = true;
        }
    });
}

function renderIndexSuggestions(query) {
    const suggestions = document.getElementById("index-suggestions");
    if (!suggestions) return;

    if (!query) {
        suggestions.hidden = true;
        suggestions.innerHTML = "";
        return;
    }

    const groups = getIndexRegistry();

    const startsWith = groups.filter(g => g.term.toLowerCase().startsWith(query));
    const contains = groups.filter(g =>
        !g.term.toLowerCase().startsWith(query) && g.term.toLowerCase().includes(query)
    );
    const results = [...startsWith, ...contains].slice(0, 8);

    if (!results.length) {
        suggestions.innerHTML = `<div class="index-suggestion-empty">No matching index terms.</div>`;
        suggestions.hidden = false;
        return;
    }

    suggestions.innerHTML = results.map((group, i) => `
        <div class="index-suggestion-item" data-suggestion-index="${i}">
            <span class="index-suggestion-term">${escapeHtml(group.term)}</span>
            ${group.matches.length === 1
                ? (group.matches[0].isAlias
                    ? `<span class="index-suggestion-path">see ${escapeHtml(group.matches[0].nodeTitle)}</span>`
                    : "")
                : `<span class="index-suggestion-path">${group.matches.length} topics</span>`}
        </div>
    `).join("");

    suggestions.querySelectorAll(".index-suggestion-item").forEach((el, i) => {
        el.addEventListener("click", () => {
            handleIndexGroupClick(results[i]);
            suggestions.hidden = true;
        });
    });

    suggestions.hidden = false;
}

async function startApp() {
    let data = await loadStudyData();

    if (!data) return;

    window.__studyData = data;

    /*
    const localContent = localStorage.getItem("study-notebook-alpha-content");
    if(localContent){
        try{ window.__studyData=JSON.parse(localContent); }catch(_){}
    } */


    data = window.__studyData;
    renderStudyTree(data);
    invalidateIndexCache();
    initRightPanelTabs();
    initIndexSearch();
    initIndexScopeToggle();
    initIndexTermContextMenu();

    // Select the first topic automatically so the notebook is not empty.
    const firstTopic = studyTreeElement.querySelector(
        '.tree-label'
    );

    if (firstTopic) {
        firstTopic.classList.add("active");
    }

    const firstTopicNode = findFirstTopic(data.subjects);

    if (firstTopicNode) {
        renderTopic(firstTopicNode);
        renderResources(firstTopicNode);
        renderMcqs(firstTopicNode);
    }

    const params = new URLSearchParams(window.location.search);

    // Supports the Index tab's "Open in new tab" action, which reopens
    // this page with ?rightTab=index so the new tab lands straight on
    // the Index view instead of the default References tab.
    const requestedTab = params.get("rightTab");
    if (requestedTab === "index" || requestedTab === "mcq") {
        selectRightPanelTab(requestedTab);
    }

    // Supports clicking a term on the standalone Index directory page
    // (index-directory.html?openNode=<id>) — jumps straight to that
    // topic here, the same way a Table of Contents click would.
    const requestedNode = params.get("openNode");
    if (requestedNode) {
        selectNodeById(requestedNode);
    }
}






/* =========================================================
   SELECTED TOPIC TRACKING
   Used by getMcqUrl() (right panel MCQ tab) to scope MCQ
   practice to whichever topic is currently open.
   ========================================================= */

let selectedTopicId = null;

function rememberSelectedTopic(node) {
    selectedTopicId = node.id;
}

/*
   The existing createTreeNode() selection handler already calls
   renderTopic(node) and renderResources(node). We also need to
   remember which topic the user selected.
*/
document.addEventListener("click", event => {
    const label = event.target.closest(".tree-label");
    if (!label) return;

    const row = label.closest(".tree-row");
    const titleEl = row?.querySelector(".tree-node-title");
    const title = titleEl ? titleEl.textContent.trim() : "";
    selectedTopicId = findTopicIdByTitle(title);
});

function findTopicIdByTitle(title) {
    function walk(nodes) {
        for (const node of nodes || []) {
            if (node.title === title) return node.id;

            const found = walk(node.children);
            if (found) return found;
        }
        return null;
    }

    return walk(window.__studyData?.subjects);
}

function findFirstTopic(nodes) {
    for (const node of nodes || []) {
        if (node.type === "topic") return node;

        const found = findFirstTopic(node.children);
        if (found) return found;
    }
    return null;
}

/* =========================================================
   STEP 13 — CONTROLLED TREE EXTENSION
   Canonical author skeleton remains the shared backbone.
   Users extend selected nodes; they do not duplicate the
   entire Subject/Course/Unit/Chapter hierarchy.
   ========================================================= */

let selectedStructureNode = null;

// Tracks which top-level Subject is highlighted in the top ribbon.
let activeSubjectId = null;

// By default the INDEX lists every Subject (each collapsed, per the
// level-by-level expand behaviour). Clicking a chip in the top ribbon
// switches the INDEX to show just that one Subject's branch instead.
// This flag is what toggles between the two modes.
let subjectFilterActive = false;

const STRUCTURE_CHILD_TYPES = {
    subject: [{type:"child", label:"Subtopic"}],
    paper: [{type:"child", label:"Subtopic"}],
    unit: [{type:"child", label:"Subtopic"}],
    chapter: [{type:"child", label:"Subtopic"}],
    topic: [{type:"child", label:"Subtopic"}],
    child: [{type:"child", label:"Subtopic"}]
};

function findNodeById(nodes,id){
    for(const node of nodes||[]){
        if(node.id===id) return node;
        const found=findNodeById(node.children,id);
        if(found) return found;
    }
    return null;
}

function refreshStructureSelection(node){
    selectedStructureNode=node;

    const add=document.getElementById("add-structure");
    const options=document.getElementById("tree-action-options");
    if(!add||!options)return;

    const canExtend=!!node;
    add.disabled=!canExtend;

    const nodeDepth = node ? getNodeDepth(node.id) : null;
    const label = node ? getNodeLevelLabel(node, (nodeDepth ?? 0) + 1) : "Subtopic";
    options.innerHTML=canExtend ? `
        <button type="button"
                class="tree-action-option"
                data-add-type="child">
            + Add ${label}
        </button>` : "";
}

function makeStructureId(type){
    return type+"-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,7);
}

function getNodeDepth(targetId, nodes = window.__studyData?.subjects || [], depth = 0) {
    for (const node of nodes) {
        if (node.id === targetId) return depth;
        const found = getNodeDepth(targetId, node.children || [], depth + 1);
        if (found !== null) return found;
    }
    return null;
}

function openStructureDialog(){
    if(!selectedStructureNode)return;

    const depth = getNodeDepth(selectedStructureNode.id);
    const nextDepth = (depth ?? 0) + 1;

    const nextType = nextDepth === 1 ? "course"
        : nextDepth === 2 ? "unit"
        : nextDepth === 3 ? "chapter"
        : nextDepth === 4 ? "topic"
        : "subtopic";

    const label = nextDepth === 1 ? "Course"
        : nextDepth === 2 ? "Unit"
        : nextDepth === 3 ? "Chapter"
        : nextDepth === 4 ? "Topic"
        : "Subtopic";

    const backdrop=document.createElement("div");
    backdrop.className="structure-dialog-backdrop";
    backdrop.innerHTML=`
        <div class="structure-dialog">
            <h3>Add ${label}</h3>
            <div class="hierarchy-help">
                <strong>Hierarchy</strong>
                <span>Subject → Course → Unit → Chapter → Topic → Subtopic → Subtopic → …</span>
            </div>
            <p>
                You are adding a <strong>${label}</strong> inside
                <strong>${escapeHtml(selectedStructureNode.title)}</strong>.
            </p>
            <input id="structure-title" type="text" placeholder="${label} name">
            <div class="structure-dialog-actions">
                <button type="button" id="structure-cancel">Cancel</button>
                <button type="button" class="save" id="structure-save">Add ${label}</button>
            </div>
        </div>`;

    document.body.appendChild(backdrop);

    backdrop.querySelector("#structure-cancel").onclick=()=>backdrop.remove();

    backdrop.querySelector("#structure-save").onclick=async ()=>{
        const title=backdrop.querySelector("#structure-title").value.trim();
        if(!title)return;

        const newNode={
            id:makeStructureId("node"),
            parentId:selectedStructureNode.id,
            type:nextType,
            title,
            children:[],
            community:[],
            resources:[],
            mcqs:[]
        };

        if(nextType === "topic" || nextType === "subtopic"){
            newNode.content={
                explanation:"",
                example:"",
                keyPoints:[]
            };
        }

        selectedStructureNode.children = selectedStructureNode.children || [];
        const sortOrder = selectedStructureNode.children.length + 1;
        selectedStructureNode.children.push(newNode);
        persistAlphaContent();
        renderStudyTree(window.__studyData);
        refreshStructureSelection(newNode);
        backdrop.remove();

        try {
            await fetch(GOOGLE_SHEET_API, {
                method: "POST",
                mode: "no-cors",
                body: JSON.stringify({
                    action: "save_structure",
                    node_id: newNode.id,
                    parent_id: newNode.parentId,
                    node_type: newNode.type,
                    title: newNode.title,
                    sort_order: sortOrder,
                    status: "active",
                    author_id: "user"
                })
            });
        } catch (error) {
            console.error("Structure save failed:", error);
        }
    };
}

function persistAlphaContent(){
    localStorage.setItem("study-notebook-alpha-content",JSON.stringify(window.__studyData));
    invalidateIndexCache();
}


// Start the Alpha notebook
startApp();


/* =========================================================
   STEP 20 — SHEET-FRIENDLY STRUCTURED COMMUNITY CONTRIBUTION
   ========================================================= */

function openContributionModal() {
    if (!selectedTopicNode) return;

    const modal = document.getElementById("contribution-modal");
    if (!modal) return;

    modal.hidden = false;
    document.getElementById("contribution-topic-name").textContent =
        selectedTopicNode.title || "Selected topic";

    document.getElementById("contribution-type").value = "explanation";
    document.getElementById("contribution-title").value = "";
    document.getElementById("contribution-text").value = "";
    document.getElementById("contribution-example").value = "";
    document.getElementById("contribution-source").value = "";
    document.getElementById("contribution-author").value = "";
    document.getElementById("contribution-ai-used").checked = false;

    const keypoints = document.getElementById("contribution-keypoints");
    keypoints.innerHTML = "";
    addContributionKeypoint();

    updateContributionFields();
}

function closeContributionModal() {
    const modal = document.getElementById("contribution-modal");
    if (modal) modal.hidden = true;
}

function addContributionKeypoint(value = "") {
    const container = document.getElementById("contribution-keypoints");
    if (!container) return;

    const row = document.createElement("div");
    row.className = "contribution-keypoint-row";
    row.innerHTML = `
        <input value="${escapeHtml(value)}" placeholder="Key point">
        <button type="button" class="contribution-keypoint-remove">×</button>
    `;

    row.querySelector("button").onclick = () => row.remove();
    container.appendChild(row);
}

function updateContributionFields() {
    const type = document.getElementById("contribution-type")?.value;
    const text = document.getElementById("contribution-text");
    const example = document.getElementById("contribution-example");
    const source = document.getElementById("contribution-source");

    if (!text || !example || !source) return;

    const presets = {
        explanation: {
            text: "Write the explanation here...",
            example: "Optional example or mnemonic",
            source: "Optional source/reference"
        },
        example: {
            text: "Describe the example and what it demonstrates...",
            example: "Optional memory aid",
            source: "Source/reference"
        },
        note: {
            text: "Write the concise note or mnemonic...",
            example: "Memory trick",
            source: "Optional source/reference"
        },
        resource: {
            text: "Briefly explain why this resource is useful...",
            example: "",
            source: "Paste the resource URL"
        },
        subtopic: {
            text: "Explain the proposed subtopic...",
            example: "Optional example",
            source: "Optional source/reference"
        },
        mcq: {
            text: "Question + options + correct answer/explanation...",
            example: "Optional exam/source reference",
            source: "Optional source/reference"
        }
    };

    const preset = presets[type] || presets.explanation;
    text.placeholder = preset.text;
    example.placeholder = preset.example;
    source.placeholder = preset.source;
}

async function submitContribution() {

    console.log("SUBMIT CONTRIBUTION FUNCTION CALLED");

    if (!selectedTopicNode) return;

    const type = document.getElementById("contribution-type").value;
    const title = document.getElementById("contribution-title").value.trim();
    const content = document.getElementById("contribution-text").value.trim();

    if (!title || !content) {
        alert("Please enter at least a Title and Explanation.");
        return;
    }

    const keyPoints = [...document.querySelectorAll("#contribution-keypoints input")]
        .map(input => input.value.trim())
        .filter(Boolean);

    const contributionId =
        "community-" +
        Date.now().toString(36) +
        "-" +
        Math.random().toString(36).slice(2, 7);

    const contributor =
        document.getElementById("contribution-author").value.trim() ||
        "Community contributor";

    const aiAssisted =
        document.getElementById("contribution-ai-used").checked;

    const example =
        document.getElementById("contribution-example").value.trim();

    const source =
        document.getElementById("contribution-source").value.trim();

    const payload = {
        contribution_id: contributionId,
        node_id: selectedTopicNode.id,
        contribution_type: type,
        title: title,
        content: content,
        source: source,
        contributor_id: contributor,
        key_points: keyPoints.join("\n"),
        example: example,
        ai_assisted: aiAssisted,
        created_at: new Date().toISOString()
    };

    try {

        await fetch(GOOGLE_SHEET_API, {
            method: "POST",
            mode: "no-cors",
            body: JSON.stringify(payload)
        });

        /*
         * Apps Script Web Apps do not reliably expose the POST response
         * to browser JavaScript because of cross-origin restrictions.
         * The request has therefore been sent without requiring a readable
         * response.
         */

        selectedTopicNode.community =
            selectedTopicNode.community || [];

        selectedTopicNode.community.push({
            id: contributionId,
            topicId: selectedTopicNode.id,
            topicTitle: selectedTopicNode.title,
            type: type,
            title: title,
            explanation: content,
            keyPoints: keyPoints,
            example: example,
            source: source,
            contributor: contributor,
            aiAssisted: aiAssisted,
            format: "structured",
            createdAt: new Date().toISOString()
        });

        closeContributionModal();

        alert("Thanks! Your contribution has been submitted for review.");

    } catch (error) {

        console.error(
            "Community contribution failed:",
            error
        );

        alert(
            "Could not submit the contribution. Please try again."
        );
    }
}

document.getElementById("contribution-close")?.addEventListener("click", closeContributionModal);
document.getElementById("contribution-cancel")?.addEventListener("click", closeContributionModal);
document.getElementById("contribution-submit")?.addEventListener("click", submitContribution);
document.getElementById("contribution-type")?.addEventListener("change", updateContributionFields);
document.getElementById("add-contribution-keypoint")?.addEventListener("click", () => addContributionKeypoint());

async function deleteCommunityItem(contributionId) {
    if (!selectedTopicNode) return;
    if (!confirm("Delete this contribution? This cannot be undone.")) return;

    try {
        await fetch(GOOGLE_SHEET_API, {
            method: "POST",
            mode: "no-cors",
            body: JSON.stringify({
                action: "delete_community",
                contribution_id: contributionId,
                node_id: selectedTopicNode.id
            })
        });

        selectedTopicNode.community =
            (selectedTopicNode.community || []).filter(x => x.id !== contributionId);

        renderContentLayer();

    } catch (error) {
        console.error("Delete contribution failed:", error);
        alert("Could not delete this contribution. Please try again.");
    }
}



/* =========================================================
   STEP 23 — SUBJECT STRIP
   ========================================================= */

function renderSubjectStrip() {
    const strip = document.getElementById("subject-strip");
    if (!strip) return;

    strip.innerHTML = "";

    (window.__studyData.subjects || []).forEach(subject => {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "subject-chip";
        chip.textContent = subject.title;

        const active = selectedStructureNode &&
                       selectedStructureNode.id === subject.id;
        if (active) chip.classList.add("active");

        chip.onclick = () => {
            selectedStructureNode = subject;
            activeSubjectId = subject.id;
            subjectFilterActive = true;

            // Clicking a chip in the ribbon narrows the INDEX down to
            // just that subject's branch (collapsing/hiding all others).
            renderStudyTree(window.__studyData);
            refreshStructureSelection(subject);

            document.querySelectorAll(".subject-chip").forEach(x =>
                x.classList.remove("active")
            );
            chip.classList.add("active");
        };

        strip.appendChild(chip);
    });
}

function addRootSubject() {
    const title = prompt("Enter Subject name:");
    if (!title || !title.trim()) return;

    const subject = {
        id: "subject-" + Date.now().toString(36) + "-" +
             Math.random().toString(36).slice(2,7),
        parentId: null,
        type: "subject",
        title: title.trim(),
        children: [],
        community: [],
        resources: [],
        mcqs: []
    };

    window.__studyData.subjects = window.__studyData.subjects || [];
    const sortOrder = window.__studyData.subjects.length + 1;
    window.__studyData.subjects.push(subject);

    persistAlphaContent();

    (async () => {
        try {
            await fetch(GOOGLE_SHEET_API, {
                method: "POST",
                mode: "no-cors",
                body: JSON.stringify({
                    action: "save_structure",
                    node_id: subject.id,
                    parent_id: "",
                    node_type: "subject",
                    title: subject.title,
                    sort_order: sortOrder,
                    status: "active",
                    author_id: "user"
                })
            });
        } catch (error) {
            console.error("Structure save failed:", error);
        }
    })();

    // New subject becomes the active subject immediately.
    selectedStructureNode = subject;
    activeSubjectId = subject.id;

    renderSubjectStrip();
    renderStudyTree(window.__studyData);
    refreshStructureSelection(subject);

    // The new subject is a root node, so its branch is immediately open.
    const rootLabel = [...document.querySelectorAll(".tree-label")]
        .find(label => label.textContent === subject.title);

    if (rootLabel) {
        rootLabel.classList.add("active");

        const rootNode = rootLabel.closest(".tree-node");
        const childContainer = rootNode?.querySelector(":scope > .tree-children");
        const toggle = rootNode?.querySelector(":scope > .tree-row > .tree-toggle");

        if (childContainer) childContainer.hidden = false;
        if (toggle) toggle.textContent = "▾";
    }

    document.querySelectorAll(".subject-chip").forEach(chip =>
        chip.classList.toggle("active", chip.textContent === subject.title)
    );
}

document.getElementById("add-subject")?.addEventListener("click", addRootSubject);

