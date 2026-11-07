// =============================================================================
// runtimes/cpp/src/completions.ts
// Autocomplete for C++ cells (replaces the old keyword-only list). One CompletionSource
// that looks at what is left of the cursor and decides what to offer:
//
//   #                    -> preprocessor directives (as snippets)
//   #include␠ / < / "    -> standard headers (and a quoted-header snippet)
//   #ifdef / #pragma     -> macro names / pragma kinds
//   std:: / std::chrono:: -> members of the standard library, with the header each needs
//   expr. / expr->       -> common member functions, plus names declared in the notebook
//   anything else        -> names declared in the notebook's other cells, keywords, types,
//                           snippets (main, for, while, cout <<, ...), std names, C library
//
// It never offers anything inside comments, strings or char literals (except the header
// name of an #include "…"), and it triggers on typing and on Ctrl+Space (explicit).
// =============================================================================
import { snippetCompletion, startCompletion, type Completion, type CompletionContext, type CompletionResult, type CompletionSource } from '@codemirror/autocomplete';
import { DIRECTIVES, HEADERS, KEYWORDS, TYPES, STD_MEMBERS, NESTED, GLOBALS, MEMBERS, SNIPPETS, type Kind } from './completion-data';

export interface CompletionHost {
  /** Source of every code cell in the notebook (the shell passes this through engine.attach). */
  codeSources(): string[];
}

// ----------------------------------------------------------------------------- lexing

export type LexState = 'code' | 'comment' | 'string' | 'char';

/** What the end of `text` is inside of. Understands //, /* *\/, "…", '…', R"x(…)x" and 1'000 digit separators. */
export function lexState(text: string): LexState {
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i], d = text[i + 1];
    if (c === '/' && d === '/') { const e = text.indexOf('\n', i); if (e < 0) return 'comment'; i = e + 1; continue; }
    if (c === '/' && d === '*') { const e = text.indexOf('*/', i + 2); if (e < 0) return 'comment'; i = e + 2; continue; }
    if (c === '"') {
      const raw = /(?:u8|u|U|L)?R$/.test(text.slice(Math.max(0, i - 3), i)) ? /^"([^\s()\\]{0,16})\(/.exec(text.slice(i)) : null;
      if (raw) { const end = text.indexOf(')' + raw[1] + '"', i + raw[0].length); if (end < 0) return 'string'; i = end + raw[1].length + 2; continue; }
      i++;
      while (i < n && text[i] !== '"' && text[i] !== '\n') i += text[i] === '\\' ? 2 : 1;
      if (i >= n) return 'string';
      if (text[i] === '\n') continue; // unterminated string ends at the line break
      i++; continue;
    }
    if (c === "'") {
      if (/[0-9a-fA-F]/.test(text[i - 1] ?? '') && /[0-9a-fA-F]/.test(d ?? '')) { i++; continue; } // digit separator
      i++;
      while (i < n && text[i] !== "'" && text[i] !== '\n') i += text[i] === '\\' ? 2 : 1;
      if (i >= n) return 'char';
      if (text[i] === '\n') continue;
      i++; continue;
    }
    i++;
  }
  return 'code';
}

/** Replace comments, string and char literals with harmless placeholders; newlines are kept. */
export function stripNoise(src: string): string {
  let out = '', i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { const e = src.indexOf('\n', i); i = e < 0 ? n : e; continue; }
    if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); const stop = e < 0 ? n : e + 2; out += src.slice(i, stop).replace(/[^\n]/g, ' '); i = stop; continue; }
    if (c === '"') {
      const raw = /(?:u8|u|U|L)?R$/.test(out.slice(-3)) ? /^"([^\s()\\]{0,16})\(/.exec(src.slice(i)) : null;
      if (raw) { const e = src.indexOf(')' + raw[1] + '"', i + raw[0].length); const stop = e < 0 ? n : e + raw[1].length + 2; out += '""' + src.slice(i, stop).replace(/[^\n]/g, ''); i = stop; continue; }
      let j = i + 1;
      while (j < n && src[j] !== '"' && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      out += '""'; i = src[j] === '"' ? j + 1 : j; continue;
    }
    if (c === "'" && !(/[0-9a-fA-F]/.test(src[i - 1] ?? '') && /[0-9a-fA-F]/.test(d ?? ''))) {
      let j = i + 1;
      while (j < n && src[j] !== "'" && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      out += '0'; i = src[j] === "'" ? j + 1 : j; continue;
    }
    out += c; i++;
  }
  return out;
}

