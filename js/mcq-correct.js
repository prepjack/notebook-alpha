/* =========================================================
   MCQ HUB — H3 (Correct tab: Answer key + bulk save)
   Part 1  pure functions (node-testable, no DOM)
   Part 2  mcqBulkSaveAndVerify() — shared by H3 / H4 / H5
   Part 3  Correct tab UI
   Plain globals, loaded AFTER mcq-export.js and BEFORE mcq-hub.js.
   Uses from mcq.js: allLoadedMcqs, mcqApiData, mapMcqRow,
   applyMcqPracticeFilters, mcqSelectedIds, mcqUpdateSelectionUi_,
   mcqEscapeHtml, MCQ_GOOGLE_SHEET_API.
   ========================================================= */

/* ---------------- PART 1 — pure functions ---------------- */

const MCQ_KEY_LETTERS_ = "ABCDEF";

function mcqKeyLetter_(option) {
    const n = Number(option);
    return n >= 1 && n <= 6 ? MCQ_KEY_LETTERS_[n - 1] : "";
}

// Sheet value (1-6, "A"-"F", "", 0, junk) -> 1..6, or 0 when there is no answer.
function mcqCorrectSavedOption_(row) {
    const s = String(row && row.correct_option !== undefined && row.correct_option !== null ? row.correct_option : "")
        .trim().toUpperCase();
    if (/^[1-6]$/.test(s)) return Number(s);
    const i = MCQ_KEY_LETTERS_.indexOf(s);
    return (s.length === 1 && i >= 0) ? i + 1 : 0;
}

function mcqKeyDigits_(text) {
    // Devanagari digits ०-९ -> 0-9
    return String(text).replace(/[\u0966-\u096F]/g, ch => String(ch.charCodeAt(0) - 0x0966));
}

// Paste key -> answers. Matches by PAPER question number, never by list position
// (except the compact "ACBDA…" form, see below).
// questionNos / optionCounts: parallel arrays (paper question numbers, how many options each has).
// Returns { applied:[{qno,option}], unknown:[qno], invalid:[token], outOfRange:[token],
//           duplicates:[qno], compact:boolean, compactMismatch:null|{got,expected} }
// `option` is 1-6 (the number stored in the Sheet). Nothing is saved here.
function parseAnswerKey(text, questionNos, optionCounts) {
    const res = { applied: [], unknown: [], invalid: [], outOfRange: [], duplicates: [], compact: false, compactMismatch: null };
    const nos = (questionNos || []).map(Number);
    const counts = {};
    nos.forEach((n, i) => { if (counts[n] === undefined) counts[n] = Number(optionCounts && optionCounts[i]) || 4; });
    const s = mcqKeyDigits_(text).replace(/[\u2013\u2014]/g, "-").trim();
    if (!s) return res;

    // Compact form: only letters A-F, exactly one per question, in order.
    const squeezed = s.replace(/[\s,;|]+/g, "");
    if (/^[A-Fa-f]+$/.test(squeezed)) {
        if (squeezed.length === nos.length) {
            res.compact = true;
            squeezed.toUpperCase().split("").forEach((ch, i) => {
                const option = MCQ_KEY_LETTERS_.indexOf(ch) + 1;
                if (option > counts[nos[i]]) res.outOfRange.push(nos[i] + "-" + ch);
                else res.applied.push({ qno: nos[i], option });
            });
            return res;
        }
        res.compactMismatch = { got: squeezed.length, expected: nos.length };
    }

    const seen = new Map();
    const pairRe = /^(?:[Qq]\.?\s*)?(\d+)\s*(?:->|=>|[-.):=\u2192>])*\s*([A-Za-z]|\d)/;
    let i = 0;
    while (i < s.length) {
        if (/[\s,;|]/.test(s[i])) { i++; continue; }
        const rest = s.slice(i);
        const m = pairRe.exec(rest);
        let ok = false;
        if (m) {
            const after = rest[m[0].length] || "";
            const optTok = m[2];
            const isLetter = /[A-Za-z]/.test(optTok);
            ok = isLetter ? !/[A-Za-z]/.test(after) : !/\d/.test(after);
        }
        if (!ok) {
            const bad = /^[^\s,;|]+/.exec(rest)[0];
            res.invalid.push(bad);
            i += bad.length;
            continue;
        }
        i += m[0].length;
        const token = m[0].trim();
        const qno = Number(m[1]);
        const optTok = m[2].toUpperCase();
        let option = 0;
        if (/\d/.test(optTok)) option = Number(optTok);
        else option = MCQ_KEY_LETTERS_.indexOf(optTok) + 1;       // 0 when outside A-F
        if (option < 1 || option > 6) { res.invalid.push(token); continue; }
        if (counts[qno] === undefined) { if (res.unknown.indexOf(qno) === -1) res.unknown.push(qno); continue; }
        if (option > counts[qno]) { res.outOfRange.push(qno + "-" + MCQ_KEY_LETTERS_[option - 1]); continue; }
        if (seen.has(qno)) { if (res.duplicates.indexOf(qno) === -1) res.duplicates.push(qno); }
        seen.set(qno, option);
    }
    seen.forEach((option, qno) => res.applied.push({ qno, option }));
    res.applied.sort((a, b) => a.qno - b.qno);
    return res;
}

