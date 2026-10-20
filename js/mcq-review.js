/* =========================================================
   MCQ HUB — H4 (Correct tab: Review mode + AI correction)
   Part 1  pure functions (node-testable, no DOM):
           draft helpers, buildMcqCorrectionPrompt, parseMcqCorrectionReply
   Part 2  Review mode UI + AI prompt / paste-back UI
   Plain globals, loaded AFTER mcq-correct.js and BEFORE mcq-hub.js.
   Saves go ONLY through mcqBulkSaveAndVerify (mcq-correct.js).
   AI text is NEVER saved from the paste-back screen: it only fills
   Review drafts, which a person reads and saves.
   ========================================================= */

/* ---------------- PART 1 — pure functions ---------------- */

const MCQ_RV_LETTERS_ = "ABCDEF";
const MCQ_RV_OPT_KEYS_ = ["option_a", "option_b", "option_c", "option_d", "option_e", "option_f"];
const MCQ_RV_ALT_KEYS_ = MCQ_RV_OPT_KEYS_.map(k => k + "_alt");

// Names the AI may use in its reply (reply name -> Sheet column).
const MCQ_RV_REPLY_NAMES_ = ["correct", "question"].concat(MCQ_RV_OPT_KEYS_, ["explanation", "question_alt"], MCQ_RV_ALT_KEYS_, ["explanation_alt"]);
const MCQ_RV_SINGLE_LINE_ = new Set(["correct"].concat(MCQ_RV_OPT_KEYS_, MCQ_RV_ALT_KEYS_));

function mcqRvNorm_(value) {
    return String(value === undefined || value === null ? "" : value).replace(/\r\n?/g, "\n").trim();
}

function mcqRvSavedOption_(row) {
    const s = String(row && row.correct_option !== undefined && row.correct_option !== null ? row.correct_option : "").trim().toUpperCase();
    if (/^[1-6]$/.test(s)) return Number(s);
    const i = MCQ_RV_LETTERS_.indexOf(s);
    return (s.length === 1 && i >= 0) ? i + 1 : 0;
}

function mcqRvOptionCount_(row) {
    return Math.min(6, Math.max(2, ((row && row.options) || []).length));
}

function mcqRvHasAlt_(row) {
    return !!(String((row && row.question_alt) || "").trim() || String((row && row.alt_language) || "").trim());
}

// Sheet columns a person / the AI may change for this question in Review.
// origin / derived_from are NOT here (they stay in the pencil). Options cannot be added or removed.
function mcqRvAllowedFields_(row) {
    const n = mcqRvOptionCount_(row);
    const out = ["question"].concat(MCQ_RV_OPT_KEYS_.slice(0, n), ["correct_option", "explanation"]);
    if (mcqRvHasAlt_(row)) out.push("question_alt", ...MCQ_RV_ALT_KEYS_.slice(0, n), "explanation_alt");
    return out;
}

// Current (saved) value of one field: a number for correct_option (0 = none), text otherwise.
function mcqRvOriginal_(row, field) {
    if (field === "correct_option") {
        const n = mcqRvSavedOption_(row);
        return n > mcqRvOptionCount_(row) ? 0 : n;
    }
    const oi = MCQ_RV_OPT_KEYS_.indexOf(field);
    if (oi >= 0) return String(((row && row.options) || [])[oi] ?? "");
    return String(row && row[field] !== undefined && row[field] !== null ? row[field] : "");
}

function mcqRvIsChanged_(row, field, value) {
    if (field === "correct_option") return Number(value) !== mcqRvOriginal_(row, field);
    return mcqRvNorm_(value) !== mcqRvNorm_(mcqRvOriginal_(row, field));
}

// drafts: Map(mcq_id -> {field: newValue}). Holds ONLY changed fields.
function mcqRvSetDraft_(drafts, row, field, value) {
    const id = String(row.id);
    const cur = drafts.get(id) || {};
    if (mcqRvIsChanged_(row, field, value)) cur[field] = value;
    else delete cur[field];
    if (Object.keys(cur).length) drafts.set(id, cur); else drafts.delete(id);
}

function mcqRvDraftCount_(drafts) {
    let fields = 0;
    drafts.forEach(d => { fields += Object.keys(d).length; });
    return { questions: drafts.size, fields };
}

// Drop drafts for unknown questions / not-allowed fields / values equal to the saved value.
function mcqRvPrune_(drafts, rowsById) {
    Array.from(drafts.keys()).forEach(id => {
        const row = rowsById.get(id);
        if (!row) { drafts.delete(id); return; }
        const allowed = new Set(mcqRvAllowedFields_(row));
        const d = drafts.get(id);
        Object.keys(d).forEach(f => { if (!allowed.has(f) || !mcqRvIsChanged_(row, f, d[f])) delete d[f]; });
        if (!Object.keys(d).length) drafts.delete(id);
    });
}

// Drafts -> bulk-save updates (text trimmed, correct_option as a number 1-6).
function mcqRvBuildUpdates_(drafts, rowsById) {
    const out = [];
    drafts.forEach((d, id) => {
        const row = rowsById.get(id);
        if (!row) return;
        const fields = {};
        Object.keys(d).forEach(f => {
            if (!mcqRvIsChanged_(row, f, d[f])) return;
            fields[f] = f === "correct_option" ? Number(d[f]) : mcqRvNorm_(d[f]);
        });
        if (Object.keys(fields).length) out.push({ mcq_id: id, fields });
    });
    out.sort((a, b) => (Number(rowsById.get(a.mcq_id).question_no) || 1e9) - (Number(rowsById.get(b.mcq_id).question_no) || 1e9));
    return out;
}

// Language 1 question / options must never be emptied (that would remove an option).
function mcqRvValidate_(drafts, rowsById) {
    const problems = [];
    drafts.forEach((d, id) => {
        const row = rowsById.get(id);
        if (!row) return;
        Object.keys(d).forEach(f => {
            if ((f === "question" || MCQ_RV_OPT_KEYS_.indexOf(f) >= 0) && !mcqRvNorm_(d[f])) {
                problems.push({ mcq_id: id, qno: Number(row.question_no) || 0, field: f,
                    msg: mcqRvFieldLabel_(f) + " cannot be empty (options cannot be removed here)." });
            }
        });
    });
    return problems;
}

function mcqRvSerialize_(drafts) {
    const o = {};
    drafts.forEach((d, id) => { o[id] = d; });
    return o;
}

function mcqRvDeserialize_(obj) {
    const m = new Map();
    if (obj && typeof obj === "object") {
        Object.keys(obj).forEach(id => {
            const d = obj[id];
            if (d && typeof d === "object") m.set(String(id), Object.assign({}, d));
        });
    }
    return m;
}

function mcqRvFieldLabel_(field) {
    if (field === "correct_option" || field === "correct") return "Correct answer";
    if (field === "question") return "Question";
    if (field === "explanation") return "Explanation";
    if (field === "question_alt") return "Question (Language 2)";
    if (field === "explanation_alt") return "Explanation (Language 2)";
    const m = /^option_([a-f])(_alt)?$/.exec(field);
    return m ? "Option " + m[1].toUpperCase() + (m[2] ? " (Language 2)" : "") : field;
}

/* ---- AI prompt ---- */

