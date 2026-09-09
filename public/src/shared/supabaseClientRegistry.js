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
// In-flight creation promise — see ensureSharedSupabaseClient() below for
// why this exists separately from sharedSupabaseClient itself.
let creationPromise = null;

export function getSharedSupabaseClient() {
  return sharedSupabaseClient;
}

export async function ensureSharedSupabaseClient() {
  if (sharedSupabaseClient) return sharedSupabaseClient;

  // BUG FIX: the previous version only memoized the *resolved* client,
  // checked synchronously at the top of this function. But this function
  // is async and awaits an import() before ever assigning
  // sharedSupabaseClient — so two callers invoked back-to-back before that
  // await resolves (e.g. session-sync.js's syncAdminSessionWithSupabase()
  // and quizManifest.js's fetchDbManifest(), which both fire near page
  // load on index.html) BOTH pass the `if (sharedSupabaseClient)` guard
  // while it's still null, and BOTH call window.supabase.createClient(),
  // producing two independent GoTrueClient instances fighting over the
  // same "sb-...-auth-token" localStorage key. Memoizing the in-flight
  // Promise itself (not just its eventual result) closes that window:
  // every concurrent caller awaits the exact same createClient() call.
  if (creationPromise) return creationPromise;

  creationPromise = (async () => {
    if (typeof window !== "undefined" && window.supabase) {
      try {
        const { SUPABASE_URL, SUPABASE_ANON_KEY } = await import("./public-config.js");
        if (SUPABASE_URL && SUPABASE_ANON_KEY) {
          // autoRefreshToken disabled, persistSession left ON:
          //  - persistSession must stay true — sign-in.js's OAuth/OTP flow
          //    and oauth-callback.html both rely on this same shared client
          //    writing its session to localStorage, and adminBadgeSync.js's
          //    syncAdminSession() cross-tab recovery reads that persisted
          //    session back via getSession(). Disabling persistSession would
          //    silently break sign-in and recovery, not just the outage case.
          //  - autoRefreshToken is what actually caused the incident: on
          //    every page load supabase-js starts a background timer that
          //    proactively POSTs /auth/v1/token?grant_type=refresh_token for
          //    any stored session, on every page, whether or not that page
          //    has any active auth UI. During the Supabase outage those
          //    requests just accumulated 504s and unhandled-rejection noise.
          //    Turning it off removes the automatic timer; a session is
          //    still refreshed on demand the next time something calls
          //    getSession()/signIn(), which happens explicitly and rarely
          //    enough not to matter.
          sharedSupabaseClient = window.supabase.createClient(
            SUPABASE_URL,
            SUPABASE_ANON_KEY,
            {
              auth: {
                autoRefreshToken: false,
                persistSession: true,
              },
            },
          );
        }
      } catch (err) {
        console.error("Unable to initialize shared Supabase client:", err);
      }
    }
    return sharedSupabaseClient;
  })();

  return creationPromise;
}

export function setSharedSupabaseClient(client) {
  sharedSupabaseClient = client;
  // A client set explicitly (e.g. index.html's session-sync handing over
  // the client it already resolved via syncAdminSession) satisfies any
  // callers still awaiting an in-flight ensureSharedSupabaseClient() call
  // from this point forward too, since sharedSupabaseClient is now set —
  // but if creationPromise never got started, make sure a later
  // ensureSharedSupabaseClient() call doesn't attempt a redundant create.
  if (!creationPromise) {
    creationPromise = Promise.resolve(client);
  }
}