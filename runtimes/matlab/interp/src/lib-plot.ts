// =============================================================================
// runtimes/matlab/interp/src/lib-plot.ts
// Plotting built-ins (plan Phase 4b). They only edit the figure state in figures.ts;
// drawing happens later in the UI from the posted FigureSpec.
// =============================================================================
import { T, V, isT, isC, isStr, toStr, mk, num, INT_RANGE } from './values';
import { Def, T_, err } from './lib-common';
import { COLORMAPS, Cmap, parula } from './colormaps';
import type { Figures, PlotAxes, PlotItem } from './figures';
import type { LineSpec } from '../../../shared/plot-spec';

type ImageItem = Extract<PlotItem, { t: 'image' }>;
type RGB = [number, number, number];

// ---------- images: how the pixels of an image item were made, so colormap() can redo them ----------
export type ImageSource =
  /** imshow of a grayscale image: the gray levels as first mapped (r = g = b). */
  | { kind: 'gray'; rgb: Uint8Array }
  /** imagesc: position of every pixel inside the color limits, 0..1, row-major. */
  | { kind: 'scaled'; u: Float64Array }
  /** image / imshow(X,map): 0-based colormap row of every pixel, row-major. */
  | { kind: 'indexed'; ix: Int32Array; base: Cmap };
const SOURCES = new WeakMap<ImageItem, ImageSource>();
const byte = (v: number) => Math.round(255 * Math.min(1, Math.max(0, v)));

/** Recompute the pixels of an image item for `map` (null = the item's own default). */
function paint(item: ImageItem, map: Cmap | null) {
  const src = SOURCES.get(item);
  if (!src) return; // truecolor images are not affected by colormaps
  const n = item.w * item.h;
  const use = map ?? (src.kind === 'indexed' ? src.base : src.kind === 'scaled' ? parula(256) : null);
  if (!use) { item.rgb = (src as { rgb: Uint8Array }).rgb; delete item.cmap; return; }
  const m = use.length, lut = use.map(r => r.map(byte)), rgb = new Uint8Array(n * 3);
  for (let p = 0; p < n; p++) {
    const k = src.kind === 'indexed' ? src.ix[p] : Math.floor((src.kind === 'gray' ? src.rgb[p * 3] / 255 : src.u[p]) * m);
    const row = lut[Math.min(m - 1, Math.max(0, k))];
    rgb[p * 3] = row[0]; rgb[p * 3 + 1] = row[1]; rgb[p * 3 + 2] = row[2];
  }
  item.rgb = rgb; item.cmap = use;
  if (src.kind === 'indexed' && item.ticks && item.range) item.range = [item.range[0], item.range[0] + m - 1]; // image(C): labels follow the map length
}

/**
 * Put an image into the current axes. `setMap`: the axes colormap the image brings with it
 * (imshow: its own map, or null for gray); omitted: the axes keeps its colormap (imagesc, image).
 */
export function addImage(figs: Figures, item: ImageItem, source?: ImageSource, setMap?: Cmap | null) {
  const ax = figs.add(item);
  if (setMap !== undefined) ax.colormap = setMap;
  if (source) { SOURCES.set(item, source); if (setMap === undefined) paint(item, ax.colormap); else if (setMap) item.cmap = setMap; }
  figs.changed();
}

// ---------- argument helpers ----------
const COLOR_LETTERS = 'rgbcmykw';
const COLOR_NAMES: Record<string, string> = { red: 'r', green: 'g', blue: 'b', cyan: 'c', magenta: 'm', yellow: 'y', black: 'k', white: 'w' };
const STYLES = ['-', '--', ':', '-.', 'none'];
const MARKERS = ['o', '+', '*', '.', 'x', 's', 'd', '^', 'v', '>', '<', 'p', 'h'];

