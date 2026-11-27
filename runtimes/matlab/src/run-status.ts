// Toolbar status text of a running MATLAB program: "Running… line 12 · 40% · 7 s".
import type { T } from '../../shared/i18n';
import { formatElapsed } from '../../shared/run-progress';

export function formatRunStatus(t: T, info: { line: number; percent: number | null; elapsedMs: number }): string {
  const time = formatElapsed(info.elapsedMs, t);
  const parts = [t('Running…')];
  if (info.line > 0) parts.push(t('line {n}', { n: info.line }));
  if (info.percent !== null) parts.push(`${info.percent}%`);
  parts.push(time);
  return parts[0] + ' ' + parts.slice(1).join(' · ');
}
