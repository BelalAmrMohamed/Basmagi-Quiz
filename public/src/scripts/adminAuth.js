// =============================================================================
// public/src/scripts/adminAuth.js
//
// WHY sessionStorage (not pure memory):
//   The original design stored the JWT only in a JS module variable.
//   sessionStorage survives same-tab navigation, is automatically cleared
//   when the tab closes, and cannot be read from other tabs or origins.
//   Real security still lives on the server — every request is re-validated
//   cryptographically regardless of what sessionStorage holds.
// =============================================================================

const SESSION_KEY = "__bq_adm"; // intentionally opaque key name

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
  } catch (_) {}

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
  } catch (_) {}
}

/**
 * Authenticates with the server using a Supabase access token.
 * On success the JWT is stored in sessionStorage.
 *
 * @param {string} supabaseToken
 * @returns {boolean} true if successful, false otherwise
 */
export async function signInWithSupabase(supabaseToken) {
  let res;
  try {
    res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ supabaseToken }),
    });
  } catch (networkErr) {
    console.error("Network error authenticating with Supabase token");
    return false;
  }

  let body = {};
  try {
    body = await res.json();
  } catch (_) {}

  if (!res.ok) {
    console.warn(body.error || "Failed to authenticate as admin via Supabase");
    return false;
  }

  const { token } = body;
  if (!token || typeof token !== "string") {
    return false;
  }

  _token = token;
  try {
    sessionStorage.setItem(SESSION_KEY, token);
  } catch (_) {}
  return true;
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
  } catch (_) {}
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
 * @returns {{ role: string, isOwner: boolean } | null}
 */
export function getAdminRoleInfo() {
  const token = getToken();
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return {
      role: payload.role,
      isOwner: !!payload.isOwner
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
  } catch (_) {}
}

/**
 * Full sign-out: clears the local admin JWT (sessionStorage) AND, if a
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
      await supabaseClient.auth.signOut();
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