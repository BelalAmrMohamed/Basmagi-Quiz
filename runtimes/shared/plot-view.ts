// =============================================================================
// runtimes/shared/plot-view.ts
// Draws a `plot` output (FigureSpec) as SVG, built only with createElementNS (decision D2), so
// user text never passes through an HTML parser. Colors are CSS variables with light fallbacks
// (themes in styles/tokens.css); plotSvgText() replaces them for standalone files (PNG, export).
// =============================================================================
import type { FigureSpec, PlotAxes, PlotItem, LineSpec } from './plot-spec';
import { rgbToDataUrl, toBlob } from './images';

type Attrs = Record<string, string | number>;
type Limits = [number, number];
type Box = { x: number; y: number; w: number; h: number };
type Series = Exclude<PlotItem, { t: 'image' } | { t: 'text' }>;
type ImageItem = Extract<PlotItem, { t: 'image' }>;

export interface PlotOptions {
  /** Row-major RGB pixels -> image URL. Default: a PNG data URL made with a canvas. */
  imageUrl?: (w: number, h: number, rgb: Uint8Array) => string;
  doc?: Document;
}

const NS = 'http://www.w3.org/2000/svg';
const INK = 'var(--plot-ink, #1d2433)', BG = 'var(--plot-bg, #ffffff)', GRID = 'var(--plot-grid, #dfe3ea)';
/** MATLAB's default color order, used for series without an explicit color. */
const ORDER = ['#0072bd', '#d95319', '#c8930c', '#7e2f8e', '#5f9320', '#1f9fd0', '#a2142f'].map((c, i) => `var(--plot-c${i + 1}, ${c})`);
const NAMED: Record<string, string> = { r: '#ff0000', g: '#00b400', b: '#0000ff', c: '#00bcbc', m: '#d000d0', y: '#d6b400', k: INK, w: '#ffffff' };
const DASH: Record<string, string> = { '--': '8 5', ':': '2 4', '-.': '9 4 2 4' };
const TICK_FONT = 11, LABEL_FONT = 12.5, TITLE_FONT = 14, LINE_H = 17, CHAR = 0.6;

// ---------- numbers ----------
/** Tick positions inside [lo, hi]: the smallest 1/2/5 step giving at most `max` ticks (normally 4 to 8). */
export function niceTicks(lo: number, hi: number, max = 8, minStep = 0): { step: number; ticks: number[] } {
  const span = hi - lo;
  if (!(span > 0) || !Number.isFinite(span)) return { step: 1, ticks: Number.isFinite(lo) ? [lo] : [] };
  let step = 0;
  for (let e = Math.floor(Math.log10(span / max)) - 1; !step; e++) {
    for (const m of [1, 2, 5]) {
      const s = m * 10 ** e;
      if (s >= minStep && Math.floor(hi / s + 1e-9) - Math.ceil(lo / s - 1e-9) + 1 <= max) { step = s; break; }
    }
  }
  const ticks: number[] = [];
  for (let k = Math.ceil(lo / step - 1e-9); k <= Math.floor(hi / step + 1e-9); k++) ticks.push(+(k * step).toPrecision(12));
  return { step, ticks };
}
export function formatTick(v: number, step: number): string {
  if (v === 0) return '0';
  if (Math.abs(v) >= 1e5 || step < 1e-4) return v.toExponential(Math.max(0, Math.min(6, Math.floor(Math.log10(Math.abs(v))) - Math.floor(Math.log10(step))))).replace('e+', 'e');
  return v.toFixed(Math.max(0, -Math.floor(Math.log10(step) + 1e-9)));
}

