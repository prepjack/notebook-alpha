// richcontent.js
//
// Turns a plain-text Google Sheets cell into rich HTML: headings, bold,
// bullet lists and tables via Markdown, plus three special fenced blocks:
//
//   ```mermaid            ```chart                  ```lottie
//   graph TD               {"type":"bar",             {"src":"https://.../anim.json",
//   A[Start]-->B[End]        "labels":["Q1","Q2"],      "loop":true,"height":220}
//   ```                      "data":[10,20]}          ```
//                           ```
//
// Plain Markdown images (![caption](url)) also work out of the box —
// they're turned into captioned, click-to-enlarge figures below.
//
// No new Google Sheet columns are needed — authors keep typing into the
// same definition / explanation / example cells, just using this syntax.
// See google-sheet-template/README.txt for the authoring cheatsheet.

(function () {
    let mermaidReady = false;
    let chartCounter = 0;
    let mermaidCounter = 0;
    let lottieCounter = 0;

    // Every live lottie-web instance created by renderLottieBlocks(), so a
    // fresh render pass (new topic, language/depth switch, etc.) can tear
    // down whatever animations the PREVIOUS pass started before wiping
    // container.innerHTML. Without this, replaced-away SVG animations keep
    // their internal requestAnimationFrame loop (and any ResizeObserver)
    // running forever in the background — a leak that compounds every time
    // the user opens a new topic in the same session.
    const liveLottieInstances = new Set();

    /* =========================================================
       ALPHA-PLUS — INDEX TERMS: {{Term}} auto-detection
       Runs BEFORE marked.parse()/DOMPurify, on the exact text that is
       about to be rendered (i.e. already split to the current
       language + depth block by app.js). A term is spanned only at
       its FIRST occurrence within that block; later repeats of the
       same term fall back to plain **bold** so no duplicate DOM id
       is ever created. Returned alongside the rewritten text so the
       caller (renderRichContent) can hand the term list to app.js
       for the subtopic-scoped Index tab.
       ========================================================= */

    function slugifyIndexTerm(term) {
        const base = String(term || "")
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9\s-]/g, "")
            .replace(/\s+/g, "-")
            .replace(/-+/g, "-")
            .replace(/^-|-$/g, "");
        return "term-" + (base || "entry");
    }

    function escapeIndexAttr(value) {
        return String(value)
            .replaceAll("&", "&amp;")
            .replaceAll('"', "&quot;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;");
    }

    // Returns { text, terms } — text has every {{Term}} replaced (first
    // occurrence -> <span>, repeats -> **bold**), terms is
    // [{ term, id }] in first-seen order, ready to sync/list.
    function extractIndexTerms(rawText) {
        const seenNormalized = new Map(); // normalizedTerm -> id
        const usedIds = new Set();
        const terms = [];

        const text = String(rawText || "").replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (match, rawTerm) => {
            const term = rawTerm.trim();
            if (!term) return "";

            const normalized = term.toLowerCase();

            if (seenNormalized.has(normalized)) {
                // Repeat mention of an already-spanned term this block —
                // keep it readable but don't create a second id.
                return `**${term}**`;
            }

            let id = slugifyIndexTerm(term);
            let suffix = 2;
            while (usedIds.has(id)) {
                id = `${slugifyIndexTerm(term)}-${suffix++}`;
            }
            usedIds.add(id);
            seenNormalized.set(normalized, id);
            terms.push({ term, id });

            return `<span class="rc-index-term" data-term="${escapeIndexAttr(term)}" id="${id}">${term}</span>`;
        });

        return { text, terms };
    }

    /**
     * Destroys tracked lottie-web instances whose element lives inside
     * `container` (or, with no argument, every tracked instance whose
     * element is no longer attached to the document at all — a safety net
     * for anything that slipped through). Scoped to a container, not "all
     * animations everywhere", so this stays safe to call even if this
     * renderer is ever reused for more than one on-page container at once
     * (e.g. a modal preview alongside the main content panel).
     */
    function destroyLottieAnimationsWithin(container) {
        liveLottieInstances.forEach(entry => {
            const stale = container ? container.contains(entry.wrap) : !entry.wrap.isConnected;
            if (!stale) return;
            try { if (entry.resizeObserver) entry.resizeObserver.disconnect(); } catch (_) {}
            try { if (entry.timeoutId) clearTimeout(entry.timeoutId); } catch (_) {}
            try { entry.anim.destroy(); } catch (_) {}
            liveLottieInstances.delete(entry);
        });
    }

    function ensureMermaid() {
        if (mermaidReady || typeof mermaid === "undefined") return;
        mermaid.initialize({ startOnLoad: false, theme: "neutral", securityLevel: "strict" });
        mermaidReady = true;
    }

    if (typeof marked !== "undefined") {
        marked.setOptions({ gfm: true, breaks: true, headerIds: false, mangle: false });
    }

    function defaultPalette(i) {
        const colors = ["#4f6df5", "#f59e42", "#42c76f", "#e55c8a", "#8a5cf5", "#f5c542"];
        return colors[i % colors.length];
    }

    /**
     * Builds a single, consistent {name -> value} lookup for a Drive-folder
     * asset map (used for both `assets` [filename -> URL] and `assetData`
     * [filename -> parsed JSON]). Handles the ways an author might type a
     * filename in the Markdown/```lottie source vs. how Drive/Apps Script
     * actually names the key:
     *   - exact key
     *   - ./ prefix stripped, path-prefix stripped (folder/name.json -> name.json)
     *   - URL-decoded (spaces become %20 in some flows)
     *   - case-insensitive, as a LAST-RESORT fallback only (so "Anim.JSON"
     *     typed in a Sheet cell still matches "anim.json" actually uploaded)
     */
    function buildAssetLookup(map) {
        const exact = {};
        const caseInsensitive = {};
        if (map && typeof map === "object") {
            Object.keys(map).forEach(key => {
                const value = map[key];
                if (value === undefined || value === null) return;
                const variants = new Set([key, String(key).split("/").pop()]);
                try { variants.add(decodeURIComponent(key)); } catch (_) {}
                try { variants.add(decodeURIComponent(String(key).split("/").pop())); } catch (_) {}
                variants.forEach(v => {
                    exact[v] = value;
                    caseInsensitive[v.toLowerCase()] = value;
                });
            });
        }
        return function lookup(ref) {
            if (!ref) return null;
            let r = String(ref).trim();
            try { r = decodeURIComponent(r); } catch (_) {}
            r = r.replace(/^\.\//, "");
            const bare = r.split("/").pop();
            if (Object.prototype.hasOwnProperty.call(exact, r)) return exact[r];
            if (Object.prototype.hasOwnProperty.call(exact, bare)) return exact[bare];
            const lr = r.toLowerCase();
            const lb = bare.toLowerCase();
            if (Object.prototype.hasOwnProperty.call(caseInsensitive, lr)) return caseInsensitive[lr];
            if (Object.prototype.hasOwnProperty.call(caseInsensitive, lb)) return caseInsensitive[lb];
            return null;
        };
    }

    /** True if `ref` is already a directly-fetchable absolute URL (or a data: URI). */
    function isAbsoluteUrl(ref) {
        return typeof ref === "string" && /^(https?:|data:|blob:)/i.test(ref.trim());
    }

    /**
     * Minimal shape check so a mismatched file (e.g. someone pastes an MCQ
     * export or a random JSON file as the ```lottie src) fails with a clear,
     * specific message instead of a blank box or a cryptic lottie-web error.
     */
    function looksLikeLottieJson(obj) {
        return !!obj && typeof obj === "object" && Array.isArray(obj.layers) &&
            (typeof obj.v === "string" || typeof obj.ip === "number" || typeof obj.op === "number");
    }

    /**
     * Fetches a URL and returns parsed Bodymovin JSON, or throws a specific,
     * human-readable error. Fetching (and validating) ourselves — rather than
     * handing the raw URL to lottie-web's own `path` loader — means a Google
     * Drive link that resolves to an HTML interstitial (virus-scan warning,
     * "request access" page, etc.) is reported clearly instead of silently
     * producing an empty box.
     */
    async function fetchLottieJson(url) {
        let response;
        try {
            response = await fetch(url, { cache: "no-store" });
        } catch (networkErr) {
            throw new Error("Network request for the animation file failed. Check the link and your connection.");
        }
        if (!response.ok) {
            throw new Error(`Animation file request failed (HTTP ${response.status}).`);
        }
        const raw = await response.text();
        let data;
        try {
            data = JSON.parse(raw);
        } catch (parseErr) {
            if (/^\s*<(!doctype|html)/i.test(raw)) {
                throw new Error("The link returned a webpage instead of JSON — check the file's Drive sharing is \"Anyone with the link can view\".");
            }
            throw new Error("The animation file is not valid JSON.");
        }
        return data;
    }

    /**
     * Resolves whatever the author put in a ```lottie fence into a plain
     * Bodymovin/Lottie JSON object, trying (in order):
     *   1. Inline full animation JSON (no src/path key at all)
     *   2. Drive-folder assetData match (server already parsed the JSON) —
     *      the fast, CORS-free path for "Add Content Folder" topics
     *   3. Apps Script get_drive_asset proxy URL
     *   4. Any other absolute URL (lottiefiles.com, a direct Drive/hosted link)
     *   5. Drive-folder `assets` URL fallback, if assetData didn't have it
     *      (e.g. the file wasn't valid JSON server-side, or was added after
     *      assetData was cached)
     * Throws a specific Error on failure; callers turn that into rc-error text.
     */
    async function resolveLottieAnimationData(spec, assetData, assets) {
        const source = typeof spec.src === "string" ? spec.src.trim() :
                       (typeof spec.path === "string" ? spec.path.trim() : null);

        // 1. Fully inline animation JSON — no src/path at all.
        if (!source) {
            if (looksLikeLottieJson(spec)) return spec;
            throw new Error("No \"src\" was given and this block's own JSON doesn't look like a Lottie animation (missing \"layers\").");
        }

        // 2. Drive-folder assetData: filename -> already-parsed JSON.
        const dataLookup = buildAssetLookup(assetData);
        let matched = dataLookup(source);
        if (typeof matched === "string") {
            try { matched = JSON.parse(matched); }
            catch (e) { throw new Error("Matched animation data for \"" + source + "\" is not valid JSON."); }
        }
        if (matched && typeof matched === "object") {
            if (!looksLikeLottieJson(matched)) {
                throw new Error(`"${source}" was found but doesn't look like a Lottie/Bodymovin animation file.`);
            }
            return matched;
        }

        // 3 & 4. Any URL we can fetch directly — the Apps Script proxy,
        // or any other absolute URL (lottiefiles.com, direct hosted link).
        if (isAbsoluteUrl(source)) {
            const data = await fetchLottieJson(source);
            if (!looksLikeLottieJson(data)) {
                throw new Error(`The file at that link doesn't look like a Lottie/Bodymovin animation.`);
            }
            return data;
        }

        // 5. Drive-folder `assets` URL fallback (bare filename -> URL).
        const urlLookup = buildAssetLookup(assets);
        const assetUrl = urlLookup(source);
        if (assetUrl) {
            const data = await fetchLottieJson(assetUrl);
            if (!looksLikeLottieJson(data)) {
                throw new Error(`"${source}" was found but doesn't look like a Lottie/Bodymovin animation file.`);
            }
            return data;
        }

        throw new Error(`No file named "${source}" was found in this topic's content folder. Check the filename in the \`\`\`lottie block matches exactly (case included).`);
    }

    /**
     * Resolves once layout has actually settled, instead of assuming the
     * container has its final size the instant it's inserted. Guards against
     * the box being measured mid-transition (grid column not yet resolved,
     * a still-collapsing accordion, fonts still loading) — the scenario
     * lottie-web itself can't recover from on its own at load time.
     * Resolves `true` if a non-zero size was observed, `false` on timeout
     * (caller proceeds anyway; the ResizeObserver set up after init can
     * still repair things later).
     */
    function waitForNonZeroSize(el, maxWaitMs = 1200) {
        return new Promise(resolve => {
            const start = Date.now();
            function check() {
                if (!el.isConnected) return resolve(false);
                if (el.clientWidth > 0 && el.clientHeight > 0) return resolve(true);
                if (Date.now() - start >= maxWaitMs) return resolve(false);
                requestAnimationFrame(() => setTimeout(check, 50));
            }
            check();
        });
    }

    function renderMermaidBlocks(container) {
        container.querySelectorAll("code.language-mermaid").forEach(codeEl => {
            const pre = codeEl.closest("pre");
            if (!pre) return;
            const source = codeEl.textContent;
            const holder = document.createElement("div");
            holder.className = "rc-mermaid";
            pre.replaceWith(holder);

            ensureMermaid();
            if (typeof mermaid === "undefined") {
                holder.textContent = source;
                return;
            }
            mermaidCounter += 1;
            const id = `rc-mermaid-${mermaidCounter}-${Date.now()}`;
            mermaid.render(id, source)
                .then(({ svg }) => { holder.innerHTML = svg; })
                .catch(() => {
                    holder.innerHTML = '<p class="rc-error">Could not render this diagram. Check the mermaid syntax.</p>';
                });
        });
    }

    function renderChartBlocks(container) {
        container.querySelectorAll("code.language-chart").forEach(codeEl => {
            const pre = codeEl.closest("pre");
            if (!pre) return;

            let spec;
            try {
                spec = JSON.parse(codeEl.textContent);
            } catch (err) {
                const p = document.createElement("p");
                p.className = "rc-error";
                p.textContent = "Invalid chart data (check the JSON in the ```chart block).";
                pre.replaceWith(p);
                return;
            }

            const wrap = document.createElement("div");
            wrap.className = "rc-chart";
            const canvas = document.createElement("canvas");
            chartCounter += 1;
            canvas.id = `rc-chart-${chartCounter}-${Date.now()}`;
            wrap.appendChild(canvas);
            pre.replaceWith(wrap);

            if (typeof Chart === "undefined") {
                wrap.textContent = "Chart library unavailable.";
                return;
            }

            const rawDatasets = spec.datasets || [{ label: spec.label || "", data: spec.data || [] }];
            const isPie = spec.type === "pie" || spec.type === "doughnut";

            try {
            new Chart(canvas.getContext("2d"), {
                type: spec.type || "bar",
                data: {
                    labels: spec.labels || [],
                    datasets: rawDatasets.map((ds, i) => ({
                        backgroundColor: ds.color || (isPie ? spec.labels.map((_, j) => defaultPalette(j)) : defaultPalette(i)),
                        borderColor: ds.borderColor || defaultPalette(i),
                        borderWidth: spec.type === "line" ? 2 : 1,
                        label: ds.label || "",
                        data: ds.data || []
                    }))
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: rawDatasets.length > 1 || isPie || !!spec.legend } },
                    scales: isPie ? {} : { y: { beginAtZero: true } }
                }
            });
            } catch (err) {
                wrap.textContent = "Could not render chart.";
                console.error("RichContent chart render failed", err);
            }
        });
    }

    /**
     * Renders one ```lottie block into `wrap`, given already-resolved
     * `animationData`. Handles: guaranteeing a real size before init (the
     * layout-timing fix), registering the instance for cleanup, a
     * ResizeObserver so the animation stays correctly sized through panel
     * drags / language-toggle re-renders, a load timeout, and always
     * leaving either a playing animation or a clear, visible error — never
     * a silent empty box.
     */
    async function mountLottie(wrap, spec, animationData) {
        // Guarantee the container actually has a size before lottie-web
        // measures it. lottie-web's SVG renderer bakes the container's
        // clientWidth/clientHeight into the generated <svg>'s inline style
        // at init time and does NOT re-measure on its own later — so if the
        // box happens to be 0x0 for a frame (grid columns still resolving,
        // fonts still loading, a still-collapsing parent), the animation
        // stays permanently invisible even though nothing "failed".
        const gotSize = await waitForNonZeroSize(wrap);
        if (!wrap.isConnected) return; // user navigated away while we waited

        if (!gotSize) {
            // Proceed anyway — better an animation that needs one resize
            // than nothing — but give the ResizeObserver below a real shot
            // at repairing it the moment the box does get a size.
            console.warn("[Notebook Alpha] Lottie container never reached a non-zero size before init; will retry sizing via ResizeObserver.");
        }

        let anim;
        try {
            anim = window.lottie.loadAnimation({
                container: wrap,
                renderer: "svg",
                loop: spec.loop !== false,
                autoplay: spec.autoplay !== false,
                rendererSettings: { preserveAspectRatio: "xMidYMid meet", progressiveLoad: true },
                animationData
            });
        } catch (err) {
            throw new Error("lottie-web could not start this animation: " + (err && err.message ? err.message : String(err)));
        }

        const entry = { anim, wrap, resizeObserver: null, timeoutId: null };
        liveLottieInstances.add(entry);

        // Self-heals the exact "layout-timing" scenario above, AND keeps the
        // animation correctly sized when the user drags the panel resizer
        // (STEP 2 horizontal panel resizers) or toggles language/depth,
        // both of which can change this container's width after init.
        if (typeof ResizeObserver !== "undefined") {
            let lastW = wrap.clientWidth, lastH = wrap.clientHeight;
            entry.resizeObserver = new ResizeObserver(() => {
                const w = wrap.clientWidth, h = wrap.clientHeight;
                if (w > 0 && h > 0 && (w !== lastW || h !== lastH)) {
                    lastW = w; lastH = h;
                    try { anim.resize(); } catch (_) {}
                }
            });
            entry.resizeObserver.observe(wrap);
        }

        function abandon() {
            try { if (entry.resizeObserver) entry.resizeObserver.disconnect(); } catch (_) {}
            try { anim.destroy(); } catch (_) {}
            liveLottieInstances.delete(entry);
        }

        return new Promise((resolve, reject) => {
            let settled = false;

            entry.timeoutId = setTimeout(() => {
                if (settled) return;
                settled = true;
                abandon();
                reject(new Error("Timed out waiting for the animation to load (10s). The file may be too large, or the link may be unreachable."));
            }, 10000);

            anim.addEventListener("data_failed", () => {
                if (settled) return;
                settled = true;
                clearTimeout(entry.timeoutId);
                abandon();
                reject(new Error("This JSON isn't a Lottie/Bodymovin animation lottie-web can parse."));
            });

            anim.addEventListener("DOMLoaded", () => {
                if (settled) return;
                settled = true;
                clearTimeout(entry.timeoutId);
                resolve(anim);
            });
        });
    }

    async function renderLottieBlocks(container, assetData, assets) {
        const blocks = Array.from(container.querySelectorAll("code.language-lottie"));

        for (const codeEl of blocks) {
            const pre = codeEl.closest("pre");
            if (!pre) continue;

            let spec;
            try {
                spec = JSON.parse(codeEl.textContent);
            } catch (err) {
                const p = document.createElement("p");
                p.className = "rc-error";
                p.textContent = "Invalid animation data (check the JSON in the ```lottie block).";
                pre.replaceWith(p);
                continue;
            }

            const wrap = document.createElement("div");
            wrap.className = "rc-lottie";

            // Optional CSS motion fallback for simple hand-authored Lottie JSON.
            // Usage inside the lottie fence: "motion": "float" or "motion": "pulse"
            // This is intentionally applied to the rendered SVG, not to the Lottie
            // layer data, so static vector animations remain visible and reliable.
            if (spec.motion === "float") wrap.classList.add("rc-lottie-motion-float");
            if (spec.motion === "pulse") wrap.classList.add("rc-lottie-motion-pulse");

            wrap.style.width = "100%";
            wrap.style.height = spec.height
                ? (typeof spec.height === "number" ? `${spec.height}px` : spec.height)
                : "220px"; // explicit default, not just CSS min-height, so lottie always gets a real number to measure
            lottieCounter += 1;
            wrap.id = `rc-lottie-${lottieCounter}-${Date.now()}`;
            pre.replaceWith(wrap);

            if (typeof window.lottie === "undefined") {
                wrap.innerHTML = '<p class="rc-error">Animation library failed to load. Check your connection and reload the page.</p>';
                continue;
            }

            try {
                const animationData = await resolveLottieAnimationData(spec, assetData, assets);
                await mountLottie(wrap, spec, animationData);
            } catch (err) {
                const message = err && err.message ? err.message : String(err);
                console.error("RichContent Lottie render failed:", message, { spec });
                wrap.style.height = "auto";
                wrap.classList.add("rc-lottie-error");
                wrap.innerHTML = `<p class="rc-error">⚠ Could not render this animation. ${escapeForHtml(message)}</p>`;
            }
        }
    }

    function escapeForHtml(str) {
        const div = document.createElement("div");
        div.textContent = String(str == null ? "" : str);
        return div.innerHTML;
    }

    /**
     * Wraps rendered <img> elements in a captioned, click-to-enlarge
     * figure. The Markdown alt text (![alt](url)) becomes the caption,
     * so authors get labelled study images for free — no new syntax.
     */
    function enhanceImages(container) {
        container.querySelectorAll("img").forEach(img => {
            img.setAttribute("loading", "lazy");
            img.addEventListener("click", () => window.open(img.src, "_blank"));

            const caption = img.getAttribute("alt");
            const figure = document.createElement("figure");
            figure.className = "rc-figure";
            img.replaceWith(figure);
            figure.appendChild(img);
            if (caption) {
                const figcaption = document.createElement("figcaption");
                figcaption.textContent = caption;
                figure.appendChild(figcaption);
            }
        });
    }

    /**
     * Rewrites bare-filename references (from an "Add Content Link"
     * FOLDER — see README.txt section 7) to their real fetchable URLs
     * before Markdown parsing:
     *   ![Neuron structure](neuron.png)   ->  ![Neuron structure](https://...)
     *   ```lottie
     *   {"src":"mitosis.json", ...}       ->  {"src":"https://...", ...}
     *   ```
     * A reference that's already a full URL (http/https/data:) is left
     * untouched, and a filename with no matching asset is left as-is too
     * (it just won't resolve — same as a typo in any other markdown link).
     */
    function resolveAssetRefs(text, assets) {
        if (!assets || typeof assets !== "object" || !Object.keys(assets).length) return text;

        // Same normalized filename matching used for ```lottie assets below
        // (exact / bare / decoded / case-insensitive fallback) — see
        // buildAssetLookup() — so an author typing a filename doesn't get
        // silently different behavior for an image vs. an animation.
        const lookupAsset = buildAssetLookup(assets);
        function lookup(ref) {
            if (!ref) return null;
            if (isAbsoluteUrl(ref)) return ref.trim();
            return lookupAsset(ref);
        }

        let out = text.replace(/(!\[[^\]]*]\()([^\)\s]+)(\))/g, (whole, pre, ref, post) => {
            const url = lookup(ref);
            return url ? `${pre}${url}${post}` : whole;
        });

        // IMPORTANT: Do NOT rewrite the src/path inside a lottie fence here.
        // Unlike images, Lottie can use the original filename to look up the
        // parsed JSON object in assetData. Rewriting it to an Apps Script URL
        // loses that filename and makes the lookup dependent on URL matching.
        // renderLottieBlocks() resolves filenames through assets when needed.

        return out;
    }

    /**
     * Renders `raw` markdown text (optionally with ```mermaid / ```chart /
     * ```lottie fences, and/or Markdown images) into `container`, a DOM
     * element. `assets` is an optional {filename: url} map — see
     * resolveAssetRefs() above — for content loaded from a Drive folder.
     */
    function renderRichContent(raw, container, assets, assetData) {
        if (!container) return;

        // Tear down any lottie-web instances from the content this
        // container is ABOUT to lose (topic switch, language/depth toggle,
        // re-render) before wiping it out. Without this, each replaced
        // animation's internal render loop (and its ResizeObserver) keeps
        // running in the background indefinitely — a leak that grows with
        // every topic the user opens in the same session.
        destroyLottieAnimationsWithin(container);

        const resolvedText = resolveAssetRefs(String(raw || "").trim(), assets);

        if (!resolvedText) {
            container.innerHTML = "";
            window.lastRenderedIndexTerms = [];
            return;
        }

        if (typeof marked === "undefined" || typeof DOMPurify === "undefined") {
            container.textContent = resolvedText; // safe fallback if a CDN script failed to load
            window.lastRenderedIndexTerms = [];
            return;
        }

        // {{Term}} -> <span class="rc-index-term" ...> (first occurrence
        // only). window.lastRenderedIndexTerms is read by app.js right
        // after this call to sync/list terms for the subtopic-scoped
        // Index tab — see ALPHA-PLUS INDEX TERMS in app.js.
        const { text, terms } = extractIndexTerms(resolvedText);
        window.lastRenderedIndexTerms = terms;

        const html = marked.parse(text);
        container.innerHTML = DOMPurify.sanitize(html, { ADD_ATTR: ["target", "data-term"] });

        container.querySelectorAll("a[href]").forEach(a => {
            a.setAttribute("target", "_blank");
            a.setAttribute("rel", "noopener noreferrer");
        });

        renderMermaidBlocks(container);
        renderChartBlocks(container);
        renderLottieBlocks(container, assetData, assets).catch(err => console.error("RichContent Lottie block processing failed", err));
        enhanceImages(container);
    }

    window.renderRichContent = renderRichContent;
    // Exposed so app.js's manual right-click "Mark as index term" can
    // generate ids the exact same way as the {{Term}} auto-detection above
    // (and avoid colliding with an id already used on the page).
    window.slugifyIndexTerm = slugifyIndexTerm;
})();
