// =============================================================================
// supabase/functions/youtube/transcript.js
// Server-only: fetches the public caption track of a YouTube video (best effort).
// The official Data API cannot download captions with an API key (that needs the
// video owner's OAuth), so this reads the same public caption tracks the YouTube
// apps use. It can stop working when YouTube changes its pages or blocks datacenter
// IPs: every failure is reported as { available: false, reason } and the caller
// falls back to the video's title and description.
//
// Why several sources (in this order):
//   1. InnerTube /youtubei/v1/player as the ANDROID, then the IOS client. The caption
//      URLs those clients get are not bound to a web proof-of-origin (`pot`) token.
//   2. The caption tracks embedded in the watch page (the previous, web-client path).
//      Its timedtext URLs usually need a `pot` token now, so YouTube answers 200 with an
//      EMPTY body — that is the "blocked" the agent used to report every time.
// Each caption URL is tried as json3, then the URL's own format (XML), srv3 and vtt.
//
// Diagnostics: every step is recorded as { step, … } (statuses, counts, byte lengths and
// query-parameter NAMES only — never cookies, URL values, signatures or tokens). They are
// written to the function logs on every failure and returned as `debug` when the caller
// asks for it (GET /api/youtube?action=transcript&id=…&debug=1).
//
// Pure helpers (extractCaptionTracks, pickTrack, parseJson3, parseXmlTranscript, parseVtt,
// parseCaptionBody, mergeSegments) are unit-tested in tests/youtube-transcript.test.js;
// fetchTranscript takes an injectable `fetchImpl`.
// =============================================================================

const WATCH_URL = "https://www.youtube.com/watch";
const PLAYER_URL = "https://www.youtube.com/youtubei/v1/player";
const FETCH_TIMEOUT_MS = 8000;
const TOTAL_BUDGET_MS = 25000;
const MERGE_WINDOW_SECONDS = 20;
const MAX_LINES = 4000;
const WEB_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// InnerTube clients that hand out caption URLs usable without a web `pot` token.
// Versions follow what yt-dlp / youtube-transcript-api use; if YouTube starts rejecting an
// old version, bumping `version` here is the fix (the debug output shows the player status).
const CLIENTS = [
  {
    name: "ANDROID", id: 3, version: "20.10.38",
    ua: "com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip",
    context: { androidSdkVersion: 30, osName: "Android", osVersion: "11" },
  },
  {
    name: "IOS", id: 5, version: "20.10.4",
    ua: "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)",
    context: { deviceMake: "Apple", deviceModel: "iPhone16,2", osName: "iPhone", osVersion: "18.3.2.22D82" },
  },
];

// "" = keep the URL's own format (XML on the app clients).
const CAPTION_FORMATS = ["json3", "", "srv3", "vtt"];

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

/** Caption tracks out of an InnerTube player response ([] when absent). */
export function extractPlayerCaptionTracks(player) {
  const tracks = player?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  return Array.isArray(tracks) ? tracks.filter((t) => typeof t?.baseUrl === "string") : [];
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

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decodeEntities(text) {
  // The legacy XML format is double-encoded (&amp;#39;), so decode twice.
  const once = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const cp = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return String.fromCodePoint(cp); } catch { return m; }
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
  return once(once(text));
}

/** XML captions -> [{ s, t }]: the classic `<text start dur>` (seconds) and srv3 `<p t d>` (milliseconds) formats. */
export function parseXmlTranscript(xml) {
  const src = String(xml || "");
  const attr = (attrs, name) => new RegExp(`\\b${name}="([^"]*)"`).exec(attrs)?.[1] ?? null;
  const clean = (inner) => decodeEntities(inner.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
  const out = [];
  for (const m of src.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)) {
    const t = clean(m[2]);
    if (t) out.push({ s: Math.max(0, Math.floor(Number(attr(m[1], "start")) || 0)), t });
  }
  if (out.length) return out;
  for (const m of src.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/g)) {
    const t = clean(m[2]);
    if (t) out.push({ s: Math.max(0, Math.floor((Number(attr(m[1], "t")) || 0) / 1000)), t });
  }
  return out;
}

