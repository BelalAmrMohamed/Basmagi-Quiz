// Phase 7: complex numbers (plan D4) and the frequency-domain functions.
// A complex value is a T with an extra `im` array; only the functions in COMPLEX_OK accept one.
import { T, V, mk, num, ew, isT, isStr, toStr, scalarOf, numel, matmul, cplx, reOf, imOf, isComplex, complexBody, Cls, display } from './values';
import { Def, err, T_ } from './lib-common';
import type { Builtin } from './lib-common';

/** Builtins that may receive a complex argument; every other one throws `<fn>: complex values are not supported`. */
export const COMPLEX_OK = new Set(('fft ifft fft2 ifft2 fftshift ifftshift abs angle real imag conj isreal exp sum mean disp display ' +
  'size numel length ndims isempty class isnumeric isfloat isa isvector isscalar ismatrix isrow iscolumn rows columns').split(' '));

const z = (t: T) => new Float64Array(t.data.length);

// ---------- arithmetic ----------
/** Elementwise complex op with implicit expansion: pair codes (i*nb+j) from `ew` carry the broadcast indices. */
function pairs(a: T, b: T, f: (ar: number, ai: number, br: number, bi: number) => [number, number]): T {
  const na = a.data.length, nb = b.data.length;
  const ia = mk('double', a.dims.slice()), ib = mk('double', b.dims.slice());
  for (let i = 0; i < na; i++) ia.data[i] = i;
  for (let i = 0; i < nb; i++) ib.data[i] = i;
  const codes = ew(ia, ib, (x, y) => x * nb + y, 'double');
  const n = codes.data.length, re = new Float64Array(n), im = new Float64Array(n);
  const ai = a.im ?? z(a), bi = b.im ?? z(b);
  for (let k = 0; k < n; k++) {
    const i = Math.floor(codes.data[k] / nb), j = codes.data[k] - i * nb;
    const r = f(a.data[i], ai[i], b.data[j], bi[j]); re[k] = r[0]; im[k] = r[1];
  }
  return cplx({ cls: 'double', dims: codes.dims, data: re }, im);
}
const cdiv = (ar: number, ai: number, br: number, bi: number): [number, number] => {
  if (bi === 0) return [ar / br, ai / br];
  const d = br * br + bi * bi; return [(ar * br + ai * bi) / d, (ai * br - ar * bi) / d];
};
const cpow = (ar: number, ai: number, br: number, bi: number): [number, number] => {
  if (ar === 0 && ai === 0) return br === 0 && bi === 0 ? [1, 0] : [0, 0];
  const lr = Math.log(Math.hypot(ar, ai)), th = Math.atan2(ai, ar);
  const er = br * lr - bi * th, ei = bi * lr + br * th, m = Math.exp(er);
  return [m * Math.cos(ei), m * Math.sin(ei)];
};
export function complexBinop(op: string, a: T, b: T): T {
  const mul = (ar: number, ai: number, br: number, bi: number): [number, number] => [ar * br - ai * bi, ar * bi + ai * br];
  switch (op) {
    case '+': return pairs(a, b, (ar, ai, br, bi) => [ar + br, ai + bi]);
    case '-': return pairs(a, b, (ar, ai, br, bi) => [ar - br, ai - bi]);
    case '.*': return pairs(a, b, mul);
    case './': return pairs(a, b, cdiv);
    case '.^': return pairs(a, b, cpow);
    case '*':
      if (a.data.length === 1 || b.data.length === 1) return pairs(a, b, mul);
      { const ar = reOf(a), ai = imOf(a), br = reOf(b), bi = imOf(b);
        const rr = matmul(ar, br), ii = matmul(ai, bi), ri = matmul(ar, bi), ir = matmul(ai, br);
        return cplx({ cls: 'double', dims: rr.dims, data: rr.data.map((x, k) => x - ii.data[k]) }, ri.data.map((x, k) => x + ir.data[k])); }
    case '/': if (b.data.length === 1) return pairs(a, b, cdiv); break;
    case '==': case '~=': {
      const r = pairs(a, b, (ar, ai, br, bi) => [+(ar === br && ai === bi), 0]);
      const want = op === '==' ? 1 : 0;
      return { cls: 'logical', dims: r.dims, data: r.data.map(x => +(x === want)) };
    }
    case '<': case '<=': case '>': case '>=': case '&': case '|': {
      const rr = ew(reOf(a), reOf(b), (x, y) => (op === '<' ? +(x < y) : op === '<=' ? +(x <= y) : op === '>' ? +(x > y) : op === '>=' ? +(x >= y) : op === '&' ? +(x !== 0 && y !== 0) : +(x !== 0 || y !== 0)), 'logical');
      return rr;
    }
  }
  return err(`Operator '${op}' is not supported for complex values.`);
}

