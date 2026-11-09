// =============================================================================
// runtimes/matlab/src/engine.ts
// MATLAB engine for the shared notebook UI. Wraps the interpreter Web Worker:
//   * 60 s time limit per run, Stop aborts; both reset the workspace (like the old runtime)
//   * workspace variables, current-folder image files (uploads, imwrite output, lesson assets)
//   * figures and imtool images reported as `img` outputs
// Caps: everything except stdin. No DOM and no CSS here; the shell draws everything.
// =============================================================================
import type { Engine, ImageFile, VarInfo, RunRequest, RunSink } from '../../shared/engine';
import { createT, type Lang } from '../../shared/i18n';
import { fileToImage } from '../../shared/images';
import { matlabLanguage } from './language';
import { matlabLint, type LintMessages } from './lint';
import { matlabCompletions } from './completions';
import { matlabIndent } from './indent';
import { MATLAB_HELP } from './help';

export const TIME_LIMIT_MS = 60_000;
const DEFAULT_FILES = ['test.png', 'testgray.png'];

export interface MatlabEngineOptions {
  baseUrl?: string;
  lang?: Lang;
  /** Published cell sources: image names they mention are pre-loaded. */
  publishedSources?: string[];
  /** Test hook: build the worker. Default loads `<baseUrl>worker.js`. */
  createWorker?: (workerUrl: string) => Worker;
}

type Run = { sink: RunSink; id: number; fig: number; timer: number; settle: () => void };

const LINT_EN: LintMessages = {
  unmatched: (c) => `Unmatched '${c}'`, unclosed: (c) => `Unclosed '${c}'`,
  mismatch: (o, c) => `'${c}' does not match '${o}'`, string: 'Unterminated string',
};
const LINT_AR: LintMessages = {
  unmatched: (c) => `القوس '${c}' بلا مقابل`, unclosed: (c) => `القوس '${c}' غير مغلق`,
  mismatch: (o, c) => `'${c}' لا يطابق '${o}'`, string: 'نص غير منتهٍ',
};

