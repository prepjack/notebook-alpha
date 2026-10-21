/* =========================================================
   MCQ EXPORT — H2 (Hub "Export" tab)
   Part 1: PURE functions (no DOM) — testable with node:
           docs/hub/test-export.js
   Part 2: thin UI code for the Hub Export tab.
   Plain globals, loaded AFTER mcq.js and BEFORE mcq-hub.js.
   No Sheet writes. Never exports status / hidden fields.
   ========================================================= */

const MCQ_EXPORT_LETTERS_ = "ABCDEF";
const MCQ_EXPORT_OPTS_KEY_ = "alpha_mcq_export_opts";
const MCQ_EXPORT_DEFAULTS_ = {
    number: true, question: true, options: true, correct: true,
    explanation: true, passage: false, tags: false, source: false,
    lang: "1",          // "1" | "2" | "both"
    layout: "full"      // "full" | "questions" | "key"
};

/* ---------------- PART 1 — pure functions ---------------- */

function mcqExportNormOpts_(o) {
    const out = Object.assign({}, MCQ_EXPORT_DEFAULTS_, o || {});
    ["number", "question", "options", "correct", "explanation", "passage", "tags", "source"]
        .forEach(k => { out[k] = !!out[k]; });
    if (!["1", "2", "both"].includes(String(out.lang))) out.lang = "1";
    out.lang = String(out.lang);
    if (!["full", "questions", "key"].includes(out.layout)) out.layout = "full";
    // "Questions only" must never leak answers.
    if (out.layout === "questions") { out.correct = false; out.explanation = false; }
    out.paperTitle = String(out.paperTitle || "");
    return out;
}

function mcqExportHasAlt_(row) {
    return !!String((row && row.question_alt) || "").trim();
}

// Rows in paper order: collection first, then question_no (blank last), then original order.
function mcqExportSortRows_(rows) {
    return (rows || []).map((row, i) => ({ row, i })).sort((a, b) => {
        const ca = String(a.row.collection_id_ref || a.row.collection_id || "");
        const cb = String(b.row.collection_id_ref || b.row.collection_id || "");
        if (ca !== cb) return ca < cb ? -1 : 1;
        const qa = Number(a.row.question_no || 0) || Number.MAX_SAFE_INTEGER;
        const qb = Number(b.row.question_no || 0) || Number.MAX_SAFE_INTEGER;
        return (qa - qb) || (a.i - b.i);
    }).map(x => x.row);
}

// Index of the correct option, or -1 when the sheet has no (valid) answer.
function mcqExportCorrectIdx_(row) {
    const raw = row.correct_option;
    if (raw !== undefined && String(raw === null ? "" : raw).trim() === "") return -1;
    const a = Number(row.answer);
    if (!Number.isInteger(a) || a < 0 || a >= (row.options || []).length) return -1;
    return a;
}

// One language block of a question. which = 1 | 2.
// Language 2 follows the on-screen rule: a blank second-language option /
// explanation falls back to the first language, so option letters always match.
function mcqExportVariant_(row, which) {
    const opts1 = (row.options || []).map(o => String(o == null ? "" : o));
    if (which === 2 && mcqExportHasAlt_(row)) {
        const alt = [row.option_a_alt, row.option_b_alt, row.option_c_alt,
                     row.option_d_alt, row.option_e_alt, row.option_f_alt];
        return {
            which: 2,
            label: String(row.alt_language || "").trim() || "Language 2",
            question: String(row.question_alt || ""),
            options: opts1.map((o, i) => String(alt[i] || "").trim() ? String(alt[i]) : o),
            explanation: String(row.explanation_alt || "").trim() ? String(row.explanation_alt) : String(row.explanation || "")
        };
    }
    return {
        which: 1,
        label: String(row.language || "").trim() || "Language 1",
        question: String(row.question || ""),
        options: opts1,
        explanation: String(row.explanation || "")
    };
}

