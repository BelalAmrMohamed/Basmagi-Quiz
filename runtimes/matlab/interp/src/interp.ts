import { parse, MatlabError } from './parser';
import { registerMath } from './lib-math';
import { registerArray } from './lib-array';
import { registerString } from './lib-string';
import { registerIpt } from './lib-ipt';
import { registerPlot, addImage, drawBars, type ImageSource } from './lib-plot';
import { Figures, type FigureSpec } from './figures';
import { T, V, S, C, FuncHandle, Idx, Cls, isT, isC, isS, isF, mkStruct, mk, num, str, toStr, isStr, scalarOf, numel, sat, ew, binop, transpose, index, assign, cat, display, dimStr, PrintOpts, idxList, effDims, outCls, numCls, fltCls, isIntCls, INT_RANGE, CLASS_NAMES, CLASS_BYTES, toUnit, fromUnit } from './values';
import { ScalarEval, isScalarExpr } from './scalar';
import { BufferOwners } from './cow';

// ---------- host interface (browser UI and Node tests each implement this) ----------
export interface RawImage { width: number; height: number; channels: 1 | 3; data: Uint8Array; /* row-major, interleaved */
  colormap?: number[][]; bitDepth: number; format: string; fileSize: number; fileModDate?: string; colorType: string; filename: string }
export interface Host {
  print(s: string): void;
  warn?(s: string): void;
  readImage(path: string): RawImage | null;
  writeImage(path: string, img: { width: number; height: number; channels: 1 | 3; data: Uint8Array }): void;
  /** `fig` is the figure number (imshow) or the current one (imtool). Optional: older hosts count `newFigure` calls instead. */
  showImage(img: { width: number; height: number; rgb: Uint8Array }, opts: { tool: boolean; name?: string; fig?: number }): void;
  newFigure(): void;
  /** A figure that is more than one plain image. Posting the same `id` again replaces the previous post. */
  figure?(id: number, spec: FigureSpec): void;
  beep?(): void;
  tick?(info: { line: number; loops: { iter: number; total: number }[]; elapsedMs: number }): void;
  clc?(): void;
  maxPrintElements?: number;
}

type Scope = Map<string, V>;
type Builtin = (a: V[], nargout: number, I: Interp) => V[];
const BRK = 1, CNT = 2, RET = 3;
const err = (m: string, id?: string): never => {
  const e = new MatlabError(m);
  if (id) (e as any).identifier = id;
  throw e;
};
const T_ = (v: V, fn: string): T => isT(v) ? v : err(`Error using ${fn}: Invalid argument (struct/cell/handle not allowed here).`);

export class Interp {
  vars: Scope = new Map();
  funcs = new Map<string, any>();
  curScope: Scope = this.vars;
  fnStack: { name: string; nargin: number; nargout: number; f: any }[] = [];
  private endStack: { t: { dims: number[]; data: { length: number } }; pos: number; n: number }[] = [];
  private depth = 0;
  private readonly scalar = new ScalarEval();
  /** Allocation-free scalar evaluation and direct element access. Tests switch it off to compare against the general path. */
  scalarFastPath = true;
  /** Source line of the statement being run (1-based, 0 before the first). Reported by `host.tick`. */
  curLine = 0;
  runStartMs = 0;
  /** Loops being run, outermost first. `total` is Infinity when unknown (`while`, `1:Inf`, a NaN bound). */
  private loops: { iter: number; total: number }[] = [];
  private backEdges = 0;
  private lastTickMs = 0;
  /** The clock is looked at every `tickMask + 1` loop iterations (a power of two) and `host.tick` is called at most every `tickIntervalMs`. */
  tickMask = 4095;
  tickIntervalMs = 100;
  clock: () => number = () => performance.now();
  /** Which array buffers are shared (copy-on-write). */
  readonly buffers = new BufferOwners();
  /** Argument expressions (AST) of the builtin call in progress, so builtins like imtool can read the variable name. */
  curArgs: any[] | undefined;
  /** Figures of the current run (reset at the start of every run). */
  figs = new Figures();
  constructor(public host: Host) {}
  /** Post changed figures to the host: plain images as `showImage`, everything else as `figure`. `force` ignores the 100 ms throttle. */
  flushFigures(force = false) {
    this.figs.flush({
      image: (id, it) => this.host.showImage({ width: it.w, height: it.h, rgb: it.rgb }, { tool: false, name: it.name, fig: id }),
      plot: (id, spec) => this.host.figure?.(id, spec),
    }, force);
  }
  get opts(): PrintOpts { return { maxElements: this.host.maxPrintElements ?? 3000, width: 80 }; }

  run(src: string) {
    const ast = parse(src);
    for (const s of ast) if (s.k === 'func') this.funcs.set(s.name, s);
    this.curScope = this.vars;
    this.figs.reset();
    this.loops.length = 0; this.backEdges = 0; this.curLine = 0;
    this.runStartMs = this.lastTickMs = this.clock();
    try { this.exec(ast.filter(s => s.k !== 'func'), this.vars); }
    finally { this.flushFigures(true); }
  }
  private store(sc: Scope, name: string, v: V) {
    if (isT(v)) this.buffers.hold(v.data); // shared, not copied
    else if (isC(v)) { const c = v; v = { cls: 'cell', dims: c.dims.slice(), data: c.data.map(x => this.cloneValue(x)) }; }
    else if (isS(v)) { const s = v; v = { cls: 'struct', dims: s.dims.slice(), keys: s.keys.slice(), data: s.data.map(rec => { const r: Record<string, V> = {}; for (const k of s.keys) r[k] = this.cloneValue(rec[k]); return r; }) }; }
    sc.set(name, v);
  }
  private cloneValue(v: V): V {
    if (isT(v)) { const data = v.data.slice(); this.buffers.hold(data); return { cls: v.cls, dims: v.dims.slice(), data }; }
    if (isC(v)) return { cls: 'cell', dims: v.dims.slice(), data: v.data.map(x => this.cloneValue(x)) };
    if (isS(v)) { const s = v; return { cls: 'struct', dims: s.dims.slice(), keys: s.keys.slice(), data: s.data.map(rec => { const r: Record<string, V> = {}; for (const k of s.keys) r[k] = this.cloneValue(rec[k]); return r; }) }; }
    return v;
  }
  private show(name: string, v: V) { this.host.print(display(name, v, this.opts)); }

