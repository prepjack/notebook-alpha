/* =========================================================
   MCQ PAGE — separate tab/window
   ========================================================= */

let currentMcqs = [];
let currentMcqIndex = 0;
let attemptedQuestions = new Set();

// ALPHA-PLUS — explanation stays collapsed by default even after a
// question is attempted; this tracks which question indices the user
// has explicitly expanded via the 👁️ toggle (single view and All
// Questions view share this same index-keyed state).
let expandedExplanations = new Set();

// The question body is now its own scroll area (footer strip stays put).
// Remember what was last shown so Next/Previous scroll back to the top, while
// picking an option (same question re-render) keeps the scroll position.
let mcqLastScrollKey = "";

// ALPHA-PLUS — main practice-panel display mode. "single" is the
// original one-question-at-a-time view; "all" is a scrollable list
// showing every question with its full options (question + all its options),
// for scanning through the set. Clicking a question in "all" mode jumps
// back to "single" mode on that question — answering still only
// happens in single mode, so there's one answer-handling code path.
let mcqViewMode = "single";
let selectedAnswers = {};
let attemptStarted = false;
let timerSeconds = 0;
let timerInterval = null;
let markCorrect = 1;
let markWrong = 0;

// Phase 4 — MCQ Bank / Add MCQs
let mcqApiData = { nodes: [], mcqs: [] };
let mcqStudyData = { subjects: [] };

// ROLL-UP (2026-09): when on, opening any node (subject/unit/chapter/topic)
// also loads the MCQs of every sub-topic below it. MCQs are still saved once,
// on the topic they were added to; nothing is copied to parents.
let mcqIncludeDescendants = localStorage.getItem("alpha_mcq_include_sub") !== "0";
let currentMcqTopic = null;
let mcqTagSuggestions = [];

// PHASE 8a — Index_Terms loaded once via loadStudyTree()'s full dump
// (doGet already returns index_terms; no new endpoint needed).
let mcqIndexTerms = [];

// PHASE 8a — fixed, ordered language list: English + India's 22
// Eighth Schedule languages. `value` is what's stored / written into
// @language: tags (and what the practice-UI filter matches on);
// `label` is the native-script display text shown in the dropdown.
const MCQ_LANGUAGES = [
    { value: "English",   label: "English" },
    { value: "Assamese",  label: "Assamese (অসমীয়া)" },
    { value: "Bengali",   label: "Bengali (বাংলা)" },
    { value: "Bodo",      label: "Bodo (बड़ो)" },
    { value: "Dogri",     label: "Dogri (डोगरी)" },
    { value: "Gujarati",  label: "Gujarati (ગુજરાતી)" },
    { value: "Hindi",     label: "Hindi (हिंदी)" },
    { value: "Kannada",   label: "Kannada (ಕನ್ನಡ)" },
    { value: "Kashmiri",  label: "Kashmiri (کٲشُر)" },
    { value: "Konkani",   label: "Konkani (कोंकणी)" },
    { value: "Maithili",  label: "Maithili (मैथिली)" },
    { value: "Malayalam", label: "Malayalam (മലയാളം)" },
    { value: "Manipuri",  label: "Manipuri (মৈতৈলোন্)" },
    { value: "Marathi",   label: "Marathi (मराठी)" },
    { value: "Nepali",    label: "Nepali (नेपाली)" },
    { value: "Odia",      label: "Odia (ଓଡ଼ିଆ)" },
    { value: "Punjabi",   label: "Punjabi (ਪੰਜਾਬੀ)" },
    { value: "Sanskrit",  label: "Sanskrit (संस्कृतम्)" },
    { value: "Santali",   label: "Santali (ᱥᱟᱱᱛᱟᱲᱤ)" },
    { value: "Sindhi",    label: "Sindhi (سنڌي)" },
    { value: "Tamil",     label: "Tamil (தமிழ்)" },
    { value: "Telugu",    label: "Telugu (తెలుగు)" },
    { value: "Urdu",      label: "Urdu (اردو)" }
];

// Phase 7 — practice filters over the currently fetched question set.
let allLoadedMcqs = [];
let selectedMcqTags = new Set();
let selectedMcqLanguage = "";
// ORIGIN filter: "" = all, otherwise one of pyq / old / book / ai.
let selectedMcqOrigin = "";
let currentCollectionView = null;
let mcqPreviewRows = [];

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

const MCQ_GOOGLE_SHEET_API =
    "https://script.google.com/macros/s/AKfycbzE7zuqKXMmvfoP6LNCRw159odJsqWW9O0hEWm7uHIelnQJz4x7iFMnbTDKvm8lpIw5QA/exec";


// PHASE 5/7 — tree/breadcrumb structure only. MCQs are fetched lazily
// through get_mcqs(); the default doGet response no longer contains them.
async function loadStudyTree() {

    const response = await fetch(MCQ_GOOGLE_SHEET_API);

    if (!response.ok) {
        throw new Error(
            `Google Sheet API failed (${response.status})`
        );
    }

    const apiData = await response.json();

    console.log("MCQ: Google Sheets data loaded:", apiData);

    // PHASE 8a — Index_Terms is already part of this same full dump
    // (doGet's default response); reuse it directly for the MCQ
    // popup's tag autocomplete instead of adding a new endpoint.
    mcqIndexTerms = apiData.index_terms || [];

    return convertApiDataToMcqData(apiData);
}

// PHASE 5 — lazy fetch of just the MCQs (+ referenced passages /
// collections) for one topic, via the new get_mcqs doGet action.
// Pass null/undefined for topicId to fetch with no node_id filter.
// Populates mcqApiData / mcqTagSuggestions as a side effect, same as
// the old full-dump load used to, but scoped to whatever was fetched.
async function loadMcqsForTopic(topicId) {

    const url = MCQ_GOOGLE_SHEET_API + "?action=get_mcqs" +
        (topicId ? "&node_id=" + encodeURIComponent(topicId) : "") +
        (topicId && mcqIncludeDescendants ? "&include_descendants=1" : "");

    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(
            `Google Sheet API (get_mcqs) failed (${response.status})`
        );
    }

    const data = await response.json();

    mcqApiData = data || { mcqs: [], passages: [], collections: [] };
    const visibleRows = (mcqApiData.mcqs || []).filter(row =>
        String(row.status || "").trim().toLowerCase() !== "archived"
    );
    mcqTagSuggestions = buildMcqTagSuggestions(visibleRows);

    return visibleRows.map(mapMcqRow);
}

// Row -> practice-view MCQ object. Extracted out of the old
// "Attach MCQs" loop so both loadMcqsForTopic() and the refresh path
// in confirmSaveMcqs() share one mapping.
// STANDARD (2026-09): the sheet stores correct_option as 1-6 (1 = first
// option; a question has 4, 5 or 6 options depending on its source). Inside the app, `answer` stays a 0-based index so that
// options[answer] and every `selected === mcq.answer` check keep working.
// These two helpers are the ONLY place that converts between the two.
// Legacy A-F letters are still read (as 1-6) so an old cell never breaks.
function correctToIndex(value) {
    const s = String(value ?? "").trim().toUpperCase();
    if (/^[1-6]$/.test(s)) return Number(s) - 1;
    const i = "ABCDEF".indexOf(s);
    return (s.length === 1 && i >= 0) ? i : 0;
}
function indexToCorrect(index) {
    return Number(index) + 1;
}

// ORIGIN — where a question really comes from.
//   pyq  = copied from a real exam paper     book = book / coaching material
//   ai   = written by an AI                  old  = existing, not checked yet
// A blank / unknown origin in the sheet always counts as "old".
const MCQ_ORIGINS = ["pyq", "old", "book", "ai"];
const MCQ_ORIGIN_LABELS = { pyq: "Real PYQ", old: "Old bank", book: "Book", ai: "AI practice" };

function normalizeMcqOrigin(value) {
    const s = String(value ?? "").trim().toLowerCase();
    return MCQ_ORIGINS.includes(s) ? s : "old";
}

// PHASE 5 — ⓘ info button (READ-ONLY). Shows where a question comes from.
// Every field is optional: a row is drawn only when its value is filled.
const MCQ_ORIGIN_CHIP_LABELS = { pyq: "Original PYQ", old: "Unchecked", book: "Book", ai: "AI practice" };

// A link is used ONLY if it starts with http:// or https:// (never javascript:/data:).
function mcqSafeUrl_(value) {
    const s = String(value ?? "").trim();
    return /^https?:\/\//i.test(s) ? s : "";
}

function mcqInfoLinkHtml_(url, text) {
    const safe = mcqSafeUrl_(url);
    if (!safe) return "";
    return `<a class="content-action mcq-info-link" href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer">${escapeHtml(text)}</a>`;
}

function mcqOriginChipHtml_(q, index) {
    const origin = normalizeMcqOrigin(q && q.origin);
    return `<button type="button" class="mcq-origin-chip ${origin}" data-mcq-info="${index}" title="Question info">${escapeHtml(MCQ_ORIGIN_CHIP_LABELS[origin])}</button>`;
}

function mcqInfoButtonHtml_(index) {
    return `<button type="button" class="mcq-info-btn" data-mcq-info="${index}" title="Question info" aria-label="Question info">ⓘ</button>`;
}

// pdf_url can hold ONE link or MANY: "link Label || link Label"
// (a label is optional; the link itself never contains a space).
function mcqParsePdfLinks_(raw) {
    return String(raw ?? "").split("||").map(x => x.trim()).filter(Boolean).map(part => {
        const m = part.match(/^(\S+)\s*(.*)$/);
        return { url: m[1], label: (m[2] || "").trim() };
    });
}

function mcqPdfButtonsHtml_(raw) {
    const links = mcqParsePdfLinks_(raw);
    return links.map((l, i) => {
        let text;
        if (l.label) text = "Open " + l.label + (/pdf/i.test(l.label) ? "" : " PDF");
        else text = links.length === 1 ? "Open original PDF" : "Open PDF " + (i + 1);
        return mcqInfoLinkHtml_(l.url, text);
    }).join("");
}

// One label/value row. An empty value draws nothing (no "N/A").
function mcqInfoRowHtml_(label, valueHtml) {
    if (valueHtml === undefined || valueHtml === null || String(valueHtml).trim() === "") return "";
    return `<div class="mcq-info-row"><span class="mcq-info-label">${escapeHtml(label)}</span><span class="mcq-info-value">${valueHtml}</span></div>`;
}

// One "in the source" fact, per language. Same value in both languages ->
// one row "(English, Hindi)"; different -> one row per language; only one
// language filled -> a single row.
function mcqSourceRowsHtml_(q, label, key, altKey) {
    const langs = q.languages || [];
    const l1 = langs[0] || "1st language";
    const l2 = q.alt_language || langs[1] || "2nd language";
    const a = String(q[key] ?? "").trim();
    const b = String(q[altKey] ?? "").trim();
    const row = (lbl, v) => mcqInfoRowHtml_(lbl, escapeHtml(v));
    if (a && b && a === b) return row(`${label} (${l1}, ${l2})`, a);
    if (a && b) return row(`${label} (${l1})`, a) + row(`${label} (${l2})`, b);
    if (b) return row(`${label} (${l2})`, b);
    return row(label, a);
}

function mcqInfoHtml_(q) {
    const txt = v => escapeHtml(String(v ?? "").trim());
    const col = getMcqCollectionInfo(q.collection_id_ref || q.collection_id) || {};
    const origin = normalizeMcqOrigin(q.origin);
    const topic = getMcqNodePath(q.node_id).map(n => n.title).join(" › ");

    // AI practice question: show what it was based on (only if derived_from is filled).
    let basedOn = "";
    if (origin === "ai" && String(q.derived_from || "").trim()) {
        const src = (allLoadedMcqs || []).find(m => String(m.id) === String(q.derived_from));
        const srcText = src ? String(src.question || "").trim() : "";
        basedOn = srcText ? txt(srcText.length > 140 ? srcText.slice(0, 140) + "…" : srcText) : "A real exam question";
    }

    // 1) The paper / set as it exists on this website.
    const paperRows = [
        mcqInfoRowHtml_("Paper", txt(col.title)),
        mcqInfoRowHtml_("Question number", txt(q.question_no))
    ].join("");

    // 2) This question.
    const questionRows = [
        mcqInfoRowHtml_("Topic", txt(topic)),
        mcqInfoRowHtml_("Origin", txt(MCQ_ORIGIN_CHIP_LABELS[origin])),
        mcqInfoRowHtml_("Languages", txt((q.languages || []).join(", "))),
        mcqInfoRowHtml_("Difficulty", txt(q.difficulty)),
        mcqInfoRowHtml_("Tags", txt(q.tags)),
        mcqInfoRowHtml_("Question type", txt(q.question_type)),
        mcqInfoRowHtml_("Passage", String(q.passage_id || "").trim() ? "Comprehension passage question" : ""),
        mcqInfoRowHtml_("Based on", basedOn),
        mcqInfoRowHtml_("Note", txt(q.remark)),
        mcqInfoRowHtml_("Extra link", mcqInfoLinkHtml_(q.extra_link, String(q.extra_link_label || "").trim() || "Open link"))
    ].join("");

    // 3) The original paper (the real exam paper this came from).
    const sourceRows = [
        mcqInfoRowHtml_("Exam", txt(col.exam)),
        mcqInfoRowHtml_("Year", txt(col.year)),
        mcqInfoRowHtml_("Session / shift", txt(col.session)),
        mcqInfoRowHtml_("Source path", txt(col.source_path)),
        mcqInfoRowHtml_("Paper remark", txt(col.remark))
    ].join("");
    const buttons = [
        mcqPdfButtonsHtml_(col.pdf_url),
        mcqInfoLinkHtml_(col.source_url, "Open source website"),
        mcqInfoLinkHtml_(col.answer_key_url, "Answer key")
    ].join("");

    // 4) This question inside that original paper.
    const sourceQRows = [
        mcqSourceRowsHtml_(q, "Question no. in source", "source_question_no", "alt_source_question_no"),
        mcqSourceRowsHtml_(q, "Question ID in source", "source_qid", "alt_source_qid"),
        mcqSourceRowsHtml_(q, "Page in source", "source_page", "alt_source_page")
    ].join("");

    const section = (title, body) => body ? `<div class="mcq-info-heading">${title}</div>${body}` : "";
    const sourceBody = sourceRows + (buttons ? `<div class="mcq-info-buttons">${buttons}</div>` : "");
    const sourceHtml = (sourceBody || sourceQRows)
        ? section("Original paper (source)", sourceBody) + section("This question in the source", sourceQRows)
        : `<div class="mcq-info-empty">Source details not recorded for this question.</div>`;

    // PHASE 6 — edit button (only when this paper has a row in Collections).
    const collectionId = String(q.collection_id_ref || q.collection_id || "").trim();
    const editPaperBtn = (collectionId && getMcqCollectionInfo(collectionId))
        ? `<div class="mcq-info-buttons"><button type="button" class="content-action mcq-info-link" data-mcq-edit-collection="${escapeHtml(collectionId)}">✏️ Edit paper info</button></div>`
        : "";
    return section("Paper on this website", paperRows)
        + section("Question details", questionRows)
        + sourceHtml + editPaperBtn;
}

// PHASE 6 — remembers the papers shown in the "Paper info" popover so it can
// be redrawn right after "Edit paper info" is saved (no page reload needed).
let lastMcqPaperShared_ = [];

// PHASE 6 — "Edit paper info": the facts that belong to the WHOLE paper
// (Collections sheet). Every field is optional; an empty value clears it.
const MCQ_COLLECTION_EDIT_FIELDS_ = [
    ["exam", "Exam", "text", "e.g. UGC NET"],
    ["year", "Year", "text", "e.g. 2024"],
    ["session", "Session / shift", "text", "e.g. June 2024 Shift 1"],
    ["pdf_url", "Original PDF link(s) — for several write: link Label || link Label", "urls", "https://drive.google.com/... English PDF || https://drive.google.com/... Hindi PDF"],
    ["answer_key_url", "Answer key link", "url", "https://..."],
    ["source_url", "Source website link", "url", "https://..."],
    ["source_path", "Source path (menu path on the website)", "text", ""],
    ["remark", "Paper remark", "area", ""],
    ["description", "Description", "area", ""]
];

function openMcqCollectionEditModal(collectionId, reopenInfoIndex) {
    const info = getMcqCollectionInfo(collectionId);
    if (!info) {
        alert("Paper info was not found for this question.");
        return;
    }
    document.getElementById("mcq-collection-edit-modal")?.remove();
    const esc = mcqEscapeHtml;

    const modal = document.createElement("div");
    modal.id = "mcq-collection-edit-modal";
    modal.innerHTML = `
        <div class="add-resource-overlay">
            <div class="add-resource-modal mcq-meta-modal">
                <button type="button" class="modal-close" id="mcq-col-close">×</button>
                <h2>✏️ Edit paper info</h2>
                <p class="add-resource-scope"><strong>${esc(info.title || collectionId)}</strong><br>
                These facts are saved once for the whole paper. Every field is optional — leave it empty if you do not know it.</p>
                ${MCQ_COLLECTION_EDIT_FIELDS_.map(([col, label, kind, hint]) => {
                    const val = esc(String(info[col] ?? "").trim());
                    const input = (kind === "area" || kind === "urls")
                        ? `<textarea id="mcq-col-${col}" rows="${kind === "urls" ? 3 : 2}" placeholder="${esc(hint)}">${val}</textarea>`
                        : `<input id="mcq-col-${col}" type="text" value="${val}" placeholder="${esc(hint)}">`;
                    return `<label for="mcq-col-${col}">${esc(label)}</label>${input}`;
                }).join("")}
                <div class="modal-actions">
                    <button type="button" id="mcq-col-cancel">Cancel</button>
                    <button type="button" id="mcq-col-save" class="primary">Save paper info</button>
                </div>
            </div>
        </div>`;
    document.body.appendChild(modal);

    const close = () => modal.remove();
    document.getElementById("mcq-col-close")?.addEventListener("click", close);
    document.getElementById("mcq-col-cancel")?.addEventListener("click", close);
    modal.querySelector(".add-resource-overlay")?.addEventListener("click", e => {
        if (e.target === e.currentTarget) close();
    });

    document.getElementById("mcq-col-save")?.addEventListener("click", async () => {
        // 1) Read + check everything first (nothing is sent if a link is bad).
        const next = {};
        for (const [col, label, kind] of MCQ_COLLECTION_EDIT_FIELDS_) {
            let v = document.getElementById("mcq-col-" + col)?.value.trim() || "";
            if (kind === "urls" && v) {
                const parts = mcqParsePdfLinks_(v);
                if (!parts.length || parts.some(p => !mcqSafeUrl_(p.url))) {
                    alert("PDF links: every link must start with http:// or https:// (separate several with ||).");
                    return;
                }
                v = parts.map(p => p.label ? p.url + " " + p.label : p.url).join(" || ");
            }
            if (kind === "url" && v && !mcqSafeUrl_(v)) {
                alert(label + " must start with http:// or https:// (or leave it empty).");
                return;
            }
            if (v !== String(info[col] ?? "").trim()) next[col] = v;
        }
        if (!Object.keys(next).length) {
            close();
            if (reopenInfoIndex !== undefined) openMcqInfoModal(reopenInfoIndex);
            return;
        }

        const btn = document.getElementById("mcq-col-save");
        if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }

        try {
            const body = JSON.stringify({ action: "update_collection_info", collection_id: collectionId, fields: next });
            try {
                // Normal request first, so a server-side error can be shown.
                const res = await fetch(MCQ_GOOGLE_SHEET_API, { method: "POST", body });
                const out = await res.json();
                if (!out || out.success !== true) throw new Error((out && out.error) || "Save failed.");
            } catch (err) {
                // Browser blocked reading the reply: send once more the old
                // way (same values, so saving twice is harmless).
                if (!(err instanceof TypeError)) throw err;
                await fetch(MCQ_GOOGLE_SHEET_API, { method: "POST", mode: "no-cors", body });
            }

            // 2) Refresh what is already in memory so ⓘ and Paper info
            //    show the new values straight away.
            Object.assign(info, next);
            const backupInfo = (currentCollectionViewApiBackup?.collections || [])
                .find(c => String(c.collection_id || "") === String(collectionId));
            if (backupInfo) Object.assign(backupInfo, next);

            close();
            renderMcqPaperSourcesToolbar(lastMcqPaperShared_);
            if (reopenInfoIndex !== undefined) openMcqInfoModal(reopenInfoIndex);
            else alert("Paper info updated.");
        } catch (error) {
            console.error("Paper info update failed:", error);
            alert("Could not save paper info: " + (error && error.message ? error.message : "please try again."));
            if (btn) { btn.disabled = false; btn.textContent = "Save paper info"; }
        }
    });
}

function closeMcqInfoModal() {
    document.getElementById("mcq-info-overlay")?.remove();
}

