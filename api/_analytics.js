// =============================================================================
// api/_analytics.js
// Privacy-first site analytics behind the live counter on about.html.
// Not a Vercel function (leading underscore) — api/admin.js routes to it, which
// keeps the project at its current function count.
//
//   POST /api/admin  { action: "track" | "ping" }   → handleAnalyticsTrack
//   GET  /api/admin?liveStats=true                  → handleAnalyticsLive
//
// Visitors are never identified: the only thing stored is an HMAC of
// (UTC day | IP | user-agent) that rotates every day. The raw IP is hashed in
// memory and never written anywhere. See supabase/migrations/*_site_analytics.sql.
// =============================================================================

import crypto from "crypto";
import { isRateLimited } from "./_rateLimit.js";

const BOT_UA =
  /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|uptime|monitor|python-|curl\/|wget|axios|node-fetch|go-http|phantomjs/i;

const trackLog = new Map(); // `${ip}:${action}` -> timestamps
const TRACK_LIMIT_PER_MIN = 30;
const PING_LIMIT_PER_MIN = 10;

export function isBotUserAgent(ua) {
  const s = String(ua || "").trim();
  return s.length < 10 || BOT_UA.test(s);
}

export function clientIp(req) {
  const h = req.headers || {};
  const raw = h["x-vercel-forwarded-for"] || h["x-forwarded-for"] || h["x-real-ip"] || "";
  return (
    String(raw).split(",")[0].trim() ||
    (req.socket && req.socket.remoteAddress) ||
    ""
  );
}

// Daily-rotating anonymous visitor id. Same visitor => same hash within one UTC
// day, a different one tomorrow, and not reversible without the server secret.
export function visitorHash(ip, ua, now = new Date(), secret = analyticsSecret()) {
  const day = now.toISOString().slice(0, 10);
  return crypto
    .createHmac("sha256", secret)
    .update(`${day}|${ip}|${ua}`)
    .digest("hex")
    .slice(0, 32);
}

function analyticsSecret() {
  return process.env.ANALYTICS_SALT || process.env.SUPABASE_SERVICE_KEY || "basmagi-analytics";
}

// Requests from other sites' pages are ignored (same-origin fetch always sends Origin).
function isSameOrigin(req) {
  const origin = req.headers && req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch (_) {
    return false;
  }
}

// Fire-and-forget endpoint: always answers 204 so the beacon never retries or
// leaks why a hit was ignored (bot, rate limit, foreign origin, DB hiccup).
export async function handleAnalyticsTrack(req, res, supabaseService) {
  res.setHeader("Cache-Control", "no-store");
  const action = req.body && req.body.action;
  if (action !== "track" && action !== "ping") return res.status(400).json({ error: "Bad action" });

  const ua = String((req.headers && req.headers["user-agent"]) || "");
  if (!isSameOrigin(req) || isBotUserAgent(ua)) return res.status(204).end();

  const ip = clientIp(req);
  if (trackLog.size > 5000) trackLog.clear();
  const limit = action === "track" ? TRACK_LIMIT_PER_MIN : PING_LIMIT_PER_MIN;
  if (isRateLimited(`${ip}:${action}`, limit, trackLog)) return res.status(204).end();

  const visitor = visitorHash(ip, ua);
  const fn = action === "track" ? "analytics_track_view" : "analytics_heartbeat";
  try {
    const { error } = await supabaseService.rpc(fn, { p_visitor: visitor });
    if (error) console.error(`[analytics] ${fn} failed:`, error.message);
  } catch (err) {
    console.error(`[analytics] ${fn} threw:`, err);
  }
  return res.status(204).end();
}