/** 'r--o' -> { color: 'r', style: '--', marker: 'o' }; null when the string is not a LineSpec. A marker alone means no line. */
export function parseLineSpec(s: string): LineSpec | null {
  const out: LineSpec = {};
  let i = 0;
  while (i < s.length) {
    const two = s.slice(i, i + 2), c = s[i];
    if ((two === '--' || two === '-.') && !out.style) { out.style = two; i += 2; }
    else if ((c === '-' || c === ':') && !out.style) { out.style = c; i++; }
    else if (COLOR_LETTERS.includes(c) && !out.color) { out.color = c; i++; }
    else if (MARKERS.includes(c) && !out.marker) { out.marker = c; i++; }
    else return null;
  }
  if (!s.length) return null;
  if (out.marker && !out.style) out.style = 'none';
  return out;
}

function colorOf(v: V, fn: string): string | RGB {
  if (isStr(v)) {
    const s = toStr(v).toLowerCase(), c = COLOR_NAMES[s] ?? s;
    if (c.length === 1 && COLOR_LETTERS.includes(c)) return c;
  } else if (isT(v) && v.data.length === 3 && v.data.every(x => x >= 0 && x <= 1)) return [v.data[0], v.data[1], v.data[2]];
  return err(`Error using ${fn}: Invalid color value.`);
}

/** Trailing 'Name', value pairs of a plotting call, applied to a LineSpec. */
function applyProps(spec: LineSpec, rest: V[], fn: string) {
  for (let i = 0; i < rest.length; i += 2) {
    if (!isStr(rest[i])) err(`Error using ${fn}: Data must be given before property names.`);
    const name = toStr(rest[i]), v = rest[i + 1];
    if (v === undefined) err(`Error using ${fn}: Property '${name}' needs a value.`);
    switch (name.toLowerCase()) {
      case 'linewidth': { const w = T_(v, fn).data[0]; if (!(w > 0)) err(`Error using ${fn}: LineWidth must be a positive number.`); spec.width = w; break; }
      case 'color': case 'facecolor': spec.color = colorOf(v, fn); break;
      case 'linestyle': { const s = toStr(v); if (!STYLES.includes(s)) err(`Error using ${fn}: Invalid line style.`); spec.style = s as LineSpec['style']; break; }
      case 'marker': { const s = toStr(v); if (s !== 'none' && !MARKERS.includes(s)) err(`Error using ${fn}: Invalid marker.`); spec.marker = s === 'none' ? undefined : s; break; }
      case 'markersize': case 'markerfacecolor': case 'markeredgecolor': case 'displayname': case 'edgecolor': break; // accepted, not drawn
      default: err(`Error using ${fn}: Unrecognized property '${name}'.`);
    }
  }
}

const numeric = (v: V, fn: string): T => { const t = T_(v, fn); if (t.cls === 'char') err(`Error using ${fn}: Data must be numeric.`); return t; };
const isVec = (t: T) => t.dims.length === 2 && (t.dims[0] <= 1 || t.dims[1] <= 1);
const oneTo = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

/** Split x/y data into series (MATLAB: a vector is one series, a matrix gives one series per column). */
function series(x: T | null, y: T, fn: string): { x: number[]; y: number[] }[] {
  const bad = () => err(`Error using ${fn}: Vectors must be the same length.`);
  if (y.dims.length > 2 || (x && x.dims.length > 2)) err(`Error using ${fn}: Data cannot have more than 2 dimensions.`);
  if (isVec(y) && (!x || isVec(x))) {
    if (x && x.data.length !== y.data.length) bad();
    return [{ x: x ? Array.from(x.data) : oneTo(y.data.length), y: Array.from(y.data) }];
  }
  const columns = (t: T) => Array.from({ length: t.dims[1] }, (_, j) => Array.from(t.data.subarray(j * t.dims[0], (j + 1) * t.dims[0])));
  const rowsOf = (t: T) => Array.from({ length: t.dims[0] }, (_, i) => Array.from({ length: t.dims[1] }, (_, j) => t.data[i + t.dims[0] * j]));
  if (!x) return columns(y).map(c => ({ x: oneTo(c.length), y: c }));
  if (isVec(x)) {
    const xs = Array.from(x.data);
    const sets = y.dims[0] === xs.length ? columns(y) : y.dims[1] === xs.length ? rowsOf(y) : bad();
    return sets.map(c => ({ x: xs, y: c }));
  }
  if (isVec(y)) { // matrix x against vector y
    const ys = Array.from(y.data);
    const sets = x.dims[0] === ys.length ? columns(x) : x.dims[1] === ys.length ? rowsOf(x) : bad();
    return sets.map(c => ({ x: c, y: ys }));
  }
  if (x.dims[0] !== y.dims[0] || x.dims[1] !== y.dims[1]) bad();
  const cx = columns(x);
  return columns(y).map((c, j) => ({ x: cx[j], y: c }));
}