// Turns rows into a neutral model that text / md / csv / print all share.
function mcqExportModel_(rows, passages, o) {
    const passageMap = new Map();
    (passages || []).forEach(p => passageMap.set(String(p.passage_id), p));
    const seen = new Set();
    return (rows || []).map((row, i) => {
        const whichList = o.lang === "both"
            ? (mcqExportHasAlt_(row) ? [1, 2] : [1])
            : (o.lang === "2" && mcqExportHasAlt_(row) ? [2] : [1]);
        const correctIdx = mcqExportCorrectIdx_(row);
        const blocks = whichList.map(which => {
            const v = mcqExportVariant_(row, which);
            let passage = "";
            const pid = String(row.passage_id || "").trim();
            if (o.passage && pid && passageMap.has(pid)) {
                const key = pid + "|" + which;
                if (!seen.has(key)) {
                    seen.add(key);
                    const p = passageMap.get(pid);
                    passage = (which === 2 && String(p.content_alt || "").trim()) ? String(p.content_alt) : String(p.content || "");
                }
            }
            return Object.assign(v, { passage, correctIdx });
        });
        const no = String(row.question_no == null ? "" : row.question_no).trim() || String(i + 1);
        return {
            no, row, blocks, correctIdx,
            tags: String(row.tags || "").trim(),
            srcNo: String(row.source_question_no == null ? "" : row.source_question_no).trim(),
            srcQid: String(row.source_qid || "").trim()
        };
    });
}

function mcqExportCorrectText_(block) {
    if (block.correctIdx < 0) return "—";
    return MCQ_EXPORT_LETTERS_[block.correctIdx] + ") " + (block.options[block.correctIdx] || "");
}

function mcqExportSourceLine_(m, title) {
    const parts = [];
    if (title) parts.push(title);
    if (m.srcNo) parts.push("Source Q no: " + m.srcNo);
    if (m.srcQid) parts.push("Question ID: " + m.srcQid);
    return parts.length ? "Source: " + parts.join(" · ") : "";
}

function mcqExportKeyTokens_(model) {
    return model.map(m => m.no + "-" + (m.correctIdx < 0 ? "—" : MCQ_EXPORT_LETTERS_[m.correctIdx]));
}

function mcqExportBuildText_(model, o) {
    if (o.layout === "key") {
        const tokens = mcqExportKeyTokens_(model);
        const lines = [];
        for (let i = 0; i < tokens.length; i += 10) lines.push(tokens.slice(i, i + 10).join(" "));
        return lines.join("\n");
    }
    const both = o.lang === "both";
    return model.map(m => {
        const out = [];
        m.blocks.forEach(b => {
            const lines = [];
            if (both) lines.push("(" + b.label + ")");
            if (b.passage) lines.push("Passage:\n" + b.passage);
            const head = [o.number ? "Q" + m.no + "." : "", o.question ? b.question : ""].filter(Boolean).join(" ");
            if (head) lines.push(head);
            if (o.options) b.options.forEach((t, i) => lines.push(MCQ_EXPORT_LETTERS_[i] + ") " + t));
            if (o.correct) lines.push("Correct: " + mcqExportCorrectText_(b));
            if (o.explanation && b.explanation.trim()) lines.push("Explanation: " + b.explanation.trim());
            out.push(lines.join("\n"));
        });
        const extra = [];
        if (o.tags && m.tags) extra.push("Tags: " + m.tags);
        if (o.source) { const s = mcqExportSourceLine_(m, o.paperTitle); if (s) extra.push(s); }
        if (extra.length) out.push(extra.join("\n"));
        return out.join("\n");
    }).join("\n\n");
}

