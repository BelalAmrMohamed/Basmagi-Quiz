// =============================================================================
// runtimes/cpp/src/engine.ts
// C++ engine for the shared notebook UI. Supports both fast local compilation via
// Wasm-Clang (when downloaded) and fallback to the cpp-run Supabase Edge Function.
// Stdin is asked inline, Jupyter style, through sink.input().
// =============================================================================
import { cpp } from '@codemirror/lang-cpp';
import { cppCompletions } from './completions';
import { cppLint } from './lint';
import { cellRuns } from './assemble';
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
  /** The program crashed: what kind, and which cell (index among the cells run) was executing. */
  trap?: 'stack' | 'oob' | 'div0' | 'abort' | 'badcall' | 'oom'; crashCell?: number;
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
  'Cell {n}: ': 'الخلية {n}: ',
  'Still running… if nothing happens, your program may be in an infinite loop. Press Stop to cancel.': 'ما زال يعمل… إذا لم يظهر شيء فقد يكون برنامجك في حلقة لا نهائية. اضغط إيقاف للإلغاء.',
  'The program crashed: too much recursion (stack overflow). Check that your recursive function has a base case that stops it.': 'تعطّل البرنامج: تكرار ذاتي مفرط (فيض المكدس). تأكد أن الدالة العودية لها حالة أساسية توقفها.',
  'The program crashed: it touched memory that is not its own. This is usually an array index out of range, a bad pointer, or endless recursion.': 'تعطّل البرنامج: حاول الوصول إلى ذاكرة لا تخصه. السبب غالباً فهرس مصفوفة خارج النطاق أو مؤشر خاطئ أو تكرار ذاتي لا ينتهي.',
  'The program crashed: division by zero.': 'تعطّل البرنامج: قسمة على صفر.',
  'The program stopped itself (abort or an unreachable path). A function that must return a value may have reached its end without returning.': 'أوقف البرنامج نفسه (abort أو مسار غير قابل للوصول). ربما وصلت دالة تُرجع قيمة إلى نهايتها دون return.',
  'The program crashed: it called a function through an invalid pointer.': 'تعطّل البرنامج: استدعى دالة عبر مؤشر غير صالح.',
  'The program ran out of memory. Check for an endless loop that keeps adding data, or a very large array.': 'نفدت ذاكرة البرنامج. تحقق من حلقة لا تنتهي تضيف بيانات باستمرار أو مصفوفة ضخمة جداً.',
  "'{n}' is declared but never defined. Define it in this cell or in an earlier cell that runs with it.": "'{n}' معرَّف (تصريح فقط) لكن دون تعريف فعلي. عرّفه في هذه الخلية أو في خلية سابقة تعمل معها.",
  'A statement is missing its ending semicolon (;). Check the end of the line shown, or the line before it.': 'تعليمة ينقصها الفاصلة المنقوطة (;) في نهايتها. تحقق من نهاية السطر الظاهر أو السطر الذي قبله.',
  "'{n}' comes from the standard library: add the matching #include (<iostream> for cout and cin, <string> for string, <vector> for vector, <fstream> for files) and write using namespace std; or use the std:: prefix.": "'{n}' من المكتبة القياسية: أضف الـ #include المناسب (<iostream> لـ cout وcin، <string> لـ string، <vector> لـ vector، <fstream> للملفات) واكتب using namespace std; أو استخدم البادئة std::.",
  "'{n}' is not declared at this point. Check the spelling, declare it before using it (a forward declaration such as int f(int); works), and make sure the cell that declares it is above this one.": "'{n}' غير معرَّف عند هذه النقطة. تحقق من الإملاء وعرّفه قبل استخدامه (يصلح تصريح مسبق مثل int f(int);) وتأكد أن الخلية التي تعرّفه فوق هذه الخلية.",
  "'{n}' is not a known type. Check the spelling or add the #include that provides it.": "'{n}' ليس نوعاً معروفاً. تحقق من الإملاء أو أضف الـ #include الذي يوفره.",
  'std::{n} needs its header: add the matching #include.': 'std::{n} يحتاج إلى ملف الترويسة الخاص به: أضف الـ #include المناسب.',
  "'{n}' is defined twice. Earlier cells replay on every run, so two cells cannot define the same name.": "'{n}' معرَّف مرتين. الخلايا السابقة تُعاد عند كل تشغيل، لذلك لا يمكن لخليتين تعريف الاسم نفسه.",
  'The operator does not fit these types. Use cout << value to print and cin >> variable to read.': 'المعامل لا يناسب هذه الأنواع. استخدم cout << قيمة للطباعة وcin >> متغير للقراءة.',
  'An expression is incomplete here. Check for a missing value, operator or closing bracket.': 'التعبير غير مكتمل هنا. تحقق من قيمة أو معامل أو قوس إغلاق ناقص.',
  'A function that returns a value must return on every path. Add a return statement at the end.': 'الدالة التي تُرجع قيمة يجب أن تُرجع في كل المسارات. أضف return في نهايتها.',
  'Give the variable a value before reading it, for example int x = 0;': 'أعطِ المتغير قيمة قبل قراءته، مثلاً int x = 0;',
  "The call has a different number of arguments than the function expects. Check the function's declaration.": 'عدد المعاملات في الاستدعاء يختلف عما تتوقعه الدالة. راجع تصريح الدالة.',
  "No version of '{n}' accepts these arguments. Check how many there are and their types.": "لا توجد نسخة من '{n}' تقبل هذه المعاملات. تحقق من عددها وأنواعها.",
  'A bracket is not closed. Count your ( ) { } [ ] pairs.': 'يوجد قوس غير مغلق. عُدّ أزواج ( ) { } [ ].',
  "The value's type does not match the variable's type.": 'نوع القيمة لا يطابق نوع المتغير.',
  'main must return int: write int main() instead of void main().': 'يجب أن تُرجع main قيمة int: اكتب int main() بدلاً من void main().',
  'Upload text files': 'رفع ملفات نصية',
  'No files yet. Upload a text file to get started.': 'لا توجد ملفات بعد. ارفع ملفاً نصياً للبدء.',
};

