// flashcards.js
//
// Phase 8 — Flashcards v1 (per-topic, fixed 5-box Leitner).
//
// Everything for the feature lives here: .md parsing, card ids,
// localStorage scheduling, and the flip-card modal. Frontend-only —
// nothing is synced to Sheets/Drive, exactly like the reading timer.
//
// Public surface (window.Flashcards):
//   splitArticleAndCards(rawLangChunk) -> { article, cards }   (used by app.js)
//   setContext(topicId, langTag, rawCardsBlock)                (app.js, after render)
//   onNewArticle()                                             (app.js, topic/lang change)
//   updateButtonState()                                        (enable/disable Flashcard btn)
//   open()                                                     (reading-tools.js)
(function () {
    const STORAGE_KEY = "flashcards:leitner:v1";
    const INTERVALS_DAYS = [1, 3, 7, 15, 30]; // index 0 = box 1 ... index 4 = box 5

    const FLASHCARDS_MARKER_RE = /^[ \t]*<!--\s*===FLASHCARDS===\s*-->[ \t]*$/m;
    const CARD_MARKER_RE = /^[ \t]*<!--\s*CARD\s*-->[ \t]*$/m;

    // ---------- current context (which topic + language is open) ----------
    let ctx = { topicId: "", lang: "EN", cards: [] };
    let modalEl = null;
    let keyHandler = null;

    // =========================================================
    // §2 — Parsing
    // =========================================================

    // Separates one language chunk into "article markdown" (goes to the
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
    function parseFlashcards(rawBlock) {
        const block = String(rawBlock || "");
        if (!block.trim()) return [];

        const splitter = new RegExp(CARD_MARKER_RE.source, "gm");
        const segments = block.split(splitter);
        const cards = [];

        segments.forEach(segment => {
            let front = null;
            let back = null;
            let current = null;

            segment.split(/\r?\n/).forEach(line => {
                const q = line.match(/^\s*Q:\s?(.*)$/);
                const a = line.match(/^\s*A:\s?(.*)$/);
                if (q) {
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

            front = (front || "").trim();
            back = (back || "").trim();
            if (front && back) cards.push({ front, back });
        });

        return cards;
    }

    // =========================================================
    // §3 — Card identity
    // =========================================================

    // FNV-1a 32-bit -> base36. Non-cryptographic; only needs to avoid
    // accidental collisions inside one topic+language.
    function hashString(str) {
        let h = 0x811c9dc5;
        for (let i = 0; i < str.length; i++) {
            h ^= str.charCodeAt(i);
            h = Math.imul(h, 0x01000193);
        }
        return (h >>> 0).toString(36);
    }

    // INTENDED BEHAVIOUR (not a bug): the id is derived from the FRONT
    // text only. Editing a question later creates a "new" card with fresh
    // scheduling; editing only the answer keeps the id and its history.
    function makeCardId(topicId, lang, front) {
        const normalized = String(front).trim().replace(/\s+/g, " ");
        return `${topicId}::${lang}::${hashString(normalized)}`;
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
        store[card.id] = entry;
        writeStore(store);
    }

    function onForgot(card, today) {
        const store = readStore();
        store[card.id] = { box: 1, dueDate: addDaysIso(today, 1), lastReviewed: today };
        writeStore(store);
    }

    // =========================================================
    // Context (called from app.js)
    // =========================================================

    function setContext(topicId, lang, rawCardsBlock) {
        const tag = String(lang || "EN").toUpperCase();
        const cards = parseFlashcards(rawCardsBlock).map(c => ({
            id: makeCardId(topicId, tag, c.front),
            front: c.front,
            back: c.back
        }));
        ctx = { topicId: String(topicId || ""), lang: tag, cards };
        updateButtonState();
    }

    // Wipes the previous topic/language's deck so it can never leak
    // into a newly opened one.
    function onNewArticle() {
        closeModal();
        ctx = { topicId: "", lang: "EN", cards: [] };
        updateButtonState();
    }

    function updateButtonState() {
        const btn = document.querySelector('[data-post-read-action="flashcard"]');
        if (!btn) return;
        const has = ctx.cards.length > 0;
        btn.disabled = !has;
        btn.title = has ? "" : "No flashcards for this topic/language yet";
    }

    // =========================================================
    // §5 — Modal
    // =========================================================

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, ch => (
            { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]
        ));
    }

    function renderMd(text) {
        try {
            if (window.marked && window.DOMPurify) {
                return window.DOMPurify.sanitize(window.marked.parse(String(text)));
            }
        } catch (err) { /* fall through to plain text */ }
        return escapeHtml(text).replace(/\n/g, "<br>");
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
        let flipped = false;

        const progressEl = modalEl.querySelector("#flashcard-progress");
        const bodyEl = modalEl.querySelector("#flashcard-body");

        function flip() {
            const card = bodyEl.querySelector("#flashcard-card");
            const answers = bodyEl.querySelector("#flashcard-answers");
            if (!card || !answers || flipped) return;
            flipped = true;
            card.classList.add("flipped");
            answers.hidden = false;
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
            flipped = false;
            const card = deck[index];
            progressEl.textContent = `Card ${index + 1} of ${deck.length}`;
            bodyEl.innerHTML = `
                <div class="flashcard-scene">
                    <div class="flashcard-card" id="flashcard-card" tabindex="0" role="button" aria-label="Flip card">
                        <div class="flashcard-face flashcard-front">
                            <div class="flashcard-text">${renderMd(card.front)}</div>
                            <span class="flashcard-hint">tap to flip</span>
                        </div>
                        <div class="flashcard-face flashcard-back">
                            <div class="flashcard-text">${renderMd(card.back)}</div>
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
            if (!flipped) return;
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
            if ((e.key === " " || e.key === "Enter") && !e.target.closest("button")) {
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

    window.Flashcards = { splitArticleAndCards, setContext, onNewArticle, updateButtonState, open };

    // Flashcard button starts disabled until a topic with cards is open.
    updateButtonState();

    // Exposed for tests only; harmless in production.
    window.Flashcards.__test = { parseFlashcards, makeCardId, addDaysIso, onKnewIt, onForgot, isDue, readStore };
})();
