// Phase 6.3: time limit selector, Stop / timeout message, worker terminated and recreated, workspace reset.
// The real shell and the real MATLAB engine run in jsdom; the worker is fake and the long timer is fired by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import path from 'node:path';
import { writeFileSync, rmSync } from 'node:fs';

const root = path.join(import.meta.dirname, '..');
const entryFile = path.join(root, '_timelimit-entry.ts');
writeFileSync(entryFile, `export { mountShell } from './shared/shell';
export { createMatlabEngine, TIME_LIMIT_KEY } from './matlab/src/engine';`);
let code;
try {
  code = (await build({
    absWorkingDir: root, entryPoints: ['_timelimit-entry.ts'], bundle: true, write: false, format: 'iife', globalName: 'T',
    loader: { '.css': 'empty' },
    alias: { '@codemirror/state': path.resolve(root, 'node_modules/@codemirror/state'), '@codemirror/view': path.resolve(root, 'node_modules/@codemirror/view') },
    define: { 'process.env.NODE_ENV': '"test"' },
  })).outputFiles[0].text;
} finally { rmSync(entryFile); }

const EN = 'Execution stopped. The workspace was reset; use Run all to rebuild it.\n';
const AR = 'توقف التنفيذ. تمت إعادة ضبط مساحة العمل؛ استخدم «تشغيل الكل» لإعادة بنائها.\n';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function page({ brokenStorage = false } = {}) {
  const dom = new JSDOM('<!doctype html><body><div id="root"></div></body>', { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://x.test/' });
  const w = dom.window;
  w.HTMLCanvasElement.prototype.getContext = () => null;
  w.Window.prototype.scrollTo = () => {};
  w.Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} });
  w.Range.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 });
  w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  w.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  if (brokenStorage) Object.defineProperty(w, 'localStorage', { get() { throw new Error('storage blocked'); } });
  // Timers of a minute or more are recorded so the test can fire them; everything else stays real.
  const long = [];
  const realSet = w.setTimeout.bind(w), realClear = w.clearTimeout.bind(w);
  w.setTimeout = (fn, ms, ...a) => { if (ms >= 60000) { long.push({ fn, ms, live: true }); return -1e9 - long.length; } return realSet(fn, ms, ...a); };
  w.clearTimeout = (id) => { if (id <= -1e9) long[-id - 1e9 - 1].live = false; else realClear(id); };
  w.eval(code);
  return { w, long };
}

async function mount(pg = page(), lang = 'en') {
  const { w } = pg;
  const workers = []; // every worker the engine created
  const mk = () => { const k = { sent: [], terminated: false, postMessage(m) { k.sent.push(m); }, terminate() { k.terminated = true; } }; workers.push(k); return k; };
  const engine = w.T.createMatlabEngine({ createWorker: mk, baseUrl: 'https://x.test/', lang });
  const varsSeen = [];
  const origRun = engine.run;
  engine.run = (req, sink) => { const s = Object.create(sink); s.vars = (v) => { varsSeen.push(JSON.parse(JSON.stringify(v))); sink.vars?.(v); }; return origRun(req, s); };
  const el = w.document.createElement('div');
  w.document.body.append(el);
  w.T.mountShell(engine, { root: el, lang, notebook: { id: 'n', schemaVersion: 1, cells: [{ type: 'code', source: 'while true, pause(0.1); end' }] } });
  const startRun = async () => {
    const done = w.__mlweb.runAll();
    for (let i = 0; i < 50 && !workers.at(-1).sent.some((m) => m.t === 'run'); i++) await wait(10);
    assert.ok(workers.at(-1).sent.some((m) => m.t === 'run'), 'the run reached the worker');
    return { done };
  };
  const sel = () => el.querySelector('#timelimit');
  return { ...pg, el, engine, workers, varsSeen, startRun, sel };
}

test('the selector offers 60, 120 and 300 s, defaults to 60 and is not drawn by the engine', async () => {
  const m = await mount();
  assert.deepEqual([...m.sel().options].map((o) => [o.value, o.textContent]), [['60000', '60 s'], ['120000', '120 s'], ['300000', '300 s']]);
  assert.equal(m.sel().value, '60000');
  assert.equal(m.sel().getAttribute('aria-label'), 'Time limit per run');
  const ar = await mount(page(), 'ar');
  assert.equal(ar.sel().options[1].textContent, '120 ث');
});