function openMcqInfoModal(index) {
    const q = currentMcqs[index];
    if (!q) return;
    closeMcqInfoModal();
    const overlay = document.createElement("div");
    overlay.id = "mcq-info-overlay";
    overlay.className = "mcq-info-overlay";
    overlay.innerHTML = `<div class="mcq-info-panel" role="dialog" aria-modal="true" aria-label="Question info">
        <button type="button" class="mcq-info-close" aria-label="Close">×</button>
        ${mcqInfoHtml_(q)}
    </div>`;
    overlay.addEventListener("click", event => {
        const editBtn = event.target.closest("[data-mcq-edit-collection]");
        if (editBtn) {
            closeMcqInfoModal();
            openMcqCollectionEditModal(editBtn.dataset.mcqEditCollection, index);
            return;
        }
        if (event.target === overlay || event.target.closest(".mcq-info-close")) closeMcqInfoModal();
    });
    document.body.appendChild(overlay);
}

// One listener for every ⓘ button and origin chip (they are re-drawn on each render).
document.addEventListener("click", event => {
    const btn = event.target.closest && event.target.closest("[data-mcq-info]");
    if (btn) openMcqInfoModal(Number(btn.dataset.mcqInfo));
});
document.addEventListener("keydown", event => {
    if (event.key === "Escape") closeMcqInfoModal();
});

function mapMcqRow(row) {

    const correctIndex = correctToIndex(row.correct_option);

    // A question has as many options as its source gives it (4, 5 or 6).
    // Empty trailing options (e.g. option_e / option_f on a normal 4-option
    // question) are dropped, so only real options are ever shown.
    const rawOptions = [
        row.option_a, row.option_b, row.option_c,
        row.option_d, row.option_e, row.option_f
    ].map(o => (o === undefined || o === null) ? "" : String(o));
    let optionCount = rawOptions.length;
    while (optionCount > 1 && !rawOptions[optionCount - 1]) optionCount--;

    return {
        id: row.mcq_id,
        question: row.question || "",
        options: rawOptions.slice(0, optionCount),
        answer: correctIndex ?? 0,
        explanation: row.explanation || "",
        optionNotes: [
            row.explanation_a || "",
            row.explanation_b || "",
            row.explanation_c || "",
            row.explanation_d || "",
            row.explanation_e || "",
            row.explanation_f || ""
        ].slice(0, optionCount),
        tags: row.tags || "",
        language: row.language || "",
        description: row.description || "",
        difficulty: row.difficulty || "",
        status: row.status || "",
        question_type: row.question_type || "simple",
        collection_id_ref: row.collection_id_ref || row.collection_id || "",
        collection_id: row.collection_id || "",
        question_no: row.question_no ?? "",
        node_id: row.node_id || "",
        passage_id: row.passage_id || "",
        origin: normalizeMcqOrigin(row.origin),
        derived_from: row.derived_from || "",
        warnings: row.warnings || [],
        // PHASE 4 — one-row bilingual question: second-language columns
        // (copied one by one, as mapMcqRow always does).
        alt_language: row.alt_language || "",
        question_alt: row.question_alt || "",
        option_a_alt: row.option_a_alt || "", option_b_alt: row.option_b_alt || "",
        option_c_alt: row.option_c_alt || "", option_d_alt: row.option_d_alt || "",
        option_e_alt: row.option_e_alt || "", option_f_alt: row.option_f_alt || "",
        explanation_alt: row.explanation_alt || "",
        explanation_a_alt: row.explanation_a_alt || "", explanation_b_alt: row.explanation_b_alt || "",
        explanation_c_alt: row.explanation_c_alt || "", explanation_d_alt: row.explanation_d_alt || "",
        explanation_e_alt: row.explanation_e_alt || "", explanation_f_alt: row.explanation_f_alt || "",
        source_qid: row.source_qid || "",
        source_question_no: row.source_question_no ?? "",
        alt_source_question_no: row.alt_source_question_no ?? "",
        alt_source_qid: row.alt_source_qid ?? "",
        alt_source_page: row.alt_source_page ?? "",
        source_page: row.source_page || "",
        remark: row.remark || "",
        extra_link: row.extra_link || "",
        extra_link_label: row.extra_link_label || "",
        // true only on the second-language variant of a one-row question
        isAltVariant: false
    };
}

// Groups flat mapped rows into practice "slots". Every row is ONE
// question = ONE slot. A row with question_alt becomes one slot holding
// two language variants (toggle-able); every other row is its own
// single-variant slot. Order follows first appearance in `rows`.
// PHASE 4 — a row with question_alt is ONE question holding two
// languages. This builds the second-language variant: same id, same
// answer, same option ORDER; text comes from the *_alt columns. A blank
// alt option / explanation falls back to the first language's text, so
// the screen never shows an empty option.
function buildMcqAltVariant_(row, altKey) {
    const n = row.options.length;
    const altOpts = [
        row.option_a_alt, row.option_b_alt, row.option_c_alt,
        row.option_d_alt, row.option_e_alt, row.option_f_alt
    ];
    const altNotes = [
        row.explanation_a_alt, row.explanation_b_alt, row.explanation_c_alt,
        row.explanation_d_alt, row.explanation_e_alt, row.explanation_f_alt
    ];
    return Object.assign({}, row, {
        language: altKey,
        question: row.question_alt || row.question,
        options: row.options.map((o, i) => String(altOpts[i] || "").trim() ? String(altOpts[i]) : o),
        explanation: row.explanation_alt || row.explanation,
        optionNotes: row.optionNotes.map((t, i) => String(altNotes[i] || "").trim() ? String(altNotes[i]) : t).slice(0, n),
        isAltVariant: true
    });
}

function buildMcqSlots(rows) {
    const order = [];

    (rows || []).forEach(row => {
        const langKey = row.language || "English";

        // One-row bilingual question: ONE slot, two variants built from
        // this single row.
        if (String(row.question_alt || "").trim()) {
            let altKey = String(row.alt_language || "").trim() || "Hindi";
            if (altKey.toLowerCase() === langKey.toLowerCase()) altKey = altKey + " (2)";
            order.push({
                group_id: "row:" + row.id,
                primaryKey: langKey,
                variants: { [langKey]: row, [altKey]: buildMcqAltVariant_(row, altKey) },
                languages: [langKey, altKey]
            });
            return;
        }

        order.push({ group_id: "", variants: { [langKey]: row }, languages: [langKey] });
    });

    return order;
}

// Copies one variant's fields onto the slot's top level (question,
// options, answer, explanation, id, tags, ...) so every existing bit
// of render/result/report code that reads e.g. `mcq.question` keeps
// working unchanged — the slot just also carries `languages` /
// `activeLanguage` / `variants` / `group_id` for the toggle UI.
function activateSlotLanguage(slot, preferredLang) {
    const chosen = (preferredLang && slot.variants[preferredLang]) ? preferredLang : slot.languages[0];
    Object.assign(slot, slot.variants[chosen]);
    slot.activeLanguage = chosen;
    return slot;
}

// Remembers which language was last shown for a given question group,
// so re-filtering (tags, topic switch within the same session) doesn't
// keep snapping a toggled question back to its first language. Reset
// whenever the underlying topic/collection data changes.
let mcqActiveLanguageByGroup = new Map();

function setSlotLanguage(slotIndex, lang) {
    const slot = currentMcqs[slotIndex];
    if (!slot || !slot.variants[lang] || slot.activeLanguage === lang) return;
    activateSlotLanguage(slot, lang);
    if (slot.group_id) mcqActiveLanguageByGroup.set(slot.group_id, lang);
    renderMcqView();
}


