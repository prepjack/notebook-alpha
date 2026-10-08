/* =========================================================
   CONTENT GENERATION PROMPT — MODULAR BUILDER
   One function per prompt section. Each section looks at the
   ticked versions (EN / HI / AI) and the style (detailed / notes)
   and writes its own text. No regex surgery on a master prompt.

   To change a rule: find its section function below and edit it
   in that one place. Nothing else needs to stay in sync.

   Public API:  window.NotebookPrompt.build(langs, style)
                -> prompt string, with the two placeholders
                   <PUT HIERARCHY PATH HERE> and <PUT TOPIC NAME HERE>
                   still in it (app.js fills them in).
   Console:     NotebookPrompt.preview(["EN","HI"], "notes")
   ========================================================= */
(function (global) {
    "use strict";

    const ORDER = ["EN", "HI", "AI"];
    const BT = "```";                       // so fences never need escaping
    const BAR = "=".repeat(52);

    const banner = title => BAR + "\n" + title + "\n" + BAR;
    const list = (arr, word) => {
        if (arr.length <= 1) return arr.join("");
        if (arr.length === 2) return arr[0] + " " + word + " " + arr[1];
        return arr.slice(0, -1).join(", ") + ", " + word + " " + arr[arr.length - 1];
    };

    function normalize(langs) {
        const want = new Set((Array.isArray(langs) ? langs : []).map(l => String(l).toUpperCase()));
        const L = ORDER.filter(l => want.has(l));
        return L.length ? L : ORDER.slice();
    }

    /* Everything a section might need to know, computed once. */
    function ctx(langs, style) {
        const L = normalize(langs);
        const src = L.filter(l => l !== "AI");
        return {
            L, n: L.length,
            src,                              // source-faithful versions present
            srcSlash: src.join("/"),
            hasAI: L.includes("AI"),
            hasHI: L.includes("HI"),
            needsDevanagari: L.includes("HI") || L.includes("AI"),
            notes: style === "notes",
            first: src[0] || null             // numbering anchor
        };
    }

    /* ---------- 1. HEADER ---------- */
    function header() {
        return `You are helping me create a complete, self-contained study-content ZIP package for Notebook Alpha, an exam-preparation website.

ENVIRONMENT: this needs an AI environment with real file creation and ZIP packaging (code execution / computer use, e.g. Claude or ChatGPT with code execution). Create content.md and every referenced asset as real files in one folder, then package that folder as a ZIP.

SOURCE MATERIAL: I will attach or paste a PDF (or other source) in this chat. Treat it as authoritative (see SOURCE FIDELITY).

TOPIC CONTEXT:
Full hierarchy path:
<PUT HIERARCHY PATH HERE>

Topic:
<PUT TOPIC NAME HERE>`;
    }

    /* ---------- 2. PACKAGE (the one place the asset rule lives) ---------- */
    function pkg() {
        return banner("CONTENT PACKAGE — CRITICAL") + `
Build one folder, then ZIP it:

Topic Folder/
├── content.md
├── image-1.png      (only if genuinely useful, actually generated)
└── other genuinely required assets

- The Markdown file may have any name ending in .md.
- Every asset referenced in the Markdown must be a real file in the same folder, and every generated asset must be referenced. No placeholders, no made-up filenames, no external or Google Drive URLs.
- Use relative plain filenames only, lowercase-hyphenated, e.g. ![Information Lifecycle](information-lifecycle.png)
- Deliver the folder as a single ZIP file.`;
    }

    /* ---------- 3. MARKDOWN FEATURES ---------- */
    function markdown(c) {
        return banner("MARKDOWN + VISUAL SUPPORT") + `
Rendered with marked.js (GitHub-flavored Markdown). Use:
- ## / ### headings, **bold**, *italic*, bullet and numbered lists
- standard Markdown tables
- > blockquotes for important exam callouts
- Mermaid diagrams, chart blocks, Markdown images (rules below)
- Math in LaTeX: inline between single dollar signs, e.g. $x^2 + y_1$ or $\\frac{a}{b}$; a separate equation line between double dollar signs, e.g. $$a^2 + b^2 = c^2$$. Never use the dollar sign for money (write Rs. or the rupee symbol), do not use \\( \\) or \\[ \\] delimiters, and use only standard LaTeX that KaTeX supports (no \\ce{...}, no custom \\newcommand macros, no images of equations).
- {{Term}} marking for index candidates (see INDEX TERMS)

Do not use HTML. Do not use Lottie or any animation syntax. To teach a process or sequence use a static visual: a labelled diagram, a Mermaid flowchart, or a step-by-step table.

MERMAID — STRICT RULES (a single syntax error shows a broken "bomb" graphic on the site):
- Allowed types: timeline, flowchart, mindmap. Keep every diagram small and simple; if it cannot be kept simple, use a table instead.
- Never write a semicolon ";" anywhere inside a diagram. Avoid "#" and other special characters in labels. Use "," or "—" instead.
- Flowchart: put EVERY node label in double quotes, including Devanagari, e.g. A["Congress (1923)"] --> B["Swaraj Party"]. Label an arrow like A -->|label| B.
- Timeline: write each year or period ONCE, with all its events under it as separate ": event" lines in date order, e.g.
    1923 : 1 Jan — first event
         : 13 Apr — second event
  Never repeat the same year on a new line. Use ":" only as that separator, never inside an event text.
- Each diagram is its own fenced block (${BT}mermaid ... ${BT}); leave a blank line between blocks and put nothing else on the closing fence line.${c.n > 1 ? "\n- The same diagram in " + list(c.L, "and") + " must have identical structure and the same number of events; only the text is translated." : ""}

CHART: use ${BT}chart blocks only when a numerical comparison helps, e.g.
${BT}chart
{"type":"bar","labels":["Primary","Secondary"],"data":[40,35]}
${BT}`;
    }

    /* ---------- 4. INDEX TERMS ---------- */
    function indexTerms(c) {
        return banner("INDEX TERMS") + `
Wrap genuinely index-worthy terms (key terminologies, concepts, definitions a student would want in a glossary for this topic) in double curly braces, e.g. {{Mental Processes}}.
- Wrap a term only at its FIRST occurrence in each language block; the count resets at every LANG block. Later mentions stay plain text.
- Do not wrap general emphasis. Typically a handful per block, not every noun phrase.${c.n > 1 ? "\n- Wrap the same set of terms in " + list(c.L, "and") + " so suggestions stay consistent across versions." : ""}
- {{}} only shows a dotted-underline suggestion on the site. It does not index anything by itself; a human still marks the term. So treat it purely as flagging for review.`;
    }

    /* ---------- 5. VISUALS + IMAGE TEXT ---------- */
    function visuals(c) {
        const whenToMake = c.notes
            ? `VISUALS — FEWER, ONLY WHEN THEY BEAT BULLETS:
Prefer Markdown tables, arrow chains, and Mermaid diagrams (the website renders them with its own fonts). Create a PNG only when a real diagram, map, labelled figure, or timeline would teach faster than a table or Mermaid can, typically 0 to 3 per topic.`
            : `VISUALS — GENEROUS BUT PURPOSEFUL:
Use more visual support than a minimal notes file would, but every visual must earn its place. Types: labelled diagrams, process diagrams, concept maps, comparison visuals, timelines, classification and cause-and-effect diagrams, scenario illustrations, memory-oriented visualizations.`;

        const askFirst = `Before creating any visual ask: "Will this help the learner understand, remember, distinguish, connect, or recall the concept?" If not, skip it. Prefer one large, clear visual over several cluttered ones.`;

        const text = c.needsDevanagari
            ? `${banner("IMAGE TEXT RENDERING — NO BOXES — CRITICAL")}
Every PNG is code-rendered, and Hindi turns into empty boxes or broken vowel signs unless you do ALL of this:
1. Find a real Devanagari font (Noto Sans Devanagari / Mukta / Hind / Lohit; check fc-list :lang=hi, install fonts-noto-core if missing) and confirm with fontTools that अ क ् ा ि ं are in its cmap. Never use the default font or a web-font URL.
2. Render with HTML+CSS (@font-face to the local font file) screenshotted via headless Chromium, or Pillow with Layout.RAQM (check features.check("raqm")). Never use matplotlib text or Pillow basic layout for Hindi.
3. Every label inside an image is bilingual: "English / हिन्दी". Dates and numbers stay in Roman digits. Keep image text short.
4. After saving, open each PNG and look for boxes, detached matras, overlap, clipping. Fix and re-render until clean.
5. If no working font or shaping is possible, never ship boxes: use English-only labels (note it in the manifest) or a Mermaid diagram / Markdown table instead.`
            : `${banner("IMAGE TEXT")}
All image labels are in English only. Use a clean, readable font. After saving, open each PNG and check for overlap and clipping; fix and re-render until clean.`;

        return banner("VISUALS") + "\n" + whenToMake + "\n" + askFirst + "\n\n" + text;
    }

    /* ---------- 6. SCOPE / NOTES STYLE ---------- */
    function scope(c) {
        if (!c.notes) {
            return banner("SCOPE AND EDUCATIONAL QUALITY") + `
Using the hierarchy above, calibrate depth and scope to this exact topic. Stay within this topic's boundaries and avoid repeating content that belongs primarily to sibling or parent topics.

Create clear, serious, exam-oriented notes. Where relevant include: definitions, core concepts, explanations and relationships, classifications/components/processes, examples, comparisons and tables, important facts and exam-oriented points, memory aids where genuinely useful, quick revision points and a concise summary.

No generic filler, motivational language, decorative sections, or unnecessary repetition.`;
        }
        const applyTo = c.src.length
            ? "the " + list(c.src, "and") + " block" + (c.src.length > 1 ? "s" : "") +
              (c.hasAI ? " (the AI block keeps its teaching style, see AI LEARNING VERSION below)" : "")
            : "the AI block (keep its teaching techniques, but write them as compact points, not paragraphs)";
        return banner("SCOPE AND NOTES STYLE — CRITICAL") + `
Using the hierarchy above, calibrate depth and scope to this exact topic. Stay within this topic's boundaries and avoid repeating content that belongs primarily to sibling or parent topics.

Write ${applyTo} as compact pointwise exam notes, the way a top-scoring student condenses a PDF for revision:
- Short bullets, one idea per line. No long paragraphs; at most a one-line lead-in under a heading.
- Bold every key term, name, date, number, and keyword an examiner could ask.
- Definitions in one line: **Term**: meaning.
- Put comparisons, classifications, types, features, merits/demerits, and timelines in tables or arrow chains (A → B → C); use Mermaid for processes and hierarchies.
- Keep the source's sequence, numbering, and terminology.
- Add short memory aids and one-line "Exam Trap" or "Common Confusion" callouts (as > blockquotes) only where accurate and useful.
- End each ## section with 2-4 "Quick Revision" bullets of its must-remember points.
- Compress wording, never content: every exam-relevant fact, term, name, number, date, classification, and example in the source must still appear.
- No filler, motivational language, decorative sections, or repetition.`;
    }

    /* ---------- 7. LANGUAGE ARCHITECTURE ---------- */
    function languages(c) {
        const { L, n, src } = c;
        const partial = n < 3;
        const markerText = {
            EN: "...English (source-faithful)...",
            HI: "...Hindi (source-faithful)...",
            AI: "...AI Learning Version, see AI LEARNING VERSION below..."
        };

        const parts = [];

        let intro = "The website has ONE control: Version: EN / HI / AI" +
            (c.hasAI ? " (AI = the AI Learning Version)" : "") + ".";
        if (partial) {
            intro += "\nFor THIS topic generate ONLY the " + list(L, "and") + " version" + (n > 1 ? "s" : "") +
                ". The site greys out any version missing from the file, so do NOT create empty or placeholder blocks for the others.";
        }
        parts.push(intro);

        parts.push("Generate exactly ONE block per selected version in ONE .md file (" + n + " block" + (n > 1 ? "s" : "") +
            " total), in this exact order:\n\n" +
            L.map(l => "<!-- ===LANG:" + l + "=== -->\n" + markerText[l]).join("\n\n"));

        parts.push([
            "MARKER RULES:",
            "- Copy every marker exactly, alone on its own line, with no extra spaces, punctuation, headings, or fences.",
            "- Include every listed block" + (n > 1 ? ", in the order " + L.join(" → ") + "." : "."),
            ...(partial ? ["- Add no marker or block for any version not listed above."] : []),
            "- Do not create separate files for versions."
        ].join("\n"));

        parts.push([
            n > 1 ? "SECTION NUMBERING FOR TOGGLE SYNC — CRITICAL:" : "SECTION NUMBERING — CRITICAL:",
            "- Every ## heading " + (n > 1 ? "in " + L[0] + " " : "") + "starts with a strictly increasing major number: \"1. Title\", \"2. Title\", \"3. Title\".",
            ...(n > 1 ? ["- " + list(L.slice(1), "and") + " reuse the exact same numbers, in the same order, for the corresponding concepts. This is what lets the site's toggle jump between " + L.join("/") + " without losing the reader's place."] : []),
            "- If concepts are merged keep the smaller number. Never reuse a number for a different concept.",
            "- ### headings may use decimals such as 2.1, 2.2."
        ].join("\n"));

        if (src.length) {
            const lines = [
                "CONTENT RULES (" + list(src, "and") + ", source-faithful):",
                "- The most complete and authoritative version(s).",
                "- Preserve source structure, sequence, terminology, definitions, examples, classifications, relationships, and exam-relevant detail.",
                c.notes ? "- Write as compact pointwise exam notes (see SCOPE AND NOTES STYLE), not paragraphs."
                        : "- Explain concepts clearly rather than listing keywords.",
                "- Add clarification, analogies, or \"why it matters\" notes only when genuinely helpful and not factually invented.",
                src.length > 1 ? "- EN and HI must stay factually consistent with each other and the source."
                               : "- " + src[0] + " must stay factually consistent with the source."
            ];
            parts.push(lines.join("\n"));
        } else {
            parts.push([
                "CONTENT RULES (AI Learning Version is the ONLY version here, so it must carry the full source content):",
                "- Preserve source structure, sequence, terminology, definitions, examples, classifications, and exam-relevant detail.",
                "- Never shorten or drop source content for brevity; teach all of it in the AI Learning Version style."
            ].join("\n"));
        }

        parts.push(banner("LANGUAGE INSTRUCTIONS"));
        if (L.includes("EN")) parts.push("EN: write natural, clear English suitable for exam preparation. Preserve important technical and standard terminology.");
        if (L.includes("HI")) parts.push("HI: write fully in Hindi using Devanagari script. For important or difficult technical terms include the English term alongside the Hindi equivalent where useful, e.g. \"सूचना संगठन (Information Organization)\". Prefer terminology established in the source. Do not write Roman-script Hindi.");
        if (c.hasAI) parts.push("AI (teaching register): write natural spoken Hinglish: Devanagari for Hindi grammar, connectors and sentence structure, with subject-specific technical English terms kept in Roman script. Do not write everything in Roman-script Hindi and do not mechanically translate technical terms. Example style:\n\"Mental Processes का मतलब है कि हमारा दिमाग कैसे काम करता है — जैसे Thinking, Learning और Remembering जैसी चीज़ें इसमें आती हैं।\"\nThis register makes the voice conversational. It is not there to duplicate the " + (src.length ? c.srcSlash + " content" : "source content") + " in another language.");
        if (n > 1) parts.push("Keep the SAME concept identity, heading order, and numbering across " + list(L, "and") + ". Only language and style" + (c.hasAI ? " (and, for AI, the teaching approach)" : "") + " change.");

        return banner("LANGUAGE ARCHITECTURE — CRITICAL") + "\n" + parts.join("\n\n");
    }

    /* ---------- 8. AI LEARNING VERSION ---------- */
    function aiVersion(c) {
        if (!c.hasAI) return "";
        const anchor = c.first
            ? "The identity, order, and numbering of major headings must match the " + c.first + (c.src.length > 1 ? "/" + c.src[1] : "") + " source-faithful version" + (c.src.length > 1 ? "s" : "") + " exactly. A reader must always be able to tell which AI section corresponds to which " + c.srcSlash + " section."
            : "Follow the source's own structure, numbered 1., 2., 3. in the source's order. A reader must always be able to tell which AI section corresponds to which part of the source.";
        const richest = c.first
            ? "Cover every heading from " + c.first + " with full teaching depth."
            : "Cover every heading and every important point of the source with full teaching depth.";

        return banner("AI LEARNING VERSION (LANG:AI)") + `
The AI Learning Version is not a paraphrase or a shortened copy. Its job is to TEACH the material the way a good teacher would explain it out loud. It is the richest pass: analogies, real-life examples, mnemonics where useful, connections between concepts, active-recall prompts. ${richest}

HEADINGS ARE ANCHORS: ${anchor} Inside each heading you have broad creative freedom in how you teach.

Use whichever of these genuinely helps that concept (never all of them every time; you may invent others):
- Simple Explanation: plain-language meaning and why it happens
- Real-Life Connections: everyday situations the learner recognizes
- Multiple Examples: genuinely different examples, never to pad length
- Mini Scenario / Story: the concept playing out in a short situation
- Connection to Existing Knowledge: link to something the learner already knows
- Analogy: make an abstract idea concrete
- Memory Hook / Mnemonic: only when accurate and natural; never distort a concept to fit one
- Visual Explanation: a diagram, timeline, or comparison when a picture teaches faster (see VISUALS)
- Common Confusion: what students mix it up with, and how to tell apart
- Exam Trap: a distinction or wording that commonly costs marks
- Explain It Yourself: an active-recall prompt ("explain in your own words", "how would you distinguish X from Y", "what would happen if...")

Choose like a skilled teacher, not a template: one concept may need explanation + example + diagram, another analogy + confusion + mnemonic, another almost nothing.

Style: natural, conversational, like an excellent teacher beside the learner, while academically accurate. Prefer simpler wording when it communicates equally well, without becoming childish or imprecise.

Web research is allowed only to improve explanations, examples, analogies, or mnemonics in this version. Never use it to alter source content, add unsupported facts, or treat questionable content as fact. Be creative in HOW you teach, accurate in WHAT you claim.`;
    }

    /* ---------- 9. SOURCE FIDELITY ---------- */
    function fidelity(c) {
        const applies = c.src.length
            ? list(c.src, "and") + " block" + (c.src.length > 1 ? "s" : "")
            : "the AI block (it is the only version)";
        return banner("SOURCE FIDELITY (applies to " + applies + ")") + `
- The uploaded source is authoritative. Do not invent facts, dates, classifications, quotations, references, or claims.
- Preserve important terminology, names, numbers, headings, and ordering. Do not silently swap source terminology for general-knowledge terms.
- If a figure, table, or diagram holds important information, represent it faithfully in Markdown, Mermaid, a chart, or a clearly specified asset.
- Any explanatory analogy must be clearly educational and not presented as a source fact.
- Voice: write as the author of these notes, stating every fact directly and confidently, in any language. A reader should never be able to tell a source document existed, so no sentence mentions where the information came from.`;
    }

    /* ---------- 10. FINAL OUTPUT + CHECKLIST ---------- */
    function finish(c) {
        const { L, n } = c;
        const checks = [
            (n === 1 ? "the LANG block exists" : "all " + n + " LANG blocks exist") + " (" + L.join(", ") + ")" + (n > 1 ? ", with exact marker order " + L.join(" → ") : ""),
            ...(n > 1 ? ["section numbering is synchronized concept-for-concept across " + list(L, "and")] : []),
            "every asset filename in the Markdown matches a real file in the ZIP, and vice versa; no unnecessary external URLs",
            "every Mermaid block follows the MERMAID rules (no \";\", quoted flowchart labels, each timeline year written once)",
            "chart JSON is valid",
            "{{}} is used only for genuine glossary-worthy terms, once per language block" + (n > 1 ? ", consistently across " + L.join("/") : ""),
            (c.src.length ? c.srcSlash + " content" : "the content") + " states facts directly, with no mention of a source or material anywhere",
            ...(c.hasAI ? ["the AI Learning Version teaches rather than paraphrases, uses real-life examples purposefully, and " +
                (c.first ? "keeps its headings and numbering mapped to " + c.srcSlash : "keeps its headings in the source's order without dropping any source content")] : []),
            "every PNG was opened and checked: " + (c.needsDevanagari ? "no empty boxes or broken Devanagari, bilingual (English / हिन्दी) labels" : "no overlap or clipping")
        ];

        return banner("FINAL OUTPUT") + `
- Create the actual content.md and every asset in one topic folder, then package it as one ZIP.
- Do not wrap the Markdown inside content.md in a ${BT}markdown fence. Keep the marker lines exactly intact.
- After packaging, output a short plain list titled exactly:

Package Manifest:

listing every file actually in the ZIP (content.md plus each asset). It confirms what exists; it is not an instruction list.

Before finishing, verify:
` + checks.map(x => "- " + x).join("\n") + `

Create the complete Notebook Alpha study-content ZIP package for the topic and source material provided.`;
    }

    /* ---------- ASSEMBLY ---------- */
    function build(langs, style) {
        const c = ctx(langs, style);
        return [
            header(),
            pkg(),
            markdown(c),
            indexTerms(c),
            visuals(c),
            scope(c),
            languages(c),
            aiVersion(c),
            fidelity(c),
            finish(c)
        ].filter(Boolean).join("\n\n");
    }

    function preview(langs, style) {
        const p = build(langs, style);
        console.log(p);
        console.log("— length:", p.length, "chars");
        return p;
    }

    const api = { build, preview };
    global.NotebookPrompt = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
