// =============================================================================
// public/src/shared/youtube-mcp-model.js
// PURE (no network, no DOM, no storage). Turns YouTube Data API responses into
// the payloads stored by MCP import links and the published catalog, and formats
// the text MCP tools answer with. scripts/sync-mcp-rules.js copies this file and
// youtube-rules.js into supabase/functions/mcp (Deno); tests/youtube-mcp-model.test.js
// covers it.
// =============================================================================

import {
  YOUTUBE_LIMITS,
  canonicalPlaylistUrl,
  normalizeVideoRef,
  canonicalWatchUrl,
  formatDurationSeconds,
  isAllowedThumbnailUrl,
  isValidPlaylistId,
  isValidVideoId,
  normalizeVideoMeta,
  parseIsoDuration,
} from "./youtube-rules.js";

const THUMB_ORDER = ["maxres", "standard", "high", "medium", "default"];

/** Best allowed thumbnail from a snippet.thumbnails object, or "". */
export function pickThumbnail(thumbnails) {
  for (const key of THUMB_ORDER) {
    const url = thumbnails?.[key]?.url;
    if (isAllowedThumbnailUrl(url)) return url;
  }
  return "";
}

/**
 * videos.list item (part: snippet, contentDetails, status) → the import payload
 * for a personal video. Throws Error(<Arabic>) when the video cannot be saved.
 */
export function videoImportPayload(item) {
  if (!isValidVideoId(item?.id)) throw new Error("معرّف الفيديو غير صالح.");
  if (item.status?.embeddable === false) {
    throw new Error("هذا الفيديو مغلق للتضمين، ولا يمكن حفظه في «محتواي».");
  }
  const sn = item.snippet || {};
  const meta = normalizeVideoMeta({
    title: sn.title,
    description: sn.description,
    channelTitle: sn.channelTitle,
    channelId: sn.channelId,
    publishedAt: sn.publishedAt,
    durationSeconds: parseIsoDuration(item.contentDetails?.duration),
    thumbnailUrl: pickThumbnail(sn.thumbnails),
  });
  return { youtubeId: item.id, meta };
}

/**
 * A playlist payload from its metadata, its loaded entries (in order), and a Map
 * of videoId → durationSeconds. Unavailable entries are kept and flagged; the
 * browser builder drops them and applies the item cap.
 */
export function playlistImportPayload({ playlist, items, durations }) {
  if (!isValidPlaylistId(playlist?.id)) throw new Error("معرّف قائمة التشغيل غير صالح.");
  const sn = playlist.snippet || {};
  const title = String(sn.title || "").trim().slice(0, YOUTUBE_LIMITS.titleMax);
  if (!title) throw new Error("عنوان قائمة التشغيل مطلوب.");
  const considered = (items || []).slice(0, YOUTUBE_LIMITS.playlistItemsMax);
  return {
    playlist: {
      id: playlist.id,
      title,
      channelTitle: String(sn.channelTitle || "").trim().slice(0, YOUTUBE_LIMITS.channelMax),
      itemCount: Number(playlist.contentDetails?.itemCount) || 0,
    },
    items: considered.map((it) => ({
      videoId: it.unavailable ? null : it.videoId,
      title: it.title || "",
      thumbnailUrl: it.thumbnailUrl || "",
      durationSeconds: durations?.get(it.videoId) ?? null,
      unavailable: Boolean(it.unavailable),
    })),
  };
}

function linkOf(row) {
  return row.kind === "playlist" ? canonicalPlaylistUrl(row.playlist_id) : canonicalWatchUrl(row.youtube_id);
}

function countLabel(row) {
  if (row.kind !== "playlist") return row.channel_title || "";
  const total = row.total_count ?? row.item_count;
  return row.partial ? `أول ${row.item_count} من أصل ${total} فيديو` : `${row.item_count} فيديو`;
}

/** One line per published row, for search and list answers. */
export function formatPublishedList(rows, heading) {
  if (!rows.length) return `${heading}: لا توجد نتائج منشورة.`;
  const lines = rows.map((r) => {
    const detail = countLabel(r);
    return `- ${r.title} (${r.kind === "playlist" ? "قائمة تشغيل" : "فيديو"}${detail ? ` · ${detail}` : ""}) — ${linkOf(r)}`;
  });
  return [`${heading} (${rows.length}):`, ...lines].join("\n");
}

