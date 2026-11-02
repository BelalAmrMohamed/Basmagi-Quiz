import { parse, MatlabError } from './parser';
import { T, V, S, C, Idx, Cls, isT, isC, mk, num, str, toStr, isStr, scalarOf, numel, sat, ew, binop, transpose, index, assign, cat, display, dimStr, PrintOpts } from './values';

// ---------- host interface (browser UI and Node tests each implement this) ----------
export interface RawImage { width: number; height: number; channels: 1 | 3; data: Uint8Array; /* row-major, interleaved */
  colormap?: number[][]; bitDepth: number; format: string; fileSize: number; fileModDate?: string; colorType: string; filename: string }
export interface Host {
  print(s: string): void;
  warn?(s: string): void;
  readImage(path: string): RawImage | null;
  writeImage(path: string, img: { width: number; height: number; channels: 1 | 3; data: Uint8Array }): void;
  showImage(img: { width: number; height: number; rgb: Uint8Array }, opts: { tool: boolean }): void;
  newFigure(): void;
  clc?(): void;
  maxPrintElements?: number;
}

type Scope = Map<string, V>;
type Builtin = (a: V[], nargout: number, I: Interp) => V[];
const BRK = 1, CNT = 2, RET = 3;
const err = (m: string): never => { throw new MatlabError(m); };
const T_ = (v: V, fn: string): T => isT(v) ? v : err(`Error using ${fn}: Invalid argument (struct not allowed here).`);

export class Interp {
  vars: Scope = new Map();
  funcs = new Map<string, any>();
  private endStack: { t: { dims: number[]; data: { length: number } }; pos: number; n: number }[] = [];
  private depth = 0;
  constructor(public host: Host) {}
  get opts(): PrintOpts { return { maxElements: this.host.maxPrintElements ?? 3000, width: 80 }; }

  run(src: string) {
    const ast = parse(src);
    for (const s of ast) if (s.k === 'func') this.funcs.set(s.name, s);
    this.exec(ast.filter(s => s.k !== 'func'), this.vars);
  }
  private store(sc: Scope, name: string, v: V) {
    if (isT(v)) { if ((v as any).held) v = { ...v, data: v.data.slice() }; (v as any).held = true; }
    else if (isC(v)) v = { cls: 'cell', dims: v.dims.slice(), data: v.data.map(x => this.cloneValue(x)) };
    else v = { cls: 'struct', fields: v.fields.map(([k, x]) => [k, this.cloneValue(x)]) };
    sc.set(name, v);
  }
  private cloneValue(v: V): V {
    if (isT(v)) return { cls: v.cls, dims: v.dims.slice(), data: v.data.slice() };
    if (isC(v)) return { cls: 'cell', dims: v.dims.slice(), data: v.data.map(x => this.cloneValue(x)) };
    return { cls: 'struct', fields: v.fields.map(([k, x]) => [k, this.cloneValue(x)]) };
  }
  private show(name: string, v: V) { this.host.print(display(name, v, this.opts)); }

  // ---------- statements ----------
  exec(stmts: any[], sc: Scope): number {
    for (const s of stmts) {
      switch (s.k) {
        case 'expr': {
          const e = s.e;
          if (e.k === 'id' && sc.has(e.n)) { if (s.show) this.show(e.n, sc.get(e.n)!); break; }
          const r = this.evalMulti(e, sc, 0);
          if (r.length) { this.store(sc, 'ans', r[0]); if (s.show) this.show('ans', sc.get('ans')!); }
          break;
        }
        case 'switch': {
          const value = this.eval(s.value, sc);
          let selected: any[] | null = null;
          for (const c of s.cases) {
            if (this.sameCase(value, this.eval(c.match, sc))) { selected = c.body; break; }
          }
          const r = this.exec(selected ?? s.otherwise ?? [], sc);
          if (r === BRK) break;
          if (r) return r;
          break;
        }
        case 'assign': {
          const rs = s.lhs.length === 1 ? [this.evalMulti(s.rhs, sc, 1)[0]] : this.evalMulti(s.rhs, sc, s.lhs.length);
          s.lhs.forEach((lv: any, i: number) => {
            if (!lv) return;
            const val = rs[i]; if (val === undefined) err(s.lhs.length === 1 ? 'Value must be assigned: the expression returned no value.' : 'Too many output arguments.');
            this.assignTo(sc, lv, val);
            if (s.show) this.show(lv.n, sc.get(lv.n)!);
          });
          break;
        }
        case 'if': {
          let done = false;
          for (const c of s.clauses) if (this.truthy(this.eval(c.c, sc))) { const r = this.exec(c.body, sc); if (r) return r; done = true; break; }
          if (!done && s.els) { const r = this.exec(s.els, sc); if (r) return r; }
          break;
        }
        case 'for': {
          const rng = this.eval(s.e, sc) as T, rows = rng.dims[0], cols = rng.data.length / (rows || 1);
          for (let j = 0; j < (rng.data.length ? cols : 0); j++) {
            this.store(sc, s.v, rows === 1 ? num(rng.data[j], rng.cls) : mk(rng.cls, [rows, 1], rng.data.subarray(j * rows, (j + 1) * rows)));
            const r = this.exec(s.body, sc); if (r === BRK) break; if (r === RET) return r;
          }
          break;
        }
        case 'while': {
          let guard = 0;
          while (this.truthy(this.eval(s.c, sc))) {
            if (++guard > 5e6) err('Loop iteration limit (5,000,000) exceeded.');
            const r = this.exec(s.body, sc); if (r === BRK) break; if (r === RET) return r;
          }
          break;
        }
        case 'break': return BRK;
        case 'continue': return CNT;
        case 'return': return RET;
      }
    }
    return 0;
  }
  private truthy(v: V): boolean { const t = T_(v, 'if'); return t.data.length > 0 && t.data.every(x => x !== 0); }

