// =============================================================================
// runtimes/matlab/interp/src/lib-geom.ts
// Geometric transforms (plan Phase 5.4): imresize (nearest, bilinear, bicubic, anti-aliasing), imrotate, imtranslate.
// =============================================================================
import { T, V, Cls, isStr, toStr, mk, sat } from './values';
import { Def, T_, err } from './lib-common';

const lc = (v: V) => toStr(v).toLowerCase();
const planesOf = (t: T) => t.dims.slice(2).reduce((a, b) => a * b, 1);

// ---------- kernels (MathWorks imresize) ----------
const box = (x: number) => (x >= -0.5 && x < 0.5 ? 1 : 0);
const tri = (x: number) => { const a = Math.abs(x); return a < 1 ? 1 - a : 0; };
const cubic = (x: number) => { // Keys, a = -0.5
  const a = Math.abs(x), a2 = a * a, a3 = a2 * a;
  return a <= 1 ? 1.5 * a3 - 2.5 * a2 + 1 : a <= 2 ? -0.5 * a3 + 2.5 * a2 - 4 * a + 2 : 0;
};
const KERNELS: Record<string, { h: (x: number) => number; w: number }> = { nearest: { h: box, w: 1 }, bilinear: { h: tri, w: 2 }, bicubic: { h: cubic, w: 4 } };

/** Symmetric (mirror) index of 1-based position k in an axis of length n, as 0-based. */
const mirror = (k: number, n: number) => { const p = (((k - 1) % (2 * n)) + 2 * n) % (2 * n); return p < n ? p : 2 * n - 1 - p; };

type Weights = { idx: Int32Array; w: Float64Array }[];
function weightsFor(inN: number, outN: number, method: string, aa: boolean): Weights {
  const { h: h0, w: kw0 } = KERNELS[method], scale = outN / inN;
  const widen = scale < 1 && aa, h = widen ? (x: number) => scale * h0(scale * x) : h0, kw = widen ? kw0 / scale : kw0;
  const P = Math.ceil(kw) + 2, out: Weights = [];
  for (let i = 1; i <= outN; i++) {
    const u = i / scale + 0.5 * (1 - 1 / scale), left = Math.floor(u - kw / 2), idx = new Int32Array(P), w = new Float64Array(P);
    let s = 0;
    for (let p = 0; p < P; p++) { const k = left + p; idx[p] = mirror(k, inN); w[p] = h(u - k); s += w[p]; }
    for (let p = 0; p < P; p++) w[p] /= s;
    out.push({ idx, w });
  }
  return out;
}

function resize(A: T, oh: number, ow: number, method: string, aa: boolean): T {
  const H = A.dims[0], W = A.dims[1], np = planesOf(A), rw = weightsFor(H, oh, method, aa), cw = weightsFor(W, ow, method, aa);
  const out = mk(A.cls, [oh, ow, ...A.dims.slice(2)]), tmp = new Float64Array(oh * W);
  for (let p = 0; p < np; p++) {
    const src = p * H * W;
    for (let c = 0; c < W; c++) for (let i = 0; i < oh; i++) { const { idx, w } = rw[i]; let s = 0; for (let q = 0; q < idx.length; q++) s += w[q] * A.data[src + idx[q] + H * c]; tmp[i + oh * c] = s; }
    for (let j = 0; j < ow; j++) { const { idx, w } = cw[j]; for (let i = 0; i < oh; i++) { let s = 0; for (let q = 0; q < idx.length; q++) s += w[q] * tmp[i + oh * idx[q]]; out.data[p * oh * ow + i + oh * j] = A.cls === 'logical' ? (s > 0.5 ? 1 : 0) : sat(A.cls, s); } }
  }
  return out;
}