// ----------------------------------------------------------------------------- notebook scan

export interface NotebookNames {
  vars: Set<string>;       // variables, parameters, struct members, structured bindings
  functions: Set<string>;
  types: Set<string>;      // classes, structs, unions, enums, aliases, template parameters
  macros: Set<string>;
  enumerators: Set<string>;
  namespaces: Set<string>;
  usingStd: boolean;
}

const RESERVED = new Set([...KEYWORDS, ...TYPES, 'for', 'while', 'if', 'switch', 'do', 'try', 'class', 'struct', 'union', 'enum', 'namespace', 'template', 'int', 'main', 'co_return', 'co_await', 'co_yield']);
const NOT_A_TYPE = '(?!(?:return|delete|goto|throw|else|case|new|typedef|using|namespace|public|private|protected|break|continue|do|sizeof|typename|template|operator|static_cast|dynamic_cast|const_cast|reinterpret_cast|if|while|for|switch|catch|try|co_return|co_await|co_yield|and|or|not|xor)\\b)';
const BUILTIN = '(?:(?:unsigned|signed|long|short)\\b\\s*)*(?:int|char|double|float|bool|wchar_t|char16_t|char32_t|void|auto)\\b|(?:unsigned|signed|long|short)\\b(?:\\s+(?:unsigned|signed|long|short))*';
const STD_CLASSES = STD_MEMBERS.filter((m) => m[1] === 'class' || m[1] === 'type').map((m) => m[0]);
const BASE_KNOWN = [...new Set([...STD_CLASSES, 'size_t', 'ptrdiff_t', 'FILE', 'int8_t', 'int16_t', 'int32_t', 'int64_t', 'uint8_t', 'uint16_t', 'uint32_t', 'uint64_t', 'intmax_t', 'uintmax_t', 'time_t', 'clock_t'])];

const idents = (s: string) => s.split(/[\s,*&]+/).filter((t) => /^[A-Za-z_]\w*$/.test(t));
const TYPE_WORDS = new Set(['const', 'volatile', 'unsigned', 'signed', 'long', 'short', 'struct', 'class', 'enum', 'typename']);

