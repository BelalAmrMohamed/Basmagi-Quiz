// public/src/features/home/user-quizzes-folders.js
import { getFromStorage, setInStorage } from "../../shared/storage-helpers.js";
import { _prompt, _confirm, _confirmTyped, showNotification } from "../../components/notifications/notifications.js";
import { isAdminAuthenticated } from "../../shared/adminAuth.js";
import { renderUserQuizzesView, updateBulkActionBar } from "./user-quizzes-view.js";
import { getSelectedUserQuizzes } from "./app-state.js";
import { toSlug } from "./slug-utils.js";
import { buildUserQuizEntry } from "./quiz-schema.js";
import { getSubjectIcon } from "./subject-icons.js";
import { MORE_DOTS_ICON_SVG } from "./icons.js";
import { openMoveToDialogWithSource } from "./move-to-dialog.js";

// Current navigation state
export let currentFolderId = null;
let folderPathStack = [];

export function getChildren(userQuizzes, parentId) {
  return userQuizzes.filter((q) => (q.meta?.parentId || null) === parentId);
}

/**
 * Walks a row's full parentId chain up to a root (parentId === null) and
 * returns true only if every ancestor along the way actually exists in
 * `userQuizzes`. A row one level below a missing parent is caught by a
 * simple "does my direct parent exist" check, but a row whose *grandparent*
 * is missing (its direct parent still exists as a row, but that parent's
 * own parent doesn't) would incorrectly pass a one-level check — this walks
 * the whole chain, the same way isDescendant() below already does for the
 * unrelated "am I inside myself" check, so both share the same notion of
 * what "reachable from root" means.
 *
 * Used by:
 *  - pruneOrphanedRows() (course-count.js) — so the "امتحاناتك" card's
 *    counts only include genuinely reachable rows.
 *  - hasSameLevelCollision() below — so a same-name/type/level clash
 *    against a row that's technically still in storage but unreachable
 *    (a leftover from an old bug, or one being cleaned up) doesn't block a
 *    legitimate new copy/create/rename/move.
 *
 * @param {object} row - a user_quizzes entry
 * @param {Array} userQuizzes
 * @param {Map<string, object>} [byId] - optional id→row lookup to reuse
 *   across many calls in the same pass instead of re-scanning the array
 *   each time (collision checks and bulk operations call this per-row).
 * @returns {boolean}
 */
export function isRowReachable(row, userQuizzes, byId = null) {
  const lookup =
    byId ||
    new Map(
      userQuizzes.map((q) => [q.id || q.meta?.id, q]).filter(([id]) => id),
    );
  const seen = new Set();
  let current = row;
  while (current) {
    const parentId = current.meta?.parentId || null;
    if (parentId === null) return true;
    if (seen.has(parentId)) return false; // cyclic parentId — treat as unreachable, not an infinite loop
    seen.add(parentId);
    current = lookup.get(parentId);
    if (!current) return false;
  }
  return true;
}

/**
 * The one rule the whole "امتحاناتك" section must follow, enforced
 * identically everywhere a new name can be introduced at a level: create
 * (createFolderOrCourseNamed), rename (renameItem), move
 * (moveItemsToFolder), single-quiz copy (copyQuizToUserQuizzes), and
 * tree copy (copyCategoryTreeToUserQuizzes's copyNode, every node type).
 *
 * "No two elements of the same type AND same name may share the same
 * parentId." Different levels are always allowed regardless of name reuse;
 * different types at the same level with the same name are always allowed
 * too (a folder and a course can both be named "math" side by side).
 *
 * Unreachable/orphaned rows (see isRowReachable above) never count as a
 * collision — a leftover row from an old bug shouldn't block a legitimate
 * new item from taking that name.
 *
 * @param {Array} userQuizzes - checked as given, so a caller that has
 *   already `.push()`-ed newly copied siblings earlier in the same pass
 *   (copyCategoryTreeToUserQuizzes copying two subtrees in one call) gets
 *   those included automatically — pass the same live array reference
 *   you're building, not a stale snapshot.
 * @param {{type: string, title: string, parentId: string|null, excludeId?: string}} candidate
 * @returns {boolean} true if placing `candidate` would collide
 */
export function hasSameLevelCollision(userQuizzes, { type, title, parentId, excludeId = null }) {
  const normalizedTitle = (title || "").trim().toLowerCase();
  const normalizedParentId = parentId || null;
  const byId = new Map(
    userQuizzes.map((q) => [q.id || q.meta?.id, q]).filter(([id]) => id),
  );
  return userQuizzes.some((q) => {
    const qId = q.id || q.meta?.id;
    if (excludeId && qId === excludeId) return false;
    const qType = q.meta?.type || "quiz"; // plain quiz rows carry no meta.type
    if (qType !== (type || "quiz")) return false;
    if ((q.meta?.parentId || null) !== normalizedParentId) return false;
    if ((q.meta?.title || "").trim().toLowerCase() !== normalizedTitle) return false;
    return isRowReachable(q, userQuizzes, byId);
  });
}

/**
 * Courses are always top-level — they never live inside another folder or
 * course, and nothing may be moved/dropped/dragged into a course except
 * directly from the root. This is the single guard every move/drop/create
 * path below funnels through, so the rule can't drift out of sync between
 * drag-and-drop, the move-to dialog, the context menu, and the breadcrumb
 * drop targets the way separate ad-hoc checks would.
 * @param {object[]} userQuizzes
 * @param {string} itemId - the item being placed somewhere
 * @param {string|null} targetFolderId - where it would be placed (null = root)
 * @returns {{allowed: boolean, reason?: string}}
 */
export function canPlaceItem(userQuizzes, itemId, targetFolderId) {
  const item = userQuizzes.find((q) => (q.id || q.meta?.id) === itemId);
  const isCourse = item?.meta?.type === "course";

  // A course may only ever sit at the root — moving it anywhere else
  // (including into another course) is never allowed.
  if (isCourse && targetFolderId !== null) {
    return { allowed: false, reason: "المواد تبقى في المستوى الرئيسي دائماً ولا يمكن نقلها داخل مجلد أو مادة أخرى." };
  }

  // Nothing may be placed *inside* a course except directly (a course can
  // hold folders/quizzes as children — that's normal); this only blocks
  // placing a course inside a course, already covered above, and moving
  // an item into itself/its own descendant (checked by the caller via
  // isDescendant since that needs the full ancestry walk).
  return { allowed: true };
}

export function getCurrentFolderPathStack() {
  return folderPathStack;
}

/** The id one level up from currentFolderId (null = root), based on
 * folderPathStack. Used by the "نقل إلى الخارج" (move out) shortcut. */
function pathStackParentId() {
  if (folderPathStack.length <= 1) return null;
  return folderPathStack[folderPathStack.length - 2].id;
}

export function navigateToFolder(folderId, folderTitle) {
  if (folderId === null) {
    currentFolderId = null;
    folderPathStack = [];
  } else {
    currentFolderId = folderId;
    const existingIndex = folderPathStack.findIndex((f) => f.id === folderId);
    if (existingIndex !== -1) {
      folderPathStack = folderPathStack.slice(0, existingIndex + 1);
    } else {
      folderPathStack.push({ id: folderId, title: folderTitle });
    }
  }
  renderUserQuizzesView();
}

/**
 * Build the URL hash for the current folder path stack.
 * Root level = "#my-quizzes", nested = "#my-quizzes/slug1/slug2"
 */
export function buildFolderHash() {
  if (folderPathStack.length === 0) return "#my-quizzes";
  const slugs = folderPathStack.map((f) => toSlug(f.title));
  return "#my-quizzes/" + slugs.join("/");
}

/**
 * Restore folder state without triggering a new renderUserQuizzesView().
 * Called by restoreViewFromURL() so the URL → state sync doesn't cause
 * double renders or phantom pushState entries.
 */
export function setFolderState(stack, folderId) {
  folderPathStack = stack;
  currentFolderId = folderId;
}