// rows: [{id, qno, saved}], pending: {id: option}. Only real differences are returned.
function buildAnswerKeyChanges_(rows, pending) {
    const out = [];
    (rows || []).forEach(r => {
        const to = Number(pending && pending[r.id]) || 0;
        if (to && to !== Number(r.saved || 0)) out.push({ id: r.id, qno: r.qno, from: Number(r.saved || 0), to });
    });
    return out;
}

function formatAnswerKeyChange_(c) {
    const q = c.qno ? "Q" + c.qno : "Q?";
    return q + ": " + (c.from ? mcqKeyLetter_(c.from) : "(none)") + " → " + mcqKeyLetter_(c.to);
}

function mcqBulkChunk_(list, size) {
    const out = [];
    for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
    return out;
}

function mcqBulkNorm_(field, value) {
    // H5 — the flag is only "yes" or blank (same rule as Code.gs normalizeNeedsCheck_)
    if (field === "needs_check") return /^(yes|y|true|1)$/i.test(String(value === undefined || value === null ? "" : value).trim()) ? "yes" : "";
    if (field === "correct_option") return String(mcqCorrectSavedOption_({ correct_option: value }));
    if (field === "origin") return String(value === undefined || value === null ? "" : value).trim().toLowerCase();
    return String(value === undefined || value === null ? "" : value).trim();
}

// Compare what we sent with the rows re-read from the Sheet.
// correct_option is compared as a number; text is trimmed.
function mcqBulkCompare_(updates, rawRows) {
    const byId = new Map();
    (rawRows || []).forEach(r => { if (!byId.has(String(r.mcq_id))) byId.set(String(r.mcq_id), r); });
    const out = [];
    (updates || []).forEach(u => {
        const row = byId.get(String(u.mcq_id));
        Object.keys(u.fields || {}).forEach(field => {
            if (!row) { out.push({ mcq_id: u.mcq_id, field, expected: u.fields[field], got: "(not found in Sheet)" }); return; }
            const exp = mcqBulkNorm_(field, u.fields[field]);
            const got = mcqBulkNorm_(field, row[field]);
            // safeSheetText_ may have stored a leading apostrophe on text that starts with = + -
            const same = exp === got || (field !== "correct_option" && got === "'" + exp);
            if (!same) out.push({ mcq_id: u.mcq_id, field, expected: u.fields[field], got: row[field] === undefined ? "" : row[field] });
        });
    });
    return out;
}

// Re-read up to `tries` times (a re-read can lag a second or two) until nothing mismatches.
// fetchRawRows: async () => array of raw Sheet rows.
async function mcqBulkVerify_(updates, fetchRawRows, opts) {
    opts = opts || {};
    const tries = opts.tries || 3;
    const delayMs = opts.delayMs === undefined ? 2000 : opts.delayMs;
    const sleep = opts.sleep || (ms => new Promise(r => setTimeout(r, ms)));
    let rows = null, mismatches = [], lastError = null, attempts = 0;
    for (let a = 1; a <= tries; a++) {
        attempts = a;
        try {
            rows = await fetchRawRows();
            mismatches = mcqBulkCompare_(updates, rows);
            lastError = null;
            if (!mismatches.length) break;
        } catch (err) {
            lastError = err;
        }
        if (a < tries) await sleep(delayMs);
    }
    if (lastError && !rows) throw lastError;
    return { mismatches, rows, attempts };
}

// Previous value to put back on Undo.
function mcqBulkPrevValue_(field, rawValue) {
    if (field === "correct_option") {
        const n = mcqCorrectSavedOption_({ correct_option: rawValue });
        return n ? n : "";
    }
    return rawValue === undefined || rawValue === null ? "" : String(rawValue);
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        parseAnswerKey, buildAnswerKeyChanges_, formatAnswerKeyChange_, mcqCorrectSavedOption_,
        mcqBulkChunk_, mcqBulkCompare_, mcqBulkVerify_, mcqBulkPrevValue_, mcqKeyLetter_, mcqBulkNorm_
    };
}

/* ---------------- PART 2 — shared save helper (browser) ---------------- */

// In memory only: what to put back for "↩️ Undo last save".
// { paperId, updates:[{mcq_id, fields:{<previous values>}}] }
let lastBulkUndo = null;

const MCQ_BULK_CHUNK_ = 100;

async function mcqBulkFetchRawRows_(paperId) {
    const url = MCQ_GOOGLE_SHEET_API + "?action=get_mcqs&collection_id=" + encodeURIComponent(paperId) +
        "&_=" + Date.now() + Math.floor(Math.random() * 1000);
    const response = await fetch(url);
    if (!response.ok) throw new Error("Sheet read failed (" + response.status + ")");
    const data = await response.json();
    return data.mcqs || [];
}