/** Types declared by one source (cheap, cached per source text). */
const typeCache = new Map<string, { types: Set<string>; namespaces: Set<string> }>();
function scanTypes(src: string) {
  const hit = typeCache.get(src);
  if (hit) return hit;
  const code = stripNoise(src), types = new Set<string>(), namespaces = new Set<string>();
  for (const m of code.matchAll(/\b(?:class|struct|union|enum\s+class|enum\s+struct|enum)\s+([A-Za-z_]\w*)/g)) if (!RESERVED.has(m[1]) && m[1] !== 'final') types.add(m[1]);
  for (const m of code.matchAll(/\busing\s+([A-Za-z_]\w*)\s*=/g)) types.add(m[1]);
  for (const m of code.matchAll(/\btypedef\b[^;{}]*?\b([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?\s*;/g)) types.add(m[1]);
  for (const m of code.matchAll(/\btypedef\s+(?:struct|class|union|enum)\b[^{;]*\{[^}]*\}\s*([A-Za-z_]\w*)/g)) types.add(m[1]);
  for (const m of code.matchAll(/\btemplate\s*<([^>]*)>/g)) for (const piece of m[1].split(',')) { const w = idents(piece.split('=')[0].trim()).filter((t) => !TYPE_WORDS.has(t) && t !== 'typename'); if (w.length) types.add(w[w.length - 1]); }
  for (const m of code.matchAll(/\bnamespace\s+([A-Za-z_]\w*)/g)) if (m[1] !== 'std') namespaces.add(m[1]);
  const r = { types, namespaces };
  if (typeCache.size > 64) typeCache.clear();
  typeCache.set(src, r);
  return r;
}

const declCache = new Map<string, Omit<NotebookNames, 'types' | 'namespaces'>>();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function buildDeclRegex(userTypes: Iterable<string>): RegExp {
  const known = [...new Set([...BASE_KNOWN, ...userTypes])].sort((a, b) => b.length - a.length).map(escapeRe).join('|');
  const qualified = '(?:[A-Za-z_]\\w*\\s*::\\s*)+[A-Za-z_]\\w*';
  const type = `(?:${BUILTIN}|(?:${known})\\b|${qualified}|[A-Za-z_]\\w*(?=\\s*<))`;
  return new RegExp(
    `(?<![\\w:.>])` + NOT_A_TYPE
    + `(?:(?:const|constexpr|static|volatile|inline|extern|mutable|register|thread_local)\\s+)*`
    + `(?:${type})`
    + `(?:\\s*<[^;{}]*?>)?(?:\\s*::\\s*[A-Za-z_]\\w*)*`
    + `(?:\\s*(?:const\\b|volatile\\b|\\*|&&|&)\\s*)*`
    + `\\s*(?<=[\\s*&>])([A-Za-z_]\\w*)\\s*(?=[=;,(\\[{:)]|$)`,
    'gm');
}

function matching(code: string, open: number): number {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === '(') depth++;
    else if (code[i] === ')' && --depth === 0) return i;
  }
  return -1;
}

function looksLikeParams(list: string, known: RegExp): boolean {
  const t = list.trim();
  if (!t || t === 'void') return true;
  return t.split(',').every((piece) => {
    const p = piece.split('=')[0].trim();
    return known.test(p) || /^(?:const\s+)?(?:[A-Za-z_]\w*::)*[A-Za-z_]\w*\s*<[^>]*>\s*[&*]*\s*\w*$/.test(p);
  });
}

