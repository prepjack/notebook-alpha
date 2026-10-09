/* =========================================================
   js/visual-aids.js — "Visual aids" section inside the
   "Add Content Folder" box.

   Same pattern as quiz-prompt.js: the popup holds one empty
   <div id="visual-aids-host">; everything else (UI + prompts)
   lives in THIS file. Breaking this file can never break the popup.

   Public API:
     window.VisualAids.mount(hostElement, ctx)
       ctx = {
         topic, breadcrumb,
         getSplit()        -> { en, hi, ai }  (already filtered by the
                              popup's "Choose sections" list)
         noSectionTicked() -> true when every section is unticked
         clean(text)       -> the page's cleanContentForPrompt()
       }

   KINDS OF VISUAL live in ONE list (TYPES below). The dropdown and the
   prompt are both generated from it, so adding a kind = adding one entry.
   ========================================================= */
(function () {
    "use strict";

    var LS_TYPE = "visualAids:type";
    var LS_MODE = "visualAids:mode";
    var LS_EN = "visualAids:enOnly";
    var BT = "\u0060\u0060\u0060";

    /* ---------- the kinds of visual ---------- */
    // base  = start of the PNG file name        count = default number of images
    // place = where the Paste block goes in content.md (shown in the steps)
    var TYPES = [
        {
            id: "infographic", label: "Infographic (topic summary)", base: "infographic", count: 2,
            place: "right below each <!-- ===LANG:XX=== --> line (EN, HI and AI)",
            brief: [
                "Create infographic(s) that summarise the study content.",
                "Each infographic explains ONE clear idea in the form the content naturally calls for: a process or sequence, a classification or hierarchy, a comparison, or cause and effect.",
                "One clear title, 4 to 8 sections, arrows or numbers where order matters.",
                "Do not repeat what another infographic already shows."
            ]
        },
        {
            id: "memory", label: "Memory picture (to remember lists / order)", base: "memory", count: 1,
            place: "under the heading of the section it belongs to, in every LANG block",
            brief: [
                "Create MEMORY PICTURE(s): visual mnemonics for the parts of this content that are hardest to remember (a list, a numbered sequence, a set of similar-sounding terms, or key dates).",
                "First pick the 1 to 3 most forgettable items from the content yourself.",
                "Draw ONE vivid, slightly absurd scene per item. Each thing to remember becomes a clear object or character, placed in the exact order of the content along a familiar path (for example the rooms of a house or the stops of a street), with a small number next to each object and the real term as a short label beside it.",
                "The scene must make the correct order and the correct terms easy to recall. Never change, merge, or invent items to make the story fun.",
                "Keep the scene uncluttered: at most 7 objects per picture.",
                "In your reply, after the image(s), add a short KEY: one line per object saying what it stands for (Object = Term)."
            ]
        },
        {
            id: "compare", label: "Compare chart (confusing terms)", base: "compare", count: 1,
            place: "under the heading of the section it belongs to, in every LANG block",
            brief: [
                "Create COMPARE CHART(s) for the terms, concepts, or items in this content that students confuse with each other.",
                "Pick the 1 to 3 most confusable pairs or groups yourself (2 or 3 columns each).",
                "Layout: one column per item, shared row labels (such as meaning, key feature, example, year, exam trap), and the single most important difference highlighted in a contrasting colour.",
                "Take every cell from the content. Leave a row out rather than guess."
            ]
        },
        {
            id: "mindmap", label: "Mind map (picture)", base: "mindmap", count: 1,
            place: "right below each <!-- ===LANG:XX=== --> line (EN, HI and AI)",
            brief: [
                "Create MIND MAP picture(s) of this content.",
                "The topic in the centre, 4 to 7 main branches, at most 3 short sub-points per branch, each branch in its own colour.",
                "Keep every node to a few words, in the content's own terms. Branch order follows the content's order."
            ]
        },
        {
            id: "timeline", label: "Timeline (dates and events)", base: "timeline", count: 1,
            place: "right below each <!-- ===LANG:XX=== --> line (EN, HI and AI)",
            brief: [
                "Create TIMELINE picture(s) for the dates and events in this content: one line in chronological order, each event with its date (Roman digits) and a few words.",
                "Use only dates given in the content. Never add or correct dates from outside.",
                "At most 10 events per timeline; use a second image if there are more.",
                "If the content has fewer than 3 dates, say so in one line and instead make a process or sequence diagram."
            ]
        }
    ];

    function typeById(id) {
        return TYPES.filter(function (t) { return t.id === id; })[0] || TYPES[0];
    }

    /* ---------- small helpers ---------- */
    function esc(s) {
        return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }
    function lsGet(k, d) { try { var v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } }
    function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* blocked */ } }
    function slugTag(s) {
        return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 12);
    }
    function fileBase(type, tag) {
        return type.base + (tag ? "-" + tag : "");
    }
    function fileNames(type, tag, n) {
        var out = [], base = fileBase(type, tag);
        for (var i = 1; i <= n; i++) out.push(base + "-" + i + ".png");
        return out;
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

    /* ---------- the topic text as the AI should see it ---------- */
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
            return { text: block, bilingual: !!hiText };
        }
        if (hi) {
            return { text: "=== CONTENT (हिंदी) ===\n" + c(split.hi), bilingual: false };
        }
        return { text: "=== CONTENT (AI EXPLAINER - HINGLISH) ===\n" + c(split.ai), bilingual: false };
    }

    /* ---------- the prompt ---------- */
    // o: { type, mode ("file"|"chat"), count, tag, topic, breadcrumb, content }
    function buildPrompt(o) {
        var type = o.type;
        var n = o.count;
        var names = fileNames(type, o.tag, n);

        var delivery;
        if (o.mode === "chat") {
            delivery = [
                "DELIVERY (MODE: QUICK VIEW IN CHAT)",
                "- Show the finished image(s) here in the chat so I can study them now. Nothing will be saved, so no file names and no Markdown.",
                "- Add nothing else except what the task above asks for in the reply (for example the KEY)."
            ];
        } else {
            var pasteLines = names.map(function (f, i) {
                return "![Short caption for image " + (i + 1) + "](" + f + ")";
            }).join("\n\n");
            delivery = [
                "DELIVERY (MODE: SAVE TO SITE)",
                "- Give each image as a downloadable PNG named exactly: " + names.join(", ") + " (lowercase, with hyphens).",
                "- If you can only display images and cannot offer downloads, say so in one line.",
                "- Then output this \"Paste block\" exactly once, inside a code block, one line per image with a short English caption:",
                "",
                BT,
                pasteLines,
                BT,
                "",
                "- Add nothing else except what the task above asks for in the reply (for example the KEY). No HTML."
            ];
        }

        return [
            "You are creating study visuals for Notebook Alpha, an exam-preparation website.",
            "",
            "TOPIC: " + o.topic,
            "PATH: " + o.breadcrumb,
            "KIND OF VISUAL: " + type.label,
            "NUMBER OF IMAGES: " + n + " (fewer is fine if the content cannot support that many good ones; never make filler)",
            "",
            "TASK",
            "Use your built-in image-generation tool if you have one; otherwise draw the images with code (HTML+CSS screenshotted in headless Chromium).",
            type.brief.join("\n"),
            "",
            "CONTENT RULES (this is exam content, so accuracy matters more than beauty)",
            "- Use only facts, terms, names, dates, and numbers that appear in the content below, spelled exactly as written there. Add no new fact and no outside example.",
            "- Image text must be short: a title, labels, and short phrases. No paragraphs.",
            "- After generating each image, read every word in it. If any word is misspelled, any date or number is wrong, or anything is cut off, regenerate it before delivering.",
            "",
            "DESIGN RULES",
            "- Square or landscape (about 3:2) layout, readable on a phone: large text, high contrast, light background, one consistent colour scheme.",
            "- No decorative clutter, no watermark, no logos, no QR code, no mention of any source.",
            "",
            "LANGUAGE OF THE IMAGE TEXT",
            "- If the content below has both a \"=== CONTENT (ENGLISH) ===\" part and a \"=== CONTENT (हिंदी) ===\" part: every label reads \"English / हिन्दी\" (short labels only). Check every Devanagari word for broken or detached vowel signs and empty boxes. If any Hindi text is not perfectly clean, regenerate that image with English-only labels and tell me.",
            "- If only a \"=== CONTENT (हिंदी) ===\" part is given: write the labels in Hindi (Devanagari) only, with the same check. If it cannot be made clean, use English-only labels and tell me.",
            "- Otherwise: all text in English only.",
            "- Dates and numbers always in Roman digits.",
            "",
            delivery.join("\n"),
            "",
            "STUDY CONTENT",
            "",
            o.content
        ].join("\n");
    }

    /* ---------- mount(): the panel inside the content box ---------- */
    function mount(host, ctx) {
        if (!host || !ctx) return;

        var savedType = typeById(lsGet(LS_TYPE, "infographic"));
        var savedMode = lsGet(LS_MODE, "file") === "chat" ? "chat" : "file";
        var savedEnOnly = lsGet(LS_EN, "1") !== "0";

        host.innerHTML =
            '<div class="prompt-block-row"><strong>🖼 Visual aids for this topic</strong></div>' +
            '<p class="prompt-block-desc">Pick a kind of visual and copy the prompt. This topic\'s text (only the sections ticked in "Choose sections" above) is already inside. Paste it into an AI that can make images, e.g. ChatGPT.</p>' +
            '<label class="quiz-lbl">Kind of visual</label>' +
            '<select class="va-type">' + TYPES.map(function (t) {
                return '<option value="' + esc(t.id) + '"' + (t.id === savedType.id ? " selected" : "") + ">" + esc(t.label) + "</option>";
            }).join("") + "</select>" +
            '<label class="quiz-lbl">How many images</label>' +
            '<select class="va-count">' + [1, 2, 3].map(function (k) {
                return '<option value="' + k + '"' + (k === savedType.count ? " selected" : "") + ">" + k + "</option>";
            }).join("") + "</select>" +
            '<label class="quiz-lbl">What do you want?</label>' +
            '<label style="display:block;margin:2px 0;"><input type="radio" name="vamode" value="file"' + (savedMode === "file" ? " checked" : "") + '> <strong>Save to site</strong> (PNG files you add to this topic)</label>' +
            '<label style="display:block;margin:2px 0;"><input type="radio" name="vamode" value="chat"' + (savedMode === "chat" ? " checked" : "") + '> <strong>Quick view in chat</strong> (just look at it now, nothing saved)</label>' +
            '<div class="va-tagrow">' +
            '<label class="quiz-lbl">File tag <span class="field-optional">(optional, e.g. s2 for section 2. Keeps file names from clashing)</span></label>' +
            '<input type="text" class="va-tag" maxlength="12" placeholder="e.g. s2" autocomplete="off">' +
            '</div>' +
            '<div class="prompt-block-row">' +
            '<button type="button" class="content-action va-copy">🖼 Copy Visual Prompt</button>' +
            '<label class="flashcard-enonly"><input type="checkbox" class="va-enonly"' + (savedEnOnly ? " checked" : "") + '> English labels only (safer)</label>' +
            '</div>' +
            '<div class="quiz-add-preview va-status"></div>' +
            '<details class="content-link-guide"><summary>What to do after copying</summary><div class="va-steps"></div></details>';

        function $(sel) { return host.querySelector(sel); }
        var typeEl = $(".va-type"), countEl = $(".va-count"), tagEl = $(".va-tag"), tagRow = $(".va-tagrow");
        var enOnlyEl = $(".va-enonly"), copyEl = $(".va-copy"), statusEl = $(".va-status"), stepsEl = $(".va-steps");

        function mode() {
            var r = host.querySelector('input[name="vamode"]:checked');
            return r && r.value === "chat" ? "chat" : "file";
        }
        function status(text, kind) {
            statusEl.textContent = text;
            statusEl.className = "quiz-add-preview va-status" + (kind ? " " + kind : "");
        }

        function refresh() {
            var type = typeById(typeEl.value);
            var tag = slugTag(tagEl.value);
            var n = parseInt(countEl.value, 10) || 1;
            tagRow.hidden = mode() === "chat";

            if (mode() === "chat") {
                status("Quick view: the AI shows the image(s) in the chat. Nothing to save.");
                stepsEl.innerHTML = "<ol>" +
                    "<li>Paste the prompt into ChatGPT (image generation on).</li>" +
                    "<li>Read every word in the image(s). Wrong spelling, date or number means ask it to redo that image.</li>" +
                    "</ol>";
            } else {
                status("Files will be named: " + fileNames(type, tag, n).join(", "));
                stepsEl.innerHTML = "<ol>" +
                    "<li>Paste the prompt into ChatGPT (image generation on) and download the image(s).</li>" +
                    "<li>Check every word, date and number in the image(s). Redo any that are wrong.</li>" +
                    "<li>Put the image(s) in this topic's Drive folder next to <code>content.md</code>. Keep the exact file names.</li>" +
                    "<li>Open <code>content.md</code> and paste the \"Paste block\" the AI gave " + esc(type.place) + ".</li>" +
                    "<li>Save <code>content.md</code> back in the same Drive folder (only one .md file there), then reload the site.</li>" +
                    "</ol>";
            }
        }

        typeEl.addEventListener("change", function () {
            lsSet(LS_TYPE, typeEl.value);
            countEl.value = String(typeById(typeEl.value).count);
            refresh();
        });
        countEl.addEventListener("change", refresh);
        tagEl.addEventListener("input", refresh);
        enOnlyEl.addEventListener("change", function () { lsSet(LS_EN, enOnlyEl.checked ? "1" : "0"); });
        host.querySelectorAll('input[name="vamode"]').forEach(function (r) {
            r.addEventListener("change", function () { lsSet(LS_MODE, mode()); refresh(); });
        });

        copyEl.addEventListener("click", function () {
            if (ctx.noSectionTicked && ctx.noSectionTicked()) {
                status("Please tick at least one section in \"Choose sections\" above.", "err");
                return;
            }
            var split = ctx.getSplit ? ctx.getSplit() : null;
            var cb = buildContentBlock(split, ctx.clean, !!enOnlyEl.checked);
            if (!cb) {
                status("This topic has no content loaded yet. Add and open its content first.", "err");
                return;
            }
            var type = typeById(typeEl.value);
            var prompt = buildPrompt({
                type: type,
                mode: mode(),
                count: parseInt(countEl.value, 10) || 1,
                tag: slugTag(tagEl.value),
                topic: ctx.topic || "",
                breadcrumb: ctx.breadcrumb || "",
                content: cb.text
            });
            var original = copyEl.innerHTML;
            copyText(prompt, function () {
                copyEl.innerHTML = "✓ Prompt Copied";
                copyEl.disabled = true;
                setTimeout(function () { copyEl.innerHTML = original; copyEl.disabled = false; }, 1800);
                var big = prompt.length > 30000 ? " Long paste (" + Math.round(prompt.length / 1000) + "k characters): untick some sections and copy again if your AI app cuts it." : "";
                status("✓ Copied (" + (cb.bilingual ? "English + Hindi" : "single-language") + " content, labels " +
                    (cb.bilingual ? "bilingual" : "in one language") + ")." + big, "ok");
            }, function () {
                status("Automatic copy was blocked by the browser. Try again, or allow clipboard access for this site.", "err");
            });
        });

        refresh();
    }

    window.VisualAids = {
        mount: mount,
        __test: { buildPrompt: buildPrompt, buildContentBlock: buildContentBlock, TYPES: TYPES, fileNames: fileNames, slugTag: slugTag }
    };
})();
