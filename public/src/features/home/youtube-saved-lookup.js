// =============================================================================
// public/src/features/home/youtube-saved-lookup.js
// PURE (no DOM / storage): finds a saved YouTube video/playlist row for the AI
// agent's tools (summarize_youtube, remove_youtube).
// =============================================================================

import { parseYoutubeInput } from "../../shared/youtube-rules.js";

const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Finds a saved YouTube row by exact title, video ID or playlist ID, or by a URL naming one.
 * Pure: `rows` is the user's content list. Returns the row or null.
 */
export function findSavedYoutubeItem(rows, query) {
  const wanted = (rows || []).filter((r) => r?.meta?.type === "youtube_video" || r?.meta?.type === "youtube_playlist");
  const q = norm(query);
  if (!q) return null;
  const parsed = parseYoutubeInput(String(query));
  const byTitle = wanted.find((r) => norm(r.meta.title) === q);
  if (byTitle) return byTitle;
  if (parsed.kind === "video") return wanted.find((r) => r.meta.youtubeId === parsed.videoId) || null;
  if (parsed.kind === "playlist") return wanted.find((r) => r.meta.playlistId === parsed.playlistId) || null;
  return null;
}
