// VS Code–style indent guides: every indentation level of a line gets a thin vertical line.
//
// A line indented by N levels gets N guides, at columns 0, unit, 2·unit … (N-1)·unit, so the
// guides line up with the start of the enclosing block exactly like in VS Code. Blank lines
// take the smaller level of their nearest non-blank neighbours so the lines run unbroken
// through empty lines inside a block, but stop at the end of it.
import { getIndentUnit } from '@codemirror/language';
import { countColumn, RangeSetBuilder } from '@codemirror/state';
import type { EditorState, Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin } from '@codemirror/view';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';

/** Indent level of every line (0-based list, one entry per document line). */
export function indentLevels(lines: string[], tabSize: number, unit: number): number[] {
  const u = Math.max(1, unit);
  const levels: (number | null)[] = lines.map(text => (text.trim() === '' ? null : Math.floor(countColumn(text.match(/^[ \t]*/)![0], tabSize) / u)));
  const out: number[] = new Array(lines.length).fill(0);
  let prev = 0;
  const prevLevel: number[] = [];
  for (let i = 0; i < levels.length; i++) { if (levels[i] !== null) prev = levels[i]!; prevLevel[i] = prev; }
  let next = 0;
  for (let i = levels.length - 1; i >= 0; i--) {
    if (levels[i] !== null) { next = levels[i]!; out[i] = levels[i]!; } else out[i] = Math.min(prevLevel[i], next);
  }
  return out;
}

function build(state: EditorState): DecorationSet {
  const tabSize = state.tabSize;
  const unit = getIndentUnit(state);
  const doc = state.doc;
  const lines: string[] = [];
  for (let i = 1; i <= doc.lines; i++) lines.push(doc.line(i).text);
  const levels = indentLevels(lines, tabSize, unit);
  const builder = new RangeSetBuilder<Decoration>();
  for (let i = 0; i < levels.length; i++) {
    if (!levels[i]) continue;
    builder.add(doc.line(i + 1).from, doc.line(i + 1).from, Decoration.line({
      class: 'cm-indent-guides',
      attributes: { style: `--ig-n:${levels[i]};--ig-unit:${unit}` },
    }));
  }
  return builder.finish();
}

const plugin = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) { this.decorations = build(view.state); }
  update(update: ViewUpdate) { if (update.docChanged) this.decorations = build(update.state); }
}, { decorations: instance => instance.decorations });

const theme = EditorView.baseTheme({
  '.cm-line.cm-indent-guides': {
    backgroundImage: 'repeating-linear-gradient(to right, var(--ig-color, rgba(128,128,128,.35)) 0 1px, transparent 1px calc(var(--ig-unit) * 1ch))',
    backgroundSize: 'calc(var(--ig-n) * var(--ig-unit) * 1ch) 100%',
    backgroundRepeat: 'no-repeat',
    // `.cm-line` has horizontal padding; the first guide sits on the first column of text.
    backgroundOrigin: 'content-box',
  },
});

export function indentGuides(): Extension { return [plugin, theme]; }
