// =============================================================================
// public/src/features/home/local-youtube-history.js
// PURE helpers (no DOM / storage) for the YouTube import log (plan D1 = import
// log). An "added" event is recorded when a video or playlist is added to
// «محتواي». "published" is reserved for admin publishing (Phase D).
// Stored per device in localStorage, next to the «محتواي» library it describes.
// =============================================================================

import { YOUTUBE_LIMITS, isValidPlaylistId, isValidVideoId } from "../../shared/youtube-rules.js";

export const YOUTUBE_HISTORY_KEY = "user_youtube_import_log";
export const HISTORY_MAX = 500;
const EVENTS = new Set(["added", "published"]);
const KINDS = new Set(["video", "playlist"]);

/**
 * One log entry. `itemId` points at the «محتواي» row it refers to; if that row is
 * later deleted, the entry stays and the UI shows it as removed from the library.
 */
export function buildHistoryEvent({
  event = "added",
  kind,
  youtubeId = null,
  playlistId = null,
  title = "",
  itemId = null,
  parentId = null,
  at = new Date(),
  id = `yt_evt_${crypto.randomUUID()}`,
}) {
  if (!EVENTS.has(event)) throw new Error("نوع الحدث غير معروف.");
  if (!KINDS.has(kind)) throw new Error("نوع العنصر غير معروف.");
  if (kind === "video" && !isValidVideoId(youtubeId)) throw new Error("معرّف فيديو يوتيوب غير صالح.");
  if (kind === "playlist" && !isValidPlaylistId(playlistId)) throw new Error("معرّف قائمة التشغيل غير صالح.");
  const cleanTitle = String(title || "").trim().slice(0, YOUTUBE_LIMITS.titleMax) || "بدون عنوان";
  return {
    id,
    event,
    kind,
    youtubeId: kind === "video" ? youtubeId : null,
    playlistId: kind === "playlist" ? playlistId : null,
    title: cleanTitle,
    itemId: itemId || null,
    parentId: parentId || null,
    at: at.toISOString(),
  };
}

function isValidEntry(e) {
  return Boolean(e) &&
    typeof e.id === "string" &&
    EVENTS.has(e.event) &&
    KINDS.has(e.kind) &&
    !Number.isNaN(Date.parse(e.at)) &&
    (e.kind === "video" ? isValidVideoId(e.youtubeId) : isValidPlaylistId(e.playlistId));
}

/** Parses the stored log. Malformed rows are dropped instead of failing the page. */
export function parseHistory(raw) {
  let list;
  try {
    list = JSON.parse(raw || "[]");
  } catch {
    return [];
  }
  return Array.isArray(list) ? list.filter(isValidEntry) : [];
}

/** Appends events and keeps only the newest `max` entries (insertion order). */
export function appendHistory(log, events, max = HISTORY_MAX) {
  return [...log, ...events].slice(-max);
}

export function removeHistory(log, id) {
  return log.filter((e) => e.id !== id);
}

/** Newest first, for display. Does not mutate the input. */
export function sortHistoryNewestFirst(log) {
  return [...log].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}
