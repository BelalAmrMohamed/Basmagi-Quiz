import { indentWithTab } from '@codemirror/commands';
import { HighlightStyle, StreamLanguage, indentUnit, syntaxHighlighting } from '@codemirror/language';
import { octave } from '@codemirror/legacy-modes/mode/octave';
import { EditorState, Prec } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { basicSetup, EditorView } from 'codemirror';
import { completionExtension } from './completion';
import type { CompletionHost } from './completion';
import { indentGuides } from './indent-guides';

type AssetRec = { width: number; height: number; channels: 1 | 3; b64: string; bitDepth: number; format: string; fileSize: number; colorType: string; filename: string; fileModDate: string; colormap?: number[][] };
export interface NotebookCellDoc { id: string; type: 'markdown' | 'code'; source: string }
export interface NotebookDoc { id: string; title: string; schemaVersion: number; runtime: 'matlab'; cells: NotebookCellDoc[] }
export interface MountOptions { root: HTMLElement; baseUrl: string; notebook: NotebookDoc; lang?: 'ar' | 'en'; onNotice?: (msg: string) => void; mode?: 'view' | 'edit'; onChange?: (cells: NotebookCellDoc[]) => void;
  onInfo?: () => void;
  /** Host replacement for the built-in confirm dialog (resolve true to accept). */
  onConfirm?: (title: string, message: string, acceptLabel?: string) => Promise<boolean> }
const isEdit = () => opts?.mode === 'edit';
const cellDocs = (): NotebookCellDoc[] => cells.map((c, i) => ({ id: 'cell-' + (i + 1), type: c.type === 'code' ? 'code' : 'markdown', source: c.src }));

type Out = { k: 'text' | 'err' | 'warn'; s: string } | { k: 'img'; fig: number; w: number; h: number; rgb: Uint8Array; tool: boolean };
interface Cell { id: number; type: 'code' | 'md'; src: string; outs: Out[]; count: number | null; running: boolean; mdEdit: boolean }
interface FileRec { name: string; img: any }

const $ = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, any> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) (e as any)[k] = v;
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : String(v));
  }
  if (e instanceof HTMLButtonElement && props.title) {
    e.dataset.tooltip = String(props.title);
    if (!props['aria-label']) e.setAttribute('aria-label', String(props.title));
  }
  for (const c of kids) e.append(c);
  return e;
};
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); return true; } catch { return false; } }
};
let LANG: 'ar' | 'en' = 'ar';
const tr = (en: string, ar: string) => (LANG === 'ar' ? ar : en);
let mountRoot: HTMLElement;
let opts: MountOptions;
let baseUrl = '';
let mountToken = 0;
const $id = (id: string): HTMLElement | null => mountRoot.querySelector('#' + id);
let refreshToolbar = () => {};
let noticeTimer = 0;
let confirmResolve: ((accepted: boolean) => void) | null = null;
const imageToolState: { canvas: HTMLCanvasElement | null; image: Extract<Out, { k: 'img' }> | null; zoom: number } = { canvas: null, image: null, zoom: 1 };
const completionHost: CompletionHost = {
  workspace: () => vars.map(v => ({ name: v.name, cls: v.cls, size: v.size })),
  codeSources: () => cells.filter(c => c.type === 'code').map(c => c.src),
  fileNames: () => [...files.keys()]
};
const editorViews = new Map<number, EditorView>();
const editorStates = new Map<number, EditorState>();
const editorScroll = new Map<number, { top: number; left: number }>();
const matlabKeywords = new Set(['break', 'case', 'catch', 'continue', 'else', 'elseif', 'end', 'for', 'function', 'global', 'if', 'otherwise', 'persistent', 'return', 'switch', 'try', 'while']);
const matlabBuiltins = new Set([
  'arrayfun', 'cellfun', 'cell', 'struct', 'fieldnames', 'isfield', 'isstruct', 'iscell', 'num2cell',
  'imread', 'imwrite', 'imshow', 'imtool', 'imfinfo', 'imcrop', 'imresize', 'imrotate', 'imhist', 'histeq',
  'rgb2gray', 'rgb2hsv', 'rgb2ycbcr', 'im2double', 'im2uint8', 'ind2rgb', 'gray2ind',
  'uint8', 'uint16', 'uint32', 'uint64', 'int8', 'int16', 'int32', 'int64', 'single', 'double', 'logical',
  'abs', 'acos', 'asin', 'atan', 'ceil', 'cos', 'exp', 'floor', 'log', 'log10', 'max', 'mean', 'median',
  'min', 'mod', 'numel', 'prod', 'reshape', 'round', 'size', 'sort', 'sqrt', 'std', 'sum', 'tan',
  'any', 'all', 'find', 'length', 'linspace', 'zeros', 'ones', 'eye', 'repmat', 'flip', 'fliplr', 'flipud',
  'disp', 'fprintf', 'sprintf', 'error', 'warning', 'clear', 'clc', 'figure', 'plot', 'title', 'xlabel', 'ylabel'
]);
const matlabTypes = new Set(['cell', 'double', 'int8', 'int16', 'int32', 'int64', 'logical', 'single', 'struct', 'uint8', 'uint16', 'uint32', 'uint64']);
const matlabConstants = new Set(['false', 'true', 'eps', 'i', 'j', 'pi']);
const matlabMode = {
  ...octave,
  tokenTable: {
    keyword: tags.keyword,
    builtin: tags.standard(tags.variableName),
    variable: tags.variableName,
    type: tags.typeName,
    constant: tags.atom,
    string: tags.string,
    number: tags.number,
    comment: tags.comment,
    operator: tags.operator,
    error: tags.invalid
  },
  token(stream: Parameters<typeof octave.token>[0], state: Parameters<typeof octave.token>[1]) {
    const style = octave.token(stream, state);
    const word = stream.current();
    if (style === 'builtin' && matlabKeywords.has(word)) return 'keyword';
    if (style === 'variable') {
      if (matlabTypes.has(word)) return 'type';
      if (matlabBuiltins.has(word)) return 'builtin';
      if (matlabConstants.has(word)) return 'constant';
    }
    return style;
  }
};
const matlabLanguage = StreamLanguage.define(matlabMode);
const matlabHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--syntax-keyword)', fontWeight: '650' },
  { tag: tags.standard(tags.variableName), color: 'var(--syntax-builtin)', fontWeight: '600' },
  { tag: tags.typeName, color: 'var(--syntax-type)', fontWeight: '600' },
  { tag: tags.variableName, color: 'var(--syntax-variable)' },
  { tag: tags.string, color: 'var(--syntax-string)' },
  { tag: tags.number, color: 'var(--syntax-number)' },
  { tag: tags.atom, color: 'var(--syntax-constant)', fontWeight: '600' },
  { tag: tags.comment, color: 'var(--syntax-comment)', fontStyle: 'italic' },
  { tag: tags.operator, color: 'var(--syntax-operator)' },
  { tag: tags.invalid, color: 'var(--syntax-error)', textDecoration: 'underline wavy' }
]);
const editorTheme = EditorView.theme({
  '&': { color: 'var(--ink)', backgroundColor: 'var(--code)', fontSize: '14px' },
  '.cm-content': { fontFamily: 'ui-monospace, "Cascadia Code", Menlo, Consolas, monospace', padding: '12px 0', caretColor: 'var(--accent)' },
  '.cm-line': { padding: '0 14px' },
  '.cm-gutters': { color: 'var(--mute)', backgroundColor: 'var(--code)', border: 'none', borderRight: '1px solid var(--line)' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--accent) 7%, transparent)' },
  '.cm-activeLineGutter': { color: 'var(--ink)', backgroundColor: 'color-mix(in srgb, var(--accent) 7%, transparent)' },
  '.cm-cursor': { borderLeftColor: 'var(--accent)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: 'color-mix(in srgb, var(--ring) 34%, transparent) !important' },
  '.cm-matchingBracket': { color: 'var(--ink)', backgroundColor: 'color-mix(in srgb, var(--run) 20%, transparent)', outline: '1px solid var(--run)' },
  '.cm-nonmatchingBracket': { color: 'var(--syntax-error)' }
});
function notify(message: string) {
  if (opts.onNotice) { try { opts.onNotice(message); } catch { /* host handler failed */ } return; }
  const el = $id('notice');
  const text = $id('noticeMessage');
  if (!el || !text) return;
  text.textContent = message;
  el.hidden = false;
  window.clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(() => { el.hidden = true; }, 5000);
}
function confirmInApp(title: string, message: string, acceptLabel = tr('Continue', 'متابعة')): Promise<boolean> {
  if (opts.onConfirm) return Promise.resolve(opts.onConfirm(title, message, acceptLabel)).then(Boolean, () => false);
  const dialog = $id('confirmDialog') as HTMLDialogElement;
  $id('confirmTitle')!.textContent = title;
  $id('confirmMessage')!.textContent = message;
  dialog.querySelector<HTMLButtonElement>('[data-confirm-accept]')!.textContent = acceptLabel;
  return new Promise(resolve => {
    confirmResolve = resolve;
    dialog.showModal();
  });
}
function settleConfirm(accepted: boolean) {
  const dialog = $id('confirmDialog') as HTMLDialogElement | null;
  if (dialog?.open) dialog.close();
  const resolve = confirmResolve;
  confirmResolve = null;
  resolve?.(accepted);
}

// ---------------- state ----------------
let nextId = 1;
let cells: Cell[] = [];
let sel = 0;
const files = new Map<string, any>();
let vars: { name: string; size: string; cls: string; bytes: number }[] = [];
let cmdHist: string[] = [];
let execCount = 0;
let worker: Worker; let workerReady = false;
let publishedHash = '';
const assetManifest = new Map<string, string>();
const assetLoading = new Map<string, Promise<void>>();
let manifestReady: Promise<void> = Promise.resolve();
let curRun: { id: number; resolve: () => void; timer: number; fig: number } | null = null;

