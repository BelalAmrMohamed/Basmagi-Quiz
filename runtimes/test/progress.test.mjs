// Phase 6.2: progress and live status. The real shell and the real MATLAB engine run in jsdom; only the worker is fake,
// and `performance.now` is a clock the test moves, so no test waits for 5 real seconds.
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import path from 'node:path';
import { writeFileSync, rmSync } from 'node:fs';

const root = path.join(import.meta.dirname, '..');
const entryFile = path.join(root, '_progress-entry.ts');
writeFileSync(entryFile, `export { mountShell } from './shared/shell';
export { createMatlabEngine } from './matlab/src/engine';
export { RunProgress, formatElapsed } from './shared/run-progress';
export { formatRunStatus } from './matlab/src/run-status';
export { createT } from './shared/i18n';`);
let code;
try {
  code = (await build({
    absWorkingDir: root, entryPoints: ['_progress-entry.ts'], bundle: true, write: false, format: 'iife', globalName: 'T',
    loader: { '.css': 'empty' },
    alias: { '@codemirror/state': path.resolve(root, 'node_modules/@codemirror/state'), '@codemirror/view': path.resolve(root, 'node_modules/@codemirror/view') },
    define: { 'process.env.NODE_ENV': '"test"' },
  })).outputFiles[0].text;
} finally { rmSync(entryFile); }

function page() {
  const dom = new JSDOM('<!doctype html><body><div id="root"></div></body>', { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://x.test/' });
  const w = dom.window;
  w.HTMLCanvasElement.prototype.getContext = () => null;
  w.scrollTo = () => {};
  w.Window.prototype.scrollTo = () => {};
  w.Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} });
  w.Range.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 });
  w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  w.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  let clock = 0;
  w.performance.now = () => clock;
  w.eval(code);
  return { w, advance: (ms) => { clock += ms; }, setClock: (ms) => { clock = ms; } };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- pure parts ----------
test('RunProgress: bar after 1.5 s, primary Stop and tip after 5 s, tip once per session', () => {
  const { w } = page();
  const session = { shown: false };
  let now = 0;
  const mk = () => new w.T.RunProgress(session, () => now);
  const a = mk(); a.start();
  const v = (ms) => { now = ms; return a.view(); };
  now = 0; a.start();
  assert.deepEqual([v(0).visible, v(1499).visible, v(1500).visible], [false, false, true]);
  assert.deepEqual([v(4999).stopPrimary, v(5000).stopPrimary], [false, true]);
  assert.deepEqual([v(5000).tip, v(9000).tip], [true, true]);
  { const x = new w.T.RunProgress({ shown: false }, () => now); now = 0; x.start(); now = 4999; assert.equal(x.view().tip, false); }
  a.update(41); assert.equal(v(9000).percent, 41);
  a.update(null); assert.equal(v(9000).percent, null);
  a.update(250); assert.equal(v(9000).percent, 100);
  a.stop(); assert.equal(JSON.stringify(a.view()), JSON.stringify({ visible: false, percent: null, elapsedMs: 0, stopPrimary: false, tip: false }));
  // second run of the same session: the tip is not offered again, the rest is the same
  now = 0; const b = mk(); b.start(); now = 8000;
  assert.deepEqual([b.view().tip, b.view().stopPrimary, b.view().visible], [false, true, true]);
  // a run shorter than 5 s does not use up the tip
  const s2 = { shown: false }; now = 0; const c = new w.T.RunProgress(s2, () => now); c.start(); now = 4000; c.view(); c.stop();
  assert.equal(s2.shown, false);
});

test('status text: English and Arabic, with and without line and percent', () => {
  const { w } = page();
  const en = w.T.createT('en'), ar = w.T.createT('ar');
  const f = w.T.formatRunStatus;
  assert.equal(f(en, { line: 12, percent: 40, elapsedMs: 7400 }), 'Running… line 12 · 40% · 7 s');
  assert.equal(f(en, { line: 12, percent: null, elapsedMs: 7400 }), 'Running… line 12 · 7 s');
  assert.equal(f(en, { line: 0, percent: null, elapsedMs: 100 }), 'Running… 0 s');
  assert.equal(f(ar, { line: 3, percent: 5, elapsedMs: 2000 }), 'قيد التشغيل… السطر 3 · 5% · 2 ث');
  assert.deepEqual([w.T.formatElapsed(59999, en), w.T.formatElapsed(65000, en), w.T.formatElapsed(3600000, en)], ['59 s', '1:05', '60:00']);
});

// ---------- the real shell and engine with a fake worker ----------
async function mount(lang = 'en', again = null) {
  const pg = again ?? page(), { w } = pg;
  const sent = [];
  const worker = { postMessage(m) { sent.push(m); }, terminate() {} };
  const engine = w.T.createMatlabEngine({ createWorker: () => worker, baseUrl: 'https://x.test/', lang });
  const el = w.document.createElement('div');
  w.document.body.append(el);
  w.T.mountShell(engine, { root: el, lang, notebook: { id: 'n', schemaVersion: 1, cells: [{ type: 'code', source: 'for i = 1:10, end' }] } });
  const post = (m) => worker.onmessage({ data: m });
  const startRun = async () => {
    const before = sent.filter((m) => m.t === 'run').length;
    const done = w.__mlweb.runAll();
    for (let i = 0; i < 50 && sent.filter((m) => m.t === 'run').length === before; i++) await wait(10);
    const msg = sent.filter((m) => m.t === 'run').at(-1);
    return { id: msg.id, finish: async () => { post({ t: 'done', id: msg.id, error: null, vars: [] }); await done; await wait(20); } };
  };
  const ui = () => ({
    status: el.querySelector('#status')?.getAttribute('aria-label'),
    box: el.querySelector('.cell.running .run-progress'),
    stopPrimary: el.querySelector('#stop')?.classList.contains('primary'),
  });
  return { ...pg, el, post, startRun, ui, sent };
}