// Put re-read Sheet rows into the page's in-memory lists (same mapMcqRow mapping as loadFullMcqCollection).
function mcqApplyFreshRows_(paperId, rawRows) {
    const byId = new Map();
    (rawRows || []).forEach(r => byId.set(String(r.mcq_id), r));
    let touched = false;
    (allLoadedMcqs || []).forEach((m, i) => {
        const raw = byId.get(String(m.id));
        if (!raw || String(raw.status || "").trim().toLowerCase() === "archived") return;
        allLoadedMcqs[i] = mapMcqRow(raw);
        touched = true;
    });
    if (mcqApiData && Array.isArray(mcqApiData.mcqs)) {
        mcqApiData.mcqs.forEach((m, i) => {
            const raw = byId.get(String(m.mcq_id));
            if (raw) mcqApiData.mcqs[i] = Object.assign({}, m, raw);
        });
    }
    if (typeof mcqExportCache_ !== "undefined") delete mcqExportCache_[String(paperId)];
    return touched;
}

/* mcqBulkSaveAndVerify(paperId, updates, opts?)
   updates : [{ mcq_id, fields:{ correct_option:3, ... } }]   (content columns only)
   opts    : { isUndo:boolean, keepUndo:boolean (H5: do not touch lastBulkUndo — used for flag changes),
               noReset:boolean (H5: keep the running attempt/timer — used for flag changes) }
   Steps   : read Sheet (to remember previous values) -> POST in chunks of 100 ->
             re-read (up to 3x, 2 s apart) and compare -> refresh the page's data.
   Returns : { ok, saved, total, mismatches:[{mcq_id,field,expected,got}], notFound:[ids],
               attempts, rows }   (rows = fresh mapped rows of the paper, sorted by question_no)
   Throws  : Error with a friendly message when the Sheet cannot be reached BEFORE saving
             (nothing was written in that case). */
async function mcqBulkSaveAndVerify(paperId, updates, opts) {
    opts = opts || {};
    paperId = String(paperId || "");
    if (!paperId) throw new Error("No paper selected.");
    updates = (updates || []).filter(u => u && u.mcq_id && u.fields && Object.keys(u.fields).length);
    if (!updates.length) return { ok: true, saved: 0, total: 0, mismatches: [], notFound: [], attempts: 0, rows: null };

    // 1) previous values (for Undo) — also proves the Sheet is reachable before we write anything.
    let before;
    try {
        before = await mcqBulkFetchRawRows_(paperId);
    } catch (err) {
        console.warn("Bulk save: pre-read failed", err);
        throw new Error("Could not reach the Sheet. Nothing was saved. Check your internet and try again.");
    }
    const beforeById = new Map();
    before.forEach(r => { if (!beforeById.has(String(r.mcq_id))) beforeById.set(String(r.mcq_id), r); });
    const undoUpdates = [];
    const notFound = [];
    updates.forEach(u => {
        const row = beforeById.get(String(u.mcq_id));
        if (!row) { notFound.push(String(u.mcq_id)); return; }
        const prev = {};
        Object.keys(u.fields).forEach(f => { prev[f] = mcqBulkPrevValue_(f, row[f]); });
        undoUpdates.push({ mcq_id: u.mcq_id, fields: prev });
    });

    // 2) POST in chunks (no-cors: the reply cannot be read — step 3 proves it landed).
    let postError = null;
    try {
        for (const chunk of mcqBulkChunk_(updates, MCQ_BULK_CHUNK_)) {
            await fetch(MCQ_GOOGLE_SHEET_API, {
                method: "POST",
                mode: "no-cors",
                body: JSON.stringify({ action: "update_mcq_content_bulk", updates: chunk })
            });
        }
    } catch (err) {
        console.warn("Bulk save: POST failed", err);
        postError = err;
    }

    // 3) verify from the Sheet.
    let verdict;
    try {
        verdict = await mcqBulkVerify_(updates, () => mcqBulkFetchRawRows_(paperId));
    } catch (err) {
        console.warn("Bulk save: verification failed", err);
        if (undoUpdates.length && !opts.isUndo && !opts.keepUndo) lastBulkUndo = { paperId, updates: undoUpdates };
        throw new Error("The save was sent, but I could not read the Sheet back to confirm it. Reload and check the answers.");
    }

    // Undo information (something may have landed even when verification complains).
    if (opts.keepUndo) { /* H5 flag changes never replace the answer/text undo */ }
    else if (opts.isUndo) { if (!verdict.mismatches.length) lastBulkUndo = null; }
    else if (undoUpdates.length) lastBulkUndo = { paperId, updates: undoUpdates };

    // 4) the Sheet is the truth: refresh the page's data and redraw (current question index is kept).
    const fresh = (verdict.rows || []).filter(r => String(r.status || "").trim().toLowerCase() !== "archived");
    try {
        if (mcqApplyFreshRows_(paperId, verdict.rows)) {
            // H5: a flag change must not reset the running attempt/timer
            if (opts.noReset && typeof mcqSyncFlagsToSlots_ === "function") mcqSyncFlagsToSlots_();
            else applyMcqPracticeFilters();
        }
    } catch (err) {
        console.warn("Bulk save: refresh failed", err);
    }

    const badIds = new Set(verdict.mismatches.map(m => String(m.mcq_id)));
    notFound.forEach(id => badIds.add(id));
    const rows = fresh.map(mapMcqRow).sort((a, b) => {
        const qa = Number(a.question_no || 0), qb = Number(b.question_no || 0);
        return (qa || Number.MAX_SAFE_INTEGER) - (qb || Number.MAX_SAFE_INTEGER);
    });
    return {
        ok: !verdict.mismatches.length && !notFound.length && !postError,
        saved: updates.length - badIds.size,
        total: updates.length,
        mismatches: verdict.mismatches,
        notFound,
        attempts: verdict.attempts,
        rows
    };
}