export async function createNewFolderOrCourse(type = "folder") {
  const name = await _prompt(`أدخل اسم ال${type === "course" ? "مادة" : "مجلد"}:`);
  if (!name || !name.trim()) return;
  const result = createFolderOrCourseNamed(type, name.trim(), currentFolderId);
  if (!result.ok) {
    showNotification("تعذر الإنشاء", result.reason, "warning");
    return;
  }
  renderUserQuizzesView();
}

/**
 * Non-interactive counterpart to createNewFolderOrCourse — takes the name
 * and parent directly instead of prompting, so callers that already have
 * structured input (the AI agent's create_folder/create_course tools; a
 * future bulk-import path, etc.) don't need to fake a prompt() response.
 * Shares the exact same duplicate-name guard and record shape as the
 * interactive path so both stay in sync.
 * @param {"folder"|"course"} type
 * @param {string} name
 * @param {string|null} parentId
 * @returns {{ok: boolean, id?: string, reason?: string}}
 */
export function createFolderOrCourseNamed(type, name, parentId) {
  const trimmedName = (name || "").trim();
  if (!trimmedName) return { ok: false, reason: "الاسم مطلوب." };

  // Courses are top-level only (see canPlaceItem) — reject up front with a
  // clear reason rather than silently creating it at root regardless of
  // what parentId was requested, which would surprise a caller that
  // expected the folder they asked for.
  if (type === "course" && parentId !== null) {
    return { ok: false, reason: "المواد تبقى في المستوى الرئيسي دائماً ولا يمكن إنشاؤها داخل مجلد." };
  }

  const userQuizzes = JSON.parse(getFromStorage("user_quizzes", "[]"));

  // BUG FIX: this used to compare only parentId + title, never type — a
  // course named "math" would block a folder also named "math" at the same
  // level, even though they're different types and the rule only forbids
  // same-type + same-name clashes. Now routed through the single shared
  // predicate every other creation/rename/move/copy path also uses.
  if (hasSameLevelCollision(userQuizzes, { type, title: trimmedName, parentId: parentId || null })) {
    return { ok: false, reason: "يوجد عنصر بنفس الاسم والنوع في هذا المستوى بالفعل." };
  }

  // BUG FIX (schema consistency): give every row both a top-level `id` and
  // a `meta.id` set to the same value. Two different code paths create
  // folder/course rows — this one (previously top-level id only) and
  // copyCategoryTreeToUserQuizzes()'s copyNode() (previously meta.id only,
  // no top-level id at all) — and every reader in this codebase falls back
  // with `q.id || q.meta?.id`. Keeping both in sync means that fallback
  // always finds the same value regardless of which function created the
  // row.
  const newId = crypto.randomUUID();
  const newFolder = {
    id: newId,
    meta: {
      id: newId,
      type,
      title: trimmedName,
      parentId: parentId || null,
      createdAt: new Date().toLocaleString("en-US"),
    },
    stats: { questionCount: 0, questionTypes: [] },
    questions: [],
  };
  userQuizzes.push(newFolder);
  setInStorage("user_quizzes", JSON.stringify(userQuizzes));
  return { ok: true, id: newFolder.id };
}

/**
 * Resolves a folder/course by title (case-insensitive) rather than id, so
 * callers working from human-readable names (the AI agent only ever sees
 * titles, never internal UUIDs — see the folder-tree contextPrompt built
 * in user-quizzes-view.js) can find the right target without the caller
 * needing to already know the id. When `parentTitle` is omitted, matches
 * anywhere in the tree; multiple same-named folders at different depths is
 * an accepted ambiguity here (returns the first match) since duplicate
 * names are only prevented within a single parent, not tree-wide.
 * @param {string} title
 * @param {string|null} [parentTitle] - restrict the match to children of
 *   the folder/course with this title (also resolved by name)
 * @returns {{id: string, type: string}|null}
 */
export function findFolderByName(title, parentTitle = null) {
  const userQuizzes = JSON.parse(getFromStorage("user_quizzes", "[]"));
  const normalize = (s) => (s || "").trim().toLowerCase();

  let parentId = null;
  if (parentTitle) {
    const parent = userQuizzes.find(
      (q) => (q.meta?.type === "folder" || q.meta?.type === "course") &&
        normalize(q.meta?.title) === normalize(parentTitle),
    );
    if (!parent) return null;
    parentId = parent.id || parent.meta?.id;
  }

  const match = userQuizzes.find((q) => {
    if (q.meta?.type !== "folder" && q.meta?.type !== "course") return false;
    if (normalize(q.meta?.title) !== normalize(title)) return false;
    if (parentTitle && (q.meta?.parentId || null) !== parentId) return false;
    return true;
  });
  if (!match) return null;
  return { id: match.id || match.meta?.id, type: match.meta.type };
}

export async function renameItem(itemId, currentTitle) {
  const newName = await _prompt("أدخل الاسم الجديد:", currentTitle);
  if (!newName || !newName.trim()) return;

  const userQuizzes = JSON.parse(getFromStorage("user_quizzes", "[]"));
  const item = userQuizzes.find((q) => q.id === itemId || q.meta?.id === itemId);
  if (!item || !item.meta) return;

  const trimmedName = newName.trim();
  const parentId = item.meta?.parentId || null;
  const itemType = item.meta?.type || "quiz";

  // BUG FIX: same predicate as createFolderOrCourseNamed — routed through
  // the shared hasSameLevelCollision() so type is actually compared (a
  // rename to a name already used by a different-typed sibling should be
  // allowed) and unreachable/orphaned rows never block a legitimate rename.
  if (hasSameLevelCollision(userQuizzes, { type: itemType, title: trimmedName, parentId, excludeId: itemId })) {
    showNotification("الاسم مستخدم", "يوجد عنصر بنفس الاسم والنوع في هذا المستوى. اختر اسماً مختلفاً.", "warning");
    return;
  }

  item.meta.title = trimmedName;
  setInStorage("user_quizzes", JSON.stringify(userQuizzes));
  renderUserQuizzesView();
}

/**
 * Given a set of ids the user explicitly selected, expands it to also
 * include every descendant of any folder/course among them, against a given
 * userQuizzes snapshot. Shared by deleteFolder() (single item, always a
 * folder/course) and the bulk-delete action in user-quizzes-view.js (a mixed
 * selection that may or may not include folders/courses).
 *
 * BUG FIX: the bulk-delete handler used to remove only the exact ids the
 * user had checked. That's fine when "تحديد الكل" was used first (it selects
 * every row in the flat array, nested children included), but checking a
 * folder/course row without also individually checking its children left
 * those children behind as orphans — rows whose meta.parentId pointed at an
 * id that no longer existed. They didn't render anywhere (every view walks
 * down from a real, existing parent), but they kept inflating the
 * "امتحاناتك" card's counts (see pruneOrphanedRows in course-count.js) even
 * after the visible list looked empty. Expanding the selection to include
 * descendants before deleting stops new orphans from being created.
 * @param {Set<string>} selectedIds
 * @param {Array} userQuizzes
 * @returns {Set<string>}
 */
export function expandSelectionWithDescendants(selectedIds, userQuizzes) {
  const idsToDelete = new Set(selectedIds);
  let added = true;
  while (added) {
    added = false;
    for (const q of userQuizzes) {
      const qId = q.id || q.meta?.id;
      if (q.meta?.parentId && idsToDelete.has(q.meta.parentId) && !idsToDelete.has(qId)) {
        idsToDelete.add(qId);
        added = true;
      }
    }
  }
  return idsToDelete;
}

/**
 * Soft-deletes an item (quiz/folder/course, called from showContextMenu's
 * "حذف" for any targetType) into the local trash instead of discarding it —
 * see user-quizzes-trash.js and plan §4. Cascades to every descendant via
 * expandSelectionWithDescendants (unchanged from the old hard-delete
 * behavior) so a folder/course and everything inside it move to the trash
 * together, as one restorable/purgeable batch.
 *
 * BUG FIX (copy): the confirm wording used to say the delete "لا يمكن
 * التراجع عنه" (irreversible) — no longer true now that this routes through
 * the trash, so the message reflects that instead.
 */
