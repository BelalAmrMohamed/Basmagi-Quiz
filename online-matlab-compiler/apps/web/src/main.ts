import { autocompletion, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { indentWithTab } from '@codemirror/commands';
import { HighlightStyle, StreamLanguage, syntaxHighlighting, syntaxTree } from '@codemirror/language';
import { octave } from '@codemirror/legacy-modes/mode/octave';
import { EditorState, Prec } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { basicSetup, EditorView } from 'codemirror';

declare const __WORKER_SRC__: string;
declare const __ASSETS__: Record<string, { width: number; height: number; channels: 1 | 3; b64: string; bitDepth: number; format: string; fileSize: number; colorType: string; filename: string; fileModDate: string; colormap?: number[][] }>;
interface Lesson { id: string; title: string; group: string; files: string[]; cells: { type: 'code' | 'md'; src: string }[] }
declare const __LESSONS__: Lesson[];

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
const tr = (en: string, _ar: string) => en;
let refreshToolbar = () => {};
let themePreference = store.get('mlweb.theme') ?? 'system';
let noticeTimer = 0;
let confirmResolve: ((accepted: boolean) => void) | null = null;
const imageToolState: { canvas: HTMLCanvasElement | null; image: Extract<Out, { k: 'img' }> | null; zoom: number } = { canvas: null, image: null, zoom: 1 };
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
const matlabCompletionOptions: Completion[] = [
  ...Array.from(matlabBuiltins, label => ({ label, type: 'function', detail: 'Supported function' })),
  ...Array.from(matlabKeywords, label => ({ label, type: 'keyword', detail: 'MATLAB keyword' })),
  ...Array.from(matlabTypes, label => ({ label, type: 'type', detail: 'Numeric or data type' })),
  ...Array.from(matlabConstants, label => ({ label, type: 'constant', detail: 'MATLAB constant' }))
];
const matlabCompletionNames = new Set(matlabCompletionOptions.map(option => option.label));
function matlabCompletionSource(context: CompletionContext): CompletionResult | null {
  const word = context.matchBefore(/[A-Za-z]\w*/);
  if (!word && !context.explicit) return null;
  const from = word?.from ?? context.pos;
  if (from > 0 && context.state.sliceDoc(from - 1, from) === '.') return null;
  const token = syntaxTree(context.state).resolveInner(word?.from ?? context.pos, -1).type.name.toLowerCase();
  if (token.includes('string') || token.includes('comment')) return null;
  const variables: Completion[] = vars
    .filter(variable => !matlabCompletionNames.has(variable.name))
    .map(variable => ({ label: variable.name, type: 'variable', detail: `${variable.cls} - ${variable.size}` }));
  return {
    from,
    options: [...matlabCompletionOptions, ...variables],
    validFor: /^[A-Za-z]\w*$/
  };
}
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
  const el = document.getElementById('notice');
  const text = document.getElementById('noticeMessage');
  if (!el || !text) return;
  text.textContent = message;
  el.hidden = false;
  window.clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(() => { el.hidden = true; }, 5000);
}
function confirmInApp(title: string, message: string, acceptLabel = 'Continue'): Promise<boolean> {
  const dialog = document.getElementById('confirmDialog') as HTMLDialogElement;
  document.getElementById('confirmTitle')!.textContent = title;
  document.getElementById('confirmMessage')!.textContent = message;
  dialog.querySelector<HTMLButtonElement>('[data-confirm-accept]')!.textContent = acceptLabel;
  return new Promise(resolve => {
    confirmResolve = resolve;
    dialog.showModal();
  });
}
function settleConfirm(accepted: boolean) {
  const dialog = document.getElementById('confirmDialog') as HTMLDialogElement | null;
  if (dialog?.open) dialog.close();
  const resolve = confirmResolve;
  confirmResolve = null;
  resolve?.(accepted);
}
function applyTheme() {
  if (themePreference === 'dark' || themePreference === 'light') document.documentElement.dataset.theme = themePreference;
  else delete document.documentElement.dataset.theme;
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
let curRun: { id: number; resolve: () => void; timer: number; fig: number } | null = null;

const mkCell = (type: 'code' | 'md', src: string): Cell => ({ id: nextId++, type, src, outs: [], count: null, running: false, mdEdit: false });

// ---------------- worker ----------------
function startWorker() {
  if (worker) worker.terminate();
  const url = URL.createObjectURL(new Blob([__WORKER_SRC__], { type: 'text/javascript' }));
  worker = new Worker(url); workerReady = false;
  worker.onmessage = onWorkerMsg;
  worker.onerror = ev => { appendOut('err', 'Worker error: ' + ev.message); finishRun(); };
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
    cmdHist = cmdHist.slice(-300); store.set('mlweb.hist', JSON.stringify(cmdHist));
    const timer = window.setTimeout(() => {
      appendOut('err', 'Execution stopped: time limit (60 s) exceeded. The workspace was reset.\n'); startWorker(); vars = []; finishRun(); renderSide();
    }, 60000);
    curRun = { id: c.id, resolve, timer, fig: 0 };
    setStatus(tr('Running…', 'قيد التشغيل…')); render();
    worker.postMessage({ t: 'run', id: c.id, src: c.src });
  });
}
function stopRun() {
  if (!curRun) return; appendOut('err', 'Execution interrupted by user. The workspace was reset.\n'); startWorker(); vars = []; finishRun(); renderSide();
}
async function runAll() { for (const c of cells) { if (c.type === 'code') await runCell(c); if (c.outs.some(o => o.k === 'err')) break; } }
function resetWorkspace() { if (curRun) return; worker.postMessage({ t: 'reset' }); vars = []; renderSide(); }

