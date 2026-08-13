// ============================================================================
// public/src/features/home/session-sync.js
// SUPABASE SESSION SYNC (index.html side)
// ============================================================================
// WHY THIS EXISTS:
//   index.html needs to (a) create/own the Supabase client for the home page
//   module graph (via app-state.js's setIndexSupabaseClient, which also
//   populates the shared cross-page registry — see supabaseClientRegistry.js)
//   and (b) reconcile local admin state with any live Supabase session.
//
//   The actual reconciliation logic now lives in the shared, page-agnostic
//   adminBadgeSync.js so every page gets the same guarantee (see fix.pdf).
//   This module is a thin wrapper: it registers the home page's client, then
//   delegates to syncAdminSession() and re-renders in place on recovery
//   instead of reloading — a full reload was the double-load symptom this
//   fix ticket exists to remove.
// ============================================================================

import { setIndexSupabaseClient } from "./app-state.js";
import { syncAdminSession } from "../../shared/adminBadgeSync.js";
import { refreshAdminUI } from "../../components/side-menu/side-menu.js";

export async function syncAdminSessionWithSupabase() {
  const client = await syncAdminSession({
    onRecovered: () => {
      // Admin-dependent UI is rendered across several view functions rather
      // than one central place, so refreshAdminUI() re-runs the same badge
      // injection the inline pre-paint script does, plus re-populates the
      // side-menu dropdown if it's already been built — no reload needed.
      refreshAdminUI();
    },
    onSignedOut: () => {
      refreshAdminUI();
    },
  });

  if (client) {
    // Home page continues to "own" the client via app-state.js — this also
    // populates the shared registry so other components (side-menu, etc.)
    // can reach it without depending on the home page's module graph.
    setIndexSupabaseClient(client);
  }
}