  // ---------- statements ----------
  exec(stmts: any[], sc: Scope): number {
    for (const s of stmts) {
      this.curLine = s.line;
      switch (s.k) {
        case 'expr': {
          const e = s.e;
          if (e.k === 'id' && sc.has(e.n)) { if (s.show) this.show(e.n, sc.get(e.n)!); break; }
          const r = this.evalMulti(e, sc, 0);
          if (r.length) {
            if (e.k === 'field' && r.length > 1) {
              for (const item of r) { this.store(sc, 'ans', item); if (s.show) this.show('ans', sc.get('ans')!); }
            } else {
              this.store(sc, 'ans', r[0]); if (s.show) this.show('ans', sc.get('ans')!);
            }
          }
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
        case 'try': {
          const nLoops = this.loops.length;
          try {
            const r = this.exec(s.body, sc);
            if (r) return r;
          } catch (e: any) {
            if (!(e instanceof MatlabError)) throw e;
            this.loops.length = nLoops; // loops left by the error
            const me: S = {
              cls: 'struct', dims: [1, 1], keys: ['message', 'identifier'],
              data: [{ message: str(e.message), identifier: str((e as any).identifier ?? 'MLWeb:Error') }],
            };
            if (s.catchVar) this.store(sc, s.catchVar, me);
            const r = this.exec(s.catchBody ?? [], sc);
            if (r) return r;
          }
          break;
        }
        case 'assign': {
          const rs = s.lhs.length === 1 ? [this.evalMulti(s.rhs, sc, 1)[0]] : this.evalMulti(s.rhs, sc, s.lhs.length);
          const rootName = (lv: any): string => { let cur = lv; while (cur && cur.k !== 'id') cur = cur.a ?? cur; return cur?.n ?? 'ans'; };
          s.lhs.forEach((lv: any, i: number) => {
            if (!lv) return;
            const val = rs[i]; if (val === undefined) err(s.lhs.length === 1 ? 'Value must be assigned: the expression returned no value.' : 'Too many output arguments.');
            this.assignTo(sc, lv, val);
            if (s.show) { const rn = rootName(lv); if (sc.has(rn)) this.show(rn, sc.get(rn)!); }
          });
          break;
        }
        case 'if': {
          let done = false;
          for (const c of s.clauses) if (this.cond(c.c, sc)) { const r = this.exec(c.body, sc); if (r) return r; done = true; break; }
          if (!done && s.els) { const r = this.exec(s.els, sc); if (r) return r; }
          break;
        }
        case 'for': {
          let head = s.e; while (head.k === 'paren') head = head.a;
          if (head.k === 'range') {
            // The values are produced one at a time, so the range is never built as an array.
            const { first, step, count } = this.rangeBounds(head, sc);
            const mark = this.loops.length, loop = { iter: 0, total: Number.isFinite(count) ? count : Infinity };
            this.loops.push(loop);
            let res = 0;
            for (let j = 0; j < count; j++) {
              loop.iter = j + 1;
              if (!(++this.backEdges & this.tickMask)) this.maybeTick(s.line);
              sc.set(s.v, num(first + j * step));
              const r = this.exec(s.body, sc); if (r === BRK) break; if (r === RET) { res = r; break; }
            }
            this.loops.length = mark;
            if (res) return res;
            break;
          }
          const rng = this.eval(s.e, sc) as T, rows = rng.dims[0], cols = rng.data.length / (rows || 1);
          if (isT(rng)) this.buffers.hold(rng.data); // the loop keeps iterating the original if the body writes the variable
          const mark = this.loops.length, loop = { iter: 0, total: rng.data.length ? cols : 0 };
          this.loops.push(loop);
          let res = 0;
          for (let j = 0; j < (rng.data.length ? cols : 0); j++) {
            loop.iter = j + 1;
            if (!(++this.backEdges & this.tickMask)) this.maybeTick(s.line);
            this.store(sc, s.v, rows === 1 ? num(rng.data[j], rng.cls) : mk(rng.cls, [rows, 1], rng.data.subarray(j * rows, (j + 1) * rows)));
            const r = this.exec(s.body, sc); if (r === BRK) break; if (r === RET) { res = r; break; }
          }
          this.loops.length = mark;
          if (res) return res;
          break;
        }
        case 'while': {
          let guard = 0, res = 0;
          const mark = this.loops.length, loop = { iter: 0, total: Infinity };
          this.loops.push(loop);
          while (this.cond(s.c, sc)) {
            if (++guard > 5e6) err('Loop iteration limit (5,000,000) exceeded.');
            loop.iter = guard;
            if (!(++this.backEdges & this.tickMask)) this.maybeTick(s.line);
            const r = this.exec(s.body, sc); if (r === BRK) break; if (r === RET) { res = r; break; }
          }
          this.loops.length = mark;
          if (res) return res;
          break;
        }
        case 'break': return BRK;
        case 'continue': return CNT;
        case 'return': return RET;
      }
    }
    return 0;
  }
  /** Reports progress to `host.tick` unless one went out less than `tickIntervalMs` ago. Called at loop back-edges and by `pause`. */
  maybeTick(line = this.curLine) {
    const tick = this.host.tick;
    if (!tick) return;
    const now = this.clock();
    if (now - this.lastTickMs < this.tickIntervalMs) return;
    this.lastTickMs = now;
    this.curLine = line; // a loop reports its own line, not the last line of its body
    tick.call(this.host, { line: this.curLine, loops: this.loops.map(l => ({ iter: l.iter, total: l.total })), elapsedMs: now - this.runStartMs });
  }
  /** First value, step and length of `a:b` or `a:step:b`. The length is NaN (no elements) when a bound is NaN. */
  private rangeBounds(e: any, sc: Scope): { first: number; step: number; count: number } {
    const first = scalarOf(this.eval(e.a, sc)), step = e.step ? scalarOf(this.eval(e.step, sc)) : 1, last = scalarOf(this.eval(e.b, sc));
    const count = step === 0 || (step > 0 && first > last) || (step < 0 && first < last) ? 0 : Math.floor((last - first) / step + 1e-10) + 1;
    return { first, step, count };
  }
  private truthy(v: V): boolean { const t = T_(v, 'if'); return t.data.length > 0 && t.data.every(x => x !== 0); }
  /** Truth value of a condition; scalar conditions are decided without building a value. */
  private cond(e: any, sc: Scope): boolean {
    const x = this.tryScalar(e, sc);
    return x !== undefined ? x !== 0 : this.truthy(this.eval(e, sc));
  }
  /** Value of a scalar expression (its class is then `this.scalar.cls`), or undefined when the general path is needed. */
  private tryScalar(e: any, sc: Scope): number | undefined {
    if (!this.scalarFastPath || !isScalarExpr(e)) return undefined;
    const end = this.endStack.length ? this.endStack[this.endStack.length - 1] : undefined;
    return this.scalar.run(e, sc, end?.t, end?.pos, end?.n);
  }

  private sameCase(a: V, b: V): boolean {
    if (isT(a) && isT(b)) return a.cls === b.cls && a.dims.join(',') === b.dims.join(',') && a.data.length === b.data.length && a.data.every((x, i) => x === b.data[i]);
    if (isC(a) && isC(b)) return a.dims.join(',') === b.dims.join(',') && a.data.length === b.data.length && a.data.every((x, i) => this.sameCase(x, b.data[i]));
    if (isS(a) && isS(b)) return a.dims.join(',') === b.dims.join(',') && a.keys.length === b.keys.length && a.keys.every((k, i) => k === b.keys[i]) && a.data.every((rec, idx) => a.keys.every(k => this.sameCase(rec[k], b.data[idx][k])));
    if (isF(a) && isF(b)) return a.name === b.name && !a.params && !b.params;
    return false;
  }
  private structPositions(s: S, args: any[], sc: Scope, grow: boolean): { positions: number[]; dims: number[] } {
    const ix = this.evalArgs(args, s, sc);
    let dims = s.dims.slice();
    if (ix.length === 1) {
      const x = ix[0];
      if (x === 'colon') return { positions: s.data.map((_v, i) => i), dims: [s.data.length, 1] };
      if (x.cls === 'logical' && !grow && x.data.length !== s.data.length) err('Logical index must contain the same number of elements as the struct array.');
      const positions = x.cls === 'logical' ? Array.from(x.data, (v, i) => (v ? i : -1)).filter(i => i >= 0) : Array.from(x.data, v => v - 1);
      if (positions.some(i => !Number.isInteger(i) || i < 0)) err('Array indices must be positive integers or logical values.');
      if (!grow && positions.some(i => i >= s.data.length)) err('Index exceeds the number of array elements.');
      if (grow) {
        const mx = positions.reduce((m, i) => Math.max(m, i + 1), s.data.length);
        if (mx > s.data.length) {
          if (!(dims.length === 2 && (dims[0] <= 1 || dims[1] === 1))) err('Attempt to grow array along ambiguous dimension.');
          dims = dims[1] === 1 && dims[0] > 1 ? [mx, 1] : [1, mx];
        }
        return { positions, dims };
      }
      const srcVec = dims.length === 2 && (dims[0] === 1 || dims[1] === 1);
      const idxVec = x.dims.length === 2 && (x.dims[0] === 1 || x.dims[1] === 1);
      let resultDims = x.cls === 'logical' ? [positions.length, 1] : x.dims.slice();
      if (srcVec && idxVec && x.cls !== 'logical') resultDims = dims[0] === 1 ? [1, positions.length] : [positions.length, 1];
      return { positions, dims: resultDims };
    }
    let ed = effDims(dims, ix.length);
    const lists = ix.map((x, d) => {
      if (x === 'colon') return Array.from({ length: Math.max(ed[d], grow ? 1 : 0) }, (_v, i) => i);
      const l = idxList(x, ed[d], d + 1, ix.length)!;
      if (!grow && l.some(v => v >= ed[d])) err(`Index in position ${d + 1} exceeds array bounds.`);
      return l;
    });
    if (grow) {
      const nd = ed.map((d, i) => Math.max(d, lists[i].reduce((m, v) => Math.max(m, v + 1), 0)));
      const strides = [1]; for (let d = 1; d < ix.length; d++) strides.push(strides[d - 1] * nd[d - 1]);
      const rd = lists.map(l => l.length), sub = new Array(ix.length).fill(0), positions: number[] = [];
      const cnt = numel(rd);
      for (let o = 0; o < cnt; o++) {
        let p = 0; for (let d = 0; d < ix.length; d++) p += lists[d][sub[d]] * strides[d];
        positions.push(p);
        for (let d = 0; d < ix.length; d++) { if (++sub[d] < rd[d]) break; sub[d] = 0; }
      }
      let dd = nd; while (dd.length > 2 && dd[dd.length - 1] === 1) dd = dd.slice(0, -1);
      return { positions, dims: dd };
    }
    const strides = [1]; for (let d = 1; d < ix.length; d++) strides.push(strides[d - 1] * ed[d - 1]);
    const rd = lists.map(l => l.length), sub = new Array(ix.length).fill(0), positions: number[] = [];
    const cnt = numel(rd);
    for (let o = 0; o < cnt; o++) {
      let p = 0; for (let d = 0; d < ix.length; d++) p += lists[d][sub[d]] * strides[d];
      positions.push(p);
      for (let d = 0; d < ix.length; d++) { if (++sub[d] < rd[d]) break; sub[d] = 0; }
    }
    return { positions, dims: rd };
  }
  private growStruct(s: S, newDims: number[], newKey?: string): S {
    const keys = s.keys.slice();
    if (newKey && !keys.includes(newKey)) keys.push(newKey);
    const oldN = s.data.length, newN = numel(newDims);
    const makeEmpty = () => { const rec: Record<string, V> = {}; for (const k of keys) rec[k] = mk('double', [0, 0]); return rec; };
    const outData: Record<string, V>[] = Array.from({ length: newN }, makeEmpty);
    if (oldN > 0) {
      if (s.dims.length === 2 && newDims.length === 2 && (s.dims[0] <= 1 || s.dims[1] === 1) && (newDims[0] <= 1 || newDims[1] === 1) && s.dims[0] === newDims[0] || s.dims[1] === newDims[1]) {
        for (let i = 0; i < oldN; i++) {
          const rec = outData[i];
          for (const k of s.keys) rec[k] = this.cloneValue(s.data[i][k]);
        }
      } else {
        const k = Math.max(s.dims.length, newDims.length);
        const od = s.dims.concat(new Array(k - s.dims.length).fill(1));
        const nd = newDims.concat(new Array(k - newDims.length).fill(1));
        const sub = new Array(k).fill(0);
        for (let o = 0; o < oldN; o++) {
          let p = 0, m = 1; for (let d = 0; d < k; d++) { p += sub[d] * m; m *= nd[d]; }
          for (const key of s.keys) outData[p][key] = this.cloneValue(s.data[o][key]);
          for (let d = 0; d < k; d++) { if (++sub[d] < od[d]) break; sub[d] = 0; }
        }
      }
    }
    return { cls: 'struct', dims: newDims.slice(), keys, data: outData };
  }
  private assignTo(sc: Scope, lv: any, val: V) {
    if (lv.k === 'id') return this.store(sc, lv.n, val);
    // Fast path for direct numeric indexed assignment a(i,j,...) = x
    if (lv.k === 'idx') {
      const cur = sc.get(lv.n);
      if (cur !== undefined && isS(cur)) {
        if (!isS(val)) return err('Conversion to struct from non-struct is not possible.');
        const rhsS = val;
        const { positions, dims } = this.structPositions(cur, lv.args, sc, true);
        if (rhsS.data.length !== 1 && rhsS.data.length !== positions.length) err('Unable to perform assignment because the number of elements differs.');
        const next = this.growStruct(cur, dims);
        for (const k of rhsS.keys) if (!next.keys.includes(k)) { next.keys.push(k); for (const r of next.data) r[k] = mk('double', [0, 0]); }
        positions.forEach((p, idx) => {
          const src = rhsS.data[rhsS.data.length === 1 ? 0 : idx];
          for (const k of next.keys) next.data[p][k] = k in src ? this.cloneValue(src[k]) : mk('double', [0, 0]);
        });
        this.store(sc, lv.n, next);
        return;
      }
      if (cur !== undefined && isC(cur)) {
        if (!isC(val)) return err('Conversion to cell from non-cell is not possible.');
        const rhsC = val;
        const { positions } = this.cellPositions(cur, lv.args, sc);
        if (rhsC.data.length !== 1 && rhsC.data.length !== positions.length) err('Cell assignment size mismatch.');
        const next: C = { cls: 'cell', dims: cur.dims.slice(), data: cur.data.slice() };
        positions.forEach((p, idx) => { next.data[p] = this.cloneValue(rhsC.data[rhsC.data.length === 1 ? 0 : idx]); });
        this.store(sc, lv.n, next);
        return;
      }
      const rhs = T_(val, 'assignment');
      const numericCur = isT(cur) ? cur : undefined;
      if (numericCur && this.writeDirect(sc, lv, numericCur, rhs)) return;
      const ix = this.evalArgs(lv.args, numericCur ?? null, sc);
      if (numericCur && ix.length >= 2 && rhs.data.length === 1 && ix.every(a => a !== 'colon' && a.data.length === 1 && a.cls !== 'logical') && ix.length === numericCur.dims.length) {
        let off = 0, m = 1, ok = true;
        for (let d = 0; d < ix.length; d++) { const v = (ix[d] as T).data[0]; if (!(v >= 1 && v <= numericCur.dims[d] && v === Math.floor(v))) { ok = false; break; } off += (v - 1) * m; m *= numericCur.dims[d]; }
        if (ok) { this.writable(sc, lv.n, numericCur)[off] = sat(numericCur.cls, rhs.data[0]); return; }
      }
      const res = assign(numericCur, ix, rhs, !!numericCur && this.buffers.exclusive(numericCur.data));
      if (res.data !== numericCur?.data) this.buffers.hold(res.data);
      sc.set(lv.n, res);
      return;
    }
    const rootName = (n: any): string => { let c = n; while (c && c.k !== 'id') { c = c.a ?? (c.n ? { k: 'id', n: c.n } : null); if (c?.k === 'idx') return c.n; } return c?.n ?? err('Invalid assignment target.'); };
    const rn = rootName(lv);
    const updated = this.writeLvalue(sc.get(rn), lv, val, sc);
    this.store(sc, rn, updated);
  }
  /** The buffer of variable `name`, ready to be written: copied first if anything else holds it. */
  private writable(sc: Scope, name: string, t: T): Float64Array {
    if (this.buffers.exclusive(t.data)) return t.data;
    const data = t.data.slice();
    this.buffers.hold(data);
    sc.set(name, { cls: t.cls, dims: t.dims, data });
    return data;
  }
  /**
   * `A(i)`, `A(i,j,...)` and `A(i,j,:)` assignments inside the current bounds, with scalar subscripts.
   * Returns false, having changed nothing, for everything else (growth, vectors, logical subscripts, errors).
   */
  private writeDirect(sc: Scope, lv: any, t: T, rhs: T): boolean {
    const args = lv.args, k: number = args.length;
    // With fewer subscripts than dimensions the general path also reshapes the array, so leave that to it.
    if (!this.scalarFastPath || !k || (k > 1 && k < t.dims.length)) return false;
    const page = k === 3 && args[2].k === 'colon', count = page ? 2 : k;
    for (let d = 0; d < count; d++) if (!isScalarExpr(args[d])) return false;
    const off = this.scalar.offset(t, args, count, sc);
    if (off < 0) return false;
    const stride = page ? t.dims[0] * t.dims[1] : 0, len = page ? t.data.length / stride : 1, src = rhs.data, n = src.length;
    if (!len || (n !== 1 && n !== len)) return false;
    const data = this.writable(sc, lv.n, t), cls = t.cls;
    for (let q = 0; q < len; q++) data[off + q * stride] = sat(cls, src[n === 1 ? 0 : q]);
    return true;
  }
  /** `A(i,j,:)` with in-bounds scalar `i` and `j`: one pixel, read without building index lists. */
  private readPixel(args: any[], t: T, sc: Scope): T | undefined {
    if (!this.scalarFastPath || args.length !== 3 || args[2].k !== 'colon' || !isScalarExpr(args[0]) || !isScalarExpr(args[1])) return undefined;
    const off = this.scalar.offset(t, args, 2, sc);
    if (off < 0) return undefined;
    const stride = t.dims[0] * t.dims[1], len = t.data.length / stride;
    if (!len) return undefined;
    const data = new Float64Array(len);
    for (let q = 0; q < len; q++) data[q] = t.data[off + q * stride];
    return { cls: t.cls, dims: len === 1 ? [1, 1] : [1, 1, len], data };
  }
  private writeLvalue(cur: V | undefined, lv: any, val: V, sc: Scope): V {
    if (lv.k === 'id') return val;
    if (lv.k === 'idx') {
      if (cur !== undefined && isS(cur)) {
        if (!isS(val)) return err('Conversion to struct from non-struct is not possible.');
        const rhsS = val;
        const { positions, dims } = this.structPositions(cur, lv.args, sc, true);
        const next = this.growStruct(cur, dims);
        for (const k of rhsS.keys) if (!next.keys.includes(k)) { next.keys.push(k); for (const r of next.data) r[k] = mk('double', [0, 0]); }
        positions.forEach((p, idx) => {
          const src = rhsS.data[rhsS.data.length === 1 ? 0 : idx];
          for (const k of next.keys) next.data[p][k] = k in src ? this.cloneValue(src[k]) : mk('double', [0, 0]);
        });
        return next;
      }
      const rhs = T_(val, 'assignment');
      return assign(isT(cur) ? cur : undefined, this.evalArgs(lv.args, isT(cur) ? cur : null, sc), rhs, false);
    }
    if (lv.k === 'apply') {
      const base = this.readOrInit(lv.a, sc);
      if (isS(base)) return this.writeLvalue(base, { k: 'idx', n: '', args: lv.args }, val, sc);
      const t = isT(base) ? base : undefined;
      const rhs = T_(val, 'assignment');
      const next = assign(t, this.evalArgs(lv.args, t ?? null, sc), rhs, false);
      return this.writeLvalue(cur, lv.a, next, sc);
    }
    if (lv.k === 'cellidx') {
      const base = lv.a.k === 'id' ? cur : this.readOrInit(lv.a, sc);
      if (!base || !isC(base)) throw new MatlabError('Brace indexing is only supported for cell arrays.');
      const positions = this.cellPositions(base, lv.args, sc).positions;
      if (positions.length !== 1) err('Cell assignment requires one selected cell.');
      const next: C = { cls: 'cell', dims: base.dims.slice(), data: base.data.slice() };
      next.data[positions[0]] = this.cloneValue(val);
      return lv.a.k === 'id' ? next : this.writeLvalue(cur, lv.a, next, sc);
    }
    if (lv.k === 'field') {
      // Handle s(i).f = val or s.sub(i).f = val
      if (lv.a.k === 'idx' || lv.a.k === 'apply') {
        const arrNode = lv.a;
        const arrVal = arrNode.k === 'idx' ? sc.get(arrNode.n) : this.readOrInit(arrNode.a, sc);
        let s: S;
        if (!arrVal) s = mkStruct([lv.n], [1, 0]);
        else if (!isS(arrVal)) throw new MatlabError('Dot indexing is not supported for this value.');
        else s = arrVal;
        const { positions, dims } = this.structPositions(s, arrNode.args, sc, true);
        if (positions.length !== 1) err('Struct field assignment requires a single selected element.');
        const next = this.growStruct(s, dims, lv.n);
        next.data[positions[0]][lv.n] = this.cloneValue(val);
        return arrNode.k === 'idx' ? next : this.writeLvalue(cur, arrNode.a, next, sc);
      }
      const base = lv.a.k === 'id' ? cur : this.readOrInit(lv.a, sc);
      let s: S;
      if (!base) s = mkStruct([lv.n], [1, 1]);
      else if (!isS(base)) throw new MatlabError('Dot indexing is not supported for this value.');
      else if (base.data.length !== 1) err('Scalar structure required for this assignment.');
      else s = this.growStruct(base, base.dims, lv.n);
      s.data[0][lv.n] = this.cloneValue(val);
      return lv.a.k === 'id' ? s : this.writeLvalue(cur, lv.a, s, sc);
    }
    return err('Invalid assignment target.');
  }
  private readOrInit(e: any, sc: Scope): V | undefined {
    if (e.k === 'id') return sc.get(e.n);
    if (e.k === 'field') {
      const b = this.readOrInit(e.a, sc);
      if (!b) return undefined;
      if (!isS(b)) throw new MatlabError('Dot indexing is not supported for this value.');
      return b.data[0]?.[e.n];
    }
    if (e.k === 'cellidx') {
      const b = this.readOrInit(e.a, sc);
      if (!b || !isC(b)) throw new MatlabError('Brace indexing is only supported for cell arrays.');
      const pos = this.cellPositions(b, e.args, sc).positions;
      if (pos.length !== 1) err('Brace indexing requires a single cell selection.');
      return b.data[pos[0]];
    }
    if (e.k === 'idx') {
      const b = sc.get(e.n);
      if (!b) return undefined;
      if (isS(b)) { const { positions } = this.structPositions(b, e.args, sc, false); return positions.length === 1 ? mkStruct(b.keys, [1, 1], [b.data[positions[0]]]) : undefined; }
      return undefined;
    }
    return undefined;
  }

  // ---------- expressions ----------
  private evalFieldList(e: any, sc: Scope): V[] {
    const base = this.eval(e.a, sc);
    if (!isS(base)) throw new MatlabError('Dot indexing is not supported for this value.');
    if (!base.keys.includes(e.n)) err(`Unrecognized field name '${e.n}'.`);
    return base.data.map(rec => rec[e.n]);
  }
  private evalCallArgs(args: any[], sc: Scope): V[] {
    const out: V[] = [];
    for (const a of args) {
      if (a.k === 'colon') out.push(str(':'));
      else if (a.k === 'field') out.push(...this.evalFieldList(a, sc));
      else out.push(this.eval(a, sc));
    }
    return out;
  }
  callHandle(h: FuncHandle, args: V[], nargout: number): V[] {
    if (h.params) {
      if (args.length < h.params.length) err('Not enough input arguments.');
      if (args.length > h.params.length) err('Too many input arguments.');
      const fnSc: Scope = new Map();
      if (h.env) for (const [k, v] of h.env) fnSc.set(k, v);
      h.params.forEach((p, i) => this.store(fnSc, p, args[i]));
      const prevScope = this.curScope;
      this.curScope = fnSc;
      try { return [this.eval(h.body, fnSc)]; } finally { this.curScope = prevScope; }
    }
    return this.callFn(h.name, args, nargout);
  }
  evalMulti(e: any, sc: Scope, nargout: number): V[] {
    if (e.k === 'id' && !sc.has(e.n)) return this.callFn(e.n, [], nargout);
    if (e.k === 'idx') {
      const v = sc.get(e.n);
      if (v && isF(v)) return this.callHandle(v, this.evalCallArgs(e.args, sc), nargout);
      if (!v) return this.callFn(e.n, this.evalCallArgs(e.args, sc), nargout, e.args);
    }
    if (e.k === 'apply') {
      const base = this.eval(e.a, sc);
      if (isF(base)) return this.callHandle(base, this.evalCallArgs(e.args, sc), nargout);
      if (isC(base)) return [this.cellIndex({ ...e, a: { k: 'value', v: base } }, sc, false)];
      if (isS(base)) { const { positions, dims } = this.structPositions(base, e.args, sc, false); return [{ cls: 'struct', dims, keys: base.keys.slice(), data: positions.map(i => base.data[i]) } as S]; }
      return [index(T_(base, 'indexing'), this.evalArgs(e.args, isT(base) ? base : null, sc))];
    }
    if (e.k === 'field') return this.evalFieldList(e, sc);
    return [this.eval(e, sc)];
  }
  eval(e: any, sc: Scope): V {
    // `id`, `num` and `paren` are left to the switch: a variable must be returned as is, not copied.
    if (e.k === 'bin' || e.k === 'idx' || e.k === 'un') {
      const x = this.tryScalar(e, sc);
      if (x !== undefined) return num(x, this.scalar.cls);
    }
    switch (e.k) {
      case 'num': return num(e.v);
      case 'str': return str(e.v);
      case 'paren': return this.eval(e.a, sc);
      case 'fhandle': return { cls: 'function_handle', name: e.name } as FuncHandle;
      case 'anon': {
        const env: Scope = new Map();
        for (const [k, v] of sc) env.set(k, this.cloneValue(v));
        return { cls: 'function_handle', name: `@(${e.params.join(',')})...`, params: e.params, body: e.body, env } as FuncHandle;
      }
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
        return ew(a, a, x => -x, numCls(a.cls));
      }
      case 'bin': {
        if (e.op === '&&' || e.op === '||') {
          const l = this.cond(e.a, sc);
          if (e.op === '&&' ? !l : l) return num(+l, 'logical');
          return num(+this.cond(e.b, sc), 'logical');
        }
        return binop(e.op, T_(this.eval(e.a, sc), e.op), T_(this.eval(e.b, sc), e.op), s => this.host.warn?.(s));
      }
      case 'post': return transpose(T_(this.eval(e.a, sc), e.op ?? "'"));
      case 'range': {
        const { first, step, count } = this.rangeBounds(e, sc);
        const r = mk('double', [1, count]); for (let i = 0; i < count; i++) r.data[i] = first + i * step; return r;
      }
      case 'mat': {
        const rows = e.rows.map((r: any[]) => {
          const items: T[] = [];
          for (const x of r) {
            if (x.k === 'field') for (const v of this.evalFieldList(x, sc)) items.push(T_(v, '[]'));
            else items.push(T_(this.eval(x, sc), '[]'));
          }
          return items.length ? cat(1, items) : mk('double', [0, 0]);
        });
        return rows.length ? cat(0, rows) : mk('double', [0, 0]);
      }
      case 'cellmat': {
        if (!e.rows.length) return { cls: 'cell', dims: [0, 0], data: [] } as C;
        const expandedRows: V[][] = e.rows.map((r: any[]) => {
          const items: V[] = [];
          for (const x of r) {
            if (x.k === 'field') items.push(...this.evalFieldList(x, sc));
            else items.push(this.eval(x, sc));
          }
          return items;
        });
        const cols = expandedRows[0].length;
        if (expandedRows.some(r => r.length !== cols)) err('Cell array rows must have the same number of elements.');
        const data = new Array<V>(expandedRows.length * cols);
        expandedRows.forEach((r, row) => r.forEach((x, col) => { data[row + expandedRows.length * col] = x; }));
        return { cls: 'cell', dims: [expandedRows.length, cols], data } as C;
      }
      case 'field': {
        const base = this.eval(e.a, sc);
        if (!isS(base)) throw new MatlabError('Dot indexing is not supported for this value.');
        if (!base.keys.includes(e.n)) err(`Unrecognized field name '${e.n}'.`);
        if (base.data.length === 0) err('Struct array is empty.');
        return base.data[0][e.n];
      }
      case 'cellidx': return this.cellIndex(e, sc, true);
      case 'apply': {
        const base = this.eval(e.a, sc);
        if (isF(base)) { const r = this.callHandle(base, this.evalCallArgs(e.args, sc), 1); return r[0] ?? err('Function returned no output.'); }
        if (isC(base)) return this.cellIndex({ ...e, a: { k: 'value', v: base } }, sc, false);
        if (isS(base)) { const { positions, dims } = this.structPositions(base, e.args, sc, false); return { cls: 'struct', dims, keys: base.keys.slice(), data: positions.map(i => base.data[i]) } as S; }
        return index(T_(base, 'indexing'), this.evalArgs(e.args, isT(base) ? base : null, sc));
      }
      case 'idx': {
        const v = sc.get(e.n);
        if (v) {
          if (isF(v)) { const r = this.callHandle(v, this.evalCallArgs(e.args, sc), 1); return r[0] ?? err('Function handle returned no value.'); }
          if (isC(v)) {
            const { positions, dims } = this.cellPositions(v, e.args, sc);
            return { cls: 'cell', dims, data: positions.map(i => v.data[i]) } as C;
          }
          if (isS(v)) {
            const { positions, dims } = this.structPositions(v, e.args, sc, false);
            return { cls: 'struct', dims, keys: v.keys.slice(), data: positions.map(i => v.data[i]) } as S;
          }
          const t = T_(v, 'indexing'); return this.readPixel(e.args, t, sc) ?? index(t, this.evalArgs(e.args, t, sc));
        }
        const r = this.callFn(e.n, this.evalCallArgs(e.args, sc), 1, e.args);
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

  callFn(name: string, args: V[], nargout: number, argExprs?: any[]): V[] {
    const f = this.funcs.get(name);
    if (f) {
      const hasVarargin = f.params.length > 0 && f.params[f.params.length - 1] === 'varargin';
      const fixedParams = hasVarargin ? f.params.length - 1 : f.params.length;
      if (!hasVarargin && args.length > f.params.length) err(`Error using ${name}: Too many input arguments.`);
      if (++this.depth > 200) { this.depth = 0; err('Maximum recursion limit of 200 reached.'); }
      const sc: Scope = new Map();
      for (let i = 0; i < fixedParams && i < args.length; i++) this.store(sc, f.params[i], args[i]);
      if (hasVarargin) {
        const rest = args.slice(fixedParams).map(a => this.cloneValue(a));
        sc.set('varargin', { cls: 'cell', dims: [1, rest.length], data: rest } as C);
      }
      const prevScope = this.curScope;
      this.curScope = sc;
      this.fnStack.push({ name, nargin: args.length, nargout, f });
      try { this.exec(f.body, sc); } finally { this.fnStack.pop(); this.curScope = prevScope; this.depth--; }
      const out: V[] = [];
      const hasVarargout = f.outs.length > 0 && f.outs[f.outs.length - 1] === 'varargout';
      const fixedOuts = hasVarargout ? f.outs.length - 1 : f.outs.length;
      const want = Math.max(nargout, 1);
      for (let i = 0; i < want && i < fixedOuts; i++) {
        const v = sc.get(f.outs[i]);
        if (!v) { if (i < nargout || (i === 0 && nargout === 1)) err(`Output argument '${f.outs[i]}' (and maybe others) not assigned during call to '${name}'.`); break; }
        out.push(v);
      }
      if (hasVarargout && out.length < want) {
        const vo = sc.get('varargout');
        if (vo && isC(vo)) {
          for (let j = 0; out.length < want && j < vo.data.length; j++) out.push(vo.data[j]);
        }
      }
      return out;
    }
    const b = BUILTINS[name];
    if (!b) err(`Unrecognized function or variable '${name}'.`);
    this.curArgs = argExprs;
    try { return b(args, nargout, this); } finally { this.curArgs = undefined; }
  }
}

// =====================================================================================
// Builtins
// =====================================================================================
export const BUILTINS: Record<string, Builtin> = {};
const def = (names: string, f: Builtin) => names.split(' ').forEach(n => (BUILTINS[n] = f));
const clsFromName = (s: string): Cls => (CLASS_NAMES.includes(s) ? (s as Cls) : err(`Unsupported class '${s}'.`));
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
  const t = a[0], d = isT(t) || isC(t) || isS(t) ? t.dims : [1, 1];
  if (a.length > 1) { const k = scalarOf(a[1]); return [num(d[k - 1] ?? 1)]; }
  if (n <= 1) return [mk('double', [1, d.length], d)];
  const out: V[] = []; for (let i = 0; i < n; i++) out.push(num(i < n - 1 ? (d[i] ?? 1) : numel(d.slice(i))));
  return out;
});
def('numel', a => { const t = a[0]; return [num(isT(t) || isC(t) || isS(t) ? t.data.length : 1)]; });
def('length', a => { const t = a[0], d = isT(t) || isC(t) || isS(t) ? t.dims : [1, 1]; return [num(numel(d) ? Math.max(...d) : 0)]; });
def('ndims', a => { const t = a[0]; return [num(isT(t) || isC(t) || isS(t) ? t.dims.length : 2)]; });
def('isempty', a => { const t = a[0]; return [num(+(isT(t) || isC(t) || isS(t) ? t.data.length === 0 : false), 'logical')]; });
def('class', a => [str(isT(a[0]) ? a[0].cls : isC(a[0]) ? 'cell' : isS(a[0]) ? 'struct' : 'function_handle')]);
def('iscell', a => [num(+isC(a[0]), 'logical')]);
def('isstruct', a => [num(+isS(a[0]), 'logical')]);
def('isa', a => {
  const v = a[0], c = toStr(a[1]);
  if (c === 'numeric') return [num(+(isT(v) && v.cls !== 'logical' && v.cls !== 'char'), 'logical')];
  if (c === 'float') return [num(+(isT(v) && (v.cls === 'double' || v.cls === 'single')), 'logical')];
  if (c === 'integer') return [num(+(isT(v) && isIntCls(v.cls)), 'logical')];
  return [num(+(isT(v) ? v.cls === c : v.cls === c), 'logical')];
});
const conv = (cls: Cls): Builtin => a => { const t = T_(a[0], cls); return [{ cls, dims: t.dims.slice(), data: t.data.map(v => sat(cls, v)) }]; };
for (const c of CLASS_NAMES) def(c, conv(c as Cls));
def('cast', a => {
  const c = isStr(a[1]) ? toStr(a[1]) : '';
  if (!CLASS_NAMES.includes(c)) err(`Error using cast: Invalid class name '${c}'. Supported: ${CLASS_NAMES.join(', ')}.`);
  return conv(c as Cls)([a[0]], 1, null);
});
const map1 = (f: (x: number) => number): Builtin => a => { const t = T_(a[0], 'math'); const cls = numCls(t.cls); return [{ cls, dims: t.dims.slice(), data: t.data.map(v => sat(cls, f(v))) }]; };
def('abs', map1(Math.abs)); def('floor', map1(Math.floor)); def('ceil', map1(Math.ceil)); def('round', map1(x => Math.sign(x) * Math.round(Math.abs(x))));
def('fix', map1(Math.trunc)); def('sqrt', map1(Math.sqrt));
def('mod', a => { const x = T_(a[0], 'mod'), y = T_(a[1], 'mod'); return [ew(x, y, (p, q) => (q === 0 ? p : p - Math.floor(p / q) * q), outCls(x, y))]; });
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
  if (a.length >= 2 && T_(a[1], 'max').data.length > 0) { const u = T_(a[1], 'max'); return [ew(t, u, pick, outCls(t, u))]; }
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
  if (a.length === 0) return [mkStruct([], [1, 1])];
  if (a.length === 1 && isT(a[0]) && a[0].data.length === 0) return [mkStruct([], [0, 0])];
  if (a.length % 2 !== 0) err('Error using struct: inputs must be field-name/value pairs.');
  const keys: string[] = [];
  const vals: V[] = [];
  let dims: number[] | null = null;
  for (let i = 0; i < a.length; i += 2) {
    if (!isStr(a[i])) err('Error using struct: field names must be character vectors.');
    const k = toStr(a[i]), v = a[i + 1];
    keys.push(k); vals.push(v);
    if (isC(v) && v.data.length !== 1) {
      if (!dims) dims = v.dims.slice();
      else if (dims.join(',') !== v.dims.join(',')) err('Error using struct: cell arrays must have consistent dimensions.');
    }
  }
  if (!dims) {
    const rec: Record<string, V> = {};
    keys.forEach((k, i) => { rec[k] = isC(vals[i]) ? vals[i].data[0] : vals[i]; });
    return [mkStruct(keys, [1, 1], [rec])];
  }
  const n = numel(dims);
  const data = Array.from({ length: n }, (_, idx) => {
    const rec: Record<string, V> = {};
    keys.forEach((k, i) => {
      const v = vals[i];
      rec[k] = isC(v) ? v.data[v.data.length === 1 ? 0 : idx] : v;
    });
    return rec;
  });
  return [mkStruct(keys, dims, data)];
});
def('isfield', a => {
  const s = a[0];
  if (!isS(s)) return [num(0, 'logical')];
  if (isStr(a[1])) return [num(+s.keys.includes(toStr(a[1])), 'logical')];
  if (isC(a[1])) {
    const out = mk('logical', a[1].dims.slice());
    a[1].data.forEach((x, i) => { out.data[i] = +s.keys.includes(toStr(x)); });
    return [out];
  }
  return [num(0, 'logical')];
});
def('fieldnames', a => {
  const s = a[0];
  if (!isS(s)) return err('Error using fieldnames: input must be a struct.');
  return [{ cls: 'cell', dims: [s.keys.length, 1], data: s.keys.map(k => str(k)) } as C];
});
def('rmfield', a => {
  const s = a[0];
  if (!isS(s)) return err('Error using rmfield: input must be a struct.');
  const rem = isStr(a[1]) ? [toStr(a[1])] : isC(a[1]) ? a[1].data.map(x => toStr(x)) : err('Error using rmfield: field name must be a string.');
  for (const r of rem) if (!s.keys.includes(r)) err(`Reference to non-existent field '${r}'.`);
  const keys = s.keys.filter(k => !rem.includes(k));
  const data = s.data.map(rec => { const nr: Record<string, V> = {}; for (const k of keys) nr[k] = rec[k]; return nr; });
  return [mkStruct(keys, s.dims, data)];
});
def('cell', a => {
  const { dims } = dimsFrom(a, 'cell');
  return [{ cls: 'cell', dims, data: Array.from({ length: numel(dims) }, () => mk('double', [0, 0])) } as C];
});
def('who', (_a, _n, I) => { if (I.vars.size) I.host.print('Your variables are:\n\n' + [...I.vars.keys()].sort().join('  ') + '\n\n'); return []; });
def('whos', (_a, _n, I) => {
  if (!I.vars.size) return [];
  const rows = [...I.vars.entries()].sort().map(([k, v]) => isT(v) || isC(v) ? [k, dimStr(v.dims).replace(/×/g, 'x'), String(v.data.length * (isC(v) ? 8 : (CLASS_BYTES[v.cls] ?? 8))), v.cls] : isS(v) ? [k, dimStr(v.dims).replace(/×/g, 'x'), '-', 'struct'] : [k, '1x1', '-', 'function_handle']);
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
def('format', () => []);
def('figure', (a, nargout, I) => {
  I.flushFigures();
  let id: number;
  // figure('Name', 'x', ...): window properties are accepted and ignored
  if (a.length && isStr(a[0]) && Number.isNaN(Number(toStr(a[0])))) a = [];
  if (a.length) {
    const n = isStr(a[0]) ? Number(toStr(a[0])) : scalarOf(a[0], 'figure');
    const { fig, created } = I.figs.select(n); id = fig.id;
    if (created) I.host.newFigure();
  } else { id = I.figs.create().id; I.host.newFigure(); }
  return nargout > 0 ? [num(id)] : [];
});
def('drawnow', (_a, _n, I) => { I.flushFigures(); return []; });

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
  const to8 = (v: number) => (t.cls === 'uint8' ? v : Math.max(0, Math.min(255, Math.round(toUnit(t.cls, v) * 255))));
  if (map && c === 1) { // indexed: double/single indices are 1-based (MATLAB), integer classes 0-based
    const out = new Uint8Array(h * w * 3), m = map.dims[0];
    for (let i = 0; i < h; i++) for (let j = 0; j < w; j++) { const ix = Math.min(m - 1, Math.max(0, Math.floor(t.data[i + h * j]) - (t.cls === 'double' || t.cls === 'single' ? 1 : 0))); for (let k = 0; k < 3; k++) out[(i * w + j) * 3 + k] = Math.round(255 * Math.min(1, Math.max(0, map.data[ix + m * k]))); }
    return { width: w, height: h, channels: 3, data: out };
  }
  const out = new Uint8Array(h * w * c);
  for (let i = 0; i < h; i++) for (let j = 0; j < w; j++) for (let k = 0; k < c; k++) out[(i * w + j) * c + k] = to8(t.data[i + h * j + h * w * k]);
  return { width: w, height: h, channels: c as 1 | 3, data: out };
}
function show(tool: boolean): Builtin {
  return (a, _n, I) => {
    // Like MATLAB's imtool: the window is named after the variable (imtool(I)) or the file (imtool('a.png')); nothing for other expressions.
    const a0 = I.curArgs?.[0];
    const name: string | undefined = a0?.k === 'id' ? a0.n : a0?.k === 'str' ? String(a0.v).split(/[\\/]/).pop() || undefined : undefined;
    if (isStr(a[0])) { const im = readImg(I, toStr(a[0])); a = [toTensor(im), ...(im.colormap ? [mk('double', [im.colormap.length, 3], im.colormap.map(r => r[0]).concat(im.colormap.map(r => r[1]), im.colormap.map(r => r[2])))] : []), ...a.slice(1)]; }
    const t = T_(a[0], 'imshow');
    // second argument: [] or [lo hi] = display range, m-by-3 = colormap of an indexed image
    const opt = a[1] && isT(a[1]) && a[1].cls !== 'char' ? a[1] : undefined;
    const map = opt && opt.data.length && opt.dims.length === 2 && opt.dims[1] === 3 ? opt : undefined;
    const gray = !map && t.dims.length === 2;
    let range: [number, number] | undefined;
    if (opt && !map) {
      if (opt.data.length === 2) { range = [opt.data[0], opt.data[1]]; if (!(range[0] < range[1])) err('Error using imshow: Display range [low high] must be increasing.'); }
      else if (!opt.data.length) {
        let lo = Infinity, hi = -Infinity; for (const v of t.data) if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
        if (lo > hi) { lo = 0; hi = 1; } else if (lo === hi) hi = lo + 1;
        range = [lo, hi];
      } else err('Error using imshow: Display range must be [] or a two-element vector.');
    }
    // the range only applies to grayscale images (MATLAB ignores it for truecolor)
    const scaled = gray && range ? mk('double', t.dims.slice(), t.data.map(v => (v !== v ? 0 : (v - range![0]) / (range![1] - range![0])))) : t;
    const b = toBytes(scaled, map), rgb = new Uint8Array(b.width * b.height * 3);
    for (let p = 0; p < b.width * b.height; p++) for (let k = 0; k < 3; k++) rgb[p * 3 + k] = b.data[p * b.channels + (b.channels === 3 ? k : 0)];
    const img = { width: b.width, height: b.height, rgb };
    if (tool) { I.flushFigures(); I.host.showImage(img, { tool: true, name, fig: I.figs.curId || 1 }); return []; }
    if (gray) range ??= INT_RANGE[t.cls] ? [INT_RANGE[t.cls][0], INT_RANGE[t.cls][1]] : [0, 1];
    let source: ImageSource | undefined, cmap: number[][] | null = null;
    if (gray) source = { kind: 'gray', rgb };
    else if (map && t.dims.length === 2) {
      const m = map.dims[0], ix = new Int32Array(b.width * b.height);
      cmap = Array.from({ length: m }, (_, i) => [map.data[i], map.data[i + m], map.data[i + 2 * m]]);
      for (let i = 0; i < b.height; i++) for (let j = 0; j < b.width; j++) ix[i * b.width + j] = Math.min(m - 1, Math.max(0, Math.floor(t.data[i + b.height * j]) - (t.cls === 'double' || t.cls === 'single' ? 1 : 0)));
      source = { kind: 'indexed', ix, base: cmap };
    }
    addImage(I.figs, { t: 'image', w: b.width, h: b.height, rgb, name, ...(gray ? { range } : {}) }, source, cmap); return [];
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
  const keys = ['Filename', 'FileModDate', 'FileSize', 'Format', 'FormatVersion', 'Width', 'Height', 'BitDepth', 'ColorType'];
  const rec: Record<string, V> = {
    Filename: str(img.filename), FileModDate: str(img.fileModDate ?? ''), FileSize: num(img.fileSize),
    Format: str(img.format), FormatVersion: str(''), Width: num(img.width), Height: num(img.height),
    BitDepth: num(img.bitDepth), ColorType: str(img.colorType),
  };
  if (png) { keys.push('FormatSignature'); rec.FormatSignature = mk('double', [1, 8], [137, 80, 78, 71, 13, 10, 26, 10]); }
  return [mkStruct(keys, [1, 1], [rec])];
});
const rgbInput = (v: V, fn: string): T => { const t = T_(v, fn); if (t.dims.length !== 3 || t.dims[2] !== 3) err(`Error using ${fn}: RGB input must be M-by-N-by-3.`); return t; };
const f64 = (t: T): Float64Array => (isIntCls(t.cls) ? t.data.map(v => toUnit(t.cls, v)) : t.data);
function perPixel(t: T, outCls: Cls, f: (r: number, g: number, b: number) => number[]): T {
  const n = t.dims[0] * t.dims[1], d = f64(t), o = mk(outCls, t.dims.slice());
  for (let p = 0; p < n; p++) { const r = f(d[p], d[p + n], d[p + 2 * n]); for (let k = 0; k < 3; k++) o.data[p + k * n] = sat(outCls, r[k]); }
  return o;
}
def('rgb2gray', a => {
  const t = T_(a[0], 'rgb2gray'); if (t.dims.length === 2) err('Error using rgb2gray: RGB input must be M-by-N-by-3.'); rgbInput(t, 'rgb2gray');
  const n = t.dims[0] * t.dims[1], cls: Cls = numCls(t.cls), o = mk(cls, [t.dims[0], t.dims[1]]);
  for (let p = 0; p < n; p++) o.data[p] = sat(cls, 0.298936 * t.data[p] + 0.587043 * t.data[p + n] + 0.114021 * t.data[p + 2 * n]);
  return [o];
});
// im2double / im2single / im2uint8 / im2uint16: integer classes scale by their range, double/single/logical are 0-1 (logical 0/1)
const im2cls = (cls: Cls, fn: string): Builtin => a => {
  const t = T_(a[0], fn);
  if (t.cls === 'char') err(`Error using ${fn}: Invalid input class 'char'.`);
  if (t.cls === cls) return [t];
  return [{ cls, dims: t.dims.slice(), data: t.data.map(v => fromUnit(cls, toUnit(t.cls, v))) } as T];
};
def('im2double', a => { const t = T_(a[0], 'im2double'); return [{ cls: 'double', dims: t.dims.slice(), data: f64(t) } as T]; });
def('im2single', im2cls('single', 'im2single')); def('im2uint16', im2cls('uint16', 'im2uint16'));
def('rgb2hsv', a => [perPixel(rgbInput(a[0], 'rgb2hsv'), 'double', (r, g, b) => {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let h = 0;
  if (d > 0) h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, mx === 0 ? 0 : d / mx, mx];
})]);
def('rgb2ycbcr', a => {
  const t = rgbInput(a[0], 'rgb2ycbcr'), k = t.cls === 'uint8' ? 1 : t.cls === 'uint16' ? 257 : t.cls === 'double' || t.cls === 'single' ? 1 / 255 : 0;
  if (!k) err('Error using rgb2ycbcr: RGB must be uint8, uint16, single or double.');
  return [perPixel(t, t.cls, (r, g, b) => {
    const y = 16 + 65.481 * r + 128.553 * g + 24.966 * b, cb = 128 - 37.797 * r - 74.203 * g + 112 * b, cr = 128 + 112 * r - 93.786 * g - 18.214 * b;
    return [y * k, cb * k, cr * k];
  })];
});
def('rgb2ntsc', a => [perPixel(rgbInput(a[0], 'rgb2ntsc'), 'double', (r, g, b) => [0.299 * r + 0.587 * g + 0.114 * b, 0.596 * r - 0.274 * g - 0.322 * b, 0.211 * r - 0.523 * g + 0.312 * b])]);
def('imcrop', a => {
  const t = T_(a[0], 'imcrop'), r = T_(a[1], 'imcrop'); if (r.data.length !== 4) err('Error using imcrop: rect must be [xmin ymin width height] (interactive cropping is not available).');
  const [x, y, w, h] = Array.from(r.data), H = t.dims[0], W = t.dims[1];
  const c0 = Math.max(1, Math.round(x)), c1 = Math.min(W, Math.round(x + w)), r0 = Math.max(1, Math.round(y)), r1 = Math.min(H, Math.round(y + h));
  const rows = mk('double', [1, Math.max(0, r1 - r0 + 1)]), cols = mk('double', [1, Math.max(0, c1 - c0 + 1)]);
  rows.data.forEach((_, i) => (rows.data[i] = r0 + i)); cols.data.forEach((_, i) => (cols.data[i] = c0 + i));
  return [index(t, t.dims.length === 3 ? [rows, cols, 'colon'] : [rows, cols])];
});
/** Histogram bin (0-based) of a pixel value: logical and uint8 use the value itself; other integer classes are spread over 256 bins; double/single use round(v*255) for imhist and floor(v*bins) for histeq. */
const histBin = (cls: Cls, v: number, bins: number, forEq = false): number => {
  if (cls === 'logical') return v;
  const r = INT_RANGE[cls];
  if (r) return cls === 'uint8' ? v : Math.min(bins - 1, Math.max(0, Math.floor(((v - r[0]) * 256) / (r[1] - r[0] + 1))));
  return forEq ? Math.min(bins - 1, Math.floor(v * bins)) : Math.min(255, Math.max(0, Math.round(v * 255)));
};
def('imhist', (a, nargout, I) => {
  const t = T_(a[0], 'imhist'), asked = a[1] ? T_(a[1], 'imhist') : null;
  if (asked && (asked.data.length !== 1 || !Number.isInteger(asked.data[0]) || asked.data[0] < 1 || asked.data[0] > 65536)) err('Error using imhist: Number of bins must be a positive integer (imhist(X, map) is not supported).');
  const logical = t.cls === 'logical', bins = logical ? 2 : asked ? asked.data[0] : 256, o = mk('double', [bins, 1]);
  // 256 bins keep the class mapping above; another count spreads the class range over `bins` centers
  for (const v of t.data) o.data[logical || bins === 256 ? histBin(t.cls, v, bins) : Math.min(bins - 1, Math.max(0, Math.round(toUnit(t.cls, v) * (bins - 1))))]++;
  const [lo, hi] = INT_RANGE[t.cls] ?? [0, 1];
  const centers = (a0: number, a1: number) => Array.from({ length: bins }, (_, i) => (bins === 1 ? a0 : a0 + (i * (a1 - a0)) / (bins - 1)));
  if (nargout === 0) { // draw it: x on the 0..255 scale (0 and 1 for logical images)
    const top = logical ? 1 : 255;
    drawBars(I.figs, [{ x: centers(0, top), y: Array.from(o.data), width: bins > 1 ? top / (bins - 1) : top, ramp: true }]);
    return [];
  }
  return nargout > 1 ? [o, mk('double', [bins, 1], centers(lo, hi))] : [o];
});
def('histeq', (a, nargout) => {
  const image = T_(a[0], 'histeq');
  if (image.dims.length !== 2) err('Error using histeq: input must be a two-dimensional grayscale image.');
  if ((image.cls === 'double' || image.cls === 'single') && image.data.some(v => v < 0 || v > 1)) err('Error using histeq: double input values must be in the range [0, 1].');
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
    hist[histBin(image.cls, value, inputBins, true)]++;
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
    lut[i] = image.cls === 'logical' ? +(normalized >= 0.5) : fromUnit(image.cls, normalized);
  }
  const out = mk(image.cls, image.dims.slice());
  for (let i = 0; i < image.data.length; i++) {
    out.data[i] = lut[histBin(image.cls, image.data[i], inputBins, true)];
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
def('rem', a => { const x = T_(a[0], 'rem'), y = T_(a[1], 'rem'); return [ew(x, y, (p, q) => (q === 0 ? NaN : p % q), outCls(x, y))]; });
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
def('error', (a, _n, I) => {
  if (a.length >= 2 && isStr(a[0]) && isStr(a[1]) && /^[A-Za-z]\w*(?::[A-Za-z]\w*)+$/.test(toStr(a[0]))) {
    return err(toStr(BUILTINS.sprintf(a.slice(1), 1, I)[0]), toStr(a[0]));
  }
  const m = a.length > 1 ? toStr(BUILTINS.sprintf(a, 1, I)[0]) : toStr(a[0]);
  return err(m);
});
def('warning', (a, _n, I) => {
  if (!a.length) return [];
  if (a.length === 1 && isStr(a[0]) && /^(off|on)$/i.test(toStr(a[0]))) return [];
  let m: string;
  if (a.length >= 2 && isStr(a[0]) && isStr(a[1]) && /^[A-Za-z]\w*(?::[A-Za-z]\w*)+$/.test(toStr(a[0]))) {
    m = toStr(BUILTINS.sprintf(a.slice(1), 1, I)[0]);
  } else {
    m = a.length > 1 ? toStr(BUILTINS.sprintf(a, 1, I)[0]) : toStr(a[0]);
  }
  if (I.host.warn) I.host.warn(m); else I.host.print('Warning: ' + m + '\n');
  return [];
});
def('rethrow', a => {
  const s = a[0];
  if (!isS(s) || !s.keys.includes('message')) err('Error using rethrow: Input must be an MException struct.');
  const sr = s as S;
  return err(toStr(sr.data[0].message), sr.keys.includes('identifier') ? toStr(sr.data[0].identifier) : 'MLWeb:Error');
});
def('feval', (a, nargout, I) => {
  if (!a.length) err('Error using feval: Not enough input arguments.');
  const fn = a[0], rest = a.slice(1);
  if (isF(fn)) return I.callHandle(fn, rest, nargout);
  if (isStr(fn)) return I.callFn(toStr(fn), rest, nargout);
  return err('Error using feval: First argument must be a function handle or function name.');
});
def('func2str', a => {
  const h = a[0];
  if (!isF(h)) return err('Error using func2str: Input must be a function handle.');
  return [str(h.name)];
});
def('str2func', a => {
  if (!isStr(a[0])) err('Error using str2func: Input must be a string.');
  return [{ cls: 'function_handle', name: toStr(a[0]) } as FuncHandle];
});
def('nargin', (a, _n, I) => {
  if (a.length > 0) {
    if (isF(a[0])) {
      if (a[0].params) return [num(a[0].params.length)];
      const uf = I.funcs.get(a[0].name);
      if (uf) return [num(uf.params.length && uf.params[uf.params.length - 1] === 'varargin' ? -uf.params.length : uf.params.length)];
      err(`Error using nargin: cannot determine nargin for '${a[0].name}'.`);
    }
    const name = toStr(a[0]);
    const uf = I.funcs.get(name);
    if (uf) return [num(uf.params.length && uf.params[uf.params.length - 1] === 'varargin' ? -uf.params.length : uf.params.length)];
    err(`Error using nargin: function '${name}' not found.`);
  }
  const top = I.fnStack[I.fnStack.length - 1];
  return [num(top ? top.nargin : 0)];
});
def('nargout', (a, _n, I) => {
  if (a.length > 0) {
    if (isF(a[0])) {
      if (a[0].params) return [num(1)];
      const uf = I.funcs.get(a[0].name);
      if (uf) return [num(uf.outs.length && uf.outs[uf.outs.length - 1] === 'varargout' ? -uf.outs.length : uf.outs.length)];
      err(`Error using nargout: cannot determine nargout for '${a[0].name}'.`);
    }
    const name = toStr(a[0]);
    const uf = I.funcs.get(name);
    if (uf) return [num(uf.outs.length && uf.outs[uf.outs.length - 1] === 'varargout' ? -uf.outs.length : uf.outs.length)];
    err(`Error using nargout: function '${name}' not found.`);
  }
  const top = I.fnStack[I.fnStack.length - 1];
  return [num(top ? top.nargout : 0)];
});
def('exist', (a, _n, I) => {
  const name = toStr(a[0]);
  const kind = a[1] ? toStr(a[1]).toLowerCase() : '';
  const hasVar = I.curScope.has(name);
  if (kind === 'var') return [num(hasVar ? 1 : 0)];
  if (kind === 'builtin') return [num(BUILTINS[name] ? 5 : 0)];
  if (kind === 'file') return [num(I.funcs.has(name) || I.host.readImage(name) ? 2 : 0)];
  if (hasVar) return [num(1)];
  if (BUILTINS[name]) return [num(5)];
  if (I.funcs.has(name) || I.host.readImage(name)) return [num(2)];
  return [num(0)];
});
function mapFun(isCell: boolean): Builtin {
  const fnName = isCell ? 'cellfun' : 'arrayfun';
  return (a, nargout, I) => {
    if (a.length < 2) err(`Error using ${fnName}: Not enough input arguments.`);
    const fn = a[0];
    let uniform = true;
    let end = a.length;
    if (end >= 3 && isStr(a[end - 2]) && toStr(a[end - 2]).toLowerCase() === 'uniformoutput') {
      uniform = scalarOf(a[end - 1], 'UniformOutput') !== 0;
      end -= 2;
    }
    const inputs = a.slice(1, end);
    if (!inputs.length) err(`Error using ${fnName}: Not enough input arguments.`);
    let dims: number[] | null = null;
    for (const inp of inputs) {
      if (isCell) {
        if (!isC(inp)) err(`Error using cellfun: Input must be a cell array.`);
      } else if (!isT(inp) && !isS(inp) && !isC(inp)) {
        err(`Error using arrayfun: Unsupported input type.`);
      }
      if (!dims) dims = (inp as any).dims.slice();
      else if ((inp as any).dims.join(',') !== dims.join(',')) err(`Error using ${fnName}: All inputs must have the same size.`);
    }
    const n = numel(dims!), want = Math.max(nargout, 1);
    const cols: V[][] = Array.from({ length: want }, () => new Array(n));
    const callOne = (args: V[]) => {
      if (isF(fn)) return I.callHandle(fn, args, want);
      if (isStr(fn)) return I.callFn(toStr(fn), args, want);
      return err(`Error using ${fnName}: First argument must be a function handle or name.`);
    };
    for (let i = 0; i < n; i++) {
      const callArgs: V[] = inputs.map(inp => {
        if (isCell) return (inp as C).data[i];
        if (isT(inp)) return num(inp.data[i], inp.cls);
        if (isS(inp)) return mkStruct(inp.keys, [1, 1], [inp.data[i]]);
        return (inp as C).data[i];
      });
      const res = callOne(callArgs);
      for (let o = 0; o < want; o++) {
        if (res[o] === undefined) err(`Error using ${fnName}: Function returned fewer outputs than requested.`);
        cols[o][i] = res[o];
      }
    }
    if (!uniform) return cols.map(data => ({ cls: 'cell', dims: dims!.slice(), data } as C));
    return cols.map(data => {
      if (n === 0) return mk('double', dims!.slice());
      const first = data[0];
      if (!isT(first) || first.data.length !== 1) err(`Error using ${fnName}: Non-scalar in Uniform output, at index 1, output 1. Set 'UniformOutput' to false.`);
      const resCls: Cls = data.every((v): v is T => isT(v) && v.cls === first.cls) ? (first.cls as Cls) : 'double';
      const out = mk(resCls, dims!.slice());
      for (let i = 0; i < n; i++) {
        const v = data[i];
        if (!isT(v) || v.data.length !== 1) return err(`Error using ${fnName}: Non-scalar in Uniform output, at index ${i + 1}. Set 'UniformOutput' to false.`);
        out.data[i] = sat(resCls, v.data[0]);
      }
      return out;
    });
  };
}
def('cellfun', mapFun(true));
def('arrayfun', mapFun(false));
let ticAt = 0; def('tic', () => { ticAt = performance.now(); return []; });
def('toc', (_a, n, I) => { const s = (performance.now() - ticAt) / 1000; if (n > 0) return [num(s)]; I.host.print(`Elapsed time is ${s.toFixed(6)} seconds.\n`); return []; });
let seed = 123456789; const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
def('rand', a => { const { dims, cls } = dimsFrom(a, 'rand'); const t = mk(cls, dims); for (let i = 0; i < t.data.length; i++) t.data[i] = sat(cls, rnd()); return [t]; });
def('randi', a => { const m = T_(a[0], 'randi'), hi = m.data[m.data.length - 1], lo = m.data.length > 1 ? m.data[0] : 1; const { dims } = dimsFrom(a.slice(1), 'randi'); const t = mk('double', dims); for (let i = 0; i < t.data.length; i++) t.data[i] = lo + Math.floor(rnd() * (hi - lo + 1)); return [t]; });
// image arithmetic (saturating, class-aware) and conversions
const imArith = (f: (x: number, y: number) => number, fn: string): Builtin => a => { const x = T_(a[0], fn), y = T_(a[1], fn); return [ew(x, y, f, outCls(x, y))]; };
def('imadd', imArith((p, q) => p + q, 'imadd')); def('imsubtract', imArith((p, q) => p - q, 'imsubtract')); def('imabsdiff', imArith((p, q) => Math.abs(p - q), 'imabsdiff'));
def('im2uint8', im2cls('uint8', 'im2uint8'));
def('imcomplement', a => { const t = T_(a[0], 'imcomplement'); return [{ cls: t.cls, dims: t.dims.slice(), data: t.data.map(v => { const r = INT_RANGE[t.cls]; return r ? r[0] + r[1] - v : 1 - v; }) }]; });
def('mat2gray', a => { const t = T_(a[0], 'mat2gray'); let lo = Infinity, hi = -Infinity; for (const v of t.data) { if (v < lo) lo = v; if (v > hi) hi = v; } const d = hi - lo; return [{ cls: 'double', dims: t.dims.slice(), data: t.data.map(v => (d === 0 ? (v > 0 ? 1 : 0) : (v - lo) / d)) }]; });
def('im2gray', (a, n, I) => { const t = T_(a[0], 'im2gray'); return t.dims.length === 3 ? BUILTINS.rgb2gray(a, n, I) : [t]; });

def('im2bw', (a, n, I) => { let t = T_(a[0], 'im2bw'); if (t.dims.length === 3) t = BUILTINS.rgb2gray([t], 1, I)[0] as T; const lv = a[1] ? T_(a[1], 'im2bw').data[0] : 0.5, th = INT_RANGE[t.cls] ? INT_RANGE[t.cls][0] + lv * (INT_RANGE[t.cls][1] - INT_RANGE[t.cls][0]) : lv; const o = mk('logical', t.dims.slice()); for (let i = 0; i < t.data.length; i++) o.data[i] = t.data[i] > th ? 1 : 0; return [o]; });

// Phase 2 libraries (registered last so they supersede the earlier minimal versions)
registerMath(def);
registerArray(def);
registerString(def);
registerPlot(def);
registerIpt(def);
