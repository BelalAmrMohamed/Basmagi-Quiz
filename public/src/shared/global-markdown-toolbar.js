// ============================================================================
// SHARED GLOBAL MARKDOWN + LATEX TOOLBAR
// ============================================================================
// Shared by create-lesson and create-quiz. The page supplies formatting and
// media callbacks; this module owns focus/selection safety, dropdown state,
// viewport placement, outside-click/Escape handling, and keyboard access.
// ============================================================================

import { mountColorPicker } from "./color-picker.js";

let activeTextarea = null;
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

function trackTextareaFocus() {
  if (trackTextareaFocus.installed) return;
  trackTextareaFocus.installed = true;
  document.addEventListener("focusin", (event) => {
    const target = event.target;
    if (target instanceof HTMLTextAreaElement && target.classList.contains("md-source")) {
      activeTextarea = target;
    }
  }, true);
}

function allMenus() {
  return [...document.querySelectorAll(".gmd-dropdown-menu")];
}

function findToggle(menu) {
  const id = menu?.id;
  if (!id) return null;
  return document.querySelector(`[data-gmd-menu-id="${escapeCss(id)}"]`);
}

export function closeAllGmdDropdowns() {
  for (const menu of allMenus()) {
    menu.classList.remove("open");
    menu.removeAttribute("data-gmd-open");
    menu.setAttribute("aria-hidden", "true");
    const toggle = findToggle(menu);
    toggle?.setAttribute("aria-expanded", "false");
  }
}

function captureSelection() {
  const textarea = activeTextarea;
  if (!(textarea instanceof HTMLTextAreaElement) || !document.body.contains(textarea)) return null;
  return {
    textarea,
    start: textarea.selectionStart ?? 0,
    end: textarea.selectionEnd ?? 0,
  };
}

function restoreSelection(selection) {
  const textarea = selection?.textarea;
  if (!(textarea instanceof HTMLTextAreaElement) || !document.body.contains(textarea)) return null;
  activeTextarea = textarea;
  textarea.focus({ preventScroll: true });
  textarea.setSelectionRange(selection.start, selection.end);
  return textarea;
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
  const rect = toggle.getBoundingClientRect();
  const pad = 8;
  menu.style.visibility = "hidden";
  menu.style.position = "fixed";
  menu.style.display = "flex";
  menu.style.left = "0px";
  menu.style.top = "0px";
  menu.style.maxHeight = `${Math.max(140, window.innerHeight - pad * 2)}px`;

  const measuredWidth = menu.scrollWidth || menu.offsetWidth || 240;
  const width = Math.min(measuredWidth, Math.max(160, window.innerWidth - pad * 2));
  const measuredHeight = Math.min(menu.scrollHeight || menu.offsetHeight || 260, window.innerHeight - pad * 2);
  let left = rect.right - width;
  left = Math.max(pad, Math.min(left, window.innerWidth - width - pad));

  const below = rect.bottom + 4;
  const above = rect.top - measuredHeight - 4;
  const top = below + measuredHeight <= window.innerHeight - pad
    ? below
    : (above >= pad ? above : window.innerHeight - measuredHeight - pad);

  menu.style.width = `${width}px`;
  menu.style.top = `${Math.max(pad, top)}px`;
  menu.style.left = `${left}px`;
  menu.style.visibility = "";
}

function detachMenus(bar, toggles) {
  for (const { toggle, menu } of toggles) {
    if (!menu?.id) continue;
    if (menu.parentElement !== document.body) document.body.appendChild(menu);
    menu.dataset.gmdDetached = "true";
    toggle.dataset.gmdMenuId = menu.id;
    menu.setAttribute("aria-hidden", "true");
  }
}

function setupHighlightPicker(menu, state, onAction) {
  if (!menu || state.picker) return;
  state.picker = mountColorPicker(
    menu,
    (hex) => {
      const restored = restoreSelection(state.highlightSelection);
      if (!restored) {
        showNoFieldTip();
        return;
      }
      onAction?.({
        cmd: "highlight",
        latex: null,
        extra: hex,
        textarea: restored,
        selection: { start: state.highlightSelection.start, end: state.highlightSelection.end },
      });
      closeAllGmdDropdowns();
    },
    closeAllGmdDropdowns,
    () => {
      closeAllGmdDropdowns();
      document.getElementById("gmdHighlightToggle")?.focus({ preventScroll: true });
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
  // toolbar and the detached popovers. Binding after detachment also prevents
  // selector changes in either page from silently losing menu behavior.
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
    toggle.addEventListener("mousedown", (event) => event.preventDefault());
    toggle.addEventListener("keydown", (event) => {
      if ((event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") && !menu.classList.contains("open")) {
        event.preventDefault();
        toggle.click();
      } else if (event.key === "Escape") {
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

      // Capture the editor range before focus can move into the detached
      // viewport popover. This range is restored when a dropdown item is
      // chosen, so formatting never jumps to the wrong cursor position.
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
      toggle.setAttribute("aria-expanded", "true");

      const items = directItems(menu);
      items.forEach((item, i) => item.setAttribute("tabindex", i === 0 ? "0" : "-1"));
      if (event.detail === 0) {
        if (menu.id === "gmdHighlightMenu") state.picker?.focusFirst();
        else items[0]?.focus({ preventScroll: true });
      }
    });
  }

  const reposition = () => {
    const open = document.querySelector(".gmd-dropdown-menu.open[data-gmd-open]");
    if (!open) return;
    const toggle = findToggle(open);
    if (toggle) positionMenu(toggle, open);
  };
  window.addEventListener("resize", reposition, { passive: true });
  window.addEventListener("scroll", reposition, { passive: true, capture: true });

  // A single document-level Escape handler makes keyboard dismissal reliable
  // even when focus is inside a detached menu item or the color picker.
  if (!setupGlobalMarkdownToolbar.escapeInstalled) {
    setupGlobalMarkdownToolbar.escapeInstalled = true;
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      const open = document.querySelector(".gmd-dropdown-menu.open[data-gmd-open]");
      if (!open) return;
      event.preventDefault();
      event.stopPropagation();
      const toggle = findToggle(open);
      closeAllGmdDropdowns();
      toggle?.focus({ preventScroll: true });
    }, true);
  }

  // Close only when the pointer starts outside the bar and all detached menus.
  document.addEventListener("pointerdown", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.closest(`#${escapeCss(bar.id)}`) || target.closest(".gmd-dropdown-menu")) return;
    state.activeSelection = null;
    closeAllGmdDropdowns();
  });

  state.api = {
    getActiveTextarea: () => activeTextarea && document.body.contains(activeTextarea) ? activeTextarea : null,
    captureSelection,
    restoreSelection,
    closeAll: closeAllGmdDropdowns,
  };
  return state.api;
}

export { activeTextarea };
