// =============================================================================
// runtimes/shared/challenge.ts
// Output-based grading of challenge cells. Pure functions (no DOM, no language knowledge):
// the learner's code is judged on what it printed, never on its source text.
// =============================================================================
import type { Out } from './engine';

export type MatchMode = 'exact' | 'trimmed' | 'regex' | 'numeric';
export type Challenge = {
  expectedOutput: string;
  /** Standard input fed to the program when graded (engines with stdin only). */
  testStdin?: string;
  hint?: string;
  /** Default 'trimmed'. */
  matchMode?: MatchMode;
  /** numeric mode only: |a-b| <= tolerance * max(1, |b|). Default 1e-6. */
  tolerance?: number;
  /** Model solution code. Learners can reveal it after their first attempt. */
  solution?: string;
};
export type ChallengeResult =
  | { state: 'pass'; actual: string }
  | { state: 'fail'; actual: string }
  /** The cell raised a compile/runtime error, so there is nothing to compare yet. */
  | { state: 'error'; actual: string };

export const DEFAULT_TOLERANCE = 1e-6;

/** CRLF -> LF, trailing whitespace stripped on every line, trailing empty lines dropped. */
export function normalizeOutput(s: string): string {
  return s.replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/[ \t\f\v]+$/, '')).join('\n').replace(/\n+$/, '');
}

/** Everything the cell printed to stdout (text outputs), in order. */
export function actualOutput(outs: Out[]): string {
  let text = '';
  for (const o of outs) if (o.k === 'text') text += o.s;
  return text;
}

const NUM = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/;

function numericMatch(actual: string, expected: string, tol: number): boolean {
  const a = actual.split(/\s+/).filter(Boolean), e = expected.split(/\s+/).filter(Boolean);
  if (a.length !== e.length) return false;
  return a.every((tok, i) => {
    const want = e[i];
    if (NUM.test(tok) && NUM.test(want)) { const x = Number(tok), y = Number(want); return Math.abs(x - y) <= tol * Math.max(1, Math.abs(y)); }
    return tok === want;
  });
}

export function matches(ch: Challenge, actualRaw: string): boolean {
  const mode = ch.matchMode ?? 'trimmed';
  if (mode === 'exact') return actualRaw.replace(/\r\n?/g, '\n') === ch.expectedOutput.replace(/\r\n?/g, '\n');
  const actual = normalizeOutput(actualRaw);
  if (mode === 'regex') {
    try { return new RegExp(`^(?:${ch.expectedOutput})$`, 's').test(actual); } catch { return false; }
  }
  const expected = normalizeOutput(ch.expectedOutput);
  if (mode === 'numeric') return numericMatch(actual, expected, ch.tolerance ?? DEFAULT_TOLERANCE);
  return actual === expected;
}

export function gradeCell(ch: Challenge, outs: Out[], hadError: boolean): ChallengeResult {
  const actual = actualOutput(outs);
  if (hadError) return { state: 'error', actual };
  return { state: matches(ch, actual) ? 'pass' : 'fail', actual };
}

/** Line numbers (0-based) of `actual` that differ from the same line of `expected` (for highlighting). */
export function differingLines(actual: string, expected: string): Set<number> {
  const a = normalizeOutput(actual).split('\n'), e = normalizeOutput(expected).split('\n');
  const out = new Set<number>();
  for (let i = 0; i < Math.max(a.length, e.length); i++) if (a[i] !== e[i]) out.add(i);
  return out;
}

/** Copy of a challenge safe to hand to the host (only known keys, no undefined). */
export function cleanChallenge(raw: unknown): Challenge | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const out: Challenge = { expectedOutput: typeof r.expectedOutput === 'string' ? r.expectedOutput : '' };
  if (typeof r.testStdin === 'string' && r.testStdin !== '') out.testStdin = r.testStdin;
  if (typeof r.hint === 'string' && r.hint.trim()) out.hint = r.hint;
  if (r.matchMode === 'exact' || r.matchMode === 'regex' || r.matchMode === 'numeric') out.matchMode = r.matchMode;
  if (typeof r.tolerance === 'number' && Number.isFinite(r.tolerance) && r.tolerance >= 0 && out.matchMode === 'numeric') out.tolerance = r.tolerance;
  if (typeof r.solution === 'string' && r.solution.trim()) out.solution = r.solution;
  return out;
}
