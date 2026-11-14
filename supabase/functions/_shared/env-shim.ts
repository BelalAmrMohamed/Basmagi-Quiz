// Imported FIRST by every generated edge function so env aliases exist before
// any module-level code (e.g. createClient(process.env.SUPABASE_URL, ...)) runs.
// Vercel names -> Supabase-provided names.
import process from "node:process";
const alias = (to: string, from: string) => {
  if (!process.env[to] && Deno.env.get(from)) process.env[to] = Deno.env.get(from);
};
alias("SUPABASE_SERVICE_KEY", "SUPABASE_SERVICE_ROLE_KEY");
alias("SUPABASE_URL", "SUPABASE_URL");
alias("SUPABASE_ANON_KEY", "SUPABASE_ANON_KEY");
