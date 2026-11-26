// Phase 4a tests: figure state (subplot math, hold, replace, flush rules) and the interpreter's figure plumbing. Expected values are computed by hand.
import type { Interp } from '../src/index';
import { Figures, parseSubplot, cellOf, indexOf, FLUSH_THROTTLE_MS } from '../src/figures';
import { parseLineSpec } from '../src/lib-plot';
type Run = (name: string, src: string, check: (o: string, I: Interp) => any, expectErr?: string) => void;
type Ctx = { run: Run; val: (I: Interp, n: string) => number[]; eq: (a: any, b: any) => any; shown: any[]; plots: { id: number; spec: any }[] };

const line = (y: number[]) => ({ t: 'line' as const, x: y.map((_, i) => i + 1), y, spec: {} });
const img = (w: number, h: number) => ({ t: 'image' as const, w, h, rgb: new Uint8Array(w * h * 3) });
/** Fake clock + recording sink. */
function rig() {
  let now = 0; const log: string[] = [], plots: any[] = [];
  const F = new Figures(() => now);
  const sink = { image: (id: number, it: any) => log.push(`img${id}:${it.w}x${it.h}`), plot: (id: number, spec: any) => { log.push(`plot${id}`); plots.push(spec); } };
  return { F, sink, log, plots, at: (t: number) => { now = t; } };
}
const throws = (f: () => void, msg: string) => { try { f(); } catch (e: any) { return e.message === msg || `wrong error: ${e.message}`; } return 'no error thrown'; };

