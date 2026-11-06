// Values: column-major N-d tensors with MATLAB class semantics (uint8 saturation etc.)
import { MatlabError } from './parser';
export type Cls = 'double' | 'uint8' | 'logical' | 'char';
export interface T { cls: Cls; dims: number[]; data: Float64Array }
export interface S { cls: 'struct'; fields: [string, any][] }
export interface C { cls: 'cell'; dims: number[]; data: V[] }
export type V = T | S | C;
export const isT = (v: any): v is T => !!v && Array.isArray(v.dims);
export const isC = (v: any): v is C => !!v && v.cls === 'cell' && Array.isArray(v.dims) && Array.isArray(v.data);
export const numel = (d: number[]) => d.reduce((a, b) => a * b, 1);

export function sat(cls: Cls, v: number): number {
  if (cls === 'uint8') return v !== v ? 0 : v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v);
  if (cls === 'logical') return v !== 0 ? 1 : 0;
  return v;
}
export const mk = (cls: Cls, dims: number[], data?: ArrayLike<number>): T => {
  while (dims.length > 2 && dims[dims.length - 1] === 1) dims = dims.slice(0, -1);
  const n = numel(dims), d = new Float64Array(n);
  if (data) for (let i = 0; i < n; i++) d[i] = data[i];
  return { cls, dims, data: d };
};
export const num = (v: number, cls: Cls = 'double'): T => ({ cls, dims: [1, 1], data: Float64Array.of(sat(cls, v)) });
export const str = (s: string): T => mk('char', [s.length ? 1 : 0, s.length], Array.from(s, c => c.charCodeAt(0)));
export const toStr = (t: any): string => (isT(t) ? String.fromCharCode(...Array.from(t.data)) : '');
export const isStr = (t: any) => isT(t) && t.cls === 'char';
export const scalarOf = (t: any, what = 'argument'): number => {
  if (!isT(t) || t.data.length < 1) throw new MatlabError(`Expected a numeric ${what}.`);
  return t.data[0];
};
export const dimStr = (d: number[]) => d.join('×');
export const outCls = (a: T, b: T): Cls => (a.cls === 'uint8' || b.cls === 'uint8' ? 'uint8' : 'double');

