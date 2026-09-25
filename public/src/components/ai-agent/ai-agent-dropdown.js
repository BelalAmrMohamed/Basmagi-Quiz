// =============================================================================
// public/src/components/ai-agent/ai-agent-dropdown.js
// SELF-CONTAINED ANCHORED DROPDOWN — the AI Agent's own small popover menu
// engine (small "more" menu on the input, the history item's ⋮ menu, the
// sidebar's export menu, and the `@` mention menu).
//
// This is a deliberate fork of features/home/exam-dropdown-menu.js's
// openExamDropdownMenu/closeAllExamDropdownMenus, NOT a re-export of it.
// The agent used to import that module directly, which meant:
//   - the agent depended on a component that lives under features/home,
//     so it couldn't be dropped into a page without also wiring up that
//     page's home-feature imports;
//   - the agent's dropdowns only rendered correctly on pages that also
//     happened to load features/home/exam-dropdown-menu.css (a SEPARATE
//     stylesheet from exam-dropdown-menu.js) — index.html, create-quiz.html
//     and result.html do, but lesson.html and create-lesson.html do NOT,
//     so every agent dropdown opened on those two pages rendered unstyled.
// See ai-agent.css's own header comment for the CSS half of this fix — the
// classes this module uses (.ai-agent-dropdown-menu / .ai-agent-dropdown-item
// and friends) are styled entirely inside ai-agent.css, which every host
// page already links.
//
// Positioning is also self-contained (no import from
// features/home/floating-position.js) — see positionAgentDropdown below,
// a direct port of positionExamDropdownMenu's viewport-clamping math.
//
// Behaviorally this is a 1:1 port: same anchored-below/flip-above/clamp
// logic, same single-exit-point closeMenu() guarantee (every close route —
// outside click, Escape, scroll, resize, or an explicit menu action — goes
// through it so listeners are never leaked), same "click the same trigger
// twice closes it instead of reopening" behavior. Only the class names and
// the module boundary changed.
// =============================================================================

/** Anchors `menu` below (or, if there's no room, above) `triggerBtn`,
 * right-edge aligned (this is an RTL UI), clamped so it never runs off
 * either side of the viewport. Direct port of positionExamDropdownMenu. */
export function positionAgentDropdown(menu, triggerBtn) {
    const rect = triggerBtn.getBoundingClientRect();
    const gap = 6;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const menuW = menu.offsetWidth;
    const menuH = menu.offsetHeight;

    // Same bottom-nav-aware clamping as positionExamDropdownMenu — a mobile
    // fixed bottom-nav bar (present on some host pages) would otherwise clip
    // the last item(s) of a menu opened near the bottom of the screen. This
    // is a plain DOM query (no CSS class contract with the agent itself), so
    // it's safe to keep: it degrades to 0 inset on pages with no such bar.
    const bottomNav = document.querySelector(".bottom-nav");
    let bottomInset = 0;
    if (bottomNav && window.getComputedStyle(bottomNav).display !== "none") {
        const navRect = bottomNav.getBoundingClientRect();
        if (navRect.top < vh && navRect.height > 0) {
            bottomInset = vh - navRect.top;
        }
    }
    const availableVh = vh - bottomInset;

    let top = rect.bottom + gap;
    let left = rect.right - menuW;

    // Flip above the button if there isn't enough room below.
    if (top + menuH > availableVh - gap) {
        const above = rect.top - menuH - gap;
        top = above >= gap ? above : Math.max(gap, availableVh - menuH - gap);
    }

    // Clamp vertically within the available viewport (above the bottom nav) —
    // covers menus that grow taller after being positioned (e.g. the mention
    // menu's async platform-search results arriving after initial open),
    // which the flip-above check above can't account for since it only runs
    // once at initial placement.
    if (top + menuH > availableVh - gap) top = availableVh - menuH - gap;
    if (top < gap) top = gap;

    // Clamp horizontally within the viewport.
    if (left < gap) left = gap;
    if (left + menuW > vw - gap) left = vw - menuW - gap;

    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;
}

/** Tracks the trigger button whose menu is currently open (if any), so a
 * second click on that SAME trigger can close it instead of reopening a
 * fresh copy — see the early-return in openAgentDropdown below. Reset to
 * null on every close path since closeMenu() is this module's single exit
 * point (see file header). */
let openTriggerBtn = null;

/** Removes any currently-open agent dropdown(s). Defensive — normally only
 * one can be open at a time since opening a new one closes the last. */
export function closeAllAgentDropdowns() {
    document.querySelectorAll(".ai-agent-dropdown-menu").forEach((el) => el.remove());
    openTriggerBtn = null;
}

/**
 * Opens a small anchored dropdown below (or above, if clamped) `triggerBtn`.
 * `buildContent(menu, closeMenu, reposition)` is called once, synchronously,
 * to populate the (still-hidden) menu element before it's measured and
 * positioned — mirrors openExamDropdownMenu's own contract exactly, so
 * every existing call site can switch over by only changing the import.
 *
 * @param {HTMLElement} triggerBtn
 * @param {(menu: HTMLElement, closeMenu: () => void, reposition: () => void) => void} buildContent
 * @returns {(() => void) | null} closeMenu, or null if this call just
 *   closed an already-open menu for the same trigger instead of opening one
 */
export function openAgentDropdown(triggerBtn, buildContent) {
    const wasOpenForThisTrigger = openTriggerBtn === triggerBtn;
    closeAllAgentDropdowns();

    if (wasOpenForThisTrigger) {
        return null;
    }

    const menu = document.createElement("div");
    menu.className = "ai-agent-dropdown-menu";
    menu.setAttribute("role", "menu");
    menu.style.visibility = "hidden";

    function closeMenu() {
        menu.remove();
        document.removeEventListener("click", onOutsideClick);
        document.removeEventListener("keydown", onKeydown);
        window.removeEventListener("resize", closeMenu);
        window.removeEventListener("scroll", onScroll, true);
        if (openTriggerBtn === triggerBtn) openTriggerBtn = null;
    }

    function onOutsideClick(e) {
        if (menu.contains(e.target) || triggerBtn.contains(e.target)) return;
        closeMenu();
    }

    function onKeydown(e) {
        if (e.key === "Escape") closeMenu();
    }

    function onScroll(e) {
        if (menu.contains(e.target)) return; // scrolling inside the menu itself
        closeMenu();
    }

    function reposition() {
        positionAgentDropdown(menu, triggerBtn);
    }

    buildContent(menu, closeMenu, reposition);

    document.body.appendChild(menu);
    positionAgentDropdown(menu, triggerBtn);
    menu.style.visibility = "visible";
    openTriggerBtn = triggerBtn;

    // The click that opened this menu already had its propagation stopped by
    // the trigger button's own onclick handler, so it's safe to attach this
    // listener immediately without it firing on the same click.
    document.addEventListener("click", onOutsideClick);
    document.addEventListener("keydown", onKeydown);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", onScroll, true);

    return closeMenu;
}