const mkCell = (type: 'code' | 'md', src: string): Cell => ({ id: nextId++, type, src, outs: [], count: null, running: false, mdEdit: false });

// ---------------- worker ----------------
function makeWorker(): Worker {
  const url = baseUrl + 'worker.js';
  try { return new Worker(url); }
  catch {
    // Fallback: same-origin synchronous fetch of the worker source, run from a Blob (never leaves the browser).
    const x = new XMLHttpRequest(); x.open('GET', url, false); x.send();
    return new Worker(URL.createObjectURL(new Blob([x.responseText], { type: 'text/javascript' })));
  }
}
function startWorker() {
  if (worker) worker.terminate();
  worker = makeWorker(); workerReady = false;
  worker.onmessage = onWorkerMsg;
  worker.onerror = ev => { appendOut('err', tr('Worker error: ', 'خطأ في المُنفِّذ: ') + ev.message); finishRun(); };
  for (const [name, img] of files) worker.postMessage({ t: 'putFile', name, img });
}
function appendOut(k: 'text' | 'err' | 'warn', s: string) {
  if (!curRun) return; const c = cells.find(x => x.id === curRun!.id); if (!c) return;
  const last = c.outs[c.outs.length - 1];
  if (k === 'text' && last && last.k === 'text') last.s += s; else c.outs.push({ k, s: k === 'warn' ? s.replace(/\n?$/, '\n') : s });
  scheduleRender();
}
function onWorkerMsg(e: MessageEvent) {
  const m = e.data;
  switch (m.t) {
    case 'ready': workerReady = true; break;
    case 'print': appendOut('text', m.s); break;
    case 'warn': appendOut('warn', m.s); break;
    case 'clc': if (curRun) { const c = cells.find(x => x.id === curRun!.id)!; c.outs = c.outs.filter(o => o.k === 'err'); scheduleRender(); } break;
    case 'fig': if (curRun) curRun.fig++; break;
    case 'img': if (curRun) {
      const c = cells.find(x => x.id === curRun!.id)!;
      if (curRun.fig === 0) curRun.fig = 1;
      const fig = m.tool ? -curRun.fig : curRun.fig;
      if (!m.tool) c.outs = c.outs.filter(o => !(o.k === 'img' && o.fig === fig));   // imshow into the same figure replaces the previous image
      const image: Extract<Out, { k: 'img' }> = { k: 'img', fig, w: m.w, h: m.h, rgb: m.rgb, tool: m.tool };
      c.outs.push(image); scheduleRender();
      if (m.tool) openImageTool(image);
    } break;
    case 'wrote': files.set(m.name, m.img); renderSide(); break;
    case 'vars': vars = m.vars; renderSide(); break;
    case 'done': if (curRun && curRun.id === m.id) {
      const c = cells.find(x => x.id === m.id);
      if (c && m.error) c.outs.push({ k: 'err', s: m.error + '\n' });
      vars = m.vars; finishRun(); renderSide();
    } break;
  }
}
function finishRun() {
  if (!curRun) return; clearTimeout(curRun.timer);
  const c = cells.find(x => x.id === curRun!.id); if (c) c.running = false;
  const r = curRun.resolve; curRun = null; setStatus(tr('Ready', 'جاهز')); render(); r();
}
function runCell(c: Cell): Promise<void> {
  if (c.type !== 'code') return Promise.resolve();
  if (curRun) return Promise.resolve();
  return new Promise(resolve => {
    c.outs = []; c.running = true; c.count = ++execCount;
    for (const ln of c.src.split(/\r?\n/)) { const t = ln.trim(); if (t && !t.startsWith('%') && t !== 'end') cmdHist.push(t); }
    cmdHist = cmdHist.slice(-300); store.set(histKey(), JSON.stringify(cmdHist));
    const timer = window.setTimeout(() => {
      appendOut('err', tr('Execution stopped: time limit (60 s) exceeded. The workspace was reset.\n', 'توقف التنفيذ: تجاوز الحد الزمني (60 ثانية). تمت إعادة ضبط مساحة العمل.\n')); startWorker(); vars = []; finishRun(); renderSide();
    }, 60000);
    curRun = { id: c.id, resolve, timer, fig: 0 };
    setStatus(tr('Running…', 'قيد التشغيل…')); render();
    void ensureAssetsFor(c.src).then(() => { if (curRun && curRun.id === c.id) worker.postMessage({ t: 'run', id: c.id, src: c.src }); });
  });
}
function stopRun() {
  if (!curRun) return; appendOut('err', tr('Execution interrupted by user. The workspace was reset.\n', 'تم إيقاف التنفيذ بواسطة المستخدم. تمت إعادة ضبط مساحة العمل.\n')); startWorker(); vars = []; finishRun(); renderSide();
}
async function runAll() { for (const c of cells) { if (c.type === 'code') await runCell(c); if (c.outs.some(o => o.k === 'err')) break; } }
function resetWorkspace() { if (curRun) return; worker.postMessage({ t: 'reset' }); vars = []; renderSide(); }

// ---------------- assets (fetched per file from the host build) ----------------
const baseName = (p: string) => p.split(/[\\/]/).pop() || p;
function referencedAssets(src: string): string[] {
  const out = new Set<string>();
  for (const m of src.matchAll(/['"]([^'"\n]{1,200})['"]/g)) { const real = assetManifest.get(baseName(m[1]).toLowerCase()); if (real) out.add(real); }
  return [...out];
}
function loadAsset(name: string): Promise<void> {
  if (files.has(name)) return Promise.resolve();
  const inflight = assetLoading.get(name); if (inflight) return inflight;
  const token = mountToken;
  const p = fetch(baseUrl + 'assets/' + encodeURIComponent(name) + '.json').then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() as Promise<AssetRec>; }).then(s => {
    if (token !== mountToken) return;
    const bin = atob(s.b64), d = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) d[i] = bin.charCodeAt(i);
    const { b64, ...rest } = s; void b64; const img = { ...rest, data: d }; files.set(name, img); worker?.postMessage({ t: 'putFile', name, img }); renderSide();
  }).catch(err => { console.warn('MLWeb: could not load asset', name, err); }).finally(() => { assetLoading.delete(name); });
  assetLoading.set(name, p); return p;
}
async function ensureAssetsFor(src: string) { await manifestReady; await Promise.all(referencedAssets(src).map(loadAsset)); }

