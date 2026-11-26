// =============================================================================
// runtimes/matlab/interp/src/colormaps.ts
// Colormap generators: m-by-3 rows with values in [0,1], following the MATLAB formulas.
// =============================================================================
export type Cmap = number[][];

/** One HSV color (all in [0,1]) -> RGB. */
function hsvToRgb(h: number, s: number, v: number): number[] {
  const f = (n: number) => { const k = (n + h * 6) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return [f(5), f(3), f(1)];
}

const rows = (m: number, f: (i: number) => number[]): Cmap => Array.from({ length: m }, (_, i) => f(i));

export const gray = (m: number): Cmap => rows(m, i => { const v = i / Math.max(m - 1, 1); return [v, v, v]; });

export function hot(m: number): Cmap {
  const n = Math.floor((3 * m) / 8);
  return rows(m, i => [
    i < n ? (i + 1) / n : 1,
    i < n ? 0 : i < 2 * n ? (i - n + 1) / n : 1,
    i < 2 * n ? 0 : (i - 2 * n + 1) / (m - 2 * n),
  ]);
}

export function bone(m: number): Cmap {
  const g = gray(m), h = hot(m);
  return rows(m, i => [0, 1, 2].map(k => (7 * g[i][k] + h[i][2 - k]) / 8));
}

export function jet(m: number): Cmap {
  const n = Math.ceil(m / 4), u: number[] = [];
  for (let i = 1; i <= n; i++) u.push(i / n);
  for (let i = 1; i < n; i++) u.push(1);
  for (let i = n; i >= 1; i--) u.push(i / n);
  const g0 = Math.ceil(n / 2) - (m % 4 === 1 ? 1 : 0), g = u.map((_, i) => g0 + i + 1); // 1-based rows
  const out = rows(m, () => [0, 0, 0]);
  const gi = g.filter(x => x <= m), ri = g.map(x => x + n).filter(x => x <= m), bi = g.map(x => x - n).filter(x => x >= 1);
  ri.forEach((r, i) => { out[r - 1][0] = u[i]; });
  gi.forEach((r, i) => { out[r - 1][1] = u[i]; });
  bi.forEach((r, i) => { out[r - 1][2] = u[u.length - bi.length + i]; });
  return out;
}

export const hsv = (m: number): Cmap => rows(m, i => hsvToRgb(i / Math.max(m, 1), 1, 1));

/** Approximation of MATLAB's default colormap: linear interpolation between nine anchor colors. */
const PARULA: Cmap = [[0.2422, 0.1504, 0.6603], [0.2780, 0.2856, 0.8995], [0.2440, 0.4358, 0.9988], [0.1540, 0.5902, 0.9218], [0.0265, 0.7020, 0.7973],
  [0.2161, 0.7843, 0.5923], [0.6473, 0.7456, 0.1885], [0.9990, 0.7653, 0.2164], [0.9769, 0.9839, 0.0805]];
export const parula = (m: number): Cmap => rows(m, i => {
  const p = (i / Math.max(m - 1, 1)) * (PARULA.length - 1), a = Math.min(PARULA.length - 2, Math.floor(p)), f = p - a;
  return [0, 1, 2].map(k => PARULA[a][k] * (1 - f) + PARULA[a + 1][k] * f);
});

export const COLORMAPS: Record<string, (m: number) => Cmap> = { gray, jet, hot, bone, hsv, parula };
