/* =========================================================
   MOBILE OFF-CANVAS DRAWERS — shared controller (standalone copy)
   Same controller app.js defines for the Home page, split into its own
   file so pages that do NOT load app.js (Practice) can use the exact same
   drawer buttons/backdrop. If app.js is also loaded, whichever defined
   window.initMobileDrawers first is kept.
   Extra vs app.js: the returned object also has openPanel(panelOrId).
   ========================================================= */
if (!window.initMobileDrawers) {
window.initMobileDrawers = function (config) {
    if (!config || !Array.isArray(config.drawers) || !config.drawers.length) return null;

    const breakpoint = Number.isFinite(config.breakpoint) ? config.breakpoint : 900;
    const header = document.querySelector(config.headerSelector || ".app-header");
    if (!header) return null;

    const drawerItems = config.drawers
        .map(item => ({
            panel: typeof item.panel === "string" ? document.getElementById(item.panel) : item.panel,
            label: item.label || "Panel",
            side: item.side === "right" ? "right" : "left"
        }))
        .filter(item => item.panel);

    if (!drawerItems.length) return null;

    let backdrop = document.getElementById("mobile-drawer-backdrop");
    if (!backdrop) {
        backdrop = document.createElement("div");
        backdrop.id = "mobile-drawer-backdrop";
        backdrop.className = "mobile-drawer-backdrop";
        backdrop.hidden = true;
        document.body.appendChild(backdrop);
    }

    const controls = document.createElement("div");
    controls.className = "mobile-drawer-controls";
    controls.setAttribute("aria-label", "Mobile panel controls");
    header.appendChild(controls);

    const states = new Map();
    let openPanel = null;

    function closeAll() {
        drawerItems.forEach(item => {
            item.panel.classList.remove("mobile-drawer-open");
            states.get(item.panel)?.setAttribute("aria-expanded", "false");
        });
        openPanel = null;
        backdrop.hidden = true;
        document.body.classList.remove("mobile-drawer-active");
    }

    function open(item) {
        if (window.innerWidth > breakpoint) return;
        if (openPanel && openPanel !== item.panel) closeAll();
        if (item.panel.classList.contains("mobile-drawer-open")) {
            closeAll();
            return;
        }
        item.panel.classList.add("mobile-drawer-open");
        states.get(item.panel)?.setAttribute("aria-expanded", "true");
        openPanel = item.panel;
        backdrop.hidden = false;
        document.body.classList.add("mobile-drawer-active");
    }

    drawerItems.forEach((item, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "mobile-drawer-toggle";
        button.dataset.drawerSide = item.side;
        button.textContent = item.icon ? `${item.icon} ${item.label}` : item.label;
        button.setAttribute("aria-label", `Open ${item.label}`);
        button.setAttribute("aria-expanded", "false");
        button.title = item.label;
        button.addEventListener("click", () => open(item));
        controls.appendChild(button);
        states.set(item.panel, button);
    });

    backdrop.addEventListener("click", closeAll);
    document.addEventListener("keydown", event => {
        if (event.key === "Escape") closeAll();
    });

    function sync() {
        if (window.innerWidth > breakpoint) {
            closeAll();
            controls.hidden = true;
        } else {
            controls.hidden = false;
        }
    }

    window.addEventListener("resize", sync);
    sync();

    // Opens the drawer that belongs to a given panel (element or id).
    function openByPanel(panelOrId) {
        const panel = typeof panelOrId === "string" ? document.getElementById(panelOrId) : panelOrId;
        const item = drawerItems.find(d => d.panel === panel);
        if (item && !item.panel.classList.contains("mobile-drawer-open")) open(item);
    }

    return { open, closeAll, sync, openPanel: openByPanel };
};
}