// rows: mapped MCQ rows in paper order. opts: { verify, rewrite, typos, translation, extra,
//   passages, paperTitle, explanationRules }.
// explanationRules defaults to the global MCQ_EXPLANATION_FORMAT_RULE_ from mcq.js — the SAME
// text the Add MCQs prompt uses, so corrected explanations render identically.
function buildMcqCorrectionPrompt(rows, opts) {
    opts = opts || {};
    rows = rows || [];
    if (!rows.length) throw new Error("No questions to put in the prompt.");
    const extra = String(opts.extra || "").trim();
    if (!opts.verify && !opts.rewrite && !opts.typos && !opts.translation && !extra) {
        throw new Error("Tick at least one task (or write extra instructions).");
    }
    const rules = String(opts.explanationRules ||
        (typeof MCQ_EXPLANATION_FORMAT_RULE_ !== "undefined" ? MCQ_EXPLANATION_FORMAT_RULE_ : "")).trim();
    if ((opts.rewrite || opts.verify) && !rules) throw new Error("The explanation rules are missing (mcq.js did not load).");

    const body = buildMcqExport(rows, opts.passages || [], {
        number: true, question: true, options: true, correct: true, explanation: true,
        passage: true, tags: false, source: false, lang: "both", layout: "full",
        paperTitle: opts.paperTitle || ""
    }).text;

    const lines = [];
    lines.push("You are an expert exam-question editor. Check the " + rows.length + " multiple-choice question" + (rows.length === 1 ? "" : "s") +
        " below. Each may also have a second-language version (for example Hindi). Reply ONLY in the strict format described under REPLY FORMAT.");
    lines.push("", "TASKS");
    if (opts.verify) lines.push("- Verify the correct answer of every question. If the current answer is right, write nothing for `correct`. If it is wrong, give the right letter in `correct` AND a matching new `explanation` (and `explanation_alt` when a second language exists).");
    if (opts.rewrite) lines.push("- Rewrite the explanation of every question (and `explanation_alt` where a second language exists) following EXPLANATION STYLE below.");
    if (opts.typos) lines.push("- Fix spelling, typing and punctuation mistakes in the question and in the options. Do not change the meaning. Only list a field if it really needs a fix.");
    if (opts.translation) lines.push("- Check that the second-language text (question, options, explanation) says the same thing as the first language. Fix only what is wrong, using the `_alt` fields.");
    if (extra) lines.push("- Extra instructions from the owner: " + extra);

    if (rules && (opts.rewrite || opts.verify)) {
        lines.push("", "EXPLANATION STYLE (for `explanation` and `explanation_alt`)");
        lines.push("- Explanation format: " + rules);
        lines.push("- Write `explanation` in the SAME language as the question; `explanation_alt` in the second language with the same structure.");
    }

    lines.push("", "REPLY FORMAT (strict)");
    lines.push("Use one block per question that needs a change. Start each block with `## Q<number>` (the number printed before each question below), then one `field: value` per line:");
    lines.push("");
    lines.push("## Q7");
    lines.push("correct: B");
    lines.push("explanation: ...(may span several lines)");
    lines.push("explanation_alt: ...");
    lines.push("## Q9");
    lines.push("question: ...");
    lines.push("option_c: ...");
    lines.push("");
    lines.push("Rules:");
    lines.push("- Valid field names are exactly: correct, question, option_a, option_b, option_c, option_d, option_e, option_f, explanation, question_alt, option_a_alt, option_b_alt, option_c_alt, option_d_alt, option_e_alt, option_f_alt, explanation_alt.");
    lines.push("- Only include fields that must change. Leave everything else out. If the existing answer is right, say nothing for `correct`.");
    lines.push("- `correct` is ONE letter (A-F) and applies to both languages.");
    lines.push("- Never reorder options and never add or remove options. Use option_e / option_f only if that option already exists in the question.");
    lines.push("- Keep Hindi (or any second language) in its own script (Devanagari for Hindi).");
    lines.push("- A value may continue over several lines (blank lines are fine). Never start a line inside a value with a field name followed by a colon.");
    lines.push("- No markdown code fences, no extra commentary, no text before the first `## Q`. If nothing needs to change, reply with the single word: NONE");

    lines.push("", "QUESTIONS" + (opts.paperTitle ? " (" + opts.paperTitle + ")" : ""));
    lines.push(body);
    return lines.join("\n");
}

/* ---- Paste-back parser ---- */

function mcqRvDigits_(text) {
    return String(text).replace(/[\u0966-\u096F]/g, ch => String(ch.charCodeAt(0) - 0x0966));
}