/** [lo, hi] of one coordinate over everything drawn on the axes (text does not rescale, as in MATLAB). */
function extent(ax: PlotAxes, dim: 'x' | 'y'): Limits | null {
  let lo = Infinity, hi = -Infinity;
  const see = (v: number) => { if (Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } };
  for (const it of ax.items) {
    if (it.t === 'text') continue;
    if (it.t === 'image') { see(0.5); see((dim === 'x' ? it.w : it.h) + 0.5); continue; }
    for (const v of it[dim]) { if (it.t === 'bar' && dim === 'x') { see(v - it.width / 2); see(v + it.width / 2); } else see(v); }
    if (dim === 'y' && (it.t === 'bar' || it.t === 'stem')) see(0);
  }
  return lo <= hi ? [lo, hi] : null;
}
function limitsOf(ax: PlotAxes, dim: 'x' | 'y'): Limits {
  const manual = dim === 'x' ? ax.xlim : ax.ylim;
  if (manual) return manual;
  let [lo, hi] = extent(ax, dim) ?? [0, 1];
  if (lo === hi) { lo -= 1; hi += 1; }
  const exact = ax.tight || ax.items.some(i => i.t === 'image') || (dim === 'x' && ax.items.some(i => i.t === 'bar' && i.ramp));
  if (exact) return [lo, hi];
  const { step } = niceTicks(lo, hi); // widen to whole tick steps
  return [+(Math.floor(lo / step + 1e-9) * step).toPrecision(12), +(Math.ceil(hi / step - 1e-9) * step).toPrecision(12)];
}

// ---------- per-axes layout ----------
interface Plan {
  ax: PlotAxes; xl: Limits; yl: Limits; xt: ReturnType<typeof niceTicks>; yt: ReturnType<typeof niceTicks>;
  /** No box, ticks or labels: `axis off`, and imshow images. */
  hidden: boolean; reverse: boolean;
  ramp: Extract<PlotItem, { t: 'bar' }> | undefined;
  bar?: { map: number[][] | null; range: Limits; ticks: ReturnType<typeof niceTicks> };
  m: { l: number; r: number; t: number; b: number };
}
const lines = (s: string) => (s ? s.split('\n') : []);
const textWidth = (s: string, font: number) => s.length * font * CHAR;

function plan(ax: PlotAxes): Plan {
  const images = ax.items.filter((i): i is ImageItem => i.t === 'image');
  const hidden = ax.off || (images.length > 0 && !images.some(i => i.ticks));
  const xl = limitsOf(ax, 'x'), yl = limitsOf(ax, 'y'), whole = images.length ? 1 : 0;
  // a few bar groups centered on whole numbers get whole-number ticks only, as in MATLAB
  const bars = ax.items.filter((i): i is Extract<PlotItem, { t: 'bar' }> => i.t === 'bar' && !i.ramp);
  const groups = bars.length > 0 && xl[1] - xl[0] <= 20 && bars[0].x.every((_, i) => { const c = bars.reduce((s, b) => s + b.x[i], 0) / bars.length; return Math.abs(c - Math.round(c)) < 1e-9; });
  const xt = niceTicks(xl[0], xl[1], 8, groups ? 1 : whole), yt = niceTicks(yl[0], yl[1], 8, whole);
  const ramp = ax.items.find((i): i is Extract<PlotItem, { t: 'bar' }> => i.t === 'bar' && !!i.ramp);
  let bar: Plan['bar'];
  if (ax.colorbar) {
    const img = images[images.length - 1];
    let range: Limits = img?.range ?? [0, 1];
    if (!(range[1] > range[0])) range = [range[0], range[0] + 1];
    bar = { map: img?.cmap ?? (img ? null : ax.colormap), range, ticks: niceTicks(range[0], range[1]) };
  }
  const yw = Math.max(0, ...yt.ticks.map(v => textWidth(formatTick(v, yt.step), TICK_FONT)));
  const barW = bar ? 28 + Math.max(0, ...bar.ticks.ticks.map(v => textWidth(formatTick(v, bar!.ticks.step), TICK_FONT))) : 0;
  const m = {
    l: 10 + (hidden ? 0 : yw + 8 + lines(ax.ylabel).length * LINE_H),
    r: 16 + barW,
    t: 12 + lines(ax.title).length * LINE_H,
    b: 10 + (hidden ? 0 : 18 + lines(ax.xlabel).length * LINE_H) + (ramp && !hidden ? 14 : 0),
  };
  return { ax, xl, yl, xt, yt, hidden, reverse: images.length > 0, ramp, bar, m };
}