export async function deleteFolder(folderId) {
  const userQuizzes = JSON.parse(getFromStorage("user_quizzes", "[]"));
  const target = userQuizzes.find((q) => (q.id || q.meta?.id) === folderId);
  if (!target) return;

  if (!(await _confirm("سيُنقل هذا العنصر إلى سلة المهملات. هل تريد المتابعة؟"))) return;

  const idsToDelete = expandSelectionWithDescendants(new Set([folderId]), userQuizzes);
  const itemsToTrash = userQuizzes.filter(
    (q) => idsToDelete.has(q.id) || idsToDelete.has(q.meta?.id),
  );
  const newQuizzes = userQuizzes.filter((q) => !idsToDelete.has(q.id) && !idsToDelete.has(q.meta?.id));

  const { moveToTrash } = await import("./user-quizzes-trash.js");
  moveToTrash(itemsToTrash, target.meta?.title || "عنصر بلا اسم");

  setInStorage("user_quizzes", JSON.stringify(newQuizzes));
  renderUserQuizzesView();

  const { refreshUserQuizzesCard } = await import("./course-count.js");
  refreshUserQuizzesCard();
}

/**
 * "حذف الكل" — wipes the entire "امتحاناتك" collection (every quiz, folder,
 * and course) in one action, unconditionally, regardless of current folder
 * or selection state.
 *
 * This exists as a deliberate escape hatch for storage bloat/orphan buildup
 * (see A6/Part D) that no automatic cleanup heuristic should attempt to fix
 * on its own — a user staring at a phantom "5000 lines in localStorage but
 * nothing renders" situation needs a way to just start over without Claude
 * (or the app) guessing which of those rows were "real" vs leftover cruft
 * from a bygone copy-tree bug. `pruneOrphanedRows`-style automatic pruning
 * only removes rows that are provably unreachable; it deliberately does NOT
 * address rows that are technically reachable yet never rendered due to an
 * unrelated view-layer bug — this button is the deliberately blunter, fully
 * manual alternative for exactly that residual case.
 *
 * BUG FIX (double verification): a single button-press _confirm() dialog
 * was the original safeguard here, but "حذف الكل" and the far more common,
 * far less dangerous per-item "حذف" both live in the same #userQuizContextMenu
 * — a user who has learned to reflexively click through the "هل أنت متأكد؟"
 * dialog for routine single-item deletes can just as easily click through
 * it here without reading it, and wipe their entire collection by mistake.
 * Now routed through _confirmTyped() (notifications.js) instead: the
 * button-press step still happens first (identical UI to every other
 * destructive confirmation in the app), but only unlocks a second step
 * where the destructive button stays disabled until the user retypes the
 * literal phrase "حذف الكل" — the same text as the menu item they clicked —
 * exactly. This mirrors GitHub's "type the repo name to confirm deletion"
 * pattern and can't be clicked through on autopilot the way a single
 * yes/no dialog can.
 */
export async function deleteAllUserQuizzes() {
  const confirmed = await _confirmTyped({
    message:
      "سيتم حذف كل امتحاناتك ومجلداتك نهائياً ولا يمكن التراجع عن هذا الإجراء.\nللمتابعة، اضغط \"نعم\" ثم اكتب العبارة المطلوبة في الخطوة التالية.",
    confirmPhrase: "حذف الكل",
    confirmButtonLabel: "حذف كل شيء نهائياً",
  });
  if (!confirmed) return;

  setInStorage("user_quizzes", "[]");
  // navigateToFolder(null, ...) resets to root AND calls
  // renderUserQuizzesView() itself — no need to call it again here.
  navigateToFolder(null, null);

  const { refreshUserQuizzesCard } = await import("./course-count.js");
  refreshUserQuizzesCard();

  showNotification("تم الحذف", "تم حذف كل امتحاناتك ومجلداتك.", "success");
}

// Drag and drop logic
let draggedItemId = null;

export function handleDragStart(e, itemId) {
  draggedItemId = itemId;
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", itemId);
  e.target.style.opacity = "0.5";
}

export function handleDragEnd(e) {
  e.target.style.opacity = "1";
  draggedItemId = null;
}

export function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  e.currentTarget.classList.add("drag-over");
}

export function handleDragLeave(e) {
  e.currentTarget.classList.remove("drag-over");
}

export function handleDrop(e, targetFolderId) {
  e.preventDefault();
  e.currentTarget.classList.remove("drag-over");
  const itemId = e.dataTransfer.getData("text/plain");
  if (!itemId || itemId === targetFolderId) return;

  // Prevent moving a folder into itself or its children
  const userQuizzes = JSON.parse(getFromStorage("user_quizzes", "[]"));
  if (isDescendant(userQuizzes, itemId, targetFolderId)) {
    showNotification("خطأ", "لا يمكن نقل المجلد إلى داخله.", "./favicon.png");
    return;
  }

  // Courses are top-level only — see canPlaceItem's doc comment.
  const placement = canPlaceItem(userQuizzes, itemId, targetFolderId);
  if (!placement.allowed) {
    showNotification("لا يمكن النقل", placement.reason, "warning");
    return;
  }

  const itemIndex = userQuizzes.findIndex((q) => q.id === itemId || q.meta?.id === itemId);
  if (itemIndex === -1) return;
  if (!userQuizzes[itemIndex].meta) userQuizzes[itemIndex].meta = {};
  if ((userQuizzes[itemIndex].meta.parentId || null) === (targetFolderId || null)) return; // already there

  // BUG FIX: this drag-and-drop path is a separate implementation from
  // moveItemsToFolder() below (used by the "نقل إلى" dialog/bulk-move bar)
  // and had never been routed through the shared hasSameLevelCollision()
  // guard — so dragging a quiz/folder onto a target that already had a
  // same-named same-type child silently succeeded and created a same-level
  // duplicate, even though the non-drag move path already blocked exactly
  // this. Both paths now share the same rule.
  const item = userQuizzes[itemIndex];
  if (
    hasSameLevelCollision(userQuizzes, {
      type: item.meta?.type || "quiz",
      title: item.meta?.title || "",
      parentId: targetFolderId || null,
      excludeId: itemId,
    })
  ) {
    showNotification(
      "تعذر النقل",
      "يوجد عنصر بنفس الاسم والنوع في هذا المستوى بالفعل.",
      "warning",
    );
    return;
  }

  item.meta.parentId = targetFolderId;
  setInStorage("user_quizzes", JSON.stringify(userQuizzes));
  renderUserQuizzesView();
}

function isDescendant(quizzes, parentId, checkId) {
  if (parentId === checkId) return true;
  let current = quizzes.find((q) => q.id === checkId || q.meta?.id === checkId);
  while (current && current.meta?.parentId) {
    if (current.meta.parentId === parentId) return true;
    current = quizzes.find((q) => q.id === current.meta.parentId || q.meta?.id === current.meta.parentId);
  }
  return false;
}

/**
 * Re-parent one or more items to `targetFolderId` (null = root), with the
 * same self/descendant guard handleDrop uses. Shared by the single-item
 * "نقل إلى" menu action and the bulk-move action bar button — the only
 * difference between them is how many ids get passed in.
 * @param {string[]} itemIds
 * @param {string|null} targetFolderId
 * @returns {{moved: number, blocked: number}}
 */
