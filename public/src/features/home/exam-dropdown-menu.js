// ============================================================================
// EXAM DROPDOWN MENU ENGINE
// ============================================================================
// Replaces the old full-screen .modal-overlay/.exam-actions-sheet bottom
// sheet with a small anchored dropdown (.exam-dropdown-menu) attached to the
// ⋮ trigger button. It's appended to <body> (not the card) and positioned
// with getBoundingClientRect() so it's never clipped by a card's
// overflow:hidden, then closed on outside click / Escape / scroll / resize.
// Shared by showExamActionsOverlay and showUserQuizActionsOverlay.
//
// NOTE: this is the reference implementation for correct modal-dismiss
// cleanup — closeMenu() is the ONLY exit path and every close route
// (outside click, Escape, scroll, resize, or an explicit menu action) goes
// through it, so all listeners are always removed. The two leaked-listener
// bugs fixed elsewhere in this codebase (see modal-utils.js) were essentially
// copies of this pattern that didn't preserve that single-exit-point guarantee.
// ============================================================================

import { positionExamDropdownMenu } from "./floating-position.js";

/** Removes any currently-open dropdown menu(s). Defensive — normally only
 * one can be open at a time since opening a new one closes the last. */
export function closeAllExamDropdownMenus() {
  document.querySelectorAll(".exam-dropdown-menu").forEach((el) => el.remove());
}

/** Anchors `menu` below (or, if there's no room, above) `triggerBtn`,
 * right-edge aligned (this is an RTL UI), clamped so it never runs off
 * either side of the viewport. */

export function openExamDropdownMenu(triggerBtn, buildContent) {
  closeAllExamDropdownMenus();

  const menu = document.createElement("div");
  menu.className = "exam-dropdown-menu";
  menu.setAttribute("role", "menu");
  menu.style.visibility = "hidden";

  function closeMenu() {
    menu.remove();
    document.removeEventListener("click", onOutsideClick);
    document.removeEventListener("keydown", onKeydown);
    window.removeEventListener("resize", closeMenu);
    window.removeEventListener("scroll", onScroll, true);
  }

  // Global click listener — closes the dropdown when the user clicks
  // anywhere outside of it (or its trigger button).
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

  // Re-runs the menu's own viewport clamping. Needed because nested content
  // (like the "معلومات الإمتحان" submenu) can change the menu's effective
  // height/width after it's already been positioned — e.g. on narrow
  // viewports the submenu stacks inline below the trigger, growing the
  // menu tall enough to run off the bottom of the screen.
  function reposition() {
    positionExamDropdownMenu(menu, triggerBtn);
  }

  buildContent(menu, closeMenu, reposition);

  document.body.appendChild(menu);
  positionExamDropdownMenu(menu, triggerBtn);
  menu.style.visibility = "visible";

  // The click that opened this menu already had its propagation stopped by
  // the trigger button's own onclick handler, so it's safe to attach this
  // listener immediately without it firing on the same click.
  document.addEventListener("click", onOutsideClick);
  document.addEventListener("keydown", onKeydown);
  window.addEventListener("resize", closeMenu);
  window.addEventListener("scroll", onScroll, true);

  return closeMenu;
}


/**
 * Builds the "معلومات الإمتحان" row as a submenu: a trigger button plus a
 * popover (.submenu-content) previewing `basicRows`, with a "كل المعلومات"
 * button that closes the whole dropdown and calls `onShowFull` (which opens
 * the full quiz-info-modal-card). Reveals on hover for real pointer/mouse
 * devices, and toggles on click/tap everywhere (so it also works on desktop
 * via keyboard/click, and is the only way in on touch devices).
 */
