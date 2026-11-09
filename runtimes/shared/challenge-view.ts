// =============================================================================
// runtimes/shared/challenge-view.ts
// UI of challenge cells: header (badge, target output, hint, reset), the pass/fail banner
// shown under the cell, and the author panel (edit mode only). Grading lives in challenge.ts.
// =============================================================================
import type { Ctx, UiCell } from './ctx';
import { h } from './dom';
import { actualOutput, differingLines, normalizeOutput, type Challenge, type MatchMode } from './challenge';

const MODES: MatchMode[] = ['trimmed', 'exact', 'numeric', 'regex'];

function lines(text: string, mark: Set<number> | null): HTMLElement {
  const pre = h('pre', { class: 'ch-pre', dir: 'ltr' });
  const rows = text.length ? text.replace(/\n$/, '').split('\n') : [];
  rows.forEach((ln, i) => pre.append(h('span', { class: 'ch-line' + (mark?.has(i) ? ' diff' : '') }, ln + '\n')));
  return pre;
}

export function challengeHeader(ctx: Ctx, c: UiCell): HTMLElement {
  const { t } = ctx, ch = c.challenge as Challenge;
  const regex = ch.matchMode === 'regex';
  const head = h('div', { class: 'ch-head' },
    h('span', { class: 'ch-badge' }, '🏁 ' + t('Challenge')),
    h('span', { class: 'ch-goal' }, t('Write code that prints the target output.')),
    h('span', { class: 'sp' }));
  if (ch.hint) head.append(h('button', { type: 'button', class: 'ch-btn', onclick: () => { c.hintShown = !c.hintShown; ctx.render(); } }, c.hintShown ? t('Hide hint') : t('Hint')));
  head.append(h('button', { type: 'button', class: 'ch-btn', onclick: () => { c.targetHidden = !c.targetHidden; ctx.render(); } }, c.targetHidden ? t('Show target output') : t('Hide target output')));
  if (!ctx.isEdit()) head.append(h('button', { type: 'button', class: 'ch-btn', disabled: ctx.state.busy, onclick: async () => {
    if (c.src === c.starter && !c.outs.length) return;
    if (await ctx.confirm(t('Reset to starter'), t('Replace your code in this cell with the starter code?'), t('Reset'))) ctx.resetChallenge(c);
  } }, t('Reset to starter')));
  const box = h('div', { class: 'ch-box' }, head);
  if (ch.hint && c.hintShown) box.append(h('div', { class: 'ch-hint', dir: 'auto' }, h('b', {}, t('Hint') + ': '), ch.hint));
  if (!c.targetHidden) {
    box.append(h('div', { class: 'ch-target' },
      h('div', { class: 'ch-label' }, regex ? t('Expected pattern') : t('Target output')
        + (ch.matchMode === 'numeric' ? ' · ' + t('numbers may differ slightly') : '')),
      lines(ch.expectedOutput || t('(no output)'), null)));
  }
  return box;
}