export function runPhase4(ctx: Ctx) {
  const { run, eq } = ctx;
  console.log('Phase 4a (figure state and plumbing)');
  const U = (name: string, f: () => any) => run(name, 'x = 1;', () => f());

  // ---- subplot index math ----
  U('subplot index math: row-major cells', () => {
    // 2x3 grid: p=1 -> (0,0), p=4 -> (1,0), p=6 -> (1,2); back again: (1,2) -> 6
    for (const [p, rc] of [[1, [0, 0]], [3, [0, 2]], [4, [1, 0]], [6, [1, 2]]] as const) { const r = eq(cellOf(p, 3), rc); if (r !== true) return `cellOf(${p},3): ${r}`; }
    return eq([indexOf(1, 2, 3), indexOf(0, 0, 3), indexOf(1, 0, 3)], [6, 1, 4]);
  });
  U('subplot 3-digit form: 234 = (2,3,4), 111 = (1,1,1), 999 = (9,9,9)', () => eq([parseSubplot([234]), parseSubplot([111]), parseSubplot([999]), parseSubplot([2, 2, 3])], [[2, 3, 4], [1, 1, 1], [9, 9, 9], [2, 2, 3]]));
  U('subplot argument errors', () => {
    for (const [a, m] of [[[2, 2, 5], 'Error using subplot: Index exceeds number of subplots.'], [[2, 0, 1], 'Error using subplot: Arguments must be positive integers.'], [[2.5, 2, 1], 'Error using subplot: Arguments must be positive integers.'], [[100], 'Error using subplot: Unknown command option.'], [[2, 2], 'Error using subplot: Not enough input arguments.']] as const) { const r = throws(() => parseSubplot(a as any), m); if (r !== true) return `${a}: ${r}`; }
    return true;
  });
  U('subplot(2,2,p) selects or creates the axes of that cell; same cell twice is the same axes', () => {
    const F = new Figures(), a = F.subplot([2, 2, 3]), a2 = F.subplot([2, 2, 3]), b = F.subplot([2, 2, 2]), f = F.current();
    if (a !== a2 || a.r !== 1 || a.c !== 0 || b.r !== 0 || b.c !== 1) return `cells: ${a.r},${a.c} ${b.r},${b.c}`;
    return eq([f.axes.length, f.rows, f.cols, F.gca() === b], [2, 2, 2, true]);
  });
  U('subplot with another grid replaces the axes (documented deviation: no overlapping axes)', () => {
    const F = new Figures(); F.subplot([2, 2, 1]); F.add(line([1, 2])); F.subplot([1, 2, 2]);
    const f = F.current(); return eq([f.rows, f.cols, f.axes.length, f.axes[0].r, f.axes[0].c, f.axes[0].items.length], [1, 2, 1, 0, 1, 0]);
  });

  // ---- hold semantics ----
  U('hold: without hold a new item replaces the old ones, with hold on it is added, hold off replaces again', () => {
    const F = new Figures(); F.add(line([1])); F.add(line([2]));
    const ax = F.gca(); if (ax.items.length !== 1 || (ax.items[0] as any).y[0] !== 2) return 'plain replace failed';
    F.setHold('on'); F.add(line([3])); F.add(line([4]));
    if (F.gca().items.length !== 3) return `hold on: ${F.gca().items.length} items`;
    F.setHold('off'); F.add(line([5]));
    return eq([F.gca().items.length, (F.gca().items[0] as any).y[0]], [1, 5]);
  });
  U('hold toggles with no argument; it belongs to one axes only', () => {
    const F = new Figures(); F.subplot([1, 2, 1]); F.setHold('toggle'); const a = F.gca(); F.subplot([1, 2, 2]);
    return eq([a.hold, F.gca().hold, (F.setHold('toggle'), F.gca().hold), (F.setHold('toggle'), F.gca().hold)], [true, false, true, false]);
  });
  U('replace resets title/labels/limits/legend but keeps the colormap; hold on keeps everything', () => {
    const F = new Figures(), ax = F.gca(); F.add(line([1]));
    ax.title = 'T'; ax.xlabel = 'x'; ax.xlim = [0, 9]; ax.legend = ['a']; ax.grid = true; ax.colormap = [[0, 0, 0], [1, 1, 1]];
    F.setHold('on'); F.add(line([2]));
    if (ax.title !== 'T' || ax.items.length !== 2) return 'hold on lost decorations';
    F.setHold('off'); F.add(line([3]));
    return eq([ax.title, ax.xlabel, ax.xlim, ax.legend, ax.grid, ax.colormap, ax.items.length], ['', '', null, [], false, [[0, 0, 0], [1, 1, 1]], 1]);
  });

  // ---- figure numbers ----
  U('figure numbers: lowest unused, select creates, close frees the number, close all resets', () => {
    const F = new Figures(), ids: number[] = [];
    ids.push(F.create().id, F.create().id, F.create().id);            // 1 2 3
    F.close(2); ids.push(F.curId);                                    // current was 3 -> still 3
    ids.push(F.create().id);                                          // lowest free = 2
    const s = F.select(7); ids.push(s.fig.id, s.created ? 1 : 0);     // 7 created
    const s2 = F.select(1); ids.push(s2.created ? 1 : 0, F.curId);    // existing
    F.close(1); ids.push(F.curId);                                    // current closed -> highest remaining = 7
    F.closeAll(); ids.push(F.curId);
    const e = throws(() => F.select(0), 'Error using figure: Figure number must be a positive integer.');
    if (e !== true) return e;
    return eq(ids, [1, 2, 3, 3, 2, 7, 1, 0, 1, 7, 0]);
  });
  U('gca/current create figure 1 on demand; clf empties the current figure', () => {
    const F = new Figures(); F.gca(); F.add(line([1])); const f = F.current(); F.subplot([2, 2, 4]); F.clf();
    return eq([F.curId, f.rows, f.cols, f.axes.length], [1, 1, 1, 0]);
  });

  // ---- flush rules ----
  U('flush: one undecorated image goes out as an image, once; unchanged figures are not re-posted', () => {
    const r = rig(); r.F.add(img(3, 2)); r.F.flush(r.sink); r.F.flush(r.sink, true);
    return eq(r.log, ['img1:3x2']);
  });
  U('flush: a decoration, a second item, or a subplot grid turns the figure into a plot post', () => {
    const r = rig();
    r.F.add(img(2, 2)); r.F.gca().title = 'T'; r.F.changed(); r.F.flush(r.sink, true);           // title
    r.F.create(); r.F.add(img(2, 2)); r.F.setHold('on'); r.F.add(line([1, 2])); r.F.flush(r.sink, true); // 2 items
    r.F.create(); r.F.subplot([1, 2, 1]); r.F.add(img(2, 2)); r.F.flush(r.sink, true);              // 1x2 grid, one image
    r.F.create(); r.F.subplot([1, 1, 1]); r.F.add(img(2, 2)); r.F.flush(r.sink, true);              // 1x1 subplot stays plain
    if (r.log.join() !== 'plot1,plot2,plot3,img4:2x2') return r.log.join();
    return eq([r.plots[0].axes[0].title, r.plots[1].axes[0].items.map((i: any) => i.t), r.plots[2].rows + 'x' + r.plots[2].cols], ['T', ['image', 'line'], '1x2']);
  });
  U('flush: replace by id: re-posting a figure that went image -> plot -> image keeps its id', () => {
    const r = rig(); r.F.add(img(2, 2)); r.F.flush(r.sink, true);
    r.F.gca().colorbar = true; r.F.changed(); r.F.flush(r.sink, true);
    r.F.add(img(4, 4)); r.F.flush(r.sink, true);                       // replace resets the colorbar -> plain again
    return eq(r.log, ['img1:2x2', 'plot1', 'img1:4x4']);
  });
  U('flush: throttle is 100 ms per figure, the end of the run (force) ignores it, the first post is never delayed', () => {
    const r = rig(); r.at(0); r.F.add(img(1, 1)); r.F.flush(r.sink);                // posted
    r.at(50); r.F.add(img(2, 2)); r.F.flush(r.sink);                                 // 50 ms: held back
    r.at(FLUSH_THROTTLE_MS - 1); r.F.flush(r.sink);                                  // 99 ms: still held back
    r.at(FLUSH_THROTTLE_MS); r.F.flush(r.sink);                                      // 100 ms: posted
    r.at(110); r.F.add(img(3, 3)); r.F.flush(r.sink); r.F.flush(r.sink, true);       // forced
    r.at(111); r.F.create(); r.F.add(img(5, 5)); r.F.flush(r.sink);                  // other figure: own throttle
    return eq(r.log, ['img1:1x1', 'img1:2x2', 'img1:3x3', 'img2:5x5']);
  });
  U('flush: empty figures are not posted, but a cleared figure that was posted is, so its card is emptied', () => {
    const r = rig(); r.F.create(); r.F.flush(r.sink, true);
    if (r.log.length) return 'empty figure posted';
    r.F.add(img(2, 2)); r.F.flush(r.sink, true); r.F.clf(); r.F.flush(r.sink, true);
    return eq([r.log, r.plots[0].axes.length], [['img1:2x2', 'plot1'], 0]);
  });
  U('flush: posted spec is a copy (later edits do not change it)', () => {
    const r = rig(); r.F.add(line([1, 2])); r.F.gca().title = 'A'; r.F.changed(); r.F.flush(r.sink, true);
    r.F.gca().title = 'B'; (r.F.gca().items[0] as any).y.push(9);
    return eq([r.plots[0].axes[0].title, r.plots[0].axes[0].items.length], ['A', 1]);
  });

  // ---- interpreter plumbing ----
  const A = `A=zeros(2,3,'uint8'); B=zeros(4,5,'uint8');`;
  run('imshow(I) still emits one image with the variable name', `${A} imshow(A);`, () => eq([ctx.shown.map(s => [s.w, s.h, s.tool, s.name, s.fig]), ctx.plots.length], [[[3, 2, false, 'A', 1]], 0]));
  run('imshow calls into one figure are coalesced: only the last image is posted', `${A} imshow(A); imshow(B); imshow(A);`, () => eq(ctx.shown.map(s => [s.w, s.h]), [[3, 2]]));
  run('figure starts a new figure and posts the pending one; ids are 1, 2', `${A} imshow(A); figure; imshow(B);`, () => eq(ctx.shown.map(s => [s.w, s.fig]), [[3, 1], [5, 2]]));
  run('figure(n) selects or creates figure n and h = figure returns the number', `${A} figure(3); imshow(A); h = figure; k = figure(3); imshow(B);`, (_o, I) => {
    const r = eq(ctx.shown.map(s => [s.w, s.fig]), [[3, 3], [5, 3]]); return r !== true ? r : eq([I.vars.get('h')!.data[0], I.vars.get('k')!.data[0]], [1, 3]);
  });
  run('figure 2 (command syntax) selects figure 2', `${A} figure 2\nimshow(A);`, () => eq(ctx.shown.map(s => s.fig), [2]));
  run('imtool keeps posting immediately as a tool image, after the pending imshow', `${A} imshow(A); imtool(B);`, () => eq(ctx.shown.map(s => [s.w, s.tool, s.name]), [[3, false, 'A'], [5, true, 'B']]));
  run('drawnow posts the pending figure at once, so the next imshow is a second post', `${A} imshow(A); drawnow; imshow(B);`, () => eq(ctx.shown.map(s => s.w), [3, 5]));
  run('pause posts the pending figure before waiting, so the next imshow is a second post', `${A} imshow(A); pause(0.001); imshow(B);`, () => eq(ctx.shown.map(s => s.w), [3, 5]));
  run('posts inside the 100 ms throttle are merged: only the last state of the figure is posted at the end', `${A} imshow(A); drawnow; imshow(B); drawnow; imshow(A);`, () => ctx.shown[0].w === 3 && ctx.shown[ctx.shown.length - 1].w === 3 && ctx.shown.length <= 3 || JSON.stringify(ctx.shown));
  run('every run starts with fresh figures (numbers restart at 1)', 'x = 1;', (_o, I) => {
    I.run(`${A} imshow(A);`); I.run(`${A} imshow(B);`);
    return eq(ctx.shown.map(s => [s.w, s.fig]), [[3, 1], [5, 1]]);
  });
  run('figures drawn before an error are still posted', 'x = 1;', (_o, I) => {
    try { I.run(`${A} imshow(A); error('boom');`); } catch { /* expected */ }
    return eq(ctx.shown.map(s => s.w), [3]);
  });
  run('a plot post goes to Host.figure(id, spec), never to showImage', 'x = 1;', (_o, I) => {
    I.run(`${A} imshow(A);`); I.figs.setHold('on'); I.figs.add(line([1, 2, 3])); I.flushFigures(true);
    const p = ctx.plots; return eq([ctx.shown.length, p.length, p[0].id, p[0].spec.axes[0].items.map((i: any) => i.t)], [1, 1, 1, ['image', 'line']]);
  });
  runPhase4b(ctx);
}

