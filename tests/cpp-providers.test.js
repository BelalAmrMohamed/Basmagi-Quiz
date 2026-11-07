import test from 'node:test';
import assert from 'node:assert/strict';
import { runWandbox, runPiston, runProviders, ProvidersFailed, summarize } from '../supabase/functions/cpp-run/providers.ts';

const OK = { compiler_error: '', compiler_message: '', program_output: 'ok', program_error: '', status: '0' };
const res = (body, status = 200) => ({ ok: status < 200 || status >= 300 ? false : true, status, json: async () => body });
/** A fetch that never answers but honours abort, like a hung upstream. */
const hang = (signal) => new Promise((_, reject) => signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
async function withFetch(fn, body) {
  const old = globalThis.fetch;
  const calls = [];
  globalThis.fetch = (url, opts) => { calls.push(String(url)); return fn(String(url), opts); };
  try { return await body(calls); } finally { globalThis.fetch = old; }
}
const sig = () => new AbortController().signal;
const fast = { compiler: 'gcc-head', limits: { wandboxMs: 60, pistonMs: 60, totalMs: 400, retryDelayMs: 1, retryMinLeftMs: 0 } };

test('Wandbox request maps compiler and program output, with no list.json call when pinned', () =>
  withFetch(async () => res(OK), async (calls) => {
    const r = await runWandbox('int main(){}', '', sig(), { compiler: 'gcc-head' });
    assert.equal(r.provider, 'wandbox'); assert.equal(r.stdout, 'ok'); assert.equal(r.ok, true);
    assert.deepEqual(calls, ['https://wandbox.org/api/compile.json']);
  }));

test('a hung compiler list never delays or fails a compile (regression: shared 20 s abort)', () =>
  withFetch(async (url, o) => (url.endsWith('list.json') ? hang(o.signal) : res(OK)), async (calls) => {
    const t = Date.now();
    const r = await runWandbox('int main(){}', '', sig(), { limits: { listMs: 40 } });
    assert.equal(r.stdout, 'ok');
    assert.ok(Date.now() - t < 500, 'compile must not wait for list.json');
    assert.ok(calls.includes('https://wandbox.org/api/compile.json'));
  }));

test('Wandbox compile errors are a result (ok:false), not a provider failure', () =>
  withFetch(async () => res({ ...OK, compiler_error: "cell-1:1:1: error: bad", program_output: '' }), async () => {
    const r = await runProviders('x', '', sig(), '', fast);
    assert.equal(r.ok, false); assert.match(r.compile, /error: bad/);
  }));

test('Piston includes authorization and maps compile/run result', () =>
  withFetch(async () => res({ compile: { code: 0, stderr: '' }, run: { stdout: '42', stderr: '', code: 0 } }), async () => {
    let seen;
    const old = globalThis.fetch;
    globalThis.fetch = async (u, o) => { seen = o; return res({ compile: { code: 0, stderr: '' }, run: { stdout: '42', stderr: '', code: 0 } }); };
    try {
      const r = await runPiston('int main(){}', '', sig(), 'secret');
      assert.equal(seen.headers.authorization, 'Bearer secret'); assert.equal(r.stdout, '42');
    } finally { globalThis.fetch = old; }
  }));

test('transient Wandbox failure is retried once, then falls back to authorized Piston', () => {
  let wandbox = 0;
  return withFetch(async (url) => {
    if (url.includes('wandbox.org')) { wandbox++; return res({}, 503); }
    return res({ compile: { code: 0, stderr: '' }, run: { stdout: 'fallback', stderr: '', code: 0 } });
  }, async () => {
    const r = await runProviders('x', '', sig(), 'token', fast);
    assert.equal(r.provider, 'piston'); assert.equal(r.stdout, 'fallback'); assert.equal(wandbox, 2);
  });
});

test('a hung Wandbox times out on its own budget and Piston still gets its turn', () =>
  withFetch(async (url, o) => (url.includes('wandbox.org') ? hang(o.signal) : res({ compile: { code: 0 }, run: { stdout: 'p', code: 0 } })), async (calls) => {
    const r = await runProviders('x', '', sig(), 'token', fast);
    assert.equal(r.provider, 'piston');
    assert.equal(calls.filter((c) => c.includes('wandbox.org')).length, 1, 'timeouts are not retried');
  }));

test('timeout without Piston: classified as timeout, names the provider, mentions missing token', () =>
  withFetch(async (url, o) => hang(o.signal), async () => {
    await assert.rejects(runProviders('x', '', sig(), '', fast), (e) => {
      assert.ok(e instanceof ProvidersFailed);
      assert.equal(e.kind, 'timeout');
      assert.match(e.message, /Wandbox: timed out after 0\.\d s/);
      assert.match(e.message, /Piston: not configured/);
      assert.deepEqual(e.attempts.map((a) => [a.provider, a.kind]), [['wandbox', 'timeout'], ['piston', 'not_configured']]);
      return true;
    });
  }));

test('rate limit is reported as such after one retry', () => {
  let n = 0;
  return withFetch(async () => { n++; return res({}, 429); }, async () => {
    await assert.rejects(runProviders('x', '', sig(), '', fast), (e) => {
      assert.equal(e.kind, 'rate_limit'); assert.equal(n, 2);
      assert.match(e.message, /Wandbox: rate limited \(HTTP 429\) \(2 tries\)/);
      return true;
    });
  });
});

test('4xx other than 429 is not retried and shows the status', () => {
  let n = 0;
  return withFetch(async () => { n++; return res({}, 403); }, async () => {
    await assert.rejects(runProviders('x', '', sig(), 'bad', fast), (e) => {
      assert.equal(n, 2, 'one Wandbox try + one Piston try');
      assert.match(e.message, /Piston: HTTP 403 error \(authorization rejected\)/);
      return true;
    });
  });
});

test('network errors and unreadable bodies are classified', async () => {
  await withFetch(async () => { throw new TypeError('fetch failed'); }, async () => {
    await assert.rejects(runProviders('x', '', sig(), '', fast), (e) => e.kind === 'network' && /network error \(fetch failed\)/.test(e.message));
  });
  await withFetch(async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad json'); } }), async () => {
    await assert.rejects(runProviders('x', '', sig(), '', fast), (e) => e.kind === 'bad_response');
  });
});

test('overall deadline: remaining providers are reported as skipped, not silently dropped', () =>
  withFetch(async (url, o) => hang(o.signal), async () => {
    const outer = AbortSignal.timeout(40);
    await assert.rejects(runProviders('x', '', outer, 'token', { compiler: 'gcc-head', limits: { wandboxMs: 5000, pistonMs: 5000, totalMs: 40 } }), (e) => {
      assert.deepEqual(e.attempts.map((a) => [a.provider, a.kind]), [['wandbox', 'timeout'], ['piston', 'skipped']]);
      return true;
    });
  }));

test('summarize collapses retries per provider', () => {
  assert.equal(summarize([{ provider: 'wandbox', kind: 'http', status: 503, ms: 1 }, { provider: 'wandbox', kind: 'http', status: 503, ms: 1 }]), 'Wandbox: HTTP 503 error (2 tries).');
});
