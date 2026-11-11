// =============================================================================
// runtimes/shared/cell-view.ts
// One notebook cell: index label, hover tools (Run/Edit), cell menu, editor or rendered
// markdown, outputs, and the insert row. Shift+Enter / Ctrl+Enter live in editor.ts.
// =============================================================================
import { EditorView } from '@codemirror/view';
import type { Ctx, UiCell } from './ctx';
import { h } from './dom';
import { createEditorState } from './editor';
import { renderMarkdown, mdDirection } from './markdown';
import { renderOut } from './outputs';
import { challengeAuthor, challengeHeader, challengeResult } from './challenge-view';
import { actualOutput, normalizeOutput } from './challenge';

export function renderCell(ctx: Ctx, c: UiCell, i: number): HTMLElement {
  const { t, state } = ctx, cells = state.cells;
  const mv = (d: number) => () => {
    const j = i + d;
    if (j < 0 || j >= cells.length) return;
    [cells[i], cells[j]] = [cells[j], cells[i]];
    state.sel = j; ctx.save(); ctx.render();
  };
  const idx = h('span', { class: 'idx', 'aria-hidden': true }, c.type === 'md' ? '' : c.running ? 'In [*]:' : `In [${c.count ?? ' '}]:`);
  const tools = h('div', { class: 'tools' });
  if (c.type === 'code') {
    tools.append(h('button', { class: 'primary', disabled: state.busy, title: t('Run cell · Shift+Enter'), onclick: () => void ctx.runCell(c) }, t('▶ Run')));
  } else {
    tools.append(h('button', { title: t('Edit text cell'), onclick: () => { c.mdEdit = !c.mdEdit; ctx.render(); } }, c.mdEdit ? t('Done') : t('Edit')));
  }
  const insertAt = (type: 'code' | 'md', offset: number) => () => {
    const added = ctx.mkCell(type, type === 'md' ? '## Heading' : '');
    added.mdEdit = type === 'md';
    const at = i + offset;
    cells.splice(at, 0, added);
    state.sel = at; ctx.save(); ctx.render();
    if (added.type === 'code') ctx.focusEditor(added.id);
  };
  const menuItem = (label: string, action: () => void) =>
    h('button', { onclick: (e: MouseEvent) => { action(); (e.currentTarget as HTMLElement).closest('details')?.removeAttribute('open'); } }, label);
  const duplicate = () => {
    const copy = ctx.mkCell(c.type, c.src);
    if (c.stdin !== undefined) copy.stdin = c.stdin;
    if (c.challenge) { copy.challenge = structuredClone(c.challenge); copy.chRef = c.chRef; copy.starter = c.starter; }
    copy.mdEdit = c.type === 'md';
    cells.splice(i + 1, 0, copy);
    state.sel = i + 1; ctx.save(); ctx.render();
    if (copy.type === 'code') ctx.focusEditor(copy.id);
  };
  const remove = () => {
    cells.splice(i, 1);
    if (!cells.length) cells.push(ctx.mkCell('code', ''));
    state.sel = Math.min(state.sel, cells.length - 1); ctx.save(); ctx.render();
  };
  const options = h('details', { class: 'cell-menu' },
    h('summary', { title: t('Cell options'), 'aria-label': t('Cell options') }, '⋯'),
    h('div', { class: 'cell-menu-items' },
      menuItem(t('Insert code cell above'), insertAt('code', 0)),
      menuItem(t('Insert text cell above'), insertAt('md', 0)),
      menuItem(t('Duplicate cell'), duplicate),
      menuItem(t('Move cell up'), mv(-1)),
      menuItem(t('Move cell down'), mv(1)),
      ...(c.outs.length ? [menuItem(t('Clear cell output'), () => { c.outs = []; c.count = null; c.result = undefined; ctx.render(); })] : []),
      ...(c.type === 'code' && ctx.isEdit() ? [menuItem(c.challenge ? t('Remove challenge') : t('Make challenge'), () => {
        if (c.challenge) { delete c.challenge; delete c.starter; c.result = undefined; } else { c.challenge = { expectedOutput: normalizeOutput(actualOutput(c.outs)) }; c.starter = ''; }
        ctx.save(); ctx.render();
      })] : []),
      ...(c.challenge && !ctx.isEdit() ? [] : [menuItem(c.type === 'md' ? t('Convert to code') : t('Convert to text'), () => {
        c.type = c.type === 'md' ? 'code' : 'md'; c.outs = []; c.mdEdit = c.type === 'md';
        if (c.type === 'md') { delete c.stdin; delete c.challenge; c.result = undefined; }
        ctx.save(); ctx.render();
      })]),
      menuItem(t('Delete cell'), remove)));
  tools.append(h('span', { class: 'sp' }), options);

  const el = h('section', {
    class: 'cell' + (i === state.sel ? ' sel' : '') + (c.running ? ' running' : '') + (c.challenge && c.type === 'code' ? ' challenge' : ''), tabindex: -1,
    'aria-label': t(c.type === 'md' ? 'Text cell {n}' : 'Code cell {n}', { n: i + 1 }),
  }, idx, tools);
  el.addEventListener('focusin', () => {
    if (state.sel !== i) { state.sel = i; ctx.root.querySelectorAll('.cell').forEach((n, k) => n.classList.toggle('sel', k === i)); }
  });

  if (c.type === 'md' && !c.mdEdit) {
    const v = h('div', { class: 'md', dir: mdDirection(c.src) });
    v.innerHTML = renderMarkdown(c.src);
    v.ondblclick = () => { c.mdEdit = true; ctx.render(); };
    el.append(v);
  } else if (c.type === 'md') {
    const ta = h('textarea', { class: 'src mdsrc', dir: 'auto', spellcheck: false, rows: 1, 'data-cell': c.id });
    ta.value = c.src;
    const fit = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 2 + 'px'; };
    requestAnimationFrame(fit);
    ta.oninput = () => { c.src = ta.value; fit(); ctx.save(); };
    ta.onkeydown = (ev) => {
      if (ev.key === 'Enter' && (ev.shiftKey || ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); c.mdEdit = false; ctx.render(); }
      else if (ev.key === 'Tab') { ev.preventDefault(); const s = ta.selectionStart; ta.setRangeText('    ', s, ta.selectionEnd, 'end'); c.src = ta.value; fit(); ctx.save(); }
    };
    el.append(ta);
  } else {
    const host = h('div', { class: 'code-editor', dir: 'ltr', 'data-cell': c.id });
    if (c.challenge) el.append(challengeHeader(ctx, c));
    el.append(host);
    if (c.challenge && ctx.isEdit()) el.append(challengeAuthor(ctx, c));
    const st = ctx.editorStates.get(c.id) ?? createEditorState(ctx.engine, c.src, {
      runAdvance: () => ctx.runFromEditor(c, true),
      runStay: () => ctx.runFromEditor(c, false),
      escape: () => ctx.leaveEditor(c),
      change: (src, s) => { c.src = src; ctx.editorStates.set(c.id, s); ctx.save(); },
      pasteReplaced: (text) => {
        const parts = ctx.engine.splitPaste?.(text.replace(/\r\n?/g, '\n'));
        if (!parts) return;
        c.splitOffer = { src: text.replace(/\r\n?/g, '\n'), parts };
        setTimeout(() => { if (c.src.replace(/\r\n?/g, '\n') === c.splitOffer?.src) ctx.render(); else delete c.splitOffer; }, 0);
      },
    });
    const view = new EditorView({ state: st, parent: host });
    ctx.editors.set(c.id, view);
    ctx.editorStates.set(c.id, view.state);
    requestAnimationFrame(() => view.requestMeasure());
  }

  if (c.type === 'code' && c.splitOffer && c.src.replace(/\r\n?/g, '\n') === c.splitOffer.src) {
    const offer = c.splitOffer;
    el.append(h('div', { class: 'split-offer', role: 'status' },
      h('span', { dir: 'auto' }, '✂️ ' + t('You pasted a whole program. Split it into {n} cells?', { n: offer.parts.length })),
      h('button', { type: 'button', class: 'primary', onclick: () => {
        const i = ctx.state.cells.indexOf(c);
        if (i < 0) return;
        const made = offer.parts.map((p) => ctx.mkCell(p.type, p.src));
        delete c.splitOffer; ctx.editorStates.delete(c.id); ctx.editors.delete(c.id);
        ctx.state.cells.splice(i, 1, ...made); // replace the pasted cell, don't leave it behind
        ctx.save(); ctx.render();
      } }, t('Split into cells')),
      h('button', { type: 'button', onclick: () => { delete c.splitOffer; ctx.render(); } }, t('Keep as one cell'))));
  } else if (c.splitOffer) delete c.splitOffer;

  const outs = h('div', { class: 'outs' });
  const pend = c.pending;
  const lastOut = c.outs[c.outs.length - 1];
  // Terminal style: the program's last (unfinished) line of output is the prompt, and the box sits on that same line.
  const inlinePrompt = pend?.inline && lastOut?.k === 'text' ? lastOut : null;
  for (const o of c.outs) if (o !== inlinePrompt) outs.append(renderOut(ctx, c, o));
  if (pend) outs.append(inputRow(ctx, c, pend, inlinePrompt ? inlinePrompt.s : ''));
  if (c.challenge && c.type === 'code' && !c.running) { const banner = challengeResult(ctx, c); if (banner) outs.append(banner); }
  const insert = h('div', { class: 'cell-insert', role: 'group', 'aria-label': t('Insert a cell below') },
    h('button', { onclick: insertAt('code', 1) }, t('+ Code')), h('button', { onclick: insertAt('md', 1) }, t('+ Text')));
  el.append(outs, insert);
  return el;
}