  private sameCase(a: V, b: V): boolean {
    if (isT(a) && isT(b)) return a.cls === b.cls && a.dims.join(',') === b.dims.join(',') && a.data.length === b.data.length && a.data.every((x, i) => x === b.data[i]);
    if (isC(a) && isC(b)) return a.dims.join(',') === b.dims.join(',') && a.data.length === b.data.length && a.data.every((x, i) => this.sameCase(x, b.data[i]));
    if (!isT(a) && !isT(b) && !isC(a) && !isC(b)) return a.fields.length === b.fields.length && a.fields.every(([k, v], i) => k === b.fields[i][0] && this.sameCase(v, b.fields[i][1]));
    return false;
  }
  private assignTo(sc: Scope, lv: any, val: V) {
    if (lv.k === 'id') return this.store(sc, lv.n, val);
    if (lv.k === 'field') {
      const path: string[] = [];
      let base = lv;
      while (base.k === 'field') { path.unshift(base.n); base = base.a; }
      if (base.k !== 'id') err('Invalid structure assignment.');
      const current = sc.get(base.n);
      let root: S;
      if (!current) root = { cls: 'struct', fields: [] };
      else if (isT(current) || isC(current)) throw new MatlabError('Dot indexing is not supported for this value.');
      else root = { cls: 'struct', fields: current.fields.slice() };
      let parent = root;
      for (const name of path.slice(0, -1)) {
        let nested = parent.fields.find(([k]) => k === name)?.[1];
        if (!nested) {
          nested = { cls: 'struct', fields: [] } as S;
          parent.fields.push([name, nested]);
        }
        if (isT(nested) || isC(nested)) err(`Cannot create field '${name}' on this value.`);
        parent = nested;
      }
      const name = path[path.length - 1], i = parent.fields.findIndex(([k]) => k === name);
      if (i < 0) parent.fields.push([name, val]); else parent.fields[i] = [name, val];
      this.store(sc, base.n, root);
      return;
    }
    if (lv.k === 'cellidx') {
      if (lv.a.k !== 'id') err('Cell assignment requires a named cell array.');
      const current = sc.get(lv.a.n);
      if (!current || !isC(current)) throw new MatlabError('Brace indexing is only supported for cell arrays.');
      const positions = this.cellPositions(current, lv.args, sc).positions;
      if (positions.length !== 1) err('Cell assignment requires one selected cell.');
      current.data[positions[0]] = val;
      return;
    }
    if (lv.k !== 'idx') err('Invalid assignment target.');
    const cur = sc.get(lv.n), rhs = T_(val, 'assignment');
    if (cur !== undefined && !isT(cur)) throw new MatlabError('Invalid indexed assignment to a non-numeric value.');
    const numericCur = isT(cur) ? cur : undefined;
    const ix = this.evalArgs(lv.args, numericCur ?? null, sc);
    // fast path: scalar subscripts inside bounds -> mutate in place (each variable owns its tensor)
    if (numericCur && ix.length >= 2 && rhs.data.length === 1 && ix.every(a => a !== 'colon' && a.data.length === 1 && a.cls !== 'logical') && ix.length === numericCur.dims.length) {
      let off = 0, m = 1, ok = true;
      for (let d = 0; d < ix.length; d++) { const v = (ix[d] as T).data[0]; if (!(v >= 1 && v <= numericCur.dims[d] && v === Math.floor(v))) { ok = false; break; } off += (v - 1) * m; m *= numericCur.dims[d]; }
      if (ok) { numericCur.data[off] = sat(numericCur.cls, rhs.data[0]); return; }
    }
    const res = assign(numericCur, ix, rhs, !!numericCur); (res as any).held = true; sc.set(lv.n, res);
  }

