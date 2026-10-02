// ============================================================================
// SHARED GLOBAL MARKDOWN + LATEX TOOLBAR
// ============================================================================
// Shared by create-lesson and create-quiz. The page supplies formatting and
// media callbacks; this module owns focus/selection safety, dropdown state,
// viewport placement, outside-click/Escape handling, and keyboard access.
// ============================================================================

import { mountColorPicker } from "./color-picker.js";

let activeTextarea = null;
let lastCapturedSelection = null;
const initializedBars = new WeakSet();
const barStates = new WeakMap();
let tipEl = null;
let tipTimer = null;

function escapeCss(value) {
  if (globalThis.CSS?.escape) return CSS.escape(String(value));
  return String(value).replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
}

function showNoFieldTip() {
  if (!tipEl) {
    tipEl = document.createElement("div");
    tipEl.className = "gmd-no-field-tip";
    tipEl.textContent = "انقر على حقل نصي أولاً";
    tipEl.setAttribute("role", "status");
    tipEl.setAttribute("aria-live", "polite");
    document.body.appendChild(tipEl);
  }
  clearTimeout(tipTimer);
  tipEl.classList.add("visible");
  tipTimer = window.setTimeout(() => tipEl?.classList.remove("visible"), 1800);
}

function updateActiveFromTarget(target) {
  if (!target || !(target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement)) return;
  if (
    target.classList.contains("md-source") ||
    target.classList.contains("wp-textarea") ||
    target.id === "quiz-title" ||
    target.id === "lessonTitle" ||
    target.id === "lessonDescription"
  ) {
    activeTextarea = target;
    if (typeof target.selectionStart === "number") {
      lastCapturedSelection = {
        textarea: target,
        start: target.selectionStart,
        end: typeof target.selectionEnd === "number" ? target.selectionEnd : target.selectionStart,
      };
    }
  }
}

function trackTextareaFocus() {
  if (trackTextareaFocus.installed) return;
  trackTextareaFocus.installed = true;

  // Track both focus and caret/selection changes across the document
  document.addEventListener("focusin", (event) => updateActiveFromTarget(event.target), true);
  document.addEventListener("keyup", (event) => updateActiveFromTarget(event.target), true);
  document.addEventListener("mouseup", (event) => updateActiveFromTarget(event.target), true);
  document.addEventListener("select", (event) => updateActiveFromTarget(event.target), true);
  document.addEventListener("input", (event) => updateActiveFromTarget(event.target), true);
}

function allMenus() {
  return [...document.querySelectorAll(".gmd-dropdown-menu")];
}

function findToggle(menu) {
  const id = menu?.id;
  if (!id) return null;
  return document.querySelector(`[data-gmd-menu-id="${escapeCss(id)}"], [aria-controls="${escapeCss(id)}"]`);
}

export function closeAllGmdDropdowns() {
  for (const menu of allMenus()) {
    if (menu.classList.contains("open") || menu.hasAttribute("data-gmd-open")) {
      menu.classList.remove("open");
      menu.removeAttribute("data-gmd-open");
      menu.setAttribute("aria-hidden", "true");
      menu.style.display = "none";
      const toggle = findToggle(menu);
      if (toggle) {
        toggle.setAttribute("aria-expanded", "false");
        toggle.classList.remove("active", "gmd-btn-active");
      }
    }
  }
}

function captureSelection() {
  if (activeTextarea && document.body.contains(activeTextarea)) {
    return {
      textarea: activeTextarea,
      start: typeof activeTextarea.selectionStart === "number" ? activeTextarea.selectionStart : (lastCapturedSelection?.start ?? 0),
      end: typeof activeTextarea.selectionEnd === "number" ? activeTextarea.selectionEnd : (lastCapturedSelection?.end ?? 0),
    };
  }
  if (lastCapturedSelection && document.body.contains(lastCapturedSelection.textarea)) {
    return { ...lastCapturedSelection };
  }
  const ae = document.activeElement;
  if ((ae instanceof HTMLTextAreaElement || ae instanceof HTMLInputElement) && ae.classList.contains("md-source")) {
    activeTextarea = ae;
    return {
      textarea: ae,
      start: ae.selectionStart ?? 0,
      end: ae.selectionEnd ?? 0,
    };
  }
  return null;
}

