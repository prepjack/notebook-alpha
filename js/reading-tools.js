// reading-tools.js
//
// "Read time" toggle button + reading-progress line for the CONTENT
// panel. Frontend-only, in-memory UI state — nothing here is persisted
// to Google Sheets, the .md file, or anywhere else.
//
// Word count is taken from #rc-explanation — the same container
// renderRichContent() already fills with the CURRENTLY OPEN topic's
// rendered Markdown (see renderContentLayer() / loadAndRenderMdFileContent()
// in app.js). Child/parent/sibling topics are never read from here, so
// switching topics can never mix their word counts together.
(function () {
    const WPM = 200;

    let currentWordCount = 0;
    let showingTime = false;

    function readTimeBtn() {
        return document.getElementById("read-time-btn");
    }
    function progressFill() {
        return document.getElementById("reading-progress-fill");
    }
    function scrollHost() {
        return document.getElementById("middle-panel");
    }

    function countWords(text) {
        const trimmed = String(text || "").trim();
        if (!trimmed) return 0;
        return trimmed.split(/\s+/).length;
    }

    function minutesLabel(words) {
        // Sensible floor: any non-trivial content reads as "~1 min"
        // rather than "~0 min read".
        const minutes = Math.max(1, Math.round(words / WPM));
        return `~${minutes} min read`;
    }

    function updateButtonLabel() {
        const btn = readTimeBtn();
        if (!btn) return;
        btn.textContent = showingTime ? minutesLabel(currentWordCount) : "Read time";
    }

    // content-panel-header (holding this progress bar) is sticky and
    // covers this much of the top of the viewport on its own.
    //
    // STEP 34: on desktop .app-header is no longer sticky, so once it's
    // scrolled away it stops covering anything — read its own live
    // remaining height instead of assuming a flat 92px. Below 901px the
    // header is still sticky (mobile keeps the old behaviour), so its
    // 92px still counts there.
    function visibleTopOffset() {
        const header = document.querySelector("#middle-panel .content-panel-header");
        const appHeader = document.querySelector(".app-header");
        const headerOffset = window.innerWidth > 900
            ? Math.max(0, Math.min(92, appHeader ? appHeader.getBoundingClientRect().bottom : 0))
            : 92;
        return headerOffset + (header ? header.getBoundingClientRect().height : 0);
    }

    function updateProgress() {
        const host = scrollHost();
        const fill = progressFill();
        if (!host || !fill) return;

        // Phase 1 layout redesign: #middle-panel no longer scrolls inside
        // its own box — the page does. Progress is now how far the host's
        // own content has scrolled past the sticky-header boundary,
        // relative to the host's total height minus the visible viewport.
        const rect = host.getBoundingClientRect();
        const viewport = window.innerHeight - visibleTopOffset();
        const scrollable = rect.height - viewport;

        // Nothing to scroll (short article fits entirely on screen) —
        // treat it as fully in view rather than dividing by zero.
        const percent = scrollable <= 0
            ? 100
            : Math.min(100, Math.max(0, ((visibleTopOffset() - rect.top) / scrollable) * 100));

        fill.style.width = percent + "%";
    }

    // Call at the START of rendering a (possibly new) topic's content,
    // before the new article's markup lands in the DOM. Prevents the
    // previous article's "~X min read" / scroll position from ever
    // being shown, even for a moment, against the new one.
    function onNewArticle() {
        currentWordCount = 0;
        showingTime = false;
        updateButtonLabel();
        const fill = progressFill();
        if (fill) fill.style.width = "0%";
    }

    // Call AFTER the current topic's rendered Markdown is actually in
    // the DOM (works for both the synchronous legacy-text path and the
    // async Drive-fetched .md path in app.js).
    function onContentRendered() {
        const container = document.getElementById("rc-explanation");
        currentWordCount = countWords(container ? container.textContent : "");
        updateButtonLabel();
        // Let layout settle before measuring scrollHeight.
        requestAnimationFrame(updateProgress);
    }

    document.addEventListener("DOMContentLoaded", () => {
        const btn = readTimeBtn();
        if (btn) {
            btn.addEventListener("click", () => {
                showingTime = !showingTime;
                updateButtonLabel();
            });
        }

        window.addEventListener("scroll", updateProgress, { passive: true });
        window.addEventListener("resize", updateProgress);
    });

    window.__ReadTimeFeature = { onNewArticle, onContentRendered };
})();


