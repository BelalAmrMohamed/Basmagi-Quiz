// ============================================================================
// public/src/features/home/empty-state.js
// SHARED EMPTY STATE — one builder for every "nothing to show here" panel.
// ============================================================================
// DEDUPLICATION: three near-identical empty states used to be hand-rolled
// inline (search-integration.js x2, user-quizzes-view.js x1), each with its
// own emoji glyph, its own inline styles, and slightly different copy. This
// is the single shared builder they all now call. All icons are inline SVG
// (aria-hidden) — no emoji anywhere in this file or its callers.

/**
 * Build a standardized "no results / nothing here" panel.
 *
 * @param {object}   options
 * @param {"grid"|"panel"} [options.variant="grid"] - "grid" spans the results
 *   grid (grid-column: 1 / -1) and uses the lighter .empty-state treatment;
 *   "panel" is a standalone card (used for "no quizzes yet" contexts that
 *   aren't inside a search-results grid).
 * @param {"search"|"folder"} [options.icon="search"] - which glyph to show.
 * @param {string}   options.title - main heading text.
 * @param {string}   [options.subtitle] - optional secondary line.
 * @returns {HTMLElement}
 */
export function createEmptyState({
    variant = "grid",
    icon = "search",
    title,
    subtitle = "",
}) {
    const el = document.createElement("div");
    el.setAttribute("role", "status");

    if (variant === "grid") {
        el.className = "empty-state";
    } else {
        el.className = "empty-state empty-state--panel";
        el.style.gridColumn = "1 / -1";
    }

    const iconSvg = icon === "folder" ? FOLDER_ICON_SVG : SEARCH_ICON_SVG;

    el.innerHTML = `
    <div class="empty-state-icon" aria-hidden="true">${iconSvg}</div>
    <h3>${title}</h3>
    ${subtitle ? `<p>${subtitle}</p>` : ""}
  `;

    return el;
}

const SEARCH_ICON_SVG =
    `<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>`;

const FOLDER_ICON_SVG =
    `<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h5.5l2 2H20a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z"/></svg>`;