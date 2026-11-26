// Scalar fast path (plan 6.1a): evaluates expressions built only from numeric literals, scalar
// variables, scalar-subscript reads, `end` and operators on plain numbers, without allocating tensors.
//
// It never raises and never calls a function. Anything it cannot do exactly like the general
// evaluator (non-scalar operand, unknown name, bad subscript, mixed integer classes, ...) returns
// `undefined`, and the caller re-runs the whole expression on the general path. That is safe
// because eligible expressions have no side effects, and it keeps every error message in one place.
import { Cls, V, isT, isIntCls, sat } from './values';

/** What `end` refers to: the array being subscripted, the subscript position and the subscript count. */
export interface EndRef { t: { dims: number[]; data: { length: number } }; pos: number; n: number }

/** True when the expression has a shape the fast path can handle. Cached on the AST node. */
export function isScalarExpr(e: any): boolean {
  let r: boolean | undefined = e.scalarShape;
  if (r === undefined) {
    switch (e.k) {
      case 'num': case 'id': case 'end': r = true; break;
      case 'paren': case 'un': r = isScalarExpr(e.a); break;
      case 'bin': r = isScalarExpr(e.a) && isScalarExpr(e.b); break;
      case 'idx': r = e.args.length > 0 && e.args.every(isScalarExpr); break;
      default: r = false;
    }
    e.scalarShape = r;
  }
  return r!;
}

export class ScalarEval {
  /** Class of the value returned by the last successful `run`. */
  cls: Cls = 'double';

  /** `e` must satisfy `isScalarExpr`. */
  run(e: any, sc: Map<string, V>, end: EndRef | undefined): number | undefined {
    switch (e.k) {
      case 'num': this.cls = 'double'; return e.v;
      case 'id': {
        const v = sc.get(e.n);
        if (v === undefined || !isT(v) || v.data.length !== 1) return undefined;
        this.cls = v.cls; return v.data[0];
      }
      case 'paren': return this.run(e.a, sc, end);
      case 'end': {
        if (end === undefined) return undefined;
        const { t, pos, n } = end;
        this.cls = 'double';
        if (n === 1) return t.data.length;
        if (pos < n - 1) return t.dims[pos] ?? 1;
        let m = 1; for (let d = pos; d < t.dims.length; d++) m *= t.dims[d];
        return m;
      }
      case 'idx': {
        const v = sc.get(e.n);
        if (v === undefined || !isT(v)) return undefined;
        const args = e.args, k: number = args.length, dims = v.dims;
        let off = 0, stride = 1;
        for (let d = 0; d < k; d++) {
          const a = args[d];
          const i = this.run(a, sc, { t: v, pos: d, n: k });
          if (i === undefined || this.cls === 'logical') return undefined; // logical subscripts select, they do not position
          let size: number;
          if (k === 1) size = v.data.length;
          else if (d < k - 1) size = d < dims.length ? dims[d] : 1;
          else { size = 1; for (let q = d; q < dims.length; q++) size *= dims[q]; } // last subscript spans the remaining dimensions
          if (!(i >= 1 && i <= size && i === Math.floor(i))) return undefined;
          off += (i - 1) * stride; stride *= size;
        }
        this.cls = v.cls; return v.data[off];
      }
      case 'un': {
        const x = this.run(e.a, sc, end);
        if (x === undefined) return undefined;
        if (e.op === '~') { this.cls = 'logical'; return x === 0 ? 1 : 0; }
        if (e.op === '+') return x;
        const c = this.cls;
        this.cls = c === 'single' || isIntCls(c) ? c : 'double';
        return sat(this.cls, -x);
      }
      case 'bin': {
        const op: string = e.op;
        const x = this.run(e.a, sc, end);
        if (x === undefined) return undefined;
        if (op === '&&' || op === '||') {
          this.cls = 'logical';
          if (op === '&&' ? x === 0 : x !== 0) return op === '&&' ? 0 : 1;
          const y = this.run(e.b, sc, end);
          if (y === undefined) return undefined;
          this.cls = 'logical'; return y !== 0 ? 1 : 0;
        }
        const ca = this.cls;
        const y = this.run(e.b, sc, end);
        if (y === undefined) return undefined;
        const cb = this.cls;
        let r: number;
        switch (op) {
          case '<': this.cls = 'logical'; return x < y ? 1 : 0;
          case '<=': this.cls = 'logical'; return x <= y ? 1 : 0;
          case '>': this.cls = 'logical'; return x > y ? 1 : 0;
          case '>=': this.cls = 'logical'; return x >= y ? 1 : 0;
          case '==': this.cls = 'logical'; return x === y ? 1 : 0;
          case '~=': this.cls = 'logical'; return x !== y ? 1 : 0;
          case '&': this.cls = 'logical'; return x !== 0 && y !== 0 ? 1 : 0;
          case '|': this.cls = 'logical'; return x !== 0 || y !== 0 ? 1 : 0;
          case '+': r = x + y; break;
          case '-': r = x - y; break;
          case '*': case '.*': r = x * y; break;
          case '/': case './': r = x / y; break;
          case '\\': r = y / x; break;
          case '^': case '.^': r = Math.pow(x, y); break;
          default: return undefined;
        }
        // Result class, as in `outCls`.
        const ia = isIntCls(ca), ib = isIntCls(cb);
        if (ia && ib && ca !== cb) return undefined; // the general path reports this error
        this.cls = ia ? ca : ib ? cb : ca === 'single' || cb === 'single' ? 'single' : 'double';
        return this.cls === 'double' ? r : sat(this.cls, r);
      }
    }
    return undefined;
  }
}
