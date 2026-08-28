// =============================================================================
// api/ai-agent/chat.js
// POST /api/ai-agent/chat
// Body: {
//   provider: "google" | "deepseek" | "claude",
//   messages: [{ role: "user"|"assistant", content: string }, ...],
//   useOwnKey?: boolean,
//   ownKey?: string,           // required if useOwnKey is true
//   systemPrompt?: string,     // optional system-role instructions
//   enableTools?: boolean,     // if true, offers CREATE_QUIZ_TOOL (see _tools.js)
// }
// Success 200: { text: string, toolCall?: { name: string, input: object } }
// Failure 400/401/403/429/500: { error: string }
//
// AUTHORIZATION:
// Access to the platform's rotated free-tier keys (getNextKey in
// _keyPool.js) requires EITHER:
//   - a valid admin JWT (see _middleware.js::requireAdmin) — "Verified
//     Admin", OR
//   - a valid regular-user JWT (see api/user-profile/identify.js and
//     api/user-profile/sync-progress.js) with current_level >= 10.
// Both JWTs are minted server-side with a server-computed claim (admin
// role / user current_level), so neither is spoofable by a client simply
// sending a bigger number — see isLevel10PlusUser() below.
//
// Everyone else (including anonymous users) can still use the endpoint by
// setting useOwnKey: true and supplying their own key — that path skips
// the platform pool and authorization check entirely, and the key is never
// persisted server-side.
// =============================================================================

import { applyCors, requireAdmin, handleAuthError } from "../_middleware.js";
import { getNextKey, hasPlatformKeys } from "./_keyPool.js";
import { callProvider, isSupportedProvider } from "./_providerClients.js";
import { CREATE_QUIZ_TOOL } from "./_tools.js";
import jwt from "jsonwebtoken";

// Upstream 429 ("too many requests") / 503 ("model overloaded") are
// transient provider-side conditions, not something wrong with the key or
// our code — surface them as a distinct, friendlier message + a real HTTP
// status the frontend can use to suggest "try again" rather than reading
// as a generic broken-integration error.
function isTransientUpstreamStatus(status) {
  return status === 429 || status === 503;
}

function transientMessageFor(status) {
  return status === 429
    ? "تم الوصول للحد الأقصى من الطلبات لدى مزوّد الذكاء الاصطناعي حاليًا. حاول مرة أخرى خلال قليل."
    : "خوادم مزوّد الذكاء الاصطناعي مشغولة حاليًا (overloaded). حاول مرة أخرى خلال لحظات.";
}

// Very small in-memory per-IP limiter for the own-key proxy path, to keep
// this endpoint from being used as an open relay. Resets on cold start —
// acceptable for v1 given Vercel's function lifecycle; swap for an
// edge-config/Redis counter if abuse becomes a real problem.
const ownKeyRequestLog = new Map(); // ip -> [timestamps]
const OWN_KEY_RATE_LIMIT = 20; // requests
const OWN_KEY_RATE_WINDOW_MS = 60_000; // per minute

function isRateLimited(ip) {
  const now = Date.now();
  const timestamps = (ownKeyRequestLog.get(ip) || []).filter(
    (t) => now - t < OWN_KEY_RATE_WINDOW_MS,
  );
  timestamps.push(now);
  ownKeyRequestLog.set(ip, timestamps);
  return timestamps.length > OWN_KEY_RATE_LIMIT;
}

// Verifies a regular-user JWT minted by /api/user-profile/identify or
// /api/user-profile/sync-progress. `current_level` in the token is
// server-computed at mint time (see api/user-profile/_levelMath.js) —
// never something the client set directly — so trusting the claim here is
// safe as long as the token itself verifies (same guarantee as the admin
// JWT path via requireAdmin).
function isLevel10PlusUser(req) {
  const authHeader = req.headers["authorization"] || "";
  if (!authHeader.startsWith("Bearer ")) return false;
  const token = authHeader.slice(7).trim();
  if (!token) return false;

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ["HS256"] });
    return payload.role === "user" && Number(payload.current_level) >= 10;
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { provider, messages, useOwnKey, ownKey, systemPrompt, enableTools } = req.body || {};

  if (!isSupportedProvider(provider)) {
    return res.status(400).json({ error: "مزوّد غير مدعوم" });
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "الرسائل مطلوبة" });
  }

  const tools = enableTools ? [CREATE_QUIZ_TOOL] : undefined;

  // ── Own-key path: bypass auth + platform pool entirely ───────────────────
  if (useOwnKey) {
    if (!ownKey || typeof ownKey !== "string") {
      return res.status(400).json({ error: "مفتاح API مطلوب" });
    }

    const ip =
      req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
      req.socket?.remoteAddress ||
      "unknown";
    if (isRateLimited(ip)) {
      return res.status(429).json({ error: "طلبات كثيرة جدًا، حاول لاحقًا" });
    }

    try {
      const result = await callProvider(provider, ownKey, messages, systemPrompt, tools);
      return res.status(200).json(result);
    } catch (err) {
      console.error("[ai-agent/chat] own-key provider error:", err);
      if (isTransientUpstreamStatus(err.upstreamStatus)) {
        return res.status(err.upstreamStatus).json({
          error: transientMessageFor(err.upstreamStatus),
          detail: process.env.NODE_ENV === "production" ? undefined : String(err.message || err),
          transient: true,
        });
      }
      return res.status(502).json({
        error: "فشل الاتصال بمزوّد الذكاء الاصطناعي",
        detail: process.env.NODE_ENV === "production" ? undefined : String(err.message || err),
      });
    }
  }

  // ── Platform-key path: requires Verified Admin OR a Level 10+ user ──────
  try {
    requireAdmin(req);
  } catch (err) {
    if (!isLevel10PlusUser(req)) {
      // Only defer to the shared admin-token-expired message when that's
      // literally what happened (a stale admin token) — any other failure
      // (no token, malformed token, valid-but-under-level-10 user token)
      // gets the friendlier, more accurate 403 below instead of a bare
      // "غير مصرح".
      if (err.message === "TOKEN_EXPIRED") {
        handleAuthError(err, res);
        return;
      }
      return res.status(403).json({
        error:
          "استخدام مفاتيح المنصة متاح فقط للمشرفين الموثقين أو المستخدمين من المستوى 10+. يمكنك استخدام مفتاح API الخاص بك بدلاً من ذلك.",
      });
    }
  }

  if (!hasPlatformKeys(provider)) {
    return res.status(503).json({ error: "لا توجد مفاتيح منصة متاحة لهذا المزوّد حاليًا" });
  }

  const picked = getNextKey(provider);
  if (!picked) {
    return res.status(503).json({ error: "لا توجد مفاتيح منصة متاحة لهذا المزوّد حاليًا" });
  }

  try {
    const result = await callProvider(provider, picked.key, messages, systemPrompt, tools);
    return res.status(200).json(result);
  } catch (err) {
    console.error("[ai-agent/chat] platform-key provider error:", err);
    if (isTransientUpstreamStatus(err.upstreamStatus)) {
      return res.status(err.upstreamStatus).json({
        error: transientMessageFor(err.upstreamStatus),
        transient: true,
      });
    }
    return res.status(502).json({ error: "فشل الاتصال بمزوّد الذكاء الاصطناعي" });
  }
}