// =============================================================================
// public/src/shared/floating-window.js
// Neutral helpers for floating windows (the AI window and the YouTube windows):
// minimized-corner math, overlap avoidance, remembered corner, a reference-
// counted page-scroll lock, and a smooth "glide to target" animation.
// Pure functions first (unit-tested); the DOM helpers at the bottom are small.
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

export function prefersReducedMotion() {
  return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.motion === "reduced";
}

/** Visible rects of other minimized floating windows (AI pill, YouTube pill). */
export function otherMinimizedRects(self) {
  return [...document.querySelectorAll(".aiw.is-minimized, .ytw.is-min")]
    .filter((n) => n !== self)
    .map((n) => n.getBoundingClientRect())
    .map((r) => ({ left: r.left, top: r.top, width: r.width, height: r.height }));
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
