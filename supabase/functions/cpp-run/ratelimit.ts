// Quota counter backed by the cpp_run_hit RPC. The request is time-boxed so a slow database
// can never hang a compile request.
export async function hitQuota(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const url = Deno.env.get('SUPABASE_URL'), secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const r = await fetch(`${url}/rest/v1/rpc/cpp_run_hit`, {
    method: 'POST',
    headers: { apikey: secret!, authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
    body: JSON.stringify({ p_key: key, p_limit: limit, p_window_s: windowSeconds }),
    signal: AbortSignal.timeout(3000),
  });
  if (!r.ok) throw new Error('quota service unavailable');
  return await r.json();
}
