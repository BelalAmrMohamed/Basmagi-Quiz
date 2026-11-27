/** Share of a run that is done, from the loops being run (outermost first, `iter` counted from 1). */
export type LoopState = { iter: number; total: number };

/**
 * Fraction 0..1 of the outermost loop's work that is done: (outerIter - 1 + innerFraction) / outerTotal, recursively.
 * The iteration in progress does not count as done. Null when there is no loop or the outermost trip count is not
 * finite (`while`, `1:Inf`), so only elapsed time can be shown. A non-finite inner count contributes nothing.
 */
export function progressFraction(loops: readonly LoopState[]): number | null {
  const outer = loops[0];
  if (!outer || !Number.isFinite(outer.total) || outer.total <= 0) return null;
  let f = 0;
  for (let i = loops.length - 1; i >= 0; i--) {
    const { iter, total } = loops[i];
    f = Number.isFinite(total) && total > 0 ? (Math.max(0, iter - 1) + f) / total : 0;
  }
  return Math.min(1, Math.max(0, f));
}

/** `progressFraction` as a whole percent, never 100 while the loop still runs; null when unknown. */
export function progressPercent(loops: readonly LoopState[]): number | null {
  const f = progressFraction(loops);
  return f === null ? null : Math.min(99, Math.floor(f * 100 + 1e-9));
}
