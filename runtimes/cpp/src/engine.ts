// =============================================================================
// runtimes/cpp/src/engine.ts
// C++ engine for the shared notebook UI. Supports both fast local compilation via
// Wasm-Clang (when downloaded) and fallback to the cpp-run Supabase Edge Function.
// Stdin is asked inline, Jupyter style, through sink.input().
// =============================================================================
import { cpp } from '@codemirror/lang-cpp';
import { cppCompletions } from './completions';
import { cppLint } from './lint';
import { isWasmCached } from './wasm-cache';
import { attachWasmDialog } from '../../shared/wasm-dialog';
import type { Engine, Cell, RunRequest, RunSink } from '../../shared/engine';
import type { Ctx } from '../../shared/ctx';

export type CppRunResponse = {
  ok: boolean; compile?: string; sections?: Array<{ stdout?: string; stderr?: string }>;
  exit?: number; timeMs?: number; provider?: string; truncated?: boolean;
  files?: Array<{ name: string; content: string }>;
};
export type CppExecute = (r: { cells: Array<{ src: string; stdin?: string }>; target: number | 'all'; signal: AbortSignal }) => Promise<CppRunResponse>;
export type CppEngineOptions = {
  execute: CppExecute;
  lang?: 'en' | 'ar';
  timeoutMs?: number;
  baseUrl?: string;
  createWorker?: (workerUrl: string) => Worker;
};

export const CPP_AR: Record<string, string> = {
  'Compiling…': 'جارٍ التجميع…',
  'Syntax error': 'خطأ في الصياغة',
  'Compile error': 'خطأ في التجميع',
  'Exit': 'الخروج',
  'Empty cell skipped': 'تم تجاوز الخلية الفارغة',
  'Compiler request failed.': 'فشل طلب المترجم.',
  'No response from the compile service within 25 s.': 'لم تصل أي استجابة من خدمة التجميع خلال 25 ثانية.',
  'The compiler returned no diagnostics.': 'لم يُرجع المترجم أي رسائل.',
  'output truncated': 'تم اقتطاع المخرجات',
  'Compiler messages': 'رسائل المترجم',
  'Standard input · Cell {n}': 'الإدخال القياسي · الخلية {n}',
  '⚡ 20MB Fast Compiler': '⚡ المترجم السريع (20م.ب)',
  'Download fast offline C++ compiler (~20MB)': 'تحميل مترجم C++ السريع للعمل بدون إنترنت (~20 م.ب)',
  'Instant C++ Local Compiler': 'المترجم المحلي السريع للـ C++',
  '~20 MB · One-time download': '~20 م.ب · لمرة واحدة فقط',
  'One-time download: ': 'تحميل لمرة واحدة: ',
  'Downloads the Clang compiler (~20 MB) once into your browser cache. Once finished, C++ code compiles instantly (~300ms) right on your machine, 100% offline, with zero server delays. It will not download again on future visits.':
    'يقوم بتحميل مترجم Clang (~20 م.ب) لمرة واحدة فقط في ذاكرة المتصفح. بعد اكتمال التحميل، سيعمل كود C++ بسرعة فائقة (~300 مللي ثانية) مباشرة على جهازك وبدون إنترنت ودون أي انتظار للخوادم السحابية. لن يُعاد تحميله مرة أخرى في الزيارات القادمة.',
  'Sub-second execution (~200–400ms) without server queues': 'تنفيذ فوري خلال أجزاء من الثانية دون طوابير انتظار الخوادم',
  'Full support for C++ Fundamentals & Object-Oriented Programming (OOP)': 'دعم كامل لأساسيات البرمجة والبرمجة الكائنية (OOP)',
  'Text file reading and writing (<fstream>) with the Current Folder workspace': 'قراءة وكتابة الملفات النصية (<fstream>) في مجلد العمل الحالي',
  'Works 100% offline without internet connection': 'يعمل بنسبة 100% دون الحاجة إلى اتصال بالإنترنت',
  'Ready to download': 'جاهز للتحميل',
  'Starting download…': 'بدء التحميل…',
  'Cancel': 'إلغاء',
  'Close': 'إغلاق',
  'Installed': 'مثبت',
  'Delete & Free 20 MB': 'حذف وتحرير 20 م.ب',
  'Download Fast Compiler (~20MB)': 'تحميل المترجم السريع (~20 م.ب)',
  'Keep Cloud Compiler (0 MB)': 'البقاء على المترجم السحابي (0 م.ب)',
  'Are you sure you want to remove the local C++ compiler and free up ~20MB of browser cache?': 'هل أنت متأكد من رغبتك في حذف المترجم المحلي وتحرير ~20 م.ب من ذاكرة المتصفح؟',
  'Local compiler removed. Now using Cloud Compiler.': 'تم حذف المترجم المحلي بنجاح، ويتم الآن استخدام المترجم السحابي.',
  'Fast local C++ compiler ready! Code will now compile instantly.': 'المترجم السريع جاهز الآن! سيتم تشغيل الكود فورياً.',
  'Download cancelled.': 'تم إلغاء التحميل.',
  'Download failed: ': 'فشل التحميل: ',
  '⚡ Local: Active': '⚡ محلي: نشط',
  'Fast local C++ compiler is installed and active': 'المترجم المحلي السريع مثبت ونشط',
  'Upload text files': 'رفع ملفات نصية',
  'No files yet. Upload a text file to get started.': 'لا توجد ملفات بعد. ارفع ملفاً نصياً للبدء.',
};