const USES_CIN = /(?:\bstd\s*::\s*)?\bcin\b/;
const DIAG = /cell-(\d+):(\d+)(?::(\d+))?:\s*(fatal error|error|warning|note)\s*:\s*(.*)/;
const GENERATED = /^\d+ (warnings?|errors?)( and \d+ (warnings?|errors?))? generated\.?$/;

export type CompileDiag = { k: number; line: number; col?: number; sev: 'error' | 'warning'; msg: string; detail?: string };

/** Show the learner's code, not the assembled program (a cell's `main` is renamed internally, and a `return 0;` is added). */
const tidy = (x: string) => x.replace(/\s*return 0;\/\*nb\*\/\s*/g, ' ').replace(/__nb_main_\d+/g, 'main');

/**
 * Turn gcc/clang output into diagnostics keyed by active-list cell (0-based). The source line, caret and notes that clang
 * prints under a message stay attached to it as `detail`; text that belongs to no diagnostic (linker errors) is returned as `rest`.
 */
export function parseCompile(text: string): { diags: CompileDiag[]; rest: string } {
  const diags: CompileDiag[] = [];
  const rest: string[] = [];
  let cur: CompileDiag | null = null;
  const addDetail = (ln: string) => { if (cur) cur.detail = cur.detail ? cur.detail + '\n' + ln : ln; };
  for (const raw of text.split('\n')) {
    const ln = tidy(raw);
    const m = DIAG.exec(ln);
    if (m) {
      if (m[4] === 'note') { addDetail(`note: ${m[5]}`); continue; }
      cur = { k: Number(m[1]) - 1, line: Number(m[2]), ...(m[3] ? { col: Number(m[3]) } : {}), sev: m[4] === 'warning' ? 'warning' : 'error', msg: m[5] };
      diags.push(cur);
    } else if (GENERATED.test(ln.trim()) || /^fatal error: too many errors/.test(ln.trim())) {
      cur = null;
    } else if (ln.trim()) {
      if (cur) addDetail(ln.replace(/\s+$/, '')); else rest.push(ln);
    }
  }
  for (const d of diags) if (d.detail) d.detail = d.detail.split('\n').slice(0, 8).join('\n');
  return { diags, rest: rest.join('\n') };
}

