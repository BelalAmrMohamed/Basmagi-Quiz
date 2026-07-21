// ============================================================================
// DATE UTILITIES
// ============================================================================

/**
 * Returns true if the ISO-8601 / locale date string `dateStr` is within
 * `withinDays` days of today.  Returns false for missing or unparseable dates.
 * @param {string|undefined} dateStr
 * @param {number} [withinDays=14]
 * @returns {boolean}
 */
export function isRecentlyAdded(dateStr, withinDays = 14) {
  if (!dateStr) return false;
  // Normalise non-standard separators such as "2026-03-19 - 20:37"
  // by collapsing any " - " (space-dash-space) between date and time into a
  // single space so the string becomes parseable by the Date constructor.
  const normalised = String(dateStr).replace(/\s+-\s+/, " ");
  const d = new Date(normalised);
  if (isNaN(d)) return false;
  const diffMs = Date.now() - d.getTime();
  return diffMs >= 0 && diffMs < withinDays * 24 * 60 * 60 * 1000;
}