/* ---------------- PART 3 — Correct tab UI (browser) ---------------- */

const mcqCorrectState_ = {
    paperId: "", rows: [], loadedAt: 0, loading: false, error: "", token: 0,
    pending: {},           // mcq_id -> option 1-6 (only when different from the saved one)
    onlySelected: false, pasteText: "", paste: null,
    result: null, lastChangedIds: [], busy: false
};

function mcqCorrectCount_() { return Object.keys(mcqCorrectState_.pending).length; }

if (typeof window !== "undefined") {
    window.mcqCorrectHasUnsaved_ = function () { return mcqCorrectCount_() > 0; };

    // true = OK to leave (nothing unsaved, or the person agreed to discard).
    // H4: also covers unsaved Review drafts (js/mcq-review.js).
    window.mcqCorrectConfirmDiscard_ = function () {
        const n = mcqCorrectCount_();
        const r = window.mcqReviewDraftCount_ ? window.mcqReviewDraftCount_() : { questions: 0, fields: 0 };
        if (!n && !r.fields) return true;
        const parts = [];
        if (n) parts.push(n + " unsaved answer change" + (n === 1 ? "" : "s"));
        if (r.fields) parts.push(r.fields + " unsaved review edit" + (r.fields === 1 ? "" : "s") + " in " + r.questions + " question" + (r.questions === 1 ? "" : "s"));
        if (!confirm("You have " + parts.join(" and ") + ". Discard them?")) return false;
        mcqCorrectState_.pending = {};
        mcqCorrectState_.paste = null;
        if (window.mcqReviewDiscardAll_) window.mcqReviewDiscardAll_();
        return true;
    };

    window.addEventListener("beforeunload", e => {
        if (mcqCorrectCount_()) { e.preventDefault(); e.returnValue = ""; }
    });
}

function mcqCorrectPreview_(text) {
    const chars = Array.from(String(text || "").replace(/\s+/g, " ").trim());
    return chars.length > 60 ? chars.slice(0, 60).join("") + "…" : chars.join("");
}

function mcqCorrectRowFrom_(m) {
    const count = Math.min(6, Math.max(2, (m.options || []).length));
    let saved = mcqCorrectSavedOption_(m);
    if (saved > count) saved = 0;
    return { id: String(m.id), qno: Number(m.question_no) || 0, text: mcqCorrectPreview_(m.question), count, saved };
}

function mcqCorrectSortRows_(rows) {
    return rows.map((r, i) => ({ r, i })).sort((a, b) =>
        ((a.r.qno || Number.MAX_SAFE_INTEGER) - (b.r.qno || Number.MAX_SAFE_INTEGER)) || (a.i - b.i)).map(x => x.r);
}

function mcqCorrectPrune_() {
    const st = mcqCorrectState_;
    const byId = new Map(st.rows.map(r => [r.id, r]));
    Object.keys(st.pending).forEach(id => {
        const r = byId.get(id);
        if (!r || st.pending[id] === r.saved || st.pending[id] > r.count) delete st.pending[id];
    });
}

async function mcqCorrectLoad_(paperId) {
    const st = mcqCorrectState_;
    const token = ++st.token;
    st.loading = true; st.error = "";
    mcqCorrectDraw_();
    try {
        const raw = await mcqBulkFetchRawRows_(paperId);
        if (token !== st.token) return;
        st.rows = mcqCorrectSortRows_(raw
            .filter(r => String(r.status || "").trim().toLowerCase() !== "archived")
            .map(mapMcqRow).map(mcqCorrectRowFrom_));
        st.paperId = paperId;
        st.loadedAt = Date.now();
        mcqCorrectPrune_();
    } catch (err) {
        if (token !== st.token) return;
        console.warn("Correct tab: load failed", err);
        st.error = "Could not load this paper from the Sheet. Check your internet and press Reload.";
    } finally {
        if (token === st.token) st.loading = false;
    }
    mcqCorrectDraw_();
}

