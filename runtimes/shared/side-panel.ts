// =============================================================================
// runtimes/shared/side-panel.ts
// The side column: workspace variables, current-folder files, command history.
// Each panel renders only if the engine's `caps` flag for it is true.
// =============================================================================
import type { Ctx } from './ctx';
import type { ImageFile } from './engine';
import { h, fmtBytes, download } from './dom';
import { rawToCanvas, toBlob, downloadImage } from './images';

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

type MenuItem = { label: string; action: () => void | Promise<void>; danger?: boolean; preview?: Promise<HTMLCanvasElement | null> };
let closeOpenMenu: (() => void) | null = null;
let openMenuAnchor: HTMLElement | null = null;
const samplePreviewCache = new Map<string, Promise<HTMLCanvasElement | null>>();

/**
 * A small floating menu. It is appended to the notebook root with `position: fixed`, because the
 * panel body scrolls and clips anything absolutely positioned inside it.
 */
function openMenu(ctx: Ctx, anchor: HTMLElement, items: MenuItem[], menuClass = '') {
  const toggleClosed = openMenuAnchor === anchor;
  closeOpenMenu?.();
  if (toggleClosed) return;
  const menu = h('div', { class: `file-menu ${menuClass}`.trim(), role: 'menu' });
  const buttons = items.map((it) => {
    const button = h('button', {
      type: 'button', role: 'menuitem', class: it.danger ? 'danger' : '',
      onclick: () => { close(false); void it.action(); },
    });
    if (it.preview) {
      const thumb = h('span', { class: 'file-menu-thumb', 'aria-hidden': 'true' });
      button.classList.add('file-menu-sample');
      button.append(thumb, h('span', { class: 'file-menu-label' }, it.label));
      void it.preview.then((canvas) => { if (canvas && button.isConnected) thumb.append(canvas); });
    } else button.textContent = it.label;
    return button;
  });
  menu.append(...buttons);
  ctx.root.append(menu);
  anchor.setAttribute('aria-expanded', 'true');

  const r = anchor.getBoundingClientRect(), w = menu.offsetWidth, ht = menu.offsetHeight, gap = 8;
  const rtl = getComputedStyle(ctx.root).direction === 'rtl';
  const left = Math.min(Math.max(rtl ? r.left : r.right - w, gap), Math.max(gap, window.innerWidth - w - gap));
  const below = r.bottom + 4, top = below + ht > window.innerHeight - gap ? Math.max(gap, r.top - ht - 4) : below;
  menu.style.left = left + 'px';
  menu.style.top = top + 'px';

  const away = (e: Event) => { if (!menu.contains(e.target as Node) && !anchor.contains(e.target as Node)) close(false); };
  const key = (e: KeyboardEvent) => {
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); buttons[(i + 1) % buttons.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); buttons[(i - 1 + buttons.length) % buttons.length].focus(); }
    else if (e.key === 'Tab') close(false);
  };
  const dismiss = () => close(false);
  // Scrolling only matters when it moves the button the menu hangs from (the panel body scrolls).
  const onScroll = () => { const a = anchor.getBoundingClientRect(); if (Math.abs(a.top - r.top) > 1 || Math.abs(a.left - r.left) > 1) close(false); };
  function close(refocus: boolean) {
    document.removeEventListener('pointerdown', away, true);
    document.removeEventListener('keydown', key, true);
    window.removeEventListener('resize', dismiss);
    window.removeEventListener('scroll', onScroll, true);
    menu.remove();
    anchor.setAttribute('aria-expanded', 'false');
    if (closeOpenMenu === close0) { closeOpenMenu = null; openMenuAnchor = null; }
    if (refocus && anchor.isConnected) anchor.focus();
  }
  const close0 = () => close(false);
  closeOpenMenu = close0;
  openMenuAnchor = anchor;
  document.addEventListener('pointerdown', away, true);
  document.addEventListener('keydown', key, true);
  window.addEventListener('resize', dismiss);
  window.addEventListener('scroll', onScroll, true);
  buttons[0]?.focus({ preventScroll: true });
}

async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall back below */ }
  const ta = h('textarea', { style: 'position:fixed;opacity:0', 'aria-hidden': 'true' });
  ta.value = text;
  document.body.append(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { /* not allowed */ }
  ta.remove();
  return ok;
}

/** PNG is the one image type every browser accepts on the clipboard. */
async function copyImage(img: ImageFile): Promise<boolean> {
  try {
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') return false;
    // The promise is handed over unresolved so Safari keeps the click's permission while it encodes.
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': toBlob(rawToCanvas(img), 'image/png') })]);
    return true;
  } catch { return false; }
}

function isImageFile(f: any): f is ImageFile {
  return f && typeof f.width === 'number' && typeof f.height === 'number';
}

