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
   Same combination restores exact scrollTop; language/depth switches
   restore the same heading index so translated/shorter content does
   not jump to an unrelated pixel offset.
   ========================================================= */
const contentScrollMemory = new Map();
let pendingScrollRestore = null;

function contentScrollKey(topicId, language, depth) {
    return `${topicId}::${language}::${depth}`;
}

function contentHeadings() {
    return [...document.querySelectorAll("#rc-explanation h1, #rc-explanation h2, #rc-explanation h3, #rc-explanation h4, #rc-explanation h5, #rc-explanation h6")];
}

// This project's headings are authored as "5. Working Memory" /
// "5. कार्यकारी स्मृति (Working Memory)" / etc. — the leading number
// stays the same across EN/HI/HINGLISH and across FULL/HALF/MINI even
// though the wording, and the TOTAL number of headings around it,
// don't. Matching on this number is far more reliable than matching by
// array position: if one variant merges, drops, or reorders a heading
// anywhere else in the document, plain index-matching silently points
// at the wrong section from then on, and each further switch compounds
// the same error (this is what "one section further every time you
// switch" looks like). Matching by this number is immune to that,
// because it doesn't care how many OTHER headings exist before it.
// Sub-headings without a leading number (e.g. "Components of Working
// Memory") return null and fall back to positional-index matching.
function headingNumberToken(heading) {
    const text = (heading.textContent || "").trim();
    const match = text.match(/^(\d+)\s*[.)]/);
    return match ? match[1] : null;
}

// Resolves `pending`'s remembered heading against `headings` (the NEW
// content's heading list). Prefers the number-token match; falls back
// to the plain array index when the remembered heading had no number
// (or that number doesn't exist in the new content).
function resolveHeadingIndex(headings, pending) {
    if (pending.headingNumber) {
        const idx = headings.findIndex(h => headingNumberToken(h) === pending.headingNumber);
        if (idx >= 0) return idx;
    }
    return pending.headingIndex;
}

// The CONTENT header (title + language/depth toggles + read-time button
// + progress line) is position:sticky and overlaps whatever scrolls
// underneath it (z-index:30 in style.css). A fixed "24px" guess used to
// be used here, which is far smaller than the header's real rendered
// height once the language/depth toggle row is visible — restoring a
// heading to "24px below the panel top" therefore left it hidden behind
// the frozen header. Measuring the header's actual height keeps both
// "which heading counts as current" (capture) and "where to land that
// heading" (restore) consistent with the real sticky header size.
function stickyHeaderOffset(host) {
    const header = host.querySelector(".content-panel-header");
    const headerHeight = header ? header.getBoundingClientRect().height : 0;
    return headerHeight + 12; // small breathing room below the header
}

function currentHeadingIndex(host) {
    const headings = contentHeadings();
    const threshold = host.getBoundingClientRect().top + stickyHeaderOffset(host);
    let index = -1;
    let bestTop = -Infinity;

    for (let i = 0; i < headings.length; i++) {
        const top = headings[i].getBoundingClientRect().top;
        if (top <= threshold && top > bestTop) {
            bestTop = top;
            index = i;
        }
    }
    return index;
}

// Absolute offset of `el` from the top of `host`'s scrollable content,
// independent of the current scrollTop (unlike getBoundingClientRect()
// alone, which is only relative to the current viewport).
function contentOffsetOf(el, host) {
    const hostRect = host.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    return host.scrollTop + (elRect.top - hostRect.top);
}

// The document offset the user is actually reading at right now: not
// host.scrollTop itself, but scrollTop + the sticky header's height,
// since that header visually covers the first stickyHeaderOffset() px
// of whatever scrollTop points to. currentHeadingIndex() already picks
// "the heading whose top is at or above this same point" — so the
// fraction below MUST measure from this point too, or the two
// calculations disagree about where "here" is by exactly the header's
// height, biasing every fraction low by a constant amount.
function currentReadingPoint(host) {
    return host.scrollTop + stickyHeaderOffset(host);
}

