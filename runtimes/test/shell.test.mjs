// jsdom tests for the shared shell (fake engine) and the MATLAB indent logic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import path from 'node:path';

const here = import.meta.dirname;
const bundle = async (entry, globalName) => (await build({
  absWorkingDir: path.join(here, '..'), entryPoints: [entry], bundle: true, write: false, format: 'iife', globalName,
  loader: { '.css': 'empty' }, define: { 'process.env.NODE_ENV': '"test"' },
})).outputFiles[0].text;

const entry = `
import { mountShell } from './shared/shell';
import { createMatlabEngine } from './matlab/src/engine';
export { mountShell, createMatlabEngine };
`;
import { writeFileSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
const tmp = mkdtempSync(path.join(os.tmpdir(), 'rt-'));
const entryFile = path.join(here, '..', '_test-entry.ts');
writeFileSync(entryFile, entry);
const code = await bundle('_test-entry.ts', 'T');
import { rmSync } from 'node:fs';
rmSync(entryFile);

function env() {
  const dom = new JSDOM('<!doctype html><body><div id="root"></div></body>', { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://x.test/' });
  dom.window.HTMLCanvasElement.prototype.getContext = () => null;
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  dom.window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); this.dispatchEvent(new dom.window.Event('close')); };
  dom.window.eval(code);
  return dom;
}
const fakeEngine = (over = {}) => ({
  id: 'fake', label: 'Fake', kernel: 'fake', exportExt: '.m',
  editor: { extensions: () => [] },
  caps: { workspace: true, files: true, images: true, stdin: false, history: true },
  files: new Map(),
  async run({ cells, target, signal }, sink) {
    const c = cells[target];
    if (c.src.includes('hang')) return new Promise((res) => signal.addEventListener('abort', () => { sink.out({ k: 'err', s: 'stopped\n' }); res(); }));
    if (c.src.includes('boom')) { sink.out({ k: 'err', s: 'bad\n' }); return; }
    sink.out({ k: 'text', s: 'out:' + c.src }); sink.out({ k: 'text', s: '!' });
    sink.vars([{ name: 'x', size: '1x1', cls: 'double', bytes: 8 }]);
  },
  reset() {}, dispose() { this.disposed = true; },
  ...over,
});
const nb = (cells) => ({ id: 'n1', schemaVersion: 1, cells });
const tick = (w, ms = 20) => new Promise((r) => w.setTimeout(r, ms));

test('mounts, runs a cell, shows merged text output and workspace', async () => {
  const dom = env(), w = dom.window, root = w.document.getElementById('root');
  const h = w.T.mountShell(fakeEngine(), { root, notebook: nb([{ type: 'code', source: 'a=1' }, { type: 'markdown', source: '# Hi $x^2$' }]) });
  assert.ok(root.classList.contains('mlweb'));
  assert.equal(root.querySelectorAll('.cell').length, 2);
  assert.ok(root.querySelector('.md h1'), 'markdown rendered');
  assert.ok(root.querySelector('.katex'), 'math rendered');
  assert.ok(root.querySelector('#side'), 'side panel present');
  await w.__mlweb.runCell(w.__mlweb.cells[0]); await tick(w);
  assert.equal(root.querySelector('.outs .o').textContent, 'out:a=1!');
  assert.match(root.querySelector('table.ws').textContent, /double/);
  assert.equal(root.querySelector('#status').textContent, 'Ready');
  assert.deepEqual(h.getCells().map((c) => c.type), ['code', 'markdown']);
  h.destroy();
  assert.equal(root.children.length, 0);
});

test('run all stops after the first error; Stop aborts a hung run', async () => {
  const dom = env(), w = dom.window, root = w.document.getElementById('root');
  w.T.mountShell(fakeEngine(), { root, notebook: nb([{ type: 'code', source: 'boom' }, { type: 'code', source: 'b' }]) });
  await w.__mlweb.runAll(); await tick(w);
  assert.equal(w.__mlweb.cells[1].outs.length, 0);
  w.__mlweb.cells[1].src = 'hang';
  const p = w.__mlweb.runCell(w.__mlweb.cells[1]); await tick(w);
  assert.ok(!root.querySelector('#stop').hidden);
  root.querySelector('#stop').click(); await p; await tick(w);
  assert.match(root.querySelectorAll('.outs')[1].textContent, /stopped/);
  assert.ok(root.querySelector('#stop').hidden);
});

test('caps gate the side panels; diag output renders; setCells/destroy', async () => {
  const dom = env(), w = dom.window, root = w.document.getElementById('root');
  const eng = fakeEngine({ caps: { workspace: false, files: false, images: false, stdin: false, history: false },
    async run(_r, sink) { sink.out({ k: 'diag', line: 3, col: 2, sev: 'error', msg: 'oops' }); } });
  const h = w.T.mountShell(eng, { root, notebook: nb([{ type: 'code', source: 'x' }]) });
  assert.equal(root.querySelector('#side'), null);
  assert.equal(root.querySelector('#toggleside'), null);
  assert.equal(root.querySelector('#imageTool'), null);
  await w.__mlweb.runAll(); await tick(w);
  assert.match(root.querySelector('.o-diag').textContent, /Line 3:2.*oops/);
  h.setCells([{ type: 'code', source: 'q' }, { type: 'code', source: 'r' }]);
  assert.equal(root.querySelectorAll('.cell').length, 2);
  h.destroy();
  assert.equal(eng.disposed, true);
});

test('Arabic mode flips direction and translates', async () => {
  const dom = env(), w = dom.window, root = w.document.getElementById('root');
  w.T.mountShell(fakeEngine(), { root, lang: 'ar', notebook: nb([{ type: 'code', source: '' }]) });
  assert.equal(root.getAttribute('dir'), 'rtl');
  assert.notEqual(root.querySelector('#runall').textContent, '▶ Run all');
});

test('MATLAB engine: worker messages become outputs, 60 s guard is cleared', async () => {
  const dom = env(), w = dom.window, root = w.document.getElementById('root');
  const posted = [];
  const fakeWorker = { postMessage(m) { posted.push(m); if (m.t === 'run') setTimeout(() => {
    fakeWorker.onmessage({ data: { t: 'print', s: 'hello\n' } });
    fakeWorker.onmessage({ data: { t: 'done', id: m.id, error: null, vars: [{ name: 'a', size: '1x1', cls: 'double', bytes: 8 }] } });
  }, 0); }, terminate() {} };
  const eng = w.T.createMatlabEngine({ createWorker: () => fakeWorker, baseUrl: 'https://x.test/' });
  assert.deepEqual([eng.exportExt, eng.kernel, eng.caps.stdin], ['.m', 'mlweb', false]);
  w.T.mountShell(eng, { root, notebook: nb([{ type: 'code', source: 'disp("hello")' }]) });
  await w.__mlweb.runAll(); await tick(w);
  assert.equal(root.querySelector('.outs .o').textContent, 'hello\n');
  assert.match(root.querySelector('table.ws').textContent, /double/);
  assert.ok(posted.some((m) => m.t === 'run'));
});

test('sink.input shows an inline Jupyter-style box, echoes the answer, and Stop cancels it', async () => {
  const dom = env(), w = dom.window, root = w.document.getElementById('root');
  let got;
  const eng = fakeEngine({ caps: { workspace: false, files: false, images: false, stdin: true, history: false },
    async run(r, sink) { got = await sink.input({ label: 'Enter your name' }, r.target); sink.out({ k: 'text', s: 'hi ' + got }); } });
  w.T.mountShell(eng, { root, notebook: nb([{ type: 'code', source: 'x' }]) });
  const p = w.__mlweb.runAll(); await tick(w);
  const ta = root.querySelector('textarea[data-stdin]');
  assert.ok(ta, 'inline box rendered');
  assert.match(root.querySelector('.o-input').textContent, /Enter your name/);
  ta.value = 'Ruby';
  ta.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await p; await tick(w);
  assert.equal(got, 'Ruby');
  assert.equal(root.querySelector('textarea[data-stdin]'), null);
  assert.match(root.querySelector('.o-stdin').textContent, /Ruby/);
  const eng2 = fakeEngine({ async run(r, sink) { got = await sink.input({}, r.target); } });
  const root2 = w.document.createElement('div'); w.document.body.append(root2);
  w.T.mountShell(eng2, { root: root2, notebook: nb([{ type: 'code', source: 'x' }]) });
  const p2 = w.__mlweb.runAll(); await tick(w);
  root2.querySelector('textarea[data-stdin]').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await p2; await tick(w);
  assert.equal(got, null);
});
