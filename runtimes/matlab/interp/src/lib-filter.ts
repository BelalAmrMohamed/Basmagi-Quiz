// =============================================================================
// runtimes/matlab/interp/src/lib-filter.ts
// Spatial filtering (plan Phase 5.2): conv2, filter2, imfilter, fspecial, padarray, medfilt2, ordfilt2, imgaussfilt.
// All images are column-major; planes beyond the first two dimensions are filtered one by one.
// =============================================================================
import { T, V, Cls, isStr, toStr, mk, sat, numel } from './values';
import { Def, T_, err } from './lib-common';

type Pad = { k: 'const'; v: number } | { k: 'replicate' | 'symmetric' | 'circular' };
const ZERO: Pad = { k: 'const', v: 0 };
const IMG_TYPES = 'uint8, uint16, uint32, int8, int16, int32, single, double, logical';

/** Source index for position i of an axis of length n, or -1 when the position holds the constant pad value. */
function mapIdx(i: number, n: number, p: Pad): number {
  if (i >= 0 && i < n) return i;
  if (n === 0) return -1;
  if (p.k === 'const') return -1;
  if (p.k === 'replicate') return i < 0 ? 0 : n - 1;
  if (p.k === 'circular') return ((i % n) + n) % n;
  const q = ((i % (2 * n)) + 2 * n) % (2 * n);
  return q < n ? q : 2 * n - 1 - q;
}

/** pm x pn copy of one plane where P(x,y) = A(x+r0, y+c0) under the padding rule. */
function padPlane(src: Float64Array, so: number, m: number, n: number, r0: number, c0: number, pm: number, pn: number, pad: Pad): Float64Array {
  const P = new Float64Array(pm * pn), cv = pad.k === 'const' ? pad.v : 0, rm = new Int32Array(pm);
  for (let x = 0; x < pm; x++) rm[x] = mapIdx(x + r0, m, pad);
  for (let y = 0; y < pn; y++) {
    const cy = mapIdx(y + c0, n, pad);
    for (let x = 0; x < pm; x++) { const rx = rm[x]; P[x + pm * y] = rx < 0 || cy < 0 ? cv : src[so + rx + m * cy]; }
  }
  return P;
}

/** out(p,q) = sum h(i,j) * P(p+i, q+j) over an om x on output. */
function correlate(P: Float64Array, pm: number, h: ArrayLike<number>, kr: number, kc: number, om: number, on: number): Float64Array {
  const out = new Float64Array(om * on);
  for (let j = 0; j < kc; j++) for (let i = 0; i < kr; i++) {
    const hv = h[i + kr * j];
    if (!hv) continue;
    for (let q = 0; q < on; q++) { const o = om * q, s = i + pm * (q + j); for (let p = 0; p < om; p++) out[o + p] += hv * P[s + p]; }
  }
  return out;
}

/** Correlate every plane of t with h (kr x kc) whose window starts at (r0,c0) relative to the output pixel. */
export function filterT(t: T, h: ArrayLike<number>, kr: number, kc: number, r0: number, c0: number, om: number, on: number, pad: Pad, cls: Cls): T {
  const m = t.dims[0], n = t.dims[1], rest = t.dims.slice(2), np = numel(rest);
  const out = mk(cls, [om, on, ...rest]);
  if (om * on === 0) return out;
  for (let p = 0; p < np; p++) {
    const P = padPlane(t.data, p * m * n, m, n, r0, c0, om + kr - 1, on + kc - 1, pad);
    const r = correlate(P, om + kr - 1, h, kr, kc, om, on), base = p * om * on;
    for (let i = 0; i < r.length; i++) out.data[base + i] = sat(cls, r[i]);
  }
  return out;
}

const cen = (k: number) => Math.floor((k - 1) / 2); // 0-based center of a window of length k (MATLAB: floor((k+1)/2), 1-based)
const rot180 = (h: Float64Array) => { const r = new Float64Array(h.length); for (let i = 0; i < h.length; i++) r[i] = h[h.length - 1 - i]; return r; };
const lc = (v: V) => toStr(v).toLowerCase();

