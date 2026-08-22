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

    window.ReadingTools = { onNewArticle, onContentRendered };
})();