function convertApiDataToMcqData(apiData) {

    const nodes = apiData.nodes || [];

    const nodeMap = {};

    // Create nodes
    nodes.forEach(row => {

        nodeMap[row.node_id] = {
            id: row.node_id,
            title: row.title,
            type: row.node_type,
            parentId: row.parent_id || null,
            children: []
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


    // Return the same structure expected by existing mcq.js
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

// Path of a question's own topic (Subject › Unit › Chapter › Topic), shown
// small above each question. Long paths keep only the last 3 levels.
// Feedback body: the general explanation, then (if the sheet has per-option
// notes) the note for what the learner picked, the correct option, and the
// remaining options collapsed. Rows without notes show only `explanation`.
function mcqFeedbackBodyHtml(q, sel) {
    const general = q.explanation ? `<div>${renderRichInline(q.explanation, true)}</div>` : "";
    const notes = q.optionNotes || [];
    if (!notes.some(n => n)) return general;

    const item = (i, tag) => notes[i] ? `
        <div style="margin-top:8px;padding:8px 10px;border-left:3px solid ${i === q.answer ? "#2e7d4f" : "#b5533c"};background:rgba(0,0,0,0.03);border-radius:4px;">
            <strong>${tag}Option ${i + 1}</strong><br>${renderRichInline(notes[i])}
        </div>` : "";

    const shown = new Set();
    let html = general;
    if (sel !== undefined && sel !== q.answer) {
        html += item(sel, "Your choice — ");
        shown.add(sel);
    }
    html += item(q.answer, sel === q.answer ? "Your choice · Correct — " : "Correct answer — ");
    shown.add(q.answer);

    const rest = (q.options || []).map((_, i) => i).filter(i => !shown.has(i)).map(i => item(i, "")).join("");
    if (rest.trim()) {
        html += `<details style="margin-top:8px;"><summary style="cursor:pointer;">Other options</summary>${rest}</details>`;
    }
    return html;
}

// Comprehension MCQs: shows the shared passage above the question.
// In the all-questions list a passage is shown only once, above the first
// question that uses it (prevQ = the question just before this one).
function mcqPassageHtml(q, prevQ) {
    const pid = String(q.passage_id || "").trim();
    if (!pid) return "";
    if (prevQ && String(prevQ.passage_id || "").trim() === pid) return "";
    const passage = ((mcqApiData && mcqApiData.passages) || [])
        .find(p => String(p.passage_id) === pid);
    if (!passage || !passage.content) return "";
    // PHASE 4 — second-language view uses content_alt (falls back to content).
    const passageText = (q.isAltVariant && String(passage.content_alt || "").trim()) ? passage.content_alt : passage.content;
    return `<div class="mcq-passage" style="margin:0 0 12px;padding:10px 12px;border-left:3px solid #2e7d4f;background:rgba(0,0,0,0.03);border-radius:4px;"><strong>Passage</strong><div>${renderRichInline(passageText, true)}</div></div>`;
}

function findTopic(nodes, id) {
    for (const node of nodes || []) {
        if (node.id === id) return node;

        const found = findTopic(node.children, id);
        if (found) return found;
    }
    return null;
}

function findFirstTopic(nodes) {
    for (const node of nodes || []) {
        if (node.type === "topic") return node;

        const found = findFirstTopic(node.children);
        if (found) return found;
    }
    return null;
}

function resetAttemptState() {
    clearInterval(timerInterval);
    timerInterval = null;
    timerSeconds = 0;
    attemptStarted = false;
    attemptedQuestions = new Set();
    selectedAnswers = {};

    const display = document.getElementById("mcq-timer-display");
    if (display) display.textContent = "No timer";
}

function startAttempt() {
    markCorrect = Number(document.getElementById("mark-correct").value) || 0;
    markWrong = Number(document.getElementById("mark-wrong").value) || 0;

    const mode = document.getElementById("mcq-timer-mode").value;

    clearInterval(timerInterval);
    attemptStarted = true;

    if (mode === "none") {
        document.getElementById("mcq-timer-display").textContent = "No timer";
        return;
    }

    timerSeconds = Number(mode) * 60;
    updateTimerDisplay();

    timerInterval = setInterval(() => {
        timerSeconds--;
        updateTimerDisplay();

        if (timerSeconds <= 0) {
            clearInterval(timerInterval);
            timerInterval = null;
            attemptStarted = false;
            document.getElementById("mcq-timer-display").textContent = "Time up";
        }
    }, 1000);
}

function updateTimerDisplay() {
    const display = document.getElementById("mcq-timer-display");
    if (!display) return;

    const minutes = Math.floor(timerSeconds / 60);
    const seconds = timerSeconds % 60;

    display.textContent =
        `${String(minutes).padStart(2, "0")}:` +
        `${String(seconds).padStart(2, "0")}`;
}


function getMcqLanguages(rows) {
    // PHASE 4 — a one-row bilingual question counts for BOTH its languages.
    const names = [];
    (rows || []).forEach(mcq => {
        names.push(String(mcq.language || "").trim());
        if (String(mcq.question_alt || "").trim()) {
            names.push(String(mcq.alt_language || "").trim() || "Hindi");
        }
    });
    return Array.from(new Set(names.filter(Boolean)))
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

function getMcqTags(rows) {
    return buildMcqTagSuggestions((rows || []).map(mcq => ({ tags: mcq.tags || "" })));
}

function getMcqCollectionInfo(collectionId) {
    return (mcqApiData.collections || []).find(c => String(c.collection_id || "") === String(collectionId || "")) || null;
}

// Drops a stale origin selection (e.g. after switching to a topic that has no
// AI questions) BEFORE filtering, so questions never vanish because of a
// filter the person can no longer see.
function syncMcqOriginSelection() {
    const present = new Set((allLoadedMcqs || []).map(m => normalizeMcqOrigin(m.origin)));
    if (present.size < 2 || !present.has(selectedMcqOrigin)) selectedMcqOrigin = "";
}

// Origin chips (All / Real PYQ / Old bank / Book / AI practice). Shown only
// when the loaded questions really contain 2 or more kinds of origin, so
// a topic that is all one kind stays exactly as clean as before.
function renderMcqOriginFilterRow() {
    const present = Array.from(new Set((allLoadedMcqs || []).map(m => normalizeMcqOrigin(m.origin))));
    if (selectedMcqOrigin && !present.includes(selectedMcqOrigin)) selectedMcqOrigin = "";
    let row = document.getElementById("mcq-origin-filter-row");

    if (present.length < 2) {
        selectedMcqOrigin = "";
        row?.remove();
        return;
    }
    if (!row) {
        const anchor = document.getElementById("mcq-collection-notes");
        if (!anchor) return;
        row = document.createElement("div");
        row.id = "mcq-origin-filter-row";
        row.className = "mcq-tag-filter-row mcq-origin-filter-row";
        anchor.insertAdjacentElement("beforebegin", row);
    }

    const chips = [["", "All"]].concat(
        MCQ_ORIGINS.filter(o => present.includes(o)).map(o => [o, MCQ_ORIGIN_LABELS[o]])
    );
    row.innerHTML = `<span class="mcq-filter-label">Show:</span>` + chips.map(([value, label]) => `
        <button type="button" class="mcq-filter-chip ${selectedMcqOrigin === value ? "active" : ""}" data-origin="${escapeHtml(value)}">${escapeHtml(label)}</button>
    `).join("");
    row.querySelectorAll(".mcq-filter-chip").forEach(button => {
        button.addEventListener("click", () => {
            selectedMcqOrigin = button.dataset.origin || "";
            currentMcqIndex = 0;
            applyMcqPracticeFilters();
        });
    });
}

function populateMcqPracticeFilters() {
    renderMcqOriginFilterRow();
    const language = document.getElementById("mcq-language");
    const languageWrap = document.querySelector(".mcq-language-control");
    const languages = getMcqLanguages(allLoadedMcqs);

    if (language) {
        language.innerHTML = languages.map(value =>
            `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`
        ).join("");
        selectedMcqLanguage = languages.length > 1 && languages.includes(selectedMcqLanguage)
            ? selectedMcqLanguage
            : (languages.length > 1 ? "" : (languages[0] || ""));
        language.value = selectedMcqLanguage;
        if (languageWrap) languageWrap.hidden = languages.length <= 1;
    }

    const row = document.getElementById("mcq-tag-filter-row");
    if (!row) return;
    const tags = getMcqTags(allLoadedMcqs);
    const previous = selectedMcqTags;
    selectedMcqTags = new Set(Array.from(previous).filter(tag => tags.includes(tag)));
    row.innerHTML = tags.length ? tags.map(tag => `
        <button type="button" class="mcq-filter-chip ${selectedMcqTags.has(tag) ? "active" : ""}" data-tag="${escapeHtml(tag)}">
            ${escapeHtml(tag)}
        </button>
    `).join("") : `<span class="mcq-filter-empty">No tags in this topic</span>`;

    row.querySelectorAll(".mcq-filter-chip").forEach(button => {
        button.addEventListener("click", () => {
            const tag = button.dataset.tag || "";
            if (selectedMcqTags.has(tag)) selectedMcqTags.delete(tag);
            else selectedMcqTags.add(tag);
            applyMcqPracticeFilters();
        });
    });
}

function renderMcqCollectionNotes() {
    const host = document.getElementById("mcq-collection-notes");
    if (!host) return;
    if (currentCollectionView) {
        const info = getMcqCollectionInfo(currentCollectionView.id);
        host.innerHTML = `<div class="mcq-collection-note">
            <strong>Full paper:</strong> ${escapeHtml(info?.title || currentCollectionView.id)}
            <button type="button" id="mcq-back-to-topic" class="mcq-collection-link">Back to topic</button>
            <button type="button" id="mcq-delete-collection" class="mcq-collection-link danger">🗑️ Delete this entire collection</button>
        </div>`;
        document.getElementById("mcq-back-to-topic")?.addEventListener("click", () => {
            currentCollectionView = null;
            selectedMcqTags = new Set();
            selectedMcqLanguage = "";
            mcqActiveLanguageByGroup = new Map();
            allLoadedMcqs = currentCollectionViewBackup.slice();
            mcqApiData = currentCollectionViewApiBackup;
            populateMcqPracticeFilters();
            applyMcqPracticeFilters();
        });
        document.getElementById("mcq-delete-collection")?.addEventListener("click", () =>
            deleteMcqCollectionPermanently(currentCollectionView.id, info?.title || currentCollectionView.id)
        );
        renderMcqPaperSourcesToolbar([]);
        return;
    }

    host.innerHTML = "";
    const counts = new Map();
    allLoadedMcqs.forEach(mcq => {
        const id = String(mcq.collection_id_ref || "").trim();
        if (id) counts.set(id, (counts.get(id) || 0) + 1);
    });
    const shared = Array.from(counts.entries()).filter(([, count]) => count > 1);
    renderMcqPaperSourcesToolbar(shared);
}

// Paper-source links used to live as a banner above every question. They
// now live behind a toolbar button (hidden when there's nothing to show)
// so the question area stays uncluttered — see renderMcqCollectionNotes.
function renderMcqPaperSourcesToolbar(shared) {
    const btn = document.getElementById("mcq-paper-sources-btn");
    const popover = document.getElementById("mcq-paper-sources-popover");
    if (!btn || !popover) return;

    lastMcqPaperShared_ = shared;
    if (!shared.length) {
        btn.hidden = true;
        popover.hidden = true;
        popover.innerHTML = "";
        return;
    }

    btn.hidden = false;
    popover.innerHTML = shared.map(([id]) => {
        const info = getMcqCollectionInfo(id);
        const paperLinks = [
            mcqPdfButtonsHtml_(info?.pdf_url),
            mcqInfoLinkHtml_(info?.source_url, "Open source website"),
            mcqInfoLinkHtml_(info?.answer_key_url, "Answer key")
        ].join("");
        return `<div class="mcq-collection-note">
            <strong>${escapeHtml(info?.title || id)}</strong>
            ${paperLinks}
            <button type="button" class="mcq-collection-link" data-collection-id="${escapeHtml(id)}">View full paper in order</button>
            ${info ? `<button type="button" class="mcq-collection-link" data-edit-collection-id="${escapeHtml(id)}">✏️ Edit paper info</button>` : ""}
        </div>`;
    }).join("");
    popover.querySelectorAll("[data-edit-collection-id]").forEach(button => {
        button.addEventListener("click", () => {
            popover.hidden = true;
            openMcqCollectionEditModal(button.dataset.editCollectionId);
        });
    });
    popover.querySelectorAll("[data-collection-id]").forEach(button => {
        button.addEventListener("click", () => {
            popover.hidden = true;
            loadFullMcqCollection(button.dataset.collectionId);
        });
    });
}

function positionMcqPaperSourcesPopover() {
    const btn = document.getElementById("mcq-paper-sources-btn");
    const popover = document.getElementById("mcq-paper-sources-popover");
    if (!btn || !popover) return;
    const rect = btn.getBoundingClientRect();
    popover.style.top = `${rect.bottom + 6}px`;
    popover.style.left = `${Math.max(8, rect.left)}px`;
}

document.getElementById("mcq-paper-sources-btn")?.addEventListener("click", () => {
    const popover = document.getElementById("mcq-paper-sources-popover");
    if (!popover) return;
    if (popover.hidden) {
        positionMcqPaperSourcesPopover();
        popover.hidden = false;
    } else {
        popover.hidden = true;
    }
});

document.addEventListener("click", event => {
    const popover = document.getElementById("mcq-paper-sources-popover");
    const btn = document.getElementById("mcq-paper-sources-btn");
    if (!popover || popover.hidden) return;
    if (event.target === btn || popover.contains(event.target)) return;
    popover.hidden = true;
});

window.addEventListener("resize", () => {
    const popover = document.getElementById("mcq-paper-sources-popover");
    if (popover && !popover.hidden) positionMcqPaperSourcesPopover();
});

let currentCollectionViewBackup = [];
let currentCollectionViewApiBackup = null;

// ALPHA-PLUS — bulk delete for an entire collection (Code.gs's
// delete_mcq_collection: every MCQ row, the Collections row, and any
// now-orphaned passages). Needs a stronger confirmation than a single
// question's delete since this can remove hundreds of rows at once —
// the person must type the collection's own title back, not just OK a
// generic confirm().
async function deleteMcqCollectionPermanently(collectionId, title) {
    const typed = prompt(
        `This permanently deletes EVERY question in "${title}" — no undo.\n\n` +
        `Type the collection's name exactly to confirm:\n${title}`
    );
    if (typed !== title) return;

    try {
        await fetch(MCQ_GOOGLE_SHEET_API, {
            method: "POST",
            mode: "no-cors",
            body: JSON.stringify({ action: "delete_mcq_collection", collection_id: collectionId })
        });

        currentCollectionView = null;
        selectedMcqTags = new Set();
        selectedMcqLanguage = "";
        await refreshCurrentMcqTopic();
        alert(`"${title}" deleted.`);
    } catch (error) {
        console.error("Collection delete failed:", error);
        alert("Could not delete this collection. Please try again.");
    }
}

async function loadFullMcqCollection(collectionId) {
    if (!collectionId) return;
    try {
        currentCollectionViewBackup = allLoadedMcqs.slice();
        currentCollectionViewApiBackup = mcqApiData;
        const response = await fetch(MCQ_GOOGLE_SHEET_API + "?action=get_mcqs&collection_id=" + encodeURIComponent(collectionId));
        if (!response.ok) throw new Error(`Collection fetch failed (${response.status})`);
        const data = await response.json();
        mcqApiData = data || { mcqs: [], passages: [], collections: [] };
        const rows = (mcqApiData.mcqs || []).filter(row => String(row.status || "").trim().toLowerCase() !== "archived");
        allLoadedMcqs = rows.map(mapMcqRow).sort((a, b) => {
            const qa = Number(a.question_no || 0), qb = Number(b.question_no || 0);
            return (qa || Number.MAX_SAFE_INTEGER) - (qb || Number.MAX_SAFE_INTEGER);
        });
        currentCollectionView = { id: collectionId };
        selectedMcqTags = new Set();
        selectedMcqLanguage = "";
        mcqActiveLanguageByGroup = new Map();
        populateMcqPracticeFilters();
        applyMcqPracticeFilters();
    } catch (error) {
        console.error("Could not load full MCQ collection:", error);
        alert("Could not load the full paper. Please try again.");
    }
}

function applyMcqPracticeFilters() {
    syncMcqOriginSelection();
    let slots = buildMcqSlots(allLoadedMcqs);

    // Tags — a slot passes if the UNION of tags across all its language
    // variants covers every selected tag (a translator won't always
    // repeat tags on every variant, so this avoids hiding a paired
    // question just because one variant's tags cell is blank).
    if (selectedMcqTags.size) {
        slots = slots.filter(slot => {
            const tagSet = new Set();
            slot.languages.forEach(lang => {
                String(slot.variants[lang].tags || "").split(",")
                    .map(t => t.trim().toLowerCase()).filter(Boolean)
                    .forEach(t => tagSet.add(t));
            });
            return Array.from(selectedMcqTags).every(tag => tagSet.has(tag.toLowerCase()));
        });
    }

    // Origin — a slot passes if no origin is selected, OR any of its
    // language variants has that origin.
    if (selectedMcqOrigin) {
        slots = slots.filter(slot =>
            slot.languages.some(lang => normalizeMcqOrigin(slot.variants[lang].origin) === selectedMcqOrigin)
        );
    }

    // Language — a slot passes if selectedMcqLanguage is empty, OR it
    // has a variant in that language (the OTHER variants of a paired
    // slot stay reachable via the toggle, they just aren't what
    // decides whether the slot shows up in this filtered list).
    if (selectedMcqLanguage) {
        slots = slots.filter(slot =>
            slot.languages.some(lang => lang.trim().toLowerCase() === selectedMcqLanguage.trim().toLowerCase())
        );
    }

    slots.forEach(slot => {
        const matchingFilterLang = selectedMcqLanguage
            ? slot.languages.find(lang => lang.trim().toLowerCase() === selectedMcqLanguage.trim().toLowerCase())
            : null;
        const remembered = slot.group_id ? mcqActiveLanguageByGroup.get(slot.group_id) : null;
        activateSlotLanguage(slot, matchingFilterLang || remembered || slot.languages[0]);
    });

    currentMcqs = slots;
    currentMcqIndex = Math.min(currentMcqIndex, Math.max(0, currentMcqs.length - 1));
    resetAttemptState();
    populateMcqPracticeFilters();
    renderMcqCollectionNotes();
    renderMcqView();
}

function renderMcqView() {
    const questionArea = document.getElementById("mcq-question");
    const grid = document.getElementById("mcq-question-grid");

    if (!currentMcqs.length) {
        questionArea.innerHTML = "<p>No MCQs added for this topic yet.</p>";
        grid.innerHTML = "";
        const emptyFooter = document.getElementById("mcq-question-footer");
        if (emptyFooter) emptyFooter.innerHTML = "";
        return;
    }

    const totalLabel = document.getElementById("mcq-nav-total");
    if (totalLabel) totalLabel.textContent = currentMcqs.length;

    grid.innerHTML = currentMcqs.map((mcq, index) => `
        <button
            type="button"
            class="mcq-number ${
                attemptedQuestions.has(index) ? "attempted" : ""
            } ${
                index === currentMcqIndex ? "current" : ""
            }"
            data-question-index="${index}"
        >${index + 1}</button>
    `).join("");

    grid.querySelectorAll(".mcq-number").forEach(button => {
        button.addEventListener("click", () => {
            currentMcqIndex = Number(button.dataset.questionIndex);
            mcqViewMode = "single";
            renderMcqView();
        });
    });

    // ALPHA-PLUS — "All Questions" view: every question with its full
    // options, scrollable — and fully attemptable here too (not just
    // single view). Selecting an option updates the same shared
    // selectedAnswers/attemptedQuestions state single-view uses, shows
    // immediate correct/incorrect feedback for that question, and
    // re-renders so the right-panel grid stays in sync.
    if (mcqViewMode === "all") {
        // The bottom strip stays in place in All Questions view (Previous/Next
        // make no sense here) and shows live progress instead of vanishing.
        const footer = document.getElementById("mcq-question-footer");
        if (footer) {
            footer.innerHTML = `<div style="font-size:0.9em;color:#55695c;padding:8px 4px;">Attempted ${attemptedQuestions.size} of ${currentMcqs.length} questions</div>`;
        }
        if (mcqLastScrollKey !== "all") { questionArea.scrollTop = 0; mcqLastScrollKey = "all"; }
        questionArea.innerHTML = `
            <div class="mcq-all-list">
                ${currentMcqs.map((q, i) => {
                    const sel = selectedAnswers[i];
                    const answered = sel !== undefined;
                    const expanded = expandedExplanations.has(i);
                    const correct = answered && sel === q.answer;
                    return `
                    <div class="mcq-all-item">
                        <div class="mcq-question-number mcq-question-heading">
                            <span>Question ${i + 1} of ${currentMcqs.length}</span>
                            <span class="mcq-head-tools">${mcqOriginChipHtml_(q, i)}${mcqInfoButtonHtml_(i)}</span>
                        </div>
                        ${q.languages.length > 1 ? `
                            <div class="mcq-lang-toggle" role="group" aria-label="Question language">
                                ${q.languages.map(lang => `
                                    <button type="button" class="mcq-lang-pill ${lang === q.activeLanguage ? "active" : ""}" data-question-index="${i}" data-lang="${escapeHtml(lang)}">${escapeHtml(lang)}</button>
                                `).join("")}
                            </div>
                        ` : ""}
                        ${mcqPassageHtml(q, i > 0 ? currentMcqs[i - 1] : null)}
                        <div class="mcq-question-text">${renderRichInline(q.question, true)}</div>
                        <div class="mcq-large-options">
                            ${q.options.map((option, oi) => `
                                <button
                                    type="button"
                                    class="mcq-large-option ${sel === oi ? "selected" : ""}"
                                    data-question-index="${i}"
                                    data-option-index="${oi}"
                                >
                                    <span class="mcq-radio-circle" aria-hidden="true"></span>
                                    <span class="mcq-option-text">${renderRichInline(option)}</span>
                                </button>
                            `).join("")}
                        </div>
                        ${answered ? `
                            <div class="mcq-feedback-toggle-row">
                                <button type="button" class="content-action mcq-feedback-toggle-btn" data-question-index="${i}">
                                    ${expanded ? "🙈 Hide Explanation" : "👁️ Show Explanation"}
                                </button>
                            </div>
                        ` : ""}
                        ${answered && expanded ? `
                            <div class="mcq-feedback">
                                <strong>${correct ? "Correct" : "Not correct"}</strong><br>
                                ${mcqFeedbackBodyHtml(q, sel)}
                            </div>` : ""}
                    </div>`;
                }).join("")}
            </div>
        `;

        questionArea.querySelectorAll(".mcq-all-item .mcq-large-option").forEach(button => {
            button.addEventListener("click", () => {
                answerQuestionInAllView(
                    Number(button.dataset.questionIndex),
                    Number(button.dataset.optionIndex)
                );
            });
        });

        questionArea.querySelectorAll(".mcq-feedback-toggle-btn").forEach(button => {
            button.addEventListener("click", () => {
                const index = Number(button.dataset.questionIndex);
                if (expandedExplanations.has(index)) {
                    expandedExplanations.delete(index);
                } else {
                    expandedExplanations.add(index);
                }
                renderMcqView();
            });
        });

        questionArea.querySelectorAll(".mcq-all-item .mcq-lang-pill").forEach(button => {
            button.addEventListener("click", () => {
                setSlotLanguage(Number(button.dataset.questionIndex), button.dataset.lang);
            });
        });

        return;
    }

    const mcq = currentMcqs[currentMcqIndex];
    const selected = selectedAnswers[currentMcqIndex];

    questionArea.innerHTML = `
        <div class="mcq-card-large">
            <div class="mcq-question-number mcq-question-heading">
                <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;">
                    <span>Question ${currentMcqIndex + 1} of ${currentMcqs.length}</span>
                    ${mcq.languages.length > 1 ? `
                        <div class="mcq-lang-toggle" role="group" aria-label="Question language" style="margin:0;">
                            ${mcq.languages.map(lang => `
                                <button type="button" class="mcq-lang-pill ${lang === mcq.activeLanguage ? "active" : ""}" data-lang="${escapeHtml(lang)}">${escapeHtml(lang)}</button>
                            `).join("")}
                        </div>
                    ` : ""}
                </div>
                <span class="mcq-head-tools">
                    ${mcqOriginChipHtml_(mcq, currentMcqIndex)}
                    ${mcqInfoButtonHtml_(currentMcqIndex)}
                    <button type="button" class="mcq-edit-meta" id="mcq-edit-meta" title="Edit question metadata" aria-label="Edit question metadata">✏️</button>
                </span>
            </div>

            ${mcqPassageHtml(mcq)}
            <div class="mcq-question-text">
                ${renderRichInline(mcq.question, true)}
            </div>

            <div class="mcq-large-options">
                ${mcq.options.map((option, index) => `
                    <button
                        type="button"
                        class="mcq-large-option ${
                            selected === index ? "selected" : ""
                        }"
                        data-option-index="${index}"
                    >
                        <span class="mcq-radio-circle" aria-hidden="true"></span>
                        <span class="mcq-option-text">${renderRichInline(option)}</span>
                    </button>
                `).join("")}
            </div>

            ${attemptedQuestions.has(currentMcqIndex) && expandedExplanations.has(currentMcqIndex) ? `
                <div id="mcq-feedback" class="mcq-feedback">
                    <strong>${selected === mcq.answer ? "Correct" : "Not correct"}</strong><br>
                    ${mcqFeedbackBodyHtml(mcq, selected)}
                </div>
            ` : ""}
        </div>
    `;

    const scrollKey = "single:" + currentMcqIndex;
    if (mcqLastScrollKey !== scrollKey) { questionArea.scrollTop = 0; mcqLastScrollKey = scrollKey; }

    const footer = document.getElementById("mcq-question-footer");
    if (footer) {
        footer.innerHTML = `
            <div class="mcq-navigation-buttons">
                <div class="mcq-nav-left-group">
                    <button id="mcq-prev" type="button">← Previous</button>
                    ${attemptedQuestions.has(currentMcqIndex) ? `
                        <button type="button" id="mcq-feedback-toggle" class="content-action">
                            ${expandedExplanations.has(currentMcqIndex) ? "🙈 Hide Explanation" : "👁️ Show Explanation"}
                        </button>
                    ` : ""}
                </div>
                <button id="mcq-next" type="button">Next →</button>
            </div>
        `;
    }

    document.getElementById("mcq-feedback-toggle")?.addEventListener("click", () => {
        if (expandedExplanations.has(currentMcqIndex)) {
            expandedExplanations.delete(currentMcqIndex);
        } else {
            expandedExplanations.add(currentMcqIndex);
        }
        renderMcqView();
    });

    questionArea.querySelectorAll(".mcq-large-option")
        .forEach(button => {
            button.addEventListener("click", () => {
                answerCurrentQuestion(Number(button.dataset.optionIndex));
            });
        });

    questionArea.querySelectorAll(".mcq-lang-pill").forEach(button => {
        button.addEventListener("click", () => {
            setSlotLanguage(currentMcqIndex, button.dataset.lang);
        });
    });

    document.getElementById("mcq-edit-meta")?.addEventListener("click", () => {
        // PHASE 6 — a one-row bilingual question is ONE row: always edit that
        // row. If the second language is on screen, open the "Language 2" tab.
        if (mcq.variants && mcq.variants[mcq.primaryKey]) {
            openMcqMetaModal(mcq.variants[mcq.primaryKey], { startTab: mcq.isAltVariant ? "alt" : "" });
            return;
        }
        openMcqMetaModal(mcq);
    });

    document.getElementById("mcq-prev")?.addEventListener("click", () => {
        if (currentMcqIndex > 0) {
            currentMcqIndex--;
            renderMcqView();
        }
    });

    document.getElementById("mcq-next")?.addEventListener("click", () => {
        if (currentMcqIndex < currentMcqs.length - 1) {
            currentMcqIndex++;
            renderMcqView();
        }
    });
}

function answerCurrentQuestion(optionIndex) {
    if (!attemptStarted) {
        alert("Click Start Attempt before answering questions.");
        return;
    }

    const changed = selectedAnswers[currentMcqIndex] !== optionIndex;
    selectedAnswers[currentMcqIndex] = optionIndex;
    attemptedQuestions.add(currentMcqIndex);
    if (changed) logMcqAttempt(currentMcqIndex, optionIndex);

    renderMcqView();
}

// Phase 0 event log: fires once per actual answer choice (picking an
// option counts as "submitted and graded" in this UI's instant-feedback
// design — there's no separate submit step). Re-clicking the SAME
// already-selected option doesn't re-log (see the `changed` guards at
// both call sites); picking a DIFFERENT option after that does, since
// that's a genuine new attempt future retry-queue logic can use.
function logMcqAttempt(index, optionIndex) {
    try {
        const q = currentMcqs[index];
        if (!q || !window.EventLog || typeof window.EventLog.logEvent !== "function") return;
        window.EventLog.logEvent("mcq", q.node_id || "", {
            questionId: q.id, correct: optionIndex === q.answer
        });
    } catch (err) { /* logging must never block answering */ }
}

// ALPHA-PLUS — same answer-recording logic as answerCurrentQuestion,
// but for a given question index rather than always currentMcqIndex —
// used by the "All Questions" view where every question is answerable
// in place, not just the one currently selected in single view.
function answerQuestionInAllView(index, optionIndex) {
    if (!attemptStarted) {
        alert("Click Start Attempt before answering questions.");
        return;
    }
    const changedInAllView = selectedAnswers[index] !== optionIndex;
    selectedAnswers[index] = optionIndex;
    attemptedQuestions.add(index);
    if (changedInAllView) logMcqAttempt(index, optionIndex);
    renderMcqView();
}

document.getElementById("mcq-start").addEventListener("click", startAttempt);

const mcqNavigatorWidthToggle = window.enablePanelWidthToggle?.("mcq-navigator", "--mcq-right-width", {
    workspaceOrId: "mcq-workspace",
    buttonOrId: "mcq-nav-width-toggle",
    panelLabel: "question navigator",
    minMiddle: 300,
    minPanel: 260
});


document.getElementById("mcq-nav-toggle")?.addEventListener("click", () => {
    const navigator = document.getElementById("mcq-navigator");
    if (!navigator) return;

    navigator.classList.toggle("collapsed");

    const workspace = document.querySelector(".mcq-workspace");
    const button = document.getElementById("mcq-nav-toggle");
    const collapsed = navigator.classList.contains("collapsed");

    if (workspace) {
        workspace.classList.toggle("navigator-collapsed", collapsed);
    }

    button.textContent = collapsed ? "‹" : "›";
    button.title = collapsed
        ? "Expand question navigator"
        : "Collapse question navigator";
});

// ALPHA-PLUS — main-panel Single/All Questions view switch (two
// separate buttons, not one toggle — each just sets the mode directly).
function setMcqViewMode(mode) {
    mcqViewMode = mode;
    document.getElementById("mcq-view-single-btn")?.classList.toggle("active", mode === "single");
    document.getElementById("mcq-view-all-btn")?.classList.toggle("active", mode === "all");
    renderMcqView();
}
document.getElementById("mcq-view-single-btn")?.addEventListener("click", () => setMcqViewMode("single"));
document.getElementById("mcq-view-all-btn")?.addEventListener("click", () => setMcqViewMode("all"));



function calculateResult() {
    let correct = 0, wrong = 0, unanswered = 0, score = 0;

    currentMcqs.forEach((mcq, index) => {
        if (!(index in selectedAnswers)) {
            unanswered++;
        } else if (selectedAnswers[index] === mcq.answer) {
            correct++;
            score += markCorrect;
        } else {
            wrong++;
            score += markWrong;
        }
    });

    return { total: currentMcqs.length, correct, wrong, unanswered, score };
}

function showResult() {
    clearInterval(timerInterval);
    timerInterval = null;
    attemptStarted = false;

    const result = calculateResult();
    document.getElementById("result-summary").innerHTML = `
        <div class="result-stat"><div class="result-stat-label">Score</div><div class="result-stat-value">${result.score}</div></div>
        <div class="result-stat"><div class="result-stat-label">Correct</div><div class="result-stat-value">${result.correct}</div></div>
        <div class="result-stat"><div class="result-stat-label">Wrong</div><div class="result-stat-value">${result.wrong}</div></div>
        <div class="result-stat"><div class="result-stat-label">Unanswered</div><div class="result-stat-value">${result.unanswered}</div></div>
    `;

    document.getElementById("result-details").innerHTML =
        currentMcqs.map((mcq, index) => {
            const selected = selectedAnswers[index];

            if (selected === undefined) {
                return `<div class="result-question">
                    <strong>Q${index + 1} — Unanswered</strong><br>
                    ${renderRichInline(mcq.question)}
                </div>`;
            }

            const isCorrect = selected === mcq.answer;

            return `<div class="result-question ${isCorrect ? "correct" : "wrong"}">
                <strong>Q${index + 1} — ${isCorrect ? "Correct" : "Wrong"}</strong><br>
                ${renderRichInline(mcq.question)}<br><br>
                Your answer: ${renderRichInline(mcq.options[selected])}<br>
                Correct answer: ${renderRichInline(mcq.options[mcq.answer])}<br><br>
                ${renderRichInline(mcq.explanation)}
            </div>`;
        }).join("");

    document.getElementById("mcq-result").hidden = false;

    if (!document.getElementById("download-report")) {
        const retry = document.getElementById("mcq-retry");
        const button = document.createElement("button");
        button.id = "download-report";
        button.type = "button";
        button.textContent = "Download Report PDF";
        button.addEventListener("click", downloadReport);
        retry.insertAdjacentElement("beforebegin", button);
    }
}


function buildPrintableReport() {
    const result = calculateResult();

    const rows = currentMcqs.map((mcq, index) => {
        const selected = selectedAnswers[index];
        const status = selected === undefined
            ? "Unanswered"
            : selected === mcq.answer
                ? "Correct"
                : "Wrong";

        return `
            <article class="print-question ${status.toLowerCase()}">
                <h3>Q${index + 1}. ${escapeHtml(mcq.question)}</h3>
                <p><strong>Status:</strong> ${status}</p>
                <p><strong>Your answer:</strong>
                    ${selected === undefined
                        ? "Not attempted"
                        : escapeHtml(mcq.options[selected])}
                </p>
                <p><strong>Correct answer:</strong>
                    ${escapeHtml(mcq.options[mcq.answer])}
                </p>
                <p><strong>Explanation:</strong>
                    ${escapeHtml(mcq.explanation)}
                </p>
            </article>
        `;
    }).join("");

    return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>MCQ Attempt Report</title>
            <style>
                body {
                    font-family: Arial, sans-serif;
                    color: #26332b;
                    margin: 40px;
                    line-height: 1.5;
                }
                h1 { margin-bottom: 5px; }
                .meta { color: #667168; margin-bottom: 25px; }
                .summary {
                    display: grid;
                    grid-template-columns: repeat(4, 1fr);
                    gap: 10px;
                    margin: 20px 0 30px;
                }
                .stat {
                    border: 1px solid #ccd4cc;
                    padding: 12px;
                }
                .label { font-size: 11px; color: #68736c; }
                .value { font-size: 20px; font-weight: bold; }
                .print-question {
                    border-top: 1px solid #d5dbd5;
                    padding: 16px 0;
                    break-inside: avoid;
                }
                .print-question.correct {
                    border-left: 4px solid #8eab96;
                    padding-left: 12px;
                }
                .print-question.wrong {
                    border-left: 4px solid #c5a0a0;
                    padding-left: 12px;
                }
                .print-question.unanswered {
                    border-left: 4px solid #c9c9b5;
                    padding-left: 12px;
                }
                @media print {
                    body { margin: 20mm; }
                }
            </style>
        </head>
        <body>
            <h1>MCQ Attempt Report</h1>
            <div class="meta">
                Generated locally from the current attempt.
            </div>

            <div class="summary">
                <div class="stat">
                    <div class="label">Score</div>
                    <div class="value">${result.score}</div>
                </div>
                <div class="stat">
                    <div class="label">Correct</div>
                    <div class="value">${result.correct}</div>
                </div>
                <div class="stat">
                    <div class="label">Wrong</div>
                    <div class="value">${result.wrong}</div>
                </div>
                <div class="stat">
                    <div class="label">Unanswered</div>
                    <div class="value">${result.unanswered}</div>
                </div>
            </div>

            ${rows}
        </body>
        </html>
    `;
}

function downloadReport() {
    const printable = buildPrintableReport();
    const reportWindow = window.open("", "_blank");

    if (!reportWindow) {
        alert("Please allow pop-ups for the report window.");
        return;
    }

    reportWindow.document.open();
    reportWindow.document.write(printable);
    reportWindow.document.close();

    reportWindow.onload = () => {
        reportWindow.focus();
        reportWindow.print();
    };
}

function resetForNewAttempt() {
    document.getElementById("mcq-result").hidden = true;
    currentMcqIndex = 0;
    resetAttemptState();
    renderMcqView();
}

document.getElementById("mcq-submit").addEventListener("click", showResult);
document.getElementById("mcq-retry").addEventListener("click", resetForNewAttempt);

async function init() {
    try {
        const data = await loadStudyTree();
        mcqStudyData = data;

        const params = new URLSearchParams(window.location.search);
        const topicId = params.get("topic");

        // Resolve which topic to show first (URL param, else first
        // topic in the tree — same fallback as before). Either way we
        // now fetch that topic's MCQs lazily via get_mcqs, instead of
        // reading them out of the already-fetched full dump.
        const topic = topicId
            ? findTopic(data.subjects, topicId)
            : findFirstTopic(data.subjects);

        currentMcqTopic = topic || null;
        allLoadedMcqs = topic ? await loadMcqsForTopic(topic.id) : [];
        currentCollectionView = null;
        selectedMcqTags = new Set();
        selectedMcqLanguage = "";
        mcqActiveLanguageByGroup = new Map();
        applyMcqPracticeFilters();

        if (topic) {
            document.title = `${topic.title} — MCQ Practice`;
        }
    } catch (error) {
        console.error(error);
        document.getElementById("mcq-question").innerHTML =
            "<p>Could not load MCQ data.</p>";
    }
}

init();

/* STEP 34 — MCQ DISPLAY CONTROLS */
(() => {
    const root = document.querySelector(".mcq-page");
    const down = document.getElementById("mcq-font-down");
    const up = document.getElementById("mcq-font-up");
    const lang = document.getElementById("mcq-language");
    if (!root) return;

    let size = Number(localStorage.getItem("alpha_mcq_font_size") || "1");
    size = Math.max(0.85, Math.min(1.35, size));

    function applySize() {
        root.style.setProperty("--mcq-font-scale", size);
        localStorage.setItem("alpha_mcq_font_size", String(size));
    }

    down?.addEventListener("click", () => {
        size = Math.max(0.85, +(size - 0.1).toFixed(2));
        applySize();
    });

    up?.addEventListener("click", () => {
        size = Math.min(1.35, +(size + 0.1).toFixed(2));
        applySize();
    });

    lang?.addEventListener("change", () => {
        selectedMcqLanguage = lang.value || "";
        applyMcqPracticeFilters();
    });

    applySize();
})();

/* =========================================================
   PHASE 4 — MCQ BANK: Add MCQs + Fetch & Preview
   Reuses the site's existing modal/button classes; no new modal
   framework is introduced here.
   ========================================================= */

const MCQ_TYPE_PROMPT_BLOCKS = {
    simple: `SIMPLE MCQ FORMAT
For each simple MCQ, use:
@type: simple
@topic: <node_id>
@question: <question text>
@options:
1) <option 1>
2) <option 2>
3) <option 3>
4) <option 4>
5) <option 5 — ONLY if the source question really has a 5th option, e.g. "None of these">
6) <option 6 — ONLY if the source question really has a 6th option>
@correct: <number of the correct option: 1-4 normally, up to 5 or 6 if the question has that many options>
@explanation: <2-3 sentences: the concept and why the correct option is right>
@why_1: <why option 1 is right, or why it is wrong and what it actually refers to>
@why_2: <same for option 2>
@why_3: <same for option 3>
@why_4: <same for option 4>
@why_5: <same for option 5 — only if option 5 exists>
@why_6: <same for option 6 — only if option 6 exists>
@end`,

    assertion_reason: `ASSERTION–REASONING FORMAT
For each assertion–reasoning MCQ, use:
@type: assertion_reason
@topic: <node_id>
@assertion: <Assertion (A)>
@reason: <Reason (R)>
@correct: 1|2|3|4
@explanation: <2-3 sentences: the concept and why the correct option is right>
@why_1: <why option 1 is right, or why it is wrong and what it actually refers to>
@why_2: <same for option 2>
@why_3: <same for option 3>
@why_4: <same for option 4>
@end
The parser supplies the standard four Assertion–Reasoning options (1–4) automatically, so do not invent replacement option text unless specifically required.`,

    comprehension: `COMPREHENSION FORMAT
For a comprehension set, put the passage before its questions. Use a passage id that is unique across ALL files (for example <collection-slug>-p1, <collection-slug>-p2); never reuse p001/p002 in a different file, because the same id overwrites the earlier passage:
@passage: p001
@topic: <node_id>
@passage_kind: text
@passage_text:
<verbatim passage>
@end_passage

Then create each question as a normal question block and reference that passage:
@type: simple
@topic: <node_id>
@passage: p001
@question: <question based on the passage>
@options:
1) <option 1>
2) <option 2>
3) <option 3>
4) <option 4>
5) <option 5 — ONLY if the source question really has a 5th option, e.g. "None of these">
6) <option 6 — ONLY if the source question really has a 6th option>
@correct: <number of the correct option: 1-4 normally, up to 5 or 6 if the question has that many options>
@explanation: <2-3 sentences: the concept and why the correct option is right>
@why_1: <why option 1 is right, or why it is wrong and what it actually refers to>
@why_2: <same for option 2>
@why_3: <same for option 3>
@why_4: <same for option 4>
@why_5: <same for option 5 — only if option 5 exists>
@why_6: <same for option 6 — only if option 6 exists>
@end`,

    table: `TABLE / DI FORMAT
