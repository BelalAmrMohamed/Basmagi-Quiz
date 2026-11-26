// SVG renderer for `plot` outputs (shared/plot-view.ts) in jsdom. Expected ticks and counts are worked out by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const code = (await build({
  absWorkingDir: root, bundle: true, write: false, format: 'iife', globalName: 'T',
  stdin: {
    resolveDir: root, loader: 'ts',
    contents: `export * from './shared/plot-view'; export { renderOut } from './shared/outputs'; export { Interp } from './matlab/interp/src/index';`,
  },
})).outputFiles[0].text;
const { window: w } = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', pretendToBeVisual: true });
w.HTMLCanvasElement.prototype.getContext = () => null;
w.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,AA==';
w.eval(code);
const { T } = w;

const axes = (items, extra = {}) => ({ r: 0, c: 0, items, title: '', xlabel: '', ylabel: '', xlim: null, ylim: null, grid: false, legend: [], hold: false, colormap: null, colorbar: false, equal: false, tight: false, square: false, off: false, ...extra });
const render = (...list) => T.renderPlot({ rows: 1, cols: 1, axes: list }, { imageUrl: (iw, ih) => `stub:${iw}x${ih}` });
const all = (svg, role) => [...svg.querySelectorAll(`[data-role="${role}"]`)];
const texts = (svg, role) => all(svg, role).map((e) => e.textContent);
const box = (e) => Object.fromEntries(['x', 'y', 'width', 'height'].map((k) => [k, Number(e.getAttribute(k))]));
const plain = (v) => JSON.parse(JSON.stringify(v)); // jsdom-realm values -> this realm
const line = (x, y, spec = {}) => ({ t: 'line', x, y, spec });

test('niceTicks uses 1/2/5 steps with at most 8 ticks; formatTick follows the step', () => {
  const t = (lo, hi) => plain(T.niceTicks(lo, hi));
  assert.deepEqual(t(0, 1), { step: 0.2, ticks: [0, 0.2, 0.4, 0.6, 0.8, 1] });
  assert.deepEqual(t(-1, 1), { step: 0.5, ticks: [-1, -0.5, 0, 0.5, 1] });
  assert.deepEqual(t(-0.5, 255.5), { step: 50, ticks: [0, 50, 100, 150, 200, 250] });
  assert.deepEqual(t(0, 70000).ticks, [0, 10000, 20000, 30000, 40000, 50000, 60000, 70000]);
  assert.deepEqual([T.formatTick(0.4, 0.2), T.formatTick(1, 0.05), T.formatTick(250, 50), T.formatTick(200000, 50000)], ['0.4', '1.00', '250', '2.0e5']);
});