/** Leading numeric arguments of a call, then the rest (LineSpec, flags, properties). */
function split(a: V[], max: number, fn: string): { data: T[]; rest: V[] } {
  let k = 0;
  while (k < a.length && k < max && !isStr(a[k])) k++;
  if (!k) err(`Error using ${fn}: Not enough input arguments.`);
  return { data: a.slice(0, k).map(v => numeric(v, fn)), rest: a.slice(k) };
}

/** Common tail of bar/stem/scatter: optional 'filled', a LineSpec / color string, then properties. */
function styleArgs(rest: V[], fn: string): { spec: LineSpec; filled: boolean } {
  const spec: LineSpec = {};
  let filled = false, i = 0;
  for (; i < rest.length; i++) {
    if (!isStr(rest[i])) break;
    const s = toStr(rest[i]);
    if (s.toLowerCase() === 'filled') { filled = true; continue; }
    if (COLOR_NAMES[s.toLowerCase()]) { spec.color = COLOR_NAMES[s.toLowerCase()]; continue; }
    const p = parseLineSpec(s);
    if (!p) break;
    Object.assign(spec, p);
  }
  applyProps(spec, rest.slice(i), fn);
  return { spec, filled };
}

/** Bar chart items used by bar, hist, histogram and imhist. */
export function drawBars(figs: Figures, sets: { x: number[]; y: number[]; width: number; spec?: LineSpec; ramp?: boolean }[]) {
  figs.add(...sets.map(s => ({ t: 'bar' as const, ...s })));
}
/** Smallest positive distance between two x positions (1 when there is none). */
function minGap(x: number[]): number {
  const s = x.filter(Number.isFinite).sort((a, b) => a - b);
  let g = Infinity;
  for (let i = 1; i < s.length; i++) if (s[i] > s[i - 1]) g = Math.min(g, s[i] - s[i - 1]);
  return Number.isFinite(g) ? g : 1;
}

/** A label argument: text, number or cell of lines. */
function labelText(v: V, fn: string): string {
  if (isC(v)) return v.data.map(x => labelText(x, fn)).join('\n');
  const t = T_(v, fn);
  if (t.cls === 'char') {
    const [r, c] = t.dims;
    return Array.from({ length: r }, (_, i) => String.fromCharCode(...Array.from({ length: c }, (_, j) => t.data[i + r * j]))).join('\n');
  }
  return Array.from(t.data, x => String(+x.toPrecision(5))).join('  ');
}
const word = (v: V | undefined) => (v && isStr(v) ? toStr(v).toLowerCase() : '');
function onOff(a: V[], now: boolean, fn: string): boolean {
  if (!a.length) return !now;
  const s = word(a[0]);
  if (s !== 'on' && s !== 'off') err(`Error using ${fn}: Argument must be 'on' or 'off'.`);
  return s === 'on';
}
function limits(v: V, fn: string, n: number): number[] {
  const t = numeric(v, fn);
  if (t.data.length !== n) err(`Error using ${fn}: Limits must be a ${n}-element vector.`);
  for (let i = 0; i < n; i += 2) if (!(t.data[i] < t.data[i + 1])) err(`Error using ${fn}: Limits must be increasing.`);
  return Array.from(t.data);
}
/** Data extent of an axes along x or y, for xlim/ylim queries. */
function extent(ax: PlotAxes, dim: 'x' | 'y'): [number, number] {
  let lo = Infinity, hi = -Infinity;
  const see = (v: number) => { if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } };
  for (const it of ax.items) {
    if (it.t === 'image') { see(0.5); see((dim === 'x' ? it.w : it.h) + 0.5); }
    else if (it.t === 'text') see(it[dim]);
    else { it[dim].forEach(see); if (it.t === 'bar') { if (dim === 'x') it.x.forEach(v => { see(v - it.width / 2); see(v + it.width / 2); }); else see(0); } }
  }
  return lo <= hi ? [lo, hi] : [0, 1];
}

