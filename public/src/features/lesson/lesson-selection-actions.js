// ============================================================================
// public/src/features/lesson/lesson-selection-actions.js
// TEXT-SELECTION ACTIONS (Phase 5 step 4) — a small floating popup that
// appears over a text selection inside `.lesson-view__body` and offers
// "اشرحها" (explain this) / "بسّطها" (simplify it) / "اقرأها" (read aloud).
// The AI actions hand selected text to lesson-view.js's
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
 * @param {(selectedText: string) => (void|boolean|Promise<void|boolean>)} onExplain
 * @param {(selectedText: string) => (void|boolean|Promise<void|boolean>)} onSimplify
 * @param {(selectedText: string) => (void|boolean|Promise<void|boolean>)} onRead
 * @returns {() => void} teardown - removes all listeners/DOM this call added
 */
export function equipLessonSelectionActions(root, onExplain, onSimplify, onRead) {
  const body = root.querySelector(".lesson-view__body");
  if (!body) return () => { };

  let popupEl = null;
  let capturedText = "";
  let popupInteraction = false;
  let popupInteractionTimer = 0;

  function markPopupInteraction() {
    popupInteraction = true;
    window.clearTimeout(popupInteractionTimer);
    // Give selectionchange/mouseup enough time to settle without dismissing
    // the popup that the user is actively interacting with.
    popupInteractionTimer = window.setTimeout(() => {
      popupInteraction = false;
    }, 250);
  }

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
    popup.setAttribute("aria-label", "إجراءات النص المحدد");

    function bindActionButton(button, action) {
      let handledByPointer = false;

      // Some browsers fire selectionchange between mousedown and click. If
      // that collapses the selection, the document-level selection listener
      // used to remove the popup before click could run. Handle pointerdown
      // directly on the button, prevent its default selection-changing
      // behavior, and keep click as the keyboard-accessible fallback.
      button.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        handledByPointer = true;
        markPopupInteraction();
        void runAction(button, capturedText, action);
      });

      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (handledByPointer) {
          handledByPointer = false;
          return;
        }
        markPopupInteraction();
        void runAction(button, capturedText, action);
      });
    }

    const explainBtn = document.createElement("button");
    explainBtn.type = "button";
    explainBtn.className = `${POPUP_CLASS}__btn`;
    explainBtn.textContent = "اشرحها";
    bindActionButton(explainBtn, onExplain);

    const simplifyBtn = document.createElement("button");
    simplifyBtn.type = "button";
    simplifyBtn.className = `${POPUP_CLASS}__btn`;
    simplifyBtn.textContent = "بسّطها";
    bindActionButton(simplifyBtn, onSimplify);

    const readBtn = document.createElement("button");
    readBtn.type = "button";
    readBtn.className = `${POPUP_CLASS}__btn`;
    readBtn.textContent = "اقرأها";
    bindActionButton(readBtn, onRead);

    async function runAction(button, text, action) {
      if (!text || typeof action !== "function") return;
      popup.querySelectorAll("button").forEach((item) => { item.disabled = true; });
      const original = button.textContent;
      button.textContent = button === readBtn ? "جارٍ القراءة…" : "جارٍ فتح المساعد…";
      setPopupStatus(
        button === readBtn ? "جارٍ بدء القراءة…" : "جارٍ تجهيز الطلب…",
        false,
      );
      try {
        const result = await action(text);
        if (result === false) throw new Error("action_failed");
        removePopup();
      } catch (error) {
        console.error("[lesson-selection-actions] AI action failed:", error);
        popup.querySelectorAll("button").forEach((item) => { item.disabled = false; });
        button.textContent = original;
        setPopupStatus(
          button === readBtn
            ? "تعذر بدء القراءة الصوتية. تحقق من إعدادات الصوت ثم حاول مرة أخرى."
            : "تعذر تشغيل المساعد. تحقق من الاتصال ثم حاول مرة أخرى.",
          true,
        );
      }
    }

    function setPopupStatus(message, isError) {
      let status = popup.querySelector(".lesson-selection-popup__status");
      if (!status) {
        status = document.createElement("span");
        status.className = "lesson-selection-popup__status";
        status.setAttribute("role", "status");
        status.setAttribute("aria-live", "polite");
        popup.appendChild(status);
      }
      status.textContent = message;
      status.classList.toggle("is-error", Boolean(isError));
      const nextRect = popup.getBoundingClientRect();
      const gap = 8;
      let top = rect.top - nextRect.height - gap;
      if (top < gap) top = rect.bottom + gap;
      popup.style.top = `${top}px`;
      popup.style.left = `${rect.left + rect.width / 2 - nextRect.width / 2}px`;
      clampFloatingElementToViewport(popup, gap);
    }

    popup.appendChild(explainBtn);
    popup.appendChild(simplifyBtn);
    popup.appendChild(readBtn);
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
    if (popupInteraction) return;
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
    window.clearTimeout(popupInteractionTimer);
    popupInteraction = false;
    document.removeEventListener("selectionchange", handleSelectionChange);
    document.removeEventListener("mouseup", handleSelectionChange);
    document.removeEventListener("touchend", handleSelectionChange);
    document.removeEventListener("mousedown", handlePointerDown, true);
    document.removeEventListener("keydown", handleKeydown);
    removePopup();
  };
}