function sampleImagePreview(ctx: Ctx, name: string): Promise<HTMLCanvasElement | null> {
  const base = new URL(ctx.opts.baseUrl || './', location.href);
  const url = new URL(`assets/${encodeURIComponent(name)}.json`, base).href;
  const cached = samplePreviewCache.get(url);
  if (cached) return cached;
  const preview = fetch(url).then(async (response) => {
    if (!response.ok) return null;
    const { b64, ...meta } = await response.json();
    if (typeof b64 !== 'string' || !Number.isFinite(meta.width) || !Number.isFinite(meta.height)) return null;
    const binary = atob(b64), data = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) data[i] = binary.charCodeAt(i);
    const source = rawToCanvas({ ...meta, data } as ImageFile);
    const scale = Math.min(1, 64 / source.width, 48 / source.height);
    const thumb = document.createElement('canvas');
    thumb.width = Math.max(1, Math.round(source.width * scale));
    thumb.height = Math.max(1, Math.round(source.height * scale));
    thumb.className = 'file-menu-preview';
    thumb.getContext('2d')?.drawImage(source, 0, 0, thumb.width, thumb.height);
    return thumb;
  }).catch(() => null);
  samplePreviewCache.set(url, preview);
  return preview;
}

function fileMenu(ctx: Ctx, anchor: HTMLElement, name: string, file: any) {
  const { t } = ctx;
  const isImg = isImageFile(file);
  const items: MenuItem[] = [
    { label: t('Copy Name'), action: async () => ctx.notify((await copyText(name)) ? t('Copied {name}', { name }) : t('Could not copy to the clipboard.')) },
    ...(ctx.engine.renameFile ? [{
      label: t('Rename'),
      action: async () => {
        const next = await ctx.prompt(t('Rename file'), name);
        if (next === null) return;
        let to = next.trim();
        // Typing just a new base name keeps the old extension, so imread('name.png') keeps working.
        if (to && !/\.[A-Za-z0-9]+$/.test(to)) to += /\.[^.]+$/.exec(name)?.[0] ?? '';
        ctx.renameFile(name, to);
      },
    }] : []),
    ...(isImg ? [{
      label: t('Copy Image'),
      action: async () => ctx.notify((await copyImage(file)) ? t('Image copied to clipboard.') : t('Could not copy the image. Your browser may block clipboard access; use Download instead.')),
    }] : []),
    {
      label: t('Download'),
      action: () => {
        if (isImg) downloadImage(name, file);
        else download(name, new Blob([file.data || file.text || ''], { type: 'text/plain' }));
      },
    },
    { label: t('Remove'), danger: true, action: () => ctx.removeFile(name) },
  ];
  openMenu(ctx, anchor, items);
}

function filesPanel(ctx: Ctx): HTMLElement {
  const { t } = ctx;
  const body = h('div', { class: 'body' }), files = ctx.files() as Map<string, any>;
  for (const [name, file] of files) {
    const isImg = isImageFile(file);
    const thumb = isImg
      ? rawToCanvas(file)
      : h('span', { style: 'font-size:1.3rem;display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;' }, '📄');
    const info = isImg
      ? `${file.width}×${file.height} · ${file.channels === 1 ? 'grayscale' : 'RGB'} · ${fmtBytes(file.fileSize)}`
      : fmtBytes(file.fileSize || 0);

    body.append(h('div', { class: 'file' }, thumb,
      h('span', { class: 'n', title: info }, name + ' · ' + fmtBytes(file.fileSize || 0)),
      h('button', {
        class: 'file-more', title: t('File actions'), 'aria-haspopup': 'menu', 'aria-expanded': 'false',
        onclick: (e: MouseEvent) => fileMenu(ctx, e.currentTarget as HTMLElement, name, file),
      }, '⋮')));
  }
  const isCpp = ctx.engine.id === 'cpp';
  if (!files.size) {
    body.append(h('div', { class: 'empty' }, isCpp ? t('No files yet. Upload a text file to get started.') : t('No files yet. Upload an image to get started.')));
  }
  const input = h('input', { type: 'file', accept: isCpp ? '.txt,.csv,.dat,.in,.out,text/*' : 'image/*', multiple: true, style: 'display:none' });
  input.onchange = async () => {
    for (const f of Array.from(input.files ?? [])) {
      try { await ctx.addFile(f); }
      catch (e) { ctx.notify(t('Could not load {name}: {error}', { name: f.name, error: e instanceof Error ? e.message : String(e) })); }
    }
    input.value = '';
  };
  const samplesBtn = !isCpp && ctx.engine.samples
    ? h('button', {
        title: t('Browse and add the sample images'), 'aria-haspopup': 'menu', 'aria-expanded': 'false',
        onclick: async (e: MouseEvent) => {
          const anchor = e.currentTarget as HTMLElement;
          const missing = await ctx.missingSamples();
          if (!missing.length) { ctx.notify(t('All sample images are already in the folder.')); return; }
          openMenu(ctx, anchor, [
            ...(missing.length > 1 ? [{ label: t('Add all ({n})', { n: missing.length }), action: () => ctx.addSamples(missing) }] : []),
            ...missing.map((n) => ({ label: n, preview: sampleImagePreview(ctx, n), action: () => ctx.addSamples([n]) })),
          ], 'file-menu--samples');
        },
      }, t('Samples'))
    : null;
  const actions = h('span', { class: 'panel-actions', style: 'display:inline-flex;gap:6px' }, ...(samplesBtn ? [samplesBtn] : []),
    h('button', { title: t(isCpp ? 'Upload text files' : 'Upload image files'), onclick: () => input.click() }, t('Upload')));
  return h('div', { class: 'panel' }, h('h3', {}, t('Current Folder'), actions, input), body);
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
