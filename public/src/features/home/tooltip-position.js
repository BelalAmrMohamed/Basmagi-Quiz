// ============================================================================
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
  // Reset any inline overrides from a previous placement so measurements
  // below reflect the tooltip's natural size.
  tooltip.style.transform = "";
  tooltip.style.top = "";
  tooltip.style.left = "";
  tooltip.style.right = "";
  tooltip.style.position = "fixed";

  const rect = triggerBtn.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const tooltipW = tooltip.offsetWidth;
  const tooltipH = tooltip.offsetHeight;

  let top = rect.bottom + gap;
  let left = rect.right - tooltipW; // right-edge aligned with the trigger

  // Flip above the trigger if there isn't enough room below.
  if (top + tooltipH > vh - gap) {
    const above = rect.top - tooltipH - gap;
    top = above >= gap ? above : Math.max(gap, vh - tooltipH - gap);
  }

  // Clamp within the viewport on both axes.
  if (left < gap) left = gap;
  if (left + tooltipW > vw - gap) left = vw - tooltipW - gap;
  if (top < gap) top = gap;
  if (top + tooltipH > vh - gap) top = vh - tooltipH - gap;

  tooltip.style.top = `${top}px`;
  tooltip.style.left = `${left}px`;
}

/**
 * Wires up close-on-scroll/resize for an open, fixed-position course-info
 * tooltip. Fixed-position elements don't move with page scroll the way the
 * old absolute-positioned ones did (which scrolled with their card), so
 * without this the tooltip would visually detach from its trigger button
 * as soon as the page scrolls. Closing it (matching the existing "outside
 * click" behavior) is simpler and safer than re-positioning on every
 * scroll/resize tick.
 */
export function attachCourseInfoTooltipDismissOnScroll(tooltip) {
  function close() {
    tooltip.classList.remove("show");
    window.removeEventListener("scroll", close, true);
    window.removeEventListener("resize", close);
  }
  window.addEventListener("scroll", close, true);
  window.addEventListener("resize", close);
}
