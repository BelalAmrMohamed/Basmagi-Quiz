# Live-render markdown editor — first-pass result & recommendation

Plan: [live-render-md-prompt.md](live-render-md-prompt.md)

## What was built (prototype, one block type, one editor)

The lesson editor's plain `markdown` block (`create-lesson.js`) now has a third
tab, **مباشر (Live)**, next to كتابة / معاينة:

- Textarea and rendered preview are shown side by side (stacked under 720px).
- The preview re-renders with `renderMarkdown()` on a 120 ms debounce and skips
  the render when the value is unchanged.
- The preview follows the caret (caret position / text length mapped onto the
  preview scroll range) and mirrors textarea scrolling.
- Opt-in: write/preview behave exactly as before. Picking Live (or switching
  back to Write) is remembered in `localStorage` (`lesson_editor_md_live`) so
  new blocks open in the last-used editing mode.
- Code: `setupLiveMdPreview`, `setMdMode`, `readLiveMdPreference` in
  `create-lesson.js`; `.lesson-md-editor--live` rules in `create-lesson.css`.

## Re-validation of the "no contenteditable" reasoning

Agreed. Storage is a plain markdown string everywhere (`lessons.content`, quiz
fields, export), so a rich-DOM editor needs a markdown ⇄ DOM converter or a
second representation, and `replaceTextareaRange`'s native-undo trick only
works on a real `<textarea>`. No disagreement.

## Why this is the split view and not Typora-style inline rendering

True inline live-preview (syntax rendered, source revealed at the caret) needs
a decoration layer over a text model (CodeMirror 6 / ProseMirror). Overlaying
rendered HTML on a textarea does not work: headings, lists, KaTeX and code
blocks change line heights, so the caret drifts from the text. This repo has
no build step, so adopting CodeMirror means vendoring it or adding a bundling
step, plus writing a markdown→decoration mapping that duplicates
`renderMarkdown()`'s rules for `==highlight==`, `$...$` and RTL handling.
That is the real cost, and it is a separate decision. The split view captures
most of the latency win (no click to see the result) with none of that risk.

## Verification

- **Ctrl+Z**: the live layer never assigns `textarea.value` and never calls
  `setSelectionRange`; it only reads the value and writes the preview's
  `innerHTML`. `replaceTextareaRange` and the toolbar paths are untouched, so
  native undo is unchanged. Toolbar actions dispatch `input`, which the live
  preview already listens for.
- **Export boundary**: nothing in `markdown.js` or `export-to-quiz.js` was
  changed; `renderMarkdown()`'s output shape is identical, so the `.toString()`
  serialization block does not need updating.
- **LaTeX / highlight / RTL**: the pane uses the same `renderMarkdown()` call
  and `.md-content` classes as the existing preview, so all three go through
  the same code path.
- **Not run in a browser here.** The checks above are by code reading and a
  syntax check; click through it in Chrome (type, undo/redo, toolbar buttons,
  Arabic and `$x^2$` content, narrow viewport) before merging.

## Recommendation for rollout

1. **Other `.md-source` fields (question prompt, options, explanation, model
   answer)**: do not use side-by-side. These are 1–4 row fields, and a split
   pane in an option row wastes space. Instead, show a single read-only
   rendered strip directly under the field while it is focused (same debounce,
   same `renderMarkdown`), hidden when blurred. Factor
   `setupLiveMdPreview` so it takes a `layout: "split" | "below"` option
   rather than copying it.
2. **Quiz title / description and lesson title / description**: leave as is;
   they are short and rarely contain heavy syntax.
3. **create-quiz.js**: it uses the same `.md-source` contract. Once the
   helper is moved to a shared module (for example
   `shared/live-md-preview.js`, editor-only, never serialized into exports),
   adopt it there with the same opt-in flag. Do that only after the lesson
   version has had real use.
4. **Only then consider inline rendering.** If authors still find split view
   too slow, prototype CodeMirror 6 in a single block behind a flag, with the
   markdown string remaining the source of truth.
