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

  // BUG FIX: this used to measure `offsetWidth`/`offsetHeight` BEFORE the
  // `.show` class was applied by the caller, i.e. while the tooltip still
  // had `opacity: 0; visibility: hidden; transform: translateY(-5px)`.
  // `visibility: hidden` keeps the element in normal layout flow, so it
  // usually still reports a real size — but combined with `width:
  // max-content` and a `transform`, some browsers deferred/optimized that
  // layout pass and returned 0 here intermittently (most reliably on a
  // fast desktop hover-in, before the previous tooltip's close transition
  // had settled). Whenever that happened, the code fell back to a
  // hardcoded 200×150 guess, which is nothing like this tooltip's real
  // size — producing exactly the "shows up in an unexpected place /
  // sometimes doesn't appear" symptom on desktop hover (mobile tap was
  // largely unaffected, since a fresh, settled tooltip on first open
  // almost always measured correctly the old way).
  //
  // Fix: temporarily force the tooltip into its actual shown layout state
  // (`.show`, opacity 1, no transform) while still invisible to the user,
  // measure it for real, then restore whatever `.show` state the caller
  // wants. This guarantees `tooltipW`/`tooltipH` reflect the tooltip's
  // true rendered size every time — no fallback guess needed.
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

  // BUG FIX: the CSS `.course-info-tooltip.flip-above` rule sets
  // `bottom: 100%` (positioning the tooltip's bottom edge at the
  // viewport's own bottom edge, since this is `position: fixed`) so it
  // can grow upward from the trigger. Earlier this only cleared any
  // *previous* inline `top`/`bottom` with `tooltip.style.top = ""` before
  // measuring, then unconditionally set `tooltip.style.top` here — but
  // never cleared `bottom` again afterward. So whenever `.flip-above` was
  // active, the element ended up with BOTH an inline `top: <px>` AND a
  // class-driven `bottom: 100%` in effect at once. A `position: fixed`
  // box with both `top` and `bottom` set and no explicit `height` has its
  // height computed as the distance between them — here, `100% of the
  // viewport` minus `top` — which has nothing to do with the tooltip's
  // actual content size. That stretched/mispositioned box is why the
  // background (and border/shadow) rendered somewhere other than where
  // the text appeared to sit, exactly when flip-above was in play.
  // Fix: whichever edge we're NOT driving with inline `top` gets an
  // explicit `auto`, so only one of `top`/`bottom` is ever a real
  // constraint at a time — matching what `.flip-above`'s own CSS
  // (`top: auto`) already does for the non-fixed fallback state.
  tooltip.style.top = `${top}px`;
  tooltip.style.bottom = "auto";
  tooltip.style.left = `${left}px`;
}
