/* =========================================================
   MCQ HUB — H1 shell (Papers · Info · Import)
   Plain globals, loaded AFTER mcq.js. No Sheet writes here.
   Uses from mcq.js: allLoadedMcqs, mcqApiData, currentCollectionView,
   getMcqCollectionInfo, loadFullMcqCollection, openAddMcqModal,
   openMcqCollectionEditModal, normalizeMcqOrigin, MCQ_ORIGIN_LABELS,
   mcqPdfButtonsHtml_, mcqInfoLinkHtml_, mcqEscapeHtml.
   ========================================================= */

let mcqHubTab_ = "papers";      // remembered for the page session
let mcqHubPaperId_ = "";

const MCQ_HUB_TABS_ = [
    ["papers", "PAPERS"],
    ["info", "INFO"],
    ["import", "IMPORT"],
    ["correct", "CORRECT"],
    ["export", "EXPORT"]
];

// Papers that really have questions in the loaded list, with counts.
function mcqHubCollectPapers_() {
    const rows = allLoadedMcqs || [];
    const counts = new Map();
    const origins = new Map();
    let loose = 0;
    rows.forEach(mcq => {
        const id = String(mcq.collection_id_ref || "").trim();
        if (!id) { loose++; return; }
        counts.set(id, (counts.get(id) || 0) + 1);
        if (!origins.has(id)) origins.set(id, new Map());
        const o = normalizeMcqOrigin(mcq.origin);
        origins.get(id).set(o, (origins.get(id).get(o) || 0) + 1);
    });
    const papers = Array.from(counts.entries()).map(([id, count]) => {
        const info = getMcqCollectionInfo(id);
        return { id, count, info, title: (info && info.title) || id, origins: origins.get(id) };
    });
    return { papers, loose };
}

function mcqHubOriginSummary_(originMap) {
    if (!originMap) return "";
    return Array.from(originMap.entries())
        .map(([o, n]) => `${MCQ_ORIGIN_LABELS[o] || o}: ${n}`)
        .join(" · ");
}

function mcqHubPapersTabHtml_(papers, loose) {
    const esc = mcqEscapeHtml;
    if (!papers.length) {
        return `<p class="mcq-hub-empty">No paper is loaded in this topic yet. Use the Import tab to add one.${
            loose ? `<br>${loose} individual question${loose === 1 ? "" : "s"} (no paper).` : ""}</p>`;
    }
    const cards = papers.map(p => `
        <div class="mcq-hub-card">
            <div class="mcq-hub-card-title">${esc(p.title)}</div>
            <div class="mcq-hub-card-meta">${p.count} question${p.count === 1 ? "" : "s"}${
                mcqHubOriginSummary_(p.origins) ? " · " + esc(mcqHubOriginSummary_(p.origins)) : ""}</div>
            <div class="mcq-hub-card-actions">
                <button type="button" class="content-action" data-hub-view="${esc(p.id)}">View in order</button>
                <button type="button" class="content-action" data-hub-info="${esc(p.id)}">Info</button>
            </div>
        </div>`).join("");
    return cards + (loose
        ? `<p class="mcq-hub-note">${loose} individual question${loose === 1 ? "" : "s"} (no paper)</p>` : "");
}

function mcqHubInfoTabHtml_(paperId) {
    const esc = mcqEscapeHtml;
    if (!paperId) return `<p class="mcq-hub-empty">Select a paper above to see its info.</p>`;
    const info = getMcqCollectionInfo(paperId);
    if (!info) return `<p class="mcq-hub-empty">No paper info found for this paper.</p>`;
    const links = [
        mcqPdfButtonsHtml_(info.pdf_url),
        mcqInfoLinkHtml_(info.source_url, "Open source website"),
        mcqInfoLinkHtml_(info.answer_key_url, "Answer key")
    ].join("");
    const row = (label, value) => String(value ?? "").trim()
        ? `<div class="mcq-info-row"><span class="mcq-info-label">${esc(label)}</span><span class="mcq-info-value">${esc(String(value).trim())}</span></div>`
        : "";
    return `
        <div class="mcq-hub-card">
            <div class="mcq-hub-card-title">${esc(info.title || paperId)}</div>
            ${links ? `<div class="mcq-hub-card-actions">${links}</div>` : `<div class="mcq-hub-card-meta">No links saved for this paper.</div>`}
            ${row("Source path", info.source_path)}
            ${row("Remark", info.remark)}
            <div class="mcq-hub-card-actions">
                <button type="button" class="content-action" data-hub-edit="${esc(paperId)}">✏️ Edit paper info</button>
            </div>
        </div>`;
}

