/* =========================================================
   js/visual-aids.js — "Visual aids" section inside the
   "Add Content Folder" box.

   Same pattern as quiz-prompt.js: the popup holds one empty
   <div id="visual-aids-host">; everything else (UI + prompts)
   lives in THIS file.

   Public API:
     window.VisualAids.mount(hostElement, ctx)
       ctx = {
         topic, breadcrumb,
         getSplit()        -> { en, hi, ai }  (already filtered by the
                              popup's "Choose sections" list)
         noSectionTicked() -> true when every section is unticked
         clean(text)       -> the page's cleanContentForPrompt()
       }

   TWO SMALL LISTS drive everything. EVERY choice produces IMAGES.
     TYPES    = what to make   (infographic, diagram, memory picture, mnemonic card, ...)
     METHODS  = how to draw it (AI picture, code, AI chooses)
   Each kind says which methods suit it (TYPES[].methods, first = default).
   To add a kind or a method, add one entry; the dropdowns and the prompt
   follow automatically.
   ========================================================= */
(function () {
    "use strict";

    var LS_TYPE = "visualAids:type";
    var LS_MODE = "visualAids:mode";
    var LS_EN = "visualAids:enOnly";
    var BT = "\u0060\u0060\u0060";

    /* ---------- HOW to draw (all of them make images) ---------- */
    var METHODS = {
        ai_picture: { label: "AI picture" },
        code:       { label: "Code (exact text)" },
        auto:       { label: "Let the AI choose the best tool" }
    };

    function methodDesc(methodId, type) {
        if (type.mnemonic && methodId === "code") {
            return "The AI makes a clean card with code: the mnemonic in big text, each part lined up with its exact term. Plain look, but every word is exact. Best choice for mnemonics.";
        }
        if (type.mnemonic && methodId === "ai_picture") {
            return "The AI's image tool makes a more colourful card. It lists every term it put on the card under \"Text in image\", so you can check the spelling and dates.";
        }
        if (methodId === "ai_picture") {
            if (type.replica) {
                return "The AI's image tool redraws your reference image. It lists every label it put in the new image, so you can compare it with the original in seconds.";
            }
            return type.numbersOnly
                ? "The AI's image tool draws the scene. Only numbers go inside the picture. What each number means is written as a text legend that you paste with it, so spelling and dates cannot go wrong, and Hindi is safe."
                : "The AI's image tool draws it with short labels copied from the content. The AI also lists every date and name it put in the picture, so you can check them in seconds.";
        }
        if (methodId === "code") {
            return type.replica
                ? "The AI rebuilds the reference with code (Python or SVG), so the text is exact. Works well for diagrams, charts and tables. A reference with real drawings may come out simpler."
                : "The AI draws with code (Python or SVG), so every word is exactly what the content says. The look is plainer. Hindi needs a font, so English-only labels are safer.";
        }
        return "The AI picks the most reliable method for each image and tells you which one it used.";
    }

    /* ---------- WHAT to make ---------- */
    // base     = start of the PNG file name        count   = default number
    // methods  = allowed drawing methods, first is the default
    // numbersOnly = picture holds only numbers; meanings go in a text legend
    // replica  = redraw a reference image the user attaches
    // place    = where the Paste block goes in content.md (shown in the steps)
    var TYPES = [
        {
            id: "infographic", label: "Infographic (topic summary)", base: "infographic", count: 2,
            methods: ["ai_picture", "code", "auto"], numbersOnly: false,
            place: "right below each <!-- ===LANG:XX=== --> line (EN, HI and AI)",
            brief: [
                "Create infographic(s) that summarise the study content.",
                "Each infographic explains ONE clear idea in the form the content naturally calls for: a process or sequence, a classification or hierarchy, a comparison, or cause and effect.",
                "One clear title, 4 to 8 sections, arrows or numbers where order matters.",
                "Do not repeat what another infographic already shows."
            ]
        },
        {
            id: "diagram", label: "Diagram (flow / cycle / hierarchy)", base: "diagram", count: 1,
            methods: ["code", "ai_picture", "auto"], numbersOnly: false,
            place: "under the heading of the section it belongs to, in every LANG block",
            brief: [
                "Create a clean DIAGRAM of a process, cycle, flow, or hierarchy from this content.",
                "Pick the 1 to 3 sequences or structures in the content that are easiest to understand as a diagram.",
                "Use boxes and arrows (or a tree for a hierarchy). Number the steps where order matters, show the direction of every arrow, and mark the start and the end clearly.",
                "At most 8 boxes per diagram; use a second diagram if there are more. Box order follows the content's order."
            ]
        },
        {
            id: "memory", label: "Memory picture (to remember lists / order)", base: "memory", count: 1,
            methods: ["ai_picture"], numbersOnly: true,
            place: "under the heading of the section it belongs to, in every LANG block",
            brief: [
                "Create MEMORY PICTURE(s): visual mnemonics for the parts of this content that are hardest to remember (a list, a numbered sequence, a set of similar-sounding terms, or key dates).",
                "First pick the 1 to 3 most forgettable items from the content yourself.",
                "Draw ONE vivid, slightly absurd scene per item. Each thing to remember becomes a clear object or character, placed in the exact order of the content along a familiar path (for example the rooms of a house or the stops of a street), with a small number (1, 2, 3 ...) next to each object, in the content's order.",
                "The scene must make the correct order easy to recall. Never change, merge, or invent items to make the story fun.",
                "At most 7 objects per picture. In the legend, each line says what the object stands for: Object = Term."
            ]
        },
        {
            id: "mnemonic", label: "Mnemonic card (acronym / sentence / rhyme / story)", base: "mnemonic", count: 1,
            methods: ["code", "ai_picture", "auto"], numbersOnly: false, mnemonic: true,
            place: "under the heading of the section it belongs to, in every LANG block",
            brief: []   // built per request, see briefFor()
        },
        {
            id: "pictorial", label: "Pictorial scene (picture-led explanation)", base: "pictorial", count: 1,
            methods: ["ai_picture"], numbersOnly: true,
            place: "under the heading of the section it belongs to, in every LANG block",
            brief: [
                "Create PICTORIAL scene(s): a picture-led explanation of a concept as it would look in real life (a situation, a place, objects, people), so the idea can be recalled by \"seeing\" it.",
                "Pick the 1 to 3 concepts in the content that are easiest to show as a scene.",
                "Mark the key parts of the scene with numbered callouts (at most 6 per picture).",
                "The scene must show the content's own idea accurately. Do not add facts or events that are not in the content."
            ]
        },
        {
            id: "compare", label: "Compare chart (confusing terms)", base: "compare", count: 1,
            methods: ["code", "ai_picture", "auto"], numbersOnly: false,
            place: "under the heading of the section it belongs to, in every LANG block",
            brief: [
                "Create a COMPARE CHART for the terms, concepts, or items in this content that students confuse with each other.",
                "Pick the 1 to 3 most confusable pairs or groups yourself (2 or 3 columns each).",
                "Layout: one column per item, shared row labels (such as meaning, key feature, example, year, exam trap), and the single most important difference highlighted.",
                "Take every cell from the content. Leave a row out rather than guess."
            ]
        },
        {
            id: "mindmap", label: "Mind map", base: "mindmap", count: 1,
            methods: ["code", "ai_picture", "auto"], numbersOnly: false,
            place: "right below each <!-- ===LANG:XX=== --> line (EN, HI and AI)",
            brief: [
                "Create a MIND MAP of this content.",
                "The topic in the centre, 4 to 7 main branches, at most 3 short sub-points per branch, each branch in its own colour.",
                "Keep every node to a few words, in the content's own terms. Branch order follows the content's order."
            ]
        },
        {
            id: "timeline", label: "Timeline (dates and events)", base: "timeline", count: 1,
            methods: ["code", "ai_picture", "auto"], numbersOnly: false,
            place: "right below each <!-- ===LANG:XX=== --> line (EN, HI and AI)",
            brief: [
                "Create a TIMELINE for the dates and events in this content: one line in chronological order, each event with its date (Roman digits) and a few words.",
                "Use only dates given in the content. Never add or correct dates from outside.",
                "At most 10 events per timeline; make a second one if there are more.",
                "If the content has fewer than 3 dates, say so in one line and make a process or sequence diagram instead."
            ]
        },
        {
            id: "replica", label: "Replica of an image I give you", base: "replica", count: 1,
            methods: ["ai_picture", "code", "auto"], numbersOnly: false, replica: true,
            place: "under the heading of the section it belongs to, in every LANG block",
            brief: []   // built per request, see briefFor()
        }
    ];

    function typeById(id) {
        return TYPES.filter(function (t) { return t.id === id; })[0] || TYPES[0];
    }

    // replicaText: "reference" = copy the reference image's own text exactly,
    //              "content"   = take the text from the topic content
    var MNEMONIC_STYLES = {
        choose:   { label: "Let the AI choose the most natural", text: "Choose the most natural style for each item yourself (acronym, sentence, rhyme, story, or date hook) and say which one you used." },
        acronym:  { label: "Acronym (a word from the first letters)", text: "ACRONYM: a pronounceable word or name made from the first letters of the items, in order." },
        sentence: { label: "Sentence (each word starts with the item's letter)", text: "SENTENCE: a catchy sentence, the sillier the better, where each word starts with the first letter of the matching item, in order." },
        rhyme:    { label: "Rhyme or jingle", text: "RHYME OR JINGLE: a short rhyme of 2 to 4 lines that says the items in order." },
        story:    { label: "Story chain", text: "STORY CHAIN: a very short, vivid story where each item appears as a character or object, in order." },
        datehook: { label: "Date or number hook", text: "DATE HOOK: for dates and numbers, a memorable hook that encodes the digits exactly (for example split a year into two-digit chunks and link each chunk to a vivid image or phrase). Write the decoding line that proves the digits are right." }
    };

    function briefFor(type, o) {
        if (type.mnemonic) {
            var st = MNEMONIC_STYLES[o.mnemonicStyle] || MNEMONIC_STYLES.choose;
            return [
                "Create MNEMONIC CARD(s): memory tricks for the parts of this content that are hardest to remember (lists, ordered steps, classifications, groups of similar terms, or key dates).",
                "First pick the 1 to 3 most forgettable items or groups from the content yourself. One card per item or group.",
                "MNEMONIC STYLE. " + st.text,
                "Rules: use the items in the content's exact order, each exactly once. Never change, merge, drop, or invent an item, and never bend a term's spelling, to make the mnemonic work. If no natural mnemonic exists for something, say so in one line instead of forcing a bad one.",
                "Card layout: the mnemonic in large text at the top; below it, each part of the mnemonic lined up with the exact term it stands for, in order, with the first letter or key part of each term highlighted."
            ];
        }
        if (!type.replica) return type.brief;
        var n = o.count;
        var head = "I have attached " + n + " REFERENCE image" + (n > 1 ? "s" : "") + " (from the internet or a book) to this message. Create one new image for each reference image, redrawn from scratch.";
        if (o.replicaText === "content") {
            return [
                head,
                "Use the reference only for its layout, structure, and visual style. The text in the new image comes from the STUDY CONTENT below, not from the reference.",
                "Keep the same kind of elements (boxes, arrows, labels, groups) in the same arrangement, with the content's own terms in them."
            ];
        }
        return [
            head,
            "The new image must look like the reference: the same layout, the same structure, the same elements and arrows, the same labels. It should be a clean, sharp, correctly spelled version of it.",
            "If the reference is blurry or small, read it carefully and rebuild it larger and cleaner."
        ];
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
    function fileNames(type, tag, n) {
        var out = [], base = type.base + (tag ? "-" + tag : "");
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
            return { text: block, hasEn: true, hasHi: !!hiText, bilingual: !!hiText };
        }
        if (hi) {
            return { text: "=== CONTENT (हिंदी) ===\n" + c(split.hi), hasEn: false, hasHi: true, bilingual: false };
        }
        return { text: "=== CONTENT (AI EXPLAINER - HINGLISH) ===\n" + c(split.ai), hasEn: false, hasHi: false, bilingual: false };
    }

    /* ---------- prompt pieces ---------- */
    function isRefMode(o) { return !!o.type.replica && o.replicaText !== "content"; }

    function methodBlock(o) {
        var type = o.type, methodId = o.method;
        var source = isRefMode(o) ? "the reference image" : "the content";

        if (methodId === "ai_picture") {
            if (type.numbersOnly) {
                return [
                    "DRAWING METHOD: AI PICTURE, NUMBERS ONLY",
                    "- Use your built-in image-generation tool.",
                    "- Inside the picture put only numbers, simple icons, and at most a short English title. Do NOT write terms, names, dates, or sentences inside the picture, because image tools often garble them.",
                    "- Every number is explained in a LEGEND (a numbered Markdown list) that you write as text, using the content's exact terms, names, and dates."
                ];
            }
            return [
                "DRAWING METHOD: AI PICTURE WITH SHORT LABELS",
                "- Use your built-in image-generation tool.",
                "- Labels inside the picture must be short (a few words) and copied exactly from " + source + ".",
                "- FACT LOCK: before drawing, list every date, name, and number you will put in the picture, copied from " + source + ". After drawing, read the picture and compare each label with that list; regenerate if anything differs.",
                "- In your reply include that list under the heading \"Text in image:\" so I can verify it in seconds."
            ];
        }
        if (methodId === "code") {
            var lines = [
                "DRAWING METHOD: CODE (EXACT TEXT)",
                "- Draw with code, not with the image-generation tool: Python (Pillow or matplotlib), or SVG converted to PNG. Every word is then exactly what " + source + " says.",
                "- Use a clear, large font and a consistent palette. A plain but clean look is fine.",
                "- If any label contains Hindi, use a real Devanagari font (Noto Sans Devanagari, Mukta, or Hind) and check that every character shows correctly. If that is not possible, use English-only labels and tell me."
            ];
            if (type.replica) lines.push("- If the reference is mostly drawings that code cannot reproduce, say so in one line and use the image-generation tool for that image instead.");
            return lines;
        }
        return [
            "DRAWING METHOD: YOU CHOOSE",
            "- For each image choose the most reliable method yourself:",
            "  * code (Python or SVG, exact text) for anything with dates, lists, or many labels;",
            "  * the image-generation tool for scenes or illustrations, with only numbers inside the picture and a numbered LEGEND written as text.",
            "- Whatever you choose, copy every date, name, and number exactly from " + source + ". If you use the image tool with labels, list them under \"Text in image:\".",
            "- Tell me in one line, per image, which method you used and why."
        ];
    }

    // which legend language(s) the Paste block needs
    function legendLangs(langs) {
        if (langs.en && langs.hi) return "both";
        if (langs.hi && !langs.en) return "hi";
        return "en";
    }

    function pasteBlockText(names, withLegend, lang, type) {
        var cap = lang === "hi" ? "Short Hindi caption" : "Short English caption";
        var term = lang === "hi" ? "exact Hindi term from the Hindi content" : "exact term from the content";
        return names.map(function (f, i) {
            var img = "![" + cap + " for image " + (i + 1) + "](" + f + ")";
            if (!withLegend) return img;
            if (type && type.mnemonic) {
                return img + "\n\n**Mnemonic:** the mnemonic itself, as text" + (lang === "hi" ? " (a separate Hindi one, built from the Hindi terms)" : "") +
                    "\n1. part of the mnemonic = " + term + "\n2. ...";
            }
            return img + "\n\n**Legend**\n1. what the object or callout shows = " + term + "\n2. ...";
        }).join("\n\n");
    }

    function deliveryBlock(o) {
        var type = o.type, method = o.method, n = o.count;
        var names = fileNames(type, o.tag, n);
        var legendNeeded = (method === "ai_picture" && type.numbersOnly) || method === "auto" || !!type.mnemonic;

        if (o.mode === "chat") {
            var chat = [
                "DELIVERY (MODE: QUICK VIEW IN CHAT)",
                "- Show the finished image(s) here in the chat so I can study them now. Nothing will be saved, so no file names and no Markdown paste block."
            ];
            if (type.mnemonic) chat.push("- Under each card write the mnemonic as text, and what each part of it stands for (the content's exact terms).");
            else if (legendNeeded) chat.push("- Under each image that uses numbered callouts, write its numbered LEGEND (what each number stands for, with the content's exact terms).");
            chat.push("- Add nothing else except what the task asks for in the reply.");
            return chat;
        }

        var out = [
            "DELIVERY (MODE: SAVE TO SITE)",
            "- Give each image as a downloadable PNG named exactly: " + names.join(", ") + " (lowercase, with hyphens).",
            "- If you can only display images and cannot offer downloads, say so in one line."
        ];
        var langsMode = legendNeeded ? legendLangs(o.langs) : null;
        if (langsMode === "both") {
            out.push("- Then output TWO \"Paste block\" code blocks, exactly once each. The English one is for the EN block of content.md; the Hindi one (same numbering) is for the HI block.");
            out.push("", "English Paste block:", BT, pasteBlockText(names, true, "en", type), BT);
            out.push("", "Hindi Paste block:", BT, pasteBlockText(names, true, "hi", type), BT);
        } else if (langsMode) {
            out.push("- Then output this \"Paste block\" exactly once, inside a code block:");
            out.push("", BT, pasteBlockText(names, true, langsMode, type), BT);
        } else {
            out.push("- Then output this \"Paste block\" exactly once, inside a code block, one line per image with a short English caption:");
            out.push("", BT, pasteBlockText(names, false, "en", type), BT);
        }
        if (method === "auto" && !type.mnemonic) {
            out.push("- Keep the Legend lines only under images that use numbered callouts; delete them for the other images.");
        }
        out.push("- Add nothing else except what the task asks for in the reply. No HTML.");
        return out;
    }

    function languageBlock(o) {
        var type = o.type, method = o.method, langs = o.langs;
        if (type.mnemonic) {
            var hindiToo = legendLangs(langs) === "both";
            return [
                "LANGUAGE",
                "- Build the mnemonic from the content's own terms. The image is in English only (the mnemonic and short term labels).",
                hindiToo
                    ? "- The Hindi content is also given: write a SEPARATE Hindi mnemonic built from the Hindi terms, as text only in the Hindi Paste block. Do not translate the English one (an acronym cannot be translated). If no good Hindi mnemonic exists, say so in one line."
                    : (legendLangs(langs) === "hi"
                        ? "- Only Hindi content is given: build the mnemonic from the Hindi terms and write it as text. The image may carry the mnemonic only if the Devanagari renders perfectly; otherwise give the text only."
                        : "- Only English content is given: English only."),
                "- Dates and numbers always in Roman digits."
            ];
        }
        if (isRefMode(o)) {
            return [
                "LANGUAGE OF THE IMAGE TEXT",
                "- Keep the language of the text in the reference image. If it has Hindi (Devanagari), check every word for broken or detached vowel signs and empty boxes. If a Hindi label cannot be made clean, redo that image with English labels taken from the English content below and tell me.",
                "- Dates and numbers stay exactly as in the reference."
            ];
        }
        if (method === "ai_picture" && type.numbersOnly) {
            var how = legendLangs(langs) === "both"
                ? "once in English and once in Hindi (Devanagari), with the same numbering. Hindi terms are copied from the Hindi part of the content, not translated afresh."
                : legendLangs(langs) === "hi"
                    ? "in Hindi (Devanagari), copied from the Hindi content."
                    : "in English (or, if the content is a Hinglish explainer, in the same language as the content), using the content's exact terms.";
            return [
                "LANGUAGE",
                "- The picture itself holds only numbers and at most a short English title.",
                "- The legend is written " + how,
                "- Dates and numbers always in Roman digits."
            ];
        }
        return [
            "LANGUAGE OF THE IMAGE TEXT",
            "- If the content below has both a \"=== CONTENT (ENGLISH) ===\" part and a \"=== CONTENT (हिंदी) ===\" part: every label reads \"English / हिन्दी\" (short labels only). Check every Devanagari word for broken or detached vowel signs and empty boxes. If any Hindi text is not perfectly clean, redo that image with English-only labels and tell me.",
            "- If only a \"=== CONTENT (हिंदी) ===\" part is given: write the labels in Hindi (Devanagari) only, with the same check. If it cannot be made clean, use English-only labels and tell me.",
            "- Otherwise: all text in English only.",
            "- Dates and numbers always in Roman digits."
        ];
    }

    function contentRules(o) {
        var head = "CONTENT RULES (this is exam content, so accuracy matters more than beauty)";
        var maps = "- Never draw maps, borders, or coastlines (AI-drawn maps get them wrong). If the " + (o.type.replica ? "reference or content" : "content") + " needs a map, say so in one line and skip it.";
        if (isRefMode(o)) {
            return [
                head,
                "- The text in the new image is copied exactly from the reference image: same spelling, same dates, same numbers. Read each label slowly. If a label is unreadable, leave it out and tell me.",
                "- The STUDY CONTENT below is only for checking. If a label in the reference disagrees with it, do not change the label silently; list each case under \"Differences:\" in your reply.",
                "- Never round, convert, or \"correct\" a date or number.",
                maps,
                "- Do not copy watermarks, logos, website names, or credit lines. Redraw everything from scratch; do not trace or paste the reference.",
                "- After making each image, compare it with the reference label by label and redo it if anything differs or is cut off."
            ];
        }
        var lines = [
            head,
            "- Use only facts, terms, names, dates, and numbers that appear in the content below, spelled exactly as written there. Add no new fact and no outside example.",
            "- Never round, convert, translate, or \"correct\" a date or number. If you are not sure of something, leave it out.",
            maps,
            "- Keep any text short: titles, labels, short phrases. No paragraphs.",
            "- After making each image, read it back and check every word, date, and number against the content. Redo it if anything is wrong or cut off."
        ];
        if (o.type.mnemonic) {
            lines.push("- The mnemonic itself (acronym, sentence, rhyme, or story) is the only thing you may invent. Every term, name, date, and number it stands for must be exactly as in the content.");
        }
        if (o.type.replica) {
            lines.push("- Do not copy the reference's text, watermarks, logos, website names, or credit lines. Redraw everything from scratch; do not trace or paste the reference.");
        }
        return lines;
    }

    // o: { type, method, mode ("file"|"chat"), count, tag, topic, breadcrumb,
    //      content, langs:{en,hi}, extra, replicaText }
    function buildPrompt(o) {
        var type = o.type;
        var parts = [
            "You are creating study visuals for Notebook Alpha, an exam-preparation website.",
            "",
            "TOPIC: " + o.topic,
            "PATH: " + o.breadcrumb,
            "KIND OF VISUAL: " + type.label,
            type.replica
                ? "NUMBER OF IMAGES: " + o.count + " (one new image per attached reference image)"
                : "NUMBER OF IMAGES: " + o.count + " (fewer is fine if the content cannot support that many good ones; never make filler)",
            "",
            "TASK",
            briefFor(type, o).join("\n"),
            "",
            methodBlock(o).join("\n"),
            "",
            contentRules(o).join("\n"),
            "",
            "STYLE (make it attractive AND readable)",
            "- A friendly flat-illustration look with one consistent palette of at most 4 colours. Give each colour a meaning (for example green = definition, red = exam trap, blue = process) and use small icons where they help." +
                (isRefMode(o) ? " Where the reference has its own colours, you may keep its colour logic." : ""),
            "- The most important thing is the largest. At most 7 main elements per image" + (type.replica ? " (more only if the reference has more)." : "."),
            "- Readable on a phone: large elements, high contrast, light background.",
            "- No watermark, logo, QR code, or mention of any source. Beauty never comes before accuracy or readability.",
            "",
            languageBlock(o).join("\n"),
            "",
            deliveryBlock(o).join("\n"),
            ""
        ];
        if (o.extra) {
            parts.push(
                "EXTRA INSTRUCTIONS FROM ME (follow these for style and focus; they never override the CONTENT RULES above)",
                o.extra,
                ""
            );
        }
        parts.push("STUDY CONTENT", "", o.content);
        return parts.join("\n");
    }

    /* ---------- mount(): the panel inside the content box ---------- */
    function mount(host, ctx) {
        if (!host || !ctx) return;

        var savedType = typeById(lsGet(LS_TYPE, "infographic"));
        var savedMode = lsGet(LS_MODE, "file") === "chat" ? "chat" : "file";
        var savedEnOnly = lsGet(LS_EN, "1") !== "0";

        host.innerHTML =
            '<div class="prompt-block-row"><strong>🖼 Visual aids for this topic</strong></div>' +
            '<p class="prompt-block-desc">Pick what to make and how to draw it, then copy the prompt. This topic\'s text (only the sections ticked in "Choose sections" above) is already inside. Paste it into an AI that can make images, e.g. ChatGPT. Every choice here gives images.</p>' +
            '<label class="quiz-lbl">What to make</label>' +
            '<select class="va-type">' + TYPES.map(function (t) {
                return '<option value="' + esc(t.id) + '"' + (t.id === savedType.id ? " selected" : "") + ">" + esc(t.label) + "</option>";
            }).join("") + "</select>" +
            '<div class="va-mnemonicrow" hidden>' +
            '<label class="quiz-lbl">Style of mnemonic</label>' +
            '<select class="va-mnemonicstyle">' + Object.keys(MNEMONIC_STYLES).map(function (k) {
                return '<option value="' + k + '">' + esc(MNEMONIC_STYLES[k].label) + "</option>";
            }).join("") + "</select>" +
            '</div>' +
            '<div class="va-replicarow" hidden>' +
            '<label class="quiz-lbl">Text in the new image</label>' +
            '<select class="va-replicatext">' +
            '<option value="reference">Keep the reference image\'s text exactly (a clean copy)</option>' +
            '<option value="content">Take the text from my topic content (reference is only for layout and style)</option>' +
            '</select>' +
            '</div>' +
            '<label class="quiz-lbl">How to draw it</label>' +
            '<select class="va-method"></select>' +
            '<p class="prompt-block-desc va-methoddesc"></p>' +
            '<label class="quiz-lbl va-countlbl">How many</label>' +
            '<select class="va-count">' + [1, 2, 3].map(function (k) {
                return '<option value="' + k + '"' + (k === savedType.count ? " selected" : "") + ">" + k + "</option>";
            }).join("") + "</select>" +
            '<label class="quiz-lbl">What do you want?</label>' +
            '<label style="display:block;margin:2px 0;"><input type="radio" name="vamode" value="file"' + (savedMode === "file" ? " checked" : "") + '> <strong>Save to site</strong> (image files you add to this topic)</label>' +
            '<label style="display:block;margin:2px 0;"><input type="radio" name="vamode" value="chat"' + (savedMode === "chat" ? " checked" : "") + '> <strong>Quick view in chat</strong> (just look at it now, nothing saved)</label>' +
            '<div class="va-tagrow">' +
            '<label class="quiz-lbl">File tag <span class="field-optional">(optional, e.g. s2 for section 2. Keeps file names from clashing)</span></label>' +
            '<input type="text" class="va-tag" maxlength="12" placeholder="e.g. s2" autocomplete="off">' +
            '</div>' +
            '<label class="quiz-lbl">Extra instructions for this visual <span class="field-optional">(optional, not remembered)</span></label>' +
            '<textarea class="va-extra" rows="2" style="width:100%;box-sizing:border-box;" placeholder="e.g. Notebook hand-drawn style. Only 5 boxes. Make the 3 dates biggest."></textarea>' +
            '<div class="prompt-block-row">' +
            '<button type="button" class="content-action va-copy">🖼 Copy Visual Prompt</button>' +
            '<label class="flashcard-enonly"><input type="checkbox" class="va-enonly"' + (savedEnOnly ? " checked" : "") + '> English only (safer)</label>' +
            '</div>' +
            '<div class="quiz-add-preview va-status"></div>' +
            '<details class="content-link-guide"><summary>What to do after copying</summary><div class="va-steps"></div></details>';

        function $(sel) { return host.querySelector(sel); }
        var typeEl = $(".va-type"), methodEl = $(".va-method"), methodDescEl = $(".va-methoddesc");
        var countEl = $(".va-count"), countLbl = $(".va-countlbl"), tagEl = $(".va-tag"), tagRow = $(".va-tagrow");
        var extraEl = $(".va-extra"), replicaRow = $(".va-replicarow"), replicaEl = $(".va-replicatext");
        var mnemonicRow = $(".va-mnemonicrow"), mnemonicEl = $(".va-mnemonicstyle");
        var enOnlyEl = $(".va-enonly"), copyEl = $(".va-copy"), statusEl = $(".va-status"), stepsEl = $(".va-steps");

        function mode() {
            var r = host.querySelector('input[name="vamode"]:checked');
            return r && r.value === "chat" ? "chat" : "file";
        }
        function status(text, kind) {
            statusEl.textContent = text;
            statusEl.className = "quiz-add-preview va-status" + (kind ? " " + kind : "");
        }

        // Rebuilds the "How to draw it" list for the chosen kind.
        function fillMethods(keepCurrent) {
            var type = typeById(typeEl.value);
            var allowed = type.methods;
            var current = keepCurrent && allowed.indexOf(methodEl.value) >= 0 ? methodEl.value : allowed[0];
            methodEl.innerHTML = allowed.map(function (m) {
                return '<option value="' + m + '"' + (m === current ? " selected" : "") + ">" + esc(METHODS[m].label) + "</option>";
            }).join("");
        }

        function refresh() {
            var type = typeById(typeEl.value);
            var method = methodEl.value;
            var tag = slugTag(tagEl.value);
            var n = parseInt(countEl.value, 10) || 1;
            var m = mode();

            methodDescEl.textContent = methodDesc(method, type);
            replicaRow.hidden = !type.replica;
            mnemonicRow.hidden = !type.mnemonic;
            countLbl.textContent = type.replica ? "How many reference images you will attach" : "How many";
            tagRow.hidden = m === "chat";

            var attach = type.replica
                ? "<li><strong>Attach your reference image" + (n > 1 ? "s" : "") + " to the same message</strong> in ChatGPT, together with the prompt.</li>"
                : "";

            if (m === "chat") {
                status(type.replica
                    ? "Quick view: attach the reference image to the same message. Nothing is saved."
                    : "Quick view: the AI shows the result in the chat. Nothing to save.");
                stepsEl.innerHTML = "<ol>" + attach +
                    "<li>Paste the prompt into ChatGPT (image generation on).</li>" +
                    "<li>Read every word, date and number in the result" + (type.replica ? " and compare with your original" : "") + ". If anything is wrong, ask it to redo that one.</li>" +
                    "</ol>";
            } else {
                status("Files will be named: " + fileNames(type, tag, n).join(", ") + (type.replica ? ". Attach the reference image to the same message." : ""));
                stepsEl.innerHTML = "<ol>" + attach +
                    "<li>Paste the prompt into ChatGPT (image generation on) and download the image(s).</li>" +
                    "<li>Check every word, date and number in the image(s) (and the \"Text in image\" list, if it gives one). Redo any that are wrong.</li>" +
                    "<li>Put the image(s) in this topic's Drive folder next to <code>content.md</code>. Keep the exact file names.</li>" +
                    "<li>Open <code>content.md</code> and paste the \"Paste block\" the AI gave " + esc(type.place) + ". If it gave an English and a Hindi block, use the English one in the EN block and the Hindi one in the HI block.</li>" +
                    "<li>Save <code>content.md</code> back in the same Drive folder (only one .md file there), then reload the site.</li>" +
                    "</ol>";
            }
        }

        typeEl.addEventListener("change", function () {
            lsSet(LS_TYPE, typeEl.value);
            countEl.value = String(typeById(typeEl.value).count);
            fillMethods(false);
            refresh();
        });
        methodEl.addEventListener("change", refresh);
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
                method: methodEl.value,
                mode: mode(),
                count: parseInt(countEl.value, 10) || 1,
                tag: slugTag(tagEl.value),
                topic: ctx.topic || "",
                breadcrumb: ctx.breadcrumb || "",
                content: cb.text,
                langs: { en: cb.hasEn, hi: cb.hasHi },
                extra: extraEl.value.trim(),
                replicaText: replicaEl.value === "content" ? "content" : "reference",
                mnemonicStyle: mnemonicEl.value
            });
            var original = copyEl.innerHTML;
            copyText(prompt, function () {
                copyEl.innerHTML = "✓ Prompt Copied";
                copyEl.disabled = true;
                setTimeout(function () { copyEl.innerHTML = original; copyEl.disabled = false; }, 1800);
                var big = prompt.length > 30000 ? " Long paste (" + Math.round(prompt.length / 1000) + "k characters): untick some sections and copy again if your AI app cuts it." : "";
                var attachNote = type.replica ? " Now attach your reference image to the same message." : "";
                status("✓ Copied (" + (cb.bilingual ? "English + Hindi" : "single-language") + " content)." + attachNote + big, "ok");
            }, function () {
                status("Automatic copy was blocked by the browser. Try again, or allow clipboard access for this site.", "err");
            });
        });

        fillMethods(false);
        refresh();
    }

    window.VisualAids = {
        mount: mount,
        __test: { buildPrompt: buildPrompt, buildContentBlock: buildContentBlock, TYPES: TYPES, METHODS: METHODS, MNEMONIC_STYLES: MNEMONIC_STYLES,
                  fileNames: fileNames, slugTag: slugTag }
    };
})();