function conv2Core(A: T, K: T, kernelIsRotated: boolean, shape: string, fn: string): T {
  if (A.dims.length > 2 || K.dims.length > 2) err(`Error using ${fn}: N-D arrays are not supported.`);
  if (shape !== 'full' && shape !== 'same' && shape !== 'valid') err(`Error using ${fn}: Unknown shape parameter '${shape}'. Use 'full', 'same' or 'valid'.`);
  const cls: Cls = A.cls === 'single' || K.cls === 'single' ? 'single' : 'double';
  const [m, n] = A.dims, [kr, kc] = K.dims;
  const dim = (a: number, k: number) => Math.max(0, shape === 'full' ? a + k - 1 : shape === 'same' ? a : a - k + 1);
  const om = dim(m, kr), on = dim(n, kc);
  if (om * on === 0 || kr * kc === 0) return mk(cls, [om, on]);
  const h = kernelIsRotated ? K.data : rot180(K.data);
  const st = (k: number) => (shape === 'full' ? 0 : shape === 'same' ? Math.floor(k / 2) : k - 1);
  return filterT(A, h, kr, kc, -(kr - 1) + st(kr), -(kc - 1) + st(kc), om, on, ZERO, cls);
}

const shapeArg = (v: V | undefined) => (v === undefined ? 'full' : lc(v));

function checkImg(A: T, fn: string, pos = 1, name = 'A') {
  if (A.cls === 'char') err(`Error using ${fn}: Expected input number ${pos}, ${name}, to be one of these types: ${IMG_TYPES}`);
}

// ---------- fspecial ----------
function fspecial(a: V[]): T {
  const type = a[0] ? lc(a[0]) : err('Error using fspecial: Not enough input arguments.');
  const arg = (k: number) => (a[k] === undefined ? undefined : T_(a[k], 'fspecial'));
  const size2 = (k: number, def: number[]): [number, number] => {
    const t = arg(k);
    if (!t) return [def[0], def[1]];
    const r = t.data.length === 1 ? [t.data[0], t.data[0]] : [t.data[0], t.data[1]];
    if (!r.every(v => v >= 1 && Number.isInteger(v))) err('Error using fspecial: HSIZE must contain positive integers.');
    return [r[0], r[1]];
  };
  const make = (r: number, c: number, f: (i: number, j: number) => number) => {
    const h = mk('double', [r, c]);
    for (let j = 0; j < c; j++) for (let i = 0; i < r; i++) h.data[i + r * j] = f(i, j);
    return h;
  };
  const fromRows = (rows: number[][]) => make(rows.length, rows[0].length, (i, j) => rows[i][j]);
  const sc = (k: number, d: number) => { const t = arg(k); return t ? t.data[0] : d; };
  switch (type) {
    case 'average': { const [r, c] = size2(1, [3, 3]); return make(r, c, () => 1 / (r * c)); }
    case 'gaussian': case 'log': {
      const isLog = type === 'log', [r, c] = size2(1, isLog ? [5, 5] : [3, 3]), sg = sc(2, 0.5);
      if (!(sg > 0)) err('Error using fspecial: SIGMA must be positive.');
      const s2 = sg * sg, x = (j: number) => j - (c - 1) / 2, y = (i: number) => i - (r - 1) / 2;
      const h = make(r, c, (i, j) => Math.exp(-(x(j) ** 2 + y(i) ** 2) / (2 * s2)));
      const mx = Math.max(...h.data);
      for (let i = 0; i < h.data.length; i++) if (h.data[i] < 2.220446049250313e-16 * mx) h.data[i] = 0;
      let sum = 0; for (const v of h.data) sum += v;
      if (sum !== 0) for (let i = 0; i < h.data.length; i++) h.data[i] /= sum;
      if (!isLog) return h;
      const h1 = make(r, c, (i, j) => h.data[i + r * j] * (x(j) ** 2 + y(i) ** 2 - 2 * s2) / (s2 * s2));
      let s1 = 0; for (const v of h1.data) s1 += v;
      for (let i = 0; i < h1.data.length; i++) h1.data[i] -= s1 / h1.data.length;
      return h1;
    }
    case 'laplacian': {
      const al = Math.min(1, Math.max(0, sc(1, 0.2))), p = al / (al + 1), q = (1 - al) / (al + 1);
      return fromRows([[p, q, p], [q, -4 / (al + 1), q], [p, q, p]]);
    }
    case 'unsharp': {
      const al = Math.min(1, Math.max(0, sc(1, 0.2))), d = al + 1;
      return fromRows([[-al / d, (al - 1) / d, -al / d], [(al - 1) / d, (al + 5) / d, (al - 1) / d], [-al / d, (al - 1) / d, -al / d]]);
    }
    case 'prewitt': return fromRows([[1, 1, 1], [0, 0, 0], [-1, -1, -1]]);
    case 'sobel': return fromRows([[1, 2, 1], [0, 0, 0], [-1, -2, -1]]);
    case 'disk': return disk(sc(1, 5));
    case 'motion': return motion(sc(1, 9), sc(2, 0));
    default: return err(`Error using fspecial: Unknown filter type '${toStr(a[0])}'.`);
  }
}

