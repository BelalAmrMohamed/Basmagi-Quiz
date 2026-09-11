## Implementation Plan: Admin Deletion/Trash, Move, Edit & Rename

### 0. Scope clarification & assumptions to confirm first

Before coding, I want to flag a few things I found in the codebase that affect design decisions — worth a quick check with you:

1. **Two completely different storage models.** The *shared* quizzes/courses/folders area (`root-view.js`, `category-view.js`) is backed by Supabase Postgres (`quizzes`, `courses`, `folders` tables) via `/api/*` endpoints. The **"امتحاناتك" (`/#my-quizzes`)** area is pure **client-side `localStorage`** (`user_quizzes` key) — there is no server table for it at all today. A "trash can" for that section can't reuse server infra; it has to be a second localStorage bucket (e.g. `user_quizzes_trash`) with its own retention/sweep logic run client-side. That's a materially different (and less robust — no cross-device sync, no server-enforced retention) feature than the shared trash. I'll design both, but want to confirm client-side-only is acceptable for `/@my-quizzes` trash, since true retention enforcement (auto-purge after N days) needs *something* to run periodically, and there's no cron/job runner in this codebase yet — I'd implement it as a lazy sweep-on-load.
2. **The spec's `/@my-quizzes`** doesn't exist as a route; the current hash is `/#my-quizzes`. I'll treat this as the existing "امتحاناتك" section.
3. **Vercel serverless function count.** There are already 21 functions under `/api`. Depending on your Vercel plan (Hobby caps at 12), new endpoints must be consolidated into existing multi-method files (matching the existing `college-quiz.js` pattern) rather than adding new standalone files.
4. **Media deletion** currently happens via direct-to-Supabase-Storage client uploads (no server proxy) — so "delete quiz must remove associated media" needs either (a) a server endpoint with the service-role key that can list+delete storage objects by quiz path prefix, or (b) parsing the quiz JSON's media URLs and deleting each by exact key. I'll go with (a), storing/deriving a per-quiz storage prefix so trash/purge can safely batch-delete.

---

### 1. Data model changes (Supabase — shared side)

