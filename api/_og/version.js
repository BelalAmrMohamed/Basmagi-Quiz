// =============================================================================
// api/_og/version.js — single source of truth for OG image cache-busting.
//
// Every OG image is cached for a YEAR per URL (immutable), so the URL itself
// must change whenever the picture would. Two ingredients:
//   1. LAYOUT version (below) — bump ONLY when a layout/design changes for
//      every item of that kind at once.
//   2. CONTENT stamp — something that changes with the item's data
//      (updated_at timestamp, or the counts for courses). Callers pass it to
//      ogVersion(); nobody hand-bumps a number for data changes any more.
//
// Used by api/render-quiz.js, api/render-course.js, api/seo.js and
// scripts/og-snapshot.mjs. Plain module, no deps — safe in Node and Edge.
// =============================================================================

export const OG_LAYOUT_VERSION = {
  quiz: 4,
  course: 6, // 6: counts in the table, course info under it, SVG icons
  lesson: 1,
  notebook: 1,
};

/**
 * @param {"quiz"|"course"|"lesson"|"notebook"} kind
 * @param {string|number|Array<string|number>|null} [stamp] content fingerprint
 * @returns {string} e.g. "6-1-1-4-0" — use as the `v=` query value
 */
export function ogVersion(kind, stamp = null) {
  const base = String(OG_LAYOUT_VERSION[kind] ?? 1);
  const parts = (Array.isArray(stamp) ? stamp : [stamp]).filter((x) => x !== null && x !== undefined && x !== "" && !Number.isNaN(x));
  return parts.length ? `${base}-${parts.join("-")}` : base;
}

/** Date | ISO string | null → epoch ms (or null) for use as a stamp. */
export function stampFromDate(d) {
  const t = d ? Date.parse(d) : NaN;
  return Number.isFinite(t) ? t : null;
}