// ---------- elementwise with implicit expansion ----------
export function ew(a: T, b: T, f: (x: number, y: number) => number, cls: Cls): T {
  const sa = a.data.length === 1, sb = b.data.length === 1;
  if (sa || sb || (a.dims.length === b.dims.length && a.dims.every((x, i) => x === b.dims[i]))) {
    const dims = sa && !sb ? b.dims : a.dims, n = numel(dims), r = new Float64Array(n);
    for (let i = 0; i < n; i++) r[i] = sat(cls, f(a.data[sa ? 0 : i], b.data[sb ? 0 : i]));
    return { cls, dims: dims.slice(), data: r };
  }
  const nd = Math.max(a.dims.length, b.dims.length), da: number[] = [], db: number[] = [], dr: number[] = [];
  for (let i = 0; i < nd; i++) {
    const x = a.dims[i] ?? 1, y = b.dims[i] ?? 1;
    if (x !== y && x !== 1 && y !== 1) throw new MatlabError('Arrays have incompatible sizes for this operation.');
    da.push(x); db.push(y); dr.push(Math.max(x, y));
  }
  const n = numel(dr), r = new Float64Array(n), sub = new Array(nd).fill(0);
  for (let i = 0; i < n; i++) {
    let ia = 0, ib = 0, ma = 1, mb = 1;
    for (let d = 0; d < nd; d++) { ia += (da[d] === 1 ? 0 : sub[d]) * ma; ib += (db[d] === 1 ? 0 : sub[d]) * mb; ma *= da[d]; mb *= db[d]; }
    r[i] = sat(cls, f(a.data[ia], b.data[ib]));
    for (let d = 0; d < nd; d++) { if (++sub[d] < dr[d]) break; sub[d] = 0; }
  }
  return { cls, dims: dr, data: r };
}
export function matmul(a: T, b: T): T {
  if (a.dims.length > 2 || b.dims.length > 2) throw new MatlabError('Incorrect dimensions for matrix multiplication.');
  const [m, k] = a.dims, [k2, n] = b.dims;
  if (k !== k2) throw new MatlabError('Incorrect dimensions for matrix multiplication. Check that the number of columns in the first matrix matches the number of rows in the second matrix.');
  const cls = outCls(a, b), r = mk(cls, [m, n]);
  for (let j = 0; j < n; j++) for (let i = 0; i < m; i++) { let s = 0; for (let l = 0; l < k; l++) s += a.data[i + m * l] * b.data[l + k * j]; r.data[i + m * j] = sat(cls, s); }
  return r;
}
export function transpose(a: T): T {
  if (a.dims.length > 2) throw new MatlabError('Transpose on ND array is not defined.');
  const [m, n] = a.dims, r = mk(a.cls, [n, m]);
  for (let i = 0; i < m; i++) for (let j = 0; j < n; j++) r.data[j + n * i] = a.data[i + m * j];
  return r;
}
export function binop(op: string, a: T, b: T): T {
  const c = outCls(a, b);
  switch (op) {
    case '+': return ew(a, b, (x, y) => x + y, c);
    case '-': return ew(a, b, (x, y) => x - y, c);
    case '.*': return ew(a, b, (x, y) => x * y, c);
    case './': return ew(a, b, (x, y) => x / y, c);
    case '.^': return ew(a, b, Math.pow, c);
    case '*': return a.data.length === 1 || b.data.length === 1 ? ew(a, b, (x, y) => x * y, c) : matmul(a, b);
    case '/': if (b.data.length === 1) return ew(a, b, (x, y) => x / y, c); throw new MatlabError('Matrix right division is not supported yet (use ./).');
    case '\\': throw new MatlabError('Matrix left division is not supported yet.');
    case '^': if (a.data.length === 1 && b.data.length === 1) return ew(a, b, Math.pow, c); throw new MatlabError('Matrix power is not supported yet (use .^).');
    case '<': return ew(a, b, (x, y) => +(x < y), 'logical');
    case '<=': return ew(a, b, (x, y) => +(x <= y), 'logical');
    case '>': return ew(a, b, (x, y) => +(x > y), 'logical');
    case '>=': return ew(a, b, (x, y) => +(x >= y), 'logical');
    case '==': return ew(a, b, (x, y) => +(x === y), 'logical');
    case '~=': return ew(a, b, (x, y) => +(x !== y), 'logical');
    case '&': return ew(a, b, (x, y) => +(x !== 0 && y !== 0), 'logical');
    case '|': return ew(a, b, (x, y) => +(x !== 0 || y !== 0), 'logical');
  }
  throw new MatlabError(`Unsupported operator ${op}`);
}

