import { getFromStorage, setInStorage } from "../../shared/storage-helpers.js";
import { _prompt, _confirm, showNotification } from "../../components/notifications/notifications.js";
import { isAdminAuthenticated } from "../../shared/adminAuth.js";
import { renderUserQuizzesView, updateBulkActionBar } from "./user-quizzes-view.js";
import { getSelectedUserQuizzes } from "./app-state.js";

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

export async function createNewFolderOrCourse(type = "folder") {
  const name = await _prompt(`أدخل اسم ال${type === "course" ? "مادة" : "مجلد"}:`);
  if (!name || !name.trim()) return;

  const userQuizzes = JSON.parse(getFromStorage("user_quizzes", "[]"));
  const newFolder = {
    id: crypto.randomUUID(),
    meta: {
      type: type,
      title: name.trim(),
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
  if (item && item.meta) {
    item.meta.title = newName.trim();
    setInStorage("user_quizzes", JSON.stringify(userQuizzes));
    renderUserQuizzesView();
  }
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

export function initContextMenu() {
  if (contextMenuEl) return;
  contextMenuEl = document.createElement("div");
  contextMenuEl.id = "userQuizContextMenu";
  contextMenuEl.style.cssText = `
    display: none; position: absolute; z-index: 9999;
    background: var(--color-surface); border: 1px solid var(--color-border);
    border-radius: 8px; box-shadow: var(--shadow-lg); padding: 5px 0;
    min-width: 150px; flex-direction: column;
  `;
  document.body.appendChild(contextMenuEl);

  document.addEventListener("click", () => {
    contextMenuEl.style.display = "none";
  });
}

export function showContextMenu(e, targetType, targetId, targetTitle) {
  e.preventDefault();
  initContextMenu();
  
  contextMenuEl.innerHTML = "";
  
  if (targetType === "background") {
    contextMenuEl.appendChild(createMenuItem("إنشاء مجلد", () => createNewFolderOrCourse("folder")));
    if (currentFolderId === null) {
      contextMenuEl.appendChild(createMenuItem("إنشاء مادة", () => createNewFolderOrCourse("course")));
    }
    if (isAdminAuthenticated()) {
      contextMenuEl.appendChild(createMenuItem("رفع مجلد", () => uploadFolderForAdmins()));
    }
  } else if (targetType === "item" || targetType === "folder" || targetType === "course") {
    contextMenuEl.appendChild(createMenuItem("تحديد", () => selectItem(targetId)));
    contextMenuEl.appendChild(createMenuItem("إعادة تسمية", () => renameItem(targetId, targetTitle)));
    if (targetType === "folder" || targetType === "course") {
      contextMenuEl.appendChild(createMenuItem("حذف", () => deleteFolder(targetId)));
    }
  }

  contextMenuEl.style.left = `${e.pageX}px`;
  contextMenuEl.style.top = `${e.pageY}px`;
  contextMenuEl.style.display = "flex";
}

function createMenuItem(label, onClick) {
  const item = document.createElement("div");
  item.textContent = label;
  item.style.cssText = `
    padding: 10px 15px; cursor: pointer; color: var(--color-text-primary);
    font-size: 0.9rem; transition: background 0.2s;
  `;
  item.onmouseover = () => item.style.background = "var(--color-bg-hover, rgba(0,0,0,0.05))";
  item.onmouseout = () => item.style.background = "transparent";
  item.onclick = (e) => {
    e.stopPropagation();
    contextMenuEl.style.display = "none";
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

  const checkbox = document.querySelector(`.user-quiz-select-checkbox[data-quiz-id="${itemId}"]`);
  if (checkbox && !checkbox.checked) {
    checkbox.click();
  }
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