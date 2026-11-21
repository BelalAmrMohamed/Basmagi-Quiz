// =============================================================================
// public/src/shared/youtube-rules.js
// Canonical YouTube video/playlist rules shared by the browser (import modal,
// personal library) and the server (api/youtube.js). Pure: no DOM, no fetch,
// no storage. A byte-identical copy lives in scripts/lib/youtube-rules.js
// (api/ imports it) — tests/youtube-rules.test.js fails if they drift; run
// `npm run sync:mcp` after editing this file.
//
// Videos are references only: Basmagi stores IDs and metadata and plays through
// YouTube's embed player. Never accept arbitrary iframe/embed HTML.
// =============================================================================

export const YOUTUBE_LIMITS = Object.freeze({
  titleMax: 200,
  descriptionMax: 5000,
  channelMax: 200,
  searchQueryMax: 100,
  searchPageSize: 10,
  playlistPageSize: 50,
  playlistItemsMax: 200,   // max items imported from one playlist in one action
  detailBatchMax: 50,      // videos.list accepts up to 50 IDs per call
});

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const PLAYLIST_ID_RE = /^[A-Za-z0-9_-]{10,64}$/;
const CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{22}$/;
const PAGE_TOKEN_RE = /^[A-Za-z0-9_-]{1,64}$/;

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
  "youtu.be",
  "www.youtu.be",
]);

export function isValidVideoId(id) {
  return typeof id === "string" && VIDEO_ID_RE.test(id);
}

export function isValidPlaylistId(id) {
  return typeof id === "string" && PLAYLIST_ID_RE.test(id);
}

export function isValidPageToken(token) {
  return typeof token === "string" && PAGE_TOKEN_RE.test(token);
}

/**
 * Parses what the user pasted: a bare 11-character video ID, a watch URL,
 * youtu.be, Shorts/embed/live URLs, or a playlist URL.
 *
 * @returns {{kind:"video", videoId:string, playlistId?:string}
 *   | {kind:"playlist", playlistId:string}
 *   | {kind:"invalid", reason:string}}
 */
export function parseYoutubeInput(input) {
  const raw = String(input ?? "").trim();
  if (!raw) return { kind: "invalid", reason: "empty" };
  if (isValidVideoId(raw)) return { kind: "video", videoId: raw };

  let url;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { kind: "invalid", reason: "malformed" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { kind: "invalid", reason: "protocol" };
  }
  const host = url.hostname.toLowerCase();
  if (!YOUTUBE_HOSTS.has(host)) return { kind: "invalid", reason: "host" };

  const segments = url.pathname.split("/").filter(Boolean);
  const listParam = url.searchParams.get("list") || "";
  const playlistFromList = isValidPlaylistId(listParam) ? listParam : null;

  let videoId = null;
  if (host === "youtu.be" || host === "www.youtu.be") {
    videoId = segments[0] || null;
  } else if (segments[0] === "watch") {
    videoId = url.searchParams.get("v");
  } else if (["shorts", "embed", "live", "v"].includes(segments[0])) {
    videoId = segments[1] || null;
  } else if (segments[0] === "playlist") {
    if (playlistFromList) return { kind: "playlist", playlistId: playlistFromList };
    return { kind: "invalid", reason: "playlist-id" };
  }

  if (videoId !== null) {
    if (!isValidVideoId(videoId)) return { kind: "invalid", reason: "video-id" };
    return playlistFromList
      ? { kind: "video", videoId, playlistId: playlistFromList }
      : { kind: "video", videoId };
  }

  if (playlistFromList) return { kind: "playlist", playlistId: playlistFromList };
  return { kind: "invalid", reason: "unsupported-path" };
}

