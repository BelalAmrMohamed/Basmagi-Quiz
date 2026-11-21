// =============================================================================
// public/src/features/home/local-youtube-playlist.js
// PURE helpers (no DOM / network / storage) for personal YouTube playlist
// objects in «محتواي». One playlist is one row in `user_quizzes` with
// meta.type "youtube_playlist": a snapshot of its ordered videos taken at import
// time (IDs, titles, durations, thumbnails). Refreshing from YouTube is later.
// =============================================================================

import {
  YOUTUBE_LIMITS,
  canonicalPlaylistUrl,
  isAllowedThumbnailUrl,
  isValidPlaylistId,
  isValidVideoId,
} from "../../shared/youtube-rules.js";

export const YOUTUBE_PLAYLIST_TYPE = "youtube_playlist";
export const PLAYLIST_ITEMS_MAX = YOUTUBE_LIMITS.playlistItemsMax;

function cleanItem(raw) {
  if (!raw || raw.unavailable || !isValidVideoId(raw.videoId)) return null;
  const title = String(raw.title || "").trim().slice(0, YOUTUBE_LIMITS.titleMax) || "فيديو بدون عنوان";
  const durationSeconds = Number.isInteger(raw.durationSeconds) && raw.durationSeconds >= 0
    ? raw.durationSeconds
    : null;
  const thumbnailUrl = isAllowedThumbnailUrl(raw.thumbnailUrl) ? raw.thumbnailUrl : "";
  return { videoId: raw.videoId, title, durationSeconds, thumbnailUrl };
}

/**
 * Builds the «محتواي» row for one playlist. `items` is the playlist's ordered
 * list as loaded; unavailable entries are dropped. At most PLAYLIST_ITEMS_MAX
 * entries are considered. When YouTube reports more, the object is `partial`
 * and keeps the total count.
 */
export function buildLocalYoutubePlaylistEntry({
  playlist,
  items,
  parentId = null,
  id = `user_youtube_playlist_${crypto.randomUUID()}`,
  now = new Date(),
}) {
  if (!isValidPlaylistId(playlist?.id)) throw new Error("معرّف قائمة التشغيل غير صالح.");
  const title = String(playlist.title || "").trim().slice(0, YOUTUBE_LIMITS.titleMax);
  if (!title) throw new Error("عنوان قائمة التشغيل مطلوب.");
  const channelTitle = String(playlist.channelTitle || "").trim().slice(0, YOUTUBE_LIMITS.channelMax);

  const rawList = Array.isArray(items) ? items : [];
  const considered = rawList.slice(0, PLAYLIST_ITEMS_MAX);
  const kept = considered.map(cleanItem).filter(Boolean);
  if (kept.length === 0) throw new Error("لا توجد فيديوهات متاحة في هذه القائمة.");

  const total = Number.isInteger(playlist.itemCount) && playlist.itemCount >= 0
    ? playlist.itemCount
    : rawList.length;
  const partial = total > considered.length;
  const iso = now.toISOString();

  return {
    id,
    meta: {
      type: YOUTUBE_PLAYLIST_TYPE,
      title,
      parentId: parentId || null,
      createdAt: now.toLocaleString("en-US"),
      updatedAt: iso,
      description: "",
      source: canonicalPlaylistUrl(playlist.id),
      playlistId: playlist.id,
      channelTitle,
      thumbnailUrl: kept.find((k) => k.thumbnailUrl)?.thumbnailUrl || "",
      passwordProtected: false,
    },
    stats: { itemCount: kept.length },
    playlist: {
      id: playlist.id,
      title,
      channelTitle,
      itemCount: total,
      partial,
      unavailableCount: considered.length - kept.length,
      importedAt: iso,
      items: kept,
    },
    passwordHash: null,
    questions: [],
  };
}

/** Same playlist ID at the same folder level: the duplicate rule for playlists. */
export function findSameLevelPlaylistDuplicate(items, playlistId, parentId = null) {
  return (items || []).find(
    (row) =>
      row?.meta?.type === YOUTUBE_PLAYLIST_TYPE &&
      row.meta.playlistId === playlistId &&
      (row.meta.parentId || null) === (parentId || null),
  ) || null;
}

/** Count line for cards and the window: "3 فيديو", or "أول 200 من أصل 350 فيديو" when partial. */
export function describePlaylistCount(entry) {
  const n = entry?.playlist?.items?.length ?? entry?.stats?.itemCount ?? 0;
  if (entry?.playlist?.partial) return `أول ${n} من أصل ${entry.playlist.itemCount} فيديو`;
  return `${n} فيديو`;
}
