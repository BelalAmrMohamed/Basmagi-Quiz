// =============================================================================
// runtimes/shared/indent-guides.ts
// Thin vertical guides at every indent level (one per indent unit). Blank lines take the
// smaller of the surrounding indents so guides run unbroken through gaps. Ported from the
// deployed runtime; colour comes from --ig-color.
// =============================================================================
import { countColumn, RangeSetBuilder, type EditorState, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { getIndentUnit } from '@codemirror/language';

/** Indent level of each line; blank lines inherit min(indent above, indent below). */
export function guideLevels(lines: string[], tabSize: number, unit: number): number[] {
  const u = Math.max(1, unit);
  const own = lines.map((l) => (l.trim() === '' ? null : Math.floor(countColumn(l.match(/^[ \t]*/)![0], tabSize) / u)));
  const above: number[] = [];
  let run = 0;
  for (let i = 0; i < own.length; i++) { if (own[i] !== null) run = own[i]!; above[i] = run; }
  const out = new Array<number>(lines.length).fill(0);
  let below = 0;
  for (let i = own.length - 1; i >= 0; i--) {
    if (own[i] !== null) { below = own[i]!; out[i] = own[i]!; } else out[i] = Math.min(above[i], below);
  }
  return out;
}

function build(state: EditorState): DecorationSet {
  const unit = getIndentUnit(state), doc = state.doc, lines: string[] = [];
  for (let i = 1; i <= doc.lines; i++) lines.push(doc.line(i).text);
  const levels = guideLevels(lines, state.tabSize, unit), b = new RangeSetBuilder<Decoration>();
  levels.forEach((n, i) => {
    if (!n) return;
    const from = doc.line(i + 1).from;
    b.add(from, from, Decoration.line({ class: 'cm-indent-guides', attributes: { style: `--ig-n:${n};--ig-unit:${unit}` } }));
  });
  return b.finish();
}

const plugin = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) { this.decorations = build(view.state); }
  update(u: ViewUpdate) { if (u.docChanged) this.decorations = build(u.state); }
}, { decorations: (p) => p.decorations });

const theme = EditorView.baseTheme({
  '.cm-line.cm-indent-guides': {
    backgroundImage: 'repeating-linear-gradient(to right, var(--ig-color, rgba(128,128,128,.35)) 0 1px, transparent 1px calc(var(--ig-unit) * 1ch))',
    backgroundSize: 'calc(var(--ig-n) * var(--ig-unit) * 1ch) 100%',
    backgroundRepeat: 'no-repeat',
    backgroundOrigin: 'content-box',
  },
});

export const indentGuides = (): Extension => [plugin, theme];