test('the chosen limit is saved in localStorage, restored on the next mount, and bad values fall back to 60 s', async () => {
  const pg = page();
  const m = await mount(pg);
  m.sel().value = '120000'; m.sel().dispatchEvent(new pg.w.Event('change'));
  assert.equal(pg.w.localStorage.getItem('mlweb.timeLimitMs'), '120000');
  assert.equal((await mount(pg)).sel().value, '120000');
  pg.w.localStorage.setItem('mlweb.timeLimitMs', '5000');
  assert.equal((await mount(pg)).sel().value, '60000', 'a value that is not one of the options is ignored');
  pg.w.localStorage.setItem('mlweb.timeLimitMs', 'abc');
  assert.equal((await mount(pg)).engine.timeLimit.get(), 60000);
  m.engine.timeLimit.set(999); // not an option: not stored
  assert.equal(pg.w.localStorage.getItem('mlweb.timeLimitMs'), 'abc');
});

test('blocked storage does not throw: the default applies and choosing still works for the page', async () => {
  const m = await mount(page({ brokenStorage: true }));
  assert.equal(m.sel().value, '60000');
  assert.doesNotThrow(() => { m.sel().value = '300000'; m.sel().dispatchEvent(new m.w.Event('change')); });
  assert.equal(m.engine.timeLimit.get(), 60000);
});

test('the run timer uses the selected limit', async () => {
  const pg = page();
  const a = await mount(pg);
  let run = await a.startRun();
  assert.equal(a.long.filter((t) => t.live).at(-1).ms, 60000);
  a.el.querySelector('#stop').click(); await run.done;
  a.sel().value = '300000'; a.sel().dispatchEvent(new pg.w.Event('change'));
  run = await a.startRun();
  assert.equal(a.long.filter((t) => t.live).at(-1).ms, 300000);
  assert.equal(a.sel().disabled, true, 'the selector is locked while a run is active');
  a.el.querySelector('#stop').click(); await run.done;
  assert.equal(a.sel().disabled, false);
});

test('time limit: message, worker terminated and recreated, workspace reset, shell back to Ready', async () => {
  const m = await mount();
  const run = await m.startRun();
  const first = m.workers[0];
  m.long.filter((t) => t.live).at(-1).fn(); // the limit expires while the worker is busy and silent
  await run.done; await wait(20);
  assert.ok(m.el.textContent.includes(EN), 'the output ends with the reset message');
  assert.equal(first.terminated, true);
  assert.equal(m.workers.length, 2, 'a fresh worker was created');
  assert.equal(m.workers[1].terminated, false);
  assert.equal(JSON.stringify(m.varsSeen.at(-1)), '[]', 'the workspace was reset');
  assert.equal(m.el.querySelector('#status').getAttribute('aria-label'), 'Ready');
  assert.equal(m.el.querySelector('#stop').hidden, true);
  // the notebook is usable again on the new worker
  const run2 = await m.startRun();
  assert.equal(m.workers[1].sent.filter((x) => x.t === 'run').length, 1);
  m.el.querySelector('#stop').click(); await run2.done;
});

test('Stop on a busy worker (while true + pause) ends with the same message and the same recovery', async () => {
  const m = await mount();
  const run = await m.startRun();
  const first = m.workers[0];
  m.el.querySelector('#stop').click();
  await run.done; await wait(20);
  assert.ok(m.el.textContent.includes(EN));
  assert.equal(m.el.textContent.split(EN).length - 1, 1, 'the message appears once');
  assert.equal(first.terminated, true);
  assert.equal(m.workers.length, 2);
  assert.equal(JSON.stringify(m.varsSeen.at(-1)), '[]');
  assert.equal(m.el.querySelector('#status').getAttribute('aria-label'), 'Ready');
  assert.equal(m.long.filter((t) => t.live).length, 0, 'the limit timer was cancelled');
});

test('the old messages are gone and the Arabic message is used in Arabic mode', async () => {
  const m = await mount(page(), 'ar');
  const run = await m.startRun();
  m.el.querySelector('#stop').click(); await run.done; await wait(20);
  assert.ok(m.el.textContent.includes(AR));
  assert.ok(!/time limit \(60 s\)|interrupted by user/.test(m.el.textContent));
});
