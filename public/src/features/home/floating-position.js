// ============================================================================
// public/src/features/home/floating-position.js
// FLOATING ELEMENT POSITIONING — shared viewport-clamping helpers for
// anchored dropdowns/menus (fixed-position, escapes clipping ancestors).
// ============================================================================

export function positionExamDropdownMenu(menu, triggerBtn) {
  const rect = triggerBtn.getBoundingClientRect();
  const gap = 6;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const menuW = menu.offsetWidth;
  const menuH = menu.offsetHeight;

  // BUG FIX: on phones this clamped only to the raw viewport height, not
  // accounting for the fixed .bottom-nav bar sitting on top of the page's
  // bottom edge — so a menu tall enough to reach the bottom of the screen
  // (e.g. with several actions, including "حذف الإمتحان") could get placed
  // (or clamped) partly underneath the nav instead of above it. Reserve the
  // nav's height the same way positionCourseInfoTooltip already does for
  // the course-info tooltip.
  const bottomNav = document.querySelector(".bottom-nav");
  let bottomInset = 0;
  if (bottomNav && window.getComputedStyle(bottomNav).display !== "none") {
    const navRect = bottomNav.getBoundingClientRect();
    if (navRect.top < vh && navRect.height > 0) {
      bottomInset = vh - navRect.top;
    }
  }
  const availableVh = vh - bottomInset;

  let top = rect.bottom + gap;
  let left = rect.right - menuW;

  // Flip above the button if there isn't enough room below.
  if (top + menuH > availableVh - gap) {
    const above = rect.top - menuH - gap;
    top = above >= gap ? above : Math.max(gap, availableVh - menuH - gap);
  }

  // Clamp vertically within the available viewport (above the bottom nav) —
  // covers menus that grow taller after being positioned (e.g. expanding
  // the "معلومات الإمتحان" submenu inline on narrow viewports), which the
  // flip-above check above can't account for since it only runs once at
  // initial placement.
  if (top + menuH > availableVh - gap) top = availableVh - menuH - gap;
  if (top < gap) top = gap;

  // Clamp horizontally within the viewport.
  if (left < gap) left = gap;
  if (left + menuW > vw - gap) left = vw - menuW - gap;

  menu.style.top = `${top}px`;
  menu.style.left = `${left}px`;
}

/**
 * Nudges an already-CSS-positioned floating element (one anchored via
 * `position: absolute` + `right`/`top` offsets from a relatively-positioned
 * parent) back into the viewport if it currently overflows any edge, by
 * adding inline left/top overrides. Used for small popovers like the
 * course-info-tooltip that rely on static CSS for the common case but can
 * run off-screen for cards near a viewport edge.
 *
 * NOTE: this only rescues the element from *viewport* overflow. It can't
 * rescue it from being clipped by a scroll/clip ancestor (e.g. the mobile
 * `.grid-container`, which uses `overflow: hidden` to clip its list-row
 * children to a rounded border) — a `transform` on the element still keeps
 * it inside that ancestor's clipping box. For that case, see
 * `positionCourseInfoTooltip` below, which switches the element to
 * `position: fixed` instead so it escapes ancestor clipping entirely.
 */
export function clampFloatingElementToViewport(el, gap = 6) {
  el.style.transform = "";

  const rect = el.getBoundingClientRect();

  let shiftX = 0;
  let shiftY = 0;

  if (rect.left < gap) {
    shiftX = gap - rect.left;
  } else if (rect.right > window.innerWidth - gap) {
    shiftX = window.innerWidth - gap - rect.right;
  }

  if (rect.bottom > window.innerHeight - gap) {
    shiftY = window.innerHeight - gap - rect.bottom;
  }

  if (shiftX !== 0 || shiftY !== 0) {
    const computed = window.getComputedStyle(el).transform;
    const base = computed !== "none" ? computed : "";
    el.style.transform = `${base} translate(${shiftX}px, ${shiftY}px)`;
  }
}
