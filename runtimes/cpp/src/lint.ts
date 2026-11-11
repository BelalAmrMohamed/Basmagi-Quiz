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
    const lastLine = state.doc.line(state.doc.lines);
    // Lezer expects a line break after a preprocessor directive. A complete final
    // #include is valid at EOF in C++, so ignore its parser EOF marker in the editor.
    const completeIncludeAtEof = lastLine.to === state.doc.length
      && /^[ \t]*#[ \t]*include[ \t]*(?:<[^>\r\n]+>|"[^"\r\n]+?")[ \t]*(?:(?:\/\/.*)|(?:\/\*.*\*\/[ \t]*))?$/.test(lastLine.text);
    syntaxTree(state).iterate({
      enter(node) {
        if (out.length >= 50) return false;
        if (node.type.isError) {
          if (completeIncludeAtEof && node.from >= lastLine.from && node.to <= lastLine.to) return false;
          out.push({ from: node.from, to: node.to, severity: 'error', message }); return false;
        }
        return undefined;
      },
    });
    return out;
  };
}
