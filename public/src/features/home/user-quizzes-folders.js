import { getFromStorage, setInStorage } from "../../shared/storage-helpers.js";
import { _prompt, _confirm, showNotification } from "../../components/notifications/notifications.js";
import { isAdminAuthenticated } from "../../shared/adminAuth.js";
import { renderUserQuizzesView, updateBulkActionBar } from "./user-quizzes-view.js";
import { getSelectedUserQuizzes } from "./app-state.js";
import { toSlug } from "./slug-utils.js";

// Current navigation state
export let currentFolderId = null;
let folderPathStack = [];

export function getChildren(userQuizzes, parentId) {
  return userQuizzes.filter((q) => (q.meta?.parentId || null) === parentId);
}

export function getCurrentFolderPathStack() {
  return folderPathStack;
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
  if (await !_confirm("هل أنت متأكد من حذف هذا المجلد/المادة وكل ما بداخله؟")) return;
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

function uploadFolderForAdmins() {
  const input = document.createElement('input');
  input.type = 'file';
  input.webkitdirectory = true;
  input.directory = true;
  input.multiple = true;
  input.onchange = async (e) => {
    const files = Array.from(e.target.files).filter(f => f.name.endsWith('.json'));
    if (files.length === 0) return;
    const { importJsonQuizFiles } = await import("./quiz-file-import.js");
    importJsonQuizFiles(files);
  };
  input.click();
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