// How far the user has scrolled INSIDE the current section (between this
// heading and the next one, or the end of the content if it's the last
// heading), as a 0..1 fraction. Landing on the section's heading alone
// (fraction always 0) is what caused restores to feel "close but not
// quite there" — two languages/depths can render the same heading at
// very different lengths, so remembering only "which heading" and not
// "how far into it" loses real precision. This fraction is combined with
// the matched heading on restore to land at the equivalent depth inside
// the corresponding section, not just its top.
function currentSectionFraction(host, headingIndex) {
    if (headingIndex < 0) return 0;
    const headings = contentHeadings();
    const sectionStart = contentOffsetOf(headings[headingIndex], host);
    const sectionEnd = headings[headingIndex + 1]
        ? contentOffsetOf(headings[headingIndex + 1], host)
        : host.scrollHeight;
    const span = sectionEnd - sectionStart;
    if (span <= 0) return 0;
    return Math.min(1, Math.max(0, (currentReadingPoint(host) - sectionStart) / span));
}

function captureContentScrollPosition() {
    const host = document.getElementById("middle-panel");
    if (!host || !selectedTopicNode) return null;

    const headingIndex = currentHeadingIndex(host);
    const headings = contentHeadings();
    const state = {
        scrollTop: host.scrollTop,
        headingIndex,
        headingNumber: headingIndex >= 0 ? headingNumberToken(headings[headingIndex]) : null,
        sectionFraction: currentSectionFraction(host, headingIndex)
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
    const headingIndex = currentHeadingIndex(host);
    const headings = contentHeadings();
    pendingScrollRestore = {
        mode: "semantic",
        headingIndex,
        headingNumber: headingIndex >= 0 ? headingNumberToken(headings[headingIndex]) : null,
        sectionFraction: currentSectionFraction(host, headingIndex),
        fallbackScrollTop: host.scrollTop
    };
}

function prepareTopicScrollRestore(node) {
    // The exact topic/language/depth key is resolved once the new .md file
    // has been parsed and the language/depth for this topic are known.
    // Until then, a new topic starts at the top (see restoreContentScrollPosition).
    pendingScrollRestore = { mode: "topic", topicId: node ? node.id : null };
}

// Applies one restore target to `host`. Split out from
// restoreContentScrollPosition() so the same target/fraction can be
// re-applied a second time once async content (images, mermaid
// diagrams) has finished changing the page's height — see
// scheduleContentScrollRestore() below for why that second pass exists.
function applyScrollRestore(pending, host) {
    if (!pending || !host || !selectedTopicNode) return;

    if (pending.mode === "topic") {
        const target = contentScrollMemory.get(
            contentScrollKey(selectedTopicNode.id, currentContentLanguage, currentContentDepth)
        );
        host.scrollTop = target ? target.scrollTop : 0;
        return;
    }

    const headings = contentHeadings();
    const matchedIndex = resolveHeadingIndex(headings, pending);
    if (matchedIndex >= 0 && headings[matchedIndex]) {
        const sectionStart = contentOffsetOf(headings[matchedIndex], host);
        const sectionEnd = headings[matchedIndex + 1]
            ? contentOffsetOf(headings[matchedIndex + 1], host)
            : host.scrollHeight;
        const fraction = pending.sectionFraction || 0;
        const targetContentOffset = sectionStart + fraction * (sectionEnd - sectionStart);
        host.scrollTop = Math.max(0, targetContentOffset - stickyHeaderOffset(host));
    } else {
        host.scrollTop = Math.min(pending.fallbackScrollTop || 0, Math.max(0, host.scrollHeight - host.clientHeight));
    }
}

function restoreContentScrollPosition() {
    const host = document.getElementById("middle-panel");
    if (!host || !selectedTopicNode || !pendingScrollRestore) return null;

    const pending = pendingScrollRestore;
    pendingScrollRestore = null;
    applyScrollRestore(pending, host);
    return pending;
}

// Resolves once every <img> still loading inside `host` has finished (or
// failed) loading. Images without an explicit width/height attribute
// don't have a known layout height until they load, so anything below
// one in the reading flow (including the heading we're restoring to)
// can still shift after our first restore pass. A short safety timeout
// keeps a slow/broken image from blocking restoration indefinitely.
function waitForImagesSettled(host) {
    if (!host) return Promise.resolve();
    const pending = [...host.querySelectorAll("img")].filter(img => !img.complete);
    if (!pending.length) return Promise.resolve();
    const loaded = pending.map(img => new Promise(resolve => {
        img.addEventListener("load", resolve, { once: true });
        img.addEventListener("error", resolve, { once: true });
    }));
    return Promise.race([Promise.all(loaded), new Promise(resolve => setTimeout(resolve, 1500))]);
}

// `renderDone` is the promise returned by renderRichContent() — it
// resolves once mermaid diagrams have finished rendering. Combined with
// waitForImagesSettled(), this covers the two things in this app that
// change the page's height AFTER the initial synchronous render:
// diagrams and images. A heading/fraction target computed against the
// pre-settle layout can land slightly off; re-applying the exact same
// target once the layout has stopped moving corrects that drift without
// needing a second, different restoration strategy.
function scheduleContentScrollRestore(renderDone) {
    requestAnimationFrame(() => {
        const pending = restoreContentScrollPosition();
        if (!pending || pending.mode !== "semantic") return; // exact topic/lang/depth revisits don't need a settle correction

        const host = document.getElementById("middle-panel");
        Promise.resolve(renderDone)
            .then(() => waitForImagesSettled(host))
            .then(() => requestAnimationFrame(() => applyScrollRestore(pending, host)));
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
                    🔗 ${mdLink ? "Replace Content Link" : "Add Content Link"}
                </button>
                ${hasContent ? `
                <button class="content-action resource-delete-btn" data-action="remove-content">
                    🗑 Remove Content
                </button>` : ""}
            </div>

            ${!hasContent ? `
                <div class="empty-content-block">
                    <p>No content available for this topic. Link a <strong>.md</strong> file
                       already saved in Google Drive to add rich, formatted content —
                       Markdown, tables, mermaid diagrams and charts are all supported.</p>
                    <button class="content-action" data-action="add-content-link">🔗 Add Content Link</button>
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
        applyMdTextToContentPanel(markdownCache.get(cacheKey), container);
        return;
    }

    container.innerHTML = `<p class="rc-loading">Loading content…</p>`;
    hideLanguageToggleRow();

    try {
        const url = `${GOOGLE_SHEET_API}?action=get_markdown&ref=${encodeURIComponent(mdLink)}`;
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
            markdownCache.set(cacheKey, text);

            if (!text.trim()) {
                container.innerHTML = `<p class="rc-error">This file is empty.</p>`;
                hideLanguageToggleRow();
            } else {
                applyMdTextToContentPanel(text, container);
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

function applyMdTextToContentPanel(rawText, container) {
    currentLanguageSplit = splitContentByLanguage(rawText);

    const preferred = (selectedTopicNode && lastLanguagePerTopic.get(selectedTopicNode.id)) || "EN";
    currentContentLanguage = languageBlockFor(preferred, currentLanguageSplit) ? preferred : "EN";

    const depthKey = selectedTopicNode ? `${selectedTopicNode.id}::${currentContentLanguage}` : null;
    const preferredDepth = (depthKey && lastDepthPerTopicLanguage.get(depthKey)) || "FULL";
    currentDepthSplit = splitLayerByDepth(languageBlockFor(currentContentLanguage, currentLanguageSplit) || "");
    currentContentDepth = depthBlockFor(preferredDepth, currentDepthSplit) ? preferredDepth : "FULL";

    renderCurrentLanguageBlock(container);
    updateLanguageToggleUI();
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
    const renderDone = renderRichContent(text, container);
    if (window.ReadingTools) window.ReadingTools.onContentRendered();
    scheduleContentScrollRestore(renderDone);
}

function switchContentLanguage(lang) {
    if (!currentLanguageSplit) return;
    if (!languageBlockFor(lang, currentLanguageSplit)) return; // not authored for this topic — button should be disabled anyway
    if (lang === currentContentLanguage) return;

    rememberBeforeContentVariantSwitch();
    currentContentLanguage = lang;
    if (selectedTopicNode) lastLanguagePerTopic.set(selectedTopicNode.id, lang);

    const depthKey = selectedTopicNode ? `${selectedTopicNode.id}::${lang}` : null;
    const languageText = languageBlockFor(lang, currentLanguageSplit) || "";
    const depthSplit = splitLayerByDepth(languageText);
    // A language toggle should cross ONLY the language axis. Scroll
    // restoration is designed around a single-axis jump (same heading,
    // same fraction into it); silently also changing depth here — as
    // this used to always do, via "whatever depth this language was
    // last read at" — turns a language switch into a compound
    // language+depth jump whenever that per-language memory doesn't
    // happen to already match the current depth. That's what made
    // restoration feel order-dependent: some toggle sequences kept the
    // depth axis fixed by coincidence, others didn't. Stay on the
    // CURRENT depth whenever the new language has it authored; only
    // fall back to this topic's remembered depth for that language (or
    // FULL) when it genuinely doesn't exist there.
    const stayOnCurrentDepth = depthBlockFor(currentContentDepth, depthSplit) ? currentContentDepth : null;
    const preferredDepth = stayOnCurrentDepth || (depthKey && lastDepthPerTopicLanguage.get(depthKey)) || "FULL";
    currentDepthSplit = depthSplit;
    currentContentDepth = depthBlockFor(preferredDepth, depthSplit) ? preferredDepth : "FULL";

    const container = document.getElementById("rc-explanation");
    if (!container) return;

    // Reset/recompute reading-time state before rendering the newly selected
    // language/depth content, so all reading tools use the live DOM.
    if (window.ReadingTools) window.ReadingTools.onNewArticle();
    renderCurrentLanguageBlock(container);
    updateLanguageToggleUI();
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
}

function updateLanguageToggleUI() {
    const row = document.getElementById("content-toggle-row");
    if (!row) return;

    if (!currentLanguageSplit) {
        row.hidden = true;
        return;
    }

    row.hidden = false;

    const buttons = {
        EN: document.getElementById("lang-toggle-en"),
        HI: document.getElementById("lang-toggle-hi"),
        HINGLISH: document.getElementById("lang-toggle-hinglish")
    };

    Object.keys(buttons).forEach(lang => {
        const btn = buttons[lang];
        if (!btn) return;
        btn.disabled = !languageBlockFor(lang, currentLanguageSplit);
        btn.classList.toggle("active", lang === currentContentLanguage);
    });

    const depthButtons = {
        FULL: document.getElementById("depth-toggle-full"),
        HALF: document.getElementById("depth-toggle-half"),
        MINI: document.getElementById("depth-toggle-mini")
    };

    const languageText = languageBlockFor(currentContentLanguage, currentLanguageSplit) || "";
    const depthSplit = splitLayerByDepth(languageText);
    currentDepthSplit = depthSplit;

    Object.keys(depthButtons).forEach(depth => {
        const btn = depthButtons[depth];
        if (!btn) return;
        btn.disabled = !depthBlockFor(depth, depthSplit);
        btn.classList.toggle("active", depth === currentContentDepth);
    });
}

function hideLanguageToggleRow() {
    currentLanguageSplit = null;
    currentDepthSplit = null;
    currentContentDepth = "FULL";
    const row = document.getElementById("content-toggle-row");
    if (row) row.hidden = true;
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

        if (action.dataset.action === "remove-content") {
            removeTopicContent();
            return;
        }
    }
});

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

const CONTENT_LINK_AI_PROMPT = `You are helping me write study notes as a single Markdown (.md) file
for a Library & Information Science exam-prep website. The file will
be rendered on the web using marked.js (GitHub-flavored Markdown),
so please use ONLY the following elements, and nothing else that
needs special setup:

- ## / ### headings for structure
- **bold** and *italic* for emphasis
- - bullet lists and 1. numbered lists
- Tables using standard Markdown pipe syntax
- > blockquotes for "important for exam" callouts
- Optionally, a mermaid diagram using a \`\`\`mermaid fenced code block
  (flowchart/graph/mindmap syntax) if a concept has a visual structure
- Optionally, a chart using a \`\`\`chart fenced code block containing
  JSON like: {"type":"bar","labels":[...],"data":[...]}

Full hierarchy path of this topic on the website:
<PUT HIERARCHY PATH HERE>

Topic: <PUT TOPIC NAME HERE>

Using the hierarchy path above, calibrate the depth and scope of the
notes to where this topic sits in the syllabus — a broad Unit-level
topic needs wider coverage, while a narrow Subtopic needs sharper,
more specific detail. Write clear, exam-oriented notes on this exact
topic: a definition, a clear explanation, one worked example if
relevant, and key points to remember. Keep headings consistent (##
for major sections, ### for sub-sections) and stay strictly within the
scope of this one topic — do not repeat content that belongs to
sibling or parent topics named in the hierarchy above. Do not use any
HTML tags, only Markdown.

IMPORTANT — the website has TWO independent controls for this file:
1. Language: EN / HI / HINGLISH
2. Content depth: Full Read / Half Read / Mini Read

Therefore, generate THREE depth versions for EACH language. The
language is the outer layer and the depth is nested inside it. The
final file MUST follow this exact overall structure and marker order:

<!-- ===LANG:EN=== -->
<!-- ===DEPTH:FULL=== -->
...complete English Full Read notes...
<!-- ===DEPTH:HALF=== -->
...English Half Read notes...
<!-- ===DEPTH:MINI=== -->
...English Mini Read notes...

<!-- ===LANG:HI=== -->
<!-- ===DEPTH:FULL=== -->
...complete Hindi Full Read notes...
<!-- ===DEPTH:HALF=== -->
...Hindi Half Read notes...
<!-- ===DEPTH:MINI=== -->
...Hindi Mini Read notes...

<!-- ===LANG:HINGLISH=== -->
<!-- ===DEPTH:FULL=== -->
...complete Hinglish Full Read notes...
<!-- ===DEPTH:HALF=== -->
...Hinglish Half Read notes...
<!-- ===DEPTH:MINI=== -->
...Hinglish Mini Read notes...

MARKER RULES — CRITICAL:
- Copy every marker EXACTLY as shown above.
- Every marker must be alone on its own line.
- Do not add spaces, punctuation, Markdown fences, headings, or other text on marker lines.
- Do not omit any of the nine depth sections.
- Keep the language blocks in exactly EN → HI → HINGLISH order.
- Keep the depth blocks in exactly FULL → HALF → MINI order inside every language block.
- Do NOT create separate files for the languages or depths. Everything must be in ONE .md file.

DEPTH RULES — CRITICAL:

FULL READ:
- This is the authoritative, most complete version.
- Preserve the source material's important structure, sequence, terminology,
  definitions, examples, classifications, relationships, and exam-relevant detail.
- Match the source material's heading order as closely as possible.
- Explain concepts clearly rather than merely listing keywords.
- Include useful analogies, cross-links, "why it matters", and exam-oriented
  clarification where they genuinely improve understanding, without inventing
  facts not supported by the source.
- Use the normal reading length appropriate to the topic and source material.

HALF READ:
- Keep the SAME major heading order and overall conceptual coverage as FULL.
- Make it substantially shorter — roughly half the reading time of FULL.
- Compress repetition and secondary detail, but retain definitions, core concepts,
  important classifications, relationships, key examples, and exam-relevant facts.
- Enrich concise explanations with an analogy, cross-link, or "why it matters"
  note when useful.
- It must remain understandable on its own; do not say "see Full Read" or refer
  to omitted sections.

MINI READ:
- This is the fastest revision version.
- Keep the SAME major heading order as FULL, but reduce each heading to its
  essential recall points.
- Prefer key terms, short definitions, one-line explanations, comparisons,
  formulas/rules where relevant, and one-line recall cues.
- Aim for roughly half the reading time of HALF (and therefore much shorter than FULL).
- Optionally include a small mermaid mind-map when it genuinely improves recall.
- It must also stand alone; do not say "see Full Read" or "see Half Read".

IMPORTANT — all three depth versions must be derived from the SAME source
material and must remain factually consistent with each other. Do not introduce
new facts in Half or Mini that are absent from Full/source material. Do not simply
truncate the Full version: deliberately rewrite each depth for its intended reading
purpose while preserving the same core meaning and heading sequence.

LANGUAGE INSTRUCTIONS:

EN:
Write natural, clear English suitable for exam preparation. Preserve important
technical terms and standard terminology from the source.

HI:
Write fully in Hindi using Devanagari script. Pay special attention to the correct
Hindi terminology used for difficult/important English terms. When a technical or
academic English term is important or difficult, write the English term alongside
its Hindi equivalent, e.g. "सूचना संगठन (Information Organization)". Use the source
material's established Hindi terminology when it is available. Do not turn the
entire section into Roman-script Hindi.

HINGLISH:
Write natural spoken Hinglish in Devanagari sentence structure: grammar,
connectors, and explanations should be in Hindi (Devanagari), while
subject-specific / technical / English terms remain in English (Roman script).
Do NOT write the whole section in Roman-script Hindi and do NOT translate every
technical term into Hindi.
Example style:
"Mental Processes का मतलब है कि हमारा दिमाग कैसे काम करता है — जैसे Thinking,
Learning और Remembering जैसी चीज़ें इसमें आती हैं।"

IMPORTANT — maintain the SAME underlying content, heading order, examples,
classifications, and depth relationship across EN, HI, and HINGLISH. Only the
language/style should change.

SOURCE FIDELITY:
- Treat the uploaded/original source material as authoritative.
- Do not invent facts, examples, dates, classifications, quotations, or references
  that are not supported by the source unless clearly labelled as a simple explanatory
  analogy.
- Preserve important source terminology, names, numbers, headings, and ordering.
- If the source contains a figure/table/diagram whose information matters, represent
  its information faithfully in Markdown where possible.
- Do not silently replace the source's terminology with unrelated general-knowledge
  terminology.

OUTPUT HYGIENE:
- Return ONLY the Markdown file content, not an explanation of what you did.
- Do not wrap the entire answer in a \`\`\`markdown code fence.
- Do not add a preface, conclusion, commentary, or "Here is your file" message outside
  the requested language/depth blocks.
- The marker lines are structural metadata for the website parser, so they must remain
  exactly intact.

---
FILE NAMING INSTRUCTION (for you, the human — not for the AI tool):
Once the AI above has generated the notes, save the file to your
Google Drive using EXACTLY this file name. This keeps every topic's
file uniquely and predictably named, matching this exact spot in the
website's hierarchy, so nothing ever gets mixed up or overwritten:

<PUT SUGGESTED FILENAME HERE>

Then set that file's sharing to "Anyone with the link can view",
copy its share link, and paste that link into the "Add Content Link"
box on the website for this topic.`;

// Maps each node_type to the short label used inside the generated
// Google-Drive file name (Sub / Course / Unit / Chapter / Topic / Subtopic).
const NODE_TYPE_FILE_LABELS = {
    subject: "Sub",
    course: "Course",
    unit: "Unit",
    chapter: "Chapter",
    topic: "Topic",
    subtopic: "Subtopic"
};

// Full ancestor chain (Subject -> ... -> this node), reusing the same
// tree-walk already used elsewhere (selectNodeById, Index search).
function getTopicAncestorPath(node) {
    return findPathToNode(window.__studyData?.subjects || [], node.id) || [node];
}

// Human-readable breadcrumb for the prompt's context section, e.g.
// "LIS → ePG → P-01 Knowledge Society(17) → M-02 Data, Information, and Knowledge → Information"
function buildTopicBreadcrumb(node) {
    return getTopicAncestorPath(node).map(n => n.title).join(" → ");
}

// Deterministic, hierarchy-based Drive file name, e.g.
// "Sub_LIS_Course_ePG_Unit_P-01-Knowledge-Society(17)_Chapter_M-02-Data,-Information,-and-Knowledge_Topic_Information.md"
// Spaces inside each title become hyphens; everything else (commas,
// parentheses, numbers) is kept exactly as it is in the Nodes sheet.
function buildTopicFileName(node) {
    const parts = getTopicAncestorPath(node).map(n => {
        const label = NODE_TYPE_FILE_LABELS[n.type] ||
            (n.type ? n.type.charAt(0).toUpperCase() + n.type.slice(1) : "Node");
        const safeTitle = String(n.title || "").trim().replace(/\s+/g, "-");
        return `${label}_${safeTitle}`;
    });
    return parts.join("_") + ".md";
}

function openAddContentLink() {
    if (!selectedTopicNode) return;
    document.getElementById("add-content-link-modal")?.remove();

    const existingLink = String((selectedTopicNode.content || {}).md_file || "");
    const suggestedFileName = buildTopicFileName(selectedTopicNode);

    const modal = document.createElement("div");
    modal.id = "add-content-link-modal";
    modal.innerHTML = `
        <div class="add-resource-overlay">
            <div class="add-resource-modal">
                <button type="button" class="modal-close" onclick="closeAddContentLink()">×</button>
                <h2>🔗 Add Content Link</h2>
                <p class="add-resource-scope">Adding to: <strong>${escapeHtml(selectedTopicNode.title)}</strong></p>

                <label>Google Drive link to the .md file</label>
                <input id="content-link-url" type="url" value="${escapeHtml(existingLink)}"
                       placeholder="https://drive.google.com/file/d/.../view">
                <p class="drive-note">The file must be shared as <strong>"Anyone with the link
                    can view"</strong>, or the website won't be able to read it.</p>

                <details class="content-link-guide">
                    <summary>Formatting guide</summary>
                    <pre class="content-link-guide-body">## Heading                -&gt; section heading
**bold**  *italic*        -&gt; bold / italic text
- point one               -&gt; bullet list
- point two
1. step one                -&gt; numbered list
2. step two

| Term | Meaning |         -&gt; a real HTML table
|------|---------|
| RAM  | Volatile memory |
| ROM  | Non-volatile    |

&gt; Important exam note      -&gt; highlighted quote/callout box

\`\`\`mermaid
graph TD
A[Information Society] --&gt; B[Digital Divide]
\`\`\`
-&gt; mind maps / flowcharts (mermaid.js syntax)

\`\`\`chart
{"type":"bar","labels":["Primary","Secondary"],"data":[40,35]}
\`\`\`
-&gt; bar / line / pie / doughnut charts (Chart.js JSON spec)</pre>
                </details>

                <div class="content-action-row">
                    <button type="button" class="content-action" onclick="copyContentLinkAiPrompt()">📋 Copy AI Prompt</button>
                </div>

                <label>Suggested file name (save your Drive file with this exact name)</label>
                <div class="content-action-row">
                    <input id="suggested-filename-box" type="text" readonly
                           value="${escapeHtml(suggestedFileName)}"
                           onclick="this.select()">
                    <button type="button" class="content-action" onclick="copySuggestedFileName()">📋 Copy Name</button>
                </div>
                <p class="drive-note">This name is unique to this topic's exact place in the
                    hierarchy (Subject/Course/Unit/Chapter/Topic), so it never clashes with
                    another topic's file.</p>

                <button class="resource-submit-btn" type="button" onclick="submitContentLink()">Save Link</button>
            </div>
        </div>`;
    document.body.appendChild(modal);
}

function copySuggestedFileName() {
    const box = document.getElementById("suggested-filename-box");
    if (!box) return;

    const fileName = box.value;
    const done = () => alert("File name copied! Use this exact name when saving the .md file to Google Drive.");
    const manual = () => {
        box.select();
        alert("Could not copy automatically — the name is now selected, press Ctrl+C / Cmd+C to copy it.");
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(fileName).then(done).catch(manual);
    } else {
        manual();
    }
}

function closeAddContentLink() {
    document.getElementById("add-content-link-modal")?.remove();
}

function copyContentLinkAiPrompt() {
    if (!selectedTopicNode) return;

    const topicTitle = selectedTopicNode.title || "<PUT TOPIC NAME HERE>";
    const breadcrumb = buildTopicBreadcrumb(selectedTopicNode);
    const fileName = buildTopicFileName(selectedTopicNode);

    const prompt = CONTENT_LINK_AI_PROMPT
        .replace("<PUT HIERARCHY PATH HERE>", breadcrumb)
        .replace("<PUT TOPIC NAME HERE>", topicTitle)
        .replace("<PUT SUGGESTED FILENAME HERE>", fileName);

    const done = () => alert("Prompt copied! Paste it into ChatGPT, Claude, Gemini, or any AI tool. along with the content material you want to convert into a Markdown file.");
    const manual = () => alert("Could not copy automatically — please copy this prompt manually:\n\n" + prompt);

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(prompt).then(done).catch(() => fallbackCopyText(prompt, done, manual));
    } else {
        fallbackCopyText(prompt, done, manual);
    }
}

function fallbackCopyText(text, onSuccess, onFailure) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
        document.execCommand("copy");
        onSuccess();
    } catch (error) {
        onFailure();
    }
    ta.remove();
}

async function submitContentLink() {
    const url = document.getElementById("content-link-url")?.value.trim();
    if (!url) { alert("Please paste a Google Drive link to the .md file."); return; }
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
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Save Link"; }
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
        renderIndexAZList(document.getElementById("index-search-input")?.value.trim().toLowerCase() || "");
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

function invalidateIndexCache() {
    invalidateIndexRegistry();
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

function initIndexSearch() {
    const input = document.getElementById("index-search-input");
    const suggestions = document.getElementById("index-suggestions");
    if (!input || !suggestions) return;

    input.addEventListener("input", () => {
        const query = input.value.trim().toLowerCase();
        renderIndexAZList(query);
        renderIndexSuggestions(query);
    });

    input.addEventListener("focus", () => {
        if (input.value.trim()) renderIndexSuggestions(input.value.trim().toLowerCase());
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

