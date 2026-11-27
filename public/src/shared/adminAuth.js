// =============================================================================
// public/src/shared/adminAuth.js
//
// WHY sessionStorage (not pure memory):
//   The original design stored the JWT only in a JS module variable.
//   sessionStorage survives same-tab navigation, is automatically cleared
//   when the tab closes, and cannot be read from other tabs or origins.
//   Real security still lives on the server — every request is re-validated
//   cryptographically regardless of what sessionStorage holds.
// =============================================================================

import { ensureSharedSupabaseClient } from "./supabaseClientRegistry.js";

const SESSION_KEY = "__bq_adm"; // intentionally opaque key name

// Renew the admin JWT once it is this old, checking at this interval.
const RENEW_AFTER_MS = 60 * 60 * 1000;
const RENEW_CHECK_MS = 10 * 60 * 1000;

// ── Restore token on module load ─────────────────────────────────────────────
// Runs once when this module is first imported on any page.
let _token = null;

(function restoreFromSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw || raw === "null" || raw === "undefined") return;
    // Sanity-check: a JWT is exactly 3 base64url segments separated by dots
    if (/^[\w\-]+\.[\w\-]+\.[\w\-]+$/.test(raw)) {
      _token = raw;
    } else {
      sessionStorage.removeItem(SESSION_KEY); // corrupt — discard
    }
  } catch (_) {
    // sessionStorage blocked in some browsers/modes — degrade gracefully
  }
})();

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Authenticates with the server using the given Admin ID.
 *
 * @param {string} adminId
 * @throws {Error} with Arabic message on failure
 */
export async function signIn(adminId) {
  let res;
  try {
    res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adminId }),
    });
  } catch (networkErr) {
    throw new Error("تعذّر الاتصال بالخادم. تحقق من اتصالك بالإنترنت.");
  }

  let body = {};
  try {
    body = await res.json();
  } catch (_) { }

  if (!res.ok) {
    throw new Error(body.error || "فشل تسجيل الدخول");
  }

  const { token } = body;
  if (!token || typeof token !== "string") {
    throw new Error("استجابة غير متوقعة من الخادم");
  }

  _token = token;
  try {
    sessionStorage.setItem(SESSION_KEY, token);
  } catch (_) { }
}

/**
 * Authenticates with the server using a Supabase access token.
 * On success the JWT is stored in sessionStorage.
 *
 * @param {string} supabaseToken
 * @returns {boolean} true if successful, false otherwise
 */
export async function signInWithSupabase(supabaseToken) {
  return (await exchangeSupabaseToken(supabaseToken)) === "ok";
}

/**
 * Like signInWithSupabase(), but tells a real rejection apart from a failure
 * that may succeed later (offline, server error, expired Supabase token).
 *
 * @param {string} supabaseToken
 * @param {() => boolean} [isStale] - if it returns true once the server has
 *   answered, the new token is discarded
 * @returns {Promise<"ok"|"forbidden"|"error">} "forbidden" = not an admin
 */
export async function exchangeSupabaseToken(supabaseToken, isStale) {
  let res;
  try {
    res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ supabaseToken }),
    });
  } catch (networkErr) {
    console.error("Network error authenticating with Supabase token");
    return "error";
  }

  let body = {};
  try {
    body = await res.json();
  } catch (_) { }

  if (!res.ok) {
    console.warn(body.error || "Failed to authenticate as admin via Supabase");
    return res.status === 403 ? "forbidden" : "error";
  }

  const { token } = body;
  if (!token || typeof token !== "string" || isStale?.()) {
    return "error";
  }

  _token = token;
  try {
    sessionStorage.setItem(SESSION_KEY, token);
  } catch (_) { }
  return "ok";
}

// ── Silent renewal ───────────────────────────────────────────────────────────

let _renewal = null; // in-flight renewal, shared by concurrent callers

/**
 * Replaces the current admin JWT with a fresh one, using the long-lived
 * Supabase session. Does nothing when not signed in. A temporary failure keeps
 * the current token; only a server "not an admin" answer clears it.
 *
 * @param {object} [options]
 * @param {boolean} [options.force] - renew even if the token is still recent
 * @returns {Promise<void>}
 */
