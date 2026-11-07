// =============================================================================
// runtimes/shared/cell-view.ts
// One notebook cell: index label, hover tools (Run/Edit), cell menu, editor or rendered
// markdown, outputs, and the insert row. Shift+Enter / Ctrl+Enter live in editor.ts.
// =============================================================================
import { EditorView } from '@codemirror/view';
import type { Ctx, UiCell } from './ctx';
import { h } from './dom';
import { createEditorState } from './editor';
import { renderMarkdown } from './markdown';
import { renderOut } from './outputs';

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
      ...(c.outs.length ? [menuItem(t('Clear cell output'), () => { c.outs = []; c.count = null; ctx.render(); })] : []),
      menuItem(c.type === 'md' ? t('Convert to code') : t('Convert to text'), () => {
        c.type = c.type === 'md' ? 'code' : 'md'; c.outs = []; c.mdEdit = c.type === 'md';
        if (c.type === 'md') delete c.stdin;
        ctx.save(); ctx.render();
      }),
      menuItem(t('Delete cell'), remove)));
  tools.append(h('span', { class: 'sp' }), options);

  const el = h('section', {
    class: 'cell' + (i === state.sel ? ' sel' : '') + (c.running ? ' running' : ''), tabindex: -1,
    'aria-label': t(c.type === 'md' ? 'Text cell {n}' : 'Code cell {n}', { n: i + 1 }),
  }, idx, tools);
  el.addEventListener('focusin', () => {
    if (state.sel !== i) { state.sel = i; ctx.root.querySelectorAll('.cell').forEach((n, k) => n.classList.toggle('sel', k === i)); }
  });

  if (c.type === 'md' && !c.mdEdit) {
    const v = h('div', { class: 'md' });
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
    el.append(host);
    const st = ctx.editorStates.get(c.id) ?? createEditorState(ctx.engine, c.src, {
      runAdvance: () => ctx.runFromEditor(c, true),
      runStay: () => ctx.runFromEditor(c, false),
      escape: () => ctx.leaveEditor(c),
      change: (src, s) => { c.src = src; ctx.editorStates.set(c.id, s); ctx.save(); },
    });
    const view = new EditorView({ state: st, parent: host });
    ctx.editors.set(c.id, view);
    ctx.editorStates.set(c.id, view.state);
    requestAnimationFrame(() => view.requestMeasure());
  }

  const outs = h('div', { class: 'outs' });
  for (const o of c.outs) outs.append(renderOut(ctx, c, o));
  if (c.pending) outs.append(inputRow(ctx, c, c.pending));
  const insert = h('div', { class: 'cell-insert', role: 'group', 'aria-label': t('Insert a cell below') },
    h('button', { onclick: insertAt('code', 1) }, t('+ Code')), h('button', { onclick: insertAt('md', 1) }, t('+ Text')));
  el.append(outs, insert);
  return el;
}

/** Jupyter-style stdin box: label, then a bordered field. Enter submits, Shift+Enter adds a line, Esc cancels. */
function inputRow(ctx: Ctx, c: UiCell, p: NonNullable<UiCell['pending']>): HTMLElement {
  const { t } = ctx, id = `stdin-${c.id}`;
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
