# Basmagi Quiz — Implementation Report

## Implementation Summary
- Fixed live lesson reader-font application with persisted `fontId`, undo/redo snapshots, autosave, and restoration for drafts/saved/published lessons.
- Unified create-lesson/create-quiz Markdown + LaTeX toolbar behavior in one shared module: mutual exclusion, detached viewport menus, outside-click/Escape closing, keyboard navigation, and selection restoration.
- Aligned flow-field/background layering with `light`, `dark`, `dark-slate`, animation enabled/disabled, and reduced-motion behavior without opaque body overrides.
- Added canonical `lesson-reference` blocks with local/published picker, self-reference protection, normalization, safe fallbacks, and server-side cycle validation.
- Redesigned referenced quiz/lesson cards around Start/Open, Download, Info, and AI attachment actions with SVG icons, bubbling prevention, and responsive action grids.
- Added optional lesson descriptions with live counter and persistence through local storage, catalog, reader, info views, server validation, and admin publishing.
- Added canonical lesson `source` metadata end-to-end, including the editor field, local/published models, catalog/manifest/reader metadata, info/download surfaces, admin validation, and a safe database view migration.
- Added lesson password protection with server-side hashing of a client-derived digest; plaintext lesson passwords are not sent in editor/unlock HTTP payloads and password hashes are never exposed in public lesson payloads.
- Added protected-reader gating before content rendering and password-gated lesson exports, plus explicit password replacement/removal paths while editing.
- Added batched reference lookups and non-breaking stale/missing reference rendering.
- Added responsive/accessibility treatment for the updated controls and cards.
- Hardened both create-page menu systems with synchronized ARIA state, single-open behavior, repeat-safe keyboard listeners, submenu close/reopen semantics, and trigger keyboard navigation.
- Wired create-lesson reference previews to the same reader-side Start/Download/Info/AI action architecture; stale references expose Info while disabling unavailable actions.
- Added focus restoration for the lesson preview, metadata info modal, reader controls, and password gate.

## Changed / Created Files

- `api/_catalog.js`
- `api/_validateLesson.js`
- `api/admin.js`
- `api/ai-agent/_tools.js`
- `api/ai-agent/chat.js`
- `api/render-course.js`
- `public/create-lesson.html`
- `public/src/components/ai-agent/ai-agent-attach-launcher.js`
- `public/src/components/ai-agent/ai-agent-chat.js`
- `public/src/features/create-lesson/create-lesson.css`
- `public/src/features/create-lesson/create-lesson.js`
- `public/src/features/create-quiz/create-quiz.css`
- `public/src/features/create-quiz/create-quiz.js`
- `public/src/features/home/download-modal.js`
- `public/src/features/home/exam-card.js`
- `public/src/features/home/index.css`
- `public/src/features/home/lesson-card.js`
- `public/src/features/home/lesson-download.js`
- `public/src/features/home/lesson-info-modal.js`
- `public/src/features/home/user-quiz-card.js`
- `public/src/features/lesson/lesson-access.js`
- `public/src/features/lesson/lesson-blocks.js`
- `public/src/features/lesson/lesson-icons.js`
- `public/src/features/lesson/lesson-reader-prefs.js`
- `public/src/features/lesson/lesson-schema.js`
- `public/src/features/lesson/lesson-view.js`
- `public/src/features/lesson/lesson.css`
- `public/src/shared/flow-field.js`
- `public/src/shared/global-markdown-toolbar.js`
- `public/src/shared/markdown-toolbar-actions.js`
- `public/src/shared/quizManifest.js`
- `supabase/migrations/20260929210000_lesson_security_description_references.sql`
- `supabase/migrations/20261002160600_lesson_source_metadata.sql`

## Database Migration

`supabase/migrations/20260929210000_lesson_security_description_references.sql` adds:
- `lessons.description` (optional author description).
- `lessons.source` (optional author source/reference, maximum 500 characters).
- `lessons.password_hash` (server-side digest derived from the browser password digest).
- `public.lesson_public` safe-reader view that returns `content = NULL` for protected lessons and never exposes `password_hash`.
- Column-level browser grants that prevent `anon`/`authenticated` roles from selecting protected lesson content directly from `lessons`.

## Validation Results

- JavaScript syntax: `node --check` passed for all project JS files (`185` JS files under `public/src` + `api`).
- Lesson server validators: valid canonical lesson-reference content accepted; invalid reference IDs, descriptions over 1200 chars, malformed password digests, and unknown block keys rejected.
- Password contract: deterministic client-digest → server-digest verification passed for correct and incorrect passwords; editor/unlock transport uses `passwordHash`, not plaintext `password`.
- Structural integration checks passed for font selection, shared toolbar wiring, reference schema/editor/reader/API integration, descriptions, and password API/migration wiring.
- No new TODO/placeholder/stub markers detected in the changed implementation modules.
- Browser automation could not be completed in this environment: Chromium was available, but the execution environment blocks local-network navigation (including localhost/loopback test pages), so live click/paint interaction could not be truthfully reported as passed.
- `npm run seo:check` was attempted; its remote HTTP checks returned HTTP 0 and the command timed out because outbound network access is unavailable in this execution environment. This does not indicate an application source failure.

## Regression Scope Checked

- create-lesson and create-quiz both bind the same global toolbar module.
- lesson local rows preserve legacy field fallbacks while new metadata is saved in canonical lesson structures.
- public lesson catalog/manifest paths use `lesson_public` and do not query the raw `lessons` table from browser code.
- admin lesson responses strip `password_hash` before returning data to the editor.
- protected lesson HTML is rendered only after successful unlock content retrieval; the public fetch path provides metadata + a null content field for protected lessons.
- stale references degrade to an unavailable card instead of aborting the lesson render.
- lesson source metadata remains available through the safe `lesson_public` view without exposing password hashes or protected content.