function mcqExportBuildMd_(model, o) {
    const quote = t => String(t).split("\n").map(l => "> " + l).join("\n");
    const head = o.paperTitle ? "# " + o.paperTitle + "\n\n" : "";
    if (o.layout === "key") return head + "**Answer key**\n\n" + mcqExportBuildText_(model, o);
    const both = o.lang === "both";
    return head + model.map(m => {
        const out = [];
        m.blocks.forEach(b => {
            const parts = [];
            if (both) parts.push("_(" + b.label + ")_");
            if (b.passage) parts.push("> **Passage**\n" + quote(b.passage));
            const q = [o.number ? "**Q" + m.no + ".**" : "", o.question ? b.question : ""].filter(Boolean).join(" ");
            if (q) parts.push(q);
            if (o.options) parts.push(b.options.map((t, i) => "- " + MCQ_EXPORT_LETTERS_[i] + ") " + t).join("\n"));
            if (o.correct) parts.push("**Correct:** " + mcqExportCorrectText_(b));
            if (o.explanation && b.explanation.trim()) parts.push("**Explanation:** " + b.explanation.trim());
            out.push(parts.join("\n\n"));
        });
        const extra = [];
        if (o.tags && m.tags) extra.push("Tags: " + m.tags);
        if (o.source) { const s = mcqExportSourceLine_(m, o.paperTitle); if (s) extra.push(s); }
        if (extra.length) out.push("_" + extra.join(" | ") + "_");
        return out.join("\n\n");
    }).join("\n\n---\n\n");
}

function mcqExportBuildCsvRows_(model, o) {
    if (o.layout === "key") {
        return [["question_no", "correct"]].concat(
            model.map(m => [m.no, m.correctIdx < 0 ? "" : MCQ_EXPORT_LETTERS_[m.correctIdx]]));
    }
    const header = ["question_no", "language", "question",
        "option_a", "option_b", "option_c", "option_d", "option_e", "option_f",
        "correct", "explanation", "tags", "source_qid"];
    const rows = [header];
    model.forEach(m => {
        m.blocks.forEach(b => {
            rows.push([
                o.number ? m.no : "",
                b.label,
                o.question ? b.question : "",
                ...[0, 1, 2, 3, 4, 5].map(i => (o.options && b.options[i] !== undefined) ? b.options[i] : ""),
                (o.correct && b.correctIdx >= 0) ? MCQ_EXPORT_LETTERS_[b.correctIdx] : "",
                o.explanation ? b.explanation : "",
                o.tags ? m.tags : "",
                o.source ? m.srcQid : ""
            ]);
        });
    });
    return rows;
}

// MAIN pure builder. rows = mapped MCQ objects already in paper order.
// opts: number question options correct explanation passage tags source
//       lang ("1"|"2"|"both")  layout ("full"|"questions"|"key")  paperTitle
function buildMcqExport(rows, passages, opts) {
    const o = mcqExportNormOpts_(opts);
    const model = mcqExportModel_(rows, passages, o);
    return {
        text: mcqExportBuildText_(model, o),
        md: mcqExportBuildMd_(model, o),
        csvRows: mcqExportBuildCsvRows_(model, o),
        count: model.length
    };
}

