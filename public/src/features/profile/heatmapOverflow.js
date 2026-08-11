// public/src/features/profile/heatmapOverflow.js
// Toggles `.is-overflowing` on the heatmap body + grid so edge fades
// (on .heatmap-body) only show when the year strip is wider than the card.
//
// Runs on a ResizeObserver (container width changes: sidebar collapse,
// window resize, orientation change) and a MutationObserver (renderActivityHeatmap
// rebuilds the grid's innerHTML every refreshUI() call).

function syncOverflowState(container) {
  const grid = container.querySelector(".heatmap-grid");
  const body = container.querySelector(".heatmap-body");
  if (!grid) return;
  const isOverflowing = grid.scrollWidth > grid.clientWidth + 1;
  grid.classList.toggle("is-overflowing", isOverflowing);
  if (body) body.classList.toggle("is-overflowing", isOverflowing);
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
  const mutationObserver = new MutationObserver(() => {
    run();
    // After layout settles (fonts/cells), re-measure and scroll if needed.
    requestAnimationFrame(run);
  });
  mutationObserver.observe(container, { childList: true, subtree: false });
}