test('line plot: tick labels, grid, markers, title and axis labels', () => {
  const svg = render(axes([line([1, 2, 3, 4, 5], [10, 20, 15, 40, 30], { color: 'r', style: '--', marker: 'o', width: 2 })], { grid: true, title: 'T', xlabel: 'time', ylabel: 'level' }));
  assert.deepEqual(texts(svg, 'x-tick'), ['1', '2', '3', '4', '5']);
  assert.deepEqual(texts(svg, 'y-tick'), ['10', '15', '20', '25', '30', '35', '40']);
  assert.deepEqual([all(svg, 'grid').length, all(svg, 'marker').length, all(svg, 'line').length], [12, 5, 1]);
  assert.deepEqual([texts(svg, 'title'), texts(svg, 'xlabel'), texts(svg, 'ylabel')], [['T'], ['time'], ['level']]);
  const style = all(svg, 'line')[0].getAttribute('style');
  assert.match(style, /stroke:#ff0000;stroke-width:3/); assert.match(style, /stroke-dasharray:8 5/);
  assert.match(svg.getAttribute('viewBox'), /^0 0 640 420$/); assert.equal(svg.getAttribute('width'), '100%');
});

test('NaN breaks a line; marker-only specs draw no line; manual limits hide points outside', () => {
  const svg = render(axes([line([1, 2, 3, 4], [1, NaN, 3, 4])]));
  assert.equal(all(svg, 'line')[0].getAttribute('d').match(/M/g).length, 2);
  const dots = render(axes([line([1, 2, 3], [1, 2, 3], { marker: '+', style: 'none' })], { xlim: [0, 2] }));
  assert.deepEqual([all(dots, 'line').length, all(dots, 'marker').length], [0, 2]);
});

test('series take the color order in turn; the legend lists as many series as it has names', () => {
  const svg = render(axes([line([1, 2], [1, 2]), line([1, 2], [2, 3]), line([1, 2], [3, 4])], { legend: ['a', 'b'] }));
  assert.deepEqual(all(svg, 'line').map((e) => e.getAttribute('style').match(/--plot-c\d/)[0]), ['--plot-c1', '--plot-c2', '--plot-c3']);
  assert.deepEqual(texts(svg, 'legend-text'), ['a', 'b']);
});

test('bars, stems and scatter: one element per value, bars start at zero', () => {
  const bars = render(axes([{ t: 'bar', x: [1, 2, 3], y: [4, 5, 6], width: 0.8 }]));
  assert.equal(all(bars, 'bar').length, 3);
  assert.equal(texts(bars, 'y-tick')[0], '0');
  assert.deepEqual(texts(bars, 'x-tick'), ['1', '2', '3']); // extent [0.6, 3.4] widened to [0.5, 3.5]
  const frame = box(all(bars, 'frame')[0]), first = box(all(bars, 'bar')[0]);
  assert.ok(Math.abs(first.y + first.height - (frame.y + frame.height)) < 0.05, 'bar stands on the x axis');
  assert.ok(Math.abs(first.height / frame.height - 4 / 6) < 0.001, 'height is 4 of 6');
  const stem = render(axes([{ t: 'stem', x: [1, 2], y: [3, -1] }]));
  assert.deepEqual([all(stem, 'stem').length, all(stem, 'marker').length, all(stem, 'baseline').length], [2, 2, 1]);
  const sc = render(axes([{ t: 'scatter', x: [1, 2, 3], y: [3, 1, 2], filled: true }]));
  assert.equal(all(sc, 'point').length, 3);
});

test('imshow-style image: pixelated, no ticks or frame, aspect ratio kept', () => {
  const svg = render(axes([{ t: 'image', w: 4, h: 2, rgb: new Uint8Array(24) }], { title: 'img' }));
  const img = all(svg, 'image')[0], b = box(img);
  assert.equal(img.getAttribute('href'), 'stub:4x2');
  assert.match(img.getAttribute('style'), /image-rendering:pixelated/);
  assert.ok(Math.abs(b.width / b.height - 2) < 0.001, `ratio ${b.width / b.height}`);
  assert.deepEqual([all(svg, 'x-tick').length, all(svg, 'frame').length, texts(svg, 'title')], [0, 0, ['img']]);
});

test('imagesc: integer ticks, y grows downwards, colorbar labelled with the data range', () => {
  const cmap = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const svg = render(axes([{ t: 'image', w: 2, h: 3, rgb: new Uint8Array(18), ticks: true, cmap, range: [0, 4] }], { colorbar: true }));
  assert.deepEqual(texts(svg, 'x-tick'), ['1', '2']);
  const y = all(svg, 'y-tick');
  assert.deepEqual(y.map((e) => e.textContent), ['1', '2', '3']);
  assert.ok(Number(y[0].getAttribute('y')) < Number(y[2].getAttribute('y')), 'row 1 is on top');
  assert.deepEqual(texts(svg, 'color-tick'), ['0', '1', '2', '3', '4']);
  assert.equal(all(svg, 'colorbar')[0].querySelectorAll('rect').length, 5); // 4 colors + outline
});

test('subplot grid: cells are placed row-major with equal plot boxes', () => {
  const cell = (r, c, extra) => ({ ...axes([line([1, 2], [1, 2])], extra), r, c });
  const svg = T.renderPlot({ rows: 2, cols: 2, axes: [cell(0, 0, { title: 'a' }), cell(0, 1, { ylabel: 'long' }), cell(1, 0)] });
  const f = all(svg, 'frame').map(box);
  assert.equal(all(svg, 'axes').length, 3);
  assert.deepEqual([f[0].y, f[0].x, f[0].width, f[0].height], [f[1].y, f[2].x, f[2].width, f[2].height]);
  assert.ok(f[1].x > f[0].x + f[0].width && f[2].y > f[0].y + f[0].height);
});

test('an empty figure and `axis off` draw without ticks', () => {
  assert.equal(all(T.renderPlot({ rows: 1, cols: 1, axes: [] }), 'axes').length, 0);
  const svg = render(axes([line([1, 2], [1, 2])], { off: true, xlabel: 'hidden' }));
  assert.deepEqual([all(svg, 'x-tick').length, all(svg, 'xlabel').length, all(svg, 'line').length], [0, 0, 1]);
});

test('imhist of an image drawn by the interpreter: 256 bars and the gray ramp', () => {
  let spec;
  const I = new T.Interp({ print() {}, readImage: () => null, writeImage() {}, showImage() {}, newFigure() {}, figure: (_id, s) => { spec = s; } });
  I.run('g = uint8([0 100 100; 255 100 0]); imhist(g)');
  const svg = T.renderPlot(spec);
  assert.deepEqual([all(svg, 'bar').length, all(svg, 'ramp').length], [256, 1]);
  assert.deepEqual(texts(svg, 'x-tick'), ['0', '50', '100', '150', '200', '250']);
  assert.deepEqual(texts(svg, 'y-tick'), ['0', '0.5', '1.0', '1.5', '2.0', '2.5', '3.0']);
});

test('user text is never parsed as markup', () => {
  const evil = '<img src=x onerror=alert(1)>';
  const svg = render(axes([line([1], [1]), { t: 'text', x: 1, y: 1, s: evil }], { title: evil }));
  assert.equal(svg.querySelector('img'), null);
  assert.deepEqual(texts(svg, 'title'), [evil]);
});

test('plotSvgText makes a standalone file: theme variables replaced, fixed size, unique clip ids', () => {
  const a = render(axes([line([1, 2], [1, 2])])), b = render(axes([line([1, 2], [1, 2])]));
  assert.notEqual(a.querySelector('clipPath').id, b.querySelector('clipPath').id);
  const light = T.plotSvgText(a);
  assert.ok(!light.includes('var(') && light.includes('#0072bd') && light.includes('xmlns="http://www.w3.org/2000/svg"'));
  assert.match(light, / width="640"/); assert.match(light, / height="420"/);
  const themed = T.plotSvgText(a, (n) => (n === '--plot-c1' ? ' #123456' : ''), 2);
  assert.ok(themed.includes('#123456') && !themed.includes('#0072bd'));
  assert.match(themed, / width="1280"/); assert.match(themed, / height="840"/);
  assert.ok(a.outerHTML.includes('var(--plot-c1'), 'the on-screen figure keeps its variables');
});

test('the plot output card holds the figure and a Save PNG button', () => {
  const card = T.renderOut({ t: (s) => s }, {}, { k: 'plot', fig: 3, spec: { rows: 1, cols: 1, axes: [axes([line([1, 2], [1, 2])])] } });
  assert.equal(card.querySelector('.cap').firstChild.textContent, 'Figure 3');
  assert.equal(card.querySelector('.cap button').textContent, 'Save PNG');
  assert.ok(card.querySelector('svg [data-role="line"]'));
});
