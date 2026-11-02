# MATLAB-Style Notebook Integration Plan

## Status and confirmed decisions

Ready to execute. The product and scope decisions below were confirmed with the owner on 2026-11-02.

- Add **Notebook** as one content type, distinct from quizzes and lessons. Store the language/runtime as notebook metadata (`matlab` first); do not create separate MATLAB, Python, and C++ content types.
- Integrate the learner experience into Basmagi-Quiz as a first-party route and build artifact, not an iframe or separately deployed application.
- Ship only the existing browser-based MATLAB-style educational interpreter. It is not a full MathWorks MATLAB runtime. Do not introduce server-side code execution or another language runtime in this release.
- Migrate all ten guided lessons from the compiler project. Support `.ipynb` and `.m` import, plus the platform's JSON/batch upload flow.
- Provide admin notebook creation and upload. Build a dedicated `create-notebook` page in a later phase, after the learner route, catalog, and import pipeline exist.
- Learner work is ungraded and autosaved locally; no account/cloud sync or score/points integration in this release.
- The UI is Arabic-first and RTL; code, editor input, and code output remain LTR.
- MCP can discover/read published notebooks and create expiring draft links for the safe admin-authoring flow. MCP must not publish or directly mutate published notebooks.

## Goal

Bring the compiler and its ten lessons into the existing course/folder content system so admins can publish MATLAB-style notebooks, learners can run them in the browser, and platform/MCP discovery and authoring remain consistent with quizzes and lessons.

The compiler project already contains a CodeMirror MATLAB/Octave editor, Web Worker interpreter, markdown/code cells, outputs, image-processing examples, local autosave, and `.m`/`.ipynb` import/export. Reuse and adapt these capabilities instead of rebuilding a second editor or interpreter.

## Product and architecture decisions

### Content model

Create a first-class `notebooks` resource, a sibling leaf to quizzes and lessons in the existing course/folder hierarchy. Use a language/runtime field such as `runtime: "matlab"` so later runtimes can be added without multiplying top-level content types. Keep the executable notebook document separate from lesson markdown and quiz question data.

Use versioned JSON content, with an initial shape equivalent to:

```json
{
  "schemaVersion": 1,
  "cells": [
    { "id": "cell-1", "type": "markdown", "source": "..." },
    { "id": "cell-2", "type": "code", "source": "..." }
  ]
}
```

Keep the runtime as notebook metadata (one authoritative value, e.g. a `runtime` column) and the schema version/cells in the JSON document. Persist authored cell source and notebook metadata, not learner execution outputs or local workspace state. Preserve any lesson assets needed by the migrated image-processing lessons through the platform's existing media/static-asset conventions; do not inline the entire compiler site's generated HTML into database content.

### Execution and learner state

- Keep execution entirely in a browser Web Worker using the existing interpreter. Preserve the current execution timeout/stop behavior and surface runtime errors as errors.
- Present the runtime accurately as an educational MATLAB-style subset; do not imply compatibility with proprietary MATLAB.
- Store learner edits and workspace state locally, scoped to the notebook. Provide a clear/reset path and retain export/download behavior where it works in the integrated UI.
- Do not add a grading/submission model, profile sync, points, completion scores, or server execution.
- Keep static code-fence highlighting in the shared Markdown renderer distinct from the interactive notebook editor. The renderer already has a MATLAB keyword set; verify its behavior and fix only concrete gaps. Reuse the compiler's editor highlighting for executable cells.

### Routes and platform placement

- Add a learner route such as `/notebook/:slug-or-id` and a dedicated admin route such as `/create-notebook`.
- Add the route exceptions/rewrites and metadata required by the existing Vercel routing conventions.
- Add notebooks to shared course/folder browsing and the existing home / “امتحاناتك” content surfaces. Treat them as unscored leaves; exclude them from quiz attempts, result pages, and score/level calculations.
- Reuse existing admin authorization, placement, rename/move/delete, trash/restore, collision, and upload conventions rather than creating a parallel hierarchy.

## Execution phases

### Phase 1 — Data model, validation, and content lifecycle

1. Add a migration for `public.notebooks`, following the lessons table's course/folder consistency and public-read patterns. Include UUID, title, optional description/source/slug, course/folder placement, runtime, versioned JSON content, creator, and timestamps. Add uniqueness/indexes and a public-safe view or equivalent read boundary for published notebook content.
2. Add notebook content validation with explicit limits for title, description, runtime, cell count, cell source sizes, total document size, and supported cell types. Reject unknown runtime values rather than silently defaulting to MATLAB.
3. Keep client/editor, API, upload, and MCP validation aligned through the repository's shared content-rules workflow (`public/src/shared/content-rules.js`, `scripts/sync-mcp-rules.js`, and their generated copies). Add upload-only structural checks in the established API validation layer.
4. Add admin CRUD/list/get API actions following `handleCreateLesson`, including authorization, course/folder placement, sibling-name/slug checks, and clear errors. Add notebook to generic item actions (move, rename, delete, trash/restore) and content counts.
5. Add migrations for any notebook-specific trash type or import-draft kind constraints; ensure restore/delete snapshots retain notebook runtime and document content.

