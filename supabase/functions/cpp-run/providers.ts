// Compiler providers for the cpp-run Edge Function.
//
// Design rules (each one fixes a failure mode seen in production):
//  * Every attempt owns its own timeout, so one hung provider cannot eat the whole budget
//    and Piston still gets its turn. The overall deadline (`signal`) is a hard cap on top.
//  * The Wandbox compiler list is NOT fetched on the request path. A blocked or slow
//    list.json used to consume the shared 20 s signal and surface as "compiler timed out".
//  * Failures are classified (timeout / rate_limit / http / network / bad_response) and
//    collected per provider, so the caller can tell the user exactly what failed.
//
// Keep this file erasable-TypeScript only (no enums / parameter properties) so Node's
// type stripping can import it in tests.

// Wandbox's compiler-option-raw field expects newline-separated flags.
// A space-delimited value reaches g++ as one malformed argv option.
const COMPILER_OPTION = '-std=c++17\n-Wall\n-Wextra\n-O1';
const DEFAULT_COMPILER = 'gcc-head';

export type FailureKind = 'timeout' | 'rate_limit' | 'http' | 'network' | 'bad_response';

export const LIMITS = {
  /** Hard cap for the whole request (the client gives up at 25 s). */
  totalMs: 20000,
  wandboxMs: 12000,
  pistonMs: 8000,
  listMs: 3000,
  /** A retry is only attempted if at least this much of the budget is left. */
  retryMinLeftMs: 3000,
  retryDelayMs: 300,
};

export type Limits = typeof LIMITS;

export type Attempt = { provider: string; kind: FailureKind | 'not_configured' | 'skipped'; status?: number; ms: number; detail?: string };

const label = (p: string) => (p === 'wandbox' ? 'Wandbox' : p === 'piston' ? 'Piston' : p);
const secs = (ms: number) => (ms / 1000).toFixed(1) + ' s';

export function describe(a: Attempt): string {
  const who = label(a.provider);
  switch (a.kind) {
    case 'timeout': return `${who}: timed out after ${secs(a.ms)}`;
    case 'rate_limit': return `${who}: rate limited (HTTP ${a.status ?? 429})`;
    case 'http': return `${who}: HTTP ${a.status ?? '?'} error${a.status === 401 || a.status === 403 ? ' (authorization rejected)' : ''}`;
    case 'network': return `${who}: network error${a.detail ? ` (${a.detail})` : ''}`;
    case 'bad_response': return `${who}: returned an unreadable response`;
    case 'not_configured': return `${who}: not configured (set PISTON_TOKEN)`;
    default: return `${who}: skipped (time budget used up)`;
  }
}

export function summarize(attempts: Attempt[]): string {
  // Collapse retries of the same provider into one phrase: "Wandbox: HTTP 503 error (2 tries)".
  const out: string[] = [];
  for (const provider of [...new Set(attempts.map((a) => a.provider))]) {
    const mine = attempts.filter((a) => a.provider === provider);
    out.push(describe(mine[mine.length - 1]) + (mine.length > 1 ? ` (${mine.length} tries)` : ''));
  }
  return out.join('; ') + '.';
}

export class ProviderError extends Error {
  provider: string;
  kind: FailureKind;
  status?: number;
  ms: number;
  detail?: string;
  constructor(provider: string, kind: FailureKind, ms: number, status?: number, detail?: string) {
    super(describe({ provider, kind, status, ms, detail }));
    this.name = 'ProviderError';
    this.provider = provider;
    this.kind = kind;
    this.status = status;
    this.ms = ms;
    this.detail = detail;
  }
}

/** Thrown when every provider failed. `attempts` has one entry per try, in order. */
export class ProvidersFailed extends Error {
  attempts: Attempt[];
  kind: FailureKind | 'not_configured';
  constructor(attempts: Attempt[]) {
    const real = attempts.filter((a) => a.kind !== 'not_configured' && a.kind !== 'skipped');
    super('Compiler unavailable. ' + summarize(attempts) + ' Please retry in a moment.');
    this.name = 'ProvidersFailed';
    this.attempts = attempts;
    this.kind = (real.length ? real[real.length - 1].kind : 'not_configured') as FailureKind | 'not_configured';
  }
}

function classify(provider: string, e: any, ms: number, aborted: boolean): ProviderError {
  if (e instanceof ProviderError) return e;
  if (aborted || e?.name === 'AbortError' || e?.name === 'TimeoutError') return new ProviderError(provider, 'timeout', ms);
  if (e instanceof SyntaxError) return new ProviderError(provider, 'bad_response', ms);
  return new ProviderError(provider, 'network', ms, undefined, String(e?.message || e).slice(0, 120));
}

const httpFailure = (provider: string, status: number, ms: number) =>
  new ProviderError(provider, status === 429 ? 'rate_limit' : 'http', ms, status);

/** Run `fn` with its own timeout; the overall `outer` signal can still cancel it. */
async function attempt<T>(provider: string, budgetMs: number, outer: AbortSignal, fn: (s: AbortSignal) => Promise<T>): Promise<T> {
  const started = Date.now();
  if (outer.aborted) throw new ProviderError(provider, 'timeout', 0);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), budgetMs);
  const onOuter = () => ctl.abort();
  outer.addEventListener('abort', onOuter);
  try {
    return await fn(ctl.signal);
  } catch (e) {
    throw classify(provider, e, Date.now() - started, ctl.signal.aborted);
  } finally {
    clearTimeout(timer);
    outer.removeEventListener('abort', onOuter);
  }
}

