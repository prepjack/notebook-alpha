/* =========================================================
   MCQ BANK — PHASE 2 of 7: CLIENT-SIDE PARSER
   (spec: "Phase 2 of 7 — MCQ Bank: Client-Side Parser")

   Exposes a single global: window.parseMcqMarkdown(text)

   Pure and synchronous — no network calls, no DOM access, no
   dependency on any other file in this project. Takes the raw
   text of an author-written .md file (the tag grammar below) and
   returns:

     {
       collections: [ { title, description, exam, year, session, source } ],
       passages:    [ { passage_id, node_id, kind, content } ],
       mcqs:        [ { mcq_id, node_id, question_type, passage_id,
                         collection_id_ref, question_no, question,
                         option_a, option_b, option_c, option_d,
                         correct_option, explanation, difficulty,
                         language, tags, description, exam, year,
                         session, source, source_question_no,
                         warnings: [] } ]
     }

   Nothing here writes to Google Sheets — Phase 3 (a save_mcqs_bulk
   doPost action + ensureCollection_ find-or-create) is what takes
   this function's output and persists it. This file only turns
   text into structured objects.

   ---- Tag grammar this file parses -----------------------------

   Passage block:
     @passage: p001
     @topic: t20
     @passage_kind: text          (optional, default "text")
     @passage_text:
     [... verbatim lines, including blank lines, until @end_passage ...]
     @end_passage

   Question block:
     @collection: <title>         (optional — carries forward, see below)
     @question_no: <number>       (optional — auto-assigned if absent)
     @type: simple | assertion_reason
     @topic: <node_id>
     @passage: <passage_id>       (optional — must reference an earlier @passage:)
     @question: <text>            (required unless @type: assertion_reason)
     @assertion: <text>           (required only for assertion_reason)
     @reason: <text>              (required only for assertion_reason)
     @options:
     A) <text>
     B) <text>
     C) <text>
     D) <text>
     @correct: A|B|C|D            (required)
     @explanation / @difficulty / @language / @tags / @description /
     @exam / @year / @session / @source / @source_question_no  (all optional)
     @end

   A block's TYPE is decided purely by which terminator line ends
   it — @end_passage vs @end — never by which tags are present, so
   a malformed/reordered block still gets classified consistently.
   ========================================================= */

