// flashcards.js
//
// Phase 8 — Flashcards v2: ONE bilingual deck per topic (English / हिंदी),
// fixed 5-box Leitner. The deck does not depend on the EN/HI/AI toggle.
//
// Everything for the feature lives here: .md parsing, card ids,
// localStorage scheduling, and the flip-card modal. Frontend-only —
// nothing is synced to Sheets/Drive, exactly like the reading timer.
//
// Public surface (window.Flashcards):
//   splitArticleAndCards(rawLangChunk) -> { article, cards }   (used by app.js)
//   setContext(topicId, rawCardsBlock)                         (app.js, after render)
//   onNewArticle()                                             (app.js, new topic / re-render)
//   updateButtonState()                                        (enable/disable Flashcard btn)
//   open()                                                     (reading-tools.js)
(function () {
    const STORAGE_KEY = "flashcards:leitner:v1";
    const INTERVALS_DAYS = [1, 3, 7, 15, 30]; // index 0 = box 1 ... index 4 = box 5

    const FLASHCARDS_MARKER_RE = /^[ \t]*<!--\s*===FLASHCARDS===\s*-->[ \t]*$/m;
    const CARD_LINE_RE = /^[ \t]*<!--\s*CARD\s*-->[ \t]*$/;

    // ---------- current context (which topic is open) ----------
    let ctx = { topicId: "", cards: [] };
    let modalEl = null;
    let keyHandler = null;

    // =========================================================
    // §2 — Parsing
    // =========================================================

    // Separates the whole file into "article markdown" (goes to the
    // normal renderer) and the raw flashcard block (never rendered as
    // article). No marker => chunk is returned untouched.
    function splitArticleAndCards(chunk) {
        const text = String(chunk || "");
        const m = FLASHCARDS_MARKER_RE.exec(text);
        if (!m) return { article: text, cards: "" };
        return {
            article: text.slice(0, m.index).trim(),
            cards: text.slice(m.index + m[0].length).trim()
        };
    }

    // Q:/A: values may span multiple lines: everything up to the next
    // Q:/A:/<!--CARD--> belongs to whichever started most recently.
    // Tolerant on purpose (AI output varies): a <!--CARD--> line ends the
    // current card, AND so does a new "Q:" that follows an "A:" even when
    // the <!--CARD--> separator was forgotten. Cards missing a Q or an A
    // are dropped.
    function parseFlashcards(rawBlock) {
        const block = String(rawBlock || "");
        if (!block.trim()) return [];

        const cards = [];
        let front = null;
        let back = null;
        let current = null;

        const flush = () => {
            const f = (front || "").trim();
            const b = (back || "").trim();
            if (f && b) cards.push({ front: f, back: b });
            front = null;
            back = null;
            current = null;
        };

        block.split(/\r?\n/).forEach(line => {
            if (CARD_LINE_RE.test(line)) {
                flush();
                return;
            }
            const q = line.match(/^\s*Q:\s?(.*)$/);
            const a = line.match(/^\s*A:\s?(.*)$/);
            if (q) {
                if (back !== null) flush(); // new question after an answer = new card
                front = q[1];
                current = "front";
            } else if (a) {
                back = a[1];
                current = "back";
            } else if (current === "front") {
                front += "\n" + line;
            } else if (current === "back") {
                back += "\n" + line;
            }
        });
        flush();

        return cards;
    }

    // =========================================================
    // Bilingual split: "English / हिंदी"
    // =========================================================
    // Cards are authored as "English text / हिंदी text". A "/" is the
    // separator only if there is NO Devanagari before it and SOME after
    // it; when several slashes qualify the LAST one wins, so
    // "input/output / इनपुट/आउटपुट" splits after "output", and Hindi-side
    // alternates ("a / b / c") stay together on the Hindi side.
    const DEVANAGARI_RE = /[\u0900-\u097F]/;

    function splitOneSegment(text) {
        let cut = -1;
        for (let i = 0; i < text.length; i++) {
            if (text[i] !== "/") continue;
            const before = text.slice(0, i);
            const after = text.slice(i + 1);
            if (!DEVANAGARI_RE.test(before) && DEVANAGARI_RE.test(after)) cut = i;
        }
        if (cut === -1) return { en: text.trim(), hi: "" }; // no Hindi part
        return { en: text.slice(0, cut).trim(), hi: text.slice(cut + 1).trim() };
    }

    // Single-line fields: one split over the whole text. Multi-line
    // fields where SEVERAL lines each carry their own "English / हिंदी"
    // pair (e.g. numbered lists) are split line by line, so the English
    // and Hindi lists come out as two clean lists. A line with no
    // separator goes to Hindi if it contains Devanagari, else English.
    function splitBilingual(raw) {
        const text = String(raw || "").trim();
        const lines = text.split(/\r?\n/);
        const pairs = lines.map(splitOneSegment);
        const pairedLines = pairs.filter(p => p.hi).length;

        if (lines.length > 1 && pairedLines > 1) {
            const en = [];
            const hi = [];
            lines.forEach((line, i) => {
                if (pairs[i].hi) {
                    en.push(pairs[i].en);
                    hi.push(pairs[i].hi);
                } else if (DEVANAGARI_RE.test(line)) {
                    hi.push(line.trim());
                } else {
                    en.push(line.trim());
                }
            });
            return { en: en.join("\n"), hi: hi.join("\n") };
        }
        return splitOneSegment(text);
    }

    // =========================================================
    // §3 — Card identity
    // =========================================================

    // FNV-1a 32-bit -> base36. Non-cryptographic; only needs to avoid
    // accidental collisions inside one topic.
    function hashString(str) {
        let h = 0x811c9dc5;
        for (let i = 0; i < str.length; i++) {
            h ^= str.charCodeAt(i);
            h = Math.imul(h, 0x01000193);
        }
        return (h >>> 0).toString(36);
    }

    // INTENDED BEHAVIOUR (not a bug): the id is derived from the ENGLISH
    // part of the FRONT only (plus the topic). Editing the English
    // question creates a "new" card with fresh scheduling; editing the
    // Hindi wording or any answer keeps the id and its history.
    function makeCardId(topicId, frontEn) {
        const normalized = String(frontEn).trim().replace(/\s+/g, " ").toLowerCase();
        return `${topicId}::${hashString(normalized)}`;
    }

    // =========================================================
    // §3/§4 — Storage + Leitner scheduling
    // =========================================================

    function readStore() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            const parsed = raw ? JSON.parse(raw) : {};
            return parsed && typeof parsed === "object" ? parsed : {};
        } catch (err) {
            return {}; // fail closed: everything reads as a new card
        }
    }

    function writeStore(store) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
        } catch (err) {
            console.warn("[Notebook Alpha] Could not save flashcard progress:", err);
        }
        // Lets the header badge / Practice page refresh (own answers AND
        // progress merged in from another device both come through here).
        try {
            window.dispatchEvent(new CustomEvent("flashcards-progress-changed"));
        } catch (err) { /* very old browser: no live refresh, everything else works */ }
    }

    // ---- known decks (IDs only, no text) ----------------------------
    // Progress entries outlive edits: if a deck is rewritten, the old
    // cards' entries stay in the store but no longer exist in the deck.
    // Remembering which IDs each topic's CURRENT deck has (refreshed every
    // time the topic is opened) lets the due counts ignore those ghosts,
    // so the header badge never promises cards the topic can't show.
    const DECKS_KEY = "flashcards:decks:v1";

    function readKnownDecks() {
        try {
            const raw = JSON.parse(localStorage.getItem(DECKS_KEY) || "{}");
            return raw && typeof raw === "object" ? raw : {};
        } catch (err) {
            return {};
        }
    }

    function saveKnownDeck(topicId, ids) {
        if (!topicId || !ids.length) return; // never record an empty deck (could be a half-loaded page)
        try {
            const all = readKnownDecks();
            all[topicId] = ids;
            localStorage.setItem(DECKS_KEY, JSON.stringify(all));
        } catch (err) { /* storage blocked: counts just include ghosts */ }
    }

    // Drops localStorage progress entries that belong to THIS topic but
    // whose card id is no longer in the deck just loaded (the question was
    // reworded, or the card was removed, since the .md was last read).
    // Only ever touches ids under "topicId::…" — every other topic's
    // entries are left alone, including topics not opened this session.
    // Called right after a fresh deck is parsed, so the id set is
    // authoritative at that moment. Safe to run on every open: a no-op
    // when nothing changed.
    function pruneOrphansForTopic(topicId, currentIds) {
        if (!topicId) return 0;
        const keep = new Set(currentIds);
        const store = readStore();
        const prefix = topicId + "::";
        let removed = 0;
        Object.keys(store).forEach(id => {
            if (id.indexOf(prefix) !== 0) return; // not this topic
            if (keep.has(id)) return;             // still in the deck
            delete store[id];
            removed++;
        });
        if (removed) {
            writeStore(store);
            notifyChanged();
        }
        return removed;
    }

    function pad(n) {
        return String(n).padStart(2, "0");
    }

    // Local date, yyyy-mm-dd, no time component.
    function isoDate(d) {
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }

    function todayIso() {
        return isoDate(new Date());
    }

    function addDaysIso(iso, days) {
        const [y, m, d] = iso.split("-").map(Number);
        return isoDate(new Date(y, m - 1, d + days)); // local-date math, DST-safe
    }

    function prettyDate(iso) {
        const [y, m, d] = iso.split("-").map(Number);
        try {
            return new Date(y, m - 1, d).toLocaleDateString("en-GB", {
                day: "numeric", month: "short", year: "numeric"
            });
        } catch (err) {
            return iso;
        }
    }

    function isDue(card, store, today) {
        const entry = store[card.id];
        if (!entry) return true; // never reviewed = always due
        return String(entry.dueDate || "") <= today;
    }

    function onKnewIt(card, today) {
        const store = readStore();
        // A card with no entry is a NEW card and sits implicitly in box 1
        // (spec §3), so its first "knew it" moves it to box 2 (3 days).
        const entry = store[card.id] || { box: 1 };
        entry.box = Math.min((Number(entry.box) || 1) + 1, 5);
        entry.dueDate = addDaysIso(today, INTERVALS_DAYS[entry.box - 1]);
        entry.lastReviewed = today;
        entry.ts = Date.now(); // exact moment, so sync can tell which device reviewed last
        store[card.id] = entry;
        writeStore(store);
        notifyChanged();
    }

    function onForgot(card, today) {
        const store = readStore();
        store[card.id] = { box: 1, dueDate: addDaysIso(today, 1), lastReviewed: today, ts: Date.now() };
        writeStore(store);
        notifyChanged();
    }

    // =========================================================
    // Progress sync / backup hooks (see js/progress-sync.js)
    // =========================================================

    // Tells the sync layer that review progress changed (it debounces).
    function notifyChanged() {
        if (window.ProgressSync && typeof window.ProgressSync.markDirty === "function") {
            window.ProgressSync.markDirty();
        }
    }

    // When did this card entry last change? Entries from before sync
    // existed have no `ts`, so fall back to the review date (midnight).
    function entryTs(entry) {
        if (!entry || typeof entry !== "object") return 0;
        const t = Number(entry.ts);
        if (t > 0) return t;
        const d = Date.parse(String(entry.lastReviewed || "") + "T00:00:00");
        return isNaN(d) ? 0 : d;
    }

    // Never trust incoming data (import file / server): must look exactly
    // like something this module itself would have written.
    function isValidEntry(e) {
        return !!e && typeof e === "object" &&
            Number.isInteger(Number(e.box)) && Number(e.box) >= 1 && Number(e.box) <= 5 &&
            /^\d{4}-\d{2}-\d{2}$/.test(String(e.dueDate || ""));
    }

    // MERGE, never overwrite: per card, whichever side reviewed most
    // recently wins. Returns how many local entries were added/updated.
    function mergeRemoteStore(remote) {
        if (!remote || typeof remote !== "object") return 0;
        const local = readStore();
        let changed = 0;

        Object.keys(remote).forEach(id => {
            const r = remote[id];
            if (!isValidEntry(r)) return;
            const l = local[id];
            if (l && entryTs(r) <= entryTs(l)) return;

            const clean = {
                box: Number(r.box),
                dueDate: String(r.dueDate),
                lastReviewed: String(r.lastReviewed || "")
            };
            if (Number(r.ts) > 0) clean.ts = Number(r.ts);
            local[id] = clean;
            changed++;
        });

        if (changed) writeStore(local);
        return changed;
    }

    // =========================================================
    // Context (called from app.js)
    // =========================================================

    function setContext(topicId, rawCardsBlock) {
        const seen = new Set();
        const cards = [];
        // A flashcards.md companion may or may not begin with the
        // <!--===FLASHCARDS===--> line; both are fine.
        const raw = String(rawCardsBlock || "");
        const block = FLASHCARDS_MARKER_RE.test(raw) ? splitArticleAndCards(raw).cards : raw;
        parseFlashcards(block).forEach(c => {
            const front = splitBilingual(c.front);
            const back = splitBilingual(c.back);
            const id = makeCardId(topicId, front.en || c.front);
            if (seen.has(id)) return; // duplicate English question: keep the first
            seen.add(id);
            cards.push({ id, front, back });
        });
        ctx = { topicId: String(topicId || ""), cards };
        const ids = cards.map(c => c.id);
        saveKnownDeck(ctx.topicId, ids);
        pruneOrphansForTopic(ctx.topicId, ids);
        updateButtonState();
        updatePracticeBadge();
    }

    // Wipes the previous topic's deck so it can never leak
    // into a newly opened one.
    function onNewArticle() {
        closeModal();
        ctx = { topicId: "", cards: [] };
        updateButtonState();
    }

    // =========================================================
    // Due summary (header badge + Practice page)
    // =========================================================

    // Reviewed cards only (a card never reviewed has no entry yet). "Due"
    // = dueDate <= today; overdue = before today; upcoming = the next 7
    // days. Grouped by topic (the topic id is the part of the card id
    // before the last "::"). Ghost entries of decks that were rewritten
    // are skipped for topics whose current deck is known.
    function getDueSummary(todayStr) {
        const today = todayStr || todayIso();
        const soon = addDaysIso(today, 7);
        const store = readStore();
        const known = readKnownDecks();
        const knownSets = {};
        const summary = { today: today, total: 0, overdue: 0, dueToday: 0, upcoming: 0, later: 0, reviewed: 0, topics: {} };

        Object.keys(store).forEach(id => {
            const e = store[id];
            if (!isValidEntry(e)) return;
            const cut = id.lastIndexOf("::");
            if (cut <= 0) return;
            const topicId = id.slice(0, cut);

            if (Array.isArray(known[topicId])) {
                knownSets[topicId] = knownSets[topicId] || new Set(known[topicId]);
                if (!knownSets[topicId].has(id)) return; // ghost of an edited/removed card
            }

            const due = String(e.dueDate);
            const t = summary.topics[topicId] || (summary.topics[topicId] = {
                topicId: topicId, overdue: 0, dueToday: 0, upcoming: 0, later: 0, reviewed: 0, nextFuture: ""
            });
            t.reviewed++; summary.reviewed++;
            if (due < today) { t.overdue++; summary.overdue++; summary.total++; }
            else if (due === today) { t.dueToday++; summary.dueToday++; summary.total++; }
            else {
                if (due <= soon) { t.upcoming++; summary.upcoming++; }
                else { t.later++; summary.later++; }
                if (!t.nextFuture || due < t.nextFuture) t.nextFuture = due;
            }
        });
        return summary;
    }

    // All topic ids that have a known deck locally (Tree view's scope:
    // only topics whose flashcards have actually been seen at least once,
    // never the whole site tree).
    function getKnownTopicIds() {
        return Object.keys(readKnownDecks());
    }

    // Per-box breakdown for one topic's Tree-view box-strip. Built from
    // DECKS_KEY (the authoritative full id list, including never-reviewed
    // cards) + the progress store — NOT from ctx.cards, so this works for
    // any known topic whether or not it's the one currently open, with
    // zero Drive/network calls. Ghosts are structurally impossible here:
    // we only ever walk the known deck's ids, never the store's ids.
    //
    // Returns null if the topic has no known deck yet (nothing to show).
    //
    // Shape:
    //   { topicId, total, readyTotal,
    //     boxes: [ { box, intervalDays, total, readyCount, waitingCount,
    //                ready: { new: [ids],                        // no dueDate: never reviewed
    //                         overdue: [ { id, dueDate } ],       // dueDate already passed
    //                         dueToday: [ { id, dueDate } ] },    // dueDate = today
    //                waiting: [ { id, dueDate } ]  // dueDate in the future, soonest first
    //              }, ... 5 entries ] }
    function getBoxSummary(topicId, todayStr) {
        const ids = readKnownDecks()[topicId];
        if (!Array.isArray(ids) || !ids.length) return null;

        const today = todayStr || todayIso();
        const store = readStore();
        const boxes = INTERVALS_DAYS.map((days, i) => ({
            box: i + 1,
            intervalDays: days,
            total: 0,
            readyCount: 0,
            waitingCount: 0,
            ready: { new: [], overdue: [], dueToday: [] },
            waiting: []
        }));
        let readyTotal = 0;

        ids.forEach(id => {
            const entry = store[id];
            const boxNum = entry ? Math.min(Math.max(Number(entry.box) || 1, 1), 5) : 1;
            const b = boxes[boxNum - 1];
            b.total++;

            if (!entry) {
                b.ready.new.push(id);
                b.readyCount++; readyTotal++;
                return;
            }
            const due = String(entry.dueDate || "");
            if (due < today) {
                b.ready.overdue.push({ id: id, dueDate: due });
                b.readyCount++; readyTotal++;
            } else if (due === today) {
                b.ready.dueToday.push({ id: id, dueDate: due });
                b.readyCount++; readyTotal++;
            } else {
                b.waiting.push({ id: id, dueDate: due });
                b.waitingCount++;
            }
        });

        boxes.forEach(b => b.waiting.sort((x, y) => x.dueDate < y.dueDate ? -1 : x.dueDate > y.dueDate ? 1 : 0));

        return { topicId: topicId, total: ids.length, readyTotal: readyTotal, boxes: boxes };
    }

    // "Practice · 12" link in the header (only present on pages that have it).
    function updatePracticeBadge() {
        const badge = document.getElementById("practice-badge");
        if (!badge) return;
        const total = getDueSummary().total;
        badge.textContent = total > 99 ? "99+" : String(total);
        badge.hidden = total === 0;
        const link = document.getElementById("practice-link");
        if (link) link.title = total === 0 ? "Practice: nothing due right now" : "Practice: " + total + " card" + (total === 1 ? "" : "s") + " due";
    }

    function updateButtonState() {
        const btn = document.querySelector('[data-post-read-action="flashcard"]');
        if (!btn) return;
        const has = ctx.cards.length > 0;
        btn.disabled = !has;
        btn.title = has ? "" : "No flashcards for this topic yet";
    }

    // =========================================================
    // §5 — Modal
    // =========================================================

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, ch => (
            { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]
        ));
    }

    // "->" typed in plain text becomes a proper arrow (only when spaced,
    // so code-ish text like a->b is left alone).
    function niceArrows(text) {
        return String(text).replace(/\s(?:-|\u2013|\u2014)>\s/g, " \u2192 ");
    }

    // One language's text. Single lines render INLINE (so "1. Generation
    // -> 2. Collection" isn't swallowed into a one-item ordered list);
    // multi-line text renders as normal block Markdown (real lists work).
    function renderMd(text) {
        const src = niceArrows(text);
        try {
            if (window.marked && window.DOMPurify) {
                const html = src.includes("\n")
                    ? window.marked.parse(src)
                    : window.marked.parseInline(src);
                return window.DOMPurify.sanitize(html);
            }
        } catch (err) { /* fall through to plain text */ }
        return escapeHtml(src).replace(/\n/g, "<br>");
    }

    // English on top, thin divider, हिंदी below. No Hindi => English only.
    function renderFaceText(pair) {
        const en = pair.en ? `<div class="flashcard-en">${renderMd(pair.en)}</div>` : "";
        const hi = pair.hi ? `<div class="flashcard-hi">${renderMd(pair.hi)}</div>` : "";
        return en + hi;
    }

    function closeModal() {
        if (keyHandler) {
            document.removeEventListener("keydown", keyHandler);
            keyHandler = null;
        }
        if (modalEl) {
            modalEl.remove(); // removed from the DOM, not just hidden
            modalEl = null;
        }
    }

    function open() {
        if (!ctx.cards.length) return;
        closeModal();

        const today = todayIso();
        const store = readStore();
        const deck = ctx.cards.filter(c => isDue(c, store, today));

        modalEl = document.createElement("div");
        modalEl.id = "flashcard-modal";
        modalEl.innerHTML = `
            <div class="add-resource-overlay" id="flashcard-overlay">
                <div class="add-resource-modal flashcard-modal" role="dialog" aria-modal="true" aria-label="Flashcards">
                    <button type="button" class="modal-close" id="flashcard-close" aria-label="Close">×</button>
                    <div class="flashcard-progress" id="flashcard-progress"></div>
                    <div id="flashcard-body"></div>
                </div>
            </div>`;
        document.body.appendChild(modalEl);

        modalEl.querySelector("#flashcard-close").addEventListener("click", closeModal);
        modalEl.querySelector("#flashcard-overlay").addEventListener("mousedown", e => {
            if (e.target.id === "flashcard-overlay") closeModal();
        });

        let index = 0;
        let showingBack = false; // which side is facing the reader right now
        let revealed = false;    // has the answer side been seen at least once for this card?

        const progressEl = modalEl.querySelector("#flashcard-progress");
        const bodyEl = modalEl.querySelector("#flashcard-body");

        // Unlimited flips: every tap / Space / Enter turns the card over
        // again, front <-> back, as often as wanted. The first time the
        // answer side is shown, "Yaad tha / Bhool gaya" appear and then STAY
        // (even while the question side faces you again), so you can
        // re-read the question, then answer.
        function flip() {
            const card = bodyEl.querySelector("#flashcard-card");
            const answers = bodyEl.querySelector("#flashcard-answers");
            if (!card || !answers) return;
            showingBack = !showingBack;
            card.classList.toggle("flipped", showingBack);
            card.setAttribute("aria-pressed", showingBack ? "true" : "false");
            if (showingBack && !revealed) {
                revealed = true;
                answers.hidden = false;
            }
        }

        function showMessage(html) {
            progressEl.textContent = "";
            bodyEl.innerHTML = `
                <div class="flashcard-message">${html}</div>
                <div class="flashcard-answers"><button type="button" class="bottom-strip-btn" id="flashcard-done">Close</button></div>`;
            bodyEl.querySelector("#flashcard-done").addEventListener("click", closeModal);
        }

        function showCard() {
            if (index >= deck.length) {
                showMessage(`Session complete! Reviewed ${deck.length} card${deck.length === 1 ? "" : "s"}.`);
                return;
            }
            showingBack = false;
            revealed = false;
            const card = deck[index];
            progressEl.textContent = `Card ${index + 1} of ${deck.length}`;
            bodyEl.innerHTML = `
                <div class="flashcard-scene">
                    <div class="flashcard-card" id="flashcard-card" tabindex="0" role="button" aria-pressed="false" aria-label="Flip card">
                        <div class="flashcard-face flashcard-front">
                            <div class="flashcard-text">${renderFaceText(card.front)}</div>
                            <span class="flashcard-hint">tap to flip</span>
                        </div>
                        <div class="flashcard-face flashcard-back">
                            <div class="flashcard-text">${renderFaceText(card.back)}</div>
                            <span class="flashcard-hint">tap to flip back</span>
                        </div>
                    </div>
                </div>
                <div class="flashcard-answers" id="flashcard-answers" hidden>
                    <button type="button" class="bottom-strip-btn flashcard-knew" id="flashcard-knew">Yaad tha ✓</button>
                    <button type="button" class="bottom-strip-btn flashcard-forgot" id="flashcard-forgot">Bhool gaya ✗</button>
                </div>`;

            bodyEl.querySelector("#flashcard-card").addEventListener("click", flip);
            bodyEl.querySelector("#flashcard-knew").addEventListener("click", () => answer(true));
            bodyEl.querySelector("#flashcard-forgot").addEventListener("click", () => answer(false));
        }

        function answer(knew) {
            if (!revealed) return; // never grade a card whose answer was not looked at
            const card = deck[index];
            // Persisted immediately — closing early loses nothing.
            if (knew) onKnewIt(card, todayIso());
            else onForgot(card, todayIso());
            index += 1;
            showCard();
        }

        keyHandler = function (e) {
            if (e.key === "Escape") {
                closeModal();
                return;
            }
            const t = e.target;
            const onButton = !!(t && typeof t.closest === "function" && t.closest("button"));
            if ((e.key === " " || e.key === "Enter") && !onButton) {
                e.preventDefault();
                flip();
            }
        };
        document.addEventListener("keydown", keyHandler);

        if (!deck.length) {
            const dates = ctx.cards
                .map(c => (store[c.id] && store[c.id].dueDate) || "")
                .filter(Boolean)
                .sort();
            const next = dates.length ? prettyDate(dates[0]) : "";
            showMessage(next ? `All caught up! Next review due ${escapeHtml(next)}.` : "All caught up!");
            return;
        }

        showCard();
    }

    window.Flashcards = { splitArticleAndCards, setContext, onNewArticle, updateButtonState, open, getDueSummary, getBoxSummary, getKnownTopicIds, updatePracticeBadge };

    // Flashcard button starts disabled until a topic with cards is open.
    updateButtonState();
    updatePracticeBadge();
    try {
        window.addEventListener("flashcards-progress-changed", updatePracticeBadge);
    } catch (err) { /* no live badge refresh */ }

    // Join the progress sync/backup system (js/progress-sync.js loads first).
    if (window.ProgressSync && typeof window.ProgressSync.register === "function") {
        window.ProgressSync.register("flashcards", { export: readStore, merge: mergeRemoteStore });
    }

    // Exposed for tests only; harmless in production.
    window.Flashcards.__test = { parseFlashcards, splitBilingual, makeCardId, mergeRemoteStore, entryTs, addDaysIso, onKnewIt, onForgot, isDue, readStore, pruneOrphansForTopic, getBoxSummary, getKnownTopicIds };
})();
