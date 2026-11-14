// supabase/functions/pulse/index.ts
// NOTE: deliberately NOT named "track"/"analytics": ad blockers (Brave, uBlock) block those URLs.
// Page-view / heartbeat beacon, moved off Vercel (api/_analytics.js handleAnalyticsTrack).
// Anonymous: only a daily-rotating HMAC of (UTC day | IP | UA) is stored, via the
// analytics_track_view / analytics_heartbeat RPCs (service_role only).
//
// Deploy:  supabase functions deploy pulse --no-verify-jwt
// Secrets: supabase secrets set ANALYTICS_SALT=<same value as Vercel ANALYTICS_SALT>
//          (keeping the same salt keeps today's visitor hashes continuous).
import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED_HOSTS = new Set(
  (Deno.env.get("ANALYTICS_ALLOWED_HOSTS") || "basmagi.vercel.app")
    .split(",").map((s) => s.trim()).filter(Boolean),
);
const BOT_UA =
  /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|uptime|monitor|python-|curl\/|wget|axios|node-fetch|go-http|phantomjs/i;
const TRACK_LIMIT_PER_MIN = 30;
const PING_LIMIT_PER_MIN = 10;
const hits = new Map<string, number[]>();

function cors(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function allowedOrigin(origin: string | null): boolean {
  if (!origin) return true; // sendBeacon from same-origin pages may omit it
  try {
    const u = new URL(origin);
    return ALLOWED_HOSTS.has(u.host) || u.hostname === "localhost";
  } catch (_) {
    return false;
  }
}

function limited(key: string, max: number): boolean {
  const now = Date.now();
  if (hits.size > 5000) hits.clear();
  const arr = (hits.get(key) || []).filter((t) => now - t < 60_000);
  arr.push(now);
  hits.set(key, arr);
  return arr.length > max;
}

async function visitorHash(ip: string, ua: string, secret: string): Promise<string> {
  const day = new Date().toISOString().slice(0, 10);
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${day}|${ip}|${ua}`));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

let admin: ReturnType<typeof createClient> | null = null;

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const base = cors(origin);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: base });
  if (req.method !== "POST") return new Response(null, { status: 405, headers: base });

  let action = "";
  try {
    const text = await req.text(); // sendBeacon sends text/plain; parse manually
    action = JSON.parse(text || "{}").action;
  } catch (_) { /* fallthrough */ }
  if (action !== "track" && action !== "ping") return new Response(null, { status: 400, headers: base });

  const ua = req.headers.get("user-agent") || "";
  if (!allowedOrigin(origin) || ua.trim().length < 10 || BOT_UA.test(ua)) {
    return new Response(null, { status: 204, headers: base });
  }
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
    req.headers.get("cf-connecting-ip") || "";
  if (limited(`${ip}:${action}`, action === "track" ? TRACK_LIMIT_PER_MIN : PING_LIMIT_PER_MIN)) {
    return new Response(null, { status: 204, headers: base });
  }

  try {
    admin ??= createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false },
    });
    const secret = Deno.env.get("ANALYTICS_SALT") || "basmagi-analytics";
    const visitor = await visitorHash(ip, ua, secret);
    const fn = action === "track" ? "analytics_track_view" : "analytics_heartbeat";
    const { error } = await admin.rpc(fn, { p_visitor: visitor });
    if (error) console.error(`[pulse] ${fn} failed:`, error.message);
  } catch (err) {
    console.error("[pulse] threw:", err);
  }
  return new Response(null, { status: 204, headers: base });
});