function mcqCorrectTabHtml_() {
    return `<div id="mcq-correct-root"></div>`;
}

function mcqCorrectBind_(body) {
    const st = mcqCorrectState_;
    const paperId = String(mcqHubPaperId_ || "");
    if (st.paperId !== paperId) {
        st.paperId = paperId; st.rows = []; st.pending = {}; st.paste = null;
        st.result = null; st.loadedAt = 0; st.lastChangedIds = []; st.pasteText = "";
    }
    const root = body.querySelector("#mcq-correct-root");
    root.addEventListener("click", mcqCorrectClick_);
    root.addEventListener("input", e => {
        if (e.target.id === "mcq-key-paste-box") st.pasteText = e.target.value;
    });
    root.addEventListener("change", e => {
        if (e.target.matches("[data-key-only]")) { st.onlySelected = e.target.checked; mcqCorrectDrawGrid_(); }
    });
    if (!paperId) { mcqCorrectDraw_(); return; }
    const fresh = st.rows.length && (Date.now() - st.loadedAt) < 30000;
    if (st.busy || fresh) mcqCorrectDraw_();
    else mcqCorrectLoad_(paperId);
}

if (typeof window !== "undefined") window.mcqCorrectOnSelectionChange_ = function () {
    if (!document.getElementById("mcq-correct-root")) return;
    const label = document.querySelector("#mcq-correct-root [data-key-only-label]");
    const n = mcqSelectedIds.size;
    if (label) label.textContent = "Only selected (" + n + ")";
    const cb = document.querySelector("#mcq-correct-root [data-key-only]");
    if (cb) cb.disabled = n === 0;
    if (n === 0 && mcqCorrectState_.onlySelected) { mcqCorrectState_.onlySelected = false; if (cb) cb.checked = false; }
    mcqCorrectDrawGrid_();
};

function mcqCorrectRowHtml_(r) {
    const st = mcqCorrectState_;
    const esc = mcqEscapeHtml;
    const pend = st.pending[r.id] || 0;
    let chips = "";
    for (let i = 1; i <= r.count; i++) {
        let cls = "mcq-key-chip";
        if (pend) { if (i === pend) cls += " is-changed"; else if (i === r.saved) cls += " was-saved"; }
        else if (i === r.saved) cls += " is-saved";
        chips += `<button type="button" class="${cls}" data-key-id="${esc(r.id)}" data-key-opt="${i}" aria-pressed="${i === (pend || r.saved)}">${MCQ_KEY_LETTERS_[i - 1]}</button>`;
    }
    const flag = (!r.saved && !pend) ? `<span class="mcq-key-flag">no answer</span>` : "";
    const was = pend ? `<span class="mcq-key-was">was ${r.saved ? mcqKeyLetter_(r.saved) : "none"}</span>` : "";
    return `<div class="mcq-key-row${pend ? " is-dirty" : ""}" data-key-row="${esc(r.id)}">
        <div class="mcq-key-q"><b>${r.qno ? "Q" + r.qno : "Q?"}</b> <span class="mcq-key-text">${esc(r.text)}</span> ${flag}</div>
        <div class="mcq-key-chips">${chips}${was}</div>
    </div>`;
}

function mcqCorrectVisibleRows_() {
    const st = mcqCorrectState_;
    return st.onlySelected ? st.rows.filter(r => mcqSelectedIds.has(r.id)) : st.rows;
}

function mcqCorrectDraw_() {
    const root = document.getElementById("mcq-correct-root");
    if (!root) return;
    const st = mcqCorrectState_;
    const esc = mcqEscapeHtml;
    if (!st.paperId) { root.innerHTML = `<p class="mcq-hub-empty">Select a paper above to correct its answers.</p>`; return; }
    if (st.loading && !st.rows.length) { root.innerHTML = `<p class="mcq-hub-empty">Loading questions from the Sheet…</p>`; return; }
    if (st.error && !st.rows.length) {
        root.innerHTML = `<p class="mcq-hub-empty">${esc(st.error)}</p><div class="mcq-hub-card-actions"><button type="button" class="content-action" data-key-act="reload">🔄 Reload</button></div>`;
        return;
    }
    if (!st.rows.length) { root.innerHTML = `<p class="mcq-hub-empty">This paper has no questions.</p>`; return; }
    const noAns = st.rows.filter(r => !r.saved).length;
    const selN = mcqSelectedIds.size;
    root.innerHTML = `
        <div class="mcq-hub-card mcq-key">
            <div class="mcq-hub-card-title">✅ Answer key</div>
            <div class="mcq-hub-card-meta">${st.rows.length} questions${noAns ? ` · <span class="mcq-key-red">${noAns} without answer</span>` : ""} · saved straight to the Sheet</div>
            <div class="mcq-hub-card-actions">
                <button type="button" class="content-action" data-key-act="reload">🔄 Reload from Sheet</button>
                <label class="mcq-exp-check"><input type="checkbox" data-key-only${st.onlySelected ? " checked" : ""}${selN ? "" : " disabled"}> <span data-key-only-label>Only selected (${selN})</span></label>
            </div>
            <details class="mcq-key-paste"${st.paste || st.pasteText ? " open" : ""}>
                <summary>📋 Paste answer key</summary>
                <textarea id="mcq-key-paste-box" rows="4" spellcheck="false" placeholder="1-A 2-C 3-B   or   1.A  2) b  3:2   or   ACBDA…">${esc(st.pasteText)}</textarea>
                <div class="mcq-hub-card-actions"><button type="button" class="content-action" data-key-act="fill">Fill grid</button></div>
                <div id="mcq-key-paste-report" class="mcq-hub-note" aria-live="polite"></div>
            </details>
            <div id="mcq-key-result" aria-live="polite"></div>
            <div id="mcq-key-diff"></div>
            <div id="mcq-key-grid" class="mcq-key-grid"></div>
            <div id="mcq-key-savebar" class="mcq-key-savebar"></div>
        </div>`;
    mcqCorrectDrawGrid_();
    mcqCorrectDrawPasteReport_();
    mcqCorrectDrawResult_();
    mcqCorrectDrawSummary_();
}