// ---------- FFT ----------
function fftPow2(re: Float64Array, im: Float64Array, inv: boolean) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (inv ? 2 : -2) * Math.PI / len, half = len >> 1;
    for (let i = 0; i < n; i += len) for (let k = 0; k < half; k++) {
      const wr = Math.cos(ang * k), wi = Math.sin(ang * k), a = i + k, b = a + half;
      const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
      re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
    }
  }
}
/** Unscaled DFT of one lane, in place: radix-2 for powers of two, Bluestein otherwise. */
function dftLane(re: Float64Array, im: Float64Array, inv: boolean) {
  const n = re.length; if (n <= 1) return;
  if ((n & (n - 1)) === 0) return fftPow2(re, im, inv);
  let m = 1; while (m < 2 * n - 1) m <<= 1;
  const s = inv ? 1 : -1, cr = new Float64Array(n), ci = new Float64Array(n);
  for (let k = 0; k < n; k++) { const a = Math.PI * ((k * k) % (2 * n)) / n; cr[k] = Math.cos(a); ci[k] = s * Math.sin(a); }
  const ar = new Float64Array(m), ai = new Float64Array(m), br = new Float64Array(m), bi = new Float64Array(m);
  for (let k = 0; k < n; k++) { ar[k] = re[k] * cr[k] - im[k] * ci[k]; ai[k] = re[k] * ci[k] + im[k] * cr[k]; }
  br[0] = cr[0]; bi[0] = -ci[0];
  for (let k = 1; k < n; k++) { br[k] = br[m - k] = cr[k]; bi[k] = bi[m - k] = -ci[k]; }
  fftPow2(ar, ai, false); fftPow2(br, bi, false);
  for (let k = 0; k < m; k++) { const r = ar[k] * br[k] - ai[k] * bi[k]; ai[k] = ar[k] * bi[k] + ai[k] * br[k]; ar[k] = r; }
  fftPow2(ar, ai, true);
  for (let k = 0; k < n; k++) { const xr = ar[k] / m, xi = ai[k] / m; re[k] = xr * cr[k] - xi * ci[k]; im[k] = xr * ci[k] + xi * cr[k]; }
}
/** Transform along 0-based `dim`, padding with zeros or cropping to length `len` first. */
function fftAlong(t: T, dim: number, len: number | undefined, inv: boolean): T {
  const dims = t.dims.concat(new Array(Math.max(0, dim + 1 - t.dims.length)).fill(1));
  const n0 = dims[dim], n = len ?? n0, inner = numel(dims.slice(0, dim)), outer = numel(dims.slice(dim + 1));
  const rd = dims.slice(); rd[dim] = n;
  const re = new Float64Array(inner * n * outer), im = new Float64Array(re.length), sim = t.im;
  const lr = new Float64Array(n), li = new Float64Array(n);
  for (let o = 0; o < outer; o++) for (let i = 0; i < inner; i++) {
    lr.fill(0); li.fill(0);
    for (let k = 0; k < Math.min(n, n0); k++) { const p = i + inner * (k + n0 * o); lr[k] = t.data[p]; li[k] = sim ? sim[p] : 0; }
    dftLane(lr, li, inv);
    for (let k = 0; k < n; k++) { const p = i + inner * (k + n * o); re[p] = inv ? lr[k] / n : lr[k]; im[p] = inv ? li[k] / n : li[k]; }
  }
  while (rd.length > 2 && rd[rd.length - 1] === 1) rd.pop();
  return { cls: 'double', dims: rd, data: re, im };
}
/** True when X(k) = conj(X(-k)) along `dims` (all other indices fixed), within a relative tolerance. */
function conjSym(t: T, dimsList: number[]): boolean {
  if (!t.im) return true;
  const d = t.dims, n = t.data.length, st: number[] = []; let m = 1;
  for (const x of d) { st.push(m); m *= x; }
  let mx = 0; for (let k = 0; k < n; k++) mx = Math.max(mx, Math.abs(t.data[k]), Math.abs(t.im[k]));
  const tol = 1e-10 * Math.max(mx, 1e-300), sub = new Array(d.length).fill(0);
  for (let p = 0; p < n; p++) {
    let q = 0; for (let k = 0; k < d.length; k++) q += (dimsList.includes(k) ? (d[k] - sub[k]) % d[k] : sub[k]) * st[k];
    if (Math.abs(t.data[p] - t.data[q]) > tol || Math.abs(t.im[p] + t.im[q]) > tol) return false;
    for (let k = 0; k < d.length; k++) { if (++sub[k] < d[k]) break; sub[k] = 0; }
  }
  return true;
}
const firstNS = (t: T) => { const i = t.dims.findIndex(x => x !== 1); return i < 0 ? 0 : i; };
function shiftDims(t: T, dimsList: number[], inverse: boolean): T {
  const d = t.dims, n = t.data.length, st: number[] = []; let m = 1;
  for (const x of d) { st.push(m); m *= x; }
  const re = new Float64Array(n), im = t.im ? new Float64Array(n) : undefined, sub = new Array(d.length).fill(0);
  for (let p = 0; p < n; p++) {
    let q = 0;
    for (let k = 0; k < d.length; k++) {
      const s = dimsList.includes(k) ? (inverse ? -Math.floor(d[k] / 2) : Math.floor(d[k] / 2)) : 0;
      q += (((sub[k] + s) % d[k]) + d[k]) % d[k] * st[k];
    }
    re[q] = t.data[p]; if (im) im[q] = t.im![p];
    for (let k = 0; k < d.length; k++) { if (++sub[k] < d[k]) break; sub[k] = 0; }
  }
  return im ? cplx({ cls: 'double', dims: d.slice(), data: re }, im) : { cls: t.cls, dims: d.slice(), data: re };
}