/** Plain-language explanations of the compiler messages beginners hit most. `{n}` is the identifier from the message. */
const HINTS: Array<[RegExp, string]> = [
  [/expected ';'/, 'A statement is missing its ending semicolon (;). Check the end of the line shown, or the line before it.'],
  [/use of undeclared identifier '((?:cout|cin|cerr|endl|string|getline|vector|map|set|pair|sort|ifstream|ofstream|fstream|stringstream|setw|setprecision|sqrt|pow|abs|min|max|swap|to_string|stoi|stod))'/, "'{n}' comes from the standard library: add the matching #include (<iostream> for cout and cin, <string> for string, <vector> for vector, <fstream> for files) and write using namespace std; or use the std:: prefix."],
  [/use of undeclared identifier '([^']+)'/, "'{n}' is not declared at this point. Check the spelling, declare it before using it (a forward declaration such as int f(int); works), and make sure the cell that declares it is above this one."],
  [/unknown type name '([^']+)'/, "'{n}' is not a known type. Check the spelling or add the #include that provides it."],
  [/no (?:member|type) named '([^']+)' in namespace 'std'/, 'std::{n} needs its header: add the matching #include.'],
  [/redefinition of '([^']+)'/, "'{n}' is defined twice. Earlier cells replay on every run, so two cells cannot define the same name."],
  [/invalid operands to binary expression/, 'The operator does not fit these types. Use cout << value to print and cin >> variable to read.'],
  [/expected expression/, 'An expression is incomplete here. Check for a missing value, operator or closing bracket.'],
  [/control reaches end of non-void function|non-void function does not return a value/, 'A function that returns a value must return on every path. Add a return statement at the end.'],
  [/variable '[^']+' is uninitialized/, 'Give the variable a value before reading it, for example int x = 0;'],
  [/too (?:few|many) arguments to (?:function|constructor)/, "The call has a different number of arguments than the function expects. Check the function's declaration."],
  [/no matching function for call to '([^']+)'/, "No version of '{n}' accepts these arguments. Check how many there are and their types."],
  [/expected '[})\]]'|expected '\)'|extraneous closing brace/, 'A bracket is not closed. Count your ( ) { } [ ] pairs.'],
  [/no viable conversion|cannot initialize a (?:variable|parameter) of type/, "The value's type does not match the variable's type."],
  [/'main' must return 'int'/, 'main must return int: write int main() instead of void main().'],
];

/** The hint for a compiler message, translated with `translate` (identity for English). */
export const explain = (msg: string, translate: (s: string) => string = (x) => x): string | undefined => {
  for (const [re, template] of HINTS) {
    const m = re.exec(msg);
    if (m) return translate(template).replace('{n}', m[1] ?? '');
  }
  return undefined;
};

const TRAPS: Record<NonNullable<CppRunResponse['trap']>, string> = {
  stack: 'The program crashed: too much recursion (stack overflow). Check that your recursive function has a base case that stops it.',
  oob: 'The program crashed: it touched memory that is not its own. This is usually an array index out of range, a bad pointer, or endless recursion.',
  div0: 'The program crashed: division by zero.',
  abort: 'The program stopped itself (abort or an unreachable path). A function that must return a value may have reached its end without returning.',
  badcall: 'The program crashed: it called a function through an invalid pointer.',
  oom: 'The program ran out of memory. Check for an endless loop that keeps adding data, or a very large array.',
};

/** Text for a file every C++ notebook starts with, so reading a file works without uploading one first. */
const DEFAULT_FILES: Array<{ name: string; text: string }> = [
  { name: 'test.txt', text: 'Hello World\nWelcome to C++ file input and output!\nRead me with ifstream, line by line.\n42 3.14 Basmagi\n' },
];

