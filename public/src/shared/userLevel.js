// =============================================================================
// public/src/shared/userLevel.js
// Client-side half of the user_profiles / level-verification system.
//
// Regular users have no login — this mints a random device_id once,
// persists it in localStorage, and exchanges it with the backend
// (/api/user-profile/identify) for a short-lived JWT carrying a
// SERVER-COMPUTED current_level claim. That token is what
// api/ai-agent/chat.js trusts for the "Level 10+" gate — nothing here
// sends a level number to the server; the server always derives it from
// user_profiles.passed_quizzes_count.
//
// Usage:
//   import { getUserToken, reportQuizResult, getCachedLevel } from "../../shared/userLevel.js";
//   const token = await getUserToken();          // mint/refresh as needed
//   await reportQuizResult({ passed: true });     // call after a quiz result
// =============================================================================

import { getFromStorage, setInStorage } from "./storage-helpers.js";

const DEVICE_ID_KEY = "ai_agent_device_id";
const TOKEN_CACHE_KEY = "ai_agent_user_token";
const TOKEN_EXP_CACHE_KEY = "ai_agent_user_token_exp";
const LEVEL_CACHE_KEY = "ai_agent_user_level";

// Refresh a little before actual JWT expiry (tokens are minted with a 2h
// TTL server-side — see api/user-profile/identify.js).
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

function getOrCreateDeviceId() {
  let id = getFromStorage(DEVICE_ID_KEY, null);
  if (!id) {
    id = crypto.randomUUID();
    setInStorage(DEVICE_ID_KEY, id);
  }
  return id;
}

function cacheToken(token, currentLevel) {
  setInStorage(TOKEN_CACHE_KEY, token);
  setInStorage(TOKEN_EXP_CACHE_KEY, String(Date.now() + 2 * 60 * 60 * 1000));
  setInStorage(LEVEL_CACHE_KEY, String(currentLevel ?? ""));
}

function readCachedToken() {
  const token = getFromStorage(TOKEN_CACHE_KEY, null);
  const expRaw = getFromStorage(TOKEN_EXP_CACHE_KEY, null);
  const exp = expRaw ? Number(expRaw) : 0;
  if (!token || !exp || Date.now() > exp - REFRESH_MARGIN_MS) return null;
  return token;
}

/**
 * Returns a valid user JWT, minting/refreshing it via /api/user-profile/identify
 * if the cached one is missing or near expiry. Returns null if the request
 * fails (offline, server error) — callers should treat that as "no
 * platform-key access available right now", not throw.
 */
export async function getUserToken() {
  const cached = readCachedToken();
  if (cached) return cached;

  const deviceId = getOrCreateDeviceId();
  try {
    const res = await fetch("/api/user-profile/identify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId }),
    });
    if (!res.ok) return null;

    const data = await res.json();
    cacheToken(data.token, data.currentLevel);
    return data.token;
  } catch (err) {
    console.error("[userLevel] identify request failed:", err);
    return null;
  }
}

/**
 * Best-effort read of the last-known level without hitting the network —
 * useful for UI hints ("أنت في المستوى 7"). May be stale; getUserToken()
 * is the source of truth for anything security-relevant.
 */
export function getCachedLevel() {
  const raw = getFromStorage(LEVEL_CACHE_KEY, null);
  return raw ? Number(raw) : null;
}

/**
 * Call after a quiz result is shown to advance the user's server-side
 * progress (and therefore level). Safe to call even if the user has never
 * been identified before — it will mint an identity first.
 *
 * NOT YET WIRED UP to result.html/quiz.js — this is the integration point
 * for that follow-up work. Calling it manually already works end-to-end.
 *
 * @param {{ passed: boolean }} outcome
 * @returns {Promise<number|null>} the updated level, or null on failure
 */
export async function reportQuizResult({ passed }) {
  const token = await getUserToken();
  if (!token) return null;

  try {
    const res = await fetch("/api/user-profile/sync-progress", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ passed: !!passed }),
    });
    if (!res.ok) return null;

    const data = await res.json();
    cacheToken(data.token, data.currentLevel);
    return data.currentLevel;
  } catch (err) {
    console.error("[userLevel] sync-progress request failed:", err);
    return null;
  }
}
