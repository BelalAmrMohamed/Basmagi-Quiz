// =============================================================================
// runtimes/matlab/src/lint.ts
// Light-weight MATLAB scanner for live diagnostics: unmatched or unclosed brackets and
// unclosed string literals. Understands comments (%, %{ %}), `...` continuations and the
// transpose-vs-string ambiguity of the single quote.
// =============================================================================
import type { EditorState } from '@codemirror/state';
import type { Diagnostic } from '@codemirror/lint';

export type LintMessages = { unmatched: (c: string) => string; unclosed: (c: string) => string; mismatch: (open: string, close: string) => string; string: string };

const PAIRS: Record<string, string> = { ')': '(', ']': '[', '}': '{' };

export function scanMatlab(src: string, m: LintMessages): Diagnostic[] {
  const out: Diagnostic[] = [];
  const stack: Array<{ c: string; at: number }> = [];
  const err = (from: number, to: number, message: string) => out.push({ from, to, severity: 'error', message });
  let i = 0, blockComment = 0, lineStart = true;
  const n = src.length;
  let ls = 0; // index of current line start

  while (i < n) {
    const ch = src[i];
    if (ch === '\n') {
      // an open ( cannot span lines without a continuation
      while (stack.length && stack[stack.length - 1].c === '(') { const t = stack.pop()!; err(t.at, t.at + 1, m.unclosed('(')); }
      i++; ls = i; lineStart = true; continue;
    }
    if (lineStart) {
      let e = src.indexOf('\n', i); if (e < 0) e = n;
      const line = src.slice(ls, e).trim();
      if (line === '%{') { blockComment++; i = e; lineStart = false; continue; }
      if (line === '%}' && blockComment) { blockComment--; i = e; lineStart = false; continue; }
      lineStart = false;
    }
    if (blockComment) { const e = src.indexOf('\n', i); i = e < 0 ? n : e; continue; }
    if (ch === '%' || ch === '#') { const e = src.indexOf('\n', i); i = e < 0 ? n : e; continue; }
    if (ch === '.' && src.startsWith('...', i)) {
      // continuation: ignore the rest of the line and keep brackets open across the newline
      const e = src.indexOf('\n', i); i = e < 0 ? n : e + 1; ls = i; lineStart = false; continue;
    }
    if (ch === '"' || ch === "'") {
      let isString = ch === '"';
      if (!isString) {
        let p = i - 1;
        const inMatrix = stack.length && stack[stack.length - 1].c !== '(';
        const spaced = p >= ls && /[ \t]/.test(src[p]);
        while (p >= ls && /[ \t]/.test(src[p])) p--;
        const prev = p >= ls ? src[p] : '';
        const transpose = prev !== '' && /[\w)\]}'.]/.test(prev) && !(inMatrix && spaced);
        isString = !transpose;
      }
      if (isString) {
        let j = i + 1, closed = false;
        while (j < n && src[j] !== '\n') {
          if (src[j] === ch) { if (src[j + 1] === ch) { j += 2; continue; } closed = true; j++; break; }
          j++;
        }
        if (!closed) err(i, j, m.string);
        i = j; continue;
      }
      i++; continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') { stack.push({ c: ch, at: i }); i++; continue; }
    if (ch === ')' || ch === ']' || ch === '}') {
      const top = stack[stack.length - 1];
      if (!top) err(i, i + 1, m.unmatched(ch));
      else if (top.c === PAIRS[ch]) stack.pop();
      else { err(i, i + 1, m.mismatch(top.c, ch)); if (stack.some((s) => s.c === PAIRS[ch])) { while (stack.pop()!.c !== PAIRS[ch]); } }
      i++; continue;
    }
    i++;
  }
  for (const t of stack) err(t.at, t.at + 1, m.unclosed(t.c));
  return out.sort((a, b) => a.from - b.from);
}

export function matlabLint(m: LintMessages): (state: EditorState) => Diagnostic[] {
  return (state) => scanMatlab(state.doc.toString(), m);
}
