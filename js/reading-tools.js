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

    function updateProgress() {
        const host = scrollHost();
        const fill = progressFill();
        if (!host || !fill) return;

        const scrollable = host.scrollHeight - host.clientHeight;
        // Nothing to scroll (short article fits entirely on screen) —
        // treat it as fully in view rather than dividing by zero.
        const percent = scrollable <= 0
            ? 100
            : Math.min(100, Math.max(0, (host.scrollTop / scrollable) * 100));

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

        const host = scrollHost();
        if (host) {
            host.addEventListener("scroll", updateProgress, { passive: true });
        }
        window.addEventListener("resize", updateProgress);
    });

    window.__ReadTimeFeature = { onNewArticle, onContentRendered };
})();


// =========================================================
// "My reading time" — ACTUAL ACTIVE READING TIME
//
// Completely separate feature from "Read time" above. That one
// estimates how long an article SHOULD take (word count / 200wpm).
// This one measures how long the user has ACTUALLY been actively
// reading the CURRENTLY OPEN article — frontend-only, in-memory,
// nothing persisted anywhere, resets the moment the user switches
// to a different topic.
//
// "Active" is approximated (not scientific eye-tracking) as:
//   - the document/tab is visible (not backgrounded), AND
//   - the user has interacted (scroll/mouse/keyboard/touch)
//     within the last INACTIVITY_LIMIT_MS.
// A 1-second ticker only adds time while both conditions hold.
// =========================================================
(function () {
    const INACTIVITY_LIMIT_MS = 60 * 1000; // no activity for 60s = paused
    const TICK_MS = 1000;

    let activeSeconds = 0;
    let showingMyTime = false;
    let lastActivityTs = Date.now();

    function btn() {
        return document.getElementById("my-reading-time-btn");
    }

    function formatDuration(totalSeconds) {
        const m = Math.floor(totalSeconds / 60);
        const s = totalSeconds % 60;
        return `Reading time: ${m} min ${s} sec`;
    }

    function updateLabel() {
        const el = btn();
        if (!el) return;
        el.textContent = showingMyTime ? formatDuration(activeSeconds) : "My reading time";
    }

    function markActive() {
        lastActivityTs = Date.now();
    }

    function isCurrentlyActive() {
        if (document.hidden) return false;
        return (Date.now() - lastActivityTs) < INACTIVITY_LIMIT_MS;
    }

    function tick() {
        if (!isCurrentlyActive()) return;
        activeSeconds += 1;
        if (showingMyTime) updateLabel();
    }

    // Call at the START of rendering a (possibly new) topic — same
    // moment app.js resets the Read Time button — so the previous
    // article's active time can never carry over, even briefly.
    function onNewArticle() {
        activeSeconds = 0;
        showingMyTime = false;
        markActive();
        updateLabel();
    }

    // Call AFTER the new article's markup (including this button,
    // which is re-created inside #topic-content on every render) is
    // actually in the DOM.
    function onContentRendered() {
        markActive();
        updateLabel();
    }

    document.addEventListener("DOMContentLoaded", () => {
        // #my-reading-time-btn is torn down and recreated on every
        // render (renderContentLayer() rewrites #topic-content's
        // innerHTML), so a direct listener on the button itself
        // wouldn't survive a topic switch. Delegate from the stable
        // #topic-content container instead.
        const contentHost = document.getElementById("topic-content");
        if (contentHost) {
            contentHost.addEventListener("click", (event) => {
                if (!event.target.closest("#my-reading-time-btn")) return;
                showingMyTime = !showingMyTime;
                updateLabel();
            });
        }

        // Any of these count as "the user is actively reading".
        document.addEventListener("mousemove", markActive, { passive: true });
        document.addEventListener("keydown", markActive, { passive: true });
        document.addEventListener("touchstart", markActive, { passive: true });
        document.addEventListener("touchmove", markActive, { passive: true });
        window.addEventListener("scroll", markActive, { passive: true });

        const scrollHost = document.getElementById("middle-panel");
        if (scrollHost) {
            scrollHost.addEventListener("scroll", markActive, { passive: true });
        }

        // Coming back to the tab counts as activity too, so the
        // timer doesn't read as instantly idle the moment focus
        // returns, before any mousemove has happened yet.
        document.addEventListener("visibilitychange", () => {
            if (!document.hidden) markActive();
        });

        setInterval(tick, TICK_MS);
    });

    window.__MyReadingTimeFeature = { onNewArticle, onContentRendered };
})();


// =========================================================
// Combined dispatcher — app.js only knows about (and only ever
// calls) window.ReadingTools.onNewArticle() / onContentRendered().
// Both features above are wired to those same two lifecycle
// moments independently; neither feature's internal state or
// behavior depends on the other.
// =========================================================
window.ReadingTools = {
    onNewArticle() {
        window.__ReadTimeFeature.onNewArticle();
        window.__MyReadingTimeFeature.onNewArticle();
    },
    onContentRendered() {
        window.__ReadTimeFeature.onContentRendered();
        window.__MyReadingTimeFeature.onContentRendered();
    }
};
