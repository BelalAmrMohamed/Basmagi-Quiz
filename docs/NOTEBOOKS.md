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