/** MathWorks fspecial('disk'): area of every pixel inside the circle, then normalised. */
function disk(rad: number): T {
  if (!(rad > 0)) err('Error using fspecial: RADIUS must be positive.');
  const crad = Math.ceil(rad - 0.5), N = 2 * crad + 1, r2 = rad * rad, g = mk('double', [N, N]), at = (i: number, j: number) => i + N * j;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const ax = Math.abs(j - crad), ay = Math.abs(i - crad), mx = Math.max(ax, ay), mn = Math.min(ax, ay);
    const m1 = r2 < (mx + 0.5) ** 2 + (mn - 0.5) ** 2 ? mn - 0.5 : Math.sqrt(r2 - (mx + 0.5) ** 2);
    const m2 = r2 > (mx - 0.5) ** 2 + (mn + 0.5) ** 2 ? mn + 0.5 : Math.sqrt(r2 - (mx - 0.5) ** 2);
    const mask = (r2 < (mx + 0.5) ** 2 + (mn + 0.5) ** 2 && r2 > (mx - 0.5) ** 2 + (mn - 0.5) ** 2) || (mn === 0 && mx - 0.5 < rad && mx + 0.5 >= rad);
    let s = 0;
    if (mask) {
      s = (r2 * (0.5 * (Math.asin(m2 / rad) - Math.asin(m1 / rad)) + 0.25 * (Math.sin(2 * Math.asin(m2 / rad)) - Math.sin(2 * Math.asin(m1 / rad)))) - (mx - 0.5) * (m2 - m1) + (m1 - mn + 0.5));
    }
    if ((mx + 0.5) ** 2 + (mn + 0.5) ** 2 < r2) s += 1;
    g.data[at(i, j)] = s;
  }
  g.data[at(crad, crad)] = Math.min(Math.PI * r2, Math.PI / 2);
  if (crad > 0 && rad > crad - 0.5 && r2 < (crad - 0.5) ** 2 + 0.25) {
    const m1 = Math.sqrt(r2 - (crad - 0.5) ** 2), m1n = m1 / rad;
    const sg0 = 2 * (r2 * (0.5 * Math.asin(m1n) + 0.25 * Math.sin(2 * Math.asin(m1n))) - m1 * (crad - 0.5));
    g.data[at(2 * crad, crad)] = sg0; g.data[at(crad, 2 * crad)] = sg0; g.data[at(crad, 0)] = sg0; g.data[at(0, crad)] = sg0;
    g.data[at(2 * crad - 1, crad)] -= sg0; g.data[at(crad, 2 * crad - 1)] -= sg0; g.data[at(crad, 1)] -= sg0; g.data[at(1, crad)] -= sg0;
  }
  g.data[at(crad, crad)] = Math.min(g.data[at(crad, crad)], 1);
  let sum = 0; for (const v of g.data) sum += v;
  for (let i = 0; i < g.data.length; i++) g.data[i] /= sum;
  return g;
}