// ---------- indexing ----------
export type Idx = 'colon' | T;
function idxList(ix: Idx, n: number, pos: number, k: number): number[] | null {
  if (ix === 'colon') return null; // caller expands
  if (ix.cls === 'logical') { const r: number[] = []; for (let i = 0; i < ix.data.length; i++) if (ix.data[i]) r.push(i); return r; }
  const r = new Array(ix.data.length);
  for (let i = 0; i < r.length; i++) {
    const v = ix.data[i];
    if (v !== Math.floor(v)) throw new MatlabError(v === 0 ? 'Index in position ' + pos + ' is invalid. Array indices must be positive integers or logical values.' : 'Array indices must be positive integers or logical values.');
    if (v < 1) throw new MatlabError(v === 0 ? 'Index in position ' + pos + ' is invalid. Array indices must be positive integers or logical values.' : 'Index in position ' + pos + ' is invalid. Array indices must be positive integers or logical values.');
    r[i] = v - 1;
  }
  return r;
}
const effDims = (d: number[], k: number) => {
  if (k >= d.length) return d.concat(new Array(k - d.length).fill(1));
  return d.slice(0, k - 1).concat([numel(d.slice(k - 1))]);
};
export function index(t: T, ix: Idx[]): T {
  const k = ix.length;
  if (k === 0) return t;
  if (k === 1) {
    const n = t.data.length, a = ix[0];
    if (a === 'colon') return { cls: t.cls, dims: [n, 1], data: t.data.slice() };
    if (a.data.length === 1 && a.cls !== 'logical') {
      const v = a.data[0];
      if (v !== Math.floor(v) || v < 1) throw new MatlabError(v === 0 ? 'Index in position 1 is invalid. Array indices must be positive integers or logical values.' : 'Array indices must be positive integers or logical values.');
      if (v > n) throw new MatlabError(`Index exceeds the number of array elements. Index must not exceed ${n}.`);
      return { cls: t.cls, dims: [1, 1], data: Float64Array.of(t.data[v - 1]) };
    }
    const l = idxList(a, n, 1, 1)!, r = new Float64Array(l.length);
    for (let i = 0; i < l.length; i++) { if (l[i] >= n) throw new MatlabError(`Index exceeds the number of array elements. Index must not exceed ${n}.`); r[i] = t.data[l[i]]; }
    const srcVec = t.dims.length === 2 && (t.dims[0] === 1 || t.dims[1] === 1), idxVec = a.dims.length === 2 && (a.dims[0] === 1 || a.dims[1] === 1);
    let dims = a.cls === 'logical' ? (srcVec && t.dims[0] === 1 ? [1, l.length] : [l.length, 1]) : a.dims.slice();
    if (a.cls !== 'logical' && srcVec && idxVec) dims = t.dims[0] === 1 && t.dims[1] !== 1 ? [1, l.length] : [l.length, 1];
    return { cls: t.cls, dims, data: r };
  }
  const ed = effDims(t.dims, k);
  if (ix.every(a => a !== 'colon' && a.data.length === 1 && a.cls !== 'logical')) { // scalar fast path
    let off = 0, m = 1;
    for (let d = 0; d < k; d++) {
      const v = (ix[d] as T).data[0];
      if (v !== Math.floor(v) || v < 1) throw new MatlabError('Index in position ' + (d + 1) + ' is invalid. Array indices must be positive integers or logical values.');
      if (v > ed[d]) throw new MatlabError(`Index in position ${d + 1} exceeds array bounds. Index must not exceed ${ed[d]}.`);
      off += (v - 1) * m; m *= ed[d];
    }
    return { cls: t.cls, dims: [1, 1], data: Float64Array.of(t.data[off]) };
  }
  const lists: number[][] = ix.map((a, d) => {
    if (a === 'colon') return Array.from({ length: ed[d] }, (_, i) => i);
    const l = idxList(a, ed[d], d + 1, k)!;
    for (const v of l) if (v >= ed[d]) throw new MatlabError(`Index in position ${d + 1} exceeds array bounds. Index must not exceed ${ed[d]}.`);
    return l;
  });
  const rd = lists.map(l => l.length), n = numel(rd), r = new Float64Array(n), strides = [1];
  for (let d = 1; d < k; d++) strides.push(strides[d - 1] * ed[d - 1]);
  if (k === 2) { let o = 0; for (let j = 0; j < rd[1]; j++) { const cj = lists[1][j] * strides[1]; for (let i = 0; i < rd[0]; i++) r[o++] = t.data[lists[0][i] + cj]; } }
  else { const sub = new Array(k).fill(0); for (let o = 0; o < n; o++) { let p = 0; for (let d = 0; d < k; d++) p += lists[d][sub[d]] * strides[d]; r[o] = t.data[p]; for (let d = 0; d < k; d++) { if (++sub[d] < rd[d]) break; sub[d] = 0; } } }
  return mk(t.cls, rd, r);
}
export function assign(t: T | undefined, ix: Idx[], rhs: T, inPlace = false): T {
  const cls = t ? t.cls : rhs.cls;
  let cur: T = t ?? { cls, dims: [0, 0], data: new Float64Array(0) };
  const k = ix.length, nr = rhs.data.length;
  if (k === 1) {
    const a = ix[0], n = cur.data.length;
    const l = a === 'colon' ? Array.from({ length: n }, (_, i) => i) : idxList(a, n, 1, 1)!;
    if (nr !== 1 && nr !== l.length) throw new MatlabError('Unable to perform assignment because the number of elements on the left and right sides differ.');
    const mx = l.reduce((m, v) => Math.max(m, v + 1), 0);
    let data = cur.data, dims = cur.dims.slice();
    if (mx > n) {
      if (!(dims.length === 2 && (dims[0] <= 1 || dims[1] === 1) )) throw new MatlabError('Attempt to grow array along ambiguous dimension.');
      const nd = new Float64Array(mx); nd.set(data); data = nd; dims = dims[1] === 1 && dims[0] > 1 ? [mx, 1] : [1, mx];
    } else if (!inPlace || rhs.data === data) data = data.slice();
    for (let i = 0; i < l.length; i++) data[l[i]] = sat(cls, rhs.data[nr === 1 ? 0 : i]);
    return { cls, dims, data };
  }
  let ed = effDims(cur.dims, k);
  const rdims = rhs.dims.filter(d => d !== 1);
  let rpos = 0;
  const lists = ix.map((a, d) => {
    if (a === 'colon') { const len = ed[d] === 0 || cur.data.length === 0 ? (nr === 1 ? 1 : (rdims[rpos] ?? 1)) : ed[d]; if (a === 'colon') rpos++; return Array.from({ length: len }, (_, i) => i); }
    const l = idxList(a, ed[d], d + 1, k)!; if (l.length !== 1) rpos++; return l;
  });
  const cnt = lists.reduce((m, l) => m * l.length, 1);
  if (nr !== 1 && nr !== cnt) throw new MatlabError(`Unable to perform assignment because the size of the left side is ${dimStr(lists.map(l => l.length))} and the size of the right side is ${dimStr(rhs.dims)}.`);
  const nd = ed.map((d, i) => Math.max(d, lists[i].reduce((m, v) => Math.max(m, v + 1), 0)));
  let data: Float64Array;
  if (nd.some((d, i) => d !== ed[i])) {
    if (k < cur.dims.length) throw new MatlabError('Unable to resize array with fewer subscripts than dimensions.');
    data = new Float64Array(numel(nd)); const sub = new Array(k).fill(0), n0 = cur.data.length;
    for (let o = 0; o < n0; o++) { let p = 0, m = 1; for (let d = 0; d < k; d++) { p += sub[d] * m; m *= nd[d]; } data[p] = cur.data[o]; for (let d = 0; d < k; d++) { if (++sub[d] < ed[d]) break; sub[d] = 0; } }
    ed = nd;
  } else data = inPlace && rhs.data !== cur.data ? cur.data : cur.data.slice();
  const strides = [1]; for (let d = 1; d < k; d++) strides.push(strides[d - 1] * ed[d - 1]);
  const rd = lists.map(l => l.length), sub = new Array(k).fill(0);
  for (let o = 0; o < cnt; o++) {
    let p = 0; for (let d = 0; d < k; d++) p += lists[d][sub[d]] * strides[d];
    data[p] = sat(cls, rhs.data[nr === 1 ? 0 : o]);
    for (let d = 0; d < k; d++) { if (++sub[d] < rd[d]) break; sub[d] = 0; }
  }
  let dd = ed; while (dd.length > 2 && dd[dd.length - 1] === 1) dd = dd.slice(0, -1);
  return { cls, dims: dd, data };
}

