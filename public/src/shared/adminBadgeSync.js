// ============================================================================
// public/src/shared/adminBadgeSync.js
// SHARED ADMIN SESSION SYNC — page-agnostic Supabase↔admin-JWT recovery
// ============================================================================
// WHY THIS EXISTS:
//   session-sync.js's syncAdminSessionWithSupabase() was written for
//   index.html only, and its fix-up path for "Supabase has a live session
//   but our local admin JWT is gone" ended in a hard window.location.reload().
//   That reload was tolerable on the home page (it's the only place that ran
//   this check), but two problems remain once every page needs the same
//   guarantee (see fix.pdf's acceptance criteria):
//
//     1. A full reload on every page that mounts this logic re-introduces
//        the exact "loads once, then reloads ~1s later" symptom the ticket
//        wants eliminated — just relocated from index.html to five pages
//        instead of one.
//     2. Five copies of the same fetch("/api/env") + createClient() +
//        getSession() + signInWithSupabase() dance is a maintenance hazard.
//
//   This module factors that recovery logic out into one page-agnostic
//   function, reusing the already-generic ensureSharedSupabaseClient() for
//   the "fetch env → create client" bootstrap (see supabaseClientRegistry.js)
//   instead of duplicating it. Its success path calls an in-place UI refresh
//   callback instead of reloading the page.
//
// WHEN THIS RUNS:
//   Only needed for the edge case where sessionStorage doesn't already have
//   an admin JWT for this tab (e.g. a fresh tab / bookmark / browser
//   restart) but Supabase still has a live, longer-lived session in
//   localStorage. If a JWT already exists in sessionStorage (e.g. same-tab
//   navigation from a page the user signed in on), the inline pre-paint
//   badge-injection scripts in each HTML file already render the badge
//   synchronously and correctly — this module has nothing to do in that
//   case and exits immediately.
// ============================================================================

import {
  isAdminAuthenticated,
  signInWithSupabase,
  fullSignOut,
} from "./adminAuth.js";
import { ensureSharedSupabaseClient } from "./supabaseClientRegistry.js";
import { _alert } from "../components/notifications/notifications.js";

/**
 * Reconciles local admin auth state with the live Supabase session, without
 * ever forcing a full page reload. Safe to call on every page that renders
 * the side-menu profile dropdown (profile, settings, result, create-quiz)
 * as well as the home page.
 *
 * @param {object} [options]
 * @param {() => void} [options.onRecovered] - called after a Supabase-only
 *   session is successfully re-derived into a local admin JWT. Callers
 *   should use this to re-render admin-dependent UI in place (badge,
 *   dropdown, upload buttons, etc.) instead of reloading.
 * @param {() => void} [options.onSignedOut] - called after this function
 *   determines the user is NOT actually an admin (rejected) or the admin
 *   session has gone stale, and has cleared local state accordingly. Callers
 *   should use this to make sure admin-dependent UI is hidden.
 * @returns {Promise<import("./supabaseClientRegistry.js").SupabaseClient|null>}
 *   the Supabase client used for the check, so callers that also need to
 *   register it as their page's "owned" client (see app-state.js) can do so
 *   without creating a second client instance.
 */
export async function syncAdminSession({ onRecovered, onSignedOut } = {}) {
  const client = await ensureSharedSupabaseClient();
  if (!client) return null;

  try {
    const {
      data: { session },
    } = await client.auth.getSession();

    if (session && !isAdminAuthenticated()) {
      // Supabase still has a live session but our local admin JWT is gone
      // (e.g. new tab / browser restart wiped sessionStorage) — re-derive
      // the admin JWT from the existing Supabase session instead of
      // silently showing "logged out" while another tab/page would show
      // "logged in".
      const ok = await signInWithSupabase(session.access_token);
      if (ok) {
        if (typeof onRecovered === "function") onRecovered();
      } else {
        // ── Non-admin rejection ─────────────────────────────────────────
        // /api/auth returned 403 — this user is authenticated with Supabase
        // but is NOT an admin. Without explicitly destroying the Supabase
        // session here, this function would be called again on the next
        // page load, get 403 again, and loop forever.
        _alert("أنت لست من مشرفين المنصة. تم رفض الوصول.");
        await fullSignOut(client);
        // Belt-and-suspenders: also clear any Supabase localStorage keys.
        try {
          Object.keys(localStorage)
            .filter((k) => k.startsWith("sb-") && k.endsWith("-auth-token"))
            .forEach((k) => localStorage.removeItem(k));
        } catch (_) {}
        if (typeof onSignedOut === "function") onSignedOut();
      }
    } else if (!session && isAdminAuthenticated()) {
      // Local admin JWT still exists but Supabase's own session is gone
      // (e.g. it expired, or was revoked elsewhere) — don't keep showing
      // an authenticated admin UI based on stale local state.
      fullSignOut(null); // no supabaseClient.auth.signOut() needed, already gone
      if (typeof onSignedOut === "function") onSignedOut();
    }
  } catch (err) {
    console.error("Failed to sync admin session with Supabase:", err);
  }

  return client;
}