// Shapes the RPC result into a fixed, defensive payload (30 zero-filled days).
export function normalizeLiveStats(raw) {
  const int = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  };
  const r = raw && typeof raw === "object" ? raw : {};
  const daily = (Array.isArray(r.daily) ? r.daily : [])
    .map((d) => ({
      day: String((d && d.day) || ""),
      visitors: int(d && d.visitors),
      views: int(d && d.views),
    }))
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.day))
    .slice(-30);
  return {
    totalVisitors: int(r.totalVisitors),
    visitorsToday: int(r.visitorsToday),
    totalViews: int(r.totalViews),
    viewsToday: int(r.viewsToday),
    onlineNow: int(r.onlineNow),
    daily,
  };
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_RANGE_DAYS = 731;

function isoDay(d) {
  return d.toISOString().slice(0, 10);
}

// Cairo calendar day, matching the SQL functions.
function cairoToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(now);
}

// Reads ?days=N or ?from=YYYY-MM-DD&to=YYYY-MM-DD. Returns null for the default
// 30-day payload, otherwise a clamped { from, to } window (max 731 days, never future).
export function parseRange(query, now = new Date()) {
  const q = query || {};
  const today = cairoToday(now);
  const shift = (day, n) => isoDay(new Date(Date.parse(`${day}T00:00:00Z`) - n * 86400000));
  if (q.from && DAY_RE.test(String(q.from))) {
    let to = q.to && DAY_RE.test(String(q.to)) ? String(q.to) : today;
    if (to > today) to = today;
    let from = String(q.from);
    if (Number.isNaN(Date.parse(`${from}T00:00:00Z`)) || Number.isNaN(Date.parse(`${to}T00:00:00Z`))) return null;
    if (from > to) from = to;
    const earliest = shift(to, MAX_RANGE_DAYS - 1);
    if (from < earliest) from = earliest;
    return { from, to };
  }
  const days = Math.floor(Number(q.days));
  if (Number.isFinite(days) && days > 0 && days !== 30) {
    const n = Math.min(days, MAX_RANGE_DAYS);
    return { from: shift(today, n - 1), to: today };
  }
  return null;
}

// Shapes analytics_range_stats() into the live payload (+ range totals), no 30-day cap.
export function normalizeRangeStats(raw) {
  const int = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  };
  const r = raw && typeof raw === "object" ? raw : {};
  const daily = (Array.isArray(r.daily) ? r.daily : [])
    .map((d) => ({
      day: String((d && d.day) || ""),
      visitors: int(d && d.visitors),
      views: int(d && d.views),
    }))
    .filter((d) => DAY_RE.test(d.day))
    .slice(-MAX_RANGE_DAYS);
  return {
    from: DAY_RE.test(String(r.from)) ? r.from : null,
    to: DAY_RE.test(String(r.to)) ? r.to : null,
    firstDay: DAY_RE.test(String(r.firstDay)) ? r.firstDay : null,
    rangeVisitors: int(r.rangeVisitors),
    rangeViews: int(r.rangeViews),
    daily,
  };
}

export async function handleAnalyticsLive(req, res, supabaseAnon) {
  try {
    const { data, error } = await supabaseAnon.rpc("analytics_live_stats");
    if (error) throw error;
    const payload = normalizeLiveStats(data);

    // Optional custom window for the chart (?days=7|90|365 or ?from=&to=).
    const range = parseRange(req.query);
    if (range) {
      const { data: rangeData, error: rangeError } = await supabaseAnon.rpc("analytics_range_stats", {
        p_from: range.from,
        p_to: range.to,
      });
      if (rangeError) throw rangeError;
      const r = normalizeRangeStats(rangeData);
      payload.daily = r.daily;
      payload.range = { from: r.from || range.from, to: r.to || range.to, visitors: r.rangeVisitors, views: r.rangeViews, firstDay: r.firstDay };
    }
    // Edge-cached for a few seconds: however many tabs poll, the database is hit
    // roughly once per 10 s (the cache key includes the query string).
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=10, stale-while-revalidate=20");
    return res.status(200).json(payload);
  } catch (err) {
    console.error("[analytics] live stats failed:", err && err.message ? err.message : err);
    res.setHeader("Cache-Control", "no-store");
    return res.status(500).json({ error: "Live stats unavailable" });
  }
}