function restoreSelection(selection) {
  const target = selection?.textarea || activeTextarea || lastCapturedSelection?.textarea;
  if (!target || !document.body.contains(target)) return null;
  activeTextarea = target;
  target.focus({ preventScroll: true });
  const start = typeof selection?.start === "number" ? selection.start : (target.selectionStart ?? 0);
  const end = typeof selection?.end === "number" ? selection.end : (target.selectionEnd ?? start);
  try {
    target.setSelectionRange(start, end);
  } catch {
    // Non-text input types can throw on setSelectionRange
  }
  return target;
}

function directItems(menu) {
  return [...menu.querySelectorAll(":scope > button.gmd-btn:not([disabled])")];
}

function setRoving(menu, index) {
  const items = directItems(menu);
  if (!items.length) return;
  const safe = (index + items.length) % items.length;
  items.forEach((item, i) => item.setAttribute("tabindex", i === safe ? "0" : "-1"));
  items[safe].focus({ preventScroll: true });
}

function focusFirstMenuItem(menu) {
  if (menu.id === "gmdHighlightMenu") {
    const swatch = menu.querySelector(".cp-swatch");
    if (swatch) swatch.focus({ preventScroll: true });
  } else {
    const items = directItems(menu);
    if (items.length) {
      items[0].setAttribute("tabindex", "0");
      items[0].focus({ preventScroll: true });
    }
  }
}

function setupMenuKeyboard(menu, toggle) {
  if (menu.dataset.gmdKeyboardReady === "1") return;
  menu.dataset.gmdKeyboardReady = "1";
  menu.addEventListener("keydown", (event) => {
    const items = directItems(menu);
    const current = items.indexOf(document.activeElement);
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeAllGmdDropdowns();
      toggle.focus({ preventScroll: true });
      return;
    }
    if (event.key === "Tab") {
      closeAllGmdDropdowns();
      return;
    }
    if (!items.length) return;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      setRoving(menu, current < 0 ? 0 : current + 1);
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      setRoving(menu, current < 0 ? items.length - 1 : current - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      setRoving(menu, 0);
    } else if (event.key === "End") {
      event.preventDefault();
      setRoving(menu, items.length - 1);
    }
  });
}

function positionMenu(toggle, menu) {
  if (!toggle || !menu) return;

  const toggleRect = toggle.getBoundingClientRect();
  if (toggleRect.width === 0 && toggleRect.height === 0) {
    closeAllGmdDropdowns();
    return;
  }

  const bar = toggle.closest(".global-md-bar") || document.getElementById("globalMdBar");
  if (bar) {
    const barRect = bar.getBoundingClientRect();
    // If toggle is scrolled outside visible horizontal or vertical bounds of the toolbar
    if (
      toggleRect.right < barRect.left - 12 ||
      toggleRect.left > barRect.right + 12 ||
      toggleRect.bottom < barRect.top - 12 ||
      toggleRect.top > barRect.bottom + 12
    ) {
      closeAllGmdDropdowns();
      return;
    }
  }

  const pad = 8;
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;

  // Clear previous inline dimensions so natural content sizing can be computed
  menu.style.visibility = "hidden";
  menu.style.display = "flex";
  menu.style.position = "fixed";
  menu.style.left = "0px";
  menu.style.top = "0px";
  menu.style.width = "";
  menu.style.maxWidth = "";
  menu.style.maxHeight = "";

  const maxAvailableW = Math.max(140, viewportW - pad * 2);
  const measuredW = menu.scrollWidth || menu.offsetWidth || 240;
  const menuW = Math.min(measuredW, maxAvailableW);

  // Vertical placement: place directly below the toolbar button
  const below = toggleRect.bottom + 4;
  const maxAvailableH = Math.max(100, viewportH - below - pad);

  // Horizontal placement: in RTL, align the menu's right edge to the toggle's right edge
  const isRtl = document.documentElement.dir === "rtl" || getComputedStyle(document.documentElement).direction === "rtl";
  let left;
  if (isRtl) {
    left = toggleRect.right - menuW;
    if (left < pad) left = pad;
    if (left + menuW > viewportW - pad) left = Math.max(pad, viewportW - menuW - pad);
  } else {
    left = toggleRect.left;
    if (left + menuW > viewportW - pad) left = Math.max(pad, viewportW - menuW - pad);
    if (left < pad) left = pad;
  }

  menu.style.boxSizing = "border-box";
  menu.style.width = `${menuW}px`;
  menu.style.maxWidth = `${maxAvailableW}px`;
  menu.style.top = `${Math.max(pad, below)}px`;
  menu.style.left = `${left}px`;
  menu.style.maxHeight = `${maxAvailableH}px`;
  menu.style.overflowY = "auto";
  menu.style.visibility = "";
}