function mcqHubImportTabHtml_() {
    return `
        <div class="mcq-hub-card">
            <div class="mcq-hub-card-title">Import a new paper</div>
            <p class="mcq-hub-note">Import a new paper from your .md. After import, corrections are done in the Correct tab / Sheet — don't re-import to correct.</p>
            <div class="mcq-hub-card-actions">
                <button type="button" class="content-action" id="mcq-hub-open-add">➕ Open Add MCQs</button>
            </div>
        </div>`;
}

function mcqHubRender_() {
    const modal = document.getElementById("mcq-hub-modal");
    if (!modal) return;
    const esc = mcqEscapeHtml;
    const { papers, loose } = mcqHubCollectPapers_();

    // keep the selected paper valid
    if (!papers.some(p => p.id === mcqHubPaperId_)) mcqHubPaperId_ = papers.length ? papers[0].id : "";

    modal.querySelector("#mcq-hub-paper").innerHTML = papers.length
        ? papers.map(p => `<option value="${esc(p.id)}"${p.id === mcqHubPaperId_ ? " selected" : ""}>${esc(p.title)} (${p.count})</option>`).join("")
        : `<option value="">— no paper in this topic —</option>`;

    modal.querySelectorAll(".content-layer-tab").forEach(btn =>
        btn.classList.toggle("active", btn.dataset.hubTab === mcqHubTab_));

    const body = modal.querySelector("#mcq-hub-body");
    if (mcqHubTab_ === "info") body.innerHTML = mcqHubInfoTabHtml_(mcqHubPaperId_);
    else if (mcqHubTab_ === "import") body.innerHTML = mcqHubImportTabHtml_();
    else if (mcqHubTab_ === "correct") { body.innerHTML = mcqCorrectTabHtml_(); mcqCorrectBind_(body); }
    else if (mcqHubTab_ === "export") { body.innerHTML = mcqExportTabHtml_(); mcqExportBind_(body); }
    else body.innerHTML = mcqHubPapersTabHtml_(papers, loose);

    body.querySelectorAll("[data-hub-view]").forEach(b => b.addEventListener("click", () => {
        const id = b.dataset.hubView;
        if (closeMcqHub() === false) return;
        loadFullMcqCollection(id);
    }));
    body.querySelectorAll("[data-hub-info]").forEach(b => b.addEventListener("click", () => {
        if (b.dataset.hubInfo !== mcqHubPaperId_ && window.mcqCorrectConfirmDiscard_ && !window.mcqCorrectConfirmDiscard_()) return;
        mcqHubPaperId_ = b.dataset.hubInfo;
        mcqHubTab_ = "info";
        mcqHubRender_();
    }));
    body.querySelectorAll("[data-hub-edit]").forEach(b => b.addEventListener("click", () => {
        openMcqCollectionEditModal(b.dataset.hubEdit);
    }));
    body.querySelector("#mcq-hub-open-add")?.addEventListener("click", () => {
        // Hub stays open underneath; closing Add MCQs returns to the Hub.
        openAddMcqModal();
    });
}

function mcqHubKeydown_(event) {
    if (event.key !== "Escape") return;
    // A modal opened on top of the Hub (Add MCQs / Edit paper info) closes first.
    if (document.getElementById("add-mcq-modal") || document.getElementById("mcq-collection-edit-modal")) return;
    closeMcqHub();
}

// H3 — returns false (and keeps the Hub open) when the person has unsaved answer
// changes and chooses to stay. `force` skips the question (used when re-opening).
function closeMcqHub(force) {
    if (force !== true && document.getElementById("mcq-hub-modal") &&
        window.mcqCorrectConfirmDiscard_ && !window.mcqCorrectConfirmDiscard_()) return false;
    document.getElementById("mcq-hub-modal")?.remove();
    document.removeEventListener("keydown", mcqHubKeydown_);
    return true;
}

