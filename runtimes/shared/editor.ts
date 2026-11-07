// =============================================================================
// runtimes/shared/editor.ts
// CodeMirror factory shared by every engine: theme, highlight style, line numbers,
// no line wrapping, indentWithTab. Engines contribute language support through
// `engine.editor.extensions()` and optional `completions`.
// =============================================================================
import { EditorState, Prec, type Extension } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { HighlightStyle, bracketMatching, indentOnInput, indentUnit, syntaxHighlighting } from '@codemirror/language';
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { tags } from '@lezer/highlight';
import type { Engine } from './engine';
import { indentGuides } from './indent-guides';

export const highlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--syntax-keyword)', fontWeight: '650' },
  { tag: tags.standard(tags.variableName), color: 'var(--syntax-builtin)', fontWeight: '600' },
  { tag: [tags.typeName, tags.className], color: 'var(--syntax-type)', fontWeight: '600' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: 'var(--syntax-function, var(--syntax-builtin))' },
  { tag: [tags.variableName, tags.propertyName], color: 'var(--syntax-variable)' },
  { tag: [tags.string, tags.character, tags.special(tags.string)], color: 'var(--syntax-string)' },
  { tag: [tags.number, tags.bool], color: 'var(--syntax-number)' },
  { tag: tags.atom, color: 'var(--syntax-constant)', fontWeight: '600' },
  { tag: tags.comment, color: 'var(--syntax-comment)', fontStyle: 'italic' },
  { tag: [tags.operator, tags.punctuation], color: 'var(--syntax-operator)' },
  { tag: tags.invalid, color: 'var(--syntax-error)', textDecoration: 'underline wavy' },
]);

export const editorTheme = EditorView.theme({
  '&': { color: 'var(--ink)', backgroundColor: 'var(--code)', fontSize: '14px' },
  '.cm-content': { fontFamily: 'ui-monospace, "Cascadia Code", Menlo, Consolas, monospace', padding: '12px 0', caretColor: 'var(--accent)' },
  '.cm-line': { padding: '0 14px' },
  '.cm-gutters': { color: 'var(--mute)', backgroundColor: 'var(--code)', border: 'none', borderRight: '1px solid var(--line)' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--accent) 7%, transparent)' },
  '.cm-activeLineGutter': { color: 'var(--ink)', backgroundColor: 'color-mix(in srgb, var(--accent) 7%, transparent)' },
  '.cm-cursor': { borderLeftColor: 'var(--accent)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: 'color-mix(in srgb, var(--ring) 34%, transparent) !important' },
  '.cm-matchingBracket': { color: 'var(--ink)', backgroundColor: 'color-mix(in srgb, var(--run) 20%, transparent)', outline: '1px solid var(--run)' },
  '.cm-nonmatchingBracket': { color: 'var(--syntax-error)' },
});

export type EditorHooks = {
  /** Shift+Enter */ runAdvance(): void;
  /** Ctrl/Cmd+Enter */ runStay(): void;
  /** Escape: leave the editor and enter command mode. */ escape(): void;
  /** Document changed. */ change(src: string, state: EditorState): void;
};

/** Build an editor state. Kept per cell by the shell so undo history survives re-renders. */
export function createEditorState(engine: Engine, doc: string, hooks: EditorHooks): EditorState {
  const { extensions, completions } = engine.editor;
  const base: Extension[] = [
    lineNumbers(), highlightActiveLine(), highlightActiveLineGutter(), drawSelection(),
    history(), indentOnInput(), bracketMatching(), closeBrackets(),
    syntaxHighlighting(highlightStyle),
    editorTheme,
    EditorState.tabSize.of(4),
    // No EditorView.lineWrapping: long lines scroll horizontally so source layout is preserved.
    indentUnit.of('    '),
    indentGuides(),
    completions
      ? autocompletion({ override: Array.isArray(completions) ? completions : [completions], activateOnTyping: true, maxRenderedOptions: 40, icons: true, tooltipClass: () => 'mlweb-complete' })
      : [],
    ...extensions(),
    Prec.highest(keymap.of([
      { key: 'Shift-Enter', run: () => { hooks.runAdvance(); return true; } },
      { key: 'Mod-Enter', run: () => { hooks.runStay(); return true; } },
      { key: 'Escape', run: () => { hooks.escape(); return true; } },
      indentWithTab,
    ])),
    keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...completionKeymap]),
    EditorView.updateListener.of((u) => { if (u.docChanged) hooks.change(u.state.doc.toString(), u.state); }),
  ];
  return EditorState.create({ doc, extensions: base });
}