// ---------- point sampling for rotate / translate ----------
type Interp = 'nearest' | 'linear' | 'cubic';
/** Value of plane `off` at 1-based (y, x), or NaN when the point lies outside the image (beyond half a pixel). Neighbours past the border repeat the edge. */
function sample(d: Float64Array, off: number, H: number, W: number, y: number, x: number, m: Interp): number {
  if (!(y >= 0.5 && y < H + 0.5 && x >= 0.5 && x < W + 0.5)) return NaN;
  const px = (r: number, c: number) => d[off + Math.min(H, Math.max(1, r)) - 1 + H * (Math.min(W, Math.max(1, c)) - 1)];
  if (m === 'nearest') return px(Math.floor(y + 0.5), Math.floor(x + 0.5));
  const y0 = Math.floor(y), x0 = Math.floor(x), fy = y - y0, fx = x - x0;
  if (m === 'linear') return (1 - fy) * ((1 - fx) * px(y0, x0) + fx * px(y0, x0 + 1)) + fy * ((1 - fx) * px(y0 + 1, x0) + fx * px(y0 + 1, x0 + 1));
  let s = 0;
  for (let a = -1; a <= 2; a++) { const wy = cubic(fy - a); let r = 0; for (let b = -1; b <= 2; b++) r += cubic(fx - b) * px(y0 + a, x0 + b); s += wy * r; }
  return s;
}
const finish = (cls: Cls, v: number, fill: number, interpolated: boolean) => (v !== v ? fill : cls === 'logical' && interpolated ? (v > 0.5 ? 1 : 0) : sat(cls, v));

function rotate(A: T, deg: number, method: Interp, crop: boolean): T {
  const H = A.dims[0], W = A.dims[1], np = planesOf(A), q = deg / 90;
  if (!crop && Number.isInteger(q)) { // multiples of 90: exact, no resampling
    const k = ((q % 4) + 4) % 4, nh = k % 2 ? W : H, nw = k % 2 ? H : W, o = mk(A.cls, [nh, nw, ...A.dims.slice(2)]);
    for (let p = 0; p < np; p++) for (let i = 0; i < H; i++) for (let j = 0; j < W; j++) {
      const [ni, nj] = k === 0 ? [i, j] : k === 1 ? [W - 1 - j, i] : k === 2 ? [H - 1 - i, W - 1 - j] : [j, H - 1 - i];
      o.data[p * nh * nw + ni + nh * nj] = A.data[p * H * W + i + H * j];
    }
    return o;
  }
  const th = (deg * Math.PI) / 180, c = Math.cos(th), s = Math.sin(th);
  const oh = crop ? H : Math.max(1, Math.ceil(W * Math.abs(s) + H * Math.abs(c) - 1e-9)), ow = crop ? W : Math.max(1, Math.ceil(W * Math.abs(c) + H * Math.abs(s) - 1e-9));
  const o = mk(A.cls, [oh, ow, ...A.dims.slice(2)]), ci = (W + 1) / 2, ri = (H + 1) / 2, co = (ow + 1) / 2, ro = (oh + 1) / 2;
  for (let p = 0; p < np; p++) for (let x = 1; x <= ow; x++) for (let y = 1; y <= oh; y++) {
    const dx = x - co, dy = y - ro;
    o.data[p * oh * ow + (y - 1) + oh * (x - 1)] = finish(A.cls, sample(A.data, p * H * W, H, W, ri + dx * s + dy * c, ci + dx * c - dy * s, method), 0, method !== 'nearest');
  }
  return o;
}

function translate(A: T, tx: number, ty: number, method: Interp, fill: number, full: boolean): T {
  const H = A.dims[0], W = A.dims[1], np = planesOf(A);
  const oh = full ? H + Math.ceil(Math.abs(ty)) : H, ow = full ? W + Math.ceil(Math.abs(tx)) : W;
  const ox = full ? Math.min(0, tx) - tx : -tx, oy = full ? Math.min(0, ty) - ty : -ty; // source = output + offset
  const o = mk(A.cls, [oh, ow, ...A.dims.slice(2)]);
  for (let p = 0; p < np; p++) for (let x = 1; x <= ow; x++) for (let y = 1; y <= oh; y++)
    o.data[p * oh * ow + (y - 1) + oh * (x - 1)] = finish(A.cls, sample(A.data, p * H * W, H, W, y + oy, x + ox, method), sat(A.cls, fill), method !== 'nearest');
  return o;
}

function checkImg(A: T, fn: string) {
  if (A.cls === 'char') err(`Error using ${fn}: Expected input number 1, A, to be one of these types: uint8, uint16, int16, single, double, logical`);
  if (A.dims.length > 3) err(`Error using ${fn}: Expected input number 1, A, to be 2-D or 3-D.`);
}

