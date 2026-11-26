import { T, V, C, S, Cls, isT, isC, isS, isStr, toStr, scalarOf, numel, sat, mk, num, cat, dimStr, mkStruct } from './values';
import { Def, err, T_, dimsFrom, rnd, setSeed, randnSample } from './lib-common';

function magicSquare(n: number): number[] {
  if (n === 0) return [];
  if (n === 1) return [1];
  if (n === 2) return [1, 4, 3, 2]; // MATLAB's magic(2) column-major: [1 3; 4 2]
  const out = new Array(n * n).fill(0);
  const set = (r: number, c: number, v: number) => { out[r + n * c] = v; };
  if (n % 2 === 1) {
    let r = 0, c = (n - 1) >> 1;
    for (let k = 1; k <= n * n; k++) {
      set(r, c, k);
      const nr = (r - 1 + n) % n, nc = (c + 1) % n;
      if (out[nr + n * nc] !== 0) r = (r + 1) % n;
      else { r = nr; c = nc; }
    }
    return out;
  }
  if (n % 4 === 0) {
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const v = i * n + j + 1;
      const bi = i % 4, bj = j % 4;
      const diag = (bi === bj) || (bi + bj === 3);
      set(i, j, diag ? (n * n + 1 - v) : v);
    }
    return out;
  }
  // Singly even (n = 2*(2m+1)): Strachey method
  const half = n >> 1, subN = half * half;
  const sub = magicSquare(half);
  const add = (ro: number, co: number, off: number) => {
    for (let j = 0; j < half; j++) for (let i = 0; i < half; i++) set(ro + i, co + j, sub[i + half * j] + off);
  };
  add(0, 0, 0); add(half, half, subN); add(0, half, 2 * subN); add(half, 0, 3 * subN);
  const k = (n - 2) >> 2;
  const swap = (r1: number, c1: number, r2: number, c2: number) => {
    const t = out[r1 + n * c1]; out[r1 + n * c1] = out[r2 + n * c2]; out[r2 + n * c2] = t;
  };
  for (let i = 0; i < half; i++) {
    for (let j = 0; j < k; j++) swap(i, j, i + half, j);
    for (let j = n - k + 1; j < n; j++) swap(i, j, i + half, j);
  }
  const mid = half >> 1;
  swap(mid, 0, mid + half, 0);
  swap(mid, k, mid + half, k);
  return out;
}

