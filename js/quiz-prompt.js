/* =========================================================
   js/quiz-prompt.js — "Copy quiz prompt" popup (Practice page)

   Builds the ready-to-paste quiz prompt for ONE topic: topic title,
   subject, language, question count, focus, exam context and the
   topic's own content (fetched from Drive via get_markdown) are filled
   in automatically. Nothing is sent anywhere — the prompt is copied to
   the clipboard and the user pastes it into Gemini/Claude themselves.

   Public API:
     window.QuizPrompt.open({ api, nodeId, link, subject, topic })
       api     Apps Script web app URL
       nodeId  topic id
       link    the topic's content Drive link (mdLinks[nodeId]); may be ""
       subject root title of the topic's path (may be "")
       topic   the topic's own title

   window.QuizPrompt.mount(hostElement, ctx)     (used inside the "Add Content
   Folder" box on the notebook page: one place for prompt + add quiz)
       ctx = { api, nodeId, topic, subject, parent, getSplit(), clean(text) }
       getSplit() -> { en, hi, ai } of the topic's currently loaded text
       clean(text) -> the page's own cleanContentForPrompt()

   Exam context is remembered in localStorage (last value used) until a
   per-node exam_context field exists.
   ========================================================= */
(function () {
    "use strict";

    var LS_EXAM = "quizPrompt:exam";
    var LS_LANG = "quizPrompt:lang";
    var LS_COUNT = "quizPrompt:count";

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

    var modalKeyHandler = null;

    function esc(s) {
        return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }
    function lsGet(k, d) { try { var v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } }
    function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* blocked */ } }

    function slug(s) {
        return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    }

    function fileNameFor(topic, nodeId, focus, lang, parent) {
        var base = [slug(parent), slug(topic)].filter(Boolean).join("_") || slug(nodeId) || "topic";
        var f = slug(focus);
        var code = lang === "bilingual" ? "bi" : lang;
        return base + (f ? "-" + f : "") + "-" + code + ".html";
    }

    // Content as the model should see it: drop {{Term}} markers (keep the
    // word) and fenced animation blocks that mean nothing outside the site.
    function cleanContent(md) {
        return String(md || "")
            .replace(/```lottie[\s\S]*?```/gi, "")
            .replace(/\{\{([^{}]+)\}\}/g, "$1")
            .trim();
    }

    function buildPrompt(o) {
        var count = o.count;
        var minTypes = count < 6 ? 3 : 4;
        var exam = o.exam ? o.exam : "(not specified)";
        var bil = o.lang === "bilingual" ? [
            "9. LANGUAGE bilingual hai: question, har option, explanation, tf ki reason",
            "   aur match/order ke har item ko ek hi string mein is format mein do:",
            "   \"English text || हिंदी text\"  (pehle English, phir ' || ', phir Devanagari",
            "   Hindi; technical terms Hindi side mein bhi English hi rakho). Renderer is",
            "   string ko ' || ' pe todkar English upar aur Hindi neeche (halke rang mein)",
            "   dikhaye. HAR string mein SIRF EK ' || ' ho (ek string = ek baat). Isliye",
            "   stmt ke statements, ar ke assertion/reason, aur har option alag string ho,",
            "   aur har string apna ' || ' rakhe. Renderer split karte waqt sirf PEHLE",
            "   ' || ' pe tode (indexOf se), split(' || ') se nahi.",
            "   answer wale fields (option index, True/False, sahi order) is",
            "   format se bahar rahein. evidence aur fib ke typed accepted answers sirf",
            "   English mein hon."
        ].join("\n") : null;
        return [
            "Tum ek experienced exam question-setter ho. Neeche diye STUDY CONTENT se ek",
            "chhota practice quiz banana hai, jo ek single self-contained HTML file ho.",
            "",
            "EXAM CONTEXT: " + exam,
            "SUBJECT: " + (o.subject || "(not specified)"),
            "TOPIC: " + o.topic,
            "FOCUS: " + (o.focus || "(none: balanced mix)"),
            "LANGUAGE: " + o.lang + "    (en / hi / hinglish / bilingual: poora quiz isi mein)",
            "QUESTIONS: " + count,
            "",
            "STUDY CONTENT:",
            o.content,
            "",
            "== CONTEXT RULES ==",
            "1. EXAM CONTEXT diya hai to usi exam ke question style, difficulty aur",
            "   phrasing ke hisaab se likho. Khali hai to general competitive-exam",
            "   style rakho, kisi khaas exam ka naam mat lo.",
            "2. Question patterns sirf wahi use karo jo us exam mein chalte hain ya jo",
            "   content ko natural lagte hain. Koi pattern zabardasti mat thoopo.",
            "3. Agar EXAM CONTEXT mein ek se zyada exam hain, to wo question style",
            "   rakho jo un sabme common ho (mostly mcq, tf, fib, match). stmt aur ar",
            "   tab hi use karo jab content khud mang kare, aur kisi ek exam ki",
            "   khaas phrasing mat pakdo.",
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
            "== QUESTION TYPES ==",
            "Core (hamesha available):",
            "  mcq    : 4 options",
            "  tf     : True/False + reason",
            "  fib    : fill in the blank (4 options ya typed answer, accepted spellings",
            "           ki list ke saath)",
            "  match  : 4 pairs, right side shuffled",
            "  order  : 4-5 items ko sahi sequence mein lagana",
            "Exam-pattern wale (sirf tab jab exam context ya content ko suit karein):",
            "  stmt   : Statement I & II + standard 4 options",
            "  ar     : Assertion (A) & Reason (R) + standard 4 options",
            "",
            "Content jis type ke liye suit kare, uska mix khud decide karo. Kam se kam",
            minTypes + " alag types use karo.",
            "",
            "== TECHNICAL RULES ==",
            "1. Ek hi .html file. Inline CSS + vanilla JS. Koi CDN, font, image ya",
            "   library nahi.",
            "2. localStorage / sessionStorage / cookies / fetch BILKUL use mat karo.",
            "   State sirf JS variables mein.",
            "3. File ke top par ye do blocks do, bilkul isi format mein:",
            "   <script type=\"application/json\" id=\"quiz-meta\">",
            "   {\"title\",\"file_name\",\"exam\",\"subject\",\"topic\",\"language\",\"total\",\"types\":{...}}",
            "   </script>",
            "   <script type=\"application/json\" id=\"quiz-data\">",
            "   [ { id, type, question, options/pairs/items, answer, explanation, evidence }, ... ]",
            "   </script>",
            "   quiz-data ek JSON ARRAY ho (object nahi). Questions alag se JS mein",
            "   hardcode mat karo; ek generic renderer in dono blocks se padhe.",
            "   stmt: statements ek alag \"statements\" ARRAY mein do (har Statement ek item),",
            "   question mein sirf intro line. ar: \"assertion\" aur \"reason\" alag fields mein,",
            "   question mein sirf intro line (ya khali). Statements/assertion/reason ko kabhi",
            "   question string ke andar \\n se jodkar mat bharo. Renderer inhe alag-alag",
            "   dikhaye.",
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
        ].filter(function (x) { return x !== null; }).join("\n");
    }

    function options(list, selected) {
        return list.map(function (o) {
            return '<option value="' + esc(o.v) + '"' + (o.v === selected ? " selected" : "") + ">" + esc(o.label) + "</option>";
        }).join("");
    }

    function close() {
        var m = document.getElementById("quiz-prompt-modal");
        if (m) m.remove();
        if (modalKeyHandler) { document.removeEventListener("keydown", modalKeyHandler); modalKeyHandler = null; }
    }

    function open(opts) {
        close();
        opts = opts || {};
        var topic = opts.topic || opts.nodeId || "Topic";
        var content = "";            // cleaned topic content, once loaded
        var contentState = "loading"; // loading | ok | missing | error

        var wrap = document.createElement("div");
        wrap.id = "quiz-prompt-modal";
        wrap.innerHTML =
            '<div class="add-resource-overlay"><div class="add-resource-modal mcq-add-modal quiz-add-modal quiz-prompt-modal">' +
            '<button type="button" class="modal-close" id="qp-close">×</button>' +
            "<h2>📋 Quiz prompt</h2>" +
            '<p class="add-resource-scope">Topic: ' + esc(topic) + "</p>" +
            '<div class="qp-row">' +
            '<div><label class="quiz-lbl">Language</label><select id="qp-lang">' + options(LANG_OPTIONS, lsGet(LS_LANG, "en")) + "</select></div>" +
            '<div><label class="quiz-lbl">Questions</label><input type="number" id="qp-count" min="4" max="20" value="' + esc(lsGet(LS_COUNT, "10")) + '"></div>' +
            "</div>" +
            '<label class="quiz-lbl">Focus</label><select id="qp-focus">' + options(FOCUS_OPTIONS, "") + "</select>" +
            '<label class="quiz-lbl">Exam context (trim to one exam if the topic is for one)</label>' +
            '<input type="text" id="qp-exam" placeholder="e.g. UGC NET, SSC, BPSC" value="' + esc(lsGet(LS_EXAM, "")) + '">' +
            '<div id="qp-status" class="quiz-add-preview">Loading topic content…</div>' +
            '<textarea id="qp-text" rows="7" readonly></textarea>' +
            '<div class="quiz-add-actions"><button type="button" class="bottom-strip-btn" id="qp-copy">Copy prompt</button></div>' +
            "</div></div>";
        document.body.appendChild(wrap);

        var langEl = document.getElementById("qp-lang");
        var countEl = document.getElementById("qp-count");
        var focusEl = document.getElementById("qp-focus");
        var examEl = document.getElementById("qp-exam");
        var statusEl = document.getElementById("qp-status");
        var textEl = document.getElementById("qp-text");
        var copyEl = document.getElementById("qp-copy");

        function setStatus(t, kind) {
            statusEl.textContent = t;
            statusEl.className = "quiz-add-preview" + (kind ? " " + kind : "");
        }

        function current() {
            var count = parseInt(countEl.value, 10);
            if (!isFinite(count)) count = 10;
            count = Math.min(20, Math.max(4, count));
            var lang = langEl.value;
            var focus = focusEl.value;
            return {
                count: count, lang: lang, focus: focus,
                exam: examEl.value.trim(),
                subject: opts.subject || "",
                topic: topic,
                content: content || "[PASTE THE TOPIC CONTENT HERE]",
                fileName: fileNameFor(topic, opts.nodeId, focus, lang, opts.parent)
            };
        }

        function refresh() {
            var o = current();
            textEl.value = buildPrompt(o);
            if (contentState === "ok") {
                setStatus("✓ Content loaded (" + content.length.toLocaleString() + " characters). Suggested file name: " + o.fileName, "ok");
            }
        }

        [langEl, focusEl].forEach(function (e) { e.addEventListener("change", refresh); });
        [countEl, examEl].forEach(function (e) { e.addEventListener("input", refresh); });

        copyEl.addEventListener("click", function () {
            var o = current();
            lsSet(LS_LANG, o.lang); lsSet(LS_COUNT, String(o.count)); lsSet(LS_EXAM, o.exam);
            var text = textEl.value;
            function done() {
                copyEl.textContent = "Copied ✓";
                setTimeout(function () { copyEl.textContent = "Copy prompt"; }, 1800);
            }
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).then(done, fallback);
            } else {
                fallback();
            }
            function fallback() {
                textEl.removeAttribute("readonly");
                textEl.select();
                try { document.execCommand("copy"); done(); } catch (e) { setStatus("Couldn't copy automatically — select the text and copy it.", "err"); }
                textEl.setAttribute("readonly", "readonly");
            }
        });

        document.getElementById("qp-close").addEventListener("click", close);
        wrap.querySelector(".add-resource-overlay").addEventListener("click", function (ev) {
            if (ev.target.classList.contains("add-resource-overlay")) close();
        });
        modalKeyHandler = function (ev) { if (ev.key === "Escape") close(); };
        document.addEventListener("keydown", modalKeyHandler);

        refresh();

        // Load the topic's content from Drive (same endpoint the reader uses).
        if (!opts.link) {
            contentState = "missing";
            setStatus("This topic has no linked content yet. The prompt has a placeholder — paste the content in yourself.", "err");
            refresh();
            return;
        }
        fetch(opts.api + "?action=get_markdown&ref=" + encodeURIComponent(opts.link))
            .then(function (r) { return r.json(); })
            .then(function (d) {
                if (!document.getElementById("quiz-prompt-modal")) return; // closed meanwhile
                if (!d || !d.ok || !String(d.content || "").trim()) {
                    contentState = "error";
                    setStatus((d && d.error) || "Couldn't load the content. The prompt has a placeholder — paste the content in yourself.", "err");
                    refresh();
                    return;
                }
                content = cleanContent(d.content);
                contentState = "ok";
                refresh();
            })
            .catch(function () {
                if (!document.getElementById("quiz-prompt-modal")) return;
                contentState = "error";
                setStatus("Network error. The prompt has a placeholder — paste the content in yourself.", "err");
                refresh();
            });
    }


    // ---------- shared pieces for mount() ----------

    // Same three cases the old "Small Quiz Prompt" handled: English (+ Hindi
    // unless enOnly), Hindi only, or only the AI-explainer (Hinglish) text.
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
        host.classList.add("quiz-host");
        host.innerHTML =
            '<div class="prompt-block-row"><strong>📝 Quiz for this topic</strong></div>' +
            '<p class="prompt-block-desc"><strong>1. Make:</strong> copy the prompt (this topic\'s text is already inside), paste it into Gemini or another AI, and save the HTML it returns in this topic\'s Drive folder under the suggested file name. ' +
            '<strong>2. Add:</strong> paste that file\'s Drive link below. It then appears in Practice → this topic → Quiz.</p>' +
            '<div class="qp-row">' +
            '<div><label class="quiz-lbl">Quiz language</label><select class="qh-lang">' + options(LANG_OPTIONS, lsGet(LS_LANG, "en")) + "</select></div>" +
            '<div><label class="quiz-lbl">Questions</label><input type="number" class="qh-count" min="4" max="20" value="' + esc(lsGet(LS_COUNT, "10")) + '"></div>' +
            "</div>" +
            '<label class="quiz-lbl">Focus</label><select class="qh-focus">' + options(FOCUS_OPTIONS, "") + "</select>" +
            '<label class="quiz-lbl">Exam context (use one exam if this topic is for one)</label>' +
            '<input type="text" class="qh-exam" placeholder="e.g. UGC NET, SSC, BPSC" value="' + esc(lsGet(LS_EXAM, "")) + '">' +
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
        var langEl = $(".qh-lang"), countEl = $(".qh-count"), focusEl = $(".qh-focus"), examEl = $(".qh-exam");
        var enOnlyEl = $(".qh-enonly"), copyEl = $(".qh-copy"), copyStatus = $(".qh-copystatus");
        var linkEl = $(".qh-link"), prevEl = $(".qh-preview"), titleEl = $(".qh-title"), saveEl = $(".qh-save");
        var listEl = $(".qh-list");

        function status(el, text, kind) { el.textContent = text; el.className = "quiz-add-preview " + (el.dataset.base || "") + (kind ? " " + kind : ""); }
        copyStatus.dataset.base = "qh-copystatus";
        prevEl.dataset.base = "qh-preview";

        function current() {
            var count = parseInt(countEl.value, 10);
            if (!isFinite(count)) count = 10;
            count = Math.min(20, Math.max(4, count));
            return {
                count: count, lang: langEl.value, focus: focusEl.value, exam: examEl.value.trim(),
                subject: ctx.subject || "", topic: topic
            };
        }
        function showName() {
            var o = current();
            status(copyStatus, "Suggested file name: " + fileNameFor(topic, nodeId, o.focus, o.lang, ctx.parent));
        }
        [langEl, focusEl].forEach(function (e) { e.addEventListener("change", showName); });
        showName();

        copyEl.addEventListener("click", function () {
            var split = ctx.getSplit ? ctx.getSplit() : null;
            var cb = buildContentBlock(split, ctx.clean, !!enOnlyEl.checked);
            if (!cb) {
                status(copyStatus, "This topic has no content loaded yet. Add and open its content first — the quiz prompt is built from that text.", "err");
                return;
            }
            var o = current();
            o.content = cb.text;
            o.fileName = fileNameFor(topic, nodeId, o.focus, o.lang, ctx.parent);
            lsSet(LS_LANG, o.lang); lsSet(LS_COUNT, String(o.count)); lsSet(LS_EXAM, o.exam);
            var prompt = buildPrompt(o);
            var original = copyEl.innerHTML;
            copyText(prompt, function () {
                copyEl.innerHTML = "✓ Prompt Copied";
                copyEl.disabled = true;
                setTimeout(function () { copyEl.innerHTML = original; copyEl.disabled = false; }, 1800);
                var big = prompt.length > 30000 ? " Long paste (" + Math.round(prompt.length / 1000) + "k characters) — tick \"EN only\" and copy again if your AI app cuts it." : "";
                status(copyStatus, "✓ Copied (" + cb.included + "). Save the quiz as: " + o.fileName + "." + big, "ok");
            }, function () {
                status(copyStatus, "Automatic copy was blocked by the browser. Try again, or allow clipboard access for this site.", "err");
            });
        });

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
                    return list;
                })
                .catch(function () { /* list is a nicety; ignore */ });
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

    window.QuizPrompt = { open: open, close: close, mount: mount, __test: { buildPrompt: buildPrompt, buildContentBlock: buildContentBlock, fileNameFor: fileNameFor } };
})();
