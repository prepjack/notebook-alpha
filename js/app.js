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
    const mcqRows = apiData.mcqs || [];
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
            resources: [],
            mcqs: []
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

    // Attach MCQs
    mcqRows.forEach(row => {

        const node = nodeMap[row.node_id];

        if (!node) return;

        node.mcqs.push({
            id: row.mcq_id,
            question: row.question,
            options: [
                row.option_a,
                row.option_b,
                row.option_c,
                row.option_d
            ],
            answer: Number(row.correct_option) || 0,
            explanation: row.explanation || ""
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
        subjects: subjects
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

function renderTopic(node) {
    selectedTopicNode = node;
    selectedTopicId = node.id;
    renderContentLayer();
}


let activeContentLayer = "core";
let selectedTopicNode = null;

function renderContentLayer() {
    const node = selectedTopicNode;
    const el = document.getElementById("topic-content");
    if (!node || !el) return;

    if (activeContentLayer === "core") {
        const c = node.content || {};
        const diagrams = String(c.diagram || "")
            .split(/\r?\n/)
            .map(x => x.trim())
            .filter(Boolean);

        el.innerHTML = `
            <h2>${escapeHtml(node.title || "")}</h2>

            <div class="content-action-row content-action-row-top">
                <button class="content-action" data-action="edit-content">
                    ✎ Add / Edit Content
                </button>
            </div>

            <div class="topic-section">
                <h3>Definition</h3>
                <div class="rich-content" id="rc-definition"></div>
            </div>

            <div class="topic-section">
                <h3>Explanation</h3>
                <div class="rich-content" id="rc-explanation"></div>
            </div>

            <div class="topic-section">
                <h3>Example</h3>
                <div class="rich-content" id="rc-example"></div>
            </div>

            <div class="topic-section">
                <h3>Key Points</h3>
                <div class="key-points-grid">
                    ${(c.keyPoints || []).length
                        ? c.keyPoints.map(x => `
                            <div class="key-point-card">
                                <span class="key-point-icon">✓</span>
                                <span class="key-point-text">${escapeHtml(x)}</span>
                            </div>`).join("")
                        : `<p class="rc-empty">No key points added yet.</p>`}
                </div>
            </div>

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

        // Definition / Explanation / Example support Markdown (headings,
        // bold, bullet lists, tables) plus ```mermaid mind-map blocks and
        // ```chart graph blocks — see google-sheet-template/README.txt.
        renderRichContent(c.definition || "*No definition added yet.*",
            document.getElementById("rc-definition"));
        renderRichContent(c.explanation || "*No core explanation added yet.*",
            document.getElementById("rc-explanation"));
        renderRichContent(c.example || "*No example added yet.*",
            document.getElementById("rc-example"));
    }
}

document.addEventListener("click", e => {
    const action = e.target.closest("[data-action]");
    if (action && selectedTopicNode) {
        if (action.dataset.action === "contribute") {
            openContributionModal();
            return;
        }

        if (action.dataset.action === "edit-content") {
            openEditContentModal();
            return;
        }
    }
});

function openEditContentModal() {
    if (!selectedTopicNode) return;
    const c = selectedTopicNode.content || {};

    document.getElementById("edit-content-modal")?.remove();

    const modal = document.createElement("div");
    modal.id = "edit-content-modal";
    modal.innerHTML = `
        <div class="resource-preview-overlay">
            <div class="add-resource-modal">
                <button type="button" class="modal-close" onclick="closeEditContentModal()">×</button>
                <h2>✎ Add / Edit Content</h2>
                <p class="add-resource-scope">Topic: <strong>${escapeHtml(selectedTopicNode.title)}</strong></p>

                <label>Definition <span class="field-optional">(Markdown supported)</span></label>
                <textarea id="edit-content-definition" placeholder="Short, precise definition... (Markdown: **bold**, lists, tables)">${escapeHtml(c.definition || "")}</textarea>

                <label>Explanation <span class="field-optional">(Markdown, tables, mermaid/chart blocks)</span></label>
                <textarea id="edit-content-explanation" placeholder="Full explanation... Use Markdown for formatting/tables, a &#96;&#96;&#96;mermaid block for mind maps, or a &#96;&#96;&#96;chart block for graphs.">${escapeHtml(c.explanation || "")}</textarea>

                <label>Example <span class="field-optional">(Markdown supported)</span></label>
                <textarea id="edit-content-example" placeholder="Example... (Markdown supported)">${escapeHtml(c.example || "")}</textarea>

                <label>Key Points <span class="field-optional">(one per line)</span></label>
                <textarea id="edit-content-keypoints" placeholder="One key point per line...">${escapeHtml((c.keyPoints || []).join("\n"))}</textarea>

                <label>Diagram / Graph image URLs <span class="field-optional">(one per line, optional)</span></label>
                <textarea id="edit-content-diagram" placeholder="https://... (one image URL per line)">${escapeHtml(c.diagram || "")}</textarea>

                <button class="resource-submit-btn" type="button" onclick="submitEditContent()">Save Content</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector(".resource-preview-overlay").addEventListener("click", (e) => {
        if (e.target.classList.contains("resource-preview-overlay")) closeEditContentModal();
    });
}

function closeEditContentModal() {
    document.getElementById("edit-content-modal")?.remove();
}

async function submitEditContent() {
    if (!selectedTopicNode) return;

    const definition = document.getElementById("edit-content-definition").value.trim();
    const explanation = document.getElementById("edit-content-explanation").value.trim();
    const example = document.getElementById("edit-content-example").value.trim();
    const keyPointsRaw = document.getElementById("edit-content-keypoints").value.trim();
    const diagram = document.getElementById("edit-content-diagram").value.trim();

    const keyPoints = keyPointsRaw
        .split(/\r?\n/)
        .map(x => x.trim())
        .filter(Boolean);

    const submitBtn = document.querySelector("#edit-content-modal .resource-submit-btn");
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Saving..."; }

    const fields = [
        { content_type: "definition", content: definition },
        { content_type: "explanation", content: explanation },
        { content_type: "example", content: example },
        { content_type: "key_points", content: keyPointsRaw },
        { content_type: "diagram", content: diagram }
    ];

    try {
        for (const field of fields) {
            await fetch(GOOGLE_SHEET_API, {
                method: "POST",
                mode: "no-cors",
                body: JSON.stringify({
                    action: "save_core",
                    node_id: selectedTopicNode.id,
                    content_type: field.content_type,
                    title: selectedTopicNode.title,
                    content: field.content,
                    status: "published",
                    author_id: "author",
                    version: 1
                })
            });
        }

        selectedTopicNode.content = {
            definition,
            explanation,
            example,
            keyPoints,
            diagram
        };

        closeEditContentModal();
        renderContentLayer();
        document.getElementById("middle-panel").scrollTop = 0;

    } catch (error) {
        console.error("Content save failed:", error);
        alert("Could not save content. Please check your connection and try again.");
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Save Content"; }
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
                <span>Resources <span class="resource-count">${list.length}</span></span>
                <button class="add-resource-btn" type="button" onclick="openAddResource()">
                    + Add Resource
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
                }).join("") : `<p class="resource-empty">No resources added yet.</p>`}
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
                <h2>➕ Add Resource</h2>
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

        <button class="resource-submit-btn" type="button" onclick="submitResource()">Add Resource</button>
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
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Add Resource"; }
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
        document.getElementById("middle-panel").scrollTop = 0;
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
}






/* =========================================================
   MCQ LAUNCHER
   Opens a separate MCQ page/tab for the currently selected topic.
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

const mcqLaunch = document.getElementById("mcq-launch");

if (mcqLaunch) {
    mcqLaunch.addEventListener("click", () => {
        const topicId = selectedTopicId ||
            findFirstTopic(window.__studyData?.subjects)?.id;

        const url = topicId
            ? `mcq.html?topic=${encodeURIComponent(topicId)}`
            : "mcq.html";

        window.open(url, "_blank", "noopener");
    });
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