const MCQ_RV_HEADER_RE_ = /^\s*(?:#{1,6}\s*)?(?:\*\*|__)?\s*[Qq]\.?\s*([0-9\u0966-\u096F]+)\s*(?:\*\*|__)?\s*[:.\-\u2013\u2014]?\s*(?:\*\*|__)?\s*$/;
const MCQ_RV_FIELD_RE_ = /^\s*(?:[-*\u2022]\s+)?(?:\*\*|__)?\s*([A-Za-z][A-Za-z0-9_ \-]{0,30}?)\s*(?:\*\*|__)?\s*:\s*(?:\*\*|__)?\s*(.*)$/;
const MCQ_RV_FENCE_RE_ = /^\s*```[\w-]*\s*$/;
const MCQ_RV_ONE_TOKEN_RE_ = /^\(?\s*[A-Za-z0-9\u0966-\u096F]\s*\)?$/;

function mcqRvCleanToken_(s) {
    return mcqRvDigits_(String(s).replace(/\*\*|__/g, "").trim().replace(/[.,;]+$/, "").trim());
}

// text: the AI's reply. rowsByQuestionNo: Map or plain object  question_no -> mapped row.
// Returns { items:[{qno,id,field,name,before,after}], ignored:[{qno,field,reason,text}], questions, fields }.
//   field  = Sheet column (correct_option for `correct`); before/after are numbers for correct_option.
// Rules (documented in CHECKPOINT_HUB_H4.md):
//  * a block starts at a line that is only "Q7" / "## Q7" / "### Q7" / "**Q7**";
//  * a value continues until the next KNOWN `field:` line, the next block, or the end;
//  * `correct:` is a field line only when what follows is ONE character (B, 2, Z...); a longer
//    `correct: the capital is ...` inside a multi-line value is treated as ordinary prose;
//  * an unknown `name:` line ends a single-line field (correct / option_*) and is reported as
//    ignored; inside a multi-line value (question / explanation) it is kept as prose unless the
//    name has an underscore or starts with option / question / explanation / answer / correct / why;
//  * nothing here ever touches the Sheet.
function parseMcqCorrectionReply(text, rowsByQuestionNo) {
    const getRow = qno => (rowsByQuestionNo instanceof Map) ? rowsByQuestionNo.get(qno) : (rowsByQuestionNo || {})[qno];
    const res = { items: [], ignored: [], questions: 0, fields: 0 };
    const src = String(text === undefined || text === null ? "" : text).replace(/\r\n?/g, "\n");

    const blocks = [];
    let cur = null, field = null, stray = 0;
    src.split("\n").forEach(line => {
        if (MCQ_RV_FENCE_RE_.test(line)) return;
        const h = MCQ_RV_HEADER_RE_.exec(line);
        if (h) {
            cur = { qno: Number(mcqRvDigits_(h[1])), entries: [] };
            blocks.push(cur); field = null;
            return;
        }
        if (!cur) { if (line.trim()) stray++; return; }
        const f = MCQ_RV_FIELD_RE_.exec(line);
        if (f) {
            const rawName = f[1].trim();
            const name = rawName.toLowerCase().replace(/[\s\-]+/g, "_");
            const rest = f[2];
            const known = MCQ_RV_REPLY_NAMES_.indexOf(name) >= 0;
            let isField;
            if (known) {
                isField = !(name === "correct" && field && !MCQ_RV_SINGLE_LINE_.has(field.name) &&
                    !MCQ_RV_ONE_TOKEN_RE_.test(mcqRvCleanToken_(rest)));
            } else {
                const fieldLike = rawName.indexOf("_") >= 0 || /^(option|question|explanation|answer|correct|why)/i.test(rawName);
                isField = !field || field.unknown || MCQ_RV_SINGLE_LINE_.has(field.name) || fieldLike;
            }
            if (isField) {
                field = { name: known ? name : rawName, unknown: !known, lines: [rest] };
                cur.entries.push(field);
                return;
            }
        }
        if (field) field.lines.push(line);
        else if (line.trim()) stray++;
    });
    if (stray) res.ignored.push({ qno: null, field: "", reason: "text outside any question block (" + stray + " line" + (stray === 1 ? "" : "s") + ")", text: "" });

    const byKey = new Map();      // id|field -> index in res.items
    blocks.forEach(block => {
        const row = getRow(block.qno);
        if (!row) {
            res.ignored.push({ qno: block.qno, field: "", reason: "question number " + block.qno + " is not in this paper", text: "" });
            return;
        }
        const allowed = new Set(mcqRvAllowedFields_(row));
        const n = mcqRvOptionCount_(row);
        block.entries.forEach(entry => {
            // value: join lines, drop trailing separator lines (--- / ***), trim
            const ls = entry.lines.slice();
            while (ls.length && /^\s*(?:-{3,}|\*{3,}|_{3,})?\s*$/.test(ls[ls.length - 1])) ls.pop();
            let value = ls.join("\n").trim();
            const snippet = value.length > 60 ? value.slice(0, 60) + "…" : value;
            const ign = reason => res.ignored.push({ qno: block.qno, field: entry.name, reason, text: snippet });

            if (entry.unknown) { ign("unknown field name"); return; }
            const sheetField = entry.name === "correct" ? "correct_option" : entry.name;
            if (!allowed.has(sheetField)) {
                const om = /^option_([a-f])(_alt)?$/.exec(sheetField);
                if (om && MCQ_RV_LETTERS_.indexOf(om[1].toUpperCase()) >= n) ign("this question has only " + n + " options (options cannot be added)");
                else if (/_alt$/.test(sheetField)) ign("this question has no second language");
                else ign("field not allowed");
                return;
            }
            if (!value) { ign("empty value"); return; }

            let after, before;
            if (sheetField === "correct_option") {
                const tok = mcqRvCleanToken_(value).replace(/^\(\s*|\s*\)$/g, "").trim().toUpperCase();
                let opt = 0;
                if (/^[1-6]$/.test(tok)) opt = Number(tok);
                else if (/^[A-F]$/.test(tok)) opt = MCQ_RV_LETTERS_.indexOf(tok) + 1;
                if (!opt) { ign("could not read the answer \"" + snippet + "\" (use A-F or 1-6)"); return; }
                if (opt > n) { ign("option " + MCQ_RV_LETTERS_[opt - 1] + " does not exist (this question has " + n + " options)"); return; }
                after = opt; before = mcqRvOriginal_(row, sheetField);
                if (after === before) { ign("same as the current answer"); return; }
            } else {
                before = mcqRvOriginal_(row, sheetField);
                after = mcqRvNorm_(value);
                if (after === mcqRvNorm_(before)) { ign("same as the current text"); return; }
            }
            const key = String(row.id) + "|" + sheetField;
            const item = { qno: block.qno, id: String(row.id), field: sheetField, name: entry.name, before, after };
            if (byKey.has(key)) {
                res.ignored.push({ qno: block.qno, field: entry.name, reason: "repeated — the last one is used", text: "" });
                res.items[byKey.get(key)] = item;
            } else {
                byKey.set(key, res.items.length);
                res.items.push(item);
            }
        });
    });
    res.fields = res.items.length;
    res.questions = new Set(res.items.map(i => i.id)).size;
    return res;
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        buildMcqCorrectionPrompt, parseMcqCorrectionReply,
        mcqRvAllowedFields_, mcqRvOriginal_, mcqRvIsChanged_, mcqRvSetDraft_, mcqRvDraftCount_,
        mcqRvPrune_, mcqRvBuildUpdates_, mcqRvValidate_, mcqRvSerialize_, mcqRvDeserialize_, mcqRvFieldLabel_
    };
}

/* ---------------- PART 2 — UI (browser only) ---------------- */

const MCQ_RV_STORE_PREFIX_ = "alpha_mcq_review_";
const MCQ_AI_OPTS_KEY_ = "alpha_mcq_ai_opts";
const MCQ_AI_EXTRA_KEY_ = "alpha_mcq_ai_extra";

const mcqReviewState_ = {
    paperId: "", rows: [], rowsById: new Map(), loadedAt: 0, loading: false, error: "", token: 0,
    sub: "key",                         // "key" | "review" | "ai"
    scope: { mode: "selected", ids: [] }, // "selected" | "paper" | "ids"
    curId: "", drafts: new Map(), result: null, busy: false, restored: 0, notice: "",
    ai: { pasteText: "", parsed: null, ticks: {}, status: "", token: 0 }
};

function mcqRvStoreGet_(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
function mcqRvStoreSet_(key, value) { try { localStorage.setItem(key, value); } catch (e) { /* ignore */ } }

function mcqReviewLoadAiOpts_() {
    let o = { verify: true, rewrite: true, typos: false, translation: false };
    try { const raw = mcqRvStoreGet_(MCQ_AI_OPTS_KEY_); if (raw) o = Object.assign(o, JSON.parse(raw)); } catch (e) { /* ignore */ }
    return o;
}

/* ----- draft backup (sessionStorage, always in try/catch) ----- */
let mcqReviewPersistTimer_ = null;

function mcqReviewStoreKey_() { return MCQ_RV_STORE_PREFIX_ + mcqReviewState_.paperId; }

function mcqReviewFlush_() {
    clearTimeout(mcqReviewPersistTimer_);
    const st = mcqReviewState_;
    if (!st.paperId) return;
    try {
        if (st.drafts.size) {
            sessionStorage.setItem(mcqReviewStoreKey_(), JSON.stringify({ drafts: mcqRvSerialize_(st.drafts), scope: st.scope }));
        } else {
            sessionStorage.removeItem(mcqReviewStoreKey_());
        }
    } catch (e) { /* ignore */ }
}

function mcqReviewPersist_() {
    clearTimeout(mcqReviewPersistTimer_);
    mcqReviewPersistTimer_ = setTimeout(mcqReviewFlush_, 300);
}

function mcqReviewRestore_() {
    const st = mcqReviewState_;
    if (st.drafts.size) return;
    try {
        const raw = sessionStorage.getItem(mcqReviewStoreKey_());
        if (!raw) return;
        const data = JSON.parse(raw);
        const drafts = mcqRvDeserialize_(data && data.drafts);
        mcqRvPrune_(drafts, st.rowsById);
        if (!drafts.size) { sessionStorage.removeItem(mcqReviewStoreKey_()); return; }
        st.drafts = drafts;
        if (data.scope && data.scope.mode) st.scope = { mode: data.scope.mode, ids: Array.isArray(data.scope.ids) ? data.scope.ids : [] };
        st.restored = mcqRvDraftCount_(drafts).fields;
    } catch (e) { /* ignore */ }
}

if (typeof window !== "undefined") {
    window.addEventListener("pagehide", mcqReviewFlush_);
    window.addEventListener("beforeunload", mcqReviewFlush_);

    window.mcqReviewHasUnsaved_ = function () { return mcqReviewState_.drafts.size > 0; };
    window.mcqReviewDraftCount_ = function () { return mcqRvDraftCount_(mcqReviewState_.drafts); };
    window.mcqReviewDiscardAll_ = function () {
        const st = mcqReviewState_;
        st.drafts = new Map(); st.result = null; st.restored = 0; st.ai.parsed = null; st.ai.ticks = {};
        try { if (st.paperId) sessionStorage.removeItem(mcqReviewStoreKey_()); } catch (e) { /* ignore */ }
    };
}

/* ----- data ----- */

function mcqReviewSortRows_(rows) {
    return rows.map((r, i) => ({ r, i })).sort((a, b) =>
        ((Number(a.r.question_no) || 1e9) - (Number(b.r.question_no) || 1e9)) || (a.i - b.i)).map(x => x.r);
}

function mcqReviewSetRows_(rows) {
    const st = mcqReviewState_;
    st.rows = mcqReviewSortRows_(rows);
    st.rowsById = new Map(st.rows.map(r => [String(r.id), r]));
    st.loadedAt = Date.now();
    mcqRvPrune_(st.drafts, st.rowsById);
}

async function mcqReviewLoad_(paperId) {
    const st = mcqReviewState_;
    const token = ++st.token;
    st.loading = true; st.error = "";
    mcqReviewDraw_();
    try {
        const raw = await mcqBulkFetchRawRows_(paperId);
        if (token !== st.token) return;
        st.paperId = paperId;
        mcqReviewSetRows_(raw.filter(r => String(r.status || "").trim().toLowerCase() !== "archived").map(mapMcqRow));
        mcqReviewRestore_();
    } catch (err) {
        if (token !== st.token) return;
        console.warn("Review: load failed", err);
        st.error = "Could not load this paper from the Sheet. Check your internet and press Reload.";
    } finally {
        if (token === st.token) st.loading = false;
    }
    mcqReviewDraw_();
}

// Questions chosen by the scope (without the ones that only have drafts).
function mcqReviewScopeRows_() {
    const st = mcqReviewState_;
    if (st.scope.mode === "paper") return st.rows;
    if (st.scope.mode === "ids") { const s = new Set(st.scope.ids.map(String)); return st.rows.filter(r => s.has(String(r.id))); }
    return st.rows.filter(r => mcqSelectedIds.has(String(r.id)));
}

// Review shows the scope plus any question that already has a draft (nothing hides).
function mcqReviewEffectiveRows_() {
    const st = mcqReviewState_;
    const ids = new Set(mcqReviewScopeRows_().map(r => String(r.id)));
    st.drafts.forEach((d, id) => ids.add(id));
    return st.rows.filter(r => ids.has(String(r.id)));
}

function mcqReviewScopeLabel_() {
    const m = mcqReviewState_.scope.mode;
    return m === "paper" ? "whole paper" : (m === "ids" ? "AI-changed questions" : "selected questions");
}

/* ----- Correct tab shell (sub-views: Answer key · Review · AI correction) ----- */

const MCQ_RV_SUBS_ = [["key", "Answer key"], ["review", "Review"], ["ai", "AI correction"]];

function mcqCorrectShellHtml_() {
    return `<div class="mcq-sub-tabs" id="mcq-sub-tabs">${
        MCQ_RV_SUBS_.map(([k, label]) => `<button type="button" class="mcq-sub-tab" data-sub="${k}">${label}<span class="mcq-sub-badge" data-sub-badge="${k}" hidden></span></button>`).join("")
    }</div><div id="mcq-sub-body"></div>`;
}

function mcqCorrectShellBind_(body) {
    const st = mcqReviewState_;
    const paperId = String(mcqHubPaperId_ || "");
    if (st.paperId !== paperId) {
        st.paperId = paperId; st.rows = []; st.rowsById = new Map(); st.loadedAt = 0;
        st.drafts = new Map(); st.result = null; st.curId = ""; st.restored = 0; st.notice = "";
        st.scope = { mode: "selected", ids: [] }; st.ai.parsed = null; st.ai.ticks = {};
    }
    body.querySelector("#mcq-sub-tabs").addEventListener("click", e => {
        const b = e.target.closest && e.target.closest("[data-sub]");
        if (!b) return;
        st.sub = b.dataset.sub;
        mcqReviewDrawSub_();
    });
    mcqReviewDrawSub_();
}

function mcqReviewUpdateBadge_() {
    const st = mcqReviewState_;
    const el = document.querySelector("[data-sub-badge=\"review\"]");
    if (!el) return;
    const n = mcqRvDraftCount_(st.drafts).fields;
    el.hidden = !n;
    el.textContent = n ? String(n) : "";
}

function mcqReviewDrawSub_() {
    const st = mcqReviewState_;
    const sub = document.getElementById("mcq-sub-body");
    if (!sub) return;
    document.querySelectorAll("#mcq-sub-tabs .mcq-sub-tab").forEach(b => b.classList.toggle("active", b.dataset.sub === st.sub));
    mcqReviewUpdateBadge_();
    if (st.sub === "key") {
        sub.innerHTML = mcqCorrectTabHtml_();
        mcqCorrectBind_(sub);
        return;
    }
    sub.innerHTML = `<div id="mcq-rv-root"></div>`;
    const root = sub.querySelector("#mcq-rv-root");
    root.addEventListener("click", mcqReviewClick_);
    root.addEventListener("input", mcqReviewInput_);
    root.addEventListener("change", mcqReviewChange_);
    if (!st.paperId) { mcqReviewDraw_(); return; }
    const fresh = st.rows.length && (Date.now() - st.loadedAt) < 60000;
    if (st.busy || fresh) mcqReviewDraw_();
    else mcqReviewLoad_(st.paperId);
}

if (typeof window !== "undefined") {
// Open the Correct tab on a given sub-view (used by Export shortcut and by the answer-key screen).
window.mcqReviewOpenSub_ = function (sub, o) {
    const st = mcqReviewState_;
    st.sub = sub;
    if (o && o.scope) st.scope = { mode: o.scope, ids: o.ids || [] };
    mcqHubTab_ = "correct";
    if (document.getElementById("mcq-hub-modal")) mcqHubRender_();
    else if (typeof openMcqHub === "function") openMcqHub({ tab: "correct" });
};
window.mcqReviewOpenAi_ = function (scopeMode) {
    window.mcqReviewOpenSub_("ai", { scope: scopeMode === "paper" ? "paper" : "selected" });
};

window.mcqReviewOnSelectionChange_ = function () {
    const st = mcqReviewState_;
    if (!document.getElementById("mcq-rv-root") || st.busy || st.scope.mode !== "selected") return;
    mcqReviewDraw_();
};
}

/* ----- drawing ----- */

function mcqReviewDraw_() {
    const root = document.getElementById("mcq-rv-root");
    if (!root) return;
    const st = mcqReviewState_;
    const esc = mcqEscapeHtml;
    mcqReviewUpdateBadge_();
    if (!st.paperId) { root.innerHTML = `<p class="mcq-hub-empty">Select a paper above first.</p>`; return; }
    if (st.loading && !st.rows.length) { root.innerHTML = `<p class="mcq-hub-empty">Loading questions from the Sheet…</p>`; return; }
    if (st.error && !st.rows.length) {
        root.innerHTML = `<p class="mcq-hub-empty">${esc(st.error)}</p><div class="mcq-hub-card-actions"><button type="button" class="content-action" data-rv-act="reload">🔄 Reload</button></div>`;
        return;
    }
    if (!st.rows.length) { root.innerHTML = `<p class="mcq-hub-empty">This paper has no questions.</p>`; return; }
    if (st.sub === "ai") { mcqReviewDrawAi_(root); return; }

    const rows = mcqReviewEffectiveRows_();
    if (!rows.length) {
        root.innerHTML = `<div class="mcq-hub-card"><div class="mcq-hub-card-title">📝 Review</div>
            <p class="mcq-hub-note">No question is selected. Tick questions on the page (or use the “✔ selected” menu above), or review the whole paper.</p>
            <div class="mcq-hub-card-actions"><button type="button" class="content-action" data-rv-act="whole">Review whole paper (${st.rows.length})</button></div>
            <div id="mcq-rv-result"></div></div>`;
        mcqReviewDrawResult_();
        return;
    }
    if (!rows.some(r => String(r.id) === st.curId)) st.curId = String(rows[0].id);
    const idx = rows.findIndex(r => String(r.id) === st.curId);
    const row = rows[idx];
    const jump = rows.map(r => {
        const id = String(r.id);
        const cls = "mcq-rv-jbtn" + (st.drafts.has(id) ? " is-changed" : "") + (id === st.curId ? " is-cur" : "");
        return `<button type="button" class="${cls}" data-rv-go="${esc(id)}">${Number(r.question_no) || "?"}</button>`;
    }).join("");
    root.innerHTML = `
        <div class="mcq-hub-card mcq-rv">
            ${st.restored ? `<div class="mcq-hub-note">↻ Restored ${st.restored} unsaved edit${st.restored === 1 ? "" : "s"} from this browser session.</div>` : ""}
            ${st.notice ? `<div class="mcq-key-result is-ok">${esc(st.notice)}</div>` : ""}
            <div class="mcq-rv-scope mcq-hub-note">Reviewing ${esc(mcqReviewScopeLabel_())} (${rows.length})
                ${st.scope.mode !== "paper" ? `· <button type="button" class="mcq-rv-link" data-rv-act="whole">review whole paper</button>` : ""}
                ${st.scope.mode !== "selected" ? `· <button type="button" class="mcq-rv-link" data-rv-act="usesel">use selected questions</button>` : ""}</div>
            <div class="mcq-rv-head">
                <button type="button" class="content-action" data-rv-nav="-1"${idx <= 0 ? " disabled" : ""}>◀ Prev</button>
                <b class="mcq-rv-title">Q${Number(row.question_no) || "?"} · ${idx + 1} of ${rows.length}</b>
                <button type="button" class="content-action" data-rv-nav="1"${idx >= rows.length - 1 ? " disabled" : ""}>Next ▶</button>
            </div>
            <div class="mcq-rv-jump" id="mcq-rv-jump">${jump}</div>
            <div id="mcq-rv-q">${mcqReviewQuestionHtml_(row)}</div>
            <div id="mcq-rv-result"></div>
            <div id="mcq-rv-foot" class="mcq-key-savebar"></div>
        </div>`;
    mcqReviewDrawResult_();
    mcqReviewDrawFoot_();
    st.restored = 0; st.notice = "";
}

function mcqRvDraftValue_(row, field) {
    const d = mcqReviewState_.drafts.get(String(row.id));
    return (d && d[field] !== undefined) ? d[field] : mcqRvOriginal_(row, field);
}

function mcqRvIsDraft_(row, field) {
    const d = mcqReviewState_.drafts.get(String(row.id));
    return !!(d && d[field] !== undefined);
}

function mcqRvMarkers_(row, field) {
    const on = mcqRvIsDraft_(row, field);
    return `<span class="mcq-rv-dot"${on ? "" : " hidden"}>● changed</span><button type="button" class="mcq-rv-link mcq-rv-reset" data-rv-reset="${field}"${on ? "" : " hidden"}>↩ reset</button>`;
}

function mcqRvFieldHtml_(row, field, label, tag) {
    const esc = mcqEscapeHtml;
    const val = mcqRvDraftValue_(row, field);
    const ctrl = tag === "textarea"
        ? `<textarea class="mcq-rv-input" data-rv-f="${field}" rows="${field.indexOf("explanation") === 0 ? 9 : 3}" spellcheck="false">${esc(val)}</textarea>`
        : `<input type="text" class="mcq-rv-input" data-rv-f="${field}" value="${esc(val)}" spellcheck="false">`;
    const isExp = field === "explanation" || field === "explanation_alt";
    const hasMath = isExp && /\$[^$\n]+\$/.test(String(val));
    const toggle = isExp ? `<button type="button" class="mcq-rv-link" data-rv-prev="${field}"${hasMath ? "" : " hidden"}>👁 preview</button>` : "";
    return `<div class="mcq-rv-field${mcqRvIsDraft_(row, field) ? " is-changed" : ""}" data-rv-wrap="${field}">
        <div class="mcq-rv-label"><span>${esc(label)}</span> ${mcqRvMarkers_(row, field)} ${toggle}</div>
        ${ctrl}${isExp ? `<div class="mcq-rv-preview" id="mcq-rv-pv-${field}" hidden></div>` : ""}
    </div>`;
}

function mcqReviewQuestionHtml_(row) {
    const esc = mcqEscapeHtml;
    const n = mcqRvOptionCount_(row);
    const hasAlt = mcqRvHasAlt_(row);
    const panel = (alt) => {
        const sfx = alt ? "_alt" : "";
        const title = alt ? (String(row.alt_language || "").trim() || "Language 2") : (String(row.language || "").trim() || "Language 1");
        let html = `<div class="mcq-rv-panel"><div class="mcq-rv-panel-title">${alt ? "Language 2" : "Language 1"} · ${esc(title)}</div>`;
        html += mcqRvFieldHtml_(row, "question" + sfx, "Question", "textarea");
        for (let i = 0; i < n; i++) html += mcqRvFieldHtml_(row, MCQ_RV_OPT_KEYS_[i] + sfx, "Option " + MCQ_RV_LETTERS_[i], "input");
        if (!alt) html += mcqReviewChipsHtml_(row);
        html += mcqRvFieldHtml_(row, "explanation" + sfx, "Explanation", "textarea");
        return html + `</div>`;
    };
    return panel(false) + (hasAlt ? panel(true) : "") +
        `<div class="mcq-hub-note">You can change option text here, but options cannot be added or removed. Origin / source fields stay in the ✏️ pencil on the question.</div>`;
}

function mcqReviewChipsHtml_(row) {
    const n = mcqRvOptionCount_(row);
    const saved = mcqRvOriginal_(row, "correct_option");
    const cur = Number(mcqRvDraftValue_(row, "correct_option")) || 0;
    let chips = "";
    for (let i = 1; i <= n; i++) {
        let cls = "mcq-key-chip";
        if (cur !== saved) { if (i === cur) cls += " is-changed"; else if (i === saved) cls += " was-saved"; }
        else if (i === saved) cls += " is-saved";
        chips += `<button type="button" class="${cls}" data-rv-chip="${i}" aria-pressed="${i === cur}">${MCQ_RV_LETTERS_[i - 1]}</button>`;
    }
    const flag = !cur ? `<span class="mcq-key-flag">no answer</span>` : "";
    return `<div class="mcq-rv-field${mcqRvIsDraft_(row, "correct_option") ? " is-changed" : ""}" data-rv-wrap="correct_option">
        <div class="mcq-rv-label"><span>Correct answer (both languages)</span> ${mcqRvMarkers_(row, "correct_option")} ${flag}</div>
        <div class="mcq-key-chips" id="mcq-rv-chips">${chips}</div></div>`;
}

function mcqReviewDrawFoot_() {
    const el = document.getElementById("mcq-rv-foot");
    if (!el) return;
    const st = mcqReviewState_;
    const c = mcqRvDraftCount_(st.drafts);
    el.innerHTML = `<span class="mcq-key-count">${c.fields ? c.fields + " unsaved edit" + (c.fields === 1 ? "" : "s") : "No changes"}</span>
        <button type="button" class="content-action" data-rv-act="discard"${c.fields && !st.busy ? "" : " disabled"}>Discard</button>
        <button type="button" class="content-action mcq-key-save" data-rv-act="save"${c.fields && !st.busy ? "" : " disabled"}>Save all (${c.questions} question${c.questions === 1 ? "" : "s"}, ${c.fields} field${c.fields === 1 ? "" : "s"})</button>`;
    mcqReviewUpdateBadge_();
}

function mcqRvShort_(v) {
    const s = String(v === undefined || v === null ? "" : v).replace(/\s+/g, " ").trim();
    return s.length > 80 ? s.slice(0, 80) + "…" : s;
}

function mcqReviewDrawResult_() {
    const el = document.getElementById("mcq-rv-result");
    if (!el) return;
    const st = mcqReviewState_;
    const r = st.result;
    const esc = mcqEscapeHtml;
    if (!r) { el.innerHTML = ""; return; }
    const undoBtn = (typeof lastBulkUndo !== "undefined" && lastBulkUndo && lastBulkUndo.paperId === st.paperId && !st.busy)
        ? `<button type="button" class="content-action" data-rv-act="undo">↩️ Undo last save</button>` : "";
    if (r.kind === "working") { el.innerHTML = `<div class="mcq-key-result">⏳ Saving and checking the Sheet…</div>`; return; }
    if (r.kind === "error") { el.innerHTML = `<div class="mcq-key-result is-bad">⚠️ ${esc(r.msg)}<div class="mcq-hub-card-actions">${undoBtn}</div></div>`; return; }
    if (r.kind === "undone") { el.innerHTML = `<div class="mcq-key-result is-ok">↩️ Undone — ${r.saved}/${r.total} restored and confirmed from the Sheet.</div>`; return; }
    if (r.kind === "ok") { el.innerHTML = `<div class="mcq-key-result is-ok">✔ Saved ${r.saved}/${r.total} and confirmed from the Sheet.<div class="mcq-hub-card-actions">${undoBtn}</div></div>`; return; }
    const lines = r.mismatches.map(m => {
        const row = st.rowsById.get(String(m.mcq_id));
        const q = row && row.question_no ? "Q" + row.question_no : esc(String(m.mcq_id));
        return `<li>${q}: ${esc(mcqRvFieldLabel_(m.field))} — expected “${esc(mcqRvShort_(m.expected))}”, Sheet has “${esc(mcqRvShort_(m.got))}”</li>`;
    }).join("");
    el.innerHTML = `<div class="mcq-key-result is-bad">⚠️ Saved ${r.saved}/${r.total} — the Sheet does not match for:
        <ul>${lines}</ul>
        <div class="mcq-hub-note">If every question failed, the new Apps Script version may not be deployed yet. Your edits are still here.</div>
        <div class="mcq-hub-card-actions"><button type="button" class="content-action" data-rv-act="save">🔁 Retry</button>${undoBtn}</div></div>`;
}

/* ----- events ----- */

function mcqReviewCurRow_() { return mcqReviewState_.rowsById.get(mcqReviewState_.curId); }

function mcqReviewRefreshRowUi_(row, field) {
    const wrap = document.querySelector(`#mcq-rv-q [data-rv-wrap="${field}"]`);
    if (wrap) {
        const on = mcqRvIsDraft_(row, field);
        wrap.classList.toggle("is-changed", on);
        wrap.querySelector(".mcq-rv-dot")?.toggleAttribute("hidden", !on);
        wrap.querySelector(".mcq-rv-reset")?.toggleAttribute("hidden", !on);
    }
    const jb = document.querySelector(`#mcq-rv-jump [data-rv-go="${CSS.escape(String(row.id))}"]`);
    if (jb) jb.classList.toggle("is-changed", mcqReviewState_.drafts.has(String(row.id)));
    mcqReviewDrawFoot_();
    mcqReviewPersist_();
}

