// Phase 4a tests: figure state (subplot math, hold, replace, flush rules) and the interpreter's figure plumbing. Expected values are computed by hand.
import type { Interp } from '../src/index';
import { Figures, parseSubplot, cellOf, indexOf, FLUSH_THROTTLE_MS } from '../src/figures';
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
}
