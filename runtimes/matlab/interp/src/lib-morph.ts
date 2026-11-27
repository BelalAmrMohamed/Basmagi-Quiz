// =============================================================================
// runtimes/matlab/interp/src/lib-morph.ts
// Morphology and binary analysis (plan Phase 5.7): strel, getnhood, imerode, imdilate, imopen, imclose, imfill,
// bwlabel, bwareaopen, regionprops.
// =============================================================================
import { T, V, Cls, S, isStr, isS, isC, toStr, mk, num, mkStruct, sat } from './values';
import { Def, T_, err } from './lib-common';

const lc = (v: V) => toStr(v).toLowerCase();
const cen = (k: number) => Math.floor((k - 1) / 2); // 0-based origin of a window of length k (MATLAB: floor((k+1)/2), 1-based)
const planesOf = (t: T) => t.dims.slice(2).reduce((a, b) => a * b, 1);

// ---------- structuring elements ----------
const nhoodT = (r: number, c: number, f: (i: number, j: number) => boolean) => {
  const t = mk('logical', [r, c]);
  for (let j = 0; j < c; j++) for (let i = 0; i < r; i++) t.data[i + r * j] = f(i, j) ? 1 : 0;
  return t;
};
const seStruct = (n: T, h?: T): S => mkStruct(['Neighborhood', 'Height'], [1, 1], [{ Neighborhood: n, Height: h ?? mk('double', n.dims.slice()) }]);

function lineNhood(len: number, deg: number): T {
  if (!(len >= 1)) err('Error using strel: LEN must be at least 1.');
  const th = (deg * Math.PI) / 180, c = Math.cos(th), s = Math.sin(th), half = (len - 1) / 2, pts: [number, number][] = [];
  for (let k = 0; k < len; k++) {
    const m = -half + k; // one step per pixel along the major axis
    pts.push(Math.abs(c) >= Math.abs(s) ? [Math.round(m), Math.round(m * (s / c))] : [Math.round(m * (c / s)), Math.round(m)]); // [x, y], y up
  }
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const t = mk('logical', [y1 - y0 + 1, x1 - x0 + 1]);
  for (const [x, y] of pts) t.data[y1 - y + (y1 - y0 + 1) * (x - x0)] = 1;
  return t;
}

function strel(a: V[]): S {
  if (!a.length || !isStr(a[0])) err('Error using strel: The first argument must be a shape name.');
  const shape = lc(a[0]), arg = (k: number) => (a[k] === undefined ? undefined : T_(a[k], 'strel'));
  const intArg = (k: number, what: string, min: number) => {
    const t = arg(k);
    if (!t || t.data.length !== 1 || !Number.isInteger(t.data[0]) || t.data[0] < min) err(`Error using strel: ${what} must be an integer of at least ${min}.`);
    return (t as T).data[0];
  };
  switch (shape) {
    case 'square': { const w = intArg(1, 'W', 1); return seStruct(nhoodT(w, w, () => true)); }
    case 'rectangle': {
      const t = arg(1);
      if (!t || t.data.length !== 2 || !t.data.every(v => Number.isInteger(v) && v >= 1)) err('Error using strel: MN must be [rows columns] of positive integers.');
      return seStruct(nhoodT(t!.data[0], t!.data[1], () => true));
    }
    case 'diamond': { const r = intArg(1, 'R', 0), n = 2 * r + 1; return seStruct(nhoodT(n, n, (i, j) => Math.abs(i - r) + Math.abs(j - r) <= r)); }
    case 'disk': {
      const r = intArg(1, 'R', 0), n = arg(2) ? (arg(2) as T).data[0] : 4, N = 2 * r + 1;
      if (![0, 4, 6, 8].includes(n)) err('Error using strel: N must be 0, 4, 6 or 8.');
      const lim = n === 0 ? r * r : r * r + r - 1; // n > 0: octagon-like approximation of MATLAB's decomposed disk (see help)
      return seStruct(nhoodT(N, N, (i, j) => (i - r) ** 2 + (j - r) ** 2 <= Math.max(lim, 0)));
    }
    case 'line': { const t = lineNhood(intArg(1, 'LEN', 1), arg(2) ? (arg(2) as T).data[0] : 0); return seStruct(t); }
    case 'arbitrary': {
      const nh = arg(1);
      if (!nh || nh.dims.length !== 2) err('Error using strel: NHOOD must be a 2-D array.');
      const n = nhoodT(nh!.dims[0], nh!.dims[1], (i, j) => nh!.data[i + nh!.dims[0] * j] !== 0), h = arg(2);
      if (h && (h.dims[0] !== n.dims[0] || h.dims[1] !== n.dims[1])) err('Error using strel: HEIGHT must be the same size as NHOOD.');
      return seStruct(n, h ? mk('double', h.dims.slice(), h.data) : undefined);
    }
    default: return err(`Error using strel: Unknown shape '${toStr(a[0])}'. Use 'square', 'rectangle', 'diamond', 'disk', 'line' or 'arbitrary'.`);
  }
}

