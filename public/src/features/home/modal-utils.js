// ============================================================================
// MODAL UTILITIES — shared dismiss/cleanup wiring for overlay-style modals
// ============================================================================
//
// BUG FIX (memory leak): the original code wired a document-level Escape-key
// listener per modal, but only removed it from the Escape-key handler itself
// and the overlay-click-outside handler. Every other way of closing a modal
// (a Cancel button, a Create/Confirm button, etc.) called `close()` without
// removing that listener, so a dead `keydown` listener stayed attached to
// `document` forever every time one of those modals was dismissed via a
// button. Repeated use of "احفظ اختبار" / "برومبت الذكاء الاصطناعي" would
// accumulate stray listeners over a session.
//
// Fix: centralize the wiring so there is exactly ONE way to close a modal,
// and cleanup (removing the escape listener) always happens as part of that
// single path — the same pattern already used correctly by
// exam-dropdown-menu.js's openExamDropdownMenu()/closeMenu().

/**
 * Wires standard modal dismiss behavior (Escape key + click-outside-overlay)
 * around a caller-supplied `dismiss` function, and returns a `close()`
 * function that the caller should use as the ONLY way to close the modal
 * (from every button, not just Cancel/overlay-click). This guarantees the
 * Escape listener is always cleaned up, regardless of which UI element
 * triggered the close.
 *
 * @param {HTMLElement} overlay - the outer `.modal-overlay` element; a click
 *   directly on this element (i.e. outside the modal card) triggers dismiss.
 * @param {() => void} dismiss - performs the actual visual removal (e.g. the
 *   fade-out + `overlay.remove()` sequence). Called at most once.
 * @returns {() => void} close - call this from every button/action that
 *   should close the modal. Idempotent.
 */
export function wireModalDismiss(overlay, dismiss) {
  let closed = false;

  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", escHandler);
    dismiss();
  };

  function escHandler(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  }

  document.addEventListener("keydown", escHandler);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });

  return close;
}

/**
 * Standard fade-out-then-remove dismiss animation shared by the modals that
 * used this exact inline pattern (opacity + translateY transition before
 * removing the node).
 *
 * @param {HTMLElement} overlay
 * @param {HTMLElement} modalCard
 */
export function fadeOutAndRemove(overlay, modalCard) {
  overlay.style.opacity = "0";
  overlay.style.transition = "opacity 0.2s";
  if (modalCard) {
    modalCard.style.transform = "translateY(10px)";
    modalCard.style.transition = "transform 0.2s";
  }
  setTimeout(() => overlay.remove(), 200);
}
