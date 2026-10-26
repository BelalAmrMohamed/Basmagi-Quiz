// ============================================================================
// SHARED SUPABASE CLIENT REGISTRY — cross-page singleton
// ============================================================================

let sharedSupabaseClient = null;
let creationPromise = null;
let sdkLoadPromise = null;

function loadSupabaseSdk() {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (window.supabase?.createClient) return Promise.resolve(window.supabase);
  if (sdkLoadPromise) return sdkLoadPromise;

  const sources = [
    "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2",
    "https://unpkg.com/@supabase/supabase-js@2",
  ];
  sdkLoadPromise = (async () => {
    for (const src of sources) {
      try {
        await new Promise((resolve, reject) => {
          const script = document.createElement("script");
          const timeout = setTimeout(() => {
            script.remove();
            reject(new Error("Supabase SDK load timed out"));
          }, 7000);
          script.src = src;
          script.async = true;
          script.dataset.supabaseSdkFallback = "true";
          script.onload = () => {
            clearTimeout(timeout);
            if (window.supabase?.createClient) resolve();
            else reject(new Error("Supabase SDK loaded without its browser client"));
          };
          script.onerror = () => {
            clearTimeout(timeout);
            script.remove();
            reject(new Error(`Could not load Supabase SDK from ${new URL(src).hostname}`));
          };
          document.head.appendChild(script);
        });
        if (window.supabase?.createClient) return window.supabase;
      } catch (error) {
        console.warn("Supabase SDK source failed:", error.message);
      }
    }
    return null;
  })().finally(() => {
    if (!window.supabase?.createClient) sdkLoadPromise = null;
  });
  return sdkLoadPromise;
}

export function getSharedSupabaseClient() {
  return sharedSupabaseClient;
}

export async function ensureSharedSupabaseClient() {
  if (sharedSupabaseClient) return sharedSupabaseClient;
  if (creationPromise) return creationPromise;

  const attempt = (async () => {
    try {
      const sdk = await loadSupabaseSdk();
      if (!sdk) return null;
      const { SUPABASE_URL, SUPABASE_ANON_KEY } = await import("./public-config.js");
      if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
        throw new Error("Supabase public configuration is missing");
      }
      // Persist sessions for OAuth/admin recovery, but avoid background
      // refresh requests that create noise during service outages.
      sharedSupabaseClient = sdk.createClient(
        SUPABASE_URL,
        SUPABASE_ANON_KEY,
        { auth: { autoRefreshToken: false, persistSession: true } },
      );
      return sharedSupabaseClient;
    } catch (error) {
      console.error("Unable to initialize shared Supabase client:", error);
      return null;
    }
  })();
  creationPromise = attempt;
  const client = await attempt;
  const resolvedClient = client || sharedSupabaseClient;
  if (!resolvedClient && creationPromise === attempt) creationPromise = null;
  return resolvedClient;
}

export function setSharedSupabaseClient(client) {
  sharedSupabaseClient = client;
  creationPromise = Promise.resolve(client);
}