export function createCppEngine(o: CppEngineOptions): Engine {
  // Filled in by the shell through attach(); completions read it lazily on every keystroke.
  let codeSources: () => string[] = () => [];
  const tr = (s: string) => (o.lang === 'ar' && CPP_AR[s]) || s;
  const timeoutMs = o.timeoutMs ?? 25000;
  const files = new Map<string, any>();
  for (const f of DEFAULT_FILES) {
    const data = new TextEncoder().encode(f.text);
    files.set(f.name, { filename: '/vfs/' + f.name, fileSize: data.length, data, text: f.text, isText: true, builtin: true });
  }
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
    // A cell reads input when it runs code and `cin` appears anywhere in the program being built: a function that reads input
    // can be defined in this cell, an earlier one, or (with a forward declaration) a later one.
    const inProgram = all ? active : active.filter((b) => typeof tIdx === 'number' && b.idx <= tIdx);
    const needsCin = (a: { idx: number; cell: Cell }) => !a.cell.stdinLocked && cellRuns(a.cell.src) && inProgram.some((b) => USES_CIN.test(b.cell.src));
    const collectStdins = async (): Promise<boolean> => {
      for (const a of selected) {
        if (needsCin(a) && !stdins.has(a.idx)) {
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
        const live = new Set(selected.filter(needsCin).map((a) => a.idx));
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
          const loopNotice = setTimeout(() => sink.status(tr('Still running… if nothing happens, your program may be in an infinite loop. Press Stop to cancel.'), 'run'), 5000);
          try { res = await callWorker({ live: live.size > 0, liveStdin: typed, eof }); } finally { clearTimeout(loopNotice); }
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
      const codeNo = (idx: number) => req.cells.slice(0, idx + 1).filter((c) => c.type === 'code').length;
      if (res.compile) {
        const { diags, rest } = parseCompile(res.compile);
        for (const d of diags) {
          const a = active[d.k];
          const mine = !!a && shown.has(a.idx);
          // An earlier cell replays with this one: its warnings were shown when it ran, but its errors still block this run.
          if (!mine && d.sev === 'warning') continue;
          const hint = explain(d.msg, tr);
          sink.out({ k: 'diag', line: d.line, ...(d.col ? { col: d.col } : {}), sev: d.sev, msg: d.msg, ...(d.detail ? { detail: d.detail } : {}), ...(hint ? { hint } : {}), ...(mine || !a ? {} : { cell: codeNo(a.idx) }) }, mine ? a.idx : selected[0].idx);
        }
        if (rest && (!res.ok || !diags.length)) {
          for (const ln of rest.split('\n')) {
            const und = /undefined symbol: ([A-Za-z_]\w*)/.exec(ln);
            const text = und ? `${ln}\n💡 ${tr("'{n}' is declared but never defined. Define it in this cell or in an earlier cell that runs with it.").replace('{n}', und[1])}` : ln;
            sink.out({ k: res.ok ? 'warn' : 'err', s: text + '\n' }, selected[0].idx);
          }
        }
      }
      if (!res.ok) {
        if (!res.compile) sink.out({ k: 'err', s: tr('The compiler returned no diagnostics.') + '\n' }, selected[0].idx);
        sink.status(tr('Compile error') + (res.provider ? ' · ' + res.provider : ''), 'error');
        return;
      }
      flush(res);
      if (res.trap) {
        const at = all ? selected[Math.min(res.crashCell ?? 0, selected.length - 1)] : selected[0];
        sink.out({ k: 'err', s: '💥 ' + tr(TRAPS[res.trap]) + '\n' }, at.idx);
      }
      sink.status(`${tr('Exit')} ${res.exit ?? 0} · ${res.timeMs ?? 0}ms${res.provider ? ' · ' + res.provider : ''}${res.truncated ? ' · ' + tr('output truncated') : ''}`, 'result');
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