function detachMenus(bar, toggles) {
  for (const { toggle, menu } of toggles) {
    if (!menu?.id) continue;
    if (menu.parentElement !== document.body) document.body.appendChild(menu);
    menu.dataset.gmdDetached = "true";
    toggle.dataset.gmdMenuId = menu.id;
    menu.setAttribute("aria-hidden", "true");
    menu.style.display = "none";
  }
}

function setupHighlightPicker(menu, state, onAction) {
  if (!menu || state.picker) return;
  state.picker = mountColorPicker(
    menu,
    (hex) => {
      const targetSelection = state.activeSelection || state.highlightSelection;
      const restored = restoreSelection(targetSelection);
      if (!restored) {
        showNoFieldTip();
        return;
      }
      onAction?.({
        cmd: "highlight",
        latex: null,
        extra: hex,
        textarea: restored,
        selection: targetSelection ? { start: targetSelection.start, end: targetSelection.end } : null,
      });
      closeAllGmdDropdowns();
    },
    closeAllGmdDropdowns,
    () => {
      closeAllGmdDropdowns();
      const toggle = document.getElementById("gmdHighlightToggle");
      toggle?.focus({ preventScroll: true });
    },
  );
}

/**
 * @param {{barId?:string,onAction?:(payload:object)=>void,onMedia?:(type:string,textarea:HTMLTextAreaElement|null)=>void}} options
 */
