// =============================================================================
// runtimes/matlab/interp/src/lib-ipt.ts
// Image Processing Toolbox built-ins (plan Phase 5). Grows one sub-phase at a time; large groups live in their own files.
// 5.1 intensity, thresholding and metrics; 5.6 imnoise.
// =============================================================================
import { T, V, Cls, isStr, toStr, mk, num, sat, toUnit, fromUnit, ew, outCls, INT_RANGE, CLASS_NAMES } from './values';
import { Def, T_, err, rnd, randnSample } from './lib-common';
import { registerFilter, filterT } from './lib-filter';

const lc = (v: V) => toStr(v).toLowerCase();
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const planesOf = (t: T) => t.dims.slice(2).reduce((a, b) => a * b, 1);
const unitOf = (cls: Cls, v: number) => (INT_RANGE[cls] ? toUnit(cls, v) : v);
/** Dynamic range L of a class (255 for uint8, 65535 for uint16, 1 for floating point and logical). */
const rangeOf = (cls: Cls) => { const r = INT_RANGE[cls]; return r ? r[1] - r[0] : 1; };

function numeric(v: V | undefined, fn: string, pos = 1, name = 'I'): T {
  const t = T_(v as V, fn);
  if (t.cls === 'char') err(`Error using ${fn}: Expected input number ${pos}, ${name}, to be one of these types: uint8, uint16, int16, single, double, logical`);
  return t;
}

/** Histogram bin of a raw value as imhist counts it (256 bins, or 65536 for 16-bit integers). */
function binOf(cls: Cls, v: number, nb: number) {
  const r = INT_RANGE[cls];
  return r ? Math.min(nb - 1, Math.max(0, Math.floor(((v - r[0]) * nb) / (r[1] - r[0] + 1)))) : Math.min(nb - 1, Math.max(0, Math.round(v * (nb - 1))));
}
const nbinsOf = (cls: Cls) => (cls === 'uint16' || cls === 'int16' ? 65536 : 256);

/** [low high] intensity limits (0..1) of one plane that clip tol[0] and 1-tol[1] of the pixels (MathWorks stretchlim). */
function stretch(data: Float64Array, off: number, len: number, cls: Cls, tol: number[]): [number, number] {
  const nb = nbinsOf(cls), h = new Float64Array(nb);
  for (let i = 0; i < len; i++) h[binOf(cls, data[off + i], nb)]++;
  let acc = 0, lo = -1, hi = -1;
  for (let k = 0; k < nb; k++) {
    acc += h[k];
    const c = acc / len;
    if (lo < 0 && c > tol[0]) lo = k;
    if (hi < 0 && c >= tol[1]) { hi = k; break; }
  }
  return lo === hi || lo < 0 || hi < 0 ? [0, 1] : [lo / (nb - 1), hi / (nb - 1)];
}

function stretchlim(I: T, tol: number[]): T {
  if (I.dims.length > 3) err('Error using stretchlim: Expected input number 1, I, to be 2-D or 3-D.');
  const np = planesOf(I), n = I.dims[0] * I.dims[1], out = mk('double', [2, np]);
  for (let p = 0; p < np; p++) { const [lo, hi] = stretch(I.data, p * n, n, I.cls, tol); out.data[2 * p] = lo; out.data[2 * p + 1] = hi; }
  return out;
}

/** Otsu threshold (0..1) of the pixels as a 256-bin histogram of their 8-bit values. */
function otsu(I: T): number {
  const N = 256, h = new Float64Array(N);
  for (const v of I.data) h[I.cls === 'uint8' ? v : I.cls === 'logical' ? (v ? 255 : 0) : sat('uint8', unitOf(I.cls, v) * 255)]++;
  let tot = 0; for (const c of h) tot += c;
  if (tot === 0) return 0;
  let om = 0, mu = 0, muT = 0;
  for (let k = 0; k < N; k++) muT += (h[k] / tot) * (k + 1);
  const sb = new Float64Array(N); let best = -Infinity;
  for (let k = 0; k < N; k++) {
    const p = h[k] / tot; om += p; mu += p * (k + 1);
    sb[k] = (muT * om - mu) ** 2 / (om * (1 - om));
    if (isFinite(sb[k]) && sb[k] > best) best = sb[k];
  }
  if (!isFinite(best)) return 0;
  let s = 0, c = 0;
  for (let k = 0; k < N; k++) if (sb[k] === best) { s += k + 1; c++; }
  return (s / c - 1) / (N - 1);
}