export function createExamInfoSubmenu(basicRows, onShowFull, closeDropdown, reposition) {
  const container = document.createElement("div");
  container.className = "submenu-container";

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "exam-action-btn submenu-trigger";
  trigger.innerHTML = `<span class="submenu-trigger-label">${INFO_ICON_SVG}<span>معلومات الإمتحان</span></span><svg class="submenu-caret" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>`;

  const content = document.createElement("div");
  content.className = "submenu-content";
  content.innerHTML = basicRows.length
    ? basicRows
        .map(({ label, val, multiline, copyable }) => {
          const valAttrs = multiline ? ` class="multiline-val"` : "";
          const labelHtml = copyable
            ? `<span class="copyable-label">${escapeHtml(label)}:${COPY_CHECK_ICON_SVG}</span>`
            : `<span>${escapeHtml(label)}:</span>`;
          return `<div class="tooltip-row">${labelHtml}<span${valAttrs}>${escapeHtml(String(val))}</span></div>`;
        })
        .join("")
    : `<p class="quiz-info-empty">لا توجد معلومات إضافية</p>`;

  // Wire up copy-to-clipboard for any copyable rows (e.g. المصدر/source).
  // The UI indicator is a small check icon next to the label (swapped in for
  // the copy icon briefly) rather than text next to the value, so copying
  // never shifts or reflows the value itself.
  const rowEls = content.querySelectorAll(".tooltip-row");
  basicRows.forEach(({ val, copyable }, i) => {
    if (!copyable) return;
    const row = rowEls[i];
    if (!row) return;
    row.classList.add("copyable-row");
    row.onclick = (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(String(val)).then(() => {
        if (row.dataset.copying === "1") return;
        row.dataset.copying = "1";
        row.classList.add("copied");
        setTimeout(() => {
          row.classList.remove("copied");
          delete row.dataset.copying;
        }, 2000);
      });
    };
  });

  const moreBtn = document.createElement("button");
  moreBtn.type = "button";
  moreBtn.className = "exam-action-btn exam-action-btn--primary submenu-more-btn";
  moreBtn.textContent = "كل المعلومات";
  moreBtn.onclick = (e) => {
    e.stopPropagation();
    closeDropdown();
    onShowFull();
  };
  content.appendChild(moreBtn);

  container.appendChild(trigger);
  container.appendChild(content);

  function setOpen(open) {
    content.classList.toggle("show", open);
    container.classList.toggle("submenu-open", open);

    if (open) {
      // Reset any previous clamp overrides before measuring — otherwise
      // stale inline styles from a prior open (at a different viewport
      // size) would throw off this measurement.
      content.style.left = "";
      content.style.right = "";
      content.style.top = "";

      const isStacked =
        window.matchMedia && window.matchMedia("(max-width: 480px)").matches;

      if (!isStacked) {
        // Desktop/tablet: the submenu is absolutely positioned to the left
        // of its trigger (RTL layout). If the trigger sits near the left
        // edge of the screen, that would run the submenu off-screen — so
        // clamp it back into the viewport, matching the outer dropdown's
        // own clamping in positionExamDropdownMenu.
        const rect = content.getBoundingClientRect();
        const gap = 6;
        if (rect.left < gap) {
          const shift = gap - rect.left;
          content.style.right = `calc(100% + 8px - ${shift}px)`;
        }
        if (rect.bottom > window.innerHeight - gap) {
          const overflow = rect.bottom - (window.innerHeight - gap);
          content.style.top = `${-overflow}px`;
        }
      }
    }

    // The submenu opening/closing changes the dropdown menu's effective
    // size (especially when stacked inline on narrow viewports), so the
    // whole menu needs to be re-clamped to the viewport too.
    if (typeof reposition === "function") reposition();
  }

  // Desktop / real pointer devices: reveal on hover.
  if (
    window.matchMedia &&
    window.matchMedia("(hover: hover) and (pointer: fine)").matches
  ) {
    container.addEventListener("mouseenter", () => setOpen(true));
    container.addEventListener("mouseleave", () => setOpen(false));
  }

  // Mobile (and as a click fallback everywhere): tap the trigger to toggle.
  trigger.onclick = (e) => {
    e.stopPropagation();
    setOpen(!content.classList.contains("show"));
  };
  content.onclick = (e) => e.stopPropagation();

  return container;
}