export function canonicalWatchUrl(videoId) {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

export function canonicalPlaylistUrl(playlistId) {
  return `https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}`;
}

/** Privacy-enhanced embed (no cookies until playback). Never user-supplied. */
export function embedUrl(videoId) {
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}`;
}

/** Thumbnail hosts we accept from API responses or stored records. */
export function isAllowedThumbnailUrl(url) {
  if (typeof url !== "string" || !url) return false;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && (
      u.hostname === "i.ytimg.com" || u.hostname.endsWith(".ytimg.com") ||
      // channel avatars (channels.list snippet.thumbnails)
      u.hostname === "yt3.ggpht.com" || u.hostname === "yt3.googleusercontent.com"
    );
  } catch {
    return false;
  }
}

/** ISO 8601 duration (YouTube contentDetails.duration) → whole seconds, or null. */
export function parseIsoDuration(iso) {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(iso || ""));
  if (!m || m[0] === "P" || m[0] === "PT") return null;
  const [, d = 0, h = 0, min = 0, s = 0] = m;
  return Number(d) * 86400 + Number(h) * 3600 + Number(min) * 60 + Number(s);
}

/** Seconds → "m:ss" or "h:mm:ss"; empty string when unknown. */
export function formatDurationSeconds(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function optionalText(value, max, label) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string") throw new Error(`${label} يجب أن يكون نصاً.`);
  const clean = value.trim();
  if (clean.length > max) throw new Error(`${label} طويل جداً (الحد الأقصى ${max} حرف).`);
  return clean;
}

/**
 * Validates and normalizes the stored metadata subset of a video. Absent
 * optional fields become "" / null so records stay schema-stable.
 * Throws Error(<Arabic message>) on the first problem, like the other validators.
 */
export function normalizeVideoMeta(raw = {}) {
  const title = optionalText(raw.title, YOUTUBE_LIMITS.titleMax, "عنوان الفيديو");
  if (!title) throw new Error("عنوان الفيديو مطلوب.");

  const description = optionalText(raw.description, YOUTUBE_LIMITS.descriptionMax, "وصف الفيديو");
  const channelTitle = optionalText(raw.channelTitle, YOUTUBE_LIMITS.channelMax, "اسم القناة");
  const channelId = typeof raw.channelId === "string" && CHANNEL_ID_RE.test(raw.channelId) ? raw.channelId : "";

  let publishedAt = "";
  if (raw.publishedAt) {
    const d = new Date(raw.publishedAt);
    if (Number.isNaN(d.getTime())) throw new Error("تاريخ نشر الفيديو غير صالح.");
    publishedAt = d.toISOString();
  }

  let durationSeconds = null;
  if (raw.durationSeconds !== undefined && raw.durationSeconds !== null) {
    if (!Number.isInteger(raw.durationSeconds) || raw.durationSeconds < 0) {
      throw new Error("مدة الفيديو غير صالحة.");
    }
    durationSeconds = raw.durationSeconds;
  }

  const thumbnailUrl = isAllowedThumbnailUrl(raw.thumbnailUrl) ? raw.thumbnailUrl : "";
  const channelThumbnailUrl = isAllowedThumbnailUrl(raw.channelThumbnailUrl) ? raw.channelThumbnailUrl : "";

  return { title, description, channelTitle, channelId, publishedAt, durationSeconds, thumbnailUrl, channelThumbnailUrl };
}

/**
 * Validates one video reference for a server write or MCP import. Returns the
 * canonical reference: ID, watch URL, and normalized metadata.
 */
export function normalizeVideoRef(videoId, meta = {}) {
  if (!isValidVideoId(videoId)) throw new Error("معرّف فيديو يوتيوب غير صالح.");
  return { youtubeId: videoId, url: canonicalWatchUrl(videoId), ...normalizeVideoMeta(meta) };
}

const CONTROL_CHARS_RE = /\p{Cc}/u;

/**
 * Search text rule (plan §2.1): any text except control characters, 1 to
 * searchQueryMax characters after trimming (counted by code point). Returns the
 * rule that failed so the UI can say why.
 * @returns {{ok:true, query:string} | {ok:false, code:"empty"|"too-long"|"control-chars", message:string}}
 */
export function validateSearchQuery(input) {
  const query = String(input ?? "").trim();
  if (!query) return { ok: false, code: "empty", message: "اكتب كلمة أو أكثر للبحث." };
  if ([...query].length > YOUTUBE_LIMITS.searchQueryMax) {
    return {
      ok: false,
      code: "too-long",
      message: `نص البحث طويل (الحد الأقصى ${YOUTUBE_LIMITS.searchQueryMax} حرف).`,
    };
  }
  if (CONTROL_CHARS_RE.test(query)) {
    return {
      ok: false,
      code: "control-chars",
      message: "نص البحث يحتوي على محارف تحكم غير مسموحة (مثل الأسطر الجديدة).",
    };
  }
  return { ok: true, query };
}
