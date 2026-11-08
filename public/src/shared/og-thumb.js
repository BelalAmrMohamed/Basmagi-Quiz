// =============================================================================
// public/src/shared/og-thumb.js
// Client-side builder for the server-rendered thumbnails at /api/og.
// =============================================================================
// The browser cannot import from api/, so the layout versions are mirrored
// here. tests/og-thumb.test.js fails if this table drifts from
// api/_og/version.js (the single source of truth) — bump both together.
// The `v=` value follows api/_og/version.js ogVersion(): "<layout>-<stamp>".
// =============================================================================

export const OG_LAYOUT_VERSION = {
  quiz: 4,
  course: 6,
  lesson: 1,
  notebook: 1,
};

function stampFromDate(value) {
  const t = value ? Date.parse(value) : NaN;
  return Number.isFinite(t) ? t : null;
}

/**
 * @param {"quiz"|"lesson"|"notebook"|"course"|"folder"} kind
 * @param {object} item
 * @param {string} item.id - quiz 8-char code, lesson/notebook id or slug,
 *   course uuid (also the course uuid for kind "folder")
 * @param {string|number|Date|null} [item.updatedAt] - content stamp for cache-busting
 * @param {string[]|string} [item.folderPath] - raw folder names (kind "folder")
 * @returns {string|null} relative URL, or null when no thumbnail can be requested
 */
export function ogThumbUrl(kind, { id, updatedAt = null, folderPath = null } = {}) {
  const safeId = String(id ?? "").trim();
  if (!safeId) return null;
  const layoutKind = kind === "folder" ? "course" : kind;
  const layout = OG_LAYOUT_VERSION[layoutKind];
  if (layout === undefined) return null;

  let query;
  if (kind === "quiz") query = `quizId=${encodeURIComponent(safeId)}`;
  else if (kind === "lesson") query = `lesson=${encodeURIComponent(safeId)}`;
  else if (kind === "notebook") query = `notebook=${encodeURIComponent(safeId)}`;
  else if (kind === "course") query = `course=${encodeURIComponent(safeId)}`;
  else if (kind === "folder") {
    const parts = Array.isArray(folderPath) ? folderPath : String(folderPath || "").split("/");
    const path = parts.map((p) => String(p).trim()).filter(Boolean).join("/");
    if (!path) return null;
    query = `course=${encodeURIComponent(safeId)}&folder=${encodeURIComponent(path)}`;
  } else {
    return null;
  }

  const stamp = updatedAt instanceof Date ? updatedAt.getTime() : (typeof updatedAt === "number" ? updatedAt : stampFromDate(updatedAt));
  const v = stamp ? `${layout}-${stamp}` : String(layout);
  return `/api/og?${query}&v=${v}`;
}
