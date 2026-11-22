// =============================================================================
// supabase/functions/youtube/transcript.js
// Server-only: fetches the public caption track of a YouTube video (best effort).
// The official Data API cannot download captions with an API key (that needs the
// video owner's OAuth), so this reads the same public caption track the YouTube
// player uses. It can stop working when YouTube changes its pages or blocks
// datacenter IPs: every failure is reported as { available: false, reason } and
// the caller falls back to the video's title and description.
//
// Pure helpers (extractCaptionTracks, pickTrack, parseJson3, mergeSegments) are
// unit-tested in tests/youtube-transcript.test.js; fetchTranscript takes an
// injectable `fetchImpl`.
// =============================================================================

const WATCH_URL = "https://www.youtube.com/watch";
const FETCH_TIMEOUT_MS = 8000;
const MERGE_WINDOW_SECONDS = 20;
const MAX_LINES = 4000;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/** Finds the `"captionTracks":[...]` JSON array in a watch page and parses it ([] when absent). */
export function extractCaptionTracks(html) {
  const marker = '"captionTracks":';
  const at = String(html || "").indexOf(marker);
  if (at < 0) return [];
  const start = html.indexOf("[", at);
  if (start < 0) return [];
  let depth = 0;
  let inString = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === "[") depth++;
    else if (ch === "]" && --depth === 0) {
      try {
        const arr = JSON.parse(html.slice(start, i + 1));
        return Array.isArray(arr) ? arr.filter((t) => typeof t?.baseUrl === "string") : [];
      } catch {
        return [];
      }
    }
  }
  return [];
}

/** Prefers the requested language, then Arabic, then English; a human-made track beats an auto-generated one (kind "asr"). */
export function pickTrack(tracks, preferred = []) {
  if (!tracks?.length) return null;
  const order = [...preferred, "ar", "en"].filter(Boolean).map((l) => String(l).toLowerCase());
  const base = (t) => String(t.languageCode || "").toLowerCase();
  const rank = (t) => {
    const lang = base(t);
    let langRank = order.findIndex((l) => lang === l || lang.startsWith(`${l}-`));
    if (langRank < 0) langRank = order.length;
    return langRank * 2 + (t.kind === "asr" ? 1 : 0);
  };
  return [...tracks].sort((a, b) => rank(a) - rank(b))[0];
}

/** json3 caption payload -> [{ s: startSeconds, t: text }]. */
export function parseJson3(data) {
  const out = [];
  for (const ev of data?.events || []) {
    if (!Array.isArray(ev?.segs)) continue;
    const t = ev.segs.map((g) => g?.utf8 || "").join("").replace(/\s*\n\s*/g, " ").trim();
    if (t) out.push({ s: Math.max(0, Math.floor((Number(ev.tStartMs) || 0) / 1000)), t });
  }
  return out;
}

/** Merges tiny caption cues into ~20s lines so the payload stays small. */
export function mergeSegments(segs, windowSeconds = MERGE_WINDOW_SECONDS) {
  const lines = [];
  for (const seg of segs) {
    const last = lines[lines.length - 1];
    if (last && seg.s - last.s < windowSeconds) last.t += ` ${seg.t}`;
    else lines.push({ s: seg.s, t: seg.t });
  }
  return lines.slice(0, MAX_LINES);
}

function isYoutubeHost(url) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && (u.hostname === "youtube.com" || u.hostname.endsWith(".youtube.com"));
  } catch {
    return false;
  }
}

/**
 * @returns {Promise<{available:true, language:string, kind:"manual"|"auto", lines:{s:number,t:string}[]} | {available:false, reason:"no_captions"|"blocked"|"upstream"}>}
 */
export async function fetchTranscript(videoId, { lang = "", fetchImpl = fetch } = {}) {
  const get = async (url, init = {}) => fetchImpl(url, {
    ...init,
    headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", Cookie: "CONSENT=YES+1", ...(init.headers || {}) },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  let html;
  try {
    const page = await get(`${WATCH_URL}?v=${encodeURIComponent(videoId)}&hl=en`);
    if (!page.ok) return { available: false, reason: page.status === 429 || page.status === 403 ? "blocked" : "upstream" };
    html = await page.text();
  } catch {
    return { available: false, reason: "upstream" };
  }
  if (html.includes("consent.youtube.com") || html.includes('"status":"LOGIN_REQUIRED"')) {
    return { available: false, reason: "blocked" };
  }

  const track = pickTrack(extractCaptionTracks(html), lang ? [lang] : []);
  if (!track) return { available: false, reason: "no_captions" };
  if (!isYoutubeHost(track.baseUrl)) return { available: false, reason: "upstream" }; // never follow a foreign URL

  try {
    const url = new URL(track.baseUrl);
    url.searchParams.set("fmt", "json3");
    const res = await get(url.toString());
    if (!res.ok) return { available: false, reason: "upstream" };
    const body = await res.text();
    const lines = mergeSegments(parseJson3(body ? JSON.parse(body) : {}));
    // An empty body usually means YouTube withheld the track from this server.
    if (!lines.length) return { available: false, reason: "blocked" };
    return { available: true, language: track.languageCode || "", kind: track.kind === "asr" ? "auto" : "manual", lines };
  } catch {
    return { available: false, reason: "upstream" };
  }
}