When a question depends on a table or data interpretation, keep the table/data inside the question or passage as Markdown text and then use:
@type: simple
@topic: <node_id>
@question:
<question and any required table/data>
@options:
1) <option 1>
2) <option 2>
3) <option 3>
4) <option 4>
5) <option 5 — ONLY if the source question really has a 5th option, e.g. "None of these">
6) <option 6 — ONLY if the source question really has a 6th option>
@correct: <number of the correct option: 1-4 normally, up to 5 or 6 if the question has that many options>
@explanation: <brief calculation/reasoning: how the correct option is reached>
@why_1: <why option 1 is right, or the mistake that leads to it>
@why_2: <same for option 2>
@why_3: <same for option 3>
@why_4: <same for option 4>
@why_5: <same for option 5 — only if option 5 exists>
@why_6: <same for option 6 — only if option 6 exists>
@end`
};

function mcqEscapeHtml(value) {
    return escapeHtml(value == null ? "" : value);
}

function buildMcqTagSuggestions(rows) {
    const set = new Set();
    (rows || []).forEach(row => {
        String(row.tags || "").split(",").forEach(tag => {
            const clean = tag.trim();
            if (clean) set.add(clean);
        });
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

function getMcqNodePath(nodeId) {
    const path = [];
    function walk(nodes) {
        for (const node of nodes || []) {
            path.push(node);
            if (node.id === nodeId) return true;
            if (walk(node.children)) return true;
            path.pop();
        }
        return false;
    }
    return walk(mcqStudyData.subjects) ? path.slice() : [];
}

function buildMcqTopicBreadcrumb(node) {
    return getMcqNodePath(node?.id).map(n => n.title).join(" → ");
}

function buildMcqSuggestedFileName(node) {
    const labels = {
        subject: "Sub",
        course: "Course",
        unit: "Unit",
        chapter: "Chapter",
        topic: "Topic",
        subtopic: "Subtopic"
    };
    return getMcqNodePath(node?.id).map(n => {
        const label = labels[n.type] || (n.type ? n.type.charAt(0).toUpperCase() + n.type.slice(1) : "Node");
        const safe = String(n.title || "").trim().replace(/\s+/g, "-");
        return `${label}_${safe}`;
    }).join("_") + ".md";
}

function flattenMcqTopics(nodes, depth = 0, out = []) {
    (nodes || []).forEach(node => {
        out.push({ node, depth });
        flattenMcqTopics(node.children, depth + 1, out);
    });
    return out;
}

function getMcqSelectedTypes() {
    return Array.from(document.querySelectorAll('#mcq-type-options input[type="checkbox"]:checked'))
        .map(input => input.value);
}

/* =========================================================
   PHASE 8a — multi-language generator for the Add MCQ popup.
   Replaces the old single free-typeable "Language" text input.
   ========================================================= */

function mcqLanguageOptionsHtml(selectedValue) {
    return `<option value="">Select...</option>` + MCQ_LANGUAGES.map(lang =>
        `<option value="${mcqEscapeHtml(lang.value)}" ${lang.value === selectedValue ? "selected" : ""}>${mcqEscapeHtml(lang.label)}</option>`
    ).join("");
}

// Renders exactly `count` <select> rows into #mcq-lang-select-row.
// Preserves existing selections where possible: 2->3 keeps the first
// two and adds an empty third; 3->2 drops the third.
function renderMcqLanguageSelects(count) {
    const wrap = document.getElementById("mcq-lang-select-row");
    if (!wrap) return;

    const existingValues = Array.from(wrap.querySelectorAll(".mcq-lang-select")).map(s => s.value);
    const n = Math.max(1, Math.min(2, Number(count) || 1));

    wrap.innerHTML = "";
    for (let i = 0; i < n; i++) {
        const select = document.createElement("select");
        select.className = "mcq-lang-select";
        select.innerHTML = mcqLanguageOptionsHtml(existingValues[i] || (i === 0 ? "English" : ""));
        select.addEventListener("change", refreshLanguageDropdownOptions);
        wrap.appendChild(select);
    }

    refreshLanguageDropdownOptions();
}

// No-duplicate rule: after any dropdown's selection changes, disable
// that value's <option> in every OTHER dropdown (never in the
// dropdown that currently holds it).
function refreshLanguageDropdownOptions() {
    const selects = Array.from(document.querySelectorAll(".mcq-lang-select"));
    const chosen = selects.map(s => s.value).filter(Boolean);
    selects.forEach(select => {
        Array.from(select.options).forEach(opt => {
            if (!opt.value) return; // skip placeholder "Select..." option
            const chosenElsewhere = chosen.includes(opt.value) && select.value !== opt.value;
            opt.disabled = chosenElsewhere;
        });
    });
}

// Ordered list of selected language values (skips empty/placeholder
// dropdowns), in the order the dropdowns appear on screen.
function getMcqSelectedLanguages() {
    return Array.from(document.querySelectorAll(".mcq-lang-select"))
        .map(s => s.value)
        .filter(Boolean);
}

function getMcqTagChips() {
    return Array.from(document.querySelectorAll("#mcq-tag-chips .mcq-tag-chip"))
        .map(chip => chip.dataset.tag || "")
        .filter(Boolean);
}

function addMcqTagChip(value) {
    const clean = String(value || "").trim().replace(/^,+|,+$/g, "");
    if (!clean) return;
    const existing = getMcqTagChips();
    if (existing.some(tag => tag.toLowerCase() === clean.toLowerCase())) return;

    const wrap = document.getElementById("mcq-tag-chips");
    if (!wrap) return;
    const chip = document.createElement("span");
    chip.className = "mcq-tag-chip";
    chip.dataset.tag = clean;
    chip.innerHTML = `${mcqEscapeHtml(clean)} <button type="button" aria-label="Remove tag">×</button>`;
    chip.querySelector("button").addEventListener("click", () => chip.remove());
    wrap.appendChild(chip);
}

// PHASE 8a — tag suggestions now come only from the canonical
// Index_Terms list (term / normalized_term), not from MCQs' own
// free-typed `tags` column. No "create new tag" path exists here
// any more — if a match isn't in the Index yet, the user adds it via
// the Index system's own UI first, or uses the Description field.
function getMcqIndexTermSuggestions(query) {
    const q = String(query || "").trim().toLowerCase();
    return (mcqIndexTerms || [])
        .map(row => String(row.term || "").trim())
        .filter(Boolean)
        .filter(term => !q || term.toLowerCase().includes(q) ||
            String(mcqIndexTerms.find(r => r.term === term)?.normalized_term || "").includes(q))
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

function renderMcqTagSuggestions(value) {
    const box = document.getElementById("mcq-tag-suggestions");
    if (!box) return;
    const q = String(value || "").trim().toLowerCase();
    const matches = getMcqIndexTermSuggestions(q)
        .filter(tag => !getMcqTagChips().some(x => x.toLowerCase() === tag.toLowerCase()))
        .slice(0, 8);

    box.innerHTML = matches.map(tag =>
        `<button type="button" data-tag="${mcqEscapeHtml(tag)}">${mcqEscapeHtml(tag)}</button>`
    ).join("");
    box.hidden = matches.length === 0;
    box.querySelectorAll("button").forEach(btn => {
        btn.addEventListener("click", () => {
            addMcqTagChip(btn.dataset.tag);
            const input = document.getElementById("mcq-tag-input");
            if (input) {
                input.value = "";
                input.focus();
            }
            renderMcqTagSuggestions("");
        });
    });
}

// SINGLE-LANGUAGE files — the same source-info rules the bilingual prompt
// already has (Question ID, page, paper header). Every tag is optional and
// the AI must leave it out instead of guessing; links are never written by
// the AI (they are added on the website).
function buildMcqSourcePromptLines_(collection) {
    return [
        "",
        "SOURCE INFO (all optional — leave a tag out when the source does not print it; never guess)",
        "- @question_no: the question's own position in this file (1, 2, 3 ...), on EVERY question.",
        "- @source_question_no: the question's number EXACTLY as printed in the source PDF (it can differ from @question_no). If the PDF does not number its questions, leave it out.",
        "- @source_qid: copy the paper's own Question ID for that question EXACTLY as printed in the source PDF. If the PDF has no Question ID, leave @source_qid out. Same for @source_page. Never guess or invent an ID.",
        collection
            ? `- Paper header: on the FIRST question block only (it carries forward), next to @collection: ${collection}, write @exam, @year, @session and @source_path only if the source prints them. Do not write a separate empty header block.`
            : "- If these questions belong to a named paper, put @collection: <paper name> on the FIRST question block only, and, only if the source prints them, @exam, @year, @session and @source_path.",
        "- If the source does not print a year, session or path, leave that tag out. Never guess.",
        "- Never invent URLs. Do not write any link (PDF, website, answer key) in the file; links are added later on the website."
    ];
}

// ONE-ROW BILINGUAL (Phase 3) — prompt text for exactly 2 languages.
// Grammar is the one js/mcq-parse.js understands (one block = one question, both languages).
function buildMcqBilingualPromptLines_(primary, second, collection) {
    return [
        "",
        `BILINGUAL ONE-BLOCK INSTRUCTION (PRIMARY language = ${primary}, SECOND language = ${second})`,
        "Create ONE block per question that carries BOTH languages. Do NOT repeat the question set once per language.",
        `Question N must be the same question in both languages: same meaning, same options, same correct answer.`,
        `- PRIMARY (${primary}) tags: @question, @options, @explanation, @why_1 ... @why_6 — exactly as in the format instructions above.`,
        `- SECOND (${second}) tags, same meaning: @alt_question, @alt_options, @alt_explanation, @alt_why_1 ... @alt_why_6.`,
        `- Put @language: ${primary} and @alt_language: ${second} on EVERY question.`,
        `- @alt_options must have EXACTLY the same number of options as @options, in EXACTLY the same order (option 1 in ${primary} = option 1 in ${second}). Write ONE shared @correct (the number of the correct option); never a second @correct.`,
        `- Assertion–Reasoning questions: use @assertion / @reason for ${primary} and @alt_assertion / @alt_reason for ${second}, and also write @alt_options: the four standard statements translated into ${second}, in this order: 1) Both A and R are true, and R is the correct explanation of A  2) Both A and R are true, but R is NOT the correct explanation of A  3) A is true, but R is false  4) A is false, but R is true.`,
        `- Comprehension: ONE @passage block with the passage in ${primary} under @passage_text and the same passage in ${second} under @alt_passage_text (both before @end_passage). The questions point to it with @passage and carry their own @alt_ tags.`,
        `- SOURCE NUMBERS for the ${primary} PDF: @source_question_no (the question's number EXACTLY as printed in that PDF), @source_qid (its Question ID EXACTLY as printed) and @source_page. If the PDF does not print one of them, leave that tag out.`,
        `- SOURCE NUMBERS for the ${second} PDF: @alt_source_question_no, @alt_source_qid and @alt_source_page — the same facts, read from the ${second} version of the paper. The ${second} version can number or order its questions differently, so find the same question by its meaning (or by its Question ID, if both PDFs print the same ID) and write the ${second} number even when it differs from the ${primary} one. Leave an @alt_source_... tag out when the ${second} PDF prints the same value as the ${primary} one or does not print it at all.`,
        "- Never guess or invent a number, ID or page; copy only what the PDF prints.",
        collection
            ? `- Paper header: on the FIRST question block only (it carries forward) write @collection: ${collection} and, only if the source prints them, @exam, @year, @session and @source_path. Do not write a separate empty header block.`
            : "- Paper header: on the FIRST question block only (it carries forward) write @collection: <paper name> and, only if the source prints them, @exam, @year, @session and @source_path. Do not write a separate empty header block.",
        "- If the source does not print a year, session or path, leave that tag out. Never guess.",
        "- Never invent URLs. Do not write any link (PDF, website, answer key) in the file; links are added later on the website.",
        "",
        "Example of ONE bilingual question block:",
        "@type: simple",
        "@topic: <node_id>",
        "@question_no: 1",
        `@language: ${primary}`,
        `@alt_language: ${second}`,
        `@source_question_no: <number in the ${primary} PDF, or leave this tag out>`,
        `@alt_source_question_no: <number in the ${second} PDF, or leave this tag out>`,
        "@source_qid: <Question ID from the PDF, or leave this tag out>",
        `@alt_source_qid: <only if the ${second} PDF prints a different ID, else leave this tag out>`,
        `@question: <question in ${primary}>`,
        "@options:",
        "1) <option 1>",
        "2) <option 2>",
        "3) <option 3>",
        "4) <option 4>",
        `@alt_question: <same question in ${second}>`,
        "@alt_options:",
        "1) <same option 1>",
        "2) <same option 2>",
        "3) <same option 3>",
        "4) <same option 4>",
        "@correct: <1-4>",
        `@explanation: <explanation in ${primary}>`,
        `@alt_explanation: <explanation in ${second}>`,
        "@end"
    ];
}

