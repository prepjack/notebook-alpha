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
                         option_e, option_f,   (5th/6th: only if the question has them)
                         origin, derived_from, (only when @origin / @derived_from is given)
                         correct_option, explanation, difficulty,
                         language, tags, description, exam, year,
                         session, source, source_question_no,
                         question_group_id, warnings: [] } ]
     }

   ---- Language-linking (question_group_id) -----------------------

   @group: <id>          (optional tag on a question block, see below)

   Two or more question blocks that resolve to the SAME group key are
   treated as language/translation variants of ONE question — the
   practice UI shows them as a single slot with a language-toggle,
   instead of as separate questions. A group key resolves like this:

     - explicit @group: <id>  -> group key is that id (slugged). This
       is what the "MULTI-LANGUAGE" AI prompt in mcq.js now asks for:
       question N of the English block and question N of the Hindi
       block both get the SAME @group value, so they pair up even
       though each language block uses its own @collection.
     - no @group, but same @collection + same @question_no across
       blocks -> those blocks share a group key too (covers a file
       that reuses one @collection for multiple languages instead)
     - neither @group nor a shared collection+question_no -> no
       grouping; behaves exactly as before

   A group key shared by only ONE block is not a real pairing, so
   mcq_id stays exactly the legacy format in that case (existing saved
   data is unaffected). Only once a group key is shared by 2+ blocks
   does mcq_id get a "_<language>" suffix to stay unique, and
   question_group_id gets set to the shared key so the client can pair
   them back up. See the post-pass at the bottom of parseMcqMarkdown().

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
     @origin: pyq | book | ai | old
                                  (optional — carries forward like @collection:
                                    set it once and every following question
                                    inherits it; an empty "@origin:" clears it.
                                    pyq  = copied from a real exam paper
                                    book = from a book / coaching material
                                    ai   = written by an AI
                                    old  = existing, not checked yet)
     @derived_from: <mcq_id>      (optional — for origin ai: the real question
                                    this AI question was based on)
     @question_no: <number>       (optional — auto-assigned if absent)
     @group: <id>                 (optional — links this question to its
                                    translation/variant in another language,
                                    see "Language-linking" above)
     @type: simple | assertion_reason
     @topic: <node_id>
     @passage: <passage_id>       (optional — must reference an earlier @passage:)
     @question: <text>            (required unless @type: assertion_reason)
     @assertion: <text>           (required only for assertion_reason)
     @reason: <text>              (required only for assertion_reason)
     @options:
     1) <text>                    (legacy A) B) C) D) also accepted)
     2) <text>
     3) <text>
     4) <text>
     5) <text>                    (optional — only if the question has a 5th option)
     6) <text>                    (optional — only if the question has a 6th option)
     @correct: 1|2|3|4|5|6        (required; legacy A-F also accepted)
     @explanation: <concept + why the correct option is right>
     @why_1 .. @why_6: <why THAT option is right / wrong>   (optional)
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

            const tagMatch = trimmed.match(/^@([a-zA-Z0-9_]+):\s?(.*)$/);

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

    // Parses "1) text" ... "6) text" (or legacy "A) text" ... "F) text")
    // lines out of a raw options block. Letters not present are simply
    // absent from the returned map (caller treats them as "").
    function parseOptionLines_(rawOptionsText) {
        const result = {};
        String(rawOptionsText || "")
            .split("\n")
            .forEach(function (line) {
                // Accepts "1) text" (standard) and legacy "A) text".
                // Result keys stay A-F internally (option_a..option_f).
                const m = line.trim().match(/^([1-6A-Fa-f])\)\s*(.*)$/);
                if (m) {
                    const k = m[1].toUpperCase();
                    result["123456".indexOf(k) >= 0 ? "ABCDEF"["123456".indexOf(k)] : k] = m[2];
                }
            });
        return result;
    }

    const AR_DEFAULT_OPTIONS_ = {
        A: "Both A and R are true, and R is the correct explanation of A",
        B: "Both A and R are true, but R is NOT the correct explanation of A",
        C: "A is true, but R is false",
        D: "A is false, but R is true"
    };

    // Where a question comes from. Blank/absent is shown on the site as "old".
    const KNOWN_ORIGINS_ = ["pyq", "book", "ai", "old"];

    // Standard: sheet stores 1-6 (1 = first option). Legacy A-F is still accepted.
    const CORRECT_TO_NUMBER_ = { "1": 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, A: 1, B: 2, C: 3, D: 4, E: 5, F: 6 };

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

        // @origin: carry-forward, exactly like @collection. A block with no
        // @origin tag inherits the running value; an explicit empty
        // "@origin:" clears it; an unknown value is flagged and ignored.
        if (hasTag_(fields, "origin")) {
            const rawOrigin = getField_(fields, "origin").trim().toLowerCase();
            if (!rawOrigin) {
                state.currentOrigin = "";
            } else if (KNOWN_ORIGINS_.indexOf(rawOrigin) !== -1) {
                state.currentOrigin = rawOrigin;
            } else {
                state.currentOrigin = "";
                warnings.push("unknown @origin '" + rawOrigin + "' (use pyq, book, ai or old) — origin not set");
            }
        }
        const originValue = state.currentOrigin;

        const rawType = getField_(fields, "type");
        const type = rawType || "simple";
        const isAssertionReason = type.toLowerCase() === "assertion_reason";

        // PHASE 8a — flag missing/unrecognized @type as a warning
        // (surfaces as ⚠ in the Phase 4 preview table, does not
        // block the row from parser output).
        const KNOWN_TYPES_ = ["simple", "assertion_reason", "comprehension", "table"];
        if (!rawType || KNOWN_TYPES_.indexOf(rawType.toLowerCase()) === -1) {
            warnings.push("missing or unrecognized @type — this question's type could not be determined");
        }

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
        let optionA = "", optionB = "", optionC = "", optionD = "", optionE = "", optionF = "";
        if (hasTag_(fields, "options")) {
            const parsed = parseOptionLines_(fields.options ? getField_(fields, "options") : "");
            optionA = parsed.A || "";
            optionB = parsed.B || "";
            optionC = parsed.C || "";
            optionD = parsed.D || "";
            optionE = parsed.E || "";
            optionF = parsed.F || "";
        } else if (isAssertionReason) {
            optionA = AR_DEFAULT_OPTIONS_.A;
            optionB = AR_DEFAULT_OPTIONS_.B;
            optionC = AR_DEFAULT_OPTIONS_.C;
            optionD = AR_DEFAULT_OPTIONS_.D;
        }
        if (!optionA && !optionB && !optionC && !optionD && !optionE && !optionF) {
            warnings.push("missing @options");
        } else {
            // A question has as many options as the source paper gives it
            // (normally 4, sometimes 5 or 6). Count up to the last filled one
            // and flag gaps / unusually short lists so a typo is not silent.
            const optList = [optionA, optionB, optionC, optionD, optionE, optionF];
            let optCount = optList.length;
            while (optCount > 0 && !optList[optCount - 1]) optCount--;
            if (optList.slice(0, optCount).some(function (o) { return !o; })) {
                warnings.push("option numbering has a gap (1) 2) 3) ... must be continuous)");
            } else if (optCount < 4) {
                warnings.push("only " + optCount + " options found (expected 4 or more)");
            }
        }

        // correct option — stored as 1-6 (1 = first option). Accepts
        // "1"-"6" (standard) or legacy "A"-"F" and always outputs 1-6.
        const correctRaw = getField_(fields, "correct").toUpperCase();
        let correctOption = "";
        if (Object.prototype.hasOwnProperty.call(CORRECT_TO_NUMBER_, correctRaw)) {
            correctOption = CORRECT_TO_NUMBER_[correctRaw];
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

        // group key (language-linking, see file header) — resolved to a
        // final mcq_id / question_group_id in the post-pass at the end of
        // parseMcqMarkdown(), once every block's group key is known and we
        // can tell whether it's actually shared by 2+ blocks or not.
        const explicitGroup = getField_(fields, "group");
        const groupKey = explicitGroup
            ? "grp_" + slug_(explicitGroup)
            : (collectionRef ? "mcq_" + slug_(collectionRef) + "_q" + questionNo : null);
        const langSlug = slug_(getField_(fields, "language") || "en") || "en";

        // mcq_id (rule 6 — deterministic, never Date.now()/Math.random()).
        // Provisional when groupKey exists — finalized in the post-pass,
        // which is also where the language suffix gets added IF this
        // group key turns out to be shared by more than one block.
        const mcqId = groupKey || ("mcq_" + shortHash_(questionText));

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

        const built = {
            mcq_id: mcqId,
            _groupKey: groupKey,   // internal — consumed by the post-pass, never sent to the sheet
            _langSlug: langSlug,   // internal — consumed by the post-pass, never sent to the sheet
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
            option_e: optionE,
            option_f: optionF,
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

        // Origin is only added when known, so re-importing an older .md that
        // has no @origin never blanks an origin already set in the sheet.
        if (originValue) built.origin = originValue;
        const derivedFrom = getField_(fields, "derived_from");
        if (derivedFrom) built.derived_from = derivedFrom;

        // Per-option explanations (@why_1..@why_6 -> explanation_a..f).
        // Only added when the tag is present and non-empty, so re-importing
        // an older .md (or one without @why tags) never blanks notes that
        // were already saved/edited in the sheet.
        ["a", "b", "c", "d", "e", "f"].forEach(function (letter, i) {
            const note = getField_(fields, "why_" + (i + 1));
            if (note) built["explanation_" + letter] = note;
        });
        return built;
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
            currentOrigin: "",             // @origin carry-forward (same idea as the collection)
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

        /* -----------------------------------------------------
           Post-pass — resolve language-linking now that every
           block's provisional group key is known (see file header
           and buildMcq_ above). A group key held by only ONE block
           is not a real pairing: that block's mcq_id is left exactly
           as its legacy format (existing saved data, and every
           single-language file that already exists, is unaffected).
           A group key shared by 2+ blocks becomes a real pairing:
           question_group_id is set to that shared key, and each
           member's mcq_id gets a "_<language>" suffix so they stay
           unique rows while remaining linkable by question_group_id.
           ----------------------------------------------------- */
        const groupCounts = new Map();
        mcqs.forEach(function (mcq) {
            if (mcq._groupKey) {
                groupCounts.set(mcq._groupKey, (groupCounts.get(mcq._groupKey) || 0) + 1);
            }
        });

        const seenIdsPerGroup = new Map(); // groupKey -> Set of mcq_ids already assigned in this group
        mcqs.forEach(function (mcq) {
            const groupKey = mcq._groupKey;
            const isRealGroup = !!groupKey && groupCounts.get(groupKey) > 1;

            mcq.question_group_id = isRealGroup ? groupKey : "";

            if (isRealGroup) {
                let seen = seenIdsPerGroup.get(groupKey);
                if (!seen) { seen = new Set(); seenIdsPerGroup.set(groupKey, seen); }

                let candidate = groupKey + "_" + mcq._langSlug;
                if (seen.has(candidate)) {
                    // Two blocks in the same group share a language (likely
                    // an authoring mistake — two English variants under one
                    // @group). Disambiguate rather than silently collide,
                    // and flag it so the author notices in the preview.
                    let n = 2;
                    while (seen.has(candidate + "-" + n)) n++;
                    candidate = candidate + "-" + n;
                    mcq.warnings.push(
                        "duplicate @language '" + mcq._langSlug + "' within @group '" +
                        groupKey.replace(/^grp_/, "") + "' — mcq_id disambiguated, please check for a copy-paste mistake"
                    );
                }
                seen.add(candidate);
                mcq.mcq_id = candidate;
            } else if (groupKey) {
                mcq.mcq_id = groupKey; // single member — legacy id format, unchanged
            }
            // else: mcq_id already set to the hash-based standalone fallback

            delete mcq._groupKey;
            delete mcq._langSlug;
        });

        return {
            collections: Array.from(state.collectionsMap.values()),
            passages: passages,
            mcqs: mcqs
        };
    }

    window.parseMcqMarkdown = parseMcqMarkdown;
})();
