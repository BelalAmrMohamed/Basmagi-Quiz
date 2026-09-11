# Implementation Plan — Fix Round (3 Phases)

Root-caused each item against the actual code before scoping it. A few are real bugs from step 9; several are older, unrelated gaps the QA pass just surfaced.

## Root causes found

| # | Report item | Actual cause |
|---|---|---|
| 2 | `#quizPasswordClear` shows even when quiz has no password | `updateSaveMenuOptionForSharedEdit()` shows the row unconditionally whenever `sharedEditDbId` is set — never checks whether the loaded quiz actually has `password` set. **My bug from step 9.** |
| 3 | Edited quiz reappears as a draft on the entry screen | `autosave()` only branches on `currentDraftId` vs. else-case `quiz_draft` key; it has no branch for `sharedEditDbId`, so every keystroke while editing a shared quiz writes into the legacy single-key `quiz_draft`, which the entry screen then surfaces as a recoverable draft. **My bug from step 9.** |
| 4 | Console error on save (image.png) | Need the actual error text/stack — not yet identified from static reading. |
| 5 | No rename collision protection | Documented, intentional gap in `_itemActions.js`'s `validateItemName` from an earlier step ("full uniqueness enforcement intentionally NOT duplicated"). **Not a regression — a known gap.** |
| 6 | Can't rename/delete/move folders | `canManageItem()` checks `item.author_handle`/`item.author_email`, but folder nodes from `quizManifest.js` only ever carry `created_by` — Tier 2 can never match for folders, so the whole dropdown silently fails to appear unless the admin happens to be owner or scope-matched. **Pre-existing gap, unrelated to step 9.** |
| 7 | No trash link in `#userQuizContextMenu` / `create-folder-btn` menu | Feature request, not a bug. |
| 8 | `.user-create-quiz-card` should also move into both menus | Feature request / UX consolidation. |
| 9 | Control page: no skeletons, just "جاري التحميل..." text | Cosmetic/UX gap, pre-existing. |
| 10 | Can't edit colleges — `POST /api/admin-control` 400 | `api/admin-control.js` doesn't exist in the codebase at all. Pre-existing, unrelated to quizzes work. |
| 11 | `#trashSection` stuck on "جاري التحميل..." until manual refresh | `loadTrash()` looks structurally correct; likely a first-call auth/timing race whose error gets silently swallowed into the empty-state div. Needs live console output to pin exactly. |
| 12 | Every button click has an unexplained delay | Likely the same class of issue as #9/#11 — no immediate visual feedback masks normal network latency. |

---

## Phase 1 — Fix step-9 regressions (fast, isolated, no design decisions needed)

**Goal:** make the edit-mode feature just shipped actually work end-to-end. All three are small, mechanical fixes in files already touched.

1. **Fix the password-clear checkbox condition** (`create-quiz.js`): `updateSaveMenuOptionForSharedEdit()` needs to know whether the loaded quiz actually has a password. Since `loadFullQuizData` doesn't expose the hash (by design), thread a boolean out of `loadSharedQuizForEdit` (e.g. from the manifest's `quiz.password` truthiness, or a small dedicated existence check) and only reveal `#quizPasswordClearRow` when that's true.
2. **Fix the draft leak** (`create-quiz.js`): give `autosave()` a real third branch for `sharedEditDbId` — either skip local persistence entirely (safest, since the server is now the source of truth for shared quizzes) or autosave into a `sharedEditDbId`-keyed sessionStorage entry that's never surfaced on the entry screen. Also make sure leaving shared-edit mode clears any stray `quiz_draft` key so an old local edit-in-progress doesn't get cross-contaminated.
3. **Diagnose and fix the console error** ![image.png](image.png): get the actual stack trace/error text first — this determines whether it's a follow-on symptom of #2/#3 (most likely, since both touch the same load/save path) or a separate bug in `loadSharedQuizForEdit`/`saveSharedQuizEdit`.

Ship and re-test the full edit round-trip (steps 1–4 together) before moving to Phase 2, since #4 may simply disappear once #2/#3 are fixed.

---

## Phase 2 — Fix pre-existing admin gaps surfaced by QA

**Goal:** close gaps that predate step 9 but block core admin workflows.

5. **Fix folder admin-actions visibility** (`admin-item-actions.js`): add a `created_by` check to `canManageItem()`'s Tier 2 (comparing against the admin's own id/handle, whatever `created_by` actually stores — needs a quick check of the `folders`/`courses` table schema to confirm the field's shape before comparing it correctly against `roleInfo`). Do this without touching quizzes' existing `author_handle`/`author_email` checks.
6. **Add rename/move/delete server-side name-collision protection** (`api/_itemActions.js` + wherever the DB schema allows): decide whether to add a same-level uniqueness check in `validateItemName` (query siblings before accepting) or leave as a documented gap — this was previously an explicit decision, so revisit deliberately rather than silently patching.
7. **Fix `/api/admin-control` 400 on college save**: locate or recreate the missing handler for `action=save_college`/`delete_college` (currently 404-equivalent, since the file doesn't exist) and wire it with the same admin-auth middleware pattern as `api/admin.js`.
8. **Diagnose `#trashSection` first-load stall**: reproduce with the browser console open and check whether `postAdminItemAction("trash-list")` throws a swallowed 401 on first call (token not ready yet) vs. a rendering no-op in `renderTrashList()`. Fix at the actual point of failure once confirmed rather than guessing.

---

## Phase 3 — UX polish and feature additions

**Goal:** the explicitly-requested additions and loading-state work, once the underlying data paths are trustworthy (Phase 2).

9. **Add trash-can entry points**: one link/button inside `#userQuizContextMenu` (`user-quizzes-folders.js`) and one inside the `create-folder-btn mobile-only-flex` dropdown (`user-quizzes-view.js`), both navigating to the existing local trash view.
10. **Consolidate the "create" menus**: move `.user-create-quiz-card`'s action into both menus above so `create-folder-btn`'s dropdown becomes a 4-item menu (Create Quiz / Create Folder / Create Course / Trash Can), matching the spec exactly; keep the standalone inline card behavior unchanged if anything else still depends on it.
11. **Add skeleton loaders to control.html**: replace every bare "جاري التحميل..." text node (overview stats, admins list, trash list) with a shared skeleton-loader component, so Phase 2's fixed load paths get proper loading UX instead of plain text.
12. **Add optimistic/immediate feedback on button clicks**: audit `control.js`'s action buttons (save, delete, restore, purge) for a shared "disable + spinner while in-flight" pattern, so the existing network latency reads as expected loading rather than an unexplained delay — this should mostly disappear as a *complaint* once #11 makes loading visible, but button-level feedback is a separate, smaller fix on top.