**Acceptance:** A valid MATLAB notebook can be created, listed, fetched publicly, updated/deleted by an authorized admin, moved within the course/folder tree, and restored from trash. Invalid content and unauthorized operations fail explicitly. No quiz score or attempt counters change.

### Phase 2 — Integrate the browser runtime and learner notebook route

1. Refactor the compiler UI into a reusable runtime shell that accepts the platform-loaded notebook document instead of relying exclusively on lessons baked into its standalone HTML build.
2. Add a reproducible host build step for the compiler UI/worker and emit its static assets under the platform's public assets. Do not retain a second Vercel deployment or manually maintain generated/minified bundles.
3. Add the notebook page and runtime data-loading path. Fetch only public notebook content; handle missing, unavailable, and malformed content with visible platform-standard errors.
4. Adapt the current UI to platform styling, Arabic-first labels, RTL layout, LTR editor/code/output, navigation, and responsive/mobile behavior. Preserve editor accessibility, keyboard controls, stop/timeout behavior, figures, workspace, and supported file operations.
5. Keep local autosave namespaced by notebook ID and schema version. Make clear which changes are local learner work and which content is the published admin version.
6. Add the `/notebook/:slug-or-id` route and page metadata. Ensure the route does not break service-worker/offline rules or existing page routing.

**Acceptance:** A published notebook opens at its first-party route, executes supported MATLAB-style examples in a Worker, survives reload with local work intact, reports interpreter failures visibly, and works in Arabic/RTL and on mobile. No learner code is sent to a server for execution or saved to a profile.

### Phase 3 — Catalog, admin bulk upload, and migration of the ten lessons

1. Extend shared catalog/home rendering, search, folder counts, cards, and “امتحاناتك” surfaces to recognize notebooks. Provide notebook actions consistent with neighboring content while keeping quiz-only actions unavailable.
2. Extend the existing admin batch upload pipeline to accept notebook JSON records and imported `.ipynb` / `.m` files, with per-file validation and explicit per-item success/failure results. Do not treat arbitrary files as executable server-side.
3. Convert the ten compiler lesson files under `online-matlab-compiler/apps/web/lessons/` from their current `@...` / `%% md` / `%% code` format into the canonical notebook document. Preserve ordering, code, explanatory markdown, and image/data assets. This is a distinct conversion from `.ipynb` import.
4. Use the existing importer for `.ipynb` and `.m` where compatible; define deterministic conversion behavior: Markdown and code cells retain order, a `.m` script becomes a code cell, and unsupported notebook cell/output metadata is ignored or reported rather than silently misrepresented.
5. Add an idempotent seed/import procedure so the ten notebooks are not duplicated on rerun. Record the source lesson ID and a stable slug or migration key.
6. Add the MATLAB fence-language to prompt/examples and preserve current static Markdown highlighting. Do not duplicate the already-present MATLAB keyword highlighter; test and repair only if the renderer's actual output is deficient.

**Acceptance:** All ten source lessons appear once in the platform with matching order/content and required assets. `.ipynb`, `.m`, and batch imports either produce a validated notebook or a clear actionable error. Notebooks appear in the intended browsing/search/folder surfaces and do not enter quiz scoring.

### Phase 4 — MCP discovery, read, and draft-link workflow

1. Add notebook metadata/content tools following the current quiz/lesson patterns. Include notebooks in recent-content filtering and platform statistics.
2. Add notebook schema/authoring guidance and ready-to-use prompts covering runtime limitations, Arabic/RTL-friendly Markdown, code cells, supported image assets, and content limits.
3. Add `create_notebook_import_link`: validate the full notebook, support `dry_run`, and save a short-lived `notebook` draft using the existing import-draft workflow. Nothing is published by MCP.
4. Extend `import_drafts` constraints and draft URL/loading logic to understand notebook drafts. Preserve the existing 72-hour expiry/fallback behavior; wire the draft link into the creation page in Phase 5.
5. Add published notebook lookup/read tools that exclude unavailable or non-public data and return an outline/JSON form consistent with current lesson content tools.
6. Keep draft validation consistent between MCP and the platform editor/upload path. Return specific validation errors, not success-shaped fallbacks.

**Acceptance:** MCP can discover/read a public notebook and create a valid/invalid dry-run draft with the same validation used by the platform. Drafts expire as expected; Phase 5 completes the user-facing link target. No notebook is published by MCP.