function lenArg(v: V | undefined, fn: string): number | undefined {
  if (v === undefined || (isT(v) && v.data.length === 0)) return undefined;
  const n = scalarOf(v as T); if (!Number.isInteger(n) || n < 0) err(`Error using ${fn}: Size argument must be a nonnegative integer scalar.`); return n;
}
export function registerComplex(B: Record<string, Builtin>, def: Def) {
  const sym = (a: V[]) => a.some(x => isStr(x) && toStr(x).toLowerCase() === 'symmetric');
  const args = (a: V[]) => a.filter(x => !isStr(x));
  const finish = (r: T, inv: boolean, src: T, dl: number[], opt: V[]): T => {
    if (!inv) return cplx(reOf(r), r.im!);
    const forceReal = sym(opt), noReal = opt.some(x => isStr(x) && toStr(x).toLowerCase() === 'nonsymmetric');
    if (forceReal || (!noReal && conjSym(src, dl))) return { cls: 'double', dims: r.dims, data: r.data };
    return cplx(reOf(r), r.im!);
  };
  for (const [name, inv] of [['fft', false], ['ifft', true]] as const) {
    def(name, a => {
      const x = T_(args(a)[0], name), p = args(a);
      const dim = p[2] ? scalarOf(T_(p[2], name)) - 1 : firstNS(x);
      return [finish(fftAlong(x, dim, lenArg(p[1], name), inv), inv, x, [dim], a)];
    });
  }
  for (const [name, inv] of [['fft2', false], ['ifft2', true]] as const) {
    def(name, a => {
      const x = T_(args(a)[0], name), p = args(a);
      const r = fftAlong(fftAlong(x, 0, lenArg(p[1], name), inv), 1, lenArg(p[2], name), inv);
      return [finish(r, inv, x, [0, 1], a)];
    });
  }
  for (const [name, inv] of [['fftshift', false], ['ifftshift', true]] as const) {
    def(name, a => {
      const x = T_(a[0], name);
      const dl = a[1] ? [scalarOf(T_(a[1], name)) - 1] : x.dims.map((_d, k) => k);
      return [shiftDims(x, dl, inv)];
    });
  }
  const part = (name: string, f: (re: number, im: number) => number): void => {
    def(name, a => { const t = T_(a[0], name); const r = mk('double', t.dims.slice()); for (let k = 0; k < t.data.length; k++) r.data[k] = f(t.data[k], t.im ? t.im[k] : 0); return [r]; });
  };
  const prevAbs = B.abs;
  part('abs', (r, i) => Math.hypot(r, i));
  const cabs = B.abs;
  def('abs', (a, n, I) => (isComplex(a[0]) ? cabs(a, n, I) : prevAbs(a, n, I)));
  part('angle', (r, i) => Math.atan2(i, r));
  part('imag', (_r, i) => i);
  // real/conj keep the class of real input
  def('real', a => { const t = T_(a[0], 'real'); return [{ cls: t.cls, dims: t.dims, data: t.data }]; });
  def('conj', a => { const t = T_(a[0], 'conj'); return [t.im ? cplx(reOf(t), t.im.map(x => -x)) : t]; });
  def('isreal', a => [num(+(isT(a[0]) && !a[0].im), 'logical')]);
  def('iscomplex', a => [num(+isComplex(a[0]), 'logical')]);
  COMPLEX_OK.add('iscomplex');
  const prevExp = B.exp;
  def('exp', (a, n, I) => {
    const t = a[0]; if (!isComplex(t)) return prevExp(a, n, I);
    const r = mk('double', t.dims.slice()), im = z(t);
    for (let k = 0; k < t.data.length; k++) { const m = Math.exp(t.data[k]); r.data[k] = m * Math.cos(t.im[k]); im[k] = m * Math.sin(t.im[k]); }
    return [cplx(r, im)];
  });
  for (const name of ['sum', 'mean']) {
    const prev = B[name];
    def(name, (a, n, I) => {
      if (!isComplex(a[0])) return prev(a, n, I);
      const r = prev([reOf(a[0]), ...a.slice(1)], n, I)[0] as T, i = prev([imOf(a[0]), ...a.slice(1)], n, I)[0] as T;
      return [cplx({ cls: 'double', dims: r.dims, data: r.data }, i.data)];
    });
  }
  const prevDisp = B.disp;
  def('disp', (a, n, I) => {
    if (isComplex(a[0])) { I.host.print(a[0].dims.length > 2 ? display('x', a[0], I.opts).replace(/^x =\n\n/, '') : complexBody(a[0]).replace(/$/, a[0].data.length === 1 ? '\n' : '')); return []; }
    return prevDisp(a, n, I);
  });
  def('i j', () => [cplx(mk('double', [1, 1]), Float64Array.of(1))]);
}
