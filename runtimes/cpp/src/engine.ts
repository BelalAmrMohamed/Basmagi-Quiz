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
  /** In-browser run stopped at a stdin read: `needCell` is the index (among code cells run) that wants input. */
  needInput?: boolean; needCell?: number;
};

/** Ctrl+D in the input box: end of input (EOF). */
const EOT = '\x04';
export type CppExecute = (r: { cells: Array<{ src: string; stdin?: string }>; target: number | 'all'; signal: AbortSignal }) => Promise<CppRunResponse>;
export type CppEngineOptions = {
  execute: CppExecute;
  lang?: 'en' | 'ar';
  timeoutMs?: number;
  /** Timeout for the in-browser compiler (default 120000). */
  localTimeoutMs?: number;
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
  'MB': 'م.ب',
  '⚡ Instant Compiler': '⚡ المترجم الفوري',
  '⚡ Local: Active': '⚡ محلي: نشط',
  'Download the instant in-browser C++ compiler ({size})': 'تحميل المترجم الفوري للـ C++ داخل المتصفح ({size})',
  'The instant local C++ compiler is installed and active': 'المترجم المحلي الفوري مثبت ونشط',
  'Instant C++ Local Compiler': 'المترجم المحلي الفوري للـ C++',
  'Compile and run C++ inside your browser, with no server in the way.': 'اترجم وشغّل كود C++ داخل المتصفح مباشرة، دون الاعتماد على أي خادم.',
  'one-time download': 'تحميل لمرة واحدة',
  'typical run time': 'زمن التشغيل المعتاد',
  'Offline': 'بدون إنترنت',
  'after the first download': 'بعد التحميل الأول',
  'Runs in about a second, with no server queue or network delay': 'يعمل خلال ثانية تقريباً دون طوابير خوادم أو تأخير في الشبكة',
  'Interactive input: your program pauses at cin and waits for you, like a real terminal': 'إدخال تفاعلي: يتوقف البرنامج عند cin وينتظر إدخالك كما في الطرفية الحقيقية',
  'Reads and writes text files (<fstream>) in the Current Folder': 'قراءة وكتابة الملفات النصية (<fstream>) في مجلد العمل الحالي',
  'Keeps working without an internet connection': 'يستمر في العمل دون اتصال بالإنترنت',
  'Good to know: ': 'من المفيد أن تعرف: ',
  'Programs that use C++ exceptions (try / catch / throw) are not supported by the local compiler, so they run on the cloud compiler automatically. The download ({size}) is stored in your browser and is not repeated on later visits.': 'البرامج التي تستخدم الاستثناءات (try / catch / throw) لا يدعمها المترجم المحلي، لذلك تُشغَّل تلقائياً على المترجم السحابي. التحميل ({size}) يُحفظ في المتصفح ولا يتكرر في الزيارات القادمة.',
  'The local compiler is installed and active.': 'المترجم المحلي مثبت ونشط.',
  'It uses about {size} of browser storage.': 'يستخدم حوالي {size} من مساحة تخزين المتصفح.',
  'Downloading…': 'جارٍ التحميل…',
  'Downloading {file}…': 'جارٍ تحميل {file}…',
  '{n}s left': 'متبقي {n} ث',
  'Starting download…': 'بدء التحميل…',
  'Cancel': 'إلغاء',
  'Close': 'إغلاق',
  'Done': 'تم',
  'Installed': 'مثبت',
  'Not installed': 'غير مثبت',
  'Not now': 'ليس الآن',
  'Download ({size})': 'تحميل ({size})',
  'Remove and free {size}': 'حذف وتحرير {size}',
  'Remove the local compiler?': 'حذف المترجم المحلي؟',
  'This frees about {size} of browser storage. C++ will run on the cloud compiler until you download it again.': 'سيحرر هذا حوالي {size} من مساحة المتصفح، وسيعمل C++ على المترجم السحابي إلى أن تحمّل المترجم المحلي مرة أخرى.',
  'Remove': 'حذف',
  'Local compiler removed. Now using the cloud compiler.': 'تم حذف المترجم المحلي، ويتم الآن استخدام المترجم السحابي.',
  'Instant compiler ready. C++ now runs right in your browser.': 'المترجم الفوري جاهز. يعمل C++ الآن مباشرة داخل المتصفح.',
  'Download cancelled.': 'تم إلغاء التحميل.',
  'Download failed: ': 'فشل التحميل: ',
  'The local compiler did not finish within 120 s.': 'لم يكتمل المترجم المحلي خلال 120 ثانية.',
  'Waiting for input…': 'بانتظار الإدخال…',
  'Using the cloud compiler (exceptions are not supported locally)': 'يتم استخدام المترجم السحابي (الاستثناءات غير مدعومة محلياً)',
  'Type here, then press Enter': 'اكتب هنا ثم اضغط Enter',
  'Enter to send · Ctrl+D ends input · Esc stops': 'Enter للإرسال · Ctrl+D لإنهاء الإدخال · Esc للإيقاف',
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
    // baseUrl is usually a site-relative path ("/assets/notebook-runtime-cpp/"); resolve it against the page first,
    // because `new URL(x, '/relative')` throws "Invalid base URL".
    const pageUrl = typeof location !== 'undefined' ? location.href : 'http://localhost/';
    const baseHref = new URL(o.baseUrl || './', pageUrl).href.replace(/\/?$/, '/');
    const workerUrl = new URL('worker.js', baseHref).href;
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

  /** Drop the worker (stuck run, Stop, timeout) so the next run starts a clean one. */
  const killWorker = () => { try { worker?.terminate(); } catch { /* ignore */ } worker = null; };

  /** Compile clang/lld in the background so the first Run doesn't pay for it. */
  const warmUp = async () => {
    try { if (await isWasmCached()) getWorker().postMessage({ t: 'warm' }); } catch { /* ignore */ }
  };
  void warmUp();

  async function go(req: RunRequest, sink: RunSink, all: boolean) {
    const active: Array<{ idx: number; cell: Cell }> = [];
    req.cells.forEach((cell, idx) => { if (cell.type === 'code' && cell.src.trim()) active.push({ idx, cell }); });
    const tIdx = req.target;
    if (!all && typeof tIdx === 'number' && !active.some((a) => a.idx === tIdx)) { sink.status(tr('Empty cell skipped')); return; }
    if (!active.length) return;
    const selected = all ? active : active.filter((a) => a.idx === tIdx);
    const stdins = new Map<number, string>();
    const isLocal = await isWasmCached();
    // Cloud compile can't pause for input, so it collects every cin answer up front. Local runs are interactive instead.
    const collectStdins = async (): Promise<boolean> => {
      for (const a of selected) {
        if (USES_CIN.test(a.cell.src) && !a.cell.stdinLocked && !stdins.has(a.idx)) {
          const n = req.cells.slice(0, a.idx + 1).filter((c) => c.type === 'code').length;
          const v = await sink.input({ label: tr('Standard input · Cell {n}').replace('{n}', String(n)), value: a.cell.stdin ?? '' }, a.idx);
          if (v === null) return false;
          stdins.set(a.idx, v);
        }
      }
      return true;
    };
    if (!isLocal && !(await collectStdins())) return;
    if (req.signal.aborted) return;
    sink.status(tr('Compiling…'), 'run');
    const ctrl = new AbortController();
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startTimer = (ms: number) => { clearTimeout(timer); timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, ms); };
    startTimer(timeoutMs);
    const onAbort = () => ctrl.abort();
    req.signal.addEventListener('abort', onAbort);

    try {
      const targetActive = all ? 'all' as const : active.findIndex((a) => a.idx === tIdx);
      let res: CppRunResponse;

      const emittedOut = new Map<number, number>(), emittedErr = new Map<number, number>();
      /** Print only what is new since the last flush; interactive runs replay the program, so output repeats. */
      const flush = (r: CppRunResponse) => {
        const secs = r.sections || [];
        selected.forEach((a, i) => {
          const sec = secs[all ? i : 0] || {};
          const so = sec.stdout || '', se = sec.stderr || '';
          const po = emittedOut.get(a.idx) || 0, pe = emittedErr.get(a.idx) || 0;
          if (so.length > po) { sink.out({ k: 'text', s: so.slice(po) }, a.idx); emittedOut.set(a.idx, so.length); }
          if (se.length > pe) { sink.out({ k: 'err', s: se.slice(pe) }, a.idx); emittedErr.set(a.idx, se.length); }
        });
      };

      if (isLocal) {
        const localMs = o.localTimeoutMs ?? 120000;
        const workspaceFileList = Array.from(files.entries()).map(([name, f]) => ({
          name,
          content: f.text ?? (f.data ? new TextDecoder().decode(f.data) : ''),
        }));
        const live = new Set(selected.filter((a) => USES_CIN.test(a.cell.src) && !a.cell.stdinLocked).map((a) => a.idx));
        const cellsPayload = active.map((a) => ({ src: a.cell.src, stdin: a.cell.stdin ?? '', live: live.has(a.idx) }));

        const callWorker = (extra: Record<string, unknown>) => new Promise<CppRunResponse>((resolve, reject) => {
          const w = getWorker();
          const runId = Math.random().toString(36).slice(2);
          const cleanup = () => { w.removeEventListener('message', handler); ctrl.signal.removeEventListener('abort', onAb); };
          const handler = (e: MessageEvent) => {
            const m = e.data;
            if (!m || m.t !== 'done' || m.id !== runId) return;
            cleanup();
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
          };
          const onAb = () => { cleanup(); killWorker(); reject(new Error('Aborted')); };
          w.addEventListener('message', handler);
          ctrl.signal.addEventListener('abort', onAb, { once: true });
          w.postMessage({ t: 'run', id: runId, cells: cellsPayload, target: targetActive, files: workspaceFileList, ...extra });
        });

        let typed = '', eof = false;
        const asked = new Set<number>();
        res = undefined as unknown as CppRunResponse;
        for (let round = 0; round < 2000; round++) {
          startTimer(localMs);
          res = await callWorker({ live: live.size > 0, liveStdin: typed, eof });
          clearTimeout(timer); // never count the time the learner spends typing
          if (!res.ok || !res.needInput) break;
          flush(res);
          const a = all ? selected[res.needCell ?? 0] : selected[0];
          if (!a || !live.has(a.idx)) { eof = true; continue; }
          sink.status(tr('Waiting for input…'), 'run');
          const v = await sink.input({ inline: true, first: !asked.has(a.idx) }, a.idx);
          if (v === null || req.signal.aborted) return;
          asked.add(a.idx);
          if (v === EOT) eof = true; else typed += v.endsWith('\n') ? v : v + '\n';
          sink.status(tr('Running…'), 'run');
        }
        // The in-browser clang has exceptions disabled: hand such programs to the cloud compiler instead of failing.
        if (!res.ok && /exceptions disabled/.test(res.compile || '')) {
          sink.status(tr('Using the cloud compiler (exceptions are not supported locally)'), 'run');
          clearTimeout(timer);
          if (!(await collectStdins())) return;
          startTimer(timeoutMs);
          res = await o.execute({
            cells: active.map((a) => ({ src: a.cell.src, stdin: stdins.get(a.idx) ?? a.cell.stdin ?? '' })),
            target: targetActive, signal: ctrl.signal,
          });
        }
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
      flush(res);
      sink.status(`${tr('Exit')} ${res.exit ?? 0} · ${res.timeMs ?? 0}ms${res.provider ? ' · ' + res.provider : ''}${res.truncated ? ' · ' + tr('output truncated') : ''}`, 'result');
      void hasErr;
    } catch (e) {
      if (req.signal.aborted) return;
      const msg = timedOut ? (await isWasmCached() ? tr('The local compiler did not finish within 120 s.') : tr('No response from the compile service within 25 s.')) : (e as Error)?.message || tr('Compiler request failed.');
      sink.out({ k: 'err', s: msg + '\n' }, selected[0].idx);
      sink.status(msg, 'error');
    } finally {
      clearTimeout(timer);
      req.signal.removeEventListener('abort', onAbort);
    }
  }

  const engine: Engine & { setWasmMode: (on: boolean) => void } = {
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
    setWasmMode: (on: boolean) => { if (on) void warmUp(); },
    dispose() {
      if (worker) {
        worker.terminate();
        worker = null;
      }
    },
  };
  return engine;
}
