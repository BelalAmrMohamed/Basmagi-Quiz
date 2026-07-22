// ============================================================================
// public/src/features/home/session-sync.js
// SUPABASE SESSION SYNC (index.html side)
// ============================================================================
// WHY THIS EXISTS:
//   index.html previously only ever checked isAdminAuthenticated(), which
//   reads a sessionStorage-scoped JWT. Supabase itself keeps a SEPARATE,
//   longer-lived session in localStorage. sign-in already checked that —
//   index.html never did — so the two pages could disagree about whether
//   the user was logged in ("ghost session" bug). This mirrors that same
//   check here so both pages agree on the same source of truth.
// ============================================================================

import {
  isAdminAuthenticated,
  signInWithSupabase,
  fullSignOut,
} from "../../shared/adminAuth.js";
import { setIndexSupabaseClient } from "./app-state.js";

export async function syncAdminSessionWithSupabase() {
  try {
    const res = await fetch("/api/env");
    const data = await res.json();
    if (!data.supabaseUrl || !data.supabaseAnonKey) return;

    const client = window.supabase.createClient(
      data.supabaseUrl,
      data.supabaseAnonKey,
    );
    setIndexSupabaseClient(client);

    const {
      data: { session },
    } = await client.auth.getSession();

    if (session && !isAdminAuthenticated()) {
      // Supabase still has a live session but our local admin JWT is gone
      // (e.g. new tab / browser restart wiped sessionStorage) — re-derive
      // the admin JWT from the existing Supabase session instead of
      // silently showing "logged out" while sign-in would show
      // "logged in".
      const ok = await signInWithSupabase(session.access_token);
      if (ok) {
        // Admin-dependent UI is rendered across several view functions
        // rather than one central place — full reload is the reliable way
        // to make every view reflect the corrected auth state.
        window.location.reload();
      } else {
        // ── Non-admin rejection ───────────────────────────────────────────────
        // /api/auth returned 403 — this user is authenticated with Supabase
        // but is NOT an admin. Without explicitly destroying the Supabase
        // session here, this function would be called again on the next
        // interaction, get 403 again, call fullSignOut(), reload, and loop
        // forever.
        //
        // Fix: show the user a clear rejection message FIRST, then destroy
        // the Supabase session so this branch never triggers again for this
        // non-admin account. Do NOT reload — the page renders fine without
        // admin features and the sign-in dialog will show the error.
        alert("أنت لست من مشرفين المنصة. تم رفض الوصول.");
        await fullSignOut(client);
        // Also clear any Supabase localStorage keys for belt-and-suspenders
        try {
          Object.keys(localStorage)
            .filter((k) => k.startsWith("sb-") && k.endsWith("-auth-token"))
            .forEach((k) => localStorage.removeItem(k));
        } catch (_) {}
        // No reload needed — page renders correctly without admin mode.
      }
    } else if (!session && isAdminAuthenticated()) {
      // Local admin JWT still exists but Supabase's own session is gone
      // (e.g. it expired, or was revoked elsewhere) — don't keep showing
      // an authenticated admin UI based on stale local state.
      fullSignOut(null); // no supabaseClient.auth.signOut() needed, already gone
      window.location.reload();
    }
  } catch (err) {
    console.error("Failed to sync admin session with Supabase:", err);
  }
}
