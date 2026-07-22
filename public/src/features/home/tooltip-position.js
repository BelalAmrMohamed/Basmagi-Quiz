// ============================================================================
// public/src/features/home/tooltip-position.js
// COURSE INFO TOOLTIP — positioning + dismiss-on-scroll for the small
// info popover shown from a course card's (i) button.
// ============================================================================

/**
 * Positions a `.course-info-tooltip` using `position: fixed` + coordinates
 * from the trigger button's `getBoundingClientRect()`, instead of relying on
 * its default `position: absolute` (relative to `.course-info-container`).
 *
 * Why: on mobile, cards live inside `.grid-container`, which sets
 * `overflow: hidden` to clip the list-rows to a rounded border. An
 * absolutely-positioned tooltip is a child of that clipping box, so for any
 * card near the bottom of the list, the tooltip gets cut off / hidden
 * instead of rendering below the list — exactly the "menu fails to display
 * above the greater parent .grid-container" bug. `position: fixed` is
 * positioned relative to the viewport instead, so it escapes that clipping
 * ancestor entirely — the same trick already used for `.exam-dropdown-menu`
 * (see openExamDropdownMenu above).
 *
 * Anchors below-right of the trigger (RTL UI, right-edge aligned), flipping
 * above it if there isn't enough room below, and clamps to the viewport.
 */
export function positionCourseInfoTooltip(tooltip, triggerBtn, gap = 8) {
  const rect = triggerBtn.getBoundingClientRect();
  const vh = window.innerHeight;

  // Account for fixed bottom navigation bar on mobile screen layouts
  const bottomNav = document.querySelector(".bottom-nav");
  let bottomInset = 0;
  if (bottomNav && window.getComputedStyle(bottomNav).display !== "none") {
    const navRect = bottomNav.getBoundingClientRect();
    if (navRect.top < vh && navRect.height > 0) {
      bottomInset = vh - navRect.top;
    }
  }

  const availableVh = vh - bottomInset;

  let tooltipH = tooltip.offsetHeight;
  if (!tooltipH) {
    const prevVis = tooltip.style.visibility;
    const prevOpacity = tooltip.style.opacity;
    tooltip.style.visibility = "hidden";
    tooltip.style.opacity = "0";
    tooltipH = tooltip.offsetHeight || 150;
    tooltip.style.visibility = prevVis;
    tooltip.style.opacity = prevOpacity;
  }

  // Flip above the trigger if there isn't enough room below in the available viewport.
  if (rect.bottom + gap + tooltipH > availableVh) {
    tooltip.classList.add("flip-above");
  } else {
    tooltip.classList.remove("flip-above");
  }
}