/** imagesc / image data -> item pixels. Row-major output from a column-major matrix. */
function pixels(t: T, f: (v: number) => number): Float64Array {
  const [h, w] = t.dims, out = new Float64Array(h * w);
  for (let i = 0; i < h; i++) for (let j = 0; j < w; j++) out[i * w + j] = f(t.data[i + h * j]);
  return out;
}
const emptyImage = (t: T, range: [number, number]): ImageItem => ({ t: 'image', w: t.dims[1], h: t.dims[0], rgb: new Uint8Array(t.dims[0] * t.dims[1] * 3), range, ticks: true });
/** M-by-N-by-3 truecolor data -> image item. */
function truecolor(t: T, fn: string): ImageItem {
  const [h, w] = t.dims;
  if (t.dims.length !== 3 || t.dims[2] !== 3) err(`Error using ${fn}: Image data must be M-by-N or M-by-N-by-3.`);
  const r = INT_RANGE[t.cls], rgb = new Uint8Array(h * w * 3);
  for (let i = 0; i < h; i++) for (let j = 0; j < w; j++) for (let k = 0; k < 3; k++) { const v = t.data[i + h * j + h * w * k]; rgb[(i * w + j) * 3 + k] = byte(r ? (v - r[0]) / (r[1] - r[0]) : v); }
  return { t: 'image', w, h, rgb, ticks: true };
}

/** colormap argument: a name or an m-by-3 matrix; null = default. */
function cmapArg(v: V): Cmap | null {
  if (isStr(v)) {
    const s = toStr(v).toLowerCase();
    if (s === 'default') return null;
    return COLORMAPS[s] ? COLORMAPS[s](256) : err(`Error using colormap: Unknown colormap '${toStr(v)}'. Supported: ${Object.keys(COLORMAPS).join(', ')}.`);
  }
  const t = T_(v, 'colormap'), m = t.dims[0];
  if (t.dims.length !== 2 || t.dims[1] !== 3 || !m || t.data.some(x => !(x >= 0 && x <= 1))) err('Error using colormap: Colormap must be an m-by-3 matrix with values between 0 and 1.');
  return Array.from({ length: m }, (_, i) => [t.data[i], t.data[i + m], t.data[i + 2 * m]]);
}
const cmapValue = (map: Cmap): T => mk('double', [map.length, 3], [0, 1, 2].flatMap(k => map.map(r => r[k])));