// Local learner work lives only in this browser, namespaced per notebook id + schema version.
// It never changes the published admin version and is never sent to a server.
const nbKey = () => `mlweb.nb.${opts.notebook.id}.v${opts.notebook.schemaVersion}`;
const histKey = () => `mlweb.hist.${opts.notebook.id}.v${opts.notebook.schemaVersion}`;
const hashStr = (t: string) => { let h = 2166136261; for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
const snapOf = (list: { type: string; src: string }[]) => hashStr(JSON.stringify(list.map(c => [c.type, c.src])));
const publishedCells = (): Cell[] => {
  const list = (opts.notebook.cells || []).map(c => mkCell(c.type === 'code' ? 'code' : 'md', String(c.source ?? '')));
  return list.length ? list : [mkCell('code', '')];
};
function updateSaveState() {
  const el = $id('saveState'); if (!el || isEdit()) return;
  const local = snapOf(cells) !== publishedHash;
  el.textContent = local ? tr('Local edits · saved in this browser only', 'تعديلات محلية · محفوظة في هذا المتصفح فقط') : tr('Published version', 'النسخة المنشورة');
  el.dataset.state = local ? 'local' : 'published';
}
const save = () => {
  if (isEdit()) { try { opts.onChange?.(cellDocs()); } catch { /* host handler failed */ } return; }
  const saved = store.set(nbKey(), JSON.stringify({ v: 1, pub: publishedHash, cells: cells.map(c => ({ type: c.type, src: c.src })) }));
  updateSaveState();
  if (!saved) notify(tr('Notebook could not be saved in this browser. Export a copy to avoid losing changes.', 'تعذر حفظ دفتر العمل في هذا المتصفح. صدّر نسخة لتجنب فقدان التغييرات.'));
};
function load(): Cell[] | null {
  const s = store.get(nbKey()); if (!s) return null;
  try {
    const j = JSON.parse(s);
    const arr = Array.isArray(j) ? j : j && Array.isArray(j.cells) ? j.cells : null;
    if (!arr || !arr.length) return null;
    const list = arr.map((x: any) => ({ type: x?.type === 'code' ? 'code' : 'md', src: String(x?.src ?? '') }));
    // If the learner never edited and the admin has since republished, show the new published version.
    if (j && !Array.isArray(j) && j.pub && j.pub !== publishedHash && snapOf(list) === j.pub) return null;
    if (j && !Array.isArray(j) && j.pub && j.pub !== publishedHash) setTimeout(() => notify(tr('This notebook was updated by the author. Your local edits were kept; use "Reset to published version" to see the new one.', 'حدّث المؤلف هذا الدفتر. تم الاحتفاظ بتعديلاتك المحلية؛ استخدم «العودة إلى النسخة المنشورة» لعرض الجديد.')), 0);
    return list.map((x: any) => mkCell(x.type, x.src));
  } catch { /* ignore corrupt local data */ }
  return null;
}
function resetToPublished() {
  if (curRun) stopRun();
  store.set(nbKey(), '');
  for (const id of [...editorStates.keys()]) { editorStates.delete(id); editorScroll.delete(id); }
  cells = publishedCells(); sel = 0; save(); startWorker(); vars = []; render(); renderSide();
  void Promise.all(cells.map(c => ensureAssetsFor(c.src)));
}

const helpReference = [
  ['Notebook', 'Shift+Enter runs and advances; Ctrl+Enter runs in place; Ctrl+Shift+P or ? opens help.', 'يشغّل Shift+Enter الخلية وينتقل للتالية؛ يشغّل Ctrl+Enter في مكانه؛ ويفتح Ctrl+Shift+P أو ? المساعدة.'],
  ['Command mode', 'Press Esc to leave the editor, then: A insert above, B insert below, D D delete, M to text, Y to code, Up/Down or K/J move, Enter edit, Shift+Enter run and select next.', 'اضغط Esc للخروج من المحرر ثم: A إدراج أعلاه، B إدراج أسفله، D D حذف، M إلى نص، Y إلى كود، الأسهم أو K/J للتنقل، Enter للتحرير، Shift+Enter للتشغيل والانتقال للتالية.'],
  ['Editor', 'Ctrl+Space opens autocomplete; Tab/Enter accepts a suggestion; Tab indents; Esc closes suggestions.', 'يفتح Ctrl+Space الإكمال التلقائي؛ يقبل Tab/Enter الاقتراح؛ يزيد Tab المسافة البادئة؛ ويغلق Esc الاقتراحات.'],
  ['switch / case', 'Choose one branch with switch value, case value, otherwise, and end.', 'اختر فرعاً باستخدام switch وcase وotherwise وend.'],
  ['Arrays and cells', 'Create numeric arrays with [1 2; 3 4] and cell arrays with {1, "text"}.', 'أنشئ مصفوفة رقمية مثل [1 2; 3 4] أو خلية مثل {1, "text"}.'],
  ['Structs', "Read and assign fields with s.name; create values with struct('name', value).", 'اقرأ وعيّن الحقول باستخدام s.name؛ وأنشئ البنية عبر struct.'],
  ['Image input/output', 'imread, imwrite, imshow, imtool, imfinfo, and histeq.', 'أوامر الصور: imread وimwrite وimshow وimtool وimfinfo وhisteq.'],
  ['Image transforms', 'rgb2gray, rgb2hsv, rgb2ycbcr, imcrop, imresize, imrotate, imhist.', 'تحويلات الصور: rgb2gray وrgb2hsv وrgb2ycbcr وimcrop وimresize وimrotate وimhist.'],
  ['Array operations', 'size, numel, length, reshape, repmat, indexing, ranges, and logical masks.', 'عمليات المصفوفات: size وnumel وlength وreshape وrepmat والفهرسة والنطاقات.'],
  ['Math and display', 'sum, mean, max, min, abs, sqrt, disp, fprintf, sprintf, and error.', 'الحساب والعرض: sum وmean وmax وmin وabs وsqrt وdisp وfprintf وsprintf وerror.'],
  ['Compatibility', 'MLWeb implements an educational MATLAB-style subset; it is not a full MATLAB runtime.', 'يقدم MLWeb مجموعة تعليمية بأسلوب MATLAB وليس بيئة MATLAB كاملة.']
];
function renderHelp() {
  const dialog = $id('helpDialog') as HTMLDialogElement | null;
  const items = $id('helpItems');
  const search = $id('helpSearch') as HTMLInputElement | null;
  if (!dialog || !items || !search) return;
  const query = search.value.trim().toLowerCase();
  items.replaceChildren();
  for (const [title, description, arabic] of helpReference) {
    const shown = tr(description, arabic);
    if (query && !(title + ' ' + description + ' ' + arabic).toLowerCase().includes(query)) continue;
    items.append($('article', { class: 'help-item' }, $('b', {}, title), $('p', {}, shown)));
  }
}
function openHelp() {
  const dialog = $id('helpDialog') as HTMLDialogElement | null;
  if (!dialog) return;
  $id('helpTitle')!.textContent = tr('MLWeb help', 'مساعدة MLWeb');
  $id('closeHelp')!.textContent = tr('Close', 'إغلاق');
  $id('helpIntro')!.textContent = tr('Search supported MATLAB-style commands and notebook shortcuts.', 'ابحث عن أوامر MATLAB المدعومة واختصارات دفتر العمل.');
  const search = $id('helpSearch') as HTMLInputElement;
  search.placeholder = tr('Search commands…', 'ابحث عن الأوامر…');
  search.value = '';
  renderHelp();
  if (!dialog.open) dialog.showModal();
  search.focus();
}
// ---------------- markdown (tiny) ----------------
const esc = (s: string) => s.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));
function renderTex(tex: string, display: boolean): string {
  const k = (window as any).katex;
  if (!k) return esc((display ? '$$' : '$') + tex + (display ? '$$' : '$'));
  try { return k.renderToString(tex, { displayMode: display, throwOnError: false, strict: 'ignore' }); } catch { return esc(tex); }
}
function md(src: string): string {
  // Math ($…$ / $$…$$) is rendered with the host page's KaTeX; code spans/fences are left untouched.
  const codes: string[] = [], maths: string[] = [];
  src = src.replace(/```[\s\S]*?```|`[^`\n]+`/g, m => `\uE002${codes.push(m) - 1}\uE003`)
    .replace(/\$\$([\s\S]+?)\$\$/g, (_m, t) => `\uE000${maths.push(renderTex(t.trim(), true)) - 1}\uE001`)
    .replace(/\$([^$\n]+?)\$/g, (_m, t) => `\uE000${maths.push(renderTex(t.trim(), false)) - 1}\uE001`)
    .replace(/\uE002(\d+)\uE003/g, (_m, i) => codes[+i]);
  return mdBase(src).replace(/\uE000(\d+)\uE001/g, (_m, i) => maths[+i]);
}
function mdBase(src: string): string {
  const inline = (t: string) => esc(t).replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>').replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\*([^*]+)\*/g, '<i>$1</i>');
  const out: string[] = []; let list: 'ul' | 'ol' | null = null, para: string[] = [], code: string[] | null = null, tbl: string[][] | null = null;
  const flushT = () => { if (tbl) { out.push('<table>' + tbl.map((r, i) => '<tr>' + r.map(c => (i === 0 ? '<th>' : '<td>') + inline(c) + (i === 0 ? '</th>' : '</td>')).join('') + '</tr>').join('') + '</table>'); tbl = null; } };
  const flushP = () => { if (para.length) { out.push('<p>' + inline(para.join(' ')) + '</p>'); para = []; } };
  const flushL = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const ln of src.split(/\r?\n/)) {
    if (code) { if (/^```/.test(ln)) { out.push('<pre>' + esc(code.join('\n')) + '</pre>'); code = null; } else code.push(ln); continue; }
    if (/^```/.test(ln)) { flushP(); flushL(); code = []; continue; }
    let m;
    if (/^\s*\|.*\|\s*$/.test(ln)) { flushP(); flushL(); if (!tbl) tbl = []; if (!/^\s*\|[\s:|-]+\|\s*$/.test(ln)) tbl.push(ln.trim().replace(/^\||\|$/g, '').split('|').map(x => x.trim())); continue; }
    if (tbl) flushT();
    if ((m = /^(#{1,3})\s+(.*)/.exec(ln))) { flushP(); flushL(); out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); }
    else if ((m = /^\s*[-*]\s+(.*)/.exec(ln))) { flushP(); if (list !== 'ul') { flushL(); out.push('<ul>'); list = 'ul'; } out.push('<li>' + inline(m[1]) + '</li>'); }
    else if ((m = /^\s*\d+\.\s+(.*)/.exec(ln))) { flushP(); if (list !== 'ol') { flushL(); out.push('<ol>'); list = 'ol'; } out.push('<li>' + inline(m[1]) + '</li>'); }
    else if (!ln.trim()) { flushP(); flushL(); } else { flushL(); para.push(ln.trim()); }
  }
  if (code) out.push('<pre>' + esc(code.join('\n')) + '</pre>'); flushP(); flushL(); flushT();
  return out.join('\n').replace(/<(p|h[1-3]|li)>/g, '<$1 dir="auto">');
}

// ---------------- image helpers ----------------
function rawToCanvas(img: { width: number; height: number; channels: number; data: Uint8Array; colormap?: number[][] }): HTMLCanvasElement {
  const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
  const id = new ImageData(img.width, img.height), n = img.width * img.height;
  for (let i = 0; i < n; i++) {
    if (img.channels === 1 && img.colormap) { const c = img.colormap[Math.min(img.colormap.length - 1, img.data[i])]; id.data[i * 4] = c[0] * 255; id.data[i * 4 + 1] = c[1] * 255; id.data[i * 4 + 2] = c[2] * 255; }
    else if (img.channels === 1) { const v = img.data[i]; id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v; }
    else { id.data[i * 4] = img.data[i * 3]; id.data[i * 4 + 1] = img.data[i * 3 + 1]; id.data[i * 4 + 2] = img.data[i * 3 + 2]; }
    id.data[i * 4 + 3] = 255;
  }
  cv.getContext('2d')!.putImageData(id, 0, 0); return cv;
}
function rgbToCanvas(w: number, h: number, rgb: Uint8Array): HTMLCanvasElement { return rawToCanvas({ width: w, height: h, channels: 3, data: rgb }); }
const toBlob = (cv: HTMLCanvasElement, type: string) => new Promise<Blob>(res => cv.toBlob(b => res(b!), type, 0.92));
function download(name: string, blob: Blob) { const a = $('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); a.remove(); }
async function downloadImage(name: string, img: any) {
  const ext = (name.split('.').pop() || 'png').toLowerCase(), type = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png';
  download(type === 'image/png' && ext !== 'png' ? name.replace(/\.\w+$/, '') + '.png' : name, await toBlob(rawToCanvas(img), type));
}
async function addUpload(f: File) {
  const bmp = await createImageBitmap(f), cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
  const g = cv.getContext('2d')!; g.drawImage(bmp, 0, 0); const px = g.getImageData(0, 0, bmp.width, bmp.height).data, n = bmp.width * bmp.height, d = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) { d[i * 3] = px[i * 4]; d[i * 3 + 1] = px[i * 4 + 1]; d[i * 3 + 2] = px[i * 4 + 2]; }
  const ext = (f.name.split('.').pop() || 'png').toLowerCase();
  const img = { width: bmp.width, height: bmp.height, channels: 3, data: d, bitDepth: 24, format: ext === 'jpeg' ? 'jpg' : ext, fileSize: f.size, colorType: 'truecolor', filename: '/vfs/' + f.name, fileModDate: new Date(f.lastModified).toUTCString() };
  files.set(f.name, img); worker.postMessage({ t: 'putFile', name: f.name, img }); renderSide();
}

// ---------------- rendering ----------------
let renderQ = 0;
function scheduleRender() { if (!renderQ) renderQ = requestAnimationFrame(() => { renderQ = 0; render(); }); }
const nb = () => $id('nb')!;
function setStatus(s: string) {
  const el = $id('status');
  if (el) { el.textContent = s; el.title = s; el.setAttribute('aria-label', s); el.dataset.state = curRun ? 'running' : 'idle'; }
  const stop = $id('stop');
  stop?.toggleAttribute('disabled', !curRun);
  if (stop) stop.hidden = !curRun;
}

function figureEl(o: Extract<Out, { k: 'img' }>): HTMLElement {
  const cv = rgbToCanvas(o.w, o.h, o.rgb), px = $('div', { class: 'px' }, ' ');
  let zoom = 1; const apply = () => { cv.style.width = o.w * zoom + 'px'; cv.style.height = o.h * zoom + 'px'; cv.style.imageRendering = zoom > 1 ? 'pixelated' : 'auto'; };
  if (o.w > 640) zoom = 640 / o.w; apply();
  cv.onmousemove = ev => {
    const r = cv.getBoundingClientRect(), x = Math.floor((ev.clientX - r.left) / r.width * o.w), y = Math.floor((ev.clientY - r.top) / r.height * o.h);
    if (x < 0 || y < 0 || x >= o.w || y >= o.h) return; const i = (y * o.w + x) * 3, d = o.rgb;
    px.textContent = `${tr('Pixel info', 'معلومات البكسل')}: (${tr('row', 'صف')} ${y + 1}, ${tr('col', 'عمود')} ${x + 1})  [${d[i]} ${d[i + 1]} ${d[i + 2]}]`;
  };
  cv.onmouseleave = () => { px.textContent = ' '; };
  const cap = $('div', { class: 'cap' }, o.tool ? `${tr('Image Tool', 'أداة الصورة')} · ${o.w}×${o.h}` : `${tr('Figure', 'شكل')} ${o.fig} · ${o.w}×${o.h}`);
  if (o.tool) cap.append($('button', { title: tr('Reopen interactive Image Tool', 'إعادة فتح أداة الصورة التفاعلية'), onclick: () => openImageTool(o) }, tr('Open viewer', 'فتح العارض')));
  const zb = (t: string, f: () => void) => $('button', { title: tr('Zoom image', 'تكبير الصورة'), onclick: () => { f(); apply(); } }, t);
  cap.append(zb('+', () => { zoom *= 1.5; }), zb('−', () => { zoom /= 1.5; }), zb('100%', () => { zoom = 1; }));
  cap.append($('button', { onclick: async () => download(`figure${Math.abs(o.fig)}.png`, await toBlob(cv, 'image/png')) }, 'PNG'));
  return $('div', { class: 'fig' }, cap, $('div', { class: 'scroll' }, cv), px);
}
function setImageToolZoom(zoom: number) {
  const image = imageToolState.image, canvas = imageToolState.canvas;
  if (!image || !canvas) return;
  imageToolState.zoom = Math.max(0.05, Math.min(16, zoom));
  canvas.style.width = `${image.w * imageToolState.zoom}px`;
  canvas.style.height = `${image.h * imageToolState.zoom}px`;
  canvas.style.imageRendering = imageToolState.zoom > 1 ? 'pixelated' : 'auto';
  $id('imageToolMeta')!.textContent = `${image.w} × ${image.h} px · ${Math.round(imageToolState.zoom * 100)}%`;
}
function fitImageTool() {
  const image = imageToolState.image;
  const stage = $id('imageToolStage');
  if (!image || !stage) return;
  const padding = 32;
  const zoom = Math.min(1, (stage.clientWidth - padding) / image.w, (stage.clientHeight - padding) / image.h);
  setImageToolZoom(Math.max(0.05, zoom));
  stage.scrollTo(0, 0);
}
function openImageTool(image: Extract<Out, { k: 'img' }>) {
  const dialog = $id('imageTool') as HTMLDialogElement;
  const stage = $id('imageToolStage')!;
  imageToolState.image = image;
  imageToolState.canvas = rgbToCanvas(image.w, image.h, image.rgb);
  const canvas = imageToolState.canvas;
  canvas.setAttribute('aria-label', tr(`Image ${image.w} by ${image.h} pixels. Move pointer to inspect pixels.`, `صورة ${image.w} × ${image.h} بكسل. حرّك المؤشر لفحص البكسلات.`));
  canvas.onmousemove = event => {
    const rect = canvas.getBoundingClientRect();
    const x = Math.min(image.w - 1, Math.max(0, Math.floor((event.clientX - rect.left) / rect.width * image.w)));
    const y = Math.min(image.h - 1, Math.max(0, Math.floor((event.clientY - rect.top) / rect.height * image.h)));
    const p = (y * image.w + x) * 3;
    $id('imagePixelInfo')!.textContent = `${tr('Pixel info', 'معلومات البكسل')} · X: ${x + 1}, Y: ${y + 1} · RGB: [${image.rgb[p]}, ${image.rgb[p + 1]}, ${image.rgb[p + 2]}]`;
  };
  stage.replaceChildren(canvas);
  $id('imageToolTitle')!.textContent = tr('Image Tool', 'أداة الصورة');
  $id('imagePixelInfo')!.textContent = tr('Pixel info: move over the image', 'معلومات البكسل: حرّك المؤشر فوق الصورة');
  if (!dialog.open) dialog.showModal();
  requestAnimationFrame(fitImageTool);
}
function runFromEditor(cell: Cell, advance: boolean, command = false) {
  if (curRun) return true;
  void runCell(cell).then(() => {
    if (!advance) return;
    const index = cells.indexOf(cell);
    if (index < 0) return;
    if (index === cells.length - 1) cells.push(mkCell('code', ''));
    sel = index + 1;
    save();
    if (command) focusCommand(cells[sel].id); else focusCell(cells[sel].id);
  });
  return true;
}
function cellEl(c: Cell, i: number): HTMLElement {
  const mv = (d: number) => () => { const j = i + d; if (j < 0 || j >= cells.length) return; [cells[i], cells[j]] = [cells[j], cells[i]]; sel = j; save(); render(); };
  const tools = $('div', { class: 'tools' });
  const prompt = $('span', { class: 'idx', 'aria-hidden': true }, c.type === 'md' ? '' : c.running ? 'In [*]:' : `In [${c.count ?? ' '}]:`);
  if (c.type === 'code') tools.append($('button', { class: 'primary', disabled: !!curRun, title: tr('Run cell · Shift+Enter', 'تشغيل الخلية · Shift+Enter'), onclick: () => runCell(c) }, tr('▶ Run', '▶ تشغيل')));
  else tools.append($('button', { title: tr('Edit text cell', 'تحرير خلية النص'), onclick: () => { c.mdEdit = !c.mdEdit; render(); } }, c.mdEdit ? tr('Done', 'تم') : tr('Edit', 'تحرير')));
  const insertAt = (type: 'code' | 'md', offset: number) => () => {
    const added = mkCell(type, type === 'md' ? '## Heading' : '');
    added.mdEdit = added.type === 'md';
    const at = i + offset;
    cells.splice(at, 0, added);
    sel = at;
    save();
    render();
    if (added.type === 'code') focusCell(added.id);
  };
  const menuItem = (label: string, action: () => void) => $('button', { onclick: (event: MouseEvent) => { action(); (event.currentTarget as HTMLElement).closest('details')?.removeAttribute('open'); } }, label);
  const duplicate = () => { const copy = mkCell(c.type, c.src); copy.mdEdit = c.type === 'md'; cells.splice(i + 1, 0, copy); sel = i + 1; save(); render(); if (copy.type === 'code') focusCell(copy.id); };
  const remove = () => { cells.splice(i, 1); if (!cells.length) cells.push(mkCell('code', '')); sel = Math.min(sel, cells.length - 1); save(); render(); };
  const options = $('details', { class: 'cell-menu' },
    $('summary', { title: tr('Cell options', 'خيارات الخلية'), 'aria-label': tr('Cell options', 'خيارات الخلية') }, '⋯'),
    $('div', { class: 'cell-menu-items' },
      menuItem(tr('Insert code cell above', 'إدراج خلية كود أعلاه'), insertAt('code', 0)),
      menuItem(tr('Insert text cell above', 'إدراج خلية نص أعلاه'), insertAt('md', 0)),
      menuItem(tr('Duplicate cell', 'تكرار الخلية'), duplicate),
      menuItem(tr('Move cell up', 'نقل الخلية لأعلى'), mv(-1)),
      menuItem(tr('Move cell down', 'نقل الخلية لأسفل'), mv(1)),
      ...(c.outs.length ? [menuItem(tr('Clear cell output', 'مسح مخرجات الخلية'), () => { c.outs = []; c.count = null; render(); })] : []),
      menuItem(c.type === 'md' ? tr('Convert to code', 'تحويل إلى كود') : tr('Convert to text', 'تحويل إلى نص'), () => { c.type = c.type === 'md' ? 'code' : 'md'; c.outs = []; c.mdEdit = c.type === 'md'; save(); render(); }),
      menuItem(tr('Delete cell', 'حذف الخلية'), remove)));
  tools.append($('span', { class: 'sp' }), options);
  const el = $('section', { class: 'cell' + (i === sel ? ' sel' : '') + (c.running ? ' running' : ''), tabindex: -1, 'aria-label': tr(`${c.type === 'md' ? 'Text' : 'Code'} cell ${i + 1}`, `خلية ${c.type === 'md' ? 'نص' : 'كود'} ${i + 1}`) }, prompt, tools);
  el.addEventListener('focusin', () => { if (sel !== i) { sel = i; mountRoot.querySelectorAll('.cell').forEach((n, k) => n.classList.toggle('sel', k === i)); } });
  if (c.type === 'md' && !c.mdEdit) { const v = $('div', { class: 'md' }); v.innerHTML = md(c.src); v.ondblclick = () => { c.mdEdit = true; render(); }; el.append(v); }
  else if (c.type === 'md') {
    const ta = $('textarea', { class: 'src mdsrc', dir: 'auto', spellcheck: false, rows: 1, 'data-cell': c.id });
    ta.value = c.src; const fit = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 2 + 'px'; }; requestAnimationFrame(fit);
    ta.oninput = () => { c.src = ta.value; fit(); save(); };
    ta.onkeydown = ev => {
      if (ev.key === 'Enter' && (ev.shiftKey || ev.ctrlKey || ev.metaKey)) {
        ev.preventDefault();
        c.mdEdit = false; render();
      } else if (ev.key === 'Tab') { ev.preventDefault(); const s = ta.selectionStart; ta.setRangeText('    ', s, ta.selectionEnd, 'end'); c.src = ta.value; fit(); save(); }
    };
    el.append(ta);
  } else {
    const host = $('div', { class: 'code-editor', dir: 'ltr', 'data-cell': c.id });
    el.append(host);
    const state = editorStates.get(c.id) ?? EditorState.create({
      doc: c.src,
      extensions: [
        basicSetup,
        matlabLanguage,
        syntaxHighlighting(matlabHighlight),
        editorTheme,
        EditorView.lineWrapping,
        EditorState.tabSize.of(4),
        indentUnit.of('    '),
        indentGuides(),
        completionExtension(opts.notebook.runtime || 'matlab', completionHost),
        Prec.highest(keymap.of([
          { key: 'Shift-Enter', run: () => runFromEditor(c, true) },
          { key: 'Mod-Enter', run: () => runFromEditor(c, false) },
          { key: 'Escape', run: () => enterCommandMode(c) },
          indentWithTab
        ])),
        EditorView.updateListener.of(update => {
          if (update.docChanged) {
            c.src = update.state.doc.toString();
            editorStates.set(c.id, update.state);
            save();
          }
        })
      ]
    });
    const view = new EditorView({ state, parent: host });
    editorViews.set(c.id, view);
    editorStates.set(c.id, view.state);
    requestAnimationFrame(() => view.requestMeasure());
  }
  const outs = $('div', { class: 'outs' });
  for (const o of c.outs) {
    if (o.k === 'img') outs.append(figureEl(o)); else outs.append($('pre', { class: 'o' + (o.k === 'text' ? '' : ' ' + o.k) }, o.s.replace(/\n+$/, '\n')));
  }
  const insert = $('div', { class: 'cell-insert', role: 'group', 'aria-label': tr('Insert a cell below', 'إدراج خلية أدناه') },
    $('button', { onclick: insertAt('code', 1) }, tr('+ Code', '+ كود')),
    $('button', { onclick: insertAt('md', 1) }, tr('+ Text', '+ نص')));
  el.append(outs, insert); return el;
}
let focusId: number | null = null;
let cmdFocusId: number | null = null;
function focusCell(id: number) { focusId = id; render(); }
/** Command mode (Jupyter): focus is on the cell itself, not inside its editor. */
function focusCommand(id: number) { cmdFocusId = id; render(); }
function enterCommandMode(c: Cell) {
  const i = cells.indexOf(c); if (i < 0) return false;
  sel = i;
  const el = mountRoot.querySelectorAll<HTMLElement>('.cell')[i];
  (document.activeElement as HTMLElement | null)?.blur?.();
  el?.focus();
  return true;
}
let pendingD = 0;
function onCommandKey(ev: KeyboardEvent) {
  const target = ev.target as HTMLElement | null;
  if (!target || !target.classList?.contains('cell')) return;
  const i = Array.from(mountRoot.querySelectorAll('.cell')).indexOf(target);
  const c = cells[i]; if (!c) return;
  const key = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key;
  const go = (j: number) => { j = Math.max(0, Math.min(cells.length - 1, j)); sel = j; focusCommand(cells[j].id); };
  if (ev.key === 'Enter' && (ev.shiftKey || ev.ctrlKey || ev.metaKey)) {
    ev.preventDefault();
    if (c.type === 'code') runFromEditor(c, ev.shiftKey, true);
    else if (ev.shiftKey) go(i + 1);
    return;
  }
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
  const insert = (at: number) => { const added = mkCell('code', ''); cells.splice(at, 0, added); sel = at; save(); focusCommand(added.id); };
  switch (key) {
    case 'Enter': ev.preventDefault(); if (c.type === 'md') { c.mdEdit = true; } focusCell(c.id); break;
    case 'ArrowUp': case 'k': ev.preventDefault(); go(i - 1); break;
    case 'ArrowDown': case 'j': ev.preventDefault(); go(i + 1); break;
    case 'a': ev.preventDefault(); insert(i); break;
    case 'b': ev.preventDefault(); insert(i + 1); break;
    case 'm': ev.preventDefault(); if (c.type !== 'md') { c.type = 'md'; c.outs = []; c.count = null; c.mdEdit = false; save(); focusCommand(c.id); } break;
    case 'y': ev.preventDefault(); if (c.type !== 'code') { c.type = 'code'; c.mdEdit = false; save(); focusCommand(c.id); } break;
    case 'd': {
      ev.preventDefault();
      const now = Date.now();
      if (now - pendingD < 900) {
        pendingD = 0;
        cells.splice(i, 1); if (!cells.length) cells.push(mkCell('code', ''));
        const j = Math.min(i, cells.length - 1); sel = j; save(); focusCommand(cells[j].id);
      } else pendingD = now;
      break;
    }
    default: return;
  }
  if (key !== 'd') pendingD = 0;
}

function render() {
  const root = nb(), y = window.scrollY, active = document.activeElement as HTMLTextAreaElement | null;
  let keep: { id: string; s: number; e: number } | null = active && active.dataset?.cell ? { id: active.dataset.cell, s: active.selectionStart, e: active.selectionEnd } : null;
  let keepEditorId: number | null = null;
  const keepCommand = active instanceof HTMLElement && active.classList.contains('cell') ? Array.from(root.children).indexOf(active) : -1;
  for (const [id, view] of editorViews) {
    if (view.hasFocus) keepEditorId = id;
    editorStates.set(id, view.state);
    editorScroll.set(id, { top: view.scrollDOM.scrollTop, left: view.scrollDOM.scrollLeft });
    view.destroy();
  }
  editorViews.clear();
  const codeIds = new Set(cells.filter(cell => cell.type === 'code').map(cell => cell.id));
  for (const id of editorStates.keys()) {
    if (!codeIds.has(id)) { editorStates.delete(id); editorScroll.delete(id); }
  }
  root.replaceChildren();
    cells.forEach((c, i) => root.append(cellEl(c, i)));
  if (focusId !== null) {
    const view = editorViews.get(focusId);
    if (view) {
      const end = view.state.doc.length;
      view.dispatch({ selection: { anchor: end } });
      view.focus();
      view.scrollDOM.scrollTop = view.scrollDOM.scrollHeight;
    } else {
      const t = mountRoot.querySelector<HTMLTextAreaElement>(`textarea[data-cell="${focusId}"]`);
      if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); t.scrollIntoView({ block: 'nearest' }); }
    }
    focusId = null; keep = null; keepEditorId = null;
  }
  if (keep) { const t = mountRoot.querySelector<HTMLTextAreaElement>(`textarea[data-cell="${keep.id}"]`); if (t) { t.focus({ preventScroll: true }); t.setSelectionRange(keep.s, keep.e); } }
  else if (keepEditorId !== null) {
    const view = editorViews.get(keepEditorId), scroll = editorScroll.get(keepEditorId);
    if (view) { view.focus(); if (scroll) view.scrollDOM.scrollTo(scroll.left, scroll.top); }
  }
  if (cmdFocusId !== null) {
    const idx = cells.findIndex(x => x.id === cmdFocusId);
    mountRoot.querySelectorAll<HTMLElement>('.cell')[idx]?.focus();
    cmdFocusId = null;
  } else if (keepCommand >= 0 && focusId === null && !document.activeElement?.closest?.('.cell')) {
    mountRoot.querySelectorAll<HTMLElement>('.cell')[Math.min(keepCommand, cells.length - 1)]?.focus({ preventScroll: true });
  }
  window.scrollTo(0, y);
  const stop = $id('stop');
  stop?.toggleAttribute('disabled', !curRun);
  if (stop) stop.hidden = !curRun;
}
function fmtBytes(n: number) { return n < 1024 ? n + ' B' : (n / 1024).toFixed(1) + ' KB'; }
function renderSide() {
  const side = $id('side')!; side.replaceChildren();
  const ws = $('div', { class: 'body' });
  if (!vars.length) ws.append($('div', { class: 'empty' }, tr('Run a cell to see variables here.', 'شغّل خلية لعرض المتغيرات هنا.')));
  else {
    const t = $('table', { class: 'ws' }, $('tr', {}, ...[tr('Name', 'الاسم'), tr('Size', 'الحجم'), tr('Class', 'النوع'), tr('Bytes', 'بايت')].map(h => $('th', {}, h))));
    for (const v of vars) {
      const name = $('button', { title: tr('Insert variable name in a new code cell', 'إضافة اسم المتغير إلى خلية كود جديدة'), onclick: () => { cells.push(mkCell('code', v.name)); sel = cells.length - 1; save(); focusCell(cells[sel].id); } }, v.name);
      t.append($('tr', {}, $('td', {}, name), $('td', {}, v.size), $('td', {}, v.cls), $('td', {}, v.bytes ? fmtBytes(v.bytes) : '—')));
    }
    ws.append(t);
  }
  side.append($('div', { class: 'panel' }, $('h3', {}, tr('Workspace', 'مساحة العمل'), $('button', { title: tr('Clear variables', 'مسح المتغيرات'), onclick: resetWorkspace }, tr('Clear', 'مسح'))), ws));

  const fb = $('div', { class: 'body' });
  for (const [name, img] of files) {
    const cv = rawToCanvas(img);
    fb.append($('div', { class: 'file' }, cv, $('span', { class: 'n', title: `${img.width}×${img.height} · ${img.channels === 1 ? 'grayscale' : 'RGB'} · ${fmtBytes(img.fileSize)}` }, name + ' · ' + fmtBytes(img.fileSize)),
      $('button', { title: tr('Download file', 'تنزيل الملف'), onclick: () => downloadImage(name, img) }, '↓'),
      $('button', { title: tr('Remove file', 'إزالة الملف'), onclick: () => { files.delete(name); worker.postMessage({ t: 'delFile', name }); renderSide(); } }, '✕')));
  }
  if (!files.size) fb.append($('div', { class: 'empty' }, tr('No files yet. Upload an image to get started.', 'لا توجد ملفات بعد. ارفع صورة للبدء.')));
  const inp = $('input', { type: 'file', accept: 'image/*', multiple: true, style: 'display:none' }); inp.onchange = async () => {
    for (const f of Array.from(inp.files ?? [])) {
      try { await addUpload(f); }
      catch (error) { notify(tr(`Could not load ${f.name}: ${error instanceof Error ? error.message : String(error)}`, `تعذر تحميل ${f.name}: ${error instanceof Error ? error.message : String(error)}`)); }
    }
    inp.value = '';
  };
  side.append($('div', { class: 'panel' }, $('h3', {}, tr('Current Folder', 'المجلد الحالي'), $('button', { title: tr('Upload image files', 'رفع ملفات الصور'), onclick: () => inp.click() }, tr('Upload', 'رفع')), inp), fb));

  const hb = $('div', { class: 'body hist' });
  if (!cmdHist.length) hb.append($('div', { class: 'empty' }, tr('Executed commands appear here. Select one to add it as a cell.', 'ستظهر الأوامر المنفذة هنا. اختر أمراً لإضافته كخلية.')));
  for (const h of cmdHist.slice().reverse().slice(0, 60)) hb.append($('div', { title: h, onclick: () => { cells.push(mkCell('code', h)); sel = cells.length - 1; save(); render(); } }, h));
  side.append($('div', { class: 'panel' }, $('h3', {}, tr('Command History', 'سجل الأوامر'), $('button', { title: tr('Clear command history', 'مسح سجل الأوامر'), onclick: () => { cmdHist = []; store.set(histKey(), '[]'); renderSide(); } }, tr('Clear', 'مسح'))), hb));
}

// ---------------- import / export ----------------
const fileBase = () => (opts.notebook.title || 'notebook').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'notebook';
const linesOf = (t: string) => t.split('\n').map((l, i, a) => (i < a.length - 1 ? l + '\n' : l));
const hasOutputs = () => cells.some(c => c.type === 'code' && c.outs.length > 0);
const figPng = (o: Extract<Out, { k: 'img' }>) => rgbToCanvas(o.w, o.h, o.rgb).toDataURL('image/png');
function exportIpynb(withOutputs: boolean) {
  const nbk = { nbformat: 4, nbformat_minor: 5, metadata: { kernelspec: { name: 'mlweb', display_name: 'MLWeb (MATLAB subset)', language: 'matlab' }, language_info: { name: 'matlab', file_extension: '.m' } },
    cells: cells.map(c => {
      const lines = linesOf(c.src);
      if (c.type === 'md') return { cell_type: 'markdown', metadata: {}, source: lines };
      const outputs: any[] = []; let txt = '';
      if (withOutputs) for (const o of c.outs) {
        if (o.k === 'img') outputs.push({ output_type: 'display_data', metadata: {}, data: { 'image/png': figPng(o).split(',')[1], 'text/plain': ['<image>'] } });
        else if (o.k === 'text') txt += o.s;
        else outputs.push({ output_type: 'stream', name: 'stderr', text: linesOf(o.s) });
      }
      if (txt) outputs.unshift({ output_type: 'stream', name: 'stdout', text: linesOf(txt) });
      return { cell_type: 'code', metadata: {}, execution_count: withOutputs ? c.count : null, source: lines, outputs };
    }) };
  download(fileBase() + '.ipynb', new Blob([JSON.stringify(nbk, null, 1)], { type: 'application/json' }));
}
function exportM(withOutputs: boolean) {
  const outputComment = (c: Cell) => {
    const text = c.outs.filter(o => o.k !== 'img').map(o => (o as { s: string }).s).join('').replace(/\s+$/, '');
    const figs = c.outs.filter(o => o.k === 'img').length;
    const out = text ? text.split('\n').map(l => '%   ' + l) : [];
    if (figs) out.push(`%   [${figs} figure${figs === 1 ? '' : 's'} not included]`);
    return out.length ? '\n% Output:\n' + out.join('\n') : '';
  };
  const s = cells.map(c => c.type === 'md' ? c.src.split('\n').map(l => '% ' + l).join('\n') : c.src + (withOutputs ? outputComment(c) : '')).join('\n\n%%\n');
  download(fileBase() + '.m', new Blob([('% Exported from MLWeb - Belal Amr Mohamed\n\n' + s).replace(/\n/g, '\r\n')], { type: 'text/plain' }));
}
function exportHtml(withOutputs: boolean) {
  let n = 0;
  const body = cells.map(c => {
    if (c.type === 'md') return `<section class="md">${md(c.src)}</section>`;
    n += 1;
    const outs = withOutputs ? c.outs.map(o => (o.k === 'img' ? `<img alt="figure ${o.fig}" src="${figPng(o)}">` : `<pre class="o${o.k === 'text' ? '' : ' ' + o.k}">${esc(o.s.replace(/\n+$/, ''))}</pre>`)).join('') : '';
    return `<section class="code"><span class="prompt">In [${withOutputs && c.count ? c.count : n}]:</span><div><pre class="src" dir="ltr">${esc(c.src)}</pre>${outs}</div></section>`;
  }).join('\n');
  const html = `<!doctype html>\n<html lang="${LANG}" dir="${LANG === 'ar' ? 'rtl' : 'ltr'}">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${esc(opts.notebook.title || 'Notebook')}</title>\n<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">\n<style>\n body{font:16px/1.65 system-ui,-apple-system,"Segoe UI",Tahoma,sans-serif;color:#1d2433;max-width:900px;margin:0 auto;padding:28px 18px 60px}\n .md img{max-width:100%} .md code{background:#f0f2f7;border-radius:4px;padding:1px 5px} .md pre{background:#f0f2f7;border-radius:4px;padding:10px 12px;overflow:auto;direction:ltr;text-align:left}\n .code{display:grid;grid-template-columns:74px minmax(0,1fr);gap:8px;margin:10px 0;direction:ltr}\n .prompt{color:#307fc1;font:12.5px/1.8 ui-monospace,Menlo,Consolas,monospace;text-align:right;padding-top:8px}\n pre.src{margin:0;padding:10px 12px;background:#f6f7fb;border:1px solid #dce2ed;border-radius:4px;font:13.5px/1.6 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere}\n pre.o{margin:6px 0 0;padding:6px 4px;font:13px/1.55 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap} pre.o.err{background:#fff1f0;color:#b42318;padding:8px 12px} pre.o.warn{background:#fffaeb;color:#93370d;padding:8px 12px}\n .code img{display:block;max-width:100%;margin-top:8px;border:1px solid #dce2ed}\n @media print{body{padding:0} pre.src{break-inside:avoid}}\n</style>\n</head>\n<body>\n<h1>${esc(opts.notebook.title || '')}</h1>\n${body}\n</body>\n</html>\n`;
  download(fileBase() + '.html', new Blob([html], { type: 'text/html;charset=utf-8' }));
}
type ExportFormat = 'ipynb' | 'm' | 'html';
function openExport() {
  const dialog = $id('exportDialog') as HTMLDialogElement | null; if (!dialog) return;
  const withOut = dialog.querySelector<HTMLInputElement>('#exportOutputs')!;
  const available = hasOutputs();
  withOut.checked = available; withOut.disabled = !available;
  $id('exportOutputsNote')!.textContent = available ? tr('Text results and figures currently shown under the cells.', 'النتائج النصية والأشكال الظاهرة حالياً أسفل الخلايا.') : tr('No outputs yet: run the cells first. Outputs are not saved with the notebook, only what is on screen can be exported.', 'لا توجد مخرجات بعد: شغّل الخلايا أولاً. المخرجات لا تُحفظ مع الدفتر، ويمكن تصدير ما هو ظاهر على الشاشة فقط.');
  if (!dialog.open) dialog.showModal();
}
function runExport() {
  const dialog = $id('exportDialog') as HTMLDialogElement; if (!dialog) return;
  const format = (dialog.querySelector<HTMLInputElement>('input[name="exportFormat"]:checked')?.value || 'ipynb') as ExportFormat;
  const withOutputs = dialog.querySelector<HTMLInputElement>('#exportOutputs')!.checked && hasOutputs();
  dialog.close();
  try { (format === 'm' ? exportM : format === 'html' ? exportHtml : exportIpynb)(withOutputs); }
  catch (error) { notify(tr('Export failed: ', 'فشل التصدير: ') + (error instanceof Error ? error.message : String(error))); }
}
async function importFile(f: File) {
  const text = await f.text();
  if (/\.ipynb$/i.test(f.name)) {
    const j = JSON.parse(text);
    if (!j || !Array.isArray(j.cells)) throw new Error(tr('This .ipynb file has no valid cells array.', 'ملف ‎.ipynb لا يحتوي على مصفوفة خلايا صالحة.'));
    const arr = j.cells.map((c: any) => {
      if (!c || !['markdown', 'code', 'raw'].includes(c.cell_type)) throw new Error(tr('This notebook contains an unsupported cell type.', 'يحتوي هذا الدفتر على نوع خلية غير مدعوم.'));
      return mkCell(c.cell_type === 'markdown' ? 'md' : 'code', Array.isArray(c.source) ? c.source.join('') : String(c.source ?? ''));
    });
    if (arr.length) cells = arr;
  } else {
    const parts = text.replace(/\r\n?/g, '\n').split(/^%%.*$/m).map(s => s.replace(/^\n+|\n+$/g, '')).filter(s => s.trim());
    cells = (parts.length ? parts : ['']).map(p => mkCell('code', p));
  }
  sel = 0; save(); render(); renderSide();
  notify(tr(`Imported ${f.name}.`, `تم استيراد ${f.name}.`));
}