type Off = { i: number; j: number; h: number };
function offsets(v: V | undefined, fn: string): Off[] {
  let nh: T, ht: T | null = null;
  if (v !== undefined && isS(v)) {
    const rec = v.data[0];
    if (!rec || !('Neighborhood' in rec)) err(`Error using ${fn}: Expected input number 2, SE, to be a structuring element from strel.`);
    nh = rec.Neighborhood as T; ht = (rec.Height as T) ?? null;
  } else nh = T_(v as V, fn);
  if (nh.dims.length !== 2) err(`Error using ${fn}: SE must be two-dimensional.`);
  const [r, c] = nh.dims, oi = cen(r), oj = cen(c), out: Off[] = [];
  for (let j = 0; j < c; j++) for (let i = 0; i < r; i++) if (nh.data[i + r * j] !== 0) out.push({ i: i - oi, j: j - oj, h: ht && ht.data.length === nh.data.length ? ht.data[i + r * j] : 0 });
  if (!out.length) err(`Error using ${fn}: SE must have at least one nonzero element.`);
  return out;
}

function morph(A: T, offs: Off[], dilate: boolean, fn: string): T {
  if (A.cls === 'char' || A.dims.length > 3) err(`Error using ${fn}: Expected input number 1, IM, to be a 2-D or 3-D numeric or logical image.`);
  const m = A.dims[0], n = A.dims[1], np = planesOf(A), out = mk(A.cls, A.dims.slice());
  for (let p = 0; p < np; p++) {
    const base = p * m * n;
    for (let c = 0; c < n; c++) for (let r = 0; r < m; r++) {
      let best = dilate ? -Infinity : Infinity;
      for (const o of offs) { // dilation reflects the element (max of A(p - b) + h); erosion does not (min of A(p + b) - h); outside pixels are ignored
        const rr = dilate ? r - o.i : r + o.i, cc = dilate ? c - o.j : c + o.j;
        if (rr < 0 || cc < 0 || rr >= m || cc >= n) continue;
        const v = A.data[base + rr + m * cc] + (dilate ? o.h : -o.h);
        if (dilate ? v > best : v < best) best = v;
      }
      out.data[base + r + m * c] = A.cls === 'logical' ? (best > 0 ? 1 : 0) : sat(A.cls, best);
    }
  }
  return out;
}

// ---------- binary analysis ----------
function binary(v: V, fn: string): T {
  const t = T_(v, fn);
  if (t.cls === 'char' || t.dims.length > 2) err(`Error using ${fn}: Expected input number 1, BW, to be a 2-D logical or numeric image.`);
  return t;
}
const connOf = (v: V | undefined, fn: string) => { const c = v === undefined ? 8 : T_(v, fn).data[0]; if (c !== 4 && c !== 8) err(`Error using ${fn}: CONN must be 4 or 8.`); return c; };

