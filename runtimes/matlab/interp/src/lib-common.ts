import { MatlabError } from './parser';
import { T, V, Cls, isT, isStr, toStr, scalarOf, numel, sat, mk, num } from './values';

export type Builtin = (a: V[], nargout: number, I: any) => V[];
export type Def = (names: string, f: Builtin) => void;

export const err = (m: string, id?: string): never => {
  const e = new MatlabError(m);
  if (id) (e as any).identifier = id;
  throw e;
};

export const T_ = (v: V, fn: string): T =>
  isT(v) ? v : err(`Error using ${fn}: Invalid argument (struct/cell/handle not allowed here).`);

export const clsFromName = (s: string): Cls =>
  (['double', 'uint8', 'logical'].includes(s) ? (s as Cls) : err(`Unsupported class '${s}'.`));

export function dimsFrom(a: V[], fn: string): { dims: number[]; cls: Cls } {
  let cls: Cls = 'double';
  const rest = a.slice();
  if (rest.length && isStr(rest[rest.length - 1])) cls = clsFromName(toStr(rest.pop()));
  const ts = rest.map(x => T_(x, fn));
  let dims: number[] =
    ts.length === 0 ? [1, 1] :
    ts.length === 1 ? (ts[0].data.length === 1 ? [ts[0].data[0], ts[0].data[0]] : Array.from(ts[0].data)) :
    ts.map(t => t.data[0]);
  dims = dims.map(d => Math.max(0, Math.floor(d)));
  return { dims, cls };
}

export const firstNonSingleton = (t: T): number => {
  const k = t.dims.findIndex(d => d !== 1);
  return k < 0 ? 0 : k;
};

export function reduce(t: T, dim: number, f: (v: number[]) => number, cls: Cls): T {
  const d = t.dims.concat(new Array(Math.max(0, dim + 1 - t.dims.length)).fill(1)), len = d[dim];
  const inner = numel(d.slice(0, dim)), outer = numel(d.slice(dim + 1)), rd = d.slice();
  rd[dim] = 1;
  const r = mk(cls, rd), buf = new Array(len);
  for (let o = 0; o < outer; o++) {
    for (let i = 0; i < inner; i++) {
      for (let k = 0; k < len; k++) buf[k] = t.data[i + inner * (k + len * o)];
      r.data[i + inner * o] = sat(cls, f(buf));
    }
  }
  return r;
}

export function reduceWithIdx(t: T, dim: number, f: (v: number[]) => [number, number], cls: Cls): [T, T] {
  const d = t.dims.concat(new Array(Math.max(0, dim + 1 - t.dims.length)).fill(1)), len = d[dim];
  const inner = numel(d.slice(0, dim)), outer = numel(d.slice(dim + 1)), rd = d.slice();
  rd[dim] = 1;
  const r = mk(cls, rd), idx = mk('double', rd), buf = new Array(len);
  for (let o = 0; o < outer; o++) {
    for (let i = 0; i < inner; i++) {
      for (let k = 0; k < len; k++) buf[k] = t.data[i + inner * (k + len * o)];
      const [val, bestIdx] = f(buf);
      r.data[i + inner * o] = sat(cls, val);
      idx.data[i + inner * o] = bestIdx;
    }
  }
  return [r, idx];
}

export const isAllFlag = (v: V | undefined): boolean => !!v && isStr(v) && toStr(v).toLowerCase() === 'all';

export const redDim = (t: T, a: V[], argIdx = 1): number | 'all' => {
  if (a[argIdx] !== undefined) {
    if (isAllFlag(a[argIdx])) return 'all';
    const d = Math.floor(scalarOf(a[argIdx], 'dimension'));
    if (d < 1) err('Dimension argument must be a positive integer.');
    return d - 1;
  }
  return firstNonSingleton(t);
};

