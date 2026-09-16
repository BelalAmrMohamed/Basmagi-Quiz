## امتحاناتك Naming Rule — Audit

**The rule** (from `docs/issues.md`, "امتحاناتك Rules"): no two elements of the same type and the same name may exist at the same course/folder (or root امتحاناتك).

There are two completely separate storage models in this codebase, each needing its own enforcement:
- **Local "امتحاناتك"** (`localStorage["user_quizzes"]`) — enforcement is a shared predicate, `hasSameLevelCollision()` in `user-quizzes-folders.js`. The rule: same `type` + same `title` (trimmed, case-insensitive) + same `parentId`, ignoring unreachable/orphaned rows.
- **Shared/Supabase-backed** courses, folders, quizzes (`root-view.js`, `category-view.js`, `/api/*`) — folders and courses are backed by real DB unique constraints (`folders_unique_name_per_parent`, `courses_unique_slot` / `courses_canonical_unique_slot`); quizzes have no such constraint anywhere in the schema.

This audit traces every path that creates, renames, moves, or copies an item in either model and checks whether it's actually routed through the matching guard.

---

### Local "امتحاناتك" (`user_quizzes`)

| Path | File | Guarded? |
|---|---|---|
| Create folder/course | `createFolderOrCourseNamed` (`user-quizzes-folders.js`) | ✅ |
| Rename (context menu / card ⋮) | `renameItem` (`user-quizzes-folders.js`) | ✅ |
| Drag-and-drop move | `handleDrop` (`user-quizzes-folders.js`) | ✅ |
| Move dialog / bulk move | `moveItemsToFolder`, `createLocalUserQuizzesMoveSource` (`user-quizzes-folders.js`) | ✅ |
| Copy single quiz ("نسخ لامتحاناتي") | `copyQuizToUserQuizzes` (`copy-to-my-quizzes.js`) | ✅ |
| Copy course/folder tree | `copyCategoryTreeToUserQuizzes` (`copy-to-my-quizzes.js`) | ✅ |
| AI agent `create_quiz` | `handleCreateQuizToolCall` → `saveNewUserQuiz` (`quiz-schema.js`) | ✅ |
| AI agent `create_folder` / `create_course` | `handleCreateFolderToolCall` / `handleCreateCourseToolCall` → `createFolderOrCourseNamed` | ✅ |
| AI agent `move_item` | `handleMoveItemToolCall` → `moveItemsToFolder` | ✅ |
| **JSON file import** | `importJsonQuizFiles` (`quiz-file-import.js`) | ❌ **Gap 1** |
| **Save new quiz from editor** | `saveToUserQuizzes` (`create-quiz.js`) | ❌ **Gap 2** |
| **Rename from editor's own grid** | `window.renameEntryItem` (`create-quiz.js`) | ❌ **Gap 3** |
| **AI agent `edit_quiz`** | `handleEditQuizToolCall` (`user-quizzes-view.js`) | ❌ **Gap 4** |

#### Gap 1 — JSON import never checks collisions
`importJsonQuizFiles` (`public/src/features/home/quiz-file-import.js`) builds one `user_quizzes` entry per valid file via `buildUserQuizEntry`, which always leaves `parentId` unset (→ root), and pushes it straight into the array. No call to `hasSameLevelCollision`. Importing two files that produce the same title (or re-importing the same file twice) silently creates duplicate quizzes at root.