/** Per-plane option: scalar/2-vector for every plane, or one column per plane. */
function pair(t: T | null, p: number, d: [number, number]): [number, number] {
  if (!t || t.data.length === 0) return d;
  return t.data.length >= 2 * (p + 1) && t.data.length > 2 ? [t.data[2 * p], t.data[2 * p + 1]] : [t.data[0], t.data[1]];
}

function imadjust(a: V[]): T {
  const I = numeric(a[0], 'imadjust');
  if (I.cls === 'logical') err('Error using imadjust: Expected input number 1, I, to be one of these types: uint8, uint16, int16, single, double');
  if (I.dims.length > 3) err('Error using imadjust: Expected input number 1, I, to be 2-D or 3-D.');
  const np = planesOf(I), n = I.dims[0] * I.dims[1];
  const optT = (k: number) => (a[k] === undefined ? null : T_(a[k], 'imadjust'));
  const inT = optT(1), outT = optT(2), gT = optT(3);
  const lims = !inT || inT.data.length === 0 ? stretchlim(I, [0.01, 0.99]) : null;
  const out = mk(I.cls, I.dims.slice());
  for (let p = 0; p < np; p++) {
    const [li, hi] = lims ? [lims.data[2 * p], lims.data[2 * p + 1]] : pair(inT, p, [0, 1]);
    const [lo, ho] = pair(outT, p, [0, 1]);
    const g = !gT || gT.data.length === 0 ? 1 : gT.data.length > p && gT.data.length > 1 ? gT.data[p] : gT.data[0];
    for (const v of [li, hi, lo, ho]) if (!(v >= 0 && v <= 1)) err('Error using imadjust: Range values must be in the range [0, 1].');
    if (!(li < hi)) err('Error using imadjust: LOW_IN must be less than HIGH_IN.');
    if (!(g > 0)) err('Error using imadjust: GAMMA must be positive.');
    for (let i = 0; i < n; i++) {
      const w = clamp01((unitOf(I.cls, I.data[p * n + i]) - li) / (hi - li));
      out.data[p * n + i] = fromUnit(I.cls, lo + (ho - lo) * w ** g);
    }
  }
  return out;
}

function imlincomb(a: V[]): T {
  const args = a.slice();
  let cls: Cls | null = null, K = 0;
  if (args.length && isStr(args[args.length - 1])) {
    const nm = lc(args.pop() as V);
    if (!CLASS_NAMES.includes(nm)) err(`Error using imlincomb: Unknown output class '${nm}'.`);
    cls = nm as Cls;
  }
  if (args.length % 2 === 1) K = T_(args.pop() as V, 'imlincomb').data[0];
  if (args.length < 2) err('Error using imlincomb: Not enough input arguments.');
  const imgs: T[] = [], ks: number[] = [];
  for (let i = 0; i < args.length; i += 2) {
    const k = T_(args[i], 'imlincomb'), im = T_(args[i + 1], 'imlincomb');
    if (k.data.length !== 1) err('Error using imlincomb: Expected input number ' + (i + 1) + ' to be a scalar.');
    ks.push(k.data[0]); imgs.push(im);
  }
  const first = imgs[0], oc = cls ?? first.cls;
  if (imgs.some(t => t.data.length !== first.data.length)) err('Error using imlincomb: All images must be the same size.');
  const out = mk(oc, first.dims.slice());
  for (let i = 0; i < out.data.length; i++) { let s = K; for (let j = 0; j < imgs.length; j++) s += ks[j] * imgs[j].data[i]; out.data[i] = sat(oc, s); }
  return out;
}

const mean = (d: ArrayLike<number>) => { let s = 0; for (let i = 0; i < d.length; i++) s += d[i]; return s / d.length; };
const fl = (...t: T[]): Cls => (t.some(x => x.cls === 'single') ? 'single' : 'double');
function sameSize(A: T, B: T, fn: string, nm: string) {
  if (A.dims.length !== B.dims.length || A.dims.some((d, i) => d !== B.dims[i])) err(`Error using ${fn}: A and ${nm} must be the same size.`);
}

