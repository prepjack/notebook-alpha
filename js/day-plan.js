// day-plan.js — Phase 5 (see phase-5-day-plan-v1.md)
//
// SMART Day Plan v1: data model, time estimates, suggestions, and
// live/evening progress — kept as its own module (like event-log.js
// and flashcards.js) rather than folded into practice.js, since it's a
// self-contained data layer with its own storage key and its own
// ProgressSync registration, and practice.js already does enough just
// rendering the three views.
//
// Contract:
//   - Plan data is kept SEPARATE from the event log: a plan stores
//     INTENT (what was chosen for today), the event log stores what
//     ACTUALLY happened. A measurable item's `completed` flag is never
//     trusted — getItemProgress() always recomputes live from the
//     event log, so the two can never drift out of sync (this is the
//     explicit reason the spec keeps them apart, not an oversight).
//   - Load order: after progress-sync.js, event-log.js and
//     flashcards.js (reads window.EventLog.readLog() and
//     window.Flashcards.getDueSummary()), before practice.js (which
//     renders off window.DayPlan). See practice.html's script order.
(function () {
    const STORAGE_KEY = "dayPlans"; // { [dateString]: planRecord }

    /* -----------------------------------------------------
       Storage
       ----------------------------------------------------- */
    function readStore() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            const parsed = raw ? JSON.parse(raw) : {};
            return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
        } catch (err) {
            return {}; // fail closed: today just looks like a fresh, unplanned day
        }
    }
    function writeStore(store) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
        } catch (err) {
            console.warn("[Notebook Alpha] Could not save the day plan.", err);
        }
        if (window.ProgressSync && typeof window.ProgressSync.markDirty === "function") {
            window.ProgressSync.markDirty();
        }
        try { window.dispatchEvent(new CustomEvent("day-plan-changed")); } catch (err) { /* very old browser: no live refresh */ }
    }

    function dateStringOf(d) {
        return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    }
    function getTodayDateString() {
        return dateStringOf(new Date());
    }
    function startOfDayMs(dateStr) {
        const d = new Date(dateStr + "T00:00:00");
        return d.getTime();
    }

    function getDayPlan(dateStr) {
        return readStore()[dateStr] || null;
    }

    function newItemId() {
        return "item-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
    }

    /* -----------------------------------------------------
       Time estimates (section 3)

       Defaults, documented here rather than buried in code:
         - DEFAULT_SECS_PER_CARD (15s) and DEFAULT_SECS_PER_MCQ (60s)
           are deliberately simple, fixed ballpark figures, not a
           computed average — the event log currently records a card
           review as {cardId, correct, boxFrom, boxTo} and an MCQ
           attempt as {questionId, correct}, neither with a timing
           field, so there is no real per-item duration to blend
           toward yet (only 'read' events carry `secs`). Rather than
           add new timing-capture code to flashcards.js/mcq.js's review
           loops for this, Plan Today just labels these two estimates
           as rough/approximate in the UI (see the "~" prefix below and
           practice.js's plan card copy) until a future phase decides
           real per-card/per-MCQ timing is worth adding.
         - The read estimate DOES blend toward a real average, since
           'read' events already carry `secs`: it starts at
           DEFAULT_READ_SECS and shifts toward the true average as more
           history accumulates, weighted so a handful of reads can't
           swing it wildly (see blendedAverage's prior-weight comment).
       ----------------------------------------------------- */
    const DEFAULT_SECS_PER_CARD = 15;   // a quick flip-and-judge
    const DEFAULT_SECS_PER_MCQ = 60;    // read the question, think, answer
    const DEFAULT_READ_SECS = 180;      // ~3 minutes: a typical short topic
    const READ_AVG_PRIOR_WEIGHT = 5;    // shrinkage: like 5 "phantom" reads at the default

    function getAverageReadSpeedSecs() {
        const secsList = (window.EventLog ? window.EventLog.readLog() : [])
            .filter(e => e && e.type === "read" && Number(e.secs) > 0)
            .map(e => Number(e.secs));
        if (!secsList.length) return DEFAULT_READ_SECS;
        const avg = secsList.reduce((a, b) => a + b, 0) / secsList.length;
        return Math.round((DEFAULT_READ_SECS * READ_AVG_PRIOR_WEIGHT + avg * secsList.length) / (READ_AVG_PRIOR_WEIGHT + secsList.length));
    }

    function estimateSecs(type, topicId, targetCount) {
        if (type === "read") return getAverageReadSpeedSecs();
        if (type === "flashcards") return (Number(targetCount) || 0) * DEFAULT_SECS_PER_CARD;
        if (type === "mcq") return (Number(targetCount) || 0) * DEFAULT_SECS_PER_MCQ;
        return 0; // custom: no auto-estimate
    }

    function makeItem(type, topicId, targetCount, label) {
        return {
            id: newItemId(),
            type: type,
            topicId: topicId || null,
            targetCount: targetCount == null ? null : Number(targetCount),
            estimateSecs: estimateSecs(type, topicId, targetCount),
            label: label || "",
            completed: false
        };
    }

    /* -----------------------------------------------------
       Auto-completion (section 5) — always computed live from the
       event log, never from a stored flag, for measurable types.
       ----------------------------------------------------- */
    function getItemProgress(item, dateStr) {
        if (!item) return 0;
        if (item.type === "custom") return item.completed ? 1 : 0;
        const from = startOfDayMs(dateStr || getTodayDateString());
        const to = from + 86400000;
        const logType = item.type === "flashcards" ? "card" : item.type;
        const events = (window.EventLog ? window.EventLog.readLog() : []).filter(e =>
            e && e.type === logType && e.t >= from && e.t < to &&
            (item.topicId ? e.topicId === item.topicId : true)
        );
        if (item.type === "read") {
            const secs = events.reduce((sum, e) => sum + (Number(e.secs) || 0), 0);
            return item.estimateSecs > 0 ? Math.min(1, secs / item.estimateSecs) : (secs > 0 ? 1 : 0);
        }
        return item.targetCount ? Math.min(1, events.length / item.targetCount) : (events.length > 0 ? 1 : 0);
    }

    function planTotalSecs(items) {
        return (items || []).reduce((sum, it) => sum + (Number(it.estimateSecs) || 0), 0);
    }

    /* -----------------------------------------------------
       Suggested items (section 4) — pre-filled drafts only, never
       auto-locked in. Pulls from:
         1. Today's own plan, for anything not yet completed (carried
            over rather than lost when the day rolls over).
         2. window.Flashcards.getDueSummary() for the most-overdue deck.
         3. The Read-queue gap-ladder logic Phase 4 already built
            (window.PracticeTools.readGapState), for a Continue/Revisit
            topic — reused, not reimplemented, per the project's
            standing "don't duplicate aggregation/priority logic"
            pattern from Phase 3 onward.
       Capped at 3 total, same cap the plan itself enforces.
       ----------------------------------------------------- */
    function suggestTomorrowItems() {
        const suggestions = [];

        const today = getDayPlan(getTodayDateString());
        if (today && Array.isArray(today.items)) {
            today.items.forEach(item => {
                if (suggestions.length >= 3) return;
                if (item.type === "custom") return; // manual items don't auto-carry-over
                if (getItemProgress(item, today.date) < 1) {
                    suggestions.push(Object.assign({}, item, { id: newItemId(), completed: false }));
                }
            });
        }

        if (suggestions.length < 3 && window.Flashcards && typeof window.Flashcards.getDueSummary === "function") {
            const dueSummary = window.Flashcards.getDueSummary();
            const already = new Set(suggestions.filter(s => s.type === "flashcards").map(s => s.topicId));
            const overdue = Object.keys(dueSummary.topics || {})
                .filter(id => !already.has(id))
                .map(id => ({ id: id, dueNow: (dueSummary.topics[id].overdue || 0) + (dueSummary.topics[id].dueToday || 0) }))
                .filter(t => t.dueNow > 0)
                .sort((a, b) => b.dueNow - a.dueNow);
            if (overdue.length) suggestions.push(makeItem("flashcards", overdue[0].id, Math.min(overdue[0].dueNow, 20)));
        }

        if (suggestions.length < 3 && window.PracticeTools && typeof window.PracticeTools.readGapState === "function" && typeof window.PracticeTools.getAllLeafIds === "function") {
            const already = new Set(suggestions.filter(s => s.type === "read").map(s => s.topicId));
            const leafIds = window.PracticeTools.getAllLeafIds();
            const candidate = leafIds
                .filter(id => !already.has(id))
                .map(id => ({ id: id, gap: window.PracticeTools.readGapState(id) }))
                .find(x => x.gap.state === "revisit" || x.gap.state === "continue");
            if (candidate) suggestions.push(makeItem("read", candidate.id, null));
        }

        return suggestions.slice(0, 3);
    }

    /* -----------------------------------------------------
       Writing a plan
       ----------------------------------------------------- */
    function emptyPlan(dateStr) {
        return { date: dateStr, items: [], morningConfirmedAt: null, eveningReflection: null, tomorrowPlan: [], updatedAt: 0 };
    }

    function saveDayPlan(dateStr, patch) {
        const store = readStore();
        const current = store[dateStr] || emptyPlan(dateStr);
        const next = Object.assign({}, current, patch, { date: dateStr, updatedAt: Date.now() });
        store[dateStr] = next;
        writeStore(store);
        return next;
    }

    // Night mode calls this once the day rolls over: today's plan
    // becomes yesterday's tomorrowPlan draft, confirmed or not.
    function rollOverIfNeeded() {
        const todayStr = getTodayDateString();
        const store = readStore();
        if (store[todayStr]) return store[todayStr]; // already rolled over
        // Find the most recent plan that HAS a tomorrowPlan draft and isn't today.
        const dates = Object.keys(store).filter(d => d < todayStr).sort();
        const lastDate = dates[dates.length - 1];
        const draft = lastDate && store[lastDate] && Array.isArray(store[lastDate].tomorrowPlan) ? store[lastDate].tomorrowPlan : [];
        return saveDayPlan(todayStr, { items: draft.map(it => Object.assign({}, it, { completed: false })), morningConfirmedAt: null });
    }

    /* -----------------------------------------------------
       Soft consistency (section 6) — "X of the last 7 days had at
       least one completed item", never a hard streak that resets to
       zero on a single miss.
       ----------------------------------------------------- */
    function consistencyLast7Days() {
        const store = readStore();
        const today = new Date();
        let completedDays = 0;
        for (let i = 0; i < 7; i++) {
            const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
            const key = dateStringOf(d);
            const plan = store[key];
            if (plan && Array.isArray(plan.items) && plan.items.some(it => getItemProgress(it, key) >= 1)) completedDays++;
        }
        return { completedDays: completedDays, of: 7 };
    }

    // Header pill (section 7): completed vs total measurable+custom
    // items in TODAY's plan, regardless of which of the three tabs is
    // currently open — practice.js polls this on every render.
    function todayPillState() {
        const plan = getDayPlan(getTodayDateString());
        const items = plan && Array.isArray(plan.items) ? plan.items : [];
        const done = items.filter(it => getItemProgress(it, plan.date) >= 1).length;
        return { done: done, total: items.length, hasPlan: !!plan };
    }

    /* -----------------------------------------------------
       ProgressSync integration — plans are mutable records keyed by
       date, so (unlike the event log's id-union merge) this is the
       same "newest edit wins" shape flashcards.js uses for card state:
       compare `updatedAt` per date, keep whichever side is newer.
       ----------------------------------------------------- */
    function isValidPlan(p) {
        return !!p && typeof p === "object" && typeof p.date === "string" && Array.isArray(p.items);
    }

    function exportForSync() {
        return readStore(); // already { date: record }, exactly what ProgressSync wants
    }

    function mergeFromSync(remote) {
        if (!remote || typeof remote !== "object") return 0;
        const local = readStore();
        let changed = 0;
        Object.keys(remote).forEach(dateStr => {
            const r = remote[dateStr];
            if (!isValidPlan(r)) return;
            const l = local[dateStr];
            if (l && Number(l.updatedAt || 0) >= Number(r.updatedAt || 0)) return; // local is same age or newer: keep it
            local[dateStr] = r;
            changed++;
        });
        if (changed) writeStore(local);
        return changed;
    }

    window.DayPlan = {
        getTodayDateString: getTodayDateString,
        getDayPlan: getDayPlan,
        saveDayPlan: saveDayPlan,
        rollOverIfNeeded: rollOverIfNeeded,
        makeItem: makeItem,
        estimateSecs: estimateSecs,
        getItemProgress: getItemProgress,
        planTotalSecs: planTotalSecs,
        suggestTomorrowItems: suggestTomorrowItems,
        consistencyLast7Days: consistencyLast7Days,
        todayPillState: todayPillState
    };

    if (window.ProgressSync && typeof window.ProgressSync.register === "function") {
        window.ProgressSync.register("dayPlans", { export: exportForSync, merge: mergeFromSync });
    }

    // Exposed for tests only; harmless in production (same pattern as
    // event-log.js / flashcards.js's __test surfaces).
    window.DayPlan.__test = { readStore: readStore, writeStore: writeStore, newItemId: newItemId, emptyPlan: emptyPlan };
})();
