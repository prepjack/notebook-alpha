// progress-sync.js
//
// Learner progress that lives in localStorage (today: flashcard Leitner
// boxes; later: re-read reminders, MCQ revise data) gets two safety nets:
//
//   1. SYNC  — optional, automatic, across your own devices, through the
//      same Google Apps Script backend as everything else. One shared
//      SYNC KEY (set once per device) is the only credential; there is
//      no login. localStorage stays the source of truth on every device;
//      the server only ever MERGES (newest change per card wins).
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
    const KEY_STORAGE = "notebookAlpha:syncKey";
    const LAST_SYNC_STORAGE = "notebookAlpha:lastSync";
    const DIRTY_STORAGE = "notebookAlpha:syncDirty";
    const MAX_RETRIES = 3;
    const MAX_IMPORT_BYTES = 20 * 1024 * 1024;

    // Mutable on purpose (tests shorten these).
    const config = {
        DEBOUNCE_MS: 5000,      // wait after the last review before pushing
        VERIFY_DELAY_MS: 1800,  // let the no-cors POST land before re-reading
        RETRY_DELAY_MS: 12000
    };

    const modules = {};
    let syncing = false;
    let debounceTimer = null;
    let retryTimer = null;
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
    function getKey() {
        return (lsGet(KEY_STORAGE) || "").trim();
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

    // Does the server copy contain everything we have locally (at least
    // as new)? This is how a no-cors POST — whose response we can't
    // read — is confirmed to have landed.
    function serverCovers(remote, localSnap) {
        return Object.keys(modules).every(name => {
            const local = localSnap[name] || {};
            const rem = (remote && remote[name]) || {};
            return Object.keys(local).every(id => rem[id] && entryTs(rem[id]) >= entryTs(local[id]));
        });
    }

    // ---------- network ----------
    function fatal(message) {
        const err = new Error(message);
        err.fatal = true; // wrong key / not set up: retrying won't help
        return err;
    }

    async function pull(key) {
        const url = api() + "?action=get_progress&key=" + encodeURIComponent(key) + "&_=" + Date.now();
        const res = await fetch(url);
        const json = await res.json();
        if (!json || json.success !== true) throw fatal((json && json.error) || "The server refused the request.");
        return json.data || {};
    }

    // no-cors like every other write in this project: the response is
    // opaque, so success is confirmed by pulling afterwards.
    async function push(key, snap) {
        await fetch(api(), {
            method: "POST",
            mode: "no-cors",
            body: JSON.stringify({ action: "save_progress", key: key, data: snap })
        });
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

    // Pull-merge, and push first when something changed locally. Safe to
    // call any time; concurrent calls are ignored.
    async function sync(opts) {
        opts = opts || {};
        const key = getKey();
        if (!key) return { ok: false, reason: "no_key" };
        if (!api()) return { ok: false, reason: "no_api" };
        if (syncing) return { ok: false, reason: "busy" };

        syncing = true;
        setStatus("syncing", "Syncing…");
        try {
            let pushed = false;
            if (isDirty() || opts.force) {
                await push(key, snapshot());
                pushed = true;
                await sleep(config.VERIFY_DELAY_MS);
            }

            let remote = await pull(key);
            mergeSnapshot(remote);

            // Server missing something we have (e.g. progress made before
            // a key was ever set)? Push once, then re-check.
            if (!serverCovers(remote, snapshot()) && !pushed) {
                await push(key, snapshot());
                pushed = true;
                await sleep(config.VERIFY_DELAY_MS);
                remote = await pull(key);
                mergeSnapshot(remote);
            }

            if (serverCovers(remote, snapshot())) {
                setDirty(false);
                retryCount = 0;
                lsSet(LAST_SYNC_STORAGE, new Date().toISOString());
                setStatus("ok", "Synced.");
                return { ok: true };
            }

            setDirty(true);
            setStatus("pending", "Saved on this device; will retry syncing shortly.");
            scheduleRetry();
            return { ok: false, reason: "not_confirmed" };
        } catch (err) {
            const msg = err && err.message ? err.message : "Network error";
            if (err && err.fatal) {
                setStatus("error", msg);
            } else {
                setStatus("pending", "Couldn't reach the server (" + msg + "). Progress is safe on this device.");
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
        if (!getKey()) return;
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

    // ---------- UI: header button + panel ----------
    let overlayEl = null;
    let escHandler = null;

    function formatLastSync() {
        const iso = lsGet(LAST_SYNC_STORAGE);
        if (!iso) return "Not synced yet";
        try {
            return "Last synced: " + new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
        } catch (e) {
            return "Last synced: " + iso;
        }
    }

    function statusText() {
        const parts = [];
        if (!getKey()) parts.push("Sync is off (no key set). Backup below still works.");
        else parts.push(formatLastSync());
        if (isDirty() && getKey()) parts.push("Changes waiting to sync.");
        if (status.message && status.state !== "ok") parts.push(status.message);
        return parts.join(" ");
    }

    function refreshUi() {
        const btn = document.getElementById("progress-sync-btn");
        if (btn) {
            const state = !getKey() ? "off" : (status.state === "error" ? "error" : (isDirty() ? "dirty" : "ok"));
            btn.dataset.state = state;
            btn.title = "Progress sync & backup — " + statusText();
        }
        const line = document.getElementById("progress-sync-status");
        if (line) {
            line.textContent = statusText();
            line.dataset.state = status.state;
        }
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

    function openPanel() {
        closePanel();
        overlayEl = document.createElement("div");
        overlayEl.innerHTML = `
            <div class="add-resource-overlay" id="progress-sync-overlay">
                <div class="add-resource-modal progress-sync-modal" role="dialog" aria-modal="true" aria-label="Progress sync and backup">
                    <button type="button" class="modal-close" id="progress-sync-close" aria-label="Close">×</button>
                    <div class="progress-sync-title">Progress sync &amp; backup</div>

                    <label class="progress-sync-label" for="progress-sync-key">Sync key</label>
                    <input type="password" id="progress-sync-key" class="progress-sync-input" autocomplete="off" spellcheck="false" placeholder="paste your sync key">
                    <div class="progress-sync-row">
                        <button type="button" class="bottom-strip-btn" id="progress-sync-now">Save key &amp; sync now</button>
                    </div>
                    <div class="progress-sync-status" id="progress-sync-status"></div>
                    <p class="progress-sync-help">Get the key once by running <code>setupSyncKey()</code> in the Apps Script editor (View → Logs), then paste the same key on each device. Leave it empty to turn sync off.</p>

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

        const keyInput = overlayEl.querySelector("#progress-sync-key");
        keyInput.value = getKey();
        refreshUi();

        overlayEl.querySelector("#progress-sync-close").addEventListener("click", closePanel);
        overlayEl.querySelector("#progress-sync-overlay").addEventListener("mousedown", e => {
            if (e.target.id === "progress-sync-overlay") closePanel();
        });

        overlayEl.querySelector("#progress-sync-now").addEventListener("click", async () => {
            const value = keyInput.value.trim();
            if (value) lsSet(KEY_STORAGE, value); else lsRemove(KEY_STORAGE);
            retryCount = 0;
            refreshUi();
            if (value) await sync({ force: true });
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
                else if (result.changed > 0) line.textContent = "Imported: " + result.changed + " card" + (result.changed === 1 ? "" : "s") + " added or updated.";
                else line.textContent = "Nothing to import — this device already has newer or equal progress.";
            };
            reader.onerror = () => { if (line) line.textContent = "Couldn't read that file."; };
            reader.readAsText(file);
        });

        escHandler = e => { if (e.key === "Escape") closePanel(); };
        document.addEventListener("keydown", escHandler);
    }

    function init() {
        const btn = document.getElementById("progress-sync-btn");
        if (btn) btn.addEventListener("click", openPanel);
        refreshUi();

        // Pick up other devices' progress shortly after load (and push
        // anything left over from a session that closed before syncing).
        if (getKey()) setTimeout(() => sync(), 1500);
        window.addEventListener("online", () => { if (getKey() && isDirty()) sync(); });
    }

    window.ProgressSync = {
        register, snapshot, mergeSnapshot, markDirty, sync, openPanel,
        exportBackup, importBackupText, config, entryTs
    };

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
})();