export function createMatlabEngine(opts: MatlabEngineOptions = {}): Engine {
  const t = createT(opts.lang === 'ar' ? 'ar' : 'en');
  const baseUrl = new URL(opts.baseUrl || './', location.href).href.replace(/\/?$/, '/');
  const files = new Map<string, ImageFile>();
  const manifest = new Map<string, string>();     // lower-case name -> real asset name
  const loading = new Map<string, Promise<void>>();
  let vars: VarInfo[] = [];
  let worker: Worker | null = null;
  let cur: Run | null = null;
  let disposed = false, epoch = 0;
  let codeSources: () => string[] = () => opts.publishedSources ?? [];

  // ---------------- worker ----------------
  const buildWorker = (url: string): Worker => {
    if (opts.createWorker) return opts.createWorker(url);
    try { return new Worker(url); }
    catch {
      // Cross-origin script URL: fetch it and start the worker from a blob.
      const xhr = new XMLHttpRequest();
      xhr.open('GET', url, false); xhr.send();
      return new Worker(URL.createObjectURL(new Blob([xhr.responseText], { type: 'text/javascript' })));
    }
  };
  function startWorker() {
    try { worker?.terminate(); } catch { /* already gone */ }
    worker = buildWorker(baseUrl + 'worker.js');
    worker.onmessage = onMessage;
    worker.onerror = (ev) => { cur?.sink.out({ k: 'err', s: t('Worker error: ') + ev.message + '\n' }); finish(); };
    for (const [name, img] of files) worker.postMessage({ t: 'putFile', name, img });
  }

  function finish() {
    const run = cur;
    if (!run) return;
    clearTimeout(run.timer);
    cur = null;
    run.settle();
  }
  /** Time limit or Stop: report, throw the worker away (it may be in an endless loop), reset the workspace. */
  function abortRun(message: string) {
    if (!cur) return;
    const sink = cur.sink;
    sink.out({ k: 'err', s: message });
    startWorker();
    vars = [];
    sink.vars?.([]);
    finish();
  }

  function onMessage(e: MessageEvent) {
    const m = e.data, run = cur;
    switch (m.t) {
      case 'print': run?.sink.out({ k: 'text', s: m.s }); break;
      case 'warn': run?.sink.out({ k: 'warn', s: m.s }); break;
      case 'clc': run?.sink.clear(); break;
      case 'fig': if (run) run.fig++; break;
      case 'img':
        if (run) {
          if (run.fig === 0) run.fig = 1;
          run.sink.out({ k: 'img', fig: m.tool ? -run.fig : run.fig, w: m.w, h: m.h, rgb: m.rgb, tool: !!m.tool });
        }
        break;
      case 'wrote': files.set(m.name, m.img); run?.sink.files?.(); break;
      case 'vars': vars = m.vars; run?.sink.vars?.(vars); break;
      case 'done':
        if (run && run.id === m.id) {
          if (m.error) run.sink.out({ k: 'err', s: m.error + '\n' });
          vars = m.vars;
          run.sink.vars?.(vars);
          finish();
        }
        break;
    }
  }

  // ---------------- assets (images referenced by code) ----------------
  const manifestReady: Promise<void> = (typeof fetch === 'function'
    ? fetch(baseUrl + 'assets/manifest.json').then((r) => (r.ok ? r.json() : [])).then((list) => {
        if (!disposed && Array.isArray(list)) for (const n of list) if (typeof n === 'string') manifest.set(n.toLowerCase(), n);
      }).catch(() => {})
    : Promise.resolve());

  const baseName = (p: string) => p.split(/[\\/]/).pop() || p;
  function mentionedAssets(src: string): string[] {
    const found = new Set<string>();
    for (const m of src.matchAll(/['"]([^'"\n]{1,200})['"]/g)) {
      const real = manifest.get(baseName(m[1]).toLowerCase());
      if (real) found.add(real);
    }
    return [...found];
  }
  function loadAsset(name: string): Promise<void> {
    if (files.has(name)) return Promise.resolve();
    const pending = loading.get(name);
    if (pending) return pending;
    const mine = epoch;
    const job = fetch(baseUrl + 'assets/' + encodeURIComponent(name) + '.json')
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then((j) => {
        if (mine !== epoch || disposed) return;
        const bin = atob(j.b64), data = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
        const { b64, ...rest } = j; void b64;
        const img = { ...rest, data } as ImageFile;
        files.set(name, img);
        worker?.postMessage({ t: 'putFile', name, img });
      })
      .catch((e) => { console.warn('MLWeb: could not load asset', name, e); })
      .finally(() => { loading.delete(name); });
    loading.set(name, job);
    return job;
  }
  async function loadFor(sources: string[]) {
    await manifestReady;
    if (disposed) return;
    await Promise.all(sources.flatMap(mentionedAssets).map(loadAsset));
  }

  startWorker();

  // ---------------- Engine ----------------
  const engine: Engine = {
    id: 'matlab',
    label: 'MATLAB',
    kernelDisplay: 'MLWeb (MATLAB subset)',
    kernel: 'mlweb',
    exportExt: '.m',
    caps: { workspace: true, files: true, images: true, stdin: false, history: true },
    editor: {
      extensions: () => [matlabLanguage, matlabIndent()],
      lint: matlabLint(opts.lang === 'ar' ? LINT_AR : LINT_EN),
      completions: matlabCompletions({ workspace: () => vars, codeSources: () => codeSources(), fileNames: () => [...files.keys()] }),
    },
    help: MATLAB_HELP,
    files,

    run({ cells, target, signal }: RunRequest, sink: RunSink) {
      const cell = typeof target === 'number' ? cells[target] : undefined;
      if (!cell || cell.type !== 'code') return Promise.resolve();
      if (cur) return Promise.resolve();
      return new Promise<void>((resolve) => {
        const run: Run = {
          sink, id: cell.id, fig: 0, settle: resolve,
          timer: window.setTimeout(() => abortRun(t('Execution stopped: time limit (60 s) exceeded. The workspace was reset.\n')), TIME_LIMIT_MS),
        };
        cur = run;
        signal.addEventListener('abort', () => { if (cur === run) abortRun(t('Execution interrupted by user. The workspace was reset.\n')); }, { once: true });
        // Images named in the code must be in the worker before it runs.
        loadFor([cell.src]).then(() => { if (cur === run) worker!.postMessage({ t: 'run', id: cell.id, src: cell.src }); });
      });
    },

    reset() { if (!cur) { worker?.postMessage({ t: 'reset' }); vars = []; } },

    async addFile(f: File) {
      const img = await fileToImage(f);
      files.set(f.name, img);
      worker?.postMessage({ t: 'putFile', name: f.name, img });
    },
    removeFile(name: string) { files.delete(name); worker?.postMessage({ t: 'delFile', name }); },
    renameFile(from: string, to: string) {
      // Rebuild the map so the file keeps its place in the list; `files` itself must stay the same object.
      const next = [...files].map(([k, v]) => (k === from ? [to, { ...v, filename: '/vfs/' + to }] as const : [k, v] as const));
      files.clear();
      for (const [k, v] of next) files.set(k, v);
      worker?.postMessage({ t: 'delFile', name: from });
      worker?.postMessage({ t: 'putFile', name: to, img: files.get(to) });
    },

    attach(host) { codeSources = host.codeSources; },

    async prepare(sources: string[]) {
      await manifestReady;
      if (disposed) return;
      for (const n of DEFAULT_FILES) if (manifest.has(n)) await loadAsset(manifest.get(n)!);
      await loadFor([...(opts.publishedSources ?? []), ...sources]);
    },

    dispose() {
      disposed = true; epoch++;
      if (cur) { clearTimeout(cur.timer); const r = cur; cur = null; r.settle(); }
      try { worker?.terminate(); } catch { /* already gone */ }
      worker = null;
    },
  };
  return engine;
}
