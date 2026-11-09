// =============================================================================
// runtimes/shared/wasm-dialog.ts
// Handles the UI dialog and progress bar for the ~20MB Wasm-Clang download.
// =============================================================================
import type { Ctx } from './ctx';
import { h, openDialog, closeDialog } from './dom';
import { isWasmCached, downloadWasmAssets, deleteWasmCache } from '../cpp/src/wasm-cache';

export interface WasmDialogController {
  dialogEl: HTMLDialogElement;
  buttonEl: HTMLButtonElement;
  open(): void;
  updateStatus(): Promise<void>;
  dispose(): void;
}

export function createWasmDialog(
  ctx: Ctx,
  onStatusChange?: (installed: boolean) => void
): WasmDialogController {
  const { t } = ctx;
  let abortController: AbortController | null = null;
  let isDownloading = false;
  let isInstalled = false;

  const buttonEl = h('button', {
    id: 'cppWasmBtn',
    type: 'button',
    title: t('Download fast offline C++ compiler (~20MB)'),
    onclick: () => open(),
  }, t('⚡ 20MB Fast Compiler'));

  // Header
  const titleText = h('span', {}, t('Instant C++ Local Compiler'));
  const badge = h('span', { class: 'wasm-badge' }, t('~20 MB · One-time download'));
  const closeHeadBtn = h('button', {
    type: 'button',
    style: 'background:none; border:none; cursor:pointer; font-size:1.2rem; color:var(--ink-secondary);',
    onclick: () => close(),
  }, '✕');
  const head = h('div', { class: 'wasm-dialog-head' },
    h('h2', {}, titleText, badge),
    closeHeadBtn
  );

  // Body content
  const noteBox = h('div', { class: 'wasm-note-box' },
    h('strong', {}, t('One-time download: ')),
    t('Downloads the Clang compiler (~20 MB) once into your browser cache. Once finished, C++ code compiles instantly (~300ms) right on your machine, 100% offline, with zero server delays. It will not download again on future visits.')
  );

  const featuresList = h('div', { class: 'wasm-features-list' },
    h('span', {}, '⚡ ' + t('Sub-second execution (~200–400ms) without server queues')),
    h('span', {}, '💻 ' + t('Full support for C++ Fundamentals & Object-Oriented Programming (OOP)')),
    h('span', {}, '📁 ' + t('Text file reading and writing (<fstream>) with the Current Folder workspace')),
    h('span', {}, '📴 ' + t('Works 100% offline without internet connection'))
  );

  // Progress Bar container
  const progressFill = h('div', { class: 'wasm-progress-fill' });
  const progressTrack = h('div', { class: 'wasm-progress-track' }, progressFill);
  const progressStatus = h('span', {}, t('Ready to download'));
  const progressPercent = h('span', {}, '0%');
  const progressStats = h('div', { class: 'wasm-progress-stats' }, progressStatus, progressPercent);
  const progressWrap = h('div', { class: 'wasm-progress-wrap', style: 'display:none;' },
    progressTrack,
    progressStats
  );

  const body = h('div', { class: 'wasm-dialog-body' }, noteBox, featuresList, progressWrap);

  // Actions
  const actionPrimary = h('button', { class: 'primary', type: 'button' });
  const actionSecondary = h('button', { type: 'button' });
  const actions = h('div', { class: 'wasm-dialog-actions' }, actionSecondary, actionPrimary);

  const dialogEl = h('dialog', { id: 'cppWasmDialog' }, head, body, actions);

  function fmtMb(bytes: number) {
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function renderState() {
    if (isDownloading) {
      progressWrap.style.display = 'flex';
      actionPrimary.style.display = 'none';
      actionSecondary.style.display = 'inline-block';
      actionSecondary.textContent = t('Cancel');
      actionSecondary.onclick = () => {
        if (abortController) abortController.abort();
      };
      closeHeadBtn.style.display = 'none';
    } else if (isInstalled) {
      progressWrap.style.display = 'none';
      badge.textContent = t('Installed');
      badge.style.background = 'rgba(16, 185, 129, 0.15)';
      badge.style.color = '#10b981';

      actionPrimary.style.display = 'inline-block';
      actionPrimary.textContent = t('Close');
      actionPrimary.onclick = () => close();

      actionSecondary.style.display = 'inline-block';
      actionSecondary.textContent = t('Delete & Free 20 MB');
      actionSecondary.style.color = '#ef4444';
      actionSecondary.onclick = async () => {
        if (confirm(t('Are you sure you want to remove the local C++ compiler and free up ~20MB of browser cache?'))) {
          await deleteWasmCache();
          await updateStatus();
          ctx.notify(t('Local compiler removed. Now using Cloud Compiler.'));
        }
      };
      closeHeadBtn.style.display = 'inline-block';
    } else {
      progressWrap.style.display = 'none';
      badge.textContent = t('~20 MB · One-time download');
      badge.style.background = 'rgba(59, 130, 246, 0.12)';
      badge.style.color = 'var(--accent, #3b82f6)';

      actionPrimary.style.display = 'inline-block';
      actionPrimary.textContent = t('Download Fast Compiler (~20MB)');
      actionPrimary.onclick = () => startDownload();

      actionSecondary.style.display = 'inline-block';
      actionSecondary.textContent = t('Keep Cloud Compiler (0 MB)');
      actionSecondary.style.color = '';
      actionSecondary.onclick = () => close();
      closeHeadBtn.style.display = 'inline-block';
    }
  }

  async function startDownload() {
    isDownloading = true;
    abortController = new AbortController();
    renderState();

    progressFill.style.width = '0%';
    progressStatus.textContent = t('Starting download…');
    progressPercent.textContent = '0%';

    try {
      await downloadWasmAssets((p) => {
        progressFill.style.width = `${p.percent}%`;
        progressPercent.textContent = `${p.percent}%`;
        progressStatus.textContent = `${fmtMb(p.loaded)} / ${fmtMb(p.total)} · ${p.currentFile}`;
        buttonEl.textContent = `⬇ ${p.percent}%`;
      }, abortController.signal);

      isDownloading = false;
      await updateStatus();
      ctx.notify(t('Fast local C++ compiler ready! Code will now compile instantly.'));
      renderState();
    } catch (e: any) {
      isDownloading = false;
      const msg = e?.message || String(e);
      if (msg.includes('cancelled')) {
        ctx.notify(t('Download cancelled.'));
      } else {
        ctx.notify(t('Download failed: ') + msg);
      }
      await updateStatus();
      renderState();
    } finally {
      abortController = null;
    }
  }

  async function updateStatus() {
    isInstalled = await isWasmCached();
    if (isInstalled) {
      buttonEl.textContent = t('⚡ Local: Active');
      buttonEl.classList.add('wasm-installed');
      buttonEl.setAttribute('title', t('Fast local C++ compiler is installed and active'));
    } else {
      buttonEl.textContent = t('⚡ 20MB Fast Compiler');
      buttonEl.classList.remove('wasm-installed');
      buttonEl.setAttribute('title', t('Download fast offline C++ compiler (~20MB)'));
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

  // Initial status check
  void updateStatus();

  return {
    dialogEl,
    buttonEl,
    open,
    updateStatus,
    dispose: () => {
      if (abortController) abortController.abort();
    },
  };
}

export function attachWasmDialog(ctx: Ctx): HTMLElement {
  const controller = createWasmDialog(ctx, (installed) => {
    (ctx.engine as any).setWasmMode?.(installed);
  });
  ctx.q('root')?.append(controller.dialogEl);
  return controller.buttonEl;
}
