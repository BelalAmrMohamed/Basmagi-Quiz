// =============================================================================
// runtimes/shared/run-progress.ts
// What the notebook shows about a long run: after 1.5 s a thin progress bar and an elapsed timer in the
// running cell's footer, after 5 s the Stop button turns primary and (once per session) the engine's tip
// about slow code appears. This file is the clock-and-state part and has no DOM, so it is unit-tested.
// =============================================================================
import type { T } from './i18n';

export const SHOW_AFTER_MS = 1500;
export const STOP_PRIMARY_AFTER_MS = 5000;
export const TIP_AFTER_MS = 5000;

/** Shared by every run of one page, so a tip is offered once per session. */
export interface TipSession { shown: boolean }

export interface ProgressView {
  /** Show the footer (bar and timer). */
  visible: boolean;
  /** 0..100, or null when the share done is unknown (the bar then moves without a position). */
  percent: number | null;
  elapsedMs: number;
  /** Make the Stop button visually primary. */
  stopPrimary: boolean;
  /** Show the engine's tip. True for the rest of the run once it has been offered. */
  tip: boolean;
}

export class RunProgress {
  private startedAt: number | null = null;
  private percent: number | null = null;
  private tipOffered = false;
  constructor(private session: TipSession = { shown: false }, private now: () => number = () => performance.now()) {}

  start() { this.startedAt = this.now(); this.percent = null; this.tipOffered = false; }
  /** `percent` is what the engine reported last; null when unknown. */
  update(percent: number | null) { this.percent = percent === null ? null : Math.min(100, Math.max(0, percent)); }
  stop() { this.startedAt = null; this.percent = null; this.tipOffered = false; }

  view(): ProgressView {
    if (this.startedAt === null) return { visible: false, percent: null, elapsedMs: 0, stopPrimary: false, tip: false };
    const elapsedMs = this.now() - this.startedAt;
    if (!this.tipOffered && elapsedMs >= TIP_AFTER_MS && !this.session.shown) { this.tipOffered = true; this.session.shown = true; }
    return { visible: elapsedMs >= SHOW_AFTER_MS, percent: this.percent, elapsedMs, stopPrimary: elapsedMs >= STOP_PRIMARY_AFTER_MS, tip: this.tipOffered };
  }
}

/** `7 s`, `59 s`, `1:05`. */
export function formatElapsed(ms: number, t: T): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s < 60 ? t('{n} s', { n: s }) : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
