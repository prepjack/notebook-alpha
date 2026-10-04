/* =========================================================
   js/quiz-prompt.js — quiz section inside the "Add Content Folder" box

   One place for everything about a topic's quizzes:
     1. build + copy the quiz prompt (topic text already inside),
        with the user's choice of question TYPES and COUNTS,
     2. paste the finished quiz's Drive link and save it.

   Public API:
     window.QuizPrompt.mount(hostElement, ctx)
       ctx = { api, nodeId, topic, subject, parent, getSplit(), clean(text) }
       getSplit() -> { en, hi, ai } of the topic's currently loaded text
       clean(text) -> the page's own cleanContentForPrompt()

   QUESTION TYPES live in ONE registry (TYPE_REGISTRY below). The popup's
   counters and the prompt's "QUESTION TYPES" section are both generated
   from it, so adding a built-in type = adding one entry here.
   Users can also add their own types with [+ Add type]; those are kept
   in localStorage and sent to the AI as "name + description".
   ========================================================= */
(function () {
    "use strict";

    var LS_EXAM = "quizPrompt:exam";
    var LS_LANG = "quizPrompt:lang";
    var LS_COUNTS = "quizPrompt:counts";
    var LS_CUSTOM = "quizPrompt:customTypes";
    var LS_MODE = "quizPrompt:mode";

    var MAX_PER_TYPE = 20;   // one type
    var LONG_QUIZ = 20;      // total above this -> warn (output may get cut)

    // ---------- the registry ----------
    var TYPE_REGISTRY = [
        { id: "mcq", label: "Multiple choice (MCQ)",
          spec: "4 options, ek sahi. answer = sahi option ka 0-based index." },
        { id: "mcq_negative", label: "MCQ — NOT / EXCEPT",
          spec: "'Kaun sa kathan SAHI NAHI hai / EXCEPT / NOT' style: 4 options mein se 3 sahi aur 1 galat; answer = wo galat option jo poocha gaya (0-based index). Question mein NOT/EXCEPT capital mein likho. JSON mein \"negative\": true do (renderer isse mcq ki tarah chalaye aur chhota 'NOT' badge dikhaye)." },
        { id: "tf", label: "True / False",
          spec: "ek statement; answer = true ya false (boolean); explanation mein reason." },
        { id: "fib", label: "Fill in the blank",
          spec: "'____' wali khali jagah; ya to 4 options (answer = index) ya typed answer (answer text + \"accepted\" array jisme sahi spellings hon)." },
        { id: "match", label: "Match the following",
          spec: "4 pairs: \"pairs\": [{\"left\",\"right\"}, ...]; right side shuffle karke dikhao; pairs ka diya hua order hi sahi jodi hai." },
        { id: "order", label: "Sequence / order",
          spec: "4-5 \"items\" ka sahi sequence; items shuffle karke dikhao; answer = items ke indexes ki array, sahi order mein." },
        { id: "stmt", label: "Statement I / II",
          spec: "\"statements\" ek ARRAY (Statement I, II ... har ek alag item); question mein sirf intro line. Options standard 4: dono sahi / dono galat / I sahi II galat / I galat II sahi. answer = option index." },
        { id: "ar", label: "Assertion – Reason",
          spec: "\"assertion\" aur \"reason\" alag fields; question mein sirf intro (ya khali). Options standard 4: dono sahi aur R sahi vyakhya / dono sahi par R vyakhya nahi / A sahi R galat / A galat R sahi. answer = option index." },
        { id: "multi_correct", label: "Which statements are correct (I, II, III…)",
          spec: "\"statements\" ARRAY (3-4 items: I, II, III, IV); options coded combinations jaise 'I and II only', 'II and III only', 'I, II and III only'; answer = option index." },
        { id: "odd_one_out", label: "Odd one out",
          spec: "4 options mein se ek jo baaki teen se alag ho; answer = us option ka index; explanation mein batao baaki teen mein kya common hai. Renderer mcq jaisa." }
    ];

    // Every preset totals 12 questions and includes a NOT/EXCEPT question.
    var PRESETS = [
        { id: "exam", label: "Exam pattern",
          counts: { mcq: 4, mcq_negative: 2, stmt: 2, ar: 2, multi_correct: 2 } },
        { id: "recall", label: "Quick recall",
          counts: { mcq: 4, mcq_negative: 1, tf: 3, fib: 2, odd_one_out: 2 } },
        { id: "mixed", label: "Mixed",
          counts: { mcq: 3, mcq_negative: 1, tf: 1, fib: 1, match: 1, order: 1, stmt: 1, ar: 1, multi_correct: 1, odd_one_out: 1 } }
    ];

    var FOCUS_OPTIONS = [
        { v: "", label: "Balanced mix (whole content)" },
        { v: "definitions & key terms", label: "Definitions & key terms" },
        { v: "compare & contrast", label: "Compare & contrast" },
        { v: "application & tricky options", label: "Application & tricky options" },
        { v: "quick revision", label: "Quick revision" }
    ];

    var LANG_OPTIONS = [
        { v: "en", label: "English" },
        { v: "hi", label: "Hindi" },
        { v: "hinglish", label: "Hinglish (Hindi in Roman letters)" },
        { v: "bilingual", label: "English + हिंदी (bilingual)" }
    ];

    // ---------- small helpers ----------
    function esc(s) {
        return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }
    function lsGet(k, d) { try { var v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } }
    function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* blocked */ } }
    function slug(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); }

    function fileNameFor(topic, nodeId, focus, lang, parent) {
        var base = [slug(parent), slug(topic)].filter(Boolean).join("_") || slug(nodeId) || "topic";
        var f = slug(focus);
        var code = lang === "bilingual" ? "bi" : lang;
        return base + (f ? "-" + f : "") + "-" + code + ".html";
    }

    function options(list, selected) {
        return list.map(function (o) {
            return '<option value="' + esc(o.v) + '"' + (o.v === selected ? " selected" : "") + ">" + esc(o.label) + "</option>";
        }).join("");
    }

    // ---------- custom types (kept in the browser) ----------
    function loadCustomTypes() {
        try {
            var arr = JSON.parse(lsGet(LS_CUSTOM, "[]"));
            if (!Array.isArray(arr)) return [];
            return arr.filter(function (t) { return t && t.id && t.label && t.desc; });
        } catch (e) { return []; }
    }
    function saveCustomTypes(list) { lsSet(LS_CUSTOM, JSON.stringify(list)); }

    function allTypes(custom) {
        return TYPE_REGISTRY.concat(custom.map(function (t) {
            return {
                id: t.id, label: t.label, custom: true,
                spec: "CUSTOM (user ka banaya type): " + t.desc +
                      " — Agar yeh description koi nayi interaction nahi maangti, to ise mcq ki tarah dikhao " +
                      "(options + ek sahi answer, answer = 0-based index). \"type\" ki value bilkul yahi id rakho."
            };
        }));
    }

    function loadCounts() {
        try {
            var o = JSON.parse(lsGet(LS_COUNTS, "null"));
            if (o && typeof o === "object") return o;
        } catch (e) { /* fall through */ }
        return Object.assign({}, PRESETS[2].counts); // first time: Mixed (12)
    }

    var SHORT = { mcq: "MCQ", mcq_negative: "NOT", tf: "T/F", fib: "Fill", match: "Match", order: "Order",
                  stmt: "Stmt", ar: "A-R", multi_correct: "Multi", odd_one_out: "Odd" };
    function shortOf(t) {
        return SHORT[t.id] || (t.label.length > 12 ? t.label.slice(0, 11) + "…" : t.label);
    }

    function clampCount(n) {
        n = parseInt(n, 10);
        if (!isFinite(n) || n < 0) n = 0;
        return Math.min(MAX_PER_TYPE, n);
    }

    function totalOf(types, counts) {
        return types.reduce(function (sum, t) { return sum + clampCount(counts[t.id]); }, 0);
    }

    // ---------- the prompt ----------
    // o: { lang, focus, exam, subject, topic, content, fileName,
    //      types: [{id,label,spec,count}] (count > 0 only), count: total }
    function buildPrompt(o) {
        var exam = o.exam ? o.exam : "(not specified)";
        var types = o.types || [];
        var total = o.count;

        var typeLines = types.map(function (t) {
            return "  " + t.id + " x" + t.count + "  (" + t.label + "): " + t.spec;
        });
        var distro = types.map(function (t) { return t.id + ": " + t.count; }).join(", ");

        var bil = o.lang === "bilingual" ? [
            "9. LANGUAGE bilingual hai: question, har option, explanation, tf ki reason",
            "   aur match/order ke har item ko ek hi string mein is format mein do:",
            "   \"English text || हिंदी text\"  (pehle English, phir ' || ', phir Devanagari",
            "   Hindi; technical terms Hindi side mein bhi English hi rakho). Renderer is",
            "   string ko ' || ' pe todkar English upar aur Hindi neeche (halke rang mein)",
            "   dikhaye. HAR string mein SIRF EK ' || ' ho (ek string = ek baat). Isliye",
            "   statements ke har item, assertion, reason aur har option alag string ho,",
            "   aur har string apna ' || ' rakhe. Renderer split karte waqt sirf PEHLE",
            "   ' || ' pe tode (indexOf se), split(' || ') se nahi.",
            "   answer wale fields (option index, True/False, sahi order) is",
            "   format se bahar rahein. evidence aur fib ke typed accepted answers sirf",
            "   English mein hon."
        ].join("\n") : null;


        var techFile = [
            "== TECHNICAL RULES ==",
            "1. Ek hi .html file. Inline CSS + vanilla JS. Koi CDN, font, image ya",
            "   library nahi.",
            "2. localStorage / sessionStorage / cookies / fetch BILKUL use mat karo.",
            "   State sirf JS variables mein.",
            "3. File ke top par ye do blocks do, bilkul isi format mein:",
            "   <script type=\"application/json\" id=\"quiz-meta\">",
            "   {\"title\",\"file_name\",\"exam\",\"subject\",\"topic\",\"language\",\"total\",\"types\":{type_id: ginti, ...},\"notes\"}",
            "   </script>",
            "   <script type=\"application/json\" id=\"quiz-data\">",
            "   [ { id, type, question, options/pairs/items/statements/assertion/reason, answer, explanation, evidence }, ... ]",
            "   </script>",
            "   quiz-data ek JSON ARRAY ho (object nahi). Har item ka \"type\" upar ki list ka id ho,",
            "   aur uske fields us type ke spec ke hisaab se. Questions alag se JS mein",
            "   hardcode mat karo; ek generic renderer in dono blocks se padhe. Statements,",
            "   assertion, reason ko kabhi question string ke andar \\n se jodkar mat bharo.",
            "   quiz-meta ka \"total\" aur \"types\" quiz-data ki asli ginti se match karein.",
            "4. FILE NAME: quiz-meta ke \"file_name\" mein bilkul yahi naam do: " + o.fileName,
            "   Wahi naam <title> ke saath bhi do. Kabhi \"quiz.html\" ya \"index.html\"",
            "   naam mat rakho.",
            "5. Mobile-first (360px), dark/light dono mein padhne layak, bade tap",
            "   targets.",
            "6. Flow: ek time pe ek question, check karte hi feedback + explanation +",
            "   evidence, phir Next. Upar progress bar. Options har baar shuffle",
            "   (order type chhodke).",
            "7. End par result screen: score, type-wise breakdown, galat questions ki",
            "   list (explanation ke saath), \"Retry wrong only\" aur \"Retry all\".",
            "8. Result screen par bhejo:",
            "   parent.postMessage({type:'quiz-result', score, total, byType, wrongIds}, '*');",
            "9. Output sirf poora HTML code, koi extra text nahi."
        ];
        var techChat = [
            "== TECHNICAL RULES (MODE: PLAY-NOW) ==",
            "1. Quiz ek self-contained interactive app ho: inline CSS + vanilla JS, koi CDN,",
            "   font, image ya library nahi.",
            "2. localStorage / sessionStorage / cookies / fetch BILKUL use mat karo.",
            "   State sirf JS variables mein.",
            "3. Saare questions ek array mein rakho, har item ka \"type\" upar ki list ka id ho aur",
            "   fields us type ke spec ke hisaab se. Ek generic renderer unhe dikhaye.",
            "   Statements, assertion, reason ko kabhi question string ke andar \\n se",
            "   jodkar mat bharo.",
            "4. Mobile-first (360px), dark/light dono mein padhne layak, bade tap targets.",
            "5. Flow: ek time pe ek question, check karte hi feedback + explanation +",
            "   evidence, phir Next. Upar progress bar. Options har baar shuffle",
            "   (order type chhodke).",
            "6. End par result screen: score, type-wise breakdown, galat questions ki",
            "   list (explanation ke saath), \"Retry wrong only\" aur \"Retry all\".",
            "7. PLAIN-TEXT MODE (sirf tab jab interactive preview na chale): ek-ek question",
            "   poochho, mere jawab ka intezaar karo, turant sahi/galat + explanation +",
            "   evidence batao, phir agla question. Aakhir mein score aur galat questions",
            "   ki list dikhao.",
            "8. Sirf ek chhoti line likho, uske baad quiz. Lamba extra text nahi."
        ];
        var tech = o.mode === "chat" ? techChat : techFile;
        var contract = o.mode === "chat" ? [
            "##### OUTPUT CONTRACT — MODE: PLAY-NOW #####",
            "Tumhara jawab = ek interactive quiz jo main isi conversation mein TURANT khelunga",
            "(is app ka interactive preview: canvas / artifact).",
            "- Sirf ek chhoti line likho, phir quiz. Koi download, file ya link nahi.",
            "- Agar tum is conversation mein interactive preview nahi chala sakte, to PLAIN-TEXT",
            "  MODE mein quiz khelao (ek-ek sawaal, mera jawab, turant feedback). Neeche",
            "  TECHNICAL RULES ka step 7 dekho.",
            "###############################################"
        ] : [
            "##### OUTPUT CONTRACT — MODE: SAVE-FILE #####",
            "Tumhara poora jawab = EK complete HTML document (<!DOCTYPE html> se </html> tak).",
            "- Isse pehle ya baad mein koi text, intro, explanation ya markdown nahi.",
            "- Ye file ki tarah save hoga, isliye neeche TECHNICAL RULES ka format bilkul waisa hi chahiye.",
            "################################################"
        ];
        var reminder = o.mode === "chat"
            ? "REMINDER (MODE: PLAY-NOW): output = ek chhoti line + interactive quiz jo isi conversation mein khele. Koi file ya download nahi."
            : "REMINDER (MODE: SAVE-FILE): output = sirf ek complete HTML document, uske bahar kuch nahi.";
        var lead = o.mode === "chat"
            ? ["chhota practice quiz banana hai, jo main isi conversation mein turant khel sakun.",
               null]
            : ["chhota practice quiz banana hai, jo ek single self-contained HTML file ho.",
               null];
        return [
            contract.join("\n"),
            "",
            "Tum ek experienced exam question-setter ho. Neeche diye STUDY CONTENT se ek",
            lead[0],
            lead[1],
            "",
            "EXAM CONTEXT: " + exam,
            "SUBJECT: " + (o.subject || "(not specified)"),
            "TOPIC: " + o.topic,
            "FOCUS: " + (o.focus || "(none: balanced mix)"),
            "LANGUAGE: " + o.lang + "    (en / hi / hinglish / bilingual: poora quiz isi mein)",
            "QUESTIONS: " + total + " (exactly)",
            "",
            "STUDY CONTENT:",
            o.content,
            "",
            "== CONTEXT RULES ==",
            "1. EXAM CONTEXT diya hai to usi exam ke question style, difficulty aur",
            "   phrasing ke hisaab se likho. Khali hai to general competitive-exam",
            "   style rakho, kisi khaas exam ka naam mat lo.",
            "2. Question TYPES aur unki ginti neeche user ne khud tay ki hai. Unhe exam",
            "   context ke naam par badlo mat; exam context sirf phrasing/difficulty ke liye hai.",
            "3. Agar EXAM CONTEXT mein ek se zyada exam hain, to phrasing aisi rakho jo un",
            "   sabme common ho, kisi ek exam ki khaas phrasing mat pakdo.",
            "4. FOCUS diya hai to questions mainly usi angle se banao. Khali ho to",
            "   poore content ka balanced mix rakho.",
            "",
            "== CONTENT RULES (sabse zaroori) ==",
            "1. Har question SIRF STUDY CONTENT se bane. Bahar ke facts, naam, saal ya",
            "   definitions mat jodo. Content mein jo nahi hai, uska question mat banao.",
            "2. Har question ke saath \"evidence\" do: content ka wo chhota hissa",
            "   (max 20 words, apne shabdon mein) jis par question aur uska answer",
            "   tika hai. Evidence na mile to wo question hata do.",
            "3. Har question ki explanation do: sahi answer kyun sahi hai (1-2 line),",
            "   aur galat options kyun galat hain (1 line).",
            "4. Content ke sab important hisse cover karo. Ek hi paragraph se saare",
            "   questions mat nikalo.",
            "5. Difficulty mix: ~40% easy (recall), ~40% medium (concept/compare),",
            "   ~20% hard (application, confusing-but-plausible options).",
            "6. Distractors plausible hon (isi topic ke asli terms, near-miss). \"All of",
            "   the above\" / \"None of the above\" avoid karo. Sahi answer ki position",
            "   random rakho.",
            "7. Koi question duplicate na ho, aur ek question dusre ka answer na de.",
            "8. Technical terms English mein hi rakho, chahe LANGUAGE hindi/hinglish ho.",
            bil,
            "",
            "== QUESTION TYPES (exact distribution, total " + total + ") ==",
            typeLines.join("\n"),
            "",
            "DISTRIBUTION: " + distro + ".",
            "- Har type ki UTNI hi ginti rakho jitni upar likhi hai (total " + total + "). HTML dene se pehle",
            "  quiz-data ki ginti type-wise verify karo.",
            "- Jo type list mein nahi hai wo mat banao.",
            "- Agar content kisi type ke liye ground hi nahi deta (jaise match ke liye 4 pairs, ya",
            "  order ke liye koi sequence), to wo question zabardasti mat banao: uski ginti kam karke",
            "  baaki chune hue types mein baanto, aur " + (o.mode === "chat"
                ? "apni pehli chhoti line mein mujhe batao"
                : "quiz-meta ke \"notes\" field mein ek line likho") + " ki kya badla aur kyun.",
            "",
            tech.join("\n"),
            "",
            reminder
        ].filter(function (x) { return x !== null; }).join("\n");
    }

    // ---------- topic content as the model should see it ----------
    function buildContentBlock(split, clean, enOnly) {
        var en = split && String(split.en || "").trim();
        var hi = split && String(split.hi || "").trim();
        var ai = split && String(split.ai || "").trim();
        if (!en && !hi && !ai) return null;
        var c = clean || function (t) { return String(t || "").trim(); };
        if (en) {
            var hiText = (enOnly || !hi) ? "" : c(split.hi);
            var block = "=== CONTENT (ENGLISH) ===\n" + c(split.en);
            if (hiText) block += "\n\n=== CONTENT (हिंदी) ===\n" + hiText;
            return { text: block, included: hiText ? "English + Hindi content" : "English content only" };
        }
        if (hi) {
            return {
                text: "NOTE: This topic has no English version; only the Hindi text below exists.\n\n=== CONTENT (हिंदी) ===\n" + c(split.hi),
                included: "Hindi content only"
            };
        }
        return {
            text: "NOTE: This topic only has an AI-explainer version, written in conversational Hinglish. Take every fact only from this text and keep its technical terms exactly as written.\n\n=== CONTENT (AI EXPLAINER - HINGLISH) ===\n" + c(split.ai),
            included: "AI-explainer content only"
        };
    }

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

    // ---------- mount(): the quiz section inside the content box ----------
    function mount(host, ctx) {
        if (!host || !ctx) return;
        var api = ctx.api, nodeId = ctx.nodeId, topic = ctx.topic || ctx.nodeId || "Topic";
        var custom = loadCustomTypes();
        var counts = loadCounts();

        host.classList.add("quiz-host");
        host.innerHTML =
            '<div class="prompt-block-row"><strong>📝 Quiz for this topic</strong></div>' +
            '<p class="prompt-block-desc"><strong>1. Make:</strong> choose the question types, copy the prompt (this topic\'s text is already inside), paste it into Gemini or another AI, and save the HTML it returns in this topic\'s Drive folder under the suggested file name. ' +
            '<strong>2. Add:</strong> paste that file\'s Drive link below. It then appears in Practice → this topic → Quiz.</p>' +
            '<div class="qp-row">' +
            '<div><label class="quiz-lbl">Quiz language</label><select class="qh-lang">' + options(LANG_OPTIONS, lsGet(LS_LANG, "en")) + "</select></div>" +
            '<div><label class="quiz-lbl">Focus</label><select class="qh-focus">' + options(FOCUS_OPTIONS, "") + "</select></div>" +
            "</div>" +
            '<label class="quiz-lbl">Exam context (use one exam if this topic is for one)</label>' +
            '<input type="text" class="qh-exam" placeholder="e.g. UGC NET, SSC, BPSC" value="' + esc(lsGet(LS_EXAM, "")) + '">' +
            '<label class="quiz-lbl">What do you want?</label>' +
            '<div class="qh-modes">' +
            '<label class="qh-mode"><input type="radio" name="qhmode" value="file"' + (lsGet(LS_MODE, "file") !== "chat" ? " checked" : "") + '> <span><strong>Save to site</strong> — the AI gives an HTML file; add it below and it appears in Practice.</span></label>' +
            '<label class="qh-mode"><input type="radio" name="qhmode" value="chat"' + (lsGet(LS_MODE, "file") === "chat" ? " checked" : "") + '> <span><strong>Quick attempt in chat</strong> — attempt it right in the AI chat. Nothing is saved (learn &amp; forget).</span></label>' +
            "</div>" +
            '<button type="button" class="qh-strip" aria-expanded="false"><span class="qh-arrow">▸</span><span class="qh-striplbl">Question types</span><span class="qh-summary"></span></button>' +
            '<div class="qh-typesbody" hidden>' +
            '<div class="qh-presets">' +
            PRESETS.map(function (p) { return '<button type="button" class="qh-preset" data-preset="' + p.id + '">' + esc(p.label) + "</button>"; }).join("") +
            '<button type="button" class="qh-preset" data-preset="none">Clear</button></div>' +
            '<div class="qh-types"></div>' +
            '<button type="button" class="qh-addtype-btn">+ Add type</button>' +
            '<div class="qh-addform" hidden>' +
            '<input type="text" class="qh-ct-name" placeholder="Type name, e.g. Matching with code">' +
            '<textarea class="qh-ct-desc" rows="2" placeholder="Describe it for the AI: how many options, how the answer is given. e.g. 4 pairs, options are codes like A-ii B-i C-iv D-iii, one correct code"></textarea>' +
            '<div class="qh-addform-row"><button type="button" class="qh-ct-add">Add</button><button type="button" class="qh-ct-cancel">Cancel</button></div>' +
            "</div>" +
            "</div>" +
            '<div class="quiz-add-preview qh-totalnote"></div>' +
            '<div class="prompt-block-row qh-copyrow">' +
            '<button type="button" class="content-action qh-copy">📝 Copy Quiz Prompt</button>' +
            '<label class="flashcard-enonly"><input type="checkbox" class="qh-enonly"> EN only (shorter)</label>' +
            "</div>" +
            '<div class="quiz-add-preview qh-copystatus"></div>' +
            '<hr class="qh-sep">' +
            '<label class="quiz-lbl">Drive link of the finished quiz .html file</label>' +
            '<input type="text" class="qh-link" placeholder="https://drive.google.com/file/d/…/view" autocomplete="off">' +
            '<div class="quiz-add-preview qh-preview">Paste the link — title and question count fill in automatically.</div>' +
            '<label class="quiz-lbl">Title</label><input type="text" class="qh-title" placeholder="e.g. Basics recall">' +
            '<div class="quiz-add-actions"><button type="button" class="resource-submit-btn qh-save" disabled>Save quiz</button></div>' +
            '<div class="qh-list"></div>';

        function $(sel) { return host.querySelector(sel); }
        var langEl = $(".qh-lang"), focusEl = $(".qh-focus"), examEl = $(".qh-exam");
        var typesEl = $(".qh-types"), summaryEl = $(".qh-summary"), totalNote = $(".qh-totalnote");
        var stripEl = $(".qh-strip"), bodyEl = $(".qh-typesbody");
        var enOnlyEl = $(".qh-enonly"), copyEl = $(".qh-copy"), copyStatus = $(".qh-copystatus");
        var linkEl = $(".qh-link"), prevEl = $(".qh-preview"), titleEl = $(".qh-title"), saveEl = $(".qh-save");
        var listEl = $(".qh-list");
        var addBtn = $(".qh-addtype-btn"), addForm = $(".qh-addform");
        var ctName = $(".qh-ct-name"), ctDesc = $(".qh-ct-desc");

        function status(el, text, kind) {
            el.textContent = text;
            el.className = "quiz-add-preview " + (el.dataset.base || "") + (kind ? " " + kind : "");
        }
        copyStatus.dataset.base = "qh-copystatus";
        prevEl.dataset.base = "qh-preview";
        totalNote.dataset.base = "qh-totalnote";

        // ---- question types: counters ----
        function persistCounts() { lsSet(LS_COUNTS, JSON.stringify(counts)); }

        function renderTypes() {
            var types = allTypes(custom);
            typesEl.innerHTML = types.map(function (t) {
                var n = clampCount(counts[t.id]);
                return '<div class="qh-trow' + (n > 0 ? " on" : "") + '" data-id="' + esc(t.id) + '">' +
                    '<span class="qh-tname">' + esc(t.label) + (t.custom ? ' <em>(custom)</em>' : "") + "</span>" +
                    '<span class="qh-tctl">' +
                    '<button type="button" class="qh-step" data-act="dec" aria-label="less">−</button>' +
                    '<input type="number" class="qh-tcount" min="0" max="' + MAX_PER_TYPE + '" value="' + n + '">' +
                    '<button type="button" class="qh-step" data-act="inc" aria-label="more">+</button>' +
                    (t.custom ? '<button type="button" class="qh-del" data-act="del" title="Remove this custom type">✕</button>' : "") +
                    "</span></div>";
            }).join("");
            updateTotal();
        }

        function updateTotal() {
            var types = allTypes(custom);
            var total = totalOf(types, counts);
            var on = types.filter(function (t) { return clampCount(counts[t.id]) > 0; });
            var parts = on.slice(0, 4).map(function (t) { return shortOf(t) + " " + clampCount(counts[t.id]); });
            if (on.length > 4) parts.push("+" + (on.length - 4) + " more");
            summaryEl.textContent = total + " questions" + (parts.length ? " · " + parts.join(", ") : "");
            if (total === 0) status(totalNote, "Pick at least one type (use a preset or the + buttons).", "err");
            else if (total > LONG_QUIZ) status(totalNote, "⚠ " + total + " questions is long — the AI's answer may get cut off. Two shorter quizzes work better.", "err");
            else status(totalNote, "");
            showName();
        }

        typesEl.addEventListener("click", function (ev) {
            var btn = ev.target.closest("[data-act]");
            if (!btn) return;
            var row = btn.closest(".qh-trow");
            var id = row.dataset.id;
            if (btn.dataset.act === "del") {
                if (!confirm("Remove this custom type?")) return;
                custom = custom.filter(function (t) { return t.id !== id; });
                delete counts[id];
                saveCustomTypes(custom);
            } else {
                var n = clampCount(counts[id]);
                counts[id] = clampCount(n + (btn.dataset.act === "inc" ? 1 : -1));
            }
            persistCounts();
            renderTypes();
        });
        typesEl.addEventListener("change", function (ev) {
            var inp = ev.target.closest(".qh-tcount");
            if (!inp) return;
            counts[inp.closest(".qh-trow").dataset.id] = clampCount(inp.value);
            persistCounts();
            renderTypes();
        });

        host.querySelector(".qh-presets").addEventListener("click", function (ev) {
            var b = ev.target.closest("[data-preset]");
            if (!b) return;
            var p = PRESETS.filter(function (x) { return x.id === b.dataset.preset; })[0];
            counts = p ? Object.assign({}, p.counts) : {};
            persistCounts();
            renderTypes();
        });

        // ---- expand / collapse strip ----
        stripEl.addEventListener("click", function () {
            var open = bodyEl.hidden;           // currently collapsed -> open it
            bodyEl.hidden = !open;
            stripEl.setAttribute("aria-expanded", open ? "true" : "false");
        });

        // ---- custom type form ----
        addBtn.addEventListener("click", function () { addForm.hidden = !addForm.hidden; if (!addForm.hidden) ctName.focus(); });
        $(".qh-ct-cancel").addEventListener("click", function () { addForm.hidden = true; });
        $(".qh-ct-add").addEventListener("click", function () {
            var name = ctName.value.trim(), desc = ctDesc.value.trim();
            if (!name || !desc) { status(totalNote, "Give the type a name and a one-line description for the AI.", "err"); return; }
            var base = "custom_" + (slug(name).replace(/-/g, "_") || "type");
            var id = base, k = 2;
            var taken = function (x) { return allTypes(custom).some(function (t) { return t.id === x; }); };
            while (taken(id)) id = base + "_" + (k++);
            custom.push({ id: id, label: name, desc: desc });
            counts[id] = 1;
            saveCustomTypes(custom);
            persistCounts();
            ctName.value = ""; ctDesc.value = ""; addForm.hidden = true;
            renderTypes();
        });

        // ---- prompt ----
        function current() {
            var types = allTypes(custom)
                .map(function (t) { return { id: t.id, label: t.label, spec: t.spec, count: clampCount(counts[t.id]) }; })
                .filter(function (t) { return t.count > 0; });
            return {
                mode: modeValue(),
                lang: langEl.value, focus: focusEl.value, exam: examEl.value.trim(),
                subject: ctx.subject || "", topic: topic,
                types: types,
                count: types.reduce(function (s, t) { return s + t.count; }, 0)
            };
        }
        function modeValue() {
            var r = host.querySelector('input[name="qhmode"]:checked');
            return r && r.value === "chat" ? "chat" : "file";
        }
        function showName() {
            var o = current();
            if (o.mode === "chat") {
                status(copyStatus, "Quick attempt: the AI will open the quiz right in the chat. Nothing is saved to the site.");
            } else {
                status(copyStatus, "Suggested file name: " + fileNameFor(topic, nodeId, o.focus, o.lang, ctx.parent));
            }
        }
        host.querySelectorAll('input[name="qhmode"]').forEach(function (r) {
            r.addEventListener("change", function () { lsSet(LS_MODE, modeValue()); showName(); });
        });
        [langEl, focusEl].forEach(function (e) { e.addEventListener("change", showName); });

        copyEl.addEventListener("click", function () {
            var o = current();
            if (!o.count) { status(copyStatus, "Pick at least one question type first.", "err"); return; }
            var split = ctx.getSplit ? ctx.getSplit() : null;
            var cb = buildContentBlock(split, ctx.clean, !!enOnlyEl.checked);
            if (!cb) {
                status(copyStatus, "This topic has no content loaded yet. Add and open its content first — the quiz prompt is built from that text.", "err");
                return;
            }
            o.content = cb.text;
            o.fileName = fileNameFor(topic, nodeId, o.focus, o.lang, ctx.parent);
            lsSet(LS_LANG, o.lang); lsSet(LS_EXAM, o.exam); lsSet(LS_MODE, o.mode);
            var prompt = buildPrompt(o);
            var original = copyEl.innerHTML;
            copyText(prompt, function () {
                copyEl.innerHTML = "✓ Prompt Copied";
                copyEl.disabled = true;
                setTimeout(function () { copyEl.innerHTML = original; copyEl.disabled = false; }, 1800);
                var big = prompt.length > 30000 ? " Long paste (" + Math.round(prompt.length / 1000) + "k characters) — tick \"EN only\" and copy again if your AI app cuts it." : "";
                status(copyStatus, o.mode === "chat"
                    ? "✓ Copied (" + cb.included + ", " + o.count + " questions). Paste it in Gemini / ChatGPT / Claude and attempt right there. Not saved." + big
                    : "✓ Copied (" + cb.included + ", " + o.count + " questions). Save the quiz as: " + o.fileName + "." + big, "ok");
            }, function () {
                status(copyStatus, "Automatic copy was blocked by the browser. Try again, or allow clipboard access for this site.", "err");
            });
        });

        renderTypes();

        // ---- Add quiz (paste link -> preview -> save -> confirm) ----
        var fileId = "", titleTouched = false, timer = null, token = 0;
        titleEl.addEventListener("input", function () { titleTouched = true; });

        function runPreview() {
            var link = linkEl.value.trim();
            var mine = ++token;
            fileId = "";
            saveEl.disabled = true;
            if (!link) { status(prevEl, "Paste the link — title and question count fill in automatically."); return; }
            status(prevEl, "Checking the file…");
            fetch(api + "?action=preview_quiz&ref=" + encodeURIComponent(link))
                .then(function (r) { return r.json(); })
                .then(function (d) {
                    if (mine !== token) return;
                    if (!d || !d.ok) { status(prevEl, (d && d.error) || "Couldn't read this file.", "err"); return; }
                    var i = d.info || {};
                    if (!i.has_data) { status(prevEl, "This HTML has no quiz-data block. Regenerate it with the quiz prompt above.", "err"); return; }
                    fileId = i.drive_file_id || "";
                    if (!titleTouched) titleEl.value = i.title || "";
                    var bits = [(i.question_count || 0) + " questions"];
                    if (i.exam) bits.push(i.exam);
                    if (i.language) bits.push(i.language);
                    status(prevEl, "✓ " + bits.join(" · "), "ok");
                    saveEl.disabled = false;
                })
                .catch(function () { if (mine === token) status(prevEl, "Network error. Try again.", "err"); });
        }
        linkEl.addEventListener("input", function () { clearTimeout(timer); timer = setTimeout(runPreview, 600); });

        function loadList() {
            fetch(api + "?action=get_quizzes&node_id=" + encodeURIComponent(nodeId))
                .then(function (r) { return r.json(); })
                .then(function (d) {
                    var list = (d && d.quizzes) || [];
                    if (!host.isConnected) return;
                    listEl.innerHTML = list.length
                        ? '<label class="quiz-lbl">Already added to this topic (' + list.length + ")</label>" +
                          list.map(function (q) {
                              return '<div class="qh-listrow">' + esc(q.title || "Quiz") + " · " + (Number(q.question_count) || 0) + " questions</div>";
                          }).join("")
                        : "";
                })
                .catch(function () { /* the list is a nicety; ignore */ });
        }
        loadList();

        saveEl.addEventListener("click", function () {
            var link = linkEl.value.trim();
            if (!link || !fileId) return;
            saveEl.disabled = true;
            saveEl.textContent = "Saving…";
            function reset() { saveEl.textContent = "Save quiz"; saveEl.disabled = false; }
            fetch(api, { method: "POST", mode: "no-cors", body: JSON.stringify({ action: "save_quiz", node_id: nodeId, ref: link, title: titleEl.value.trim() }) })
                .then(function () {
                    // no-cors hides the answer, so confirm by reading it back.
                    var tries = 0;
                    function check() {
                        tries++;
                        setTimeout(function () {
                            fetch(api + "?action=get_quizzes&node_id=" + encodeURIComponent(nodeId))
                                .then(function (r) { return r.json(); })
                                .then(function (d) {
                                    var found = ((d && d.quizzes) || []).some(function (q) { return String(q.drive_file_id) === fileId; });
                                    if (found) {
                                        status(prevEl, "✓ Saved. Find it in Practice → this topic → Quiz.", "ok");
                                        linkEl.value = ""; titleEl.value = ""; titleTouched = false; fileId = "";
                                        saveEl.textContent = "Save quiz"; saveEl.disabled = true;
                                        loadList();
                                    } else if (tries < 3) { check(); }
                                    else { status(prevEl, "Couldn't confirm the save. Check the Quizzes sheet, then try again.", "err"); reset(); }
                                })
                                .catch(function () { if (tries < 3) check(); else { status(prevEl, "Couldn't confirm the save.", "err"); reset(); } });
                        }, 1200);
                    }
                    check();
                })
                .catch(function () { status(prevEl, "Couldn't reach the server.", "err"); reset(); });
        });
    }

    // The old Practice-page popup is no longer used (everything is in the
    // content box now). Kept as a harmless stub so a leftover call can't throw.
    function open() { console.warn("[QuizPrompt] open() is retired; use the Add Content Folder box."); }
    function close() { /* nothing to close */ }

    window.QuizPrompt = {
        mount: mount, open: open, close: close,
        __test: { buildPrompt: buildPrompt, buildContentBlock: buildContentBlock, fileNameFor: fileNameFor,
                  TYPE_REGISTRY: TYPE_REGISTRY, PRESETS: PRESETS, allTypes: allTypes, totalOf: totalOf }
    };
})();
