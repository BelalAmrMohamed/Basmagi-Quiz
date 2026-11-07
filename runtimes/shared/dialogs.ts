// =============================================================================
// runtimes/shared/dialogs.ts
// Dialogs and the notice toast: help (searchable), confirm and notice. Text prompts (stdin)
// are not drawn here: they use the platform's _prompt() through MountOptions.onPrompt.
// Each `build*` returns the element to append to the notebook root; the `Dialogs` object
// holds the promise-returning API the shell exposes through Ctx.
// =============================================================================
import type { Ctx } from './ctx';
import { h, openDialog, closeDialog } from './dom';

const GENERIC_HELP: Array<[string, string, string]> = [
  ['Notebook', 'Shift+Enter runs and advances; Ctrl+Enter runs in place; Ctrl+Shift+P or ? opens help.',
    'يشغّل Shift+Enter الخلية وينتقل للتالية؛ يشغّل Ctrl+Enter في مكانه؛ ويفتح Ctrl+Shift+P أو ? المساعدة.'],
  ['Command mode', 'Press Esc to leave the editor, then: A insert above, B insert below, D D delete, M to text, Y to code, Up/Down or K/J move, Enter edit, Shift+Enter run and select next.',
    'اضغط Esc للخروج من المحرر ثم: A إدراج أعلاه، B إدراج أسفله، D D حذف، M إلى نص، Y إلى كود، الأسهم أو K/J للتنقل، Enter للتحرير، Shift+Enter للتشغيل والانتقال للتالية.'],
  ['Editor', 'Ctrl+Space opens autocomplete; Tab/Enter accepts a suggestion; Tab indents; Esc closes suggestions.',
    'يفتح Ctrl+Space الإكمال التلقائي؛ يقبل Tab/Enter الاقتراح؛ يزيد Tab المسافة البادئة؛ ويغلق Esc الاقتراحات.'],
];

const dlg = (id: string, labelledBy: string, ...kids: Node[]) => h('dialog', { id, 'aria-labelledby': labelledBy }, ...kids);

export interface Dialogs {
  elements: HTMLElement[];
  help(): void;
  confirm(title: string, message: string, accept?: string): Promise<boolean>;
  notify(message: string): void;
  dispose(): void;
}

export function createDialogs(ctx: Ctx): Dialogs {
  const { t, lang } = ctx;
  const cleanups: Array<() => void> = [];
  const on = <E extends EventTarget>(el: E | null, type: string, fn: (e: any) => void, opts?: AddEventListenerOptions) => {
    if (!el) return;
    el.addEventListener(type, fn, opts);
    cleanups.push(() => el.removeEventListener(type, fn, opts));
  };
  let noticeTimer = 0;

  // ---- help ----
  const helpDialog = dlg('helpDialog', 'helpTitle',
    h('div', { class: 'help-head' }, h('h2', { id: 'helpTitle' }, ''), h('button', { id: 'closeHelp', type: 'button' }, '')),
    h('div', { class: 'help-body' }, h('p', { id: 'helpIntro' }, ''), h('input', { id: 'helpSearch', type: 'search', autocomplete: 'off' }), h('div', { id: 'helpItems' })));
  const helpItems = () => [...GENERIC_HELP, ...(ctx.engine.help?.items ?? [])];
  const renderHelp = () => {
    const items = helpDialog.querySelector('#helpItems')!, search = helpDialog.querySelector<HTMLInputElement>('#helpSearch')!;
    const q = search.value.trim().toLowerCase();
    items.replaceChildren();
    for (const [title, en, ar] of helpItems()) {
      if (q && !(title + ' ' + en + ' ' + ar).toLowerCase().includes(q)) continue;
      items.append(h('article', { class: 'help-item' }, h('b', {}, title), h('p', {}, lang === 'ar' ? ar : en)));
    }
  };
  const help = () => {
    const cfg = ctx.engine.help;
    helpDialog.querySelector('#helpTitle')!.textContent = cfg?.title ? t(cfg.title) : t('{name} help', { name: ctx.engine.label });
    helpDialog.querySelector('#closeHelp')!.textContent = t('Close');
    helpDialog.querySelector('#helpIntro')!.textContent = cfg?.intro ? t(cfg.intro) : t('Search commands and notebook shortcuts.');
    const search = helpDialog.querySelector<HTMLInputElement>('#helpSearch')!;
    search.placeholder = t('Search commands…');
    search.value = '';
    renderHelp();
    openDialog(helpDialog);
    search.focus();
  };
  on(helpDialog.querySelector('#helpSearch'), 'input', renderHelp);
  on(helpDialog.querySelector('#closeHelp'), 'click', () => closeDialog(helpDialog));
  on(helpDialog, 'click', (e) => { if (e.target === e.currentTarget) closeDialog(helpDialog); });

  // ---- confirm ----
  let confirmResolve: ((ok: boolean) => void) | null = null;
  const confirmDialog = dlg('confirmDialog', 'confirmTitle',
    h('div', { class: 'dialog-head' }, h('h2', { id: 'confirmTitle' }, ''),
      h('button', { type: 'button', 'data-confirm-cancel': true, 'aria-label': t('Close dialog') }, '×')),
    h('div', { class: 'dialog-body' }, h('p', { id: 'confirmMessage' }),
      h('div', { class: 'dialog-actions' },
        h('button', { type: 'button', 'data-confirm-cancel': true }, t('Cancel')),
        h('button', { type: 'button', class: 'primary', 'data-confirm-accept': true }, ''))));
  const settleConfirm = (ok: boolean) => {
    if (confirmDialog.open) closeDialog(confirmDialog);
    const r = confirmResolve; confirmResolve = null; r?.(ok);
  };
  const confirm = (title: string, message: string, accept = t('Continue')): Promise<boolean> => {
    const hook = ctx.opts.onConfirm;
    if (hook) return Promise.resolve(hook(title, message, accept)).then(Boolean, () => false);
    confirmDialog.querySelector('#confirmTitle')!.textContent = title;
    confirmDialog.querySelector('#confirmMessage')!.textContent = message;
    confirmDialog.querySelector('[data-confirm-accept]')!.textContent = accept;
    return new Promise((resolve) => { confirmResolve = resolve; openDialog(confirmDialog); });
  };
  confirmDialog.querySelectorAll('[data-confirm-cancel]').forEach((b) => on(b, 'click', () => settleConfirm(false)));
  on(confirmDialog.querySelector('[data-confirm-accept]'), 'click', () => settleConfirm(true));
  on(confirmDialog, 'cancel', (e) => { e.preventDefault(); settleConfirm(false); });
  on(confirmDialog, 'click', (e) => { if (e.target === e.currentTarget) settleConfirm(false); });

  // ---- notice ----
  const notice = h('div', { id: 'notice', role: 'status', 'aria-live': 'polite', hidden: true },
    h('span', { id: 'noticeMessage' }),
    h('button', { type: 'button', id: 'dismissNotice', 'aria-label': t('Dismiss notification') }, '×'));
  const notify = (message: string) => {
    notice.querySelector('#noticeMessage')!.textContent = message;
    notice.hidden = false;
    window.clearTimeout(noticeTimer);
    noticeTimer = window.setTimeout(() => { notice.hidden = true; }, 5000);
  };
  on(notice.querySelector('#dismissNotice'), 'click', () => { window.clearTimeout(noticeTimer); notice.hidden = true; });

  return {
    elements: [helpDialog, confirmDialog, notice], help, confirm, notify,
    dispose() {
      window.clearTimeout(noticeTimer);
      settleConfirm(false);
      for (const fn of cleanups.splice(0)) fn();
    },
  };
}