// ---------------- lessons ----------------
let curLesson: string | null = null;
function loadAsset(name: string) {
  if (files.has(name)) return; const s = __ASSETS__[name]; if (!s) return;
  const bin = atob(s.b64), d = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) d[i] = bin.charCodeAt(i);
  const { b64, ...rest } = s; void b64; files.set(name, { ...rest, data: d });
}
async function openLesson(id: string, ask = true) {
  const L = __LESSONS__.find(l => l.id === id); if (!L || curRun) return;
  if (ask && !await confirmInApp('Open lesson?', `Open "${L.title}"? The current notebook will be replaced. Export it first if you want to keep a copy.`, 'Open lesson')) return;
  L.files.forEach(loadAsset); cells = L.cells.map(c => mkCell(c.type, c.src)); sel = 0; curLesson = id;
  store.set('mlweb.lesson', id); save(); startWorker(); vars = []; render(); renderSide(); window.scrollTo(0, 0);
  history_.replaceState(null, '', '#' + id); const s = document.getElementById('lessons') as HTMLSelectElement | null; if (s) s.value = id;
  document.title = L.title + ' – MLWeb | Belal Amr Mohamed';
}
const history_ = window.history;
function lessonNav(): HTMLElement | null {
  const i = __LESSONS__.findIndex(l => l.id === curLesson); if (i < 0) return null;
  const go = (d: number) => $('button', { disabled: !__LESSONS__[i + d], onclick: () => openLesson(__LESSONS__[i + d].id) }, d < 0 ? tr('← Previous lesson', '← الدرس السابق') : tr('Next lesson →', 'الدرس التالي →'));
  return $('div', { class: 'lessonnav' }, go(-1), $('span', {}, tr(`Lesson ${i + 1} of ${__LESSONS__.length}: ${__LESSONS__[i].title}`, `الدرس ${i + 1} من ${__LESSONS__.length}: ${__LESSONS__[i].title}`)), go(1));
}

// ---------------- persistence ----------------
const save = () => {
  const saved = store.set('mlweb.nb', JSON.stringify(cells.map(c => ({ type: c.type, src: c.src }))));
  const state = document.getElementById('saveState');
  if (state) state.textContent = saved ? tr('Saved locally', 'تم الحفظ محلياً') : tr('Save failed', 'تعذر الحفظ');
  if (!saved) notify(tr('Notebook could not be saved in this browser. Export a copy to avoid losing changes.', 'تعذر حفظ دفتر العمل في هذا المتصفح. صدّر نسخة لتجنب فقدان التغييرات.'));
};
function load(): Cell[] | null {
  const s = store.get('mlweb.nb'); if (!s) return null;
  try { const a = JSON.parse(s); if (Array.isArray(a) && a.length) return a.map((x: any) => mkCell(x.type === 'md' ? 'md' : 'code', String(x.src ?? ''))); } catch { /* ignore */ }
  return null;
}
function defaultNotebook(): Cell[] {
  return [
    mkCell('code', "a = imread('test.png');\nsize(a)"),
    mkCell('code', "imshow(a), figure, imshow(rgb2gray(a));"),
    mkCell('code', "imfinfo('test.png')"),
    mkCell('code', "x = uint8([200 200 200]);\n(x(1)+x(2)+x(3))/3      % saturates at 255 first\nx(1)/3+x(2)/3+x(3)/3"),
  ];
}