// ---------- drawing ----------
let uid = 0;

export function renderPlot(spec: FigureSpec, opts: PlotOptions = {}): SVGSVGElement {
  const doc = opts.doc ?? document, imageUrl = opts.imageUrl ?? rgbToDataUrl;
  const prefix = `plot${++uid}-${Math.random().toString(36).slice(2, 7)}`;
  const el = (parent: Element | null, tag: string, attrs: Attrs = {}): SVGElement => {
    const e = doc.createElementNS(NS, tag) as SVGElement;
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    parent?.appendChild(e);
    return e;
  };
  const paint = (fill: string, stroke = 'none', width = 1) => `fill:${fill};stroke:${stroke};stroke-width:${width}`;
  const n = (v: number) => +v.toFixed(2);
  const text = (parent: Element, x: number, y: number, s: string, o: { size?: number; anchor?: string; bold?: boolean; role: string; transform?: string }) => {
    const t = el(parent, 'text', { x: n(x), y: n(y), 'font-size': o.size ?? TICK_FONT, 'text-anchor': o.anchor ?? 'middle', 'data-role': o.role, style: paint(INK) + (o.bold ? ';font-weight:600' : '') });
    if (o.transform) t.setAttribute('transform', o.transform);
    const ls = s.split('\n');
    if (ls.length === 1) t.textContent = s;
    else ls.forEach((l, i) => { el(t, 'tspan', { x: n(x), dy: i ? LINE_H : 0 }).textContent = l; });
    return t;
  };
  const stops = (defs: Element, id: string, x1: number, x2: number) => {
    const g = el(defs, 'linearGradient', { id, gradientUnits: 'userSpaceOnUse', x1: n(x1), x2: n(x2), y1: 0, y2: 0 });
    el(g, 'stop', { offset: 0, 'stop-color': '#000000' }); el(g, 'stop', { offset: 1, 'stop-color': '#ffffff' });
  };

  const rows = Math.max(1, spec.rows), cols = Math.max(1, spec.cols);
  const W = Math.max(640, cols * 260), cw = W / cols;
  const ch = rows === 1 && cols === 1 ? 420 : Math.min(400, Math.max(230, cw * 0.8));
  const H = rows * ch;
  const svg = el(null, 'svg', {
    viewBox: `0 0 ${W} ${n(H)}`, width: '100%', role: 'img',
    style: `display:block;max-width:${W}px;height:auto;direction:ltr;font-family:system-ui,-apple-system,"Segoe UI",sans-serif`,
  }) as SVGSVGElement;
  el(svg, 'rect', { x: 0, y: 0, width: W, height: n(H), style: paint(BG), 'data-role': 'background' });
  const defs = el(svg, 'defs');

  const plans = spec.axes.map(plan);
  // shared left/top/bottom margins keep the plot boxes of a subplot grid aligned
  const shared = (k: 'l' | 't' | 'b') => Math.max(0, ...plans.map(p => p.m[k]));
  const ml = shared('l'), mt = shared('t'), mb = shared('b');

  plans.forEach((p, index) => {
    const { ax, xl, yl } = p;
    const dx = xl[1] - xl[0], dy = yl[1] - yl[0];
    const box: Box = { x: ax.c * cw + ml, y: ax.r * ch + mt, w: Math.max(20, cw - ml - p.m.r), h: Math.max(20, ch - mt - mb) };
    const keepRatio = ax.equal || (p.reverse && p.hidden);
    if (keepRatio || ax.square) {
      const ratio = ax.square ? 1 : dx / dy; // width / height
      const w = Math.min(box.w, box.h * ratio), h = w / ratio;
      box.x += (box.w - w) / 2; box.y += (box.h - h) / 2; box.w = w; box.h = h;
    }
    const X = (v: number) => box.x + ((v - xl[0]) / dx) * box.w;
    const Y = (v: number) => (p.reverse ? box.y + ((v - yl[0]) / dy) * box.h : box.y + box.h - ((v - yl[0]) / dy) * box.h);
    const g = el(svg, 'g', { 'data-role': 'axes' });
    const clip = `${prefix}-c${index}`;
    el(el(defs, 'clipPath', { id: clip }), 'rect', { x: n(box.x), y: n(box.y), width: n(box.w), height: n(box.h) });
    const inX = p.xt.ticks, inY = p.yt.ticks;

    if (ax.grid && !p.hidden) {
      for (const v of inX) el(g, 'line', { x1: n(X(v)), x2: n(X(v)), y1: n(box.y), y2: n(box.y + box.h), style: paint('none', GRID), 'data-role': 'grid' });
      for (const v of inY) el(g, 'line', { y1: n(Y(v)), y2: n(Y(v)), x1: n(box.x), x2: n(box.x + box.w), style: paint('none', GRID), 'data-role': 'grid' });
    }

    // ----- data -----
    const data = el(g, 'g', { 'clip-path': `url(#${clip})` });
    // markers sit on the border when a point is on a limit, so they get their own unclipped layer
    const marks = el(g, 'g');
    const inside = (x: number, y: number) => x >= xl[0] - dx * 1e-9 && x <= xl[1] + dx * 1e-9 && y >= yl[0] - dy * 1e-9 && y <= yl[1] + dy * 1e-9;
    let auto = 0;
    const colorOf = (s: LineSpec | undefined) => {
      const c = s?.color;
      if (c === undefined) return ORDER[auto++ % ORDER.length];
      return typeof c === 'string' ? NAMED[c] ?? c : `rgb(${c.map(v => Math.round(v * 255)).join(',')})`;
    };
    const keys: { item: Series; color: string }[] = [];
    for (const it of ax.items) {
      if (it.t === 'image') {
        const img = el(data, 'image', { x: n(X(0.5)), y: n(Y(0.5)), width: n(X(it.w + 0.5) - X(0.5)), height: n(Y(it.h + 0.5) - Y(0.5)), preserveAspectRatio: 'none', style: 'image-rendering:pixelated', 'data-role': 'image' });
        img.setAttribute('href', imageUrl(it.w, it.h, it.rgb));
        continue;
      }
      if (it.t === 'text') continue;
      const color = colorOf(it.spec);
      keys.push({ item: it, color });
      const width = (it.spec?.width ?? 1) * 1.5;
      if (it.t === 'bar') {
        const base = Y(Math.min(yl[1], Math.max(yl[0], 0)));
        it.x.forEach((x, i) => {
          const y = it.y[i];
          if (!Number.isFinite(x) || !Number.isFinite(y)) return;
          const a = X(x - it.width / 2), b = X(x + it.width / 2), top = Y(y);
          // narrow bars overlap by half a unit so antialiasing leaves no seams between neighbors
          el(data, 'rect', { x: n(a), y: n(Math.min(top, base)), width: n(b - a > 5 ? b - a : Math.max(0.5, b - a) + 0.5), height: n(Math.abs(base - top)), style: paint(color, b - a > 5 ? BG : 'none', 0.75), 'data-role': 'bar' });
        });
      } else if (it.t === 'line') {
        if ((it.spec.style ?? '-') !== 'none') {
          let d = '', pen = false;
          it.x.forEach((x, i) => {
            const y = it.y[i];
            if (!Number.isFinite(x) || !Number.isFinite(y)) { pen = false; return; }
            d += `${pen ? 'L' : 'M'}${n(X(x))} ${n(Y(y))}`; pen = true;
          });
          if (d) el(data, 'path', { d, style: paint('none', color, width) + (DASH[it.spec.style!] ? `;stroke-dasharray:${DASH[it.spec.style!]}` : ''), 'stroke-linejoin': 'round', 'data-role': 'line' });
        }
        if (it.spec.marker) it.x.forEach((x, i) => { if (inside(x, it.y[i])) marker(marks, it.spec.marker!, X(x), Y(it.y[i]), 4, color, false, 'marker'); });
      } else if (it.t === 'stem') {
        const base = Y(Math.min(yl[1], Math.max(yl[0], 0)));
        el(data, 'line', { x1: n(box.x), x2: n(box.x + box.w), y1: n(base), y2: n(base), style: paint('none', INK, 0.75), 'data-role': 'baseline' });
        it.x.forEach((x, i) => {
          const y = it.y[i];
          if (!Number.isFinite(x) || !Number.isFinite(y)) return;
          const dash = DASH[it.spec?.style ?? ''];
          el(data, 'line', { x1: n(X(x)), x2: n(X(x)), y1: n(base), y2: n(Y(y)), style: paint('none', color, width) + (dash ? `;stroke-dasharray:${dash}` : ''), 'data-role': 'stem' });
          if (inside(x, y)) marker(marks, it.spec?.marker ?? 'o', X(x), Y(y), 4, color, !!it.filled, 'marker');
        });
      } else {
        const r = Math.sqrt(it.size ?? 36) * 0.667;
        it.x.forEach((x, i) => { if (inside(x, it.y[i])) marker(marks, it.spec?.marker ?? 'o', X(x), Y(it.y[i]), r, color, !!it.filled, 'point'); });
      }
    }

    // ----- frame, ticks, labels -----
    if (!p.hidden) {
      el(g, 'rect', { x: n(box.x), y: n(box.y), width: n(box.w), height: n(box.h), style: paint('none', INK, 0.9), 'data-role': 'frame' });
      const rampH = p.ramp ? 14 : 0;
      if (p.ramp) {
        const first = p.ramp.x[0], last = p.ramp.x[p.ramp.x.length - 1], a = Math.max(box.x, X(first - p.ramp.width / 2)), b = Math.min(box.x + box.w, X(last + p.ramp.width / 2));
        stops(defs, `${prefix}-r${index}`, X(first), X(last));
        el(g, 'rect', { x: n(a), y: n(box.y + box.h + 2), width: n(Math.max(0, b - a)), height: 10, style: paint(`url(#${prefix}-r${index})`, INK, 0.5), 'data-role': 'ramp' });
      }
      // skip every other x label (and so on) when they would overlap
      const widest = Math.max(0, ...inX.map(v => textWidth(formatTick(v, p.xt.step), TICK_FONT)));
      const gap = inX.length > 1 ? Math.abs(X(inX[1]) - X(inX[0])) : box.w;
      const every = Math.max(1, Math.ceil((widest + 6) / Math.max(1, gap)));
      inX.forEach((v, i) => {
        if (!rampH) el(g, 'line', { x1: n(X(v)), x2: n(X(v)), y1: n(box.y + box.h), y2: n(box.y + box.h - 4), style: paint('none', INK, 0.9) });
        if (i % every === 0) text(g, X(v), box.y + box.h + rampH + 14, formatTick(v, p.xt.step), { role: 'x-tick' });
      });
      for (const v of inY) {
        el(g, 'line', { y1: n(Y(v)), y2: n(Y(v)), x1: n(box.x), x2: n(box.x + 4), style: paint('none', INK, 0.9) });
        text(g, box.x - 6, Y(v) + 4, formatTick(v, p.yt.step), { role: 'y-tick', anchor: 'end' });
      }
      if (ax.xlabel) text(g, box.x + box.w / 2, box.y + box.h + rampH + 33, ax.xlabel, { role: 'xlabel', size: LABEL_FONT });
      if (ax.ylabel) {
        const yw = Math.max(0, ...inY.map(v => textWidth(formatTick(v, p.yt.step), TICK_FONT)));
        const lx = box.x - yw - 14 - (lines(ax.ylabel).length - 1) * LINE_H, ly = box.y + box.h / 2;
        text(g, lx, ly, ax.ylabel, { role: 'ylabel', size: LABEL_FONT, transform: `rotate(-90 ${n(lx)} ${n(ly)})` });
      }
    }
    g.appendChild(marks); // above the frame, so a marker on a limit is not crossed by it
    if (ax.title) text(g, box.x + box.w / 2, box.y - 8 - (lines(ax.title).length - 1) * LINE_H, ax.title, { role: 'title', size: TITLE_FONT, bold: true });
    for (const it of ax.items) {
      if (it.t !== 'text' || !Number.isFinite(it.x) || !Number.isFinite(it.y)) continue;
      const t = text(g, X(it.x), Y(it.y) + 4, it.s, { role: 'text', anchor: 'start', size: 12 });
      t.setAttribute('style', `${paint(INK, BG, 3)};paint-order:stroke`); // halo keeps it readable over images
    }

    // ----- colorbar -----
    if (p.bar) {
      const { map, range, ticks } = p.bar, x = box.x + box.w + 10, w = 13, cb = el(g, 'g', { 'data-role': 'colorbar' });
      if (map) {
        const h = box.h / map.length;
        map.forEach((c, i) => el(cb, 'rect', { x: n(x), y: n(box.y + box.h - (i + 1) * h), width: w, height: n(h + (i ? 0.4 : 0)), style: paint(`rgb(${c.map(v => Math.round(v * 255)).join(',')})`) }));
      } else {
        const id = `${prefix}-b${index}`;
        stops(defs, id, 0, 0);
        const grad = defs.lastChild as Element;
        grad.setAttribute('y1', String(n(box.y + box.h))); grad.setAttribute('y2', String(n(box.y)));
        el(cb, 'rect', { x: n(x), y: n(box.y), width: w, height: n(box.h), style: paint(`url(#${id})`) });
      }
      el(cb, 'rect', { x: n(x), y: n(box.y), width: w, height: n(box.h), style: paint('none', INK, 0.8) });
      for (const v of ticks.ticks) text(cb, x + w + 5, box.y + box.h - ((v - range[0]) / (range[1] - range[0])) * box.h + 4, formatTick(v, ticks.step), { role: 'color-tick', anchor: 'start' });
    }

    // ----- legend (top right, inside the box) -----
    const entries = keys.slice(0, ax.legend.length);
    if (entries.length) {
      const names = ax.legend.slice(0, entries.length).map(s => s.replace(/\n/g, ' '));
      const w = Math.min(box.w - 12, 42 + Math.max(...names.map(s => textWidth(s, TICK_FONT)))), x = box.x + box.w - w - 6, y = box.y + 6;
      const lg = el(g, 'g', { 'data-role': 'legend' });
      el(lg, 'rect', { x: n(x), y: n(y), width: n(w), height: entries.length * 16 + 8, style: paint(BG, INK, 0.7) });
      entries.forEach(({ item, color }, i) => {
        const cy = y + 12 + i * 16, s = 'spec' in item ? item.spec : undefined;
        if (item.t === 'bar') el(lg, 'rect', { x: n(x + 8), y: n(cy - 5), width: 20, height: 10, style: paint(color) });
        else {
          if (item.t !== 'scatter' && (s?.style ?? '-') !== 'none') el(lg, 'line', { x1: n(x + 6), x2: n(x + 30), y1: n(cy), y2: n(cy), style: paint('none', color, 1.5) + (DASH[s?.style ?? ''] ? `;stroke-dasharray:${DASH[s!.style!]}` : '') });
          const mk = s?.marker ?? (item.t === 'line' ? undefined : 'o');
          if (mk) marker(lg, mk, x + 18, cy, 3.5, color, 'filled' in item && !!item.filled, 'key-marker');
        }
        text(lg, x + 36, cy + 4, names[i], { role: 'legend-text', anchor: 'start' });
      });
    }
  });
  return svg;

  /** One marker of radius r centered on (x, y). */
  function marker(parent: Element, kind: string, x: number, y: number, r: number, color: string, filled: boolean, role: string) {
    const style = paint(filled || kind === '.' ? color : 'none', color, 1.3);
    const poly = (pts: [number, number][]) => el(parent, 'path', { d: 'M' + pts.map(([a, b]) => `${n(x + a * r)} ${n(y + b * r)}`).join('L') + 'Z', style, 'data-role': role });
    const strokes = (segments: number[][]) => el(parent, 'path', { d: segments.map(([a, b, c, d]) => `M${n(x + a * r)} ${n(y + b * r)}L${n(x + c * r)} ${n(y + d * r)}`).join(''), style, 'data-role': role });
    const star = (points: number, inner: number) => poly(Array.from({ length: points * 2 }, (_, i) => { const a = (Math.PI * i) / points - Math.PI / 2, k = i % 2 ? inner : 1; return [k * Math.cos(a), k * Math.sin(a)] as [number, number]; }));
    switch (kind) {
      case '+': return strokes([[-1, 0, 1, 0], [0, -1, 0, 1]]);
      case 'x': return strokes([[-0.8, -0.8, 0.8, 0.8], [-0.8, 0.8, 0.8, -0.8]]);
      case '*': return strokes([[-1, 0, 1, 0], [0, -1, 0, 1], [-0.7, -0.7, 0.7, 0.7], [-0.7, 0.7, 0.7, -0.7]]);
      case 's': return poly([[-0.85, -0.85], [0.85, -0.85], [0.85, 0.85], [-0.85, 0.85]]);
      case 'd': return poly([[0, -1.1], [0.8, 0], [0, 1.1], [-0.8, 0]]);
      case '^': return poly([[0, -1], [1, 0.8], [-1, 0.8]]);
      case 'v': return poly([[0, 1], [1, -0.8], [-1, -0.8]]);
      case '>': return poly([[1, 0], [-0.8, 1], [-0.8, -1]]);
      case '<': return poly([[-1, 0], [0.8, 1], [0.8, -1]]);
      case 'p': return star(5, 0.45);
      case 'h': return star(6, 0.55);
      default: return el(parent, 'circle', { cx: n(x), cy: n(y), r: n(kind === '.' ? r * 0.55 : r), style, 'data-role': role });
    }
  }
}

