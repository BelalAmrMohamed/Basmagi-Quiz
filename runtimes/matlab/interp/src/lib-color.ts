// =============================================================================
// runtimes/matlab/interp/src/lib-color.ts
// Color conversions and indexed images (plan Phase 5.5): hsv2rgb, ycbcr2rgb, ntsc2rgb, rgb2lab, lab2rgb,
// rgb2ind, ind2rgb, gray2ind, ind2gray.  (rgb2gray, rgb2hsv, rgb2ycbcr, rgb2ntsc live in interp.ts.)
// =============================================================================
import { T, V, Cls, isStr, toStr, mk, sat, toUnit, fromUnit, INT_RANGE } from './values';
import { Def, T_, err } from './lib-common';
import { COLORMAPS } from './colormaps';

const lc = (v: V) => toStr(v).toLowerCase();
const unitOf = (cls: Cls, v: number) => (INT_RANGE[cls] ? toUnit(cls, v) : v);
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Pixel count of M-by-N-by-3 colour data or an m-by-3 colormap (both keep one channel per plane / column). */
function colorCount(t: T, fn: string, name: string): number {
  if (t.cls === 'char') err(`Error using ${fn}: Expected input number 1, ${name}, to be numeric.`);
  if (t.dims.length === 3 && t.dims[2] === 3) return t.dims[0] * t.dims[1];
  if (t.dims.length === 2 && t.dims[1] === 3) return t.dims[0];
  return err(`Error using ${fn}: Expected input number 1, ${name}, to be M-by-N-by-3 or an m-by-3 colormap.`);
}
const floatOnly = (t: T, fn: string, name: string) => {
  if (t.cls !== 'double' && t.cls !== 'single') err(`Error using ${fn}: Expected input number 1, ${name}, to be one of these types: double, single`);
};

/** Apply f to every (c1, c2, c3) triple of t (given in the unit scale of the input class) and store the result with class `cls`. */
function map3(t: T, n: number, cls: Cls, f: (a: number, b: number, c: number) => number[], fromU = false): T {
  const o = mk(cls, t.dims.slice());
  for (let p = 0; p < n; p++) {
    const r = f(unitOf(t.cls, t.data[p]), unitOf(t.cls, t.data[p + n]), unitOf(t.cls, t.data[p + 2 * n]));
    for (let k = 0; k < 3; k++) o.data[p + k * n] = fromU ? fromUnit(cls, clamp01(r[k])) : sat(cls, r[k]);
  }
  return o;
}

const inv3 = (m: number[][]): number[][] => {
  const [[a, b, c], [d, e, f], [g, h, i]] = m, A = e * i - f * h, B = f * g - d * i, C = d * h - e * g, det = a * A + b * B + c * C;
  return [[A / det, (c * h - b * i) / det, (b * f - c * e) / det], [B / det, (a * i - c * g) / det, (c * d - a * f) / det], [C / det, (b * g - a * h) / det, (a * e - b * d) / det]];
};
const mul3 = (m: number[][], v: number[]) => [0, 1, 2].map(i => m[i][0] * v[0] + m[i][1] * v[1] + m[i][2] * v[2]);

// ---------- HSV, YCbCr, NTSC ----------
function hsv2rgb(h: number, s: number, v: number): number[] {
  const h6 = (((h % 1) + 1) % 1) * 6, i = Math.floor(h6), f = h6 - i, p = v * (1 - s), q = v * (1 - s * f), t = v * (1 - s * (1 - f));
  return [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6];
}
const YCC = [[65.481, 128.553, 24.966], [-37.797, -74.203, 112], [112, -93.786, -18.214]], YCC_INV = inv3(YCC);
const NTSC_INV = [[1, 0.956, 0.621], [1, -0.272, -0.647], [1, -1.106, 1.703]];