export function registerGeom(def: Def) {
  def('imresize', a => {
    const A = T_(a[0], 'imresize');
    checkImg(A, 'imresize');
    const H = A.dims[0], W = A.dims[1];
    let size: T | null = null, method = 'bicubic', aa: boolean | null = null, k = 1;
    const setSize = (t: T, asScale: boolean) => {
      const d = Array.from(t.data);
      if (asScale) { if (d.length !== 1 || !(d[0] > 0)) err('Error using imresize: Scale must be a positive scalar.'); size = mk('double', [1, 1], d); }
      else size = mk('double', [1, d.length], d);
    };
    if (a[1] !== undefined && !isStr(a[1])) { const t = T_(a[1], 'imresize'); setSize(t, t.data.length === 1); k = 2; }
    for (; k < a.length; k++) {
      const s = lc(a[k]);
      if (s in KERNELS) method = s;
      else if (s === 'antialiasing') { aa = T_(a[++k], 'imresize').data[0] !== 0; }
      else if (s === 'outputsize') setSize(T_(a[++k], 'imresize'), false);
      else if (s === 'scale') setSize(T_(a[++k], 'imresize'), true);
      else err(`Error using imresize: Unsupported method or option '${toStr(a[k])}'. Methods: 'nearest', 'bilinear', 'bicubic'.`);
    }
    if (!size) err('Error using imresize: Not enough input arguments.');
    const sz = size as unknown as T;
    let oh: number, ow: number;
    if (sz.data.length === 1) { oh = Math.ceil(H * sz.data[0]); ow = Math.ceil(W * sz.data[0]); }
    else if (sz.data.length === 2) {
      const [m, n] = [sz.data[0], sz.data[1]];
      if (m !== m && n !== n) err('Error using imresize: Only one element of the output size can be NaN.');
      oh = m !== m ? Math.ceil((H * n) / W) : m; ow = n !== n ? Math.ceil((W * m) / H) : n;
    } else err('Error using imresize: Output size must be a scalar scale or [rows columns].');
    if (!(Number.isInteger(oh) && Number.isInteger(ow) && oh >= 1 && ow >= 1)) err('Error using imresize: Output size must be positive integers.');
    if (H * W === 0) return [mk(A.cls, [oh, ow, ...A.dims.slice(2)])];
    return [resize(A, oh, ow, method, aa ?? method !== 'nearest')];
  });

  def('imrotate', a => {
    const A = T_(a[0], 'imrotate');
    checkImg(A, 'imrotate');
    if (a.length < 2) err('Error using imrotate: Not enough input arguments.');
    const ang = T_(a[1], 'imrotate').data[0];
    let method: Interp = 'nearest', crop = false;
    for (let k = 2; k < a.length; k++) {
      const s = lc(a[k]);
      if (s === 'nearest') method = 'nearest'; else if (s === 'bilinear') method = 'linear'; else if (s === 'bicubic') method = 'cubic';
      else if (s === 'crop') crop = true; else if (s === 'loose') crop = false;
      else err(`Error using imrotate: Invalid option '${toStr(a[k])}'. Use 'nearest', 'bilinear', 'bicubic', 'crop' or 'loose'.`);
    }
    return [rotate(A, ang, method, crop)];
  });

  def('imtranslate', a => {
    const A = T_(a[0], 'imtranslate');
    checkImg(A, 'imtranslate');
    if (a.length < 2) err('Error using imtranslate: Not enough input arguments.');
    const t = T_(a[1], 'imtranslate').data;
    if (t.length !== 2 && !(t.length === 3 && t[2] === 0)) err('Error using imtranslate: TRANSLATION must be [tx ty] (a nonzero third element is not supported).');
    let method: Interp = 'linear', fill = 0, full = false;
    for (let k = 2; k < a.length; k++) {
      const s = lc(a[k]);
      if (s === 'nearest' || s === 'linear' || s === 'cubic') method = s;
      else if (s === 'fillvalues') fill = T_(a[++k], 'imtranslate').data[0];
      else if (s === 'outputview') { const v = lc(a[++k]); if (v !== 'same' && v !== 'full') err(`Error using imtranslate: Invalid OutputView '${v}'.`); full = v === 'full'; }
      else err(`Error using imtranslate: Invalid option '${toStr(a[k])}'.`);
    }
    return [translate(A, t[0], t[1], method, fill, full)];
  });
}