/** Line of `len` pixels at `theta` degrees (counter-clockwise as displayed): coverage along the line times 1-|distance across it|. */
function motion(len: number, theta: number): T {
  len = Math.max(1, len);
  const half = len / 2, ph = (theta * Math.PI) / 180, c = Math.cos(ph), s = Math.sin(ph), R = Math.ceil(half) + 1, N = 2 * R + 1;
  const w = new Float64Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = j - R, y = R - i; // y up
    const t = x * c + y * s, d = -x * s + y * c;
    w[i + N * j] = Math.max(0, Math.min(1, half + 0.5 - Math.abs(t))) * Math.max(0, 1 - Math.abs(d));
  }
  let r0 = N, r1 = -1, c0 = N, c1 = -1;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) if (w[i + N * j] > 1e-12) { r0 = Math.min(r0, i); r1 = Math.max(r1, i); c0 = Math.min(c0, j); c1 = Math.max(c1, j); }
  const rr = r1 - r0 + 1, cc = c1 - c0 + 1, h = mk('double', [rr, cc]);
  let sum = 0;
  for (let j = 0; j < cc; j++) for (let i = 0; i < rr; i++) { const v = w[i + r0 + N * (j + c0)]; h.data[i + rr * j] = v; sum += v; }
  for (let i = 0; i < h.data.length; i++) h.data[i] /= sum;
  return h;
}

// ---------- window statistics (medfilt2, ordfilt2) ----------
function windowStat(A: T, kr: number, kc: number, offs: [number, number][], add: number[] | null, pad: Pad, pick: (sorted: Float64Array) => number): T {
  const m = A.dims[0], n = A.dims[1], out = mk(A.cls, A.dims.slice());
  if (m * n === 0) return out;
  const pm = m + kr - 1, pn = n + kc - 1, buf = new Float64Array(offs.length);
  const P = padPlane(A.data, 0, m, n, -cen(kr), -cen(kc), pm, pn, pad);
  for (let q = 0; q < n; q++) for (let p = 0; p < m; p++) {
    for (let k = 0; k < offs.length; k++) buf[k] = P[p + offs[k][0] + pm * (q + offs[k][1])] + (add ? add[k] : 0);
    out.data[p + m * q] = sat(A.cls, pick(buf.sort()));
  }
  return out;
}

function padOpt(v: V | undefined, cls: Cls, fn: string): Pad {
  if (v === undefined) return ZERO;
  const s = lc(v);
  if (s === 'zeros') return ZERO;
  if (s === 'symmetric') return { k: 'symmetric' };
  if (s === 'indexed' && fn === 'medfilt2') return { k: 'const', v: cls === 'double' || cls === 'single' ? 1 : 0 };
  return err(`Error using ${fn}: Unknown padding option '${s}'.`);
}

const img2d = (v: V | undefined, fn: string): T => {
  const t = T_(v as V, fn);
  checkImg(t, fn);
  if (t.dims.length > 2) err(`Error using ${fn}: Expected input number 1, A, to be two-dimensional.`);
  return t;
};

// ---------- imgaussfilt ----------
function gauss1(size: number, sigma: number): Float64Array {
  const g = new Float64Array(size), c = (size - 1) / 2;
  let s = 0;
  for (let i = 0; i < size; i++) { g[i] = Math.exp(-((i - c) ** 2) / (2 * sigma * sigma)); s += g[i]; }
  for (let i = 0; i < size; i++) g[i] /= s;
  return g;
}

