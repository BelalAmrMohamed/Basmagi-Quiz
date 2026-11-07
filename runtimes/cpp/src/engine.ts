// =============================================================================
// runtimes/cpp/src/engine.ts
// C++ engine for the shared notebook UI. It only talks to the cpp-run Edge Function;
// all DOM, styling and dialogs come from runtimes/shared. Stdin is asked inline, Jupyter
// style, through sink.input().
// =============================================================================
import { cpp } from '@codemirror/lang-cpp';
import { cppCompletions } from './completions';
import type { Engine, Cell, RunRequest, RunSink } from '../../shared/engine';

export type CppRunResponse = {
  ok: boolean; compile?: string; sections?: Array<{ stdout?: string; stderr?: string }>;
  exit?: number; timeMs?: number; provider?: string; truncated?: boolean;
};
export type CppExecute = (r: { cells: Array<{ src: string; stdin?: string }>; target: number | 'all'; signal: AbortSignal }) => Promise<CppRunResponse>;
export type CppEngineOptions = { execute: CppExecute; lang?: 'en' | 'ar'; timeoutMs?: number };

export const CPP_AR: Record<string, string> = {
  'Compiling…': 'جارٍ التجميع…',
  'Compile error': 'خطأ في التجميع',
  'Exit': 'الخروج',
  'Empty cell skipped': 'تم تجاوز الخلية الفارغة',
  'Compiler request failed.': 'فشل طلب المترجم.',
  'No response from the compile service within 25 s.': 'لم تصل أي استجابة من خدمة التجميع خلال 25 ثانية.',
  'The compiler returned no diagnostics.': 'لم يُرجع المترجم أي رسائل.',
  'output truncated': 'تم اقتطاع المخرجات',
  'Compiler messages': 'رسائل المترجم',
  'Standard input · Cell {n}': 'الإدخال القياسي · الخلية {n}',
};

const USES_CIN = /(?:\bstd\s*::\s*)?\bcin\b/;
const DIAG = /cell-(\d+):(\d+)(?::(\d+))?:\s*(fatal error|error|warning)\s*:\s*(.*)/;

/** Turn gcc output into diagnostics keyed by active-list cell (0-based). Unmatched text is returned as `rest`. */
export function parseCompile(text: string): { diags: Array<{ k: number; line: number; col?: number; sev: 'error' | 'warning'; msg: string }>; rest: string } {
  const diags: Array<{ k: number; line: number; col?: number; sev: 'error' | 'warning'; msg: string }> = [];
  const rest: string[] = [];
  for (const ln of text.split('\n')) {
    const m = DIAG.exec(ln);
    if (m) diags.push({ k: Number(m[1]) - 1, line: Number(m[2]), ...(m[3] ? { col: Number(m[3]) } : {}), sev: m[4] === 'warning' ? 'warning' : 'error', msg: m[5] });
    else if (ln.trim()) rest.push(ln.replace(/cell-(\d+):(\d+)(?::\d+)?/g, (_, k, l) => `cell ${k}, line ${l}`));
  }
  return { diags, rest: rest.join('\n') };
}

