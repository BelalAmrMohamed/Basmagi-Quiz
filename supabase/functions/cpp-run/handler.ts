// Request handler for cpp-run. Kept free of Deno globals (everything environment-specific is
// injected through `Deps`) so Node tests can drive it with fake providers and quota.
import { assemble, splitSections, validRunRequest, truncateOutput, truncateSections } from './assemble.js';
import { LIMITS, ProvidersFailed } from './providers.ts';

const DEFAULT_ORIGINS = ['https://basmagi.vercel.app', 'http://localhost:8080', 'http://localhost:8081'];

export type Deps = {
  env: (key: string) => string | undefined;
  hitQuota: (key: string, limit: number, windowSeconds: number) => Promise<boolean>;
  runProviders: (code: string, stdin: string, signal: AbortSignal, token: string) => Promise<any>;
  totalMs?: number;
};

const json = (body: unknown, status: number, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

async function hash(s: string) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  const configured = (deps.env('ALLOWED_ORIGINS') || DEFAULT_ORIGINS.join(',')).split(',').map((x) => x.trim());
  const origin = req.headers.get('origin') || '';
  const cors = {
    'access-control-allow-origin': configured.includes(origin) ? origin : configured[0],
    'access-control-allow-headers': 'authorization, apikey, content-type',
    'access-control-allow-methods': 'POST, OPTIONS',
    vary: 'Origin',
  };
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.', kind: 'bad_request' }, 405, cors);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'Request body is not valid JSON.', kind: 'bad_request' }, 400, cors); }
  try {
    if (!validRunRequest(body)) return json({ error: 'Request exceeds C++ run limits.', kind: 'too_large' }, 413, cors);
    const cells = body.cells;
    if (body.target !== 'all' && (!Number.isInteger(body.target) || body.target < 0 || body.target >= cells.length)) {
      return json({ error: 'Invalid target cell.', kind: 'bad_request' }, 400, cors);
    }

    // Our own per-IP / global quota. Failures here are reported as such, never as a compiler problem.
    const ip = (req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim();
    const salt = deps.env('IP_SALT') || deps.env('SUPABASE_SERVICE_ROLE_KEY');
    if (!salt) return json({ error: 'Compiler quota hashing is not configured. Set IP_SALT or SUPABASE_SERVICE_ROLE_KEY.', kind: 'config' }, 503, cors);
    const h = await hash(`${salt}:${ip}`);
    let checks: boolean[];
    try {
      checks = await Promise.all([[h, 20, 60], [h, 300, 86400], ['*', 4000, 86400]].map(([k, l, w]) => deps.hitQuota(k as string, l as number, w as number)));
    } catch {
      return json({ error: 'The run-quota service is unavailable (not a compiler problem). Please retry shortly.', kind: 'quota_unavailable' }, 503, cors);
    }
    if (checks.some((x) => !x)) {
      return json({ error: 'Run limit reached for this network (20 runs per minute, 300 per day). Please wait a minute and retry.', kind: 'quota' }, 429, { ...cors, 'retry-after': '60' });
    }

    const target = body.target;
    const program = assemble(cells, target);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), deps.totalMs ?? LIMITS.totalMs);
    const started = Date.now();
    try {
      const result = await deps.runProviders(program, cells.map((c: any) => c.stdin || '').join('\n'), ctl.signal, deps.env('PISTON_TOKEN') || '');
      const sections = result.ok ? splitSections(result.stdout, result.stderr, cells.length, target === 'all' ? 'all' : target) : [];
      const compile = truncateOutput(result.compile), capped = truncateSections(sections);
      return json({
        ok: result.ok, compile: compile.text, sections: capped.sections, exit: result.exit, signal: result.signal,
        timeMs: Date.now() - started, truncated: compile.truncated || capped.truncated, provider: result.provider,
      }, 200, cors);
    } finally {
      clearTimeout(timer);
    }
  } catch (e: any) {
    if (e instanceof ProvidersFailed) {
      return json({ error: e.message, kind: e.kind, attempts: e.attempts }, e.kind === 'timeout' ? 504 : 502, cors);
    }
    return json({ error: `Unexpected error in the compile service: ${String(e?.message || e).slice(0, 160)}`, kind: 'internal' }, 500, cors);
  }
}
