// richcontent.js
//
// Turns a plain-text Google Sheets cell into rich HTML: headings, bold,
// bullet lists and tables via Markdown, plus two special fenced blocks:
//
//   ```mermaid            ```chart
//   graph TD               {"type":"bar",
//   A[Start]-->B[End]        "labels":["Q1","Q2"],
//   ```                      "data":[10,20]}
//                           ```
//
// No new Google Sheet columns are needed — authors keep typing into the
// same definition / explanation / example cells, just using this syntax.
// See google-sheet-template/README.txt for the authoring cheatsheet.

(function () {
    let mermaidReady = false;
    let chartCounter = 0;
    let mermaidCounter = 0;

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
        });
    }

    /**
     * Renders `raw` markdown text (optionally with ```mermaid / ```chart
     * fences) into `container`, a DOM element.
     */
    function renderRichContent(raw, container) {
        if (!container) return;
        const text = String(raw || "").trim();

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
    }

    window.renderRichContent = renderRichContent;
})();