// =========================================================
// STEP 33 — PHASE 2: BOTTOM ACTION STRIP — Start/End Read
//
// Measures actual ACTIVE reading time for the current article, for
// the Start Read / End Read buttons. This is a bounded, one-shot
// session (Start -> End), unlike the old, removed "My reading time"
// feature it adapts, which ran continuously and showed a live label
// the whole time — that live display was an explicit design mistake
// we're not repeating here: this feature NEVER shows a running/
// ticking number, only a static "reading in progress" indicator while
// active and a single revealed total once "End Read" is clicked.
//
// STEP 36: #start-read-btn AND #end-read-btn both now live up in
// .content-panel-heading, right next to #read-time-btn, as a single
// toggle — clicking Start Read reveals End Read in the same spot, so
// the whole session runs without ever scrolling down. The status
// indicator, revealed result, Flashcard suggestion, Test/Revise/
// Flashcard and "Read Again" still live in #content-bottom-strip.
// Nothing below needed to change for the button move itself: every
// element is still looked up by id via els(), so it doesn't matter
// which container each one physically sits in.
//
// Activity is approximated the same way the old feature did (see
// git history, commit 1096785, for that reference implementation):
//   - the tab is visible (not backgrounded), AND
//   - the user has interacted (scroll/mouse/keyboard/touch) within
//     the last INACTIVITY_LIMIT_MS.
// A 1-second ticker only accumulates seconds while both hold AND a
// reading session is currently in progress.
// =========================================================
(function () {
    const INACTIVITY_LIMIT_MS = 60 * 1000; // no activity for 60s = paused
    const TICK_MS = 1000;

    let activeSeconds = 0;
    let isReading = false;
    let lastActivityTs = Date.now();
    let tickHandle = null;

    function els() {
        return {
            startBtn: document.getElementById("start-read-btn"),
            endBtn: document.getElementById("end-read-btn"),
            status: document.getElementById("reading-status-indicator"),
            result: document.getElementById("reading-time-result"),
            suggestion: document.getElementById("post-read-suggestion"),
            postActions: document.getElementById("post-read-actions"),
            rereadBtn: document.getElementById("reread-btn")
        };
    }

    function formatDuration(totalSeconds) {
        const m = Math.floor(totalSeconds / 60);
        const s = totalSeconds % 60;
        return `You read for ${m} min ${s} sec`;
    }

    function markActive() {
        lastActivityTs = Date.now();
    }

    function isCurrentlyActive() {
        if (document.hidden) return false;
        return (Date.now() - lastActivityTs) < INACTIVITY_LIMIT_MS;
    }

    function tick() {
        if (!isReading || !isCurrentlyActive()) return;
        activeSeconds += 1; // accumulated silently — never displayed live
    }

    function startTicker() {
        stopTicker();
        tickHandle = setInterval(tick, TICK_MS);
    }

    function stopTicker() {
        if (tickHandle) {
            clearInterval(tickHandle);
            tickHandle = null;
        }
    }

    // Shared by onNewArticle() (new topic/language — also zeroes the
    // clock) and handleReread() (re-arm for the SAME article — leaves
    // activeSeconds/isReading to their callers, since handleReread()
    // needs isReading already false and a fresh clock too, same as a
    // new article — the only real difference is a new article also
    // wants to move on from any previous topic's leftover state, which
    // is naturally true here already since both callers reset the
    // same way). Just the shared DOM reset: back to "Start Read"
    // visible up top, everything from End Read onward hidden.
    function resetToStartState() {
        const { startBtn, endBtn, status, result, suggestion, postActions, rereadBtn } = els();
        if (startBtn) {
            startBtn.hidden = false;
            startBtn.disabled = false;
            startBtn.textContent = "Start Read";
        }
        if (endBtn) {
            endBtn.hidden = true;
            endBtn.disabled = true;
        }
        if (status) status.hidden = true;
        if (result) {
            result.hidden = true;
            result.textContent = "";
        }
        if (suggestion) suggestion.hidden = true;
        if (postActions) postActions.hidden = true;
        if (rereadBtn) rereadBtn.hidden = true;
    }

    // Call at the START of rendering a (possibly new) topic's content —
    // same lifecycle moment app.js already resets the Read Time button
    // at — so switching topics OR switching EN/HI/AI fully resets the
    // strip back to its initial "Start Read" state, exactly like the
    // old reading-time features used to reset.
    function onNewArticle() {
        stopTicker();
        activeSeconds = 0;
        isReading = false;
        markActive();
        resetToStartState();
    }

    // Call AFTER the current topic's rendered Markdown is actually in
    // the DOM. The strip's own state was already reset by onNewArticle()
    // just before, so there's nothing to recompute here — this hook
    // exists purely so app.js's single onContentRendered() call keeps
    // reaching every reading-tools feature uniformly.
    function onContentRendered() {
        markActive();
    }

    function handleStartRead() {
        if (isReading) return;
        isReading = true;
        activeSeconds = 0;
        markActive();
        startTicker();

        const { startBtn, endBtn, status } = els();
        if (startBtn) startBtn.hidden = true;
        if (endBtn) {
            endBtn.hidden = false;
            endBtn.disabled = false;
        }
        if (status) {
            status.hidden = false;
            status.textContent = "● Reading…";
        }
    }

    function handleEndRead() {
        if (!isReading) return;
        isReading = false;
        stopTicker();

        const { endBtn, status, result, suggestion, postActions, rereadBtn } = els();
        if (endBtn) {
            endBtn.hidden = true;
            endBtn.disabled = true;
        }
        if (status) status.hidden = true;
        if (result) {
            result.hidden = false;
            result.textContent = formatDuration(activeSeconds); // one-time reveal, not a running counter
        }
        if (suggestion) suggestion.hidden = false;
        if (postActions) postActions.hidden = false;
        // Re-arms Start Read for the same article — see handleReread().
        if (rereadBtn) rereadBtn.hidden = false;
    }

    // "Read Again" — lets the person start a fresh timed session on the
    // SAME article without switching topics/language (which would also
    // work, via onNewArticle(), but throws away their place) or
    // reloading the page. Just re-arms Start Read up top and hides
    // everything End-Read-onward, exactly like a fresh article would,
    // minus actually touching the article itself.
    function handleReread() {
        stopTicker();
        activeSeconds = 0;
        isReading = false;
        markActive();
        resetToStartState();
    }

    // Take Test / Revise / Flashcard: visually wired, functionally inert
    // for this phase. Real behavior depends on systems (MCQ linking,
    // revision view, flashcards) tracked separately, outside these
    // layout phases.
    function handlePostReadStub(action) {
        console.log(`[Notebook Alpha] "${action}" clicked — not implemented yet (tracked separately from the layout phases).`);
    }

    document.addEventListener("DOMContentLoaded", () => {
        const { startBtn, endBtn, postActions, rereadBtn } = els();
        if (startBtn) startBtn.addEventListener("click", handleStartRead);
        if (endBtn) endBtn.addEventListener("click", handleEndRead);
        if (rereadBtn) rereadBtn.addEventListener("click", handleReread);
        if (postActions) {
            postActions.addEventListener("click", (event) => {
                const btn = event.target.closest("[data-post-read-action]");
                if (!btn) return;
                handlePostReadStub(btn.dataset.postReadAction);
            });
        }

        document.addEventListener("mousemove", markActive, { passive: true });
        document.addEventListener("keydown", markActive, { passive: true });
        document.addEventListener("touchstart", markActive, { passive: true });
        document.addEventListener("touchmove", markActive, { passive: true });
        window.addEventListener("scroll", markActive, { passive: true });

        // Coming back to the tab counts as activity too, so the timer
        // doesn't read as instantly idle the moment focus returns,
        // before any mousemove has happened yet.
        document.addEventListener("visibilitychange", () => {
            if (!document.hidden) markActive();
        });
    });

    window.__BottomStripReadFeature = { onNewArticle, onContentRendered };
})();


// =========================================================
// Combined dispatcher — app.js only knows about (and only ever
// calls) window.ReadingTools.onNewArticle() / onContentRendered().
// Forwards to every reading-tools feature above; kept as a single
// dispatcher object so app.js's call sites don't need to change if
// another reading-tools feature is added later.
// =========================================================
window.ReadingTools = {
    onNewArticle() {
        window.__ReadTimeFeature.onNewArticle();
        window.__BottomStripReadFeature.onNewArticle();
    },
    onContentRendered() {
        window.__ReadTimeFeature.onContentRendered();
        window.__BottomStripReadFeature.onContentRendered();
    }
};
