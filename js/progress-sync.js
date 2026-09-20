// progress-sync.js
//
// Learner progress that lives in localStorage (today: flashcard Leitner
// boxes; later: re-read reminders, MCQ revise data) gets two safety nets:
//
//   1. SYNC  — across the owner's devices AND browsers, through the same
//      Google Apps Script backend as everything else. No login, no key.
//      localStorage stays the source of truth on every device; the server
//      only ever MERGES (newest change per card wins). Sync is never
//      silent: pressing "⟳ Sync" always shows what happened, background
//      syncs show a short toast, and a brand-new browser is told to sync
//      first so its old progress comes in.
//   2. BACKUP — Export / Import a JSON file by hand. Import also MERGES,
//      it never overwrites, so an old backup can't erase newer reviews.
//
// Data shape (versioned, extensible — each feature adds one namespace):
//   { v: 1, exportedAt: "...", flashcards: { "<cardId>": {box,dueDate,lastReviewed,ts} } }
//
// Features plug in with ProgressSync.register(name, { export, merge }):
//   export() -> plain object map { id: entry }
//   merge(remoteMap) -> number of local entries added/updated
//
// Load order: this file must load BEFORE the features that register.
(function () {
    const LAST_SYNC_STORAGE = "notebookAlpha:lastSync";
    const DIRTY_STORAGE = "notebookAlpha:syncDirty";
    const INTRO_STORAGE = "notebookAlpha:syncIntroDone";
    const OLD_KEY_STORAGE = "notebookAlpha:syncKey"; // an earlier version used a key; now removed
    const MAX_RETRIES = 3;
    const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
    const DAY_MS = 24 * 60 * 60 * 1000;

    // Mutable on purpose (tests shorten these).
    const config = {
        DEBOUNCE_MS: 5000,      // wait after the last review before pushing
        VERIFY_DELAY_MS: 1800,  // let the no-cors POST land before re-reading
        RETRY_DELAY_MS: 12000,
        TOAST_MS: 4200,
        LOAD_SYNC_DELAY_MS: 1500,
        BANNER_DELAY_MS: 1200
    };

    const modules = {};
    let syncing = false;
    let debounceTimer = null;
    let retryTimer = null;
    let toastTimer = null;
    let retryCount = 0;
    let status = { state: "idle", message: "" };

    // ---------- tiny helpers ----------
    function lsGet(key) {
        try { return localStorage.getItem(key); } catch (e) { return null; }
    }
    function lsSet(key, value) {
        try { localStorage.setItem(key, value); } catch (e) { /* storage blocked */ }
    }
    function lsRemove(key) {
        try { localStorage.removeItem(key); } catch (e) { /* storage blocked */ }
    }
    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    function api() {
        return (typeof GOOGLE_SHEET_API === "string" && GOOGLE_SHEET_API) ? GOOGLE_SHEET_API : "";
    }
    function isDirty() {
        return lsGet(DIRTY_STORAGE) === "1";
    }
    function setDirty(flag) {
        if (flag) lsSet(DIRTY_STORAGE, "1"); else lsRemove(DIRTY_STORAGE);
        refreshUi();
    }
    function todayIso() {
        const d = new Date();
        return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    }
    function plural(n, word) {
        return n + " " + word + (n === 1 ? "" : "s");
    }

    // Same rule as the features use: exact `ts` if present, else the
    // review date (entries written before sync existed have no ts).
    function entryTs(entry) {
        if (!entry || typeof entry !== "object") return 0;
        const t = Number(entry.ts);
        if (t > 0) return t;
        const d = Date.parse(String(entry.lastReviewed || "") + "T00:00:00");
        return isNaN(d) ? 0 : d;
    }

    // ---------- registry + snapshots ----------
    function register(name, mod) {
        if (!name || !mod || typeof mod.export !== "function" || typeof mod.merge !== "function") return;
        modules[name] = mod;
    }

    function snapshot() {
        const snap = { v: 1, exportedAt: new Date().toISOString() };
        Object.keys(modules).forEach(name => {
            try { snap[name] = modules[name].export() || {}; } catch (e) { snap[name] = {}; }
        });
        return snap;
    }

    function countEntries(snap) {
        return Object.keys(modules).reduce((sum, name) => {
            const part = snap && snap[name];
            return sum + (part && typeof part === "object" ? Object.keys(part).length : 0);
        }, 0);
    }

    // Merges a snapshot into local data. Returns total entries changed.
    function mergeSnapshot(snap) {
        if (!snap || typeof snap !== "object") return 0;
        let total = 0;
        Object.keys(modules).forEach(name => {
            const part = snap[name];
            if (part && typeof part === "object" && !Array.isArray(part)) {
                try { total += Number(modules[name].merge(part)) || 0; } catch (e) { /* skip a bad module */ }
            }
        });
        return total;
    }

    // How many local entries does the server copy lack (or hold an older
    // version of)? This is how a no-cors POST — whose response can't be
    // read — is confirmed to have landed. An entry stamped more than a
    // day ahead of the SERVER's clock is deliberately clamped by the
    // server, so once it exists there it counts as covered.
    function countUncovered(remote, localSnap, serverTime) {
        let missing = 0;
        Object.keys(modules).forEach(name => {
            const local = localSnap[name] || {};
            const rem = (remote && remote[name]) || {};
            Object.keys(local).forEach(id => {
                const lt = entryTs(local[id]);
                const covered = !!rem[id] && (entryTs(rem[id]) >= lt || (serverTime > 0 && lt > serverTime + DAY_MS));
                if (!covered) missing++;
            });
        });
        return missing;
    }

    // ---------- network ----------
    function fatal(message) {
        const err = new Error(message);
        err.fatal = true; // the server refused: retrying won't help
        return err;
    }

    async function pull() {
        const res = await fetch(api() + "?action=get_progress&_=" + Date.now());
        const json = await res.json();
        if (!json || json.success !== true) throw fatal((json && json.error) || "The server refused the request.");
        return { data: json.data || {}, serverTime: Number(json.server_time) || 0 };
    }

    // no-cors like every other write in this project: the response is
    // opaque, so success is confirmed by pulling afterwards.
    async function push(snap) {
        await fetch(api(), {
            method: "POST",
            mode: "no-cors",
            body: JSON.stringify({ action: "save_progress", data: snap })
        });
    }

    // ---------- messages ----------
    function describeOk(r) {
        if (r.localCount === 0 && r.remoteCount === 0) {
            return "Nothing to sync yet: there is no progress on this device or in the cloud. Review some flashcards first.";
        }
        if (r.upToDate) return "✓ Up to date. This device and the cloud already have the same latest progress.";
        if (r.sent > 0 && r.pulled > 0) {
            return "✓ Synced. Sent " + plural(r.sent, "card") + " to the cloud and received " + plural(r.pulled, "card update") + " from your other devices.";
        }
        if (r.sent > 0) return "✓ Synced. Sent " + plural(r.sent, "card") + " from this device to the cloud.";
        return "✓ Synced. Received " + plural(r.pulled, "card update") + " from your other devices.";
    }

    function formatLastSync() {
        const iso = lsGet(LAST_SYNC_STORAGE);
        if (!iso) return "Not synced on this browser yet.";
        try {
            return "Latest sync: " + new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
        } catch (e) {
            return "Latest sync: " + iso;
        }
    }

    // ---------- UI: toast ----------
    function toast(message, kind) {
        if (!document.body) return;
        let el = document.getElementById("progress-sync-toast");
        if (!el) {
            el = document.createElement("div");
            el.id = "progress-sync-toast";
            el.className = "progress-sync-toast";
            el.setAttribute("role", "status");
            el.setAttribute("aria-live", "polite");
            document.body.appendChild(el);
        }
        el.textContent = message;
        el.dataset.kind = kind || "info";
        el.classList.add("show");
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => el.classList.remove("show"), config.TOAST_MS);
    }

    // ---------- sync engine ----------
    function setStatus(state, message) {
        status = { state: state, message: message || "" };
        refreshUi();
    }

    function scheduleRetry() {
        if (retryTimer || retryCount >= MAX_RETRIES) return;
        retryCount++;
        retryTimer = setTimeout(() => {
            retryTimer = null;
            sync();
        }, config.RETRY_DELAY_MS);
    }

    function panelOpen() {
        return !!document.getElementById("progress-sync-overlay");
    }

    // Two-way sync: pull + merge, then push only if the server lacks
    // something we have, then re-read to confirm. Never silent: the result
    // is stored in `status` (shown in the panel) and, for background syncs,
    // announced with a toast when something happened. Concurrent calls are
    // ignored.
    async function sync(opts) {
        opts = opts || {};
        if (!api()) {
            setStatus("error", "Sync isn't available: the backend address is missing.");
            return { ok: false, reason: "no_api" };
        }
        if (syncing) return { ok: false, reason: "busy" };

        syncing = true;
        setStatus("syncing", "Syncing…");
        try {
            let { data: remote, serverTime } = await pull();
            let pulled = mergeSnapshot(remote);
            const remoteCount = countEntries(remote);
            const toSend = countUncovered(remote, snapshot(), serverTime);
            let sent = 0;

            if (toSend > 0) {
                await push(snapshot());
                await sleep(config.VERIFY_DELAY_MS);
                const again = await pull();
                remote = again.data;
                serverTime = again.serverTime;
                pulled += mergeSnapshot(remote);
                const stillMissing = countUncovered(remote, snapshot(), serverTime);
                sent = toSend - stillMissing;

                if (stillMissing > 0) {
                    setDirty(true);
                    setStatus("pending", "Saved on this device, but the cloud copy isn't confirmed yet (" + plural(stillMissing, "card") + " pending). Will retry shortly.");
                    scheduleRetry();
                    if (!opts.manual && !panelOpen()) toast("Sync not confirmed yet, retrying shortly.", "warn");
                    return { ok: false, reason: "not_confirmed", pulled: pulled, sent: sent };
                }
            }

            setDirty(false);
            retryCount = 0;
            lsSet(LAST_SYNC_STORAGE, new Date().toISOString());
            lsSet(INTRO_STORAGE, "1");
            hideBanner();

            const result = {
                ok: true, pulled: pulled, sent: sent,
                localCount: countEntries(snapshot()), remoteCount: countEntries(remote),
                upToDate: pulled === 0 && sent === 0
            };
            const message = describeOk(result);
            setStatus("ok", message);
            if (!opts.manual && !panelOpen() && (pulled > 0 || sent > 0)) toast(message, "ok");
            result.message = message;
            return result;
        } catch (err) {
            const msg = err && err.message ? err.message : "Network error";
            if (err && err.fatal) {
                setStatus("error", "Sync failed: " + msg);
                if (!opts.manual && !panelOpen()) toast("Sync failed: " + msg, "error");
            } else {
                setStatus("pending", "Couldn't reach the cloud (" + msg + "). Your progress is safe on this device; it will retry.");
                if (!opts.manual && !panelOpen()) toast("Couldn't sync (offline?). Progress is safe on this device.", "warn");
                scheduleRetry();
            }
            return { ok: false, reason: err && err.fatal ? "fatal" : "network", error: msg };
        } finally {
            syncing = false;
        }
    }

    // Features call this after every change; the push is debounced so a
    // whole review session becomes about one sync.
    function markDirty() {
        setDirty(true);
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => sync(), config.DEBOUNCE_MS);
    }

    // ---------- backup: export / import ----------
    function exportBackup() {
        const text = JSON.stringify(snapshot(), null, 2);
        const blob = new Blob([text], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "notebook-alpha-progress-" + todayIso() + ".json";
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
    }

    // Returns { ok, changed } or { ok:false, error }.
    function importBackupText(text) {
        let obj;
        try {
            obj = JSON.parse(text);
        } catch (e) {
            return { ok: false, error: "That file isn't valid JSON." };
        }
        if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
            return { ok: false, error: "That file isn't a Notebook Alpha progress backup." };
        }
        if (obj.v !== 1) {
            return { ok: false, error: "This backup has version " + obj.v + "; this site only understands version 1." };
        }
        const changed = mergeSnapshot(obj);
        if (changed > 0) markDirty();
        return { ok: true, changed: changed };
    }

    // ---------- UI: header button, panel, first-run banner ----------
    let overlayEl = null;
    let escHandler = null;
    let bannerEl = null;

    function refreshUi() {
        const btn = document.getElementById("progress-sync-btn");
        if (btn) {
            let state = "ok";
            if (status.state === "error") state = "error";
            else if (isDirty()) state = "dirty";
            else if (!lsGet(LAST_SYNC_STORAGE)) state = "new";
            btn.dataset.state = state;
            btn.title = "Progress sync & backup — " + (status.message || formatLastSync());
        }
        const line = document.getElementById("progress-sync-status");
        if (line) {
            line.textContent = status.message || (isDirty() ? "Changes on this device are waiting to sync." : "Press \"Sync now\" to check.");
            line.dataset.state = status.state;
        }
        const last = document.getElementById("progress-sync-last");
        if (last) last.textContent = formatLastSync();
    }

    function closePanel() {
        if (escHandler) {
            document.removeEventListener("keydown", escHandler);
            escHandler = null;
        }
        if (overlayEl) {
            overlayEl.remove();
            overlayEl = null;
        }
    }

    // Opens the panel; if `syncNow`, also runs a manual sync right away so
    // clicking ⟳ Sync always ends with a visible result.
    function openPanel(syncNow) {
        closePanel();
        overlayEl = document.createElement("div");
        overlayEl.innerHTML = `
            <div class="add-resource-overlay" id="progress-sync-overlay">
                <div class="add-resource-modal progress-sync-modal" role="dialog" aria-modal="true" aria-label="Progress sync and backup">
                    <button type="button" class="modal-close" id="progress-sync-close" aria-label="Close">×</button>
                    <div class="progress-sync-title">Progress sync &amp; backup</div>

                    <div class="progress-sync-row">
                        <button type="button" class="bottom-strip-btn" id="progress-sync-now">⟳ Sync now</button>
                    </div>
                    <div class="progress-sync-status" id="progress-sync-status" role="status" aria-live="polite"></div>
                    <div class="progress-sync-last" id="progress-sync-last"></div>
                    <p class="progress-sync-help">Sync keeps your review progress the same on every device and browser you use. Use it once when you start on a new browser, so your earlier progress comes in and you carry on from there.</p>

                    <div class="progress-sync-divider"></div>

                    <div class="progress-sync-label">Backup</div>
                    <div class="progress-sync-row">
                        <button type="button" class="bottom-strip-btn" id="progress-export">Export backup</button>
                        <button type="button" class="bottom-strip-btn" id="progress-import">Import backup</button>
                        <input type="file" id="progress-import-file" accept=".json,application/json" hidden>
                    </div>
                    <div class="progress-sync-status" id="progress-backup-status"></div>
                    <p class="progress-sync-help">Import merges: for every card, whichever copy was reviewed most recently is kept, so an old backup can't erase newer progress.</p>
                </div>
            </div>`;
        document.body.appendChild(overlayEl);
        refreshUi();

        overlayEl.querySelector("#progress-sync-close").addEventListener("click", closePanel);
        overlayEl.querySelector("#progress-sync-overlay").addEventListener("mousedown", e => {
            if (e.target.id === "progress-sync-overlay") closePanel();
        });
        overlayEl.querySelector("#progress-sync-now").addEventListener("click", () => {
            retryCount = 0;
            runManualSync();
        });

        overlayEl.querySelector("#progress-export").addEventListener("click", () => {
            exportBackup();
            const line = document.getElementById("progress-backup-status");
            if (line) line.textContent = "Backup file downloaded.";
        });

        const fileInput = overlayEl.querySelector("#progress-import-file");
        overlayEl.querySelector("#progress-import").addEventListener("click", () => fileInput.click());
        fileInput.addEventListener("change", () => {
            const file = fileInput.files && fileInput.files[0];
            fileInput.value = "";
            const line = document.getElementById("progress-backup-status");
            if (!file) return;
            if (file.size > MAX_IMPORT_BYTES) {
                if (line) line.textContent = "That file is too large to be a progress backup.";
                return;
            }
            const reader = new FileReader();
            reader.onload = () => {
                const result = importBackupText(String(reader.result || ""));
                if (!line) return;
                if (!result.ok) line.textContent = result.error;
                else if (result.changed > 0) line.textContent = "Imported: " + plural(result.changed, "card") + " added or updated. It will sync to the cloud in a few seconds.";
                else line.textContent = "Nothing to import: this device already has newer or equal progress.";
            };
            reader.onerror = () => { if (line) line.textContent = "Couldn't read that file."; };
            reader.readAsText(file);
        });

        escHandler = e => { if (e.key === "Escape") closePanel(); };
        document.addEventListener("keydown", escHandler);

        if (syncNow) runManualSync();
    }

    async function runManualSync() {
        retryCount = 0; // a person asking for a sync always gets a fresh set of automatic retries
        const r = await sync({ manual: true });
        if (r && r.reason === "busy") {
            setStatus("syncing", "A sync is already running; the result will appear here in a moment.");
        }
        return r;
    }

    // ---- first-run banner: a brand-new browser is told to sync first ----
    function hideBanner() {
        if (bannerEl) {
            bannerEl.remove();
            bannerEl = null;
        }
    }

    function showBanner() {
        if (bannerEl || !document.body) return;
        bannerEl = document.createElement("div");
        bannerEl.className = "progress-sync-banner";
        bannerEl.id = "progress-sync-banner";
        bannerEl.setAttribute("role", "region");
        bannerEl.setAttribute("aria-label", "Sync your progress");
        bannerEl.innerHTML = `
            <div class="progress-sync-banner-title">First time on this browser?</div>
            <div class="progress-sync-banner-text" id="progress-sync-banner-text">Sync now to bring in your earlier progress from your other devices, so you carry on from where you left off. (If you review cards before syncing, those cards' older history can be replaced.)</div>
            <div class="progress-sync-row">
                <button type="button" class="bottom-strip-btn" id="progress-banner-sync">⟳ Sync now</button>
                <button type="button" class="bottom-strip-btn" id="progress-banner-skip">Start fresh here</button>
            </div>`;
        document.body.appendChild(bannerEl);

        bannerEl.querySelector("#progress-banner-skip").addEventListener("click", () => {
            lsSet(INTRO_STORAGE, "1");
            hideBanner();
        });
        bannerEl.querySelector("#progress-banner-sync").addEventListener("click", async () => {
            const text = bannerEl && bannerEl.querySelector("#progress-sync-banner-text");
            if (text) text.textContent = "Syncing…";
            const r = await sync({ manual: true });
            if (!bannerEl) return; // success already removed the banner
            const t = bannerEl.querySelector("#progress-sync-banner-text");
            if (t) t.textContent = r && r.ok ? r.message : (status.message || "Sync failed. Try again.");
        });
    }

    function maybeShowFirstRunBanner() {
        if (!api()) return;
        if (lsGet(LAST_SYNC_STORAGE) || lsGet(INTRO_STORAGE) === "1") return;
        showBanner();
    }

    function init() {
        lsRemove(OLD_KEY_STORAGE); // an earlier version stored a sync key here
        const btn = document.getElementById("progress-sync-btn");
        if (btn) btn.addEventListener("click", () => openPanel(true));
        refreshUi();

        if (lsGet(LAST_SYNC_STORAGE)) {
            // A browser that has synced before: quietly pick up other
            // devices' progress (a toast appears only if something changed).
            setTimeout(() => sync(), config.LOAD_SYNC_DELAY_MS);
        } else {
            // First time here: tell the person to sync so old progress comes in.
            setTimeout(maybeShowFirstRunBanner, config.BANNER_DELAY_MS);
        }
        window.addEventListener("online", () => { if (isDirty()) sync(); });
    }

    window.ProgressSync = {
        register, snapshot, mergeSnapshot, markDirty, sync, openPanel,
        exportBackup, importBackupText, config, entryTs
    };

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
})();