const USES_CIN = /(?:\bstd\s*::\s*)?\bcin\b/;
const DIAG = /cell-(\d+):(\d+)(?::(\d+))?:\s*(fatal error|error|warning)\s*:\s*(.*)/;

/** Turn gcc/clang output into diagnostics keyed by active-list cell (0-based). Unmatched text is returned as `rest`. */
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
  const files = new Map<string, any>();
  let worker: Worker | null = null;

  const getWorker = (): Worker => {
    if (worker) return worker;
    const workerUrl = new URL('worker.js', o.baseUrl || (typeof location !== 'undefined' ? location.href : 'http://localhost/')).href;
    if (o.createWorker) {
      worker = o.createWorker(workerUrl);
    } else {
      try {
        worker = new Worker(workerUrl);
      } catch {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', workerUrl, false);
        xhr.send();
        worker = new Worker(URL.createObjectURL(new Blob([xhr.responseText], { type: 'text/javascript' })));
      }
    }
    return worker;
  };

  async function go(req: RunRequest, sink: RunSink, all: boolean) {
    const active: Array<{ idx: number; cell: Cell }> = [];
    req.cells.forEach((cell, idx) => { if (cell.type === 'code' && cell.src.trim()) active.push({ idx, cell }); });
    const tIdx = req.target;
    if (!all && typeof tIdx === 'number' && !active.some((a) => a.idx === tIdx)) { sink.status(tr('Empty cell skipped')); return; }
    if (!active.length) return;
    const selected = all ? active : active.filter((a) => a.idx === tIdx);
    const stdins = new Map<number, string>();
    for (const a of selected) {
      if (USES_CIN.test(a.cell.src) && !a.cell.stdinLocked) {
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
      let res: CppRunResponse;

      const isLocal = await isWasmCached();
      if (isLocal) {
        const w = getWorker();
        const runId = Math.random().toString(36).slice(2);
        const workspaceFileList = Array.from(files.entries()).map(([name, f]) => ({
          name,
          content: f.text ?? (f.data ? new TextDecoder().decode(f.data) : ''),
        }));

        res = await new Promise<CppRunResponse>((resolve, reject) => {
          const handler = (e: MessageEvent) => {
            const m = e.data;
            if (m && m.t === 'done' && m.id === runId) {
              w.removeEventListener('message', handler);
              if (Array.isArray(m.result?.files)) {
                for (const rf of m.result.files) {
                  if (!files.has(rf.name) || files.get(rf.name)?.text !== rf.content) {
                    files.set(rf.name, {
                      filename: '/vfs/' + rf.name,
                      fileSize: rf.content.length,
                      data: new TextEncoder().encode(rf.content),
                      text: rf.content,
                      isText: true,
                    });
                    sink.files?.();
                  }
                }
              }
              resolve(m.result);
            }
          };
          w.addEventListener('message', handler);
          ctrl.signal.addEventListener('abort', () => {
            w.removeEventListener('message', handler);
            reject(new Error('Aborted'));
          }, { once: true });

          w.postMessage({
            t: 'run',
            id: runId,
            cells: active.map((a) => ({ src: a.cell.src, stdin: stdins.get(a.idx) ?? a.cell.stdin ?? '' })),
            target: targetActive,
            files: workspaceFileList,
          });
        });
      } else {
        res = await o.execute({
          cells: active.map((a) => ({ src: a.cell.src, stdin: stdins.get(a.idx) ?? a.cell.stdin ?? '' })),
          target: targetActive, signal: ctrl.signal,
        });
      }

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
    editor: { extensions: () => [cpp()], completions: cppCompletions({ codeSources: () => codeSources() }), lint: cppLint(tr('Syntax error')) },
    help: {
      intro: 'Shift+Enter runs the selected code cell and advances. Ctrl+Enter runs it in place. Earlier cells replay on each run; use const globals or //@global for shared declarations. A cell that uses cin asks for its own input when it runs.',
      items: [['Shared declarations', 'Earlier cells replay on each run. Use const globals or //@global for declarations shared between cells.', 'تُعاد الخلايا السابقة عند كل تشغيل؛ استخدم const أو //@global للمشاركة بين الخلايا.'],
        ['Input (cin)', 'A cell that reads cin shows an input box under it when it runs. Press Enter to submit.', 'الخلية التي تستخدم cin تعرض مربع إدخال أسفلها عند التشغيل. اضغط Enter للإرسال.']],
    },
    caps: { workspace: false, files: true, images: false, stdin: true, history: false },
    files,
    async addFile(f: File) {
      const text = await f.text();
      files.set(f.name, {
        filename: '/vfs/' + f.name,
        fileSize: f.size,
        data: new TextEncoder().encode(text),
        text,
        isText: true,
      });
    },
    removeFile(name: string) {
      files.delete(name);
    },
    renameFile(from: string, to: string) {
      const v = files.get(from);
      if (v) {
        files.delete(from);
        files.set(to, v);
      }
    },
    toolbarExtra: (ctx: Ctx) => attachWasmDialog(ctx),
    exportExt: '.cpp', kernel: 'xcpp17',
    run: (req, sink) => go(req, sink, false),
    runAll: (req, sink) => go(req, sink, true),
    attach(host) { codeSources = host.codeSources; },
    reset() {},
    dispose() {
      if (worker) {
        worker.terminate();
        worker = null;
      }
    },
  };
}
