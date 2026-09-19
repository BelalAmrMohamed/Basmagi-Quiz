I'm continuing work on a quiz app (basmagi-quiz). This is an EXPLORATION /
prototyping task, not a locked spec — read everything below, then propose an
approach before writing a lot of code.

CONTEXT — read these files first:
1. `public/src/shared/markdown.js` + `markdown-css.js` — the shared rendering
   engine (Markdown + LaTeX via KaTeX + `==highlight==` + RTL/LTR detection).
   `renderMarkdown()` is the entry point; used in 15+ call sites app-wide.
2. `public/src/features/create-lesson/create-lesson.js` — search for
   `mdEditorHtml`, `setupMdField`, `replaceTextareaRange`. This is the
   textarea-based write/preview toggle pattern (`.md-source` textarea +
   `.wp-preview-pane` sibling, switched via `setMdMode('write'|'preview')`).
   `create-quiz.js` uses the identical pattern (same `.md-source` class, same
   toggle) — the two files don't share code but do share this UX contract.
3. `public/src/features/export-quiz/export-to-quiz.js` — search for
   `.toString()`. This file `.toString()`-serializes several `markdown.js`
   functions verbatim into standalone offline quiz HTML exports, so the
   export has no build step and no dependency on the live app. ⚠️ Any
   function you touch or add that markdown.js exports and that
   export-to-quiz.js already serializes MUST be updated in that
   serialization block too, in the same dependency order, or exported
   quizzes throw `ReferenceError`s at open time. Grep `.toString()` in that
   file before assuming any markdown-engine change is self-contained. If
   your change is editor-only (never runs inside a rendered lesson/quiz
   export, e.g. an editor-side live-preview mechanism that doesn't touch
   `renderMarkdown()`'s actual output shape), it doesn't need to touch this
   file — but confirm that boundary explicitly before skipping it.

GOAL: reduce the perceived complexity/latency of writing Markdown+LaTeX+
highlight-syntax content in `create-lesson.js`/`create-quiz.js`'s editors.
The person tried the raw idea of a Google-Docs-style contenteditable rich-text
editor and we (a prior session) recommended AGAINST that — reasoning below —
in favor of a smaller "render while typing, in the same field" approach.
Re-derive/re-validate this reasoning yourself rather than taking it on faith;
flag if you disagree.

WHY NOT full contenteditable rich-text (do not silently reopen this):
- Storage format is a plain markdown string end-to-end: `lessons.content`
  jsonb, quiz question/option/explanation fields, the export serialization
  above, and every render call site. A contenteditable/rich-DOM model needs
  a bidirectional markdown ⇄ DOM converter (a real, ongoing maintenance
  surface) or a second parallel content representation — the lessons plan
  (`docs/plans/lessons-feature-plan.md`, Phase 2 step 7) explicitly told a
  prior phase not to fork a lesson-only copy of the markdown engine; forking
  the storage model itself is the same mistake one level up.
- Existing undo-safety infrastructure (`replaceTextareaRange`'s
  `execCommand("insertText")` trick, documented in create-lesson.js/
  create-quiz.js as "why not just set ta.value") is built around a plain
  `<textarea>`. A contenteditable rewrite means re-solving cursor/selection/
  native-undo problems from scratch in a messier surface (rich DOM mutation
  instead of a string).

DIRECTION TO EXPLORE INSTEAD — live-render in place, keep markdown as source
of truth:
- The textarea stays the real input / source of truth (zero storage/export/
  schema impact — `block.body = value` on input, same as today).
- Investigate a "live preview" mode (Typora/Obsidian-style): syntax renders
  as styled text inline, but the raw markdown source reveals itself right
  around the cursor's current line/token so the user can still edit the
  syntax directly. This is usually built as a CodeMirror/ProseMirror
  decoration layer over a plain-text document model — NOT full contenteditable
  rich text — so the underlying value is still one plain string at all times.
- A cheaper intermediate step, if the full live-preview turns out too
  complex for the time budget: shrink perceived latency without touching the
  render model at all — e.g. a persistent side-by-side split (both panes
  visible simultaneously, synced scroll) instead of the current click-to-
  toggle write/preview tabs, or auto-switching to preview on a short idle
  debounce. Cheap, reversible, no architecture risk — a good fallback if the
  live-preview approach doesn't pan out in the time available.
- If a true inline-render approach is pursued: consider a scoped
  contenteditable per BLOCK (not a whole-document rich editor) that
  re-renders its own innerHTML from the shadow textarea's value on a
  debounce, with the real plain `<textarea>` still the actual input target
  underneath/behind it (visually hidden or overlaid) — this keeps storage as
  plain markdown while giving the "type and see it formatted right there"
  feel. Prototype this in isolation (a throwaway single block type, e.g. just
  the lesson's `markdown` block) before touching every field type
  (question prompt/options/explanation, quiz description, etc.) — don't
  refactor every `.md-source` call site in the first pass.

CONSTRAINTS:
- Must not break the write/preview toggle for any existing caller until/
  unless it's deliberately replaced everywhere — treat this as additive/
  opt-in first, not a global rip-and-replace, so a half-finished
  exploration can be reverted cleanly.
- Must not weaken the native-undo guarantees `replaceTextareaRange` exists
  for. Whatever you build, verify Ctrl+Z still works character-by-character
  inside a field exactly as it does today.
- LaTeX (`$...$`, KaTeX), `==highlight==`, and RTL/LTR auto-detection all
  need to keep working in whatever live-render surface you build — these are
  not optional legacy syntax, they're active product features exercised by
  create-lesson.js's own editor today.
- Minimum browser support: Chrome (per `md-engine-prompt.md`'s existing
  constraint for this codebase — reuse that constraint here too).
- Do not touch `export-to-quiz.js`'s serialization block unless your change
  actually affects `renderMarkdown()`'s reader-facing output — an editor-only
  live-preview layer that only ever runs inside create-lesson.js/
  create-quiz.js's own editor UI should have no reason to.

DELIVERABLE FOR THIS FIRST PASS: a working prototype on ONE block type in
ONE editor (suggest: the lesson's plain `markdown` block in
create-lesson.js, since it's the simplest single-purpose field), plus a
short written recommendation on whether/how to extend it to every other
`.md-source` field (question prompts, options, explanations, quiz
title/description) and to create-quiz.js. Do not attempt the full rollout in
this pass.
