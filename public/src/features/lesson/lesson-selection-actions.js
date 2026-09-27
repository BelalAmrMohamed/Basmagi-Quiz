// ============================================================================
// public/src/features/lesson/lesson-selection-actions.js
// TEXT-SELECTION AI ACTIONS (Phase 5 step 4) — a small floating popup that
// appears over a text selection inside `.lesson-view__body` and offers
// "اشرح ده" (explain this) / "بسّطها" (simplify it), each handing the
// selected text to the lesson AI Agent via lesson-view.js's
// openLessonAgentWithPrompt() (passed in as onExplain/onSimplify below —
// this module never talks to the AI Agent directly, keeping exactly one
// place that knows how to open it).
//
// The critical ordering problem this solves: clicking a button collapses
// the browser's current text selection *before* the click handler runs
// (mousedown already clears it on most engines), and opening the AI modal
// steals focus, which would also collapse it. So the selected text is
// captured once, at popup-build time (on `selectionchange`/`mouseup`), and
// stored in a closure — the button's own click handler never re-reads
// `window.getSelection()`.
// ============================================================================

import { clampFloatingElementToViewport } from "../home/floating-position.js";

const POPUP_CLASS = "lesson-selection-popup";

/**
 * Wires selection-triggered AI actions inside `root` (the lesson page's
 * outer container — the popup only reacts to selections that land inside
 * `.lesson-view__body`, so selecting the ToC, comments, or quiz UI text
 * never triggers it).
 *
 * @param {HTMLElement} root
 * @param {(selectedText: string) => void} onExplain
 * @param {(selectedText: string) => void} onSimplify
 * @returns {() => void} teardown - removes all listeners/DOM this call added
 */
export function equipLessonSelectionActions(root, onExplain, onSimplify) {
  const body = root.querySelector(".lesson-view__body");
  if (!body) return () => { };

  let popupEl = null;
  let capturedText = "";

  function removePopup() {
    popupEl?.remove();
    popupEl = null;
  }

  function buildPopup(rect, text) {
    removePopup();
    capturedText = text;

    const popup = document.createElement("div");
    popup.className = POPUP_CLASS;
    popup.setAttribute("role", "toolbar");
    popup.setAttribute("aria-label", "إجراءات الذكاء الاصطناعي على النص المحدد");

    const explainBtn = document.createElement("button");
    explainBtn.type = "button";
    explainBtn.className = `${POPUP_CLASS}__btn`;
    explainBtn.textContent = "اشرحها";
    // Capture-time text, not a live selection read — see module doc above.
    explainBtn.addEventListener("mousedown", (e) => e.preventDefault()); // don't let the button steal/collapse selection on mousedown either
    explainBtn.addEventListener("click", () => {
      const text = capturedText;
      removePopup();
      onExplain?.(text);
    });

    const simplifyBtn = document.createElement("button");
    simplifyBtn.type = "button";
    simplifyBtn.className = `${POPUP_CLASS}__btn`;
    simplifyBtn.textContent = "بسّطها";
    simplifyBtn.addEventListener("mousedown", (e) => e.preventDefault());
    simplifyBtn.addEventListener("click", () => {
      const text = capturedText;
      removePopup();
      onSimplify?.(text);
    });

    popup.appendChild(explainBtn);
    popup.appendChild(simplifyBtn);
    document.body.appendChild(popup);
    popupEl = popup;

    // Fixed-position, centered above the selection's own bounding rect
    // (viewport coords — getBoundingClientRect() is already viewport-
    // relative, matching `position: fixed`). Clamped back into the
    // viewport afterward so a selection near an edge doesn't render the
    // popup partly off-screen.
    const gap = 8;
    const popupRect = popup.getBoundingClientRect();
    let top = rect.top - popupRect.height - gap;
    if (top < gap) top = rect.bottom + gap; // flip below the selection if there's no room above
    const left = rect.left + rect.width / 2 - popupRect.width / 2;

    popup.style.top = `${top}px`;
    popup.style.left = `${left}px`;
    clampFloatingElementToViewport(popup, gap);
  }

  function handleSelectionChange() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      removePopup();
      return;
    }
    const text = selection.toString().trim();
    if (!text) {
      removePopup();
      return;
    }
    const range = selection.getRangeAt(0);
    // Only react to selections that live inside the lesson body itself —
    // not the ToC, quiz controls, comments, or the popup's own buttons.
    const anchorNode = range.commonAncestorContainer;
    const anchorEl = anchorNode.nodeType === Node.ELEMENT_NODE ? anchorNode : anchorNode.parentElement;
    if (!anchorEl || !body.contains(anchorEl)) {
      removePopup();
      return;
    }
    const rect = range.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) {
      removePopup();
      return;
    }
    buildPopup(rect, text);
  }

  // `selectionchange` fires continuously while dragging; `mouseup` and
  // `touchend` catch the point where the reader has actually finished
  // choosing a range (also covers double/triple-click word/paragraph
  // selection, which never fires a drag-mouseup after the selection).
  document.addEventListener("selectionchange", handleSelectionChange);
  document.addEventListener("mouseup", handleSelectionChange);
  document.addEventListener("touchend", handleSelectionChange);

  // Dismiss on outside interaction that isn't itself the start of a new
  // in-body selection (a plain click elsewhere, scrolling the page, or
  // Escape).
  function handlePointerDown(e) {
    if (popupEl && !popupEl.contains(e.target)) removePopup();
  }
  function handleKeydown(e) {
    if (e.key === "Escape") removePopup();
  }
  document.addEventListener("mousedown", handlePointerDown, true);
  document.addEventListener("keydown", handleKeydown);

  return function teardown() {
    document.removeEventListener("selectionchange", handleSelectionChange);
    document.removeEventListener("mouseup", handleSelectionChange);
    document.removeEventListener("touchend", handleSelectionChange);
    document.removeEventListener("mousedown", handlePointerDown, true);
    document.removeEventListener("keydown", handleKeydown);
    removePopup();
  };
}