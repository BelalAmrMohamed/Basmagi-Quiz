// =============================================================================
// runtimes/matlab/interp/src/lib-edge.ts
// Edge detection (plan Phase 5.3): edge(I, method, thresh, ...) for sobel, prewitt, roberts, log and canny.
// =============================================================================
import { T, V, Cls, isStr, toStr, mk, num, str, toUnit, INT_RANGE } from './values';
import { Def, T_, err } from './lib-common';
import { filterT, fspecial } from './lib-filter';

const REPL = { k: 'replicate' } as const;
const lc = (v: V) => toStr(v).toLowerCase();
/** Row-major literal -> column-major array. */
const rows = (r: number[][], div = 1) => { const R = r.length, C = r[0].length, o = new Float64Array(R * C); for (let i = 0; i < R; i++) for (let j = 0; j < C; j++) o[i + R * j] = r[i][j] / div; return o; };

const SOBEL = { gx: rows([[1, 0, -1], [2, 0, -2], [1, 0, -1]], 8), gy: rows([[1, 2, 1], [0, 0, 0], [-1, -2, -1]], 8), k: 3, scale: 4 };
const PREWITT = { gx: rows([[1, 0, -1], [1, 0, -1], [1, 0, -1]], 6), gy: rows([[1, 1, 1], [0, 0, 0], [-1, -1, -1]], 6), k: 3, scale: 4 };
const ROBERTS = { gx: rows([[1, 0], [0, -1]]), gy: rows([[0, 1], [-1, 0]]), k: 2, scale: 6 };

/** Correlation of an m x n double image with a k x k kernel (replicated borders, window origin as imfilter). */
const corr = (img: T, h: Float64Array, k: number) => filterT(img, h, k, k, -Math.floor((k - 1) / 2), -Math.floor((k - 1) / 2), img.dims[0], img.dims[1], REPL, 'double');

/** Gradient-magnitude edges with thinning (sobel, prewitt, roberts). */
function gradientEdge(img: T, op: typeof SOBEL, thresh: number | null, dir: string, thinning: boolean): [T, number] {
  const m = img.dims[0], n = img.dims[1];
  const gx = dir === 'horizontal' ? null : corr(img, op.gx, op.k), gy = dir === 'vertical' ? null : corr(img, op.gy, op.k);
  const N = m * n, ax = new Float64Array(N), ay = new Float64Array(N), b = new Float64Array(N);
  let sum = 0;
  for (let i = 0; i < N; i++) { ax[i] = gx ? Math.abs(gx.data[i]) : 0; ay[i] = gy ? Math.abs(gy.data[i]) : 0; b[i] = ax[i] * ax[i] + ay[i] * ay[i]; sum += b[i]; }
  const cutoff = thresh === null ? (op.scale * sum) / N : thresh * thresh, e = mk('logical', [m, n]);
  const at = (r: number, c: number) => r + m * c;
  if (!thinning) { for (let i = 0; i < N; i++) e.data[i] = b[i] > cutoff ? 1 : 0; }
  else {
    for (let c = 1; c < n - 1; c++) for (let r = 1; r < m - 1; r++) {
      const i = at(r, c), v = b[i];
      if (!(v > cutoff)) continue;
      if ((ay[i] <= ax[i] && v >= b[at(r, c - 1)] && v > b[at(r, c + 1)]) || (ax[i] <= ay[i] && v >= b[at(r - 1, c)] && v > b[at(r + 1, c)])) e.data[i] = 1;
    }
  }
  return [e, Math.sqrt(cutoff)];
}