export function moveItemsToFolder(itemIds, targetFolderId) {
  const userQuizzes = JSON.parse(getFromStorage("user_quizzes", "[]"));
  let moved = 0;
  let blocked = 0;

  itemIds.forEach((itemId) => {
    if (itemId === targetFolderId) return;
    if (isDescendant(userQuizzes, itemId, targetFolderId)) {
      blocked++;
      return;
    }
    // Courses are top-level only — see canPlaceItem's doc comment.
    if (!canPlaceItem(userQuizzes, itemId, targetFolderId).allowed) {
      blocked++;
      return;
    }
    const item = userQuizzes.find((q) => q.id === itemId || q.meta?.id === itemId);
    if (!item) return;
    if (!item.meta) item.meta = {};
    if ((item.meta.parentId || null) === (targetFolderId || null)) return; // already there
    // BUG FIX: moving an item used to skip the same-level collision check
    // entirely — e.g. dragging a quiz into a folder that already had a
    // same-named quiz would silently create a same-level duplicate. Routed
    // through the same shared predicate as create/rename/copy so this rule
    // applies universally instead of only where someone remembered to add
    // it.
    if (
      hasSameLevelCollision(userQuizzes, {
        type: item.meta?.type || "quiz",
        title: item.meta?.title || "",
        parentId: targetFolderId || null,
        excludeId: itemId,
      })
    ) {
      blocked++;
      return;
    }
    item.meta.parentId = targetFolderId;
    moved++;
  });

  if (moved > 0) setInStorage("user_quizzes", JSON.stringify(userQuizzes));
  return { moved, blocked };
}

/**
 * Builds the MoveSource adapter (see move-to-dialog.js's interface doc)
 * for the "امتحاناتك" localStorage tree. Kept in this file rather than
 * move-to-dialog.js since it's the only thing here that actually reads
 * `user_quizzes` — the dialog itself stays storage-agnostic.
 * @param {string[]} itemIds
 * @returns {object|null} a MoveSource, or null if the move should be
 *   refused outright (see the lone-course guard below) before any dialog
 *   opens at all.
 */
function createLocalUserQuizzesMoveSource(itemIds) {
  const userQuizzes = JSON.parse(getFromStorage("user_quizzes", "[]"));
  const folders = userQuizzes.filter(
    (q) => q.meta?.type === "folder" || q.meta?.type === "course",
  );

  // Moving a single course means there is nowhere valid to move it to at
  // all (courses are top-level only — see canPlaceItem) — the picker
  // would open with every option disabled, which is a worse experience
  // than not opening it. showContextMenu already omits "نقل إلى" for a
  // lone course for this reason; this guard covers any other caller
  // (e.g. a future bulk-select that includes a course) with the same
  // message instead of an empty-looking dialog.
  const movingCourseIds = itemIds.filter((id) => {
    const item = userQuizzes.find((q) => (q.id || q.meta?.id) === id);
    return item?.meta?.type === "course";
  });
  if (movingCourseIds.length && itemIds.length === movingCourseIds.length) {
    showNotification(
      "لا يمكن النقل",
      "المواد تبقى في المستوى الرئيسي دائماً ولا يمكن نقلها.",
      "warning",
    );
    return null;
  }

  // Current location of the item(s) being moved, so it can be excluded/
  // marked as "current" rather than offered as a no-op destination.
  const firstItem = userQuizzes.find((q) => (q.id || q.meta?.id) === itemIds[0]);
  const currentParentId = firstItem?.meta?.parentId || null;

  const itemLabel =
    itemIds.length > 1
      ? `${itemIds.length} عناصر`
      : firstItem?.meta?.title
        ? `"${firstItem.meta.title}"`
        : "العنصر";

  return {
    itemLabel,
    rootLabel: "امتحاناتك (الرئيسية)",
    includeRoot: true,
    showNotification,

    isCurrentDestination(nodeId) {
      return (nodeId || null) === currentParentId;
    },

    getNodes() {
      return folders.map((f) => ({
        id: f.id || f.meta?.id,
        parentId: f.meta?.parentId || null,
        title: f.meta?.title || "",
        icon: f.meta?.icon || (f.meta?.type === "course" ? "📚" : "📁"),
      }));
    },

    // Each node is individually validity-checked against every item being
    // moved:
    // - a descendant of any moving item (would create a cycle)
    // - a course itself, when the payload includes a course (nowhere for a
    //   course to go but root — see canPlaceItem)
    // - a destination that already has a same-name/same-type child (would
    //   silently create a same-level duplicate)
    // - the item's current parent (a no-op, shown but marked/disabled
    //   rather than hidden, so the tree's shape stays predictable) — this
    //   one is handled by isCurrentDestination above rendering the badge
    //   instead, not by disabling the row.
    getDisabledReason(nodeId) {
      if (itemIds.includes(nodeId)) {
        return "لا يمكن نقل عنصر إلى نفسه.";
      }
      if (itemIds.some((id) => isDescendant(userQuizzes, id, nodeId))) {
        return "لا يمكن نقل مجلد إلى داخل نفسه أو أحد مجلداته الفرعية.";
      }
      if (movingCourseIds.length) {
        return "المواد تبقى في المستوى الرئيسي دائماً ولا يمكن نقلها إلى داخل مجلد.";
      }
      // Checked against EVERY item being moved (not just the first) so a
      // bulk move is flagged if it would collide for any one of them.
      const collides = itemIds.some((id) => {
        const movingItem = userQuizzes.find((q) => (q.id || q.meta?.id) === id);
        if (!movingItem) return false;
        return hasSameLevelCollision(userQuizzes, {
          type: movingItem.meta?.type || "quiz",
          title: movingItem.meta?.title || "",
          parentId: nodeId,
          excludeId: id,
        });
      });
      if (collides) {
        return "يوجد عنصر بنفس الاسم والنوع في هذا المجلد بالفعل.";
      }
      return null;
    },

    isFullyBlocked(nodeId) {
      return itemIds.every((id) => isDescendant(userQuizzes, id, nodeId) || id === nodeId);
    },

    moveTo(nodeId) {
      return moveItemsToFolder(itemIds, nodeId);
    },

    onMoved() {
      renderUserQuizzesView();
    },
  };
}

/**
 * Non-drag fallback for moving an item (used by the right-click context
 * menu and the card ⋮ overlay) — opens a small folder-tree picker modal so
 * touch/mobile users, who have no usable drag gesture, can still move items
 * in and out of folders/courses. `itemIds` supports both the single-item
 * case and the bulk-selection case with one shared implementation.
 *
 * Thin wrapper: builds the localStorage MoveSource (see
 * createLocalUserQuizzesMoveSource above) and hands it to the shared,
 * storage-agnostic dialog renderer in move-to-dialog.js. The exported
 * signature is unchanged so every existing caller (the context menu, the
 * card ⋮ overlay, the bulk-selection action bar) needs no changes.
 * @param {string[]} itemIds
 */
export function openMoveToDialog(itemIds) {
  if (!itemIds || itemIds.length === 0) return;
  const source = createLocalUserQuizzesMoveSource(itemIds);
  if (!source) return; // lone-course guard already showed its own notification
  openMoveToDialogWithSource(source);
}

// Context Menu Logic
let contextMenuEl = null;
// Track whether the last contextmenu event opened our custom menu.
// Used to implement the toggle behavior:
//   1st right-click: opens custom menu (preventDefault)
//   2nd right-click: hides custom menu, allows native menu to show
//   3rd right-click: opens custom menu again
let customMenuJustOpened = false;

