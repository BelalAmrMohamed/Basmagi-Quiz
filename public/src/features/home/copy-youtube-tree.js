// =============================================================================
// public/src/features/home/copy-youtube-tree.js
// PURE helpers (no DOM / network / storage) for copying the published YouTube
// items of a folder or course into «محتواي». Used by copyCategoryTreeToUserContent
// (copy-to-my-content.js), which owns the single batched `youtube_public` query
// for playlist `items`.
// =============================================================================

import { buildLocalYoutubeVideoEntry, findSameLevelVideoDuplicate } from "./local-youtube-video.js";
import { buildLocalYoutubePlaylistEntry, findSameLevelPlaylistDuplicate } from "./local-youtube-playlist.js";

/** True when a manifest YouTube item is a playlist. */
export function isPlaylistItem(item) {
  return item?.kind === "playlist" || item?.itemType === "youtube_playlist";
}

/**
 * Builds the local entries for the YouTube items of ONE copied folder.
 * Duplicates are decided by YouTube id at the same level (never by title) and
 * count as `skipped`; anything that cannot be built counts as `failed`.
 *
 * @param {object} args
 * @param {object[]} args.items - manifest items (`categoryTree[key].youtube`)
 * @param {string|null} args.parentId - the NEW local folder/course id
 * @param {object[]} args.existing - current local rows (already includes rows copied earlier in this run)
 * @param {Map<string, object[]>} [args.playlistItemsById] - `youtube_public.items` by row id
 * @returns {{ entries: object[], videos: number, playlists: number, skipped: number, failed: number }}
 */
export function planYoutubeCopy({ items, parentId, existing, playlistItemsById = new Map() }) {
  const out = { entries: [], videos: 0, playlists: 0, skipped: 0, failed: 0 };
  const pool = [...(existing || [])];
  for (const item of items || []) {
    try {
      let entry;
      if (isPlaylistItem(item)) {
        if (findSameLevelPlaylistDuplicate(pool, item.playlistId, parentId)) {
          out.skipped += 1;
          continue;
        }
        entry = buildLocalYoutubePlaylistEntry({
          playlist: {
            id: item.playlistId,
            title: item.title,
            channelTitle: item.channelTitle,
            channelThumbnailUrl: item.channelThumbnailUrl,
            itemCount: item.totalCount || item.itemCount,
          },
          items: playlistItemsById.get(item.id) || [],
          parentId,
        });
        out.playlists += 1;
      } else {
        if (findSameLevelVideoDuplicate(pool, item.youtubeId, parentId)) {
          out.skipped += 1;
          continue;
        }
        entry = buildLocalYoutubeVideoEntry({
          videoId: item.youtubeId,
          parentId,
          meta: {
            title: item.title,
            description: item.description,
            channelTitle: item.channelTitle,
            channelThumbnailUrl: item.channelThumbnailUrl,
            publishedAt: item.publishedAt,
            thumbnailUrl: item.thumbnailUrl,
            durationSeconds: item.durationSeconds,
          },
        });
        out.videos += 1;
      }
      pool.push(entry);
      out.entries.push(entry);
    } catch (error) {
      console.warn("[copy-youtube-tree] item skipped:", item?.id, error?.message);
      out.failed += 1;
    }
  }
  return out;
}

/** Row ids of every playlist in a list of manifest items, for the one batched query. */
export function playlistRowIds(items) {
  return [...new Set((items || []).filter(isPlaylistItem).map((i) => i.id).filter(Boolean))];
}

/** "2 اختبار · 1 فيديو · 1 قائمة تشغيل" — zero counts are omitted. */
export function describeCopyCounts({ quizzes = 0, lessons = 0, notebooks = 0, videos = 0, playlists = 0 }) {
  const parts = [];
  if (quizzes) parts.push(`${quizzes} اختبار`);
  if (lessons) parts.push(`${lessons} درس`);
  if (notebooks) parts.push(`${notebooks} دفتر`);
  if (videos) parts.push(`${videos} فيديو`);
  if (playlists) parts.push(`${playlists} قائمة تشغيل`);
  return parts.join(" · ");
}