const helpReference = [
  ['Notebook', 'Autocomplete suggests commands while typing; Ctrl+Space opens suggestions and Enter accepts one. Shift+Enter runs and advances; Ctrl+Enter runs in place; Ctrl+Shift+P or ? opens help.', 'يقترح الإكمال التلقائي الأوامر أثناء الكتابة؛ يفتح Ctrl+Space الاقتراحات ويقبل Enter أحدها. يشغّل Shift+Enter الخلية وينتقل للتالية؛ يشغّل Ctrl+Enter في مكانه؛ ويفتح Ctrl+Shift+P أو ? المساعدة.'],
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
  const dialog = document.getElementById('helpDialog') as HTMLDialogElement | null;
  const items = document.getElementById('helpItems');
  const search = document.getElementById('helpSearch') as HTMLInputElement | null;
  if (!dialog || !items || !search) return;
  const query = search.value.trim().toLowerCase();
  items.replaceChildren();
  for (const [title, description, arabic] of helpReference) {
    if (query && !(title + ' ' + description + ' ' + arabic).toLowerCase().includes(query)) continue;
    items.append($('article', { class: 'help-item' }, $('b', {}, title), $('p', {}, description)));
  }
}
function openHelp() {
  const dialog = document.getElementById('helpDialog') as HTMLDialogElement | null;
  if (!dialog) return;
  document.getElementById('helpTitle')!.textContent = tr('MLWeb help', 'مساعدة MLWeb');
  document.getElementById('closeHelp')!.textContent = tr('Close', 'إغلاق');
  document.getElementById('helpIntro')!.textContent = tr('Search supported MATLAB-style commands and notebook shortcuts.', 'ابحث عن أوامر MATLAB المدعومة واختصارات دفتر العمل.');
  const search = document.getElementById('helpSearch') as HTMLInputElement;
  search.placeholder = tr('Search commands…', 'ابحث عن الأوامر…');
  search.value = '';
  renderHelp();
  if (!dialog.open) dialog.showModal();
  search.focus();
}
// ---------------- markdown (tiny) ----------------
const esc = (s: string) => s.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));
function md(src: string): string {
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
  return out.join('\n');
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
const nb = () => document.getElementById('nb')!;
function setStatus(s: string) {
  const el = document.getElementById('status');
  if (el) { el.textContent = s; el.title = s; el.setAttribute('aria-label', s); el.dataset.state = curRun ? 'running' : 'idle'; }
  const stop = document.getElementById('stop');
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
    px.textContent = `Pixel info: (row ${y + 1}, col ${x + 1})  [${d[i]} ${d[i + 1]} ${d[i + 2]}]`;
  };
  cv.onmouseleave = () => { px.textContent = ' '; };
  const cap = $('div', { class: 'cap' }, o.tool ? `Image Tool · ${o.w}×${o.h}` : `Figure ${o.fig} · ${o.w}×${o.h}`);
  if (o.tool) cap.append($('button', { title: 'Reopen interactive Image Tool', onclick: () => openImageTool(o) }, 'Open viewer'));
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
  document.getElementById('imageToolMeta')!.textContent = `${image.w} × ${image.h} px · ${Math.round(imageToolState.zoom * 100)}%`;
}
function fitImageTool() {
  const image = imageToolState.image;
  const stage = document.getElementById('imageToolStage');
  if (!image || !stage) return;
  const padding = 32;
  const zoom = Math.min(1, (stage.clientWidth - padding) / image.w, (stage.clientHeight - padding) / image.h);
  setImageToolZoom(Math.max(0.05, zoom));
  stage.scrollTo(0, 0);
}
function openImageTool(image: Extract<Out, { k: 'img' }>) {
  const dialog = document.getElementById('imageTool') as HTMLDialogElement;
  const stage = document.getElementById('imageToolStage')!;
  imageToolState.image = image;
  imageToolState.canvas = rgbToCanvas(image.w, image.h, image.rgb);
  const canvas = imageToolState.canvas;
  canvas.setAttribute('aria-label', `Image ${image.w} by ${image.h} pixels. Move pointer to inspect pixels.`);
  canvas.onmousemove = event => {
    const rect = canvas.getBoundingClientRect();
    const x = Math.min(image.w - 1, Math.max(0, Math.floor((event.clientX - rect.left) / rect.width * image.w)));
    const y = Math.min(image.h - 1, Math.max(0, Math.floor((event.clientY - rect.top) / rect.height * image.h)));
    const p = (y * image.w + x) * 3;
    document.getElementById('imagePixelInfo')!.textContent = `Pixel info · X: ${x + 1}, Y: ${y + 1} · RGB: [${image.rgb[p]}, ${image.rgb[p + 1]}, ${image.rgb[p + 2]}]`;
  };
  stage.replaceChildren(canvas);
  document.getElementById('imageToolTitle')!.textContent = 'Image Tool';
  document.getElementById('imagePixelInfo')!.textContent = 'Pixel info: move over the image';
  if (!dialog.open) dialog.showModal();
  requestAnimationFrame(fitImageTool);
}
function runFromEditor(cell: Cell, advance: boolean) {
  if (curRun) return true;
  void runCell(cell).then(() => {
    if (!advance) return;
    const index = cells.indexOf(cell);
    if (index < 0) return;
    if (index === cells.length - 1) cells.push(mkCell('code', ''));
    sel = index + 1;
    save();
    focusCell(cells[sel].id);
  });
  return true;
}
function cellEl(c: Cell, i: number): HTMLElement {
  const mv = (d: number) => () => { const j = i + d; if (j < 0 || j >= cells.length) return; [cells[i], cells[j]] = [cells[j], cells[i]]; sel = j; save(); render(); };
  const tools = $('div', { class: 'tools' }, $('span', { class: 'idx' }, c.type === 'md' ? 'md' : c.running ? '[*]' : `[${c.count ?? ' '}]`));
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
    $('summary', { title: 'Cell options', 'aria-label': 'Cell options' }, '⋯'),
    $('div', { class: 'cell-menu-items' },
      menuItem('Insert code cell above', insertAt('code', 0)),
      menuItem('Insert text cell above', insertAt('md', 0)),
      menuItem('Duplicate cell', duplicate),
      menuItem('Move cell up', mv(-1)),
      menuItem('Move cell down', mv(1)),
      ...(c.outs.length ? [menuItem('Clear cell output', () => { c.outs = []; c.count = null; render(); })] : []),
      menuItem(c.type === 'md' ? 'Convert to code' : 'Convert to text', () => { c.type = c.type === 'md' ? 'code' : 'md'; c.outs = []; c.mdEdit = c.type === 'md'; save(); render(); }),
      menuItem('Delete cell', remove)));
  tools.append($('span', { class: 'sp' }), options);
  const el = $('section', { class: 'cell' + (i === sel ? ' sel' : '') + (c.running ? ' running' : ''), 'aria-label': tr(`${c.type === 'md' ? 'Text' : 'Code'} cell ${i + 1}`, `خلية ${c.type === 'md' ? 'نص' : 'كود'} ${i + 1}`) }, tools);
  el.addEventListener('focusin', () => { if (sel !== i) { sel = i; document.querySelectorAll('.cell').forEach((n, k) => n.classList.toggle('sel', k === i)); } });
  if (c.type === 'md' && !c.mdEdit) { const v = $('div', { class: 'md' }); v.innerHTML = md(c.src); v.ondblclick = () => { c.mdEdit = true; render(); }; el.append(v); }
  else if (c.type === 'md') {
    const ta = $('textarea', { class: 'src', spellcheck: false, rows: 1, 'data-cell': c.id });
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
    const host = $('div', { class: 'code-editor', 'data-cell': c.id });
    el.append(host);
    const state = editorStates.get(c.id) ?? EditorState.create({
      doc: c.src,
      extensions: [
        basicSetup,
        autocompletion({ override: [matlabCompletionSource] }),
        matlabLanguage,
        syntaxHighlighting(matlabHighlight),
        editorTheme,
        EditorView.lineWrapping,
        EditorState.tabSize.of(4),
        Prec.highest(keymap.of([
          { key: 'Shift-Enter', run: () => runFromEditor(c, true) },
          { key: 'Mod-Enter', run: () => runFromEditor(c, false) },
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
  const insert = $('div', { class: 'cell-insert', role: 'group', 'aria-label': 'Insert a cell below' },
    $('button', { onclick: insertAt('code', 1) }, '+ Code'),
    $('button', { onclick: insertAt('md', 1) }, '+ Text'));
  el.append(outs, insert); return el;
}
let focusId: number | null = null;
function focusCell(id: number) { focusId = id; render(); }
function render() {
  const root = nb(), y = window.scrollY, active = document.activeElement as HTMLTextAreaElement | null;
  let keep: { id: string; s: number; e: number } | null = active && active.dataset?.cell ? { id: active.dataset.cell, s: active.selectionStart, e: active.selectionEnd } : null;
  let keepEditorId: number | null = null;
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
  const ln = lessonNav(); if (ln) root.append(ln);
  cells.forEach((c, i) => root.append(cellEl(c, i)));
  if (focusId !== null) {
    const view = editorViews.get(focusId);
    if (view) {
      const end = view.state.doc.length;
      view.dispatch({ selection: { anchor: end } });
      view.focus();
      view.scrollDOM.scrollTop = view.scrollDOM.scrollHeight;
    } else {
      const t = document.querySelector<HTMLTextAreaElement>(`textarea[data-cell="${focusId}"]`);
      if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); t.scrollIntoView({ block: 'nearest' }); }
    }
    focusId = null; keep = null; keepEditorId = null;
  }
  if (keep) { const t = document.querySelector<HTMLTextAreaElement>(`textarea[data-cell="${keep.id}"]`); if (t) { t.focus({ preventScroll: true }); t.setSelectionRange(keep.s, keep.e); } }
  else if (keepEditorId !== null) {
    const view = editorViews.get(keepEditorId), scroll = editorScroll.get(keepEditorId);
    if (view) { view.focus(); if (scroll) view.scrollDOM.scrollTo(scroll.left, scroll.top); }
  }
  window.scrollTo(0, y);
  const stop = document.getElementById('stop');
  stop?.toggleAttribute('disabled', !curRun);
  if (stop) stop.hidden = !curRun;
}
function fmtBytes(n: number) { return n < 1024 ? n + ' B' : (n / 1024).toFixed(1) + ' KB'; }
function renderSide() {
  const side = document.getElementById('side')!; side.replaceChildren();
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
  side.append($('div', { class: 'panel' }, $('h3', {}, tr('Command History', 'سجل الأوامر'), $('button', { title: tr('Clear command history', 'مسح سجل الأوامر'), onclick: () => { cmdHist = []; store.set('mlweb.hist', '[]'); renderSide(); } }, tr('Clear', 'مسح'))), hb));
}

// ---------------- import / export ----------------
function exportIpynb() {
  const nbk = { nbformat: 4, nbformat_minor: 5, metadata: { kernelspec: { name: 'mlweb', display_name: 'MLWeb (MATLAB subset)', language: 'matlab' }, language_info: { name: 'matlab', file_extension: '.m' } },
    cells: cells.map(c => {
      const lines = c.src.split('\n').map((l, i, a) => (i < a.length - 1 ? l + '\n' : l));
      if (c.type === 'md') return { cell_type: 'markdown', metadata: {}, source: lines };
      const outputs: any[] = []; let txt = '';
      for (const o of c.outs) {
        if (o.k === 'img') outputs.push({ output_type: 'display_data', metadata: {}, data: { 'image/png': rgbToCanvas(o.w, o.h, o.rgb).toDataURL('image/png').split(',')[1], 'text/plain': ['<image>'] } });
        else if (o.k === 'text') txt += o.s;
        else outputs.push({ output_type: 'stream', name: 'stderr', text: [o.s] });
      }
      if (txt) outputs.unshift({ output_type: 'stream', name: 'stdout', text: txt.split('\n').map((l, i, a) => (i < a.length - 1 ? l + '\n' : l)) });
      return { cell_type: 'code', metadata: {}, execution_count: c.count, source: lines, outputs };
    }) };
  download('notebook.ipynb', new Blob([JSON.stringify(nbk, null, 1)], { type: 'application/json' }));
}
function exportM() {
  const s = cells.map(c => c.type === 'md' ? c.src.split('\n').map(l => '% ' + l).join('\n') : c.src).join('\n\n%%\n');
  download('notebook.m', new Blob([('% Exported from MLWeb - Belal Amr Mohamed\n\n' + s).replace(/\n/g, '\r\n')], { type: 'text/plain' }));
}
async function importFile(f: File) {
  const text = await f.text();
  if (/\.ipynb$/i.test(f.name)) {
    const j = JSON.parse(text);
    if (!j || !Array.isArray(j.cells)) throw new Error('This .ipynb file has no valid cells array.');
    const arr = j.cells.map((c: any) => {
      if (!c || !['markdown', 'code', 'raw'].includes(c.cell_type)) throw new Error('This notebook contains an unsupported cell type.');
      return mkCell(c.cell_type === 'markdown' ? 'md' : 'code', Array.isArray(c.source) ? c.source.join('') : String(c.source ?? ''));
    });
    if (arr.length) cells = arr;
  } else {
    const parts = text.replace(/\r\n?/g, '\n').split(/^%%.*$/m).map(s => s.replace(/^\n+|\n+$/g, '')).filter(s => s.trim());
    cells = (parts.length ? parts : ['']).map(p => mkCell('code', p));
  }
  curLesson = null;
  store.set('mlweb.lesson', '');
  sel = 0; save(); render(); renderSide();
  notify(tr(`Imported ${f.name}.`, `تم استيراد ${f.name}.`));
}

// ---------------- boot ----------------
function boot() {
  applyTheme();
  ['test.png', 'testgray.png'].forEach(loadAsset);
  try { cmdHist = JSON.parse(store.get('mlweb.hist') ?? '[]'); } catch { cmdHist = []; }
  const hashId = decodeURIComponent(location.hash.slice(1)), saved = load();
  curLesson = store.get('mlweb.lesson') || null;
  if (curLesson) __LESSONS__.find(l => l.id === curLesson)?.files.forEach(loadAsset);
  cells = saved ?? defaultNotebook();
  if (cells[0]?.type === 'md' && cells[0].src.startsWith('# Welcome to MLWeb\n')) cells.shift();
  if (!cells.length) cells = [mkCell('code', '')];
  save();
  const act = document.getElementById('actions')!;
  const imp = $('input', { type: 'file', accept: '.m,.ipynb', style: 'display:none' }); imp.onchange = () => { if (imp.files?.[0]) importFile(imp.files[0]).catch(error => notify(`Import failed: ${error instanceof Error ? error.message : String(error)}`)); imp.value = ''; };
  const sl = $('select', { id: 'lessons', title: 'Ready-made lessons' }, $('option', { value: '' }, 'Lessons…'));
  for (const g of ['Sections', 'Lectures']) { const og = $('optgroup', { label: g }); for (const l of __LESSONS__.filter(x => x.group === g)) og.append($('option', { value: l.id }, l.title)); sl.append(og); }
  sl.value = curLesson ?? ''; sl.onchange = () => { if (sl.value) openLesson(sl.value); else sl.value = curLesson ?? ''; };
  const renderToolbar = () => {
    sl.setAttribute('aria-label', 'Choose a lesson');
    sl.title = 'Choose a lesson';
    sl.options[0].textContent = 'Lessons…';
    const isDark = document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
    const menuButton = (label: string, action: () => void) => $('button', { role: 'menuitem', onclick: (event: MouseEvent) => { action(); (event.currentTarget as HTMLElement).closest('details')?.removeAttribute('open'); } }, label);
    const menu = $('details', { class: 'toolbar-menu' },
      $('summary', { title: 'Notebook menu', 'aria-label': 'Notebook menu' }, 'More'),
      $('div', { class: 'toolbar-menu-items', role: 'menu' },
        menuButton('New notebook', async () => {
          if (curRun) { notify('Stop execution before creating a new notebook.'); return; }
          if (!await confirmInApp('Create a new notebook?', 'The current notebook will be replaced. Export it first if you want to keep a copy.', 'Create notebook')) return;
          cells = defaultNotebook(); sel = 0; curLesson = null; store.set('mlweb.lesson', ''); history_.replaceState(null, '', location.pathname); save(); render(); renderSide(); sl.value = '';
        }),
        menuButton('Import…', () => imp.click()),
        menuButton('Export as .ipynb', exportIpynb),
        menuButton('Export as .m', exportM),
        menuButton('Help and shortcuts', openHelp),
        menuButton(isDark ? 'Switch to light theme' : 'Switch to dark theme', () => { themePreference = isDark ? 'light' : 'dark'; store.set('mlweb.theme', themePreference); applyTheme(); refreshToolbar(); })));
    act.replaceChildren(sl,
      $('button', { class: 'primary', id: 'runall', title: 'Run all code cells', onclick: () => runAll() }, '▶ Run all'),
      $('button', { id: 'stop', title: 'Stop execution and reset the workspace', hidden: !curRun, onclick: stopRun }, '■ Stop'),
      $('span', { id: 'status', role: 'status', 'aria-label': curRun ? 'Running' : 'Ready', 'aria-live': 'polite', title: curRun ? 'Running' : 'Ready' }, ''),
      menu, imp);
  };
  refreshToolbar = renderToolbar;
  refreshToolbar();
  document.getElementById('helpSearch')?.addEventListener('input', renderHelp);
  document.getElementById('closeHelp')?.addEventListener('click', () => (document.getElementById('helpDialog') as HTMLDialogElement).close());
  document.getElementById('helpDialog')?.addEventListener('click', event => { if (event.target === event.currentTarget) (event.currentTarget as HTMLDialogElement).close(); });
  document.querySelectorAll('[data-confirm-cancel]').forEach(button => button.addEventListener('click', () => settleConfirm(false)));
  document.querySelector('[data-confirm-accept]')?.addEventListener('click', () => settleConfirm(true));
  document.getElementById('confirmDialog')?.addEventListener('cancel', event => { event.preventDefault(); settleConfirm(false); });
  document.getElementById('confirmDialog')?.addEventListener('click', event => { if (event.target === event.currentTarget) settleConfirm(false); });
  document.getElementById('dismissNotice')?.addEventListener('click', () => { window.clearTimeout(noticeTimer); document.getElementById('notice')!.hidden = true; });
  const imageDialog = document.getElementById('imageTool') as HTMLDialogElement;
  document.getElementById('closeImageTool')?.addEventListener('click', () => imageDialog.close());
  document.getElementById('imageZoomIn')?.addEventListener('click', () => setImageToolZoom(imageToolState.zoom * 1.25));
  document.getElementById('imageZoomOut')?.addEventListener('click', () => setImageToolZoom(imageToolState.zoom / 1.25));
  document.getElementById('imageFit')?.addEventListener('click', fitImageTool);
  document.getElementById('imageActual')?.addEventListener('click', () => setImageToolZoom(1));
  document.getElementById('imageDownload')?.addEventListener('click', async () => {
    if (imageToolState.canvas) download('imtool.png', await toBlob(imageToolState.canvas, 'image/png'));
  });
  document.getElementById('imageToolStage')?.addEventListener('wheel', event => {
    if (!imageToolState.image) return;
    event.preventDefault();
    setImageToolZoom(imageToolState.zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1));
  }, { passive: false });
  imageDialog.addEventListener('click', event => { if (event.target === imageDialog) imageDialog.close(); });
  window.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'p') { event.preventDefault(); openHelp(); }
    else if (event.key === '?' && !['INPUT', 'TEXTAREA'].includes((event.target as HTMLElement)?.tagName ?? '')) { event.preventDefault(); openHelp(); }
  });
  startWorker(); render(); renderSide();
  if (hashId && __LESSONS__.some(l => l.id === hashId) && hashId !== curLesson) openLesson(hashId, false);
  else if (curLesson) document.title = (__LESSONS__.find(l => l.id === curLesson)?.title ?? 'MLWeb') + ' – MLWeb | Belal Amr Mohamed';
  window.addEventListener('hashchange', () => { const h = decodeURIComponent(location.hash.slice(1)); if (h && h !== curLesson && __LESSONS__.some(l => l.id === h)) openLesson(h); });
}
boot();
(window as any).__mlweb = { get cells() { return cells; }, runAll, runCell, files };
