// =============================================================================
// public/src/features/home/public-youtube-card.js
// Card for a PUBLISHED YouTube video / playlist (youtube_public) on a course or
// folder page. Same look as the «محتواي» cards; a click opens the same player
// windows. A playlist's video list is fetched when it is opened (the catalog
// only carries the references), so the course page stays light.
// =============================================================================

import { createItemCard } from "./item-card.js";
import { publishedCountLabel, toVideoEntry, toPlaylistEntry } from "./public-youtube-model.js";
import { openYoutubeVideoPlayer } from "./youtube-player-window.js";
import { openYoutubePlaylistWindow } from "./youtube-playlist-window.js";
import { formatDurationSeconds } from "../../shared/youtube-rules.js";
import { ensureSharedSupabaseClient } from "../../shared/supabaseClientRegistry.js";
import { openPublishedYoutubeMenu } from "./public-youtube-actions.js";
import { showNotification } from "../../components/notifications/notifications.js";

async function openPlaylist(item) {
  try {
    const supabase = await ensureSharedSupabaseClient();
    const { data, error } = await supabase.from("youtube_public").select("items").eq("id", item.id).maybeSingle();
    if (error) throw error;
    openYoutubePlaylistWindow(toPlaylistEntry(item, Array.isArray(data?.items) ? data.items : []));
  } catch (err) {
    console.error("[youtube] could not load the playlist", err);
    showNotification("تعذّر فتح قائمة التشغيل", "حاول مرة أخرى بعد قليل.", "error");
  }
}

export function createPublishedYoutubeCard(item) {
  const isPlaylist = item.kind === "playlist";
  return createItemCard({
    kind: isPlaylist ? "playlist" : "video",
    compact: true,
    title: item.title || (isPlaylist ? "قائمة بدون عنوان" : "فيديو بدون عنوان"),
    thumbnailUrl: item.thumbnailUrl,
    youtube: {
      badge: isPlaylist ? publishedCountLabel(item) : formatDurationSeconds(item.durationSeconds),
      channel: item.channelTitle,
      channelThumbnailUrl: item.channelThumbnailUrl,
    },
    onMore: (btn) => openPublishedYoutubeMenu(item, btn),
    onOpen: () => (isPlaylist ? openPlaylist(item) : openYoutubeVideoPlayer(toVideoEntry(item))),
  });
}
