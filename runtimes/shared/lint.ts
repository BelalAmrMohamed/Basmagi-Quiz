// =============================================================================
// runtimes/shared/lint.ts
// Live linting for the notebook editor. The engine supplies `editor.lint(state)`;
// this file only wires it into @codemirror/lint (debounced) and adds the gutter.
// No language knowledge lives here.
// =============================================================================
import type { Extension } from '@codemirror/state';
import { linter, lintGutter, type Diagnostic } from '@codemirror/lint';
import type { EditorState } from '@codemirror/state';

export const LINT_DELAY_MS = 300;
const MAX_DIAGNOSTICS = 25;

/** Clamp a range into the document and make sure it covers at least one character. */
export function normalizeDiagnostic(state: EditorState, d: Diagnostic): Diagnostic {
  const len = state.doc.length;
  let from = Math.max(0, Math.min(d.from, len));
  let to = Math.max(from, Math.min(d.to, len));
  if (to === from) {
    if (to < len && state.doc.sliceString(to, to + 1) !== '\n') to += 1;
    else if (from > 0) from -= 1;
  }
  return { ...d, from, to };
}

export function editorLint(lint: ((state: EditorState) => Diagnostic[]) | undefined): Extension {
  if (!lint) return [];
  return [
    linter((view) => {
      try {
        const seen = new Set<number>();
        return lint(view.state)
          .map((d) => normalizeDiagnostic(view.state, d))
          .filter((d) => (seen.has(d.from) ? false : (seen.add(d.from), true)))
          .slice(0, MAX_DIAGNOSTICS);
      } catch { return []; }
    }, { delay: LINT_DELAY_MS }),
    lintGutter(),
  ];
}
