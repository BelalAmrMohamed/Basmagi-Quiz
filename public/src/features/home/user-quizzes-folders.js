// public/src/features/home/user-quizzes-folders.js
import { getFromStorage, setInStorage } from "../../shared/storage-helpers.js";
import { _prompt, _confirm, showNotification } from "../../components/notifications/notifications.js";
import { isAdminAuthenticated } from "../../shared/adminAuth.js";
import { renderUserQuizzesView, updateBulkActionBar } from "./user-quizzes-view.js";
import { getSelectedUserQuizzes } from "./app-state.js";
import { toSlug } from "./slug-utils.js";
import { buildUserQuizEntry } from "./quiz-schema.js";
import { getSubjectIcon } from "./subject-icons.js";
import { MORE_DOTS_ICON_SVG } from "./icons.js";

// Current navigation state
export let currentFolderId = null;
let folderPathStack = [];

export function getChildren(userQuizzes, parentId) {
  return userQuizzes.filter((q) => (q.meta?.parentId || null) === parentId);
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

  const duplicate = userQuizzes.find(
    (q) => (q.meta?.parentId || null) === (parentId || null) &&
            (q.meta?.title || "").trim().toLowerCase() === trimmedName.toLowerCase()
  );
  if (duplicate) {
    return { ok: false, reason: "يوجد عنصر بنفس الاسم في هذا المستوى بالفعل." };
  }

  const newFolder = {
    id: crypto.randomUUID(),
    meta: {
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

  // Prevent duplicate names at the same level (excluding the item itself)
  const duplicate = userQuizzes.find(
    (q) => (q.id !== itemId && q.meta?.id !== itemId) &&
            (q.meta?.parentId || null) === parentId &&
            (q.meta?.title || "").trim().toLowerCase() === trimmedName.toLowerCase()
  );
  if (duplicate) {
    showNotification("الاسم مستخدم", "يوجد عنصر بنفس الاسم في هذا المستوى. اختر اسماً مختلفاً.", "warning");
    return;
  }

  item.meta.title = trimmedName;
  setInStorage("user_quizzes", JSON.stringify(userQuizzes));
  renderUserQuizzesView();
}

export async function deleteFolder(folderId) {
  if (!(await _confirm("هل أنت متأكد من حذف هذا المجلد/المادة وكل ما بداخله؟"))) return;
  const userQuizzes = JSON.parse(getFromStorage("user_quizzes", "[]"));
  const idsToDelete = new Set([folderId]);
  
  // Recursively find all children
  let added = true;
  while (added) {
    added = false;
    for (const q of userQuizzes) {
      if (q.meta?.parentId && idsToDelete.has(q.meta.parentId) && !idsToDelete.has(q.id)) {
        idsToDelete.add(q.id || q.meta.id);
        added = true;
      }
    }
  }

  const newQuizzes = userQuizzes.filter((q) => !idsToDelete.has(q.id) && !idsToDelete.has(q.meta?.id));
  setInStorage("user_quizzes", JSON.stringify(newQuizzes));
  renderUserQuizzesView();
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
  if (itemIndex !== -1) {
    if (!userQuizzes[itemIndex].meta) userQuizzes[itemIndex].meta = {};
    userQuizzes[itemIndex].meta.parentId = targetFolderId;
    setInStorage("user_quizzes", JSON.stringify(userQuizzes));
    renderUserQuizzesView();
  }
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
    item.meta.parentId = targetFolderId;
    moved++;
  });

  if (moved > 0) setInStorage("user_quizzes", JSON.stringify(userQuizzes));
  return { moved, blocked };
}

/**
 * Non-drag fallback for moving an item (used by the right-click context
 * menu and the card ⋮ overlay) — opens a small folder-tree picker modal so
 * touch/mobile users, who have no usable drag gesture, can still move items
 * in and out of folders/courses. `itemIds` supports both the single-item
 * case and the bulk-selection case with one shared implementation.
 * @param {string[]} itemIds
 */
