// =============================================================================
// runtimes/matlab/interp/src/figures.ts
// Figure state of one program run: figures, their subplot axes, hold semantics and the
// rules for when a changed figure is posted to the host. No DOM, no host: `flush` hands
// the result to a sink, so everything here is unit-testable.
// =============================================================================
import { MatlabError } from './parser';
import type { FigureSpec, PlotAxes, PlotItem } from '../../../shared/plot-spec';
export type { FigureSpec, PlotAxes, PlotItem } from '../../../shared/plot-spec';

export interface Fig { id: number; rows: number; cols: number; axes: PlotAxes[]; /** index into `axes` of the current axes, -1 = none */ cur: number; rev: number }

export interface FlushSink {
  /** A figure that is exactly one undecorated image: emitted as the classic `img` output. */
  image(id: number, item: Extract<PlotItem, { t: 'image' }>): void;
  /** Anything else: emitted as a `plot` output. */
  plot(id: number, spec: FigureSpec): void;
}

const fail = (m: string): never => { throw new MatlabError(m); };

/** Posting is throttled to one message per figure per this many ms (except at the end of a run). */
export const FLUSH_THROTTLE_MS = 100;

export const newAxes = (r = 0, c = 0): PlotAxes => ({
  r, c, items: [], title: '', xlabel: '', ylabel: '', xlim: null, ylim: null, grid: false, legend: [], hold: false,
  colormap: null, colorbar: false, equal: false, tight: false, square: false, off: false,
});

/** subplot(m,n,p) or the 3-digit form subplot(mnp) -> [m, n, p] (p is 1-based, row-major). Throws MATLAB-style errors. */
export function parseSubplot(args: number[]): [number, number, number] {
  let m: number, n: number, p: number;
  if (args.length === 1) {
    const v = args[0];
    if (!Number.isInteger(v) || v < 111 || v > 999) return fail('Error using subplot: Unknown command option.');
    m = Math.floor(v / 100); n = Math.floor(v / 10) % 10; p = v % 10;
  } else if (args.length === 3) [m, n, p] = args;
  else return fail('Error using subplot: Not enough input arguments.');
  if (![m, n, p].every(x => Number.isInteger(x) && x >= 1)) return fail('Error using subplot: Arguments must be positive integers.');
  if (p > m * n) return fail('Error using subplot: Index exceeds number of subplots.');
  return [m, n, p];
}
/** 1-based row-major subplot index -> 0-based [row, col]. */
export const cellOf = (p: number, cols: number): [number, number] => [Math.floor((p - 1) / cols), (p - 1) % cols];
export const indexOf = (r: number, c: number, cols: number) => r * cols + c + 1;

