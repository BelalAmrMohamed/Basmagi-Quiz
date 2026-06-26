// src/shared/markdown-css.js
//
// Shared CSS for markdown / KaTeX rendering, mirrored from create-quiz.
// Imported by export-to-html.js and export-to-quiz.js and interpolated
// directly into the <style> tag of each generated standalone HTML file.
//
// ── What is NOT in this module ───────────────────────────────────────────────
// The :root variable mappings that wire --color-primary, --color-border, etc.
// to the host document's design tokens differ between the two consumers:
//
//   export-to-html  → hardcoded dark-theme hex values  (e.g. --color-primary: #3b82f6)
//   export-to-quiz  → references to quiz design tokens (e.g. --color-primary: var(--info))
//
// Those per-context :root blocks (and the [data-theme="dark"] override in
// export-to-quiz that re-sets --color-code) therefore remain in each file.
//
// ── font-family note ─────────────────────────────────────────────────────────
// Four rules below reference --font-mono with a CSS fallback stack.
// • export-to-quiz defines --font-mono in its design-token :root block, so
//   the var() resolves to that value — no behavioural change.
// • export-to-html does not define --font-mono, so the CSS fallback stack
//   kicks in — identical to what those rules contained before this refactor.

export const MARKDOWN_CSS = `/* ── Markdown + KaTeX (mirrored from create-quiz) ── */
.ltr {
  direction: ltr;
}

.md-content,
.question-text,
.option-label,
.feedback,
.explanation-body,
.formal-answer,
.formal-answer-text {
  overflow-wrap: break-word;
  word-break: break-word;
  min-width: 0;
}

.md-h1,
.md-h2,
.md-h3,
.md-h4,
.md-h5,
.md-h6 {
  margin: 0.6em 0 0.3em;
  color: var(--color-text-primary);
  line-height: 1.3;
}

.md-h1 {
  font-size: 1.6em;
  border-bottom: 2px solid var(--color-border);
  padding-bottom: 4px;
}

.md-h2 {
  font-size: 1.35em;
  border-bottom: 1px solid var(--color-border);
  padding-bottom: 3px;
}

.md-h3 {
  font-size: 1.15em;
}

.md-h4 {
  font-size: 1.05em;
}

.md-h5 {
  font-size: 0.95em;
}

.md-h6 {
  font-size: 0.9em;
  opacity: 0.85;
}

.md-hr {
  border: none;
  border-top: 2px solid var(--color-border);
  margin: 0.8em 0;
}

.md-blockquote {
  border-right: 4px solid var(--color-primary);
  margin: 0.5em 0;
  padding: 8px 16px;
  background: var(--color-primary-light);
  border-radius: 0 6px 6px 0;
  color: var(--color-text-secondary);
  font-style: italic;
}

.md-list {
  margin: 0.4em 0 0.4em 1.4em;
  padding: 0;
  color: var(--color-text-primary);
}

.md-list li {
  margin-bottom: 4px;
  line-height: 1.6;
}

.md-link {
  color: var(--color-primary);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.md-img {
  max-width: 100%;
  height: auto;
  border-radius: 6px;
  margin: 4px 0;
  display: block;
}

.math-block,
.katex-display {
  display: block;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  padding: 10px 0;
  text-align: center;
  font-size: 1.05em;
  max-width: 100%;
}

.math-inline {
  display: inline;
}

.math-raw {
  font-family: var(--font-mono, "Courier New", Courier, monospace);
  font-size: 0.92em;
  background: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  padding: 1px 5px;
  color: var(--color-text-primary);
}

.inline-code {
  font-family: var(--font-mono, "SF Mono", "Fira Code", Consolas, monospace);
  font-size: 0.88em;
  background: var(--color-background-secondary, rgba(99, 102, 241, 0.1));
  border: 1px solid var(--color-border);
  border-radius: 5px;
  padding: 1px 6px;
  color: var(--color-primary, #6366f1);
  white-space: normal;
  word-break: break-all;
}

[data-theme="dark"] .inline-code,
[data-theme="dark-slate"] .inline-code {
  background: rgba(203, 166, 247, 0.15);
  color: #cba6f7;
}

.code-block-wrapper {
  display: grid;
  /* FIX: 3-column layout ensures a dedicated middle spacer column that prevents overlap */
  grid-template-columns: auto 1fr auto;
  grid-template-rows: auto 1fr;
  margin: 20px 0;
  /* FIX: Strictly lock the physical grid coordinates regardless of parent document direction */
  direction: ltr !important;
  border-radius: 10px;
  background: #121214;
  border: 1px solid #2d2d34;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35);
  position: relative;
  max-height: 500px;
  overflow: hidden;
}

/* Distinct Code-Editor Header Bar Background */
.code-block-wrapper::before {
  content: "";
  /* FIX: Spans across all 3 structural columns */
  grid-column: 1 / span 3;
  grid-row: 1;
  height: 38px;
  background: #1c1c1f;
  border-bottom: 1px solid #2d2d34;
  z-index: 1;
}

/* Language Badge */
.code-lang-label {
  grid-column: 1; /* Locked to the left-most column box */
  grid-row: 1;
  z-index: 2;
  align-self: center;
  /* FIX: Insulation package against global text-align or direction resets */
  justify-self: start;
  text-align: left !important;
  direction: ltr !important;
  padding-left: 16px;
  padding-right: 8px;
  font-family: "SF Mono", "Fira Code", "JetBrains Mono", Consolas, monospace;
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: #9b9ba6;
  user-select: none;
  pointer-events: none;
}

/* Copy Button — Refined Editor Utility */
.copy-code-btn {
  grid-column: 3; /* Locked to the right-most column box */
  grid-row: 1;
  z-index: 2;
  align-self: center;
  justify-self: end;
  margin-right: 12px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.75rem;
  font-weight: 500;
  line-height: 1;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: #9b9ba6;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  opacity: 0;
}

.copy-code-btn .copy-label {
  font-family: "Inter", "Tajawal", sans-serif;
}

.code-block-wrapper:hover .copy-code-btn {
  opacity: 1;
}

.copy-code-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.2);
  color: #ffffff;
}

.copy-code-btn:active {
  transform: scale(0.96);
}

/* "Copied!" Success Confirmation State */
.copy-code-btn.copied {
  opacity: 1 !important;
  background: rgba(16, 185, 129, 0.12);
  border-color: rgba(16, 185, 129, 0.4);
  color: #34d399;
}

/* Scrollable Inner Code Body (<pre>) */
.code-block {
  /* FIX: Spans across all 3 layout columns to maximize horizontal canvas room */
  grid-column: 1 / span 3;
  grid-row: 2;
  margin: 0;
  padding: 16px;
  background: transparent;
  overflow: auto;
  -webkit-overflow-scrolling: touch;
  font-family: "SF Mono", "Fira Code", "JetBrains Mono", Consolas, monospace;
  font-size: 0.88rem;
  line-height: 1.6;
  white-space: pre;
  text-align: left;
  scrollbar-width: thin;
  scrollbar-color: #3a3a44 transparent;
}

/* Custom Scrollbar Tuning for Dark Theme */
.code-block::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}
.code-block::-webkit-scrollbar-track {
  background: transparent;
}
.code-block::-webkit-scrollbar-thumb {
  background: #2d2d34;
  border-radius: 4px;
}
.code-block::-webkit-scrollbar-thumb:hover {
  background: #3a3a44;
}

.code-block code {
  background: none;
  padding: 0;
  border-radius: 0;
  font-size: inherit;
  color: #e3e3e6;
}

/* ── Custom High-Performance Token Highlighting (Dark Theme) ── */
.sh-comment   { color: #636370; font-style: italic; }
.sh-keyword   { color: #ff79c6; font-weight: 600; }
.sh-string    { color: #50fa7b; }
.sh-number    { color: #bd93f9; }
.sh-type      { color: #8be9fd; }
.sh-function  { color: #ffb86c; }
.sh-property  { color: #f1fa8c; }
.sh-builtin   { color: #8be9fd; font-style: italic; }
.sh-operator  { color: #ff79c6; }
.sh-variable  { color: #f8f8f2; }
.sh-tag       { color: #ff79c6; }
.sh-attr      { color: #50fa7b; }


/* ══════════════════════════════════════════════════════════════════════════════
   LIGHT THEME ADJUSTMENTS
   ══════════════════════════════════════════════════════════════════════════════ */

[data-theme="light"] .code-block-wrapper {
  background: #f8f9fa;
  border-color: #e1e1e6;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.06);
}

[data-theme="light"] .code-block-wrapper::before {
  background: #edf0f2;
  border-bottom-color: #e1e1e6;
}

[data-theme="light"] .code-lang-label {
  color: #62626a;
}

[data-theme="light"] .copy-code-btn {
  background: rgba(0, 0, 0, 0.04);
  border-color: rgba(0, 0, 0, 0.08);
  color: #62626a;
}

[data-theme="light"] .code-block code {
  color: #24292e;
}

[data-theme="light"] .code-block::-webkit-scrollbar-thumb {
  background: #d1d1d6;
}

/* Custom Token Highlighting (Light Theme) */
[data-theme="light"] .sh-comment   { color: #8e908c; font-style: italic; }
[data-theme="light"] .sh-keyword   { color: #a71d5d; font-weight: 600; }
[data-theme="light"] .sh-string    { color: #183691; }
[data-theme="light"] .sh-number    { color: #0086b3; }
[data-theme="light"] .sh-type      { color: #795da3; }
[data-theme="light"] .sh-function  { color: #795da3; }
[data-theme="light"] .sh-property  { color: #0086b3; }
[data-theme="light"] .sh-builtin   { color: #ed6a43; }
[data-theme="light"] .sh-operator  { color: #a71d5d; }
[data-theme="light"] .sh-tag       { color: #63a35c; }
[data-theme="light"] .sh-attr      { color: #795da3; }

.md-table-wrapper {
  width: 100%;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  margin: 16px 0;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1), var(--shadow-md, 0 4px 6px rgba(0, 0, 0, 0.07));
  background-image: linear-gradient(to left, rgba(255, 255, 255, 0.06) 20%, transparent), linear-gradient(to right, rgba(255, 255, 255, 0.06) 20%, transparent), radial-gradient(farthest-side at 100% 50%, rgba(0, 0, 0, 0.12), transparent), radial-gradient(farthest-side at 0% 50%, rgba(0, 0, 0, 0.12), transparent);
  background-size: 40px 100%, 40px 100%, 12px 100%, 12px 100%;
  background-position: right, left, right, left;
  background-repeat: no-repeat;
  background-attachment: local, local, scroll, scroll;
  background-color: rgba(255, 255, 255, 0.06);
}

.md-table {
  min-width: max-content;
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
  line-height: 1.55;
  direction: ltr;
  text-align: left;
}

.md-table thead tr {
  background: rgba(99, 102, 241, 0.1);
  border-bottom: 2px solid rgba(99, 102, 241, 0.22);
}

.md-table th {
  padding: 11px 16px;
  font-weight: 700;
  color: var(--color-text-primary);
  white-space: nowrap;
  letter-spacing: 0.01em;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1);
}

.md-table td {
  padding: 10px 16px;
  vertical-align: top;
  white-space: normal;
  min-width: 90px;
  overflow-wrap: break-word;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.md-table tbody tr:nth-child(even) {
  background: var(--color-background-secondary, rgba(0, 0, 0, 0.025));
}

.md-table tbody tr {
  transition: background 0.14s ease, box-shadow 0.14s ease;
}

.md-table tbody tr:hover {
  background: rgba(99, 102, 241, 0.07);
  box-shadow: inset 0 0 0 1px rgba(99, 102, 241, 0.12);
}

.md-table tbody tr:last-child td {
  border-bottom: none;
}

[data-theme="light"] .md-table-wrapper {
  background: rgba(0, 0, 0, 0.02);
  border-color: rgba(0, 0, 0, 0.08);
  background-image: linear-gradient(to left, rgba(0, 0, 0, 0.02) 20%, transparent), linear-gradient(to right, rgba(0, 0, 0, 0.02) 20%, transparent), radial-gradient(farthest-side at 100% 50%, rgba(0, 0, 0, 0.08), transparent), radial-gradient(farthest-side at 0% 50%, rgba(0, 0, 0, 0.08), transparent);
  background-size: 40px 100%, 40px 100%, 12px 100%, 12px 100%;
  background-position: right, left, right, left;
  background-repeat: no-repeat;
  background-attachment: local, local, scroll, scroll;
  background-color: rgba(0, 0, 0, 0.02);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.8), var(--shadow-sm, 0 1px 3px rgba(0, 0, 0, 0.06));
}

[data-theme="light"] .md-table thead tr {
  background: rgba(99, 102, 241, 0.07);
  border-bottom-color: rgba(99, 102, 241, 0.18);
}

[data-theme="light"] .md-table td {
  border-bottom-color: rgba(0, 0, 0, 0.05);
}

[data-theme="light"] .md-table tbody tr:nth-child(even) {
  background: rgba(0, 0, 0, 0.025);
}

[data-theme="light"] .md-table tbody tr:hover {
  background: rgba(99, 102, 241, 0.05);
  box-shadow: inset 0 0 0 1px rgba(99, 102, 241, 0.1);
}

[data-theme="dark-slate"] .md-table thead tr {
  background: rgba(99, 102, 241, 0.14);
  border-bottom-color: rgba(99, 102, 241, 0.28);
}

[data-theme="dark"] .md-table th,
[data-theme="dark-slate"] .md-table th {
  background: rgba(99, 102, 241, 0.14);
}

[data-theme="dark"] .md-table tbody tr:nth-child(even),
[data-theme="dark-slate"] .md-table tbody tr:nth-child(even) {
  background: rgba(255, 255, 255, 0.04);
}

[data-theme="dark"] .md-table tbody tr:hover,
[data-theme="dark-slate"] .md-table tbody tr:hover {
  background: rgba(99, 102, 241, 0.09);
}

[data-theme="dark"] .md-table-wrapper,
[data-theme="dark-slate"] .md-table-wrapper {
  background: linear-gradient(to left, var(--color-background) 20%, transparent) right, linear-gradient(to right, var(--color-background) 20%, transparent) left, radial-gradient(farthest-side at 100% 50%, rgba(255, 255, 255, 0.07), transparent) right, radial-gradient(farthest-side at 0% 50%, rgba(255, 255, 255, 0.07), transparent) left;
  background-color: var(--color-background);
  background-repeat: no-repeat;
  background-size: 40px 100%, 40px 100%, 10px 100%, 10px 100%;
  background-attachment: local, local, scroll, scroll;
}

@media (max-width: 480px) {
  .copy-code-btn {
    opacity: 1;
  }

  .code-block {
    font-size: 0.8rem;
    padding: 34px 12px 12px;
  }

  .md-table th,
  .md-table td {
    padding: 8px 12px;
    font-size: 0.85rem;
  }
}`;