(function () {
    "use strict";

    /* ---------------------------------------------------------
       Block splitting — line-based, not full YAML (rule 1).

       Each line starting with "@tagname:" opens/overwrites that
       field; any following line with no "@tag:" prefix is appended
       (with a newline) to the CURRENTLY OPEN field, which is what
       lets @question_text: / @question: / @explanation: etc. hold
       multi-line Markdown. A stray line before any tag has opened
       in the current block is ignored silently (rule 10).

       Block type is determined solely by its terminator line:
       "@end_passage" -> passage block, "@end" -> question block.
       An unterminated trailing block (file ends without @end /
       @end_passage) is dropped rather than guessed at or thrown.
       --------------------------------------------------------- */
    function splitIntoBlocks_(text) {
        const lines = String(text || "").split(/\r\n|\r|\n/);
        const blocks = [];

        let fields = {};
        let currentTag = null;
        let hasAnyField = false;

        function resetBuffer() {
            fields = {};
            currentTag = null;
            hasAnyField = false;
        }

        lines.forEach(function (line) {
            const trimmed = line.trim();

            if (trimmed === "@end_passage") {
                if (hasAnyField) blocks.push({ type: "passage", fields: fields });
                resetBuffer();
                return;
            }

            if (trimmed === "@end") {
                if (hasAnyField) blocks.push({ type: "question", fields: fields });
                resetBuffer();
                return;
            }

            const tagMatch = trimmed.match(/^@([a-zA-Z_]+):\s?(.*)$/);

            if (tagMatch) {
                currentTag = tagMatch[1].toLowerCase();
                fields[currentTag] = tagMatch[2];
                hasAnyField = true;
            } else if (currentTag !== null) {
                fields[currentTag] = fields[currentTag] + "\n" + line;
            }
            // else: stray line before any tag has opened — ignored (rule 10)
        });

        return blocks;
    }

    /* A tag's inline value starts empty ("") when all its content is
       on the following lines (e.g. "@passage_text:" with nothing
       after the colon); the continuation-append step above then
       prefixes that with "\n". Strip that single leading artifact
       newline before using the field, then trim the outer edges —
       internal blank lines (mid-passage, mid-question) are
       untouched either way, since trim() only touches the ends. */
    function getField_(fields, tag) {
        const raw = fields[tag];
        if (raw === undefined) return "";
        const stripped = raw.charAt(0) === "\n" ? raw.slice(1) : raw;
        return stripped.trim();
    }

    function hasTag_(fields, tag) {
        return Object.prototype.hasOwnProperty.call(fields, tag);
    }

    // lowercase, non-alphanumeric -> "-", trimmed of leading/trailing "-"
    function slug_(str) {
        return String(str || "")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "");
    }

    // Standard 32-bit FNV-1a, hex-encoded. Synchronous on purpose —
    // crypto.subtle is async and unnecessary for a short local id.
    function shortHash_(str) {
        let hash = 0x811c9dc5;
        const s = String(str || "");
        for (let i = 0; i < s.length; i++) {
            hash ^= s.charCodeAt(i);
            hash = Math.imul(hash, 0x01000193);
        }
        return (hash >>> 0).toString(16).padStart(8, "0");
    }

    // Parses "A) text" / "B) text" / "C) text" / "D) text" lines out
    // of a raw options block. Letters not present are simply absent
    // from the returned map (caller treats them as "").
    function parseOptionLines_(rawOptionsText) {
        const result = {};
        String(rawOptionsText || "")
            .split("\n")
            .forEach(function (line) {
                const m = line.trim().match(/^([A-Da-d])\)\s*(.*)$/);
                if (m) result[m[1].toUpperCase()] = m[2];
            });
        return result;
    }

    const AR_DEFAULT_OPTIONS_ = {
        A: "Both A and R are true, and R is the correct explanation of A",
        B: "Both A and R are true, but R is NOT the correct explanation of A",
        C: "A is true, but R is false",
        D: "A is false, but R is true"
    };

    const CORRECT_LETTER_TO_INDEX_ = { A: 0, B: 1, C: 2, D: 3 };

    // Explicit @question_no values are kept as numbers when they
    // parse cleanly (matches how the rest of the app treats numeric
    // sheet columns); anything non-numeric is kept as the raw string
    // rather than silently discarded.
    function coerceQuestionNo_(raw) {
        if (raw === "") return raw;
        const n = Number(raw);
        return isNaN(n) ? raw : n;
    }

    /* ---------------------------------------------------------
       Passage block -> passage object.
       Duplicate @passage: ids: first one wins (rule 8). There is
       no warnings slot on a passage object in the output shape, so
       the duplicate is logged to the console for visibility and
       simply not added — any question block referencing that id
       still resolves correctly against the first (kept) passage.
       --------------------------------------------------------- */
    function buildPassage_(fields, passageIds, passages) {
        const passageId = getField_(fields, "passage");
        const nodeId = getField_(fields, "topic");
        const kind = getField_(fields, "passage_kind") || "text";
        const content = getField_(fields, "passage_text");

        if (passageId && passageIds.has(passageId)) {
            console.warn(
                "mcq-parse: duplicate passage id '" + passageId + "' — first one wins"
            );
            return;
        }

        if (passageId) passageIds.add(passageId);

        passages.push({
            passage_id: passageId,
            node_id: nodeId,
            kind: kind,
            content: content
        });
    }

    /* ---------------------------------------------------------
       Question block -> mcq row (+ collection carry-forward state).
       --------------------------------------------------------- */
    function buildMcq_(fields, state, passageIds) {
        const warnings = [];

        // @collection: carry-forward (rule 3). An explicit empty
        // @collection: clears it back to "no collection"; a block
        // with no @collection: tag at all inherits the running value.
        if (hasTag_(fields, "collection")) {
            const rawCollection = getField_(fields, "collection");
            state.currentCollectionRef = rawCollection || null;
        }
        const collectionRef = state.currentCollectionRef;

        const type = getField_(fields, "type") || "simple";
        const isAssertionReason = type.toLowerCase() === "assertion_reason";

        const topic = getField_(fields, "topic");
        if (!topic) {
            warnings.push("no @topic — this question will not be linked to any tree node");
        }

        // question text (rule 5: assertion_reason builds a combined string)
        let questionText;
        if (isAssertionReason) {
            const assertion = getField_(fields, "assertion");
            const reason = getField_(fields, "reason");
            if (!assertion) warnings.push("missing @assertion");
            if (!reason) warnings.push("missing @reason");
            questionText = "**Assertion (A):** " + assertion + "\n\n**Reason (R):** " + reason;
        } else {
            questionText = getField_(fields, "question");
            if (!questionText) warnings.push("missing @question");
        }

        // options (explicit, or assertion_reason default, rule 5)
        let optionA = "", optionB = "", optionC = "", optionD = "";
        if (hasTag_(fields, "options")) {
            const parsed = parseOptionLines_(fields.options ? getField_(fields, "options") : "");
            optionA = parsed.A || "";
            optionB = parsed.B || "";
            optionC = parsed.C || "";
            optionD = parsed.D || "";
        } else if (isAssertionReason) {
            optionA = AR_DEFAULT_OPTIONS_.A;
            optionB = AR_DEFAULT_OPTIONS_.B;
            optionC = AR_DEFAULT_OPTIONS_.C;
            optionD = AR_DEFAULT_OPTIONS_.D;
        }
        if (!optionA && !optionB && !optionC && !optionD) {
            warnings.push("missing @options");
        }

        // correct option — stored zero-based (0=A,1=B,2=C,3=D), matching
        // the convention already used elsewhere in this project (see
        // google-sheet-template/README.txt and Code.gs saveMcq()).
        const correctLetter = getField_(fields, "correct").toUpperCase();
        let correctOption = "";
        if (Object.prototype.hasOwnProperty.call(CORRECT_LETTER_TO_INDEX_, correctLetter)) {
            correctOption = CORRECT_LETTER_TO_INDEX_[correctLetter];
        } else {
            warnings.push("missing @correct");
        }

        // passage reference (rule 7 — must have been seen earlier in the file)
        const passageRef = getField_(fields, "passage");
        if (passageRef && !passageIds.has(passageRef)) {
            warnings.push("references unknown passage '" + passageRef + "'");
        }

        // question_no (rule 4 — pure file-position count per collection group,
        // independent of any explicit numbers already used in that group)
        const counterKey = collectionRef || "";
        let questionNo;
        if (hasTag_(fields, "question_no") && getField_(fields, "question_no") !== "") {
            questionNo = coerceQuestionNo_(getField_(fields, "question_no"));
        } else {
            questionNo = (state.questionNoCounters.get(counterKey) || 0) + 1;
            warnings.push("question_no auto-assigned from file position");
        }
        state.questionNoCounters.set(counterKey, (state.questionNoCounters.get(counterKey) || 0) + 1);

        // mcq_id (rule 6 — deterministic, never Date.now()/Math.random())
        const mcqId = collectionRef
            ? "mcq_" + slug_(collectionRef) + "_q" + questionNo
            : "mcq_" + shortHash_(questionText);

        const exam = getField_(fields, "exam");
        const year = getField_(fields, "year");
        const session = getField_(fields, "session");
        const source = getField_(fields, "source");

        // collections dedup (rule 9 — exact title match; first non-empty
        // exam/year/session/source seen for that title wins; description
        // has no source tag in this grammar, so it stays "" here — a
        // later phase can add a @collection_description tag for it)
        if (collectionRef) {
            if (!state.collectionsMap.has(collectionRef)) {
                state.collectionsMap.set(collectionRef, {
                    title: collectionRef,
                    description: "",
                    exam: exam,
                    year: year,
                    session: session,
                    source: source
                });
            } else {
                const existing = state.collectionsMap.get(collectionRef);
                if (!existing.exam && exam) existing.exam = exam;
                if (!existing.year && year) existing.year = year;
                if (!existing.session && session) existing.session = session;
                if (!existing.source && source) existing.source = source;
            }
        }

        return {
            mcq_id: mcqId,
            node_id: topic,
            question_type: type,
            passage_id: passageRef,
            collection_id_ref: collectionRef || "",
            question_no: questionNo,
            question: questionText,
            option_a: optionA,
            option_b: optionB,
            option_c: optionC,
            option_d: optionD,
            correct_option: correctOption,
            explanation: getField_(fields, "explanation"),
            difficulty: getField_(fields, "difficulty"),
            language: getField_(fields, "language") || "en",
            tags: getField_(fields, "tags"),
            description: getField_(fields, "description"),
            exam: exam,
            year: year,
            session: session,
            source: source,
            source_question_no: getField_(fields, "source_question_no"),
            warnings: warnings
        };
    }

    /* ---------------------------------------------------------
       Public entry point.
       --------------------------------------------------------- */
    function parseMcqMarkdown(text) {
        const blocks = splitIntoBlocks_(text);

        const passages = [];
        const passageIds = new Set();

        const state = {
            currentCollectionRef: null,
            questionNoCounters: new Map(), // counterKey -> count
            collectionsMap: new Map()      // title -> collection object
        };

        const mcqs = [];

        blocks.forEach(function (block) {
            if (block.type === "passage") {
                buildPassage_(block.fields, passageIds, passages);
            } else {
                mcqs.push(buildMcq_(block.fields, state, passageIds));
            }
        });

        return {
            collections: Array.from(state.collectionsMap.values()),
            passages: passages,
            mcqs: mcqs
        };
    }

    window.parseMcqMarkdown = parseMcqMarkdown;
})();
