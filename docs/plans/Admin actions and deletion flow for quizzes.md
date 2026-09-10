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
6. Client: dropdown additions (edit/move/rename/delete) across `exam-card.js`, `category-view.js`, `root-view.js`, gated by `canManageItem`. (Next Step — includes building the Supabase-backed `MoveSource` adapter for `openMoveToDialogWithSource()`.)
7. Client: admin trash-management UI (list/restore/purge/settings) in `control.html`.
8. Client: `/#my-quizzes` local trash (storage key, sweep, restore, its own trash UI panel) — independent of steps 2–7, can be built in parallel.
9. `create-quiz.js` edit-mode wiring.
10. Manual QA pass: delete→restore→verify media intact; delete→purge→verify media gone; move quiz across courses; rename collision handling; non-owner/scope-restricted admin boundary checks.


This is the last partial implementation with AI (End of the chat):
```md
These are the 8 files touched today — same relative paths in your repo:

- `public/src/features/home/exam-dropdown-menu.js` — new `createActionGroupSubmenu()`
- `public/src/features/home/exam-card.js` — quiz admin group collapsed into submenu
- `public/src/features/home/category-view.js` — folder admin group collapsed into submenu
- `public/src/features/home/root-view.js` — course admin group collapsed into submenu
- `public/src/features/home/index.css` — `.submenu-content--actions` styling
- `public/control.html` — new trash panel markup, nav toggle, typed-confirm modal
- `public/src/features/control/control.js` — trash list/restore/purge/settings logic
- `public/src/features/control/control.css` — trash panel + typed-confirm styling

## What's left

**Step 8 — `/#my-quizzes` local trash (not started).** Three delete paths still hard-delete instead of soft-deleting into a new `user_quizzes_trash` localStorage bucket:
- `deleteFolder()` in `user-quizzes-folders.js`
- `deleteAllUserQuizzes()` in `user-quizzes-folders.js`
- `deleteUserQuiz()` in `user-quiz-card.js`

Needs: a storage helper module (move-to-trash + stamp `expiresAt`, lazy sweep-on-load, restore-with-collision-suffix), and a small trash UI panel reachable from the "امتحاناتك" card dropdown, per the plan's §4.

**Step 9 — `create-quiz.js` edit-mode wiring.** Not yet verified this session. Need to confirm `?id=<dbId>&mode=edit` actually pre-fills the form from a fetched quiz and posts to an update path, per §7.

**Step 10 — Manual QA pass.** Delete→restore→media-intact, delete→purge→media-gone, cross-course move, rename collisions, non-owner scope boundaries. This one's on you/a real environment to run — I won't render or execute anything.

Good stopping point — the shared/admin side (server + dropdown UI + trash panel) is now fully wired end-to-end; what remains is the local-storage trash mirror and the edit-mode form.
```