// ---------------- mount ----------------
let teardown: (() => void) | null = null;

function buildShell(title: string) {
  const r = mountRoot;
  r.replaceChildren();
  r.classList.add('mlweb');
  r.setAttribute('dir', LANG === 'ar' ? 'rtl' : 'ltr');
  r.setAttribute('lang', LANG);
  const dlg = (id: string, labelledby: string, ...kids: (Node | string)[]) => $('dialog', { id, 'aria-labelledby': labelledby }, ...kids);
  const header = $('header', { id: 'bar' }, $('div', { class: 'brand' }, $('b', { id: 'nbTitle' }, isEdit() ? '' : '')), $('div', { class: 'actions', id: 'actions' }));
  const note = $('div', { class: 'local-note', id: 'localNote', hidden: isEdit() },
    $('span', { id: 'saveState', role: 'status' }, ''));
  const layout = $('div', { id: 'layout' }, $('main', { id: 'nb' }), $('aside', { id: 'side' }));
  const helpDlg = dlg('helpDialog', 'helpTitle',
    $('div', { class: 'help-head' }, $('h2', { id: 'helpTitle' }, ''), $('button', { id: 'closeHelp', type: 'button' }, '')),
    $('div', { class: 'help-body' }, $('p', { id: 'helpIntro' }, ''), $('input', { id: 'helpSearch', type: 'search', autocomplete: 'off' }), $('div', { id: 'helpItems' })));
  const confirmDlg = dlg('confirmDialog', 'confirmTitle',
    $('div', { class: 'dialog-head' }, $('h2', { id: 'confirmTitle' }, ''), $('button', { type: 'button', 'data-confirm-cancel': true, 'aria-label': tr('Close dialog', 'إغلاق النافذة') }, '×')),
    $('div', { class: 'dialog-body' }, $('p', { id: 'confirmMessage' }),
      $('div', { class: 'dialog-actions' }, $('button', { type: 'button', 'data-confirm-cancel': true }, tr('Cancel', 'إلغاء')), $('button', { type: 'button', class: 'primary', 'data-confirm-accept': true }, ''))));
  const radio = (value: string, label: string, checked = false) => $('label', { class: 'export-opt' }, $('input', { type: 'radio', name: 'exportFormat', value, checked }), $('span', {}, label));
  const exportDlg = dlg('exportDialog', 'exportTitle',
    $('div', { class: 'dialog-head' }, $('h2', { id: 'exportTitle' }, tr('Export notebook', 'تصدير الدفتر')), $('button', { type: 'button', 'data-export-cancel': true, 'aria-label': tr('Close dialog', 'إغلاق النافذة') }, '×')),
    $('div', { class: 'dialog-body' },
      $('fieldset', { class: 'export-formats' }, $('legend', {}, tr('Format', 'الصيغة')), radio('ipynb', tr('Jupyter Notebook (.ipynb)', 'Jupyter Notebook ‎(.ipynb)'), true), radio('m', tr('MATLAB script (.m)', 'سكريبت MATLAB ‎(.m)')), radio('html', tr('Web page (.html)', 'صفحة ويب ‎(.html)'))),
      $('label', { class: 'export-opt export-outputs' }, $('input', { type: 'checkbox', id: 'exportOutputs' }), $('span', {}, tr('Include cell outputs', 'تضمين مخرجات الخلايا'))),
      $('p', { id: 'exportOutputsNote', class: 'export-note' }),
      $('div', { class: 'dialog-actions' }, $('button', { type: 'button', 'data-export-cancel': true }, tr('Cancel', 'إلغاء')), $('button', { type: 'button', class: 'primary', 'data-export-accept': true }, tr('Export', 'تصدير')))));
  const toolBtn = (id: string, label: string, text: string) => $('button', { type: 'button', id, title: label, 'aria-label': label }, text);
  const imageDlg = dlg('imageTool', 'imageToolTitle',
    $('div', { class: 'dialog-head image-tool-head' }, $('div', {}, $('h2', { id: 'imageToolTitle' }, tr('Image Tool', 'أداة الصورة')), $('span', { id: 'imageToolMeta' })), $('button', { type: 'button', id: 'closeImageTool', 'aria-label': tr('Close Image Tool', 'إغلاق أداة الصورة') }, '×')),
    $('div', { class: 'image-tool-controls' }, toolBtn('imageZoomOut', tr('Zoom out', 'تصغير'), '−'), toolBtn('imageZoomIn', tr('Zoom in', 'تكبير'), '+'),
      $('button', { type: 'button', id: 'imageFit' }, tr('Fit', 'ملاءمة')), $('button', { type: 'button', id: 'imageActual' }, '100%'),
      $('button', { type: 'button', id: 'imageDownload' }, tr('Download PNG', 'تنزيل PNG')), $('span', { class: 'image-tool-hint' }, tr('Move over the image to inspect pixel values', 'حرّك المؤشر فوق الصورة لفحص قيم البكسل'))),
    $('div', { id: 'imageToolStage', tabindex: 0, 'aria-label': tr('Interactive image view', 'عرض تفاعلي للصورة') }),
    $('div', { id: 'imagePixelInfo', role: 'status', 'aria-live': 'polite' }, ''));
  const notice = $('div', { id: 'notice', role: 'status', 'aria-live': 'polite', hidden: true }, $('span', { id: 'noticeMessage' }), $('button', { type: 'button', id: 'dismissNotice', 'aria-label': tr('Dismiss notification', 'إغلاق الإشعار') }, '×'));
  r.append(header, note, layout, helpDlg, confirmDlg, exportDlg, imageDlg, notice);
}

