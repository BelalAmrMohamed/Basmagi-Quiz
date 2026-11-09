// Phase 5 guard rails. These mount the REAL shared shell with the REAL MATLAB and C++ engines
// (only the worker / network call is faked) and fail on any drift between the two runtimes.
//   1. identical DOM skeleton, except the panels an engine's `caps` switch on
//   2. every class the rendered DOM uses is defined in runtimes/shared/styles/*.css
//   3. engines contain no CSS files and no class names (all chrome lives in shared/)
//   4. build-info.json matches a fresh hash of the runtimes sources (bundles are up to date)
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import path from 'node:path';
import { readFileSync, readdirSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { hashSources } from '../build.mjs';

const root = path.join(import.meta.dirname, '..');

const entryFile = path.join(root, '_parity-entry.ts');
writeFileSync(entryFile, `export { mountShell } from './shared/shell';
export { createMatlabEngine } from './matlab/src/engine';
export { createCppEngine } from './cpp/src/engine';`);
let code;
try {
  code = (await build({
    absWorkingDir: root,
    entryPoints: ['_parity-entry.ts'],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'T',
    loader: { '.css': 'empty' },
    alias: {
      '@codemirror/state': path.resolve(root, 'node_modules/@codemirror/state'),
      '@codemirror/view': path.resolve(root, 'node_modules/@codemirror/view'),
    },
    define: { 'process.env.NODE_ENV': '"test"' },
  })).outputFiles[0].text;
} finally { rmSync(entryFile); }

const CELLS = [{ type: 'code', source: 'x = 1' }, { type: 'markdown', source: '# Title $x^2$' }];

/** Mount one runtime in a fresh jsdom, run all cells, open every <details> menu. */
async function mount(kind, lang = 'en') {
  const dom = new JSDOM('<!doctype html><body><div id="root"></div></body>', { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://x.test/' });
  const w = dom.window;
  w.HTMLCanvasElement.prototype.getContext = () => null;
  w.Window.prototype.scrollTo = () => {};
  w.Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} });
  w.Range.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 });
  w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  w.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  w.eval(code);
  const worker = { postMessage(m) { if (m.t === 'run') setTimeout(() => { worker.onmessage({ data: { t: 'print', s: 'hi\n' } }); worker.onmessage({ data: { t: 'done', id: m.id, error: null, vars: [] } }); }, 0); }, terminate() {} };
  const engine = kind === 'matlab'
    ? w.T.createMatlabEngine({ createWorker: () => worker, baseUrl: 'https://x.test/' })
    : w.T.createCppEngine({ execute: async () => ({ ok: true, sections: [{ stdout: 'hi\n' }], exit: 0, timeMs: 1, provider: 'fake' }) });
  const el = w.document.getElementById('root');
  w.T.mountShell(engine, { root: el, lang, notebook: { id: 'n', schemaVersion: 1, cells: CELLS } });
  await w.__mlweb.runAll();
  await new Promise((r) => setTimeout(r, 60));
  el.querySelectorAll('details').forEach((d) => d.setAttribute('open', ''));
  return { w, el };
}

/** Tag + id + sorted classes of every element; CodeMirror's internals are collapsed. Text is ignored. */
function skeleton(e) {
  if (e.classList.contains('cm-editor')) return 'cm-editor';
  const kids = [...e.children].map(skeleton);
  return e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (e.classList.length ? '.' + [...e.classList].sort().join('.') : '') + (kids.length ? `[${kids.join(',')}]` : '');
}
/** Elements that exist only because an engine's caps ask for them (see Engine.caps). */
const CAPS_PANELS = ['#toggleside', '#side', '#imageTool', '#cppWasmBtn', '#cppWasmDialog'];
const prune = (el) => { const c = el.cloneNode(true); CAPS_PANELS.forEach((s) => c.querySelectorAll(s).forEach((n) => n.remove())); return c; };
const rendered = (el) => [...el.children].map(skeleton).join('\n');

const m = await mount('matlab'), c = await mount('cpp');