#### Gap 2 — Editor's "save new quiz" never checks collisions
`saveToUserQuizzes` (`public/src/features/create/create-quiz.js`) is the local-save path used by the quiz creation page (the one other than the AI agent's `create_quiz`, which *is* guarded via `saveNewUserQuiz`). It pushes a new entry directly, with no import of `hasSameLevelCollision` anywhere in the file. A user can create a brand-new quiz whose title collides with an existing root-level quiz.

#### Gap 3 — Editor's own rename button skips the guard entirely
`window.renameEntryItem` (`public/src/features/create/create-quiz.js`) is a second, independent rename implementation — separate from `renameItem()` in `user-quizzes-folders.js`, which *is* correctly guarded. This one doesn't call `hasSameLevelCollision`, and doesn't even look at `parentId`; it renames in place unconditionally.

#### Gap 4 — AI agent's `edit_quiz` bypasses the guard that `edit_quiz`'s human equivalent uses
`handleEditQuizToolCall` (`public/src/features/home/user-quizzes-view.js`) rebuilds the quiz entry via `buildUserQuizEntry` with `meta.title` possibly changed by `input.title`, and writes it back without ever calling `hasSameLevelCollision`. The human-driven rename path (`renameItem`) checks this; the AI-driven one doesn't, so asking the assistant to rename a quiz can silently produce a same-level duplicate.

---

### Shared/Supabase-backed (courses, folders, quizzes)

| Path | File | Guarded? |
|---|---|---|
| Create course | `resolveCourse` (`api/_courseFolders.js`) | ✅ (DB constraint `courses_unique_slot` / `courses_canonical_unique_slot`, get-or-create semantics) |
| Create folder | `resolveFolderPath` (`api/_courseFolders.js`) | ✅ (DB constraint `folders_unique_name_per_parent`, get-or-create semantics) |
| Create quiz (single upload) | `api/upload-quiz.js` | ✅ (explicit `path` + `filename` existence check before insert) |
| Create quiz (batch folder upload) | `api/upload-quiz.js` | ✅ (same check, per item) |
| Rename folder/course | `handleRenameItem` (`api/admin.js`) | ✅ (DB constraint, 23505 caught and turned into a friendly error) |
| Move folder | `handleMoveItem` (`api/admin.js`) | ✅ (DB constraint, 23505 caught) |
| **Rename quiz** | `handleRenameItem` (`api/admin.js`) | ❌ **Gap 5** |
| **Edit quiz (title change)** | `handleUpdateQuiz` (`api/admin.js`) | ❌ **Gap 6** |
| **Move quiz** | `handleMoveItem` (`api/admin.js`) | ❌ **Gap 7** |

#### Gap 5 — Renaming a shared quiz has no duplicate check
`handleRenameItem`'s quiz branch (`api/admin.js`) updates `title` and `data.meta.title` directly. `_itemActions.js`'s own header comment documents this as a known, intentional gap: *"Quizzes have no such constraint and still allow duplicate titles at the same level, unchanged from before."* Folders/courses get a friendly "name already taken" 400 via the 23505 branch; quizzes have nothing to trip.

#### Gap 6 — Editing a shared quiz's title has no duplicate check
`handleUpdateQuiz` (`api/admin.js`) writes `title: cleanQuiz.meta.title` straight from the edit payload with no existence check at all — not even the path+filename check `upload-quiz.js` does on create. This is a second, independent way to land a shared quiz on a colliding title, distinct from Gap 5.

#### Gap 7 — Moving a shared quiz into a folder with a same-named quiz has no check
`handleMoveItem`'s own comment says it plainly: the 23505 branch "only ever fires for itemType === 'folder'" since quizzes carry no equivalent DB constraint. Moving a quiz into a destination that already holds a same-titled quiz succeeds unconditionally.

---

### Fix plan

**Local (`user_quizzes`)** — every gap here has the exact same guard already available (`hasSameLevelCollision`, already imported in `user-quizzes-folders.js` and re-exported for reuse); this is a matter of routing each path through it and surfacing a rejection the same way the already-guarded paths do (a `showNotification`/thrown-error with a "name already used at this level" message), not new logic:
1. `importJsonQuizFiles` — check each entry against the (growing, since multiple files in one drop can collide with each other too) array before pushing; skip colliding files with a warning notification, same pattern `copyCategoryTreeToUserQuizzes` already uses for partial-success reporting.
2. `saveToUserQuizzes` — check before pushing; surface a blocking error to the caller so the editor can tell the user rather than silently saving.
3. `window.renameEntryItem` — route through the same check `renameItem()` already uses (or delegate to `renameItem()` itself, since both mutate the same `user_quizzes` array and object shape).
4. `handleEditQuizToolCall` — check before calling `buildUserQuizEntry`/`setInStorage`, mirroring exactly what `handleCreateQuizToolCall` already does with `saveNewUserQuiz`'s rejection path.

**Shared (Supabase)** — these need an actual query-based check (no DB constraint to lean on the way folders/courses have), scoped to the item's `course_id`/`folder_id`:
5. `handleRenameItem` (quiz branch) — before updating, query `quizzes` for another row with the same `title` (trimmed, case-insensitive) at the same `course_id`+`folder_id`, excluding the row itself; 400 with a friendly message on a hit.
6. `handleUpdateQuiz` — same check, scoped to the existing row's own `course_id`/`folder_id` (edit never relocates a quiz), excluding the row itself.
7. `handleMoveItem` (quiz branch) — same check, scoped to the *destination* `course_id`/`folder_id`, before the `update`.

All three server-side checks are the same shape and can share one small helper rather than being written three times.