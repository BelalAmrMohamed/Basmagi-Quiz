// =============================================================================
// runtimes/cpp/src/lint.ts
// Live syntax diagnostics from the Lezer C++ tree: every error node becomes a diagnostic.
// =============================================================================
import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import type { Diagnostic } from '@codemirror/lint';

export const CPP_LINT_AR = { 'Syntax error': 'خطأ في الصياغة' } as const;

export function cppLint(message: string): (state: EditorState) => Diagnostic[] {
  return (state) => {
    const out: Diagnostic[] = [];
    syntaxTree(state).iterate({
      enter(node) {
        if (out.length >= 50) return false;
        if (node.type.isError) { out.push({ from: node.from, to: node.to, severity: 'error', message }); return false; }
        return undefined;
      },
    });
    return out;
  };
}
