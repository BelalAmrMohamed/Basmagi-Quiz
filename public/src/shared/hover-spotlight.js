// =============================================================================
// public/src/shared/hover-spotlight.js
// Cursor-following "spotlight" for cards. Sets --spot-x / --spot-y (px, relative
// to the card) while a MOUSE pointer moves over a card; the CSS (::after radial
// gradient, pointer-events:none) does the rest. It changes no geometry, so it can
// never cause hover flicker. One delegated listener, rAF-throttled, no-op on
// touch / reduced-motion.
// =============================================================================
const CARD_SELECTOR = ".card, .category-card, .exam-card";

let installed = false;

export function installHoverSpotlight(root = document) {
  if (installed || typeof window === "undefined") return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  installed = true;

  let frame = 0;
  let pending = null;

  root.addEventListener("pointermove", (event) => {
    if (event.pointerType && event.pointerType !== "mouse") return;
    const card = event.target instanceof Element ? event.target.closest(CARD_SELECTOR) : null;
    if (!card) return;
    pending = { card, x: event.clientX, y: event.clientY };
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (!pending) return;
      const rect = pending.card.getBoundingClientRect();
      pending.card.style.setProperty("--spot-x", `${Math.round(pending.x - rect.left)}px`);
      pending.card.style.setProperty("--spot-y", `${Math.round(pending.y - rect.top)}px`);
      pending = null;
    });
  }, { passive: true });
}
