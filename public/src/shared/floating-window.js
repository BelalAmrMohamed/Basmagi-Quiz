// =============================================================================
// public/src/shared/floating-window.js
// Neutral helpers for floating windows (the AI window and the YouTube windows):
// minimized-corner math, overlap avoidance, remembered corner, a reference-
// counted page-scroll lock, and a smooth "glide to target" animation.
// Pure functions first (unit-tested); the DOM helpers at the bottom are small.
// A small registry of MINIMIZED windows lays every pill out together (see
// layoutMinimized / registerMinimized), so one pill moving, restoring or
// closing re-stacks all the others.
// =============================================================================

export const CORNERS = ["bottom-left", "bottom-right", "top-left", "top-right"];

/** Nearest screen corner for a pointer position. */
export function cornerFromPoint(x, y, vw, vh) {
  return `${y < vh / 2 ? "top" : "bottom"}-${x < vw / 2 ? "left" : "right"}`;
}

/** Top-left px of a w×h window sitting in `corner`. `bottomInset` = e.g. a mobile bottom nav. */
export function cornerRect(corner, w, h, vw, vh, { margin = 16, bottomInset = 0 } = {}) {
  const left = corner.endsWith("right") ? vw - w - margin : margin;
  const top = corner.startsWith("top") ? margin : vh - h - margin - bottomInset;
  return { left: Math.max(0, Math.round(left)), top: Math.max(0, Math.round(top)) };
}

const overlaps = (a, b) => a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;

/**
 * Shifts a minimized window away from other minimized windows (stack, never overlap):
 * bottom corners stack upward, top corners downward.
 * @param {{left:number, top:number, width:number, height:number}} rect
 * @param {Array<{left:number, top:number, width:number, height:number}>} others
 */
export function resolveOverlap(rect, others, corner, vh, gap = 8) {
  let top = rect.top;
  const dir = corner.startsWith("top") ? 1 : -1;
  for (let i = 0; i < 8; i += 1) {
    const hit = others.find((o) => overlaps({ ...rect, top }, o));
    if (!hit) break;
    top = dir > 0 ? hit.top + hit.height + gap : hit.top - rect.height - gap;
  }
  return { left: rect.left, top: Math.min(Math.max(0, top), Math.max(0, vh - rect.height)) };
}

export const PILL_HEIGHT = 48;
export const PILL_MAX_WIDTH = 300;
const SMALL_VIEWPORT = 600; // matches the windows' own `max-width: 600px` rules

/**
 * Pill size + margins for a viewport. Phones (<= 600px) use a tighter margin and keep the
 * bottom pills above the bottom nav. `env` carries optional safe-area insets and the nav height.
 */
export function pillMetrics(vw, { safe = {}, navHeight = 54 } = {}) {
  const small = vw <= SMALL_VIEWPORT;
  const margin = small ? 8 : 16;
  const s = { top: 0, right: 0, bottom: 0, left: 0, ...safe };
  return {
    width: Math.max(0, Math.min(PILL_MAX_WIDTH, vw - margin * 2)),
    height: PILL_HEIGHT,
    marginLeft: Math.max(margin, s.left),
    marginRight: Math.max(margin, s.right),
    marginTop: Math.max(margin, s.top),
    bottomOffset: (small ? navHeight + 12 : margin) + s.bottom,
  };
}

/**
 * Height available to bottom pills: the layout viewport, shrunk by an on-screen keyboard
 * (visual viewport) so a bottom pill is lifted above it instead of hiding behind it.
 */
export function effectiveViewportHeight(innerHeight, vvHeight, vvOffsetTop = 0) {
  if (!Number.isFinite(vvHeight) || vvHeight <= 0) return innerHeight;
  return Math.max(0, Math.min(innerHeight, Math.round(vvHeight + vvOffsetTop)));
}

/**
 * Lays out ALL minimized pills at once (pure). Each item sits at its corner; pills are placed
 * in arrival order and pushed away from already-placed ones — bottom corners stack upward,
 * top corners downward, never overlapping, same input => same output.
 * @param {Array<{id:string, corner:string, width:number, height:number, order:number}>} items
 * @param {number} vw
 * @param {number} vh
 * @param {{marginLeft?:number, marginRight?:number, marginTop?:number, bottomOffset?:number, gap?:number}} [m]
 * @returns {Record<string, {left:number, top:number}>}
 */
