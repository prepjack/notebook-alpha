// event-log.js — Phase 0, Part B (see phase-0-foundation.md)
//
// A small, invisible, append-only history of user activity: reads,
// flashcard reviews, MCQ attempts. Nothing reads from this yet — it
// exists purely so later phases (Queue view stats, Plan Today
// auto-completion, streaks, "last read X days ago") have real data
// from day one instead of an empty log to backfill.
//
// Contract:
//   - Append-only. Nothing here ever edits or deletes a past entry,
//     except compactEventLog() folding OLD entries into daily summary
//     rows (see step 5 in the spec) — and that isn't wired to run
//     automatically yet.
//   - `id` is globally unique per event, which is what makes merging
//     trivial: two devices' logs union by `id` with no conflict
//     resolution needed (unlike the dueAt merge-wins-by-timestamp logic
//     flashcards.js uses for card state).
//   - A failure here must never block the action that triggered it —
//     a review or a read should never fail because logging failed.
//
// Load order: must load after js/progress-sync.js (so registration
// below succeeds) on any page that has both. See index.html /
// practice.html script order. Pages without progress-sync.js (today:
// mcq.html) still log fine locally; those events sync up whenever the
// same browser next opens a page that does load progress-sync.js,
// since localStorage is shared across pages on the same origin.
(function () {
    const STORAGE_KEY = "eventLog";

    // ---------- storage ----------
    function readLog() {
        let raw;
        try {
            raw = localStorage.getItem(STORAGE_KEY);
        } catch (err) {
            return []; // storage blocked (private mode, quota, etc.)
        }
        if (!raw) return [];
        try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch (err) {
            console.warn("[Notebook Alpha] eventLog was corrupt JSON; resetting to [].", err);
            try { localStorage.setItem(STORAGE_KEY, "[]"); } catch (e) { /* storage blocked */ }
            return [];
        }
    }

    function writeLog(log) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(log));
        } catch (err) {
            console.warn("[Notebook Alpha] Could not persist eventLog.", err);
        }
    }

    // ---------- the one public write path ----------
    // logEvent('read', topicId, {secs})
    // logEvent('card', topicId, {cardId, correct, boxFrom, boxTo})
    // logEvent('mcq', topicId, {questionId, correct})
    function logEvent(type, topicId, extra) {
        try {
            const event = Object.assign(
                {
                    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                    t: Date.now(),
                    type: String(type || ""),
                    topicId: String(topicId || "")
                },
                extra || {}
            );
            const log = readLog();
            log.push(event);
            writeLog(log);
            return event;
        } catch (err) {
            // Never let logging break the action that triggered it.
            console.warn("[Notebook Alpha] logEvent failed (the action itself still completed).", err);
            return null;
        }
    }

    // ---------- merge (immutable entries => union by id) ----------
    function mergeEventLogs(localLog, remoteLog) {
        const byId = new Map();
        (Array.isArray(localLog) ? localLog : []).forEach(e => { if (e && e.id) byId.set(e.id, e); });
        (Array.isArray(remoteLog) ? remoteLog : []).forEach(e => { if (e && e.id) byId.set(e.id, e); });
        return Array.from(byId.values()).sort((a, b) => a.t - b.t);
    }

    // ---------- compaction (built now, not wired to run yet) ----------
    // Folds events older than `olderThanDays` into one daily summary row
    // per topic per type, discarding the individual events. Not called
    // automatically anywhere yet — Phase 4/5 will decide when to trigger
    // this once there are real consumers and real accumulated data.
    function compactEventLog(log, olderThanDays) {
        const days = olderThanDays == null ? 90 : olderThanDays;
        const cutoff = Date.now() - days * 86400000;
        const list = Array.isArray(log) ? log : [];
        const old = list.filter(e => e && e.t < cutoff);
        const recent = list.filter(e => e && e.t >= cutoff);

        const dailyTotals = new Map(); // key: `${topicId}|${type}|${day}`
        old.forEach(e => {
            const day = new Date(e.t).toISOString().slice(0, 10);
            const key = `${e.topicId}|${e.type}|${day}`;
            const bucket = dailyTotals.get(key) || { topicId: e.topicId, type: e.type, day, count: 0, secs: 0, correct: 0 };
            bucket.count += 1;
            if (e.type === "read") bucket.secs += Number(e.secs) || 0;
            if (e.correct) bucket.correct += 1;
            dailyTotals.set(key, bucket);
        });

        const summaries = Array.from(dailyTotals.values()).map(b => Object.assign({}, b, { compacted: true }));
        return summaries.concat(recent);
    }

    // ---------- ProgressSync integration ----------
    // ProgressSync's convention (see progress-sync.js) is:
    //   export() -> plain object map { id: entry }
    //   merge(remoteMap) -> number of local entries added/updated
    // The event log is naturally an array, so we map it to {id: entry}
    // on the way out/in. ProgressSync's generic "how many entries has
    // the server not seen yet" helper (entryTs) looks for a `ts` (or
    // `lastReviewed`) field on each entry for its staleness estimate —
    // events use `t` instead, so we mirror it into `ts` on export only,
    // purely so sync's status messages ("N entries sent") stay accurate.
    // The actual merge logic (mergeEventLogs above) is id-based and
    // never looks at ts/lastReviewed at all.
    function exportForSync() {
        const map = {};
        readLog().forEach(e => {
            if (e && e.id) map[e.id] = Object.assign({}, e, { ts: e.t });
        });
        return map;
    }

    function mergeFromSync(remoteMap) {
        if (!remoteMap || typeof remoteMap !== "object") return 0;
        const local = readLog();
        const localIds = new Set(local.map(e => e.id));
        const remoteLog = Object.keys(remoteMap)
            .map(id => {
                const e = remoteMap[id] || {};
                const clean = Object.assign({}, e);
                delete clean.ts; // that was only ever a sync-export mirror of `t`
                return clean;
            })
            .filter(e => e && e.id && e.type && e.t);
        writeLog(mergeEventLogs(local, remoteLog));
        return remoteLog.filter(e => !localIds.has(e.id)).length;
    }

    window.EventLog = {
        logEvent,
        readLog,
        mergeEventLogs,
        compactEventLog,
        exportForSync,
        mergeFromSync
    };

    if (window.ProgressSync && typeof window.ProgressSync.register === "function") {
        window.ProgressSync.register("eventLog", { export: exportForSync, merge: mergeFromSync });
    }

    // Exposed for tests only; harmless in production (mirrors the
    // pattern flashcards.js already uses for its __test surface).
    window.EventLog.__test = { readLog, writeLog };
})();
