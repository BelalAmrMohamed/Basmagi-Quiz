// Phase 6.4: large-image guard. Real engine and shell in jsdom; the image decoder and the worker are fake.
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import path from 'node:path';
import { writeFileSync, rmSync } from 'node:fs';

const root = path.join(import.meta.dirname, '..');
const entryFile = path.join(root, '_imageguard-entry.ts');
writeFileSync(entryFile, `export { mountShell } from './shared/shell';
export { createMatlabEngine } from './matlab/src/engine';
export { classifyImageSize, megapixels, LARGE_IMAGE_MP, MAX_IMAGE_MP, resetLargeImageNotice } from './shared/images';`);
let code;
try {
  code = (await build({
    absWorkingDir: root, entryPoints: ['_imageguard-entry.ts'], bundle: true, write: false, format: 'iife', globalName: 'T',
    loader: { '.css': 'empty' },
    alias: { '@codemirror/state': path.resolve(root, 'node_modules/@codemirror/state'), '@codemirror/view': path.resolve(root, 'node_modules/@codemirror/view') },
    define: { 'process.env.NODE_ENV': '"test"' },
  })).outputFiles[0].text;
} finally { rmSync(entryFile); }

const NOTICE = (mp) => `Large image (${mp} MP): pixel loops will be slow. Consider imresize first.`;
const REJECT = (w, h, mp) => `Image too large (${w}×${h}, ${mp} MP). Images above 8 MP are not accepted: each pixel is stored as an 8-byte double, so memory grows 8 times. Resize the image before uploading it.`;

function page() {
  const dom = new JSDOM('<!doctype html><body><div id="root"></div></body>', { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://x.test/' });
  const w = dom.window;
  w.Window.prototype.scrollTo = () => {};
  w.Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} });
  w.Range.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 });
  w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  w.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  // The file name encodes the size: "<w>x<h>.png". Canvas and decoder are stubs.
  const decoded = [];
  w.createImageBitmap = async (f) => { const [W, H] = f.name.replace('.png', '').split('x').map(Number); decoded.push(f.name); return { width: W, height: H, closed: false, close() { this.closed = true; } }; };
  w.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {}, getImageData: (_x, _y, W, H) => ({ data: new Uint8ClampedArray(W * H * 4) }) });
  w.eval(code);
  return { w, decoded };
}
const file = (w, name) => new w.File(['x'], name, { type: 'image/png' });

async function mount(lang = 'en') {
  const pg = page(), { w } = pg;
  const sent = [];
  const engine = w.T.createMatlabEngine({ createWorker: () => ({ postMessage(m) { sent.push(m); }, terminate() {} }), baseUrl: 'https://x.test/', lang });
  const el = w.document.createElement('div'); w.document.body.append(el);
  w.T.mountShell(engine, { root: el, lang, notebook: { id: 'n', schemaVersion: 1, cells: [{ type: 'code', source: 'x = 1' }] } });
  const messages = [];
  engine.attach({ codeSources: () => [], notify: (m) => messages.push(m) }); // replaces the shell's host so the test records notices
  return { ...pg, engine, sent, messages, put: (n) => sent.filter((m) => m.t === 'putFile' && m.name === n).length };
}

test('thresholds: exactly 2 MP is ok, one pixel more is large; exactly 8 MP is large, one pixel more is too large', () => {
  const { w } = page();
  const c = w.T.classifyImageSize;
  assert.deepEqual([w.T.LARGE_IMAGE_MP, w.T.MAX_IMAGE_MP], [2, 8]);
  assert.deepEqual([c(1, 1), c(2000, 1000), c(2000001, 1), c(1000, 2001), c(4000, 2000), c(8000001, 1), c(4001, 2000)],
    ['ok', 'ok', 'large', 'large', 'large', 'too-large', 'too-large']);
  assert.equal(w.T.megapixels(4000, 2000), 8);
});

test('an image of exactly 2 MP loads silently', async () => {
  const m = await mount();
  await m.engine.addFile(file(m.w, '2000x1000.png'));
  assert.deepEqual(m.messages, []);
  assert.equal(m.engine.files.has('2000x1000.png'), true);
  assert.equal(m.put('2000x1000.png'), 1);
});

test('above 2 MP: loads, with the notice text (English)', async () => {
  const m = await mount();
  await m.engine.addFile(file(m.w, '2000001x1.png'));
  assert.deepEqual(m.messages, [NOTICE(2)]);
  assert.equal(m.engine.files.has('2000001x1.png'), true);
  assert.equal(m.put('2000001x1.png'), 1);
  await m.engine.addFile(file(m.w, '3000x1000.png'));
  assert.equal(m.messages.length, 1, 'the notice is shown only once');
  assert.equal(m.engine.files.has('3000x1000.png'), true, 'the second large image still loads');
});

test('exactly 8 MP is accepted (with the notice); the notice shows the size with one decimal', async () => {
  const m = await mount();
  await m.engine.addFile(file(m.w, '4000x2000.png'));
  assert.deepEqual(m.messages, [NOTICE(8)]);
  assert.equal(m.engine.files.has('4000x2000.png'), true);
  const n = await mount();
  await n.engine.addFile(file(n.w, '1500x1500.png'));
  assert.deepEqual(n.messages, [NOTICE(2.3)]);
});

test('above 8 MP is rejected before any pixel buffer: clear message, nothing stored, nothing sent to the worker', async () => {
  const m = await mount();
  await assert.rejects(m.engine.addFile(file(m.w, '8000001x1.png')), { message: REJECT(8000001, 1, 8) });
  assert.equal(m.engine.files.has('8000001x1.png'), false);
  assert.equal(m.put('8000001x1.png'), 0);
  assert.deepEqual(m.messages, [], 'a rejection is an error, not the slowness notice');
  await assert.rejects(m.engine.addFile(file(m.w, '4001x2000.png')), { message: REJECT(4001, 2000, 8) });
  assert.match(REJECT(4001, 2000, 8), /Resize the image before uploading/);
});

test('a rejected image does not use up the once-only notice', async () => {
  const m = await mount();
  await assert.rejects(m.engine.addFile(file(m.w, '5000x5000.png')));
  await m.engine.addFile(file(m.w, '3000x1000.png'));
  assert.deepEqual(m.messages, [NOTICE(3)]);
});

test('the shell upload path (__mlweb.addFile) rejects the same way and keeps the file list unchanged', async () => {
  const m = await mount();
  const before = [...m.w.__mlweb.files.keys()];
  await assert.rejects(m.w.__mlweb.addFile(file(m.w, '9000x9000.png')), /Image too large \(9000×9000, 81 MP\)/);
  assert.deepEqual([...m.w.__mlweb.files.keys()], before);
});

test('Arabic mode: both messages are translated', async () => {
  const m = await mount('ar');
  await m.engine.addFile(file(m.w, '3000x1000.png'));
  assert.equal(m.messages[0], 'صورة كبيرة (3 ميجابكسل): حلقات البكسل ستكون بطيئة. جرّب imresize أولًا.');
  await assert.rejects(m.engine.addFile(file(m.w, '9000x1000.png')), { message: 'الصورة كبيرة جدًا (9000×1000، 9 ميجابكسل). لا تُقبل الصور التي تزيد على 8 ميجابكسل: يُخزَّن كل بكسل كعدد double من 8 بايت فتزداد الذاكرة 8 أضعاف. صغّر الصورة قبل رفعها.' });
});