function mount(o: MountOptions): { destroy(): void; resetToPublished(): void; getCells(): NotebookCellDoc[]; setCells(list: NotebookCellDoc[]): void } {
  if (teardown) teardown();
  if (!o || !(o.root instanceof HTMLElement)) throw new Error('MLWebNotebook.mount: opts.root must be an HTMLElement');
  if (!o.notebook || !Array.isArray(o.notebook.cells)) throw new Error('MLWebNotebook.mount: opts.notebook.cells must be an array');
  opts = o; LANG = o.lang === 'ar' ? 'ar' : 'en'; mountRoot = o.root;
  baseUrl = new URL(o.baseUrl || './', location.href).href.replace(/\/?$/, '/');
  const token = ++mountToken;
  nextId = 1; cells = []; sel = 0; files.clear(); vars = []; execCount = 0; curRun = null; focusId = null;
  editorViews.clear(); editorStates.clear(); editorScroll.clear(); assetManifest.clear(); assetLoading.clear();

  buildShell(o.notebook.title || '');
  publishedHash = snapOf(publishedCells());
  try { const h = JSON.parse(store.get(histKey()) ?? '[]'); cmdHist = Array.isArray(h) ? h.filter(x => typeof x === 'string') : []; } catch { cmdHist = []; }
  cells = isEdit() ? publishedCells() : (load() ?? publishedCells());
  if (!isEdit()) save();

  const act = $id('actions')!;
  const imp = $('input', { type: 'file', accept: '.m,.ipynb', style: 'display:none' });
  imp.onchange = () => { if (imp.files?.[0]) importFile(imp.files[0]).catch(error => notify(tr('Import failed: ', 'فشل الاستيراد: ') + (error instanceof Error ? error.message : String(error)))); imp.value = ''; };
  const renderToolbar = () => {
    const menuButton = (label: string, action: () => void) => $('button', { role: 'menuitem', onclick: (event: MouseEvent) => { action(); (event.currentTarget as HTMLElement).closest('details')?.removeAttribute('open'); } }, label);
    const menu = $('details', { class: 'toolbar-menu' },
      $('summary', { title: tr('Notebook menu', 'قائمة الدفتر'), 'aria-label': tr('Notebook menu', 'قائمة الدفتر') }, tr('More', 'المزيد')),
      $('div', { class: 'toolbar-menu-items', role: 'menu' },
        ...(isEdit() ? [] : [menuButton(tr('Reset to published version', 'العودة إلى النسخة المنشورة'), async () => {
          if (curRun) { notify(tr('Stop execution before resetting the notebook.', 'أوقف التنفيذ قبل إعادة ضبط الدفتر.')); return; }
          if (!await confirmInApp(tr('Reset to the published version?', 'العودة إلى النسخة المنشورة؟'), tr('Your local edits in this browser will be discarded. Export them first if you want to keep a copy.', 'ستُحذف تعديلاتك المحلية في هذا المتصفح. صدّرها أولاً إن أردت الاحتفاظ بنسخة.'), tr('Reset', 'إعادة ضبط'))) return;
          resetToPublished();
        })]),
        menuButton(tr('Import…', 'استيراد…'), () => imp.click()),
        menuButton(tr('Export…', 'تصدير…'), openExport),
        menuButton(tr('Help and shortcuts', 'المساعدة والاختصارات'), openHelp)));
    const addBelow = (type: 'code' | 'md') => () => {
      const added = mkCell(type, type === 'md' ? '' : ''); added.mdEdit = type === 'md';
      const at = Math.min(sel + 1, cells.length); cells.splice(at, 0, added); sel = at; save(); render();
      if (added.type === 'code') focusCell(added.id);
    };
    act.replaceChildren(
      $('button', { id: 'addcode', title: tr('Insert a code cell below the selected cell', 'إدراج خلية كود أسفل الخلية المحددة'), onclick: addBelow('code') }, tr('+ Code', '+ كود')),
      $('button', { id: 'addtext', title: tr('Insert a text (Markdown) cell below the selected cell', 'إدراج خلية نص أسفل الخلية المحددة'), onclick: addBelow('md') }, tr('+ Text', '+ نص')),
      $('button', { class: 'primary', id: 'runall', title: tr('Run all code cells', 'تشغيل كل خلايا الكود'), onclick: () => runAll() }, tr('▶ Run all', '▶ تشغيل الكل')),
      $('button', { id: 'stop', title: tr('Stop execution and reset the workspace', 'إيقاف التنفيذ وإعادة ضبط مساحة العمل'), hidden: !curRun, onclick: stopRun }, tr('■ Stop', '■ إيقاف')),
      $('span', { id: 'status', role: 'status', 'aria-label': curRun ? tr('Running', 'قيد التشغيل') : tr('Ready', 'جاهز'), 'aria-live': 'polite', title: curRun ? tr('Running', 'قيد التشغيل') : tr('Ready', 'جاهز') }, ''),
      $('button', { id: 'toggleside', title: tr('Show variables, files and history', 'إظهار المتغيرات والملفات والسجل'), 'aria-pressed': String($id('layout')?.classList.contains('side-open') ?? false), onclick: (e: MouseEvent) => { const l = $id('layout')!; const on = l.classList.toggle('side-open'); (e.currentTarget as HTMLElement).setAttribute('aria-pressed', String(on)); } }, tr('Workspace', 'مساحة العمل')),
      ...(opts.onInfo ? [$('button', { type: 'button', title: tr('Notebook information', 'معلومات الدفتر'), 'aria-label': tr('Notebook information', 'معلومات الدفتر'), onclick: () => opts.onInfo?.() }, tr('ⓘ Info', 'ⓘ معلومات'))] : []),
      menu, imp);
  };
  refreshToolbar = renderToolbar;
  refreshToolbar();
  updateSaveState();

  const listeners: [EventTarget, string, EventListener, any?][] = [];
  const on = (t: EventTarget | null, ev: string, fn: (e: any) => void, optsArg?: any) => { if (!t) return; t.addEventListener(ev, fn, optsArg); listeners.push([t, ev, fn, optsArg]); };
  on($id('nb'), 'keydown', onCommandKey);
  on($id('helpSearch'), 'input', renderHelp);
  on($id('closeHelp'), 'click', () => ($id('helpDialog') as HTMLDialogElement).close());
  on($id('helpDialog'), 'click', event => { if (event.target === event.currentTarget) (event.currentTarget as HTMLDialogElement).close(); });
  mountRoot.querySelectorAll('[data-export-cancel]').forEach(button => on(button, 'click', () => ($id('exportDialog') as HTMLDialogElement).close()));
  on(mountRoot.querySelector('[data-export-accept]'), 'click', runExport);
  on($id('exportDialog'), 'click', event => { if (event.target === event.currentTarget) (event.currentTarget as HTMLDialogElement).close(); });
  mountRoot.querySelectorAll('[data-confirm-cancel]').forEach(button => on(button, 'click', () => settleConfirm(false)));
  on(mountRoot.querySelector('[data-confirm-accept]'), 'click', () => settleConfirm(true));
  on($id('confirmDialog'), 'cancel', event => { event.preventDefault(); settleConfirm(false); });
  on($id('confirmDialog'), 'click', event => { if (event.target === event.currentTarget) settleConfirm(false); });
  on($id('dismissNotice'), 'click', () => { window.clearTimeout(noticeTimer); $id('notice')!.hidden = true; });
  const imageDialog = $id('imageTool') as HTMLDialogElement;
  on($id('closeImageTool'), 'click', () => imageDialog.close());
  on($id('imageZoomIn'), 'click', () => setImageToolZoom(imageToolState.zoom * 1.25));
  on($id('imageZoomOut'), 'click', () => setImageToolZoom(imageToolState.zoom / 1.25));
  on($id('imageFit'), 'click', fitImageTool);
  on($id('imageActual'), 'click', () => setImageToolZoom(1));
  on($id('imageDownload'), 'click', async () => { if (imageToolState.canvas) download('imtool.png', await toBlob(imageToolState.canvas, 'image/png')); });
  on($id('imageToolStage'), 'wheel', event => {
    if (!imageToolState.image) return;
    event.preventDefault();
    setImageToolZoom(imageToolState.zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1));
  }, { passive: false });
  on(imageDialog, 'click', event => { if (event.target === imageDialog) imageDialog.close(); });
  on(window, 'keydown', event => {
    if (!mountRoot.contains(event.target as Node)) return;
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'p') { event.preventDefault(); openHelp(); }
    else if (event.key === '?' && !['INPUT', 'TEXTAREA'].includes((event.target as HTMLElement)?.tagName ?? '') && !(event.target as HTMLElement)?.closest?.('.cm-editor')) { event.preventDefault(); openHelp(); }
  });

  startWorker(); render(); renderSide();

  // Asset manifest + preload: files named in any cell (plus the two default sample images).
  manifestReady = fetch(baseUrl + 'assets/manifest.json').then(r => (r.ok ? r.json() : [])).then((names: unknown) => {
    if (token !== mountToken || !Array.isArray(names)) return;
    for (const n of names) if (typeof n === 'string') assetManifest.set(n.toLowerCase(), n);
  }).catch(() => { /* no assets available; runs that need them report a normal MATLAB file error */ });
  void manifestReady.then(async () => {
    if (token !== mountToken) return;
    const wanted = new Set<string>(['test.png', 'testgray.png']);
    for (const c of publishedCells().concat(cells)) referencedAssets(c.src).forEach(n => wanted.add(n));
    await Promise.all([...wanted].filter(n => assetManifest.has(n.toLowerCase())).map(loadAsset));
  });

  const destroy = () => {
    if (teardown !== destroy) return;
    teardown = null; mountToken++;
    if (curRun) { clearTimeout(curRun.timer); curRun = null; }
    for (const [, view] of editorViews) view.destroy();
    editorViews.clear();
    try { worker?.terminate(); } catch { /* ignore */ }
    for (const [t, ev, fn, o2] of listeners) t.removeEventListener(ev, fn, o2);
    window.clearTimeout(noticeTimer);
    for (const d of Array.from(mountRoot.querySelectorAll('dialog'))) { try { (d as HTMLDialogElement).close(); } catch { /* ignore */ } }
    mountRoot.replaceChildren(); mountRoot.classList.remove('mlweb'); mountRoot.removeAttribute('dir');
    refreshToolbar = () => {};
  };
  teardown = destroy;
  return {
    destroy,
    resetToPublished: () => resetToPublished(),
    getCells: () => cellDocs(),
    setCells: (list: NotebookCellDoc[]) => {
      if (curRun) stopRun();
      for (const id of [...editorStates.keys()]) { editorStates.delete(id); editorScroll.delete(id); }
      cells = (list || []).map(c => mkCell(c.type === 'code' ? 'code' : 'md', String(c.source ?? '')));
      if (!cells.length) cells.push(mkCell('code', ''));
      sel = 0; save(); render(); renderSide();
      void Promise.all(cells.map(c => ensureAssetsFor(c.src)));
    }
  };
}

(window as any).MLWebNotebook = { mount };
(window as any).__mlweb = { get cells() { return cells; }, runAll, runCell, files };
