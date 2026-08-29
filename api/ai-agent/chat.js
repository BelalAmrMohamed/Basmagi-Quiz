// =============================================================================
// api/ai-agent/chat.js
// POST /api/ai-agent/chat
// Body: {
//   provider: "google" | "deepseek" | "claude",
//   model?: string,            // optional model override (Settings tab's model
//                              // picker); validated server-side against a
//                              // per-provider allowlist (see
//                              // _providerClients.js's ALLOWED_MODELS) and
//                              // falls back to that provider's own
//                              // lightest/cheapest/latest default when
//                              // omitted or unrecognized. ONLY honored on
//                              // the useOwnKey path — on the platform-key
//                              // path (shared free-tier keys) this is
//                              // always ignored and the default is forced,
//                              // so a Level 10+/admin user can't select a
//                              // heavier model and drain shared quota.
//   messages: [{
//     role: "user"|"assistant",
//     content: string,
//     attachments?: [{ mimeType: string, base64: string, name?: string }],
//   }, ...],
//   useOwnKey?: boolean,
//   ownKey?: string,           // required if useOwnKey is true
//   systemPrompt?: string,     // optional system-role instructions
//   enableTools?: boolean,     // if true, offers quiz tools (see _tools.js)
//   toolNames?: string[],      // which tools to offer when enableTools is true —
//                              // subset of ["create_quiz","edit_quiz","edit_current_quiz",
//                              // "delete_quiz","reset_quiz_page"] (see TOOLS_BY_NAME
//                              // below — "edit_quiz" and "edit_current_quiz" are two
//                              // different SCHEMAS for the same action, pick one not
//                              // both). Defaults to the original three (create/edit/
//                              // delete) when omitted, so existing callers need no
//                              // changes.
// }
//
// ATTACHMENTS: max 1 per message, 4MB decoded (see MAX_ATTACHMENT_BYTES —
// Vercel's own request body cap is the real binding constraint here, not
// any provider's own limit). Images/PDF are sent natively to Google/Claude;
// everything else (currently just .docx) is text-extracted server-side via
// processAttachments() and folded into `content` — this is also what makes
// attachments work at all with DeepSeek, which has no file input in its API.
// Files cost meaningfully more tokens/quota than plain text — routing
// file-bearing requests through the user's own key (useOwnKey) rather than
// the platform pool is recommended when possible; see OWN_KEY_ATTACHMENT_RATE_LIMIT
// below for why the own-key path already treats them differently.
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
import { CREATE_QUIZ_TOOL, EDIT_QUIZ_TOOL, EDIT_CURRENT_QUIZ_TOOL, DELETE_QUIZ_TOOL, RESET_QUIZ_PAGE_TOOL } from "./_tools.js";
import jwt from "jsonwebtoken";
import mammoth from "mammoth";

// ── File attachments (Task 3) ──────────────────────────────────────────────
// Deliberately handled inside this single endpoint rather than a new
// serverless function — the project is close to Vercel Hobby's 12-function
// cap (see public-config.js's comment re: the removed /api/env route), so
// every new capability here needs to fold into an existing route.
//
// Vercel's default request body limit (4.5MB on Hobby) is well below
// Gemini's own ~20MB inline-file limit, so *that* is the real binding
// constraint — enforce a conservative cap here so oversized uploads fail
// with a clear message instead of an opaque 413 from the platform.
const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024; // 4MB, base64-decoded size
const MAX_ATTACHMENTS_PER_MESSAGE = 1; // v1: one file at a time, see plan

// Gemini and Claude both take these natively (see _providerClients.js);
// anything else goes through extractAttachmentText() below instead.
const NATIVELY_SUPPORTED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
]);