export function layoutMinimized(items, vw, vh, m = {}) {
  const { marginLeft = 16, marginRight = 16, marginTop = 16, bottomOffset = 16, gap = 8 } = m;
  const sorted = [...items].sort((a, b) => (a.order - b.order) || String(a.id).localeCompare(String(b.id)));
  const placed = [];
  const out = {};
  for (const it of sorted) {
    const left = it.corner.endsWith("right") ? vw - it.width - marginRight : marginLeft;
    const top = it.corner.startsWith("top") ? marginTop : vh - it.height - bottomOffset;
    const rect = { left: Math.max(0, Math.round(left)), top: Math.max(0, Math.round(top)), width: it.width, height: it.height };
    const pos = resolveOverlap(rect, placed, it.corner, vh, gap);
    placed.push({ ...pos, width: it.width, height: it.height });
    out[it.id] = pos;
  }
  return out;
}

/** Keeps a window fully reachable after a resize / rotation / on-screen keyboard. */
export function clampToViewport(left, top, w, h, vw, vh, margin = 8) {
  return {
    left: Math.round(Math.min(Math.max(left, margin), Math.max(margin, vw - w - margin))),
    top: Math.round(Math.min(Math.max(top, margin), Math.max(margin, vh - h - margin))),
  };
}

export function readCorner(key, fallback = "bottom-right", storage = globalThis.localStorage) {
  try {
    const c = storage?.getItem(key);
    return CORNERS.includes(c) ? c : fallback;
  } catch {
    return fallback;
  }
}

export function writeCorner(key, corner, storage = globalThis.localStorage) {
  try { storage?.setItem(key, corner); } catch { /* not remembered */ }
}

// ── DOM helpers ─────────────────────────────────────────────────────────────

let scrollLocks = 0;

/** Locks page scroll (reference-counted, scrollbar-gutter compensated). Returns an idempotent unlock. */
export function lockPageScroll() {
  const root = document.documentElement;
  if (scrollLocks === 0) {
    root.style.setProperty("--fw-sbw", `${Math.max(0, window.innerWidth - root.clientWidth)}px`);
    root.classList.add("fw-scroll-locked");
  }
  scrollLocks += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    scrollLocks = Math.max(0, scrollLocks - 1);
    if (scrollLocks === 0) {
      root.classList.remove("fw-scroll-locked");
      root.style.removeProperty("--fw-sbw");
    }
  };
}

/**
 * Pure rule: window motion is off when High-Performance Mode is on
 * (theme-controller.js sets <html data-motion="reduced">; it also defaults to on
 * with the OS reduced-motion preference) or the OS asks for reduced motion.
 */
export function isMotionDisabled({ dataMotion, osReduced } = {}) {
  return dataMotion === "reduced" || Boolean(osReduced);
}

/** True when High-Performance Mode or prefers-reduced-motion is active (read live, never cached). */
export function prefersReducedMotion() {
  let osReduced = false;
  try { osReduced = Boolean(globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches); } catch { /* no matchMedia */ }
  return isMotionDisabled({ dataMotion: globalThis.document?.documentElement?.dataset?.motion, osReduced });
}

/** A delay for cleanup timers that only exist to let an animation finish: 0 when motion is off. */
export function motionDelay(ms) {
  return prefersReducedMotion() ? 0 : ms;
}

/**
 * Glides a window to `target` ({left, top, width?, height?}) with a CSS transition
 * (the stylesheet defines it on `.is-snapping`). Reduced motion: applies instantly.
 * `onDone` runs once, after the transition (or a safety timeout).
 */
export function animateTo(win, target, { important = false, duration = 220, onDone } = {}) {
  const set = (prop, value) => win.style.setProperty(prop, value, important ? "important" : "");
  const apply = () => {
    set("left", `${target.left}px`);
    set("top", `${target.top}px`);
    if (target.width != null) set("width", `${target.width}px`);
    if (target.height != null) set("height", `${target.height}px`);
    if (important) { set("right", "auto"); set("bottom", "auto"); }
  };
  if (prefersReducedMotion()) {
    // High-Performance Mode / reduced motion: final position at once, no transition class left behind.
    win.classList.remove("is-snapping");
    apply();
    onDone?.();
    return;
  }
  let finished = false;
  let timer = 0;
  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    win.removeEventListener("transitionend", onEnd);
    win.classList.remove("is-snapping");
    onDone?.();
  };
  const onEnd = (e) => { if (e.target === win && ["left", "top", "width", "height"].includes(e.propertyName)) finish(); };
  win.classList.add("is-snapping");
  win.addEventListener("transitionend", onEnd);
  timer = setTimeout(finish, duration + 80);
  apply();
}

