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
            if (spec.height) wrap.style.height = typeof spec.height === "number" ? `${spec.height}px` : spec.height;
            lottieCounter += 1;
            wrap.id = `rc-lottie-${lottieCounter}-${Date.now()}`;
            pre.replaceWith(wrap);

            const source = typeof spec.src === "string" ? spec.src.trim() :
                           (typeof spec.path === "string" ? spec.path.trim() : null);
            const resolvedSource = (source && assets && typeof assets === "object" && assets[source])
                ? assets[source]
                : source;

            // Compact on-page diagnostics. These are intentionally visible for the
            // current isolation phase so the Drive/assetData break point can be
            // identified without guessing from a blank box.
            const debug = {
                source: source || "(none)",
                lottieLoaded: typeof window.lottie !== "undefined",
                assetDataKeys: assetData && typeof assetData === "object" ? Object.keys(assetData) : [],
                assetKeys: assets && typeof assets === "object" ? Object.keys(assets) : [],
                matchedKey: null,
                dataType: null,
                dataSize: null,
                path: null,
                error: null
            };

            function showDebug() {
                const old = wrap.querySelector(".rc-lottie-debug");
                if (old) old.remove();
                const panel = document.createElement("div");
                panel.className = "rc-lottie-debug";
                panel.textContent = [
                    "Lottie diagnostic",
                    `source: ${debug.source}`,
                    `lottie loaded: ${debug.lottieLoaded ? "YES" : "NO"}`,
                    `assetData keys: ${debug.assetDataKeys.length ? debug.assetDataKeys.join(", ") : "(none)"}`,
                    `assets keys: ${debug.assetKeys.length ? debug.assetKeys.join(", ") : "(none)"}`,
                    `matched key: ${debug.matchedKey || "NO MATCH"}`,
                    `data type: ${debug.dataType || "(none)"}`,
                    `data size: ${debug.dataSize == null ? "(unknown)" : debug.dataSize + " chars"}`,
                    `render path: ${debug.path || "(not reached)"}`,
                    debug.error ? `error: ${debug.error}` : ""
                ].filter(Boolean).join("\n");
                wrap.appendChild(panel);
            }

            console.groupCollapsed("[Notebook Alpha] Lottie diagnostic");
            console.log("spec", spec);
            console.log("source", source);
            console.log("assetData keys", debug.assetDataKeys);
            console.log("assets keys", debug.assetKeys);

            if (!debug.lottieLoaded) {
                debug.error = "lottie-web library unavailable";
                console.error(debug.error);
                console.groupEnd();
                showDebug();
                continue;
            }

            try {
                let directData = null;

                if (source && assetData && typeof assetData === "object") {
                    // Exact filename first.
                    if (Object.prototype.hasOwnProperty.call(assetData, source)) {
                        debug.matchedKey = source;
                        directData = assetData[source];
                    }

                    // Normalized filename fallback.
                    if (!directData) {
                        const cleanSource = source.replace(/^\.\//, "");
                        const matched = Object.keys(assetData).find(key => {
                            const cleanKey = String(key).replace(/^\.\//, "");
                            return cleanKey === cleanSource || decodeURIComponent(cleanKey) === decodeURIComponent(cleanSource);
                        });
                        if (matched) {
                            debug.matchedKey = matched;
                            directData = assetData[matched];
                        }
                    }
                }

                // Some API layers may accidentally return the animation as a JSON string.
                // Accept both forms, but never silently pass a string to lottie-web.
                if (typeof directData === "string") {
                    try { directData = JSON.parse(directData); }
                    catch (parseError) { throw new Error("Matched assetData is a string but is not valid JSON: " + parseError.message); }
                }

                debug.dataType = directData === null ? "null" : Array.isArray(directData) ? "array" : typeof directData;
                if (directData && typeof directData === "object") {
                    try { debug.dataSize = JSON.stringify(directData).length; } catch (_) {}
                    console.log("matched animationData", directData);
                    debug.path = "assetData";

                    const anim = window.lottie.loadAnimation({
                        container: wrap,
                        renderer: "svg",
                        loop: spec.loop !== false,
                        autoplay: spec.autoplay !== false,
                        animationData: directData
                    });

                    anim.addEventListener("data_failed", () => {
                        debug.error = "lottie data_failed event";
                        console.error(debug.error);
                        showDebug();
                    });
                    anim.addEventListener("data_ready", () => {
                        debug.path = "assetData → data_ready";
                        showDebug();
                    });
                    anim.addEventListener("DOMLoaded", () => {
                        debug.path = "assetData → DOMLoaded";
                        showDebug();
                    });
                    console.groupEnd();
                    showDebug();
                    continue;
                }

                // If inline assetData is absent, use the existing Apps Script proxy.
                if (resolvedSource && /[?&]action=get_drive_asset(?:&|$)/i.test(resolvedSource)) {
                    debug.path = "Apps Script proxy fetch";
                    console.log("proxy URL", resolvedSource);
                    const response = await fetch(resolvedSource, { cache: "no-store" });
                    if (!response.ok) throw new Error(`Asset request failed (${response.status})`);
                    const payload = await response.json();
                    console.log("proxy payload", payload);
                    if (!payload || !payload.ok || !payload.data) {
                        throw new Error((payload && payload.error) || "Invalid JSON asset response");
                    }
                    debug.dataType = typeof payload.data;
                    try { debug.dataSize = JSON.stringify(payload.data).length; } catch (_) {}
                    const anim = window.lottie.loadAnimation({
                        container: wrap,
                        renderer: "svg",
                        loop: spec.loop !== false,
                        autoplay: spec.autoplay !== false,
                        animationData: payload.data
                    });
                    anim.addEventListener("data_failed", () => { debug.error = "lottie data_failed event"; showDebug(); });
                    anim.addEventListener("DOMLoaded", () => { debug.path = "Apps Script proxy → DOMLoaded"; showDebug(); });
                    console.groupEnd();
                    showDebug();
                    continue;
                }

                // Hosted URL mode (used by the isolation test) remains supported.
                if (resolvedSource) {
                    debug.path = "hosted URL path";
                    const anim = window.lottie.loadAnimation({
                        container: wrap,
                        renderer: "svg",
                        loop: spec.loop !== false,
                        autoplay: spec.autoplay !== false,
                        path: resolvedSource
                    });
                    anim.addEventListener("data_failed", () => { debug.error = "lottie data_failed event"; showDebug(); });
                    anim.addEventListener("DOMLoaded", () => { debug.path = "hosted URL → DOMLoaded"; showDebug(); });
                    console.groupEnd();
                    showDebug();
                    continue;
                }

                // Inline full animation object in the Markdown block.
                debug.path = "inline spec";
                const anim = window.lottie.loadAnimation({
                    container: wrap,
                    renderer: "svg",
                    loop: spec.loop !== false,
                    autoplay: spec.autoplay !== false,
                    animationData: spec
                });
                anim.addEventListener("data_failed", () => { debug.error = "lottie data_failed event"; showDebug(); });
                anim.addEventListener("DOMLoaded", () => { debug.path = "inline spec → DOMLoaded"; showDebug(); });
                console.groupEnd();
                showDebug();
            } catch (err) {
                debug.error = err && err.message ? err.message : String(err);
                wrap.innerHTML = '<p class="rc-error">Could not render animation.</p>';
                console.error("RichContent Lottie render failed", err);
                console.groupEnd();
                showDebug();
            }
        }
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

        // Asset keys come from Drive file names. Markdown authors may refer
        // to the same file as a bare name, URL-encoded name, or ./name.
        const normalized = {};
        Object.keys(assets).forEach(key => {
            const value = assets[key];
            if (!value) return;
            const cleanKey = String(key).split("/").pop();
            normalized[key] = value;
            normalized[cleanKey] = value;
            try { normalized[decodeURIComponent(cleanKey)] = value; } catch (_) {}
        });

        function lookup(ref) {
            if (!ref) return null;
            let r = String(ref).trim();
            try { r = decodeURIComponent(r); } catch (_) {}
            r = r.replace(/^\.\//, "");
            if (/^(https?:|data:|blob:)/i.test(r)) return r;
            return normalized[r] || normalized[r.split("/").pop()] || null;
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
        const text = resolveAssetRefs(String(raw || "").trim(), assets);

        if (!text) {
            container.innerHTML = "";
            return;
        }

        if (typeof marked === "undefined" || typeof DOMPurify === "undefined") {
            container.textContent = text; // safe fallback if a CDN script failed to load
            return;
        }

        const html = marked.parse(text);
        container.innerHTML = DOMPurify.sanitize(html, { ADD_ATTR: ["target"] });

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
})();
