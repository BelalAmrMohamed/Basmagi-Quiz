// Imported FIRST by every generated edge function so env aliases exist before
// any module-level code (e.g. createClient(process.env.SUPABASE_URL, ...)) runs.
// Vercel names -> Supabase-provided names.
import process from "node:process";
const alias = (to: string, from: string) => {
  if (process.env[to]) return;
  const value = Deno.env.get(from);
  if (!value) return;
  try {
    process.env[to] = value;
  } catch {
    // Some edge runtimes (supabase-edge-runtime 1.79+) refuse process.env writes with
    // NotSupported, which used to crash the worker at module load. The alias is only a
    // convenience; code that needs the name can read Deno.env directly.
  }
};
alias("SUPABASE_SERVICE_KEY", "SUPABASE_SERVICE_ROLE_KEY");
alias("SUPABASE_URL", "SUPABASE_URL");
alias("SUPABASE_ANON_KEY", "SUPABASE_ANON_KEY");