function buildMcqAiPrompt() {
    const collection = document.getElementById("mcq-collection")?.value.trim() || "";
    const description = document.getElementById("mcq-description")?.value.trim() || "";
    const languages = getMcqSelectedLanguages(); // PHASE 8a — ordered list of selected language values
    const topic = currentMcqTopic;
    const topicId = topic?.id || "<PUT TOPIC ID HERE>";
    const breadcrumb = buildMcqTopicBreadcrumb(topic) || "<PUT HIERARCHY PATH HERE>";
    const filename = document.getElementById("mcq-suggested-filename")?.value.trim() ||
        buildMcqSuggestedFileName(topic);
    const tags = getMcqTagChips();
    const types = getMcqSelectedTypes();
    const count = document.getElementById("mcq-question-count")?.value || "10";
    const includeMath = document.getElementById("mcq-include-math")?.checked;

    const blocks = types.length
        ? types.map(type => MCQ_TYPE_PROMPT_BLOCKS[type]).join("\n\n---\n\n")
        : "Choose at least one question type in the popup. Do not generate other question types.";

    const lines = [
        "You are helping me create a structured Markdown (.md) file for the MCQ Bank of a Library & Information Science exam-prep website.",
        "",
        "Use ONLY the tag grammar below. Do not invent alternative metadata syntax.",
        "",
        `Study Topic hierarchy: ${breadcrumb}`,
        `Study Topic ID: ${topicId}`,
        `Generate approximately ${count} questions.`,
        "",
        "QUESTION TYPE INSTRUCTIONS",
        blocks
    ];

    if (includeMath) {
        lines.push("", "MATH / NUMERIC-HEAVY INSTRUCTION", 
            "Include math or numeric-heavy questions where relevant. Preserve equations, calculations, units, percentages, ratios, tables, and numerical data accurately. Do not replace a required calculation with a vague conceptual question.",
            "MATH WRITING FORMAT: write every formula in LaTeX. Inline math goes between single dollar signs, e.g. $x^2 + y^2 = r^2$ or $\\frac{a}{b}$; a separate equation line goes between double dollar signs, e.g. $$\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}$$. Never use the dollar sign for money (write Rs. or the rupee symbol instead), and do not use \\( \\) or \\[ \\] delimiters. Use only standard LaTeX that KaTeX supports: no chemistry \\ce{...} syntax, no custom \\newcommand macros, and no images of equations.");
    }

    // 2 languages = ONE block per question carrying both languages;
    // 1 language = plain single-language file.
    if (languages.length === 2) {
        lines.push(...buildMcqBilingualPromptLines_(languages[0], languages[1], collection));
    } else {
        if (collection) {
            lines.push("", `@collection: ${collection}`,
                "Put this @collection line on the FIRST question of this collection only. It carries forward to subsequent questions; do not repeat it on every question.");
        }
        lines.push(...buildMcqSourcePromptLines_(collection));
    }

    if (languages.length === 1 && languages[0] && languages[0].toLowerCase() !== "english") {
        lines.push("", `Add @language: ${languages[0]} to EACH question.`);
    }

    const originChoice = document.getElementById("mcq-origin")?.value.trim() || "";
    const ORIGIN_PROMPT_ = {
        pyq: "Every question in this file is copied from a REAL exam paper. Put @origin: pyq on the FIRST question only (it carries forward). Keep each question and its options exactly as printed — do not rewrite, improve or shorten them. @correct must come from the official answer key in the source; never guess an answer.",
        book: "Every question in this file comes from a book / coaching material, not from an exam paper. Put @origin: book on the FIRST question only (it carries forward).",
        ai: "Every question in this file is written by you (the AI). Put @origin: ai on the FIRST question only (it carries forward). Never label a question you wrote yourself as pyq. If a question is based on a real exam question whose ID I gave you, add @derived_from: <that mcq_id> on that question.",
        old: "Put @origin: old on the FIRST question only (it carries forward)."
    };
    if (ORIGIN_PROMPT_[originChoice]) {
        lines.push("", "ORIGIN", ORIGIN_PROMPT_[originChoice]);
    }

    if (tags.length) {
        lines.push("", `Add @tags: ${tags.join(", ")} to EACH question.`);
    }

    if (description) {
        lines.push("", `Use this description where appropriate: ${description}`);
    }

    lines.push("", 
        "GENERAL RULES",
        "- Every question must have @topic using the Study Topic ID above unless the source material explicitly requires a different, valid topic.",
        "- Every question must end with @end.",
        "- A genuinely required field must not be guessed. If source material does not support it, leave it out rather than fabricating it.",
        "- Keep question, option, correct answer, and explanation content faithful to the supplied source.",
        "- Number of options: normally 4. If the source question itself has 5 or 6 options (for example a 5th option \"None of these\"), keep exactly that many (5) and 6) lines) and give @why_5 / @why_6 too. Never invent extra options to pad a question, and never drop an option the source has.",
        "- @why_1 to @why_4 (and @why_5 / @why_6 when those options exist) must each explain THAT specific option: why it is correct, or why it is wrong and what it actually refers to. Keep each to 1-2 sentences.",
        "- Write @explanation and every @why_ note in the SAME language as the question.",
        "",
        "---",
        "FILE NAMING INSTRUCTION (for you, the human — not for the AI tool):",
        "Once the AI has generated the MCQ Markdown file, save it to Google Drive using EXACTLY this file name:",
        "",
        filename,
        "",
        'Then set that file\'s sharing to "Anyone with the link can view", copy its share link, and paste that link into the Google Drive .md link box on the website.'
    );

    return lines.join("\n");
}

function copyMcqAiPrompt() {
    const prompt = buildMcqAiPrompt();
    const done = () => alert("MCQ prompt copied! Paste it into ChatGPT, Claude, Gemini, or another AI tool with your source material.");
    const manual = () => alert("Could not copy automatically — please copy the prompt manually:\n\n" + prompt);

    if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(prompt)
            .then(done)
            .catch(() => fallbackCopyText(prompt, done, manual));
    } else {
        fallbackCopyText(prompt, done, manual);
    }
}

// PHASE 5 — tag autocomplete used to be built from the full-dump's
// sitewide `mcqs` list; now that the practice view only loads the
// current topic's MCQs, refresh it with a sitewide (unfiltered)
// get_mcqs call, but only when the Add MCQ popup is actually opened
// — not on every page load. Fire-and-forget: the popup renders
// immediately either way, suggestions just fill in once this resolves.
function refreshSitewideMcqTagSuggestions() {
    fetch(MCQ_GOOGLE_SHEET_API + "?action=get_mcqs")
        .then(response => response.ok ? response.json() : null)
        .then(data => {
            if (data && data.mcqs) {
                mcqTagSuggestions = buildMcqTagSuggestions(data.mcqs);
            }
        })
        .catch(error => console.warn("Tag suggestion refresh failed:", error));
}

// PHASE 8b — bilingual (English/हिन्दी) field guide shown in the
// popup's top-right "?" panel. Numbers/colors below match the
// numbered markers rendered next to each field in openAddMcqModal().
// "Include math" and "Tag format reference" have no field number of
// their own (math is part of point 8's row; the reference has
// nothing for the user to fill in), so they're folded into the
// neighbouring point's text instead of getting their own entry.
let mcqGuideActiveTab = "english"; // persists for the session only

// red = absolutely necessary, yellow = worth checking/adjusting,
// green = fine to leave as-is / fully optional. Point 2 (Collection
// name) is dynamic — its color is computed from the live field in
// mcqGuideColorClass() below, not from this static list.
const MCQ_GUIDE_COLORS = ["yellow", "red", "red", "green", "green", "green", "yellow", "red", "yellow", "green", "yellow", "green", "red"];

const MCQ_GUIDE_POINTS = [
    { en: "Import mode — choose Full Set/Paper for a whole paper/collection, or Individual MCQ for a single question. This decides whether Collection name is required.",
      hi: "Import mode — पूरे paper/collection के लिए Full Set/Paper चुनें, या सिर्फ़ एक question के लिए Individual MCQ चुनें। इसी से तय होता है कि Collection name ज़रूरी है या नहीं।" },
    { en: "Collection name — required only in Full Set/Paper mode. Name the paper/set (e.g. 'SSC CGL 2023 Tier 1'). Leave blank in Individual MCQ mode.",
      hi: "Collection name — सिर्फ़ Full Set/Paper mode में ज़रूरी है। Paper या set का नाम डालें (जैसे 'SSC CGL 2023 Tier 1')। Individual MCQ mode में इसे खाली छोड़ सकते हैं।" },
    { en: "Google Drive .md link — required. Paste the share link of your Markdown file; it must be set to 'Anyone with the link can view'.",
      hi: "Google Drive .md link — ज़रूरी है। अपनी Markdown file का share link paste करें; उसे 'Anyone with the link can view' पर set होना चाहिए।" },
    { en: "Description — optional. A short note about this collection or MCQ, used only as extra context.",
      hi: "Description — optional है। इस collection या MCQ के बारे में एक छोटा सा note, सिर्फ़ extra context के लिए इस्तेमाल होता है।" },
    { en: "Tags — optional. Search and select existing terms from the Index; new tags can't be created from here.",
      hi: "Tags — optional हैं। Index में मौजूद terms को search करके select करें; यहाँ से नया tag नहीं बनाया जा सकता।" },
    { en: "Study Topic — optional. Pick the tree node these MCQs belong to; used to build the suggested file name.",
      hi: "Study Topic — optional है। उस tree node को चुनें जिससे ये MCQs related हैं; इसी से suggested file name बनता है।" },
    { en: "How many languages? — choose 1 or 2. Choosing 2 adds a second Language dropdown; the AI prompt then asks for ONE block per question that carries both languages (@alt_question, @alt_options ...), so the practice page shows it as ONE question with a language toggle.",
      hi: "How many languages? — 1 या 2 चुन सकते हैं। 2 चुनने पर दूसरा Language dropdown आ जाता है; AI prompt तब हर question के लिए ONE block माँगता है जिसमें दोनों languages होती हैं (@alt_question, @alt_options ...), ताकि practice page पर वो एक ही question की तरह language-toggle के साथ दिखे।" },    { en: "Question type(s) — select which types (Simple, Assertion–Reasoning, Comprehension, Table/DI) the AI prompt should ask for; at least one is required. The same row has an optional 'Include math' checkbox for calculation-heavy questions.",
      hi: "Question type(s) — तय करें कि AI prompt किस type (Simple, Assertion–Reasoning, Comprehension, Table/DI) के questions माँगे; कम से कम एक type चुनना ज़रूरी है। इसी row में एक optional 'Include math' checkbox भी है, calculation-heavy questions के लिए।" },
    { en: "How many questions? — sets the approximate question count the AI prompt asks for.",
      hi: "How many questions? — इससे AI prompt में लगभग कितने questions चाहिए, वो number set होता है।" },
    { en: "Copy AI Prompt — builds the full prompt from everything above and copies it, ready to paste into an AI tool.",
      hi: "Copy AI Prompt — ऊपर की सारी settings से पूरा prompt बनाकर copy कर देता है, जिसे किसी AI tool में paste किया जा सकता है।" },
    { en: "Suggested file name — auto-generated from the selected Study Topic; copy it and use it exactly when saving the .md file to Drive. (Below it is a collapsible 'Tag format reference' — nothing to fill in, just a cheat-sheet of the @tag grammar.)",
      hi: "Suggested file name — selected Study Topic से auto-generate होता है; .md file को Drive पर save करते समय इसी नाम का इस्तेमाल करें। (इसके ठीक ऊपर एक collapsible 'Tag format reference' है — उसमें कुछ भरना नहीं है, बस @tag grammar की cheat-sheet है।)" },
    { en: "Origin and paper details — optional. Origin says honestly where the questions come from (Original PYQ only when you are sure). The paper's PDF link, website link/path, answer-key link and remark are saved once per paper in Collections. A missing detail is never an error: leave it blank, the AI must not guess it.",
      hi: "Origin और paper details — optional हैं। Origin सच-सच बताता है कि questions कहाँ से आए हैं (Original PYQ तभी चुनें जब पक्का हो)। Paper का PDF link, website link/path, answer-key link और remark हर paper के लिए Collections में एक बार save होते हैं। कोई detail न हो तो खाली छोड़ दें — यह कभी error नहीं है, और AI को उसका अंदाज़ा नहीं लगाना चाहिए।" },
    { en: "Fetch & Preview — required. Fetches the Drive file, parses it, and opens a preview before anything is saved to the sheet.",
      hi: "Fetch & Preview — ज़रूरी step है। Drive file को fetch करके parse करता है, और sheet में save होने से पहले एक preview खोलता है।" }
];

// Point 2 (index 1, "Collection name") is dynamic — it mirrors
// whatever the popup's Full Set/Individual toggle currently has set,
// so the guide never disagrees with the actual field.
function mcqGuideColorClass(i) {
    if (i === 1) {
        const required = document.getElementById("mcq-collection")?.required;
        return required ? "red" : "green";
    }
    return MCQ_GUIDE_COLORS[i] || "green";
}

function renderMcqGuideList() {
    const list = document.getElementById("mcq-guide-list");
    if (!list) return;
    list.innerHTML = MCQ_GUIDE_POINTS.map((p, i) =>
        `<li><strong class="mcq-num-${mcqGuideColorClass(i)}">${i + 1}.</strong> ${mcqEscapeHtml(mcqGuideActiveTab === "hindi" ? p.hi : p.en)}</li>`
    ).join("");
    document.getElementById("mcq-guide-tab-en")?.classList.toggle("primary", mcqGuideActiveTab === "english");
    document.getElementById("mcq-guide-tab-hi")?.classList.toggle("primary", mcqGuideActiveTab === "hindi");
}

// Opens on top of the still-open Add MCQ popup without closing it;
// closes via its own × or an outside (overlay) click, returning
// focus to the guide icon in the popup underneath.
function openMcqGuideModal() {
    document.getElementById("mcq-guide-modal")?.remove();

    const modal = document.createElement("div");
    modal.id = "mcq-guide-modal";
    modal.innerHTML = `
        <div class="add-resource-overlay" id="mcq-guide-overlay">
            <div class="add-resource-modal mcq-guide-modal">
                <button type="button" class="modal-close" id="mcq-guide-close">×</button>
                <h2>Field Guide</h2>
                <div class="resource-type-options" role="tablist" aria-label="Guide language">
                    <button type="button" id="mcq-guide-tab-en">English</button>
                    <button type="button" id="mcq-guide-tab-hi">हिन्दी</button>
                </div>
                <ol id="mcq-guide-list" class="mcq-guide-list"></ol>
            </div>
        </div>`;
    document.body.appendChild(modal);
    renderMcqGuideList();

    const closeGuide = () => {
        modal.remove();
        document.getElementById("mcq-guide-open")?.focus();
    };

    document.getElementById("mcq-guide-close").addEventListener("click", closeGuide);
    document.getElementById("mcq-guide-tab-en").addEventListener("click", () => {
        mcqGuideActiveTab = "english";
        renderMcqGuideList();
    });
    document.getElementById("mcq-guide-tab-hi").addEventListener("click", () => {
        mcqGuideActiveTab = "hindi";
        renderMcqGuideList();
    });
    document.getElementById("mcq-guide-overlay").addEventListener("click", e => {
        if (e.target.id === "mcq-guide-overlay") closeGuide();
    });
}

// PHASE 8b — makes the Full Set/Individual toggle's real effect
// visible: reactive label text + required attribute on Collection name.
function updateMcqCollectionRequirement(mode) {
    const label = document.getElementById("mcq-collection-label");
    const input = document.getElementById("mcq-collection");
    if (!label || !input) return;
    if (mode === "full") {
        label.innerHTML = `<span class="mcq-field-num mcq-num-red" id="mcq-field-num-2">2.</span> Collection name *`;
        input.required = true;
    } else {
        label.innerHTML = `<span class="mcq-field-num mcq-num-green" id="mcq-field-num-2">2.</span> Collection name (optional)`;
        input.required = false;
    }
}