export function registerPlot(def: Def) {
  // ---------- figures and axes ----------
  def('clf', (_a, _n, I) => { I.figs.clf(); return []; });
  def('close', (a, nargout, I) => {
    const figs: Figures = I.figs;
    if (word(a[0]) === 'all') figs.closeAll();
    else if (a.length) {
      const n = isStr(a[0]) ? Number(toStr(a[0])) : T_(a[0], 'close').data[0];
      if (!figs.figs.has(n)) err('Error using close: Invalid figure handle.');
      figs.close(n);
    } else figs.close(figs.curId);
    return nargout > 0 ? [num(1)] : [];
  });
  def('subplot', (a, _n, I) => {
    I.figs.subplot(a.map(v => { const t = numeric(v, 'subplot'); if (t.data.length !== 1) err('Error using subplot: Arguments must be positive integers.'); return t.data[0]; }));
    return [];
  });

  // ---------- decorations ----------
  for (const fn of ['title', 'xlabel', 'ylabel'] as const) {
    def(fn, (a, _n, I) => {
      if (!a.length) err(`Error using ${fn}: Not enough input arguments.`);
      const s = labelText(a[0], fn); I.figs.gca()[fn] = s; I.figs.changed(); return [];
    });
  }
  def('legend', (a, _n, I) => {
    const ax: PlotAxes = I.figs.gca(), names: string[] = [];
    const first = word(a[0]);
    if (a.length === 1 && (first === 'off' || first === 'hide')) ax.legend = [];
    else if (!a.length || (a.length === 1 && first === 'show')) { if (!ax.legend.length) ax.legend = ax.items.filter(i => i.t !== 'text' && i.t !== 'image').map((_, i) => `data${i + 1}`); }
    else {
      for (let i = 0; i < a.length; i++) {
        const v = a[i];
        if (/^(location|orientation|fontsize|box|interpreter|textcolor|numcolumns)$/.test(word(v))) { i++; continue; }
        if (isC(v)) names.push(...v.data.map(x => labelText(x, 'legend'))); else names.push(labelText(v, 'legend'));
      }
      ax.legend = names;
    }
    I.figs.changed(); return [];
  });
  def('text', (a, _n, I) => {
    if (a.length < 3) err('Error using text: Not enough input arguments (expected text(x, y, str)).');
    const x = numeric(a[0], 'text'), y = numeric(a[1], 'text'), s = a[2];
    if (x.data.length !== y.data.length) err('Error using text: Vectors must be the same length.');
    if (isC(s) && s.data.length !== x.data.length && x.data.length !== 1) err('Error using text: The number of strings must match the number of positions.');
    const items = Array.from(x.data, (xv, i) => ({ t: 'text' as const, x: xv, y: y.data[i], s: isC(s) && x.data.length > 1 ? labelText(s.data[i], 'text') : labelText(s, 'text') }));
    I.figs.annotate(...items); return []; // text never replaces what is already drawn
  });
  def('grid', (a, _n, I) => { const ax = I.figs.gca(); ax.grid = onOff(a, ax.grid, 'grid'); I.figs.changed(); return []; });
  def('hold', (a, _n, I) => {
    const s = word(a[0]);
    if (a.length && !['on', 'off', 'all'].includes(s)) err("Error using hold: Argument must be 'on' or 'off'.");
    I.figs.setHold(!a.length ? 'toggle' : s === 'off' ? 'off' : 'on'); return [];
  });
  def('colorbar', (a, _n, I) => {
    const s = word(a[0]); I.figs.gca().colorbar = !(s === 'off' || s === 'hide'); I.figs.changed(); return [];
  });
  def('axis', (a, _n, I) => {
    const ax: PlotAxes = I.figs.gca();
    if (!a.length) err('Error using axis: Not enough input arguments.');
    for (const v of a) {
      if (!isStr(v)) { const l = limits(v, 'axis', 4); ax.xlim = [l[0], l[1]]; ax.ylim = [l[2], l[3]]; ax.tight = false; continue; }
      switch (word(v)) {
        case 'tight': ax.tight = true; ax.xlim = null; ax.ylim = null; break;
        case 'equal': ax.equal = true; break;
        case 'square': ax.square = true; break;
        case 'image': ax.equal = true; ax.tight = true; break;
        case 'off': ax.off = true; break;
        case 'on': ax.off = false; for (const it of ax.items) if (it.t === 'image') it.ticks = true; break;
        case 'auto': ax.xlim = null; ax.ylim = null; ax.tight = false; break;
        case 'normal': ax.equal = false; ax.square = false; break;
        default: err(`Error using axis: Unknown command option '${toStr(v)}'.`);
      }
    }
    I.figs.changed(); return [];
  });
  for (const [fn, key, dim] of [['xlim', 'xlim', 'x'], ['ylim', 'ylim', 'y']] as const) {
    def(fn, (a, _n, I) => {
      const ax: PlotAxes = I.figs.gca();
      if (!a.length) return [mk('double', [1, 2], ax[key] ?? extent(ax, dim))];
      if (word(a[0]) === 'auto') ax[key] = null; else { const l = limits(a[0], fn, 2); ax[key] = [l[0], l[1]]; }
      I.figs.changed(); return [];
    });
  }

  // ---------- plots ----------
  def('plot', (a, _n, I) => {
    const items: Extract<PlotItem, { t: 'line' }>[] = [];
    let i = 0;
    while (i < a.length && !isStr(a[i])) {
      const first = numeric(a[i++], 'plot');
      const second = i < a.length && !isStr(a[i]) ? numeric(a[i++], 'plot') : null;
      let spec: LineSpec = {};
      if (i < a.length && isStr(a[i])) { const p = parseLineSpec(toStr(a[i])); if (p) { spec = p; i++; } }
      for (const s of series(second ? first : null, second ?? first, 'plot')) items.push({ t: 'line', ...s, spec: { ...spec } });
    }
    if (!items.length) err('Error using plot: Not enough input arguments.');
    const rest = a.slice(i);
    for (const it of items) applyProps(it.spec, rest, 'plot');
    I.figs.add(...items); return [];
  });
  def('bar', (a, _n, I) => {
    const { data, rest } = split(a, 3, 'bar');
    let rel = 0.8;
    // bar(x,y,width) or bar(y,width): a trailing scalar after a longer y is the relative width
    const last = data[data.length - 1];
    if (data.length === 3 || (data.length === 2 && last.data.length === 1 && data[0].data.length > 1)) { rel = last.data[0]; data.pop(); }
    if (!(rel > 0)) err('Error using bar: Width must be a positive number.');
    const sets = series(data.length > 1 ? data[0] : null, data[data.length - 1], 'bar');
    const { spec } = styleArgs(rest, 'bar');
    // several series are drawn side by side inside one group
    const k = sets.length, group = rel * minGap(sets[0].x), w = group / k;
    drawBars(I.figs, sets.map((s, j) => ({ x: s.x.map(v => v + (j - (k - 1) / 2) * w), y: s.y, width: w, spec: { ...spec } })));
    return [];
  });
  def('stem', (a, _n, I) => {
    const { data, rest } = split(a, 2, 'stem');
    const { spec, filled } = styleArgs(rest, 'stem');
    I.figs.add(...series(data.length > 1 ? data[0] : null, data[data.length - 1], 'stem').map(s => ({ t: 'stem' as const, ...s, spec: { ...spec }, filled })));
    return [];
  });
  def('scatter', (a, _n, I) => {
    const { data, rest } = split(a, 4, 'scatter');
    if (data.length < 2) err('Error using scatter: Not enough input arguments.');
    const [x, y, size, color] = data;
    if (x.data.length !== y.data.length) err('Error using scatter: X and Y must be vectors of the same length.');
    const { spec, filled } = styleArgs(rest, 'scatter');
    if (color) spec.color = colorOf(color, 'scatter');
    if (size && size.data.length > 1) err('Error using scatter: Only one marker size for all points is supported.');
    I.figs.add({ t: 'scatter', x: Array.from(x.data), y: Array.from(y.data), spec, filled, ...(size?.data.length ? { size: size.data[0] } : {}) });
    return [];
  });
  def('histogram', (a, nargout, I) => {
    if (nargout > 0) err('Error using histogram: Output arguments are not supported; use [n, x] = hist(data, k).');
    if (!a.length) err('Error using histogram: Not enough input arguments.');
    const v = Array.from(numeric(a[0], 'histogram').data).filter(Number.isFinite);
    let i = 1, k: number | undefined;
    if (a[i] && !isStr(a[i])) k = T_(a[i++], 'histogram').data[0];
    else if (word(a[i]) === 'numbins' && a[i + 1]) { k = T_(a[i + 1], 'histogram').data[0]; i += 2; }
    if (k !== undefined && !(Number.isInteger(k) && k >= 1)) err('Error using histogram: Number of bins must be a positive integer.');
    const { spec } = styleArgs(a.slice(i), 'histogram');
    k ??= Math.ceil(Math.log2(Math.max(1, v.length))) + 1;
    let lo = v.length ? v.reduce((p, q) => Math.min(p, q)) : 0, hi = v.length ? v.reduce((p, q) => Math.max(p, q)) : 1;
    if (lo === hi) { lo -= 0.5; hi += 0.5; }
    const w = (hi - lo) / k, counts = new Array(k).fill(0);
    for (const q of v) counts[Math.min(k - 1, Math.floor((q - lo) / w))]++;
    drawBars(I.figs, [{ x: counts.map((_, j) => lo + (j + 0.5) * w), y: counts, width: w, spec }]);
    return [];
  });

  // ---------- scaled and indexed images ----------
  def('imagesc', (a, _n, I) => {
    if (!a.length || a.length > 2) err('Error using imagesc: Use imagesc(C) or imagesc(C, [lo hi]).');
    const t = numeric(a[0], 'imagesc');
    if (t.dims.length > 2) { addImage(I.figs, truecolor(t, 'imagesc')); return []; }
    let lo = Infinity, hi = -Infinity;
    if (a[1]) [lo, hi] = limits(a[1], 'imagesc', 2);
    else {
      for (const v of t.data) if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
      if (lo > hi) { lo = 0; hi = 1; } else if (lo === hi) { lo -= 1; hi += 1; }
    }
    const u = pixels(t, v => (v !== v ? 0 : Math.min(1, Math.max(0, (v - lo) / (hi - lo)))));
    addImage(I.figs, emptyImage(t, [lo, hi]), { kind: 'scaled', u }); return [];
  });
  def('image', (a, _n, I) => {
    if (a.length !== 1) err('Error using image: Use image(C).');
    const t = numeric(a[0], 'image');
    if (t.dims.length > 2) { addImage(I.figs, truecolor(t, 'image')); return []; }
    // MATLAB direct mapping: double/single values are 1-based colormap rows, integer and logical values 0-based
    const base = t.cls === 'double' || t.cls === 'single' ? 1 : 0, map = I.figs.gca().colormap ?? parula(256);
    const ix = Int32Array.from(pixels(t, v => (v !== v ? 0 : Math.floor(v) - base)));
    addImage(I.figs, emptyImage(t, [base, base + map.length - 1]), { kind: 'indexed', ix, base: parula(256) }); return [];
  });

  // ---------- colormaps ----------
  def('colormap', (a, nargout, I) => {
    const figs: Figures = I.figs;
    if (a.length) {
      const map = cmapArg(a[a.length - 1]);
      figs.gca(); const f = figs.current(); f.cmap = map;
      for (const ax of f.axes) { ax.colormap = map; for (const it of ax.items) if (it.t === 'image') paint(it, map); }
      figs.changed();
    }
    if (a.length && nargout === 0) return [];
    const ax = figs.gca(), img = ax.items.find(i => i.t === 'image') as ImageItem | undefined;
    return [cmapValue(ax.colormap ?? img?.cmap ?? parula(256))];
  });
  for (const name of ['gray', 'jet', 'hot', 'bone', 'hsv']) {
    def(name, a => {
      const m = a.length ? T_(a[0], name).data[0] : 256;
      if (!Number.isFinite(m)) err(`Error using ${name}: Number of colors must be a finite number.`);
      return [cmapValue(COLORMAPS[name](Math.max(0, Math.floor(m))))];
    });
  }
}