/** Zero crossings of the LoG response whose slope exceeds thresh (the negative pixel of each +/- pair is marked). */
function logEdge(img: T, thresh: number | null, sigma: number): [T, number] {
  const m = img.dims[0], n = img.dims[1], size = Math.ceil(sigma * 3) * 2 + 1;
  const h = fspecial([str('log'), num(size), num(sigma)]);
  const b = corr(img, h.data, size).data, e = mk('logical', [m, n]);
  if (m < 3 || n < 3) return [e, thresh ?? 0];
  const at = (r: number, c: number) => r + m * c;
  if (thresh === null) { let s = 0; for (let c = 1; c < n - 1; c++) for (let r = 1; r < m - 1; r++) s += Math.abs(b[at(r, c)]); thresh = 0.75 * (s / ((m - 2) * (n - 2))); }
  const t = thresh;
  for (let c = 1; c < n - 1; c++) for (let r = 1; r < m - 1; r++) {
    const v = b[at(r, c)], nb = [b[at(r, c + 1)], b[at(r, c - 1)], b[at(r + 1, c)], b[at(r - 1, c)]];
    let hit = false;
    if (v < 0) hit = nb.some(w => w > 0 && Math.abs(v - w) > t);
    else if (v === 0) hit = (nb[1] * nb[0] < 0 && Math.abs(nb[1] - nb[0]) > t) || (nb[3] * nb[2] < 0 && Math.abs(nb[3] - nb[2]) > t);
    if (hit) e.data[at(r, c)] = 1;
  }
  return [e, t];
}

/** Canny: derivative-of-Gaussian gradient, non-maximum suppression along the quantised gradient direction, hysteresis. */
function cannyEdge(img: T, thresh: number[] | null, sigma: number): [T, number[]] {
  const m = img.dims[0], n = img.dims[1], N = m * n, E = Math.ceil(4 * sigma), L = 2 * E + 1, e = mk('logical', [m, n]);
  const g = new Float64Array(L); let gs = 0;
  for (let i = 0; i < L; i++) { g[i] = Math.exp(-((i - E) ** 2) / (2 * sigma * sigma)); gs += g[i]; }
  for (let i = 0; i < L; i++) g[i] /= gs;
  const d = new Float64Array(L); // MATLAB gradient(): central differences, one-sided at the ends
  for (let i = 0; i < L; i++) d[i] = i === 0 ? g[1] - g[0] : i === L - 1 ? g[L - 1] - g[L - 2] : (g[i + 1] - g[i - 1]) / 2;
  let sp = 0, sn = 0; for (const v of d) { if (v > 0) sp += v; else if (v < 0) sn -= v; }
  for (let i = 0; i < L; i++) d[i] = d[i] > 0 ? d[i] / sp : d[i] < 0 ? d[i] / sn : 0;
  const nd = d.map(v => -v); // convolution with d = correlation with the reversed (negated) kernel
  const pass = (t: T, h: Float64Array, vertical: boolean) => vertical ? filterT(t, h, L, 1, -E, 0, m, n, REPL, 'double') : filterT(t, h, 1, L, 0, -E, m, n, REPL, 'double');
  const dx = pass(pass(img, g, true), nd, false).data, dy = pass(pass(img, g, false), nd, true).data;
  const mag = new Float64Array(N); let mx = 0;
  for (let i = 0; i < N; i++) { mag[i] = Math.hypot(dx[i], dy[i]); if (mag[i] > mx) mx = mag[i]; }
  if (mx > 0) for (let i = 0; i < N; i++) mag[i] /= mx;
  let lo: number, hi: number;
  if (thresh && thresh.length >= 2) [lo, hi] = thresh;
  else if (thresh && thresh.length === 1) { hi = thresh[0]; lo = 0.4 * hi; }
  else {
    const counts = new Float64Array(64);
    for (let i = 0; i < N; i++) counts[Math.round(mag[i] * 63)]++;
    let acc = 0, k = 0;
    for (; k < 64; k++) { acc += counts[k]; if (acc > 0.7 * N) break; }
    hi = (Math.min(k, 63) + 1) / 64; lo = 0.4 * hi;
  }
  if (!(lo >= 0 && lo <= hi && hi < 1)) err('Error using edge: Canny thresholds must satisfy 0 <= low <= high < 1.');
  const at = (r: number, c: number) => r + m * c, weak = new Uint8Array(N), stack: number[] = [];
  for (let c = 1; c < n - 1; c++) for (let r = 1; r < m - 1; r++) {
    const i = at(r, c), v = mag[i];
    if (!(v > lo)) continue;
    const a = (Math.atan2(dy[i], dx[i]) + Math.PI) % Math.PI, deg = (a * 180) / Math.PI;
    const [dr, dc] = deg < 22.5 || deg >= 157.5 ? [0, 1] : deg < 67.5 ? [1, 1] : deg < 112.5 ? [1, 0] : [1, -1];
    if (v >= mag[at(r - dr, c - dc)] && v > mag[at(r + dr, c + dc)]) { weak[i] = 1; if (v > hi) { e.data[i] = 1; stack.push(i); } }
  }
  while (stack.length) { // hysteresis: weak pixels 8-connected to a strong one
    const i = stack.pop() as number, r = i % m, c = (i - r) / m;
    for (let dc = -1; dc <= 1; dc++) for (let dr = -1; dr <= 1; dr++) {
      const rr = r + dr, cc = c + dc;
      if (rr < 0 || cc < 0 || rr >= m || cc >= n) continue;
      const j = at(rr, cc);
      if (weak[j] && !e.data[j]) { e.data[j] = 1; stack.push(j); }
    }
  }
  return [e, [lo, hi]];
}