function openAddMcqModal() {
    document.getElementById("add-mcq-modal")?.remove();
    refreshSitewideMcqTagSuggestions();

    const topic = currentMcqTopic || findFirstTopic(mcqStudyData.subjects);
    if (topic) currentMcqTopic = topic;

    const topicOptions = flattenMcqTopics(mcqStudyData.subjects).map(({ node, depth }) =>
        `<option value="${mcqEscapeHtml(node.id)}" ${node.id === topic?.id ? "selected" : ""}>${"&nbsp;".repeat(depth * 3)}${mcqEscapeHtml(node.title)}</option>`
    ).join("");

    const suggestedName = buildMcqSuggestedFileName(topic);

    const modal = document.createElement("div");
    modal.id = "add-mcq-modal";
    modal.innerHTML = `
        <div class="add-resource-overlay">
            <div class="add-resource-modal mcq-add-modal">
                <button type="button" class="modal-close mcq-guide-icon" id="mcq-guide-open" title="Guide" aria-label="Open field guide">?</button>
                <button type="button" class="modal-close" id="mcq-add-close">×</button>
                <h2>➕ Add MCQs</h2>
                <p class="add-resource-scope">Current topic: <strong>${mcqEscapeHtml(topic?.title || "Not selected")}</strong></p>
                <p class="drive-note" id="mcq-saved-note" hidden>↺ The values you used last time for this topic are filled in.
                    <button type="button" id="mcq-clear-saved" class="content-action">Clear saved values</button></p>

                <label class="mcq-field-label"><span class="mcq-field-num mcq-num-yellow">1.</span> Import mode</label>
                <div class="resource-type-options" role="group" aria-label="Import mode">
                    <button type="button" id="mcq-mode-full" class="primary">Full Set / Paper</button>
                    <button type="button" id="mcq-mode-individual">Individual MCQ</button>
                </div>
                <p class="drive-note">Mode is a view-only switch for now. Both modes use the same import pipeline.</p>

                <label for="mcq-collection" id="mcq-collection-label"><span class="mcq-field-num mcq-num-red" id="mcq-field-num-2">2.</span> Collection name *</label>
                <input id="mcq-collection" type="text" placeholder="e.g. UGC NET 2025 Paper II" required>

                <label for="mcq-origin"><span class="mcq-field-num mcq-num-red">2b.</span> Origin <small>(where do these questions really come from?)</small></label>
                <select id="mcq-origin">
                    <option value="">— Not set (will show as Old) —</option>
                    <option value="pyq">Real PYQ — copied from a real exam paper</option>
                    <option value="book">Book / coaching material</option>
                    <option value="ai">AI-made practice questions</option>
                    <option value="old">Old / not checked yet</option>
                </select>

                <label for="mcq-drive-link"><span class="mcq-field-num mcq-num-red">3.</span> Google Drive .md link *</label>
                <input id="mcq-drive-link" type="url" placeholder="https://drive.google.com/file/d/.../view or a folder link">
                <div class="content-action-row">
                    <button type="button" id="mcq-open-folder" class="content-action">📁 Open/Create this topic's MCQ folder</button>
                </div>
                <p class="drive-note">A single .md file link works as before. You can also paste this
                    topic's <strong>MCQ folder</strong> link (use the button above to open/create it) and
                    drop in one or several .md files — every .md in that folder is fetched and merged
                    together, so future papers just mean adding another .md file to the same folder.
                    Either way, the file(s) must be shared as <strong>"Anyone with the link can view"</strong>.</p>

                <details class="mcq-source-details" style="margin:8px 0 12px;">
                    <summary><span class="mcq-field-num mcq-num-green">3b.</span> Paper source details <small>(all optional — you can add them later)</small></summary>
                    <label for="mcq-pdf-url">Original PDF link(s) (Drive) <small>— for several write: link Label || link Label</small></label>
                    <textarea id="mcq-pdf-url" rows="2" placeholder="https://drive.google.com/file/d/.../view English PDF || https://drive.google.com/file/d/.../view Hindi PDF"></textarea>
                    <label for="mcq-source-url">Source website link</label>
                    <input id="mcq-source-url" type="url" placeholder="https://...">
                    <label for="mcq-source-path">Source path</label>
                    <input id="mcq-source-path" type="text" placeholder="e.g. Demo Site > STET > 2025 > Paper II">
                    <label for="mcq-answer-key-url">Answer key link</label>
                    <input id="mcq-answer-key-url" type="url" placeholder="https://...">
                    <label for="mcq-paper-remark">Paper remark</label>
                    <textarea id="mcq-paper-remark" rows="2" placeholder="Optional note about this paper"></textarea>
                    <p class="drive-note">None of these are needed to fetch the questions. Only full http(s) links are accepted.
                        A blank field never erases something already saved for the paper.</p>
                    <p id="mcq-source-msg" class="drive-note" style="color:#b00020" hidden></p>
                </details>

                <label for="mcq-description"><span class="mcq-field-num mcq-num-green">4.</span> Description</label>
                <textarea id="mcq-description" rows="2" placeholder="Optional description"></textarea>

                <label><span class="mcq-field-num mcq-num-green">5.</span> Tags <small>(optional — select from the Index)</small></label>
                <div id="mcq-tag-chips" class="mcq-tag-chip-wrap"></div>
                <div style="position:relative">
                    <input id="mcq-tag-input" type="text" placeholder="Search existing index terms...">
                    <div id="mcq-tag-suggestions" class="drive-note" hidden></div>
                </div>

                <label for="mcq-study-topic"><span class="mcq-field-num mcq-num-green">6.</span> Study Topic</label>
                <select id="mcq-study-topic">
                    <option value="">— Optional —</option>
                    ${topicOptions}
                </select>

                <label for="mcq-lang-count"><span class="mcq-field-num mcq-num-yellow">7.</span> How many languages?</label>
                <select id="mcq-lang-count">
                    ${[1, 2].map(n =>
                        `<option value="${n}" ${n === 1 ? "selected" : ""}>${n}</option>`).join("")}
                </select>
                <div id="mcq-lang-select-row" class="mcq-lang-select-row"></div>

                <label><span class="mcq-field-num mcq-num-red">8.</span> Question type(s) to include in the prompt</label>
                <div id="mcq-type-options" class="resource-type-options">
                    <label><input type="checkbox" value="simple" checked> Simple</label>
                    <label><input type="checkbox" value="assertion_reason"> Assertion–Reasoning</label>
                    <label><input type="checkbox" value="comprehension"> Comprehension</label>
                    <label><input type="checkbox" value="table"> Table/DI</label>
                    <label><input id="mcq-include-math" type="checkbox"> Include math</label>
                </div>
                <div class="mcq-math-hint" style="font-size:0.85em;line-height:1.45;margin:6px 0 10px;padding:8px 10px;border-left:3px solid #b8860b;background:rgba(184,134,11,0.08);border-radius:4px;">
                    <strong>Math &amp; passage tips</strong><br>
                    • Write formulas as $...$ (inline) or $$...$$ (own line).<br>
                    • Never use $ for money — write ₹ or Rs. instead.<br>
                    • Only standard LaTeX that KaTeX supports will show. Chemistry \\ce{...}, custom macros (\\newcommand) and equation images will not.<br>
                    • Passage ids must be unique across ALL files (e.g. ugcnet-jun2025-p1). Reusing p001 in another file overwrites the earlier passage.
                </div>

                <label for="mcq-question-count"><span class="mcq-field-num mcq-num-yellow">9.</span> How many questions?</label>
                <input id="mcq-question-count" type="number" min="1" value="10">

                <div class="content-action-row">
                    <button type="button" id="mcq-copy-prompt" class="content-action"><span class="mcq-field-num mcq-num-green">10.</span> 📋 Copy AI Prompt</button>
                </div>

                <details class="content-link-guide">
                    <summary>Tag format reference</summary>
                    <pre class="content-link-guide-body">${mcqEscapeHtml(`@collection: Collection Name
@origin: pyq | book | ai | old (carries forward — put it once on the first question)
@derived_from: mcq_id (optional — for AI-made questions: the real question it was based on)
@question_no: 1
@type: simple | assertion_reason
@topic: node_id
@passage: p001
@question: Question text
@assertion: Assertion text
@reason: Reason text
@options:
1) Option 1
2) Option 2
3) Option 3
4) Option 4
5) Option 5 (optional — only if the question has a 5th option)
6) Option 6 (optional — only if the question has a 6th option)
@correct: 1 (1 to 6 = number of the correct option)
@explanation: Explanation
@why_1: Why option 1 is right/wrong
@why_2: Why option 2 is right/wrong
@why_3: Why option 3 is right/wrong
@why_4: Why option 4 is right/wrong
@why_5: Why option 5 is right/wrong (optional)
@why_6: Why option 6 is right/wrong (optional)
@difficulty: easy | medium | hard
@language: en | hi | Hinglish | Mixed
@tags: tag1, tag2
@description: Description
@exam: UGC NET
@year: 2025
@session: June
@source: Source name
@source_question_no: 12
@source_qid: 80123 (paper's own Question ID — leave out if the source has none)
@source_page: 4 (optional)
@source_path: Site > Exam > 2025 > Paper II (paper header, first question only — optional)

--- BILINGUAL ONE BLOCK (2 languages, ONE question = ONE row) ---
@language: English
@alt_language: Hindi
@source_question_no: 101 (number printed in the English PDF)
@alt_source_question_no: 129 (number printed in the Hindi PDF)
@alt_source_qid / @alt_source_page: only if the Hindi PDF prints a different ID / page
@question: English question
@options: (1-4, same count and order as @alt_options)
@alt_question: Hindi question
@alt_options: (1-4, same count and order as @options)
@correct: 2 (one shared answer)
@explanation: English explanation
@alt_explanation: Hindi explanation
@why_1 ... @why_6 / @alt_why_1 ... @alt_why_6 (optional)
@alt_assertion / @alt_reason (assertion_reason: Hindi side)
@alt_passage_text: (inside a @passage block, before @end_passage)
@end`)}</pre>
                </details>

                <label for="mcq-suggested-filename"><span class="mcq-field-num mcq-num-yellow">11.</span> Suggested file name</label>
                <div class="content-action-row">
                    <input id="mcq-suggested-filename" type="text" readonly value="${mcqEscapeHtml(suggestedName)}">
                    <button type="button" id="mcq-copy-name" class="content-action">📋 Copy Name</button>
                </div>

                <button class="resource-submit-btn" type="button" id="mcq-fetch-preview"><span class="mcq-field-num mcq-num-red">12.</span> Fetch &amp; Preview</button>
            </div>
        </div>`;

    document.body.appendChild(modal);

    document.getElementById("mcq-add-close").addEventListener("click", closeAddMcqModal);
    document.getElementById("mcq-guide-open").addEventListener("click", openMcqGuideModal);
    document.getElementById("mcq-copy-prompt").addEventListener("click", copyMcqAiPrompt);
    document.getElementById("mcq-copy-name").addEventListener("click", copyMcqSuggestedName);
    document.getElementById("mcq-fetch-preview").addEventListener("click", submitAddMcq);
    document.getElementById("mcq-open-folder").addEventListener("click", openTopicMcqFolder);

    document.getElementById("mcq-study-topic").addEventListener("change", e => {
        const selected = findTopic(mcqStudyData.subjects, e.target.value);
        if (selected) {
            currentMcqTopic = selected;
            document.getElementById("mcq-suggested-filename").value = buildMcqSuggestedFileName(selected);
            const scope = modal.querySelector(".add-resource-scope strong");
            if (scope) scope.textContent = selected.title;
        }
    });

    // PHASE 8a — renders exactly 1 language dropdown by default; the
    // "How many languages?" select adds/removes dropdowns from there.
    renderMcqLanguageSelects(1);
    document.getElementById("mcq-lang-count").addEventListener("change", e => {
        renderMcqLanguageSelects(e.target.value);
    });

    // PHASE 8a — selection-only: Enter/comma no longer creates a
    // free-typed tag. It only confirms the top matching Index_Terms
    // suggestion, if one is showing; typing with no match does nothing.
    const tagInput = document.getElementById("mcq-tag-input");
    tagInput.addEventListener("input", () => renderMcqTagSuggestions(tagInput.value));
    tagInput.addEventListener("focus", () => renderMcqTagSuggestions(tagInput.value));
    tagInput.addEventListener("keydown", e => {
        if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            const topMatch = getMcqIndexTermSuggestions(tagInput.value)
                .find(tag => !getMcqTagChips().some(x => x.toLowerCase() === tag.toLowerCase()));
            if (topMatch) addMcqTagChip(topMatch);
            tagInput.value = "";
            renderMcqTagSuggestions("");
        }
    });

    // PHASE 8b — fix: the tag suggestions dropdown previously never
    // closed on outside click. Bind once per modal-open, unbind on
    // close so repeated opens don't stack duplicate listeners.
    bindMcqTagOutsideClick();

    const modeFull = document.getElementById("mcq-mode-full");
    const modeIndividual = document.getElementById("mcq-mode-individual");
    updateMcqCollectionRequirement("full"); // "Full Set / Paper" is the default active mode
    modeFull.addEventListener("click", () => {
        modeFull.classList.add("primary");
        modeIndividual.classList.remove("primary");
        updateMcqCollectionRequirement("full");
    });
    modeIndividual.addEventListener("click", () => {
        modeIndividual.classList.add("primary");
        modeFull.classList.remove("primary");
        updateMcqCollectionRequirement("individual");
    });

    // Fill in what was used last time for this topic (if anything).
    restoreMcqAddForm_();
}

// REMEMBER THE FORM — the "Add MCQs" boxes are saved in this browser (localStorage)
// per topic, right after a successful Fetch & Preview, and filled in again the next
// time this topic's Add MCQs window opens. Nothing is sent to the server.
const MCQ_ADDFORM_KEY_ = "na_mcq_addform_v1";
const MCQ_ADDFORM_FIELDS_ = [
    "mcq-collection", "mcq-origin", "mcq-drive-link", "mcq-pdf-url", "mcq-source-url",
    "mcq-source-path", "mcq-answer-key-url", "mcq-paper-remark", "mcq-description",
    "mcq-question-count"
];

function mcqAddFormTopicKey_() {
    return String(currentMcqTopic?.id || "_none");
}

function saveMcqAddForm_() {
    try {
        const data = {};
        MCQ_ADDFORM_FIELDS_.forEach(id => {
            const el = document.getElementById(id);
            if (el) data[id] = el.value;
        });
        data.mode = document.getElementById("mcq-mode-individual")?.classList.contains("primary") ? "individual" : "full";
        data.langCount = document.getElementById("mcq-lang-count")?.value || "1";
        data.langs = Array.from(document.querySelectorAll(".mcq-lang-select")).map(s => s.value);
        data.types = Array.from(document.querySelectorAll("#mcq-type-options input[type=checkbox]"))
            .filter(c => c.checked).map(c => c.id || c.value);
        const all = JSON.parse(localStorage.getItem(MCQ_ADDFORM_KEY_) || "{}");
        all[mcqAddFormTopicKey_()] = data;
        localStorage.setItem(MCQ_ADDFORM_KEY_, JSON.stringify(all));
    } catch (err) {
        console.warn("Could not remember the Add MCQs form:", err);
    }
}

function restoreMcqAddForm_() {
    let data = null;
    try {
        data = (JSON.parse(localStorage.getItem(MCQ_ADDFORM_KEY_) || "{}"))[mcqAddFormTopicKey_()] || null;
    } catch (err) { data = null; }
    if (!data) return;

    MCQ_ADDFORM_FIELDS_.forEach(id => {
        const el = document.getElementById(id);
        if (el && data[id] !== undefined) el.value = data[id];
    });
    if (data.mode === "individual") document.getElementById("mcq-mode-individual")?.click();

    const countEl = document.getElementById("mcq-lang-count");
    if (countEl && data.langCount) {
        countEl.value = data.langCount;
        renderMcqLanguageSelects(countEl.value);
    }
    Array.from(document.querySelectorAll(".mcq-lang-select")).forEach((sel, i) => {
        if (data.langs && data.langs[i]) sel.value = data.langs[i];
    });
    if (Array.isArray(data.types)) {
        document.querySelectorAll("#mcq-type-options input[type=checkbox]").forEach(c => {
            c.checked = data.types.includes(c.id || c.value);
        });
    }

    const note = document.getElementById("mcq-saved-note");
    if (note) note.hidden = false;
    document.getElementById("mcq-clear-saved")?.addEventListener("click", () => {
        try {
            const all = JSON.parse(localStorage.getItem(MCQ_ADDFORM_KEY_) || "{}");
            delete all[mcqAddFormTopicKey_()];
            localStorage.setItem(MCQ_ADDFORM_KEY_, JSON.stringify(all));
        } catch (err) { /* ignore */ }
        openAddMcqModal(); // reopens with empty boxes
    });
}

function copyMcqSuggestedName() {
    const box = document.getElementById("mcq-suggested-filename");
    if (!box) return;
    const done = () => alert("File name copied!");
    const manual = () => {
        box.select();
        alert("Could not copy automatically — the name is now selected. Press Ctrl+C / Cmd+C to copy it.");
    };
    if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(box.value).then(done).catch(manual);
    } else {
        manual();
    }
}

// PHASE 8b — outside-click handler for the tag suggestions dropdown.
// Kept as a module-level reference so it can be removed cleanly
// (bindMcqTagOutsideClick re-binds on every modal open; closeAddMcqModal
// unbinds it) instead of piling up a new document listener each time.
let mcqTagOutsideClickHandler_ = null;

function bindMcqTagOutsideClick() {
    if (mcqTagOutsideClickHandler_) {
        document.removeEventListener("click", mcqTagOutsideClickHandler_);
    }
    mcqTagOutsideClickHandler_ = function (e) {
        const box = document.getElementById("mcq-tag-suggestions");
        const input = document.getElementById("mcq-tag-input");
        if (!box || !input) return;
        if (box.hidden) return;
        if (!box.contains(e.target) && !input.contains(e.target)) {
            box.hidden = true;
        }
    };
    document.addEventListener("click", mcqTagOutsideClickHandler_);
}

function closeAddMcqModal() {
    document.getElementById("add-mcq-modal")?.remove();
    if (mcqTagOutsideClickHandler_) {
        document.removeEventListener("click", mcqTagOutsideClickHandler_);
        mcqTagOutsideClickHandler_ = null;
    }
}

// ALPHA-PLUS — MCQ LINK: folder mode (multiple .md files).
// Uses the get_mcq_source action (Code.gs handleGetMcqSource_), which —
// unlike Content's get_markdown — always returns an ARRAY of files: one
// entry for a single-file link, or one entry per .md file when the link
// points at a Drive FOLDER (e.g. this topic's auto-created "MCQ"
// subfolder, see openTopicMcqFolder() below). Each file's raw text is
// parsed separately by parseMcqMarkdown() and the results are merged in
// submitAddMcq(), so a folder that accumulates several papers over time
// just means every .md in it gets picked up on the next fetch.
async function fetchMcqSourceFiles(ref) {
    const url = `${MCQ_GOOGLE_SHEET_API}?action=get_mcq_source&ref=${encodeURIComponent(ref)}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not fetch the Drive source (${response.status}).`);
    const result = await response.json();
    if (!result?.ok) throw new Error(result?.error || "Could not read the Drive Markdown file(s).");
    const files = Array.isArray(result.files) ? result.files : [];
    if (!files.length) throw new Error("No .md file content was returned.");
    return files;
}

function isMcqFatal(row) {
    const warnings = row.warnings || [];
    const text = warnings.join(" | ").toLowerCase();
    // 2 to 6 options are allowed, but they must be continuous (no empty
    // option in the middle) and @correct must point at one of them.
    const optList = [
        row.option_a, row.option_b, row.option_c,
        row.option_d, row.option_e, row.option_f
    ].map(o => String(o || "").trim());
    let optCount = optList.length;
    while (optCount > 0 && !optList[optCount - 1]) optCount--;
    const optGap = optList.slice(0, optCount).some(o => !o);
    return !row.question || optCount < 2 || optGap ||
        !/^[1-6]$/.test(String(row.correct_option)) ||
        Number(row.correct_option) > optCount ||
        text.includes("missing @question") ||
        text.includes("missing @options") ||
        text.includes("missing @correct");
}

function resolveMcqTopicTitle(nodeId) {
    const node = findTopic(mcqStudyData.subjects, nodeId);
    return node ? node.title : "";
}

function applyMcqPopupDefaults(parsed) {
    const collection = document.getElementById("mcq-collection")?.value.trim() || "";
    const description = document.getElementById("mcq-description")?.value.trim() || "";
    // PHASE 8a — only fall back to a default @language when exactly
    // one non-English language was selected; with N>=2 the AI prompt
    // already instructs an explicit @language per block, so guessing
    // a single default here would be wrong.
    const selectedLanguages = getMcqSelectedLanguages();
    const language = (selectedLanguages.length === 1 && selectedLanguages[0].toLowerCase() !== "english")
        ? selectedLanguages[0] : "";
    const topic = document.getElementById("mcq-study-topic")?.value.trim() || "";
    const tags = getMcqTagChips().join(", ");
    const originDefault = document.getElementById("mcq-origin")?.value.trim() || "";

    parsed.mcqs.forEach(row => {
        // A question's own @origin always wins; the form choice only fills
        // the gaps. If neither is set the question is saved without an
        // origin and shows as "Old" — flagged here so it is not a surprise.
        if (!row.origin && originDefault) row.origin = originDefault;
        if (!row.origin) {
            row.warnings = (row.warnings || []).concat("no origin set (choose Origin in the form or add @origin:) — will show as Old");
        }
        if (!row.collection_id_ref && collection) row.collection_id_ref = collection;
        if (!row.tags && tags) row.tags = tags;
        if (!row.language && language) row.language = language;
        if (!row.node_id && topic) row.node_id = topic;
        if (!row.description && description) row.description = description;
    });

    // Preserve collection metadata supplied by the popup as a fallback.
    if (collection) {
        const existing = parsed.collections.find(c => c.title === collection);
        if (existing) {
            if (!existing.description && description) existing.description = description;
        } else {
            parsed.collections.push({
                title: collection,
                description: description,
                exam: "",
                year: "",
                session: "",
                source: ""
            });
        }
    }
    return parsed;
}

// ONE-ROW BILINGUAL (Phase 3) — readable warning lines for the preview:
// paper-level lines first, then per-question ones (repeats are grouped).
function buildMcqWarningLines_(parsed) {
    const lines = (parsed.warnings || []).slice();
    const groups = new Map();
    (parsed.mcqs || []).forEach((row, i) => {
        (row.warnings || []).forEach(w => {
            let text = String(w);
            const m = text.match(/@alt_options has (\d+) options but @options has (\d+)/);
            if (m) {
                text = `${row.alt_language || "Second language"} has ${m[1]} options, ${row.language || "first language"} has ${m[2]} — both must have the same options in the same order`;
            }
            const key = (m ? "IMPORTANT|" : "") + text;
            if (!groups.has(key)) groups.set(key, { text, important: !!m, nos: [] });
            groups.get(key).nos.push(row.question_no || (i + 1));
        });
    });
    groups.forEach(g => {
        if (g.important || g.nos.length === 1) {
            g.nos.forEach(n => lines.push(`Q${n}: ${g.text}`));
        } else {
            lines.push(`${g.nos.length} questions: ${g.text}`);
        }
    });
    return lines;
}

function renderMcqPreviewNotes_(parsed) {
    const box = document.getElementById("mcq-preview-notes");
    if (!box) return;
    const parts = [];

    const bilingual = (parsed.mcqs || []).filter(r => r.question_alt);
    if (bilingual.length) {
        const labels = Array.from(new Set(bilingual.map(r => `${r.language || "en"} + ${r.alt_language || "?"}`)));
        parts.push(`<div>📚 <strong>${parsed.mcqs.length} questions</strong> — one row each · ${mcqEscapeHtml(labels.join(", "))}</div>`);
    }

    const lines = buildMcqWarningLines_(parsed);
    if (lines.length) {
        const shown = lines.slice(0, 15).map(l => `<li>${mcqEscapeHtml(l)}</li>`).join("");
        const more = lines.length > 15 ? `<li>…and ${lines.length - 15} more</li>` : "";
        parts.push(`<div class="mcq-preview-warning">⚠ Warnings (saving is not blocked):<ul style="margin:4px 0 0 18px;">${shown}${more}</ul></div>`);
    }

    const cols = parsed.collections || [];
    if (cols.length && !cols.some(c => c.pdf_url)) {
        parts.push(`<div>ℹ️ No PDF link given — you can add it later in Paper info.</div>`);
    }
    if (cols.length > 1 && cols.some(c => c.pdf_url || c.source_url || c.answer_key_url)) {
        parts.push(`<div>ℹ️ This import has ${cols.length} collections — the links typed in the popup will be saved on every one of them.</div>`);
    }

    box.innerHTML = parts.join("");
}

