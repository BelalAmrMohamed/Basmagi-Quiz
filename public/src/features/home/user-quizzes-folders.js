// public/src/features/home/user-quizzes-folders.js
import { getFromStorage, setInStorage } from "../../shared/storage-helpers.js";
import { _prompt, _confirm, showNotification } from "../../components/notifications/notifications.js";
import { isAdminAuthenticated } from "../../shared/adminAuth.js";
import { renderUserQuizzesView, updateBulkActionBar } from "./user-quizzes-view.js";
import { getSelectedUserQuizzes } from "./app-state.js";
import { toSlug } from "./slug-utils.js";
import { buildUserQuizEntry } from "./quiz-schema.js";
import { getSubjectIcon } from "./subject-icons.js";

// Current navigation state
export let currentFolderId = null;
let folderPathStack = [];

export function getChildren(userQuizzes, parentId) {
  return userQuizzes.filter((q) => (q.meta?.parentId || null) === parentId);
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

  const userQuizzes = JSON.parse(getFromStorage("user_quizzes", "[]"));

  // Prevent duplicate names at the same level
  const trimmedName = name.trim();
  const duplicate = userQuizzes.find(
    (q) => (q.meta?.parentId || null) === currentFolderId &&
            (q.meta?.title || "").trim().toLowerCase() === trimmedName.toLowerCase()
  );
  if (duplicate) {
    showNotification("الاسم مستخدم", "يوجد عنصر بنفس الاسم في هذا المستوى. اختر اسماً مختلفاً.", "warning");
    return;
  }

  const newFolder = {
    id: crypto.randomUUID(),
    meta: {
      type: type,
      title: trimmedName,
      parentId: currentFolderId,
      createdAt: new Date().toLocaleString("en-US"),
    },
    stats: { questionCount: 0, questionTypes: [] },
    questions: [],
  };
  userQuizzes.push(newFolder);
  setInStorage("user_quizzes", JSON.stringify(userQuizzes));
  renderUserQuizzesView();
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

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay move-to-dialog-overlay";

  const card = document.createElement("div");
  card.className = "modal-card move-to-dialog-card";
  card.style.textAlign = "right";
  card.style.maxHeight = "80vh";
  card.style.display = "flex";
  card.style.flexDirection = "column";

  const closeDialog = () => overlay.remove();

  card.innerHTML = `
    <div class="modal-header">
      <h3 style="margin:0;font-size:1.05rem;">نقل ${itemIds.length > 1 ? `(${itemIds.length} عناصر)` : "إلى"}</h3>
      <button type="button" class="move-to-dialog-close" aria-label="إغلاق">✕</button>
    </div>
    <div class="move-to-dialog-list" role="listbox" aria-label="اختر وجهة النقل"></div>
  `;

  const listEl = card.querySelector(".move-to-dialog-list");
  listEl.style.overflowY = "auto";
  listEl.style.padding = "8px";

  function addOption(label, id, icon, depth = 0) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "move-to-dialog-option";
    btn.setAttribute("role", "option");
    btn.dataset.depth = String(depth);
    btn.style.cssText = `
      display: flex; align-items: center; gap: 8px; width: 100%;
      padding: 10px 12px; text-align: right; background: transparent;
      border: none; border-radius: 8px; cursor: pointer; font-size: 0.92rem;
      color: var(--color-text-primary);
    `;
    // Ancestry indicator: one guide segment per level of nesting, rendered
    // as small connector marks before the icon/label rather than leading
    // whitespace — whitespace-only indent (the old "　".repeat(depth)
    // approach) collapses visually once several siblings are at the same
    // depth, so there's no way to tell "these three are siblings under the
    // same parent" from "this is one level deeper". A visible connector per
    // level keeps that relationship legible regardless of depth.
    const guide = depth > 0
      ? `<span class="move-to-dialog-guide" aria-hidden="true" style="padding-inline-start:${(depth - 1) * 18}px">${"┃".repeat(Math.max(depth - 1, 0))}┗</span>`
      : "";
    btn.innerHTML = `${guide}<span aria-hidden="true">${icon}</span><span>${label}</span>`;
    btn.onmouseover = () => (btn.style.background = "var(--color-bg-hover, rgba(0,0,0,0.05))");
    btn.onmouseout = () => (btn.style.background = "transparent");
    btn.onclick = () => {
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
          "لا يمكن نقل مجلد إلى داخل نفسه أو أحد مجلداته الفرعية.",
          "warning",
        );
      }
      renderUserQuizzesView();
    };
    listEl.appendChild(btn);
  }

  addOption("إمتحاناتك (الرئيسية)", null, "📁", 0);

  // Build a simple indented flat list of every folder/course so the picker
  // stays a single scrollable list rather than a nested tree widget —
  // enough for typical folder depths, and far simpler to build/maintain.
  // Ancestry is made explicit visually (a vertical guide line + per-level
  // indent step on each option, rather than relying on full-width space
  // characters alone) so users can tell at a glance which folder is nested
  // under which before picking a destination.
  function appendChildren(parentId, depth) {
    folders
      .filter((f) => (f.meta?.parentId || null) === parentId)
      .forEach((f) => {
        const fid = f.id || f.meta?.id;
        const icon = f.meta?.icon || (f.meta?.type === "course" ? "📚" : "📁");
        addOption(f.meta?.title || "", fid, icon, depth);
        appendChildren(fid, depth + 1);
      });
  }
  appendChildren(null, 1);

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
    contextMenuEl.appendChild(createMenuItem(MOVE_TO_SVG, "نقل إلى", () => openMoveToDialog([targetId])));
    // "Move out" is only meaningful when the item is actually inside
    // something — one click straight to the immediate parent, instead of
    // making every out-of-folder move go through the full picker dialog.
    if (currentFolderId !== null) {
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

export function createFolderOrCourseCard(item) {
  const card = document.createElement("div");
  card.className = "category-card user-quiz-card";
  card.style.cursor = "pointer";
  card.draggable = true;

  const icon = item.meta?.type === "course" ? "📚" : "📁";
  const itemId = item.id || item.meta?.id;

  const selectedUserQuizzes = getSelectedUserQuizzes();
  const isChecked = selectedUserQuizzes.has(itemId);

  card.innerHTML = `
    <div class="user-quiz-card-overlay">
      <input type="checkbox" class="user-quiz-select-checkbox" data-quiz-id="${itemId}" aria-label="تحديد" ${isChecked ? "checked" : ""}>
    </div>
    <div class="category-icon" aria-hidden="true">${icon}</div>
    <div class="category-info">
      <h3>${item.meta?.title}</h3>
    </div>
  `;

  card.onclick = () => {
    // If in selection mode, toggle checkbox instead
    const container = document.querySelector(".user-quizzes-container");
    if (container?.classList.contains("selection-mode-active")) {
      const checkbox = card.querySelector(".user-quiz-select-checkbox");
      if (checkbox) checkbox.click();
      return;
    }
    navigateToFolder(itemId, item.meta?.title);
  };

  card.ondragstart = (e) => handleDragStart(e, itemId);
  card.ondragend = handleDragEnd;
  
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

  // Sync checkbox state with the shared selection set
  const checkbox = card.querySelector(".user-quiz-select-checkbox");
  if (checkbox) {
    checkbox.onclick = (e) => {
      e.stopPropagation();
      if (checkbox.checked) {
        selectedUserQuizzes.add(itemId);
      } else {
        selectedUserQuizzes.delete(itemId);
      }
      updateBulkActionBar();
    };
  }

  return card;
}