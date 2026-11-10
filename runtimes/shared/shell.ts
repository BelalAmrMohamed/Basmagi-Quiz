// =============================================================================
// runtimes/shared/shell.ts
// The notebook shell: state, render loop, run / stop / run-all, autosave, command mode,
// and the host handle {getCells, setCells, destroy}. Language engines plug in through the
// Engine contract (engine.ts); the shell is identical for every runtime.
//
// Host contract (unchanged): mount({root, baseUrl, notebook, lang, mode, onChange, onNotice,
// onInfo}) -> {getCells, setCells, destroy}, plus window.__mlweb.
// =============================================================================
import type { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { Engine, ImageFile, Out, RunSink, VarInfo, Cell, InputRequest } from './engine';
import type { Ctx, HostCell, MountOptions, UiCell } from './ctx';
import { actualOutput, cleanChallenge, gradeCell, normalizeOutput, type Challenge } from './challenge';
import { createT, type Lang } from './i18n';
import { h, store, closeDialog } from './dom';
import { createDialogs } from './dialogs';
import { createExportDialog } from './export-dialog';
import { createImageTool } from './image-tool';
import { renderCell } from './cell-view';
import { renderSide, hasSidePanels } from './side-panel';
import { renderToolbar, createImportInput } from './toolbar';
import { hasError } from './outputs';
import { fileToImage } from './images';

export interface ShellHandle {
  getCells(): HostCell[];
  setCells(cells: Array<{ type?: string; source?: string; stdin?: string; challenge?: Challenge }>): void;
  resetToPublished(): void;
  /** Read-only snapshot for assistants: each cell with its latest printed output and challenge status. */
  describe(): CellDescription[];
  /** Run the 1-based cell `n` and resolve with what it printed. Null when `n` is not a code cell. */
  runCellAt(n: number): Promise<CellDescription | null>;
  destroy(): void;
}

export type CellDescription = {
  n: number; type: 'code' | 'markdown'; source: string;
  /** Text the cell printed in its latest run, errors included (capped); empty if never run. */
  output: string; ran: boolean; failed: boolean;
  challenge?: { expectedOutput: string; matchMode: string; status: 'pass' | 'fail' | 'error' | 'not-run' };
};

const OUTPUT_CAP = 1500;
function describeCell(c: UiCell, i: number): CellDescription {
  const parts: string[] = [];
  for (const o of c.outs) {
    if (o.k === 'text' || o.k === 'warn') parts.push(o.s);
    else if (o.k === 'err') parts.push('ERROR: ' + o.s);
    else if (o.k === 'diag') parts.push(`${o.sev.toUpperCase()} line ${o.line}: ${o.msg}\n`);
    else if (o.k === 'img') parts.push('[figure]\n');
  }
  const text = parts.join('');
  return {
    n: i + 1, type: c.type === 'code' ? 'code' : 'markdown', source: c.src,
    output: text.length > OUTPUT_CAP ? text.slice(0, OUTPUT_CAP) + '\n…[truncated]' : text,
    ran: c.count != null, failed: hasError(c),
    ...(c.challenge ? { challenge: { expectedOutput: c.challenge.expectedOutput, matchMode: c.challenge.matchMode ?? 'trimmed', status: c.result?.state ?? 'not-run' } } : {}),
  };
}

/** window.__mlweb: the debugging / test hook other pages rely on. Typed loosely on purpose. */
type MlwebGlobal = { readonly cells: UiCell[]; runAll(): Promise<void>; runCell(c: UiCell): Promise<void>; files: Map<string, ImageFile>; addFile(f: File): Promise<void> };
const w = window as unknown as { __mlweb?: MlwebGlobal };

let activeDestroy: (() => void) | null = null;

/** FNV-1a over the cell types and sources: tells "published version" from "local edits". */
const fnv = (s: string) => {
  let x = 2166136261;
  for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); }
  return (x >>> 0).toString(36);
};
const hashCells = (cells: Array<{ type: string; src: string; challenge?: Challenge }>) =>
  fnv(JSON.stringify(cells.map((c) => (c.challenge ? [c.type, c.src, c.challenge] : [c.type, c.src]))));

