// =============================================================================
// api/_middleware.js
// Shared CORS + JWT verification utilities for all protected endpoints.
// =============================================================================

import jwt from "jsonwebtoken";

// ── CORS ──────────────────────────────────────────────────────────────────────

/**
 * Builds the set of allowed origins from the environment.
 * ALLOWED_ORIGIN can be:
 *   - A single URL:   "https://basmagi-quiz.vercel.app"
 *   - Comma-separated: "https://basmagi-quiz.vercel.app,http://localhost:3000"
 *   - Wildcard:       "*"  (dev/testing only — never use in prod)
 */
function getAllowedOrigins() {
  const raw = process.env.ALLOWED_ORIGIN || "";
  return raw
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

/**
 * Applies CORS headers to the response.
 * Reflects the request Origin if it's in the allowed list;
 * falls back to the first allowed origin otherwise.
 *
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 */
export function applyCors(req, res) {
  const origins = getAllowedOrigins();
  const requestOrigin = req.headers["origin"] || "";

  let allowedOrigin;
  if (origins.includes("*")) {
    allowedOrigin = "*";
  } else if (origins.includes(requestOrigin)) {
    // Reflect the matched origin (required for credentialed requests)
    allowedOrigin = requestOrigin;
  } else {
    // Default to the first configured origin
    allowedOrigin = origins[0] || "*";
  }

  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400"); // cache preflight 24h
}

// ── JWT verification ──────────────────────────────────────────────────────────

/**
 * Verifies the `Authorization: Bearer <token>` header.
 * Throws a typed Error string that callers map to HTTP status codes.
 *
 * @param {import('http').IncomingMessage} req
 * @returns {{ role: string, iat: number, exp: number }} decoded payload
 */
export function requireAdmin(req) {
  const authHeader = req.headers["authorization"] || "";

  if (!authHeader.startsWith("Bearer ")) {
    throw new Error("UNAUTHORIZED");
  }

  const token = authHeader.slice(7).trim();
  if (!token || token === "null" || token === "undefined") {
    throw new Error("UNAUTHORIZED");
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ["HS256"],
    });
  } catch (err) {
    if (err.name === "TokenExpiredError") throw new Error("TOKEN_EXPIRED");
    throw new Error("UNAUTHORIZED");
  }

  if (payload.role !== "admin") throw new Error("FORBIDDEN");

  return payload;
}

// ── Standard error responses ──────────────────────────────────────────────────

/**
 * Maps auth-related error message strings to HTTP responses.
 * Call this in catch blocks of protected endpoints.
 *
 * @param {Error} err
 * @param {import('http').ServerResponse} res
 * @returns {boolean} true if the error was handled (auth-related), false otherwise
 */
export function handleAuthError(err, res) {
  if (err.message === "TOKEN_EXPIRED") {
    res
      .status(401)
      .json({ error: "انتهت صلاحية الجلسة. يرجى تسجيل الدخول مجددًا." });
    return true;
  }
  if (err.message === "UNAUTHORIZED" || err.message === "FORBIDDEN") {
    res.status(401).json({ error: "غير مصرح" });
    return true;
  }
  return false;
}