// Deterministic PRNG seeded through rng()
let seed = 123456789;
export const getSeed = () => seed;
export const setSeed = (s: number) => { seed = (s >>> 0) || 1; };
export const rnd = (): number => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
export function randnSample(): number {
  let u = 0, v = 0;
  while (u === 0) u = rnd();
  while (v === 0) v = rnd();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

export function sprintfFmt(fmt: string, args: V[], fn = 'sprintf'): string {
  const flat: (number | string)[] = [];
  for (const a of args) {
    const t = T_(a, fn);
    if (t.cls === 'char') flat.push(toStr(t));
    else t.data.forEach(v => flat.push(v));
  }
  fmt = fmt.replace(/\\([ntr\\])/g, (_, c) => ({ n: '\n', t: '\t', r: '\r', '\\': '\\' } as any)[c]);
  let out = '', ai = 0, first = true;
  while (first || ai < flat.length) {
    first = false;
    let used = false;
    out += fmt.replace(/%([-+0 #]*)(\d+)?(?:\.(\d+))?([diefgGeEuoxXsc%])/g, (_m, fl, w, pr, c) => {
      if (c === '%') return '%';
      if (ai >= flat.length) return '';
      used = true;
      const v = flat[ai++];
      let s: string;
      if (c === 's') s = typeof v === 'number' ? String(v) : v;
      else if (c === 'c') s = typeof v === 'number' ? String.fromCharCode(v) : (v[0] ?? '');
      else if (typeof v === 'string') s = v;
      else if (c === 'd' || c === 'i') s = Number.isInteger(v) ? String(v) : String(+v.toPrecision(6));
      else if (c === 'u') s = String(v >>> 0);
      else if (c === 'o') s = (v >>> 0).toString(8);
      else if (c === 'x') s = (v >>> 0).toString(16);
      else if (c === 'X') s = (v >>> 0).toString(16).toUpperCase();
      else if (c === 'f') s = v.toFixed(pr === undefined ? 6 : +pr);
      else if (c === 'e' || c === 'E') {
        const exp = v.toExponential(pr === undefined ? 6 : +pr).replace(/e([+-])(\d)$/, 'e$10$2');
        s = c === 'E' ? exp.toUpperCase() : exp;
      } else {
        const p = pr === undefined ? 6 : Math.max(1, +pr);
        const g = Number.isFinite(v) ? Number(v.toPrecision(p)) : v;
        s = String(g);
        if (c === 'G') s = s.toUpperCase();
      }
      if (fl.includes('+') && typeof v === 'number' && v >= 0 && !s.startsWith('-')) s = '+' + s;
      return w ? (fl.includes('-') ? s.padEnd(+w) : s.padStart(+w, fl.includes('0') ? '0' : ' ')) : s;
    });
    if (!used) break;
  }
  return out;
}

/** Symmetric Jacobi eigenvalues (returns sorted descending eigenvalues of real symmetric n x n matrix). */
export function symEigenvalues(A: Float64Array, n: number): number[] {
  const M = Float64Array.from(A);
  for (let iter = 0; iter < 50 * n * n; iter++) {
    let p = 0, q = 1, maxOff = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const v = Math.abs(M[i + n * j]);
        if (v > maxOff) { maxOff = v; p = i; q = j; }
      }
    }
    if (maxOff <= 1e-14) break;
    const app = M[p + n * p], aqq = M[q + n * q], apq = M[p + n * q];
    const tau = (aqq - app) / (2 * apq);
    const t = tau >= 0 ? 1 / (tau + Math.sqrt(1 + tau * tau)) : -1 / (-tau + Math.sqrt(1 + tau * tau));
    const c = 1 / Math.sqrt(1 + t * t), s = t * c;
    M[p + n * p] = app - t * apq;
    M[q + n * q] = aqq + t * apq;
    M[p + n * q] = 0;
    M[q + n * p] = 0;
    for (let k = 0; k < n; k++) {
      if (k === p || k === q) continue;
      const akp = M[k + n * p], akq = M[k + n * q];
      M[k + n * p] = M[p + n * k] = c * akp - s * akq;
      M[k + n * q] = M[q + n * k] = s * akp + c * akq;
    }
  }
  const ev = new Array(n);
  for (let i = 0; i < n; i++) ev[i] = M[i + n * i];
  return ev.sort((a, b) => b - a);
}

/** Singular values of 2-D matrix (m x n) via symmetric eigenvalues of A'*A or A*A'. */
export function singularValues(t: T): number[] {
  const [m, n] = t.dims;
  if (m === 0 || n === 0) return [];
  if (m >= n) {
    const ata = new Float64Array(n * n);
    for (let i = 0; i < n; i++) for (let j = i; j < n; j++) {
      let s = 0;
      for (let k = 0; k < m; k++) s += t.data[k + m * i] * t.data[k + m * j];
      ata[i + n * j] = ata[j + n * i] = s;
    }
    return symEigenvalues(ata, n).map(v => Math.sqrt(Math.max(0, v)));
  }
  const aat = new Float64Array(m * m);
  for (let i = 0; i < m; i++) for (let j = i; j < m; j++) {
    let s = 0;
    for (let k = 0; k < n; k++) s += t.data[i + m * k] * t.data[j + m * k];
    aat[i + m * j] = aat[j + m * i] = s;
  }
  return symEigenvalues(aat, m).map(v => Math.sqrt(Math.max(0, v)));
}

export { num };