export function registerFilter(def: Def) {
  def('conv2', a => {
    if (a.length < 2) err('Error using conv2: Not enough input arguments.');
    if (a.length >= 3 && !isStr(a[2])) { // conv2(v1, v2, A, shape): separable form
      const v1 = T_(a[0], 'conv2'), v2 = T_(a[1], 'conv2'), A = T_(a[2], 'conv2'), sh = shapeArg(a[3]);
      const col = mk(v1.cls, [v1.data.length, 1], v1.data), row = mk(v2.cls, [1, v2.data.length], v2.data);
      return [conv2Core(conv2Core(A, col, false, sh, 'conv2'), row, false, sh, 'conv2')];
    }
    return [conv2Core(T_(a[0], 'conv2'), T_(a[1], 'conv2'), false, shapeArg(a[2]), 'conv2')];
  });
  def('filter2', a => {
    if (a.length < 2) err('Error using filter2: Not enough input arguments.');
    return [conv2Core(T_(a[1], 'filter2'), T_(a[0], 'filter2'), true, a[2] === undefined ? 'same' : lc(a[2]), 'filter2')];
  });

  def('imfilter', a => {
    if (a.length < 2) err('Error using imfilter: Not enough input arguments.');
    const A = T_(a[0], 'imfilter'), H = T_(a[1], 'imfilter');
    checkImg(A, 'imfilter');
    if (H.dims.length > 2) err('Error using imfilter: The filter H must be two-dimensional.');
    let conv = false, full = false, pad: Pad = ZERO;
    for (let k = 2; k < a.length; k++) {
      const o = T_(a[k], 'imfilter');
      if (!isStr(o)) { pad = { k: 'const', v: o.data[0] }; continue; }
      const s = lc(o);
      if (s === 'conv') conv = true; else if (s === 'corr') conv = false;
      else if (s === 'full') full = true; else if (s === 'same') full = false;
      else if (s === 'replicate' || s === 'symmetric' || s === 'circular') pad = { k: s };
      else err(`Error using imfilter: Invalid option '${s}'.`);
    }
    const [kr, kc] = H.dims, m = A.dims[0], n = A.dims[1];
    const om = full ? m + kr - 1 : m, on = full ? n + kc - 1 : n;
    if (kr * kc === 0) return [mk(A.cls, [om, on, ...A.dims.slice(2)])];
    const h = conv ? rot180(H.data) : H.data;
    return [filterT(A, h, kr, kc, full ? -(kr - 1) : -cen(kr), full ? -(kc - 1) : -cen(kc), om, on, pad, A.cls)];
  });

  def('fspecial', a => [fspecial(a)]);

  def('padarray', a => {
    if (a.length < 2) err('Error using padarray: Not enough input arguments.');
    const A = T_(a[0], 'padarray'), ps = Array.from(T_(a[1], 'padarray').data);
    if (!ps.every(v => v >= 0 && Number.isInteger(v))) err('Error using padarray: Expected input number 2, PADSIZE, to be nonnegative integers.');
    let pad: Pad = ZERO, dir = 'both';
    for (let k = 2; k < a.length; k++) {
      const o = T_(a[k], 'padarray');
      if (!isStr(o)) { pad = { k: 'const', v: o.data[0] }; continue; }
      const s = lc(o);
      if (s === 'replicate' || s === 'symmetric' || s === 'circular') pad = { k: s };
      else if (s === 'pre' || s === 'post' || s === 'both') dir = s;
      else err(`Error using padarray: Invalid option '${s}'.`);
    }
    const nd = Math.max(A.dims.length, ps.length), dims = Array.from({ length: nd }, (_, k) => A.dims[k] ?? 1);
    const pre = dims.map((_, k) => (dir === 'post' ? 0 : ps[k] ?? 0)), post = dims.map((_, k) => (dir === 'pre' ? 0 : ps[k] ?? 0));
    const od = dims.map((d, k) => d + pre[k] + post[k]);
    const maps = od.map((o, k) => { const mp = new Int32Array(o); for (let x = 0; x < o; x++) mp[x] = mapIdx(x - pre[k], dims[k], pad); return mp; });
    const stride: number[] = []; let st = 1;
    for (let k = 0; k < nd; k++) { stride.push(st); st *= dims[k]; }
    const out = mk(A.cls, od), cv = sat(A.cls, pad.k === 'const' ? pad.v : 0), total = numel(od), c = new Array(nd).fill(0);
    for (let lin = 0; lin < total; lin++) {
      let off = 0, bad = false;
      for (let k = 0; k < nd; k++) { const s = maps[k][c[k]]; if (s < 0) { bad = true; break; } off += s * stride[k]; }
      out.data[lin] = bad ? cv : A.data[off];
      for (let k = 0; k < nd; k++) { if (++c[k] < od[k]) break; c[k] = 0; }
    }
    return [out];
  });

  def('medfilt2', a => {
    const A = img2d(a[0], 'medfilt2');
    const sz = a[1] !== undefined && !isStr(a[1]) ? T_(a[1], 'medfilt2').data : [3, 3];
    const mm = sz.length === 1 ? sz[0] : sz[0], nn = sz.length === 1 ? sz[0] : sz[1];
    if (!(mm >= 1 && nn >= 1 && Number.isInteger(mm) && Number.isInteger(nn))) err('Error using medfilt2: [M N] must be positive integers.');
    const po = a[1] !== undefined && isStr(a[1]) ? a[1] : a[2];
    const offs: [number, number][] = [];
    for (let j = 0; j < nn; j++) for (let i = 0; i < mm; i++) offs.push([i, j]);
    const cnt = mm * nn, pad = padOpt(po, A.cls, 'medfilt2');
    return [windowStat(A, mm, nn, offs, null, pad, s => (cnt % 2 ? s[(cnt - 1) / 2] : (s[cnt / 2 - 1] + s[cnt / 2]) / 2))];
  });

  def('ordfilt2', a => {
    if (a.length < 3) err('Error using ordfilt2: Not enough input arguments.');
    const A = img2d(a[0], 'ordfilt2'), order = T_(a[1], 'ordfilt2').data[0], D = T_(a[2], 'ordfilt2');
    if (D.dims.length > 2) err('Error using ordfilt2: DOMAIN must be two-dimensional.');
    const [kr, kc] = D.dims, offs: [number, number][] = [];
    for (let j = 0; j < kc; j++) for (let i = 0; i < kr; i++) if (D.data[i + kr * j] !== 0) offs.push([i, j]);
    if (!Number.isInteger(order) || order < 1 || order > offs.length) err('Error using ordfilt2: ORDER must be an integer between 1 and the number of nonzero elements of DOMAIN.');
    let add: number[] | null = null, po: V | undefined;
    for (let k = 3; k < a.length; k++) {
      const o = T_(a[k], 'ordfilt2');
      if (isStr(o)) po = o;
      else {
        if (o.data.length !== D.data.length) err('Error using ordfilt2: S must be the same size as DOMAIN.');
        add = offs.map(([i, j]) => o.data[i + kr * j]);
      }
    }
    return [windowStat(A, kr, kc, offs, add, padOpt(po, A.cls, 'ordfilt2'), s => s[order - 1])];
  });

  def('imgaussfilt', a => {
    const A = T_(a[0], 'imgaussfilt');
    checkImg(A, 'imgaussfilt');
    if (A.dims.length > 3) err('Error using imgaussfilt: Expected input number 1, A, to be 2-D or 3-D.');
    let sig = [0.5, 0.5], k = 1;
    if (a[1] !== undefined && !isStr(a[1])) { const s = T_(a[1], 'imgaussfilt').data; sig = s.length >= 2 ? [s[0], s[1]] : [s[0], s[0]]; k = 2; }
    if (!sig.every(v => v > 0 && isFinite(v))) err('Error using imgaussfilt: SIGMA must be positive.');
    let fs = sig.map(s => 2 * Math.ceil(2 * s) + 1), pad: Pad = { k: 'replicate' };
    for (; k < a.length; k += 2) {
      const nm = lc(a[k]), v = a[k + 1] === undefined ? err(`Error using imgaussfilt: Missing value for '${toStr(a[k])}'.`) : T_(a[k + 1], 'imgaussfilt');
      if (nm === 'filtersize') {
        fs = v.data.length === 1 ? [v.data[0], v.data[0]] : [v.data[0], v.data[1]];
        if (!fs.every(x => x >= 1 && x % 2 === 1)) err('Error using imgaussfilt: FilterSize must contain positive odd integers.');
      } else if (nm === 'padding') {
        if (isStr(v)) { const s = lc(v); if (s === 'replicate' || s === 'symmetric' || s === 'circular') pad = { k: s }; else err(`Error using imgaussfilt: Invalid padding '${s}'.`); }
        else pad = { k: 'const', v: v.data[0] };
      } else if (nm === 'filterdomain') { if (lc(v) !== 'spatial') err("Error using imgaussfilt: Only the 'spatial' FilterDomain is supported."); }
      else err(`Error using imgaussfilt: Unknown option '${toStr(a[k])}'.`);
    }
    const gy = gauss1(fs[0], sig[0]), gx = gauss1(fs[1], sig[1]), m = A.dims[0], n = A.dims[1];
    if (m * n === 0) return [A];
    const tmp = filterT(A, gy, fs[0], 1, -cen(fs[0]), 0, m, n, pad, 'double'); // vertical pass keeps full precision
    return [filterT(tmp, gx, 1, fs[1], 0, -cen(fs[1]), m, n, pad, A.cls)];
  });
}