export async function openMoveToDialog(itemIds) {
  if (!itemIds || itemIds.length === 0) return;

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
    return;
  }

  // Current location of the item(s) being moved, so it can be excluded/
  // marked as "current" rather than offered as a no-op destination.
  const firstItem = userQuizzes.find((q) => (q.id || q.meta?.id) === itemIds[0]);
  const currentParentId = firstItem?.meta?.parentId || null;

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay move-to-dialog-overlay";

  const card = document.createElement("div");
  card.className = "modal-card move-to-dialog-card";

  const closeDialog = () => overlay.remove();

  const itemLabel =
    itemIds.length > 1
      ? `${itemIds.length} عناصر`
      : firstItem?.meta?.title
        ? `"${firstItem.meta.title}"`
        : "العنصر";

  card.innerHTML = `
    <div class="move-to-dialog-header">
      <div class="move-to-dialog-header-text">
        <h3 class="move-to-dialog-title">نقل إلى</h3>
        <p class="move-to-dialog-subtitle">اختر الوجهة لنقل ${itemLabel}</p>
      </div>
      <button type="button" class="move-to-dialog-close" aria-label="إغلاق">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
      </button>
    </div>
    <div class="move-to-dialog-tree" role="tree" aria-label="اختر وجهة النقل"></div>
  `;

  const treeEl = card.querySelector(".move-to-dialog-tree");

  /**
   * One row = one button styled as a real tree node: an icon, a label, and
   * (for nested rows) a vertical rail + elbow drawn with CSS borders on a
   * dedicated element per ancestor level — not ASCII box-drawing characters
   * baked into text content, which don't align pixel-for-pixel with the
   * row's own height/line-box and read as a decorative afterthought rather
   * than an actual structural line.
   *
   * `railContinues` is an array with one boolean per ancestor level (length
   * === depth): railContinues[i] says whether the vertical line at that
   * level should run the row's full height (there's a later sibling still
   * to come at that level, so the trunk must keep going down to reach it)
   * or stop halfway with an elbow (this row is the last child at that
   * level, so the line has nowhere left to go). Every level except the
   * last one in the array is always a straight pass-through rail for an
   * *ancestor* level — only the final entry (this row's own level) is ever
   * an elbow, and only when this row itself has no more siblings below it.
   *
   * The pass-through ancestor lines themselves are NOT drawn per-row
   * anymore (see appendChildren below) — each row here only draws its
   * OWN level's short elbow stub. A sibling list's shared ancestor rails
   * are instead a single continuous `border-right` on the `.move-to-
   * dialog-branch` wrapper that contains that whole sibling list, so the
   * line is structurally guaranteed to run unbroken from the first row to
   * the last, immune to any row-to-row seam, height variation, or
   * rounding that previously made independently-redrawn per-row segments
   * look disconnected even though the "should this level continue"
   * logic was already correct.
   */
  function addNode(container, label, id, icon, depth, { isCurrent = false, disabledReason = null, hasMoreSiblings = false, isSingleChild = false } = {}) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "move-to-dialog-node";
    row.setAttribute("role", "treeitem");
    row.dataset.depth = String(depth);
    if (isCurrent) row.classList.add("move-to-dialog-node--current");
    if (disabledReason) {
      row.classList.add("move-to-dialog-node--disabled");
      row.disabled = true;
      row.title = disabledReason;
    }

    // Own-level elbow: a short stub connecting this row to the branch's
    // shared vertical rail (drawn by the parent .move-to-dialog-branch
    // wrapper, not here). Only rendered for nested rows (depth > 0) —
    // the root "إمتحاناتك" row at depth 0 has no ancestor rail to
    // connect to at all. Also skipped for a lone child (isSingleChild):
    // with no rail behind it (see appendChildren), a stub with nothing
    // to connect to just reads as a stray floating dash.
    const elbow = depth > 0 && !isSingleChild
      ? `<span class="move-to-dialog-elbow${hasMoreSiblings ? " move-to-dialog-elbow--continues" : ""}" aria-hidden="true"></span>`
      : "";

    row.innerHTML =
      elbow +
      `<span class="move-to-dialog-node-icon" aria-hidden="true">${icon}</span>` +
      `<span class="move-to-dialog-node-label">${label}</span>` +
      (isCurrent ? `<span class="move-to-dialog-node-badge">الموقع الحالي</span>` : "");

    if (!disabledReason) {
      row.onclick = () => {
        const { moved, blocked } = moveItemsToFolder(itemIds, id);
        closeDialog();
        if (moved > 0) {
          showNotification(
            "تم النقل",
            moved > 1 ? `تم نقل ${moved} عنصر بنجاح.` : "تم نقل العنصر بنجاح.",
            "success",
          );
        }
        if (blocked > 0) {
          showNotification(
            "تعذر نقل بعض العناصر",
            "لا يمكن نقل مجلد إلى داخل نفسه أو أحد مجلداته الفرعية، ولا يمكن نقل مادة إلى داخل مجلد آخر.",
            "warning",
          );
        }
        renderUserQuizzesView();
      };
    }
    container.appendChild(row);
  }

  // Root option. Marked "current location" (not disabled — re-confirming
  // "stay at root" is harmless) when the item(s) are already there.
  // Appended directly into treeEl — it has no ancestor rail of its own,
  // so it needs no wrapping .move-to-dialog-branch.
  addNode(treeEl, "إمتحاناتك (الرئيسية)", null, "🏠", 0, {
    isCurrent: currentParentId === null,
  });

  // Recursively render the real folder/course tree — actual nesting via
  // real DOM nesting, not a flat list dressed up to look nested with
  // per-row rail spans. Each sibling group at a given parent is wrapped
  // in one .move-to-dialog-branch container; that wrapper's own
  // `border-right` (see index.css) draws a single continuous line
  // spanning every row (and nested branch) inside it, so the ancestor
  // rail can never visually break between rows the way independently
  // redrawn per-row segments could. Each node is individually
  // validity-checked against every item being moved:
  // - a descendant of any moving item (would create a cycle)
  // - a course itself, when the payload includes a course (nowhere for a
  //   course to go but root — see canPlaceItem)
  // - the item's current parent (a no-op, shown but marked/disabled rather
  //   than hidden, so the tree's shape stays predictable)
  function appendChildren(container, parentId, depth) {
    const siblings = folders.filter((f) => (f.meta?.parentId || null) === parentId);
    if (!siblings.length) return;

    // One wrapper per sibling group. Its border-right is the ancestor
    // rail every row (and every nested branch) inside it shares — a
    // single element drawing one line, rather than each row redrawing
    // its own copy of the same line and risking a seam between them.
    //
    // The rail is only meaningful when there's an actual fork to trace —
    // i.e. more than one sibling at this level. A lone child (the common
    // "folder > folder > folder" single-item chain) has nothing to
    // branch from or to, so drawing a rail there just produces a cascade
    // of short, disconnected-looking parallel strokes (one per ancestor
    // level, each shorter than the last) instead of reading as one
    // continuous line. Suppressing the rail — but keeping the same
    // indent via padding-right — for single-child branches fixes that
    // without touching the real multi-sibling case, where the rail still
    // renders exactly as before.
    const branch = document.createElement("div");
    branch.className =
      siblings.length > 1 ? "move-to-dialog-branch" : "move-to-dialog-branch move-to-dialog-branch--single";
    container.appendChild(branch);

    siblings.forEach((f, index) => {
      const fid = f.id || f.meta?.id;
      const icon = f.meta?.icon || (f.meta?.type === "course" ? "📚" : "📁");
      const isCurrent = fid === currentParentId;
      const isLastSibling = index === siblings.length - 1;

      let disabledReason = null;
      if (itemIds.includes(fid)) {
        disabledReason = "لا يمكن نقل عنصر إلى نفسه.";
      } else if (itemIds.some((id) => isDescendant(userQuizzes, id, fid))) {
        disabledReason = "لا يمكن نقل مجلد إلى داخل نفسه أو أحد مجلداته الفرعية.";
      } else if (movingCourseIds.length) {
        disabledReason = "المواد تبقى في المستوى الرئيسي دائماً ولا يمكن نقلها إلى داخل مجلد.";
      }

      addNode(branch, f.meta?.title || "", fid, icon, depth, {
        isCurrent,
        disabledReason,
        // Whether THIS row's own elbow should read as "continues" (a
        // straight join, more siblings still coming below) or a
        // rounded corner (last child in this branch) — purely a
        // property of this row's own position among its siblings, not
        // anything inherited from ancestors (those are handled by the
        // branch wrapper's border, not per-row state).
        hasMoreSiblings: !isLastSibling,
        isSingleChild: siblings.length === 1,
      });

      // Still descend into disabled branches (a disabled ancestor doesn't
      // imply its children are also invalid destinations for a *different*
      // moving item in a multi-select) unless this exact subtree is a
      // descendant of every moving item, in which case nothing under it
      // could ever be valid either and descending would just be noise.
      const allBlocked = itemIds.every((id) => isDescendant(userQuizzes, id, fid) || id === fid);
      if (!allBlocked) appendChildren(branch, fid, depth + 1);
    });
  }
  appendChildren(treeEl, null, 1);

  overlay.appendChild(card);
  document.body.appendChild(overlay);

  card.querySelector(".move-to-dialog-close").onclick = closeDialog;
  overlay.onclick = (e) => {
    if (e.target === overlay) closeDialog();
  };
  document.addEventListener(
    "keydown",
    function onEsc(e) {
      if (e.key === "Escape") {
        closeDialog();
        document.removeEventListener("keydown", onEsc);
      }
    },
  );
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
const UPLOAD_FOLDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/></svg>`;
const SELECT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>`;
const RENAME_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
const DELETE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`;
const MOVE_TO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 9V5c0-1.1.9-2 2-2h3.9c.7 0 1.3.3 1.7.9l.8 1.2c.4.6 1 .9 1.7.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-2"/><path d="M2 13h10"/><path d="m9 16 3-3-3-3"/></svg>`;

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
    if (targetType === "folder" || targetType === "course") {
      contextMenuEl.appendChild(createMenuItem(DELETE_SVG, "حذف", () => deleteFolder(targetId), true));
    }
    // Divider before global actions
    const divider = document.createElement("div");
    divider.style.cssText = "border-top: 1px solid var(--color-border); margin: 4px 0;";
    contextMenuEl.appendChild(divider);
  }

  // Global actions — always visible regardless of what was right-clicked
  contextMenuEl.appendChild(createMenuItem(CREATE_FOLDER_SVG, "إنشاء مجلد", () => createNewFolderOrCourse("folder")));
  if (currentFolderId === null) {
    contextMenuEl.appendChild(createMenuItem(CREATE_COURSE_SVG, "إنشاء مادة", () => createNewFolderOrCourse("course")));
  }
  if (isAdminAuthenticated()) {
    contextMenuEl.appendChild(createMenuItem(UPLOAD_FOLDER_SVG, "رفع مجلد", () => uploadFolderForAdmins()));
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

function createMenuItem(iconSvg, label, onClick, isDanger = false) {
  const item = document.createElement("div");
  item.style.cssText = `
    padding: 9px 14px; cursor: pointer; color: ${isDanger ? "var(--color-danger, #dc2626)" : "var(--color-text-primary)"};
    font-size: 0.88rem; transition: background 0.15s; display: flex; align-items: center; gap: 10px;
  `;
  item.innerHTML = `<span style="flex-shrink:0;display:flex;align-items:center;opacity:0.75">${iconSvg}</span><span>${label}</span>`;
  item.onmouseover = () => item.style.background = "var(--color-bg-hover, rgba(0,0,0,0.05))";
  item.onmouseout = () => item.style.background = "transparent";
  item.onclick = (e) => {
    e.stopPropagation();
    contextMenuEl.style.display = "none";
    customMenuJustOpened = false;
    onClick();
  };
  return item;
}

/**
 * "رفع مجلد" (admin folder upload) — lets an admin pick a whole
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
      "لم يتمكن أي من الملفات من الانضمام — تأكد أنها ملفات اختبار صالحة.",
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
    if (quizCount === 1) parts.push("اختبار واحد");
    else if (quizCount === 2) parts.push("اختباران");
    else if (quizCount >= 3 && quizCount <= 10) parts.push(`${quizCount} اختبارات`);
    else parts.push(`${quizCount} اختبار`);
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
  moreBtn.className = "exam-more-btn";
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