function mcqCorrectDrawGrid_() {
    const el = document.getElementById("mcq-key-grid");
    if (!el) return;
    const rows = mcqCorrectVisibleRows_();
    el.innerHTML = rows.length ? rows.map(mcqCorrectRowHtml_).join("")
        : `<p class="mcq-hub-empty">No selected question in this paper. Untick “Only selected”.</p>`;
}

function mcqCorrectDrawPasteReport_() {
    const el = document.getElementById("mcq-key-paste-report");
    if (!el) return;
    const p = mcqCorrectState_.paste;
    if (!p) { el.textContent = ""; return; }
    const esc = mcqEscapeHtml;
    const bits = [`<b>${p.applied.length}</b> answer${p.applied.length === 1 ? "" : "s"} read`];
    if (p.unknown.length) bits.push(`<span class="mcq-key-red">not in this paper: ${esc(p.unknown.join(", "))}</span>`);
    if (p.outOfRange.length) bits.push(`<span class="mcq-key-red">option does not exist: ${esc(p.outOfRange.join(", "))}</span>`);
    if (p.invalid.length) bits.push(`<span class="mcq-key-red">could not read: ${esc(p.invalid.join(", "))}</span>`);
    if (p.duplicates.length) bits.push(`repeated (last one used): ${esc(p.duplicates.join(", "))}`);
    if (p.compactMismatch) bits.push(`<span class="mcq-key-red">a plain list needs exactly ${p.compactMismatch.expected} letters (found ${p.compactMismatch.got})</span>`);
    el.innerHTML = bits.join(" · ") + `<br>Nothing is saved yet — check the grid, then press Save.`;
}

function mcqCorrectDrawResult_() {
    const el = document.getElementById("mcq-key-result");
    if (!el) return;
    const st = mcqCorrectState_;
    const r = st.result;
    const esc = mcqEscapeHtml;
    if (!r) { el.innerHTML = ""; return; }
    const undoBtn = (lastBulkUndo && lastBulkUndo.paperId === st.paperId && !st.busy)
        ? `<button type="button" class="content-action" data-key-act="undo">↩️ Undo last save</button>` : "";
    if (r.kind === "working") { el.innerHTML = `<div class="mcq-key-result">⏳ Saving and checking the Sheet…</div>`; return; }
    if (r.kind === "error") { el.innerHTML = `<div class="mcq-key-result is-bad">⚠️ ${esc(r.msg)}<div class="mcq-hub-card-actions">${undoBtn}</div></div>`; return; }
    if (r.kind === "undone") { el.innerHTML = `<div class="mcq-key-result is-ok">↩️ Undone — ${r.saved}/${r.total} restored and confirmed from the Sheet.</div>`; return; }
    if (r.kind === "ok") {
        const n = r.changedIds.length;
        el.innerHTML = `<div class="mcq-key-result is-ok">✔ Saved ${r.saved}/${r.total} and confirmed from the Sheet.
            <div class="mcq-hub-note">Answer changed — check the explanation too.</div>
            ${r.flagNote ? `<div class="mcq-hub-note">${esc(r.flagNote)}</div>` : ""}
            <div class="mcq-hub-card-actions">
                <button type="button" class="content-action" data-key-act="review">Review these ${n} →</button>
                ${r.flagged || !n ? "" : `<button type="button" class="content-action" data-key-act="flag">⚑ Flag these ${n} for explanation check</button>`}
                ${undoBtn}
            </div></div>`;
        return;
    }
    const byId = new Map(st.rows.map(x => [x.id, x]));
    const lines = r.mismatches.map(m => {
        const row = byId.get(String(m.mcq_id));
        const q = row && row.qno ? "Q" + row.qno : esc(String(m.mcq_id));
        if (m.field === "correct_option") {
            const got = mcqCorrectSavedOption_({ correct_option: m.got });
            return `<li>${q}: expected ${mcqKeyLetter_(mcqCorrectSavedOption_({ correct_option: m.expected }))}, Sheet has ${got ? mcqKeyLetter_(got) : esc(String(m.got) || "(empty)")}</li>`;
        }
        return `<li>${q}: ${esc(m.field)} — expected “${esc(String(m.expected))}”, Sheet has “${esc(String(m.got))}”</li>`;
    }).join("");
    el.innerHTML = `<div class="mcq-key-result is-bad">⚠️ Saved ${r.saved}/${r.total} — the Sheet does not match for:
        <ul>${lines}</ul>
        <div class="mcq-hub-note">If every question failed, the new Apps Script version may not be deployed yet.</div>
        <div class="mcq-hub-card-actions">
            <button type="button" class="content-action" data-key-act="save">🔁 Retry</button>${undoBtn}
        </div></div>`;
}