  // ---------- expressions ----------
  evalMulti(e: any, sc: Scope, nargout: number): V[] {
    if (e.k === 'id' && !sc.has(e.n)) return this.callFn(e.n, [], nargout);
    if (e.k === 'idx' && !sc.has(e.n)) return this.callFn(e.n, e.args.map((a: any) => (a.k === 'colon' ? str(':') : this.eval(a, sc))), nargout);
    return [this.eval(e, sc)];
  }
  eval(e: any, sc: Scope): V {
    switch (e.k) {
      case 'num': return num(e.v);
      case 'str': return str(e.v);
      case 'paren': return this.eval(e.a, sc);
      case 'id': {
        const v = sc.get(e.n); if (v) return v;
        const r = this.callFn(e.n, [], 1); return r[0] ?? err(`Value must be assigned: '${e.n}' returned no value.`);
      }
      case 'end': {
        const c = this.endStack[this.endStack.length - 1]; if (!c) err("Invalid use of 'end'.");
        const { t, pos, n } = c; if (n === 1) return num(t.data.length);
        return num(pos < n - 1 ? (t.dims[pos] ?? 1) : numel(t.dims.slice(pos)));
      }
      case 'un': {
        const a = T_(this.eval(e.a, sc), 'unary');
        if (e.op === '~') return ew(a, a, x => +(x === 0), 'logical');
        if (e.op === '+') return a;
        return ew(a, a, x => -x, a.cls === 'uint8' ? 'uint8' : 'double');
      }
      case 'bin': {
        if (e.op === '&&' || e.op === '||') {
          const l = this.truthy(this.eval(e.a, sc));
          if (e.op === '&&' ? !l : l) return num(+l, 'logical');
          return num(+this.truthy(this.eval(e.b, sc)), 'logical');
        }
        return binop(e.op, T_(this.eval(e.a, sc), e.op), T_(this.eval(e.b, sc), e.op));
      }
      case 'post': return transpose(T_(this.eval(e.a, sc), "'"));
      case 'range': {
        const a = scalarOf(this.eval(e.a, sc)), st = e.step ? scalarOf(this.eval(e.step, sc)) : 1, b = scalarOf(this.eval(e.b, sc));
        const n = st === 0 || (st > 0 && a > b) || (st < 0 && a < b) ? 0 : Math.floor((b - a) / st + 1e-10) + 1;
        const r = mk('double', [1, n]); for (let i = 0; i < n; i++) r.data[i] = a + i * st; return r;
      }
      case 'mat': {
        const rows = e.rows.map((r: any[]) => cat(1, r.map(x => T_(this.eval(x, sc), '[]'))));
        return rows.length ? cat(0, rows) : mk('double', [0, 0]);
      }
      case 'cellmat': {
        if (!e.rows.length) return { cls: 'cell', dims: [0, 0], data: [] } as C;
        const cols = e.rows[0].length;
        if (e.rows.some((r: any[]) => r.length !== cols)) err('Cell array rows must have the same number of elements.');
        const data = new Array<V>(e.rows.length * cols);
        e.rows.forEach((r: any[], row: number) => r.forEach((x, col) => { data[row + e.rows.length * col] = this.eval(x, sc); }));
        return { cls: 'cell', dims: [e.rows.length, cols], data } as C;
      }
      case 'field': {
        const base = this.eval(e.a, sc);
        if (isT(base) || isC(base)) throw new MatlabError('Dot indexing is not supported for this value.');
        const value = base.fields.find(([k]) => k === e.n)?.[1];
        return value ?? err(`Unrecognized field name '${e.n}'.`);
      }
      case 'cellidx': return this.cellIndex(e, sc, true);
      case 'apply': {
        const base = this.eval(e.a, sc);
        if (isC(base)) return this.cellIndex({ ...e, a: { k: 'value', v: base } }, sc, false);
        return index(T_(base, 'indexing'), this.evalArgs(e.args, isT(base) ? base : null, sc));
      }
      case 'idx': {
        const v = sc.get(e.n);
        if (v) {
          if (isC(v)) {
            const { positions, dims } = this.cellPositions(v, e.args, sc);
            return { cls: 'cell', dims, data: positions.map(i => v.data[i]) } as C;
          }
          const t = T_(v, 'indexing'); return index(t, this.evalArgs(e.args, t, sc));
        }
        const r = this.callFn(e.n, e.args.map((a: any) => (a.k === 'colon' ? str(':') : this.eval(a, sc))), 1);
        return r[0] ?? err(`Error using ${e.n}: Too many output arguments.`);
      }
    }
    return err('Unsupported expression: ' + e.k);
  }
  private cellIndex(e: any, sc: Scope, contents: boolean): V {
    let base: V;
    if (e.a.k === 'value') base = e.a.v;
    else base = this.eval(e.a, sc);
    if (!isC(base)) throw new MatlabError('Brace indexing is only supported for cell arrays.');
    const { positions, dims } = this.cellPositions(base, e.args, sc);
    if (contents) {
      if (positions.length !== 1) err('Brace indexing requires a single cell selection.');
      return base.data[positions[0]];
    }
    return { cls: 'cell', dims, data: positions.map(i => base.data[i]) } as C;
  }
  private cellPositions(base: C, args: any[], sc: Scope): { positions: number[]; dims: number[] } {
    if (!args.length) err('Cell indexing requires at least one subscript.');
    const ix = this.evalArgs(args, base, sc);
    let dims = base.dims.slice();
    if (ix.length === 1) {
      const x = ix[0];
      if (x === 'colon') return { positions: base.data.map((_v, i) => i), dims: [base.data.length, 1] };
      if (x.cls === 'logical' && x.data.length !== base.data.length) err('Logical index must contain the same number of elements as the cell array.');
      const positions = x.cls === 'logical'
        ? Array.from(x.data, (v, i) => v ? i : -1).filter(i => i >= 0)
        : Array.from(x.data, v => v - 1);
      if (positions.some(i => !Number.isInteger(i) || i < 0 || i >= base.data.length)) err('Cell index exceeds array bounds.');
      const srcVector = dims.length === 2 && (dims[0] === 1 || dims[1] === 1);
      const idxVector = x.dims.length === 2 && (x.dims[0] === 1 || x.dims[1] === 1);
      let resultDims = x.cls === 'logical' ? [positions.length, 1] : x.dims.slice();
      if (srcVector && idxVector && x.cls !== 'logical') resultDims = dims[0] === 1 ? [1, positions.length] : [positions.length, 1];
      return { positions, dims: resultDims };
    }
    if (ix.length < dims.length) dims = dims.slice(0, ix.length - 1).concat([numel(dims.slice(ix.length - 1))]);
    while (dims.length < ix.length) dims.push(1);
    const lists = ix.map((x, d) => {
      if (x === 'colon') return Array.from({ length: dims[d] }, (_v, i) => i);
      if (x.cls === 'logical' && x.data.length !== dims[d]) err(`Logical index in position ${d + 1} has an incompatible size.`);
      const values = x.cls === 'logical'
        ? Array.from(x.data, (v, i) => v ? i : -1).filter(i => i >= 0)
        : Array.from(x.data, v => v - 1);
      if (values.some(i => !Number.isInteger(i) || i < 0 || i >= dims[d])) err(`Cell index in position ${d + 1} exceeds array bounds.`);
      return values;
    });
    const resultDims = lists.map(list => list.length), positions: number[] = [];
    const sub = new Array(ix.length).fill(0), strides = [1];
    for (let d = 1; d < ix.length; d++) strides.push(strides[d - 1] * dims[d - 1]);
    const count = numel(resultDims);
    for (let i = 0; i < count; i++) {
      positions.push(lists.reduce((offset, list, d) => offset + list[sub[d]] * strides[d], 0));
      for (let d = 0; d < sub.length; d++) { if (++sub[d] < resultDims[d]) break; sub[d] = 0; }
    }
    return { positions, dims: resultDims };
  }
  private evalArgs(args: any[], base: { dims: number[]; data: { length: number } } | null, sc: Scope): Idx[] {
    return args.map((a, i) => {
      if (a.k === 'colon') return 'colon';
      if (a.k === 'num') return num(a.v);
      if (base) this.endStack.push({ t: base, pos: i, n: args.length });
      try { return T_(this.eval(a, sc), 'index'); } finally { if (base) this.endStack.pop(); }
    });
  }

  callFn(name: string, args: V[], nargout: number): V[] {
    const f = this.funcs.get(name);
    if (f) {
      if (args.length > f.params.length) err(`Error using ${name}: Too many input arguments.`);
      if (++this.depth > 200) { this.depth = 0; err('Maximum recursion limit of 200 reached.'); }
      const sc: Scope = new Map(); args.forEach((a, i) => this.store(sc, f.params[i], a));
      try { this.exec(f.body, sc); } finally { this.depth--; }
      const out: V[] = [];
      for (let i = 0; i < Math.max(nargout, 1) && i < f.outs.length; i++) {
        const v = sc.get(f.outs[i]);
        if (!v) { if (i < nargout || (i === 0 && nargout === 1)) err(`Output argument '${f.outs[i]}' (and maybe others) not assigned during call to '${name}'.`); break; }
        out.push(v);
      }
      return out;
    }
    const b = BUILTINS[name];
    if (!b) err(`Unrecognized function or variable '${name}'.`);
    return b(args, nargout, this);
  }
}