export function setupGlobalMarkdownToolbar({ barId = "globalMdBar", onAction, onMedia } = {}) {
  const bar = document.getElementById(barId);
  if (!bar) return null;
  if (initializedBars.has(bar)) return barStates.get(bar)?.api || null;
  initializedBars.add(bar);
  trackTextareaFocus();

  const state = { picker: null, highlightSelection: null, activeSelection: null, toggles: [] };
  barStates.set(bar, state);

  // Capture the menu relationship BEFORE detaching the popover into body.
  bar.querySelectorAll(".gmd-dropdown-toggle").forEach((toggle, index) => {
    const menu = toggle.nextElementSibling?.classList.contains("gmd-dropdown-menu")
      ? toggle.nextElementSibling
      : null;
    if (!menu) return;
    if (!menu.id) menu.id = `${bar.id}-dropdown-${index + 1}`;
    toggle.dataset.gmdMenuId = menu.id;
    toggle.setAttribute("aria-haspopup", "menu");
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-controls", menu.id);
    menu.setAttribute("role", "menu");
    menu.querySelectorAll(".gmd-btn").forEach((item) => {
      item.setAttribute("role", "menuitem");
      item.setAttribute("tabindex", "-1");
      item.setAttribute("type", "button");
    });
    state.toggles.push({ toggle, menu });
  });
  detachMenus(bar, state.toggles);

  // Menus are detached into <body>, so bind action buttons from both the
  // toolbar and the detached popovers.
  const actionButtons = [
    ...bar.querySelectorAll(".gmd-btn:not(.gmd-dropdown-toggle)"),
    ...state.toggles.flatMap(({ menu }) => [...menu.querySelectorAll(".gmd-btn:not(.gmd-dropdown-toggle)")]),
  ];
  actionButtons.forEach((button) => {
    button.setAttribute("type", "button");
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const stored = state.activeSelection;
      const textarea = restoreSelection(stored) || (activeTextarea && document.body.contains(activeTextarea) ? activeTextarea : null);
      const selection = stored && textarea === stored.textarea
        ? { start: stored.start, end: stored.end }
        : (textarea ? { start: textarea.selectionStart ?? 0, end: textarea.selectionEnd ?? 0 } : null);
      const cmd = button.dataset.gmdCmd || null;
      if (["image", "audio", "video"].includes(cmd)) {
        if (typeof onMedia === "function") onMedia(cmd, textarea);
      } else if (typeof onAction === "function") {
        if (!textarea) {
          showNoFieldTip();
        } else {
          onAction({
            cmd,
            latex: button.dataset.gmdLatex !== undefined ? button.dataset.gmdLatex : null,
            extra: button.dataset.gmdHeading || button.dataset.gmdColor || null,
            textarea,
            selection,
          });
        }
      }
      state.activeSelection = null;
      closeAllGmdDropdowns();
    });
  });

  const highlightMenu = document.getElementById("gmdHighlightMenu");
  if (highlightMenu) setupHighlightPicker(highlightMenu, state, onAction);

  for (const { toggle, menu } of state.toggles) {
    setupMenuKeyboard(menu, toggle);

    // Prevent mousedown on toggle from blurring the currently active textarea
    toggle.addEventListener("mousedown", (event) => event.preventDefault());

    // Keyboard support: Enter, Space, and ArrowDown
    toggle.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        event.stopPropagation();
        toggle.click();
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        event.stopPropagation();
        if (!menu.classList.contains("open")) {
          toggle.click();
        }
        focusFirstMenuItem(menu);
      } else if (event.key === "Escape") {
        event.preventDefault();
        closeAllGmdDropdowns();
      }
    });

    toggle.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const wasOpen = menu.classList.contains("open");
      if (wasOpen) {
        state.activeSelection = null;
        closeAllGmdDropdowns();
        return;
      }

      // Capture the editor range before focus can move into a menu
      state.activeSelection = captureSelection();
      closeAllGmdDropdowns();

      if (menu.id === "gmdHighlightMenu") {
        state.highlightSelection = state.activeSelection;
        state.picker?.refresh();
      }

      positionMenu(toggle, menu);
      menu.classList.add("open");
      menu.setAttribute("data-gmd-open", "true");
      menu.setAttribute("aria-hidden", "false");
      menu.style.display = "flex";
      toggle.setAttribute("aria-expanded", "true");
      toggle.classList.add("active", "gmd-btn-active");

      const items = directItems(menu);
      items.forEach((item, i) => item.setAttribute("tabindex", i === 0 ? "0" : "-1"));

      // If triggered via keyboard (detail === 0), move focus to first item
      if (event.detail === 0) {
        focusFirstMenuItem(menu);
      }
    });
  }

  const reposition = () => {
    const open = document.querySelector(".gmd-dropdown-menu.open[data-gmd-open]");
    if (!open) return;
    const toggle = findToggle(open);
    if (toggle) positionMenu(toggle, open);
  };

  // Immediate repositioning on scroll (both toolbar scroll and window scroll) and resize
  bar.addEventListener("scroll", reposition, { passive: true });
  window.addEventListener("resize", reposition, { passive: true });
  window.addEventListener("scroll", reposition, { passive: true, capture: true });

  // Escape closes any open dropdown and properly handles focus restoration
  if (!setupGlobalMarkdownToolbar.escapeInstalled) {
    setupGlobalMarkdownToolbar.escapeInstalled = true;
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      const open = document.querySelector(".gmd-dropdown-menu.open[data-gmd-open]");
      if (!open) return;
      event.preventDefault();
      event.stopPropagation();
      const toggle = findToggle(open);
      const wasFocusInMenu = open.contains(document.activeElement) || document.activeElement === toggle;
      closeAllGmdDropdowns();
      if (wasFocusInMenu) {
        toggle?.focus({ preventScroll: true });
      } else if (activeTextarea && document.body.contains(activeTextarea)) {
        activeTextarea.focus({ preventScroll: true });
      }
    }, true);
  }

  // Pointerdown outside active menu & toggle closes the dropdown
  if (!setupGlobalMarkdownToolbar.pointerdownInstalled) {
    setupGlobalMarkdownToolbar.pointerdownInstalled = true;
    document.addEventListener("pointerdown", (event) => {
      const openMenu = document.querySelector(".gmd-dropdown-menu.open[data-gmd-open]");
      if (!openMenu) return;

      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;

      const toggle = findToggle(openMenu);
      if (openMenu.contains(target) || (toggle && toggle.contains(target))) {
        return;
      }
      state.activeSelection = null;
      closeAllGmdDropdowns();
    }, true);
  }

  state.api = {
    getActiveTextarea: () => (activeTextarea && document.body.contains(activeTextarea) ? activeTextarea : null),
    captureSelection,
    restoreSelection,
    closeAll: closeAllGmdDropdowns,
  };
  return state.api;
}

export { activeTextarea };
