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

export const MARKDOWN_CSS = `
          /* ── Markdown + KaTeX (mirrored from create-quiz) ── */
          .ltr { direction: ltr; }
          .md-content, .question-text, .option-label, .feedback, .explanation-body, .formal-answer, .formal-answer-text { overflow-wrap: break-word; word-break: break-word; min-width: 0; }
          .md-h1, .md-h2, .md-h3, .md-h4, .md-h5, .md-h6 { margin: 0.6em 0 0.3em; color: var(--color-text-primary); line-height: 1.3; }
          .md-h1 { font-size: 1.6em; border-bottom: 2px solid var(--color-border); padding-bottom: 4px; }
          .md-h2 { font-size: 1.35em; border-bottom: 1px solid var(--color-border); padding-bottom: 3px; }
          .md-h3 { font-size: 1.15em; }
          .md-h4 { font-size: 1.05em; }
          .md-h5 { font-size: 0.95em; }
          .md-h6 { font-size: 0.9em; opacity: 0.85; }
          .md-hr { border: none; border-top: 2px solid var(--color-border); margin: 0.8em 0; }
          .md-blockquote { border-right: 4px solid var(--color-primary); margin: 0.5em 0; padding: 8px 16px; background: var(--color-primary-light); border-radius: 0 6px 6px 0; color: var(--color-text-secondary); font-style: italic; }
          .md-list { margin: 0.4em 0 0.4em 1.4em; padding: 0; color: var(--color-text-primary); }
          .md-list li { margin-bottom: 4px; line-height: 1.6; }
          .md-link { color: var(--color-primary); text-decoration: underline; text-underline-offset: 2px; }
          .md-img { max-width: 100%; height: auto; border-radius: 6px; margin: 4px 0; display: block; }
          .math-block, .katex-display { display: block; overflow-x: auto; -webkit-overflow-scrolling: touch; padding: 10px 0; text-align: center; font-size: 1.05em; max-width: 100%; }
          .math-inline { display: inline; }
          .math-raw { font-family: var(--font-mono, "Courier New", Courier, monospace); font-size: 0.92em; background: var(--color-background); border: 1px solid var(--color-border); border-radius: 4px; padding: 1px 5px; color: var(--color-text-primary); }
          .inline-code { font-family: var(--font-mono, "SF Mono", "Fira Code", Consolas, monospace); font-size: 0.88em; background: var(--color-background-secondary, rgba(99, 102, 241, 0.1)); border: 1px solid var(--color-border); border-radius: 5px; padding: 1px 6px; color: var(--color-primary, #6366f1); white-space: normal; word-break: break-all; }
          [data-theme="dark"] .inline-code, [data-theme="dark-slate"] .inline-code { background: rgba(203, 166, 247, 0.15); color: #cba6f7; }
          .code-block-wrapper { position: relative; margin: 14px 0; direction: ltr; border-radius: 12px; background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.1); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08), var(--shadow-sm, 0 1px 3px rgba(0, 0, 0, 0.1)); overflow: hidden; }
          .code-lang-label { position: absolute; top: 10px; left: 14px; font-family: var(--font-mono, "SF Mono", "Fira Code", Consolas, monospace); font-size: 0.68rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--color-text-secondary, #94a3b8); opacity: 0.7; pointer-events: none; user-select: none; }
          .copy-code-btn { position: absolute; top: 8px; right: 10px; display: inline-flex; align-items: center; gap: 5px; padding: 5px 10px; border-radius: 8px; cursor: pointer; font-size: 0.72rem; font-weight: 600; line-height: 1; letter-spacing: 0.02em; background: rgba(255, 255, 255, 0.1); border: 1px solid rgba(255, 255, 255, 0.18); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.14), 0 2px 8px rgba(0, 0, 0, 0.14); color: var(--color-text-secondary, #94a3b8); transition: background 0.18s ease, color 0.18s ease, box-shadow 0.18s ease, transform 0.12s ease; opacity: 0; z-index: 2; }
          .copy-code-btn .copy-label { font-family: "Inter", "Tajawal", sans-serif; }
          .code-block-wrapper:hover .copy-code-btn { opacity: 1; }
          .copy-code-btn:hover { background: rgba(255, 255, 255, 0.18); color: var(--color-text-primary, #1e1e2e); box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.22), 0 4px 12px rgba(0, 0, 0, 0.18); transform: translateY(-1px); }
          .copy-code-btn:active { transform: translateY(0); }
          .copy-code-btn.copied { opacity: 1; background: rgba(16, 185, 129, 0.18); border-color: rgba(16, 185, 129, 0.4); color: var(--color-success, #10b981); box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12), 0 0 0 3px rgba(16, 185, 129, 0.12); }
          .code-block { background: var(--color-background-secondary, #1a1a2e); border: none; border-radius: 12px; padding: 36px 16px 14px; margin: 0; overflow-x: auto; -webkit-overflow-scrolling: touch; max-width: 100%; font-family: var(--font-mono, "SF Mono", "Fira Code", "Cascadia Code", Consolas, monospace); font-size: 0.9rem; line-height: 1.6; white-space: pre; text-align: left; }
          .code-block code { background: none; padding: 0; border-radius: 0; font-size: inherit; color: var(--color-code, #e2e8f0); }
          [data-theme="light"] .code-block-wrapper { background: rgba(0, 0, 0, 0.03); border-color: rgba(0, 0, 0, 0.08); box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.6), var(--shadow-sm, 0 1px 3px rgba(0, 0, 0, 0.08)); }
          [data-theme="light"] .copy-code-btn { background: rgba(0, 0, 0, 0.06); border-color: rgba(0, 0, 0, 0.12); color: var(--color-text-secondary, #64748b); box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.8), 0 2px 6px rgba(0, 0, 0, 0.06); }
          [data-theme="light"] .copy-code-btn:hover { background: rgba(0, 0, 0, 0.1); color: var(--color-text-primary, #0f172a); }
          [data-theme="light"] .code-block { background: #f8f9fb; }
          [data-theme="light"] .code-block code { color: #334155; }
          [data-theme="dark"] .code-block code, [data-theme="dark-slate"] .code-block code { color: var(--color-code, #e2e8f0); }
          .md-table-wrapper { width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch; margin: 16px 0; border-radius: 14px; background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.12); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1), var(--shadow-md, 0 4px 6px rgba(0, 0, 0, 0.07)); background-image: linear-gradient(to left, rgba(255, 255, 255, 0.06) 20%, transparent), linear-gradient(to right, rgba(255, 255, 255, 0.06) 20%, transparent), radial-gradient(farthest-side at 100% 50%, rgba(0, 0, 0, 0.12), transparent), radial-gradient(farthest-side at 0% 50%, rgba(0, 0, 0, 0.12), transparent); background-size: 40px 100%, 40px 100%, 12px 100%, 12px 100%; background-position: right, left, right, left; background-repeat: no-repeat; background-attachment: local, local, scroll, scroll; background-color: rgba(255, 255, 255, 0.06); }
          .md-table { min-width: max-content; width: 100%; border-collapse: collapse; font-size: 0.9rem; line-height: 1.55; direction: ltr; text-align: left; }
          .md-table thead tr { background: rgba(99, 102, 241, 0.1); border-bottom: 2px solid rgba(99, 102, 241, 0.22); }
          .md-table th { padding: 11px 16px; font-weight: 700; color: var(--color-text-primary); white-space: nowrap; letter-spacing: 0.01em; box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1); }
          .md-table td { padding: 10px 16px; vertical-align: top; white-space: normal; min-width: 90px; overflow-wrap: break-word; border-bottom: 1px solid rgba(255, 255, 255, 0.06); }
          .md-table tbody tr:nth-child(even) { background: var(--color-background-secondary, rgba(0, 0, 0, 0.025)); }
          .md-table tbody tr { transition: background 0.14s ease, box-shadow 0.14s ease; }
          .md-table tbody tr:hover { background: rgba(99, 102, 241, 0.07); box-shadow: inset 0 0 0 1px rgba(99, 102, 241, 0.12); }
          .md-table tbody tr:last-child td { border-bottom: none; }
          [data-theme="light"] .md-table-wrapper { background: rgba(0, 0, 0, 0.02); border-color: rgba(0, 0, 0, 0.08); background-image: linear-gradient(to left, rgba(0, 0, 0, 0.02) 20%, transparent), linear-gradient(to right, rgba(0, 0, 0, 0.02) 20%, transparent), radial-gradient(farthest-side at 100% 50%, rgba(0, 0, 0, 0.08), transparent), radial-gradient(farthest-side at 0% 50%, rgba(0, 0, 0, 0.08), transparent); background-size: 40px 100%, 40px 100%, 12px 100%, 12px 100%; background-position: right, left, right, left; background-repeat: no-repeat; background-attachment: local, local, scroll, scroll; background-color: rgba(0, 0, 0, 0.02); box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.8), var(--shadow-sm, 0 1px 3px rgba(0, 0, 0, 0.06)); }
          [data-theme="light"] .md-table thead tr { background: rgba(99, 102, 241, 0.07); border-bottom-color: rgba(99, 102, 241, 0.18); }
          [data-theme="light"] .md-table td { border-bottom-color: rgba(0, 0, 0, 0.05); }
          [data-theme="light"] .md-table tbody tr:nth-child(even) { background: rgba(0, 0, 0, 0.025); }
          [data-theme="light"] .md-table tbody tr:hover { background: rgba(99, 102, 241, 0.05); box-shadow: inset 0 0 0 1px rgba(99, 102, 241, 0.1); }
          [data-theme="dark-slate"] .md-table thead tr { background: rgba(99, 102, 241, 0.14); border-bottom-color: rgba(99, 102, 241, 0.28); }
          [data-theme="dark"] .md-table th, [data-theme="dark-slate"] .md-table th { background: rgba(99, 102, 241, 0.14); }
          [data-theme="dark"] .md-table tbody tr:nth-child(even), [data-theme="dark-slate"] .md-table tbody tr:nth-child(even) { background: rgba(255, 255, 255, 0.04); }
          [data-theme="dark"] .md-table tbody tr:hover, [data-theme="dark-slate"] .md-table tbody tr:hover { background: rgba(99, 102, 241, 0.09); }
          [data-theme="dark"] .md-table-wrapper, [data-theme="dark-slate"] .md-table-wrapper { background: linear-gradient(to left, var(--color-background) 20%, transparent) right, linear-gradient(to right, var(--color-background) 20%, transparent) left, radial-gradient(farthest-side at 100% 50%, rgba(255, 255, 255, 0.07), transparent) right, radial-gradient(farthest-side at 0% 50%, rgba(255, 255, 255, 0.07), transparent) left; background-color: var(--color-background); background-repeat: no-repeat; background-size: 40px 100%, 40px 100%, 10px 100%, 10px 100%; background-attachment: local, local, scroll, scroll; }
          @media (max-width: 480px) {
            .copy-code-btn { opacity: 1; }
            .code-block { font-size: 0.8rem; padding: 34px 12px 12px; }
            .md-table th, .md-table td { padding: 8px 12px; font-size: 0.85rem; }
          }`;