function ssim(A: T, R: T): [T, T] {
  sameSize(A, R, 'ssim', 'ref');
  if (A.dims.length > 3) err('Error using ssim: Expected input number 1, A, to be 2-D or 3-D.');
  const L = rangeOf(A.cls), c1 = (0.01 * L) ** 2, c2 = (0.03 * L) ** 2, N = 11, g = new Float64Array(N * N);
  let gs = 0;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { g[i + N * j] = Math.exp(-((i - 5) ** 2 + (j - 5) ** 2) / (2 * 1.5 * 1.5)); gs += g[i + N * j]; }
  for (let i = 0; i < g.length; i++) g[i] /= gs;
  const D = (t: T) => mk('double', t.dims.slice(), t.data);
  const x = D(A), y = D(R), xx = D(A), yy = D(A), xy = D(A);
  for (let i = 0; i < x.data.length; i++) { xx.data[i] = x.data[i] ** 2; yy.data[i] = y.data[i] ** 2; xy.data[i] = x.data[i] * y.data[i]; }
  const f = (t: T) => filterT(t, g, N, N, -5, -5, t.dims[0], t.dims[1], { k: 'replicate' }, 'double');
  const mx = f(x), my = f(y), sxx = f(xx), syy = f(yy), sxy = f(xy), map = mk('double', A.dims.slice());
  for (let i = 0; i < map.data.length; i++) {
    const ux = mx.data[i], uy = my.data[i], vx = sxx.data[i] - ux * ux, vy = syy.data[i] - uy * uy, cv = sxy.data[i] - ux * uy;
    map.data[i] = ((2 * ux * uy + c1) * (2 * cv + c2)) / ((ux * ux + uy * uy + c1) * (vx + vy + c2));
  }
  return [num(mean(map.data), fl(A, R)), map];
}

function imnoise(a: V[]): T {
  const I = numeric(a[0], 'imnoise');
  if (!['uint8', 'uint16', 'int16', 'single', 'double'].includes(I.cls)) err('Error using imnoise: Expected input number 1, I, to be one of these types: uint8, uint16, int16, single, double');
  const type = a[1] === undefined ? err('Error using imnoise: Not enough input arguments.') : lc(a[1]);
  const arg = (k: number, d: number) => (a[k] === undefined ? d : T_(a[k], 'imnoise').data[0]);
  const out = mk(I.cls, I.dims.slice()), cls = I.cls, u = (v: number) => unitOf(cls, v);
  if (type.startsWith('gauss')) {
    const m = arg(2, 0), v = arg(3, 0.01);
    if (v < 0) err('Error using imnoise: Variance must be nonnegative.');
    const sd = Math.sqrt(v);
    for (let i = 0; i < I.data.length; i++) out.data[i] = fromUnit(cls, clamp01(u(I.data[i]) + m + sd * randnSample()));
  } else if (type.startsWith('salt')) {
    const d = arg(2, 0.05);
    if (!(d >= 0 && d <= 1)) err('Error using imnoise: Noise density must be in the range [0, 1].');
    for (let i = 0; i < I.data.length; i++) { const x = rnd(); out.data[i] = x < d / 2 ? fromUnit(cls, 0) : x < d ? fromUnit(cls, 1) : I.data[i]; }
  } else if (type.startsWith('speckle')) {
    const v = arg(2, 0.04);
    if (v < 0) err('Error using imnoise: Variance must be nonnegative.');
    const s = Math.sqrt(12 * v);
    for (let i = 0; i < I.data.length; i++) { const x = u(I.data[i]); out.data[i] = fromUnit(cls, clamp01(x + x * s * (rnd() - 0.5))); }
  } else if (type.startsWith('poisson')) err("Error using imnoise: The 'poisson' noise type is not supported.");
  else err(`Error using imnoise: Unknown noise type '${toStr(a[1])}'.`);
  return out;
}

