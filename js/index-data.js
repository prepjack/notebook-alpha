/* =========================================================
   INDEX DATA — shared registry / dedup module
   (Redesign spec: "Alpha Website — Redesign and Strengthen the
   Index System", phases 2-3)

   Used by BOTH js/app.js (main notebook's in-panel Index tab)
   and js/index-directory.js (standalone Index directory page),
   loaded via a <script> tag before either of them. This is now
   the single place term-building/dedup logic lives — neither
   page duplicates it any more.

   Two possible sources, tried in this order:

   1. SERVER REGISTRY — if the loaded data includes indexTerms
      (from the Apps Script "Index_Terms" sheet) and indexLinks
      (from "Index_Node"), those are canonical: every term has a
      real, stable index_id and can be linked to zero, one, or
      many tree nodes (many-to-many, per spec section 7/8). A
      term with zero links is a legitimate concept-only entry
      (spec section 5) — it is still shown, just with nothing to
      navigate to yet.

   2. LOCAL FALLBACK — if no server registry is present (local
      JSON / STUDY_DATA_FALLBACK, or an older Apps Script that
      hasn't added the new sheets yet), entries are derived
      exactly the way the Index always worked: every node's own
      title, plus its "index_terms" aliases. IDs are generated
      client-side only (prefixed "local:") purely so the rest of
      the UI can treat both sources identically — they are never
      persisted and never shown to the user (spec section 15).

   Either way, every consumer gets the same shape back:

       { indexId, term, normalizedTerm, matches: [
           { nodeId, nodeTitle, isAlias, sourceType }
       ]}

   which is a superset of the old { term, matches } shape, so
   existing render code needed no restructuring — only the
   dedup KEY changed, from a raw lowercase string to
   normalizeTerm() (spec section 4: whitespace/case no longer
   creates duplicate entries).
   ========================================================= */

function normalizeTerm(term) {
    return String(term || "")
        .trim()
        .replace(/\s+/g, " ")
        .toLowerCase();
}

let indexRegistryCache = null;

function getIndexRegistry() {
    if (!indexRegistryCache) {
        indexRegistryCache = buildIndexRegistry(window.__studyData || {});
    }
    return indexRegistryCache;
}

function invalidateIndexRegistry() {
    indexRegistryCache = null;
}

function filterIndexRegistry(filterText = "") {
    const groups = getIndexRegistry();
    if (!filterText) return groups;

    const needle = normalizeTerm(filterText);
    return groups.filter(g => g.normalizedTerm.includes(needle));
}

function buildIndexRegistry(data) {
    const hasServerRegistry = Array.isArray(data.indexTerms) && data.indexTerms.length > 0;

    return hasServerRegistry
        ? buildRegistryFromServer(data)
        : buildRegistryFromTree(data);
}

/* ---- Source 1: canonical Index_Terms + Index_Node sheets ---- */

function buildRegistryFromServer(data) {
    const byId = new Map();
    // Defensive: two Index_Terms rows can end up with the same
    // normalized_term (e.g. an old race between two near-simultaneous
    // sync requests, before sync_index_terms_bulk's single-Lock write
    // existed) — normalizedTerm -> indexId lets a second such row
    // merge into the first instead of showing as a separate entry.
    const idByNormalized = new Map();
    // Every raw row's OWN index_id -> whichever canonical id it merged
    // into, so Index_Node links (which still reference the original,
    // possibly-duplicate index_id) resolve to the merged entry below.
    const canonicalByRawId = new Map();

    (data.indexTerms || []).forEach(row => {
        const indexId = String(row.index_id);
        if (!indexId || !row.term) return;

        const normalizedTerm = row.normalized_term || normalizeTerm(row.term);
        const canonicalId = idByNormalized.get(normalizedTerm) || indexId;
        idByNormalized.set(normalizedTerm, canonicalId);
        canonicalByRawId.set(indexId, canonicalId);

        if (!byId.has(canonicalId)) {
            byId.set(canonicalId, {
                indexId: canonicalId,
                term: row.term,
                normalizedTerm,
                matches: []
            });
        }
    });

    // node_id -> title lookup, so a link can show a human-readable
    // node title even though Index_Node only stores the node_id.
    const titleByNode = {};
    (function collectTitles(nodes) {
        (nodes || []).forEach(n => {
            titleByNode[n.id] = n.title;
            collectTitles(n.children);
        });
    })(data.subjects);

    (data.indexLinks || []).forEach(link => {
        const canonicalId = canonicalByRawId.get(String(link.index_id));
        const entry = canonicalId ? byId.get(canonicalId) : null;
        const nodeId = link.node_id;
        if (!entry || !nodeId) return; // term with no node yet is fine — spec section 5

        if (!entry.matches.some(m => m.nodeId === nodeId)) {
            entry.matches.push({
                nodeId,
                nodeTitle: titleByNode[nodeId] || nodeId,
                isAlias: link.source_type === "alias",
                sourceType: link.source_type || "tree"
            });
        }
    });

    return [...byId.values()]
        .sort((a, b) => a.term.localeCompare(b.term, undefined, { sensitivity: "base" }));
}

/* ---- Source 2: legacy behaviour — derive straight from the tree ---- */

function buildRegistryFromTree(data) {
    const rawEntries = [];

    function walk(nodes) {
        (nodes || []).forEach(node => {
            const title = (node.title || "").trim();
            if (title) {
                rawEntries.push({ term: title, nodeId: node.id, nodeTitle: node.title, isAlias: false });
            }

            const aliasRaw = node.content && node.content.index_terms;
            if (aliasRaw) {
                String(aliasRaw)
                    .split(/[,\n]/)
                    .map(x => x.trim())
                    .filter(Boolean)
                    .forEach(alias => {
                        if (normalizeTerm(alias) !== normalizeTerm(title)) {
                            rawEntries.push({ term: alias, nodeId: node.id, nodeTitle: node.title, isAlias: true });
                        }
                    });
            }

            walk(node.children);
        });
    }

    walk(data.subjects);

    const byNormalized = new Map();
    let counter = 0;

    rawEntries.forEach(e => {
        const key = normalizeTerm(e.term);
        if (!key) return;

        if (!byNormalized.has(key)) {
            counter += 1;
            byNormalized.set(key, {
                indexId: `local:${counter}`,
                term: e.term,
                normalizedTerm: key,
                matches: []
            });
        }

        const entry = byNormalized.get(key);
        if (!entry.matches.some(m => m.nodeId === e.nodeId)) {
            entry.matches.push({ nodeId: e.nodeId, nodeTitle: e.nodeTitle, isAlias: e.isAlias, sourceType: e.isAlias ? "alias" : "tree" });
        }
    });

    return [...byNormalized.values()].sort((a, b) =>
        a.term.localeCompare(b.term, undefined, { sensitivity: "base" })
    );
}
