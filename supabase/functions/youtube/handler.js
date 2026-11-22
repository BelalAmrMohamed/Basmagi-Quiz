// =============================================================================
// supabase/functions/youtube/handler.js
// Server-only YouTube Data API proxy for personal video import (and later the
// admin publishing flow). The browser never sees YOUTUBE_DATA_API_KEY.
//
// Deployed as a Supabase Edge Function (NOT a Vercel function, so it adds
// nothing to the api/ function count). scripts/build-edge-functions.mjs bundles
// this handler into supabase/functions/youtube/index.ts; the browser calls
// /api/youtube, which vercel.json rewrites to that function.
//
// GET /api/youtube?action=search&q=…&pageToken=…
// GET /api/youtube?action=video&ids=ID1,ID2,…            (≤ 50 IDs)
// GET /api/youtube?action=playlist&id=PLAYLIST&pageToken=…
// GET /api/youtube?action=transcript&id=VIDEO&lang=ar   (best effort; { available:false, reason } when none)
//
// Responses are normalized (see scripts/lib/youtube-rules.js). Google errors are
// mapped to stable codes so the UI never shows raw API messages or the key.
// Playlist results are returned page by page; the caller decides how much to
// load, and a page with nextPageToken is never presented as a complete playlist.
// =============================================================================

import { isRateLimited } from "../../../api/_rateLimit.js";
import { fetchTranscript } from "./transcript.js";
import {
  YOUTUBE_LIMITS,
  isValidVideoId,
  isValidPlaylistId,
  isValidPageToken,
  parseIsoDuration,
  isAllowedThumbnailUrl,
  validateSearchQuery,
} from "../../../scripts/lib/youtube-rules.js";

const API_BASE = "https://www.googleapis.com/youtube/v3";
const RATE_LIMIT_PER_MINUTE = 30;
const CACHE_TTL_MS = 5 * 60_000;
const CACHE_MAX_ENTRIES = 500;
const cache = new Map(); // key -> { at, value }

// Stable, user-facing errors. Never includes Google's raw message.
const ERRORS = {
  not_configured: [503, "خدمة يوتيوب غير مُفعّلة على الخادم حالياً."],
  quota: [429, "تم تجاوز حصة يوتيوب اليومية. حاول لاحقاً."],
  upstream: [502, "تعذّر الاتصال بيوتيوب. حاول مرة أخرى بعد قليل."],
  not_found: [404, "لم يتم العثور على المحتوى المطلوب على يوتيوب."],
  bad_request: [400, "طلب غير صالح."],
  rate_limited: [429, "طلبات كثيرة في وقت قصير. انتظر دقيقة ثم حاول مجدداً."],
  method: [405, "Method not allowed"],
};

function fail(res, code, extra = {}) {
  const [status, error] = ERRORS[code];
  return res.status(status).json({ error, code, ...extra });
}

