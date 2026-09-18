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
 * Measures the tooltip's real rendered size (forcing its shown layout state
 * off-screen first, see below) rather than guessing, so placement is
 * accurate on every call including the very first one.
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

  const hadShow = tooltip.classList.contains("show");
  const prevVisibility = tooltip.style.visibility;
  const prevOpacity = tooltip.style.opacity;
  const prevTransform = tooltip.style.transform;
  tooltip.classList.add("show");
  tooltip.style.visibility = "hidden"; // stay invisible to the user during this forced measurement...
  tooltip.style.opacity = "1"; // ...but force the "shown" layout box (no translateY offset)
  tooltip.style.transform = "none";

  const tooltipW = tooltip.offsetWidth;
  const tooltipH = tooltip.offsetHeight;

  tooltip.style.visibility = prevVisibility;
  tooltip.style.opacity = prevOpacity;
  tooltip.style.transform = prevTransform;
  tooltip.classList.toggle("show", hadShow);

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
  tooltip.style.bottom = "auto";
  tooltip.style.left = `${left}px`;
}