// ── Minimized-pill registry ─────────────────────────────────────────────────
// Windows register their pill element; positions are published as CSS variables
// (--fw-left / --fw-top) so a window's own inline geometry is never overwritten, and the
// stylesheet's transition glides pills (switched off by High-Performance Mode).

const pills = new Map(); // id -> { el, corner, order, dragging }
let pillSeq = 0;
let relayoutFrame = 0;
let safeProbe = null;

function readSafeInsets() {
  try {
    if (!safeProbe) {
      safeProbe = document.createElement("div");
      safeProbe.setAttribute("aria-hidden", "true");
      safeProbe.style.cssText = "position:fixed;visibility:hidden;pointer-events:none;inset:0 auto auto 0;width:0;height:0;"
        + "padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)";
      document.body.appendChild(safeProbe);
    }
    const cs = getComputedStyle(safeProbe);
    return {
      top: parseFloat(cs.paddingTop) || 0, right: parseFloat(cs.paddingRight) || 0,
      bottom: parseFloat(cs.paddingBottom) || 0, left: parseFloat(cs.paddingLeft) || 0,
    };
  } catch {
    return {};
  }
}

function readNavHeight() {
  try {
    const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--bottom-nav-height"));
    return Number.isFinite(v) && v > 0 ? v : 54;
  } catch {
    return 54;
  }
}

function pillViewport() {
  const vv = globalThis.visualViewport;
  return {
    vw: window.innerWidth,
    vh: effectiveViewportHeight(window.innerHeight, vv?.height, vv?.offsetTop),
  };
}

/** Re-lays out every registered, non-dragged pill. Returns the computed positions by id. */
export function relayoutMinimized() {
  const { vw, vh } = pillViewport();
  const metrics = pillMetrics(vw, { safe: readSafeInsets(), navHeight: readNavHeight() });
  const items = [];
  for (const [id, p] of pills) {
    if (p.dragging) continue;
    items.push({ id, corner: p.corner, width: metrics.width, height: metrics.height, order: p.order });
  }
  const result = layoutMinimized(items, vw, vh, metrics);
  for (const [id, pos] of Object.entries(result)) {
    const el = pills.get(id)?.el;
    if (!el) continue;
    el.style.setProperty("--fw-left", `${pos.left}px`);
    el.style.setProperty("--fw-top", `${pos.top}px`);
    el.classList.add("fw-placed");
  }
  return result;
}

function scheduleRelayout() {
  if (relayoutFrame) return;
  relayoutFrame = requestAnimationFrame(() => { relayoutFrame = 0; relayoutMinimized(); });
}

function syncViewportListeners() {
  const on = pills.size > 0;
  const method = on ? "addEventListener" : "removeEventListener";
  window[method]("resize", scheduleRelayout);
  globalThis.visualViewport?.[method]("resize", scheduleRelayout); // on-screen keyboard / rotation
  globalThis.visualViewport?.[method]("scroll", scheduleRelayout);
}

/** A window became a minimized pill in `corner`. It joins the END of that corner's stack. */
export function registerMinimized(id, el, corner) {
  const had = pills.size > 0;
  pills.set(id, { el, corner, order: ++pillSeq, dragging: false });
  if (!had) syncViewportListeners();
  relayoutMinimized();
}

/** Pill moved to another corner (or dropped after a drag): it arrives last in the new stack. */
export function setMinimizedCorner(id, corner) {
  const p = pills.get(id);
  if (!p) return;
  if (p.corner !== corner) { p.corner = corner; p.order = ++pillSeq; }
  p.dragging = false;
  relayoutMinimized();
}

/** While a pill is being dragged it leaves the layout, so the others settle immediately. */
export function setMinimizedDragging(id, dragging) {
  const p = pills.get(id);
  if (!p) return;
  p.dragging = Boolean(dragging);
  relayoutMinimized();
}

/** Pill restored or closed: remove it and let the remaining pills drop back. */
export function unregisterMinimized(id) {
  const p = pills.get(id);
  if (!p) return;
  pills.delete(id);
  p.el.classList.remove("fw-placed");
  p.el.style.removeProperty("--fw-left");
  p.el.style.removeProperty("--fw-top");
  if (pills.size === 0) syncViewportListeners();
  relayoutMinimized();
}
