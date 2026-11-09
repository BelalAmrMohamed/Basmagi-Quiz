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

const isDecl = (t: string) =>
  /^(\s*#|\s*(using\b|typedef\b|namespace\b|template\b|class\b|struct\b|union\b|enum\b|extern\s+"C"))/.test(t) ||
  /^(\s*(const|constexpr|static\s+const|inline)\b)/.test(t) ||
  (/^[^=;{]*\)\s*(const|noexcept|override|final|\s)*(->[^={;]+)?(:[^;{]*)?\{/.test(t) && !CONTROL.test(t.trim().split(/\W/)[0]));

export function assemble(cells: Array<{ src?: string; source?: string; stdin?: string }>, target: number | 'all' = 'all'): string {
  const selected = target === 'all' ? cells : cells.slice(0, Number(target) + 1);
  const decl: string[] = [];
  const body: Array<{ k: number; stdin: string; stmts: Array<{ t: string; line: number }>; callMain: string }> = [];

  selected.forEach((cell, ix) => {
    const k = ix + 1;
    const parts = splitCell(cell.src ?? cell.source ?? '');
    const stmts: Array<{ t: string; line: number }> = [];
    let callMain = '';

    for (const p of parts) {
      let t = p.text;
      const main = /\bmain\s*\(([^)]*)\)/.exec(t);
      if (main && isDecl(t)) {
        const args = main[1].trim();
        t = t.replace(/\bmain\s*\(/, `__nb_main_${k}(`);
        callMain = args ? `__nb_main_${k}(0,nullptr);` : `__nb_main_${k}();`;
      }
      if (isDecl(t) || /\/\/@global/.test(t) || /\/\/@global/.test((cell.src || '').split('\n')[p.line - 2] || '')) {
        decl.push(`#line ${p.line} "cell-${k}"\n${t.replace(/^\s*\/\/@global\s*\n/, '')}`);
      } else {
        stmts.push({ t, line: p.line });
      }
    }
    body.push({ k, stdin: String(cell.stdin || ''), stmts, callMain });
  });

  const globals = decl.join('\n');
  const code = ['#include <iostream>', '#include <sstream>', '#include <exception>', globals, 'int main(){ try {'];
  for (const c of body) {
    let d = 'NBSTDIN' + c.k;
    while (c.stdin.includes(d)) d += 'X';
    code.push(`std::istringstream __nb_in_${c.k}(R"${d}(${c.stdin})${d}"); std::cin.clear(); std::cin.rdbuf(__nb_in_${c.k}.rdbuf());`);
    for (const s of c.stmts) code.push(`#line ${s.line} "cell-${c.k}"\n${s.t}`);
    if (c.callMain) code.push(c.callMain);
    code.push(`std::cout << "\\x1e@@NB:${c.k}@@\\x1e" << std::flush; std::cerr << "\\x1e@@NB:${c.k}@@\\x1e";`);
  }
  code.push('} catch(const std::exception& e){ std::cerr << "terminate: " << e.what(); } catch(...){ std::cerr << "terminate: unknown exception"; } return 0; }');
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