function mcqExportCsvString_(csvRows) {
    const cell = v => {
        const s = String(v == null ? "" : v);
        return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return csvRows.map(r => r.map(cell).join(",")).join("\r\n");
}

function mcqExportEsc_(value) {
    return String(value == null ? "" : value)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// Print HTML. `rich(text, block)` may render markdown/KaTeX (it must return
// SAFE html, e.g. renderRichInline which sanitises); default = escaped text.
function buildMcqPrintHtml(rows, passages, opts, rich, dateText) {
    const o = mcqExportNormOpts_(opts);
    const model = mcqExportModel_(rows, passages, o);
    const esc = mcqExportEsc_;
    const R = (t, block) => {
        if (typeof rich === "function") { try { return rich(String(t == null ? "" : t), !!block); } catch (e) { /* fall through */ } }
        return esc(t).replace(/\n/g, "<br>");
    };
    const title = o.paperTitle ? `<h1 class="mcq-print-title">${esc(o.paperTitle)}</h1>` : "";
    const date = dateText ? `<div class="mcq-print-date">${esc(dateText)}</div>` : "";
    let body;
    if (o.layout === "key") {
        body = `<div class="mcq-print-key">${mcqExportKeyTokens_(model).map(t => `<span>${esc(t)}</span>`).join("")}</div>`;
    } else {
        const both = o.lang === "both";
        body = model.map(m => {
            const blocks = m.blocks.map(b => {
                const h = [];
                if (both) h.push(`<div class="mcq-print-lang">${esc(b.label)}</div>`);
                if (b.passage) h.push(`<div class="mcq-print-passage"><b>Passage</b>${R(b.passage, true)}</div>`);
                if (o.number || o.question) {
                    h.push(`<div class="mcq-print-qtext">${o.number ? `<b>Q${esc(m.no)}.</b> ` : ""}${o.question ? R(b.question, false) : ""}</div>`);
                }
                if (o.options) {
                    h.push(b.options.map((t, i) =>
                        `<div class="mcq-print-opt"><b>${MCQ_EXPORT_LETTERS_[i]})</b> ${R(t, false)}</div>`).join(""));
                }
                if (o.correct) h.push(`<div class="mcq-print-correct"><b>Correct:</b> ${b.correctIdx < 0 ? "—" : `${MCQ_EXPORT_LETTERS_[b.correctIdx]}) ${R(b.options[b.correctIdx], false)}`}</div>`);
                if (o.explanation && b.explanation.trim()) h.push(`<div class="mcq-print-expl"><b>Explanation:</b> ${R(b.explanation.trim(), true)}</div>`);
                return h.join("");
            }).join("");
            const extra = [];
            if (o.tags && m.tags) extra.push("Tags: " + m.tags);
            if (o.source) { const s = mcqExportSourceLine_(m, o.paperTitle); if (s) extra.push(s); }
            return `<div class="mcq-print-q">${blocks}${extra.length ? `<div class="mcq-print-meta">${esc(extra.join(" | "))}</div>` : ""}</div>`;
        }).join("");
    }
    return `<div class="mcq-print-doc">${title}${date}${body}</div>`;
}

function mcqExportSlug_(title) {
    const s = String(title || "").normalize("NFC").toLowerCase()
        .replace(/[^\p{L}\p{N}\p{M}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 60);
    return s || "mcq-export";
}

function mcqExportFileName_(title, ext, dateObj) {
    const d = dateObj || new Date();
    const pad = n => String(n).padStart(2, "0");
    return `${mcqExportSlug_(title)}_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.${ext}`;
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        buildMcqExport, buildMcqPrintHtml, mcqExportSortRows_, mcqExportCsvString_,
        mcqExportSlug_, mcqExportFileName_, mcqExportNormOpts_
    };
}

/* ---------------- PART 2 — thin UI (browser only) ---------------- */

let mcqExportScope_ = "";          // "selected" | "paper" | "view" (chosen per session)
let mcqExportToken_ = 0;           // drops out-of-date async refreshes
let mcqExportCache_ = {};          // paperId -> {rows, passages, info}
let mcqExportLast_ = null;         // last build result used by the buttons

function mcqExportLoadOpts_() {
    try {
        const raw = localStorage.getItem(MCQ_EXPORT_OPTS_KEY_);
        if (raw) return Object.assign({}, MCQ_EXPORT_DEFAULTS_, JSON.parse(raw));
    } catch (e) { /* ignore */ }
    return Object.assign({}, MCQ_EXPORT_DEFAULTS_);
}

function mcqExportSaveOpts_(opts) {
    try { localStorage.setItem(MCQ_EXPORT_OPTS_KEY_, JSON.stringify(opts)); } catch (e) { /* ignore */ }
}

// Whole paper (every question of one collection), without touching the page's
// own view. If that paper is already the open "Full paper" view, reuse it.
async function mcqExportGetPaper_(paperId) {
    paperId = String(paperId || "");
    if (!paperId) return { rows: [], passages: [], info: null };
    if (currentCollectionView && String(currentCollectionView.id) === paperId) {
        return {
            rows: mcqExportSortRows_(allLoadedMcqs),
            passages: (mcqApiData && mcqApiData.passages) || [],
            info: getMcqCollectionInfo(paperId)
        };
    }
    if (mcqExportCache_[paperId]) return mcqExportCache_[paperId];
    const response = await fetch(MCQ_GOOGLE_SHEET_API + "?action=get_mcqs&collection_id=" + encodeURIComponent(paperId));
    if (!response.ok) throw new Error("Paper fetch failed (" + response.status + ")");
    const data = await response.json();
    const rows = (data.mcqs || [])
        .filter(r => String(r.status || "").trim().toLowerCase() !== "archived")
        .map(mapMcqRow);
    const info = (data.collections || []).find(c => String(c.collection_id || "") === paperId) || getMcqCollectionInfo(paperId);
    return (mcqExportCache_[paperId] = { rows: mcqExportSortRows_(rows), passages: data.passages || [], info });
}

function mcqExportPaperTitle_(paperId, info) {
    const i = info || getMcqCollectionInfo(paperId);
    return (i && i.title) || "";
}

async function mcqExportResolveScope_(scope) {
    const passages = (mcqApiData && mcqApiData.passages) || [];
    if (scope === "selected") {
        const pool = new Map();
        (allLoadedMcqs || []).forEach(r => pool.set(String(r.id), r));
        Object.values(mcqExportCache_).forEach(c => c.rows.forEach(r => { if (!pool.has(String(r.id))) pool.set(String(r.id), r); }));
        const rows = [];
        mcqSelectedIds.forEach(id => { if (pool.has(id)) rows.push(pool.get(id)); });
        const allPassages = passages.concat(...Object.values(mcqExportCache_).map(c => c.passages || []));
        const papers = new Set(rows.map(r => String(r.collection_id_ref || "")));
        const title = papers.size === 1 && rows.length ? mcqExportPaperTitle_(rows[0].collection_id_ref) : "";
        return { rows: mcqExportSortRows_(rows), passages: allPassages, title, missing: mcqSelectedIds.size - rows.length };
    }
    if (scope === "paper") {
        const p = await mcqExportGetPaper_(mcqHubPaperId_);
        return { rows: p.rows, passages: p.passages, title: mcqExportPaperTitle_(mcqHubPaperId_, p.info), missing: 0 };
    }
    // "view" = what the page shows now (filters applied), in the shown order.
    const rows = (currentMcqs || []).map(slot => slot.variants[slot.primaryKey || slot.languages[0]] || slot);
    const title = currentCollectionView ? mcqExportPaperTitle_(currentCollectionView.id) : ((currentMcqTopic && currentMcqTopic.title) || "");
    return { rows, passages, title, missing: 0 };
}

function mcqExportTabHtml_() {
    const o = mcqExportLoadOpts_();
    const chk = (key, label) => `<label class="mcq-exp-check"><input type="checkbox" data-exp-opt="${key}"${o[key] ? " checked" : ""}> ${label}</label>`;
    return `
        <div class="mcq-hub-card mcq-exp">
            <div class="mcq-exp-row">
                <label>Scope
                    <select id="mcq-exp-scope">
                        <option value="selected">Selected (0)</option>
                        <option value="paper">Whole paper</option>
                        <option value="view">Current view (filtered)</option>
                    </select>
                </label>
                <label>Layout
                    <select id="mcq-exp-layout">
                        <option value="full">Questions + answers</option>
                        <option value="questions">Questions only (no answers)</option>
                        <option value="key">Answer key only</option>
                    </select>
                </label>
                <label id="mcq-exp-lang-wrap">Language
                    <select id="mcq-exp-lang"></select>
                </label>
            </div>
            <div class="mcq-exp-checks" id="mcq-exp-checks">
                ${chk("number", "Question number")}${chk("question", "Question")}${chk("options", "Options")}
                ${chk("correct", "Correct answer")}${chk("explanation", "Explanation")}${chk("passage", "Passage text")}
                ${chk("tags", "Tags")}${chk("source", "Source info")}
            </div>
            <div id="mcq-exp-hint" class="mcq-hub-note"></div>
            <textarea id="mcq-exp-preview" class="mcq-exp-preview" readonly rows="12" spellcheck="false"></textarea>
            <div class="mcq-hub-card-actions">
                <button type="button" class="content-action" id="mcq-exp-copy">📋 Copy</button>
                <button type="button" class="content-action" id="mcq-exp-print">🖨️ Print / Save as PDF</button>
                <button type="button" class="content-action" id="mcq-exp-md">⬇️ .md</button>
                <button type="button" class="content-action" id="mcq-exp-csv">⬇️ .csv</button>
                ${mcqOwnerToolsOn_() ? `<button type="button" class="content-action" id="mcq-exp-to-ai">🤖 AI correction</button>` : ""}
            </div>
            <div id="mcq-exp-status" class="mcq-hub-note" aria-live="polite"></div>
        </div>`;
}

function mcqExportReadOpts_(body) {
    const o = mcqExportLoadOpts_();
    body.querySelectorAll("[data-exp-opt]").forEach(cb => { o[cb.dataset.expOpt] = cb.checked; });
    o.layout = body.querySelector("#mcq-exp-layout").value;
    o.lang = body.querySelector("#mcq-exp-lang").value || "1";
    return o;
}

function mcqExportCurrentBody_() {
    const body = document.getElementById("mcq-hub-body");
    return (body && body.querySelector("#mcq-exp-preview")) ? body : null;
}

async function mcqExportRefresh_() {
    const body = mcqExportCurrentBody_();
    if (!body) return;
    const token = ++mcqExportToken_;
    const scopeSel = body.querySelector("#mcq-exp-scope");
    const hint = body.querySelector("#mcq-exp-hint");
    const preview = body.querySelector("#mcq-exp-preview");
    const buttons = ["copy", "print", "md", "csv"].map(k => body.querySelector("#mcq-exp-" + k));

    scopeSel.options[0].textContent = "Selected (" + mcqSelectedIds.size + ")";
    scopeSel.value = mcqExportScope_;
    const setButtons = on => buttons.forEach(b => { b.disabled = !on; });

    let res;
    try {
        preview.value = "Loading…";
        setButtons(false);
        res = await mcqExportResolveScope_(mcqExportScope_);
    } catch (err) {
        if (token !== mcqExportToken_) return;
        console.warn("Export: could not load questions", err);
        preview.value = "";
        hint.textContent = "Could not load this paper. Check your internet and try again.";
        return;
    }
    if (token !== mcqExportToken_) return;

    // Language choices follow the questions in scope.
    const langSel = body.querySelector("#mcq-exp-lang");
    const hasAlt = res.rows.some(mcqExportHasAlt_);
    const first = res.rows[0];
    const l1 = (first && String(first.language || "").trim()) || "Language 1";
    const altRow = res.rows.find(mcqExportHasAlt_);
    const l2 = (altRow && String(altRow.alt_language || "").trim()) || "Language 2";
    const saved = mcqExportLoadOpts_().lang;
    langSel.innerHTML = hasAlt
        ? `<option value="1">${mcqExportEsc_(l1)}</option><option value="2">${mcqExportEsc_(l2)}</option><option value="both">Both</option>`
        : `<option value="1">${mcqExportEsc_(l1)}</option>`;
    langSel.value = hasAlt ? saved : "1";
    if (!langSel.value) langSel.value = "1";
    body.querySelector("#mcq-exp-lang-wrap").hidden = !hasAlt;

    const opts = mcqExportReadOpts_(body);
    opts.paperTitle = res.title;
    // Grey out choices the layout makes meaningless (stored values stay as they are).
    const layout = opts.layout;
    body.querySelectorAll("[data-exp-opt]").forEach(cb => {
        const k = cb.dataset.expOpt;
        cb.disabled = layout === "key" || (layout === "questions" && (k === "correct" || k === "explanation"));
    });

    const built = buildMcqExport(res.rows, res.passages, opts);
    mcqExportLast_ = { res, opts, built };
    preview.value = built.text;

    const needTick = mcqExportScope_ === "selected" && mcqSelectedIds.size === 0;
    const empty = built.count === 0;
    hint.textContent = needTick ? "Tick some questions first."
        : empty ? "No questions in this scope."
        : (res.missing > 0 ? res.missing + " selected question(s) are not loaded right now and were skipped. " : "") + built.count + " question" + (built.count === 1 ? "" : "s") + " in preview.";
    setButtons(!(needTick || empty));
}

function mcqExportStatus_(msg) {
    const el = document.querySelector("#mcq-hub-body #mcq-exp-status");
    if (el) el.textContent = msg;
}

async function mcqExportCopyText_(text) {
    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch (e) { /* fall through to the old way */ }
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    let ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    ta.remove();
    return ok;
}

function mcqExportDownload_(content, fileName, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function mcqExportPrint_(last) {
    let root = document.getElementById("mcq-print-root");
    if (!root) {
        root = document.createElement("div");
        root.id = "mcq-print-root";
        document.body.appendChild(root);   // direct child of <body> (print CSS relies on it)
    }
    const d = new Date();
    const dateText = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    root.innerHTML = buildMcqPrintHtml(last.res.rows, last.res.passages, last.opts,
        typeof renderRichInline === "function" ? renderRichInline : null, dateText);
    document.body.classList.add("mcq-printing");
    let cleaned = false;
    const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        document.body.classList.remove("mcq-printing");
        root.innerHTML = "";
        window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);
    setTimeout(cleanup, 120000);           // safety net if afterprint never fires
    setTimeout(() => { try { window.print(); } catch (e) { cleanup(); } }, 50);
}

function mcqExportBind_(body) {
    mcqExportCache_ = {};
    if (!mcqExportScope_) mcqExportScope_ = mcqSelectedIds.size ? "selected" : "paper";

    body.querySelectorAll("[data-exp-opt]").forEach(cb => cb.addEventListener("change", () => {
        mcqExportSaveOpts_(mcqExportReadOpts_(body));
        mcqExportRefresh_();
    }));
    body.querySelector("#mcq-exp-layout").value = mcqExportLoadOpts_().layout;
    body.querySelector("#mcq-exp-layout").addEventListener("change", () => {
        mcqExportSaveOpts_(mcqExportReadOpts_(body));
        mcqExportRefresh_();
    });
    body.querySelector("#mcq-exp-lang").addEventListener("change", () => {
        mcqExportSaveOpts_(mcqExportReadOpts_(body));
        mcqExportRefresh_();
    });
    body.querySelector("#mcq-exp-scope").addEventListener("change", e => {
        mcqExportScope_ = e.target.value;
        mcqExportRefresh_();
    });

    body.querySelector("#mcq-exp-copy").addEventListener("click", async () => {
        if (!mcqExportLast_) return;
        const ok = await mcqExportCopyText_(mcqExportLast_.built.text);
        mcqExportStatus_(ok ? "Copied ✓ (" + mcqExportLast_.built.count + " questions)"
                            : "Could not copy — select the text in the box and copy it by hand.");
    });
    body.querySelector("#mcq-exp-print").addEventListener("click", () => {
        if (mcqExportLast_) mcqExportPrint_(mcqExportLast_);
    });
    body.querySelector("#mcq-exp-md").addEventListener("click", () => {
        if (!mcqExportLast_) return;
        mcqExportDownload_(mcqExportLast_.built.md, mcqExportFileName_(mcqExportLast_.res.title, "md"), "text/markdown;charset=utf-8");
        mcqExportStatus_("Downloaded .md (" + mcqExportLast_.built.count + " questions)");
    });
    body.querySelector("#mcq-exp-csv").addEventListener("click", () => {
        if (!mcqExportLast_) return;
        // BOM first so Excel shows Hindi correctly.
        mcqExportDownload_("\uFEFF" + mcqExportCsvString_(mcqExportLast_.built.csvRows),
            mcqExportFileName_(mcqExportLast_.res.title, "csv"), "text/csv;charset=utf-8");
        mcqExportStatus_("Downloaded .csv (" + mcqExportLast_.built.count + " questions)");
    });

    // H4 shortcut: same questions, but as an AI correction prompt (Correct tab).
    body.querySelector("#mcq-exp-to-ai")?.addEventListener("click", () => {
        if (window.mcqReviewOpenAi_) window.mcqReviewOpenAi_(mcqExportScope_ === "paper" ? "paper" : "selected");
    });

    mcqExportRefresh_();
}

// mcq.js calls this whenever ticks change (so the preview follows the selection).
if (typeof window !== "undefined") window.mcqExportOnSelectionChange_ = function () {
    if (mcqExportCurrentBody_() && mcqExportScope_ === "selected") mcqExportRefresh_();
    else if (mcqExportCurrentBody_()) {
        const sel = document.querySelector("#mcq-hub-body #mcq-exp-scope");
        if (sel) sel.options[0].textContent = "Selected (" + mcqSelectedIds.size + ")";
    }
};
