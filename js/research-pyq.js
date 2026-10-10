/* =========================================================
   js/research-pyq.js — "Research & PYQ" section inside the
   "Add Content Folder" box.

   Same pattern as quiz-prompt.js / visual-aids.js: the popup holds
   one empty <div id="research-pyq-host">; all UI + prompts live here.

   Public API:
     window.ResearchPYQ.mount(hostElement, ctx)
       ctx = {
         topic, breadcrumb,
         getSplit()  -> { en, hi, ai }
         clean(text) -> the page's cleanContentForPrompt()
       }

   Two prompts, four shared controls:
     Exam focus | Sources focus | Output length | Free-text note
   Everything is remembered in localStorage (keys start "rp:").

   TO EDIT THE LISTS: change EXAM_GROUPS / SOURCE_GROUPS below.
   TO EDIT A PROMPT: change researchPrompt() / pyqPrompt() below.
   ========================================================= */
(function () {
    "use strict";

    /* ---------- 1. THE LISTS (edit freely) ---------- */
    var EXAM_GROUPS = [
        ["UGC / University level", ["UGC NET Paper 1 (General)", "UGC NET LIS (Paper 2)", "UGC JRF", "UP SET", "Bihar SET", "Rajasthan SET", "Other State SET"]],
        ["Teaching exams", ["Bihar STET (Psychology)", "Bihar STET (other subjects)", "BPSC TRE 1", "BPSC TRE 2", "BPSC TRE 3", "CTET", "UPTET", "REET", "HTET", "KVS", "NVS", "UPESSB PGT", "DSSSB"]],
        ["Librarian posts", ["KVS Librarian", "NVS Librarian", "DSSSB Librarian", "University / College Librarian", "State PSC Librarian"]],
        ["SSC", ["SSC CGL", "SSC CHSL", "SSC MTS", "SSC GD", "SSC CPO"]],
        ["State services / police", ["BPSC CCE", "UPSSSC PET", "Bihar Police", "UP Police"]],
        ["Railway, banking, UPSC", ["RRB NTPC", "RRB Group D", "IBPS", "SBI", "UPSC Prelims"]]
    ];

    var SOURCE_GROUPS = [
        ["School / board", ["NCERT", "SCERT (Bihar)", "SCERT (UP)", "SCERT (Delhi)", "CBSE", "NIOS"]],
        ["University / e-learning", ["IGNOU", "ePG Pathshala", "e-PG / UG Pathshala", "SWAYAM / NPTEL", "INFLIBNET", "Shodhganga"]],
        ["Exam bodies / official", ["UGC / NTA official", "UPSC official", "SSC official", "BPSC official", "State board / commission sites"]],
        ["Library science specific", ["NLM / DELNET", "Ranganathan's original works", "IFLA / ALA standards"]],
        ["Other", ["Government gazette / ministry sites", "Peer-reviewed papers (Google Scholar)", "Wikipedia (only for a lead, then verify)"]]
    ];

    var LENGTHS = [
        ["short", "Short (quick revision)"],
        ["standard", "Standard (balanced)"],
        ["detailed", "Detailed (everything)"],
        ["custom", "Custom (my own limit)"]
    ];

    var LANGS = [
        ["english", "English"],
        ["hindi", "हिंदी"],
        ["hinglish", "Hinglish (Roman letters mein Hindi)"],
        ["mixed", "Mixed (हिंदी + English)"]
    ];
    var DEFAULT_LANG = "mixed";

    var SKIP_RESEARCH = [
        ["mnemonics", "Mnemonics / tricks"],
        ["confusion", "Confusion pairs"],
        ["examangle", "Exam-wise angle"]
    ];
    var SKIP_PYQ = [
        ["pattern", "Pattern analysis"],
        ["probable", "Probable questions"]
    ];

    /* ---------- 2. small helpers ---------- */
    var K = { exams: "rp:exams", customExams: "rp:customExams", sources: "rp:sources", customSources: "rp:customSources",
              length: "rp:length", lang: "rp:lang", customLen: "rp:customLen", skip: "rp:skip", note: "rp:note", enOnly: "rp:enOnly" };

    function esc(s) {
        return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }
    function lsGet(k, d) { try { var v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } }
    function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* blocked */ } }
    function lsGetList(k) {
        try { var a = JSON.parse(lsGet(k, "[]")); return Array.isArray(a) ? a.filter(function (x) { return typeof x === "string" && x; }) : []; }
        catch (e) { return []; }
    }
    function lsSetList(k, a) { lsSet(k, JSON.stringify(a)); }

    function copyText(text, onOk, onFail) {
        function fallback() {
            var ta = document.createElement("textarea");
            ta.value = text;
            ta.setAttribute("readonly", "");
            ta.style.cssText = "position:fixed;left:-9999px;top:0";
            document.body.appendChild(ta);
            ta.select();
            var ok = false;
            try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
            ta.remove();
            if (ok) onOk(); else onFail();
        }
        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(text).then(onOk, fallback);
        } else {
            fallback();
        }
    }

    /* The topic text as the AI should see it (same idea as visual-aids.js). */
    function buildContentBlock(split, clean, enOnly) {
        var en = split && String(split.en || "").trim();
        var hi = split && String(split.hi || "").trim();
        var ai = split && String(split.ai || "").trim();
        if (!en && !hi && !ai) return null;
        var c = clean || function (t) { return String(t || "").trim(); };
        if (en) {
            var hiText = (enOnly || !hi) ? "" : c(split.hi);
            var block = "=== MY CONTENT (ENGLISH) ===\n" + c(split.en);
            if (hiText) block += "\n\n=== MY CONTENT (हिंदी) ===\n" + hiText;
            return { text: block, bilingual: !!hiText };
        }
        if (hi) return { text: "=== MY CONTENT (हिंदी) ===\n" + c(split.hi), bilingual: false };
        return { text: "=== MY CONTENT (AI EXPLAINER - HINGLISH) ===\n" + c(split.ai), bilingual: false };
    }

    /* ---------- 3. prompt pieces ---------- */
    var BAR = "====================================================";
    function banner(t) { return BAR + "\n" + t + "\n" + BAR; }

    function focusBlock(o) {
        var exams = o.exams.length
            ? o.exams.join(", ")
            : "GENERAL: all Indian government recruitment and eligibility exams where this topic can appear (UGC NET, State SET, STET/TET/TRE, SSC, state PSC, railway, banking, etc.)";
        var srcs = o.sources.length
            ? "PRIORITY SOURCES (check these FIRST): " + o.sources.join(", ") + ".\n" +
              "These are a floor, not a ceiling: beyond them, also search for any other authentic source (government, university, official exam body, standard textbook, peer-reviewed) wherever it adds value, and cite each one."
            : "No source preference given: choose the most authentic sources yourself (government/official first: NCERT, SCERT, CBSE, IGNOU, ePG Pathshala, SWAYAM/NPTEL, INFLIBNET, UGC/NTA, official exam-body sites; then standard textbooks and peer-reviewed papers).";
        var out = banner("FOCUS") + "\nEXAM FOCUS: " + exams + "\n" + srcs;
        if (o.note) out += "\nMY EXTRA NOTE (follow it, it overrides the defaults above): " + o.note;
        return out;
    }

    function lengthBlock(o) {
        var map = {
            short: "OUTPUT LENGTH: SHORT. Quick-revision size, about 400 words in total plus tables. Top 3 sources only. Skip anything not essential.",
            standard: "OUTPUT LENGTH: STANDARD. Balanced and readable. Do not pad; no section should run longer than it needs to.",
            detailed: "OUTPUT LENGTH: DETAILED. Be thorough and complete in every section, but stay organised with headings and tables."
        };
        if (o.length === "custom") {
            return "OUTPUT LENGTH: CUSTOM. Follow exactly this limit from me: " + (o.customLen || "keep it concise") + ".";
        }
        return map[o.length] || map.standard;
    }

    function languageBlock(o) {
        var map = {
            english: "Write your whole reply in simple, clear English.",
            hindi: "Write your whole reply in Hindi (Devanagari script), in simple natural language. Keep proper names, URLs and the exact titles of documents and exams in their original form.",
            hinglish: "Write your reply in simple Hinglish: Hindi language written in Roman letters, in a natural spoken style, keeping technical terms in English.",
            mixed: "Write your reply in ONE natural, spoken-style Hindi + English mix. This is a single text, NOT two separate versions. Hindi words must be in Devanagari script and English words in English (Roman) letters, the way educated Indians naturally talk, e.g. \"ये topic UGC NET में बहुत important है।\" Keep technical terms, names, exam names and document titles in English. Do not write English words in Devanagari, and do not write Hindi words in Roman letters."
        };
        return "OUTPUT LANGUAGE: " + (map[o.lang] || map.mixed) + " Section headings and table column names may stay in English. Real PYQ questions must stay exactly in the language they were printed in. If my extra note asks for a different language, follow the note.";
    }

    function honestyBlock() {
        return banner("NON-NEGOTIABLE HONESTY RULES") + "\n" +
            "1. USE LIVE WEB SEARCH. If you cannot search the web in this chat, say so in your FIRST line and stop; do not answer from memory pretending it is researched.\n" +
            "2. NEVER invent anything: no made-up chapters, page numbers, URLs, quotes, years or questions. If something cannot be verified, write \"Not verified\" or \"Not found\" instead of guessing.\n" +
            "3. Every source must carry a working URL you actually opened. Mark each as [Official], [University], [Textbook] or [Other] so I can judge trust.\n" +
            "4. Separate fact from inference. If sources disagree, show both and say which is more authoritative.\n" +
            "5. Do not copy long passages from sources. Summarise in your own words and point me to the chapter / page / URL.";
    }

    function researchPrompt(o) {
        var s = {};
        o.skip.forEach(function (k) { s[k] = true; });
        var n = 0;
        function h(t) { n++; return n + ". " + t; }
        var parts = [];
        parts.push("You are a careful exam-preparation researcher. Your job is to verify and deepen the study content below using authentic sources, and to show me exactly where my content is strong or weak.");
        parts.push("TOPIC PATH: " + (o.breadcrumb || "(not given)") + "\nTOPIC: " + o.topic);
        parts.push(focusBlock(o));
        parts.push(honestyBlock());
        parts.push(lengthBlock(o));
        parts.push(languageBlock(o));

        var steps = [];
        steps.push("STEP 1 — Read my content below and list its key claims (definitions, names, dates, classifications, numbers).");
        steps.push("STEP 2 — Search the web for authentic sources on this topic, following the source rules above. Open them; do not rely on snippets.");
        steps.push("STEP 3 — Compare my content against what the sources say.");
        parts.push(banner("WORK PLAN") + "\n" + steps.join("\n"));

        var sec = [];
        sec.push(h("CORE EXPLANATION — a clear, exam-oriented summary of the topic built from the sources you verified."));
        sec.push(h("SOURCES TABLE — columns: Source | Type tag | Document / chapter / page | URL | What it gives me."));
        sec.push(h("GAP ANALYSIS (most important) — three lists: (a) missing from my content but important, (b) wrong or outdated in my content, with the correct version and the source, (c) correct and well covered."));
        if (!s.mnemonics) sec.push(h("MNEMONICS / TRICKS — only if they genuinely help; label each as your own creation."));
        if (!s.confusion) sec.push(h("CONFUSION PAIRS — terms students mix up, as a small comparison table."));
        if (!s.examangle) sec.push(h("EXAM-WISE ANGLE — for each exam in the focus above (or in general if none chosen), how this topic is usually asked: type of question, depth, favourite sub-points."));
        sec.push(h("WHAT I COULD NOT VERIFY — anything you searched for but could not confirm."));
        parts.push(banner("OUTPUT SECTIONS (use these headings, in this order)") + "\n" + sec.join("\n"));

        parts.push(banner("MY CONTENT") + "\n" + (o.content || "(no content loaded; research the topic from the path and name only)"));
        return parts.join("\n\n");
    }

    function pyqPrompt(o) {
        var s = {};
        o.skip.forEach(function (k) { s[k] = true; });
        var n = 0;
        function h(t) { n++; return n + ". " + t; }
        var parts = [];
        parts.push("You are an exam-paper researcher. Your job is to find REAL previously asked questions (PYQs) on the topic below and to analyse their pattern. Accuracy matters far more than quantity.");
        parts.push("TOPIC PATH: " + (o.breadcrumb || "(not given)") + "\nTOPIC: " + o.topic);
        parts.push(focusBlock(o));
        parts.push(honestyBlock());
        parts.push(banner("PYQ-SPECIFIC RULES") + "\n" +
            "- Look first at official papers and answer keys (e.g. ugcnet.nta.ac.in, ssc.gov.in, bpsc.bih.nic.in, and the official site of each exam in the focus). Then reliable question banks, clearly marked as [Other].\n" +
            "- A real PYQ needs exam + year (+ shift/date when known) and a source URL. If you cannot name the exam and year, it is NOT a PYQ: do not list it in the PYQ table.\n" +
            "- Give the answer as printed in the official key. If the official key and a coaching site differ, show both.\n" +
            "- Never present a question you made up or reworded as a PYQ. Real and predicted questions must never be mixed.\n" +
            "- It is fine and honest to return few rows, or none, if little can be verified.");
        parts.push(lengthBlock(o));
        parts.push(languageBlock(o));

        var sec = [];
        sec.push(h("VERIFIED PYQ TABLE — columns: Exam | Year / Shift | Question | Options (if MCQ) | Correct answer | Source URL | Status (Verified / Uncertain). Group rows by exam."));
        if (!s.pattern) sec.push(h("PATTERN ANALYSIS — from the rows above only: how often this topic appears, which sub-points repeat, and which question types are used (direct, statement-based, match the following, assertion-reason, odd-one-out)."));
        if (!s.probable) sec.push(h("PROBABLE QUESTIONS — clearly labelled \"PREDICTED, NOT ACTUAL PYQ\". Write 5 to 10 original questions in the style of the focus exams, each with answer and a one-line reason. Cover different question types."));
        sec.push(h("WHAT I COULD NOT VERIFY — papers or years you could not access."));
        parts.push(banner("OUTPUT SECTIONS (use these headings, in this order)") + "\n" + sec.join("\n"));

        if (o.content) parts.push(banner("MY CONTENT (only to help you match sub-topics; do not summarise it)") + "\n" + o.content);
        return parts.join("\n\n");
    }

    /* ---------- 4. chip picker (used for Exam focus and Sources focus) ---------- */
    function chipPicker(host, cfg) {
        // cfg: { title, groups, selKey, customKey, placeholder, customLabel }
        var selected = lsGetList(cfg.selKey);
        var custom = lsGetList(cfg.customKey);

        host.innerHTML =
            '<label class="quiz-lbl">' + esc(cfg.title) + '</label>' +
            '<div class="rp-chips"></div>' +
            '<select class="rp-add"></select>' +
            '<div class="rp-customrow">' +
            '<input type="text" class="rp-custom" maxlength="80" autocomplete="off" placeholder="' + esc(cfg.placeholder) + '">' +
            '<button type="button" class="content-action rp-custom-btn">Add</button>' +
            '</div>';

        var chipsEl = host.querySelector(".rp-chips");
        var selEl = host.querySelector(".rp-add");
        var inEl = host.querySelector(".rp-custom");

        function inGroups(name) {
            return cfg.groups.some(function (g) { return g[1].indexOf(name) >= 0; });
        }
        function renderSelect() {
            var html = '<option value="">+ Pick from list…</option>';
            cfg.groups.forEach(function (g) {
                var items = g[1].filter(function (x) { return selected.indexOf(x) < 0; });
                if (!items.length) return;
                html += '<optgroup label="' + esc(g[0]) + '">' +
                    items.map(function (x) { return '<option value="' + esc(x) + '">' + esc(x) + "</option>"; }).join("") + "</optgroup>";
            });
            var mine = custom.filter(function (x) { return selected.indexOf(x) < 0; });
            if (mine.length) {
                html += '<optgroup label="Your saved">' +
                    mine.map(function (x) { return '<option value="' + esc(x) + '">' + esc(x) + "</option>"; }).join("") + "</optgroup>";
            }
            selEl.innerHTML = html;
        }
        function renderChips() {
            if (!selected.length) {
                chipsEl.innerHTML = '<span class="rp-empty">' + esc(cfg.emptyText) + "</span>";
            } else {
                chipsEl.innerHTML = selected.map(function (x, i) {
                    return '<span class="rp-chip">' + esc(x) + '<button type="button" aria-label="Remove" data-i="' + i + '">×</button></span>';
                }).join("");
            }
            renderSelect();
        }
        function add(name) {
            name = String(name || "").replace(/\s+/g, " ").trim();
            if (!name) return;
            var dup = selected.some(function (x) { return x.toLowerCase() === name.toLowerCase(); });
            if (dup) return;
            selected.push(name);
            if (!inGroups(name) && custom.indexOf(name) < 0) { custom.push(name); lsSetList(cfg.customKey, custom); }
            lsSetList(cfg.selKey, selected);
            renderChips();
        }

        selEl.addEventListener("change", function () { if (selEl.value) add(selEl.value); });
        host.querySelector(".rp-custom-btn").addEventListener("click", function () { add(inEl.value); inEl.value = ""; });
        inEl.addEventListener("keydown", function (e) {
            if (e.key === "Enter") { e.preventDefault(); add(inEl.value); inEl.value = ""; }
        });
        chipsEl.addEventListener("click", function (e) {
            var b = e.target.closest("button[data-i]");
            if (!b) return;
            selected.splice(parseInt(b.getAttribute("data-i"), 10), 1);
            lsSetList(cfg.selKey, selected);
            renderChips();
        });

        renderChips();
        return { get: function () { return selected.slice(); } };
    }

    /* ---------- 5. mount ---------- */
    function mount(host, ctx) {
        if (!host || !ctx) return;
        var savedLen = lsGet(K.length, "standard");
        var savedLang = lsGet(K.lang, DEFAULT_LANG);
        if (!LANGS.some(function (l) { return l[0] === savedLang; })) savedLang = DEFAULT_LANG;
        var savedSkip = lsGetList(K.skip);

        host.innerHTML =
            '<div class="prompt-block-row"><strong>🔬 Research &amp; PYQ for this topic</strong></div>' +
            '<p class="prompt-block-desc">Two separate prompts. <b>Research</b> checks your content against authentic sources and finds gaps. <b>PYQ</b> finds real previously asked questions and predicts new ones. Paste into an AI that has <b>web search</b> (Gemini, ChatGPT with search, Perplexity, Claude with search).</p>' +
            '<div class="rp-exam"></div>' +
            '<div class="rp-src"></div>' +
            '<label class="quiz-lbl">Output length</label>' +
            '<select class="rp-len">' + LENGTHS.map(function (l) {
                return '<option value="' + l[0] + '"' + (l[0] === savedLen ? " selected" : "") + ">" + esc(l[1]) + "</option>";
            }).join("") + "</select>" +
            '<input type="text" class="rp-customlen" maxlength="160" placeholder="e.g. max 500 words, or: only give tables" style="width:100%;box-sizing:border-box;margin-top:6px;display:none;">' +
            '<label class="quiz-lbl">Output language</label>' +
            '<select class="rp-lang">' + LANGS.map(function (l) {
                return '<option value="' + l[0] + '"' + (l[0] === savedLang ? " selected" : "") + ">" + esc(l[1]) + "</option>";
            }).join("") + "</select>" +
            '<label class="quiz-lbl">Skip these sections <span class="field-optional">(optional)</span></label>' +
            '<div class="rp-skiprow"><span class="rp-skiplbl">Research:</span>' + SKIP_RESEARCH.map(function (s) {
                return '<label class="flashcard-enonly"><input type="checkbox" data-skip="' + s[0] + '"' + (savedSkip.indexOf(s[0]) >= 0 ? " checked" : "") + "> " + esc(s[1]) + "</label>";
            }).join("") + '</div>' +
            '<div class="rp-skiprow"><span class="rp-skiplbl">PYQ:</span>' + SKIP_PYQ.map(function (s) {
                return '<label class="flashcard-enonly"><input type="checkbox" data-skip="' + s[0] + '"' + (savedSkip.indexOf(s[0]) >= 0 ? " checked" : "") + "> " + esc(s[1]) + "</label>";
            }).join("") + '</div>' +
            '<label class="quiz-lbl">Free-text note <span class="field-optional">(optional, remembered)</span></label>' +
            '<textarea class="rp-note" rows="2" style="width:100%;box-sizing:border-box;" placeholder="e.g. sirf 2018 ke baad ke sawal. Ya: Hindi medium sources prefer karo. Ya: sirf Unit 3 ke angle se."></textarea>' +
            '<div class="prompt-block-row">' +
            '<button type="button" class="content-action primary rp-copy-research">🔬 Copy Research Prompt</button>' +
            '<button type="button" class="content-action primary rp-copy-pyq">📜 Copy PYQ Prompt</button>' +
            '<label class="flashcard-enonly"><input type="checkbox" class="rp-enonly"' + (lsGet(K.enOnly, "1") !== "0" ? " checked" : "") + '> English only (shorter)</label>' +
            '</div>' +
            '<div class="quiz-add-preview rp-status"></div>' +
            '<details class="content-link-guide"><summary>What to do after copying</summary>' +
            '<p class="prompt-block-desc">Paste into an AI with web search on. Open the links it gives before trusting any reference. Anything marked <b>Uncertain</b> or <b>Not verified</b> should be checked on the official site. Keep verified findings in your own notes; do not treat AI-predicted questions as real PYQs.</p></details>';

        function $(sel) { return host.querySelector(sel); }
        var exams = chipPicker($(".rp-exam"), {
            title: "Exam focus", groups: EXAM_GROUPS, selKey: K.exams, customKey: K.customExams,
            placeholder: "Add your own exam, press Enter", emptyText: "None chosen = General (all government exams)"
        });
        var sources = chipPicker($(".rp-src"), {
            title: "Sources focus", groups: SOURCE_GROUPS, selKey: K.sources, customKey: K.customSources,
            placeholder: "Add a website / book / authority, press Enter", emptyText: "None chosen = AI picks authentic sources itself"
        });

        var langEl = $(".rp-lang");
        langEl.addEventListener("change", function () { lsSet(K.lang, langEl.value); });
        var lenEl = $(".rp-len"), customLenEl = $(".rp-customlen"), noteEl = $(".rp-note"), enOnlyEl = $(".rp-enonly"), statusEl = $(".rp-status");
        customLenEl.value = lsGet(K.customLen, "");
        noteEl.value = lsGet(K.note, "");

        function status(text, kind) {
            statusEl.textContent = text;
            statusEl.className = "quiz-add-preview rp-status" + (kind ? " " + kind : "");
        }
        function syncLen() { customLenEl.style.display = lenEl.value === "custom" ? "" : "none"; }
        syncLen();
        lenEl.addEventListener("change", function () { lsSet(K.length, lenEl.value); syncLen(); });
        customLenEl.addEventListener("input", function () { lsSet(K.customLen, customLenEl.value); });
        noteEl.addEventListener("input", function () { lsSet(K.note, noteEl.value); });
        enOnlyEl.addEventListener("change", function () { lsSet(K.enOnly, enOnlyEl.checked ? "1" : "0"); });
        host.querySelectorAll("input[data-skip]").forEach(function (cb) {
            cb.addEventListener("change", function () {
                var all = [].slice.call(host.querySelectorAll("input[data-skip]:checked")).map(function (x) { return x.getAttribute("data-skip"); });
                lsSetList(K.skip, all);
            });
        });

        function common() {
            return {
                topic: ctx.topic || "",
                breadcrumb: ctx.breadcrumb || "",
                exams: exams.get(),
                sources: sources.get(),
                length: lenEl.value,
                lang: langEl.value,
                customLen: customLenEl.value.trim(),
                note: noteEl.value.trim(),
                skip: [].slice.call(host.querySelectorAll("input[data-skip]:checked")).map(function (x) { return x.getAttribute("data-skip"); })
            };
        }

        function doCopy(btn, build, withContent) {
            var o = common();
            var cb = null;
            if (withContent) {
                cb = buildContentBlock(ctx.getSplit ? ctx.getSplit() : null, ctx.clean, !!enOnlyEl.checked);
                if (cb) o.content = cb.text;
            }
            var prompt = build(o);
            var original = btn.innerHTML;
            copyText(prompt, function () {
                btn.innerHTML = "✓ Copied";
                btn.disabled = true;
                setTimeout(function () { btn.innerHTML = original; btn.disabled = false; }, 1800);
                var msg = "✓ Copied";
                if (withContent) msg += cb ? " (with your " + (cb.bilingual ? "English + Hindi" : "single-language") + " content)." : ". No content is loaded for this topic, so the AI will research from the topic name only.";
                else msg += ".";
                if (prompt.length > 30000) msg += " Long paste (" + Math.round(prompt.length / 1000) + "k characters): tick English only or untick sections if your AI app cuts it.";
                status(msg, "ok");
            }, function () {
                status("Automatic copy was blocked by the browser. Try again, or allow clipboard access for this site.", "err");
            });
        }

        $(".rp-copy-research").addEventListener("click", function () { doCopy(this, researchPrompt, true); });
        $(".rp-copy-pyq").addEventListener("click", function () { doCopy(this, pyqPrompt, false); });
    }

    window.ResearchPYQ = {
        mount: mount,
        __test: { researchPrompt: researchPrompt, pyqPrompt: pyqPrompt, buildContentBlock: buildContentBlock }
    };
})();