**New tables**
- `trash_items` — one row per soft-deleted quiz/folder/course:
  - `id uuid pk`, `item_type text check in ('quiz','folder','course')`, `original_id uuid`, `snapshot jsonb` (full row copy, so recovery doesn't depend on the item still partially existing), `parent_folder_id uuid null`, `course_id uuid null`, `deleted_by uuid`, `deleted_at timestamptz`, `expires_at timestamptz`, `education_type text null` (for scope-based authorization on restore/purge).
  
  Storing a full snapshot (not just a soft-delete flag on the original tables) means:
  - No need to touch RLS/read policies on `quizzes`/`courses`/`folders` (they stay "delete removes the row"), avoiding a `deleted_at IS NULL` filter added to every public read query everywhere in the app.
  - Recovery is just re-inserting from `snapshot`, which also naturally handles "restore a folder whose parent was also deleted" (see cascade behavior below).

**New columns**
- `admin_settings` (new small singleton table, or reuse existing config pattern) — `trash_retention_days int default 30` — configurable retention, admin-editable.

**Cascade-on-delete semantics** (needs explicit decision, will confirm in plan review):
- Deleting a **course** → trash the course row, and cascade-trash all its folders + quizzes (as separate `trash_items` rows referencing the same `deleted_at` "batch", via a shared `batch_id` column) so they can be restored together or independently.
- Deleting a **folder** → cascade-trash its subfolders + quizzes the same way.
- Deleting a **quiz** → single `trash_items` row, plus (per requirement) permanent deletion of its media files happens only at **purge** time, not at soft-delete time — soft delete must be fully reversible, including media. Media itself isn't moved to a "trash" storage location by default (adds real storage-cost/complexity); instead I'll keep media in place until purge/permanent-delete, and only physically delete storage objects when the trash item is emptied or permanently deleted. This matches "deleting a quiz must remove all associated media files" — it's true at the point of *permanent* deletion, and during the trash window the quiz is fully restorable including media.

**RLS**: `trash_items` gets `Deny all for public`, service-role only (mirrors `admin_users`) — trash is never publicly readable.

---

### 2. Server API changes

Given the function-count constraint, I'll extend/consolidate rather than add many new files:

- **`api/admin.js`** (already the general admin CRUD surface) gains:
  - `POST /api/admin?action=trash-list` — list trash items (optionally filtered by type/scope), admin/owner only, scoped by `allowed_scopes` the same way delete-quiz already is.
  - `POST /api/admin?action=trash-restore` — body `{ trashItemId }`. Re-inserts snapshot(s) for the batch, re-validating the target course/folder still exists (or offers "restore to root" if the original parent was permanently purged).
  - `POST /api/admin?action=trash-empty` — purge one item or all items in scope; triggers real media deletion (storage cleanup) then deletes the `trash_items` row(s).
  - `POST /api/admin?action=trash-settings` — owner-only, get/set `trash_retention_days`.
  - `POST /api/admin?action=purge-expired` — sweep job: deletes any `trash_items` past `expires_at`, with storage cleanup. Since there's no cron infra visible in this repo, I'll trigger this as a lazy check (called opportunistically from `trash-list`, similar to a "vacuum on access" pattern) *and* leave a documented hook for a real Vercel Cron (`vercel.json` `crons` array) if/when that's set up — I'll ask whether to add that config.

- **`api/college-quiz.js`** (currently handles GET colleges + DELETE quiz) — the existing `handleDeleteQuiz` becomes "soft delete": instead of `DELETE FROM quizzes`, it writes a `trash_items` snapshot row, then deletes from `quizzes`. Same auth logic reused as-is (owner / uploader / scope match already implemented — no changes needed there).

- **New: folder/course delete, move, rename, edit** — added as new `action=` branches inside **`api/admin.js`** rather than new files:
  - `action=delete-folder`, `action=delete-course` — soft-delete with cascade as above.
  - `action=move-item` — body `{ itemType, itemId, targetFolderId | targetCourseId }`; reuses the "courses are always top-level" rule already enforced client-side in `canPlaceItem()` (user-quizzes-folders.js) — I'll port that same invariant server-side rather than trusting the client.
  - `action=rename-item` — body `{ itemType, itemId, newName }`.
  - Quiz **edit** reuses the existing `upload-quiz.js` POST path in "update" mode (it likely already needs an `id`/upsert branch — I'll check during implementation whether `upload-quiz.js` supports update-in-place or only insert, and extend it with an `action=update` or `id` param rather than duplicating validation logic from `_validateQuiz.js`).

  All new admin actions go through the existing `requireAdmin()` / `applyCors()` / `handleAuthError()` middleware from `_middleware.js`, and reuse the exact 3-tier authorization already proven out in `handleDeleteQuiz` (owner → creator/uploader → scope match).

---

### 3. Media cleanup on permanent delete

- At purge time, derive the Supabase Storage path prefix associated with a quiz (likely something like `quiz-media/<courseSlug>/...` based on the existing bucket layout I saw under `public/assets/quiz-media/`, but the *live* bucket is remote Supabase Storage, not this local folder — I'll inspect actual stored media URLs inside a real `quizzes.data` JSONB blob during implementation to get the exact key scheme).
- Server-side purge handler uses the service-role client (already instantiated in `college-quiz.js`/`admin.js`) to call `supabase.storage.from(bucket).remove([...keys])` for every media URL found in the quiz's snapshot JSON, then deletes the row.
- Folder/course purge cascades this per-quiz media cleanup across every quiz in the batch.

---

### 4. `/@my-quizzes` (client-side "امتحاناتك") trash

Since this is localStorage-only:
- New storage key `user_quizzes_trash`, array of `{ item, deletedAt, expiresAt }` (item = full row snapshot from `user_quizzes`, including cascaded children for folders/courses, tagged with a shared `batchId`).
- `deleteFolder()` / a new `deleteUserQuizItem()` in `user-quizzes-folders.js` change from "filter out and discard" to "move matching rows into `user_quizzes_trash`, stamped with `expiresAt = now + retentionDays`".
- Retention is a **local setting** (localStorage, default e.g. 30 days), editable from a new trash UI panel.
- A lazy sweep (`purgeExpiredUserQuizzesTrash()`) runs on `/#my-quizzes` load and removes anything past `expiresAt` — same "vacuum on access" pattern as the server side, for consistency.
- New trash UI: a dedicated view/modal reachable from the "امتحاناتك" card's dropdown (`رأيت "معلومات المادة"` pattern already exists — I'll add "سلة المهملات" the same way), listing trashed items with: restore, permanent delete, "empty trash" (reusing the existing `_confirmTyped()` double-confirmation pattern already used for "حذف الكل").
- Restore re-inserts into `user_quizzes` at the original `parentId`, or root if that parent no longer exists (mirrors the server-side "restore to root if parent purged" fallback), with `hasSameLevelCollision()` re-checked and an auto-suffix (`(2)`, etc.) on name clash, consistent with existing collision-avoidance behavior elsewhere in this file.

---

### 5. Client UI — `.exam-more-btn` dropdown additions

All three surfaces that already render an `.exam-more-btn` dropdown — `exam-card.js` (quizzes), `category-view.js` (folders), `root-view.js` (courses) — get the same new admin-only action set, added via the shared `openExamDropdownMenu()`/`exam-dropdown-menu.js` engine already used everywhere else, so styling/behavior/keyboard/positioning is free.

- **Visibility gate**: new `canManageItem(item)` helper (parallel to existing `canDeleteQuiz`), true only when `isAdminAuthenticated()` **and** (`isOwner` or creator/uploader match or scope match) — reusing the exact same 3-tier logic already in `delete-quiz.js`, generalized to accept folders/courses (which need `created_by`/`education_type` fields threaded through, confirmed present in the schema doc).
- When true, the dropdown gets 4 new rows, grouped visually below the existing actions and above the existing danger-zone delete:
  - **تعديل** (edit) — quizzes only; navigates to `/create-quiz?id=<id>&mode=edit` (new query param support needed in `create-quiz.html`/`create-quiz.js` to pre-fill from an existing quiz instead of always creating new).
  - **نقل** (move) — quizzes/folders; opens `openMoveToDialog()` — but that function currently only exists in `user-quizzes-folders.js` and operates on localStorage rows. I'll extract a **shared, storage-agnostic Move-To dialog component** (same visual tree/breadcrumb/guide-line UI) that takes an injected data-source (either the localStorage tree or a new Supabase-backed course/folder tree fetch) so both the "امتحاناتك" and the shared/admin areas reuse one dialog implementation instead of forking it — this is the single biggest refactor in the plan and I'll do it first since both new features depend on it.
  - **إعادة تسمية** (rename) — quizzes/folders/courses; reuses the existing `_prompt()`-based pattern from `renameItem()` in `user-quizzes-folders.js`, wired to the new `action=rename-item` server call for the shared side.
  - **حذف** (delete/trash) — existing quiz delete button is retitled/repointed at the new soft-delete endpoint (no longer a hard delete); new folder/course delete buttons added alongside it, all sharing one confirmation copy pattern ("سيُنقل … إلى سلة المهملات" instead of the current "لا يمكن التراجع" hard-delete wording, since it's now reversible).

- **Dropdown visibility**: gate each new button block on `canManageItem`, exactly matching the existing `canDeleteQuiz(exam)` conditional wrapping pattern already used in `exam-card.js` line ~388.

---

### 6. Admin trash UI (shared quizzes area)

- New page or modal — likely a modal launched from the existing admin control panel (`control.html` / `control.js`, where `دخول المشرفين` / admin tools already live) rather than a new route, to avoid adding another top-level page + its own auth guard boilerplate.
- Tabs or filters: "الكل / امتحانات / مجلدات / مواد", each row showing name, type, original location, deleted-by, days-until-purge, with Restore / Delete-permanently actions.
- Retention setting (owner-only) editable here, calling `action=trash-settings`.
- "إفراغ السلة" (empty trash) — same double-confirm (`_confirmTyped`) pattern as `deleteAllUserQuizzes()`.

---

### 7. `create-quiz.html` / `create-quiz.js` edit-mode support

- Detect `?id=<dbId>&mode=edit` on load; if present, fetch the existing quiz via a (new or existing) read endpoint, populate all form fields/questions/media chips from it instead of starting blank.
- Submit button becomes "حفظ التعديلات" instead of "نشر", posting to the update branch of `upload-quiz.js` (`PUT`/`action=update` with the existing `id`) instead of always inserting a new row.
- Needs the same `_validateQuiz.js` validation reused unchanged.
- Authorization for entering edit mode re-uses `canManageItem`/`canDeleteQuiz` client-side (UX gate), with the real check enforced server-side inside the update handler identical to delete's 3-tier check.

---

### 8. Build/verification order (suggested sequence)

1. Migration: `trash_items` table + RLS + `admin_settings.trash_retention_days`. (Done ✅)
2. Server: soft-delete for quizzes (adapt existing `handleDeleteQuiz`) → verify restore/purge round-trip via a scratch script before touching UI. (Done ✅)
3. Server: folder/course soft-delete + cascade batching. (Done ✅)
4. Server: move-item, rename-item, update-quiz (edit) actions. (Done ✅)
5. Shared **Move-To dialog** extraction/generalization (blocks steps 6–7). (Done ✅ — new `move-to-dialog.js` exports a storage-agnostic `openMoveToDialogWithSource(source)` that owns all DOM/tree/guide-line rendering behind a documented `MoveSource` adapter interface; `user-quizzes-folders.js`'s `openMoveToDialog()` is now a thin wrapper building a `createLocalUserQuizzesMoveSource()` adapter over `user_quizzes`, with the exact same exported signature/behavior as before — zero changes needed at any of its three call sites. The Supabase-backed admin-side adapter is deferred to step 6, where the dropdown wiring will need a concrete course/folder tree fetch to build it from.)
6. Client: dropdown additions (edit/move/rename/delete) across `exam-card.js`, `category-view.js`, `root-view.js`, gated by `canManageItem`. (Next Step — includes building the Supabase-backed `MoveSource` adapter for `openMoveToDialogWithSource()`.) (Done ✅)
7. Client: admin trash-management UI (list/restore/purge/settings) in `control.html`. (Done ✅)
8. Client: `/#my-quizzes` local trash (storage key, sweep, restore, its own trash UI panel) — independent of steps 2–7, can be built in parallel. (Done ✅ — new `user-quizzes-trash.js` owns the `user_quizzes_trash` storage key, batch-based soft-delete/restore/purge, lazy expiry sweep, and the local retention setting; new `user-quizzes-trash-panel.js` + `user-quizzes-trash-panel.css` render the "سلة المهملات" dialog, reusing the existing `.quiz-info-dialog` shell. `deleteFolder()` (user-quizzes-folders.js), `deleteUserQuiz()` (user-quiz-card.js), and the bulk-delete handler (user-quizzes-view.js) now all route through `moveToTrash()` instead of discarding rows, with confirm copy updated to reflect that the action is reversible. Entry point wired into the "امتحاناتك" card's dropdown in root-view.js, shown whenever the trash is non-empty. `deleteAllUserQuizzes()` ("حذف الكل") is deliberately left as a genuine hard wipe — it's the plan's documented escape hatch, not a per-item delete, and the trash UI's own "إفراغ السلة" already reuses its `_confirmTyped()` pattern.)
9. `create-quiz.js` edit-mode wiring. (Done ✅ — before writing code, re-traced the actual state of the codebase against this plan and found §7 was stale in a way that mattered: `create-quiz.js` had *no* server-publish path at all (its only save action wrote to `user_quizzes` localStorage); the `?edit=<id>` param it already handled was, and remains, local-only. Separately, the admin dropdown's "تعديل" button (`exam-card.js`, added during step 6) was already wired to navigate to `/create-quiz?id=<dbId>&mode=edit` — i.e. the codebase had already committed to the plan's original two-param design (`?edit=` for local, `?id=&mode=edit` for shared) without step 9 existing yet to make it do anything. Kept that split: zero changes needed at either existing `?edit=` call site (`user-quiz-card.js`, `user-quizzes-folders.js`).
   - **Server**: new `action=update-quiz` branch in `api/admin.js` (`handleUpdateQuiz`), reusing `fetchItemForAuth`/`isAuthorizedForItem` (the same 3-tier check as delete/rename/move) and `_validateQuiz.js`'s `validateQuizPayload`/`computeStats` unchanged. Looks the quiz up by the Supabase row UUID (`quizzes.id`) — the same id `?id=<dbId>` carries and `loadFullQuizData` already fetches by — which is a *different* id space than `handleDeleteQuiz`'s lookup by `data->meta->>id`; flagged in a comment since both exist in this file's neighborhood now. Preserves `meta.path`/`meta.author_id`/placement columns from the existing row (edit never relocates or re-attributes a quiz — that's `move-item`'s job). Password handling needed its own decision: the client-side prefill can never see the existing hash (it's stored in a separate column, stripped out of `data` at upload time), so a blank password field on submit is ambiguous between "unchanged" and "removed" — resolved with an explicit `clearPassword` flag from the client rather than inferring intent, backed by a new "إزالة كلمة المرور الحالية" checkbox in `create-quiz.html`, shown only in shared-edit mode.
   - **Client**: `create-quiz.js` gained `loadSharedQuizForEdit()` (fetches via the existing `loadFullQuizData`/`loadDbQuizData` — no new read endpoint needed, confirming point 4 from the original request checks out) and `saveSharedQuizEdit()` (posts to the new action, gated by a new `sharedEditDbId` module-level flag kept fully separate from the pre-existing local `editingQuizId`). The existing single save entry point (`saveLocally()`, bound to "ملف > حفظ محليًا" and Ctrl+S) now branches to `saveSharedQuizEdit()` when `sharedEditDbId` is set, rather than adding a second competing save action — its label is swapped to "حفظ التعديلات" by `updateSaveMenuOptionForSharedEdit()` so the wording doesn't claim a server save is local. Question-format conversion and the `{meta, stats, questions}` payload shape reuse `buildQuizPayload()`/`normalizeQuestionsWithIds()` unchanged — both already matched `_validateQuiz.js`'s schema exactly, since they were written against the same contract for the local-quiz path.
   - **Entry point** (plan §5's "تعديل" button) turned out to already exist in `exam-card.js` from step 6, correctly gated on `canManageItem` and correctly quiz-only (confirmed no equivalent exists in `category-view.js`/`root-view.js` for folders/courses) — nothing left to do there.)
10. Manual QA pass: delete→restore→verify media intact; delete→purge→verify media gone; move quiz across courses; rename collision handling; non-owner/scope-restricted admin boundary checks, plus edit-mode round-trip. (In progress — see QA notes below.)

---

### QA pass (step 10) — code-path trace

Everything below was checked by reading the code end-to-end (auth reached, request/response shapes matching client↔server, validation actually enforced) — not by exercising a live Supabase instance. Items marked ⚠️ still need a human click-through.

**Edit-mode round-trip (new in step 9)**
- ✅ `?id=<dbId>&mode=edit` → `loadSharedQuizForEdit` → `loadFullQuizData({dbId})` → same Supabase anon read already used by download/copy/AI-attach — no new read surface, no new failure mode introduced.
- ✅ Save → `saveSharedQuizEdit` sends `{action:"update-quiz", id, quiz, clearPassword}` with a bearer token from `getToken()`; server dispatch (`ITEM_ACTIONS` → `handleItemActions` → `requireAdmin`) matches every other admin write in this file — same middleware, same failure path (401/403) surfaced as a notification rather than a silent failure.
- ✅ `handleUpdateQuiz`'s auth check (`fetchItemForAuth("quiz", id)` + `isAuthorizedForItem`) is byte-for-byte the same helper pair `handleMoveItem`/`handleRenameItem` already use — not a reimplementation.
- ✅ `validateQuizPayload` re-runs server-side on the edited payload exactly as it does on create — a client that bypasses `create-quiz.js`'s own `validateQuiz()` (e.g. a hand-crafted request) still can't smuggle invalid question shapes or oversized payloads past the server.
- ✅ `meta.id` is force-set from the existing row before validation, so an edit can never drift the quiz's public 8-char id (which the manifest, download links, and password-hash lookups all key on) even if a malformed client payload tried to change it.
- ⚠️ Not checkable by reading alone: an actual save round-trip against a live quiz that has media (image/audio/video chips) — confirming the media URLs in `questions[].image/audio/video` survive the editor's load→render→re-serialize cycle unchanged (they should, since `buildQuizPayload`'s question mapper is the same one already proven out for local quizzes, but shared quizzes are the first time this mapper's output round-trips through Supabase rather than localStorage).
- ⚠️ Not checkable by reading alone: verifying the "إزالة كلمة المرور الحالية" checkbox actually clears access on a real password-protected quiz (i.e. that `render-quiz.js`'s password gate correctly treats a `null` `password` column as "no password required" — the column read looked consistent with that on inspection, but wasn't exercised).

**Previously-built steps (2–8), re-checked for anything step 9 might have disturbed**
- ✅ No shared helper touched by step 9 (`fetchItemForAuth`, `isAuthorizedForItem`, `_validateQuiz.js`) had its signature or behavior changed — only new call sites were added, so steps 2–8's own behavior is unaffected.
- ✅ `ITEM_ACTIONS`/dispatcher change is additive (`update-quiz` appended to both the Set and the if-chain) — every existing action string still resolves to the same handler it did before.
- ⚠️ Everything already flagged as needing a live environment in earlier steps (delete→restore→media-intact, delete→purge→media-gone, cross-course move, rename collisions, non-owner/scope-boundary checks) still needs that same human click-through — step 9 didn't touch any of those code paths, so their status is unchanged from before this step, not re-verified here.


## Testing
- I can rename, delete, and restore courses ✅
- I can rename, delete, restore, and move quizzes. ✅
- A course had a quiz named `منصة امتحانات بصمجي (تعديل)`, and another quiz next to it, I renamed the other quiz to the exact name `منصة امتحانات بصمجي (تعديل)`, and it allowed me, so no name collision protection on the front or the DB. ⚠️
- I wasn't able to delete, rename, or move folders. ⚠️
- When trying to edit a quiz, I got redirected to `/create-quiz?id=ddcf5f00-79ff-43ac-8e14-9e73f21cccb0&mode=edit`, which didn't do anything, until I figured out that the redirect is missing `.html` after the `create-quiz`, so I typed `/create-quiz.html?id=ddcf5f00-79ff-43ac-8e14-9e73f21cccb0&mode=edit`, and I was redirected to the create-quiz page with the quiz to edit. ⚠️
- `#quizPasswordClear` appears even when the quiz has no password to be removed (create-quiz.html). ⚠️
- After trying to edit the quiz, I got this error ![browser console error](image.png).
- After quitting the create-quiz editing, and going to the create-quiz page's start screen, I found the quiz I was just editing as a draft for some reason.
- It would be a good feature to have a link to the local trash can inside the `#userQuizContextMenu` and inside the `.create-folder-btn mobile-only-flex`. Tested the trash can, I can delete and restore ✅.
- While you are moving it, also move the `.user-create-quiz-card` Into the `create-folder-btn mobile-only-flex` menu and into the `#userQuizContextMenu`, too. So the `create-folder-btn mobile-only-flex` menu should now have 4 elements:
  - Create Quiz
  - Create Folder
  - Create Course
  - Trash Can
- Control Page turned out to have many issues:
  - No loading animations at all on anything on the page, it just says `جاري التحميل...`, remove that and add an advanced skeleton loader.
  - I can't edit colleges (seperate issue, not related, but good to fix). Console Output:
  ```
  control.html:281  GET http://localhost:8080/_vercel/insights/script.js net::ERR_ABORTED 404 (Not Found)
  hook.js:1  POST http://localhost:8080/api/admin-control 400 (Bad Request)
  apply @ hook.js:1
  saveCollege @ control.js:171
  ```
  - The `#trashSection` keeps saying "جاري التحميل...", and never actually loads until I press the `#refreshTrashBtn`
  - Pressing any button has a delay, which is acceptible if there is a loading animation.