function mcqReviewRenderPreview_(field) {
    const box = document.getElementById("mcq-rv-pv-" + field);
    const ta = document.querySelector(`#mcq-rv-q [data-rv-f="${field}"]`);
    if (!box || !ta || box.hidden) return;
    try {
        if (typeof mcqFeedbackBodyHtml === "function") box.innerHTML = mcqFeedbackBodyHtml({ explanation: ta.value }) || "<em>(empty)</em>";
        else box.textContent = "Preview is not available.";
    } catch (e) { box.textContent = "Preview is not available."; }
}

function mcqReviewInput_(e) {
    const f = e.target.dataset && e.target.dataset.rvF;
    if (f) {
        const st = mcqReviewState_;
        const row = mcqReviewCurRow_();
        if (!row) return;
        mcqRvSetDraft_(st.drafts, row, f, e.target.value);
        if (f === "explanation" || f === "explanation_alt") {
            const hasMath = /\$[^$\n]+\$/.test(e.target.value);
            const tog = document.querySelector(`#mcq-rv-q [data-rv-wrap="${f}"] [data-rv-prev]`);
            if (tog) tog.hidden = !hasMath;
            mcqReviewRenderPreview_(f);
        }
        const empty = (f === "question" || MCQ_RV_OPT_KEYS_.indexOf(f) >= 0) && !mcqRvNorm_(e.target.value);
        e.target.classList.toggle("is-invalid", empty);
        mcqReviewRefreshRowUi_(row, f);
        return;
    }
    if (e.target.id === "mcq-ai-paste") mcqReviewState_.ai.pasteText = e.target.value;
    else if (e.target.id === "mcq-ai-extra") { mcqRvStoreSet_(MCQ_AI_EXTRA_KEY_, e.target.value); mcqReviewAiPromptRefresh_(); }
}