// =====================================================================================
// Builtins
// =====================================================================================
const BUILTINS: Record<string, Builtin> = {};
const def = (names: string, f: Builtin) => names.split(' ').forEach(n => (BUILTINS[n] = f));
const clsFromName = (s: string): Cls => (['double', 'uint8', 'logical'].includes(s) ? (s as Cls) : err(`Unsupported class '${s}'.`));
function dimsFrom(a: V[], fn: string): { dims: number[]; cls: Cls } {
  let cls: Cls = 'double'; if (a.length && isStr(a[a.length - 1])) cls = clsFromName(toStr(a.pop()));
  const ts = a.map(x => T_(x, fn));
  let dims: number[] = ts.length === 0 ? [1, 1] : ts.length === 1 ? (ts[0].data.length === 1 ? [ts[0].data[0], ts[0].data[0]] : Array.from(ts[0].data)) : ts.map(t => t.data[0]);
  dims = dims.map(d => Math.max(0, Math.floor(d)));
  return { dims, cls };
}
def('zeros', a => { const { dims, cls } = dimsFrom(a, 'zeros'); return [mk(cls, dims)]; });
def('ones', a => { const { dims, cls } = dimsFrom(a, 'ones'); const t = mk(cls, dims); t.data.fill(1); return [t]; });
def('size', (a, n) => {
  const t = a[0], d = isT(t) || isC(t) ? t.dims : [1, 1];
  if (a.length > 1) { const k = scalarOf(a[1]); return [num(d[k - 1] ?? 1)]; }
  if (n <= 1) return [mk('double', [1, d.length], d)];
  const out: V[] = []; for (let i = 0; i < n; i++) out.push(num(i < n - 1 ? (d[i] ?? 1) : numel(d.slice(i))));
  return out;
});
def('numel', a => [num(isT(a[0]) || isC(a[0]) ? a[0].data.length : 1)]);
def('length', a => { const d = isT(a[0]) || isC(a[0]) ? a[0].dims : [1, 1]; return [num(numel(d) ? Math.max(...d) : 0)]; });
def('ndims', a => [num(isT(a[0]) || isC(a[0]) ? a[0].dims.length : 2)]);
def('isempty', a => [num(+(isT(a[0]) || isC(a[0]) ? a[0].data.length === 0 : false), 'logical')]);
def('class', a => [str(isT(a[0]) ? a[0].cls : isC(a[0]) ? 'cell' : 'struct')]);
def('iscell', a => [num(+isC(a[0]), 'logical')]);
def('isstruct', a => [num(+(!isT(a[0]) && !isC(a[0])), 'logical')]);
const conv = (cls: Cls): Builtin => a => { const t = T_(a[0], cls); return [{ cls, dims: t.dims.slice(), data: t.data.map(v => sat(cls, v)) }]; };
def('double', conv('double')); def('uint8', conv('uint8')); def('logical', conv('logical'));
const map1 = (f: (x: number) => number): Builtin => a => { const t = T_(a[0], 'math'); const cls = t.cls === 'uint8' ? 'uint8' : 'double'; return [{ cls, dims: t.dims.slice(), data: t.data.map(v => sat(cls, f(v))) }]; };
def('abs', map1(Math.abs)); def('floor', map1(Math.floor)); def('ceil', map1(Math.ceil)); def('round', map1(x => Math.sign(x) * Math.round(Math.abs(x))));
def('fix', map1(Math.trunc)); def('sqrt', map1(Math.sqrt));
def('mod', a => { const x = T_(a[0], 'mod'), y = T_(a[1], 'mod'); return [ew(x, y, (p, q) => (q === 0 ? p : p - Math.floor(p / q) * q), x.cls === 'uint8' || y.cls === 'uint8' ? 'uint8' : 'double')]; });
function reduce(t: T, dim: number, f: (v: number[]) => number, cls: Cls): T {
  const d = t.dims.concat(new Array(Math.max(0, dim + 1 - t.dims.length)).fill(1)), len = d[dim];
  const inner = numel(d.slice(0, dim)), outer = numel(d.slice(dim + 1)), rd = d.slice(); rd[dim] = 1;
  const r = mk(cls, rd), buf = new Array(len);
  for (let o = 0; o < outer; o++) for (let i = 0; i < inner; i++) { for (let k = 0; k < len; k++) buf[k] = t.data[i + inner * (k + len * o)]; r.data[i + inner * o] = sat(cls, f(buf)); }
  return r;
}
const firstNonSingleton = (t: T) => { const k = t.dims.findIndex(d => d !== 1); return k < 0 ? 0 : k; };
def('sum', a => { const t = T_(a[0], 'sum'); return [reduce(t, a[1] ? scalarOf(a[1]) - 1 : firstNonSingleton(t), v => v.reduce((p, q) => p + q, 0), t.cls === 'uint8' ? 'double' : 'double')]; });
def('mean', a => { const t = T_(a[0], 'mean'); return [reduce(t, a[1] ? scalarOf(a[1]) - 1 : firstNonSingleton(t), v => v.reduce((p, q) => p + q, 0) / v.length, 'double')]; });
const minmax = (isMax: boolean): Builtin => a => {
  const t = T_(a[0], 'max'), pick = (x: number, y: number) => (isMax ? Math.max(x, y) : Math.min(x, y));
  if (a.length >= 2 && T_(a[1], 'max').data.length > 0) { const u = T_(a[1], 'max'); return [ew(t, u, pick, t.cls === 'uint8' || u.cls === 'uint8' ? 'uint8' : 'double')]; }
  const dim = a[2] ? scalarOf(a[2]) - 1 : firstNonSingleton(t);
  return [reduce(t, dim, v => v.reduce(pick), t.cls === 'logical' || t.cls === 'char' ? 'double' : t.cls)];
};
def('max', minmax(true)); def('min', minmax(false));