function scanDeclarations(src: string, userTypes: Set<string>): Omit<NotebookNames, 'types' | 'namespaces'> {
  const vars = new Set<string>(), functions = new Set<string>(), macros = new Set<string>(), enumerators = new Set<string>();
  const noComments = stripNoise(src);
  for (const m of noComments.matchAll(/^[ \t]*#[ \t]*define[ \t]+([A-Za-z_]\w*)/gm)) macros.add(m[1]);
  const usingStd = /\busing\s+namespace\s+std\s*;/.test(noComments);
  const code = noComments.replace(/^[ \t]*#.*(?:\\\n.*)*$/gm, '');

  for (const m of code.matchAll(/\benum\b[^{;]*\{([^}]*)\}/g)) for (const piece of m[1].split(',')) { const id = /^\s*([A-Za-z_]\w*)/.exec(piece); if (id) enumerators.add(id[1]); }
  for (const m of code.matchAll(/\bauto\s*(?:&&|&|const\s*)?\s*\[([^\]]+)\]/g)) idents(m[1]).forEach((n) => vars.add(n));

  const knownType = new RegExp('^(?:const\\s+)?(?:' + BUILTIN + '|(?:' + [...new Set([...BASE_KNOWN, ...userTypes])].map(escapeRe).join('|') + ')\\b|(?:[A-Za-z_]\\w*\\s*::\\s*)+[A-Za-z_]\\w*)');
  const re = buildDeclRegex(userTypes);
  for (const m of code.matchAll(re)) {
    const name = m[1];
    if (RESERVED.has(name)) continue;
    const nameEnd = (m.index ?? 0) + m[0].lastIndexOf(name) + name.length;
    const term = /^\s*([=;,(\[{:)])/.exec(code.slice(nameEnd))?.[1] ?? '';
    if (term === '(') {
      const openAt = code.indexOf('(', nameEnd), close = matching(code, openAt);
      const list = close > 0 ? code.slice(openAt + 1, close) : '';
      const isFn = close > 0 && /^\s*(?:const\b|noexcept\b|override\b|final\b|->|\{|;|:)/.test(code.slice(close + 1)) && looksLikeParams(list, knownType);
      if (isFn) {
        functions.add(name);
        for (const piece of list.split(',')) {
          const p = piece.split('=')[0].replace(/\[[^\]]*\]/g, '').trim();
          const ids = idents(p).filter((t) => !TYPE_WORDS.has(t));
          if (ids.length >= 2) vars.add(ids[ids.length - 1]);
        }
        continue;
      }
    }
    vars.add(name);
    // `int a = 1, *b, c[3];`: later declarators in the same statement.
    let depth = 0;
    for (let i = nameEnd; i < code.length; i++) {
      const ch = code[i];
      if (ch === '(' || ch === '[' || ch === '{') depth++;
      else if (ch === ')' || ch === ']' || ch === '}') { if (--depth < 0) break; }
      else if (ch === ';' && depth === 0) break;
      else if (ch === ',' && depth === 0) {
        const more = /^\s*[*&]*\s*([A-Za-z_]\w*)/.exec(code.slice(i + 1));
        if (more && !RESERVED.has(more[1])) vars.add(more[1]);
      }
    }
  }
  for (const f of ['main']) functions.delete(f);
  return { vars, functions, macros, enumerators, usingStd };
}

/** Names the notebook declares, across all cells. Results are cached per source text. */
export function scanNotebook(sources: string[]): NotebookNames {
  const types = new Set<string>(), namespaces = new Set<string>();
  for (const s of sources) { const t = scanTypes(s); t.types.forEach((x) => types.add(x)); t.namespaces.forEach((x) => namespaces.add(x)); }
  const key = [...types].sort().join(',');
  const out: NotebookNames = { vars: new Set(), functions: new Set(), types, macros: new Set(), enumerators: new Set(), namespaces, usingStd: false };
  for (const s of sources) {
    const ck = key + '\u0000' + s;
    let r = declCache.get(ck);
    if (!r) { r = scanDeclarations(s, types); if (declCache.size > 256) declCache.clear(); declCache.set(ck, r); }
    r.vars.forEach((x) => out.vars.add(x)); r.functions.forEach((x) => out.functions.add(x)); r.macros.forEach((x) => out.macros.add(x)); r.enumerators.forEach((x) => out.enumerators.add(x));
    if (r.usingStd) out.usingStd = true;
  }
  for (const f of out.functions) out.vars.delete(f);
  for (const t of out.types) { out.vars.delete(t); out.functions.delete(t); }
  return out;
}

// ----------------------------------------------------------------------------- options

const kindType = (k: Kind): string => (k === 'keyword' ? 'keyword' : k);
const withStd = (template: string, usingStd: boolean) => template.replace(/\{std\}/g, usingStd ? '' : 'std::');

const headerOptions = new Map<string, Completion[]>();
const HEADER_CHARS = /[\w\/.+\-]*/;

function snippetOptions(usingStd: boolean): Completion[] {
  return SNIPPETS.map((s) => snippetCompletion(withStd(s.template, usingStd), { label: s.label, detail: s.detail, info: s.info, type: 'text', boost: 2 }));
}
const snippetCache = new Map<boolean, Completion[]>();

const fixedCache = new Map<boolean, Completion[]>();
function fixedOptions(usingStd: boolean): Completion[] {
  let out = fixedCache.get(usingStd);
  if (out) return out;
  out = [
    ...KEYWORDS.map((label): Completion => ({ label, type: 'keyword', boost: -1 })),
    ...TYPES.map((label): Completion => ({ label, type: 'type', boost: 0 })),
    ...STD_MEMBERS.map(([name, kind, header, sig]): Completion => ({
      label: name, type: kindType(kind), detail: sig, info: `std::${name} — #include <${header}>`,
      apply: usingStd ? name : 'std::' + name, boost: usingStd ? 0 : -1,
    })),
    ...GLOBALS.map(([name, kind, sig]): Completion => ({ label: name, type: kindType(kind), detail: sig, boost: -2 })),
    { label: 'std', type: 'namespace', detail: 'standard library', boost: -1, apply: (view, _c, from, to) => { view.dispatch({ changes: { from, to, insert: 'std::' }, selection: { anchor: from + 5 } }); startCompletion(view); } },
  ];
  fixedCache.set(usingStd, out);
  return out;
}

function headerList(delim: '<' | '"' | ''): Completion[] {
  const k = delim;
  let out = headerOptions.get(k);
  if (out) return out;
  out = HEADERS.map(([h, d]): Completion => (delim === ''
    ? { label: `<${h}>`, detail: d, type: 'text', boost: /\.h$|\//.test(h) ? -1 : 0 }
    : { label: h, detail: d, type: 'text', apply: h + (delim === '<' ? '>' : '"'), boost: /\.h$|\//.test(h) ? -1 : 0 }));
  headerOptions.set(k, out);
  return out;
}

// ----------------------------------------------------------------------------- the source

const INCLUDE = /^\s*#\s*include(?:\s+|(?=[<"]))(<|")?([\w\/.+\-]*)$/;
const DIRECTIVE = /^\s*(#)\s*(\w*)$/;
const MACRO_DIRECTIVE = /^\s*#\s*(?:ifdef|ifndef|undef)\s+(\w*)$/;
const PRAGMA = /^\s*#\s*pragma\s+(\w*)$/;
const STD_SCOPE = /\bstd\s*::\s*(\w*)$/;
const NESTED_SCOPE = /\b(?:std\s*::\s*)?(chrono|this_thread)\s*::\s*(\w*)$/;
const ANY_SCOPE = /::\s*\w*$/;
const MEMBER = /(?:\.|->)\s*(\w*)$/;
const NUMBER_DOT = /(?:^|[^\w.])\d[\w']*\.\s*\w*$/;

export function cppCompletions(host: CompletionHost): CompletionSource {
  return (context: CompletionContext): CompletionResult | null => {
    const { state, pos } = context;
    const line = state.doc.lineAt(pos), before = line.text.slice(0, pos - line.from);
    const lex = lexState(state.doc.sliceString(0, pos));
    if (lex === 'comment') return null;

    // --- #include: header names (also inside the quotes of #include "…")
    const inc = INCLUDE.exec(before);
    if (inc) {
      const delim = (inc[1] ?? '') as '<' | '"' | '', typed = inc[2];
      const next = state.doc.sliceString(pos, pos + 1);
      const to = (delim === '<' && next === '>') || (delim === '"' && next === '"') ? pos + 1 : pos;
      const options = delim === ''
        ? [...headerList(''), snippetCompletion('"${file}.h"', { label: '"file.h"', detail: 'local header', type: 'text', boost: -2 })]
        : headerList(delim);
      return { from: pos - typed.length, to, options, validFor: delim === '' ? /^[<"]?[\w\/.+\-]*$/ : HEADER_CHARS };
    }
    if (lex !== 'code') return null; // strings and char literals

    // --- other preprocessor lines
    const mac = MACRO_DIRECTIVE.exec(before);
    if (mac) {
      const { macros } = scanNotebook(host.codeSources());
      const opts: Completion[] = [...macros].map((label) => ({ label, type: 'constant', detail: 'macro', boost: 3 }));
      for (const [name, kind, sig] of GLOBALS) if (kind === 'constant') opts.push({ label: name, type: 'constant', detail: sig });
      return { from: pos - mac[1].length, options: opts, validFor: /^\w*$/ };
    }
    const prag = PRAGMA.exec(before);
    if (prag) {
      return { from: pos - prag[1].length, validFor: /^\w*$/, options: [['once', 'header guard (headers only)'], ['GCC', 'GCC pragma, e.g. GCC optimize("O2")'], ['omp', 'OpenMP'], ['pack', 'struct packing'], ['message', 'print a message while compiling'], ['warning', 'control warnings']].map(([label, detail]) => ({ label, detail, type: 'keyword' })) };
    }
    const dir = DIRECTIVE.exec(before);
    if (dir) {
      const from = line.from + before.indexOf('#');
      return {
        from, validFor: /^#\s*\w*$/,
        options: DIRECTIVES.map(([name, detail, template, info]) => snippetCompletion('#' + template, { label: '#' + name, detail, info, type: 'keyword' })),
      };
    }
    if (/^\s*#/.test(before)) return null; // the rest of a directive line: leave it alone

    const names = scanNotebook(host.codeSources());

    // --- std:: and std::chrono::
    const nested = NESTED_SCOPE.exec(before);
    if (nested) {
      const list = NESTED[nested[1]];
      return { from: pos - nested[2].length, validFor: /^\w*$/, options: list.map(([label, kind, detail]) => ({ label, type: kindType(kind), detail })) };
    }
    const sc = STD_SCOPE.exec(before);
    if (sc) {
      const options = STD_MEMBERS.map(([label, kind, header, sig]): Completion => (
        kind === 'namespace'
          ? { label, type: 'namespace', detail: sig, info: `#include <${header}>`, apply: (view, _c, from, to) => { view.dispatch({ changes: { from, to, insert: label + '::' }, selection: { anchor: from + label.length + 2 } }); startCompletion(view); } }
          : { label, type: kindType(kind), detail: sig, info: `#include <${header}>` }));
      return { from: pos - sc[1].length, options, validFor: /^\w*$/ };
    }
    if (ANY_SCOPE.test(before)) return null; // user-defined scope: no type information to complete from

    // --- member access
    const mem = MEMBER.exec(before);
    if (mem) {
      if (NUMBER_DOT.test(before) || /\.\.\.\s*\w*$/.test(before)) return null;
      const opts: Completion[] = [
        ...[...names.vars].map((label): Completion => ({ label, type: 'property', detail: 'notebook', boost: -1 })),
        ...MEMBERS.map(([label, detail]): Completion => ({ label, type: ['first', 'second', 'npos'].includes(label) ? 'property' : 'method', detail })),
      ];
      return { from: pos - mem[1].length, options: opts, validFor: /^\w*$/ };
    }

    // --- general identifier
    const word = context.matchBefore(/[A-Za-z_]\w*/);
    if (!word && !context.explicit) return null;
    const from = word ? word.from : pos;
    if (word && /[0-9]/.test(state.doc.sliceString(Math.max(0, from - 1), from))) return null; // part of a number like 2x
    const using = names.usingStd;
    let snippets = snippetCache.get(using);
    if (!snippets) { snippets = snippetOptions(using); snippetCache.set(using, snippets); }
    const dynamic: Completion[] = [
      ...[...names.vars].map((label): Completion => ({ label, type: 'variable', detail: 'notebook', boost: 4 })),
      ...[...names.functions].map((label): Completion => ({ label, type: 'function', detail: 'notebook function', boost: 4 })),
      ...[...names.types].map((label): Completion => ({ label, type: 'class', detail: 'notebook type', boost: 4 })),
      ...[...names.enumerators].map((label): Completion => ({ label, type: 'constant', detail: 'enumerator', boost: 3 })),
      ...[...names.macros].map((label): Completion => ({ label, type: 'constant', detail: 'macro', boost: 3 })),
      ...[...names.namespaces].map((label): Completion => ({ label, type: 'namespace', detail: 'notebook namespace', boost: 3 })),
    ];
    return { from, options: [...dynamic, ...snippets, ...fixedOptions(using)], validFor: /^[A-Za-z_]\w*$/ };
  };
}
