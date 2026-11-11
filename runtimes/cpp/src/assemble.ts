// =============================================================================
// runtimes/cpp/src/assemble.ts
// Reusable C++ multi-cell notebook code assembler and section splitter.
// =============================================================================

const CONTROL = /^(if|for|while|switch|do|try|else|catch)$/;

export interface SplitPart {
  text: string;
  line: number;
}

export function splitCell(src: string): SplitPart[] {
  const s = String(src || '');
  const out: SplitPart[] = [];
  let start = 0, i = 0, par = 0, br = 0, curl = 0;
  let quote = '', lineComment = false, blockComment = false, rawEnd = '';

  const push = (end: number) => {
    const raw = s.slice(start, end);
    const text = raw.trim();
    if (text) {
      let p = start;
      while (p < end) {
        if (/\s/.test(s[p])) { p++; continue; }
        if (s.startsWith('//', p)) { const nl = s.indexOf('\n', p); p = nl < 0 ? end : nl + 1; continue; }
        if (s.startsWith('/*', p)) { const close = s.indexOf('*/', p + 2); p = close < 0 ? end : close + 2; continue; }
        break;
      }
      out.push({ text, line: s.slice(0, p).split('\n').length });
    }
    start = end;
  };

  while (i < s.length) {
    const c = s[i], n = s[i + 1];
    if (!quote && !lineComment && !blockComment && !rawEnd && c === '#' && s.slice(s.lastIndexOf('\n', i - 1) + 1, i).trim() === '') {
      let end = s.indexOf('\n', i);
      if (end < 0) end = s.length;
      while (end < s.length && /\\\s*$/.test(s.slice(i, end))) {
        const next = s.indexOf('\n', end + 1);
        end = next < 0 ? s.length : next;
      }
      push(end);
      start = end < s.length ? end + 1 : end;
      i = start;
      continue;
    }
    if (lineComment) { if (c === '\n') lineComment = false; i++; continue; }
    if (blockComment) { if (c === '*' && n === '/') { blockComment = false; i += 2; } else i++; continue; }
    if (rawEnd) { if (s.startsWith(rawEnd, i)) { i += rawEnd.length; rawEnd = ''; } else i++; continue; }
    if (quote) { if (c === '\\') { i += 2; continue; } if (c === quote) quote = ''; i++; continue; }
    if (c === '/' && n === '/') { lineComment = true; i += 2; continue; }
    if (c === '/' && n === '*') { blockComment = true; i += 2; continue; }
    const raw = s.slice(i).match(/^(?:u8|u|U|L)?R"([^ ()\\\t\r\n]{0,16})\(/);
    if (raw) { rawEnd = ')' + raw[1] + '"'; i += raw[0].length; continue; }
    if (c === '"' || c === "'") { quote = c; i++; continue; }
    if (c === '(') par++;
    else if (c === ')') par = Math.max(0, par - 1);
    else if (c === '[') br++;
    else if (c === ']') br = Math.max(0, br - 1);
    else if (c === '{') curl++;
    else if (c === '}') {
      curl = Math.max(0, curl - 1);
      if (!par && !br && !curl) {
        let j = i + 1;
        while (/\s/.test(s[j] || '')) j++;
        if (s[j] === '{' || (/^while\b/.test(s.slice(j)) && /^\s*do\b/.test(s.slice(start, i + 1)))) {
          // loop block
        } else {
          if (s[j] === ';') i = j;
          push(i + 1);
        }
      }
    } else if (c === ';' && !par && !br && !curl) {
      push(i + 1);
    }
    i++;
  }
  if (start < s.length) push(s.length);
  return out;
}

/** Drop balanced <...> groups so `vector<vector<int>>` reads as a plain word. */
const stripGenerics = (t: string) => { let p = ''; while (p !== t) { p = t; t = t.replace(/<[^<>()]*>/g, 'T'); } return t; };

/** Split on commas that are not inside (), [], {} or <>. */
function splitParams(inner: string): string[] {
  const out: string[] = []; let depth = 0, cur = '';
  for (const c of inner) {
    if ('([{<'.includes(c)) depth++;
    else if (')]}>'.includes(c)) depth = Math.max(0, depth - 1);
    if (c === ',' && !depth) { out.push(cur.trim()); cur = ''; } else cur += c;
  }
  if (cur.trim() || out.length) out.push(cur.trim());
  return out;
}

const BUILTIN = '(?:unsigned|signed|long|short|int|char|bool|float|double|void|size_t|string|auto|wchar_t)';
/** One parameter of a function prototype: `int`, `const string& s`, `vector<int>& v`, `double x = 2.0`, `int a[]`, `Point p`. */
const PARAM = new RegExp(
  '^(?:const\\s+|volatile\\s+)*(?:' +
    '(?:std::)?' + BUILTIN + '\\b(?:\\s+' + BUILTIN + '\\b)*' +                    // builtin or std::string
    '|[A-Za-z_]\\w*(?:::\\w+)*\\s*<[^()]*>' +                                      // templated: vector<int>
    '|[A-Za-z_]\\w*(?:::\\w+)*(?=\\s*[&*]|\\s+(?:const\\b\\s*)?[&*]*\\s*[A-Za-z_]\\w*\\s*(?:\\[[^\\]]*\\])*\\s*(?:=.*)?$)' + // Point& / Point p
  ')\\s*(?:const\\b\\s*)?[&*]*\\s*(?:const\\b\\s*)?[&*]*\\s*(?:[A-Za-z_]\\w*)?\\s*(?:\\[[^\\]]*\\]\\s*)*(?:=.*)?$',
  's');

/**
 * A function prototype (forward declaration) such as `string getName();` or `int add(int a, int b);`.
 * It must be hoisted to the global section, otherwise it becomes a local declaration inside main and the
 * definition in another cell never sees it. Constructor-style variable definitions (`Point p(3, 4);`,
 * `vector<int> v(n);`) and calls (`foo(x);`) are NOT prototypes.
 */
export function isPrototype(text: string): boolean {
  const t = text.trim();
  if (!t.endsWith(';') || /[{}]/.test(t)) return false;
  const open = t.indexOf('(');
  if (open < 1) return false;
  let depth = 0, close = -1;
  for (let i = open; i < t.length; i++) {
    if (t[i] === '(') depth++;
    else if (t[i] === ')' && --depth === 0) { close = i; break; }
  }
  if (close < 0) return false;
  const head = stripGenerics(t.slice(0, open)).trim();
  const tail = t.slice(close + 1).replace(/;\s*$/, '').trim();
  if (/[=.<>!+\-/%|^?]|->|\bnew\b|\bdelete\b|\breturn\b|\bthrow\b|\bgoto\b|\bcase\b|\belse\b|\bsizeof\b/.test(head.replace(/operator\s*\S+/, 'operator'))) return false;
  if (tail && !/^(?:const|noexcept|override|final|volatile|\s|->\s*[\w:<>,&*\s]+|=\s*(?:0|default|delete))+$/.test(tail)) return false;
  // return type + name (two or more words, or a type with & / * before the name)
  if (!/^(?:(?:static|inline|extern|constexpr|virtual|friend|explicit)\s+)*(?:const\s+)?[A-Za-z_][\w:]*(?:\s+[A-Za-z_][\w:]*)*(?:\s*[&*]+\s*|\s+)(?:const\s+)?(?:[A-Za-z_][\w:~]*|operator\s*\S+)$/.test(head)) return false;
  const first = head.split(/\s+/)[0];
  if (/^(?:return|delete|new|throw|goto|else|case|using|typedef|cout|cin|cerr|printf)$/.test(first)) return false;
  const inner = t.slice(open + 1, close).trim();
  if (!inner || /^void$/.test(inner)) return true;
  return splitParams(inner).every((p) => p === '...' || PARAM.test(p));
}

const isDecl = (t: string) =>
  /^(\s*#|\s*(using\b|typedef\b|namespace\b|template\b|class\b|struct\b|union\b|enum\b|extern\b))/.test(t) ||
  isPrototype(t) ||
  /^(\s*(const|constexpr|static\s+const|inline)\b)/.test(t) ||
  (/^[^=;{]*\)\s*(const|noexcept|override|final|\s)*(->[^={;]+)?(:[^;{]*)?\{/.test(t) && !CONTROL.test(t.trim().split(/\W/)[0]));

/** Is this part of a cell a global declaration (hoisted) rather than a statement that runs? */
function classify(p: SplitPart, cellSrc: string): { decl: boolean; main: RegExpExecArray | null } {
  const main = /\bmain\s*\(([^)]*)\)/.exec(p.text);
  const isMain = !!main && isDecl(p.text);
  const decl = isMain || isDecl(p.text) || /\/\/@global/.test(p.text) || /\/\/@global/.test(cellSrc.split('\n')[p.line - 2] || '');
  return { decl, main: isMain ? main : null };
}

/**
 * Cut a whole program (pasted into one cell) into notebook-sized cells: the #include / using lines, then every function,
 * class or struct on its own, the prototypes together, and main last. Returns null unless it clearly is a program of 3+ pieces.
 */
export function splitProgram(src: string): string[] | null {
  const text = String(src || '').replace(/\r\n?/g, '\n');
  const parts = splitCell(text);
  if (parts.length < 3) return null;
  type Kind = 'header' | 'proto' | 'def' | 'main' | 'stmt';
  const kindOf = (p: SplitPart): Kind => {
    const t = p.text.trim();
    if (/^#/.test(t) || /^(using|typedef)\b/.test(t)) return 'header';
    const c = classify(p, text);
    if (c.main) return 'main';
    if (isPrototype(t) || /^(class|struct|union|enum)\b[^{]*;$/.test(t) || /^extern\b/.test(t)) return 'proto';
    return c.decl ? 'def' : 'stmt';
  };
  // Consecutive headers / prototypes / loose statements share a cell; every definition and main gets its own.
  const groups: Array<{ kind: Kind; line: number }> = [];
  for (const p of parts) {
    const k = kindOf(p), last = groups[groups.length - 1];
    if (last && last.kind === k && (k === 'header' || k === 'proto' || k === 'stmt')) continue;
    groups.push({ kind: k, line: p.line });
  }
  if (groups.length < 3 || !groups.some((g) => g.kind === 'def' || g.kind === 'main')) return null;
  const lines = text.split('\n');
  const cuts = groups.map((g) => Math.max(0, g.line - 1));
  cuts[0] = 0;
  const chunks = cuts.map((from, i) => lines.slice(from, i + 1 < cuts.length ? cuts[i + 1] : lines.length));
  // Comments and blank lines hanging at the end of a chunk belong to the code that follows them.
  for (let i = 0; i + 1 < chunks.length; i++) {
    const tail: string[] = [];
    while (chunks[i].length && /^\s*(\/\/.*)?$/.test(chunks[i][chunks[i].length - 1])) tail.unshift(chunks[i].pop()!);
    chunks[i + 1] = [...tail, ...chunks[i + 1]];
  }
  const out = chunks.map((c) => c.join('\n').replace(/^\n+|\s+$/g, '')).filter((c) => c.trim());
  return out.length >= 3 ? out : null;
}

/** Does running this cell execute anything (statements or a `main`), or does it only declare things? */
export function cellRuns(src: string): boolean {
  return splitCell(src).some((p) => { const c = classify(p, src); return !c.decl || !!c.main; });
}

/** `tryCatch: false` for toolchains built without C++ exceptions (the in-browser clang rejects `try`). */
export function assemble(cells: Array<{ src?: string; source?: string; stdin?: string; live?: boolean }>, target: number | 'all' = 'all', opts: { tryCatch?: boolean; unbuffered?: boolean } = {}): string {
  const tryCatch = opts.tryCatch !== false;
  const selected = target === 'all' ? cells : cells.slice(0, Number(target) + 1);
  const decl: string[] = [];
  const body: Array<{ k: number; stdin: string; live: boolean; stmts: Array<{ t: string; line: number }>; callMain: string }> = [];

  selected.forEach((cell, ix) => {
    const k = ix + 1;
    const parts = splitCell(cell.src ?? cell.source ?? '');
    const stmts: Array<{ t: string; line: number }> = [];
    let callMain = '';

    const cellSrc = cell.src ?? cell.source ?? '';
    for (const p of parts) {
      let t = p.text;
      const { decl: hoist, main } = classify(p, cellSrc);
      if (main) {
        const args = main[1].trim();
        t = t.replace(/\bmain\s*\(/, `__nb_main_${k}(`);
        // A real main() returns 0 when it falls off the end; the renamed copy would otherwise trap at run time.
        if (/\bint\s+__nb_main_/.test(t) && t.lastIndexOf('}') > 0) { const e = t.lastIndexOf('}'); t = t.slice(0, e) + ' return 0;/*nb*/ ' + t.slice(e); }
        callMain = args ? `__nb_main_${k}(0,nullptr);` : `__nb_main_${k}();`;
      }
      if (hoist) {
        decl.push(`#line ${p.line} "cell-${k}"\n${t.replace(/^\s*\/\/@global\s*\n/, '')}`);
      } else {
        stmts.push({ t, line: p.line });
      }
    }
    body.push({ k, stdin: String(cell.stdin || ''), live: !!cell.live, stmts, callMain });
  });

  const globals = decl.join('\n');
  // Detect if user included <iostream> — required for std::cin/cout and cin simulation
  const hasIostream = /^\s*#\s*include\s*[<"](iostream|bits\/stdc\+\+\.h)[">]/m.test(globals);
  // Auto-includes: <cstdio> for section markers (fputs/fflush); NOT <iostream> — students must write it
  // <sstream> is only needed for the cin redirect below; libc++ may expose std::cout through it, which would let code without #include <iostream> compile.
  const code = ['#include <cstdio>', '#include <exception>', ...(hasIostream ? ['#include <sstream>'] : []), globals, tryCatch ? 'int main(){ try {' : 'int main(){ {'];
  // Interactive cells read the real stdin (the host feeds it as the user types); the others replay their stored input.
  if (opts.unbuffered) code.push('setvbuf(stdout, nullptr, _IONBF, 0); setvbuf(stderr, nullptr, _IONBF, 0);');
  if (hasIostream && body.some((c) => c.live)) code.push('std::streambuf* __nb_cin_buf = std::cin.rdbuf();');
  for (const c of body) {
    let d = 'NBSTDIN' + c.k;
    while (c.stdin.includes(d)) d += 'X';
    // Only redirect cin when user has #include <iostream>
    if (hasIostream && c.live) {
      code.push('std::cin.clear(); std::cin.rdbuf(__nb_cin_buf);');
    } else if (hasIostream) {
      code.push(`std::istringstream __nb_in_${c.k}(R"${d}(${c.stdin})${d}"); std::cin.clear(); std::cin.rdbuf(__nb_in_${c.k}.rdbuf());`);
    }
    for (const s of c.stmts) code.push(`#line ${s.line} "cell-${c.k}"\n${s.t}`);
    if (c.callMain) code.push(c.callMain);
    code.push(`fputs("\x1e@@NB:${c.k}@@\x1e", stdout); fflush(stdout); fputs("\x1e@@NB:${c.k}@@\x1e", stderr);`);
  }
  code.push(tryCatch ? '} catch(const std::exception& e){ fputs("terminate: ", stderr); fputs(e.what(), stderr); } catch(...){ fputs("terminate: unknown exception", stderr); } return 0; }' : '} return 0; }');
  return code.join('\n');
}

export function splitSections(stdout = '', stderr = '', count = 0, target: number | 'all' = 'all') {
  const marks = Array.from({ length: count }, (_, i) => `\x1e@@NB:${i + 1}@@\x1e`);
  const split = (s: string) => {
    const a = String(s).split(/\x1e@@NB:\d+@@\x1e/);
    return marks.map((_, i) => a[i] || '');
  };
  const out = split(stdout), err = split(stderr);
  return out.map((v, i) => ({ stdout: v, stderr: err[i] })).filter((_, i) => target === 'all' || i === Number(target));
}

