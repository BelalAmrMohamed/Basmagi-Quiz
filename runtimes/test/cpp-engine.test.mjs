import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import path from 'node:path';
import { writeFileSync, rmSync } from 'node:fs';
const here = import.meta.dirname;
const f = path.join(here, '..', '_cpp-test-entry.ts');
writeFileSync(f, `export * from './cpp/src/engine';`);
const out = (await build({ absWorkingDir: path.join(here, '..'), entryPoints: ['_cpp-test-entry.ts'], bundle: true, write: false, format: 'esm', loader: { '.css': 'empty' } })).outputFiles[0].text;
rmSync(f);
const { createCppEngine, parseCompile } = await import('data:text/javascript;base64,' + Buffer.from(out).toString('base64'));

const sinkOf = (answers = []) => { const log = { out: [], status: [], asked: [] }; return { log, sink: { out: (o, c) => log.out.push([c, o]), clear() {}, status: (t, k) => log.status.push([t, k]), input: async (r, c) => { log.asked.push([r, c]); return answers.shift() ?? null; } } }; };
const cells = [{ id: 1, type: 'code', src: 'int x=1;' }, { id: 2, type: 'md', src: '# t' }, { id: 3, type: 'code', src: 'int n; std::cin>>n;' }];

test('parseCompile maps gcc diagnostics and keeps other text', () => {
  const r = parseCompile("cell-2:3:5: error: 'y' was not declared\nnote: x\ncell-1:1: warning: unused");
  assert.deepEqual(r.diags.map((d) => [d.k, d.line, d.col, d.sev]), [[1, 3, 5, 'error'], [0, 1, undefined, 'warning']]);
  assert.equal(r.rest, 'note: x');
});
test('single run asks stdin inline, sends active cells, maps sections to the cell', async () => {
  let sent;
  const e = createCppEngine({ execute: async (r) => { sent = r; return { ok: true, sections: [{ stdout: 'hi', stderr: 'w' }], exit: 0, timeMs: 5, provider: 'p' }; } });
  const { sink, log } = sinkOf(['42']);
  await e.run({ cells, target: 2, signal: new AbortController().signal }, sink);
  assert.equal(log.asked[0][1], 2);
  assert.equal(sent.target, 1); assert.equal(sent.cells.length, 2); assert.equal(sent.cells[1].stdin, '42');
  assert.deepEqual(log.out.map(([c, o]) => [c, o.k, o.s]), [[2, 'text', 'hi'], [2, 'err', 'w']]);
  assert.equal(log.status.at(-1)[1], 'result');
});
test('cancelled input aborts without calling the compiler', async () => {
  let called = false;
  const e = createCppEngine({ execute: async () => { called = true; return { ok: true }; } });
  const { sink } = sinkOf([]);
  await e.run({ cells, target: 2, signal: new AbortController().signal }, sink);
  assert.equal(called, false);
});
test('compile errors become diag outs on the right cell and an error status', async () => {
  const e = createCppEngine({ execute: async () => ({ ok: false, compile: 'cell-1:1:5: error: bad' }) });
  const { sink, log } = sinkOf();
  await e.runAll({ cells: [cells[0]], target: 'all', signal: new AbortController().signal }, sink);
  assert.deepEqual(log.out[0], [0, { k: 'diag', line: 1, col: 5, sev: 'error', msg: 'bad' }]);
  assert.deepEqual(log.status.at(-1), ['Compile error', 'error']);
});
test('timeout reports a message', async () => {
  const e = createCppEngine({ timeoutMs: 10, execute: ({ signal }) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(Object.assign(new Error('x'), { name: 'AbortError' })))) });
  const { sink, log } = sinkOf();
  await e.run({ cells: [cells[0]], target: 0, signal: new AbortController().signal }, sink);
  assert.match(log.status.at(-1)[0], /Time limit/);
});
test('caps: only stdin', () => {
  const e = createCppEngine({ execute: async () => ({ ok: true }) });
  assert.deepEqual(e.caps, { workspace: false, files: false, images: false, stdin: true, history: false });
});