const DOCX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function base64ByteLength(base64) {
  // Cheap approximation good enough for a size guard: 4 base64 chars encode
  // 3 raw bytes, minus up to 2 bytes for padding.
  const padding = (base64.match(/=+$/) || [""])[0].length;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/**
 * DeepSeek has no file/image input in its API at all (text-only), and
 * neither Gemini nor Claude take .docx/.pptx natively. For any mime type
 * outside NATIVELY_SUPPORTED_MIME_TYPES, extract plain text server-side and
 * fold it into the message's `content` instead of sending it as a binary
 * attachment — this is also what makes DeepSeek usable when a file is
 * attached (see _providerClients.js's top comment).
 *
 * v1 supports .docx via mammoth. .pptx extraction is a larger lift (no
 * lightweight library on hand) and is intentionally out of scope for now —
 * unsupported types get a clear error back to the user rather than silently
 * doing nothing.
 * @param {{mimeType: string, base64: string, name?: string}} attachment
 * @returns {Promise<string>} extracted plain text
 */
async function extractAttachmentText(attachment) {
  if (attachment.mimeType === DOCX_MIME_TYPE) {
    const buffer = Buffer.from(attachment.base64, "base64");
    const { value } = await mammoth.extractRawText({ buffer });
    return value || "";
  }
  const err = new Error(`Unsupported attachment type for extraction: ${attachment.mimeType}`);
  err.userFacing = true;
  throw err;
}

/**
 * Validates and, where needed, converts each message's attachments in
 * place — extracting text for non-natively-supported file types (folded
 * into that message's `content`) and leaving natively-supported types
 * (images/PDF) untouched for the provider adapter to send as binary parts.
 * Mutates and returns the same messages array.
 * @param {Array<object>} messages
 * @returns {Promise<Array<object>>}
 */
async function processAttachments(messages) {
  for (const message of messages) {
    if (!Array.isArray(message.attachments) || !message.attachments.length) continue;

    if (message.attachments.length > MAX_ATTACHMENTS_PER_MESSAGE) {
      const err = new Error("Too many attachments on one message");
      err.userFacing = true;
      err.userMessage = "يمكن إرفاق ملف واحد فقط في كل رسالة حاليًا.";
      throw err;
    }

    const remainingAttachments = [];
    for (const att of message.attachments) {
      if (!att?.base64 || !att?.mimeType) continue;

      const byteLength = base64ByteLength(att.base64);
      if (byteLength > MAX_ATTACHMENT_BYTES) {
        const err = new Error(`Attachment too large: ${byteLength} bytes`);
        err.userFacing = true;
        err.userMessage = "حجم الملف كبير جدًا (الحد الأقصى 4 ميجابايت).";
        throw err;
      }

      if (NATIVELY_SUPPORTED_MIME_TYPES.has(att.mimeType)) {
        remainingAttachments.push(att);
        continue;
      }

      try {
        const extractedText = await extractAttachmentText(att);
        const label = att.name ? `\n\n[محتوى الملف المرفق: ${att.name}]\n` : "\n\n[محتوى الملف المرفق]\n";
        message.content = `${message.content || ""}${label}${extractedText}`;
      } catch (extractErr) {
        if (extractErr.userFacing) throw extractErr;
        const err = new Error(`Attachment extraction failed: ${extractErr.message}`);
        err.userFacing = true;
        err.userMessage = "لا يمكن معالجة نوع هذا الملف حاليًا. الأنواع المدعومة: صور، PDF، Word (.docx).";
        throw err;
      }
    }
    message.attachments = remainingAttachments;
  }
  return messages;
}

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
const OWN_KEY_RATE_LIMIT = 20; // requests per minute, plain text
const OWN_KEY_ATTACHMENT_RATE_LIMIT = 6; // requests per minute, file-bearing
const OWN_KEY_RATE_WINDOW_MS = 60_000; // per minute

function isRateLimited(ip, limit = OWN_KEY_RATE_LIMIT) {
  const now = Date.now();
  const timestamps = (ownKeyRequestLog.get(ip) || []).filter(
    (t) => now - t < OWN_KEY_RATE_WINDOW_MS,
  );
  timestamps.push(now);
  ownKeyRequestLog.set(ip, timestamps);
  return timestamps.length > limit;
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

// All tools ever offered, keyed by a REQUEST-level name — callers select a
// subset via `toolNames` (see below) rather than this endpoint hardcoding
// one fixed set. Add a new tool here once, then any page can opt in by
// name without touching this file again.
//
// NOTE: "edit_quiz" and "edit_current_quiz" both produce a tool whose own
// `.name` field is "edit_quiz" (that's what the model's function-call
// response and the frontend's onToolCall dispatch both key on) — they're
// two different SCHEMAS for the same underlying action, picked per-page.
// EDIT_QUIZ_TOOL requires a `currentTitle` to disambiguate one quiz among
// many (home page's quiz list); EDIT_CURRENT_QUIZ_TOOL drops that field
// entirely for pages with exactly one quiz in scope (create-quiz editor) —
// its schema-level presence, even as merely optional, invited the model to
// fill in a currentTitle that page's tool handler would ignore anyway. Only
// one of the two should ever appear in a single request's `toolNames`.
const TOOLS_BY_NAME = {
  create_quiz: CREATE_QUIZ_TOOL,
  edit_quiz: EDIT_QUIZ_TOOL,
  edit_current_quiz: EDIT_CURRENT_QUIZ_TOOL,
  delete_quiz: DELETE_QUIZ_TOOL,
  reset_quiz_page: RESET_QUIZ_PAGE_TOOL,
};

// Historical default — the home page's original three tools — kept so
// existing callers that pass `enableTools: true` without `toolNames` (i.e.
// every caller before this field existed) keep working unchanged.
const DEFAULT_TOOL_NAMES = ["create_quiz", "edit_quiz", "delete_quiz"];

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { provider, model, messages, useOwnKey, ownKey, systemPrompt, enableTools, toolNames } =
    req.body || {};

  if (!isSupportedProvider(provider)) {
    return res.status(400).json({ error: "مزوّد غير مدعوم" });
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "الرسائل مطلوبة" });
  }

  // `toolNames` lets each page offer only the tools that make sense for it
  // (e.g. the create-quiz editor offers edit/reset but not create/delete —
  // there's no "other quiz" to create or delete from inside the editor of
  // one). Unknown names are silently dropped rather than erroring, so a
  // typo degrades to "fewer tools" instead of a hard failure.
  const requestedNames = Array.isArray(toolNames) && toolNames.length
    ? toolNames
    : DEFAULT_TOOL_NAMES;
  const tools = enableTools
    ? requestedNames.map((name) => TOOLS_BY_NAME[name]).filter(Boolean)
    : undefined;

  try {
    await processAttachments(messages);
  } catch (err) {
    console.error("[ai-agent/chat] attachment processing error:", err);
    return res.status(400).json({ error: err.userMessage || "تعذر معالجة الملف المرفق" });
  }

  // Attachments cost noticeably more per request (larger payload/context),
  // so requests carrying a still-binary attachment (image/PDF headed to
  // Google or Claude) get a tighter own-key rate limit than plain text.
  const hasBinaryAttachment = messages.some(
    (m) => Array.isArray(m.attachments) && m.attachments.length > 0,
  );

  // ── Own-key path: bypass auth + platform pool entirely ───────────────────
  if (useOwnKey) {
    if (!ownKey || typeof ownKey !== "string") {
      return res.status(400).json({ error: "مفتاح API مطلوب" });
    }

    const ip =
      req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
      req.socket?.remoteAddress ||
      "unknown";
    const limit = hasBinaryAttachment ? OWN_KEY_ATTACHMENT_RATE_LIMIT : OWN_KEY_RATE_LIMIT;
    if (isRateLimited(ip, limit)) {
      return res.status(429).json({ error: "طلبات كثيرة جدًا، حاول لاحقًا" });
    }

    try {
      const result = await callProvider(provider, ownKey, messages, systemPrompt, tools, model);
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

  // Model selection is only meaningful when the caller supplies their own
  // API key (own-key path above). On the platform-key path every request
  // shares the same rotated Google AI Studio free-tier keys, so honoring a
  // client-requested heavier model here would let any Level 10+/admin user
  // drain the shared rate limit for everyone. Force the provider's
  // lightest/cheapest/latest default regardless of what the client sent.
  try {
    const result = await callProvider(provider, picked.key, messages, systemPrompt, tools, undefined);
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