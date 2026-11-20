// Pure helpers (no DOM) for published YouTube cards; see public-youtube-card.js.

/** Playlist label, matching the «محتواي» card ("N فيديو", or "أول N من أصل M" when partial). */
export function publishedCountLabel(item) {
  const n = Number(item?.itemCount) || 0;
  if (item?.partial && item?.totalCount > n) return `أول ${n} من أصل ${item.totalCount} فيديو`;
  return `${n} فيديو`;
}

/** Shapes a catalog row like a saved «محتواي» entry so the existing windows can show it. */
export function toVideoEntry(item) {
  return {
    meta: {
      type: "youtube_video",
      title: item.title,
      youtubeId: item.youtubeId,
      channelTitle: item.channelTitle,
      description: item.description,
      publishedAt: item.publishedAt,
    },
    video: { videoId: item.youtubeId, durationSeconds: item.durationSeconds },
  };
}

export function toPlaylistEntry(item, items) {
  return {
    meta: { type: "youtube_playlist", title: item.title, playlistId: item.playlistId, channelTitle: item.channelTitle },
    playlist: { id: item.playlistId, title: item.title, channelTitle: item.channelTitle, itemCount: item.itemCount, partial: item.partial, items },
  };
}