// ---------- concatenation ----------
export function cat(dim: number, parts: T[]): T {
  parts = parts.filter(p => !(p.data.length === 0 && p.dims.length === 2 && p.dims[0] * p.dims[1] === 0 && parts.length > 1));
  if (parts.length === 1) return parts[0];
  if (!parts.length) return mk('double', [0, 0]);
  const cls: Cls = parts.some(p => p.cls === 'char') ? 'char' : parts.some(p => p.cls === 'uint8') ? 'uint8' : parts.every(p => p.cls === 'logical') ? 'logical' : 'double';
  const nd = Math.max(dim + 1, ...parts.map(p => p.dims.length));
  const dd = parts.map(p => p.dims.concat(new Array(nd - p.dims.length).fill(1)));
  for (const d of dd) for (let i = 0; i < nd; i++) if (i !== dim && d[i] !== dd[0][i]) throw new MatlabError(dim === 0 ? 'Dimensions of arrays being concatenated are not consistent.' : 'Dimensions of arrays being concatenated are not consistent.');
  const rd = dd[0].slice(); rd[dim] = dd.reduce((s, d) => s + d[dim], 0);
  const out = mk(cls, rd), outer = numel(rd.slice(dim + 1)), inner = numel(rd.slice(0, dim));
  let off = 0;
  for (let pi = 0; pi < parts.length; pi++) {
    const len = dd[pi][dim], chunk = inner * len;
    for (let o = 0; o < outer; o++) for (let q = 0; q < chunk; q++) out.data[o * inner * rd[dim] + off * inner + q] = sat(cls, parts[pi].data[o * chunk + q]);
    off += len;
  }
  return out;
}