// ---------- Phase 4b: plotting built-ins ----------
function runPhase4b(ctx: Ctx) {
  const { run, eq, val } = ctx;
  console.log('Phase 4b (plotting built-ins)');
  /** The posted spec of figure `id` (last post). */
  const spec = (id = 1) => [...ctx.plots].reverse().find(p => p.id === id)!.spec;
  const ax = (id = 1, i = 0) => spec(id).axes[i];
  const rgb = (it: any) => Array.from(it.rgb as Uint8Array);
  const grays = (it: any) => rgb(it).filter((_, i) => i % 3 === 0);
  const rounded = (a: number[]) => a.map(v => Math.round(v * 1000) / 1000);
  /** Rows of an m-by-3 colormap variable. */
  const cmap = (I: Interp, n: string) => { const d = rounded(val(I, n)), m = d.length / 3; return Array.from({ length: m }, (_, i) => [d[i], d[i + m], d[i + 2 * m]]); };
  const first = (...checks: (true | string)[]) => checks.find(c => c !== true) ?? true;

  // ---- colormap generators ----
  run('gray(3), hot(8), bone(8) follow the MATLAB formulas', `g = gray(3); h = hot(8); b = bone(8);`, (_o, I) => first(
    eq(cmap(I, 'g'), [[0, 0, 0], [0.5, 0.5, 0.5], [1, 1, 1]]),
    eq(cmap(I, 'h'), [[0.333, 0, 0], [0.667, 0, 0], [1, 0, 0], [1, 0.333, 0], [1, 0.667, 0], [1, 1, 0], [1, 1, 0.5], [1, 1, 1]]),
    eq([cmap(I, 'b')[0], cmap(I, 'b')[7]], [[0, 0, 0.042], [1, 1, 1]])));
  run('jet(4), jet(8), hsv(6); default size is 256 and a variable named gray still wins', `j = jet(4); k = jet(8); v = hsv(6); n = size(hot); gray = 7; q = gray + 1;`, (_o, I) => first(
    eq(cmap(I, 'j'), [[0, 0, 1], [0, 1, 1], [1, 1, 0], [1, 0, 0]]),
    eq([cmap(I, 'k')[0], cmap(I, 'k')[1], cmap(I, 'k')[7]], [[0, 0, 1], [0, 0.5, 1], [0.5, 0, 0]]),
    eq(cmap(I, 'v'), [[1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 1, 1], [0, 0, 1], [1, 0, 1]]),
    eq([val(I, 'n'), val(I, 'q')], [[256, 3], [8]])));

  // ---- imshow display range ----
  run('imshow(A,[lo hi]) maps lo to black and hi to white and stays a plain image', `imshow([0 50; 100 200], [50 150]);`, (_o, I) => {
    const it: any = I.figs.current().axes[0].items[0];
    return first(eq(grays(it), [0, 0, 128, 255]), eq([it.range, ctx.shown.length, ctx.plots.length], [[50, 150], 1, 0]));
  });
  run('imshow(A,[]) uses the data min and max; a constant image is black; default range is the class range', `A = uint8([10 20 30]); imshow(A, []); figure; imshow([7 7], []); figure; imshow(A);`, (_o, I) => {
    const it = (n: number): any => I.figs.figs.get(n)!.axes[0].items[0];
    return first(eq([grays(it(1)), grays(it(2)), grays(it(3))], [[0, 128, 255], [0, 0], [10, 20, 30]]), eq([it(1).range, it(3).range], [[10, 30], [0, 255]]));
  });
  run('imshow rejects a decreasing range', `imshow([1 2], [5 5]);`, () => 0, 'Error using imshow: Display range [low high] must be increasing.');
  run("imshow('file', []) keeps the range argument", `imshow('testgray.png', []);`, (_o, I) => { const r = (I.figs.current().axes[0].items[0] as any).range; return r[0] >= 0 && r[1] <= 255 && r[0] < r[1] || `range ${r}`; });

  // ---- colormaps on images ----
  run('colormap recolors a shown grayscale image; the next imshow is gray again', `imshow(uint8([0 255])); colormap([1 0 0; 0 0 1]); figure; colormap jet\nimshow(uint8([0 255]));`, (_o, I) => {
    const it = (n: number): any => I.figs.figs.get(n)!.axes[0].items[0];
    return eq([rgb(it(1)), rgb(it(2))], [[255, 0, 0, 0, 0, 255], [0, 0, 0, 255, 255, 255]]);
  });
  run('colormap default restores the gray pixels of imshow', `imshow(uint8([0 90])); colormap hot\ncolormap('default');`, (_o, I) => eq(grays(I.figs.current().axes[0].items[0]), [0, 90]));
  run('imagesc scales to the data range through the colormap and is a plot with ticks', `imagesc([1 2; 3 4]); colormap(gray(4)); colorbar; m = colormap;`, (_o, I) => {
    const a = ax(), it = a.items[0];
    // u = 0, 1/3, 2/3, 1 -> rows 1..4 of gray(4) = 0, 85, 170, 255
    return first(eq([grays(it), it.range, it.ticks, a.colorbar], [[0, 85, 170, 255], [1, 4], true, true]), eq([cmap(I, 'm').length, ctx.shown.length], [4, 0]));
  });
  run('imagesc(C,[lo hi]) clamps; the figure colormap applies to later subplots', `colormap(gray(2)); subplot(1,2,1); imagesc([0 5 10], [0 10]); subplot(1,2,2); imagesc([1 2]);`, () =>
    eq([grays(ax(1, 0).items[0]), grays(ax(1, 1).items[0])], [[0, 255, 255], [0, 255]]));
  run('image(C) maps directly: double is 1-based, uint8 is 0-based', `colormap(gray(3)); image([1 2 3 9]); figure; colormap(gray(3)); image(uint8([0 1 2]));`, () =>
    eq([grays(ax(1).items[0]), grays(ax(2).items[0]), ax(1).items[0].range], [[0, 128, 255, 255], [0, 128, 255], [1, 3]]));
  run('image and imagesc accept RGB arrays', `A = zeros(1,2,3); A(1,2,1) = 1; image(A);`, () => eq(rgb(ax().items[0]), [0, 0, 0, 255, 0, 0]));
  run('colormap rejects bad input', `colormap([2 0 0]);`, () => 0, 'Error using colormap: Colormap must be an m-by-3 matrix with values between 0 and 1.');

  // ---- imhist ----
  run('imhist(testgray) with no output posts exactly one figure with 256 bars', `g = imread('testgray.png'); imhist(g)`, o => {
    const it = ax().items[0];
    return eq([o, ctx.plots.length, ctx.shown.length, ax().items.length, it.t, it.x.length, it.x[0], it.x[255], it.y.reduce((p: number, q: number) => p + q, 0), it.ramp], ['', 1, 0, 1, 'bar', 256, 0, 255, 40000, true]);
  });
  run('[counts, x] = imhist(I) and imhist(I, n)', `[c, x] = imhist(uint8([0 0 255])); a = [c(1) c(256) x(1) x(256)]; [d, y] = imhist(uint8([0 100 200 255]), 2); [e, z] = imhist([0 1], 3);`, (_o, I) =>
    eq([val(I, 'a'), val(I, 'd'), val(I, 'y'), val(I, 'e'), val(I, 'z'), ctx.plots.length], [[2, 1, 0, 255], [2, 2], [0, 255], [1, 0, 1], [0, 0.5, 1], 0]));
  run('imhist of a logical image draws 2 bars at 0 and 1', `imhist(logical([1 0 1]));`, () => eq([ax().items[0].x, ax().items[0].y], [[0, 1], [1, 2]]));

  // ---- plot ----
  U('parseLineSpec', () => eq(['r--o', 'k.', '-.', 'o-', 'hello', ''].map(s => parseLineSpec(s)),
    [{ color: 'r', style: '--', marker: 'o' }, { color: 'k', marker: '.', style: 'none' }, { style: '-.' }, { marker: 'o', style: '-' }, null, null]));
  function U(name: string, f: () => any) { run(name, 'x = 1;', () => f()); }
  run('plot: x, y, LineSpec and properties', `plot(1:3, [4 5 6], 'r--o', 'LineWidth', 2);`, () => eq(ax().items, [{ t: 'line', x: [1, 2, 3], y: [4, 5, 6], spec: { color: 'r', style: '--', marker: 'o', width: 2 } }]));
  run('plot: matrix columns and several groups', `plot([1 2; 3 4]); figure; plot([0 1], [2 3], 'b', [0 1], [4 5], ':', 'Color', [0 1 0]);`, () => first(
    eq(ax(1).items.map((i: any) => [i.x, i.y]), [[[1, 2], [1, 3]], [[1, 2], [2, 4]]]),
    eq(ax(2).items.map((i: any) => [i.y, i.spec]), [[[2, 3], { color: [0, 1, 0] }], [[4, 5], { style: ':', color: [0, 1, 0] }]])));
  run('plot: length mismatch', `plot([1 2], [1 2 3]);`, () => 0, 'Error using plot: Vectors must be the same length.');
  run('plot: unknown property', `plot([1 2], 'Wobble', 3);`, () => 0, "Error using plot: Unrecognized property 'Wobble'.");
  run('hold on keeps earlier series; a plain plot replaces them', `plot([1 2]); hold on\nplot([3 4]); figure; plot([1 2]); plot([3 4]);`, () => eq([ax(1).items.length, ax(2).items.length, ax(2).items[0].y], [2, 1, [3, 4]]));

  // ---- bar, stem, scatter, hist, histogram ----
  run('bar: default width, grouped columns, relative width', `bar([4 5 6]); figure; bar([1 2; 3 4]); figure; bar([10 20 30], [1 2 3], 0.5);`, () => {
    const g = ax(2).items;
    return first(eq([ax(1).items[0].x, ax(1).items[0].width], [[1, 2, 3], 0.8]),
      eq([rounded(g[0].x), rounded(g[1].x), g[0].y, g[1].y, g[0].width], [[0.8, 1.8], [1.2, 2.2], [1, 3], [2, 4], 0.4]),
      eq([ax(3).items[0].x, ax(3).items[0].width], [[10, 20, 30], 5]));
  });
  run('stem and scatter', `stem([2 4], [1 3], 'g', 'filled'); figure; scatter([1 2], [3 4], 25, 'r', 'filled');`, () => eq([ax(1).items[0], ax(2).items[0]], [
    { t: 'stem', x: [2, 4], y: [1, 3], spec: { color: 'g' }, filled: true },
    { t: 'scatter', x: [1, 2], y: [3, 4], spec: { color: 'r' }, filled: true, size: 25 }]));
  // hist, 4 bins over [1,9]: centers 2 4 6 8; 3 is a tie and goes to the lower bin
  run('hist draws without outputs and still returns numbers with them', `d = [1 2 2 3 9 9]; [n, c] = hist(d, 4); hist(d, 4)`, (o, I) =>
    eq([o, val(I, 'n'), val(I, 'c'), ax().items[0].x, ax().items[0].y, ax().items[0].width], ['', [4, 0, 0, 2], [2, 4, 6, 8], [2, 4, 6, 8], [4, 0, 0, 2], 2]));
  run('histogram: equal bins, last edge included; default bin count', `histogram([0 1 2 3 4 4], 2); figure; histogram([0 1 2 3 4 4]);`, () =>
    eq([ax(1).items[0].x, ax(1).items[0].y, ax(1).items[0].width, ax(2).items[0].y.length], [[1, 3], [2, 4], 2, 4]));

  // ---- decorations ----
  run('title, xlabel, ylabel, legend, grid, text', `plot([1 2]); title({'a','b'}); xlabel('time'); ylabel(5); legend('one', 'Location', 'best'); grid on\ntext(1, 2, 'hi');`, () => {
    const a = ax();
    return eq([a.title, a.xlabel, a.ylabel, a.legend, a.grid, a.items.map((i: any) => i.t), a.items[1]], ['a\nb', 'time', '5', ['one'], true, ['line', 'text'], { t: 'text', x: 1, y: 2, s: 'hi' }]);
  });
  run('legend({..}) / legend(show) / legend off; grid toggles; colorbar off', `plot([1 2; 3 4]); legend('show'); figure; plot(1); legend({'p','q'}); legend('off'); grid; grid; grid; colorbar; colorbar off`, () =>
    eq([ax(1).legend, ax(2).legend, ax(2).grid, ax(2).colorbar], [['data1', 'data2'], [], true, false]));
  run('axis limits and modes; xlim/ylim set, query and reset', `plot([3 7], [1 2]); q = xlim; axis([0 5 -1 1]); r = ylim; xlim([1 4]); ylim('auto');`, (_o, I) =>
    eq([val(I, 'q'), val(I, 'r'), ax().xlim, ax().ylim], [[3, 7], [-1, 1], [1, 4], null]));
  run('axis command syntax on an image turns it into a plot', `imshow(uint8([1 2])); axis on\n`, () => eq([ctx.shown.length, ax().off, ax().items[0].ticks], [0, false, true]));
  run('axis image / square / off', `imshow(uint8([1 2])); axis image off\naxis square`, () => eq([ax().equal, ax().tight, ax().off, ax().square], [true, true, true, true]));
  run('bad limits', `xlim([2 1]);`, () => 0, 'Error using xlim: Limits must be increasing.');
  run('title on an image gives one plot post with image + title', `imshow(uint8([1 2])); title('T');`, () => eq([ctx.shown.length, ctx.plots.length, ax().title, ax().items[0].t], [0, 1, 'T', 'image']));

  // ---- figures ----
  run('subplot with two images posts one 1x2 figure', `A = uint8([1 2]); subplot(1,2,1); imshow(A); title('a'); subplot(122); imshow(A);`, () =>
    eq([ctx.plots.length, ctx.shown.length, spec().rows, spec().cols, spec().axes.map((a: any) => a.title)], [1, 0, 1, 2, ['a', '']]));
  run('clf empties, close removes, figure properties are ignored', `plot(1); clf; plot([2 3]); figure('Name', 'x'); plot(1); close; figure(5); close(5); s = close('all');`, (_o, I) =>
    eq([I.figs.figs.size, val(I, 's'), ctx.plots.length >= 1], [0, [1], true]));
  run('close of a missing figure', `close(4)`, () => 0, 'Error using close: Invalid figure handle.');
  run('clear; close all; clc at the top of a script is harmless', `clear; close all; clc\nimshow(uint8([1 2]));`, () => eq(ctx.shown.length, 1));
}
