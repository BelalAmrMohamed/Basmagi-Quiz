// =============================================================================
// runtimes/matlab/src/completions.ts
// Autocomplete for MATLAB cells, ported in full from the deployed MLWeb runtime:
//   source 1: workspace variables (with class and size), names assigned or defined anywhere
//             in the notebook's code cells, notebook functions, keywords, snippets, supported
//             functions with signatures and docs, constants
//   source 2: workspace file names inside the string argument of imread/imwrite/imfinfo/...
// =============================================================================
import { snippetCompletion, type Completion, type CompletionContext, type CompletionResult, type CompletionSource } from '@codemirror/autocomplete';
import type { VarInfo } from '../../shared/engine';
import { keywords } from './language';
import { FUNCTION_DOCS, CONSTANT_DOCS, SNIPPETS } from './completion-data';

export interface CompletionHost {
  workspace(): VarInfo[];
  codeSources(): string[];
  fileNames(): string[];
}

const ASSIGN = /^[ \t]*([A-Za-z_]\w*)[ \t]*(?:\([^)=]*\))?[ \t]*=(?!=)/gm;
const MULTI_ASSIGN = /^[ \t]*\[([^\]=\n]*)\][ \t]*=(?!=)/gm;
const FOR_VAR = /^[ \t]*for[ \t]+\(?[ \t]*([A-Za-z_]\w*)[ \t]*=/gm;
const FUNCTION_DEF = /^[ \t]*function[ \t]+(?:(?:\[([^\]]*)\]|([A-Za-z_]\w*))[ \t]*=[ \t]*)?([A-Za-z_]\w*)[ \t]*(?:\(([^)]*)\))?/gm;
const FILE_FUNCTIONS = /\b(?:imread|imwrite|imfinfo|imtool|imshow|exist|load|save|delete)\s*\(\s*(?:[^()]*,\s*)?$/;

/** Names a notebook defines: assigned variables, loop variables, function names and their arguments. */
export function scanNotebook(sources: string[]): { vars: Set<string>; functions: Set<string> } {
  const vars = new Set<string>(), functions = new Set<string>();
  const names = (s: string) => s.split(/[\s,]+/).filter((n) => /^[A-Za-z_]\w*$/.test(n));
  for (const source of sources) {
    const code = source.replace(/%.*$/gm, '');
    for (const m of code.matchAll(ASSIGN)) vars.add(m[1]);
    for (const m of code.matchAll(MULTI_ASSIGN)) names(m[1]).forEach((n) => vars.add(n));
    for (const m of code.matchAll(FOR_VAR)) vars.add(m[1]);
    for (const m of code.matchAll(FUNCTION_DEF)) {
      functions.add(m[3]);
      names(m[1] ?? m[2] ?? '').forEach((n) => vars.add(n));
      names(m[4] ?? '').forEach((n) => vars.add(n));
    }
  }
  for (const k of keywords) vars.delete(k);
  return { vars, functions };
}

/** What the cursor is inside, judged from the text of the line before it. */
export function lineContext(before: string): { kind: 'comment' | 'string' | 'code'; quote?: string; start?: number } {
  let quote = '', start = 0;
  for (let i = 0; i < before.length; i++) {
    const ch = before[i];
    if (quote) {
      if (ch === quote) { if (before[i + 1] === quote) i++; else quote = ''; }
      continue;
    }
    if (ch === '%') return { kind: 'comment' };
    if (ch === '"') { quote = ch; start = i + 1; continue; }
    if (ch === "'") {
      let j = i - 1;
      while (j >= 0 && (before[j] === ' ' || before[j] === '\t')) j--;
      const prev = j >= 0 ? before[j] : '';
      if (prev && /[\w)\]}.']/.test(prev) && j === i - 1) continue; // transpose, not a string
      quote = ch; start = i + 1;
    }
  }
  return quote ? { kind: 'string', quote, start } : { kind: 'code' };
}

export function matlabCompletions(host: CompletionHost): CompletionSource[] {
  const fixed: Completion[] = [
    ...Array.from(keywords, (label) => ({ label, type: 'keyword', boost: -1 })),
    ...SNIPPETS.map(({ template, ...spec }) => snippetCompletion(template, spec)),
    ...Object.entries(FUNCTION_DOCS).map(([label, [detail, info]]) => ({ label, type: 'function', detail, info, boost: 0 })),
    ...Object.entries(CONSTANT_DOCS).map(([label, info]) => ({ label, type: 'constant', info, boost: -2 })),
  ];

  const identifiers = (context: CompletionContext): CompletionResult | null => {
    const word = context.matchBefore(/[A-Za-z_]\w*/);
    if (!word && !context.explicit) return null;
    const line = context.state.doc.lineAt(context.pos), before = line.text.slice(0, context.pos - line.from);
    if (lineContext(before).kind !== 'code'
      || (word && /[\w)\]}]\.$/.test(before.slice(0, word.from - line.from))) // struct field access
      || (word && /\d/.test(before[word.from - line.from - 1] ?? ''))) return null;
    const workspace = host.workspace(), inWorkspace = new Set(workspace.map((v) => v.name));
    const { vars, functions } = scanNotebook(host.codeSources());
    const dynamic: Completion[] = [
      ...workspace.map((v) => ({ label: v.name, type: 'variable', detail: `${v.cls} ${v.size}`, boost: 4 })),
      ...[...vars].filter((n) => !inWorkspace.has(n)).map((n) => ({ label: n, type: 'variable', detail: 'notebook', boost: 3 })),
      ...[...functions].map((n) => ({ label: n, type: 'function', detail: 'notebook function', boost: 3 })),
    ];
    return { from: word ? word.from : context.pos, options: [...dynamic, ...fixed], validFor: /^[A-Za-z_]\w*$/ };
  };

  const fileNames = (context: CompletionContext): CompletionResult | null => {
    const line = context.state.doc.lineAt(context.pos), before = line.text.slice(0, context.pos - line.from);
    const ctx = lineContext(before);
    if (ctx.kind !== 'string' || ctx.start === undefined) return null;
    if (!FILE_FUNCTIONS.test(before.slice(0, ctx.start - 1)) && !context.explicit) return null;
    const names = host.fileNames();
    return names.length
      ? { from: line.from + ctx.start, options: names.map((label) => ({ label, type: 'text', detail: 'file' })), validFor: /^[^'"]*$/ }
      : null;
  };

  return [identifiers, fileNames];
}
