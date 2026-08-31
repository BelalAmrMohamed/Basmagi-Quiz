// =============================================================================
// api/_rateLimit.js
// Shared in-memory rate limiting utility.
// Resets on cold start — acceptable for v1 given Vercel's function lifecycle;
// swap for an edge-config/Redis counter if abuse becomes a real problem.
// =============================================================================

const requestLog = new Map(); // ip -> [timestamps]
const DEFAULT_RATE_WINDOW_MS = 60_000; // per minute

/**
 * Checks if the given IP has exceeded the specified limit within the time window.
 * @param {string} ip The IP address to check.
 * @param {number} limit Maximum allowed requests in the window.
 * @param {Map} log The Map instance to use for tracking (defaults to shared requestLog).
 * @param {number} windowMs The time window in milliseconds (defaults to 1 minute).
 * @returns {boolean} True if rate limited, false otherwise.
 */
export function isRateLimited(ip, limit, log = requestLog, windowMs = DEFAULT_RATE_WINDOW_MS) {
  const now = Date.now();
  const timestamps = (log.get(ip) || []).filter(
    (t) => now - t < windowMs,
  );
  timestamps.push(now);
  log.set(ip, timestamps);
  return timestamps.length > limit;
}
