// =============================================================================
// runtimes/shared/plot-spec.ts
// Serializable description of a figure: what the interpreter posts (`Host.figure`) and what the
// `plot` output kind carries to plot-view.ts. Types only: no code, no DOM.
// =============================================================================

/** MATLAB LineSpec parsed into parts, e.g. 'r--o' -> { color: 'r', style: '--', marker: 'o' }. */
export type LineSpec = { color?: string | [number, number, number]; style?: '-' | '--' | ':' | '-.' | 'none'; marker?: string; width?: number };

export type PlotItem =
  /** `rgb` is row-major, 3 bytes per pixel, already mapped through the colormap. `range` is the [lo hi] used (for colorbar labels). */
  | { t: 'image'; w: number; h: number; rgb: Uint8Array; range?: [number, number]; name?: string }
  | { t: 'line'; x: number[]; y: number[]; spec: LineSpec }
  | { t: 'bar'; x: number[]; y: number[]; width: number }
  | { t: 'stem'; x: number[]; y: number[] }
  | { t: 'scatter'; x: number[]; y: number[] }
  | { t: 'text'; x: number; y: number; s: string };

export interface PlotAxes {
  /** 0-based cell of the figure grid (row-major: subplot index p = r * cols + c + 1). */
  r: number; c: number;
  items: PlotItem[];
  title: string; xlabel: string; ylabel: string;
  /** null = automatic. */
  xlim: [number, number] | null; ylim: [number, number] | null;
  grid: boolean; legend: string[]; hold: boolean;
  /** Nx3 values in [0,1]; null = default. */
  colormap: number[][] | null;
  colorbar: boolean;
  /** axis equal / axis tight / axis square / axis off. */
  equal: boolean; tight: boolean; square: boolean; off: boolean;
}

export interface FigureSpec { rows: number; cols: number; axes: PlotAxes[] }