export function renewAdminToken({ force = false } = {}) {
  const current = getToken();
  if (!current || (!force && !isDueForRenewal(current))) {
    return Promise.resolve();
  }
  if (_renewal) return _renewal;

  // True after a sign-out (or another sign-in) while we were waiting.
  const isStale = () => getToken() !== current;

  _renewal = (async () => {
    try {
      const client = await ensureSharedSupabaseClient();
      if (!client) return;
      // getSession() refreshes an expired Supabase access token itself.
      const { data } = await client.auth.getSession();
      const accessToken = data?.session?.access_token;
      if (!accessToken || isStale()) return;
      const status = await exchangeSupabaseToken(accessToken, isStale);
      if (status === "forbidden" && !isStale()) signOut(); // admin access removed
    } catch (err) {
      console.warn("Could not renew the admin session:", err);
    } finally {
      _renewal = null;
    }
  })();
  return _renewal;
}

function isDueForRenewal(token) {
  try {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const { iat } = JSON.parse(atob(part));
    return !iat || Date.now() - iat * 1000 >= RENEW_AFTER_MS;
  } catch (_) {
    return true;
  }
}

/**
 * Returns the current JWT or null if not authenticated.
 * Always checks sessionStorage as a fallback in case the module
 * was re-imported after navigation.
 * @returns {string|null}
 */
export function getToken() {
  if (_token) return _token;
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (raw && raw !== "null") {
      _token = raw;
      return raw;
    }
  } catch (_) { }
  return null;
}

/**
 * Returns true if a token is available (in memory or sessionStorage).
 * NOT a security check — server validates on every request.
 * @returns {boolean}
 */
export function isAdminAuthenticated() {
  return !!getToken();
}

/**
 * Decodes the JWT payload to extract role and owner status.
 * @returns {{ role: string, isOwner: boolean, id: string|null } | null}
 */
export function getAdminRoleInfo() {
  const token = getToken();
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return {
      role: payload.role,
      isOwner: !!payload.isOwner,
      email: payload.email,
      handle: payload.handle,
      allowed_scopes: payload.allowed_scopes || [],
      // admin_users.id (uuid) — matches folders/courses.created_by. See
      // api/auth.js's jwt.sign() call for why this was added.
      id: payload.id || null,
    };
  } catch (err) {
    return null;
  }
}

/** Clears token from memory and sessionStorage. */
export function signOut() {
  _token = null;
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch (_) { }
}

/**
 * Full sign-out (this browser only): clears the local admin JWT (sessionStorage) AND, if a
 * Supabase client is provided, ends the underlying Supabase session too.
 *
 * WHY THIS EXISTS:
 *   signIn() via email/OTP or SSO creates a Supabase session that Supabase
 *   itself persists in localStorage (survives tab close + browser restart).
 *   Plain signOut() only ever cleared OUR sessionStorage-based JWT, so the
 *   Supabase session kept living underneath — sign-in would find it
 *   on next load and silently re-authenticate ("logout loop" / "ghost
 *   session" bugs). Always prefer this over calling signOut() directly on
 *   any page that has access to a Supabase client instance.
 *
 * @param {object|null} supabaseClient - initialized Supabase client, or null
 */
export async function fullSignOut(supabaseClient) {
  if (supabaseClient) {
    try {
      // "local": the default ("global") would also end this admin's sessions
      // on every other device.
      await supabaseClient.auth.signOut({ scope: "local" });
    } catch (err) {
      console.error("Error signing out of Supabase:", err);
    }
  }
  signOut();
}

/**
 * Alias kept for backwards-compatibility with index.js imports.
 * isAdminAuthenticated() already covers this — both check the same token.
 * @returns {boolean}
 */
export function hasAdminSessionHint() {
  return isAdminAuthenticated();
}

// ── Keep the session alive on every page that uses this module ───────────────
// (Real browsers only: not workers or test stubs.)
if (typeof document !== "undefined" && typeof document.visibilityState === "string") {
  const renew = () => { renewAdminToken(); };
  setTimeout(renew, 0);
  setInterval(renew, RENEW_CHECK_MS);
  window.addEventListener("online", renew);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") renew();
  });
}
