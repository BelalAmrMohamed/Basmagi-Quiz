// =============================================================================
// public/src/features/home/local-youtube-video.js
// PURE helpers (no DOM / network) for personal YouTube video entries in
// «محتواي». Entries live in the shared `user_quizzes` collection with
// meta.type "youtube_video", like local-notebook.js does for notebooks.
// =============================================================================

import {
  canonicalWatchUrl,
  canonicalPlaylistUrl,
  normalizeVideoMeta,
  isValidVideoId,
  isValidPlaylistId,
} from "../../shared/youtube-rules.js";

export const YOUTUBE_VIDEO_TYPE = "youtube_video";

/**
 * Builds the «محتواي» storage row for one video reference.
 * @param {object} args
 * @param {string} args.videoId - validated YouTube ID
 * @param {object} args.meta - metadata (title required; see normalizeVideoMeta)
 * @param {string|null} [args.parentId] - folder/course the entry is placed in
 * @param {string|null} [args.playlistId] - provenance when imported from a playlist
 */
export function buildLocalYoutubeVideoEntry({
  videoId,
  meta,
  parentId = null,
  playlistId = null,
  id = `user_youtube_${crypto.randomUUID()}`,
  now = new Date(),
}) {
  if (!isValidVideoId(videoId)) throw new Error("معرّف فيديو يوتيوب غير صالح.");
  if (playlistId && !isValidPlaylistId(playlistId)) throw new Error("معرّف قائمة التشغيل غير صالح.");
  const clean = normalizeVideoMeta(meta);
  return {
    id,
    meta: {
      type: YOUTUBE_VIDEO_TYPE,
      title: clean.title,
      parentId: parentId || null,
      createdAt: now.toLocaleString("en-US"),
      updatedAt: now.toISOString(),
      description: clean.description,
      source: canonicalWatchUrl(videoId),
      youtubeId: videoId,
      channelTitle: clean.channelTitle,
      channelId: clean.channelId,
      channelThumbnailUrl: clean.channelThumbnailUrl,
      publishedAt: clean.publishedAt,
      thumbnailUrl: clean.thumbnailUrl,
      playlistId: playlistId || null,
      playlistSource: playlistId ? canonicalPlaylistUrl(playlistId) : null,
      passwordProtected: false,
    },
    stats: { durationSeconds: clean.durationSeconds },
    video: { provider: "youtube", videoId, durationSeconds: clean.durationSeconds },
    passwordHash: null,
    questions: [],
  };
}

/** Same-level duplicate by YouTube ID (not title): the rule the import flow uses. */
export function findSameLevelVideoDuplicate(items, videoId, parentId = null) {
  return (items || []).find(
    (row) =>
      row?.meta?.type === YOUTUBE_VIDEO_TYPE &&
      row.meta.youtubeId === videoId &&
      (row.meta.parentId || null) === (parentId || null),
  ) || null;
}
