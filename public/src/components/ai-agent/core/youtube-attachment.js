// =============================================================================
// public/src/components/ai-agent/core/youtube-attachment.js
// PURE (no DOM / network / storage): builds the AI-agent attachment for a
// YouTube video or playlist — from a published manifest item OR from a local
// «محتواي» row. One builder, so the platform cards, «محتواي» cards and the
// `/` `@` menu all attach the same shape: { kind: "youtube", itemType, … }.
// =============================================================================

import { canonicalPlaylistUrl, canonicalWatchUrl } from "../../../shared/youtube-rules.js";

export const YOUTUBE_ATTACHMENT_KIND = "youtube";
const DESCRIPTION_MAX = 2000;
const SUMMARY_DESCRIPTION_MAX = 400;
const PLAYLIST_TITLES_MAX = 60;

/** True for the real kind and for older persisted chats that stored kind "lesson" + itemType youtube_*. */
export function isYoutubeAttachment(att) {
  return att?.kind === YOUTUBE_ATTACHMENT_KIND || String(att?.itemType || "").startsWith("youtube_");
}

/** 3725 → "1:02:05", 125 → "2:05"; null for anything that is not a non-negative integer. */
export function formatDuration(seconds) {
  if (!Number.isInteger(seconds) || seconds < 0) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return `${h ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

function safeUrl(isPlaylist, id) {
  try {
    return id ? (isPlaylist ? canonicalPlaylistUrl(id) : canonicalWatchUrl(id)) : "";
  } catch {
    return "";
  }
}

/** Normalizes a published manifest item or a local user_quizzes row. */
function normalize(source) {
  if (source?.meta?.type === "youtube_video" || source?.meta?.type === "youtube_playlist") {
    const m = source.meta;
    const isPlaylist = m.type === "youtube_playlist";
    return {
      isPlaylist,
      id: m.id || source.id,
      title: m.title,
      description: m.description,
      channel: m.channelTitle,
      publishedAt: m.publishedAt,
      youtubeId: isPlaylist ? null : m.youtubeId,
      playlistId: isPlaylist ? m.playlistId : null,
      durationSeconds: isPlaylist ? null : source.stats?.durationSeconds ?? source.video?.durationSeconds ?? null,
      videoCount: isPlaylist ? source.playlist?.itemCount ?? source.stats?.itemCount ?? 0 : 0,
      videoTitles: isPlaylist ? (source.playlist?.items || []).map((i) => i?.title).filter(Boolean) : [],
    };
  }
  const isPlaylist = source?.itemType === "youtube_playlist" || source?.kind === "playlist";
  return {
    isPlaylist,
    id: source?.id,
    title: source?.title,
    description: source?.description,
    channel: source?.channelTitle,
    publishedAt: source?.publishedAt,
    youtubeId: isPlaylist ? null : source?.youtubeId,
    playlistId: isPlaylist ? source?.playlistId : null,
    durationSeconds: isPlaylist ? null : source?.durationSeconds ?? null,
    videoCount: isPlaylist ? source?.totalCount || source?.itemCount || 0 : 0,
    videoTitles: [],
  };
}

/**
 * @param {object} source - manifest item (`itemType`/`kind`, `youtubeId`, …) or a local row (`meta.type`)
 * @param {"platform"|"local"} [origin]
 */
export function buildYoutubeAttachment(source, origin = "platform") {
  const n = normalize(source);
  const title = String(n.title || "").trim() || (n.isPlaylist ? "قائمة تشغيل" : "فيديو");
  const description = String(n.description || "").slice(0, DESCRIPTION_MAX);
  const duration = formatDuration(n.durationSeconds);
  const published = n.publishedAt ? String(n.publishedAt).slice(0, 10) : "";

  const summaryParts = [];
  if (n.channel) summaryParts.push(`القناة: ${n.channel}`);
  if (duration) summaryParts.push(`المدة: ${duration}`);
  if (n.isPlaylist && n.videoCount) summaryParts.push(`عدد الفيديوهات: ${n.videoCount}`);
  if (published) summaryParts.push(`تاريخ النشر: ${published}`);
  if (description) summaryParts.push(`الوصف: ${description.slice(0, SUMMARY_DESCRIPTION_MAX)}`);

  return {
    kind: YOUTUBE_ATTACHMENT_KIND,
    itemType: n.isPlaylist ? "youtube_playlist" : "youtube_video",
    id: n.id,
    title,
    source: origin,
    summary: summaryParts.join(" — "),
    payload: {
      title,
      description,
      channel: n.channel || "",
      publishedAt: n.publishedAt || null,
      url: safeUrl(n.isPlaylist, n.isPlaylist ? n.playlistId : n.youtubeId),
      ...(n.isPlaylist
        ? {
            playlistId: n.playlistId || null,
            videoCount: n.videoCount || 0,
            ...(n.videoTitles.length ? { videoTitles: n.videoTitles.slice(0, PLAYLIST_TITLES_MAX) } : {}),
          }
        : { youtubeId: n.youtubeId || null, durationSeconds: n.durationSeconds ?? null, ...(duration ? { duration } : {}) }),
    },
  };
}