function renderMcqPreviewModal(parsed) {
    mcqPreviewRows = parsed.mcqs.map((row, index) => ({
        row,
        index,
        fatal: isMcqFatal(row),
        checked: !isMcqFatal(row)
    }));

    document.getElementById("mcq-preview-modal")?.remove();
    const modal = document.createElement("div");
    modal.id = "mcq-preview-modal";
    modal.innerHTML = `
        <div class="add-resource-overlay">
            <div class="add-resource-modal mcq-preview-modal">
                <button type="button" class="modal-close" id="mcq-preview-close">×</button>
                <h2>MCQ Import Preview</h2>
                <p class="add-resource-scope" id="mcq-preview-count"></p>
                <div id="mcq-preview-notes" class="drive-note"></div>
                <div class="mcq-preview-table-wrap">
                    <table class="mcq-preview-table">
                        <thead><tr>
                            <th>✓</th><th>Topic</th><th>Collection</th><th>Type</th><th>Lang</th><th>Question</th><th>Status</th>
                        </tr></thead>
                        <tbody id="mcq-preview-body"></tbody>
                    </table>
                </div>
                <div class="content-action-row">
                    <button class="resource-submit-btn" type="button" id="mcq-confirm-save">Confirm & Save All</button>
                </div>
            </div>
        </div>`;

    document.body.appendChild(modal);
    document.getElementById("mcq-preview-close").addEventListener("click", () => modal.remove());
    renderMcqPreviewNotes_(parsed);

    const body = document.getElementById("mcq-preview-body");
    body.innerHTML = mcqPreviewRows.map(item => {
        const row = item.row;
        const topicTitle = resolveMcqTopicTitle(row.node_id);
        const topicDisplay = topicTitle
            ? mcqEscapeHtml(topicTitle)
            : `<span class="mcq-preview-unknown">⚠ unknown topic</span>`;
        const warnings = row.warnings || [];
        const status = item.fatal
            ? `<span class="mcq-preview-fatal" title="${mcqEscapeHtml(warnings.join("; ") || "Required field missing")}">❌ ${mcqEscapeHtml(warnings.join("; ") || "Required field missing")}</span>`
            : warnings.length
                ? `<span class="mcq-preview-warning" title="${mcqEscapeHtml(warnings.join("; "))}">⚠ ${mcqEscapeHtml(warnings.join("; "))}</span>`
                : `<span>✅ Ready</span>`;
        const question = String(row.question || "").replace(/\s+/g, " ").trim();
        const langDisplay = row.question_alt
            ? `${mcqEscapeHtml(row.language || "en")} + ${mcqEscapeHtml(row.alt_language || "?")}`
            : mcqEscapeHtml(row.language || "en");
        return `<tr>
            <td><input type="checkbox" class="mcq-preview-check" data-index="${item.index}" ${item.checked ? "checked" : ""} ${item.fatal ? "" : ""}></td>
            <td>${topicDisplay}</td>
            <td>${mcqEscapeHtml(row.collection_id_ref || "")}</td>
            <td>${mcqEscapeHtml(row.question_type || "simple")}</td>
            <td>${langDisplay}</td>
            <td title="${mcqEscapeHtml(row.question || "")}">${mcqEscapeHtml(question.length > 100 ? question.slice(0, 100) + "…" : question)}</td>
            <td>${status}</td>
        </tr>`;
    }).join("");

    function updatePreviewCount() {
        const checks = Array.from(document.querySelectorAll(".mcq-preview-check"));
        const checked = checks.filter(c => c.checked).length;
        const flagged = mcqPreviewRows.filter(x => x.fatal || (x.row.warnings || []).length).length;
        const count = document.getElementById("mcq-preview-count");
        if (count) count.textContent = `${checked} of ${mcqPreviewRows.length} questions ready to import (${flagged} flagged)`;
        const save = document.getElementById("mcq-confirm-save");
        if (save) save.disabled = checked === 0;
    }

    body.querySelectorAll(".mcq-preview-check").forEach(check => {
        check.addEventListener("change", updatePreviewCount);
    });

    updatePreviewCount();
    document.getElementById("mcq-confirm-save").addEventListener("click", confirmSaveMcqs);
}

// ALPHA-PLUS — MCQ LINK: opens (creating if needed) this topic's
// auto-created "MCQ" Drive subfolder — same on-demand pattern as
// js/app.js's openTopicDriveFolder() for the Content folder, just
// reading mcq_folder_url instead of drive_folder_url from the same
// get_or_create_node_folder response (Code.gs now returns both).
// Also fills the .md link field with that folder's URL so the user can
// come straight back and click "Fetch & Preview" after dropping in
// their .md file(s), without retyping/pasting the link.
async function openTopicMcqFolder() {
    const topic = currentMcqTopic;
    if (!topic) {
        alert("Please choose a Study Topic first (field 6).");
        return;
    }

    const btn = document.getElementById("mcq-open-folder");
    if (btn) { btn.disabled = true; btn.textContent = "Opening…"; }

    try {
        const url = `${MCQ_GOOGLE_SHEET_API}?action=get_or_create_node_folder&node_id=${encodeURIComponent(topic.id)}&_=${Date.now()}`;
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) throw new Error(`Folder API failed (${response.status})`);

        const data = await response.json();
        if (!data || !data.mcq_folder_url) {
            throw new Error(data?.error || "MCQ folder URL was not returned.");
        }

        const linkInput = document.getElementById("mcq-drive-link");
        if (linkInput && !linkInput.value.trim()) linkInput.value = data.mcq_folder_url;

        window.open(data.mcq_folder_url, "_blank", "noopener,noreferrer");
    } catch (error) {
        console.error("Open MCQ folder failed:", error);
        alert("Could not open/create this topic's MCQ folder. Please check the Apps Script Drive authorization.");
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = "📁 Open/Create this topic's MCQ folder"; }
    }
}

// ONE-ROW BILINGUAL (Phase 3) — optional paper-level source details typed in the
// popup. All optional; only the http(s) check can stop the fetch, never an empty field.
const MCQ_SOURCE_URL_FIELDS_ = [
    { id: "mcq-pdf-url", key: "pdf_url", label: "Original PDF link" },
    { id: "mcq-source-url", key: "source_url", label: "Source website link" },
    { id: "mcq-answer-key-url", key: "answer_key_url", label: "Answer key link" }
];

function readMcqSourceInputs_() {
    const values = {};
    let error = "";
    let errorId = "";
    MCQ_SOURCE_URL_FIELDS_.forEach(field => {
        let v = (document.getElementById(field.id)?.value || "").trim();
        if (field.key === "pdf_url") {
            // one link, or several: "link Label || link Label"
            if (v) {
                const parts = mcqParsePdfLinks_(v);
                if (!parts.length || parts.some(p => !/^https?:\/\/\S+$/i.test(p.url))) {
                    if (!error) {
                        error = field.label + ": every link must start with http:// or https:// (separate several with ||). Leave it blank if you do not have it.";
                        errorId = field.id;
                    }
                } else {
                    v = parts.map(p => p.label ? p.url + " " + p.label : p.url).join(" || ");
                }
            }
        } else if (v && !/^https?:\/\/\S+$/i.test(v) && !error) {
            error = field.label + ": only a full link starting with http:// or https:// is accepted. Leave it blank if you do not have it.";
            errorId = field.id;
        }
        values[field.key] = v;
    });
    values.source_path = (document.getElementById("mcq-source-path")?.value || "").trim();
    values.remark = (document.getElementById("mcq-paper-remark")?.value || "").trim();
    return { values, error, errorId };
}

// Modal values are put on every collection of this import. A blank modal field
// changes nothing, so a value from the .md header (e.g. @source_path) is kept.
function applyMcqSourceInputs_(parsed, values) {
    (parsed.collections || []).forEach(c => {
        ["pdf_url", "source_url", "answer_key_url", "source_path", "remark"].forEach(key => {
            if (values[key]) c[key] = values[key];
        });
    });
}

async function submitAddMcq() {
    // PHASE 8b — Collection name's required-ness is reactive to the
    // Full Set/Individual toggle (updateMcqCollectionRequirement());
    // this button isn't a real <form> submit, so enforce it manually.
    const collectionInput = document.getElementById("mcq-collection");
    if (collectionInput && collectionInput.required && !collectionInput.value.trim()) {
        alert("Please enter a Collection name (required in Full Set / Paper mode).");
        collectionInput.focus();
        return;
    }

    const ref = document.getElementById("mcq-drive-link")?.value.trim();
    if (!ref) {
        alert("Please paste a Google Drive link to the .md file.");
        return;
    }

    const sourceInputs = readMcqSourceInputs_();
    const sourceMsg = document.getElementById("mcq-source-msg");
    if (sourceMsg) { sourceMsg.hidden = true; sourceMsg.textContent = ""; }
    if (sourceInputs.error) {
        if (sourceMsg) { sourceMsg.textContent = "⚠ " + sourceInputs.error; sourceMsg.hidden = false; }
        const box = document.querySelector("#add-mcq-modal .mcq-source-details");
        if (box) box.open = true;
        document.getElementById(sourceInputs.errorId)?.focus();
        return;
    }

    const btn = document.getElementById("mcq-fetch-preview");
    if (btn) { btn.disabled = true; btn.textContent = "Fetching…"; }

    try {
        if (typeof window.parseMcqMarkdown !== "function") {
            throw new Error("MCQ parser is not loaded. Please refresh the page.");
        }
        // Folder mode may return several .md files (one per paper); parse
        // each on its own — parseMcqMarkdown()'s own per-file id/counter
        // logic stays correct that way — then merge everything together.
        // Cross-file duplicate mcq_id/passage_id (unlikely, but possible if
        // two files reuse the same collection name) resolves the same way
        // save_mcqs_bulk already resolves any duplicate: last one kept.
        const files = await fetchMcqSourceFiles(ref);
        const merged = { collections: [], passages: [], mcqs: [], warnings: [] };
        const collectionTitlesSeen = new Set();
        const passageIdsSeen = new Set();
        files.forEach(file => {
            const parsed = window.parseMcqMarkdown(String(file.content || ""));
            (parsed.collections || []).forEach(c => {
                if (collectionTitlesSeen.has(c.title)) return;
                collectionTitlesSeen.add(c.title);
                merged.collections.push(c);
            });
            (parsed.passages || []).forEach(p => {
                if (p.passage_id && passageIdsSeen.has(p.passage_id)) return;
                if (p.passage_id) passageIdsSeen.add(p.passage_id);
                merged.passages.push(p);
            });
            merged.mcqs.push(...(parsed.mcqs || []));
            merged.warnings.push(...(parsed.warnings || []));
        });

        window.__mcqLastParsedPassages = merged.passages;
        applyMcqPopupDefaults(merged);
        applyMcqSourceInputs_(merged, sourceInputs.values);
        window.__mcqLastParsedCollections = merged.collections;

        if (!merged.mcqs.length) {
            throw new Error(files.length > 1
                ? `No question blocks were found across the ${files.length} .md files in that folder.`
                : "No question blocks were found in this Markdown file.");
        }

        saveMcqAddForm_();
        closeAddMcqModal();
        renderMcqPreviewModal(merged);
    } catch (error) {
        console.error("MCQ import preview failed:", error);
        alert(error.message || "Could not fetch or parse the Markdown file.");
        if (btn) { btn.disabled = false; btn.textContent = "Fetch & Preview"; }
    }
}

async function confirmSaveMcqs() {
    const checks = Array.from(document.querySelectorAll(".mcq-preview-check:checked"));
    const selected = checks.map(c => mcqPreviewRows[Number(c.dataset.index)].row);
    if (!selected.length) return;

    const btn = document.getElementById("mcq-confirm-save");
    if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }

    const selectedIds = new Set(selected.map(row => row.mcq_id));
    const collections = [];
    const collectionSeen = new Set();
    selected.forEach(row => {
        const title = String(row.collection_id_ref || "").trim();
        if (!title || collectionSeen.has(title)) return;
        collectionSeen.add(title);
        const source = (mcqPreviewRows.find(x => x.row === row)?.row) || row;
        const parsedCol = (window.__mcqLastParsedCollections || []).find(c => c.title === title) || {};
        collections.push({
            title,
            description: row.description || "",
            exam: row.exam || "",
            year: row.year || "",
            session: row.session || "",
            source: row.source || "",
            // one-row bilingual: paper-level source details (blank = backend keeps what is saved)
            pdf_url: parsedCol.pdf_url || "",
            source_url: parsedCol.source_url || "",
            answer_key_url: parsedCol.answer_key_url || "",
            source_path: parsedCol.source_path || "",
            remark: parsedCol.remark || ""
        });
    });

    const passages = [];
    const passageIds = new Set(selected.map(r => r.passage_id).filter(Boolean));
    // Passage payload is taken from the source parse when available.
    // Rebuild from preview selection is intentionally conservative.
    const parsedPassages = window.__mcqLastParsedPassages || [];
    parsedPassages.forEach(p => {
        if (passageIds.has(p.passage_id)) passages.push(p);
    });

    const payload = {
        action: "save_mcqs_bulk",
        collections,
        passages,
        mcqs: selected
    };

    try {
        await fetch(MCQ_GOOGLE_SHEET_API, {
            method: "POST",
            mode: "no-cors",
            body: JSON.stringify(payload)
        });

        const added = selected.filter(r => !r.mcq_id || !mcqApiData.mcqs?.some(x => String(x.mcq_id) === String(r.mcq_id))).length;
        const updated = selected.length - added;

        document.getElementById("mcq-preview-modal")?.remove();
        alert(`${added} questions added, ${updated} updated.`);

        // Refresh practice data when the current topic is affected.
        if (selected.some(r => r.node_id === currentMcqTopic?.id ||
            (mcqIncludeDescendants && getMcqNodePath(r.node_id).some(n => n.id === currentMcqTopic?.id)))) {
            try {
                const freshTree = await loadStudyTree();
                mcqStudyData = freshTree;
                const freshTopic = findTopic(freshTree.subjects, currentMcqTopic.id);
                currentMcqTopic = freshTopic || currentMcqTopic;
                if (freshTopic) {
                    allLoadedMcqs = await loadMcqsForTopic(freshTopic.id);
                    currentMcqIndex = 0;
                    applyMcqPracticeFilters();
                }
            } catch (refreshError) {
                console.warn("MCQ view refresh failed:", refreshError);
            }
        }
    } catch (error) {
        console.error("MCQ bulk save failed:", error);
        alert("Could not save the MCQs. Check the Apps Script endpoint and try again.");
        if (btn) { btn.disabled = false; btn.textContent = "Confirm & Save All"; }
    }
}



/* =========================================================
   PHASE 6 — single-MCQ metadata editing
   Only classification/visibility metadata is editable here.
   ========================================================= */
function getMcqMetaTopicOptions(selectedId) {
    return flattenMcqTopics(mcqStudyData.subjects).map(({ node, depth }) => `
        <option value="${mcqEscapeHtml(node.id)}" ${node.id === selectedId ? "selected" : ""}>${"&nbsp;".repeat(depth * 3)}${mcqEscapeHtml(node.title)}</option>
    `).join("");
}

function getEditMcqTagChips() {
    return Array.from(document.querySelectorAll("#mcq-meta-tag-chips .mcq-tag-chip"))
        .map(chip => chip.dataset.tag || "")
        .filter(Boolean);
}

function addEditMcqTagChip(value) {
    const clean = String(value || "").trim().replace(/^,+|,+$/g, "");
    if (!clean) return;
    if (getEditMcqTagChips().some(tag => tag.toLowerCase() === clean.toLowerCase())) return;
    const wrap = document.getElementById("mcq-meta-tag-chips");
    if (!wrap) return;
    const chip = document.createElement("span");
    chip.className = "mcq-tag-chip";
    chip.dataset.tag = clean;
    chip.innerHTML = `${mcqEscapeHtml(clean)} <button type="button" aria-label="Remove tag">×</button>`;
    chip.querySelector("button").addEventListener("click", () => chip.remove());
    wrap.appendChild(chip);
}

function renderEditMcqTagSuggestions(value) {
    const box = document.getElementById("mcq-meta-tag-suggestions");
    if (!box) return;
    const q = String(value || "").trim().toLowerCase();
    const matches = mcqTagSuggestions
        .filter(tag => !getEditMcqTagChips().some(x => x.toLowerCase() === tag.toLowerCase()))
        .filter(tag => !q || tag.toLowerCase().includes(q))
        .slice(0, 8);
    box.innerHTML = matches.map(tag =>
        `<button type="button" data-tag="${mcqEscapeHtml(tag)}">${mcqEscapeHtml(tag)}</button>`
    ).join("");
    box.hidden = matches.length === 0;
    box.querySelectorAll("button").forEach(btn => btn.addEventListener("click", () => {
        addEditMcqTagChip(btn.dataset.tag);
        const input = document.getElementById("mcq-meta-tag-input");
        if (input) { input.value = ""; input.focus(); }
        renderEditMcqTagSuggestions("");
    }));
}

function openMcqMetaModal(mcq, options) {
    document.getElementById("mcq-meta-modal")?.remove();

    const topicOptions = getMcqMetaTopicOptions(mcq.node_id || currentMcqTopic?.id || "");
    const tags = String(mcq.tags || "").split(",").map(t => t.trim()).filter(Boolean);

    // How many option rows to show: at least 4, or as many as this question
    // already has (up to 6). "+ Add option" reveals the rest.
    const shownOptionCount = Math.min(6, Math.max(4, mcq.options?.length || 0));

    const modal = document.createElement("div");
    modal.id = "mcq-meta-modal";
    modal.innerHTML = `
        <div class="add-resource-overlay">
            <div class="add-resource-modal mcq-meta-modal">
                <button type="button" class="modal-close" id="mcq-meta-close">×</button>
                <h2>✏️ Edit MCQ</h2>
                <p class="add-resource-scope"><strong>${mcqEscapeHtml(mcq.question)}</strong></p>

                <label for="mcq-edit-question">Question</label>
                <textarea id="mcq-edit-question" rows="3">${mcqEscapeHtml(mcq.question || "")}</textarea>

                ${[1, 2, 3, 4, 5, 6].map(n => {
                    const letter = "abcdef"[n - 1];
                    const val = mcq.options?.[n - 1] || "";
                    const hide = n > shownOptionCount ? ' style="display:none"' : "";
                    return `
                <label for="mcq-edit-option-${letter}" data-opt-n="${n}"${hide}>Option ${n}</label>
                <input id="mcq-edit-option-${letter}" data-opt-n="${n}" type="text" value="${mcqEscapeHtml(val)}"${hide}>`;
                }).join("")}
                <button type="button" id="mcq-edit-add-option" class="content-action"${shownOptionCount >= 6 ? ' style="display:none"' : ""}>+ Add option</button>

                <label for="mcq-edit-correct">Correct Option</label>
                <select id="mcq-edit-correct">
                    ${Array.from({ length: shownOptionCount }, (_, i) => i + 1).map((num, i) =>
                        `<option value="${num}" ${mcq.answer === i ? "selected" : ""}>${num}</option>`
                    ).join("")}
                </select>

                <label for="mcq-edit-explanation">Explanation</label>
                <textarea id="mcq-edit-explanation" rows="3">${mcqEscapeHtml(mcq.explanation || "")}</textarea>

                ${[1, 2, 3, 4, 5, 6].map(n => {
                    const hide = n > shownOptionCount ? ' style="display:none"' : "";
                    return `
                <label for="mcq-edit-why-${n}" data-opt-n="${n}"${hide}>Option ${n} — why right / wrong</label>
                <textarea id="mcq-edit-why-${n}" data-opt-n="${n}" rows="2"${hide}>${mcqEscapeHtml(mcq.optionNotes?.[n - 1] || "")}</textarea>`;
                }).join("")}

                <hr>

                <label for="mcq-meta-topic">Topic</label>
                <select id="mcq-meta-topic">${topicOptions}</select>

                <label for="mcq-meta-difficulty">Difficulty</label>
                <select id="mcq-meta-difficulty">
                    <option value="" ${!mcq.difficulty ? "selected" : ""}>— Not set —</option>
                    <option value="easy" ${String(mcq.difficulty).toLowerCase() === "easy" ? "selected" : ""}>Easy</option>
                    <option value="medium" ${String(mcq.difficulty).toLowerCase() === "medium" ? "selected" : ""}>Medium</option>
                    <option value="hard" ${String(mcq.difficulty).toLowerCase() === "hard" ? "selected" : ""}>Hard</option>
                </select>

                <label for="mcq-meta-language">Language</label>
                <input id="mcq-meta-language" type="text" value="${mcqEscapeHtml(mcq.language || "")}" placeholder="English / Hindi / Hinglish / Mixed / Other">

                <label for="mcq-meta-origin">Origin (where this question really comes from)</label>
                <select id="mcq-meta-origin">
                    ${MCQ_ORIGINS.map(o => `<option value="${o}" ${normalizeMcqOrigin(mcq.origin) === o ? "selected" : ""}>${mcqEscapeHtml(MCQ_ORIGIN_LABELS[o])}</option>`).join("")}
                </select>
                <label for="mcq-meta-derived-from">Based on question ID <small>(only for AI practice questions — the real question it was based on)</small></label>
                <input id="mcq-meta-derived-from" type="text" value="${mcqEscapeHtml(mcq.derived_from || "")}" placeholder="e.g. mcq_ab12cd34">

                <label>Tags</label>
                <div id="mcq-meta-tag-chips" class="mcq-tag-chip-wrap"></div>
                <div style="position:relative">
                    <input id="mcq-meta-tag-input" type="text" placeholder="Type a tag, then Enter">
                    <div id="mcq-meta-tag-suggestions" class="drive-note" hidden></div>
                </div>

                <label for="mcq-meta-description">Description</label>
                <textarea id="mcq-meta-description" rows="3" placeholder="Optional description">${mcqEscapeHtml(mcq.description || "")}</textarea>

                <label for="mcq-meta-status">Status</label>
                <select id="mcq-meta-status">
                    <option value="published" ${String(mcq.status || "").toLowerCase() !== "archived" ? "selected" : ""}>Published</option>
                    <option value="archived" ${String(mcq.status || "").toLowerCase() === "archived" ? "selected" : ""}>Archived (hidden from practice, still saved)</option>
                </select>

                <div class="modal-actions">
                    <button type="button" id="mcq-meta-delete" class="danger">🗑️ Delete permanently</button>
                    <button type="button" id="mcq-meta-cancel">Cancel</button>
                    <button type="button" id="mcq-meta-save" class="primary">Save Changes</button>
                </div>
            </div>
        </div>`;

    document.body.appendChild(modal);
    tags.forEach(addEditMcqTagChip);
    setupMcqMetaTabs_(modal, mcq, options && options.startTab);

    const tagInput = document.getElementById("mcq-meta-tag-input");
    tagInput?.addEventListener("input", () => renderEditMcqTagSuggestions(tagInput.value));
    tagInput?.addEventListener("focus", () => renderEditMcqTagSuggestions(tagInput.value));
    tagInput?.addEventListener("keydown", e => {
        if (e.key === "Enter") {
            e.preventDefault();
            addEditMcqTagChip(tagInput.value);
            tagInput.value = "";
            renderEditMcqTagSuggestions("");
        }
    });

    document.getElementById("mcq-meta-close")?.addEventListener("click", () => modal.remove());
    document.getElementById("mcq-meta-cancel")?.addEventListener("click", () => modal.remove());
    modal.querySelector(".add-resource-overlay")?.addEventListener("click", e => {
        if (e.target === e.currentTarget) modal.remove();
    });
    document.getElementById("mcq-meta-save")?.addEventListener("click", () => saveMcqMeta(mcq));
    document.getElementById("mcq-meta-delete")?.addEventListener("click", () => deleteMcqPermanently(mcq));

    // "+ Add option": reveals the next hidden option row (5th, then 6th),
    // its "why" box, and the matching number in the Correct Option list.
    let visibleOptionCount = shownOptionCount;
    document.getElementById("mcq-edit-add-option")?.addEventListener("click", e => {
        if (visibleOptionCount >= 6) return;
        visibleOptionCount++;
        modal.querySelectorAll(`[data-opt-n="${visibleOptionCount}"]`).forEach(el => { el.style.display = ""; });
        const sel = document.getElementById("mcq-edit-correct");
        if (sel) {
            const opt = document.createElement("option");
            opt.value = String(visibleOptionCount);
            opt.textContent = String(visibleOptionCount);
            sel.appendChild(opt);
        }
        if (visibleOptionCount >= 6) e.currentTarget.style.display = "none";
    });
}

