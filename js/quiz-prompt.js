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

   SOURCE MODES (what the questions come from) — chosen in the box:
     topic   = this topic's content (default; already inside the prompt)
     paste   = text the user pastes (PDF / book / notes); questions only from it
     convert = ready-made questions the user pastes; the AI only turns them into
               a quiz (no new questions, each keeps its own 4/5/6 options)
     none    = no content, topic name only; the AI uses its own knowledge
   "Options per MCQ" (4 / 5 / 6) applies to the three generating modes.

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
    var LS_OPTS = "quizPrompt:opts";

    var MAX_PER_TYPE = 500;  // one type: only a sanity cap, the user decides the real number
    var LONG_QUIZ = 20;      // total above this -> gentle caution (short quizzes work best)
    var VERY_LONG_QUIZ = 50; // total above this -> firmer caution (output may get cut)

    // ---------- the registry ----------
    var TYPE_REGISTRY = [
        { id: "mcq", label: "Multiple choice (MCQ)",
          spec: "4 options, exactly one correct. answer = 0-based index of the correct option in the JSON. Shuffle the options when showing them, but each option carries its own correct flag, and the verdict uses that flag." },
        { id: "mcq_negative", label: "MCQ — NOT / EXCEPT",
          spec: "'Which statement is NOT correct / EXCEPT / NOT' style: of 4 options, 3 are true and 1 is false; answer = the false option that is asked for (0-based index in the JSON). Write NOT/EXCEPT in capital letters in the question. Put \"negative\": true in the JSON item. Shown and checked exactly like mcq (shuffled options, each with its own correct flag), plus a small 'NOT' badge. Note: the option the user must tap is the FALSE statement." },
        { id: "tf", label: "True / False",
          spec: "one statement; answer = true or false (boolean); the explanation gives the reason. Show exactly two buttons, True and False, always in this fixed order (never shuffled), and compare the tapped button with the boolean answer directly (in bilingual mode the buttons read \"True || सत्य\" and \"False || असत्य\")." },
        { id: "fib", label: "Fill in the blank",
          spec: "a '____' blank; either 4 options (answer = index; shown and checked like mcq) or a typed answer (answer text + an \"accepted\" array holding the correct spellings; the check trims spaces, ignores upper/lower case, and accepts the answer or any entry of \"accepted\"; after checking, show the correct answer)." },
        { id: "match", label: "Match the following",
          spec: "4 pairs: \"pairs\": [{\"left\",\"right\"}, ...]; the pairs are written in the correct order in the JSON. Show the left items in that order and the right items shuffled (each right item keeps the index of its own pair). The user matches every left item to a right item (dropdown or tap). The question is correct only if EVERY left item is matched to its own pair; after checking, show each left item with its correct right item and mark the wrong ones." },
        { id: "order", label: "Sequence / order",
          spec: "\"items\" (4-5) are written in the correct sequence in the JSON, and answer = [0,1,2,...] in that order. Show the items shuffled (each keeps its original index). The user arranges them (up/down buttons or tap in sequence). Correct only if the arranged original indexes read 0,1,2,... in order; after checking, show the correct sequence." },
        { id: "stmt", label: "Statement I / II",
          spec: "\"statements\" is an ARRAY (Statement I, II ... each a separate item); the question holds only an intro line. Decide first whether each statement is true or false, then choose the matching option. Standard 4 options, ALWAYS in this fixed order (never shuffled): both true / both false / I true II false / I false II true. answer = option index. The explanation says which statement is true and which is false." },
        { id: "ar", label: "Assertion – Reason",
          spec: "\"assertion\" and \"reason\" are separate fields; the question holds only an intro (or is empty). Decide first whether A is true, whether R is true, and whether R explains A, then choose the matching option. Standard 4 options, ALWAYS in this fixed order (never shuffled): both true and R is the correct explanation / both true but R is not the explanation / A true R false / A false R true. answer = option index. The explanation covers all three decisions." },
        { id: "multi_correct", label: "Which statements are correct (I, II, III…)",
          spec: "\"statements\" ARRAY (3-4 items: I, II, III, IV). Decide first which statements are true; the options are coded combinations like 'I and II only', 'II and III only', 'I, II and III only', in this fixed order (never shuffled). EXACTLY ONE option must equal the set of true statements; answer = that option's index." },
        { id: "odd_one_out", label: "Odd one out",
          spec: "of 4 options, one differs from the other three; answer = index of that option; the explanation says what the other three have in common. Shown and checked exactly like mcq (shuffled options, each with its own correct flag)." }
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

    // Options per MCQ-style question (convert mode ignores this: each pasted
    // question keeps its own 4 / 5 / 6 options).
    var OPT_OPTIONS = [
        { v: "4", label: "4 options (default)" },
        { v: "5", label: "5 options" },
        { v: "6", label: "6 options" }
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
                spec: "CUSTOM (user-defined type): " + t.desc +
                      " — If this description needs no new interaction, render it like mcq " +
                      "(options + one correct answer, answer = 0-based index). Use exactly this id as the \"type\" value."
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
    //      types: [{id,label,spec,count}] (count > 0 only), count: total,
    //      source: "topic" (default) | "paste" | "convert" | "none",
    //      optCount: 4 (default) | 5 | 6        (options per MCQ-style question),
    //      allTypes: [{id,label,spec}]          (used by "convert" only) }
    function buildPrompt(o) {
        var exam = o.exam ? o.exam : "(not specified)";
        var types = o.types || [];
        var total = o.count;
        var chat = o.mode === "chat";

        var typeLines = types.map(function (t) {
            return "  " + t.id + " x" + t.count + "  (" + t.label + "): " + t.spec;
        });
        var distro = types.map(function (t) { return t.id + ": " + t.count; }).join(", ");

        function bilRule(n) {
            if (o.lang !== "bilingual") return null;
            return [
                n + ". LANGUAGE is bilingual: write the question, every option, the explanation, the tf reason",
                "   and every match/order item as ONE string in this format:",
                "   \"English text || हिंदी text\"  (English first, then ' || ', then Devanagari",
                "   Hindi; keep technical terms in English on the Hindi side too). The renderer",
                "   splits the string at ' || ' and shows English on top and Hindi below (in a",
                "   lighter colour). Each string has EXACTLY ONE ' || ' (one string = one idea). So every",
                "   statement item, the assertion, the reason and every option is its own string,",
                "   and each string carries its own ' || '. The renderer must split only at the FIRST",
                "   ' || ' (use indexOf), not split(' || ').",
                "   Example for a stmt item: \"statements\": [\"Gandhi founded Sabarmati Ashram. || गांधी ने साबरमती आश्रम की स्थापना की।\", \"The Dandi March was in 1942. || दांडी मार्च 1942 में हुआ।\"]",
                "   (each statement is its own string with ONE ' || '; the Hindi is the translation of the",
                "   English, written once). Before output, check every string: exactly one ' || ', English",
                "   first, Hindi once, no repeated sentence.",
                "   Answer fields (option index, True/False, correct order) stay outside this",
                "   format. evidence and the typed accepted answers of fib are English only."
            ].join("\n");
        }

        var techFile = [
            "== TECHNICAL RULES ==",
            "1. ONE .html file. Inline CSS + vanilla JS. No CDN, font, image or library.",
            "2. Use NO localStorage / sessionStorage / cookies / fetch.",
            "   Keep state only in JS variables.",
            "3. Put these two blocks at the top of the file, in exactly this format:",
            "   <script type=\"application/json\" id=\"quiz-meta\">",
            "   {\"title\",\"file_name\",\"exam\",\"subject\",\"topic\",\"language\",\"total\",\"types\":{type_id: count, ...},\"notes\"}",
            "   </script>",
            "   <script type=\"application/json\" id=\"quiz-data\">",
            "   [ { id, type, question, options/pairs/items/statements/assertion/reason, answer, explanation, evidence }, ... ]",
            "   </script>",
            "   quiz-data must be a JSON ARRAY (not an object). Each item's \"type\" is an id from the list",
            "   above, and its fields follow that type's spec. Do not hardcode the questions in JS;",
            "   one generic renderer reads these two blocks. Never stuff statements, assertion or",
            "   reason into the question string with \\n. The \"total\" and \"types\" of quiz-meta must",
            "   match the real counts in quiz-data.",
            "4. FILE NAME: put exactly this name in the \"file_name\" of quiz-meta: " + o.fileName,
            "   Use the same name in <title> too. Never name it \"quiz.html\" or \"index.html\".",
            "5. Mobile-first (360px), readable in both dark and light mode, big tap targets.",
            "6. Flow: one question at a time; on checking, show feedback + explanation +",
            "   evidence, then Next. Progress bar on top. Shuffle the options every time",
            "   (except for order, tf, stmt, ar and multi_correct, which keep the fixed order described in their spec).",
            "7. End with a result screen: score, type-wise breakdown, the list of wrong questions",
            "   (with explanation), \"Retry wrong only\" and \"Retry all\".",
            "8. On the result screen send:",
            "   parent.postMessage({type:'quiz-result', score, total, byType, wrongIds}, '*');",
            "9. Output ONLY the complete HTML code, no extra text."
        ];
        var techChat = [
            "== TECHNICAL RULES (MODE: PLAY-NOW) ==",
            "1. The quiz is a ready-to-play interactive app: inline CSS + vanilla JS, no CDN,",
            "   font, image or library.",
            "2. Use NO localStorage / sessionStorage / cookies / fetch.",
            "   Keep state only in JS variables.",
            "3. Keep all questions in one array. Each item's \"type\" is an id from the list above and",
            "   its fields follow that type's spec. One generic renderer displays them.",
            "   Never stuff statements, assertion or reason into the question string with \\n.",
            "4. Mobile-first (360px), readable in both dark and light mode, big tap targets.",
            "5. Flow: one question at a time; on checking, show feedback + explanation +",
            "   evidence, then Next. Progress bar on top. Shuffle the options every time",
            "   (except for order, tf, stmt, ar and multi_correct, which keep the fixed order described in their spec).",
            "6. End with a result screen: score, type-wise breakdown, the list of wrong questions",
            "   (with explanation), \"Retry wrong only\" and \"Retry all\".",
            "7. Build the quiz inside Canvas / Artifact / an interactive preview, so it opens as a",
            "   playable page that I can click through. The chat message itself contains no HTML",
            "   and no code.",
            "8. PLAIN-TEXT MODE (only if no preview / Canvas can open at all): ask one question at a",
            "   time, wait for my answer, tell me right away whether it is right or wrong + explanation +",
            "   evidence, then ask the next question. At the end show the score and the list of wrong",
            "   questions.",
            "9. Write ONE short sentence in the chat (for example \"Your quiz is ready, open it and",
            "   play.\"), then the quiz. No long extra text."
        ];
        var tech = chat ? techChat : techFile;
        var checkRules = [
            "== ANSWER-CHECK RULES (a wrong verdict ruins the quiz) ==",
            "1. Shuffle option OBJECTS, not indexes: every option carries its own correct flag, and the",
            "   check uses that flag after the shuffle. Never compare the tapped position with the answer",
            "   index from before the shuffle.",
            "2. True/False questions have two fixed buttons (True, False), never shuffled. Compare the",
            "   tapped value with the boolean answer directly.",
            "3. The verdict (Correct / Incorrect), the highlight colours (green = the correct option, red =",
            "   the wrong option the user tapped) and the \"correct answer\" text must all come from ONE",
            "   isCorrect check, so they can never disagree with each other.",
            "4. The explanation must agree with the answer key: if the explanation says X is correct, the key",
            "   must say X.",
            "5. Before you output, test every question type in your head: tapping the correct answer must",
            "   show Correct and green; tapping a wrong answer must show Incorrect.",
            "6. Statement-based questions (stmt, ar, multi_correct): first decide whether each statement is",
            "   true or false, then pick the option that matches that decision, then set answer. Exactly one",
            "   option must match; re-check this before output.",
            "7. In bilingual mode write each language ONCE per string, as \"English || हिंदी\". Never repeat",
            "   the Hindi part and never add a second ' || '.",
            ""
        ];
        var contract = chat ? [
            "##### OUTPUT CONTRACT — MODE: PLAY-NOW #####",
            "Your reply is a ready-to-play interactive quiz that I will click and attempt right away.",
            "THIS MATTERS: I am studying for a real exam and I need to attempt this quiz here, right now, by",
            "clicking. Use EVERY tool you have (Canvas, Artifacts, code execution, interactive preview, any quiz",
            "or app feature) and make it happen. Do not settle for plain text, and do not hand the work",
            "back to me as code to copy. Find a way. I am counting on you to deliver a quiz I can play.",
            "- Build the quiz inside Canvas (or an Artifact / interactive preview, whichever your app",
            "  has), so it opens as a playable page. Do not print HTML or code in the chat.",
            "- Your chat message is ONE short sentence saying the quiz is ready and where to open",
            "  it. If a preview or share link can be made, add that single link. Otherwise the",
            "  Canvas / preview is enough.",
            "- No download and no file saving.",
            "- If you cannot open any interactive preview in this conversation, use PLAIN-TEXT MODE",
            "  (one question at a time, my answer, instant feedback). See rule 8 of the",
            "  TECHNICAL RULES below.",
            "###############################################"
        ] : [
            "##### OUTPUT CONTRACT — MODE: SAVE-FILE #####",
            "Your whole reply = ONE complete HTML document (from <!DOCTYPE html> to </html>).",
            "- No text, intro, explanation or markdown before or after it.",
            "- It will be saved as a file, so the format in the TECHNICAL RULES below must be followed exactly.",
            "################################################"
        ];
        var reminder = chat
            ? "REMINDER (MODE: PLAY-NOW): use whatever tools you have and make it happen. The quiz must be playable in Canvas / a preview. The chat holds one short sentence and no code or HTML."
            : "REMINDER (MODE: SAVE-FILE): output = only one complete HTML document, nothing outside it.";
        var lead = chat
            ? "short practice quiz that I can play right away in Canvas / a preview, just by clicking."
            : "short practice quiz as one single self-contained HTML file.";

        // ----- SOURCE MODE: what the questions come from -----
        var src = ["paste", "convert", "none", "pdf", "link"].indexOf(o.source) >= 0 ? o.source : "topic";
        var optN = (Number(o.optCount) === 5 || Number(o.optCount) === 6) ? Number(o.optCount) : 4;
        var pdfQ = src === "pdf" && o.pdfKind === "questions";   // PDF holds ready-made questions
        var convert = src === "convert" || pdfQ;
        var where = chat ? "in your one short sentence" : "in the \"notes\" field of quiz-meta";

        var introLine = convert
            ? "You are a careful exam question-setter. Turn ONLY the SOURCE QUESTIONS below into a"
            : src === "none"
                ? "You are an experienced exam question-setter. On this TOPIC (no study content is given), make a"
                : "You are an experienced exam question-setter. From the STUDY CONTENT below, make a";
        var focusLine = convert ? null : "FOCUS: " + (o.focus || "(none: balanced mix)");
        var languageLine = convert
            ? "LANGUAGE: " + o.lang + "    (if the source is in another language, change only the language, not the content or answers)"
            : "LANGUAGE: " + o.lang + "    (en / hi / hinglish / bilingual: the whole quiz in this)";
        var questionsLine = convert
            ? "QUESTIONS: exactly as many as the SOURCE QUESTIONS below (not one more, not one fewer)"
            : "QUESTIONS: " + total + " (exactly)";

        var pdfPart = o.range ? o.range : "the whole PDF";
        var contentLabel = convert ? (pdfQ ? "SOURCE QUESTIONS (inside the attached PDF — turn exactly these into the quiz):" : "SOURCE QUESTIONS (given by the user — turn exactly these into the quiz):")
            : src === "paste" ? "STUDY CONTENT (text pasted by the user):"
            : src === "pdf" ? "STUDY CONTENT (the PDF attached to this message):"
            : src === "link" ? "STUDY CONTENT (the material at the link below):"
            : src === "none" ? "STUDY CONTENT: (none given — only the TOPIC above)"
            : "STUDY CONTENT:";
        var contentBody = src === "none" ? null
            : src === "pdf" ? [
                "ATTACHED PDF: I have attached a PDF to this message.",
                "PART TO USE: " + pdfPart,
                pdfQ ? "Turn the questions of this part (with their options and answer key, as given in the PDF) into the quiz."
                     : "Make questions only from this part; ignore the rest of the PDF.",
                "If you cannot read the PDF or cannot find this part, invent nothing: write " + where + " what you could not read."
              ].join("\n")
            : src === "link" ? [
                "LINK: " + o.link,
                o.linkNote ? "WHICH PART: " + o.linkNote : "WHICH PART: all of it",
                "Open the link and read it. If it is a video (YouTube or other), use its transcript / captions.",
                "If the link does not open or no transcript is available, invent nothing: write " + where + " what did not open."
              ].join("\n")
            : o.content;

        var convertRules = [
            "== CONVERT RULES (most important) ==",
            "1. The quiz contains ONLY the questions given in the SOURCE QUESTIONS. Do not create a",
            "   single new question, do not remove any, do not merge any two.",
            "2. Keep each question's text, options and their order exactly as given. Do not change",
            "   words, spelling or facts (you may fix only obvious typing mistakes). Keep the number of OPTIONS",
            "   of each question the same as in the source (4, 5 or 6): do not add or remove any. An",
            "   option like \"None of these\" stays as it is.",
            "3. Take the ANSWER only from what the source gives (answer key, \"Ans:\", bracket, tick). Never",
            "   change the source's answer on your own, even if it looks wrong to you; if in doubt, write that",
            "   question's number " + where + ". If a question has no answer in the source, make your best",
            "   guess and put \"unverified\": true in that item; the renderer then shows",
            "   \"Answer was not in the source — AI's guess, please verify\" in that question's feedback.",
            "4. Give each question its best-fitting TYPE (list below): NOT/EXCEPT ones as mcq_negative,",
            "   Statement I/II ones as stmt, Assertion-Reason ones as ar, \"which statements are correct\" ones as",
            "   multi_correct, matching ones as match, blank ones as fib, True/False ones as tf, the rest as mcq.",
            "   Fill the fields as that type's spec says, but the content stays the source's own.",
            "5. explanation: 1-2 lines for every question (why the correct answer is right). If you are not sure,",
            "   do not invent a new fact; write \"explanation not given in the source\".",
            "6. In \"evidence\" write only \"Source Q<number>\" (the number as in the source; if none, the order).",
            "7. A question that is incomplete or unreadable (cut text, OCR junk) must be left out of the quiz,",
            "   and its number written " + where + ".",
            "8. Keep technical terms in English.",
            "9. The count of quiz-data = the count of source questions (minus the ones you left out). The \"total\"",
            "   and \"types\" of quiz-meta must match the real counts.",
            bilRule(10),
            ""
        ];

        var noContentRules = [
            "== NO-CONTENT RULES (most important) ==",
            "1. No STUDY CONTENT is given, so make the questions from your own knowledge. Use ONLY facts",
            "   you are sure of and that are standard and widely accepted at this exam level.",
            "2. Ask about details like years, names, numbers, section numbers, percentages only when you are",
            "   100% sure. At the slightest doubt, skip that question and ask a concept question instead.",
            "3. Give \"evidence\" with every question: the standard concept or idea (max 20 words) the question",
            "   rests on. Never invent the name of a book, website or page number.",
            "4. Give an explanation for every question: why the correct answer is right (1-2 lines), and why the",
            "   wrong options are wrong (1 line).",
            "5. Difficulty mix: ~40% easy (recall), ~40% medium (concept/compare), ~20% hard.",
            "6. Distractors must be plausible (real terms of this topic, near-misses). Avoid \"All of the above\" /",
            "   \"None of the above\". Put the correct answer at a random position.",
            "7. No duplicate questions, and no question may give away another's answer.",
            "8. Keep technical terms in English, even if LANGUAGE is hindi/hinglish.",
            "9. On the start screen of the quiz (in your one short sentence in play-now mode) show this clear warning:",
            "   \"⚠ This quiz was made from the AI's own knowledge, not from any content. Please verify the answers once.\"",
            "   Also write the same line " + where + ".",
            bilRule(10),
            ""
        ];

        var pasteNote = [
            (o.lang === "bilingual" ? "10." : "9.") + " The user copied the STUDY CONTENT from a PDF / book / notes and pasted it: ignore page numbers,",
            "   header/footer, broken lines, repeated lines and OCR junk. For any part that is incomplete or",
            "   unclear, do not make a question."
        ];
        var pdfNote = [
            (o.lang === "bilingual" ? "10." : "9.") + " In the attached PDF, ignore page numbers, header/footer, broken lines and OCR junk. Read only the",
            "   PART TO USE written above. For any part that is incomplete or unclear, do not make a question."
        ];
        var linkNote = [
            (o.lang === "bilingual" ? "10." : "9.") + " Questions come ONLY from the material at the link. For a video, only from what is said in it,",
            "   not from your own knowledge. If any part of the link is unclear, do not make a question from it."
        ];

        var optLine = optN === 4 ? null :
            "OPTIONS PER QUESTION: " + optN + ". For option-based questions (mcq, mcq_negative, odd_one_out, and fib with options)\n" +
            "give EXACTLY " + optN + " options; wherever the type specs above say \"4 options\", read " + optN + ".\n" +
            "answer stays a 0-based index. The standard coded options of stmt, ar, multi_correct stay as they are.";

        var convertTypes = [
            "== QUESTION TYPES (choose the best-fitting type for every source question) ==",
            (o.allTypes || o.types || []).map(function (t) { return "  " + t.id + "  (" + t.label + "): " + t.spec; }).join("\n"),
            "",
            "- Wherever a spec says \"4 options\", keep each question's number of options the same as in the",
            "  source (4, 5 or 6). The standard coded options of stmt, ar, multi_correct stay as they are.",
            "- A question that fits no special type becomes mcq.",
            ""
        ];

        var contentRulesBlock = convert ? convertRules : src === "none" ? noContentRules : [
            "== CONTENT RULES (most important) ==",
            "1. Every question must come ONLY from the STUDY CONTENT. Do not add outside facts, names, years or",
            "   definitions. If something is not in the content, do not ask about it.",
            "2. Give \"evidence\" with every question: the short part of the content",
            "   (max 20 words, in your own words) that the question and its answer rest on. If you find no",
            "   evidence, drop that question.",
            "3. Give an explanation for every question: why the correct answer is right (1-2 lines),",
            "   and why the wrong options are wrong (1 line).",
            "4. Cover all the important parts of the content. Do not draw all the questions from one paragraph.",
            "5. Difficulty mix: ~40% easy (recall), ~40% medium (concept/compare),",
            "   ~20% hard (application, confusing-but-plausible options).",
            "6. Distractors must be plausible (real terms of this topic, near-misses). Avoid \"All of",
            "   the above\" / \"None of the above\". Put the correct answer at a random position.",
            "7. No duplicate questions, and no question may give away another's answer.",
            "8. Keep technical terms in English, even if LANGUAGE is hindi/hinglish.",
            bilRule(9),
            ""
        ];
        var extraNote = src === "paste" ? pasteNote : (src === "pdf" && !convert) ? pdfNote : src === "link" ? linkNote : null;
        if (extraNote) {
            // the note goes right before the blank line that closes the content rules
            contentRulesBlock = contentRulesBlock.slice(0, -1).concat(extraNote, [""]);
        }
        var typesBlock = convert ? convertTypes : [
            "== QUESTION TYPES (exact distribution, total " + total + ") ==",
            typeLines.join("\n"),
            "",
            "DISTRIBUTION: " + distro + ".",
            "- Keep EXACTLY as many questions of each type as written above (total " + total + "). Before giving the",
            "  output, verify the type-wise counts of quiz-data.",
            "- Do not make any type that is not in the list.",
            "- If the content gives no ground for a type (for example 4 pairs for match, or a",
            "  sequence for order), do not force that question: reduce its count, spread it over the",
            "  other chosen types, and " + (chat
                ? "tell me in your one short sentence"
                : "write one line in the \"notes\" field of quiz-meta") + " what changed and why.",
            ""
        ];
        if (!convert && optLine) typesBlock = typesBlock.concat([optLine, ""]);

        return [].concat(
            [
            contract.join("\n"),
            "",
            introLine,
            lead,
            "",
            "EXAM CONTEXT: " + exam,
            "SUBJECT: " + (o.subject || "(not specified)"),
            "TOPIC: " + o.topic,
            focusLine,
            languageLine,
            questionsLine,
            "",
            contentLabel,
            contentBody,
            "",
        ],
            convert ? [] : [
            "== CONTEXT RULES ==",
            "1. If an EXAM CONTEXT is given, write in that exam's question style, difficulty and",
            "   phrasing. If it is empty, keep a general competitive-exam style and do not name any specific exam.",
            "2. The question TYPES and their counts below were chosen by the user. Do not change them",
            "   because of the exam context; the exam context is only for phrasing/difficulty.",
            "3. If the EXAM CONTEXT lists more than one exam, use phrasing that is common to all of",
            "   them; do not copy the particular phrasing of any single exam.",
            "4. If a FOCUS is given, make the questions mainly from that angle. If it is empty, keep a",
            "   balanced mix of the whole content.",
            "",
        ],
            contentRulesBlock,
            typesBlock,
            [
            checkRules.join("\n"),
            tech.join("\n"),
            "",
            reminder
        ]
        ).filter(function (x) { return x !== null; }).join("\n");
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
            '<div class="qh-optbox"><label class="quiz-lbl">Options per MCQ</label><select class="qh-opts">' + options(OPT_OPTIONS, ["4", "5", "6"].indexOf(lsGet(LS_OPTS, "4")) >= 0 ? lsGet(LS_OPTS, "4") : "4") + "</select></div>" +
            '<button type="button" class="qh-strip qh-secstrip" aria-expanded="false"><span class="qh-arrow">▸</span><span class="qh-striplbl">Questions should come from</span><span class="qh-summary qh-srcsummary"></span></button>' +
            '<div class="qh-secbody" hidden style="margin-top:8px">' +
            '<div class="qh-modes qh-sources">' +
            '<label class="qh-mode"><input type="radio" name="qhsrc" value="topic" checked> <span><strong>This topic\'s content</strong> — already inside the prompt (default).</span></label>' +
            '<label class="qh-mode"><input type="radio" name="qhsrc" value="paste"> <span><strong>My own text</strong> — paste text from a PDF, book or notes. Questions come only from it.</span></label>' +
            '<label class="qh-mode"><input type="radio" name="qhsrc" value="pdf"> <span><strong>My PDF</strong> — you attach the whole PDF in the AI chat and tell which pages, or which questions, to use.</span></label>' +
            '<label class="qh-mode"><input type="radio" name="qhsrc" value="link"> <span><strong>Video / YouTube / website link</strong> — the AI reads the link and makes questions from it.</span></label>' +
            '<label class="qh-mode"><input type="radio" name="qhsrc" value="convert"> <span><strong>My own questions → quiz</strong> — paste ready-made questions (with options and answers). The AI only turns them into a quiz; no new questions.</span></label>' +
            '<label class="qh-mode"><input type="radio" name="qhsrc" value="none"> <span><strong>No content</strong> — only the topic name; the AI uses its own knowledge. Less reliable: verify the answers.</span></label>' +
            "</div>" +
            '<div class="qh-srcbox" style="display:none"><textarea class="qh-srctext" rows="8" spellcheck="false"></textarea><div class="quiz-add-preview qh-srcnote"></div></div>' +
            '<div class="qh-pdfbox" style="display:none">' +
            '<label class="quiz-lbl">What is in the PDF?</label>' +
            '<select class="qh-pdfkind"><option value="text">Study material — make new questions from it</option><option value="questions">Ready-made questions — only turn them into a quiz</option></select>' +
            '<label class="quiz-lbl">Which part? (leave empty = whole PDF)</label>' +
            '<input type="text" class="qh-pdfrange" placeholder="e.g. pages 12–18   or   Q.1 to Q.25" autocomplete="off">' +
            '<div class="quiz-add-preview">Attach the PDF in the AI chat together with the copied prompt.</div>' +
            "</div>" +
            '<div class="qh-linkbox" style="display:none">' +
            '<label class="quiz-lbl">Link (YouTube video, other video, or website)</label>' +
            '<input type="text" class="qh-linkurl" placeholder="https://www.youtube.com/watch?v=…" autocomplete="off">' +
            '<label class="quiz-lbl">Which part? (optional)</label>' +
            '<input type="text" class="qh-linknote" placeholder="e.g. 10:00 to 25:30   or   the section on Index Terms" autocomplete="off">' +
            '<div class="quiz-add-preview">Gemini can open YouTube links. If your AI cannot open the link, copy the transcript or text and use “My own text”.</div>' +
            "</div>" +
            "</div>" +
            '<button type="button" class="qh-strip qh-secstrip" aria-expanded="false"><span class="qh-arrow">▸</span><span class="qh-striplbl">What do you want?</span><span class="qh-summary qh-modesummary"></span></button>' +
            '<div class="qh-secbody" hidden style="margin-top:8px">' +
            '<div class="qh-modes">' +
            '<label class="qh-mode"><input type="radio" name="qhmode" value="file"' + (lsGet(LS_MODE, "file") !== "chat" ? " checked" : "") + '> <span><strong>Save to site</strong> — the AI gives an HTML file; add it below and it appears in Practice.</span></label>' +
            '<label class="qh-mode"><input type="radio" name="qhmode" value="chat"' + (lsGet(LS_MODE, "file") === "chat" ? " checked" : "") + '> <span><strong>Quick attempt</strong> — the AI opens a ready-to-play quiz that you just click and attempt. Nothing is saved. (In Gemini, choose Canvas first.)</span></label>' +
            "</div>" +
            "</div>" +
            '<button type="button" class="qh-strip qh-typestrip" aria-expanded="false"><span class="qh-arrow">▸</span><span class="qh-striplbl">Question types</span><span class="qh-summary"></span></button>' +
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
        var typesEl = $(".qh-types"), summaryEl = $(".qh-typestrip .qh-summary"), totalNote = $(".qh-totalnote");
        var stripEl = $(".qh-typestrip"), bodyEl = $(".qh-typesbody");
        var enOnlyEl = $(".qh-enonly"), copyEl = $(".qh-copy"), copyStatus = $(".qh-copystatus");
        var linkEl = $(".qh-link"), prevEl = $(".qh-preview"), titleEl = $(".qh-title"), saveEl = $(".qh-save");
        var listEl = $(".qh-list");
        var addBtn = $(".qh-addtype-btn"), addForm = $(".qh-addform");
        var ctName = $(".qh-ct-name"), ctDesc = $(".qh-ct-desc");
        var srcBox = $(".qh-srcbox"), srcText = $(".qh-srctext"), srcNote = $(".qh-srcnote");
        var pdfBox = $(".qh-pdfbox"), pdfKindEl = $(".qh-pdfkind"), pdfRangeEl = $(".qh-pdfrange");
        var linkBox = $(".qh-linkbox"), linkUrlEl = $(".qh-linkurl"), linkNoteEl = $(".qh-linknote");
        var srcSummary = $(".qh-srcsummary"), modeSummary = $(".qh-modesummary");
        var optBox = $(".qh-optbox"), optsEl = $(".qh-opts"), enOnlyLbl = host.querySelector(".flashcard-enonly");

        function status(el, text, kind) {
            el.textContent = text;
            el.className = "quiz-add-preview " + (el.dataset.base || "") + (kind ? " " + kind : "");
        }
        copyStatus.dataset.base = "qh-copystatus";
        prevEl.dataset.base = "qh-preview";
        totalNote.dataset.base = "qh-totalnote";
        srcNote.dataset.base = "qh-srcnote";

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
            else if (total > VERY_LONG_QUIZ) status(totalNote, "⚠ " + total + " questions is a very long quiz. The AI may cut its answer midway or skip the count. You can still go ahead, but several shorter quizzes usually work better.", "err");
            else if (total > LONG_QUIZ) status(totalNote, "Tip: " + total + " questions is on the long side. Shorter quizzes (about 10–20) are easier to finish and revise. It's your call.");
            else status(totalNote, "✓ Short quiz: easy for the AI to get right and quick to revise.", "ok");
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

        // ---- the two collapsible sections (source + mode) ----
        host.querySelectorAll(".qh-secstrip").forEach(function (b) {
            b.addEventListener("click", function () {
                var body = b.nextElementSibling;
                var open = body.hidden;
                body.hidden = !open;
                b.setAttribute("aria-expanded", open ? "true" : "false");
            });
        });
        function updateSummaries() {
            var s = sourceValue();
            var names = { topic: "This topic’s content", paste: "My own text", pdf: "My PDF", link: "Link", convert: "My own questions", none: "No content" };
            var t = names[s] || "";
            if (s === "pdf" && pdfRangeEl.value.trim()) t += " · " + pdfRangeEl.value.trim();
            srcSummary.textContent = t;
            modeSummary.textContent = modeValue() === "chat" ? "Quick attempt" : "Save to site";
        }

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

        // ---- source mode: topic / paste / convert / none ----
        function sourceValue() {
            var r = host.querySelector('input[name="qhsrc"]:checked');
            var v = r ? r.value : "topic";
            return (v === "paste" || v === "convert" || v === "none" || v === "pdf" || v === "link") ? v : "topic";
        }
        function show(el, on) { el.style.display = on ? "" : "none"; }
        // true when each question is already written (pasted, or inside the PDF) and the AI only converts them
        function isConvert() {
            var s = sourceValue();
            return s === "convert" || (s === "pdf" && pdfKindEl.value === "questions");
        }
        function updateSrcNote() {
            var s = sourceValue(), n = srcText.value.length;
            if (!n) {
                status(srcNote, s === "convert"
                    ? "Paste the questions to convert (with options and, if you have it, the answer key)."
                    : "Paste the text the questions should come from.");
                return;
            }
            if (n > 30000) status(srcNote, "⚠ " + Math.round(n / 1000) + "k characters is long for one AI message. Paste one chapter or section at a time.", "err");
            else status(srcNote, n + " characters", "ok");
        }
        function applySource() {
            var s = sourceValue(), conv = isConvert();
            show(srcBox, s === "paste" || s === "convert");
            show(pdfBox, s === "pdf");
            show(linkBox, s === "link");
            srcText.placeholder = s === "convert"
                ? "Paste your questions here, with options and (if you have it) the answer key.\ne.g.  1. Who wrote …?  (a) …  (b) …  (c) …  (d) …   Ans: b"
                : "Paste the text here (from a PDF, book or notes). Page numbers and headings are fine — the AI ignores them.";
            pdfRangeEl.placeholder = pdfKindEl.value === "questions"
                ? "e.g. Q.1 to Q.25   or   pages 5–9"
                : "e.g. pages 12–18   or   chapter 3";
            show(optBox, !conv);                      // converting keeps each question's own options
            show(stripEl, !conv);                     // types / counts are not used when converting
            if (conv) { bodyEl.hidden = true; stripEl.setAttribute("aria-expanded", "false"); }
            show(totalNote, !conv);
            if (enOnlyLbl) show(enOnlyLbl, s === "topic");   // "EN only" only shortens the topic's own text
            updateSrcNote();
            updateSummaries();
            showName();
        }
        host.querySelectorAll('input[name="qhsrc"]').forEach(function (r) { r.addEventListener("change", applySource); });
        srcText.addEventListener("input", updateSrcNote);
        pdfKindEl.addEventListener("change", applySource);
        pdfRangeEl.addEventListener("input", updateSummaries);
        optsEl.addEventListener("change", function () { lsSet(LS_OPTS, optsEl.value); });

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
                count: types.reduce(function (s, t) { return s + t.count; }, 0),
                source: sourceValue(),
                pdfKind: pdfKindEl.value, range: pdfRangeEl.value.trim(),
                link: linkUrlEl.value.trim(), linkNote: linkNoteEl.value.trim(),
                optCount: optsEl.value,
                allTypes: allTypes(custom).map(function (t) { return { id: t.id, label: t.label, spec: t.spec }; })
            };
        }
        function modeValue() {
            var r = host.querySelector('input[name="qhmode"]:checked');
            return r && r.value === "chat" ? "chat" : "file";
        }
        function showName() {
            var o = current();
            var msg = o.mode === "chat"
                ? "Quick attempt: the AI opens a ready-to-play quiz (in Gemini, choose Canvas first). Nothing is saved to the site."
                : "Suggested file name: " + fileNameFor(topic, nodeId, o.focus, o.lang, ctx.parent);
            if (o.source === "none") status(copyStatus, "⚠ No-content mode: the AI uses its own knowledge — less reliable, so verify the answers. " + msg, "err");
            else status(copyStatus, msg);
        }
        host.querySelectorAll('input[name="qhmode"]').forEach(function (r) {
            r.addEventListener("change", function () { lsSet(LS_MODE, modeValue()); updateSummaries(); showName(); });
        });
        [langEl, focusEl].forEach(function (e) { e.addEventListener("change", showName); });

        copyEl.addEventListener("click", function () {
            var o = current();
            var cb;
            var conv = o.source === "convert" || (o.source === "pdf" && o.pdfKind === "questions");
            if (!conv && !o.count) { status(copyStatus, "Pick at least one question type first.", "err"); return; }
            if (o.source === "paste" || o.source === "convert") {
                var typed = srcText.value.trim();
                if (!typed) {
                    status(copyStatus, o.source === "convert"
                        ? "Paste the questions you want to turn into a quiz first."
                        : "Paste the text the questions should come from first.", "err");
                    return;
                }
                cb = { text: typed, included: o.source === "convert" ? "your pasted questions" : "your pasted text" };
            } else if (o.source === "pdf") {
                cb = { text: "", included: "your attached PDF" + (o.range ? ", " + o.range : ", whole PDF") };
            } else if (o.source === "link") {
                if (!/^https?:\/\//i.test(o.link)) { status(copyStatus, "Paste the video / YouTube / website link first (it must start with https://).", "err"); return; }
                cb = { text: "", included: "your link" };
            } else if (o.source === "none") {
                cb = { text: "", included: "no content — the AI's own knowledge" };
            } else {
                var split = ctx.getSplit ? ctx.getSplit() : null;
                cb = buildContentBlock(split, ctx.clean, !!enOnlyEl.checked);
                if (!cb) {
                    status(copyStatus, "This topic has no content loaded yet. Add and open its content first — the quiz prompt is built from that text.", "err");
                    return;
                }
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
                var shorten = o.source === "topic" ? "tick \"EN only\" and copy again" : "paste a smaller part of your text and copy again";
                var big = prompt.length > 30000 ? " Long paste (" + Math.round(prompt.length / 1000) + "k characters) — " + shorten + " if your AI app cuts it." : "";
                var what = conv ? "all your questions" : o.count + " questions";
                var tail = o.source === "pdf" ? " Attach the PDF in the AI chat before sending." : o.source === "link" ? " If the AI cannot open the link, paste the transcript with “My own text”." : "";
                status(copyStatus, o.mode === "chat"
                    ? "✓ Copied (" + cb.included + ", " + what + "). Paste it in Gemini (Canvas on) / ChatGPT / Claude, then click the quiz that opens and attempt it. Not saved." + tail + big
                    : "✓ Copied (" + cb.included + ", " + what + "). Save the quiz as: " + o.fileName + "." + tail + big, "ok");
            }, function () {
                status(copyStatus, "Automatic copy was blocked by the browser. Try again, or allow clipboard access for this site.", "err");
            });
        });

        renderTypes();
        updateSummaries();

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