export function registerEdge(def: Def) {
  def('edge', (a, nargout) => {
    const I = T_(a[0], 'edge');
    if (I.cls === 'char') err('Error using edge: Expected input number 1, I, to be one of these types: uint8, uint16, int16, single, double, logical');
    if (I.dims.length > 2) err('Error using edge: Expected input number 1, I, to be two-dimensional.');
    const method = a[1] === undefined ? 'sobel' : lc(a[1]);
    const img = mk('double', I.dims.slice(), I.data.map(v => (INT_RANGE[I.cls as Cls] ? toUnit(I.cls, v) : v)));
    const th = a[2] === undefined || isStr(a[2]) ? null : T_(a[2], 'edge'), thv = th && th.data.length ? Array.from(th.data) : null;
    const rest = a.slice(isStr(a[2]) ? 2 : 3);
    const strs = rest.filter(isStr).map(lc), nums = rest.filter(v => !isStr(v)).map(v => T_(v, 'edge').data[0]);
    const known = ['both', 'horizontal', 'vertical', 'thinning', 'nothinning'];
    const bad = strs.find(s => !known.includes(s));
    if (method === 'sobel' || method === 'prewitt' || method === 'roberts') {
      if (bad) err(`Error using edge: Invalid option '${bad}'.`);
      if (thv && thv.length !== 1) err('Error using edge: THRESH must be a scalar for this method.');
      if (thv && thv[0] < 0) err('Error using edge: THRESH must be nonnegative.');
      const dir = method === 'roberts' ? 'both' : strs.find(s => s === 'horizontal' || s === 'vertical') ?? 'both';
      const [e, t] = gradientEdge(img, method === 'sobel' ? SOBEL : method === 'prewitt' ? PREWITT : ROBERTS, thv ? thv[0] : null, dir, !strs.includes('nothinning'));
      return nargout > 1 ? [e, num(t)] : [e];
    }
    if (method === 'log') {
      const sigma = nums.length ? nums[0] : 2;
      if (!(sigma > 0)) err('Error using edge: SIGMA must be positive.');
      if (thv && thv.length !== 1) err('Error using edge: THRESH must be a scalar for this method.');
      const [e, t] = logEdge(img, thv ? thv[0] : null, sigma);
      return nargout > 1 ? [e, num(t)] : [e];
    }
    if (method === 'canny') {
      const sigma = nums.length ? nums[0] : Math.SQRT2;
      if (!(sigma > 0)) err('Error using edge: SIGMA must be positive.');
      const [e, t] = cannyEdge(img, thv, sigma);
      return nargout > 1 ? [e, mk('double', [1, 2], t)] : [e];
    }
    return err(`Error using edge: Unknown method '${toStr(a[1])}'. Use 'sobel', 'prewitt', 'roberts', 'log' or 'canny'.`);
  });
}