/** WebVTT -> [{ s, t }]. Auto-generated VTT repeats each line in the next cue; repeats are dropped. */
export function parseVtt(text) {
  const out = [];
  let lastLine = "";
  for (const block of String(text || "").replace(/\r/g, "").split(/\n{2,}/)) {
    const lines = block.split("\n");
    const at = lines.findIndex((l) => l.includes("-->"));
    if (at < 0) continue;
    const m = /(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,]\d+)?\s*-->/.exec(lines[at]);
    if (!m) continue;
    const s = (Number(m[1]) || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
    const fresh = [];
    for (const raw of lines.slice(at + 1)) {
      const line = decodeEntities(raw.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
      if (!line || line === lastLine) continue;
      fresh.push(line);
      lastLine = line;
    }
    if (fresh.length) out.push({ s, t: fresh.join(" ") });
  }
  return out;
}

/** Detects json3 / WebVTT / XML and parses it; [] for an empty or unknown body. */
export function parseCaptionBody(body) {
  const s = String(body || "").trim();
  if (!s) return [];
  if (s[0] === "{") {
    try { return parseJson3(JSON.parse(s)); } catch { return []; }
  }
  if (s.startsWith("WEBVTT")) return parseVtt(s);
  if (s.includes("<")) return parseXmlTranscript(s);
  return [];
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

const firstMatch = (text, re) => re.exec(text)?.[1] || "";

/**
 * @param {string} videoId
 * @param {{ lang?: string, fetchImpl?: typeof fetch, debug?: boolean }} [opts]
 * @returns {Promise<{available:true, language:string, kind:"manual"|"auto", lines:{s:number,t:string}[]} | {available:false, reason:"no_captions"|"blocked"|"upstream"}>}
 *   plus `debug: { via, ms, steps }` when opts.debug is true
 */
export async function fetchTranscript(videoId, { lang = "", fetchImpl = fetch, debug = false } = {}) {
  const startedAt = Date.now();
  const steps = [];
  const st = { watchOk: false, tracksSeen: false, sawBlock: false, sawEmptyBody: false };

  const get = async (url, init = {}, ua = WEB_UA) => {
    const remaining = TOTAL_BUDGET_MS - (Date.now() - startedAt);
    if (remaining <= 0) throw new Error("time budget exhausted");
    return fetchImpl(url, {
      ...init,
      headers: { "User-Agent": ua, "Accept-Language": "en-US,en;q=0.9", Cookie: "CONSENT=YES+1", ...(init.headers || {}) },
      signal: AbortSignal.timeout(Math.min(FETCH_TIMEOUT_MS, remaining)),
    });
  };
  const finish = (result, via = "") => {
    const ms = Date.now() - startedAt;
    // One compact line per call in `supabase functions logs youtube`; nothing sensitive in it.
    console.log("[youtube.transcript]", JSON.stringify({ id: videoId, ok: result.available, reason: result.reason, via, ms, steps }));
    return debug ? { ...result, debug: { via, ms, steps } } : result;
  };
  const fail = () => finish({
    available: false,
    reason: st.tracksSeen ? (st.sawEmptyBody || st.sawBlock ? "blocked" : "upstream")
      : st.sawBlock ? "blocked"
      : !st.watchOk ? "upstream"
      : "no_captions",
  });
  const blockedStatus = (status) => status === 429 || status === 403;

  /** One track -> merged lines, trying every caption format; null when none gave text. */
  async function readTrack(track, source, ua) {
    if (!isYoutubeHost(track.baseUrl)) { // never follow a foreign URL
      steps.push({ step: "captions", source, skipped: "foreign_host" });
      return null;
    }
    const base = new URL(track.baseUrl);
    const info = { params: [...base.searchParams.keys()], hasPot: base.searchParams.has("pot"), client: base.searchParams.get("c") || "", exp: base.searchParams.get("exp") || "" };
    for (const fmt of CAPTION_FORMATS) {
      const url = new URL(base);
      url.searchParams.delete("fmt");
      if (fmt) url.searchParams.set("fmt", fmt);
      const entry = { step: "captions", source, fmt: fmt || "default", ...(steps.some((s) => s.step === "captions" && s.source === source) ? {} : info) };
      steps.push(entry);
      try {
        const res = await get(url.toString(), {}, ua);
        entry.status = res.status;
        if (!res.ok) { if (blockedStatus(res.status)) st.sawBlock = true; continue; }
        const body = await res.text();
        entry.bytes = body.length;
        if (!body.length) { st.sawEmptyBody = true; continue; } // typical for a missing pot token
        const segs = parseCaptionBody(body);
        entry.cues = segs.length;
        const lines = mergeSegments(segs);
        if (lines.length) return lines;
      } catch (err) {
        entry.error = String(err?.name || "error");
      }
    }
    return null;
  }

  const success = (track, lines, via) => finish(
    { available: true, language: track.languageCode || "", kind: track.kind === "asr" ? "auto" : "manual", lines },
    via,
  );

  // ── Watch page: consent / bot-check detection, the public InnerTube key, tracks for the fallback ──
  let html = "";
  const watch = { step: "watch" };
  steps.push(watch);
  try {
    const page = await get(`${WATCH_URL}?v=${encodeURIComponent(videoId)}&hl=en`);
    watch.status = page.status;
    if (page.ok) {
      html = await page.text();
      st.watchOk = true;
    } else if (blockedStatus(page.status)) st.sawBlock = true;
  } catch (err) {
    watch.error = String(err?.name || "error");
  }
  const webTracks = extractCaptionTracks(html);
  watch.bytes = html.length;
  watch.consent = html.includes("consent.youtube.com");
  watch.loginRequired = html.includes('"status":"LOGIN_REQUIRED"');
  watch.captionTracks = webTracks.length;
  if (watch.consent || watch.loginRequired) st.sawBlock = true;
  const apiKey = firstMatch(html, /"INNERTUBE_API_KEY":\s*"([\w-]+)"/); // public site config, not a secret
  const visitorData = firstMatch(html, /"VISITOR_DATA":\s*"([^"]+)"/);
  watch.hasApiKey = !!apiKey;

  const preferred = lang ? [lang] : [];

  // ── 1) InnerTube player as the app clients ──
  for (const client of CLIENTS) {
    const entry = { step: "player", client: client.name };
    steps.push(entry);
    let tracks = [];
    try {
      const url = `${PLAYER_URL}?prettyPrint=false${apiKey ? `&key=${encodeURIComponent(apiKey)}` : ""}`;
      const res = await get(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://www.youtube.com",
          "X-YouTube-Client-Name": String(client.id),
          "X-YouTube-Client-Version": client.version,
          ...(visitorData ? { "X-Goog-Visitor-Id": visitorData } : {}),
        },
        body: JSON.stringify({
          context: { client: { clientName: client.name, clientVersion: client.version, hl: "en", gl: "US", ...(visitorData ? { visitorData } : {}), ...client.context } },
          videoId,
          contentCheckOk: true,
          racyCheckOk: true,
        }),
      }, client.ua);
      entry.status = res.status;
      if (!res.ok) {
        if (blockedStatus(res.status)) st.sawBlock = true;
        continue;
      }
      const player = JSON.parse((await res.text()) || "{}");
      const playability = player?.playabilityStatus || {};
      entry.playability = String(playability.status || "").slice(0, 24);
      if (playability.reason) entry.reason = String(playability.reason).slice(0, 80);
      if (playability.status === "LOGIN_REQUIRED") st.sawBlock = true; // "confirm you're not a bot" from a datacenter IP
      tracks = extractPlayerCaptionTracks(player);
      entry.captionTracks = tracks.length;
    } catch (err) {
      entry.error = String(err?.name || "error");
      continue;
    }
    const track = pickTrack(tracks, preferred);
    if (!track) continue;
    st.tracksSeen = true;
    const lines = await readTrack(track, `player:${client.name}`, client.ua);
    if (lines) return success(track, lines, `player:${client.name}`);
  }

  // ── 2) Tracks embedded in the watch page (web client; often needs a pot token) ──
  const webTrack = pickTrack(webTracks, preferred);
  if (webTrack) {
    st.tracksSeen = true;
    const lines = await readTrack(webTrack, "watch", WEB_UA);
    if (lines) return success(webTrack, lines, "watch");
  }

  return fail();
}
