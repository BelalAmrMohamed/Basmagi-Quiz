# امتحاناتك — Same-Level Naming Rule
Audit Findings & Implementation Plan

“No two elements of the same type and the same name may exist in the same course/folder (or root امتحاناتك)”

**Scope:** نسخ لامتحاناتي · .create-quiz-inline-modal · AI Agent · Create-Quiz Page · Drag-and-drop / JSON import

## 1. Executive Summary
The rule is correctly designed and lives in one canonical, well-documented predicate, but it is not called from every path that can introduce a new name into the tree. Five of the requested entry points enforce it correctly; five distinct gaps were found where a new item can be created, renamed, or imported without going through that predicate — each producing a real, reproducible same-level duplicate or a needless false-positive rename.

The good news: the fix for every gap is almost always the same one-line change — route the existing write through the already-correct shared function instead of writing to user_quizzes directly. No new logic needs to be invented; it needs to be reused.

| Creation surface | Status | Notes |
|---|---|---|
| Create folder / course (menu) | ✅ Enforced | createFolderOrCourseNamed() → hasSameLevelCollision() |
| Rename (right-click menu) | ✅ Enforced | renameItem() → hasSameLevelCollision() |
| Drag-and-drop move (in-tree) | ✅ Enforced | handleDrop() / moveItemsToFolder() |
| “نقل إلى” move dialog | ✅ Enforced | createLocalUserQuizzesMoveSource() |
| Trash restore | ✅ Enforced | restoreTrashBatch() — auto-suffixes on collision |
| نسخ لامتحاناتي — single quiz | ✅ Enforced | copyQuizToUserQuizzes() |
| نسخ لامتحاناتي — full tree | ✅ Enforced | copyCategoryTreeToUserQuizzes() |
| .create-quiz-inline-modal — paste text | ✅ Enforced | saveNewUserQuiz(), correctly parented |
| .create-quiz-inline-modal — multi-file drop | ❌ Bug #2 | importJsonQuizFiles() — no check, forced to root |
| Plain JSON drag-and-drop on امتحاناتك | ❌ Bug #2 | Same importJsonQuizFiles() gap |
| Admin folder-picker import | ⚠️ Bug #1 | uniqueNameAtLevel() ignores type |
| AI Agent — create_quiz / create_folder / create_course / move_item | ✅ Enforced | All route through shared functions |
| AI Agent — edit_quiz (rename) | ❌ Bug #3 | No hasSameLevelCollision() call |
| Create-Quiz Page — save / “حفظ محليًا” | ❌ Bug #4 | Independent 3rd save implementation |
| Create-Quiz Page — entry-screen rename | ❌ Bug #5 | Independent 4th rename implementation |

## 2. The Canonical Rule (what “correct” looks like)
Location: `public/src/features/home/user-quizzes-folders.js`, function `hasSameLevelCollision(userQuizzes, { type, title, parentId, excludeId })`.