export function createCppEngine(o: CppEngineOptions): Engine {
  // Filled in by the shell through attach(); completions read it lazily on every keystroke.
  let codeSources: () => string[] = () => [];
  const tr = (s: string) => (o.lang === 'ar' && CPP_AR[s]) || s;
  const timeoutMs = o.timeoutMs ?? 25000;

  async function go(req: RunRequest, sink: RunSink, all: boolean) {
    const active: Array<{ idx: number; cell: Cell }> = [];
    req.cells.forEach((cell, idx) => { if (cell.type === 'code' && cell.src.trim()) active.push({ idx, cell }); });
    const tIdx = req.target;
    if (!all && typeof tIdx === 'number' && !active.some((a) => a.idx === tIdx)) { sink.status(tr('Empty cell skipped')); return; }
    if (!active.length) return;
    const selected = all ? active : active.filter((a) => a.idx === tIdx);
    const stdins = new Map<number, string>();
    for (const a of selected) {
      if (USES_CIN.test(a.cell.src)) {
        const n = req.cells.slice(0, a.idx + 1).filter((c) => c.type === 'code').length;
        const v = await sink.input({ label: tr('Standard input · Cell {n}').replace('{n}', String(n)), value: a.cell.stdin ?? '' }, a.idx);
        if (v === null) return;
        stdins.set(a.idx, v);
      }
    }
    if (req.signal.aborted) return;
    sink.status(tr('Compiling…'), 'run');
    const ctrl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs);
    const onAbort = () => ctrl.abort();
    req.signal.addEventListener('abort', onAbort);
    try {
      const targetActive = all ? 'all' as const : active.findIndex((a) => a.idx === tIdx);
      const res = await o.execute({
        cells: active.map((a) => ({ src: a.cell.src, stdin: stdins.get(a.idx) ?? a.cell.stdin ?? '' })),
        target: targetActive, signal: ctrl.signal,
      });
      if (req.signal.aborted) return;
      const shown = new Set(selected.map((a) => a.idx));
      let hasErr = false;
      if (res.compile) {
        const { diags, rest } = parseCompile(res.compile);
        for (const d of diags) {
          const a = active[d.k]; const at = a && shown.has(a.idx) ? a.idx : selected[0].idx;
          sink.out({ k: 'diag', line: d.line, ...(d.col ? { col: d.col } : {}), sev: d.sev, msg: d.msg }, at);
          if (d.sev === 'error') hasErr = true;
        }
        if (rest && (!res.ok || !diags.length)) sink.out({ k: res.ok ? 'warn' : 'err', s: rest + '\n' }, selected[0].idx);
      }
      if (!res.ok) {
        if (!res.compile) sink.out({ k: 'err', s: tr('The compiler returned no diagnostics.') + '\n' }, selected[0].idx);
        sink.status(tr('Compile error') + (res.provider ? ' · ' + res.provider : ''), 'error');
        return;
      }
      const sections = res.sections || [];
      selected.forEach((a, i) => {
        const s = sections[all ? i : 0] || {};
        if (s.stdout) sink.out({ k: 'text', s: s.stdout }, a.idx);
        if (s.stderr) sink.out({ k: 'err', s: s.stderr }, a.idx);
      });
      sink.status(`${tr('Exit')} ${res.exit ?? 0} · ${res.timeMs ?? 0}ms${res.provider ? ' · ' + res.provider : ''}${res.truncated ? ' · ' + tr('output truncated') : ''}`, 'result');
      void hasErr;
    } catch (e) {
      if (req.signal.aborted) return;
      const msg = timedOut ? tr('No response from the compile service within 25 s.') : (e as Error)?.message || tr('Compiler request failed.');
      sink.out({ k: 'err', s: msg + '\n' }, selected[0].idx);
      sink.status(msg, 'error');
    } finally {
      clearTimeout(timer);
      req.signal.removeEventListener('abort', onAbort);
    }
  }

  return {
    id: 'cpp', label: 'C++17', kernelDisplay: 'C++17', language: 'C++', mimetype: 'text/x-c++src',
    importAccept: '.cpp,.cc,.cxx,.h,.hpp,.ipynb,.notebook.zip',
    legacyStoreKey: (id) => `basmagi:nb:${id}:v1`,
    editor: { extensions: () => [cpp()], completions: cppCompletions({ codeSources: () => codeSources() }) },
    help: {
      intro: 'Shift+Enter runs the selected code cell and advances. Ctrl+Enter runs it in place. Earlier cells replay on each run; use const globals or //@global for shared declarations. A cell that uses cin asks for its own input when it runs.',
      items: [['Shared declarations', 'Earlier cells replay on each run. Use const globals or //@global for declarations shared between cells.', 'تُعاد الخلايا السابقة عند كل تشغيل؛ استخدم const أو //@global للمشاركة بين الخلايا.'],
        ['Input (cin)', 'A cell that reads cin shows an input box under it when it runs. Press Enter to submit.', 'الخلية التي تستخدم cin تعرض مربع إدخال أسفلها عند التشغيل. اضغط Enter للإرسال.']],
    },
    caps: { workspace: false, files: false, images: false, stdin: true, history: false },
    exportExt: '.cpp', kernel: 'xcpp17',
    run: (req, sink) => go(req, sink, false),
    runAll: (req, sink) => go(req, sink, true),
    attach(host) { codeSources = host.codeSources; },
    reset() {}, dispose() {},
  };
}