/** Jupyter-style stdin box: label, then a bordered field. Enter submits, Shift+Enter adds a line, Esc cancels. */
function inputRow(ctx: Ctx, c: UiCell, p: NonNullable<UiCell['pending']>, priorText = ''): HTMLElement {
  const { t } = ctx, id = `stdin-${c.id}`;
  if (p.inline) return inlineInputRow(ctx, c, id, priorText, p);
  const field = h('textarea', { id, class: 'o-input-field', dir: 'ltr', rows: 1, spellcheck: false, autocomplete: 'off', 'data-stdin': c.id, maxlength: 4000 });
  field.value = p.value;
  const fit = () => { field.style.height = 'auto'; field.style.height = field.scrollHeight + 'px'; };
  requestAnimationFrame(fit);
  field.oninput = () => { p.value = field.value; fit(); };
  field.onkeydown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ctx.answerInput(c, field.value); }
    else if (e.key === 'Escape') { e.preventDefault(); ctx.answerInput(c, null); }
  };
  return h('div', { class: 'o-input' },
    h('label', { class: 'o-input-label', for: id }, p.label), field,
    h('span', { class: 'o-input-hint' }, t('Enter to run · Shift+Enter for a new line · Esc to cancel')));
}

/** Terminal-style stdin: earlier output lines, then "prompt text [ box ]" on one line. Enter submits, Ctrl+D ends the input, Esc cancels. */
function inlineInputRow(ctx: Ctx, c: UiCell, id: string, priorText: string, p: NonNullable<UiCell['pending']>): HTMLElement {
  const { t } = ctx;
  const cut = priorText.lastIndexOf('\n') + 1;
  const head = priorText.slice(0, cut), prompt = priorText.slice(cut);
  const field = h('input', { id, type: 'text', class: 'o-input-field o-input-inline', dir: 'ltr', spellcheck: false, autocomplete: 'off', 'data-stdin': c.id, maxlength: 4000, 'aria-label': prompt.trim() || t('Standard input'), placeholder: t('Type here, then press Enter') });
  field.value = p.value; // survives re-renders
  field.oninput = () => { p.value = field.value; };
  field.onkeydown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); ctx.answerInput(c, field.value); }
    else if (e.key === 'Escape') { e.preventDefault(); ctx.answerInput(c, null); }
    else if ((e.key === 'd' || e.key === 'D') && e.ctrlKey) { e.preventDefault(); ctx.answerInput(c, '\u0004'); }
  };
  return h('div', { class: 'o-term' },
    head ? h('pre', { class: 'o' }, head) : null,
    h('label', { class: 'o-term-row', for: id }, h('pre', { class: 'o o-term-prompt' }, prompt), field),
    h('span', { class: 'o-input-hint' }, t('Enter to send · Ctrl+D ends input · Esc stops')));
}
