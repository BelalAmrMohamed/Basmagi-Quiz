// ============================================================================
// public/src/shared/supabaseClientRegistry.js
// SHARED SUPABASE CLIENT REGISTRY — cross-page singleton
// ============================================================================
// Same get/set singleton pattern as app-state.js, but app-state.js is scoped
// to the home page's module graph only. Components that render on every page
// (e.g. the side-menu's profile dropdown, which needs a Supabase client to
// call fullSignOut()) need a registry that isn't tied to one page's bundle.
//
// The home page continues to own the "real" client via app-state.js's
// getIndexSupabaseClient()/setIndexSupabaseClient() — those setters also
// populate this registry (see app-state.js), so no page's existing call
// sites need to change. Any other page that creates/has access to a
// Supabase client instance can register it here too, and any component
// (side-menu, etc.) can read whichever one was last set.

let sharedSupabaseClient = null;

export function getSharedSupabaseClient() {
  return sharedSupabaseClient;
}

export async function ensureSharedSupabaseClient() {
  if (sharedSupabaseClient) return sharedSupabaseClient;
  if (typeof window !== "undefined" && window.supabase) {
    try {
      const { SUPABASE_URL, SUPABASE_ANON_KEY } = await import("./public-config.js");
      if (SUPABASE_URL && SUPABASE_ANON_KEY) {
        sharedSupabaseClient = window.supabase.createClient(
          SUPABASE_URL,
          SUPABASE_ANON_KEY,
        );
      }
    } catch (err) {
      console.error("Unable to initialize shared Supabase client:", err);
    }
  }
  return sharedSupabaseClient;
}

export function setSharedSupabaseClient(client) {
  sharedSupabaseClient = client;
}