function mcqCorrectChanges_() {
    return buildAnswerKeyChanges_(mcqCorrectState_.rows, mcqCorrectState_.pending);
}

function mcqCorrectDrawSummary_() {
    const st = mcqCorrectState_;
    const changes = mcqCorrectChanges_();
    const diff = document.getElementById("mcq-key-diff");
    if (diff) {
        const esc = mcqEscapeHtml;
        diff.innerHTML = changes.length
            ? `<details class="mcq-key-diff" open><summary>${changes.length} change${changes.length === 1 ? "" : "s"} to save</summary><ul>${
                changes.map(c => `<li>${esc(formatAnswerKeyChange_(c))}</li>`).join("")}</ul></details>` : "";
    }
    const bar = document.getElementById("mcq-key-savebar");
    if (bar) {
        const n = changes.length;
        bar.innerHTML = `<span class="mcq-key-count">${n ? n + " unsaved change" + (n === 1 ? "" : "s") : "No changes"}</span>
            <button type="button" class="content-action" data-key-act="discard"${n && !st.busy ? "" : " disabled"}>Discard</button>
            <button type="button" class="content-action mcq-key-save" data-key-act="save"${n && !st.busy ? "" : " disabled"}>Save ${n} change${n === 1 ? "" : "s"}</button>`;
    }
}

function mcqCorrectSetPending_(id, option) {
    const st = mcqCorrectState_;
    const r = st.rows.find(x => x.id === id);
    if (!r) return;
    if (!option || option === r.saved || st.pending[id] === option) delete st.pending[id];   // same chip again = revert
    else st.pending[id] = option;
}

function mcqCorrectRedrawRow_(id) {
    const r = mcqCorrectState_.rows.find(x => x.id === id);
    const el = document.querySelector(`#mcq-key-grid [data-key-row="${CSS.escape(id)}"]`);
    if (r && el) el.outerHTML = mcqCorrectRowHtml_(r);
}

function mcqCorrectFill_() {
    const st = mcqCorrectState_;
    const box = document.getElementById("mcq-key-paste-box");
    st.pasteText = box ? box.value : st.pasteText;
    const seenNo = new Set(), nos = [], counts = [];
    st.rows.forEach(r => { if (r.qno && !seenNo.has(r.qno)) { seenNo.add(r.qno); nos.push(r.qno); counts.push(r.count); } });
    const parsed = parseAnswerKey(st.pasteText, nos, counts);
    if (parsed.compact) {
        if (!confirm("This looks like a plain list of " + nos.length + " answers. Apply them in order to Q" + nos[0] + " … Q" + nos[nos.length - 1] + "?")) return;
    }
    const idByNo = new Map();
    st.rows.forEach(r => { if (r.qno && !idByNo.has(r.qno)) idByNo.set(r.qno, r.id); });
    parsed.applied.forEach(a => {
        const id = idByNo.get(a.qno);
        const row = st.rows.find(x => x.id === id);
        if (!row) return;
        if (a.option === row.saved) delete st.pending[id]; else st.pending[id] = a.option;
    });
    st.paste = parsed;
    mcqCorrectDrawGrid_();
    mcqCorrectDrawPasteReport_();
    mcqCorrectDrawSummary_();
}