### Phase 5 — Dedicated admin notebook creation page (intentionally late)

1. Add `/create-notebook` and an admin-only page modeled on the existing lesson/quiz creator pages.
2. Build authoring controls for title, description, course/folder, runtime (MATLAB only at launch), ordered Markdown/code cells, add/delete/reorder, preview, and validation.
3. Support loading notebook drafts from MCP links and `.ipynb` / `.m` imports. Provide a clear review step before save/publish.
4. Save through the notebook admin API, not direct client-side database writes. Reuse admin auth, authorization scopes, placement checks, and localized error notifications.
5. Add discoverability from existing admin controls and link behavior for `create_notebook_import_link`.

**Acceptance:** An authorized admin can create, preview, validate, and publish a notebook through the dedicated page; unauthorized users cannot publish. Draft and import flows open the correct notebook editor with data intact.

### Phase 6 — Release hardening and documentation

1. Update platform user/admin documentation and MCP authoring docs for notebooks, import formats, runtime limitations, local autosave, and export behavior.
2. Verify migrations on a clean database and against current lesson/quiz tree behavior; verify Vercel build output and route handling.
3. Test old quiz/lesson URLs, existing lesson/quiz uploads, trash restore, course/folder counts, and service-worker behavior for regressions.
4. Confirm no future runtime is accidentally advertised as available. Record Python/C++ as future runtime adapters, not launch scope.

## Primary implementation surfaces

Inspect and update the applicable existing patterns in these files/folders; exact additions should follow current naming conventions:

- Compiler source and build: `online-matlab-compiler/apps/web/src/main.ts`, `worker.ts`, `style.css`, `build.mjs`, `lessons.mjs`; `online-matlab-compiler/packages/interp/`.
- Database and content validation: `supabase/migrations/`, `docs/Database-Schema-Context.md`, `public/src/shared/content-rules.js`, `scripts/lib/content-rules.js`, `supabase/functions/mcp/content-rules.js`, `api/_validateLesson.js` (pattern only).
- Admin API and content lifecycle: `api/admin.js`, `api/_itemActions.js`, `api/_catalog.js`, `api/_trash.js`, `api/upload-quiz.js`, `api/_urls.js`.
- Public routes and admin pages: `public/lesson.html`, `public/create-lesson.html`, `public/src/features/lesson/`, `public/src/features/create-lesson/`, `public/src/features/home/`, `vercel.json`.
- Shared Markdown: `public/src/shared/markdown.js`, `public/src/shared/markdown-css.js`; MATLAB static code highlighting already has a keyword set and should be verified before any change.
- MCP authoring/discovery: `supabase/functions/mcp/index.ts`, `supabase/functions/mcp/lib.ts`, `supabase/functions/mcp/content-rules.js`, `supabase/migrations/20261028150000_import_drafts.sql`, `public/src/shared/import-draft.js`, and `scripts/sync-mcp-rules.js`.
- Tests: existing `tests/content-rules*.test.js`, `tests/mcp-*.test.js`, route/catalog tests, and compiler interpreter tests under `online-matlab-compiler/packages/interp/test/`.

## Verification checklist

- **Unit/validation:** Valid and invalid notebook schemas, supported runtime validation, size/count boundaries, `.ipynb` and `.m` conversion, migration conversion, and draft expiry/type handling.
- **Database/API:** Public read boundary, admin authorization, name/slug collision, hierarchy consistency, move/rename/delete/trash/restore, batch partial failures, and retry-safe seed migration.
- **MCP:** Notebook discovery/read/outline, `dry_run`, draft creation and expiration, authoring guide/prompt, and no direct publication.
- **Runtime:** Interpreter tests plus browser smoke tests for run cell/run all/stop/timeout, output/error display, image assets, local autosave, import/export, and malformed content.
- **Markdown/editor:** Existing MATLAB fenced-code highlighting renders escaped and directionally correct; interactive editor highlights MATLAB syntax with LTR cursor/selection. No raw HTML/script execution from Markdown or notebook text.
- **Regression:** Existing quiz/lesson tests, upload and course/folder flows, home search/counts, service worker, and old routes remain unchanged.
- **Build/UI:** Run the host static build and compiler typecheck; test Arabic-first desktop and mobile layouts, keyboard use, and direct route refresh on `/notebook/:id` and `/create-notebook`.

## Out of scope

- Python, C++, or any other runtime implementation.
- Full or proprietary MATLAB compatibility, server-side code execution, or user-supplied server packages.
- Grades, quiz-like submissions, result pages, points, profile sync, or cloud persistence of learner edits.
- Replacing the platform Markdown engine or creating a second standalone deployment.
- Editing published notebook content through MCP without an admin review/save step.
