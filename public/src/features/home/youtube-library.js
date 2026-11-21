// =============================================================================
// public/src/features/home/youtube-library.js
// DOM-free YouTube import logic shared by the import modal and the in-app AI
// agent: the server proxy client, reading and writing «محتواي», saving videos
// and whole playlists, and the import log. The modal keeps its UI; nothing here
// touches the page. The folder to save into is always passed in as parentId.
// =============================================================================

import { YOUTUBE_LIMITS } from "../../shared/youtube-rules.js";
import { getFromStorage, setInStorage } from "../../shared/storage-helpers.js";
import { buildLocalYoutubeVideoEntry, findSameLevelVideoDuplicate } from "./local-youtube-video.js";
import {
  buildLocalYoutubePlaylistEntry,
  findSameLevelPlaylistDuplicate,
} from "./local-youtube-playlist.js";
import {
  appendHistory,
  buildHistoryEvent,
  parseHistory,
  YOUTUBE_HISTORY_KEY,
} from "./local-youtube-history.js";

export async function ytApi(params) {
  let res;
  try {
    res = await fetch(`/api/youtube?${new URLSearchParams(params).toString()}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
  } catch {
    throw new Error("تعذّر الاتصال بالخادم. تحقق من الإنترنت ثم حاول مجدداً.");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (data?.error) throw new Error(data.error);
    throw new Error(`تعذّر الاتصال بخدمة يوتيوب (HTTP ${res.status}). تأكد من نشر دالة youtube على Supabase.`);
  }
  if (!data) throw new Error(`استجابة غير متوقعة من الخادم (HTTP ${res.status}).`);
  return data;
}

export function readUserItems() {
  try {
    return JSON.parse(getFromStorage("user_quizzes", "[]")) || [];
  } catch {
    return [];
  }
}

export function readHistory() {
  return parseHistory(getFromStorage(YOUTUBE_HISTORY_KEY, "[]"));
}

export function findLibraryItem(itemId) {
  if (!itemId) return null;
  return readUserItems().find((row) => (row.id || row.meta?.id) === itemId) || null;
}

/**
 * Best effort: the library write has already succeeded when this runs, so a full
 * or failing log must not undo or hide the import. Failures are logged only.
 */
export function recordHistory(events) {
  if (!events.length) return;
  try {
    const next = appendHistory(readHistory(), events);
    if (!setInStorage(YOUTUBE_HISTORY_KEY, JSON.stringify(next))) {
      console.error("[youtube] import log not saved (storage may be full)");
    }
  } catch (err) {
    console.error("[youtube] import log not saved", err);
  }
}

export function metaFromDetails(d) {
  return {
    title: d.title,
    description: d.description,
    channelTitle: d.channelTitle,
    channelId: d.channelId,
    channelThumbnailUrl: d.channelThumbnailUrl,
    publishedAt: d.publishedAt,
    durationSeconds: d.durationSeconds ?? null,
    thumbnailUrl: d.thumbnailUrl,
  };
}

/**
 * Saves a list of video references into محتواي at the current folder level.
 * Duplicates (same YouTube ID at this level) and non-embeddable items are skipped
 * with a reason; nothing is written unless the whole batch can be stored.
 * @returns {{saved:number, skipped:string[]}}
 */
export function saveVideoRefs(refs, parentId = null) {
  const items = readUserItems();
  const skipped = [];
  const created = [];
  let saved = 0;

  for (const ref of refs) {
    if (ref.blockedReason) {
      skipped.push(`${ref.title || ref.videoId}: ${ref.blockedReason}`);
      continue;
    }
    if (findSameLevelVideoDuplicate(items, ref.videoId, parentId)) {
      skipped.push(`${ref.title || ref.videoId}: موجود بالفعل`);
      continue;
    }
    const entry = buildLocalYoutubeVideoEntry({
      videoId: ref.videoId,
      meta: ref.meta,
      parentId,
      playlistId: ref.playlistId || null,
    });
    items.push(entry);
    created.push(entry);
    saved++;
  }

  if (saved > 0 && !setInStorage("user_quizzes", JSON.stringify(items))) {
    throw new Error("تعذّر الحفظ محلياً. قد تكون مساحة التخزين ممتلئة — احذف عناصر غير مستخدمة ثم أعد المحاولة.");
  }
  recordHistory(created.map((e) => buildHistoryEvent({
    kind: "video",
    youtubeId: e.meta.youtubeId,
    title: e.meta.title,
    itemId: e.id,
    parentId: e.meta.parentId,
  })));
  return { saved, skipped };
}

function writeUserItems(items) {
  return setInStorage("user_quizzes", JSON.stringify(items));
}

function rowFromApi(it) {
  return {
    videoId: it.videoId,
    title: it.title || "فيديو غير متاح",
    thumbnailUrl: it.thumbnailUrl,
    unavailable: Boolean(it.unavailable),
  };
}

/**
 * Loads a playlist's pages until the item cap or the last page. The AI agent uses
 * this; the modal keeps its own page-by-page loop because it shows progress and
 * lets the user pick videos.
 * @returns {Promise<{info: object|null, rows: object[]}>}
 */
export async function loadPlaylistRows(playlistId, onStatus) {
  let info = null;
  let rows = [];
  let token = null;
  do {
    onStatus?.(rows.length);
    const data = await ytApi(token
      ? { action: "playlist", id: playlistId, pageToken: token }
      : { action: "playlist", id: playlistId });
    info = info || data.playlist;
    rows = rows.concat((data.items || []).map(rowFromApi));
    token = data.nextPageToken || null;
  } while (token && rows.length < YOUTUBE_LIMITS.playlistItemsMax);
  return { info, rows: rows.slice(0, YOUTUBE_LIMITS.playlistItemsMax) };
}

/** Full details for many video IDs, batched to the API's limit. Map: videoId → details. */
export async function fetchVideoDetails(ids) {
  const map = new Map();
  for (let i = 0; i < ids.length; i += YOUTUBE_LIMITS.detailBatchMax) {
    const data = await ytApi({ action: "video", ids: ids.slice(i, i + YOUTUBE_LIMITS.detailBatchMax).join(",") });
    for (const d of data.items || []) map.set(d.videoId, d);
  }
  return map;
}

/**
 * Stores ONE playlist object (plan B2): durations for the available items, the
 * duplicate check, the write, and the import log. Throws Arabic messages.
 */
export async function saveWholePlaylist({ playlistId, info, rows, parentId = null }) {
  if (findSameLevelPlaylistDuplicate(readUserItems(), playlistId, parentId)) {
    throw new Error("قائمة التشغيل موجودة بالفعل في هذا المستوى.");
  }
  const considered = rows.slice(0, YOUTUBE_LIMITS.playlistItemsMax);
  const details = await fetchVideoDetails(considered.filter((r) => !r.unavailable).map((r) => r.videoId));
  const entry = buildLocalYoutubePlaylistEntry({
    playlist: {
      id: playlistId,
      title: info?.title,
      channelTitle: info?.channelTitle,
      itemCount: info?.itemCount || 0,
    },
    items: considered.map((r) => ({
      videoId: r.videoId,
      title: r.title,
      thumbnailUrl: r.thumbnailUrl,
      durationSeconds: details.get(r.videoId)?.durationSeconds ?? null,
      unavailable: r.unavailable,
    })),
    parentId,
  });
  const items = readUserItems();
  items.push(entry);
  if (!writeUserItems(items)) {
    throw new Error("تعذّر الحفظ محلياً. قد تكون مساحة التخزين ممتلئة — احذف عناصر غير مستخدمة ثم أعد المحاولة.");
  }
  recordHistory([buildHistoryEvent({
    kind: "playlist",
    playlistId,
    title: entry.meta.title,
    itemId: entry.id,
    parentId,
  })]);
  return entry;
}
