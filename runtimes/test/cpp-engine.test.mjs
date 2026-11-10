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
const { createCppEngine, parseCompile, explain } = await import('data:text/javascript;base64,' + Buffer.from(out).toString('base64'));

const sinkOf = (answers = []) => { const log = { out: [], status: [], asked: [] }; return { log, sink: { out: (o, c) => log.out.push([c, o]), clear() {}, status: (t, k) => log.status.push([t, k]), input: async (r, c) => { log.asked.push([r, c]); return answers.shift() ?? null; } } }; };
const cells = [{ id: 1, type: 'code', src: 'int x=1;' }, { id: 2, type: 'md', src: '# t' }, { id: 3, type: 'code', src: 'int n; std::cin>>n;' }];

test('parseCompile maps gcc diagnostics and keeps other text', () => {
  const r = parseCompile("wasm-ld: error: undefined symbol: f\ncell-2:3:5: error: 'y' was not declared\ncell-1:1: warning: unused");
  assert.deepEqual(r.diags.map((d) => [d.k, d.line, d.col, d.sev]), [[1, 3, 5, 'error'], [0, 1, undefined, 'warning']]);
  assert.equal(r.rest, 'wasm-ld: error: undefined symbol: f');
});
test('parseCompile keeps the source line, caret and notes with their own message', () => {
  const r = parseCompile("cell-3:3:19: error: use of undeclared identifier 'getName'\n    string name = getName();\n                  ^\ncell-2:1:8: note: did you mean this\nstring getName();\n       ^~\n1 error generated.\n");
  assert.equal(r.diags.length, 1);
  assert.equal(r.rest, '');
  assert.match(r.diags[0].detail, /string name = getName\(\);/);
  assert.match(r.diags[0].detail, /note: did you mean this/);
  assert.doesNotMatch(r.diags[0].detail, /generated/);
});
test('parseCompile shows the learner\'s main, not the renamed one', () => {
  const r = parseCompile("cell-1:2:3: error: bad\nint __nb_main_1() { x; return 0;/*nb*/ }\n");
  assert.equal(r.diags[0].detail, 'int main() { x; }');
});
test('explain gives a plain-language hint, also in Arabic', () => {
  assert.match(explain("use of undeclared identifier 'cout'"), /'cout' comes from the standard library/);
  assert.match(explain("use of undeclared identifier 'getName'"), /'getName' is not declared at this point/);
  assert.match(explain("expected ';' after expression"), /semicolon/);
  assert.equal(explain('something unusual'), undefined);
  assert.match(explain("use of undeclared identifier 'cout'", (s) => 'AR:' + s), /^AR:|AR:'\{n\}'|AR:.*cout/);
});
test('an error in an earlier (replayed) cell is labelled with that cell and shown on the running cell', async () => {
  const two = [{ id: 1, type: 'code', src: 'int a = ;' }, { id: 2, type: 'code', src: 'int b = 1;' }];
  const e = createCppEngine({ execute: async () => ({ ok: false, compile: 'cell-1:1:9: error: expected expression\nint a = ;\n        ^\ncell-1:1:1: warning: x' }) });
  const { sink, log } = sinkOf();
  await e.run({ cells: two, target: 1, signal: new AbortController().signal }, sink);
  assert.equal(log.out.length, 1); // the replayed cell's warning is dropped
  assert.equal(log.out[0][0], 1);
  assert.equal(log.out[0][1].cell, 1);
  assert.equal(log.out[0][1].detail, 'int a = ;\n        ^');
  assert.match(log.out[0][1].hint, /incomplete/);
});
test('input is asked in the cell that runs the code even when cin sits in a function defined in another cell', async () => {
  const split = [
    { id: 1, type: 'code', src: '#include <iostream>\nusing namespace std;' },
    { id: 2, type: 'code', src: 'string getName() { string n; cin >> n; return n; }' },
    { id: 3, type: 'code', src: 'int main() { cout << getName(); return 0; }' },
  ];
  let sent;
  const e = createCppEngine({ execute: async (r) => { sent = r; return { ok: true, sections: [{}, {}, { stdout: 'x' }], exit: 0 }; } });
  const { sink, log } = sinkOf(['Belal']);
  await e.runAll({ cells: split, target: 'all', signal: new AbortController().signal }, sink);
  assert.deepEqual(log.asked.map(([, c]) => c), [2]); // asked once, for the cell with main
  assert.equal(sent.cells[2].stdin, 'Belal');
});
test('every C++ notebook starts with a test.txt in the current folder', () => {
  const e = createCppEngine({ execute: async () => ({ ok: true }) });
  assert.ok(e.files.has('test.txt'));
  assert.match(e.files.get('test.txt').text, /^Hello World/);
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
  assert.match(log.status.at(-1)[0], /No response from the compile service/);
});
test('caps: stdin and files', () => {
  const e = createCppEngine({ execute: async () => ({ ok: true }) });
  assert.deepEqual(e.caps, { workspace: false, files: true, images: false, stdin: true, history: false });
});
test('compile error status names the provider and explains an empty diagnostic', async () => {
  const e = createCppEngine({ execute: async () => ({ ok: false, compile: '', provider: 'wandbox' }) });
  const { sink, log } = sinkOf();
  await e.runAll({ cells: [cells[0]], target: 'all', signal: new AbortController().signal }, sink);
  assert.deepEqual(log.status.at(-1), ['Compile error · wandbox', 'error']);
  assert.match(log.out[0][1].s, /no diagnostics/);
});
test('service errors from the Edge Function are shown verbatim in the cell and status', async () => {
  const msg = 'Compiler unavailable. Wandbox: timed out after 12.0 s; Piston: not configured (set PISTON_TOKEN). Please retry in a moment.';
  const e = createCppEngine({ execute: async () => { throw new Error(msg); } });
  const { sink, log } = sinkOf();
  await e.run({ cells: [cells[0]], target: 0, signal: new AbortController().signal }, sink);
  assert.equal(log.out[0][1].s, msg + '\n');
  assert.deepEqual(log.status.at(-1), [msg, 'error']);
});
test('attach() feeds notebook cells to the completion source', async () => {
  const e = createCppEngine({ execute: async () => ({ ok: true }) });
  e.attach({ codeSources: () => ['int totalCount = 0;'] });
  const { EditorState } = await import('@codemirror/state');
  const src = 'tot', state = EditorState.create({ doc: src });
  const ctx = { state, pos: 3, explicit: false, matchBefore: (re) => { const m = src.match(new RegExp('(?:' + re.source + ')$')); return m ? { from: 3 - m[0].length, to: 3, text: m[0] } : null; } };
  const sources = [].concat(e.editor.completions);
  assert.ok(sources[0](ctx).options.some((o) => o.label === 'totalCount'));
});