/** Full answer for one published row; playlists include their ordered list. */
export function formatPublishedDetail(row) {
  const head = [`# ${row.title}`, row.kind === "playlist" ? "قائمة تشغيل" : "فيديو"];
  if (row.channel_title) head.push(`القناة: ${row.channel_title}`);
  if (row.kind === "playlist") head.push(`عدد الفيديوهات: ${countLabel(row)}`);
  else if (row.duration_seconds != null) head.push(`المدة: ${formatDurationSeconds(row.duration_seconds)}`);
  head.push(`الرابط: ${linkOf(row)}`);
  const parts = [head.join("\n")];
  if (row.description) parts.push(row.description);
  if (row.kind === "playlist" && Array.isArray(row.items) && row.items.length) {
    parts.push(row.items
      .map((it, i) => `${i + 1}. ${it.title}${it.durationSeconds != null ? ` (${formatDurationSeconds(it.durationSeconds)})` : ""}`)
      .join("\n"));
  }
  return parts.join("\n\n");
}


/**
 * Validates an admin's published-video body → the row fields of youtube_public.
 * Throws Error(<Arabic>) on the first problem. Metadata comes from the admin's
 * browser (fetched through /api/youtube), so every field is re-checked here.
 */
export function publishedVideoFields({ youtubeId, meta }) {
  const ref = normalizeVideoRef(youtubeId, meta);
  return {
    kind: "video",
    youtube_id: ref.youtubeId,
    playlist_id: null,
    title: ref.title,
    channel_title: ref.channelTitle,
    channel_id: ref.channelId || null,
    description: ref.description,
    thumbnail_url: ref.thumbnailUrl,
    published_at: ref.publishedAt || null,
    duration_seconds: ref.durationSeconds,
    item_count: 0,
    total_count: 0,
    partial: false,
    items: [],
  };
}

/**
 * Validates an admin's published-playlist body → the row fields of youtube_public.
 * `items` is the ordered list as loaded (at most 200). Unavailable entries are
 * dropped; `partial` is set when YouTube reports more videos than were sent.
 */
export function publishedPlaylistFields({ playlistId, playlist, items, partial = false }) {
  if (!isValidPlaylistId(playlistId) || playlist?.id !== playlistId) {
    throw new Error("معرّف قائمة التشغيل غير صالح.");
  }
  const title = String(playlist.title || "").trim().slice(0, YOUTUBE_LIMITS.titleMax);
  if (!title) throw new Error("عنوان قائمة التشغيل مطلوب.");
  if (!Array.isArray(items) || items.length > YOUTUBE_LIMITS.playlistItemsMax) {
    throw new Error(`عدد فيديوهات القائمة يجب ألا يتجاوز ${YOUTUBE_LIMITS.playlistItemsMax}.`);
  }
  const kept = items
    .filter((it) => isValidVideoId(it?.videoId))
    .map((it) => ({
      videoId: it.videoId,
      title: String(it.title || "").trim().slice(0, YOUTUBE_LIMITS.titleMax) || "فيديو بدون عنوان",
      durationSeconds: Number.isInteger(it.durationSeconds) && it.durationSeconds >= 0 ? it.durationSeconds : null,
      thumbnailUrl: isAllowedThumbnailUrl(it.thumbnailUrl) ? it.thumbnailUrl : "",
    }));
  if (kept.length === 0) throw new Error("لا توجد فيديوهات متاحة في هذه القائمة.");
  const total = Number.isInteger(playlist.itemCount) && playlist.itemCount >= 0 ? playlist.itemCount : items.length;
  return {
    kind: "playlist",
    youtube_id: null,
    playlist_id: playlistId,
    title,
    channel_title: String(playlist.channelTitle || "").trim().slice(0, YOUTUBE_LIMITS.channelMax),
    channel_id: null,
    description: "",
    thumbnail_url: kept.find((k) => k.thumbnailUrl)?.thumbnailUrl || "",
    published_at: null,
    duration_seconds: null,
    item_count: kept.length,
    total_count: total,
    partial: Boolean(partial) || total > items.length,
    items: kept,
  };
}
