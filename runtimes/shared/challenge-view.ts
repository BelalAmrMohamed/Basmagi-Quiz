// =============================================================================
// runtimes/shared/challenge-view.ts
// UI of challenge cells: header (badge, target output, hint, reset), the pass/fail banner
// shown under the cell, and the author panel (edit mode only). Grading lives in challenge.ts.
// =============================================================================
import type { Ctx, UiCell } from './ctx';
import { h } from './dom';
import { differingLines, type Challenge } from './challenge';

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
    h('span', { class: 'ch-goal' }, ctx.isEdit() ? t('Your code is the solution. Run it to capture the expected output.') : t('Write code that prints the target output.')),
    h('span', { class: 'sp' }));
  if (ch.hint && !ctx.isEdit()) head.append(h('button', { type: 'button', class: 'ch-btn', onclick: () => { c.hintShown = !c.hintShown; ctx.render(); } }, c.hintShown ? t('Hide hint') : t('Hint')));
  head.append(h('button', { type: 'button', class: 'ch-btn', onclick: () => { c.targetHidden = !c.targetHidden; ctx.render(); } }, c.targetHidden ? t('Show target output') : t('Hide target output')));
  if (!ctx.isEdit()) head.append(h('button', { type: 'button', class: 'ch-btn', disabled: ctx.state.busy, onclick: async () => {
    if (c.src === c.starter && !c.outs.length) return;
    if (await ctx.confirm(t('Reset to starter'), t('Replace your code in this cell with the starter code?'), t('Reset'))) ctx.resetChallenge(c);
  } }, t('Reset to starter')));
  const box = h('div', { class: 'ch-box' }, head);
  if (ch.hint && c.hintShown && !ctx.isEdit()) box.append(h('div', { class: 'ch-hint', dir: 'auto' }, h('b', {}, t('Hint') + ': '), ch.hint));
  if (!c.targetHidden) {
    box.append(h('div', { class: 'ch-target' },
      h('div', { class: 'ch-label' }, regex ? t('Expected pattern') : t('Target output')
        + (ch.matchMode === 'numeric' ? ' · ' + t('numbers may differ slightly') : '')),
      lines(ch.expectedOutput || (ctx.isEdit() ? t('Run the cell to capture the expected output.') : t('(no output)')), null)));
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
  if (ch.solution && !ch.hideSolution) {
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

/**
 * Author controls (edit mode). Deliberately tiny: the cell's own code is the model solution and its output
 * (captured on every run) is the expected output, so the author only decides whether learners may reveal the
 * solution and may add a hint.
 */
export function challengeAuthor(ctx: Ctx, c: UiCell): HTMLElement {
  const { t } = ctx, ch = c.challenge as Challenge;
  const reveal = h('input', { type: 'checkbox', checked: !ch.hideSolution });
  reveal.onchange = () => { if (reveal.checked) delete ch.hideSolution; else ch.hideSolution = true; ctx.save(); };
  const hint = h('input', { class: 'ch-input', type: 'text', maxlength: 1000, dir: 'auto', placeholder: t('Hint for learners (optional)'), value: ch.hint ?? '' });
  hint.oninput = () => { if (hint.value.trim()) ch.hint = hint.value; else delete ch.hint; ctx.save(); };
  return h('div', { class: 'ch-author' },
    h('label', { class: 'ch-check' }, reveal, h('span', {}, t('Let learners reveal the solution (your code)'))),
    hint);
}