export class Figures {
  figs = new Map<number, Fig>();
  curId = 0;
  private posted = new Map<number, { rev: number; at: number; sent: boolean }>();
  constructor(private now: () => number = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())) {}

  /** Forget everything (start of a run: every cell run is a fresh figure session). */
  reset() { this.figs.clear(); this.posted.clear(); this.curId = 0; }

  private lowestFreeId() { let id = 1; while (this.figs.has(id)) id++; return id; }
  private touch(f: Fig) { f.rev++; }

  /** `figure`: new figure with the lowest unused number, made current. */
  create(): Fig { return this.make(this.lowestFreeId()); }
  private make(id: number): Fig {
    const f: Fig = { id, rows: 1, cols: 1, axes: [], cur: -1, rev: 0 };
    this.figs.set(id, f); this.curId = id; return f;
  }
  /** `figure(n)`: select figure n, creating it when it does not exist. `created` tells which. */
  select(n: number): { fig: Fig; created: boolean } {
    if (!Number.isInteger(n) || n < 1) return fail('Error using figure: Figure number must be a positive integer.');
    const have = this.figs.get(n);
    if (have) { this.curId = n; return { fig: have, created: false }; }
    return { fig: this.make(n), created: true };
  }
  /** Current figure; creates figure 1 (lowest free number) when none exists, like MATLAB's gcf. */
  current(): Fig { return this.figs.get(this.curId) ?? this.create(); }

  /** `clf`: empty the current figure (one cell, no axes). */
  clf() { const f = this.current(); f.rows = 1; f.cols = 1; f.axes = []; f.cur = -1; this.touch(f); }
  /** Remove figure `id`; the current figure becomes the highest remaining number (or none). */
  close(id: number) {
    if (!this.figs.delete(id)) return;
    this.posted.delete(id);
    if (this.curId === id) this.curId = this.figs.size ? Math.max(...this.figs.keys()) : 0;
  }
  closeAll() { this.figs.clear(); this.posted.clear(); this.curId = 0; }

  /** `subplot`: select (creating if needed) the axes of cell p in an m-by-n grid. A different grid replaces the old one (MLWeb: no overlapping axes). */
  subplot(args: number[]): PlotAxes {
    const [m, n, p] = parseSubplot(args), f = this.current();
    if (f.rows !== m || f.cols !== n) { f.rows = m; f.cols = n; f.axes = []; }
    const [r, c] = cellOf(p, n);
    let i = f.axes.findIndex(a => a.r === r && a.c === c);
    if (i < 0) { f.axes.push(newAxes(r, c)); i = f.axes.length - 1; }
    f.cur = i; this.touch(f);
    return f.axes[i];
  }
  /** Current axes of the current figure (created covering the whole figure when there is none). */
  gca(): PlotAxes {
    const f = this.current();
    if (f.cur < 0 || !f.axes[f.cur]) {
      if (!f.axes.length) f.axes.push(newAxes(0, 0));
      f.cur = f.axes.length - 1; this.touch(f);
    }
    return f.axes[f.cur];
  }
  /** Mark the current figure changed after the caller edited the axes returned by `gca`/`subplot` directly. */
  changed() { const f = this.figs.get(this.curId); if (f) this.touch(f); }

  /**
   * Add a plot item to the current axes. Without `hold on` the axes is first reset (items and
   * decorations, like MATLAB's NextPlot = 'replace'; the colormap is kept); with it the item is appended.
   */
  add(item: PlotItem): PlotAxes {
    const ax = this.gca();
    if (!ax.hold) { const keep = ax.colormap; Object.assign(ax, newAxes(ax.r, ax.c), { colormap: keep }); }
    ax.items.push(item); this.changed();
    return ax;
  }
  /** `hold on` / `hold off` / `hold` (toggle) on the current axes. */
  setHold(mode: 'on' | 'off' | 'toggle') {
    const ax = this.gca();
    ax.hold = mode === 'toggle' ? !ax.hold : mode === 'on';
    this.changed();
  }

  /** The single image of a figure that is nothing but one undecorated image, else null. */
  plainImage(f: Fig): Extract<PlotItem, { t: 'image' }> | null {
    if (f.rows * f.cols !== 1 || f.axes.length !== 1) return null;
    const a = f.axes[0];
    if (a.items.length !== 1 || a.items[0].t !== 'image') return null;
    if (a.title || a.xlabel || a.ylabel || a.xlim || a.ylim || a.grid || a.legend.length || a.colorbar || a.equal || a.tight || a.square || a.off) return null;
    return a.items[0];
  }

  /** Plain-data copy of a figure, safe to post (typed arrays inside items are shared, they are never mutated). */
  snapshot(f: Fig): FigureSpec {
    return { rows: f.rows, cols: f.cols, axes: f.axes.map(a => ({ ...a, items: a.items.map(i => ({ ...i })), legend: a.legend.slice(), xlim: a.xlim && [...a.xlim], ylim: a.ylim && [...a.ylim], colormap: a.colormap && a.colormap.map(r => r.slice()) } as PlotAxes)) };
  }

  /**
   * Post every figure that changed since its last post. `force` ignores the throttle (end of run).
   * Figures with nothing to draw are not posted, unless they were posted before (so a cleared figure replaces its card).
   */
  flush(sink: FlushSink, force = false) {
    for (const f of [...this.figs.values()]) {
      const last = this.posted.get(f.id);
      if (last && last.rev === f.rev) continue;
      if (!last && f.rev === 0) continue;
      const t = this.now();
      if (!force && last?.sent && t - last.at < FLUSH_THROTTLE_MS) continue;
      const drawn = f.axes.some(a => a.items.length > 0);
      if (!drawn && !last?.sent) { this.posted.set(f.id, { rev: f.rev, at: t, sent: false }); continue; }
      const img = this.plainImage(f);
      this.posted.set(f.id, { rev: f.rev, at: t, sent: true });
      if (img) sink.image(f.id, img); else sink.plot(f.id, this.snapshot(f));
    }
  }
}