// SVG icons for context menu items
const CREATE_FOLDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;
const CREATE_COURSE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`;
const UPLOAD_FOLDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`;
const SELECT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>`;
const RENAME_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
// Matches the ⋮ dropdown's own "تعديل الامتحان" icon (EDIT_ICON_SVG in
// icons.js), redrawn at this menu's 15x15 size instead of importing the
// 18x18 version, so every icon in this context menu shares one consistent
// scale.
const EDIT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z"/></svg>`;
const DELETE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`;
const MOVE_TO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 9V5c0-1.1.9-2 2-2h3.9c.7 0 1.3.3 1.7.9l.8 1.2c.4.6 1 .9 1.7.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-2"/><path d="M2 13h10"/><path d="m9 16 3-3-3-3"/></svg>`;
const ASK_AI_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="m19 16 .7 2.3L22 19l-2.3.7z"/></svg>`;

export function initContextMenu() {
  if (contextMenuEl) return;
  contextMenuEl = document.createElement("div");
  contextMenuEl.id = "userQuizContextMenu";
  contextMenuEl.style.cssText = `
    display: none; position: absolute; z-index: 9999;
    background: var(--color-surface); border: 1px solid var(--color-border);
    border-radius: 8px; box-shadow: var(--shadow-lg); padding: 5px 0;
    min-width: 170px; flex-direction: column;
  `;
  document.body.appendChild(contextMenuEl);

  document.addEventListener("click", () => {
    contextMenuEl.style.display = "none";
    customMenuJustOpened = false;
  });
}

export function showContextMenu(e, targetType, targetId, targetTitle) {
  initContextMenu();

  // Toggle behavior: if the custom menu is already open, hide it and let
  // the browser's native context menu appear naturally on this 2nd click.
  if (contextMenuEl.style.display !== "none") {
    contextMenuEl.style.display = "none";
    customMenuJustOpened = false;
    // Do NOT call e.preventDefault() — the native menu will open
    return;
  }

  e.preventDefault();
  contextMenuEl.innerHTML = "";

  // Item-specific options first (when right-clicking on a quiz/folder/course)
  if (targetType === "item" || targetType === "folder" || targetType === "course") {
    contextMenuEl.appendChild(createMenuItem(SELECT_SVG, "تحديد", () => selectItem(targetId)));
    contextMenuEl.appendChild(createMenuItem(RENAME_SVG, "إعادة تسمية", () => renameItem(targetId, targetTitle)));
    // BUG FIX: this right-click menu had no way to edit a quiz at all — the
    // ⋮ dropdown menu (showUserQuizActionsOverlay in user-quiz-card.js)
    // already has a "تعديل الامتحان" option that opens create-quiz.html in
    // edit mode; this menu was simply missing the same entry point.
    // Folders/courses have no "edit" concept of their own (there's nothing
    // to edit — see canPlaceItem's doc comment for why courses/folders are
    // structural, not content), so this is quiz-only ("item" is only ever
    // passed for plain quizzes — see the two showContextMenu call sites in
    // user-quizzes-view.js).
    if (targetType === "item") {
      contextMenuEl.appendChild(
        createMenuItem(EDIT_SVG, "تعديل الامتحان", () => {
          window.location.href = `create-quiz.html?edit=${encodeURIComponent(targetId)}`;
        }),
      );
    }
    // Non-drag fallback for moving items — essential on touch devices,
    // which have no usable drag gesture for this grid, and a faster path
    // than drag-and-drop even on desktop for deeply nested moves.
    // Courses are top-level only (see canPlaceItem) — there is nowhere
    // else a course could move to, so the option is omitted entirely
    // instead of opening a dialog with no valid destination.
    if (targetType !== "course") {
      contextMenuEl.appendChild(createMenuItem(MOVE_TO_SVG, "نقل إلى", () => openMoveToDialog([targetId])));
    }
    // "Move out" is only meaningful when the item is actually inside
    // something — one click straight to the immediate parent, instead of
    // making every out-of-folder move go through the full picker dialog.
    if (targetType !== "course" && currentFolderId !== null) {
      const parentId = pathStackParentId();
      contextMenuEl.appendChild(
        createMenuItem(MOVE_TO_SVG, "نقل إلى الخارج", () => {
          const { moved } = moveItemsToFolder([targetId], parentId);
          if (moved > 0) showNotification("تم النقل", "تم نقل العنصر خارج المجلد الحالي.", "success");
          renderUserQuizzesView();
        }),
      );
    }

    contextMenuEl.appendChild(
      createMenuItem(ASK_AI_SVG, "اسأل الباشـمبصمج", async () => {
        const { openAIAgentWithAttachment, resolveUserItemAttachment } = await import(
          "../../components/ai-agent/ai-agent-attach-launcher.js"
        );
        const attachment = resolveUserItemAttachment(targetId);
        if (attachment) openAIAgentWithAttachment(attachment);
      }),
    );

    contextMenuEl.appendChild(createMenuItem(DELETE_SVG, "حذف", () => deleteFolder(targetId), true));

    // Divider before global actions
    const divider = document.createElement("div");
    divider.style.cssText = "border-top: 1px solid var(--color-border); margin: 4px 0;";
    contextMenuEl.appendChild(divider);
  }

  // Global actions — always visible regardless of what was right-clicked
  contextMenuEl.appendChild(createMenuItem(CREATE_FOLDER_SVG, "إنشاء مجلد", () => createNewFolderOrCourse("folder")));
  // Courses are top-level only — inside a folder/course this option can't
  // do anything, but it stays visible-but-disabled (not hidden) so the
  // menu's shape doesn't shift depending on location.
  contextMenuEl.appendChild(
    createMenuItem(
      CREATE_COURSE_SVG,
      "إنشاء مادة",
      () => createNewFolderOrCourse("course"),
      false,
      currentFolderId !== null ? "المواد تُنشأ في المستوى الرئيسي فقط." : null,
    ),
  );
  // Per-item "upload to platform" action — pushes this specific
  // course/folder (with all of its nested contents) up to the DB via the
  // dedicated course/folder upload wizards (adminUpload.js). Distinct from
  // the "استيراد مجلد من جهازك" action below, which imports FROM the local
  // filesystem INTO user_quizzes rather than uploading an existing local
  // item OUT to the platform.
  if (isAdminAuthenticated() && (targetType === "course" || targetType === "folder")) {
    const label = targetType === "course" ? "رفع المادة إلى المنصة" : "رفع المجلد إلى المنصة";
    contextMenuEl.appendChild(createMenuItem(UPLOAD_FOLDER_SVG, label, () => uploadItemToPlatform(targetType, targetId)));
  }
  if (isAdminAuthenticated()) {
    contextMenuEl.appendChild(createMenuItem(UPLOAD_FOLDER_SVG, "استيراد مجلد من جهازك", () => uploadFolderForAdmins()));
  }

  // Divider + "حذف الكل" below — kept visually and physically separate from
  // the item-scoped "حذف" above so a misclick can't easily wipe everything
  // instead of one folder. Hidden entirely (not just disabled) once
  // "امتحاناتك" is already empty — there's nothing left to wipe, and a
  // visible-but-inert danger button would just be confusing.
  const userQuizzesForDeleteAll = JSON.parse(getFromStorage("user_quizzes", "[]"));
  if (userQuizzesForDeleteAll.length > 0) {
    const dangerDivider = document.createElement("div");
    dangerDivider.style.cssText = "border-top: 1px solid var(--color-border); margin: 4px 0;";
    contextMenuEl.appendChild(dangerDivider);
    contextMenuEl.appendChild(
      createMenuItem(DELETE_SVG, "حذف الكل", () => deleteAllUserQuizzes(), true),
    );
  }

  contextMenuEl.style.left = `${e.pageX}px`;
  contextMenuEl.style.top = `${e.pageY}px`;
  contextMenuEl.style.display = "flex";
  customMenuJustOpened = true;
  positionContextMenu(e);
}

/**
 * Keeps the context menu fully inside the viewport instead of letting it
 * render off-screen near an edge. The menu's real size is only known once
 * its final content is in the DOM and visible (its item count varies with
 * targetType/permissions), so this runs *after* `display: flex` is applied
 * above rather than trying to precompute a size.
 *
 * Behavior: normally the menu opens below-and-right of the cursor (this
 * page's RTL default). If there isn't enough room below, it flips to open
 * above the cursor instead; if there isn't enough room to the right (or
 * left, in an RTL context where the menu naturally grows leftward from the
 * click point), it flips to the other horizontal side too. Each axis is
 * judged independently, so a click near a corner can flip both ways at
 * once rather than only handling one edge at a time.
 */
function positionContextMenu(e) {
  const menuRect = contextMenuEl.getBoundingClientRect();
  const margin = 8; // keep a small gap from the viewport edge, not flush against it
  const viewportWidth = document.documentElement.clientWidth;
  const viewportHeight = document.documentElement.clientHeight;

  // e.clientX/Y (viewport-relative) is what actually needs to fit on
  // screen; pageX/Y (document-relative, used for the initial placement
  // above) only matches clientX/Y when the page isn't scrolled, so the
  // edge checks below are done in viewport space and converted back.
  let left = e.clientX;
  let top = e.clientY;

  const overflowsRight = left + menuRect.width > viewportWidth - margin;
  const overflowsBottom = top + menuRect.height > viewportHeight - margin;

  if (overflowsRight) left = e.clientX - menuRect.width;
  if (overflowsBottom) top = e.clientY - menuRect.height;

  // Clamp as a final safety net (e.g. a menu taller/wider than the whole
  // viewport on a very small screen) so it's never partially off either
  // opposite edge after flipping.
  left = Math.min(Math.max(left, margin), viewportWidth - menuRect.width - margin);
  top = Math.min(Math.max(top, margin), viewportHeight - menuRect.height - margin);

  contextMenuEl.style.left = `${left + window.scrollX}px`;
  contextMenuEl.style.top = `${top + window.scrollY}px`;
}

function createMenuItem(iconSvg, label, onClick, isDanger = false, disabledReason = null) {
  const item = document.createElement("div");
  const disabled = !!disabledReason;
  item.style.cssText = `
    padding: 5px 14px; cursor: ${disabled ? "not-allowed" : "pointer"};
    color: ${disabled ? "var(--color-text-tertiary, var(--color-text-secondary))" : (isDanger ? "var(--color-danger, #dc2626)" : "var(--color-text-primary)")};
    opacity: ${disabled ? "0.55" : "1"};
    font-size: 0.88rem; transition: background 0.15s; display: flex; align-items: center; gap: 10px;
  `;
  item.innerHTML = `<span style="flex-shrink:0;display:flex;align-items:center;opacity:0.75">${iconSvg}</span><span>${label}</span>`;
  if (disabled) item.title = disabledReason;
  item.onmouseover = () => { if (!disabled) item.style.background = "var(--color-bg-hover, rgba(0,0,0,0.05))"; };
  item.onmouseout = () => item.style.background = "transparent";
  item.onclick = (e) => {
    e.stopPropagation();
    if (disabled) return;
    contextMenuEl.style.display = "none";
    customMenuJustOpened = false;
    onClick();
  };
  return item;
}

/**
 * Uploads a single course or folder card (with everything nested inside
 * it) to the platform, via the dedicated Course/Folder upload wizards in
 * adminUpload.js. Triggered from the card's ⋮ menu / right-click menu
 * "☁️ رفع … إلى المنصة" action — see buildCourseUploadPayload /
 * buildFolderUploadPayload for how the local tree is flattened for the API.
 * @param {"course"|"folder"} type
 * @param {string} itemId
 */
function uploadItemToPlatform(type, itemId) {
  const userQuizzes = JSON.parse(getFromStorage("user_quizzes", "[]"));
  const item = userQuizzes.find((q) => (q.id || q.meta?.id) === itemId);
  if (!item) return;

  import("./adminUpload.js").then((mod) => {
    if (type === "course") {
      mod.openCourseUploadModal([item], userQuizzes);
    } else {
      mod.openFolderUploadModal({ folders: [item], quizzes: [], userQuizzes });
    }
  });
}

/**
 * "استيراد مجلد من جهازك" (admin local folder import) — lets an admin pick a whole
 * folder/Course on their machine (via the native directory picker) and
 * imports it in one shot: every subdirectory becomes a folder/course record
 * (preserving nesting) and every .json file becomes a quiz inside the right
 * folder, instead of flattening everything into the current folder the way
 * a plain multi-file JSON import would.
 *
 * Uses each File's `webkitRelativePath` (e.g. "Physics/Unit1/quiz1.json"),
 * which browsers populate automatically for `webkitdirectory` pickers, to
 * reconstruct the directory tree client-side — no server involvement, since
 * user_quizzes is a local/localStorage collection like the rest of this
 * feature.
 */
function uploadFolderForAdmins() {
  const input = document.createElement("input");
  input.type = "file";
  input.webkitdirectory = true;
  input.directory = true;
  input.multiple = true;
  input.onchange = async (e) => {
    const allFiles = Array.from(e.target.files);
    const jsonFiles = allFiles.filter((f) => f.name.endsWith(".json"));
    const skippedCount = allFiles.length - jsonFiles.length;

    if (jsonFiles.length === 0) {
      showNotification(
        "لا توجد ملفات",
        "لم يتم العثور على أي ملفات .json داخل المجلد المحدد.",
        "warning",
      );
      return;
    }

    await importFolderTree(jsonFiles, skippedCount);
  };
  input.click();
}

/**
 * Parses a batch of File objects (already filtered to .json) that came from
 * a directory picker, rebuilds the folder tree from their
 * `webkitRelativePath`s, and — after the admin confirms a summary — writes
 * one new folder/course/quiz set into user_quizzes under `currentFolderId`,
 * in a single storage write.
 * @param {File[]} jsonFiles
 * @param {number} skippedCount - non-.json files that were silently ignored
 */
async function importFolderTree(jsonFiles, skippedCount = 0) {
  // 1. Read + parse every file first (so we can report bad JSON up front,
  //    before touching storage at all).
  const parsedFiles = [];
  const failedFiles = [];
  for (const file of jsonFiles) {
    const relPath = file.webkitRelativePath || file.name;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!parsed || !Array.isArray(parsed.questions) || parsed.questions.length === 0) {
        failedFiles.push(relPath);
        continue;
      }
      parsedFiles.push({ relPath, parsed });
    } catch (err) {
      failedFiles.push(relPath);
    }
  }

  if (parsedFiles.length === 0) {
    showNotification(
      "تعذر الرفع",
      "لم يتمكن أي من الملفات من الانضمام — تأكد أنها ملفات امتحان صالحة.",
      "warning",
    );
    return;
  }

  // 2. Build the directory tree from relative paths. Each node is keyed by
  //    its full path-so-far (so same-named folders under different parents
  //    don't collide), and carries its own quiz files + child dir keys.
  //    Root-level directory names become "course" type (matching the
  //    manual create-course affordance, which is also root-only); anything
  //    nested becomes a plain "folder".
  const dirNodes = new Map(); // pathKey -> { name, depth, parentKey, quizFiles: [], childKeys: Set }
  const rootDirKeys = new Set();

  for (const { relPath, parsed } of parsedFiles) {
    const segments = relPath.split("/").filter(Boolean);
    // Drop the filename — everything before it is the directory chain.
    const dirSegments = segments.slice(0, -1);

    if (dirSegments.length === 0) {
      // A .json file sitting directly at the picked folder's root (no
      // subdirectory) — treat the picked folder's own name as a single
      // top-level course. webkitRelativePath always includes the picked
      // folder itself as the first segment normally; this branch only
      // hits for malformed/edge-case paths, so fall back gracefully.
      continue;
    }

    let parentKey = null;
    let pathSoFar = "";
    dirSegments.forEach((seg, depth) => {
      pathSoFar = pathSoFar ? `${pathSoFar}/${seg}` : seg;
      if (!dirNodes.has(pathSoFar)) {
        dirNodes.set(pathSoFar, {
          name: seg,
          depth,
          parentKey,
          quizFiles: [],
          childKeys: new Set(),
        });
        if (depth === 0) rootDirKeys.add(pathSoFar);
        if (parentKey) dirNodes.get(parentKey).childKeys.add(pathSoFar);
      }
      parentKey = pathSoFar;
    });

    // Attach this quiz file to its immediate parent directory.
    dirNodes.get(pathSoFar).quizFiles.push(parsed);
  }

  const folderCount = dirNodes.size;
  const quizCount = parsedFiles.length;

  // 3. Confirm before writing anything — this is a bulk, hard-to-undo
  //    admin action, and the parsed tree can differ from what the admin
  //    expected (e.g. unexpected nesting depth).
  const summaryParts = [
    `سيتم إنشاء ${folderCount} مجلد/مادة`,
    `ورفع ${quizCount} امتحان`,
  ];
  if (failedFiles.length) {
    summaryParts.push(`(تم تجاهل ${failedFiles.length} ملف غير صالح)`);
  }
  if (skippedCount) {
    summaryParts.push(`(تم تجاهل ${skippedCount} ملف غير json)`);
  }
  const confirmed = await _confirm(`${summaryParts.join(" ")}. متابعة؟`);
  if (!confirmed) return;

  // 4. Materialize folder/course records + quiz entries, then write once.
  const userQuizzes = JSON.parse(getFromStorage("user_quizzes", "[]"));
  const keyToId = new Map();

  // Unlike createNewFolderOrCourse (which rejects a duplicate name outright
  // via a warning), a bulk folder upload appends a "(2)", "(3)", ... suffix
  // instead — rejecting here would mean aborting or silently dropping an
  // entire subtree mid-batch just because one sibling folder name already
  // exists locally, which is a worse outcome than a renamed folder.
  function uniqueNameAtLevel(name, parentId) {
    const takenLower = new Set(
      userQuizzes
        .filter((q) => (q.meta?.parentId || null) === parentId)
        .map((q) => (q.meta?.title || "").trim().toLowerCase()),
    );
    if (!takenLower.has(name.trim().toLowerCase())) return name;
    let n = 2;
    let candidate = `${name} (${n})`;
    while (takenLower.has(candidate.toLowerCase())) {
      n += 1;
      candidate = `${name} (${n})`;
    }
    return candidate;
  }

  function ensureFolderRecord(pathKey) {
    if (keyToId.has(pathKey)) return keyToId.get(pathKey);
    const node = dirNodes.get(pathKey);
    const parentId = node.parentKey ? ensureFolderRecord(node.parentKey) : currentFolderId;
    const isRootLevel = node.depth === 0;
    const id = crypto.randomUUID();
    const title = uniqueNameAtLevel(node.name, parentId);
    userQuizzes.push({
      id,
      meta: {
        type: isRootLevel ? "course" : "folder",
        title,
        parentId,
        icon: isRootLevel ? getSubjectIcon(node.name, false) : undefined,
        createdAt: new Date().toLocaleString("en-US"),
      },
      stats: { questionCount: 0, questionTypes: [] },
      questions: [],
    });
    keyToId.set(pathKey, id);
    return id;
  }

  for (const [pathKey, node] of dirNodes.entries()) {
    const folderId = ensureFolderRecord(pathKey);
    node.quizFiles.forEach((parsed) => {
      const quizId = crypto.randomUUID();
      const entry = buildUserQuizEntry(quizId, parsed, parsed.meta?.title);
      entry.meta.parentId = folderId;
      userQuizzes.push(entry);
    });
  }

  setInStorage("user_quizzes", JSON.stringify(userQuizzes));
  showNotification(
    "تم الرفع",
    `تم إنشاء ${folderCount} مجلد/مادة ورفع ${quizCount} امتحان بنجاح.`,
    "success",
  );
  renderUserQuizzesView();
}

// ─── Upload-to-platform tree builders ──────────────────────────────────────
// These turn a slice of the local `user_quizzes` tree into the flat `items`
// array api/upload-quiz.js's "folder" mode expects (see that file's header
// comment for the exact shape). Both builders share the same node shape:
//   { type: "course"|"folder"|"quiz", name, folderSegments, rootName, quiz? }
// `folderSegments` is always the ordered chain of ancestor names ABOVE the
// node (never including the node's own name) — courses have none, a folder
// has its course's name (+ any ancestor folders) directly above it, and a
// quiz has whatever chain of course/folders sits above it.

function walkChildren(userQuizzes, parentId) {
  return userQuizzes.filter((q) => (q.meta?.parentId || null) === parentId);
}

// Mirrors api/_validateQuiz.js's ALLOWED_META_KEYS whitelist: the server
// rejects (not silently strips) any unrecognized meta key, so local-only
// bookkeeping fields on a user_quizzes row — parentId, type, icon,
// createdAt's raw form, etc. — must never reach the request body as-is.
// Kept in sync manually with the server list; adding a new persisted meta
// field server-side means adding it here too.
const UPLOADABLE_META_KEYS = new Set([
  "title",
  "description",
  "source",
  "createdAt",
  "password",
  "view",
  "mode",
]);

function quizToPayload(entry) {
  const rawMeta = entry.meta || {};
  const meta = {};
  for (const key of UPLOADABLE_META_KEYS) {
    const val = rawMeta[key];
    if (typeof val === "string" ? val.trim() : val != null) {
      meta[key] = typeof val === "string" ? val.trim() : val;
    }
  }
  if (!meta.title) meta.title = "امتحان";

  const questions = entry.questions || [];
  // Must mirror api/_validateQuiz.js's inferQuestionType exactly (options
  // length 0 -> Essay, 2 -> True/False, else MCQ) — the server recomputes
  // stats from `questions` and rejects the upload if this doesn't match
  // (STATS_MISMATCH), so this can never be a placeholder/empty value.
  const types = new Set();
  questions.forEach((q) => {
    if (!Array.isArray(q.options) || q.options.length === 0) types.add("Essay");
    else if (q.options.length === 2) types.add("True/False");
    else types.add("MCQ");
  });
  return {
    meta,
    stats: { questionCount: questions.length, questionTypes: Array.from(types).sort() },
    questions,
  };
}

/**
 * Recursively appends every descendant of `node` (folders + quizzes) into
 * `items`, tagging each with the ancestor chain above it (`ancestorNames`).
 * Shared by both buildCourseUploadPayload and buildFolderUploadPayload —
 * the only difference between the two callers is what ancestorNames starts
 * as and what rootName is stamped on each item.
 */
function appendSubtree(userQuizzes, node, ancestorNames, rootName, items) {
  const children = walkChildren(userQuizzes, node.id || node.meta?.id);
  for (const child of children) {
    const childId = child.id || child.meta?.id;
    const childName = (child.meta?.title || "").trim();
    if (child.meta?.type === "folder") {
      items.push({
        type: "folder",
        name: childName,
        folderSegments: [...ancestorNames],
        rootName,
      });
      appendSubtree(userQuizzes, child, [...ancestorNames, childName], rootName, items);
    } else {
      // A plain quiz leaf.
      items.push({
        type: "quiz",
        name: childName || child.meta?.title || "امتحان",
        folderSegments: [...ancestorNames],
        rootName,
        quiz: quizToPayload(child),
      });
    }
  }
}

/**
 * Builds the flat `items` payload for uploading one or more entire courses
 * (with all of their nested folders and quizzes) to the platform in one
 * batch — the "مسار رفع المواد" workflow.
 * @param {Array} userQuizzes - full local user_quizzes collection
 * @param {Array} courseItems - the selected course rows (meta.type === "course")
 * @returns {{ items: Array, rootName: string }}
 */
export function buildCourseUploadPayload(userQuizzes, courseItems) {
  const items = [];
  for (const course of courseItems) {
    const courseName = (course.meta?.title || "").trim();
    items.push({ type: "course", name: courseName, folderSegments: [], rootName: courseName });
    appendSubtree(userQuizzes, course, [courseName], courseName, items);
  }
  return { items, rootName: courseItems.length === 1 ? (courseItems[0].meta?.title || "").trim() : "" };
}

/**
 * Builds the flat `items` payload for uploading one or more folders (with
 * their nested contents) plus any loose quizzes selected alongside them
 * into an EXISTING course already on the platform — the "مسار رفع
 * المجلدات" workflow. Unlike buildCourseUploadPayload, no "course" item is
 * emitted: the target course is chosen separately in the wizard
 * (openFolderUploadModal) and resolved server-side by name, so every
 * folderSegments chain here is seeded with `targetCourseName` as its first
 * element to match what api/upload-quiz.js's folder mode expects (the
 * course name is always folderSegments[0] when no course item is present).
 * @param {Array} userQuizzes
 * @param {Array} folderItems - selected folder rows (meta.type === "folder")
 * @param {Array} additionalQuizzes - selected plain quiz rows alongside the folders
 * @param {string} targetCourseName - name of the existing course on the platform
 * @param {string[]} [targetSubfolderPath] - optional chain of existing folder
 *   names under the course to nest everything one level deeper into
 * @returns {{ items: Array, rootName: string }}
 */
export function buildFolderUploadPayload(userQuizzes, folderItems, additionalQuizzes, targetCourseName, targetSubfolderPath = []) {
  const items = [];
  const baseChain = [targetCourseName, ...targetSubfolderPath];

  for (const folder of folderItems) {
    const folderName = (folder.meta?.title || "").trim();
    items.push({
      type: "folder",
      name: folderName,
      folderSegments: [...baseChain],
      rootName: targetCourseName,
    });
    appendSubtree(userQuizzes, folder, [...baseChain, folderName], targetCourseName, items);
  }

  for (const quiz of additionalQuizzes || []) {
    items.push({
      type: "quiz",
      name: (quiz.meta?.title || "").trim() || "امتحان",
      folderSegments: [...baseChain],
      rootName: targetCourseName,
      quiz: quizToPayload(quiz),
    });
  }

  return { items, rootName: targetCourseName };
}

export function selectItem(itemId) {
  const container = document.querySelector(".user-quizzes-container");
  if (container) container.classList.add("selection-mode-active");
  const toggleBtn = document.querySelector(".selection-toggle-btn");
  if (toggleBtn) toggleBtn.classList.add("active");

  // Add itemId to the selection set
  const selectedUserQuizzes = getSelectedUserQuizzes();
  selectedUserQuizzes.add(itemId);

  // Visually check the matching checkbox
  const checkbox = document.querySelector(`.user-quiz-select-checkbox[data-quiz-id="${itemId}"]`);
  if (checkbox && !checkbox.checked) {
    checkbox.checked = true;
  }

  // Update the bulk action bar immediately
  updateBulkActionBar(true);
}

/**
 * Recursively count all subfolders and quizzes inside a given folder or course.
 * @param {object[]} userQuizzes
 * @param {string} folderId
 * @returns {{ subfolderCount: number, quizCount: number }}
 */
export function getFolderContentsCount(userQuizzes, folderId) {
  let subfolderCount = 0;
  let quizCount = 0;

  function walk(currentId) {
    const children = userQuizzes.filter(
      (q) => (q.meta?.parentId || null) === currentId
    );
    for (const child of children) {
      const isDir = child.meta?.type === "folder" || child.meta?.type === "course";
      if (isDir) {
        subfolderCount++;
        walk(child.id || child.meta?.id);
      } else {
        quizCount++;
      }
    }
  }

  walk(folderId);
  return { subfolderCount, quizCount };
}

/**
 * Format the subfolder and quiz count in natural Arabic with proper plural rules.
 * @param {number} subfolderCount
 * @param {number} quizCount
 * @returns {string}
 */
export function formatFolderAndQuizCount(subfolderCount, quizCount) {
  if (subfolderCount === 0 && quizCount === 0) {
    return "فارغ";
  }

  const parts = [];

  if (subfolderCount > 0) {
    if (subfolderCount === 1) parts.push("مجلد واحد");
    else if (subfolderCount === 2) parts.push("مجلدان");
    else if (subfolderCount >= 3 && subfolderCount <= 10) parts.push(`${subfolderCount} مجلدات`);
    else parts.push(`${subfolderCount} مجلد`);
  }

  if (quizCount > 0) {
    if (quizCount === 1) parts.push("امتحان واحد");
    else if (quizCount === 2) parts.push("امتحانان");
    else if (quizCount >= 3 && quizCount <= 10) parts.push(`${quizCount} امتحانات`);
    else parts.push(`${quizCount} امتحان`);
  }

  return parts.join(" · ");
}

export function createFolderOrCourseCard(item) {
  const card = document.createElement("div");
  card.className = "category-card user-quiz-card";
  card.style.cursor = "pointer";
  card.style.position = "relative";
  card.setAttribute("role", "button");
  card.setAttribute("tabindex", "0");
  const isCourse = item.meta?.type === "course";
  // Courses are always top-level (see canPlaceItem) — there is no valid
  // drop target for one, so it isn't made draggable at all rather than
  // being draggable-but-rejected-on-drop everywhere.
  card.draggable = !isCourse;

  const icon = isCourse ? "📚" : "📁";
  const itemId = item.id || item.meta?.id;

  const selectedUserQuizzes = getSelectedUserQuizzes();
  const isChecked = selectedUserQuizzes.has(itemId);

  // Checkbox: attached directly to card as an out-of-flow absolute element
  // (no in-flow wrapper div, preserving exact phone emoji alignment)
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "user-quiz-select-checkbox";
  checkbox.setAttribute("data-quiz-id", itemId);
  checkbox.setAttribute("aria-label", "تحديد");
  checkbox.checked = isChecked;
  checkbox.onclick = (e) => {
    e.stopPropagation();
    if (checkbox.checked) {
      selectedUserQuizzes.add(itemId);
    } else {
      selectedUserQuizzes.delete(itemId);
    }
    updateBulkActionBar();
  };
  card.appendChild(checkbox);

  // Category Icon: First in-flow flex child, aligned identically to user-quiz--phone-only-emoji
  const iconEl = document.createElement("div");
  iconEl.className = "category-icon";
  iconEl.setAttribute("aria-hidden", "true");
  iconEl.textContent = icon;
  card.appendChild(iconEl);

  // Text wrapper: card-text (display:contents on desktop, flex-column on mobile)
  const textWrap = document.createElement("div");
  textWrap.className = "card-text";

  const h = document.createElement("h3");
  h.textContent = item.meta?.title || "";
  textWrap.appendChild(h);

  // Subtext: total number of subfolders and quizzes (recursive)
  const userQuizzes = JSON.parse(getFromStorage("user_quizzes", "[]"));
  const { subfolderCount, quizCount } = getFolderContentsCount(userQuizzes, itemId);
  const subtextStr = formatFolderAndQuizCount(subfolderCount, quizCount);

  const subtextEl = document.createElement("p");
  subtextEl.className = "category-card-subtext user-quiz-count";
  subtextEl.textContent = subtextStr;
  textWrap.appendChild(subtextEl);

  card.appendChild(textWrap);

  card.setAttribute("title", item.meta?.title || "");
  card.setAttribute("aria-label", `${item.meta?.title || ""}, ${subtextStr}`);

  // Actions wrap with ⋮ more button for touch & quick access
  const actionsWrap = document.createElement("div");
  actionsWrap.className = "category-card-actions-wrap";
  const moreBtn = document.createElement("button");
  moreBtn.className = "exam-more-btn exam-more-btn--lg";
  moreBtn.type = "button";
  moreBtn.innerHTML = MORE_DOTS_ICON_SVG;
  moreBtn.setAttribute("aria-label", `خيارات ${item.meta?.title || ""}`);
  moreBtn.onclick = (e) => {
    e.stopPropagation();
    showContextMenu(e, item.meta?.type || "folder", itemId, item.meta?.title);
  };
  actionsWrap.appendChild(moreBtn);
  card.appendChild(actionsWrap);

  card.onclick = () => {
    // If in selection mode, toggle checkbox instead
    const container = document.querySelector(".user-quizzes-container");
    if (container?.classList.contains("selection-mode-active")) {
      checkbox.click();
      return;
    }
    navigateToFolder(itemId, item.meta?.title);
  };

  card.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      card.click();
    }
  });

  if (!isCourse) {
    card.ondragstart = (e) => handleDragStart(e, itemId);
    card.ondragend = handleDragEnd;
  }

  if (item.meta?.type === "folder" || item.meta?.type === "course") {
    card.ondragover = handleDragOver;
    card.ondragleave = handleDragLeave;
    card.ondrop = (e) => {
      e.stopPropagation();
      handleDrop(e, itemId);
    };
  }

  card.oncontextmenu = (e) => {
    e.stopPropagation();
    showContextMenu(e, item.meta?.type || "folder", itemId, item.meta?.title);
  };

  return card;
}