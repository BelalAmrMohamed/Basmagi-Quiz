// src/scripts/features/profile/heatmapOverflow.js
// Toggles `.is-overflowing` on #activityHeatmap's .heatmap-grid so the
// fade-mask in profile.css only kicks in when the grid is actually wider
// than its container (dense history). Sparse history renders fewer columns
// than fit, so the grid is centered via `justify-content: safe center` in
// CSS and this class stays off — no fade needed, nothing to scroll.
//
// Runs on a ResizeObserver (container width changes: sidebar collapse,
// window resize, orientation change) and a MutationObserver (renderActivityHeatmap
// rebuilds the grid's innerHTML every refreshUI() call). Fully additive —
// does not touch profileWidgets.js or how the grid itself is built.

function syncOverflowState(container) {
  const grid = container.querySelector(".heatmap-grid");
  if (!grid) return;
  const isOverflowing = grid.scrollWidth > grid.clientWidth + 1;
  grid.classList.toggle("is-overflowing", isOverflowing);
}

export function initHeatmapOverflowSync() {
  const container = document.getElementById("activityHeatmap");
  if (!container) return;

  const run = () => syncOverflowState(container);

  run();

  const resizeObserver = new ResizeObserver(run);
  resizeObserver.observe(container);

  // The heatmap's innerHTML is fully replaced on every render, so watch
  // for that and re-check once the new grid is in the DOM.
  const mutationObserver = new MutationObserver(run);
  mutationObserver.observe(container, { childList: true, subtree: false });
}