// ----------------------------------------------------------------------------- Wandbox

const compilerCache = { name: DEFAULT_COMPILER, nextCheck: 0, pending: false };

/**
 * Best-effort refresh of the newest GCC name. Never awaited by a request: the first request
 * after a cold start uses `gcc-head`, later ones use the refreshed name.
 */
function refreshCompilerInBackground(listMs: number): void {
  if (compilerCache.pending || Date.now() < compilerCache.nextCheck) return;
  compilerCache.pending = true;
  fetch('https://wandbox.org/api/list.json', { signal: AbortSignal.timeout(listMs) })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error('list ' + r.status))))
    .then((list: any[]) => {
      const gcc = list
        .filter((x) => /^gcc-\d/.test(x?.name || '') && /C\+\+/.test(x?.language || ''))
        .sort((a, b) => new Intl.Collator('en', { numeric: true }).compare(b.name, a.name));
      if (gcc[0]) compilerCache.name = gcc[0].name;
      compilerCache.nextCheck = Date.now() + 3600_000;
    })
    .catch(() => { compilerCache.nextCheck = Date.now() + 300_000; })
    .finally(() => { compilerCache.pending = false; });
}

export type RunOptions = { compiler?: string; limits?: Partial<Limits> };

export async function runWandbox(code: string, stdin: string, signal: AbortSignal, opts: RunOptions = {}) {
  const lim = { ...LIMITS, ...opts.limits };
  // WANDBOX_COMPILER (Edge Function secret) pins the compiler and disables the background list refresh.
  const pinned = opts.compiler || (globalThis as any).Deno?.env?.get?.('WANDBOX_COMPILER') || '';
  if (!pinned) refreshCompilerInBackground(lim.listMs);
  const compiler = pinned || compilerCache.name;
  return attempt('wandbox', lim.wandboxMs, signal, async (s) => {
    const started = Date.now();
    const r = await fetch('https://wandbox.org/api/compile.json', {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal: s,
      body: JSON.stringify({ compiler, code, 'compiler-option-raw': COMPILER_OPTION, stdin, save: false }),
    });
    if (!r.ok) throw httpFailure('wandbox', r.status, Date.now() - started);
    const j = await r.json();
    const diagnostic = [j.compiler_error, j.compiler_message].filter((x) => typeof x === 'string' && x).join('\n');
    return {
      provider: 'wandbox', ok: !j.compiler_error, compile: diagnostic,
      stdout: j.program_output || '', stderr: j.program_error || '',
      exit: j.status === '' || j.status == null ? 0 : Number(j.status), signal: j.signal || null,
    };
  });
}

// ----------------------------------------------------------------------------- Piston

export async function runPiston(code: string, stdin: string, signal: AbortSignal, token: string, opts: RunOptions = {}) {
  const lim = { ...LIMITS, ...opts.limits };
  return attempt('piston', lim.pistonMs, signal, async (s) => {
    const started = Date.now();
    const r = await fetch('https://emkc.org/api/v2/piston/execute', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, signal: s,
      body: JSON.stringify({ language: 'c++', version: '*', files: [{ content: code }], stdin }),
    });
    if (!r.ok) throw httpFailure('piston', r.status, Date.now() - started);
    const j = await r.json(), run = j.run || {}, comp = j.compile || {};
    return {
      provider: 'piston', ok: comp.code === 0, compile: comp.stderr || '',
      stdout: run.stdout || '', stderr: run.stderr || '', exit: run.code ?? 0, signal: run.signal || null,
    };
  });
}

// ----------------------------------------------------------------------------- orchestration

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const retryable = (e: ProviderError) => e.kind === 'rate_limit' || e.kind === 'network' || (e.kind === 'http' && (e.status ?? 0) >= 500);

/**
 * Wandbox first, then Piston (only when a token is configured). Each provider gets one retry on a
 * transient failure (429, 5xx, network) while enough budget is left. Timeouts are never retried:
 * the budget is gone, so we move straight to the next provider instead.
 */
export async function runProviders(code: string, stdin: string, signal: AbortSignal, token = '', opts: RunOptions = {}) {
  const lim = { ...LIMITS, ...opts.limits };
  const deadline = Date.now() + lim.totalMs;
  const attempts: Attempt[] = [];
  const chain: Array<{ name: string; run: () => Promise<any> }> = [{ name: 'wandbox', run: () => runWandbox(code, stdin, signal, opts) }];
  if (token) chain.push({ name: 'piston', run: () => runPiston(code, stdin, signal, token, opts) });

  for (const p of chain) {
    for (let n = 0; n < 2; n++) {
      if (signal.aborted || Date.now() >= deadline) { attempts.push({ provider: p.name, kind: 'skipped', ms: 0 }); break; }
      try {
        return await p.run();
      } catch (e) {
        const err = e instanceof ProviderError ? e : new ProviderError(p.name, 'network', 0, undefined, String((e as Error)?.message || e));
        attempts.push({ provider: err.provider, kind: err.kind, status: err.status, ms: err.ms, detail: err.detail });
        if (!retryable(err) || n === 1 || deadline - Date.now() < lim.retryMinLeftMs) break;
        await sleep(lim.retryDelayMs);
      }
    }
  }
  if (!token) attempts.push({ provider: 'piston', kind: 'not_configured', ms: 0 });
  throw new ProvidersFailed(attempts);
}