/** Pass / fail / error banner under the cell. Null until the cell has been run. */
export function challengeResult(ctx: Ctx, c: UiCell): HTMLElement | null {
  const { t } = ctx, ch = c.challenge as Challenge, r = c.result;
  if (!r) return null;
  const out = h('div', { class: 'ch-result ' + r.state, role: 'status' });
  if (r.state === 'pass') {
    out.append(h('div', { class: 'ch-pill' }, '✓ ' + t('Output matches expected result!')),
      h('span', { class: 'ch-note' }, t('Attempts: {n}', { n: c.attempts ?? 1 })));
  } else if (r.state === 'error') {
    out.append(h('div', { class: 'ch-pill' }, '⚠ ' + t('Your code raised an error. Fix it and run again.')));
  } else {
    const mark = ch.matchMode === 'regex' || ch.matchMode === 'numeric' ? null : differingLines(r.actual, ch.expectedOutput);
    out.append(h('div', { class: 'ch-pill' }, '✗ ' + t('Not quite yet. Adjust your code and run again.')),
      h('div', { class: 'ch-cols' },
        h('div', { class: 'ch-col' }, h('div', { class: 'ch-label' }, t('Actual Output')), lines(r.actual.replace(/\r\n?/g, '\n') || t('(no output)'), mark)),
        h('div', { class: 'ch-col' }, h('div', { class: 'ch-label' }, ch.matchMode === 'regex' ? t('Expected pattern') : t('Expected Output')), lines(ch.expectedOutput || t('(no output)'), null))));
  }
  if (ch.solution) {
    if (c.solutionShown) {
      out.append(h('div', { class: 'ch-solution' }, h('div', { class: 'ch-label' }, t('Model solution')), h('pre', { class: 'ch-pre', dir: 'ltr' }, ch.solution),
        h('button', { type: 'button', class: 'ch-btn', onclick: () => { c.solutionShown = false; ctx.render(); } }, t('Hide solution'))));
    } else {
      out.append(h('button', { type: 'button', class: 'ch-btn', onclick: async () => {
        if (r.state !== 'pass' && !(await ctx.confirm(t('Show solution'), t('Try a little more first? Showing the model solution gives the answer away.'), t('Show solution')))) return;
        c.solutionShown = true; ctx.render();
      } }, t('Show solution')));
    }
  }
  return out;
}

const field = (label: string, control: HTMLElement) => h('label', { class: 'ch-field' }, h('span', { class: 'ch-label' }, label), control);

/** Author panel (edit mode): everything of `challenge` plus a "use the last output" shortcut. */
export function challengeAuthor(ctx: Ctx, c: UiCell): HTMLElement {
  const { t } = ctx, ch = c.challenge as Challenge;
  const text = (key: 'expectedOutput' | 'testStdin' | 'hint' | 'solution', rows: number, ltr = true) => {
    const ta = h('textarea', { class: 'ch-input', rows, spellcheck: false, dir: ltr ? 'ltr' : 'auto', maxlength: key === 'solution' ? 20000 : key === 'expectedOutput' ? 8000 : key === 'hint' ? 1000 : 4000 });
    ta.value = (ch[key] as string | undefined) ?? '';
    ta.oninput = () => { if (ta.value === '' && key !== 'expectedOutput') delete ch[key]; else ch[key] = ta.value; ctx.save(); };
    return ta;
  };
  const mode = h('select', { class: 'ch-input' }, ...MODES.map((m) => h('option', { value: m, selected: (ch.matchMode ?? 'trimmed') === m }, t('Match: ' + m))));
  mode.onchange = () => { if (mode.value === 'trimmed') delete ch.matchMode; else ch.matchMode = mode.value as MatchMode; if (ch.matchMode !== 'numeric') delete ch.tolerance; ctx.save(); ctx.render(); };
  const useOutput = h('button', { type: 'button', class: 'ch-btn', disabled: !actualOutput(c.outs), onclick: () => { ch.expectedOutput = normalizeOutput(actualOutput(c.outs)); ctx.save(); ctx.render(); } }, t('Use last output as expected'));
  const panel = h('div', { class: 'ch-author' },
    h('div', { class: 'ch-label' }, t('Challenge settings (authors only)')),
    field(t('Expected output'), text('expectedOutput', 3)), useOutput,
    field(t('Match mode'), mode));
  if (ch.matchMode === 'numeric') {
    const tol = h('input', { class: 'ch-input', type: 'number', min: 0, step: 'any', value: String(ch.tolerance ?? 1e-6) });
    tol.oninput = () => { const v = Number(tol.value); if (Number.isFinite(v) && v >= 0) { ch.tolerance = v; ctx.save(); } };
    panel.append(field(t('Tolerance'), tol));
  }
  if (ctx.engine.caps.stdin) panel.append(field(t('Test input (stdin)'), text('testStdin', 2)));
  panel.append(field(t('Hint (optional)'), text('hint', 2, false)), field(t('Model solution code (optional, learners can reveal it)'), text('solution', 4)));
  return panel;
}
