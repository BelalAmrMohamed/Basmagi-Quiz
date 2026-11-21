// PURE (no DOM): link + embed-snippet builders for YouTube cards.
import { canonicalPlaylistUrl, canonicalWatchUrl, isValidPlaylistId, isValidVideoId } from "../../shared/youtube-rules.js";

const escapeAttr = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Normalizes a published manifest item or a local «محتواي» row to { playlist, id, title }. */
export function describeYoutubeItem(item) {
  const type = item?.meta?.type;
  const playlist = type === "youtube_playlist" || item?.itemType === "youtube_playlist" || item?.kind === "playlist";
  const src = item?.meta || item || {};
  return {
    playlist,
    id: playlist ? src.playlistId : src.youtubeId,
    title: String(src.title || "").trim(),
  };
}

/** The YouTube link for a video / playlist ("" when the id is invalid). */
export function youtubeLinkFor({ playlist, id }) {
  if (playlist) return isValidPlaylistId(id) ? canonicalPlaylistUrl(id) : "";
  return isValidVideoId(id) ? canonicalWatchUrl(id) : "";
}

/** Privacy-enhanced iframe snippet. Title is attribute-escaped. "" for an invalid id. */
export function buildYoutubeEmbedCode({ playlist, id, title }) {
  if (playlist ? !isValidPlaylistId(id) : !isValidVideoId(id)) return "";
  const src = playlist
    ? `https://www.youtube-nocookie.com/embed/videoseries?list=${encodeURIComponent(id)}`
    : `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}`;
  const label = escapeAttr(title || (playlist ? "قائمة تشغيل يوتيوب" : "فيديو يوتيوب"));
  return `<iframe width="560" height="315" src="${src}" title="${label}" frameborder="0" allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen loading="lazy"></iframe>`;
}