test('MATLAB and C++ render the same DOM skeleton; only caps panels differ', () => {
  assert.ok(m.el.querySelector('.cell .cm-editor') && c.el.querySelector('.cell .cm-editor'));
  assert.ok(m.el.querySelector('.outs .o') && c.el.querySelector('.outs .o'), 'both rendered a run output');
  assert.ok(m.el.querySelector('.toolbar-menu') && c.el.querySelector('.toolbar-menu'));
  assert.ok(m.el.querySelector('.cell-menu') && c.el.querySelector('.cell-menu'));
  assert.equal(rendered(prune(c.el)), rendered(prune(m.el)));
});
test('caps panels appear exactly where the caps are true', () => {
  assert.ok(m.el.querySelector('#toggleside'));
  assert.ok(m.el.querySelector('#side'));
  assert.ok(m.el.querySelector('#imageTool'));
  assert.ok(c.el.querySelector('#toggleside'));
  assert.ok(c.el.querySelector('#side'));
  assert.equal(c.el.querySelector('#imageTool'), null, 'C++ must not have #imageTool');
});
test('Arabic mode keeps the same skeleton for both runtimes', async () => {
  const am = await mount('matlab', 'ar'), ac = await mount('cpp', 'ar');
  assert.equal(am.el.getAttribute('dir'), 'rtl'); assert.equal(ac.el.getAttribute('dir'), 'rtl');
  assert.equal(rendered(prune(ac.el)), rendered(prune(am.el)));
});

// ------------------------------------------------------------------ CSS coverage
const cssDir = path.join(root, 'shared/styles');
const cssClasses = new Set();
for (const f of readdirSync(cssDir).filter((n) => n.endsWith('.css'))) for (const x of readFileSync(path.join(cssDir, f), 'utf8').matchAll(/\.(-?[A-Za-z_][\w-]*)/g)) cssClasses.add(x[1]);
// Classes owned by third-party widgets (CodeMirror, KaTeX), styled by their own libraries.
const THIRD_PARTY = /^(cm-|ͼ)/;
const isKatex = (n) => !!n.closest('.katex, .katex-display');

test('every class used in the rendered DOM is defined in the shared CSS', () => {
  const used = new Set();
  for (const { el } of [m, c]) for (const n of [el, ...el.querySelectorAll('*')]) if (!isKatex(n)) n.classList.forEach((k) => { if (!THIRD_PARTY.test(k)) used.add(k); });
  const missing = [...used].filter((k) => !cssClasses.has(k)).sort();
  assert.deepEqual(missing, [], 'classes without a rule in runtimes/shared/styles: ' + missing.join(', '));
});

// ------------------------------------------------------------------ engines own no chrome
function walk(dir) {
  return readdirSync(dir).flatMap((n) => { const p = path.join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
}
test('engines contain no .css files and no class names (chrome lives in runtimes/shared only)', () => {
  const offenders = [];
  for (const dir of ['cpp/src', 'matlab/src']) {
    for (const f of walk(path.join(root, dir))) {
      const rel = path.relative(root, f).split(path.sep).join('/');
      if (f.endsWith('.css')) { offenders.push(rel + ': css file'); continue; }
      if (!/\.(ts|tsx|js|mjs)$/.test(f)) continue;
      readFileSync(f, 'utf8').split(/\r?\n/).forEach((line, i) => {
        if (/\bclassName\s*=|\bclass\s*:|\bclass\s*=\s*["'`]|\bclassList\b/.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim().slice(0, 80)}`);
      });
    }
  }
  assert.deepEqual(offenders, []);
});

// ------------------------------------------------------------------ bundle freshness
test('build-info.json matches the current runtimes sources (rebuild with `npm run build:runtimes`)', async () => {
  const info = JSON.parse(readFileSync(path.join(root, 'build-info.json'), 'utf8'));
  assert.equal(await hashSources(), info.sourcesSha256, 'runtimes sources changed but the bundles were not rebuilt');
});