// ---------- text output ----------
function sprintf(fmt: string, args: V[]): string {
  const flat: (number | string)[] = [];
  for (const a of args) { const t = T_(a, 'sprintf'); if (t.cls === 'char') flat.push(toStr(t)); else t.data.forEach(v => flat.push(v)); }
  fmt = fmt.replace(/\\([ntr\\])/g, (_, c) => ({ n: '\n', t: '\t', r: '\r', '\\': '\\' } as any)[c]);
  let out = '', ai = 0, first = true;
  while (first || ai < flat.length) {
    first = false; let used = false;
    out += fmt.replace(/%([-+0 #]*)(\d+)?(?:\.(\d+))?([dgifsc%])/g, (_m, fl, w, pr, c) => {
      if (c === '%') return '%';
      if (ai >= flat.length) return ''; used = true; const v = flat[ai++]; let s: string;
      if (c === 's' || c === 'c') s = typeof v === 'number' ? String(v) : v;
      else if (typeof v === 'string') s = v;
      else if (c === 'd' || c === 'i') s = Number.isInteger(v) ? String(v) : String(+v.toPrecision(6));
      else if (c === 'f') s = v.toFixed(pr === undefined ? 6 : +pr);
      else s = String(+v.toPrecision(pr === undefined ? 6 : +pr));
      return w ? (fl.includes('-') ? s.padEnd(+w) : s.padStart(+w, fl.includes('0') ? '0' : ' ')) : s;
    });
    if (!used) break;
  }
  return out;
}
def('sprintf', a => [str(sprintf(toStr(a[0]), a.slice(1)))]);
def('fprintf', (a, _n, I) => { I.host.print(sprintf(toStr(a[0]), a.slice(1))); return []; });
def('num2str', a => { const t = T_(a[0], 'num2str'); if (t.cls === 'char') return [t]; return [str(t.data.length === 1 ? String(Number.isInteger(t.data[0]) ? t.data[0] : +t.data[0].toPrecision(5)) : Array.from(t.data).join('  '))]; });
def('disp', (a, _n, I) => {
  const v = a[0];
  if (isT(v) && v.cls === 'char') I.host.print(toStr(v) + '\n');
  else I.host.print(display('x', v, I.opts).replace(/^x =\n\n/, '').replace(/^x = /, '').replace(/\n\n$/, '\n'));
  return [];
});
def('clc', (_a, _n, I) => { I.host.clc?.(); return []; });
def('clear clearvars', (a, _n, I) => { if (!a.length || toStr(a[0]) === 'all') I.vars.clear(); else a.forEach(x => I.vars.delete(toStr(x))); return []; });
def('struct', a => {
  if (a.length % 2 !== 0) err('Error using struct: inputs must be field-name/value pairs.');
  const fields: [string, V][] = [];
  for (let i = 0; i < a.length; i += 2) {
    if (!isStr(a[i])) err('Error using struct: field names must be character vectors.');
    fields.push([toStr(a[i]), a[i + 1]]);
  }
  return [{ cls: 'struct', fields } as S];
});
def('cell', a => {
  const { dims } = dimsFrom(a, 'cell');
  return [{ cls: 'cell', dims, data: Array.from({ length: numel(dims) }, () => mk('double', [0, 0])) } as C];
});
def('who', (_a, _n, I) => { if (I.vars.size) I.host.print('Your variables are:\n\n' + [...I.vars.keys()].sort().join('  ') + '\n\n'); return []; });
def('whos', (_a, _n, I) => {
  if (!I.vars.size) return [];
  const rows = [...I.vars.entries()].sort().map(([k, v]) => isT(v) || isC(v) ? [k, dimStr(v.dims).replace(/×/g, 'x'), String(v.data.length * (isC(v) ? 8 : v.cls === 'double' ? 8 : v.cls === 'char' ? 2 : 1)), v.cls] : [k, '1x1', '-', 'struct']);
  const w = [4, 4, 5, 5].map((m, i) => Math.max(m, ...rows.map(r => r[i].length)));
  let s = `  ${'Name'.padEnd(w[0])}  ${'Size'.padEnd(w[1])}  ${'Bytes'.padStart(w[2])}  ${'Class'.padEnd(w[3])}  Attributes\n\n`;
  for (const r of rows) s += `  ${r[0].padEnd(w[0])}  ${r[1].padEnd(w[1])}  ${r[2].padStart(w[2])}  ${r[3].padEnd(w[3])}\n`;
  I.host.print(s + '\n'); return [];
});
def('help doc lookfor', (a, _n, I) => {
  const topic = a[0] && isStr(a[0]) ? toStr(a[0]).toLowerCase() : '';
  const descriptions: Record<string, string> = {
    imread: 'Read an image from the Current Folder: A = imread(filename).',
    imshow: 'Display an image in a figure: imshow(A).',
    imwrite: 'Write an image into the Current Folder: imwrite(A, filename).',
    histeq: 'Enhance grayscale contrast with histogram equalization: B = histeq(A) or B = histeq(A, levels).',
    switch: 'Select a matching case: switch value; case value; ...; otherwise; ...; end.',
    cell: 'Create a cell array with cell(m,n), or use a literal such as C = {1, "text"}.',
    struct: "Create a scalar structure with struct('field', value); read fields using s.field."
  };
  if (topic && descriptions[topic]) I.host.print(descriptions[topic] + '\n');
  else I.host.print('MLWeb help: supported educational MATLAB subset. Try imread, imshow, histeq, switch, cell, struct, size, or help command.\n');
  return [];
});
def('format hold close', () => []);
def('figure', (_a, _n, I) => { I.host.newFigure(); return []; });

// =====================================================================================
// Image toolbox
// =====================================================================================
const toTensor = (img: RawImage): T => {
  const { width: w, height: h, channels: c } = img, t = mk('uint8', c === 1 ? [h, w] : [h, w, c]);
  for (let i = 0; i < h; i++) for (let j = 0; j < w; j++) for (let k = 0; k < c; k++) t.data[i + h * j + h * w * k] = img.data[(i * w + j) * c + k];
  return t;
};
// -> row-major interleaved bytes (1 or 3 channels). `forShow` maps double [0,1] and logical to 8-bit.
function toBytes(t: T, map?: T): { width: number; height: number; channels: 1 | 3; data: Uint8Array } {
  const h = t.dims[0], w = t.dims[1], c = t.dims[2] ?? 1;
  if (t.dims.length > 3 || (c !== 1 && c !== 3)) err('Unsupported image: expected an M-by-N or M-by-N-by-3 array.');
  const to8 = (v: number) => (t.cls === 'uint8' ? v : t.cls === 'logical' ? v * 255 : Math.max(0, Math.min(255, Math.round(v * 255))));
  if (map && c === 1) { // indexed
    const out = new Uint8Array(h * w * 3), m = map.dims[0];
    for (let i = 0; i < h; i++) for (let j = 0; j < w; j++) { const ix = Math.min(m - 1, Math.max(0, t.data[i + h * j])); for (let k = 0; k < 3; k++) out[(i * w + j) * 3 + k] = Math.round(255 * Math.min(1, Math.max(0, map.data[ix + m * k]))); }
    return { width: w, height: h, channels: 3, data: out };
  }
  const out = new Uint8Array(h * w * c);
  for (let i = 0; i < h; i++) for (let j = 0; j < w; j++) for (let k = 0; k < c; k++) out[(i * w + j) * c + k] = to8(t.data[i + h * j + h * w * k]);
  return { width: w, height: h, channels: c as 1 | 3, data: out };
}
function show(tool: boolean): Builtin {
  return (a, _n, I) => {
    if (isStr(a[0])) { const im = readImg(I, toStr(a[0])); a = [toTensor(im), ...(im.colormap ? [mk('double', [im.colormap.length, 3], im.colormap.map(r => r[0]).concat(im.colormap.map(r => r[1]), im.colormap.map(r => r[2])))] : [])]; }
    const t = T_(a[0], 'imshow'), map = a[1] && isT(a[1]) && a[1].dims[1] === 3 ? a[1] : undefined;
    const b = toBytes(t, map), rgb = new Uint8Array(b.width * b.height * 3);
    for (let p = 0; p < b.width * b.height; p++) for (let k = 0; k < 3; k++) rgb[p * 3 + k] = b.data[p * b.channels + (b.channels === 3 ? k : 0)];
    I.host.showImage({ width: b.width, height: b.height, rgb }, { tool }); return [];
  };
}
def('imshow', show(false)); def('imtool', show(true));
function readImg(I: Interp, path: string): RawImage {
  let img = I.host.readImage(path);
  if (!img) { const base = path.split(/[\\/]/).pop()!; if (base !== path && (img = I.host.readImage(base))) I.host.warn?.(`Path '${path}' not found; using '${base}' from the current folder.`); }
  return img ?? err(`Error using imread: Unable to find file or directory '${path}'.`);
}
def('imread', (a, _n, I) => { const img = readImg(I, toStr(a[0])), t = toTensor(img); const out: V[] = [t]; if (img.colormap) out.push(mk('double', [img.colormap.length, 3], img.colormap.flatMap((_r, i, m) => [m[i][0]]).concat(img.colormap.map(r => r[1]), img.colormap.map(r => r[2])))); return out; });
def('imwrite', (a, _n, I) => { if (a.length < 2 || !isStr(a[a.length - 1])) err('Error using imwrite: Too few input arguments (expected imwrite(A, filename)).'); I.host.writeImage(toStr(a[a.length - 1]), toBytes(T_(a[0], 'imwrite'))); return []; });
def('imfinfo', (a, _n, I) => {
  const path = toStr(a[0]), img = readImg(I, path), png = /png/i.test(img.format);
  const f: [string, any][] = [['Filename', str(img.filename)], ['FileModDate', str(img.fileModDate ?? '')], ['FileSize', num(img.fileSize)], ['Format', str(img.format)],
    ['FormatVersion', str('')], ['Width', num(img.width)], ['Height', num(img.height)], ['BitDepth', num(img.bitDepth)], ['ColorType', str(img.colorType)]];
  if (png) f.push(['FormatSignature', mk('double', [1, 8], [137, 80, 78, 71, 13, 10, 26, 10])]);
  return [{ cls: 'struct', fields: f } as S];
});
const rgbInput = (v: V, fn: string): T => { const t = T_(v, fn); if (t.dims.length !== 3 || t.dims[2] !== 3) err(`Error using ${fn}: RGB input must be M-by-N-by-3.`); return t; };
const f64 = (t: T): Float64Array => (t.cls === 'uint8' ? t.data.map(v => v / 255) : t.data);
function perPixel(t: T, outCls: Cls, f: (r: number, g: number, b: number) => number[]): T {
  const n = t.dims[0] * t.dims[1], d = f64(t), o = mk(outCls, t.dims.slice());
  for (let p = 0; p < n; p++) { const r = f(d[p], d[p + n], d[p + 2 * n]); for (let k = 0; k < 3; k++) o.data[p + k * n] = sat(outCls, r[k]); }
  return o;
}
def('rgb2gray', a => {
  const t = T_(a[0], 'rgb2gray'); if (t.dims.length === 2) err('Error using rgb2gray: RGB input must be M-by-N-by-3.'); rgbInput(t, 'rgb2gray');
  const n = t.dims[0] * t.dims[1], cls: Cls = t.cls === 'uint8' ? 'uint8' : 'double', o = mk(cls, [t.dims[0], t.dims[1]]);
  for (let p = 0; p < n; p++) o.data[p] = sat(cls, 0.298936 * t.data[p] + 0.587043 * t.data[p + n] + 0.114021 * t.data[p + 2 * n]);
  return [o];
});
def('im2double', a => { const t = T_(a[0], 'im2double'); return [{ cls: 'double', dims: t.dims.slice(), data: f64(t) } as T]; });
def('rgb2hsv', a => [perPixel(rgbInput(a[0], 'rgb2hsv'), 'double', (r, g, b) => {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let h = 0;
  if (d > 0) h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, mx === 0 ? 0 : d / mx, mx];
})]);
def('rgb2ycbcr', a => { const t = rgbInput(a[0], 'rgb2ycbcr'), u = t.cls === 'uint8'; return [perPixel(t, u ? 'uint8' : 'double', (r, g, b) => {
  const y = 16 + 65.481 * r + 128.553 * g + 24.966 * b, cb = 128 - 37.797 * r - 74.203 * g + 112 * b, cr = 128 + 112 * r - 93.786 * g - 18.214 * b;
  return u ? [y, cb, cr] : [y / 255, cb / 255, cr / 255];
})]; });
def('rgb2ntsc', a => [perPixel(rgbInput(a[0], 'rgb2ntsc'), 'double', (r, g, b) => [0.299 * r + 0.587 * g + 0.114 * b, 0.596 * r - 0.274 * g - 0.322 * b, 0.211 * r - 0.523 * g + 0.312 * b])]);
def('imcrop', a => {
  const t = T_(a[0], 'imcrop'), r = T_(a[1], 'imcrop'); if (r.data.length !== 4) err('Error using imcrop: rect must be [xmin ymin width height] (interactive cropping is not available).');
  const [x, y, w, h] = Array.from(r.data), H = t.dims[0], W = t.dims[1];
  const c0 = Math.max(1, Math.round(x)), c1 = Math.min(W, Math.round(x + w)), r0 = Math.max(1, Math.round(y)), r1 = Math.min(H, Math.round(y + h));
  const rows = mk('double', [1, Math.max(0, r1 - r0 + 1)]), cols = mk('double', [1, Math.max(0, c1 - c0 + 1)]);
  rows.data.forEach((_, i) => (rows.data[i] = r0 + i)); cols.data.forEach((_, i) => (cols.data[i] = c0 + i));
  return [index(t, t.dims.length === 3 ? [rows, cols, 'colon'] : [rows, cols])];
});
def('imresize', (a, _n, I) => {
  const t = T_(a[0], 'imresize'), H = t.dims[0], W = t.dims[1], C = t.dims[2] ?? 1, s = T_(a[1], 'imresize');
  const nh = s.data.length === 1 ? Math.ceil(H * s.data[0]) : s.data[0], nw = s.data.length === 1 ? Math.ceil(W * s.data[0]) : s.data[1];
  let method = a[2] && isStr(a[2]) ? toStr(a[2]).toLowerCase() : 'bicubic';
  if (method === 'bicubic') { I.host.warn?.("imresize: 'bicubic' is not implemented yet; using 'bilinear'."); method = 'bilinear'; }
  if (method !== 'nearest' && method !== 'bilinear') err(`Error using imresize: unsupported method '${method}'.`);
  const o = mk(t.cls, t.dims.length === 3 ? [nh, nw, C] : [nh, nw]);
  for (let k = 0; k < C; k++) for (let i = 0; i < nh; i++) for (let j = 0; j < nw; j++) {
    const sy = (i + 0.5) * H / nh - 0.5, sx = (j + 0.5) * W / nw - 0.5; let v: number;
    const at = (r: number, c: number) => t.data[Math.min(H - 1, Math.max(0, r)) + H * Math.min(W - 1, Math.max(0, c)) + H * W * k];
    if (method === 'nearest') v = at(Math.floor(sy + 0.5), Math.floor(sx + 0.5));
    else { const y0 = Math.floor(sy), x0 = Math.floor(sx), fy = sy - y0, fx = sx - x0; v = (1 - fy) * ((1 - fx) * at(y0, x0) + fx * at(y0, x0 + 1)) + fy * ((1 - fx) * at(y0 + 1, x0) + fx * at(y0 + 1, x0 + 1)); }
    o.data[i + nh * j + nh * nw * k] = sat(t.cls, v);
  }
  return [o];
});
def('imrotate', a => {
  const t = T_(a[0], 'imrotate'), ang = ((scalarOf(a[1]) % 360) + 360) % 360, H = t.dims[0], W = t.dims[1], C = t.dims[2] ?? 1;
  if (ang % 90 !== 0) err('imrotate currently supports multiples of 90 degrees only.');
  const q = ang / 90, nh = q % 2 ? W : H, nw = q % 2 ? H : W, o = mk(t.cls, t.dims.length === 3 ? [nh, nw, C] : [nh, nw]);
  for (let k = 0; k < C; k++) for (let i = 0; i < H; i++) for (let j = 0; j < W; j++) {
    const [ni, nj] = q === 0 ? [i, j] : q === 1 ? [W - 1 - j, i] : q === 2 ? [H - 1 - i, W - 1 - j] : [j, H - 1 - i];
    o.data[ni + nh * nj + nh * nw * k] = t.data[i + H * j + H * W * k];
  }
  return [o];
});
def('imhist', (a, n) => {
  const t = T_(a[0], 'imhist'); if (n === 0) err('imhist: plotting is not available yet; call counts = imhist(I) to get the histogram.');
  const bins = t.cls === 'logical' ? 2 : 256, o = mk('double', [bins, 1]);
  for (const v of t.data) o.data[t.cls === 'double' ? Math.min(255, Math.max(0, Math.round(v * 255))) : v]++;
  return [o];
});
def('histeq', (a, nargout) => {
  const image = T_(a[0], 'histeq');
  if (image.dims.length !== 2) err('Error using histeq: input must be a two-dimensional grayscale image.');
  if (image.cls === 'double' && image.data.some(v => v < 0 || v > 1)) err('Error using histeq: double input values must be in the range [0, 1].');
  const inputBins = image.cls === 'logical' ? 2 : 256;
  const requested = a[1] ? T_(a[1], 'histeq') : null;
  let target: number[];
  if (requested && requested.data.length > 1) {
    if (requested.data.some(v => v < 0)) err('Error using histeq: histogram values must be nonnegative.');
    target = Array.from(requested.data);
  } else {
    const levels = requested ? scalarOf(requested, 'number of levels') : 64;
    if (!Number.isInteger(levels) || levels < 2 || levels > 65536) err('Error using histeq: number of levels must be an integer between 2 and 65536.');
    target = Array.from({ length: levels }, () => 1);
  }
  const hist = new Array(inputBins).fill(0);
  for (const value of image.data) {
    const bin = image.cls === 'uint8' || image.cls === 'logical' ? Math.round(value) : Math.min(inputBins - 1, Math.floor(value * inputBins));
    hist[bin]++;
  }
  const targetSum = target.reduce((sum, v) => sum + v, 0);
  if (targetSum <= 0) err('Error using histeq: target histogram must contain a positive value.');
  const targetCdf: number[] = [];
  let cumulative = 0;
  for (const count of target) { cumulative += count / targetSum; targetCdf.push(cumulative); }
  const total = image.data.length;
  const sourceCdf: number[] = [];
  cumulative = 0;
  for (const count of hist) { cumulative += count / (total || 1); sourceCdf.push(cumulative); }
  const first = sourceCdf.find(x => x > 0) ?? 0;
  const lut = new Float64Array(inputBins);
  for (let i = 0; i < inputBins; i++) {
    const cdf = total ? (sourceCdf[i] - first) / Math.max(Number.EPSILON, 1 - first) : 0;
    let j = 0;
    while (j < targetCdf.length - 1 && targetCdf[j] < cdf) j++;
    const normalized = image.cls === 'uint8' || image.cls === 'logical' ? j / Math.max(1, target.length - 1) : j / Math.max(1, target.length - 1);
    lut[i] = image.cls === 'uint8' ? Math.round(normalized * 255) : image.cls === 'logical' ? +(normalized >= 0.5) : normalized;
  }
  const out = mk(image.cls, image.dims.slice());
  for (let i = 0; i < image.data.length; i++) {
    const value = image.data[i], bin = image.cls === 'uint8' || image.cls === 'logical' ? Math.round(value) : Math.min(inputBins - 1, Math.floor(value * inputBins));
    out.data[i] = lut[bin];
  }
  const transform = mk(image.cls, [inputBins, 1], lut);
  return nargout > 1 ? [out, transform] : [out];
});

