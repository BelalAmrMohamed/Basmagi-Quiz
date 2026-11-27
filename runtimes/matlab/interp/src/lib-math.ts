import { T, Cls, isStr, toStr, scalarOf, numel, sat, ew, matmul, transpose, solveLinear, mk, num, outCls, numCls, fltCls, INT_RANGE } from './values';
import { Def, err, T_, firstNonSingleton, reduce, reduceWithIdx, redDim, singularValues } from './lib-common';

const INT_LIMITS: Record<string, [number, number]> = {
  int8: [-128, 127], uint8: [0, 255],
  int16: [-32768, 32767], uint16: [0, 65535],
  int32: [-2147483648, 2147483647], uint32: [0, 4294967295],
};

function bitMaskFor(cls: Cls, a?: any): number {
  if (a && isStr(a)) {
    const n = toStr(a).toLowerCase();
    if (n === 'uint8' || n === 'int8') return 8;
    if (n === 'uint16' || n === 'int16') return 16;
    if (n === 'uint32' || n === 'int32') return 32;
  }
  if (cls === 'uint8' || cls === 'int8') return 8;
  if (cls === 'uint16' || cls === 'int16') return 16;
  if (cls === 'uint32' || cls === 'int32') return 32;
  return 53;
}

export function registerMath(def: Def) {
  const dbl = (f: (x: number) => number) => (a: any[]) => {
    const t = T_(a[0], 'math');
    return [{ cls: 'double' as Cls, dims: t.dims.slice(), data: t.data.map(f) }];
  };
  const map1 = (f: (x: number) => number) => (a: any[]) => {
    const t = T_(a[0], 'math');
    const cls: Cls = numCls(t.cls);
    return [{ cls, dims: t.dims.slice(), data: t.data.map(v => sat(cls, f(v))) }];
  };
  const pred = (f: (x: number) => boolean) => (a: any[]) => {
    const t = T_(a[0], 'predicate');
    const out = mk('logical', t.dims.slice());
    for (let i = 0; i < t.data.length; i++) out.data[i] = f(t.data[i]) ? 1 : 0;
    return [out];
  };

  // Elementwise
  def('abs', map1(Math.abs));
  def('floor', map1(Math.floor));
  def('ceil', map1(Math.ceil));
  def('round', map1(x => Math.sign(x) * Math.round(Math.abs(x))));
  def('fix', map1(Math.trunc));
  def('sqrt', map1(Math.sqrt));
  def('sign', dbl(Math.sign));
  def('exp', dbl(Math.exp));
  def('log', dbl(Math.log));
  def('log2', dbl(Math.log2));
  def('log10', dbl(Math.log10));
  def('sin', dbl(Math.sin));
  def('cos', dbl(Math.cos));
  def('tan', dbl(Math.tan));
  def('atan', dbl(Math.atan));
  def('sinh', dbl(Math.sinh));
  def('cosh', dbl(Math.cosh));
  def('tanh', dbl(Math.tanh));

  def('atan2', a => [ew(T_(a[0], 'atan2'), T_(a[1], 'atan2'), Math.atan2, 'double')]);
  def('power', a => {
    const x = T_(a[0], 'power'), y = T_(a[1], 'power');
    return [ew(x, y, Math.pow, outCls(x, y))];
  });
  def('hypot', a => [ew(T_(a[0], 'hypot'), T_(a[1], 'hypot'), Math.hypot, 'double')]);
  def('mod', a => {
    const x = T_(a[0], 'mod'), y = T_(a[1], 'mod');
    return [ew(x, y, (p, q) => (q === 0 ? p : p - Math.floor(p / q) * q), outCls(x, y))];
  });
  def('rem', a => {
    const x = T_(a[0], 'rem'), y = T_(a[1], 'rem');
    return [ew(x, y, (p, q) => (q === 0 ? NaN : p % q), outCls(x, y))];
  });
  def('idivide', a => {
    const x = T_(a[0], 'idivide'), y = T_(a[1], 'idivide');
    const opt = a[2] && isStr(a[2]) ? toStr(a[2]).toLowerCase() : 'fix';
    const op = opt === 'round' ? (q: number) => Math.sign(q) * Math.round(Math.abs(q))
      : opt === 'floor' ? Math.floor
      : opt === 'ceil' ? Math.ceil
      : Math.trunc;
    const cls = outCls(x, y);
    return [ew(x, y, (p, q) => op(p / q), cls)];
  });

  def('isnan', pred(Number.isNaN));
  def('isinf', pred(x => !Number.isNaN(x) && !Number.isFinite(x)));
  def('isfinite', pred(Number.isFinite));
  def('xor', a => [ew(T_(a[0], 'xor'), T_(a[1], 'xor'), (p, q) => +((p !== 0) !== (q !== 0)), 'logical')]);

  // Bitwise
  const bitOp = (fn: string, op: (x: number, y: number) => number) => (a: any[]) => {
    const x = T_(a[0], fn), y = T_(a[1], fn);
    const cls = outCls(x, y);
    return [ew(x, y, (p, q) => (op(Math.trunc(p), Math.trunc(q)) >>> 0), cls)];
  };
  def('bitand', bitOp('bitand', (p, q) => p & q));
  def('bitor', bitOp('bitor', (p, q) => p | q));
  def('bitxor', bitOp('bitxor', (p, q) => p ^ q));
  def('bitshift', a => {
    const x = T_(a[0], 'bitshift'), k = T_(a[1], 'bitshift');
    const bits = bitMaskFor(x.cls, a[2]);
    const mask = bits >= 32 ? 0xffffffff : (1 << bits) - 1;
    const cls = numCls(x.cls);
    return [ew(x, k, (v, s) => {
      const iv = Math.trunc(v) >>> 0, sh = Math.trunc(s);
      if (sh >= 0) return sh >= bits ? 0 : ((iv << sh) & mask) >>> 0;
      return (-sh) >= bits ? 0 : (iv >>> (-sh)) & mask;
    }, cls)];
  });
  def('bitcmp', a => {
    const x = T_(a[0], 'bitcmp');
    const bits = bitMaskFor(x.cls, a[1]);
    const cls = numCls(x.cls);
    const out = mk(cls, x.dims.slice());
    if (bits <= 32) {
      const mask = bits === 32 ? 0xffffffff : (1 << bits) - 1;
      for (let i = 0; i < x.data.length; i++) out.data[i] = sat(cls, ((~Math.trunc(x.data[i])) & mask) >>> 0);
    } else {
      const max53 = 9007199254740991;
      for (let i = 0; i < x.data.length; i++) out.data[i] = max53 - Math.trunc(x.data[i]);
    }
    return [out];
  });

  // Reductions (dim + 'all')
  const redAll = (t: T, f: (arr: number[]) => number, cls: Cls) => num(f(Array.from(t.data)), cls);
  def('sum', a => {
    const t = T_(a[0], 'sum'), dim = redDim(t, a);
    const fn = (v: number[]) => v.reduce((p, q) => p + q, 0);
    return [dim === 'all' ? redAll(t, fn, fltCls(t)) : reduce(t, dim, fn, fltCls(t))];
  });
  def('prod', a => {
    const t = T_(a[0], 'prod'), dim = redDim(t, a);
    const fn = (v: number[]) => v.reduce((p, q) => p * q, 1);
    return [dim === 'all' ? redAll(t, fn, fltCls(t)) : reduce(t, dim, fn, fltCls(t))];
  });
  def('mean', a => {
    const t = T_(a[0], 'mean'), dim = redDim(t, a);
    const fn = (v: number[]) => (v.length ? v.reduce((p, q) => p + q, 0) / v.length : NaN);
    return [dim === 'all' ? redAll(t, fn, fltCls(t)) : reduce(t, dim, fn, fltCls(t))];
  });
  def('any', a => {
    const t = T_(a[0], 'any'), dim = redDim(t, a);
    const fn = (v: number[]) => +v.some(x => x !== 0);
    return [dim === 'all' ? redAll(t, fn, 'logical') : reduce(t, dim, fn, 'logical')];
  });
  def('all', a => {
    const t = T_(a[0], 'all'), dim = redDim(t, a);
    const fn = (v: number[]) => +v.every(x => x !== 0);
    return [dim === 'all' ? redAll(t, fn, 'logical') : reduce(t, dim, fn, 'logical')];
  });

  const minmax = (isMax: boolean) => (a: any[], nargout: number) => {
    const fnName = isMax ? 'max' : 'min';
    const t = T_(a[0], fnName);
    const pick = (x: number, y: number) => (isMax ? Math.max(x, y) : Math.min(x, y));
    if (a.length >= 2 && T_(a[1], fnName).data.length > 0 && !isStr(a[1])) {
      const u = T_(a[1], fnName);
      return [ew(t, u, pick, outCls(t, u))];
    }
    const dim = a.length >= 3 ? redDim(t, a, 2) : (a.length === 2 && isStr(a[1]) ? redDim(t, a, 1) : firstNonSingleton(t));
    const cls: Cls = t.cls === 'logical' || t.cls === 'char' ? 'double' : t.cls;
    const findBest = (v: number[]): [number, number] => {
      if (!v.length) return [NaN, NaN];
      let best = v[0], bi = 1;
      for (let i = 1; i < v.length; i++) {
        if (isMax ? v[i] > best : v[i] < best) { best = v[i]; bi = i + 1; }
      }
      return [best, bi];
    };
    if (dim === 'all') {
      const [val, bi] = findBest(Array.from(t.data));
      return nargout > 1 ? [num(val, cls), num(bi)] : [num(val, cls)];
    }
    const [r, idx] = reduceWithIdx(t, dim, findBest, cls);
    return nargout > 1 ? [r, idx] : [r];
  };
  def('max', minmax(true));
  def('min', minmax(false));

  def('median', a => {
    const t = T_(a[0], 'median'), dim = redDim(t, a);
    const med = (v: number[]) => {
      if (!v.length || v.some(Number.isNaN)) return NaN;
      const s = v.slice().sort((x, y) => x - y), m = s.length >> 1;
      return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    };
    return [dim === 'all' ? redAll(t, med, 'double') : reduce(t, dim, med, 'double')];
  });

  def('mode', (a, nargout) => {
    const t = T_(a[0], 'mode'), dim = redDim(t, a);
    const cls: Cls = numCls(t.cls);
    const modeFn = (v: number[]): [number, number] => {
      if (!v.length) return [NaN, 0];
      const counts = new Map<number, number>();
      let bestVal = Infinity, bestCount = 0;
      for (const x of v) {
        if (Number.isNaN(x)) continue;
        const c = (counts.get(x) ?? 0) + 1;
        counts.set(x, c);
        if (c > bestCount || (c === bestCount && x < bestVal)) { bestCount = c; bestVal = x; }
      }
      return bestCount === 0 ? [NaN, 0] : [bestVal, bestCount];
    };
    if (dim === 'all') {
      const [m, f] = modeFn(Array.from(t.data));
      return nargout > 1 ? [num(m, cls), num(f)] : [num(m, cls)];
    }
    const [r, f] = reduceWithIdx(t, dim, modeFn, cls);
    return nargout > 1 ? [r, f] : [r];
  });

  const stdVar = (isStd: boolean) => (a: any[]) => {
    const t = T_(a[0], isStd ? 'std' : 'var');
    const w = a[1] !== undefined && T_(a[1], 'std').data.length > 0 ? scalarOf(a[1], 'weight') : 0;
    const dim = a[2] !== undefined ? redDim(t, a, 2) : (a[1] !== undefined && isStr(a[1]) ? redDim(t, a, 1) : firstNonSingleton(t));
    const fn = (v: number[]) => {
      if (!v.length) return NaN;
      const mean = v.reduce((p, q) => p + q, 0) / v.length;
      const ss = v.reduce((p, q) => p + (q - mean) * (q - mean), 0);
      const denom = w === 1 ? v.length : Math.max(1, v.length - 1);
      const vr = v.length === 1 && w === 0 ? 0 : ss / denom;
      return isStd ? Math.sqrt(vr) : vr;
    };
    return [dim === 'all' ? redAll(t, fn, 'double') : reduce(t, dim, fn, 'double')];
  };
  def('std', stdVar(true));
  def('var', stdVar(false));

  def('range', a => {
    const t = T_(a[0], 'range'), dim = redDim(t, a);
    const fn = (v: number[]) => (v.length ? Math.max(...v) - Math.min(...v) : NaN);
    const cls: Cls = numCls(t.cls);
    return [dim === 'all' ? redAll(t, fn, cls) : reduce(t, dim, fn, cls)];
  });

  const cumOp = (fnName: string, init: (x: number) => number, step: (acc: number, x: number) => number, outCls?: Cls) => (a: any[]) => {
    const t = T_(a[0], fnName);
    const dim = a[1] ? Math.floor(scalarOf(a[1])) - 1 : firstNonSingleton(t);
    const d = t.dims.concat(new Array(Math.max(0, dim + 1 - t.dims.length)).fill(1)), len = d[dim];
    const inner = numel(d.slice(0, dim)), outer = numel(d.slice(dim + 1));
    const cls: Cls = outCls ?? (numCls(t.cls));
    const r = mk(cls, t.dims.slice());
    for (let o = 0; o < outer; o++) {
      for (let i = 0; i < inner; i++) {
        if (len === 0) continue;
        let acc = init(t.data[i + inner * (len * o)]);
        r.data[i + inner * (len * o)] = sat(cls, acc);
        for (let k = 1; k < len; k++) {
          const p = i + inner * (k + len * o);
          acc = step(acc, t.data[p]);
          r.data[p] = sat(cls, acc);
        }
      }
    }
    return [r];
  };
  def('cumsum', cumOp('cumsum', x => x, (acc, x) => acc + x, 'double'));
  def('cumprod', cumOp('cumprod', x => x, (acc, x) => acc * x, 'double'));
  def('cummax', cumOp('cummax', x => x, (acc, x) => Math.max(acc, x)));
  def('cummin', cumOp('cummin', x => x, (acc, x) => Math.min(acc, x)));

  def('diff', a => {
    let t = T_(a[0], 'diff');
    const n = a[1] !== undefined && T_(a[1], 'diff').data.length > 0 ? Math.floor(scalarOf(a[1])) : 1;
    let dim = a[2] !== undefined ? Math.floor(scalarOf(a[2])) - 1 : firstNonSingleton(t);
    for (let step = 0; step < n; step++) {
      const d = t.dims.concat(new Array(Math.max(0, dim + 1 - t.dims.length)).fill(1));
      const len = d[dim];
      if (len <= 1) { const rd = d.slice(); rd[dim] = 0; return [mk(numCls(t.cls), rd)]; }
      const inner = numel(d.slice(0, dim)), outer = numel(d.slice(dim + 1));
      const rd = d.slice(); rd[dim] = len - 1;
      const cls: Cls = numCls(t.cls);
      const r = mk(cls, rd);
      for (let o = 0; o < outer; o++) {
        for (let i = 0; i < inner; i++) {
          for (let k = 0; k < len - 1; k++) {
            const p0 = i + inner * (k + len * o);
            const p1 = i + inner * (k + 1 + len * o);
            r.data[i + inner * (k + (len - 1) * o)] = sat(cls, t.data[p1] - t.data[p0]);
          }
        }
      }
      t = r;
    }
    return [t];
  });

  def('norm', a => {
    const t = T_(a[0], 'norm');
    if (t.dims.length > 2) err('Error using norm: Input must be 2-D.');
    const [m, n] = t.dims;
    const pArg = a[1];
    const isVec = m === 1 || n === 1;
    if (isVec) {
      if (pArg && isStr(pArg) && toStr(pArg).toLowerCase() === 'fro') {
        let s = 0; for (const v of t.data) s += v * v; return [num(Math.sqrt(s))];
      }
      const p = pArg ? scalarOf(pArg) : 2;
      if (p === Infinity) return [num(t.data.length ? Math.max(...Array.from(t.data, Math.abs)) : 0)];
      if (p === -Infinity) return [num(t.data.length ? Math.min(...Array.from(t.data, Math.abs)) : 0)];
      if (p === 1) { let s = 0; for (const v of t.data) s += Math.abs(v); return [num(s)]; }
      if (p === 2) { let s = 0; for (const v of t.data) s += v * v; return [num(Math.sqrt(s))]; }
      let s = 0; for (const v of t.data) s += Math.pow(Math.abs(v), p);
      return [num(Math.pow(s, 1 / p))];
    }
    if (pArg && isStr(pArg) && toStr(pArg).toLowerCase() === 'fro') {
      let s = 0; for (const v of t.data) s += v * v; return [num(Math.sqrt(s))];
    }
    const p = pArg ? scalarOf(pArg) : 2;
    if (p === 1) {
      let best = 0;
      for (let j = 0; j < n; j++) { let s = 0; for (let i = 0; i < m; i++) s += Math.abs(t.data[i + m * j]); if (s > best) best = s; }
      return [num(best)];
    }
    if (p === Infinity) {
      let best = 0;
      for (let i = 0; i < m; i++) { let s = 0; for (let j = 0; j < n; j++) s += Math.abs(t.data[i + m * j]); if (s > best) best = s; }
      return [num(best)];
    }
    if (p === 2) {
      const sv = singularValues(t);
      return [num(sv[0] ?? 0)];
    }
    return err('Error using norm: The only matrix norms available are 1, 2, Inf, and "fro".');
  });

  def('dot', a => {
    const x = T_(a[0], 'dot'), y = T_(a[1], 'dot');
    if (x.dims.join(',') !== y.dims.join(',')) err('Error using dot: A and B must be same size.');
    if (a[2] === undefined && (x.dims[0] === 1 || x.dims[1] === 1) && x.dims.length === 2) {
      let s = 0; for (let i = 0; i < x.data.length; i++) s += x.data[i] * y.data[i];
      return [num(s)];
    }
    const dim = a[2] ? Math.floor(scalarOf(a[2])) - 1 : firstNonSingleton(x);
    const prod = ew(x, y, (p, q) => p * q, 'double');
    return [reduce(prod, dim, v => v.reduce((p, q) => p + q, 0), 'double')];
  });

  def('cross', a => {
    const x = T_(a[0], 'cross'), y = T_(a[1], 'cross');
    if (x.dims.join(',') !== y.dims.join(',')) err('Error using cross: A and B must be same size.');
    const dim = a[2] ? Math.floor(scalarOf(a[2])) - 1 : x.dims.findIndex(d => d === 3);
    if (dim < 0 || (x.dims[dim] ?? 1) !== 3) err('Error using cross: A and B must have at least one dimension of length 3.');
    const inner = numel(x.dims.slice(0, dim)), outer = numel(x.dims.slice(dim + 1));
    const r = mk('double', x.dims.slice());
    for (let o = 0; o < outer; o++) {
      for (let i = 0; i < inner; i++) {
        const p0 = i + inner * (0 + 3 * o), p1 = i + inner * (1 + 3 * o), p2 = i + inner * (2 + 3 * o);
        const ax = x.data[p0], ay = x.data[p1], az = x.data[p2];
        const bx = y.data[p0], by = y.data[p1], bz = y.data[p2];
        r.data[p0] = ay * bz - az * by;
        r.data[p1] = az * bx - ax * bz;
        r.data[p2] = ax * by - ay * bx;
      }
    }
    return [r];
  });

  def('trace', a => {
    const t = T_(a[0], 'trace');
    if (t.dims.length > 2) err('Error using trace: Input must be 2-D.');
    const [m, n] = t.dims, k = Math.min(m, n);
    let s = 0; for (let i = 0; i < k; i++) s += t.data[i + m * i];
    return [num(s)];
  });

  def('det', a => {
    const t = T_(a[0], 'det');
    if (t.dims.length > 2 || t.dims[0] !== t.dims[1]) err('Error using det: Matrix must be square.');
    const n = t.dims[0];
    if (n === 0) return [num(1)];
    const M = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => t.data[i + n * j]));
    let sign = 1, det = 1;
    for (let col = 0; col < n; col++) {
      let piv = col, best = Math.abs(M[col][col]);
      for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > best) { best = Math.abs(M[r][col]); piv = r; }
      if (best === 0) return [num(0)];
      if (piv !== col) { const tmp = M[col]; M[col] = M[piv]; M[piv] = tmp; sign = -sign; }
      det *= M[col][col];
      for (let r = col + 1; r < n; r++) {
        const f = M[r][col] / M[col][col];
        for (let c = col + 1; c < n; c++) M[r][c] -= f * M[col][c];
      }
    }
    return [num(sign * det)];
  });

  def('inv', (a, _n, I) => {
    const t = T_(a[0], 'inv');
    if (t.dims.length > 2 || t.dims[0] !== t.dims[1]) err('Error using inv: Matrix must be square.');
    const n = t.dims[0];
    const eye = mk('double', [n, n]);
    for (let i = 0; i < n; i++) eye.data[i + n * i] = 1;
    return [solveLinear(t, eye, s => I.host.warn?.(s))];
  });

  def('rank', a => {
    const t = T_(a[0], 'rank');
    if (t.dims.length > 2) err('Error using rank: Input must be 2-D.');
    const sv = singularValues(t);
    if (!sv.length) return [num(0)];
    const tol = a[1] !== undefined ? scalarOf(a[1]) : Math.max(t.dims[0], t.dims[1]) * Number.EPSILON * sv[0];
    let r = 0; for (const s of sv) if (s > tol) r++;
    return [num(r)];
  });

  def('nnz', a => {
    const t = T_(a[0], 'nnz');
    let c = 0; for (const v of t.data) if (v !== 0) c++;
    return [num(c)];
  });

  // Constants
  const clsArg = (v: any, dflt: string) => (!v ? dflt : isStr(v) ? toStr(v).toLowerCase() : (v as T).cls);
  def('intmax', a => {
    const c = clsArg(a[0], 'int32');
    const lim = INT_LIMITS[c];
    if (!lim) return err(`Error using intmax: Invalid integer class '${c}'.`);
    return [num(lim[1], c as Cls)];
  });
  def('intmin', a => {
    const c = clsArg(a[0], 'int32');
    const lim = INT_LIMITS[c];
    if (!lim) return err(`Error using intmin: Invalid integer class '${c}'.`);
    return [num(lim[0], c as Cls)];
  });
  def('realmax', a => {
    const c = a[0] ? toStr(a[0]).toLowerCase() : 'double';
    return [num(c === 'single' ? 3.4028234663852886e+38 : Number.MAX_VALUE, c === 'single' ? 'single' : 'double')];
  });
  def('realmin', a => {
    const c = a[0] ? toStr(a[0]).toLowerCase() : 'double';
    return [num(c === 'single' ? 1.1754943508222875e-38 : Number.MIN_VALUE * 4.503599627370496e15, c === 'single' ? 'single' : 'double')]; // 2^-1022
  });
  def('flintmax', a => {
    const c = a[0] ? toStr(a[0]).toLowerCase() : 'double';
    return [num(c === 'single' ? 16777216 : 9007199254740992, c === 'single' ? 'single' : 'double')];
  });

  // Time and sound
  def('pause', (a, _n, I) => {
    if (a.length >= 1 && isStr(a[0])) return [];
    const req = a.length ? scalarOf(a[0]) : 0.01;
    const ms = Math.min(5000, Math.max(0, req * 1000));
    I.flushFigures();
    const start = performance.now();
    while (performance.now() - start < ms) I.maybeTick();
    if (ms >= 100) I.flushFigures();
    return [];
  });
  def('beep', (_a, _n, I) => { I.host.beep?.(); return []; });

  void matmul; void transpose;
}
