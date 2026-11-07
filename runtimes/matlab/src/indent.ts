// =============================================================================
// runtimes/matlab/src/indent.ts
// Auto-indent for MATLAB blocks, implemented natively (no patch files):
//   * Enter after if/for/while/parfor/switch/function/try (and else/elseif/case/otherwise/catch)
//     indents the new line one level deeper.
//   * Typing end/else/elseif/case/otherwise/catch at the start of a line dedents that line.
// Block structure is tracked with a small stack; `switch` holds its `case` lines one level
// in, and each case body one level deeper again.
// =============================================================================
import { EditorSelection, Prec, type Extension, type Text } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';

const UNIT = 4;
const OPENERS = new Set(['if', 'for', 'while', 'parfor', 'switch', 'function', 'try']);
const MID = new Set(['else', 'elseif', 'catch']);
const CASE = new Set(['case', 'otherwise']);
export const DEDENT_WORD = /^\s*(end|else|elseif|case|otherwise|catch)$/;

type Frame = 'block' | 'switch' | 'case';

/** Words of a line outside strings, comments and brackets (so `a(end)` is not an `end`). */
export function lineWords(text: string): string[] {
  const words: string[] = [];
  let depth = 0, i = 0, prev = '';
  while (i < text.length) {
    const ch = text[i];
    if (ch === '%' || (ch === '.' && text.startsWith('...', i))) break;
    if (ch === '"' || (ch === "'" && !/[\w)\]}'.]/.test(prev))) { // string, not the transpose operator
      const q = ch; i++;
      while (i < text.length && !(text[i] === q && text[i + 1] !== q)) i += text[i] === q ? 2 : 1;
      i++; prev = q; continue;
    }
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth = Math.max(0, depth - 1);
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < text.length && /\w/.test(text[j])) j++;
      if (depth === 0) words.push(text.slice(i, j));
      prev = 'a'; i = j; continue;
    }
    if (!/\s/.test(ch)) prev = ch;
    i++;
  }
  return words;
}

/** Apply one line to the frame stack. Returns the line's own display level (before applying it). */
export function applyLine(stack: Frame[], text: string): number {
  const words = lineWords(text);
  const first = words[0];
  const topCase = stack[stack.length - 1] === 'case';
  let level = stack.length;
  if (first === 'end') level = stack.length - (topCase ? 2 : 1);
  else if (first && MID.has(first)) level = stack.length - 1;
  else if (first && CASE.has(first)) level = stack.length - (topCase ? 1 : 0);
  level = Math.max(0, level);

  words.forEach((w, k) => {
    if (w === 'end') { if (stack[stack.length - 1] === 'case') stack.pop(); stack.pop(); }
    else if (CASE.has(w) && k === 0) { if (stack[stack.length - 1] === 'case') stack.pop(); stack.push('case'); }
    else if (OPENERS.has(w) && (k === 0 || /^(if|for|while|parfor|switch|try)$/.test(w))) stack.push(w === 'switch' ? 'switch' : 'block');
  });
  return level;
}

/** Display level for line `n` (0-based) of `lines`, given everything above it. */
export function levelOfLine(lines: string[], n: number): number {
  const stack: Frame[] = [];
  for (let i = 0; i < n; i++) applyLine(stack, lines[i]);
  return applyLine(stack, lines[n]);
}

/** Indent (in levels) for a new line created after line `n`. */
export function levelAfterLine(lines: string[], n: number): number {
  const stack: Frame[] = [];
  for (let i = 0; i <= n; i++) applyLine(stack, lines[i]);
  return stack.length;
}

const docLines = (doc: Text, upTo: number, override?: string) => {
  const out: string[] = [];
  for (let i = 1; i <= upTo; i++) out.push(i === upTo && override !== undefined ? override : doc.line(i).text);
  return out;
};
const pad = (levels: number) => ' '.repeat(levels * UNIT);

const enterCommand = (view: EditorView): boolean => {
  const { state } = view;
  if (state.selection.ranges.length !== 1) return false;
  const sel = state.selection.main, line = state.doc.lineAt(sel.head);
  // Leave the default behavior for selections and when an autocomplete is accepted with Enter.
  if (!sel.empty) return false;
  const before = line.text.slice(0, sel.head - line.from), after = line.text.slice(sel.head - line.from);
  const lines = docLines(state.doc, line.number, before);
  const reindent = DEDENT_WORD.test(before) ? pad(levelOfLine(lines, line.number - 1)) + before.trim() : before;
  const next = pad(levelAfterLine(lines.map((l, i) => (i === lines.length - 1 ? reindent : l)), line.number - 1));
  const insert = reindent + '\n' + next;
  view.dispatch({
    changes: { from: line.from, to: sel.head, insert },
    selection: EditorSelection.cursor(line.from + insert.length),
    scrollIntoView: true, userEvent: 'input',
  });
  return true;
};

const dedentOnKeyword = EditorView.inputHandler.of((view, from, to, text) => {
  if (text.length !== 1 || !/[A-Za-z]/.test(text) || from !== to) return false;
  const line = view.state.doc.lineAt(from);
  const typed = line.text.slice(0, from - line.from) + text;
  if (!DEDENT_WORD.test(typed) || /\w/.test(line.text[from - line.from] ?? '')) return false;
  const lines = docLines(view.state.doc, line.number, typed);
  const fixed = pad(levelOfLine(lines, line.number - 1)) + typed.trim();
  if (fixed === typed) return false;
  view.dispatch({
    changes: { from: line.from, to: from, insert: fixed },
    selection: EditorSelection.cursor(line.from + fixed.length),
    userEvent: 'input.type',
  });
  return true;
});

export function matlabIndent(): Extension {
  return [Prec.high(keymap.of([{ key: 'Enter', run: enterCommand }])), dedentOnKeyword];
}