// PHASE 6 — turns the one long edit form into tabs: Question / Source /
// (Language 2, only for a one-row bilingual question). The existing fields
// are only MOVED into the first tab, so nothing about them changes.
function setupMcqMetaTabs_(modal, mcq, startTab) {
    const box = modal.querySelector(".mcq-meta-modal");
    const firstLabel = box && box.querySelector('label[for="mcq-edit-question"]');
    const actions = box && box.querySelector(".modal-actions");
    if (!box || !firstLabel || !actions) return;

    const esc = mcqEscapeHtml;
    const letters = ["a", "b", "c", "d", "e", "f"];
    const isBilingual = !!String(mcq.question_alt || "").trim();

    // 1) Question tab = everything that is already in the form.
    const qPanel = document.createElement("div");
    qPanel.dataset.mcqTab = "question";
    let node = firstLabel;
    while (node && node !== actions) {
        const next = node.nextSibling;
        qPanel.appendChild(node);
        node = next;
    }
    box.insertBefore(qPanel, actions);

    // New optional fields sit just above "Status".
    const statusLabel = qPanel.querySelector('label[for="mcq-meta-status"]');
    if (statusLabel) {
        statusLabel.insertAdjacentHTML("beforebegin", `
            <label for="mcq-edit-remark">Remark <small>(optional note shown in ⓘ)</small></label>
            <textarea id="mcq-edit-remark" rows="2">${esc(mcq.remark || "")}</textarea>
            <label for="mcq-edit-extra-link">Extra link <small>(optional, must start with http:// or https://)</small></label>
            <input id="mcq-edit-extra-link" type="text" value="${esc(mcq.extra_link || "")}" placeholder="https://...">
            <label for="mcq-edit-extra-link-label">Extra link label <small>(optional)</small></label>
            <input id="mcq-edit-extra-link-label" type="text" value="${esc(mcq.extra_link_label || "")}" placeholder="e.g. Video explanation">`);
    }

    // 2) Source tab.
    const sPanel = document.createElement("div");
    sPanel.dataset.mcqTab = "source";
    sPanel.hidden = true;
    // One set of boxes per language (second set only for a bilingual question):
    // the same paper can print a different number / ID / page in each version.
    const srcBox = (id, label, hint, key, lang) =>
        `<label for="${id}">${label}${lang ? " — " + esc(lang) : ""} <small>(${hint})</small></label>` +
        `<input id="${id}" type="text" value="${esc(mcq[key] || "")}">`;
    const srcLang1 = isBilingual ? (mcq.language || "Language 1") : "";
    const srcLang2 = mcq.alt_language || "Language 2";
    sPanel.innerHTML = `
        <p class="add-resource-scope">Where this question came from. Every field is optional — leave it empty if you do not know it.${isBilingual ? " A bilingual question has one set of boxes per language, because the original paper can print a different number, ID or page in each version." : ""}</p>
        ${srcBox("mcq-src-qno", "Question no. in source", "the number printed in the original paper", "source_question_no", srcLang1)}
        ${srcBox("mcq-src-qid", "Question ID in source", "the ID printed in the original paper", "source_qid", srcLang1)}
        ${srcBox("mcq-src-page", "Page in source", "page number in the original paper", "source_page", srcLang1)}
        ${isBilingual ? `
        ${srcBox("mcq-src-alt-qno", "Question no. in source", "the number printed in the original paper", "alt_source_question_no", srcLang2)}
        ${srcBox("mcq-src-alt-qid", "Question ID in source", "the ID printed in the original paper", "alt_source_qid", srcLang2)}
        ${srcBox("mcq-src-alt-page", "Page in source", "page number in the original paper", "alt_source_page", srcLang2)}` : ""}`;
    box.insertBefore(sPanel, actions);

    // 3) Language 2 tab (only when this row already holds a second language).
    let aPanel = null;
    if (isBilingual) {
        const altVals = letters.map(l => String(mcq["option_" + l + "_alt"] || ""));
        let altCount = altVals.length;
        while (altCount > 0 && !altVals[altCount - 1].trim()) altCount--;
        const startRows = Math.min(6, Math.max(4, mcq.options?.length || 0, altCount));
        aPanel = document.createElement("div");
        aPanel.dataset.mcqTab = "alt";
        aPanel.hidden = true;
        aPanel.innerHTML = `
            <p class="add-resource-scope">Second language text. The correct answer and the option ORDER are shared with the first language, so the number of options must be the same in both languages.</p>
            <label for="mcq-alt-language">Second language name</label>
            <input id="mcq-alt-language" type="text" value="${esc(mcq.alt_language || "")}" placeholder="e.g. Hindi">
            <label for="mcq-alt-question">Question (second language)</label>
            <textarea id="mcq-alt-question" rows="3">${esc(mcq.question_alt || "")}</textarea>
            ${[1, 2, 3, 4, 5, 6].map(n => {
                const l = letters[n - 1];
                const hide = n > startRows ? ' style="display:none"' : "";
                return `
            <label for="mcq-alt-option-${l}" data-alt-n="${n}"${hide}>Option ${n}</label>
            <input id="mcq-alt-option-${l}" data-alt-n="${n}" type="text" value="${esc(altVals[n - 1])}"${hide}>`;
            }).join("")}
            <button type="button" id="mcq-alt-add-option" class="content-action"${startRows >= 6 ? ' style="display:none"' : ""}>+ Add option</button>
            <label for="mcq-alt-explanation">Explanation (second language)</label>
            <textarea id="mcq-alt-explanation" rows="3">${esc(mcq.explanation_alt || "")}</textarea>
            ${[1, 2, 3, 4, 5, 6].map(n => {
                const l = letters[n - 1];
                const hide = n > startRows ? ' style="display:none"' : "";
                return `
            <label for="mcq-alt-why-${n}" data-alt-n="${n}"${hide}>Option ${n} — why right / wrong (second language)</label>
            <textarea id="mcq-alt-why-${n}" data-alt-n="${n}" rows="2"${hide}>${esc(mcq["explanation_" + l + "_alt"] || "")}</textarea>`;
            }).join("")}`;
        box.insertBefore(aPanel, actions);

        const showAltRows = count => {
            for (let n = 1; n <= count && n <= 6; n++) {
                aPanel.querySelectorAll(`[data-alt-n="${n}"]`).forEach(el => { el.style.display = ""; });
            }
            if (count >= 6) aPanel.querySelector("#mcq-alt-add-option").style.display = "none";
        };
        aPanel.querySelector("#mcq-alt-add-option")?.addEventListener("click", () => {
            const visible = aPanel.querySelectorAll('input[data-alt-n]:not([style*="display: none"])').length;
            showAltRows(visible + 1);
        });
        // Keep the number of rows in step with the Question tab when switching.
        aPanel.syncRows = () => {
            const primaryVisible = qPanel.querySelectorAll('input[data-opt-n]:not([style*="display: none"])').length;
            showAltRows(primaryVisible);
        };
    }

    // 4) Tab bar.
    const tabs = [["question", "Question"], ["source", "Source"]];
    if (aPanel) tabs.push(["alt", "Language 2"]);
    const bar = document.createElement("div");
    bar.className = "content-layer-tabs";
    bar.innerHTML = tabs.map(([key, label]) =>
        `<button type="button" class="content-layer-tab" data-mcq-tab-btn="${key}">${label}</button>`).join("");
    box.insertBefore(bar, qPanel);

    const panels = { question: qPanel, source: sPanel, alt: aPanel };
    const showTab = key => {
        if (!panels[key]) key = "question";
        Object.keys(panels).forEach(k => { if (panels[k]) panels[k].hidden = (k !== key); });
        bar.querySelectorAll("[data-mcq-tab-btn]").forEach(b =>
            b.classList.toggle("active", b.dataset.mcqTabBtn === key));
        if (key === "alt" && aPanel && aPanel.syncRows) aPanel.syncRows();
    };
    bar.addEventListener("click", e => {
        const btn = e.target.closest("[data-mcq-tab-btn]");
        if (btn) showTab(btn.dataset.mcqTabBtn);
    });
    showTab(startTab === "alt" ? "alt" : "question");
}

// ALPHA-PLUS — real permanent delete, distinct from the "Archived"
// status option in the same modal (which only hides the question from
// practice while keeping its row). This has no undo, so it needs its
// own strong confirmation, not just the generic browser confirm().
async function deleteMcqPermanently(mcq) {
    const typed = prompt(
        `This permanently deletes this question — no undo, unlike "Archived" status above.\n\n` +
        `Type DELETE to confirm:`
    );
    if (typed !== "DELETE") return;

    const btn = document.getElementById("mcq-meta-delete");
    if (btn) { btn.disabled = true; btn.textContent = "Deleting…"; }

    try {
        await fetch(MCQ_GOOGLE_SHEET_API, {
            method: "POST",
            mode: "no-cors",
            body: JSON.stringify({ action: "delete_mcq", mcq_id: mcq.id })
        });

        document.getElementById("mcq-meta-modal")?.remove();
        // Rebuild from allLoadedMcqs (not a direct currentMcqs filter) so a
        // paired question that still has its OTHER language variant left
        // keeps showing that variant, instead of the whole slot vanishing.
        allLoadedMcqs = allLoadedMcqs.filter(m => String(m.id) !== String(mcq.id));
        applyMcqPracticeFilters();
    } catch (error) {
        console.error("MCQ delete failed:", error);
        alert("Could not delete this question. Please try again.");
        if (btn) { btn.disabled = false; btn.textContent = "🗑️ Delete permanently"; }
    }
}

async function saveMcqMeta(mcq) {
    const topicId = document.getElementById("mcq-meta-topic")?.value || "";
    const difficulty = document.getElementById("mcq-meta-difficulty")?.value || "";
    const language = document.getElementById("mcq-meta-language")?.value.trim() || "";
    const tags = getEditMcqTagChips().join(", ");
    const description = document.getElementById("mcq-meta-description")?.value.trim() || "";
    const status = document.getElementById("mcq-meta-status")?.value || "published";

    const fields = {};
    const oldDifficulty = String(mcq.difficulty || "");
    const oldLanguage = String(mcq.language || "");
    const oldTags = String(mcq.tags || "").split(",").map(t => t.trim()).filter(Boolean).join(", ");
    const oldDescription = String(mcq.description || "");
    const oldStatus = String(mcq.status || "").trim() || "published";

    if (topicId !== String(mcq.node_id || "")) fields.node_id = topicId;
    if (difficulty !== oldDifficulty) fields.difficulty = difficulty;
    if (language !== oldLanguage) fields.language = language;
    if (tags !== oldTags) fields.tags = tags;
    if (description !== oldDescription) fields.description = description;
    if (status !== oldStatus) fields.status = status;

    // PHASE 6 — remark / extra link / source fields. All optional; an empty
    // value clears the cell. Nothing is sent yet, so an early return is safe.
    const extraLinkText = document.getElementById("mcq-edit-extra-link")?.value.trim() || "";
    if (extraLinkText && !mcqSafeUrl_(extraLinkText)) {
        alert("Extra link must start with http:// or https:// (or leave it empty).");
        return;
    }
    [
        ["remark", "mcq-edit-remark"], ["extra_link", "mcq-edit-extra-link"],
        ["extra_link_label", "mcq-edit-extra-link-label"],
        ["source_qid", "mcq-src-qid"], ["source_page", "mcq-src-page"],
        ["source_question_no", "mcq-src-qno"],
        ["alt_source_question_no", "mcq-src-alt-qno"],
        ["alt_source_qid", "mcq-src-alt-qid"], ["alt_source_page", "mcq-src-alt-page"]
    ].forEach(([col, id]) => {
        const el = document.getElementById(id);
        if (!el) return;
        const v = el.value.trim();
        if (v !== String(mcq[col] || "")) fields[col] = v;
    });

    // ALPHA-PLUS — content fields (question/options/answer/explanation)
    // go through a separate update_mcq_content action (see Code.gs —
    // update_mcq_meta's allow-list deliberately excludes these), so they
    // need their own diff/payload here, sent as a second request below.
    const question = document.getElementById("mcq-edit-question")?.value.trim() || "";
    const optionLetters = ["a", "b", "c", "d", "e", "f"];
    const optionVals = optionLetters.map(l => document.getElementById("mcq-edit-option-" + l)?.value.trim() || "");
    const correctNumber = Number(document.getElementById("mcq-edit-correct")?.value) || 1;
    const explanation = document.getElementById("mcq-edit-explanation")?.value.trim() || "";

    // A question may have 2 to 6 options, filled in order with no empty one
    // in between, and the correct option must be one of them.
    let filledCount = optionVals.length;
    while (filledCount > 0 && !optionVals[filledCount - 1]) filledCount--;
    if (filledCount < 2 || optionVals.slice(0, filledCount).some(v => !v)) {
        alert("Fill the options in order (Option 1, 2, 3 ...) with no empty option in between. At least 2 options are needed.");
        return;
    }
    if (correctNumber > filledCount) {
        alert("Correct Option " + correctNumber + " is empty. Pick one of the filled options (1 to " + filledCount + ").");
        return;
    }

    const contentFields = {};
    if (question !== String(mcq.question || "")) contentFields.question = question;
    optionLetters.forEach((letter, i) => {
        if (optionVals[i] !== String(mcq.options?.[i] || "")) contentFields["option_" + letter] = optionVals[i];
    });
    if (correctNumber !== indexToCorrect(mcq.answer ?? 0)) contentFields.correct_option = correctNumber;
    if (explanation !== String(mcq.explanation || "")) contentFields.explanation = explanation;
    const originValue = document.getElementById("mcq-meta-origin")?.value || normalizeMcqOrigin(mcq.origin);
    if (originValue !== normalizeMcqOrigin(mcq.origin)) contentFields.origin = originValue;
    const derivedFromValue = document.getElementById("mcq-meta-derived-from")?.value.trim() || "";
    if (derivedFromValue !== String(mcq.derived_from || "")) contentFields.derived_from = derivedFromValue;
    optionLetters.forEach((letter, i) => {
        const note = document.getElementById(`mcq-edit-why-${i + 1}`)?.value.trim() || "";
        if (note !== String(mcq.optionNotes?.[i] || "")) contentFields["explanation_" + letter] = note;
    });

    // PHASE 6 — second language (only exists when the Language 2 tab is open).
    if (document.getElementById("mcq-alt-question")) {
        const altQuestion = document.getElementById("mcq-alt-question").value.trim();
        const altOpts = optionLetters.map(l => document.getElementById("mcq-alt-option-" + l)?.value.trim() || "");
        let altFilled = altOpts.length;
        while (altFilled > 0 && !altOpts[altFilled - 1]) altFilled--;
        if (altQuestion || altFilled > 0) {
            if (!altQuestion) {
                alert("Language 2: the question text is empty. Fill it, or empty ALL Language 2 fields to remove the second language.");
                return;
            }
            if (altOpts.slice(0, altFilled).some(v => !v)) {
                alert("Language 2: fill the options in order (Option 1, 2, 3 ...) with no empty option in between.");
                return;
            }
            if (altFilled !== filledCount) {
                alert("Both languages must have the same number of options. Question tab has " + filledCount + ", Language 2 has " + altFilled + ". Fix one of them, then save again.");
                return;
            }
        }
        const altPairs = [
            ["alt_language", document.getElementById("mcq-alt-language")?.value.trim() || "", mcq.alt_language],
            ["question_alt", altQuestion, mcq.question_alt],
            ["explanation_alt", document.getElementById("mcq-alt-explanation")?.value.trim() || "", mcq.explanation_alt]
        ];
        optionLetters.forEach((letter, i) => {
            altPairs.push(["option_" + letter + "_alt", altOpts[i], mcq["option_" + letter + "_alt"]]);
            altPairs.push(["explanation_" + letter + "_alt", document.getElementById("mcq-alt-why-" + (i + 1))?.value.trim() || "", mcq["explanation_" + letter + "_alt"]]);
        });
        altPairs.forEach(([col, now, before]) => {
            if (now !== String(before || "")) contentFields[col] = now;
        });
    }

    if (!Object.keys(fields).length && !Object.keys(contentFields).length) {
        document.getElementById("mcq-meta-modal")?.remove();
        return;
    }

    const btn = document.getElementById("mcq-meta-save");
    if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }

    try {
        if (Object.keys(fields).length) {
            await fetch(MCQ_GOOGLE_SHEET_API, {
                method: "POST",
                mode: "no-cors",
                body: JSON.stringify({ action: "update_mcq_meta", mcq_id: mcq.id, fields })
            });
        }
        if (Object.keys(contentFields).length) {
            await fetch(MCQ_GOOGLE_SHEET_API, {
                method: "POST",
                mode: "no-cors",
                body: JSON.stringify({ action: "update_mcq_content", mcq_id: mcq.id, fields: contentFields })
            });
        }

        document.getElementById("mcq-meta-modal")?.remove();
        await refreshCurrentMcqTopic();
        alert("MCQ updated.");
    } catch (error) {
        console.error("MCQ update failed:", error);
        alert("Could not update this MCQ. Check the Apps Script endpoint and try again.");
        if (btn) { btn.disabled = false; btn.textContent = "Save Changes"; }
    }
}

async function refreshCurrentMcqTopic() {
    if (!currentMcqTopic) return;
    const freshTree = await loadStudyTree();
    mcqStudyData = freshTree;
    const freshTopic = findTopic(freshTree.subjects, currentMcqTopic.id);
    currentMcqTopic = freshTopic || currentMcqTopic;
    allLoadedMcqs = await loadMcqsForTopic(currentMcqTopic.id);
    currentCollectionView = null;
    selectedMcqTags = new Set();
    selectedMcqLanguage = "";
    mcqActiveLanguageByGroup = new Map();
    applyMcqPracticeFilters();
}

document.getElementById("mcq-add-open")?.addEventListener("click", openAddMcqModal);

/* PHASE 7 — MCQ mobile question-navigator drawer. */
window.initMobileDrawers?.({
    headerSelector: ".app-header",
    breakpoint: 900,
    drawers: [
        { panel: "mcq-navigator", label: "Questions", icon: "☷", side: "right" }
    ]
});

/* ROLL-UP TOGGLE — "Include sub-topics" checkbox next to the Paper info / paper-sources bar. */
(function setupMcqSubtopicToggle() {
    const anchor = document.getElementById("mcq-paper-sources-btn");
    if (!anchor || document.getElementById("mcq-include-sub")) return;

    anchor.insertAdjacentHTML("afterend",
        `<label id="mcq-include-sub-wrap" style="display:inline-flex;align-items:center;gap:6px;margin-left:10px;font-size:0.85em;cursor:pointer;">` +
        `<input type="checkbox" id="mcq-include-sub"> Include sub-topics</label>`);

    const cb = document.getElementById("mcq-include-sub");
    cb.checked = mcqIncludeDescendants;

    cb.addEventListener("change", async () => {
        mcqIncludeDescendants = cb.checked;
        localStorage.setItem("alpha_mcq_include_sub", cb.checked ? "1" : "0");
        if (!currentMcqTopic) return;
        try {
            allLoadedMcqs = await loadMcqsForTopic(currentMcqTopic.id);
            currentMcqIndex = 0;
            currentCollectionView = null;
            selectedMcqTags = new Set();
            selectedMcqLanguage = "";
            mcqActiveLanguageByGroup = new Map();
            applyMcqPracticeFilters();
        } catch (err) {
            console.warn("Include sub-topics reload failed:", err);
            alert("Could not reload MCQs. Please try again.");
        }
    });
})();