export function registerIpt(def: Def) {
  registerFilter(def);

  def('stretchlim', a => {
    const I = numeric(a[0], 'stretchlim'), t = a[1] === undefined || T_(a[1], 'stretchlim').data.length === 0 ? null : T_(a[1], 'stretchlim');
    const tol = t ? (t.data.length === 1 ? [t.data[0], 1 - t.data[0]] : [t.data[0], t.data[1]]) : [0.01, 0.99];
    if (!(tol[0] >= 0 && tol[0] < tol[1] && tol[1] <= 1)) err('Error using stretchlim: TOL must be in the range [0, 1] with TOL(1) < TOL(2).');
    return [stretchlim(I, tol)];
  });
  def('imadjust', a => [imadjust(a)]);
  def('graythresh', a => [num(otsu(numeric(a[0], 'graythresh')))]);
  def('imbinarize', a => {
    const I = numeric(a[0], 'imbinarize');
    if (I.dims.length > 2) err('Error using imbinarize: Expected input number 1, I, to be two-dimensional.');
    if (a[1] !== undefined && isStr(a[1])) err(`Error using imbinarize: The '${toStr(a[1])}' method is not supported; use imbinarize(I) or imbinarize(I, level).`);
    const level = a[1] === undefined ? otsu(I) : T_(a[1], 'imbinarize').data[0];
    if (!(level >= 0 && level <= 1)) err('Error using imbinarize: LEVEL must be in the range [0, 1].');
    const o = mk('logical', I.dims.slice());
    for (let i = 0; i < I.data.length; i++) o.data[i] = unitOf(I.cls, I.data[i]) > level ? 1 : 0;
    return [o];
  });

  def('immultiply', a => { const x = T_(a[0], 'immultiply'), y = T_(a[1], 'immultiply'); return [ew(x, y, (p, q) => p * q, outCls(x, y))]; });
  def('imdivide', a => { const x = T_(a[0], 'imdivide'), y = T_(a[1], 'imdivide'); return [ew(x, y, (p, q) => p / q, outCls(x, y))]; });
  def('imlincomb', a => [imlincomb(a)]);

  def('mean2', a => { const t = numeric(a[0], 'mean2', 1, 'A'); return [num(mean(t.data), fl(t))]; });
  def('std2', a => {
    const t = numeric(a[0], 'std2', 1, 'A'), m = mean(t.data);
    let s = 0; for (const v of t.data) s += (v - m) ** 2;
    return [num(t.data.length > 1 ? Math.sqrt(s / (t.data.length - 1)) : 0, fl(t))];
  });
  def('corr2', a => {
    const A = numeric(a[0], 'corr2', 1, 'A'), B = numeric(a[1], 'corr2', 2, 'B');
    sameSize(A, B, 'corr2', 'B');
    const ma = mean(A.data), mb = mean(B.data);
    let sab = 0, saa = 0, sbb = 0;
    for (let i = 0; i < A.data.length; i++) { const p = A.data[i] - ma, q = B.data[i] - mb; sab += p * q; saa += p * p; sbb += q * q; }
    return [num(sab / Math.sqrt(saa * sbb), fl(A, B))];
  });
  def('entropy', a => {
    const I = numeric(a[0], 'entropy'), nb = I.cls === 'logical' ? 2 : 256, h = new Float64Array(nb);
    for (const v of I.data) h[I.cls === 'logical' ? (v ? 1 : 0) : I.cls === 'uint8' ? v : sat('uint8', unitOf(I.cls, v) * 255)]++;
    let e = 0;
    for (const c of h) if (c > 0) { const p = c / I.data.length; e -= p * Math.log2(p); }
    return [num(e)];
  });
  def('immse', a => {
    const A = numeric(a[0], 'immse', 1, 'X'), B = numeric(a[1], 'immse', 2, 'Y');
    sameSize(A, B, 'immse', 'Y');
    let s = 0; for (let i = 0; i < A.data.length; i++) s += (A.data[i] - B.data[i]) ** 2;
    return [num(s / A.data.length, fl(A, B))];
  });
  def('psnr', (a, nargout) => {
    const A = numeric(a[0], 'psnr', 1, 'A'), R = numeric(a[1], 'psnr', 2, 'ref');
    sameSize(A, R, 'psnr', 'ref');
    const peak = a[2] === undefined ? rangeOf(A.cls) : T_(a[2], 'psnr').data[0];
    let e = 0, r = 0; for (let i = 0; i < A.data.length; i++) { e += (A.data[i] - R.data[i]) ** 2; r += R.data[i] ** 2; }
    const c = fl(A, R), res = [num(10 * Math.log10((peak * peak) / (e / A.data.length)), c)];
    if (nargout > 1) res.push(num(10 * Math.log10(r / e), c));
    return res;
  });
  def('ssim', (a, nargout) => {
    const [v, map] = ssim(numeric(a[0], 'ssim', 1, 'A'), numeric(a[1], 'ssim', 2, 'ref'));
    return nargout > 1 ? [v, map] : [v];
  });
  def('imnoise', a => [imnoise(a)]);
}
