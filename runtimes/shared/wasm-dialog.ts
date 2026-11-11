// =============================================================================
// runtimes/shared/wasm-dialog.ts
// Toolbar button + modal for the optional in-browser C++ compiler (Wasm-Clang):
// explains it, downloads it with live progress, and removes it again.
// The download size is never hard-coded in text: it comes from WASM_ASSETS.
// =============================================================================
import type { Ctx } from './ctx';
import { h, openDialog, closeDialog } from './dom';
import { isWasmCached, downloadWasmAssets, deleteWasmCache, TOTAL_WASM_SIZE, TOTAL_WASM_DOWNLOAD } from '../cpp/src/wasm-cache';

export interface WasmDialogController {
  dialogEl: HTMLDialogElement;
  buttonEl: HTMLButtonElement;
  open(): void;
  updateStatus(): Promise<void>;
  dispose(): void;
}

const mb = (bytes: number) => bytes / (1024 * 1024);
/** "60 MB": whole megabytes for the headline size, one decimal for progress. */

export function createWasmDialog(
  ctx: Ctx,
  onStatusChange?: (installed: boolean) => void
): WasmDialogController {
  const { t } = ctx;
  const size = `${Math.round(mb(TOTAL_WASM_DOWNLOAD))} ${t('MB')}`;   // what is downloaded (compressed)
  const stored = `${Math.round(mb(TOTAL_WASM_SIZE))} ${t('MB')}`;      // what it takes once unpacked in browser storage
  let warm: 'idle' | 'warming' | 'ready' | 'error' = 'idle';
  let abortController: AbortController | null = null;
  let isDownloading = false;
  let isInstalled = false;

  const buttonEl = h('button', { id: 'cppWasmBtn', type: 'button', onclick: () => open() });

  // ---- header ----
  const pill = h('span', { class: 'wasm-pill' });
  const closeHeadBtn = h('button', { type: 'button', class: 'wasm-close', 'aria-label': t('Close'), onclick: () => close() }, '✕');
  const head = h('div', { class: 'wasm-dialog-head' },
    h('span', { class: 'wasm-logo', 'aria-hidden': 'true' }, '⚡'),
    h('div', { class: 'wasm-head-text' },
      h('h2', {}, t('Instant C++ Local Compiler')),
      h('p', {}, t('Compile and run C++ inside your browser, with no server in the way.'))),
    pill, closeHeadBtn);

  // ---- body ----
  const stat = (value: string, label: string) => h('div', { class: 'wasm-stat' }, h('strong', { dir: 'auto' }, value), h('span', {}, label));
  const stats = h('div', { class: 'wasm-stats' },
    stat(size, t('one-time download')),
    stat('≈ 1 s', t('typical run time')),
    stat(t('Offline'), t('after the first download')));

  const feature = (icon: string, text: string) => h('li', {}, h('span', { 'aria-hidden': 'true' }, icon), h('span', {}, text));
  const features = h('ul', { class: 'wasm-features' },
    feature('🚀', t('Runs in about a second, with no server queue or network delay')),
    feature('⌨️', t('Interactive input: your program pauses at cin and waits for you, like a real terminal')),
    feature('📁', t('Reads and writes text files (<fstream>) in the Current Folder')),
    feature('📴', t('Keeps working without an internet connection')));

  const note = h('p', { class: 'wasm-note' },
    h('strong', {}, t('Good to know: ')),
    t('Programs that use C++ exceptions (try / catch / throw) are not supported by the local compiler, so they run on the cloud compiler automatically. The download ({size}) is stored in your browser and is not repeated on later visits.', { size }),
    h('br'), t('Download will unpack to about {stored} of browser storage. You can keep editing while it downloads.', { stored }));

  const progressFill = h('div', { class: 'wasm-progress-fill' });
  const progressTrack = h('div', { class: 'wasm-progress-track', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100 }, progressFill);
  const progressStatus = h('span', {}, '');
  const progressPercent = h('strong', {}, '0%');
  const progressMeta = h('span', { class: 'wasm-progress-meta' }, '');
  const progressWrap = h('div', { class: 'wasm-progress-wrap', hidden: true },
    h('div', { class: 'wasm-progress-stats' }, progressStatus, progressPercent),
    progressTrack, progressMeta,
    h('p', { class: 'wasm-note' }, t('You can close this window and keep editing the notebook. The download continues in the background; the toolbar button shows its progress.')));

  const installedBox = h('div', { class: 'wasm-installed-box', hidden: true },
    h('span', { 'aria-hidden': 'true' }, '✅'),
    h('div', {}, h('strong', {}, t('The local compiler is installed and active.')),
      h('span', {}, t('It uses about {size} of browser storage.', { size: stored }))));

  const body = h('div', { class: 'wasm-dialog-body' }, stats, features, note, progressWrap, installedBox);

  // ---- actions ----
  const actionPrimary = h('button', { class: 'primary', type: 'button' });
  const actionSecondary = h('button', { type: 'button' });
  const actions = h('div', { class: 'wasm-dialog-actions' }, actionSecondary, actionPrimary);

  const dialogEl = h('dialog', { id: 'cppWasmDialog' }, head, body, actions);
  // Esc / ✕ / the backdrop only hide the dialog: the download keeps running and the toolbar button shows its progress.
  dialogEl.addEventListener('click', (e) => { if (e.target === dialogEl) close(); });

  const setPill = (kind: 'idle' | 'busy' | 'ok', text: string) => { pill.dataset.state = kind; pill.textContent = text; };

  function renderState() {
    progressWrap.hidden = !isDownloading;
    installedBox.hidden = !isInstalled || isDownloading;
    stats.hidden = isInstalled || isDownloading;
    features.hidden = isDownloading;
    note.hidden = isDownloading;
    actionSecondary.style.color = '';
    if (isDownloading) {
      setPill('busy', t('Downloading…'));
      actionPrimary.hidden = false;
      actionPrimary.textContent = t('Continue editing');
      actionPrimary.onclick = () => close();
      actionSecondary.hidden = false;
      actionSecondary.textContent = t('Cancel download');
      actionSecondary.onclick = () => abortController?.abort();
    } else if (isInstalled) {
      setPill('ok', t('Installed'));
      actionPrimary.hidden = false;
      actionPrimary.textContent = t('Done');
      actionPrimary.onclick = () => close();
      actionSecondary.hidden = false;
      actionSecondary.textContent = t('Remove and free {size}', { size: stored });
      actionSecondary.style.color = 'var(--err)';
      actionSecondary.onclick = async () => {
        if (await ctx.confirm(t('Remove the local compiler?'), t('This frees about {size} of browser storage. C++ will run on the cloud compiler until you download it again.', { size: stored }), t('Remove'))) {
          await deleteWasmCache();
          await updateStatus();
          ctx.notify(t('Local compiler removed. Now using the cloud compiler.'));
        }
      };
    } else {
      setPill('idle', t('Not installed'));
      actionPrimary.hidden = false;
      actionPrimary.textContent = t('Download ({size})', { size });
      actionPrimary.onclick = () => void startDownload();
      actionSecondary.hidden = false;
      actionSecondary.textContent = t('Not now');
      actionSecondary.onclick = () => close();
    }
  }

  async function startDownload() {
    isDownloading = true;
    abortController = new AbortController();
    progressFill.style.width = '0%';
    progressPercent.textContent = '0%';
    progressStatus.textContent = t('Starting download…');
    progressMeta.textContent = '';
    renderState();
    const t0 = performance.now();
    try {
      await downloadWasmAssets((p) => {
        progressFill.style.width = `${p.percent}%`;
        progressTrack.setAttribute('aria-valuenow', String(p.percent));
        progressPercent.textContent = `${p.percent}%`;
        progressStatus.textContent = p.percent >= 100 ? t('Unpacking…') : t('Downloading {file}…', { file: p.currentFile });
        const secs = Math.max(0.5, (performance.now() - t0) / 1000);
        const speed = mb(p.loaded) / secs;
        const left = speed > 0 ? Math.max(0, Math.round((mb(p.total) - mb(p.loaded)) / speed)) : 0;
        progressMeta.textContent = `${mb(p.loaded).toFixed(1)} / ${mb(p.total).toFixed(1)} ${t('MB')} · ${speed.toFixed(1)} ${t('MB')}/s · ${t('{n}s left', { n: left })}`;
        buttonEl.textContent = `⬇ ${p.percent}%`;
      }, abortController.signal);
      isDownloading = false;
      await updateStatus();
      ctx.notify(t('Instant compiler ready. C++ now runs right in your browser.'));
    } catch (e: any) {
      isDownloading = false;
      const msg = e?.message || String(e);
      ctx.notify(msg.includes('cancelled') ? t('Download cancelled.') : t('Download failed: ') + msg);
      await updateStatus();
    } finally {
      abortController = null;
    }
  }

  async function updateStatus() {
    isInstalled = await isWasmCached();
    if (isInstalled) {
      buttonEl.textContent = warm === 'warming' ? t('⚡ Local: Warming up…') : t('⚡ Local: Active');
      buttonEl.classList.add('wasm-installed');
      buttonEl.classList.toggle('wasm-warming', warm === 'warming');
      buttonEl.setAttribute('data-tooltip', warm === 'warming' ? t('The local compiler is warming up in the background; your first run will start in a moment.') : t('The instant local C++ compiler is installed and active'));
    } else {
      buttonEl.textContent = t('⚡ Instant Compiler');
      buttonEl.classList.remove('wasm-installed');
      buttonEl.setAttribute('data-tooltip', t('Download the instant in-browser C++ compiler ({size})', { size }));
    }
    renderState();
    onStatusChange?.(isInstalled);
  }

  function open() {
    renderState();
    openDialog(dialogEl);
  }
  function close() {
    closeDialog(dialogEl);
  }

  void updateStatus();
  const unsubscribeWarm = (ctx.engine as any).onWarm?.((s: typeof warm) => { warm = s; if (isInstalled && !isDownloading) void updateStatus(); });

  return { dialogEl, buttonEl, open, updateStatus, dispose: () => { abortController?.abort(); unsubscribeWarm?.(); } };
}

export function attachWasmDialog(ctx: Ctx): HTMLElement {
  const controller = createWasmDialog(ctx, (installed) => {
    (ctx.engine as any).setWasmMode?.(installed);
  });
  ctx.root.append(controller.dialogEl);
  return controller.buttonEl;
}
