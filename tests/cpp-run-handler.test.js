import test from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../supabase/functions/cpp-run/handler.ts';
import { runProviders, ProvidersFailed } from '../supabase/functions/cpp-run/providers.ts';

const HELLO = '#include <iostream>\n\nusing namespace std;\n\nint main(){\n    cout << "Hello World";\n    return 0;\n}\n\n';
const post = (body, headers = {}) => new Request('https://f.test/cpp-run', { method: 'POST', headers: { origin: 'https://basmagi.vercel.app', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const deps = (over = {}) => ({ env: (k) => ({ IP_SALT: 's' })[k], hitQuota: async () => true, runProviders: async () => ({ ok: true, stdout: 'Hello World\x1e@@NB:1@@\x1e', stderr: '\x1e@@NB:1@@\x1e', compile: '', exit: 0, signal: null, provider: 'wandbox' }), ...over });
const hang = (signal) => new Promise((_, reject) => signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));

test('Hello World request returns output split per cell and the provider name', async () => {
  let program = '';
  const r = await handle(post({ cells: [{ src: HELLO, stdin: '' }], target: 'all' }), deps({ runProviders: async (code) => { program = code; return { ok: true, stdout: 'Hello World\x1e@@NB:1@@\x1e', stderr: '\x1e@@NB:1@@\x1e', compile: '', exit: 0, provider: 'wandbox' }; } }));
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.deepEqual(j.sections, [{ stdout: 'Hello World', stderr: '' }]);
  assert.equal(j.provider, 'wandbox');
  assert.match(program, /int __nb_main_1\(\)/);
  assert.match(program, /\n__nb_main_1\(\);/);
});

test('every provider failing returns 502 with a specific message and per-provider attempts', async () => {
  const attempts = [{ provider: 'wandbox', kind: 'rate_limit', status: 429, ms: 5 }, { provider: 'wandbox', kind: 'rate_limit', status: 429, ms: 5 }, { provider: 'piston', kind: 'not_configured', ms: 0 }];
  const r = await handle(post({ cells: [{ src: HELLO }], target: 'all' }), deps({ runProviders: async () => { throw new ProvidersFailed(attempts); } }));
  const j = await r.json();
  assert.equal(r.status, 502); assert.equal(j.kind, 'rate_limit');
  assert.match(j.error, /Wandbox: rate limited \(HTTP 429\) \(2 tries\)/);
  assert.equal(j.attempts.length, 3);
});

test('end to end: a hung Wandbox yields 504 naming Wandbox, within the budget (regression)', async () => {
  const old = globalThis.fetch;
  globalThis.fetch = (url, o) => hang(o.signal);
  try {
    const t = Date.now();
    const r = await handle(post({ cells: [{ src: HELLO }], target: 'all' }), deps({
      totalMs: 300,
      runProviders: (code, stdin, signal, token) => runProviders(code, stdin, signal, token, { compiler: 'gcc-head', limits: { wandboxMs: 80, totalMs: 300 } }),
    }));
    const j = await r.json();
    assert.equal(r.status, 504); assert.equal(j.kind, 'timeout');
    assert.match(j.error, /^Compiler unavailable\. Wandbox: timed out after 0\.\d s; Piston: not configured/);
    assert.ok(Date.now() - t < 1000);
  } finally { globalThis.fetch = old; }
});

test('our own quota: 429 says so and is not blamed on a compiler; quota outage is a distinct 503', async () => {
  let r = await handle(post({ cells: [{ src: HELLO }], target: 'all' }), deps({ hitQuota: async () => false }));
  assert.equal(r.status, 429); assert.equal(r.headers.get('retry-after'), '60'); assert.equal((await r.json()).kind, 'quota');
  r = await handle(post({ cells: [{ src: HELLO }], target: 'all' }), deps({ hitQuota: async () => { throw new Error('db'); } }));
  assert.equal(r.status, 503); const j = await r.json(); assert.equal(j.kind, 'quota_unavailable'); assert.match(j.error, /not a compiler problem/);
});

test('bad JSON, oversize, bad target and wrong method have precise errors', async () => {
  assert.equal((await handle(post('{nope'), deps())).status, 400);
  assert.equal((await handle(post({ cells: [{ src: 'x'.repeat(140000) }], target: 'all' }), deps())).status, 413);
  assert.equal((await handle(post({ cells: [{ src: 'int x;' }], target: 5 }), deps())).status, 400);
  assert.equal((await handle(new Request('https://f.test/', { method: 'GET' }), deps())).status, 405);
});

test('unexpected failures are internal errors, not "compiler unavailable"', async () => {
  const r = await handle(post({ cells: [{ src: HELLO }], target: 'all' }), deps({ runProviders: async () => { throw new TypeError('boom'); } }));
  const j = await r.json(); assert.equal(r.status, 500); assert.equal(j.kind, 'internal'); assert.match(j.error, /boom/);
});

test('CORS: allowed origin is echoed, OPTIONS preflight succeeds', async () => {
  const r = await handle(new Request('https://f.test/', { method: 'OPTIONS', headers: { origin: 'http://localhost:8080' } }), deps());
  assert.equal(r.headers.get('access-control-allow-origin'), 'http://localhost:8080');
});