This is the single source of truth for the rule. It:
* Normalizes title comparison (trim + lowercase).
* Compares the row's effective type — a plain quiz row has no `meta.type`, so it's treated as `"quiz"`.
* Compares `parentId` (`null` = root) exactly.
* Excludes a given `id` (so renaming/moving an item doesn't collide with itself).
* Ignores unreachable/orphaned rows (via `isRowReachable()`), so a leftover row from an old bug never blocks a legitimate new name.

Any code path that introduces, renames, or relocates a name at a level must call this function (or its established sibling pattern, the trash-restore auto-suffix loop) before writing to storage. The audit below checks every requested entry point against that standard.

### 2.1 Two acceptable enforcement styles
* **Reject-on-collision:** used by manual create/rename/move — shows a warning, aborts the write. Correct for explicit, single-item, user-initiated actions where the user should choose a new name themselves.
* **Auto-suffix-on-collision:** used by trash restore — appends “ (2)”, “ (3)”… until free. Correct for bulk/background operations (restoring many items at once) where aborting the whole batch over one name clash is worse than a renamed item.

Both styles are legitimate; the bug is not which style a given path chose, but that several paths implement neither.

## 3. Detailed Findings

### Bug #1 — Admin folder import ignores type when de-duplicating
**Severity:** Medium    **Surface:** Drag-and-drop a folder (admin “استيراد مجلد من جهازك”)
**File:** `public/src/features/home/user-quizzes-folders.js` — function `uniqueNameAtLevel(name, parentId)` (used inside `importFolderTree()`)

**What happens**
When an admin picks a local directory to bulk-import (every subfolder becomes a folder/course, every `.json` becomes a quiz), the helper that keeps sibling names unique builds its “taken” set from every row sharing the same parentId, regardless of type:
```javascript
function uniqueNameAtLevel(name, parentId) {
  const takenLower = new Set(
    userQuizzes
      .filter((q) => (q.meta?.parentId || null) === parentId)
      .map((q) => (q.meta?.title || "").trim().toLowerCase()),
  );
  // ← no q.meta?.type check at all
  ...
}
```

**Why it violates the rule**
The rule explicitly allows a folder and a quiz (different types) to share a name at the same level. This function instead treats any name collision — regardless of type — as taken, so importing a folder named “رياضيات” into a level that already has a plain quiz named “رياضيات” needlessly renames the imported folder to “رياضيات (2)”. This is a false-positive block, the opposite direction from most of the other bugs (which under-enforce), but it is still a rule violation: two different-typed items should have been allowed to keep the same name.

**Why this is worth fixing even though it's admin-only**
The codebase already solved this exact problem correctly one file away, in `restoreTrashBatch()` (`user-quizzes-trash.js`), which auto-suffixes using the identical pattern but does include type in its `hasSameLevelCollision()` call. `uniqueNameAtLevel()` is a second, parallel, slightly-wrong reimplementation of that same idea.

**Recommended fix**
Delete `uniqueNameAtLevel()` entirely.
Replace its one call site (inside `ensureFolderRecord()`) with the same auto-suffix loop pattern already used in `restoreTrashBatch()`: loop while `hasSameLevelCollision(userQuizzes, { type, title, parentId, excludeId })` is true, appending “ (n)”.
This also fixes the schema-consistency comment already present at that call site for free, since it becomes literally the same code path as trash-restore's proven implementation.

### Bug #2 — JSON drag-and-drop import has no naming-rule enforcement at all
**Severity:** Critical    **Surface:** Drag-and-drop a .json file / files
**File:** `public/src/features/home/quiz-file-import.js` — function `importJsonQuizFiles(files, options)`

**What happens**
This is the actual file-drop handler wired to two drop zones: the whole امتحاناتك grid (`user-quizzes-view.js:701`) and the `.create-quiz-inline-modal`'s drop target for multi-quiz files (`create-quiz-modal.js:199-242`). For every parsed entry it does:
```javascript
entries.forEach((entry) => {
  existingQuizzes.push(entry);
  importedCount++;
});
...
setInStorage("user_quizzes", JSON.stringify(existingQuizzes));
```
There is no call to `hasSameLevelCollision` anywhere in this file. Two separate problems compound here:
* No duplicate check: dropping a file whose quiz title matches an existing quiz/folder/course at the same level silently creates a same-level duplicate — exactly what the rule exists to prevent.
* Wrong destination: `buildUserQuizEntry(id, parsed, titleFallback, parentId)` accepts a `parentId` argument (defaulting to null), but `importJsonQuizFiles()` never passes one through. Every dropped file lands at the امتحاناتك root, even if the user was browsing inside a folder when they dropped it — inconsistent with every other creation path in the app, all of which respect `currentFolderId`.

**Confirmed call sites with no guard**
* `user-quizzes-view.js:701` — `wireJsonFileDropZone(container, (files) => importJsonQuizFiles(files), ...)`
* `create-quiz-modal.js:204` — multi-file drop inside the inline modal
* `create-quiz-modal.js:235` — a single file whose content is itself a multi-quiz array

Note: the inline modal's other two sub-paths — a single-quiz file drop, and the file-picker button — do NOT have this bug. Both only pre-fill the paste-text textarea; the actual save still goes through the modal's `createBtn.onclick` handler, which correctly calls `saveNewUserQuiz(parsed, title, currentFolderId)`. Only the “multiple files at once” and “single file containing multiple quizzes” branches bypass that safe path by calling `importJsonQuizFiles()` directly.

**Recommended fix**
Add a `parentId` parameter to `importJsonQuizFiles(files, { refresh, parentId = null })`, threaded through to `buildUserQuizEntry` / `quizzesFromParsedJson`.
At both call sites, pass the live `currentFolderId` (imported from `user-quizzes-folders.js`) instead of leaving it implicit.
Before pushing each entry, run it through the same collision check used by `saveNewUserQuiz` — for a multi-file batch, prefer the auto-suffix style (consistent with trash-restore) over an all-or-nothing reject, since aborting an entire batch drop over one clashing filename is a worse UX than renaming that one file's quiz.
Surface a summary notification when any files were auto-renamed, mirroring the admin-import's existing summary-before-write pattern.

### Bug #3 — AI Agent's edit_quiz (rename) tool bypasses the check
**Severity:** High    **Surface:** AI Agent on امتحاناتك
**File:** `public/src/features/home/user-quizzes-view.js` — function `handleEditQuizToolCall(toolCall)`

**What happens**
The AI Agent's `create_quiz`, `create_folder`, `create_course`, and `move_item` tool handlers all correctly route through the shared guarded functions (`saveNewUserQuiz`, `createFolderOrCourseNamed`, `moveItemsToFolder` respectively) and surface a same-level-clash error back into the chat when blocked. `edit_quiz` — which can change a quiz's title, i.e. perform a rename — does not:
```javascript
const entry = buildUserQuizEntry(qz(existing, "id") || existing.id, parsed, newTitle);
quizzes[index] = entry;
setInStorage("user_quizzes", JSON.stringify(quizzes));
// ← no hasSameLevelCollision() check before this write
```

**Why it violates the rule**
The manual UI rename path (`renameItem()` in `user-quizzes-folders.js`) explicitly guards against exactly this scenario — a rename that would collide with an existing same-type sibling. Asking the AI Agent to “rename X to Y” where Y already exists at that level silently produces a same-level duplicate instead of the same friendly rejection the manual rename gives.

**Recommended fix**
Before building the replacement entry, compute `parentId` from `existing.meta?.parentId` and itemType from `existing.meta?.type || "quiz"`.
Call `hasSameLevelCollision(quizzes, { type: itemType, title: newTitle, parentId, excludeId: itemId })`; if true, throw the same shape of error the other four tool handlers already use (`err.userMessage` set, so the chat surfaces it and the model can retry with a different title), matching `create_quiz`'s existing pattern one function above it in the same file.
No new user-facing string is needed — reuse the exact Arabic message already used by `renameItem()` (“يوجد عنصر بنفس الاسم والنوع في هذا المستوى...”) for consistency.

### Bug #4 — Create-Quiz Page save flow is a third, unguarded implementation
**Severity:** Critical    **Surface:** Create-Quiz Page — “حفظ محليًا” / Ctrl+S / main save action
**File:** `public/src/features/create/create-quiz.js` — functions `saveToUserQuizzes()` and `updateInUserQuizzes()`, invoked from `window.saveLocally`

**What happens**
This page never imports from `user-quizzes-folders.js` or `quiz-schema.js`. It reads and writes `localStorage.getItem/setItem("user_quizzes", ...)` directly, with its own payload builder (`buildQuizPayload`):
```javascript
function saveToUserQuizzes(quizToSave) {
  const existingQuizzes = JSON.parse(localStorage.getItem("user_quizzes") || "[]");
  const quizId = `user_quiz_${Date.now()}`;
  const newQuiz = { id: quizId, ...buildQuizPayload(quizToSave, quizId) };
  existingQuizzes.push(newQuiz);
  localStorage.setItem("user_quizzes", JSON.stringify(existingQuizzes));
  return quizId;
}
```

**Three compounding problems**
* No collision check: `hasSameLevelCollision` is never imported or called here. Saving a quiz titled the same as an existing one at the same level silently duplicates it.
* No `parentId` at all: `buildQuizPayload()`'s meta object never sets `parentId` — not even explicitly to null. Every fallback reader in the app treats a missing `parentId` as root (`q.meta?.parentId || null`), so a quiz created from this page always lands at the امتحاناتك root, even if “إنشاء امتحان جديد” was invoked while browsing inside a folder/course. This is the single most consequential gap found, because the Create-Quiz Page is the primary, most heavily used way to make a new quiz.
* Divergent id scheme: ids here are `user_quiz_${Date.now()}` strings, and `meta.id` is never set to match — unlike every other creation path in the codebase (`createFolderOrCourseNamed`, `copy-to-my-quizzes.js`, `importFolderTree`, `saveNewUserQuiz`), which keep a top-level `id` and `meta.id` in sync specifically so every `q.id || q.meta?.id` fallback read agrees regardless of origin. This is a latent correctness risk for anything that only reads `meta.id`.

**Why updateInUserQuizzes() is affected too**
Editing an existing quiz and changing its title while saving goes through `updateInUserQuizzes()`, which has the identical gap: it rebuilds the payload via the same `buildQuizPayload()` and writes it back with no collision check against the (possibly changed) title.

**Recommended fix**
Thread the destination folder through the page: when the Create-Quiz Page is opened from امتحاناتك with a specific folder/course in context (e.g. via a query param, matching how `?edit=<id>` already works), preserve that id across the editing session the same way `editingQuizId`/`currentDraftId` already are.
Replace `saveToUserQuizzes()`'s body with a call into the shared `saveNewUserQuiz(parsed, title, parentId)` (`quiz-schema.js`) — the exact function `.create-quiz-inline-modal`'s paste-text path already uses successfully — instead of reimplementing payload-building and storage writes locally. This single change also fixes the id/meta.id divergence for free, since `saveNewUserQuiz` already keeps them in sync via `crypto.randomUUID()`.
For `updateInUserQuizzes()`, add a `hasSameLevelCollision(..., { excludeId: quizId })` check before committing a title change, mirroring `renameItem()`'s guard, and surface the same rejection notification pattern already used elsewhere on this page (`showNotification("خطأ", ...)`) if it fires.
Treat this as the highest-priority fix in the plan given how central this page is to quiz creation.

### Bug #5 — Create-Quiz Page's own entry-screen rename is a fourth unguarded implementation
**Severity:** High    **Surface:** Create-Quiz Page — entry screen “⋮” menu → rename
**File:** `public/src/features/create/create-quiz.js` — function `window.renameEntryItem`

**What happens**
The entry screen (the grid of recent/saved quizzes shown when the Create-Quiz Page loads with no quiz open) has its own rename action, entirely separate from `renameItem()` in `user-quizzes-folders.js`:
```javascript
if (quiz.meta) {
  quiz.meta.title = newTitle.trim();
} else {
  quiz.title = newTitle.trim();
}
localStorage.setItem("user_quizzes", JSON.stringify(userQuizzes));
// ← no hasSameLevelCollision() check
```

**Why it violates the rule**
Identical failure mode to Bug #3: a rename that collides with an existing same-type sibling at the same level is written through without any check, producing a silent same-level duplicate — something the equivalent action in the امتحاناتك grid already prevents.

**Recommended fix**
Before writing `quiz.meta.title = newTitle.trim()`, compute the item's `parentId` and type the same way `renameItem()` does, and call `hasSameLevelCollision(userQuizzes, { type, title: newTitle.trim(), parentId, excludeId: quizId })`.
On a collision, show the same warning notification pattern this page already uses elsewhere (`showNotification("الاسم مستخدم", ..., "warning")`) and leave the item untouched, mirroring `renameItem()`'s early return.
Longer-term: consider having this button call the shared `renameItem()` (or a small exported wrapper around it) instead of maintaining a second implementation — the two are already meant to do the same thing to the same storage key.

## 4. Verified Safe — No Action Needed
These were investigated because they touch the same rule or storage key, but were confirmed to already enforce it correctly. Listed so the fix work below doesn't accidentally duplicate or regress them.

* **نسخ لامتحاناتي** (all three entry points — `exam-card.js`, `root-view.js`, `category-view.js`): all call into `copy-to-my-quizzes.js`'s `copyQuizToUserQuizzes()` / `copyCategoryTreeToUserQuizzes()`, both of which correctly call `hasSameLevelCollision()` for every node, including nested folder/course branches within a copied tree.
* **.create-quiz-inline-modal** — paste-text / single-file-drop / file-picker sub-paths: all converge on the same `createBtn.onclick` handler, which calls `saveNewUserQuiz(parsed, title, currentFolderId)` — correctly parented and collision-checked. Only the multi-file drop sub-path (Bug #2) diverges from this.
* **AI Agent** — `create_quiz`, `create_folder`, `create_course`, `move_item`: each dispatches to a handler in `user-quizzes-view.js` that calls the same shared, guarded functions the manual UI uses, and throws a chat-visible error (`err.userMessage`) on collision so the model can retry with a different name.
* **Drag-and-drop move within the tree, and the “نقل إلى” dialog:** `handleDrop()`, `moveItemsToFolder()`, and the move-to-dialog's per-node `getDisabledReason()` all call `hasSameLevelCollision()` before allowing a placement.
* **Trash restore:** `restoreTrashBatch()` re-checks every restored item against the live tree and auto-suffixes on collision, correctly including type in the check — this is the reference implementation Bug #1's fix should copy.
* **Upload-to-platform builders** (`buildCourseUploadPayload` / `buildFolderUploadPayload`): out of scope — these serialize a local subtree for the server-side database, they do not create or rename anything inside the local `user_quizzes` tree.

## 5. Root Cause Analysis
Every confirmed bug shares the same underlying pattern: a code path writes to the `user_quizzes` localStorage array directly (via `getFromStorage`/`setInStorage` or raw `localStorage` calls) instead of going through one of the small number of already-guarded functions that exist specifically to be the single writer for their operation type:

| Operation | Canonical guarded function | Bypassed by |
|---|---|---|
| Create a quiz | saveNewUserQuiz() — quiz-schema.js | importJsonQuizFiles() (Bug #2), saveToUserQuizzes() (Bug #4) |
| Rename an item | renameItem() — user-quizzes-folders.js | handleEditQuizToolCall() (Bug #3), renameEntryItem() (Bug #5) |
| Create folder/course | createFolderOrCourseNamed() — user-quizzes-folders.js | importFolderTree()'s uniqueNameAtLevel() (Bug #1, wrong-shaped check rather than a full bypass) |

In short: the rule was correctly built as a shared utility, but was adopted feature-by-feature rather than enforced structurally. Every new UI entry point that was wired up after the fact by importing the shared function got it right (AI Agent, move dialog, trash restore, نسخ لامتحاناتي). Every entry point that pre-dated the shared function, or that lives in a different file with its own historical storage-access pattern (`create-quiz.js`, `quiz-file-import.js`), still writes directly and was never migrated.

## 6. Implementation Plan
No code is changed as part of this document. The steps below are the recommended order of work for a follow-up implementation pass.

**Phase 1 — Highest-impact, user-facing fixes**
1. Fix Bug #4 (Create-Quiz Page save/update). Highest priority: this is the main quiz-creation surface. Route `saveToUserQuizzes()` through `saveNewUserQuiz()`, and add a collision check (excluding the item's own id) to `updateInUserQuizzes()`. Thread the intended `parentId` through the page's existing session-state pattern (alongside `editingQuizId` / `currentDraftId`).
2. Fix Bug #2 (JSON drag-and-drop). Add a `parentId` parameter to `importJsonQuizFiles()`, pass `currentFolderId` at both call sites, and add an auto-suffix-on-collision loop (matching trash-restore's style) before each push.
3. Fix Bug #5 (Create-Quiz Page entry-screen rename). Add the same collision check `renameItem()` already performs, before committing the title change.

**Phase 2 — AI Agent parity**
4. Fix Bug #3 (edit_quiz rename via AI Agent). Add the `hasSameLevelCollision()` check and throw the same `err.userMessage`-carrying error shape the sibling tool handlers already use, so the chat surfaces a clear, retryable rejection.

**Phase 3 — Admin-only cleanup**
5. Fix Bug #1 (admin folder-picker import). Replace `uniqueNameAtLevel()` with the trash-restore auto-suffix pattern (type-aware). Lower urgency since this feature is gated behind `isAdminAuthenticated()`.

**Phase 4 — Regression coverage**
For each fix above, verify by hand (or via a scripted check against localStorage) the following four scenarios, since they are the ones the rule is actually meant to allow or block:
* Same name, same type, same parent → must be blocked (or auto-suffixed, per that path's chosen style).
* Same name, different type, same parent → must be allowed (a folder and a quiz named “رياضيات” side by side).
* Same name, same type, different parent (e.g. one at root, one inside a folder) → must be allowed.
* Same name colliding only with an unreachable/orphaned row → must be allowed (`isRowReachable()` already handles this in the shared predicate; just confirm each fixed path still uses that predicate rather than a hand-rolled filter).

**Phase 5 — Prevent regression going forward**
Add a short code comment at the top of `user_quizzes`'s storage-helpers import points (or a lint rule / grep-based CI check) flagging any new `localStorage.setItem("user_quizzes", ...)` or `setInStorage("user_quizzes", ...)` call that isn't inside `user-quizzes-folders.js`, `quiz-schema.js`, `copy-to-my-quizzes.js`, or `user-quizzes-trash.js` — the four files that currently own writes to this key correctly.

Longer-term, consider consolidating all direct `user_quizzes` writes behind a single small module (a thin “repository” layer) so `create-quiz.js` and `quiz-file-import.js` are structurally unable to bypass the naming rule the way they do today — this is a larger refactor and not required to fix the five bugs above, but would prevent the same class of bug from recurring in a sixth entry point.

## 7. Appendix — File Reference

| File | Relevance |
|---|---|
| `public/src/features/home/user-quizzes-folders.js` | Canonical `hasSameLevelCollision()`; create/rename/move/drag-drop; Bug #1's `uniqueNameAtLevel()` |
| `public/src/features/home/quiz-schema.js` | `saveNewUserQuiz()` — the correct pattern Bug #4 should reuse |
| `public/src/features/home/quiz-file-import.js` | Bug #2 — `importJsonQuizFiles()` |
| `public/src/features/home/create-quiz-modal.js` | `.create-quiz-inline-modal` — safe paths + Bug #2's call sites |
| `public/src/features/home/copy-to-my-quizzes.js` | نسخ لامتحاناتي — verified safe |
| `public/src/features/home/user-quizzes-view.js` | AI Agent tool-call handlers; Bug #3 — `handleEditQuizToolCall()` |
| `public/src/features/home/user-quizzes-trash.js` | `restoreTrashBatch()` — reference auto-suffix implementation |
| `public/src/features/create/create-quiz.js` | Create-Quiz Page — Bug #4 and Bug #5 |
| `api/ai-agent/_tools.js` | AI Agent tool schemas (`create_quiz`, `create_folder`, `create_course`, `move_item`, `edit_quiz`) |
