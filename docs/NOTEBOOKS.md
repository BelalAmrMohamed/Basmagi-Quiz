# Notebooks (MATLAB-style) — implementation notes

Implements docs/plans/matlab-notebook-integration.md.

- DB: `supabase/migrations/20261102100000_notebooks.sql`, `20261102101000_notebooks_trash_and_drafts.sql` (apply in order). Public reads via `notebook_public`.
- API: `api/admin.js` actions list/get/create/update/delete-notebook; move/rename/metadata/trash/restore/cascade handle `notebook`. Batch upload: item `{type:"notebook", notebook:{…record…} | {fileName,text}}` in `api/upload-quiz.js`.
- Shared rules: `checkNotebook` in `public/src/shared/content-rules.js` (+ `npm run sync:mcp` copies it and `notebook-convert.js`).
- Runtime: `npm run build:notebook-runtime` regenerates `public/assets/notebook-runtime/` (commit the output). Mount API: `window.MLWebNotebook.mount({root, baseUrl, notebook, lang})`.
- Pages: `/notebook/:slug-or-id` (notebook.html), `/create-notebook` (admin; supports `?draft=` and `?edit=`).
- Seed the ten lessons (idempotent, key `matlab-compiler:<id>`): `node scripts/seed-notebooks.mjs --dry-run`, then with `SUPABASE_URL SUPABASE_SERVICE_KEY` and `--course-id <uuid>`.
- MCP: get_notebook, get_notebook_content, create_notebook_import_link (draft only, never publishes), clone_to_draft/update_import_draft support notebooks; guide topic `notebook`; prompt `matlab_notebook`. Redeploy the `mcp` edge function.
- Home/catalog: `notebook-card.js` renders notebooks in category views (open, copy/share link, admin edit/move/rename/delete/details); manifest reads `notebook_public` (tolerates the view missing); trash tab/label added. Runtime smoke-tested in Chromium (mount, run cell, RTL, mobile width, no console errors).
- Not done / follow-ups: root/course count breakdowns for shared notebooks, admin-profile upload counters, server-side OG metadata for /notebook/:id, end-to-end test of notebook.html against a live DB, MATLAB fence highlighting in static Markdown (unknown fences render as escaped plain text). Python/C++ are future runtimes only.

## Local (workspace) notebooks — امتحاناتك
- "دفتر جديد" in the create menu / context menu opens `create-notebook-modal.js`: paste notebook JSON (copyable AI **Prompt** button), raw `.ipynb` JSON, or upload `.ipynb` / `.m`. Pure parsing/validation lives in `notebook-input.js` (same `checkNotebook` rules as API/MCP/editor).
- Stored in `localStorage.user_quizzes` as `{ id: "user_notebook_<uuid>", meta:{type:"notebook",…}, stats:{cellCount}, notebook:{runtime, content} }`. Opens at `/notebook/<id>?type=user` (notebook-page.js reads it locally; nothing is sent to a server).
- Card/menu: open, edit (`/create-notebook?edit=<id>`), details, rename, move, delete (trash). Notebooks are excluded from quiz/lesson counts and bulk quiz actions; they ride along in course/folder admin uploads as `type:"notebook"` items.
- `/create-notebook`: admins publish to the platform; everyone else gets the same editor in local mode (saves to امتحاناتك).
- Not browser-tested end to end yet: the modal, local open and local edit were verified by unit tests (88 pass) and syntax checks only.

### Round 3 fixes
- `create-notebook.html` / `notebook.html` had a truncated bottom-nav block (unclosed `<svg>`), so `<main>` was parsed inside the SVG and rendered 0×0. Restored the block; verified in Chromium.
- `/create-notebook` is open to everyone and saves to امتحاناتك. Only an admin arriving with `?draft=` or `?edit=<platform id>` gets the publish flow.
- `notebook-input.js`: lenient JSON parser (repairs raw line breaks in strings, bad escapes, trailing commas, wrapping fences/prose) with line/column/snippet errors; the modal shows an inline error panel, a file chip, and "رفع ملف" beside "إنشاء الدفتر"; the scroll now lives in an inner wrapper so the scrollbar stays inside the rounded card.

### Round 4 (UI overhaul)
- **Runtime** (`online-matlab-compiler/apps/web/src/main.ts`, `style.css`; rebuild with `npm run build:notebook-runtime`): JupyterLab look (`In [n]:` gutter, blue/green active bars, flat toolbar, collapsible Workspace panel), KaTeX math in text cells (uses the host page's `window.katex`), English by default, and `mode:"edit"` with `onChange(cells)` plus `getCells()` / `setCells()` on the mount handle.
- **/create-notebook**: details form + the runtime in edit mode (cells are runnable). No course/folder fields for normal users; language selector (en/ar) drives the page direction/strings and is stored in `content.language`.
- **Language**: `content.language` ("en"|"ar", optional; inferred from text when missing — `shared/notebook-lang.js`). Accepted by `checkNotebook`, `api/_validateNotebook.js` and the MCP; no DB migration needed.
- **Cards (local and platform)**: «معلومات الدفتر», «تنزيل» (.ipynb, .m, HTML, PDF via print) and «اسأل الباشـمبصمج» in `features/home/notebook-actions.js`; pure logic in `shared/notebook-export.js` (tests: `tests/notebook-export.test.js`). Notebooks are attached to the AI agent through the lesson path (`fetch_attached_lesson` returns all cells).
- Not done: Jupyter command-mode keyboard shortcuts (A/B/D D/M/Y); outputs are not stored, so exports contain no outputs; end-to-end test against a live Supabase and the admin publish flow.