// ---------- CIE L*a*b* (sRGB, D65) ----------
const M_RGB = [[0.4124564, 0.3575761, 0.1804375], [0.2126729, 0.7151522, 0.072175], [0.0193339, 0.119192, 0.9503041]], M_INV = inv3(M_RGB);
const WHITE = [0.95047, 1, 1.08883], EPS = 216 / 24389, KAPPA = 24389 / 27;
const toLin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLin = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const labF = (t: number) => (t > EPS ? Math.cbrt(t) : (KAPPA * t + 16) / 116);
const labFinv = (f: number) => (f * f * f > EPS ? f * f * f : (116 * f - 16) / KAPPA);
function rgb2lab(r: number, g: number, b: number): number[] {
  const xyz = mul3(M_RGB, [toLin(r), toLin(g), toLin(b)]), fx = labF(xyz[0] / WHITE[0]), fy = labF(xyz[1] / WHITE[1]), fz = labF(xyz[2] / WHITE[2]);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
function lab2rgb(L: number, a: number, b: number): number[] {
  const fy = (L + 16) / 116, xyz = [labFinv(fy + a / 500) * WHITE[0], labFinv(fy) * WHITE[1], labFinv(fy - b / 200) * WHITE[2]];
  return mul3(M_INV, xyz).map(c => fromLin(Math.min(1, Math.max(0, c))));
}

// ---------- indexed images ----------
function cmapOf(v: V | undefined, fn: string): { n: number; d: Float64Array } {
  const m = T_(v as V, fn);
  if (m.dims.length !== 2 || m.dims[1] !== 3 || m.dims[0] < 1) err(`Error using ${fn}: MAP must be an m-by-3 colormap.`);
  return { n: m.dims[0], d: m.data };
}
/** 0-based colormap row of an index value: integer classes are 0-based, double and single are 1-based (MATLAB); out-of-range values are clamped. */
const rowOf = (cls: Cls, v: number, n: number) => Math.min(n - 1, Math.max(0, Math.floor(v) - (cls === 'double' || cls === 'single' ? 1 : 0)));
const indexClass = (n: number): Cls => (n <= 256 ? 'uint8' : 'uint16');

/** Median-cut palette of the distinct colors in `px` (unit scale, 3 values per color, with counts). */
function medianCut(px: Float64Array, cnt: Float64Array, n: number): number[][] {
  const total = cnt.length;
  type Box = { ids: number[] };
  const range = (b: Box): [number, number] => {
    let best = 0, ch = 0;
    for (let k = 0; k < 3; k++) { let lo = Infinity, hi = -Infinity; for (const i of b.ids) { const v = px[3 * i + k]; if (v < lo) lo = v; if (v > hi) hi = v; } if (hi - lo > best) { best = hi - lo; ch = k; } }
    return [best, ch];
  };
  const boxes: Box[] = [{ ids: Array.from({ length: total }, (_, i) => i) }];
  while (boxes.length < n) {
    let bi = -1, bestR = 0, bestCh = 0;
    boxes.forEach((b, i) => { if (b.ids.length > 1) { const [r, ch] = range(b); if (r > bestR) { bestR = r; bestCh = ch; bi = i; } } });
    if (bi < 0) break;
    const ids = boxes[bi].ids.sort((p, q) => px[3 * p + bestCh] - px[3 * q + bestCh] || p - q);
    let w = 0; for (const i of ids) w += cnt[i];
    let acc = 0, cut = 1;
    for (let k = 0; k < ids.length - 1; k++) { acc += cnt[ids[k]]; cut = k + 1; if (acc >= w / 2) break; }
    boxes.splice(bi, 1, { ids: ids.slice(0, cut) }, { ids: ids.slice(cut) });
  }
  return boxes.map(b => { let w = 0; const s = [0, 0, 0]; for (const i of b.ids) { w += cnt[i]; for (let k = 0; k < 3; k++) s[k] += cnt[i] * px[3 * i + k]; } return s.map(v => v / w); });
}

function rgb2ind(a: V[]): [T, T] {
  const A = T_(a[0], 'rgb2ind');
  if (A.dims.length !== 3 || A.dims[2] !== 3 || !['uint8', 'uint16', 'double', 'single'].includes(A.cls)) err('Error using rgb2ind: Expected input number 1, RGB, to be an M-by-N-by-3 uint8, uint16, double or single image.');
  if (a.length < 2) err('Error using rgb2ind: Not enough input arguments.');
  const q = T_(a[1], 'rgb2ind'), N = A.dims[0] * A.dims[1];
  for (let k = 2; k < a.length; k++) if (!isStr(a[k]) || !['dither', 'nodither'].includes(lc(a[k]))) err(`Error using rgb2ind: Invalid option '${toStr(a[k])}'.`);
  const col = (p: number) => [unitOf(A.cls, A.data[p]), unitOf(A.cls, A.data[p + N]), unitOf(A.cls, A.data[p + 2 * N])];
  let map: number[][];
  if (q.dims.length === 2 && q.dims[1] === 3) { const c = cmapOf(q, 'rgb2ind'); map = Array.from({ length: c.n }, (_, i) => [c.d[i], c.d[i + c.n], c.d[i + 2 * c.n]]); }
  else if (q.data.length === 1 && Number.isInteger(q.data[0]) && q.data[0] >= 2) {
    const key = new Map<string, number>(), px: number[] = [], cnt: number[] = [];
    for (let p = 0; p < N; p++) { const c = col(p), k = c.join(','); const i = key.get(k); if (i === undefined) { key.set(k, cnt.length); px.push(...c); cnt.push(1); } else cnt[i]++; }
    map = medianCut(Float64Array.from(px), Float64Array.from(cnt), q.data[0]);
  } else if (q.data.length === 1 && q.data[0] > 0 && q.data[0] <= 1) { // uniform quantization into cubes of edge tol; the color of a cube is the mean of its pixels
    const tol = q.data[0], L = Math.floor(1 / tol) + 1, sums = new Map<number, number[]>();
    for (let p = 0; p < N; p++) { const c = col(p), id = c.reduce((s, v) => s * L + Math.min(L - 1, Math.floor(v / tol)), 0), e = sums.get(id) ?? [0, 0, 0, 0]; for (let k = 0; k < 3; k++) e[k] += c[k]; e[3]++; sums.set(id, e); }
    map = Array.from(sums.keys()).sort((x, y) => x - y).map(id => { const e = sums.get(id) as number[]; return [e[0] / e[3], e[1] / e[3], e[2] / e[3]]; });
  } else err('Error using rgb2ind: The second argument must be an integer n >= 2, a tolerance in (0, 1] or an m-by-3 colormap.');
  const X = mk(indexClass(map.length), A.dims.slice(0, 2)), cache = new Map<string, number>();
  for (let p = 0; p < N; p++) {
    const c = col(p), k = c.join(','); let best = cache.get(k);
    if (best === undefined) { let bd = Infinity; best = 0; map.forEach((m, i) => { const d = (m[0] - c[0]) ** 2 + (m[1] - c[1]) ** 2 + (m[2] - c[2]) ** 2; if (d < bd) { bd = d; best = i; } }); cache.set(k, best as number); }
    X.data[p] = best as number;
  }
  const M = mk('double', [map.length, 3]);
  map.forEach((m, i) => { for (let k = 0; k < 3; k++) M.data[i + map.length * k] = m[k]; });
  return [X, M];
}

export function registerColor(def: Def) {
  def('hsv2rgb', a => {
    const t = T_(a[0], 'hsv2rgb'), n = colorCount(t, 'hsv2rgb', 'HSV');
    floatOnly(t, 'hsv2rgb', 'HSV');
    return [map3(t, n, t.cls, (h, s, v) => hsv2rgb(h, s, v))];
  });
  def('ycbcr2rgb', a => {
    const t = T_(a[0], 'ycbcr2rgb'), n = colorCount(t, 'ycbcr2rgb', 'YCBCR');
    if (!['uint8', 'uint16', 'double', 'single'].includes(t.cls)) err('Error using ycbcr2rgb: Expected input number 1, YCBCR, to be one of these types: uint8, uint16, double, single');
    return [map3(t, n, t.cls, (y, cb, cr) => mul3(YCC_INV, [y * 255 - 16, cb * 255 - 128, cr * 255 - 128]), true)];
  });
  def('ntsc2rgb', a => {
    const t = T_(a[0], 'ntsc2rgb'), n = colorCount(t, 'ntsc2rgb', 'YIQ');
    floatOnly(t, 'ntsc2rgb', 'YIQ');
    return [map3(t, n, t.cls, (y, i, q) => mul3(NTSC_INV, [y, i, q]), true)];
  });
  def('rgb2lab', a => {
    const t = T_(a[0], 'rgb2lab'), n = colorCount(t, 'rgb2lab', 'RGB');
    if (!['uint8', 'uint16', 'double', 'single'].includes(t.cls)) err('Error using rgb2lab: Expected input number 1, RGB, to be one of these types: uint8, uint16, double, single');
    for (let k = 1; k < a.length; k += 2) if (lc(a[k]) !== 'colorspace' || lc(a[k + 1]) !== 'srgb') err("Error using rgb2lab: Only the 'srgb' ColorSpace (D65 white point) is supported.");
    return [map3(t, n, t.cls === 'single' ? 'single' : 'double', rgb2lab)];
  });
  def('lab2rgb', a => {
    const t = T_(a[0], 'lab2rgb'), n = colorCount(t, 'lab2rgb', 'LAB');
    floatOnly(t, 'lab2rgb', 'LAB');
    let out: Cls = t.cls;
    for (let k = 1; k < a.length; k += 2) {
      const o = lc(a[k]);
      if (o === 'outputtype') { const c = lc(a[k + 1]); if (!['double', 'single', 'uint8', 'uint16'].includes(c)) err(`Error using lab2rgb: Invalid OutputType '${c}'.`); out = c as Cls; }
      else if (o === 'colorspace') { if (lc(a[k + 1]) !== 'srgb') err("Error using lab2rgb: Only the 'srgb' ColorSpace (D65 white point) is supported."); }
      else err(`Error using lab2rgb: Invalid option '${toStr(a[k])}'.`);
    }
    return [map3(t, n, out, lab2rgb, true)];
  });

  def('ind2rgb', a => {
    const X = T_(a[0], 'ind2rgb'), { n, d } = cmapOf(a[1], 'ind2rgb');
    if (X.dims.length > 2 || X.cls === 'char') err('Error using ind2rgb: Expected input number 1, X, to be a 2-D numeric image.');
    const N = X.data.length, o = mk('double', [X.dims[0], X.dims[1], 3]);
    for (let p = 0; p < N; p++) { const r = rowOf(X.cls, X.data[p], n); for (let k = 0; k < 3; k++) o.data[p + N * k] = d[r + n * k]; }
    return [o];
  });
  def('gray2ind', a => {
    const I = T_(a[0], 'gray2ind'), n = a[1] === undefined ? 64 : T_(a[1], 'gray2ind').data[0];
    if (I.dims.length > 2 || I.cls === 'char') err('Error using gray2ind: Expected input number 1, I, to be a 2-D numeric or logical image.');
    if (!Number.isInteger(n) || n < 1 || n > 65536) err('Error using gray2ind: N must be an integer between 1 and 65536.');
    const X = mk(indexClass(n), I.dims.slice());
    for (let i = 0; i < I.data.length; i++) X.data[i] = Math.round(clamp01(unitOf(I.cls, I.data[i])) * (n - 1));
    const g = COLORMAPS.gray(n), M = mk('double', [n, 3]);
    g.forEach((r, i) => { for (let k = 0; k < 3; k++) M.data[i + n * k] = r[k]; });
    return [X, M];
  });
  def('ind2gray', a => {
    const X = T_(a[0], 'ind2gray'), { n, d } = cmapOf(a[1], 'ind2gray');
    if (X.dims.length > 2 || X.cls === 'char' || X.cls === 'logical') err('Error using ind2gray: Expected input number 1, X, to be a 2-D uint8, uint16 or double image.');
    const o = mk(X.cls, X.dims.slice());
    for (let p = 0; p < X.data.length; p++) { const r = rowOf(X.cls, X.data[p], n); o.data[p] = fromUnit(X.cls, 0.299 * d[r] + 0.587 * d[r + n] + 0.114 * d[r + 2 * n]); }
    return [o];
  });
  def('rgb2ind', (a, nargout) => { const [X, M] = rgb2ind(a); return nargout > 1 ? [X, M] : [X]; });
}
