const MENU_SELECTOR = ".mlweb details.cell-menu, .mlweb details.toolbar-menu";
const MENU_CONTENT_SELECTOR = ".cell-menu-items, .toolbar-menu-items";
const MENU_GAP = 6;
const VIEWPORT_GAP = 8;

let activeMenu = null;

function menuContent(details) {
  return details?.querySelector(MENU_CONTENT_SELECTOR);
}

function resetMenuPosition(details) {
  const content = menuContent(details);
  if (!content) return;
  for (const property of ["position", "inset", "left", "top", "right", "bottom", "zIndex", "maxWidth", "maxHeight", "overflowY", "visibility"]) {
    content.style.removeProperty(property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`));
  }
}

/** Vertical band the menu may use: below a stuck toolbar and above the phone bottom nav. */
function safeBand(details, viewportHeight, edge) {
  let top = edge, bottom = viewportHeight - edge;
  const nav = document.getElementById("bottomNav") || document.querySelector(".bottom-nav");
  if (nav && getComputedStyle(nav).display !== "none") {
    const r = nav.getBoundingClientRect();
    if (r.height && r.top < viewportHeight) bottom = Math.min(bottom, r.top - edge);
  }
  if (details.matches(".cell-menu")) {
    const bar = document.querySelector(".mlweb #bar");
    if (bar && getComputedStyle(bar).position === "sticky") {
      const r = bar.getBoundingClientRect();
      if (r.height && r.top <= edge + 1 && r.bottom > 0) top = Math.max(top, r.bottom + edge);
    }
  }
  return { top, bottom: Math.max(top + 80, bottom) };
}

function positionMenu(details) {
  if (!details?.open || !details.isConnected) return;
  const summary = details.querySelector(":scope > summary");
  const content = menuContent(details);
  if (!summary || !content) return;

  const anchor = summary.getBoundingClientRect();
  const viewportWidth = document.documentElement.clientWidth;
  const viewportHeight = document.documentElement.clientHeight;
  const edge = Math.min(VIEWPORT_GAP, viewportWidth / 4, viewportHeight / 4);

  const keepScroll = content.scrollTop;
  content.style.position = "fixed";
  content.style.inset = "auto";
  content.style.left = "0px";
  content.style.top = "0px";
  content.style.right = "auto";
  content.style.bottom = "auto";
  content.style.zIndex = "1000";
  content.style.maxWidth = `${Math.max(120, viewportWidth - edge * 2)}px`;
  const band = safeBand(details, viewportHeight, edge);
  content.style.maxHeight = `${Math.max(80, band.bottom - band.top)}px`;
  content.style.overflowY = "auto";
  content.style.visibility = "hidden";

  const natural = content.getBoundingClientRect();
  const width = Math.min(natural.width, viewportWidth - edge * 2);
  const below = band.bottom - anchor.bottom - MENU_GAP;
  const above = anchor.top - MENU_GAP - band.top;
  const rtl = getComputedStyle(details).direction === "rtl";
  const clampX = (x) => Math.max(edge, Math.min(viewportWidth - width - edge, x));
  const xCandidates = viewportWidth <= 760
    ? [rtl ? anchor.right + MENU_GAP : anchor.left - width - MENU_GAP, rtl ? anchor.left - width - MENU_GAP : anchor.right + MENU_GAP]
    : [rtl ? anchor.left : anchor.right - width];
  const xs = [...new Set(xCandidates.map(clampX))];
  const triggers = [...document.querySelectorAll(`${MENU_SELECTOR} > summary`)]
    .filter((item) => item !== summary)
    .map((item) => item.getBoundingClientRect())
    .filter((rect) => rect.width && rect.height);
  const candidates = [
    { top: anchor.bottom + MENU_GAP, available: below, preference: 0 },
    { top: anchor.top - MENU_GAP, available: above, preference: 1 },
  ].flatMap(({ top, available, preference }) => xs.map((left) => {
    const height = Math.min(natural.height, Math.max(0, Math.min(band.bottom - band.top, available)));
    const rawTop = preference === 0 ? top : top - height;
    const y = Math.max(band.top, Math.min(band.bottom - height, rawTop));
    const overlap = triggers.reduce((area, rect) => {
      const widthOverlap = Math.max(0, Math.min(left + width, rect.right) - Math.max(left, rect.left));
      const heightOverlap = Math.max(0, Math.min(y + height, rect.bottom) - Math.max(y, rect.top));
      return area + widthOverlap * heightOverlap;
    }, 0);
    return { left, top: y, height, overlap, clipped: natural.height - height, preference };
  }));
  candidates.sort((a, b) => a.overlap - b.overlap || a.clipped - b.clipped || a.preference - b.preference);
  const [best] = candidates;

  content.style.left = `${best.left}px`;
  content.style.top = `${best.top}px`;
  content.style.maxHeight = `${best.height}px`;
  content.style.visibility = "";
  content.scrollTop = keepScroll;
}

function closeMenu(details) {
  if (!details) return;
  details.open = false;
  resetMenuPosition(details);
  if (activeMenu === details) activeMenu = null;
}

function closeOtherMenus(keep) {
  document.querySelectorAll(`${MENU_SELECTOR}[open]`).forEach((details) => {
    if (details !== keep) closeMenu(details);
  });
}

document.addEventListener("click", (event) => {
  const summary = event.target instanceof Element ? event.target.closest("details > summary") : null;
  if (!summary || !summary.parentElement.matches(MENU_SELECTOR)) return;
  const details = summary.parentElement;
  if (!details.open) closeOtherMenus(details);
  requestAnimationFrame(() => {
    if (details.open) {
      activeMenu = details;
      positionMenu(details);
    } else {
      resetMenuPosition(details);
      if (activeMenu === details) activeMenu = null;
    }
  });
}, true);

document.addEventListener("pointerdown", (event) => {
  if (activeMenu && !activeMenu.contains(event.target)) closeMenu(activeMenu);
}, true);

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !activeMenu) return;
  const summary = activeMenu.querySelector(":scope > summary");
  closeMenu(activeMenu);
  summary?.focus();
});

document.addEventListener("toggle", (event) => {
  const details = event.target;
  if (!(details instanceof HTMLDetailsElement) || !details.matches(MENU_SELECTOR)) return;
  if (details.open) {
    closeOtherMenus(details);
    activeMenu = details;
    requestAnimationFrame(() => positionMenu(details));
  } else {
    resetMenuPosition(details);
    if (activeMenu === details) activeMenu = null;
  }
}, true);

window.addEventListener("resize", () => positionMenu(activeMenu));
// Scrolling INSIDE the open menu must not re-position it: that reset its scroll offset, so the
// list could not be scrolled at all.
window.addEventListener("scroll", (event) => {
  if (activeMenu && event.target instanceof Node && activeMenu.contains(event.target)) return;
  positionMenu(activeMenu);
}, true);