test('a progress message sets the status text; the bar, timer and primary Stop follow the clock', async () => {
  const m = await mount();
  const run = await m.startRun();
  m.advance(1000);
  m.post({ t: 'progress', line: 1, loops: [{ iter: 2, total: 10 }], elapsedMs: 1000 });
  await wait(300);
  assert.equal(m.ui().status, 'Running… line 1 · 10% · 1 s');
  assert.equal(m.ui().box.hidden, true, 'not shown before 1.5 s');
  m.advance(1500); // 2.5 s
  m.post({ t: 'progress', line: 1, loops: [{ iter: 5, total: 10 }], elapsedMs: 2500 });
  await wait(300);
  const box = m.ui().box;
  assert.equal(box.hidden, false);
  assert.equal(box.querySelector('.run-fill').style.width, '40%');
  assert.equal(box.querySelector('.run-bar').getAttribute('aria-valuenow'), '40');
  assert.equal(box.querySelector('.run-time').textContent, '40% · 2 s');
  assert.equal(box.querySelector('.run-tip').hidden, true);
  assert.equal(m.ui().stopPrimary, false);
  m.advance(3000); // 5.5 s
  await wait(300);
  assert.equal(m.ui().stopPrimary, true);
  assert.equal(m.ui().box.querySelector('.run-tip').hidden, false);
  assert.match(m.ui().box.querySelector('.run-tip').textContent, /b = a \+ 50;/);
  await run.finish();
  assert.equal(m.el.querySelector('.run-progress'), null, 'the footer is gone after the run');
  assert.equal(m.ui().stopPrimary, false);
  assert.equal(m.el.querySelector('#status').getAttribute('aria-label'), 'Ready');
});

test('an unknown trip count (while, 1:Inf) shows elapsed time only and an indeterminate bar', async () => {
  const m = await mount();
  const run = await m.startRun();
  m.advance(2000);
  m.post({ t: 'progress', line: 4, loops: [{ iter: 7, total: Infinity }, { iter: 1, total: 3 }], elapsedMs: 2000 });
  await wait(300);
  assert.equal(m.ui().status, 'Running… line 4 · 2 s');
  const box = m.ui().box;
  assert.equal(box.querySelector('.run-bar').classList.contains('indeterminate'), true);
  assert.equal(box.querySelector('.run-bar').hasAttribute('aria-valuenow'), false);
  assert.equal(box.querySelector('.run-time').textContent, '2 s');
  await run.finish();
});

test('the tip appears once per session, not on every slow run', async () => {
  const m = await mount();
  let run = await m.startRun();
  m.advance(6000); await wait(300);
  assert.equal(m.ui().box.querySelector('.run-tip').hidden, false);
  await run.finish();
  m.setClock(0);
  run = await m.startRun();
  m.advance(6000); await wait(300);
  assert.equal(m.ui().box.hidden, false);
  assert.equal(m.ui().box.querySelector('.run-tip').hidden, true);
  assert.equal(m.ui().stopPrimary, true);
  await run.finish();
});

test('the tip is once per page load even when the notebook is mounted again', async () => {
  const m = await mount();
  let run = await m.startRun();
  m.advance(6000); await wait(300);
  assert.equal(m.ui().box.querySelector('.run-tip').hidden, false);
  await run.finish();
  const m2 = await mount('en', m);
  m.setClock(0);
  run = await m2.startRun();
  m2.advance(6000); await wait(300);
  assert.equal(m2.ui().box.hidden, false);
  assert.equal(m2.ui().box.querySelector('.run-tip').hidden, true);
  await run.finish();
});

test('Arabic UI: status, timer and tip are translated', async () => {
  const m = await mount('ar');
  const run = await m.startRun();
  m.advance(6000);
  m.post({ t: 'progress', line: 2, loops: [{ iter: 1, total: 4 }], elapsedMs: 6000 });
  await wait(300);
  assert.equal(m.ui().status, 'قيد التشغيل… السطر 2 · 0% · 6 ث');
  assert.match(m.ui().box.querySelector('.run-tip').textContent, /الحلقات على مستوى البكسل/);
  await run.finish();
});

// ---------- the worker ----------
test('the worker posts throttled `progress` messages (line, loops, elapsedMs) while a program runs', async () => {
  const vm = await import('node:vm');
  const out = (await build({ absWorkingDir: root, entryPoints: ['matlab/src/worker.ts'], bundle: true, write: false, format: 'iife', define: { 'process.env.NODE_ENV': '"test"' } })).outputFiles[0].text;
  const posted = [];
  const self = { postMessage: (m) => posted.push(m) };
  vm.runInNewContext(out, { self, performance, console, setTimeout, TextEncoder, TextDecoder, URL });
  self.onmessage({ data: { t: 'run', id: 7, src: 'x = 1;\nfor k = 1:3\n  pause(0.25);\nend' } });
  const prog = posted.filter((m) => m.t === 'progress');
  assert.ok(prog.length >= 2 && prog.length <= 12, `got ${prog.length} progress messages`);
  assert.equal(posted.at(-1).t, 'done');
  assert.ok(prog.every((m) => m.line === 3 || m.line === 2) && prog.every((m) => Array.isArray(m.loops) && typeof m.elapsedMs === 'number'));
  assert.ok(prog.some((m) => m.loops.length === 1 && m.loops[0].total === 3));
  const gaps = prog.slice(1).map((m, i) => m.elapsedMs - prog[i].elapsedMs);
  assert.ok(gaps.every((g) => g >= 99), `gaps ${gaps}`);
});