/** Connected-component labels, numbered in the order the first pixel of each is met scanning column by column. */
function label(bw: T, conn: number): [Float64Array, number] {
  const m = bw.dims[0], n = bw.dims[1], N = m * n, parent = new Int32Array(N).fill(-1), L = new Float64Array(N);
  const find = (x: number) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const union = (x: number, y: number) => { const a = find(x), b = find(y); if (a !== b) parent[Math.max(a, b)] = Math.min(a, b); };
  for (let c = 0; c < n; c++) for (let r = 0; r < m; r++) {
    const i = r + m * c;
    if (bw.data[i] === 0) continue;
    parent[i] = i;
    const nb: [number, number][] = conn === 8 ? [[r - 1, c], [r - 1, c - 1], [r, c - 1], [r + 1, c - 1]] : [[r - 1, c], [r, c - 1]];
    for (const [rr, cc] of nb) if (rr >= 0 && cc >= 0 && rr < m && cc < n && parent[rr + m * cc] >= 0) union(i, rr + m * cc);
  }
  const ids = new Map<number, number>();
  for (let i = 0; i < N; i++) if (parent[i] >= 0) { const root = find(i); let id = ids.get(root); if (id === undefined) { id = ids.size + 1; ids.set(root, id); } L[i] = id; }
  return [L, ids.size];
}

/** Fill the holes: every pixel not reachable from the border through pixels no brighter than it rises to the lowest surrounding wall (4-connected). */
function fillHoles(A: T): T {
  const m = A.dims[0], n = A.dims[1], N = m * n, R = new Float64Array(N).fill(Infinity), border = (r: number, c: number) => r === 0 || c === 0 || r === m - 1 || c === n - 1;
  for (let c = 0; c < n; c++) for (let r = 0; r < m; r++) if (border(r, c)) R[r + m * c] = A.data[r + m * c];
  const relax = (r: number, c: number) => {
    const i = r + m * c;
    let lo = Infinity;
    if (r > 0) lo = Math.min(lo, R[i - 1]); if (r < m - 1) lo = Math.min(lo, R[i + 1]); if (c > 0) lo = Math.min(lo, R[i - m]); if (c < n - 1) lo = Math.min(lo, R[i + m]);
    const v = Math.max(A.data[i], lo);
    if (v < R[i]) { R[i] = v; return true; }
    return false;
  };
  for (let changed = true; changed;) {
    changed = false;
    for (let c = 1; c < n - 1; c++) for (let r = 1; r < m - 1; r++) if (relax(r, c)) changed = true;
    for (let c = n - 2; c >= 1; c--) for (let r = m - 2; r >= 1; r--) if (relax(r, c)) changed = true;
  }
  return mk(A.cls, A.dims.slice(), R);
}

function regionprops(a: V[]): S {
  const I = binary(a[0], 'regionprops');
  const L = I.cls === 'logical' ? label(I, 8)[0] : I.data, m = I.dims[0], n = I.dims[1];
  let want: string[] = [];
  for (const v of a.slice(1)) for (const x of isC(v) ? v.data : [v]) want.push(lc(x as V));
  if (!want.length || want.includes('basic') || want.includes('all')) want = ['area', 'centroid', 'boundingbox'];
  const NAMES: Record<string, string> = { area: 'Area', centroid: 'Centroid', boundingbox: 'BoundingBox' };
  for (const w of want) if (!NAMES[w]) err(`Error using regionprops: Unsupported property '${w}'. Supported: Area, Centroid, BoundingBox.`);
  let K = 0; for (const v of L) if (v > K) K = v;
  const st = Array.from({ length: K }, () => ({ area: 0, sx: 0, sy: 0, x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity }));
  for (let c = 0; c < n; c++) for (let r = 0; r < m; r++) {
    const k = L[r + m * c];
    if (k < 1) continue;
    const s = st[k - 1]; s.area++; s.sx += c + 1; s.sy += r + 1; s.x0 = Math.min(s.x0, c + 1); s.x1 = Math.max(s.x1, c + 1); s.y0 = Math.min(s.y0, r + 1); s.y1 = Math.max(s.y1, r + 1);
  }
  const keys = want.map(w => NAMES[w]);
  const data = st.map(s => {
    const rec: Record<string, V> = {};
    for (const k of keys) {
      if (k === 'Area') rec[k] = num(s.area);
      else if (k === 'Centroid') rec[k] = mk('double', [1, 2], s.area ? [s.sx / s.area, s.sy / s.area] : [NaN, NaN]);
      else rec[k] = mk('double', [1, 4], s.area ? [s.x0 - 0.5, s.y0 - 0.5, s.x1 - s.x0 + 1, s.y1 - s.y0 + 1] : [0.5, 0.5, 0, 0]);
    }
    return rec;
  });
  return mkStruct(keys, [K, 1], data);
}

