// =============================================================================
// public/src/features/home/youtube-agent-tools.js
// Client handlers for the in-app AI agent's YouTube tools: search_youtube,
// list_youtube, add_youtube. They call the same DOM-free logic as the import
// modal (youtube-library.js), so the agent and the modal save identical objects.
// Each handler returns short Arabic text for the chat's tool bubble; failures
// throw an Error with `userMessage` set.
// =============================================================================

import { canonicalWatchUrl, parseYoutubeInput, validateSearchQuery } from "../../shared/youtube-rules.js";
import { currentFolderId } from "./user-content-folders.js";
import {
  loadPlaylistRows,
  metaFromDetails,
  readUserItems,
  saveVideoRefs,
  saveWholePlaylist,
  fetchVideoDetails,
  ytApi,
} from "./youtube-library.js";
import { YOUTUBE_PLAYLIST_TYPE, describePlaylistCount } from "./local-youtube-playlist.js";
import { YOUTUBE_VIDEO_TYPE } from "./local-youtube-video.js";
import { createItemCardResult } from "../../components/ai-agent/ai-agent-result-cards.js";

const SEARCH_LIMIT = 10;
const LIST_LIMIT = 50;

function userError(message, userMessage = message) {
  const err = new Error(message);
  err.userMessage = userMessage;
  return err;
}

export async function handleYoutubeToolCall(toolCall) {
  const input = toolCall?.input || {};
  try {
    switch (toolCall?.name) {
      case "search_youtube": return await searchYoutube(input);
      case "list_youtube": return listYoutube(input);
      case "add_youtube": return await addYoutube(input);
      default: throw userError(`Unknown YouTube tool: ${toolCall?.name}`, "أداة غير معروفة.");
    }
  } catch (err) {
    if (!err.userMessage) err.userMessage = err.message;
    throw err;
  }
}

async function searchYoutube({ query }) {
  const check = validateSearchQuery(query);
  if (!check.ok) throw userError(check.message);
  const data = await ytApi({ action: "search", q: check.query });
  const items = (data.items || []).slice(0, SEARCH_LIMIT);
  if (items.length === 0) return `لا توجد نتائج لـ «${check.query}».`;
  const lines = items.map((it, i) =>
    `${i + 1}. ${it.title} — ${it.channelTitle || "بدون قناة"} — ${canonicalWatchUrl(it.videoId)}`);
  return [`نتائج البحث عن «${check.query}» (${items.length}):`, ...lines].join("\n");
}

function listYoutube({ kind = "all", query = "" }) {
  const wanted = kind === "video"
    ? [YOUTUBE_VIDEO_TYPE]
    : kind === "playlist"
      ? [YOUTUBE_PLAYLIST_TYPE]
      : [YOUTUBE_VIDEO_TYPE, YOUTUBE_PLAYLIST_TYPE];
  const needle = String(query || "").trim().toLowerCase();
  const rows = readUserItems().filter((r) =>
    wanted.includes(r?.meta?.type) &&
    (!needle || String(r.meta?.title || "").toLowerCase().includes(needle)));
  if (rows.length === 0) {
    return `لا توجد فيديوهات أو قوائم يوتيوب${needle ? ` تطابق «${query}»` : ""} في «محتواي».`;
  }
  const lines = rows.slice(0, LIST_LIMIT).map((r) => {
    const isPlaylist = r.meta.type === YOUTUBE_PLAYLIST_TYPE;
    const detail = isPlaylist ? describePlaylistCount(r) : (r.meta.channelTitle || "");
    return `- ${r.meta.title || "بدون عنوان"} (${isPlaylist ? "قائمة تشغيل" : "فيديو"}${detail ? ` · ${detail}` : ""})`;
  });
  if (rows.length > LIST_LIMIT) lines.push(`… و${rows.length - LIST_LIMIT} أخرى`);
  return [`محتوى يوتيوب في «محتواي» (${rows.length}):`, ...lines].join("\n");
}

async function addYoutube({ url }) {
  const parsed = parseYoutubeInput(url);
  if (parsed.kind === "invalid") {
    throw userError(`invalid url: ${parsed.reason}`, "الرابط غير صالح. الصق رابط فيديو أو قائمة تشغيل من يوتيوب.");
  }
  const parentId = currentFolderId || null;

  if (parsed.kind === "video") {
    const details = (await fetchVideoDetails([parsed.videoId])).get(parsed.videoId);
    if (!details) throw userError("video unavailable", "هذا الفيديو غير متاح (محذوف أو خاص أو غير موجود).");
    if (details.embeddable === false) {
      throw userError("not embeddable", "هذا الفيديو مغلق للتضمين، ولا يمكن حفظه في «محتواي».");
    }
    const result = saveVideoRefs(
      [{ videoId: parsed.videoId, meta: metaFromDetails(details), title: details.title }],
      parentId,
    );
    if (result.saved === 0) {
      return `لم يُحفظ شيء: ${result.skipped.join("، ") || "الفيديو موجود بالفعل في هذا المستوى."}`;
    }
    const created = result.created?.[0];
    return createItemCardResult({
      kind: "youtube_video",
      id: created?.id,
      title: details.title,
      detail: details.channelTitle || "",
    });
  }

  const { info, rows } = await loadPlaylistRows(parsed.playlistId);
  const entry = await saveWholePlaylist({ playlistId: parsed.playlistId, info, rows, parentId });
  return createItemCardResult({
    kind: "youtube_playlist",
    id: entry.id,
    title: entry.meta.title,
    detail: describePlaylistCount(entry),
  });
}
