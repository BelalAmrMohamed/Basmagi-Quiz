// Single place that reads the Supabase environment for api/*.
//
// Why: a missing SUPABASE_URL made `createClient` throw "supabaseUrl is
// required" at import time or inside a handler, and `vercel dev` exited.
// Now clients are created lazily and a missing variable becomes a readable
// 503 that names the variable (see `envGuard`). The service key is read from
// SUPABASE_SERVICE_KEY, with SUPABASE_SERVICE_ROLE_KEY as an accepted alias.
import { createClient } from "@supabase/supabase-js";

export function serviceKey() {
  return process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
}

export function missingEnv(kind = "service") {
  const out = [];
  if (!process.env.SUPABASE_URL) out.push("SUPABASE_URL");
  if (kind === "anon" && !process.env.SUPABASE_ANON_KEY) out.push("SUPABASE_ANON_KEY");
  if (kind === "service" && !serviceKey()) out.push("SUPABASE_SERVICE_KEY");
  return out;
}

// Returns true (and answers 503) when something is missing.
export function envGuard(res, kinds = ["service"], extra = []) {
  const miss = [...new Set([...kinds.flatMap((k) => missingEnv(k)), ...extra.filter((n) => !process.env[n])])];
  if (!miss.length) return false;
  console.error("[env] missing:", miss.join(", "));
  res.status(503).json({
    error: "Server is not configured: missing " + miss.join(", "),
    missing: miss,
  });
  return true;
}

// Lazy client: built on first use, so importing a module never throws.
export function makeClient(kind = "service", options) {
  let client = null;
  const get = () => {
    if (client) return client;
    const miss = missingEnv(kind);
    if (miss.length) throw new Error("Missing environment variable(s): " + miss.join(", "));
    client = createClient(
      process.env.SUPABASE_URL,
      kind === "anon" ? process.env.SUPABASE_ANON_KEY : serviceKey(),
      options,
    );
    return client;
  };
  return new Proxy({}, {
    get(_t, prop) {
      const c = get();
      const v = c[prop];
      return typeof v === "function" ? v.bind(c) : v;
    },
  });
}