export function registerMorph(def: Def) {
  def('strel', a => [strel(a)]);
  def('getnhood', a => {
    const v = a[0];
    if (v !== undefined && isS(v) && v.data[0] && 'Neighborhood' in v.data[0]) return [v.data[0].Neighborhood];
    const t = T_(v as V, 'getnhood');
    return [mk('logical', t.dims.slice(), t.data.map(x => (x !== 0 ? 1 : 0)))];
  });
  def('imdilate', a => [morph(T_(a[0], 'imdilate'), offsets(a[1], 'imdilate'), true, 'imdilate')]);
  def('imerode', a => [morph(T_(a[0], 'imerode'), offsets(a[1], 'imerode'), false, 'imerode')]);
  def('imopen', a => { const o = offsets(a[1], 'imopen'); return [morph(morph(T_(a[0], 'imopen'), o, false, 'imopen'), o, true, 'imopen')]; });
  def('imclose', a => { // pad with the minimum first so the dilation can grow past the border before the erosion shrinks it back
    const o = offsets(a[1], 'imclose'), A = T_(a[0], 'imclose');
    if (A.cls === 'char' || A.dims.length > 3) err('Error using imclose: Expected input number 1, IM, to be a 2-D or 3-D numeric or logical image.');
    const pr = Math.max(...o.map(x => Math.abs(x.i))), pc = Math.max(...o.map(x => Math.abs(x.j))), m = A.dims[0], n = A.dims[1], np = planesOf(A);
    const lo = A.cls === 'logical' ? 0 : sat(A.cls, -Infinity), P = mk(A.cls, [m + 2 * pr, n + 2 * pc, ...A.dims.slice(2)]);
    P.data.fill(lo);
    for (let p = 0; p < np; p++) for (let c = 0; c < n; c++) for (let r = 0; r < m; r++) P.data[p * (m + 2 * pr) * (n + 2 * pc) + (r + pr) + (m + 2 * pr) * (c + pc)] = A.data[p * m * n + r + m * c];
    const Q = morph(morph(P, o, true, 'imclose'), o, false, 'imclose'), out = mk(A.cls, A.dims.slice());
    for (let p = 0; p < np; p++) for (let c = 0; c < n; c++) for (let r = 0; r < m; r++) out.data[p * m * n + r + m * c] = Q.data[p * (m + 2 * pr) * (n + 2 * pc) + (r + pr) + (m + 2 * pr) * (c + pc)];
    return [out];
  });

  def('imfill', a => {
    const A = binary(a[0], 'imfill');
    if (a[1] === undefined || !isStr(a[1]) || lc(a[1]) !== 'holes') err("Error using imfill: Only imfill(I, 'holes') is supported (interactive and seed-point forms are not available).");
    return [fillHoles(A)];
  });
  def('bwlabel', (a, nargout) => {
    const bw = binary(a[0], 'bwlabel'), [L, k] = label(bw, connOf(a[1], 'bwlabel'));
    return nargout > 1 ? [mk('double', bw.dims.slice(), L), num(k)] : [mk('double', bw.dims.slice(), L)];
  });
  def('bwareaopen', a => {
    const bw = binary(a[0], 'bwareaopen'), p = T_(a[1], 'bwareaopen').data[0], [L, k] = label(bw, connOf(a[2], 'bwareaopen'));
    if (!(p >= 0)) err('Error using bwareaopen: P must be a nonnegative number.');
    const size = new Float64Array(k + 1); for (const v of L) size[v]++;
    const o = mk('logical', bw.dims.slice());
    for (let i = 0; i < L.length; i++) o.data[i] = L[i] > 0 && size[L[i]] >= p ? 1 : 0;
    return [o];
  });
  def('regionprops', a => [regionprops(a)]);
}

export type { Cls };
