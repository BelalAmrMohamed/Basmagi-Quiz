// =============================================================================
// runtimes/shared/toolbar.ts
// The top bar: + Code, + Text, Run all, Stop, status, Workspace toggle, Info, "More" menu.
// =============================================================================
import type { Ctx } from './ctx';
import { h } from './dom';
import { hasSidePanels } from './side-panel';
import { importFile } from './export-dialog';

export function renderToolbar(ctx: Ctx, importInput: HTMLInputElement) {
  const { t, state, engine } = ctx;
  const actions = ctx.q('actions');
  if (!actions) return;

  const menuItem = (label: string, action: () => void) =>
    h('button', { role: 'menuitem', onclick: (e: MouseEvent) => { action(); (e.currentTarget as HTMLElement).closest('details')?.removeAttribute('open'); } }, label);

  const add = (type: 'code' | 'md') => () => {
    const c = ctx.mkCell(type, '');
    c.mdEdit = type === 'md';
    const at = Math.min(state.sel + 1, state.cells.length);
    state.cells.splice(at, 0, c);
    state.sel = at;
    ctx.save(); ctx.render();
    if (c.type === 'code') ctx.focusEditor(c.id);
  };

  const menu = h('details', { class: 'toolbar-menu' },
    h('summary', { title: t('Notebook menu'), 'aria-label': t('Notebook menu') }, t('More')),
    h('div', { class: 'toolbar-menu-items', role: 'menu' },
      ...(ctx.isEdit() ? [] : [menuItem(t('Reset to published version'), async () => {
        if (state.busy) { ctx.notify(t('Stop execution before resetting the notebook.')); return; }
        if (await ctx.confirm(t('Reset to the published version?'), t('Your local edits in this browser will be discarded. Export them first if you want to keep a copy.'), t('Reset'))) ctx.resetToPublished();
      })]),
      menuItem(t('Import…'), () => importInput.click()),
      menuItem(t('Export…'), () => ctx.openExport()),
      menuItem(t('Help and shortcuts'), () => ctx.openHelp())));

  const status = t(state.busy ? 'Running' : 'Ready');
  actions.replaceChildren(
    h('button', { id: 'addcode', title: t('Insert a code cell below the selected cell'), onclick: add('code') }, t('+ Code')),
    h('button', { id: 'addtext', title: t('Insert a text (Markdown) cell below the selected cell'), onclick: add('md') }, t('+ Text')),
    h('button', { class: 'primary', id: 'runall', title: t('Run all code cells'), onclick: () => void ctx.runAll() }, t('▶ Run all')),
    h('button', { id: 'stop', title: t('Stop execution and reset the workspace'), hidden: !state.busy, onclick: () => ctx.stop() }, t('■ Stop')),
    h('span', { id: 'status', role: 'status', 'aria-label': status, 'aria-live': 'polite', title: status }, ''),
    ...(hasSidePanels(ctx) ? [h('button', {
      id: 'toggleside', title: t('Show variables, files and history'),
      'aria-pressed': String(ctx.q('layout')?.classList.contains('side-open') ?? false),
      onclick: (e: MouseEvent) => { const open = ctx.q('layout')!.classList.toggle('side-open'); (e.currentTarget as HTMLElement).setAttribute('aria-pressed', String(open)); },
    }, t('Workspace'))] : []),
    ...(ctx.opts.onInfo ? [h('button', { type: 'button', title: t('Notebook information'), 'aria-label': t('Notebook information'), onclick: () => ctx.opts.onInfo?.() }, t('ⓘ Info'))] : []),
    menu, importInput);
}

/** The hidden <input type=file> behind "Import…". Uses the host's importer when it provides one. */
export function createImportInput(ctx: Ctx): HTMLInputElement {
  const { t, engine } = ctx;
  const hostImport = () => window.__mlwebImport;
  const input = h('input', { type: 'file', accept: engine.importAccept ?? `${engine.exportExt},.ipynb${hostImport() ? ',.zip' : ''}`, style: 'display:none' });
  input.onchange = () => {
    const f = input.files?.[0];
    if (f) {
      const job = hostImport()
        ? Promise.resolve(hostImport()!(f))
        : importFile(ctx, f).then((cells) => { if (cells.length) ctx.replaceCells(cells); ctx.notify(t('Imported {name}.', { name: f.name })); });
      job.catch((e) => ctx.notify(t('Import failed: ') + (e instanceof Error ? e.message : String(e))));
    }
    input.value = '';
  };
  return input;
}