// ---------- core extras (constants, math, reductions, array helpers, image arithmetic) ----------
const constFn = (v: number, cls: Cls = 'double'): Builtin => a => { if (!a.length) return [num(v, cls)]; const { dims } = dimsFrom(a, 'const'); const t = mk(cls, dims); t.data.fill(v); return [t]; };
def('true', constFn(1, 'logical')); def('false', constFn(0, 'logical')); def('pi', constFn(Math.PI));
def('Inf inf', constFn(Infinity)); def('NaN nan', constFn(NaN)); def('eps', constFn(2.220446049250313e-16));
const dbl = (f: (x: number) => number): Builtin => a => { const t = T_(a[0], 'math'); return [{ cls: 'double', dims: t.dims.slice(), data: t.data.map(f) }]; };
def('exp', dbl(Math.exp)); def('log', dbl(Math.log)); def('log2', dbl(Math.log2)); def('log10', dbl(Math.log10));
def('sin', dbl(Math.sin)); def('cos', dbl(Math.cos)); def('tan', dbl(Math.tan)); def('sign', dbl(Math.sign));
def('rem', a => { const x = T_(a[0], 'rem'), y = T_(a[1], 'rem'); return [ew(x, y, (p, q) => (q === 0 ? NaN : p % q), x.cls === 'uint8' || y.cls === 'uint8' ? 'uint8' : 'double')]; });
const redDim = (t: T, a: V[]) => (a[1] ? scalarOf(a[1]) - 1 : firstNonSingleton(t));
def('any', a => { const t = T_(a[0], 'any'); return [reduce(t, redDim(t, a), v => +v.some(x => x !== 0), 'logical')]; });
def('all', a => { const t = T_(a[0], 'all'); return [reduce(t, redDim(t, a), v => +v.every(x => x !== 0), 'logical')]; });
def('prod', a => { const t = T_(a[0], 'prod'); return [reduce(t, redDim(t, a), v => v.reduce((p, q) => p * q, 1), 'double')]; });
def('cumsum', a => {
  const t = T_(a[0], 'cumsum'), dim = redDim(t, a), d = t.dims.concat(new Array(Math.max(0, dim + 1 - t.dims.length)).fill(1)), len = d[dim], inner = numel(d.slice(0, dim)), outer = numel(d.slice(dim + 1));
  const r = mk('double', t.dims.slice());
  for (let o = 0; o < outer; o++) for (let i = 0; i < inner; i++) { let s = 0; for (let k = 0; k < len; k++) { const p = i + inner * (k + len * o); s += t.data[p]; r.data[p] = s; } }
  return [r];
});
def('find', a => {
  const t = T_(a[0], 'find'), idx: number[] = []; const lim = a[1] ? scalarOf(a[1]) : Infinity;
  for (let i = 0; i < t.data.length && idx.length < lim; i++) if (t.data[i] !== 0) idx.push(i + 1);
  return [mk('double', t.dims.length === 2 && t.dims[0] === 1 && t.dims[1] !== 1 ? [1, idx.length] : [idx.length, idx.length ? 1 : 0], idx)];
});
def('sort', a => {
  const t = T_(a[0], 'sort'); if (t.dims.length > 2 || (t.dims[0] !== 1 && t.dims[1] !== 1)) err('Error using sort: only vectors are supported.');
  const desc = a.some(x => isStr(x) && /^desc/i.test(toStr(x))), ord = Array.from(t.data.keys()).sort((i, j) => (desc ? t.data[j] - t.data[i] : t.data[i] - t.data[j]) || i - j);
  return [mk(t.cls, t.dims.slice(), ord.map(i => t.data[i])), mk('double', t.dims.slice(), ord.map(i => i + 1))];
});
def('linspace', a => { const lo = scalarOf(a[0]), hi = scalarOf(a[1]), n = a[2] ? scalarOf(a[2]) : 100; return [mk('double', [1, n], Array.from({ length: n }, (_, i) => (n === 1 ? hi : lo + ((hi - lo) * i) / (n - 1))))]; });
def('reshape', a => {
  const t = T_(a[0], 'reshape'); let dims = a.length === 2 ? Array.from(T_(a[1], 'reshape').data) : a.slice(1).map(x => (T_(x, 'reshape').data.length ? scalarOf(x) : -1));
  const unk = dims.indexOf(-1); if (unk >= 0) { const rest = dims.filter(x => x !== -1).reduce((p, q) => p * q, 1); dims[unk] = rest ? t.data.length / rest : 0; }
  if (numel(dims) !== t.data.length) err('Error using reshape: Number of elements must not change. Use [] as one of the size inputs to automatically calculate the appropriate size for that dimension.');
  return [mk(t.cls, dims, t.data)];
});
def('repmat', a => {
  const t = T_(a[0], 'repmat'), reps = a.length === 2 ? Array.from(T_(a[1], 'repmat').data) : a.slice(1).map(x => scalarOf(x)); if (reps.length === 1) reps.push(reps[0]);
  if (t.dims.length > 2 || reps.length > 2) err('Error using repmat: only 2-D arrays are supported.');
  const [r, c] = t.dims, R = r * reps[0], C = c * reps[1], o = mk(t.cls, [R, C]);
  for (let j = 0; j < C; j++) for (let i = 0; i < R; i++) o.data[i + R * j] = t.data[(i % r) + r * (j % c)];
  return [o];
});
const flip = (dim: number): Builtin => a => {
  const t = T_(a[0], 'flip'), [r, c] = t.dims, pages = numel(t.dims.slice(2)), o = mk(t.cls, t.dims.slice());
  for (let p = 0; p < pages; p++) for (let j = 0; j < c; j++) for (let i = 0; i < r; i++) o.data[i + r * (j + c * p)] = t.data[(dim === 0 ? r - 1 - i : i) + r * ((dim === 1 ? c - 1 - j : j) + c * p)];
  return [o];
};
def('flipud', flip(0)); def('fliplr', flip(1));
def('isnumeric', a => [num(+(isT(a[0]) && (a[0].cls === 'double' || a[0].cls === 'uint8')), 'logical')]);
def('ischar', a => [num(+(isT(a[0]) && a[0].cls === 'char'), 'logical')]);
def('strcmp', a => [num(+(isStr(a[0]) && isStr(a[1]) && toStr(a[0]) === toStr(a[1])), 'logical')]);
def('char', a => { const t = T_(a[0], 'char'); return [{ cls: 'char', dims: t.dims.slice(), data: t.data.slice() }]; });
def('error', (a, _n, I) => { const m = a.length > 1 ? toStr(BUILTINS.sprintf(a, 1, I)[0]) : toStr(a[0]); return err(m); });
let ticAt = 0; def('tic', () => { ticAt = performance.now(); return []; });
def('toc', (_a, n, I) => { const s = (performance.now() - ticAt) / 1000; if (n > 0) return [num(s)]; I.host.print(`Elapsed time is ${s.toFixed(6)} seconds.\n`); return []; });
let seed = 123456789; const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
def('rand', a => { const { dims } = dimsFrom(a, 'rand'); const t = mk('double', dims); for (let i = 0; i < t.data.length; i++) t.data[i] = rnd(); return [t]; });
def('randi', a => { const m = T_(a[0], 'randi'), hi = m.data[m.data.length - 1], lo = m.data.length > 1 ? m.data[0] : 1; const { dims } = dimsFrom(a.slice(1), 'randi'); const t = mk('double', dims); for (let i = 0; i < t.data.length; i++) t.data[i] = lo + Math.floor(rnd() * (hi - lo + 1)); return [t]; });
// image arithmetic (saturating, class-aware) and conversions
const imArith = (f: (x: number, y: number) => number, fn: string): Builtin => a => { const x = T_(a[0], fn), y = T_(a[1], fn); return [ew(x, y, f, x.cls === 'uint8' || y.cls === 'uint8' ? 'uint8' : 'double')]; };
def('imadd', imArith((p, q) => p + q, 'imadd')); def('imsubtract', imArith((p, q) => p - q, 'imsubtract')); def('imabsdiff', imArith((p, q) => Math.abs(p - q), 'imabsdiff'));
def('im2uint8', a => { const t = T_(a[0], 'im2uint8'); return [{ cls: 'uint8', dims: t.dims.slice(), data: t.data.map(v => (t.cls === 'uint8' ? v : t.cls === 'logical' ? v * 255 : sat('uint8', v * 255))) }]; });
def('imcomplement', a => { const t = T_(a[0], 'imcomplement'); return [{ cls: t.cls, dims: t.dims.slice(), data: t.data.map(v => (t.cls === 'uint8' ? 255 - v : t.cls === 'logical' ? 1 - v : 1 - v)) }]; });
def('mat2gray', a => { const t = T_(a[0], 'mat2gray'); let lo = Infinity, hi = -Infinity; for (const v of t.data) { if (v < lo) lo = v; if (v > hi) hi = v; } const d = hi - lo; return [{ cls: 'double', dims: t.dims.slice(), data: t.data.map(v => (d === 0 ? (v > 0 ? 1 : 0) : (v - lo) / d)) }]; });
def('im2gray', (a, n, I) => { const t = T_(a[0], 'im2gray'); return t.dims.length === 3 ? BUILTINS.rgb2gray(a, n, I) : [t]; });

def('im2bw', (a, n, I) => { let t = T_(a[0], 'im2bw'); if (t.dims.length === 3) t = BUILTINS.rgb2gray([t], 1, I)[0] as T; const lv = a[1] ? T_(a[1], 'im2bw').data[0] : 0.5, th = t.cls === 'uint8' ? lv * 255 : lv; const o = mk('logical', t.dims.slice()); for (let i = 0; i < t.data.length; i++) o.data[i] = t.data[i] > th ? 1 : 0; return [o]; });