export function registerArray(def: Def) {
  // Construction
  def('eye', a => {
    let cls: Cls = 'double';
    const rest = a.slice();
    if (rest.length && isStr(rest[rest.length - 1])) cls = dimsFrom([rest.pop()!], 'eye').cls;
    let r = 1, c = 1;
    if (rest.length === 1) {
      const t = T_(rest[0], 'eye');
      if (t.data.length === 1) { r = c = Math.max(0, Math.floor(t.data[0])); }
      else { r = Math.max(0, Math.floor(t.data[0])); c = Math.max(0, Math.floor(t.data[1] ?? r)); }
    } else if (rest.length >= 2) {
      r = Math.max(0, Math.floor(scalarOf(rest[0])));
      c = Math.max(0, Math.floor(scalarOf(rest[1])));
    }
    const out = mk(cls, [r, c]);
    for (let i = 0; i < Math.min(r, c); i++) out.data[i + r * i] = 1;
    return [out];
  });

  def('magic', a => {
    const n = Math.floor(scalarOf(a[0]));
    if (n < 0) err('Error using magic: N must be a nonnegative integer.');
    return [mk('double', [n, n], magicSquare(n))];
  });

  def('diag', a => {
    const t = T_(a[0], 'diag'), k = a[1] ? Math.trunc(scalarOf(a[1])) : 0;
    if (t.dims.length > 2) err('Error using diag: First input must be 2-D.');
    const [m, n] = t.dims;
    if (m === 1 || n === 1) {
      const len = t.data.length, sz = len + Math.abs(k);
      const out = mk(t.cls, [sz, sz]);
      const r0 = k < 0 ? -k : 0, c0 = k > 0 ? k : 0;
      for (let i = 0; i < len; i++) out.data[(r0 + i) + sz * (c0 + i)] = t.data[i];
      return [out];
    }
    const r0 = k < 0 ? -k : 0, c0 = k > 0 ? k : 0;
    const len = Math.max(0, Math.min(m - r0, n - c0));
    const out = mk(t.cls, [len, len ? 1 : 0]);
    for (let i = 0; i < len; i++) out.data[i] = t.data[(r0 + i) + m * (c0 + i)];
    return [out];
  });

  const tri = (upper: boolean) => (a: any[]) => {
    const t = T_(a[0], upper ? 'triu' : 'tril'), k = a[1] ? Math.trunc(scalarOf(a[1])) : 0;
    if (t.dims.length > 2) err('Input must be 2-D.');
    const [m, n] = t.dims, out = mk(t.cls, [m, n]);
    for (let j = 0; j < n; j++) for (let i = 0; i < m; i++) {
      if (upper ? (j - i >= k) : (j - i <= k)) out.data[i + m * j] = t.data[i + m * j];
    }
    return [out];
  };
  def('tril', tri(false));
  def('triu', tri(true));

  def('meshgrid', (a, nargout) => {
    const x = T_(a[0], 'meshgrid'), y = a[1] ? T_(a[1], 'meshgrid') : x;
    if (a.length <= 2 && nargout <= 2) {
      const nx = x.data.length, ny = y.data.length;
      const X = mk('double', [ny, nx]), Y = mk('double', [ny, nx]);
      for (let j = 0; j < nx; j++) for (let i = 0; i < ny; i++) {
        X.data[i + ny * j] = x.data[j];
        Y.data[i + ny * j] = y.data[i];
      }
      return [X, Y];
    }
    const z = T_(a[2] ?? a[1] ?? a[0], 'meshgrid');
    const nx = x.data.length, ny = y.data.length, nz = z.data.length;
    const X = mk('double', [ny, nx, nz]), Y = mk('double', [ny, nx, nz]), Z = mk('double', [ny, nx, nz]);
    for (let k = 0; k < nz; k++) for (let j = 0; j < nx; j++) for (let i = 0; i < ny; i++) {
      const p = i + ny * (j + nx * k);
      X.data[p] = x.data[j]; Y.data[p] = y.data[i]; Z.data[p] = z.data[k];
    }
    return [X, Y, Z];
  });

  def('ndgrid', a => {
    const vecs = a.length === 1 ? [T_(a[0], 'ndgrid'), T_(a[0], 'ndgrid')] : a.map(x => T_(x, 'ndgrid'));
    const dims = vecs.map(v => v.data.length), n = numel(dims);
    const outs = vecs.map(() => mk('double', dims.slice()));
    const sub = new Array(dims.length).fill(0);
    for (let o = 0; o < n; o++) {
      for (let d = 0; d < dims.length; d++) outs[d].data[o] = vecs[d].data[sub[d]];
      for (let d = 0; d < dims.length; d++) { if (++sub[d] < dims[d]) break; sub[d] = 0; }
    }
    return outs;
  });

  def('rng', a => {
    if (!a.length || (isStr(a[0]) && toStr(a[0]).toLowerCase() === 'default')) { setSeed(123456789); return []; }
    if (isStr(a[0]) && toStr(a[0]).toLowerCase() === 'shuffle') { setSeed(Date.now()); return []; }
    setSeed(Math.floor(scalarOf(a[0])));
    return [];
  });
  def('rand', a => {
    if (a.length >= 2 && isStr(a[0]) && toStr(a[0]).toLowerCase() === 'seed') { setSeed(Math.floor(scalarOf(a[1]))); return []; }
    const { dims, cls } = dimsFrom(a, 'rand');
    const t = mk(cls, dims);
    for (let i = 0; i < t.data.length; i++) t.data[i] = rnd();
    return [t];
  });
  def('randn', a => {
    if (a.length >= 2 && isStr(a[0]) && toStr(a[0]).toLowerCase() === 'seed') { setSeed(Math.floor(scalarOf(a[1]))); return []; }
    const { dims, cls } = dimsFrom(a, 'randn');
    const t = mk(cls, dims);
    for (let i = 0; i < t.data.length; i++) t.data[i] = randnSample();
    return [t];
  });
  def('randi', a => {
    const m = T_(a[0], 'randi'), hi = m.data[m.data.length - 1], lo = m.data.length > 1 ? m.data[0] : 1;
    const { dims, cls } = dimsFrom(a.slice(1), 'randi');
    const t = mk(cls, dims);
    for (let i = 0; i < t.data.length; i++) t.data[i] = lo + Math.floor(rnd() * (hi - lo + 1));
    return [t];
  });

  def('linspace', a => {
    const lo = scalarOf(a[0]), hi = scalarOf(a[1]), n = a[2] ? Math.floor(scalarOf(a[2])) : 100;
    if (n <= 0) return [mk('double', [1, 0])];
    return [mk('double', [1, n], Array.from({ length: n }, (_, i) => (n === 1 ? hi : lo + ((hi - lo) * i) / (n - 1))))];
  });
  def('logspace', a => {
    const lo = scalarOf(a[0]), hi = scalarOf(a[1]), n = a[2] ? Math.floor(scalarOf(a[2])) : 50;
    if (n <= 0) return [mk('double', [1, 0])];
    return [mk('double', [1, n], Array.from({ length: n }, (_, i) => Math.pow(10, n === 1 ? hi : lo + ((hi - lo) * i) / (n - 1))))];
  });
  def('colon', a => {
    const start = scalarOf(a[0]), step = a.length >= 3 ? scalarOf(a[1]) : 1, stop = scalarOf(a.length >= 3 ? a[2] : a[1]);
    const n = step === 0 || (step > 0 && start > stop) || (step < 0 && start < stop) ? 0 : Math.floor((stop - start) / step + 1e-10) + 1;
    const r = mk('double', [1, n]);
    for (let i = 0; i < n; i++) r.data[i] = start + i * step;
    return [r];
  });

  const catFn = (dim: number, parts: V[]): V => {
    if (!parts.length) return mk('double', [0, 0]);
    if (parts.every(isC)) {
      const cs = parts as C[];
      const nd = Math.max(dim + 1, ...cs.map(p => p.dims.length));
      const dd = cs.map(p => p.dims.concat(new Array(nd - p.dims.length).fill(1)));
      for (const d of dd) for (let i = 0; i < nd; i++) if (i !== dim && d[i] !== dd[0][i]) err('Dimensions of arrays being concatenated are not consistent.');
      const rd = dd[0].slice(); rd[dim] = dd.reduce((s, d) => s + d[dim], 0);
      const outData = new Array<V>(numel(rd)), outer = numel(rd.slice(dim + 1)), inner = numel(rd.slice(0, dim));
      let off = 0;
      for (let pi = 0; pi < cs.length; pi++) {
        const len = dd[pi][dim], chunk = inner * len;
        for (let o = 0; o < outer; o++) for (let q = 0; q < chunk; q++) outData[o * inner * rd[dim] + off * inner + q] = cs[pi].data[o * chunk + q];
        off += len;
      }
      return { cls: 'cell', dims: rd, data: outData } as C;
    }
    if (parts.every(isS)) {
      const ss = parts as S[];
      const keys = ss[0].keys;
      const nd = Math.max(dim + 1, ...ss.map(p => p.dims.length));
      const dd = ss.map(p => p.dims.concat(new Array(nd - p.dims.length).fill(1)));
      for (const d of dd) for (let i = 0; i < nd; i++) if (i !== dim && d[i] !== dd[0][i]) err('Dimensions of arrays being concatenated are not consistent.');
      const rd = dd[0].slice(); rd[dim] = dd.reduce((s, d) => s + d[dim], 0);
      const outData = new Array<Record<string, V>>(numel(rd)), outer = numel(rd.slice(dim + 1)), inner = numel(rd.slice(0, dim));
      let off = 0;
      for (let pi = 0; pi < ss.length; pi++) {
        const len = dd[pi][dim], chunk = inner * len;
        for (let o = 0; o < outer; o++) for (let q = 0; q < chunk; q++) outData[o * inner * rd[dim] + off * inner + q] = ss[pi].data[o * chunk + q];
        off += len;
      }
      return mkStruct(keys, rd, outData);
    }
    return cat(dim, parts.map(p => T_(p, 'cat')));
  };
  def('cat', a => [catFn(Math.floor(scalarOf(a[0])) - 1, a.slice(1))]);
  def('horzcat', a => [catFn(1, a)]);
  def('vertcat', a => [catFn(0, a)]);

  def('kron', a => {
    const A = T_(a[0], 'kron'), B = T_(a[1], 'kron');
    if (A.dims.length > 2 || B.dims.length > 2) err('Error using kron: Inputs must be 2-D.');
    const [ma, na] = A.dims, [mb, nb] = B.dims;
    const M = ma * mb, N = na * nb;
    const cls: Cls = A.cls === 'uint8' || B.cls === 'uint8' ? 'uint8' : 'double';
    const out = mk(cls, [M, N]);
    for (let ja = 0; ja < na; ja++) for (let ia = 0; ia < ma; ia++) {
      const av = A.data[ia + ma * ja];
      for (let jb = 0; jb < nb; jb++) for (let ib = 0; ib < mb; ib++) {
        out.data[(ia * mb + ib) + M * (ja * nb + jb)] = sat(cls, av * B.data[ib + mb * jb]);
      }
    }
    return [out];
  });

  def('permute', a => {
    const t = T_(a[0], 'permute'), order = Array.from(T_(a[1], 'permute').data, x => Math.floor(x) - 1);
    const nd = Math.max(t.dims.length, order.length);
    const idims = t.dims.concat(new Array(nd - t.dims.length).fill(1));
    const odims = order.map(d => idims[d] ?? 1);
    const out = mk(t.cls, odims), n = numel(odims);
    const istrides = [1]; for (let d = 1; d < nd; d++) istrides.push(istrides[d - 1] * idims[d - 1]);
    const sub = new Array(order.length).fill(0);
    for (let o = 0; o < n; o++) {
      let p = 0;
      for (let d = 0; d < order.length; d++) p += sub[d] * istrides[order[d]];
      out.data[o] = t.data[p];
      for (let d = 0; d < order.length; d++) { if (++sub[d] < odims[d]) break; sub[d] = 0; }
    }
    return [out];
  });

  def('squeeze', a => {
    const t = T_(a[0], 'squeeze');
    const kept = t.dims.filter(d => d !== 1);
    while (kept.length < 2) kept.push(1);
    return [mk(t.cls, kept, t.data)];
  });

  def('circshift', a => {
    const t = T_(a[0], 'circshift'), K = T_(a[1], 'circshift');
    let shifts: number[];
    if (a[2] !== undefined) {
      const dim = Math.floor(scalarOf(a[2])) - 1;
      shifts = new Array(Math.max(t.dims.length, dim + 1)).fill(0);
      shifts[dim] = Math.trunc(K.data[0]);
    } else if (K.data.length === 1) {
      const d = t.dims.findIndex(x => x > 1);
      shifts = new Array(t.dims.length).fill(0);
      shifts[d < 0 ? 0 : d] = Math.trunc(K.data[0]);
    } else {
      shifts = Array.from(K.data, Math.trunc);
    }
    const nd = Math.max(t.dims.length, shifts.length);
    const dims = t.dims.concat(new Array(nd - t.dims.length).fill(1));
    const sh = dims.map((d, i) => (((shifts[i] ?? 0) % d) + d) % d);
    const strides = [1]; for (let d = 1; d < nd; d++) strides.push(strides[d - 1] * dims[d - 1]);
    const n = numel(dims), out = mk(t.cls, t.dims.slice()), sub = new Array(nd).fill(0);
    for (let o = 0; o < n; o++) {
      let dst = 0;
      for (let d = 0; d < nd; d++) dst += ((sub[d] + sh[d]) % dims[d]) * strides[d];
      out.data[dst] = t.data[o];
      for (let d = 0; d < nd; d++) { if (++sub[d] < dims[d]) break; sub[d] = 0; }
    }
    return [out];
  });

  const flipAlong = (t: T, dim: number): T => {
    const d = t.dims.concat(new Array(Math.max(0, dim + 1 - t.dims.length)).fill(1)), len = d[dim];
    const inner = numel(d.slice(0, dim)), outer = numel(d.slice(dim + 1)), o = mk(t.cls, t.dims.slice());
    for (let outI = 0; outI < outer; outI++) for (let k = 0; k < len; k++) for (let inI = 0; inI < inner; inI++) {
      o.data[inI + inner * (k + len * outI)] = t.data[inI + inner * ((len - 1 - k) + len * outI)];
    }
    return o;
  };
  def('flip', a => {
    const t = T_(a[0], 'flip');
    const dim = a[1] ? Math.floor(scalarOf(a[1])) - 1 : (t.dims.findIndex(d => d !== 1) >= 0 ? t.dims.findIndex(d => d !== 1) : 0);
    return [flipAlong(t, dim)];
  });
  def('flipud', a => [flipAlong(T_(a[0], 'flipud'), 0)]);
  def('fliplr', a => [flipAlong(T_(a[0], 'fliplr'), 1)]);

  def('rot90', a => {
    const t = T_(a[0], 'rot90'), k = (((a[1] ? Math.trunc(scalarOf(a[1])) : 1) % 4) + 4) % 4;
    if (t.dims.length > 2) err('Error using rot90: A must be 2-D.');
    const [H, W] = t.dims;
    if (k === 0) return [mk(t.cls, [H, W], t.data)];
    const nh = k % 2 ? W : H, nw = k % 2 ? H : W, o = mk(t.cls, [nh, nw]);
    for (let i = 0; i < H; i++) for (let j = 0; j < W; j++) {
      const [ni, nj] = k === 1 ? [W - 1 - j, i] : k === 2 ? [H - 1 - i, W - 1 - j] : [j, H - 1 - i];
      o.data[ni + nh * nj] = t.data[i + H * j];
    }
    return [o];
  });

  def('sub2ind', a => {
    const sz = Array.from(T_(a[0], 'sub2ind').data, x => Math.floor(x));
    const subs = a.slice(1).map(x => T_(x, 'sub2ind'));
    if (!subs.length) err('Error using sub2ind: Not enough input arguments.');
    const n = Math.max(...subs.map(s => s.data.length));
    const out = mk('double', subs[0].dims.slice());
    const strides = [1]; for (let d = 1; d < sz.length; d++) strides.push(strides[d - 1] * sz[d - 1]);
    for (let i = 0; i < n; i++) {
      let ind = 1;
      for (let d = 0; d < subs.length; d++) {
        const v = subs[d].data[subs[d].data.length === 1 ? 0 : i];
        const dim = d < sz.length ? sz[d] : 1;
        if (v < 1 || v > dim || v !== Math.floor(v)) err('Error using sub2ind: Out of range subscript.');
        ind += (v - 1) * (strides[d] ?? numel(sz));
      }
      out.data[i] = ind;
    }
    return [out];
  });

  def('ind2sub', (a, nargout) => {
    const sz = Array.from(T_(a[0], 'ind2sub').data, x => Math.floor(x));
    const ind = T_(a[1], 'ind2sub'), want = Math.max(nargout, 1);
    const outs = Array.from({ length: want }, () => mk('double', ind.dims.slice()));
    const strides = [1]; for (let d = 1; d < sz.length; d++) strides.push(strides[d - 1] * sz[d - 1]);
    for (let i = 0; i < ind.data.length; i++) {
      let rem = ind.data[i] - 1;
      for (let d = 0; d < want; d++) {
        if (d < want - 1 && d < sz.length) {
          outs[d].data[i] = (rem % sz[d]) + 1;
          rem = Math.floor(rem / sz[d]);
        } else {
          outs[d].data[i] = rem + 1;
          rem = 0;
        }
      }
    }
    return outs;
  });

  def('find', (a, nargout) => {
    const t = T_(a[0], 'find');
    const lim = a[1] ? Math.floor(scalarOf(a[1])) : Infinity;
    const last = a[2] && isStr(a[2]) && toStr(a[2]).toLowerCase() === 'last';
    const idx: number[] = [];
    if (!last) {
      for (let i = 0; i < t.data.length && idx.length < lim; i++) if (t.data[i] !== 0) idx.push(i + 1);
    } else {
      for (let i = t.data.length - 1; i >= 0 && idx.length < lim; i--) if (t.data[i] !== 0) idx.push(i + 1);
      idx.reverse();
    }
    const isRow = t.dims.length === 2 && t.dims[0] === 1 && t.dims[1] !== 1;
    const dims = isRow ? [1, idx.length] : [idx.length, idx.length ? 1 : 0];
    if (nargout <= 1) return [mk('double', dims, idx)];
    const r = t.dims[0] || 1;
    const rows = mk('double', dims), cols = mk('double', dims), vals = mk(t.cls, dims);
    for (let k = 0; k < idx.length; k++) {
      const p = idx[k] - 1;
      rows.data[k] = (p % r) + 1;
      cols.data[k] = Math.floor(p / r) + 1;
      vals.data[k] = t.data[p];
    }
    return nargout >= 3 ? [rows, cols, vals] : [rows, cols];
  });

  def('sort', a => {
    const t = T_(a[0], 'sort');
    let dim = t.dims.length === 2 && t.dims[0] === 1 ? 1 : 0;
    let desc = false;
    for (const arg of a.slice(1)) {
      if (isStr(arg)) {
        const s = toStr(arg).toLowerCase();
        if (s.startsWith('desc')) desc = true;
        else if (s.startsWith('asc')) desc = false;
      } else {
        dim = Math.floor(scalarOf(arg)) - 1;
      }
    }
    const d = t.dims.concat(new Array(Math.max(0, dim + 1 - t.dims.length)).fill(1)), len = d[dim];
    const inner = numel(d.slice(0, dim)), outer = numel(d.slice(dim + 1));
    const out = mk(t.cls, t.dims.slice()), idx = mk('double', t.dims.slice());
    for (let o = 0; o < outer; o++) for (let i = 0; i < inner; i++) {
      const ord = Array.from({ length: len }, (_, k) => k);
      ord.sort((p, q) => {
        const vp = t.data[i + inner * (p + len * o)], vq = t.data[i + inner * (q + len * o)];
        return (desc ? vq - vp : vp - vq) || p - q;
      });
      for (let k = 0; k < len; k++) {
        const dst = i + inner * (k + len * o);
        out.data[dst] = t.data[i + inner * (ord[k] + len * o)];
        idx.data[dst] = ord[k] + 1;
      }
    }
    return [out, idx];
  });

  // Sets and counting
  def('unique', (a, nargout) => {
    const t = T_(a[0], 'unique');
    const stable = a.slice(1).some(x => isStr(x) && toStr(x).toLowerCase() === 'stable');
    const seen = new Map<number, number>();
    const vals: number[] = [], ia: number[] = [], firstIdx: number[] = [];
    for (let i = 0; i < t.data.length; i++) {
      const v = t.data[i];
      if (!seen.has(v)) { seen.set(v, vals.length); vals.push(v); ia.push(i + 1); firstIdx.push(i); }
    }
    let order = vals.map((_, i) => i);
    if (!stable) order.sort((p, q) => vals[p] - vals[q]);
    const sortedVals = order.map(i => vals[i]), sortedIa = order.map(i => ia[i]);
    const inv = new Array(order.length);
    order.forEach((origIdx, newIdx) => { inv[origIdx] = newIdx + 1; });
    const ic = Array.from(t.data, v => inv[seen.get(v)!]);
    const isRow = t.dims.length === 2 && t.dims[0] === 1 && t.dims[1] !== 1;
    const outDims = isRow ? [1, sortedVals.length] : [sortedVals.length, sortedVals.length ? 1 : 0];
    const out = mk(t.cls, outDims, sortedVals);
    if (nargout <= 1) return [out];
    return [out, mk('double', [sortedIa.length, sortedIa.length ? 1 : 0], sortedIa), mk('double', [ic.length, ic.length ? 1 : 0], ic)];
  });

  def('histc', a => {
    const x = T_(a[0], 'histc'), edges = T_(a[1], 'histc');
    const m = edges.data.length;
    const counts = new Float64Array(m), bin = mk('double', x.dims.slice());
    for (let i = 0; i < x.data.length; i++) {
      const v = x.data[i];
      let b = 0;
      if (m > 0) {
        if (v === edges.data[m - 1]) b = m;
        else {
          for (let j = 0; j < m - 1; j++) {
            if (v >= edges.data[j] && v < edges.data[j + 1]) { b = j + 1; break; }
          }
        }
      }
      if (b > 0) counts[b - 1]++;
      bin.data[i] = b;
    }
    const isRow = x.dims.length === 2 && x.dims[0] === 1 && x.dims[1] !== 1;
    return [mk('double', isRow ? [1, m] : [m, 1], counts), bin];
  });

  def('hist', a => {
    const data = T_(a[0], 'hist');
    const kOrCenters = a[1] ? T_(a[1], 'hist') : num(10);
    let lo = Infinity, hi = -Infinity;
    for (const v of data.data) { if (v < lo) lo = v; if (v > hi) hi = v; }
    if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
    let centers: number[];
    if (kOrCenters.data.length > 1) centers = Array.from(kOrCenters.data);
    else {
      const k = Math.max(1, Math.floor(kOrCenters.data[0]));
      if (lo === hi) centers = Array.from({ length: k }, (_, i) => lo - Math.floor(k / 2) + i);
      else { const step = (hi - lo) / k; centers = Array.from({ length: k }, (_, i) => lo + (i + 0.5) * step); }
    }
    const counts = new Float64Array(centers.length);
    for (const v of data.data) {
      let best = 0, bd = Infinity;
      for (let i = 0; i < centers.length; i++) {
        const d = Math.abs(v - centers[i]);
        if (d < bd) { bd = d; best = i; }
      }
      counts[best]++;
    }
    return [mk('double', [1, counts.length], counts), mk('double', [1, centers.length], centers)];
  });

  def('accumarray', (a, _n, I) => {
    const subs = T_(a[0], 'accumarray'), val = T_(a[1], 'accumarray');
    const [n, d] = subs.dims.length === 2 ? subs.dims : [subs.data.length, 1];
    const sz = a[2] && T_(a[2], 'accumarray').data.length > 0
      ? Array.from(T_(a[2], 'accumarray').data, Math.floor)
      : Array.from({ length: Math.max(2, d) }, (_, col) => {
          if (col >= d) return 1;
          let mx = 0; for (let i = 0; i < n; i++) mx = Math.max(mx, subs.data[i + n * col]); return mx;
        });
    const fn = a[3];
    const total = numel(sz), strides = [1];
    for (let k = 1; k < sz.length; k++) strides.push(strides[k - 1] * sz[k - 1]);
    if (!fn) {
      const out = mk('double', sz);
      for (let i = 0; i < n; i++) {
        let p = 0;
        for (let col = 0; col < d; col++) p += (subs.data[i + n * col] - 1) * strides[col];
        out.data[p] += val.data[val.data.length === 1 ? 0 : i];
      }
      return [out];
    }
    const buckets: number[][] = Array.from({ length: total }, () => []);
    for (let i = 0; i < n; i++) {
      let p = 0;
      for (let col = 0; col < d; col++) p += (subs.data[i + n * col] - 1) * strides[col];
      buckets[p].push(val.data[val.data.length === 1 ? 0 : i]);
    }
    const fillVal = a[4] ? scalarOf(a[4]) : 0;
    const out = mk('double', sz);
    for (let p = 0; p < total; p++) {
      if (!buckets[p].length) { out.data[p] = fillVal; continue; }
      const vec = mk('double', [buckets[p].length, 1], buckets[p]);
      const res = I.callHandle ? (typeof fn === 'string' ? I.callFn(fn, [vec], 1) : fn.cls === 'function_handle' ? I.callHandle(fn, [vec], 1) : I.callFn(toStr(fn), [vec], 1)) : [num(0)];
      out.data[p] = scalarOf(res[0]);
    }
    return [out];
  });

  const eqCheck = (nanEq: boolean) => (a: any[]) => {
    if (a.length < 2) err('Error using isequal: Not enough input arguments.');
    const same = (x: V, y: V): boolean => {
      if (isT(x) && isT(y)) {
        if (x.dims.join(',') !== y.dims.join(',') || x.data.length !== y.data.length) return false;
        for (let i = 0; i < x.data.length; i++) {
          if (nanEq && Number.isNaN(x.data[i]) && Number.isNaN(y.data[i])) continue;
          if (x.data[i] !== y.data[i]) return false;
        }
        return true;
      }
      if (isC(x) && isC(y)) return x.dims.join(',') === y.dims.join(',') && x.data.every((v, i) => same(v, y.data[i]));
      if (isS(x) && isS(y)) return x.dims.join(',') === y.dims.join(',') && x.keys.length === y.keys.length && x.keys.every(k => y.keys.includes(k)) && x.data.every((r, idx) => x.keys.every(k => same(r[k], y.data[idx][k])));
      return false;
    };
    for (let i = 1; i < a.length; i++) if (!same(a[0], a[i])) return [num(0, 'logical')];
    return [num(1, 'logical')];
  };
  def('isequal', eqCheck(false));
  def('isequaln', eqCheck(true));

  def('ismember', (a, nargout) => {
    const A = T_(a[0], 'ismember'), B = T_(a[1], 'ismember');
    const first = new Map<number, number>();
    for (let i = 0; i < B.data.length; i++) if (!first.has(B.data[i])) first.set(B.data[i], i + 1);
    const lia = mk('logical', A.dims.slice()), locb = mk('double', A.dims.slice());
    for (let i = 0; i < A.data.length; i++) {
      const idx = first.get(A.data[i]) ?? 0;
      lia.data[i] = idx > 0 ? 1 : 0;
      locb.data[i] = idx;
    }
    return nargout > 1 ? [lia, locb] : [lia];
  });

  // Predicates
  def('islogical', a => [num(+(isT(a[0]) && a[0].cls === 'logical'), 'logical')]);
  def('isreal', a => [num(+(isT(a[0]) && !(a[0] as any).im), 'logical')]);
  def('isfloat', a => [num(+(isT(a[0]) && (a[0].cls === 'double' || (a[0].cls as string) === 'single')), 'logical')]);
  def('isinteger', a => [num(+(isT(a[0]) && ['uint8', 'int8', 'uint16', 'int16', 'uint32', 'int32'].includes(a[0].cls)), 'logical')]);
  def('isnumeric', a => [num(+(isT(a[0]) && a[0].cls !== 'logical' && a[0].cls !== 'char'), 'logical')]);
  def('ischar', a => [num(+(isT(a[0]) && a[0].cls === 'char'), 'logical')]);
  def('isrow', a => { const t = a[0], d = isT(t) || isC(t) || isS(t) ? t.dims : [1, 1]; return [num(+(d.length === 2 && d[0] === 1 && d[1] >= 0), 'logical')]; });
  def('iscolumn', a => { const t = a[0], d = isT(t) || isC(t) || isS(t) ? t.dims : [1, 1]; return [num(+(d.length === 2 && d[1] === 1 && d[0] >= 0), 'logical')]; });
  def('isvector', a => { const t = a[0], d = isT(t) || isC(t) || isS(t) ? t.dims : [1, 1]; return [num(+(d.length === 2 && (d[0] === 1 || d[1] === 1)), 'logical')]; });
  def('isscalar', a => { const t = a[0]; return [num(+(isT(t) || isC(t) || isS(t) ? t.data.length === 1 : true), 'logical')]; });
  def('ismatrix', a => { const t = a[0], d = isT(t) || isC(t) || isS(t) ? t.dims : [1, 1]; return [num(+(d.length === 2), 'logical')]; });

  void dimStr;
}
