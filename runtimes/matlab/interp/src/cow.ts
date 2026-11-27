// Copy-on-write (plan 6.1b). Assigning, passing or looping over an array shares its buffer; the copy
// is made by the first indexed write to a buffer that has more than one holder.
//
// Rule: every place that keeps an array's buffer (a variable, a cell or field element, a captured
// value, a `for` loop) must call `hold`. A buffer nobody recorded is never written in place.

/** Buffers up to this length are not tracked: copying them on every write is cheaper than bookkeeping. */
const TRACK_ABOVE = 16;

export class BufferOwners {
  /** Tests set this to false to get the reference behaviour (every indexed write copies). */
  inPlace = true;
  /** false: one holder. true: shared. */
  private shared = new WeakMap<Float64Array, boolean>();
  /** Record one more holder of `data`. */
  hold(data: Float64Array) { if (data.length > TRACK_ABOVE) this.shared.set(data, this.shared.has(data)); }
  /** True when `data` has exactly one holder, which may therefore write into it. */
  exclusive(data: Float64Array): boolean { return this.inPlace && this.shared.get(data) === false; }
}