// ---------- printing (MATLAB-style display) ----------
export interface PrintOpts { maxElements: number; width: number }
const digitsOf = (n: number) => String(Math.abs(Math.trunc(n))).length;
function fmtSlice(t: T, off: number, rows: number, cols: number): string {
  const cell = (i: number, j: number) => t.data[off + i + rows * j];
  let w: number, f: (v: number) => string;
  if (t.cls === 'char') { return Array.from({ length: rows }, (_, i) => '    ' + String.fromCharCode(...Array.from({ length: cols }, (_, j) => cell(i, j)))).join('\n') + '\n'; }
  const all = Array.from(t.data.subarray(off, off + rows * cols));
  if (t.cls === 'uint8' || t.cls === 'logical' || all.every(v => Number.isInteger(v))) {
    const ml = Math.max(...all.map(v => String(v).length), 1);
    w = t.cls === 'double' ? Math.max(6, ml + 3) : ml + 2;
    f = v => String(v);
  } else {
    f = v => (Number.isNaN(v) ? 'NaN' : !isFinite(v) ? (v < 0 ? '-Inf' : 'Inf') : v.toFixed(4));
    w = Math.max(...all.map(v => f(v).length)) + 4;
  }
  const per = Math.max(1, Math.floor(80 / w)); let out = '';
  for (let c0 = 0; c0 < cols; c0 += per) {
    const c1 = Math.min(cols, c0 + per);
    if (cols > per) out += (c1 - c0 === 1 ? ` Column ${c0 + 1}` : ` Columns ${c0 + 1} ${c1 === cols && c1 - c0 === 2 ? 'and' : 'through'} ${c1}`) + '\n\n';
    for (let i = 0; i < rows; i++) { let line = ''; for (let j = c0; j < c1; j++) line += f(cell(i, j)).padStart(w); out += line + '\n'; }
    if (cols > per && c1 < cols) out += '\n';
  }
  return out;
}
export function display(name: string, v: V, o: PrintOpts): string {
  if (isC(v)) return `${name} =\n\n  ${dimStr(v.dims)} cell array\n\n` + v.data.map((x, i) => `    {${i + 1}}  ${inline(x)}`).join('\n') + '\n\n';
  if (!isT(v)) {
    const w = Math.max(...v.fields.map(([k]) => k.length));
    return `${name} = \n\n  struct with fields:\n\n` + v.fields.map(([k, x]) => `    ${k.padStart(w)}: ${inline(x)}`).join('\n') + '\n\n';
  }
  const n = v.data.length;
  if (v.cls === 'char' && v.dims.length === 2 && v.dims[0] <= 1) return `${name} = ${toStr(v)}\n`;
  if (n === 0) return `${name} = [](${dimStr(v.dims)})\n`;
  if (n === 1) return `${name} = ${scalarStr(v.data[0], v.cls)}\n`;
  if (n > o.maxElements) return `${name} =\n\n  ${dimStr(v.dims)} ${v.cls} array (${n} elements; output suppressed – index a part of it, e.g. ${name}(1:5,1:5,1))\n\n`;
  if (v.dims.length === 2) return `${name} =\n\n${fmtSlice(v, 0, v.dims[0], v.dims[1])}\n`;
  const [r, c] = v.dims, rest = v.dims.slice(2), pages = numel(rest); let out = '';
  for (let p = 0; p < pages; p++) {
    const sub: number[] = []; let q = p; for (const d of rest) { sub.push((q % d) + 1); q = Math.floor(q / d); }
    out += `${name}(:,:,${sub.join(',')}) =\n\n${fmtSlice(v, p * r * c, r, c)}\n`;
  }
  return out;
}
const scalarStr = (x: number, cls: Cls) => (cls === 'double' && !Number.isInteger(x) ? (Number.isFinite(x) ? x.toFixed(4) : x > 0 ? 'Inf' : x < 0 ? '-Inf' : 'NaN') : String(x));
function inline(x: any): string {
  if (isC(x)) return `{${dimStr(x.dims)} cell}`;
  if (!isT(x)) return '[1×1 struct]';
  if (x.cls === 'char') return `'${toStr(x)}'`;
  if (x.data.length === 1) return scalarStr(x.data[0], x.cls);
  if (x.data.length === 0) return `[]`;
  return `[${dimStr(x.dims)} ${x.cls}]`;
}