function getCached(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function setCached(key, value) {
  if (cache.size >= CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value);
  cache.set(key, { at: Date.now(), value });
}

function pickThumbnail(thumbnails = {}, preferSmall = false) {
  const url = preferSmall
    ? thumbnails.default?.url || thumbnails.medium?.url || thumbnails.high?.url || ""
    : thumbnails.high?.url || thumbnails.medium?.url || thumbnails.default?.url || "";
  return isAllowedThumbnailUrl(url) ? url : "";
}

function normalizeSnippet(id, snippet = {}) {
  return {
    videoId: id,
    title: String(snippet.title || "").slice(0, YOUTUBE_LIMITS.titleMax),
    description: String(snippet.description || "").slice(0, YOUTUBE_LIMITS.descriptionMax),
    channelId: snippet.channelId || "",
    channelTitle: String(snippet.channelTitle || "").slice(0, YOUTUBE_LIMITS.channelMax),
    publishedAt: snippet.publishedAt || "",
    thumbnailUrl: pickThumbnail(snippet.thumbnails),
  };
}

/**
 * Channel avatars for a set of channel ids: ONE channels.list call (<= 50 ids, 1 quota unit),
 * cached like the other responses. Returns Map(channelId -> avatar URL). Never throws: a failure
 * only means cards fall back to the placeholder glyph.
 */
async function fetchChannelAvatars(channelIds) {
  const ids = [...new Set(channelIds.filter((id) => /^UC[A-Za-z0-9_-]{22}$/.test(id || "")))].slice(0, YOUTUBE_LIMITS.detailBatchMax);
  const out = new Map();
  const missing = [];
  for (const id of ids) {
    const hit = getCached(`channel:${id}`);
    if (hit !== null && hit !== undefined) out.set(id, hit.url || "");
    else missing.push(id);
  }
  if (missing.length) {
    try {
      const data = await callYoutube("channels", {
        part: "snippet",
        id: missing.join(","),
        fields: "items(id,snippet/thumbnails)",
      });
      for (const it of data.items || []) {
        const url = pickThumbnail(it?.snippet?.thumbnails, true);
        out.set(it.id, url);
        setCached(`channel:${it.id}`, { url });
      }
    } catch (error) {
      console.warn("[youtube] channel avatars unavailable:", error?.code || error?.message);
    }
  }
  return out;
}

/** Calls the Data API. Returns parsed JSON or throws { code } for a stable error. */
async function callYoutube(path, params) {
  // process.env first (Vercel/Node); Deno.env on Supabase edge runtimes.
  const key = process.env.YOUTUBE_DATA_API_KEY || globalThis.Deno?.env?.get?.("YOUTUBE_DATA_API_KEY");
  if (!key) throw { code: "not_configured" };

  const url = new URL(`${API_BASE}/${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  url.searchParams.set("key", key);

  let response;
  try {
    response = await fetch(url, { headers: { Accept: "application/json" } });
  } catch {
    throw { code: "upstream" };
  }

  const body = await response.json().catch(() => null);
  if (response.ok) return body || {};

  const reasons = (body?.error?.errors || []).map((e) => e.reason);
  if (reasons.some((r) => ["quotaExceeded", "dailyLimitExceeded", "rateLimitExceeded", "userRateLimitExceeded"].includes(r))) {
    throw { code: "quota" };
  }
  if (response.status === 404) throw { code: "not_found" };
  if (response.status === 400 || response.status === 403) {
    // keyInvalid / accessNotConfigured are server misconfiguration, not user error.
    if (reasons.some((r) => ["keyInvalid", "accessNotConfigured", "forbidden", "ipRefererBlocked"].includes(r))) {
      throw { code: "not_configured" };
    }
  }
  throw { code: "upstream" };
}

async function actionSearch(query, pageToken) {
  const q = String(query || "").trim();
  const check = validateSearchQuery(q);
  if (!check.ok) throw { code: "bad_request", reason: check.code, message: check.message };
  if (pageToken && !isValidPageToken(pageToken)) throw { code: "bad_request" };

  const cacheKey = `search:${q}:${pageToken || ""}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const data = await callYoutube("search", {
    part: "snippet",
    type: "video",
    q,
    maxResults: YOUTUBE_LIMITS.searchPageSize,
    safeSearch: "moderate",
    pageToken: pageToken || "",
    fields: "items(id/videoId,snippet(title,description,channelId,channelTitle,publishedAt,thumbnails)),nextPageToken",
  });

  const items = (data.items || [])
    .filter((it) => isValidVideoId(it?.id?.videoId))
    .map((it) => normalizeSnippet(it.id.videoId, it.snippet));
  const result = {
    items,
    nextPageToken: isValidPageToken(data.nextPageToken) ? data.nextPageToken : null,
  };
  setCached(cacheKey, result);
  return result;
}

async function actionVideo(idsParam) {
  const ids = String(idsParam || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0 || ids.length > YOUTUBE_LIMITS.detailBatchMax) throw { code: "bad_request" };
  if (!ids.every(isValidVideoId)) throw { code: "bad_request" };

  const uncached = [];
  const items = [];
  for (const id of ids) {
    const hit = getCached(`video:${id}`);
    if (hit) items.push(hit);
    else uncached.push(id);
  }

  if (uncached.length) {
    const data = await callYoutube("videos", {
      part: "snippet,contentDetails,status",
      id: uncached.join(","),
      fields: "items(id,snippet(title,description,channelId,channelTitle,publishedAt,thumbnails),contentDetails/duration,status(privacyStatus,embeddable))",
    });
    for (const it of data.items || []) {
      if (!isValidVideoId(it?.id)) continue;
      const normalized = {
        ...normalizeSnippet(it.id, it.snippet),
        durationSeconds: parseIsoDuration(it.contentDetails?.duration),
        embeddable: it.status?.embeddable !== false,
        privacyStatus: it.status?.privacyStatus || "unknown",
      };
      setCached(`video:${it.id}`, normalized);
      items.push(normalized);
    }
  }

  // One batched channels.list for every channel that lacks an avatar (cached videos included).
  const avatars = await fetchChannelAvatars(items.filter((v) => !v.channelThumbnailUrl).map((v) => v.channelId));
  for (const v of items) {
    if (!v.channelThumbnailUrl) v.channelThumbnailUrl = avatars.get(v.channelId) || "";
  }

  // Preserve request order; report IDs the API did not return (deleted/private/invalid).
  const byId = new Map(items.map((v) => [v.videoId, v]));
  const ordered = ids.map((id) => byId.get(id)).filter(Boolean);
  const missing = ids.filter((id) => !byId.has(id));
  return { items: ordered, missing };
}

async function actionPlaylist(playlistId, pageToken) {
  if (!isValidPlaylistId(playlistId)) throw { code: "bad_request" };
  if (pageToken && !isValidPageToken(pageToken)) throw { code: "bad_request" };

  const meta = await callYoutube("playlists", {
    part: "snippet,contentDetails",
    id: playlistId,
    fields: "items(id,snippet(title,channelId,channelTitle),contentDetails/itemCount)",
  });
  const playlist = meta.items?.[0];
  if (!playlist) throw { code: "not_found" };

  const data = await callYoutube("playlistItems", {
    part: "snippet,contentDetails",
    playlistId,
    maxResults: YOUTUBE_LIMITS.playlistPageSize,
    pageToken: pageToken || "",
    fields: "items(snippet(title,thumbnails,position),contentDetails/videoId,contentDetails/videoPublishedAt),nextPageToken",
  });

  const ownerAvatar = (await fetchChannelAvatars([playlist.snippet?.channelId])).get(playlist.snippet?.channelId) || "";
  const items = (data.items || []).map((it) => {
    const videoId = it.contentDetails?.videoId || "";
    const title = it.snippet?.title || "";
    // YouTube returns placeholder titles for private/deleted entries and no videoId.
    const unavailable = !isValidVideoId(videoId) || title === "Deleted video" || title === "Private video";
    return {
      videoId: unavailable ? null : videoId,
      title: unavailable ? "" : title.slice(0, YOUTUBE_LIMITS.titleMax),
      thumbnailUrl: unavailable ? "" : pickThumbnail(it.snippet?.thumbnails),
      publishedAt: it.contentDetails?.videoPublishedAt || "",
      unavailable,
    };
  });

  return {
    playlist: {
      id: playlistId,
      title: String(playlist.snippet?.title || "").slice(0, YOUTUBE_LIMITS.titleMax),
      channelTitle: String(playlist.snippet?.channelTitle || "").slice(0, YOUTUBE_LIMITS.channelMax),
      channelThumbnailUrl: ownerAvatar,
      itemCount: Number(playlist.contentDetails?.itemCount) || 0,
    },
    items,
    nextPageToken: isValidPageToken(data.nextPageToken) ? data.nextPageToken : null,
  };
}

const TRANSCRIPT_TTL_MS = 30 * 60_000;

async function actionTranscript(id, lang) {
  if (!isValidVideoId(id)) throw { code: "bad_request" };
  const language = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(String(lang || "")) ? String(lang) : "";
  const cacheKey = `transcript:${id}:${language}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < TRANSCRIPT_TTL_MS) return hit.value;
  const result = await fetchTranscript(id, { lang: language });
  // Only successes are kept: a block or timeout should be retried next time.
  if (result.available) setCached(cacheKey, result);
  return result;
}

export default async function handler(req, res) {
  // Same-origin via the /api/youtube rewrite, so no CORS headers are needed.
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return fail(res, "method");

  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket?.remoteAddress || "unknown";
  if (isRateLimited(`youtube:${ip}`, RATE_LIMIT_PER_MINUTE)) return fail(res, "rate_limited");

  const { action, q, ids, id, pageToken, lang } = req.query || {};
  try {
    let body;
    if (action === "search") body = await actionSearch(q, pageToken);
    else if (action === "video") body = await actionVideo(ids);
    else if (action === "playlist") body = await actionPlaylist(id, pageToken);
    else if (action === "transcript") body = await actionTranscript(id, lang);
    else return fail(res, "bad_request");

    res.setHeader("Cache-Control", "private, no-store");
    return res.status(200).json(body);
  } catch (err) {
    if (err?.code === "bad_request" && err.message) {
      return res.status(400).json({ error: err.message, code: "bad_request", reason: err.reason });
    }
    if (err && ERRORS[err.code]) return fail(res, err.code);
    console.error("[youtube] unexpected error:", err?.message || err);
    return fail(res, "upstream");
  }
}
