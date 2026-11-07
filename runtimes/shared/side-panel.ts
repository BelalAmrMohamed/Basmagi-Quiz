// =============================================================================
// runtimes/shared/side-panel.ts
// The side column: workspace variables, current-folder files, command history.
// Each panel renders only if the engine's `caps` flag for it is true.
// =============================================================================
import type { Ctx } from './ctx';
import { h, fmtBytes } from './dom';
import { rawToCanvas } from './images';
import { downloadImage } from './images';

/** True when the engine has anything to show in the side column. */
export const hasSidePanels = (ctx: Pick<Ctx, 'engine'>) => { const c = ctx.engine.caps; return c.workspace || c.files || c.history; };

function workspacePanel(ctx: Ctx): HTMLElement {
  const { t, state } = ctx;
  const body = h('div', { class: 'body' });
  if (!state.vars.length) body.append(h('div', { class: 'empty' }, t('Run a cell to see variables here.')));
  else {
    const table = h('table', { class: 'ws' }, h('tr', {}, ...[t('Name'), t('Size'), t('Class'), t('Bytes')].map((x) => h('th', {}, x))));
    for (const v of state.vars) {
      const name = h('button', {
        title: t('Insert variable name in a new code cell'),
        onclick: () => { const c = ctx.mkCell('code', v.name); state.cells.push(c); state.sel = state.cells.length - 1; ctx.save(); ctx.focusEditor(c.id); },
      }, v.name);
      table.append(h('tr', {}, h('td', {}, name), h('td', {}, v.size), h('td', {}, v.cls), h('td', {}, v.bytes ? fmtBytes(v.bytes) : '—')));
    }
    body.append(table);
  }
  return h('div', { class: 'panel' }, h('h3', {}, t('Workspace'), h('button', { title: t('Clear variables'), onclick: () => ctx.resetWorkspace() }, t('Clear'))), body);
}

function filesPanel(ctx: Ctx): HTMLElement {
  const { t } = ctx;
  const body = h('div', { class: 'body' }), files = ctx.files();
  for (const [name, img] of files) {
    body.append(h('div', { class: 'file' }, rawToCanvas(img),
      h('span', { class: 'n', title: `${img.width}×${img.height} · ${img.channels === 1 ? 'grayscale' : 'RGB'} · ${fmtBytes(img.fileSize)}` }, name + ' · ' + fmtBytes(img.fileSize)),
      h('button', { title: t('Download file'), onclick: () => void downloadImage(name, img) }, '↓'),
      h('button', { title: t('Remove file'), onclick: () => ctx.removeFile(name) }, '✕')));
  }
  if (!files.size) body.append(h('div', { class: 'empty' }, t('No files yet. Upload an image to get started.')));
  const input = h('input', { type: 'file', accept: 'image/*', multiple: true, style: 'display:none' });
  input.onchange = async () => {
    for (const f of Array.from(input.files ?? [])) {
      try { await ctx.addFile(f); }
      catch (e) { ctx.notify(t('Could not load {name}: {error}', { name: f.name, error: e instanceof Error ? e.message : String(e) })); }
    }
    input.value = '';
  };
  return h('div', { class: 'panel' }, h('h3', {}, t('Current Folder'), h('button', { title: t('Upload image files'), onclick: () => input.click() }, t('Upload')), input), body);
}

function historyPanel(ctx: Ctx): HTMLElement {
  const { t, state } = ctx;
  const body = h('div', { class: 'body hist' });
  if (!state.hist.length) body.append(h('div', { class: 'empty' }, t('Executed commands appear here. Select one to add it as a cell.')));
  for (const cmd of state.hist.slice().reverse().slice(0, 60)) {
    body.append(h('div', { title: cmd, onclick: () => { state.cells.push(ctx.mkCell('code', cmd)); state.sel = state.cells.length - 1; ctx.save(); ctx.render(); } }, cmd));
  }
  return h('div', { class: 'panel' }, h('h3', {}, t('Command History'), h('button', { title: t('Clear command history'), onclick: () => ctx.clearHistory() }, t('Clear'))), body);
}

export function renderSide(ctx: Ctx) {
  const side = ctx.q('side');
  if (!side) return;
  const { caps } = ctx.engine;
  side.replaceChildren(
    ...(caps.workspace ? [workspacePanel(ctx)] : []),
    ...(caps.files ? [filesPanel(ctx)] : []),
    ...(caps.history ? [historyPanel(ctx)] : []),
  );
}