function mcqReviewChange_(e) {
    if (e.target.matches && e.target.matches("[data-ai-task]")) {
        const o = mcqReviewAiReadOpts_();
        mcqRvStoreSet_(MCQ_AI_OPTS_KEY_, JSON.stringify({ verify: o.verify, rewrite: o.rewrite, typos: o.typos, translation: o.translation }));
        mcqReviewAiPromptRefresh_();
    }
}

function mcqReviewGo_(id) {
    mcqReviewState_.curId = String(id);
    mcqReviewDraw_();
    document.getElementById("mcq-rv-root")?.scrollIntoView({ block: "start", behavior: "smooth" });
}

async function mcqReviewSave_() {
    const st = mcqReviewState_;
    if (st.busy) return;
    const problems = mcqRvValidate_(st.drafts, st.rowsById);
    if (problems.length) {
        alert("Fix these first:\n" + problems.slice(0, 8).map(p => "Q" + (p.qno || "?") + ": " + p.msg).join("\n"));
        return;
    }
    const updates = mcqRvBuildUpdates_(st.drafts, st.rowsById);
    if (!updates.length) return;
    const c = mcqRvDraftCount_(st.drafts);
    if (c.fields > 10 && !confirm("Save " + c.fields + " edits in " + c.questions + " questions to the Sheet?")) return;
    st.busy = true; st.result = { kind: "working" };
    mcqReviewDrawResult_(); mcqReviewDrawFoot_();
    try {
        const out = await mcqBulkSaveAndVerify(st.paperId, updates);
        if (out.rows) mcqReviewSetRows_(out.rows);      // new originals; also prunes drafts that now equal the Sheet
        const bad = new Set(out.mismatches.map(m => String(m.mcq_id)).concat(out.notFound));
        // a question that did not verify keeps its draft untouched
        updates.forEach(u => { if (!bad.has(String(u.mcq_id)) && !st.drafts.has(String(u.mcq_id))) { /* saved */ } });
        st.result = out.ok
            ? { kind: "ok", saved: out.saved, total: out.total }
            : { kind: "mismatch", saved: out.saved, total: out.total, mismatches: out.mismatches };
        mcqReviewFlush_();                              // removes the sessionStorage backup when nothing is left
    } catch (err) {
        st.result = { kind: "error", msg: err.message || "Could not save. Your edits are still here." };
    } finally {
        st.busy = false;
    }
    mcqReviewDraw_();
    document.getElementById("mcq-rv-result")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

async function mcqReviewUndo_() {
    const st = mcqReviewState_;
    if (st.busy || typeof lastBulkUndo === "undefined" || !lastBulkUndo || lastBulkUndo.paperId !== st.paperId) return;
    if (!confirm("Put the previous text and answers back in the Sheet?")) return;
    const undo = lastBulkUndo;
    st.busy = true; st.result = { kind: "working" };
    mcqReviewDrawResult_(); mcqReviewDrawFoot_();
    try {
        const out = await mcqBulkSaveAndVerify(undo.paperId, undo.updates, { isUndo: true });
        if (out.rows) mcqReviewSetRows_(out.rows);
        st.result = out.ok
            ? { kind: "undone", saved: out.saved, total: out.total }
            : { kind: "mismatch", saved: out.saved, total: out.total, mismatches: out.mismatches };
    } catch (err) {
        st.result = { kind: "error", msg: err.message || "Could not undo." };
    } finally {
        st.busy = false;
    }
    mcqReviewDraw_();
}

function mcqReviewClick_(e) {
    const st = mcqReviewState_;
    const t = e.target;
    const go = t.closest && t.closest("[data-rv-go]");
    if (go) { mcqReviewGo_(go.dataset.rvGo); return; }
    const nav = t.closest && t.closest("[data-rv-nav]");
    if (nav) {
        const rows = mcqReviewEffectiveRows_();
        const i = rows.findIndex(r => String(r.id) === st.curId) + Number(nav.dataset.rvNav);
        if (i >= 0 && i < rows.length) mcqReviewGo_(rows[i].id);
        return;
    }
    const chip = t.closest && t.closest("[data-rv-chip]");
    if (chip) {
        const row = mcqReviewCurRow_();
        if (!row || st.busy) return;
        const opt = Number(chip.dataset.rvChip);
        const cur = Number(mcqRvDraftValue_(row, "correct_option")) || 0;
        // same chip again = back to the saved answer
        mcqRvSetDraft_(st.drafts, row, "correct_option", opt === cur && mcqRvIsDraft_(row, "correct_option") ? mcqRvOriginal_(row, "correct_option") : opt);
        const wrap = document.querySelector('#mcq-rv-q [data-rv-wrap="correct_option"]');
        if (wrap) wrap.outerHTML = mcqReviewChipsHtml_(row);
        mcqReviewRefreshRowUi_(row, "correct_option");
        return;
    }
    const reset = t.closest && t.closest("[data-rv-reset]");
    if (reset) {
        const row = mcqReviewCurRow_();
        if (!row) return;
        const f = reset.dataset.rvReset;
        mcqRvSetDraft_(st.drafts, row, f, mcqRvOriginal_(row, f));
        if (f === "correct_option") {
            const wrap = document.querySelector('#mcq-rv-q [data-rv-wrap="correct_option"]');
            if (wrap) wrap.outerHTML = mcqReviewChipsHtml_(row);
        } else {
            const ta = document.querySelector(`#mcq-rv-q [data-rv-f="${f}"]`);
            if (ta) { ta.value = mcqRvOriginal_(row, f); ta.classList.remove("is-invalid"); }
            if (f === "explanation" || f === "explanation_alt") mcqReviewRenderPreview_(f);
        }
        mcqReviewRefreshRowUi_(row, f);
        return;
    }
    const pv = t.closest && t.closest("[data-rv-prev]");
    if (pv) {
        const box = document.getElementById("mcq-rv-pv-" + pv.dataset.rvPrev);
        if (box) { box.hidden = !box.hidden; mcqReviewRenderPreview_(pv.dataset.rvPrev); }
        return;
    }
    const tick = t.closest && t.closest("[data-ai-tick]");
    if (tick) { st.ai.ticks[tick.dataset.aiTick] = tick.checked; mcqReviewAiCounters_(); return; }
    const act = t.closest && t.closest("[data-rv-act]");
    if (act) {
        const a = act.dataset.rvAct;
        if (a === "save") mcqReviewSave_();
        else if (a === "undo") mcqReviewUndo_();
        else if (a === "discard") {
            if (st.busy || !confirm("Throw away all unsaved edits in this paper?")) return;
            window.mcqReviewDiscardAll_();
            mcqReviewDraw_();
        } else if (a === "reload") { if (!st.busy) mcqReviewLoad_(st.paperId); }
        else if (a === "whole") { st.scope = { mode: "paper", ids: [] }; mcqReviewPersist_(); mcqReviewDraw_(); }
        else if (a === "usesel") { st.scope = { mode: "selected", ids: [] }; mcqReviewPersist_(); mcqReviewDraw_(); }
        else if (a === "ai-copy") mcqReviewAiCopy_();
        else if (a === "ai-read") mcqReviewAiRead_();
        else if (a === "ai-apply") mcqReviewAiApply_();
    }
}

/* ----- AI correction sub-view ----- */

function mcqReviewAiReadOpts_() {
    const root = document.getElementById("mcq-rv-root");
    const o = { verify: false, rewrite: false, typos: false, translation: false, extra: "" };
    if (!root) return Object.assign(o, mcqReviewLoadAiOpts_(), { extra: mcqRvStoreGet_(MCQ_AI_EXTRA_KEY_) || "" });
    root.querySelectorAll("[data-ai-task]").forEach(cb => { o[cb.dataset.aiTask] = cb.checked; });
    o.extra = (root.querySelector("#mcq-ai-extra") || {}).value || "";
    return o;
}

function mcqReviewDrawAi_(root) {
    const st = mcqReviewState_;
    const esc = mcqEscapeHtml;
    const o = mcqReviewLoadAiOpts_();
    const extra = mcqRvStoreGet_(MCQ_AI_EXTRA_KEY_) || "";
    const rows = mcqReviewScopeRows_();
    const chk = (k, label) => `<label class="mcq-exp-check"><input type="checkbox" data-ai-task="${k}"${o[k] ? " checked" : ""}> ${label}</label>`;
    root.innerHTML = `
        <div class="mcq-hub-card mcq-ai">
            <div class="mcq-hub-card-title">🤖 AI correction</div>
            <div class="mcq-hub-note"><b>Step 1</b> — copy the prompt, paste it into Gemini / ChatGPT. <b>Step 2</b> — paste its reply below. You check every change before anything is saved.</div>
            <div class="mcq-hub-note">Questions in the prompt: <b>${rows.length}</b> (${esc(mcqReviewScopeLabel_())})
                ${st.scope.mode !== "paper" ? `· <button type="button" class="mcq-rv-link" data-rv-act="whole">use whole paper (${st.rows.length})</button>` : ""}
                ${st.scope.mode !== "selected" ? `· <button type="button" class="mcq-rv-link" data-rv-act="usesel">use selected (${mcqSelectedIds.size})</button>` : ""}</div>
            ${rows.length > 25 ? `<div class="mcq-hub-note mcq-key-red">More than 25 questions in one prompt can make the AI skip some. Smaller batches are safer.</div>` : ""}
            <div class="mcq-exp-checks">
                ${chk("verify", "Verify the correct answer")}${chk("rewrite", "Rewrite the explanation")}
                ${chk("typos", "Fix typos in question/options")}${chk("translation", "Check Hindi translation matches English")}
            </div>
            <label class="mcq-rv-label" for="mcq-ai-extra">Extra instructions (remembered)</label>
            <textarea id="mcq-ai-extra" class="mcq-rv-input" rows="2" spellcheck="false" placeholder="e.g. keep explanations under 60 words">${esc(extra)}</textarea>
            <details class="mcq-key-paste"><summary>Show the prompt</summary>
                <textarea id="mcq-ai-prompt" class="mcq-exp-preview" readonly rows="10" spellcheck="false"></textarea></details>
            <div class="mcq-hub-card-actions"><button type="button" class="content-action" data-rv-act="ai-copy"${rows.length ? "" : " disabled"}>📋 Copy AI prompt</button></div>
            <div id="mcq-ai-status" class="mcq-hub-note" aria-live="polite">${rows.length ? "" : "Nothing selected — tick questions on the page or use the whole paper."}</div>
            <hr class="mcq-ai-sep">
            <div class="mcq-hub-card-title">Paste the AI's reply</div>
            <textarea id="mcq-ai-paste" class="mcq-rv-input" rows="6" spellcheck="false" placeholder="## Q7&#10;correct: B&#10;explanation: ...">${esc(st.ai.pasteText)}</textarea>
            <div class="mcq-hub-card-actions"><button type="button" class="content-action" data-rv-act="ai-read">Read reply</button></div>
            <div id="mcq-ai-preview"></div>
        </div>`;
    mcqReviewAiPromptRefresh_();
    mcqReviewAiDrawPreview_();
}

async function mcqReviewAiBuild_() {
    const st = mcqReviewState_;
    const rows = mcqReviewScopeRows_();
    let passages = (typeof mcqApiData !== "undefined" && mcqApiData && mcqApiData.passages) || [];
    if (rows.some(r => String(r.passage_id || "").trim())) {
        try { const p = await mcqExportGetPaper_(st.paperId); passages = passages.concat(p.passages || []); } catch (e) { /* keep what we have */ }
    }
    const o = mcqReviewAiReadOpts_();
    const info = typeof getMcqCollectionInfo === "function" ? getMcqCollectionInfo(st.paperId) : null;
    return { text: buildMcqCorrectionPrompt(rows, Object.assign({}, o, { passages, paperTitle: (info && info.title) || "" })), count: rows.length };
}

async function mcqReviewAiPromptRefresh_() {
    const box = document.getElementById("mcq-ai-prompt");
    if (!box) return;
    const token = ++mcqReviewState_.ai.token;
    try {
        const built = await mcqReviewAiBuild_();
        if (token === mcqReviewState_.ai.token && document.getElementById("mcq-ai-prompt")) box.value = built.text;
    } catch (err) {
        if (token === mcqReviewState_.ai.token && document.getElementById("mcq-ai-prompt")) box.value = "(" + err.message + ")";
    }
}

async function mcqReviewAiCopy_() {
    const status = document.getElementById("mcq-ai-status");
    try {
        const built = await mcqReviewAiBuild_();
        const ok = await mcqExportCopyText_(built.text);
        if (status) status.textContent = ok ? "Copied ✓ (" + built.count + " questions). Now paste it into your AI app."
            : "Could not copy — open “Show the prompt” and copy the text by hand.";
    } catch (err) {
        if (status) status.textContent = err.message || "Could not build the prompt.";
    }
}

function mcqReviewAiRead_() {
    const st = mcqReviewState_;
    const box = document.getElementById("mcq-ai-paste");
    st.ai.pasteText = box ? box.value : st.ai.pasteText;
    const byNo = new Map();
    st.rows.forEach(r => { const n = Number(r.question_no); if (n && !byNo.has(n)) byNo.set(n, r); });
    const parsed = parseMcqCorrectionReply(st.ai.pasteText, byNo);
    st.ai.parsed = parsed;
    st.ai.ticks = {};
    parsed.items.forEach(it => { st.ai.ticks[it.id + "|" + it.field] = true; });
    mcqReviewAiDrawPreview_();
}

function mcqReviewAiShow_(item, v) {
    const st = mcqReviewState_;
    if (item.field === "correct_option") {
        const row = st.rowsById.get(item.id);
        const n = Number(v) || 0;
        if (!n) return "(none)";
        return MCQ_RV_LETTERS_[n - 1] + (row && row.options && row.options[n - 1] ? ") " + row.options[n - 1] : "");
    }
    return String(v === undefined || v === null ? "" : v) || "(empty)";
}

function mcqReviewAiCounters_() {
    const st = mcqReviewState_;
    const el = document.getElementById("mcq-ai-counts");
    const p = st.ai.parsed;
    if (!el || !p) return;
    const on = p.items.filter(it => st.ai.ticks[it.id + "|" + it.field]);
    const qs = new Set(on.map(it => it.id)).size;
    el.innerHTML = `<b>${p.questions}</b> question${p.questions === 1 ? "" : "s"} · <b>${p.fields}</b> field${p.fields === 1 ? "" : "s"} · <b>${p.ignored.length}</b> ignored — ticked: ${on.length} field${on.length === 1 ? "" : "s"} in ${qs} question${qs === 1 ? "" : "s"}`;
    const btn = document.getElementById("mcq-ai-apply");
    if (btn) btn.disabled = !on.length;
}

function mcqReviewAiDrawPreview_() {
    const el = document.getElementById("mcq-ai-preview");
    if (!el) return;
    const st = mcqReviewState_;
    const p = st.ai.parsed;
    const esc = mcqEscapeHtml;
    if (!p) { el.innerHTML = ""; return; }
    const groups = new Map();
    p.items.forEach(it => { if (!groups.has(it.id)) groups.set(it.id, []); groups.get(it.id).push(it); });
    let html = `<div class="mcq-hub-note" id="mcq-ai-counts"></div>`;
    if (!p.items.length) html += `<p class="mcq-hub-empty">Nothing usable in this reply.</p>`;
    groups.forEach((items, id) => {
        const row = st.rowsById.get(id);
        html += `<div class="mcq-ai-q"><div class="mcq-ai-qtitle">Q${Number(row && row.question_no) || "?"}</div>`;
        items.forEach(it => {
            const key = it.id + "|" + it.field;
            html += `<div class="mcq-ai-item">
                <label class="mcq-exp-check"><input type="checkbox" data-ai-tick="${esc(key)}"${st.ai.ticks[key] ? " checked" : ""}> <b>${esc(mcqRvFieldLabel_(it.field))}</b></label>
                <div class="mcq-ai-old">${esc(mcqReviewAiShow_(it, it.before))}</div>
                <div class="mcq-ai-new">${esc(mcqReviewAiShow_(it, it.after))}</div></div>`;
        });
        html += `</div>`;
    });
    if (p.ignored.length) {
        html += `<details class="mcq-key-paste"><summary>${p.ignored.length} ignored (never applied)</summary><ul class="mcq-ai-ign">${
            p.ignored.map(g => `<li>${g.qno ? "Q" + esc(String(g.qno)) + " " : ""}${g.field ? "<code>" + esc(g.field) + "</code> " : ""}— ${esc(g.reason)}${g.text ? ` <span class="mcq-hub-note">“${esc(g.text)}”</span>` : ""}</li>`).join("")}</ul></details>`;
    }
    html += `<div class="mcq-hub-card-actions"><button type="button" class="content-action mcq-key-save" id="mcq-ai-apply" data-rv-act="ai-apply">Apply ticked changes to review drafts</button></div>
        <div class="mcq-hub-note">Nothing is saved to the Sheet from this screen. You will read the changes once more in Review, then press Save all.</div>`;
    el.innerHTML = html;
    mcqReviewAiCounters_();
}

function mcqReviewAiApply_() {
    const st = mcqReviewState_;
    const p = st.ai.parsed;
    if (!p) return;
    const on = p.items.filter(it => st.ai.ticks[it.id + "|" + it.field]);
    if (!on.length) { alert("Tick at least one change."); return; }
    on.forEach(it => {
        const row = st.rowsById.get(it.id);
        if (row) mcqRvSetDraft_(st.drafts, row, it.field, it.after);
    });
    const ids = Array.from(new Set(on.map(it => it.id)));
    st.scope = { mode: "ids", ids };
    st.sub = "review";
    st.curId = ids[0];
    st.result = null;
    st.notice = on.length + " AI change" + (on.length === 1 ? "" : "s") + " placed in " + ids.length + " question" + (ids.length === 1 ? "" : "s") + " as drafts. Read them, then press Save all.";
    mcqReviewFlush_();
    mcqReviewDrawSub_();
}