async function mcqCorrectSave_() {
    const st = mcqCorrectState_;
    if (st.busy) return;
    const changes = mcqCorrectChanges_();
    if (!changes.length) return;
    if (changes.length > 10 && !confirm("Save " + changes.length + " answer changes to the Sheet?")) return;
    const updates = changes.map(c => ({ mcq_id: c.id, fields: { correct_option: c.to } }));
    st.busy = true;
    st.result = { kind: "working" };
    mcqCorrectDrawResult_(); mcqCorrectDrawSummary_();
    try {
        const out = await mcqBulkSaveAndVerify(st.paperId, updates);
        if (out.rows) {
            st.rows = mcqCorrectSortRows_(out.rows.map(mcqCorrectRowFrom_));
            st.loadedAt = Date.now();
        }
        const bad = new Set(out.mismatches.map(m => String(m.mcq_id)).concat(out.notFound));
        changes.forEach(c => { if (!bad.has(c.id)) delete st.pending[c.id]; });
        mcqCorrectPrune_();
        st.lastChangedIds = changes.filter(c => !bad.has(c.id)).map(c => c.id);
        st.result = out.ok
            ? { kind: "ok", saved: out.saved, total: out.total, changedIds: st.lastChangedIds }
            : { kind: "mismatch", saved: out.saved, total: out.total, mismatches: out.mismatches };
    } catch (err) {
        st.result = { kind: "error", msg: err.message || "Could not save. Your changes are still here." };
    } finally {
        st.busy = false;
    }
    mcqCorrectDraw_();
    document.getElementById("mcq-key-result")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

// H5 — after an answer change: mark the changed questions "needs check" (one bulk save, verified).
async function mcqCorrectFlag_() {
    const st = mcqCorrectState_;
    if (st.busy || !st.result || st.result.kind !== "ok" || typeof mcqSetFlags_ !== "function") return;
    const ids = (st.result.changedIds || []).slice();
    if (!ids.length) return;
    st.busy = true;
    const keep = st.result;
    st.result = Object.assign({}, keep, { flagNote: "⏳ Flagging…" });
    mcqCorrectDrawResult_(); mcqCorrectDrawSummary_();
    let note = "", done = false;
    try {
        const r = await mcqSetFlags_(ids, true);
        done = r.ok;
        note = r.ok ? "⚑ " + r.saved + " question" + (r.saved === 1 ? "" : "s") + " flagged and confirmed from the Sheet. See Correct → Needs check."
            : "⚠️ Only " + r.saved + "/" + r.total + " flags could be confirmed. " + (r.hint || "");
    } catch (err) {
        note = "⚠️ " + (err && err.message ? err.message : "Could not save the flags.");
    } finally {
        st.busy = false;
    }
    st.result = Object.assign({}, keep, { flagNote: note, flagged: done });
    mcqCorrectDraw_();
}

async function mcqCorrectUndo_() {
    const st = mcqCorrectState_;
    if (st.busy || !lastBulkUndo || lastBulkUndo.paperId !== st.paperId) return;
    if (!confirm("Put the previous answers back in the Sheet?")) return;
    const undo = lastBulkUndo;
    st.busy = true;
    st.result = { kind: "working" };
    mcqCorrectDrawResult_(); mcqCorrectDrawSummary_();
    try {
        const out = await mcqBulkSaveAndVerify(undo.paperId, undo.updates, { isUndo: true });
        if (out.rows) {
            st.rows = mcqCorrectSortRows_(out.rows.map(mcqCorrectRowFrom_));
            st.loadedAt = Date.now();
        }
        mcqCorrectPrune_();
        st.result = out.ok
            ? { kind: "undone", saved: out.saved, total: out.total }
            : { kind: "mismatch", saved: out.saved, total: out.total, mismatches: out.mismatches };
    } catch (err) {
        st.result = { kind: "error", msg: err.message || "Could not undo." };
    } finally {
        st.busy = false;
    }
    mcqCorrectDraw_();
}

function mcqCorrectClick_(event) {
    const st = mcqCorrectState_;
    const chip = event.target.closest && event.target.closest("[data-key-opt]");
    if (chip) {
        if (st.busy) return;
        const id = chip.dataset.keyId;
        mcqCorrectSetPending_(id, Number(chip.dataset.keyOpt));
        mcqCorrectRedrawRow_(id);
        mcqCorrectDrawSummary_();
        return;
    }
    const act = event.target.closest && event.target.closest("[data-key-act]");
    if (!act) return;
    const a = act.dataset.keyAct;
    if (a === "fill") mcqCorrectFill_();
    else if (a === "save") mcqCorrectSave_();
    else if (a === "undo") mcqCorrectUndo_();
    else if (a === "flag") mcqCorrectFlag_();
    else if (a === "discard") {
        if (st.busy) return;
        st.pending = {}; st.paste = null;
        mcqCorrectDrawGrid_(); mcqCorrectDrawPasteReport_(); mcqCorrectDrawSummary_();
    } else if (a === "reload") {
        if (st.busy) return;
        if (mcqCorrectCount_() && !confirm("Reload from the Sheet? Your unsaved changes stay in the grid.")) return;
        mcqCorrectLoad_(st.paperId);
    } else if (a === "review") {
        st.lastChangedIds.forEach(id => mcqSelectedIds.add(id));
        mcqUpdateSelectionUi_();
        if (window.mcqReviewOpenSub_) window.mcqReviewOpenSub_("review", { scope: "selected" });
        else { act.textContent = "✔ Selected " + st.lastChangedIds.length; act.disabled = true; }
    }
}
