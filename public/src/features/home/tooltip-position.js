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
 * BUG FIX: this function previously only toggled the `flip-above` class,
 * which under the CSS default `position: absolute` still left the tooltip
 * inside `.course-info-container`'s containing block — so it stayed subject
 * to `.grid-container`'s `overflow: hidden` clipping and, because the
 * container's own z-index/stacking context sits below other page chrome, it
 * could also render visually "under" later siblings. This now actually
 * switches the tooltip to `position: fixed` and sets explicit `top`/`left`
 * pixel coordinates (same technique `positionExamDropdownMenu` already uses
 * for `.exam-dropdown-menu`), which both escapes the clipping ancestor and
 * — since a fixed-position element is promoted out of its old stacking
 * context — lets `--z-tooltip` actually govern its stacking against the
 * rest of the page, including the bottom nav.
 *
 * Anchors below-right of the trigger (RTL UI, right-edge aligned), flipping
 * above it if there isn't enough room below, and clamps to the viewport.
 */
export function positionCourseInfoTooltip(tooltip, triggerBtn, gap = 8) {
  const rect = triggerBtn.getBoundingClientRect();
  const vw = window.innerWidth;
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

  // Switch to viewport-relative fixed positioning so the tooltip can escape
  // any clipping/stacking ancestor. Clear any previous inline placement
  // before measuring, so a stale width/position from a prior open (at a
  // different trigger or viewport size) can't throw off this measurement.
  tooltip.style.position = "fixed";
  tooltip.style.margin = "0";
  tooltip.style.top = "";
  tooltip.style.bottom = "";
  tooltip.style.left = "";
  tooltip.style.right = "";

  let tooltipW = tooltip.offsetWidth;
  let tooltipH = tooltip.offsetHeight;
  if (!tooltipH || !tooltipW) {
    const prevVis = tooltip.style.visibility;
    const prevOpacity = tooltip.style.opacity;
    tooltip.style.visibility = "hidden";
    tooltip.style.opacity = "0";
    tooltipW = tooltip.offsetWidth || 200;
    tooltipH = tooltip.offsetHeight || 150;
    tooltip.style.visibility = prevVis;
    tooltip.style.opacity = prevOpacity;
  }

  // Flip above the trigger if there isn't enough room below in the available viewport.
  const flipAbove = rect.bottom + gap + tooltipH > availableVh;
  tooltip.classList.toggle("flip-above", flipAbove);

  let top = flipAbove ? rect.top - gap - tooltipH : rect.bottom + gap;
  // Clamp vertically within the available viewport (above the bottom nav).
  if (top + tooltipH > availableVh - gap) top = availableVh - tooltipH - gap;
  if (top < gap) top = gap;

  // Right-edge aligned under the trigger (RTL UI), clamped horizontally.
  let left = rect.right - tooltipW;
  if (left < gap) left = gap;
  if (left + tooltipW > vw - gap) left = vw - tooltipW - gap;

  tooltip.style.top = `${top}px`;
  tooltip.style.left = `${left}px`;
}