export function mountShell(engine: Engine, opts: MountOptions, extraAr: Record<string, string> = {}): ShellHandle {
  activeDestroy?.();
  if (!opts || !(opts.root instanceof HTMLElement)) throw new Error('mount: opts.root must be an HTMLElement');
  if (!opts.notebook || !Array.isArray(opts.notebook.cells)) throw new Error('mount: opts.notebook.cells must be an array');

  const lang: Lang = opts.lang === 'ar' ? 'ar' : 'en';
  const t = createT(lang, extraAr);
  const root = opts.root;
  const edit = () => opts.mode === 'edit';
  const nbKey = () => `mlweb.nb.${opts.notebook.id}.v${opts.notebook.schemaVersion}`;
  const histKey = () => `mlweb.hist.${opts.notebook.id}.v${opts.notebook.schemaVersion}`;

  let nextId = 1, execCount = 0, destroyed = false;
  const state: Ctx['state'] = { cells: [], sel: 0, busy: false, vars: [], hist: [] };
  const editors = new Map<number, EditorView>();
  const editorStates = new Map<number, EditorState>();
  const editorScroll = new Map<number, { top: number; left: number }>();
  const cleanups: Array<() => void> = [];
  let cur: { ctrl: AbortController } | null = null;
  let statusKind: 'run' | 'error' | 'result' | undefined;
  const resolvers = new Map<number, (v: string | null) => void>();
  let focusInputId: number | null = null;
  let focusEditorId: number | null = null, focusCardId: number | null = null;
  let renderQ = 0, lastD = 0, generation = 0;

  const mkCell = (type: 'code' | 'md', src: string): UiCell => ({ id: nextId++, type, src, outs: [], count: null, running: false, mdEdit: false });
  /**
   * Challenge on a cell. Published form: `source` = starter code, `challenge.solution` = model solution.
   * Author (edit) form: the cell's code IS the model solution, so the starter is kept aside and the solution
   * is folded back in when the notebook is saved (see hostCells).
   */
  function attachChallenge(cell: UiCell, raw: unknown) {
    const ch = cell.type === 'code' ? cleanChallenge(raw) : undefined;
    if (!ch) return;
    cell.starter = cell.src;
    if (edit()) {
      if (ch.solution !== undefined) cell.src = ch.solution;
      delete ch.solution;
    }
    cell.challenge = ch;
  }
  const published = (): UiCell[] => {
    const cells = (opts.notebook.cells || []).map((c, i) => {
      const cell = mkCell(c.type === 'code' ? 'code' : 'md', String(c.source ?? ''));
      if (cell.type === 'code' && c.stdin !== undefined) cell.stdin = String(c.stdin);
      attachChallenge(cell, c.challenge);
      if (cell.challenge) cell.chRef = i;
      return cell;
    });
    return cells.length ? cells : [mkCell('code', '')];
  };
  const publishedHash = hashCells(published());
  const hostCells = (): HostCell[] => state.cells.map((c, i) => {
    const challenge = c.type === 'code' && c.challenge ? cleanChallenge(c.challenge) : undefined;
    // Author form -> published form: the author's code becomes the model solution, learners start from the starter.
    const asAuthor = !!challenge && edit();
    if (challenge && asAuthor && c.src.trim()) challenge.solution = c.src;
    return {
      id: 'cell-' + (i + 1), type: c.type === 'code' ? 'code' : 'markdown', source: asAuthor ? (c.starter ?? '') : c.src,
      ...(engine.caps.stdin && c.type === 'code' && c.stdin !== undefined ? { stdin: c.stdin } : {}),
      ...(challenge ? { challenge } : {}),
    };
  });

  // ---------------- skeleton ----------------
  root.replaceChildren();
  root.classList.add('mlweb');
  root.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
  root.setAttribute('lang', lang);
  const sidePanels = hasSidePanels({ engine });
  const bar = h('header', { id: 'bar' }, h('div', { class: 'brand' }, h('b', { id: 'nbTitle' }, '')), h('div', { class: 'actions', id: 'actions' }));
  const localNote = h('div', { class: 'local-note', id: 'localNote', hidden: edit() }, h('span', { id: 'saveState', role: 'status' }, ''));
  const layout = h('div', { id: 'layout' }, h('main', { id: 'nb' }), ...(sidePanels ? [h('aside', { id: 'side' })] : []));
  root.append(bar, localNote, layout);

  const q = <E extends HTMLElement = HTMLElement>(id: string) => root.querySelector<E>('#' + id);

  // ---------------- ctx ----------------
  const ctx: Ctx = {
    engine, t, lang, root, opts, state, q, editors, editorStates,
    isEdit: edit, mkCell, save, render, renderSide: () => renderSide(ctx), renderToolbar: () => renderToolbar(ctx, importInput),
    notify, confirm: (...a) => dialogs.confirm(...a), prompt: (...a) => dialogs.prompt(...a), answerInput,
    focusEditor: (id) => { focusEditorId = id; render(); },
    focusCard: (id) => { focusCardId = id; render(); },
    leaveEditor, jumpToLine, runCell, runFromEditor, runAll, stop, resetWorkspace, resetToPublished, resetChallenge, replaceCells,
    openHelp: () => dialogs.help(), openExport: () => exportDialog.open(), openImage: (o) => imageTool?.open(o),
    addFile, removeFile, renameFile, files: () => engine.files ?? new Map(), clearHistory,
  };
  const dialogs = createDialogs(ctx);
  const exportDialog = createExportDialog(ctx);
  const imageTool = engine.caps.images ? createImageTool(ctx) : null;
  const importInput = createImportInput(ctx);
  root.append(...dialogs.elements, exportDialog.element, ...(imageTool ? [imageTool.element] : []));

  /** Inline input: shows the box in the running cell and waits for Enter (value) or Esc/Stop (null). */
  function ask(c: UiCell | undefined, req: InputRequest = {}): Promise<string | null> {
    if (!c) return Promise.resolve(null);
    if (resolvers.has(c.id)) answerInput(c, null);
    return new Promise((resolve) => {
      c.pending = req.inline
        ? { label: '', value: '', inline: true, first: !!req.first }
        : { label: req.label ?? t('Standard input'), value: req.value ?? c.stdin ?? '' };
      resolvers.set(c.id, resolve);
      focusInputId = c.id;
      render();
    });
  }
  function answerInput(c: UiCell, value: string | null) {
    const resolve = resolvers.get(c.id), p = c.pending;
    resolvers.delete(c.id);
    c.pending = undefined;
    if (value !== null && p?.inline) {
      // Terminal style: the answer joins the program's own output ("Name: Belal"), and every line typed this run is kept as stdin.
      if (value !== '\u0004') {
        const line = value.endsWith('\n') ? value : value + '\n';
        c.stdin = (p.first ? '' : c.stdin ?? '') + line;
        applyOut(c, { k: 'text', s: line });
        save();
      }
    } else if (value !== null && p) {
      c.stdin = value;
      c.outs.push({ k: 'stdin', label: p.label, value });
      save();
    }
    render();
    resolve?.(value);
  }
  const cancelInputs = () => { for (const c of state.cells) if (c.pending) answerInput(c, null); };

  function notify(message: string) {
    if (opts.onNotice) { try { opts.onNotice(message); } catch { /* host notice failed */ } return; }
    dialogs.notify(message);
  }

  // ---------------- persistence ----------------
  function updateSaveState() {
    const el = q('saveState');
    if (!el || edit()) return;
    const local = hashCells(state.cells) !== publishedHash;
    el.textContent = local ? t('Local edits · saved in this browser only') : t('Published version');
    el.dataset.state = local ? 'local' : 'published';
  }
  function save() {
    if (edit()) { try { opts.onChange?.(hostCells()); } catch { /* host onChange failed */ } return; }
    const ok = store.set(nbKey(), JSON.stringify({
      v: 1, pub: publishedHash,
      cells: state.cells.map((c) => ({ type: c.type, src: c.src, ...(c.stdin !== undefined ? { stdin: c.stdin } : {}), ...(c.chRef !== undefined ? { chRef: c.chRef } : {}) })),
    }));
    updateSaveState();
    if (!ok) notify(t('Notebook could not be saved in this browser. Export a copy to avoid losing changes.'));
  }
  function loadLegacy(): UiCell[] | null {
    const key = engine.legacyStoreKey?.(String(opts.notebook.id));
    const raw = key ? store.get(key) : null;
    if (!raw) return null;
    try {
      const j = JSON.parse(raw);
      if (!Array.isArray(j?.cells) || !j.cells.length) return null;
      return j.cells.map((x: any) => {
        const c = mkCell(x?.type === 'code' ? 'code' : 'md', String(x?.source ?? ''));
        if (c.type === 'code' && x?.stdin) c.stdin = String(x.stdin);
        return c;
      });
    } catch { return null; }
  }
  function loadLocal(): UiCell[] | null {
    const raw = store.get(nbKey());
    if (!raw) return loadLegacy();
    try {
      const j = JSON.parse(raw);
      const arr = Array.isArray(j) ? j : j && Array.isArray(j.cells) ? j.cells : null;
      if (!arr || !arr.length) return null;
      const cells = arr.map((x: any) => ({ type: x?.type === 'code' ? 'code' : 'md', src: String(x?.src ?? ''), stdin: x?.stdin, chRef: typeof x?.chRef === 'number' ? x.chRef : undefined }));
      const stale = j && !Array.isArray(j) && j.pub && j.pub !== publishedHash;
      // The author republished and the reader never edited: show the new version.
      if (stale && hashCells(cells) === j.pub) return null;
      if (stale) setTimeout(() => notify(t('This notebook was updated by the author. Your local edits were kept; use "Reset to published version" to see the new one.')), 0);
      const pub = published();
      return cells.map((x: any) => {
        const c = mkCell(x.type, x.src);
        if (x.type === 'code' && x.stdin !== undefined) c.stdin = String(x.stdin);
        // The challenge definition always comes from the published notebook, never from local storage.
        const p = x.type === 'code' && x.chRef !== undefined ? pub.find((u) => u.chRef === x.chRef) : undefined;
        if (p) { c.challenge = p.challenge; c.chRef = p.chRef; c.starter = p.starter; }
        return c;
      });
    } catch { return null; }
  }

  // ---------------- status ----------------
  function setStatus(text: string, kind?: 'run' | 'error' | 'result') {
    statusKind = kind;
    const el = q('status');
    if (el) { el.textContent = text; el.title = text; el.setAttribute('aria-label', text); el.dataset.state = state.busy ? 'running' : 'idle'; }
    syncStop();
  }
  function syncStop() {
    const stopBtn = q('stop');
    stopBtn?.toggleAttribute('disabled', !state.busy);
    q('runall')?.toggleAttribute('disabled', state.busy);
    if (stopBtn) stopBtn.hidden = !state.busy;
  }

  // ---------------- outputs ----------------
  const scheduleRender = () => { if (!renderQ) renderQ = requestAnimationFrame(() => { renderQ = 0; if (!destroyed) render(); }); };
  function applyOut(c: UiCell | undefined, o: Out) {
    if (!c) return;
    if (o.k === 'img') {
      // imshow into the same figure replaces the previous image; imtool images always add.
      if (!o.tool) c.outs = c.outs.filter((x) => !(x.k === 'img' && x.fig === o.fig));
      c.outs.push(o);
      scheduleRender();
      if (o.tool) imageTool?.open(o);
      return;
    }
    const last = c.outs[c.outs.length - 1];
    if (o.k === 'text' && last && last.k === 'text') c.outs[c.outs.length - 1] = { k: 'text', s: last.s + o.s };
    else c.outs.push(o.k === 'warn' ? { k: 'warn', s: o.s.replace(/\n?$/, '\n') } : o);
    scheduleRender();
  }

  // ---------------- running ----------------
  const aborted = (ctrl: AbortController) => new Promise<void>((res) => ctrl.signal.addEventListener('abort', () => setTimeout(res, 3000), { once: true }));

  function makeSink(snapshot: Cell[], single: number | null, run: number): RunSink {
    const live = (i?: number) => {
      const idx = i ?? single;
      const id = idx == null ? undefined : snapshot[idx]?.id;
      return id == null ? undefined : state.cells.find((c) => c.id === id);
    };
    return {
      out: (o, i) => { if (run === generation) applyOut(live(i), o); },
      clear: (i) => { const c = live(i); if (c && run === generation) { c.outs = c.outs.filter((x) => x.k === 'err'); scheduleRender(); } },
      status: (text, kind) => { if (run === generation) setStatus(text, kind); },
      vars: (v: VarInfo[]) => { if (run === generation) { state.vars = v; ctx.renderSide(); } },
      files: () => { if (run === generation) ctx.renderSide(); },
      input: (req, i) => (run === generation ? ask(live(i), req) : Promise.resolve(null)),
    };
  }

  async function execute(targets: UiCell[], batch: boolean, ctrlRun: (req: Parameters<Engine['run']>[0], sink: RunSink) => Promise<void>): Promise<void> {
    const ctrl = new AbortController();
    cur = { ctrl };
    state.busy = true;
    const run = ++generation;
    for (const c of targets) { c.outs = []; c.result = undefined; c.running = true; c.count = ++execCount; }
    setStatus(t('Running…'), 'run');
    render();
    const snapshot: Cell[] = state.cells.map((c) => {
      const base: Cell = { id: c.id, type: c.type, src: c.src, ...(c.stdin !== undefined ? { stdin: c.stdin } : {}) };
      // A challenge is graded against its own test input, so the learner is not asked for stdin.
      if (!edit() && engine.caps.stdin && c.type === 'code' && c.challenge?.testStdin !== undefined) { base.stdin = c.challenge.testStdin; base.stdinLocked = true; }
      return base;
    });
    const single = batch ? null : snapshot.findIndex((c) => c.id === targets[0].id);
    const sink = makeSink(snapshot, single, run);
    try {
      await Promise.race([ctrlRun({ cells: snapshot, target: batch ? 'all' : single!, signal: ctrl.signal }, sink), aborted(ctrl)]);
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError' && !ctrl.signal.aborted) {
        const message = (e as Error)?.message || t('Execution failed.');
        for (const c of targets) applyOut(c, { k: 'err', s: message + '\n' });
        setStatus(message, 'error');
        notify(message);
      }
    } finally {
      if (cur?.ctrl === ctrl) {
        cur = null; state.busy = false;
        for (const c of targets) {
          c.running = false;
          if (c.type === 'code' && c.challenge && edit()) {
            // Authoring: the author's own code defines the challenge. Its output is the expected output,
            // and the stdin typed for the run (if any) becomes the test input.
            c.result = undefined;
            if (!ctrl.signal.aborted && !hasError(c)) {
              c.challenge.expectedOutput = normalizeOutput(actualOutput(c.outs));
              if (engine.caps.stdin && c.stdin !== undefined) c.challenge.testStdin = c.stdin; else delete c.challenge.testStdin;
              save();
            }
          } else if (c.type === 'code' && c.challenge) {
            if (ctrl.signal.aborted) c.result = undefined;
            else { c.attempts = (c.attempts ?? 0) + 1; c.result = gradeCell(c.challenge, c.outs, hasError(c)); }
          }
        }
        if (statusKind !== 'error' && statusKind !== 'result') setStatus(t('Ready'));
        else syncStop();
        if (!destroyed) { render(); ctx.renderSide(); }
      }
    }
  }

  function runCell(c: UiCell): Promise<void> {
    if (c.type !== 'code' || cur) return Promise.resolve();
    if (engine.caps.history) {
      for (const ln of c.src.split(/\r?\n/)) {
        const s = ln.trim();
        if (s && !s.startsWith('%') && !s.startsWith('//') && s !== 'end') state.hist.push(s);
      }
      state.hist = state.hist.slice(-300);
      store.set(histKey(), JSON.stringify(state.hist));
    }
    return execute([c], false, (req, sink) => engine.run(req, sink));
  }

  async function runAll(): Promise<void> {
    if (cur) return;
    if (engine.runAll) {
      const codes = state.cells.filter((c) => c.type === 'code');
      if (!codes.length) return;
      await execute(codes, true, (req, sink) => engine.runAll!(req, sink));
      return;
    }
    for (let i = 0; i < state.cells.length; i++) {
      const c = state.cells[i];
      if (c.type === 'code') await runCell(c);
      if (hasError(c)) break;
    }
  }

  function stop() { cur?.ctrl.abort(); cancelInputs(); }
  function resetWorkspace() {
    if (cur) return;
    void engine.reset();
    state.vars = [];
    ctx.renderSide();
  }
  function clearHistory() { state.hist = []; store.set(histKey(), '[]'); ctx.renderSide(); }

  function runFromEditor(c: UiCell, advance: boolean, command = false): boolean {
    if (cur) return true;
    void runCell(c).then(() => {
      if (!advance) return;
      const i = state.cells.indexOf(c);
      if (i < 0) return;
      if (i === state.cells.length - 1) state.cells.push(mkCell('code', ''));
      state.sel = i + 1;
      save();
      if (command) ctx.focusCard(state.cells[state.sel].id); else ctx.focusEditor(state.cells[state.sel].id);
    });
    return true;
  }

  // ---------------- cells / files ----------------
  function replaceCells(cells: UiCell[]) {
    if (cur) stop();
    editorStates.clear(); editorScroll.clear();
    state.cells = cells.length ? cells : [mkCell('code', '')];
    state.sel = 0;
    save(); render(); ctx.renderSide();
    prepare();
  }
  function resetChallenge(c: UiCell) {
    if (cur || c.starter === undefined) return;
    c.src = c.starter; c.outs = []; c.count = null; c.result = undefined; c.hintShown = false; c.solutionShown = false;
    if (c.challenge?.testStdin === undefined) delete c.stdin;
    editorStates.delete(c.id); editorScroll.delete(c.id);
    save(); render();
    ctx.focusEditor(c.id);
  }
  function resetToPublished() {
    if (cur) stop();
    store.set(nbKey(), '');
    editorStates.clear(); editorScroll.clear();
    state.cells = published(); state.sel = 0; state.vars = [];
    save(); void engine.reset(); render(); ctx.renderSide();
    prepare();
  }
  function prepare() {
    const p = engine.prepare?.(state.cells.map((c) => c.src));
    if (p) void p.then(() => { if (!destroyed) ctx.renderSide(); }, () => {});
  }
  async function addFile(f: File) {
    if (!engine.addFile && !engine.files) return;
    if (!engine.addFile) { engine.files?.set(f.name, await fileToImage(f)); }
    else await engine.addFile(f);
    window.__mlwebFileHook?.add?.(f);
    ctx.renderSide();
  }
  function removeFile(name: string) {
    if (engine.removeFile) engine.removeFile(name); else engine.files?.delete(name);
    window.__mlwebFileHook?.del?.(name);
    ctx.renderSide();
  }
  function renameFile(from: string, to: string): boolean {
    const name = to.trim(), files = engine.files;
    if (!engine.renameFile || !files?.has(from) || name === from) return false;
    if (!name || /[\\/]/.test(name)) { notify(t('File names cannot be empty or contain / or \\.')); return false; }
    if (files.has(name)) { notify(t('A file named {name} already exists.', { name })); return false; }
    engine.renameFile(from, name);
    window.__mlwebFileHook?.rename?.(from, name);
    if (state.cells.some((c) => c.type === 'code' && c.src.includes(from))) notify(t('Renamed. Code cells that mention {name} still use the old name.', { name: from }));
    ctx.renderSide();
    return true;
  }

  // ---------------- editor focus helpers ----------------
  function leaveEditor(c: UiCell): boolean {
    const i = state.cells.indexOf(c);
    if (i < 0) return false;
    state.sel = i;
    const card = q('nb')!.querySelectorAll<HTMLElement>('.cell')[i];
    (document.activeElement as HTMLElement | null)?.blur?.();
    card?.focus();
    return true;
  }
  function jumpToLine(c: UiCell, line: number, col?: number) {
    const view = editors.get(c.id);
    if (!view) { ctx.focusEditor(c.id); return; }
    const doc = view.state.doc, ln = doc.line(Math.max(1, Math.min(line, doc.lines)));
    const pos = ln.from + (col ? Math.min(col - 1, ln.length) : 0);
    view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
    view.focus();
  }

  // ---------------- command mode (Esc, then A/B/D D/M/Y/J/K/Enter) ----------------
  function onCommandKey(e: KeyboardEvent) {
    const target = e.target as HTMLElement | null;
    if (!target || !target.classList?.contains('cell')) return;
    const i = Array.from(q('nb')!.querySelectorAll('.cell')).indexOf(target), cell = state.cells[i];
    if (!cell) return;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const go = (n: number) => { n = Math.max(0, Math.min(state.cells.length - 1, n)); state.sel = n; ctx.focusCard(state.cells[n].id); };
    if (e.key === 'Enter' && (e.shiftKey || e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (cell.type === 'code') runFromEditor(cell, e.shiftKey, true); else if (e.shiftKey) go(i + 1);
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const insertAt = (at: number) => { const c = mkCell('code', ''); state.cells.splice(at, 0, c); state.sel = at; save(); ctx.focusCard(c.id); };
    switch (key) {
      case 'Enter': e.preventDefault(); if (cell.type === 'md') cell.mdEdit = true; ctx.focusEditor(cell.id); break;
      case 'ArrowUp': case 'k': e.preventDefault(); go(i - 1); break;
      case 'ArrowDown': case 'j': e.preventDefault(); go(i + 1); break;
      case 'a': e.preventDefault(); insertAt(i); break;
      case 'b': e.preventDefault(); insertAt(i + 1); break;
      case 'm': e.preventDefault(); if (cell.type !== 'md') { cell.type = 'md'; cell.outs = []; cell.count = null; cell.mdEdit = false; save(); ctx.focusCard(cell.id); } break;
      case 'y': e.preventDefault(); if (cell.type !== 'code') { cell.type = 'code'; cell.mdEdit = false; save(); ctx.focusCard(cell.id); } break;
      case 'd': {
        e.preventDefault();
        const now = Date.now();
        if (now - lastD < 900) {
          lastD = 0;
          state.cells.splice(i, 1);
          if (!state.cells.length) state.cells.push(mkCell('code', ''));
          const n = Math.min(i, state.cells.length - 1);
          state.sel = n; save(); ctx.focusCard(state.cells[n].id);
        } else lastD = now;
        break;
      }
      default: return;
    }
    if (key !== 'd') lastD = 0;
  }

  // ---------------- render loop ----------------
  function render() {
    if (destroyed) return;
    const nb = q('nb')!, y = window.scrollY, active = document.activeElement as HTMLElement | null;
    const ta = active as HTMLTextAreaElement | null;
    let keepText = ta && ta.dataset?.cell ? { id: ta.dataset.cell, s: ta.selectionStart, e: ta.selectionEnd } : null;
    const keepInput = ta && ta.dataset?.stdin ? { id: ta.dataset.stdin, s: ta.selectionStart, e: ta.selectionEnd } : null;
    let keepEditor: number | null = null;
    const keepCard = active instanceof HTMLElement && active.classList.contains('cell') ? Array.from(nb.children).indexOf(active) : -1;
    for (const [id, view] of editors) {
      if (view.hasFocus) keepEditor = id;
      editorStates.set(id, view.state);
      editorScroll.set(id, { top: view.scrollDOM.scrollTop, left: view.scrollDOM.scrollLeft });
      view.destroy();
    }
    editors.clear();
    const codeIds = new Set(state.cells.filter((c) => c.type === 'code').map((c) => c.id));
    for (const id of [...editorStates.keys()]) if (!codeIds.has(id)) { editorStates.delete(id); editorScroll.delete(id); }

    nb.replaceChildren();
    state.cells.forEach((c, i) => nb.append(renderCell(ctx, c, i)));

    if (focusEditorId !== null) {
      const view = editors.get(focusEditorId);
      if (view) {
        view.dispatch({ selection: { anchor: view.state.doc.length } });
        view.focus();
        view.scrollDOM.scrollTop = view.scrollDOM.scrollHeight;
      } else {
        const t2 = nb.querySelector<HTMLTextAreaElement>(`textarea[data-cell="${focusEditorId}"]`);
        if (t2) { t2.focus(); t2.setSelectionRange(t2.value.length, t2.value.length); t2.scrollIntoView?.({ block: 'nearest' }); }
      }
      focusEditorId = null; keepText = null; keepEditor = null;
    }
    if (focusInputId !== null) {
      const t3 = nb.querySelector<HTMLTextAreaElement>(`[data-stdin="${focusInputId}"]`);
      if (t3) { t3.focus(); t3.setSelectionRange(t3.value.length, t3.value.length); t3.scrollIntoView?.({ block: 'nearest' }); }
      focusInputId = null; keepText = null; keepEditor = null;
    } else if (keepInput) {
      const t3 = nb.querySelector<HTMLTextAreaElement>(`[data-stdin="${keepInput.id}"]`);
      if (t3) { t3.focus({ preventScroll: true }); t3.setSelectionRange(keepInput.s, keepInput.e); }
    }
    if (keepText) {
      const t2 = nb.querySelector<HTMLTextAreaElement>(`textarea[data-cell="${keepText.id}"]`);
      if (t2) { t2.focus({ preventScroll: true }); t2.setSelectionRange(keepText.s, keepText.e); }
    } else if (keepEditor !== null) {
      const view = editors.get(keepEditor), sc = editorScroll.get(keepEditor);
      if (view) { view.focus(); if (sc) view.scrollDOM.scrollTo(sc.left, sc.top); }
    }
    if (focusCardId !== null) {
      const i = state.cells.findIndex((c) => c.id === focusCardId);
      nb.querySelectorAll<HTMLElement>('.cell')[i]?.focus();
      focusCardId = null;
    } else if (keepCard >= 0 && !document.activeElement?.closest?.('.cell')) {
      nb.querySelectorAll<HTMLElement>('.cell')[Math.min(keepCard, state.cells.length - 1)]?.focus({ preventScroll: true });
    }
    window.scrollTo(0, y);
    syncStop();
  }

  // ---------------- listeners: tooltip, command keys, help shortcut ----------------
  const on = (el: EventTarget | null, ev: string, fn: (e: any) => void, o?: AddEventListenerOptions | boolean) => {
    if (!el) return; el.addEventListener(ev, fn, o); cleanups.push(() => el.removeEventListener(ev, fn, o));
  };
  const tip = h('div', { class: 'mlweb-tooltip', role: 'tooltip', hidden: true });
  document.body.append(tip);
  let tipFor: HTMLElement | null = null;
  const hideTip = () => { tip.hidden = true; tipFor = null; };
  const placeTip = () => {
    if (!tipFor || !root.contains(tipFor)) { hideTip(); return; }
    const a = tipFor.getBoundingClientRect(), b = tip.getBoundingClientRect(), pad = 8;
    const left = Math.max(pad, Math.min(a.left + (a.width - b.width) / 2, window.innerWidth - b.width - pad));
    const below = a.bottom + pad;
    const top = below + b.height <= window.innerHeight - pad ? below : Math.max(pad, a.top - b.height - pad);
    tip.style.left = `${Math.round(left)}px`; tip.style.top = `${Math.round(top)}px`;
  };
  const showTip = (target: EventTarget | null) => {
    const b = target instanceof Element ? target.closest<HTMLElement>('button[data-tooltip]') : null;
    if (b?.dataset.tooltip) { tipFor = b; tip.textContent = b.dataset.tooltip; tip.hidden = false; placeTip(); }
  };
  const leaveTip = (e: any) => {
    const b = e.target instanceof Element ? e.target.closest('button[data-tooltip]') : null;
    if (b && b === tipFor && !(e.relatedTarget instanceof Node && b.contains(e.relatedTarget))) hideTip();
  };
  on(root, 'pointerover', (e) => showTip(e.target));
  on(root, 'pointerout', leaveTip);
  on(root, 'focusin', (e) => showTip(e.target));
  on(root, 'focusout', leaveTip);
  on(window, 'scroll', placeTip, true);
  on(window, 'resize', placeTip);
  on(q('nb'), 'keydown', onCommandKey);
  on(window, 'keydown', (e: KeyboardEvent) => {
    const tgt = e.target as HTMLElement | null;
    if (!tgt || !root.contains(tgt)) return;
    const combo = (e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'p';
    const question = e.key === '?' && !['INPUT', 'TEXTAREA'].includes(tgt.tagName ?? '') && !tgt.closest?.('.cm-editor');
    if (combo || question) { e.preventDefault(); dialogs.help(); }
  });

  // ---------------- boot ----------------
  if (engine.caps.history) {
    try { const d = JSON.parse(store.get(histKey()) ?? '[]'); state.hist = Array.isArray(d) ? d.filter((m: unknown) => typeof m === 'string') : []; } catch { state.hist = []; }
  }
  state.cells = edit() ? published() : (loadLocal() ?? published());
  if (!edit()) save();
  engine.attach?.({ codeSources: () => state.cells.filter((c) => c.type === 'code').map((c) => c.src) });
  ctx.renderToolbar();
  updateSaveState();
  setStatus(t('Ready'));
  render();
  ctx.renderSide();
  prepare();

  // ---------------- handle ----------------
  const globalApi: MlwebGlobal = {
    get cells() { return state.cells; }, runAll, runCell, get files() { return ctx.files(); }, addFile,
  };
  w.__mlweb = globalApi;

  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    if (activeDestroy === destroy) activeDestroy = null;
    generation++;
    if (renderQ) cancelAnimationFrame(renderQ);
    cur?.ctrl.abort(); cancelInputs(); cur = null; state.busy = false;
    for (const view of editors.values()) view.destroy();
    editors.clear();
    try { engine.dispose(); } catch { /* engine already gone */ }
    cleanups.splice(0).forEach((f) => f());
    dialogs.dispose(); exportDialog.dispose(); imageTool?.dispose();
    tip.remove();
    for (const d of Array.from(root.querySelectorAll('dialog'))) { try { closeDialog(d); } catch { /* not open */ } }
    root.replaceChildren();
    root.classList.remove('mlweb');
    root.removeAttribute('dir');
    if (w.__mlweb === globalApi) delete w.__mlweb;
  };
  activeDestroy = destroy;

  return {
    destroy,
    getCells: hostCells,
    resetToPublished,
    describe: () => state.cells.map(describeCell),
    async runCellAt(n) {
      const c = state.cells[n - 1];
      if (!c || c.type !== 'code') return null;
      await runCell(c);
      return describeCell(c, n - 1);
    },
    setCells(next) {
      replaceCells((next || []).map((m) => {
        const c = mkCell(m.type === 'code' ? 'code' : 'md', String(m.source ?? ''));
        if (c.type === 'code' && m.stdin !== undefined) c.stdin = String(m.stdin);
        attachChallenge(c, m.challenge);
        return c;
      }));
    },
  };
}