function openMcqHub(opts) {
    opts = opts || {};
    closeMcqHub(true);      // re-opening keeps the unsaved answer grid (same paper)

    const { papers } = mcqHubCollectPapers_();
    const wanted = opts.paperId || (currentCollectionView && currentCollectionView.id) || "";
    if (wanted) mcqHubPaperId_ = String(wanted);
    else if (!papers.some(p => p.id === mcqHubPaperId_)) mcqHubPaperId_ = papers.length ? papers[0].id : "";
    if (opts.tab) mcqHubTab_ = opts.tab;

    const modal = document.createElement("div");
    modal.id = "mcq-hub-modal";
    modal.innerHTML = `
        <div class="add-resource-overlay">
            <div class="add-resource-modal mcq-hub-modal">
                <div class="mcq-hub-header">
                    <h2>🗂️ MCQ Hub</h2>
                    <button type="button" class="modal-close" id="mcq-hub-close" aria-label="Close">×</button>
                </div>
                <div class="mcq-hub-select-row">
                    <label for="mcq-hub-paper">Paper</label>
                    <select id="mcq-hub-paper"></select>
                </div>
                <div class="mcq-hub-sel-row">
                    <button type="button" class="content-action" id="mcq-hub-sel-chip">✔ ${mcqSelectedIds.size} selected</button>
                    <div class="mcq-hub-sel-menu" id="mcq-hub-sel-menu" hidden>
                        <button type="button" class="content-action" data-hub-sel="paper">Select all in this paper</button>
                        <button type="button" class="content-action" data-hub-sel="visible">Select visible</button>
                        <button type="button" class="content-action" data-hub-sel="invert">Invert</button>
                        <button type="button" class="content-action" data-hub-sel="clear">Clear</button>
                    </div>
                </div>
                <div class="content-layer-tabs mcq-hub-tabs">
                    ${MCQ_HUB_TABS_.map(([key, label]) =>
                        `<button type="button" class="content-layer-tab" data-hub-tab="${key}">${label}</button>`).join("")}
                </div>
                <div id="mcq-hub-body" class="mcq-hub-body"></div>
            </div>
        </div>`;
    document.body.appendChild(modal);

    modal.querySelector("#mcq-hub-close").addEventListener("click", () => closeMcqHub());
    modal.querySelector(".add-resource-overlay").addEventListener("mousedown", e => {
        if (e.target.classList.contains("add-resource-overlay")) closeMcqHub();
    });
    modal.querySelector("#mcq-hub-paper").addEventListener("change", e => {
        const next = e.target.value;
        // H3 — unsaved answer changes belong to the old paper
        if (next !== mcqHubPaperId_ && window.mcqCorrectConfirmDiscard_ && !window.mcqCorrectConfirmDiscard_()) {
            e.target.value = mcqHubPaperId_;
            return;
        }
        mcqHubPaperId_ = next;
        mcqHubRender_();
    });
    modal.querySelectorAll(".content-layer-tab").forEach(btn => btn.addEventListener("click", () => {
        mcqHubTab_ = btn.dataset.hubTab;
        mcqHubRender_();
    }));
    document.addEventListener("keydown", mcqHubKeydown_);

    modal.querySelector("#mcq-hub-sel-chip").addEventListener("click", () => {
        const menu = modal.querySelector("#mcq-hub-sel-menu");
        menu.hidden = !menu.hidden;
    });
    modal.querySelectorAll("[data-hub-sel]").forEach(btn => btn.addEventListener("click", async () => {
        const act = btn.dataset.hubSel;
        const visibleIds = (currentMcqs || []).map(q => String(q.id)).filter(Boolean);
        if (act === "clear") mcqSelectedIds.clear();
        else if (act === "visible") visibleIds.forEach(id => mcqSelectedIds.add(id));
        else if (act === "invert") visibleIds.forEach(id => { if (mcqSelectedIds.has(id)) mcqSelectedIds.delete(id); else mcqSelectedIds.add(id); });
        else if (act === "paper") {
            try {
                const paper = await mcqExportGetPaper_(mcqHubPaperId_);
                paper.rows.forEach(r => { if (r.id) mcqSelectedIds.add(String(r.id)); });
            } catch (err) {
                console.warn("Select all in paper failed:", err);
                alert("Could not load this paper. Please try again.");
                return;
            }
        }
        mcqUpdateSelectionUi_();
    }));

    mcqHubRender_();
}

// Called by mcq.js whenever paper info / loaded questions change.
window.mcqHubRefresh = function () {
    if (document.getElementById("mcq-hub-modal")) mcqHubRender_();
};

document.getElementById("mcq-hub-open")?.addEventListener("click", () => openMcqHub());