// ---------- standalone output ----------
/** Serialize a plot as a self-contained SVG file: every var(--name, fallback) becomes `lookup(name)` or the fallback. */
export function plotSvgText(svg: SVGSVGElement, lookup: (name: string) => string = () => '', scale = 1): string {
  const copy = svg.cloneNode(true) as SVGSVGElement;
  const [, , w, h] = copy.getAttribute('viewBox')!.split(' ').map(Number);
  copy.setAttribute('width', String(w * scale)); copy.setAttribute('height', String(h * scale));
  copy.style.maxWidth = 'none';
  const Serializer = svg.ownerDocument.defaultView!.XMLSerializer;
  return new Serializer().serializeToString(copy).replace(/var\((--[\w-]+),\s*([^()]*)\)/g, (_m, name, fallback) => lookup(name).trim() || fallback);
}

/** Render the on-screen plot (with its current theme colors) to a PNG at twice its nominal size. */
export async function plotToPng(svg: SVGSVGElement): Promise<Blob> {
  const css = getComputedStyle(svg);
  const source = plotSvgText(svg, name => css.getPropertyValue(name), 2);
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve(); img.onerror = () => reject(new Error('Could not draw the figure.'));
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(source);
  });
  const cv = document.createElement('canvas');
  cv.width = img.width; cv.height = img.height;
  cv.getContext('2d')!.drawImage(img, 0, 0);
  return toBlob(cv, 'image/png');
}
