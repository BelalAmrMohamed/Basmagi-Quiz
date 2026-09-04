// ============================================================================
// public/src/features/home/user-quizzes-view.js
// USER QUIZZES VIEW — the "امتحاناتك" (My Quizzes) screen: card grid,
// admin sign-in/out bar, bulk selection + bulk action bar, and drag-and-drop
// file import.
// ============================================================================
// NOTE: this module and user-quiz-card.js import from each other
// (renderUserQuizzesView/updateBulkActionBar here, createUserQuizCard there).
// This is a real circular import, safe because neither side calls the
// other's export at module-evaluation time — only from inside event
// handlers/functions, by which point both modules have finished loading.
// ============================================================================

import { getFromStorage, setInStorage } from "../../shared/storage-helpers.js";
import { isAdminAuthenticated, fullSignOut } from "../../shared/adminAuth.js";
import { _prompt } from "../../components/notifications/notifications.js";
import { openExamDropdownMenu } from "./exam-dropdown-menu.js";
import { 
  currentFolderId, 
  getChildren, 
  getCurrentFolderPathStack, 
  navigateToFolder, 
  showContextMenu, 
  handleDragStart, 
  handleDragEnd, 
  handleDragOver, 
  handleDragLeave, 
  handleDrop,
  createNewFolderOrCourse,
  createFolderOrCourseCard,
  buildFolderHash,
  openMoveToDialog,
  createFolderOrCourseNamed,
  findFolderByName,
  moveItemsToFolder,
} from "./user-quizzes-folders.js";
import { openSignInDialog } from "../../components/log-in/sign-in.js";
import { container, title } from "./dom-refs.js";
import {
  getNavigationStack,
  isRestoring,
  getIndexSupabaseClient,
  getSelectedUserQuizzes,
  getSearchManager,
} from "./app-state.js";
import { updateBreadcrumb } from "./breadcrumb.js";
import { renderTitleBreadcrumb } from "./title-breadcrumb.js";
import { getSubjectIcon } from "./subject-icons.js";
import { qz, saveNewUserQuiz, buildUserQuizEntry } from "./quiz-schema.js";
import { createUserQuizCard } from "./user-quiz-card.js";
import { createInlineCreateQuizCard } from "./create-quiz-modal.js";
import { createAIAgentFab } from "../../components/ai-agent/ai-agent.js";
import { HOME_PAGE_SYSTEM_PROMPT } from "../../components/ai-agent/ai-agent-default-prompts.js";
import { HOME_PAGE_SUGGESTED_PROMPTS } from "../../components/ai-agent/ai-agent-suggested-prompts.js";
import { renderRootCategories } from "./root-view.js";
import {
  importJsonQuizFiles,
  wireJsonFileDropZone,
} from "./quiz-file-import.js";
import {
  ADMIN_SIGN_OUT_ICON_SVG,
  ADMIN_SIGN_IN_ICON_SVG,
  CHECK_SQUARE_ICON_SVG,
  TRASH_ICON_SVG,
  DOWNLOAD_ICON_SVG,
  MOVE_TO_ICON_SVG,
} from "./icons.js";
import {
  showNotification,
  _confirm,
} from "../../components/notifications/notifications.js";

/**
 * Handles the AI Helper's `create_quiz` tool call: validates the payload,
 * saves it via the same tested save path the manual paste-JSON modal uses
 * (saveNewUserQuiz, in quiz-schema.js), notifies the user, and refreshes
 * the grid. Returns the chat bubble text to show for this result.
 * @param {{name: string, input: object}} toolCall
 * @returns {string} text shown in the chat as the tool-result bubble
 */
function handleCreateQuizToolCall(toolCall) {
  const input = toolCall?.input || {};
  const questions = Array.isArray(input.questions) ? input.questions : [];

  if (!questions.length) {
    showNotification(
      "بيانات ناقصة",
      "لم يتمكن الباشــمبصمج من إنشاء الامتحان: لا توجد أسئلة صالحة.",
      "warning",
      10,
    );
    const err = new Error("create_quiz tool call had no questions");
    err.userMessage = "تعذر إنشاء الامتحان: لا توجد أسئلة صالحة.";
    throw err;
  }

  const title = input.title || "Untitled Quiz";
  const parsed = {
    questions,
    meta: { title, description: input.description || "" },
  };

  saveNewUserQuiz(parsed, title);
  showNotification(
    "تم الإنشاء",
    'تم إنشاء الامتحان وإضافته إلى "امتحاناتك"',
    "success",
  );
  renderRootCategories();
  renderUserQuizzesView();
  return `✅ تم إنشاء الامتحان: ${title}`;
}

/**
 * Handles the AI Helper's `edit_quiz` tool call. Finds the quiz by its
 * exact current title (matched against user_quizzes, the same source the
 * model was given via contextSummary), applies only the fields present in
 * the tool input, and persists the merged entry through buildUserQuizEntry
 * — the same normalization path saveNewUserQuiz uses — so edited quizzes
 * keep the same shape as newly-created ones.
 * @param {{name: string, input: object}} toolCall
 * @returns {string} text shown in the chat as the tool-result bubble
 */
function handleEditQuizToolCall(toolCall) {
  const input = toolCall?.input || {};
  const currentTitle = (input.currentTitle || "").trim();

  if (!currentTitle) {
    const err = new Error("edit_quiz tool call had no currentTitle");
    err.userMessage = "تعذر تعديل الامتحان: لم يتم تحديد الامتحان المطلوب تعديله.";
    throw err;
  }

  const quizzes = JSON.parse(getFromStorage("user_quizzes", "[]"));
  const index = quizzes.findIndex((q) => qz(q, "title") === currentTitle);

  if (index === -1) {
    const err = new Error(`edit_quiz: no quiz titled "${currentTitle}" found`);
    err.userMessage = `تعذر العثور على امتحان بعنوان "${currentTitle}".`;
    throw err;
  }

  const existing = quizzes[index];
  const newTitle = input.title || qz(existing, "title");
  const parsed = {
    // Only overwrite questions if the model actually sent a replacement
    // list — omitting `questions` in the tool call means "keep as-is",
    // per EDIT_QUIZ_TOOL's description (see api/ai-agent/_tools.js).
    questions: Array.isArray(input.questions) && input.questions.length
      ? input.questions
      : existing.questions,
    meta: {
      ...existing.meta,
      title: newTitle,
      description: input.description ?? existing.meta?.description ?? "",
    },
  };

  const entry = buildUserQuizEntry(qz(existing, "id") || existing.id, parsed, newTitle);
  quizzes[index] = entry;
  setInStorage("user_quizzes", JSON.stringify(quizzes));

  showNotification("تم التعديل", `تم تعديل الامتحان "${newTitle}"`, "success");
  renderRootCategories();
  renderUserQuizzesView();
  return `✅ تم تعديل الامتحان: ${newTitle}`;
}

/**
 * Handles the AI Helper's `delete_quiz` tool call. The system prompt
 * already instructs the model to only call this after the user explicitly
 * confirmed the exact quiz name in chat (see HOME_PAGE_SYSTEM_PROMPT) —
 * that confirmation, already given once in the conversation, is the single
 * source of truth. This intentionally does NOT add a second native/in-app
 * confirmation dialog on top: a prior version did, and the result was the
 * user confirming once in chat only to be asked again by a popup — a
 * redundant, confusing second gate on the exact same decision. create_quiz
 * and edit_quiz never had this second gate either; delete_quiz shouldn't
 * be the odd one out just because it's destructive — the chat confirmation
 * already carries that weight.
 * @param {{name: string, input: object}} toolCall
 * @returns {string} text shown in the chat as the tool-result bubble
 */
function handleDeleteQuizToolCall(toolCall) {
  const input = toolCall?.input || {};
  const title = (input.title || "").trim();

  if (!title) {
    const err = new Error("delete_quiz tool call had no title");
    err.userMessage = "تعذر حذف الامتحان: لم يتم تحديد اسم الامتحان.";
    throw err;
  }

  const quizzes = JSON.parse(getFromStorage("user_quizzes", "[]"));
  const match = quizzes.find((q) => qz(q, "title") === title);

  if (!match) {
    const err = new Error(`delete_quiz: no quiz titled "${title}" found`);
    err.userMessage = `تعذر العثور على امتحان بعنوان "${title}".`;
    throw err;
  }

  const remaining = quizzes.filter((q) => q !== match);
  setInStorage("user_quizzes", JSON.stringify(remaining));

  showNotification("تم الحذف", `تم حذف الامتحان "${title}"`, "success");
  renderRootCategories();
  renderUserQuizzesView();
  return `🗑️ تم حذف الامتحان: ${title}`;
}

/**
 * "امتحاناتك الرئيسية" (root) is how the folder-tree context prompt and
 * move_item's destinationFolder both refer to the top level — resolve that
 * literal label the same way for both create_folder's parentFolder and
 * move_item's destinationFolder so the model can use the exact string it
 * was given back in context, instead of having to know to omit the field
 * (which it won't reliably infer purely from the schema description).
 */
function resolveFolderTitleToId(folderTitle) {
  if (!folderTitle || folderTitle === "امتحاناتك الرئيسية" || folderTitle === "الرئيسية") {
    return { ok: true, id: null };
  }
  const found = findFolderByName(folderTitle);
  if (!found) {
    return { ok: false, reason: `لم يتم العثور على "${folderTitle}".` };
  }
  return { ok: true, id: found.id };
}

function handleCreateFolderToolCall(toolCall) {
  const { name, parentFolder } = toolCall?.input || {};
  if (!name || !name.trim()) {
    const err = new Error("create_folder called without a name");
    err.userMessage = "اسم المجلد مطلوب.";
    throw err;
  }

  const parentResolution = resolveFolderTitleToId(parentFolder);
  if (!parentResolution.ok) {
    const err = new Error(parentResolution.reason);
    err.userMessage = parentResolution.reason;
    throw err;
  }

  const result = createFolderOrCourseNamed("folder", name.trim(), parentResolution.id);
  if (!result.ok) {
    const err = new Error(result.reason);
    err.userMessage = result.reason;
    throw err;
  }

  renderUserQuizzesView();
  return `📁 تم إنشاء المجلد: ${name.trim()}`;
}

function handleCreateCourseToolCall(toolCall) {
  const { name } = toolCall?.input || {};
  if (!name || !name.trim()) {
    const err = new Error("create_course called without a name");
    err.userMessage = "اسم المادة مطلوب.";
    throw err;
  }

  // Courses are always top-level — see createFolderOrCourseNamed's own
  // guard, which this relies on rather than duplicating the check here.
  const result = createFolderOrCourseNamed("course", name.trim(), null);
  if (!result.ok) {
    const err = new Error(result.reason);
    err.userMessage = result.reason;
    throw err;
  }

  renderUserQuizzesView();
  return `📚 تم إنشاء المادة: ${name.trim()}`;
}

function handleMoveItemToolCall(toolCall) {
  const { itemName, destinationFolder } = toolCall?.input || {};
  if (!itemName || !itemName.trim()) {
    const err = new Error("move_item called without an itemName");
    err.userMessage = "اسم العنصر المراد نقله مطلوب.";
    throw err;
  }

  // The item being moved can be a quiz, a folder, or a course — quizzes
  // aren't findable via findFolderByName (folders/courses only), so quiz
  // titles are matched directly against user_quizzes here.
  const userQuizzes = JSON.parse(getFromStorage("user_quizzes", "[]"));
  const normalize = (s) => (s || "").trim().toLowerCase();
  const item = userQuizzes.find((q) => normalize(q.meta?.title) === normalize(itemName));
  if (!item) {
    const err = new Error(`Item not found: ${itemName}`);
    err.userMessage = `لم يتم العثور على "${itemName}".`;
    throw err;
  }
  const itemId = item.id || item.meta?.id;

  const destResolution = resolveFolderTitleToId(destinationFolder);
  if (!destResolution.ok) {
    const err = new Error(destResolution.reason);
    err.userMessage = destResolution.reason;
    throw err;
  }

  const { moved, blocked } = moveItemsToFolder([itemId], destResolution.id);
  renderUserQuizzesView();

  if (moved > 0) {
    return `✅ تم نقل "${itemName}" إلى ${destinationFolder || "امتحاناتك الرئيسية"}.`;
  }
  const err = new Error(`Move blocked/no-op for ${itemName}`);
  err.userMessage = blocked > 0
    ? "لا يمكن نقل مجلد إلى داخل نفسه أو أحد مجلداته الفرعية، ولا يمكن نقل مادة إلى داخل مجلد آخر."
    : `"${itemName}" موجود بالفعل في هذا الموقع.`;
  throw err;
}

/**
 * Renders the user's folder/course tree as an indented plain-text list by
 * title (root "امتحاناتك الرئيسية" first, then each folder/course nested
 * under its parent) for the AI agent's system-context — this is the only
 * way the model can resolve create_folder's parentFolder or move_item's
 * itemName/destinationFolder to a real location, since (like every other
 * tool on this page) it only ever sees titles, never internal ids.
 * @param {object[]} userQuizzes
 * @returns {string}
 */
function buildFolderTreeContextPrompt(userQuizzes) {
  const nodes = userQuizzes.filter(
    (q) => q.meta?.type === "folder" || q.meta?.type === "course",
  );
  const lines = ["هيكل المجلدات والمواد الحالي للمستخدم:", "- امتحاناتك الرئيسية (المستوى الرئيسي)"];

  function appendChildren(parentId, depth) {
    nodes
      .filter((n) => (n.meta?.parentId || null) === parentId)
      .forEach((n) => {
        const nid = n.id || n.meta?.id;
        const kind = n.meta?.type === "course" ? "مادة" : "مجلد";
        lines.push(`${"  ".repeat(depth)}- ${n.meta?.title || ""} (${kind})`);
        appendChildren(nid, depth + 1);
      });
  }
  appendChildren(null, 1);

  return lines.join("\n");
}

/**
 * Single entry point passed as onToolCall to createAIAgentFab — dispatches
 * to the right handler by tool name. Keeps ai-agent-chat.js generic (it
 * just calls whatever onToolCall it was given) while each page decides
 * which tool names it actually supports.
 * @param {{name: string, input: object}} toolCall
 * @returns {string} text shown in the chat as the tool-result bubble
 */
function handleQuizToolCall(toolCall) {
  switch (toolCall?.name) {
    case "create_quiz":
      return handleCreateQuizToolCall(toolCall);
    case "edit_quiz":
      return handleEditQuizToolCall(toolCall);
    case "delete_quiz":
      return handleDeleteQuizToolCall(toolCall);
    case "create_folder":
      return handleCreateFolderToolCall(toolCall);
    case "create_course":
      return handleCreateCourseToolCall(toolCall);
    case "move_item":
      return handleMoveItemToolCall(toolCall);
    default: {
      const err = new Error(`Unknown tool call: ${toolCall?.name}`);
      err.userMessage = "أداة غير معروفة.";
      throw err;
    }
  }
}

/**
 * Render user-created quizzes VIEW (Folder Content)
 */
export function renderUserQuizzesView() {
  try {
    const selectedUserQuizzes = getSelectedUserQuizzes();
    selectedUserQuizzes.clear();

    // Update Navigation Stack — only push if we're not already sitting on
    // this same view. Without this guard, any re-render of this view while
    // already inside it (e.g. renderUserQuizzesView() called again after a
    // bulk delete) pushes a second "امتحاناتك" frame, making the breadcrumb
    // read navigationStack[length - 2] (undefined) instead of the actual
    // parent, which broke both its label and its onclick handler.
    const navigationStack = getNavigationStack();
    const topOfStack = navigationStack[navigationStack.length - 1];
    if (!topOfStack || topOfStack.name !== "امتحاناتك") {
      navigationStack.push({ name: "امتحاناتك" });
    }
    updateBreadcrumb();

    // Build the correct URL hash for the current folder depth
    const folderHash = buildFolderHash();
    if (!isRestoring()) {
      history.pushState({ view: "my-quizzes" }, "", folderHash);
    } else {
      history.replaceState({ view: "my-quizzes" }, "", folderHash);
    }

    // Fix the #breadcrumb back-button for nested user-quiz folders.
    // updateBreadcrumb() only knows about the navigationStack which holds
    // a single "امتحاناتك" entry — it always renders "الرجوع إلى المواد ←"
    // regardless of how deep we are in the folder tree. Override it directly
    // based on the real folderPathStack.
    const pathStack = getCurrentFolderPathStack();
    const breadcrumbEl = document.getElementById("breadcrumb");
    if (breadcrumbEl && pathStack.length > 0) {
      breadcrumbEl.classList.add("show");
      breadcrumbEl.setAttribute("aria-hidden", "false");
      const breadcrumbText = breadcrumbEl.querySelector(".breadcrumb-text");
      if (breadcrumbText) {
        if (pathStack.length === 1) {
          // Parent is the root of user-quizzes
          breadcrumbText.textContent = "الرجوع إلى امتحاناتك ←";
          breadcrumbEl.onclick = () => navigateToFolder(null, null);
          breadcrumbEl.setAttribute("aria-label", "الرجوع إلى امتحاناتك ←");
        } else {
          // Parent is the previous folder in the path stack
          const parentFolder = pathStack[pathStack.length - 2];
          breadcrumbText.textContent = `الرجوع إلى ${parentFolder.title} ←`;
          breadcrumbEl.onclick = () => navigateToFolder(parentFolder.id, parentFolder.title);
          breadcrumbEl.setAttribute("aria-label", `الرجوع إلى ${parentFolder.title} ←`);
        }
      }

      // MOVE OUT OF FOLDER — make the back-breadcrumb itself a valid drop
      // target. Previously the only background drop target was
      // quizzesContainer, which resolves to `currentFolderId` — a no-op
      // when you're already inside a folder, since it just re-parents the
      // item to the folder it's already in. Dropping on the "الرجوع إلى
      // ..." breadcrumb instead moves the item to the parent one level up,
      // which is the actual "move out" gesture this view was missing.
      const targetParentId = pathStack.length === 1 ? null : pathStack[pathStack.length - 2].id;
      breadcrumbEl.ondragover = handleDragOver;
      breadcrumbEl.ondragleave = handleDragLeave;
      breadcrumbEl.ondrop = (e) => handleDrop(e, targetParentId);
    } else if (breadcrumbEl) {
      breadcrumbEl.ondragover = null;
      breadcrumbEl.ondragleave = null;
      breadcrumbEl.ondrop = null;
    }

    // Update Title: use the smart collapsible breadcrumb in #Subjects-text.
    // Build items from folderPathStack: root = "امتحاناتك", then each folder.
    if (title) {
      let userQuizzes = [];
      try {
        userQuizzes = JSON.parse(getFromStorage("user_quizzes", "[]"));
      } catch (e) {
        userQuizzes = [];
      }

      // dropTargetId is carried separately from onClick: every ancestor
      // crumb (including the current/last one, which has no onClick) is a
      // valid "move item here" drop target, not just the clickable ones.
      const bcItems = [
        {
          label: "امتحاناتك",
          icon: "📁",
          onClick: pathStack.length > 0 ? () => navigateToFolder(null, null) : undefined,
          dropTargetId: null,
        },
        ...pathStack.map((f, idx) => {
          const item = userQuizzes.find((q) => (q.id || q.meta?.id) === f.id);
          const isCourse = item?.meta?.type === "course" || (!item?.meta?.type && idx === 0);
          const icon = item?.meta?.icon || (isCourse ? getSubjectIcon(f.title, false) : "📁");
          return {
            label: f.title,
            icon: icon,
            onClick:
              idx < pathStack.length - 1
                ? () => navigateToFolder(f.id, f.title)
                : undefined, // last = current, non-clickable
            dropTargetId: f.id,
          };
        }),
      ];
      renderTitleBreadcrumb(title, bcItems);

      // MOVE INTO ANY ANCESTOR — wire drag/drop onto the rendered crumb
      // elements too (renderTitleBreadcrumb doesn't take drop handlers
      // itself), so dropping a quiz/folder on ANY ancestor in the path —
      // not just the immediate parent — moves it there directly, including
      // the current (non-clickable) crumb which represents "stay here".
      // Matched by index since renderTitleBreadcrumb renders one
      // .title-breadcrumb-item per bcItems entry, in the same order
      // (it may collapse the middle into a "…" dropdown, but the first and
      // last items — the ones most useful as drop targets — always render).
      requestAnimationFrame(() => {
        const crumbEls = title.querySelectorAll(".title-breadcrumb-item");
        crumbEls.forEach((el) => {
          const label = el.getAttribute("title");
          const match = bcItems.find((it) => it.label === label);
          if (!match) return;
          el.ondragover = handleDragOver;
          el.ondragleave = handleDragLeave;
          el.ondrop = (e) => {
            e.stopPropagation();
            handleDrop(e, match.dropTargetId);
          };
        });
      });
    }

    if (!container) return;

    container.innerHTML = "";
    container.className = "grid-container user-quizzes-drop-zone";

    const userQuizzes = JSON.parse(getFromStorage("user_quizzes", "[]"));

    // Update search context for user quizzes
    const searchManager = getSearchManager();
    if (searchManager) {
      searchManager.container.style.display = ""; // Reset inline hide
      searchManager.setUserQuizzesContext(userQuizzes);
    }

    // 1. Create 'Create New Quiz' Button (Always visible at top)
    const actionsBar = document.createElement("div");
    actionsBar.className = "user-quiz-search-actions";

    // Mobile "مجلد جديد" button — a dropdown with both "مجلد جديد" and
    // "مادة جديدة" (previously hardcoded to always create a folder, so
    // phone users had no way to create a course at all — that was only
    // reachable via the desktop right-click context menu). Course creation
    // stays root-only, matching the same rule the desktop context menu
    // already enforces (see showContextMenu in user-quizzes-folders.js).
    const createFolderBtn = document.createElement("button");
    createFolderBtn.type = "button";
    createFolderBtn.innerHTML = `<span>مجلد جديد</span> <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`;
    createFolderBtn.className = "btn create-folder-btn mobile-only-flex";
    createFolderBtn.setAttribute("aria-label", "إنشاء مجلد أو مادة جديدة");
    createFolderBtn.setAttribute("aria-haspopup", "menu");
    createFolderBtn.onclick = (e) => {
      e.stopPropagation();
      openExamDropdownMenu(createFolderBtn, (menu, closeMenu) => {
        const folderOpt = document.createElement("button");
        folderOpt.type = "button";
        folderOpt.className = "exam-action-btn";
        folderOpt.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg><span>مجلد جديد</span>`;
        folderOpt.onclick = (e) => {
          e.stopPropagation();
          closeMenu();
          createNewFolderOrCourse("folder");
        };
        menu.appendChild(folderOpt);

        const courseOpt = document.createElement("button");
        courseOpt.type = "button";
        courseOpt.className = "exam-action-btn";
        courseOpt.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg><span>مادة جديدة</span>`;
        if (currentFolderId === null) {
          courseOpt.onclick = (e) => {
            e.stopPropagation();
            closeMenu();
            createNewFolderOrCourse("course");
          };
        } else {
          // Shown-disabled with an explanation, rather than hidden — a
          // silently-missing option here would look like a bug, the same
          // inconsistency Part 3 flags for the desktop context menu.
          courseOpt.disabled = true;
          courseOpt.title = "يمكن إنشاء المواد في الصفحة الرئيسية لـ«امتحاناتك» فقط";
          courseOpt.style.opacity = "0.5";
          courseOpt.style.cursor = "not-allowed";
        }
        menu.appendChild(courseOpt);
      });
    };
    actionsBar.appendChild(createFolderBtn);

    // Selection mode only makes sense when there's actually something to
    // select — hide the toggle entirely for an empty quiz list.
    if (userQuizzes.length > 0) {
      const toggleSelectionBtn = document.createElement("button");
      toggleSelectionBtn.type = "button";
      toggleSelectionBtn.className = "btn selection-toggle-btn mobile-only-flex";
      toggleSelectionBtn.innerHTML = `<span>تحديد الامتحانات</span> ${CHECK_SQUARE_ICON_SVG}`;
      toggleSelectionBtn.onclick = () => {
        const qzContainer = container.querySelector(".user-quizzes-container");
        if (qzContainer) {
          qzContainer.classList.toggle("selection-mode-active");
          const isActive = qzContainer.classList.contains(
            "selection-mode-active",
          );
          toggleSelectionBtn.classList.toggle("active", isActive);
          if (!isActive) {
            selectedUserQuizzes.clear();
            document
              .querySelectorAll(".user-quiz-select-checkbox")
              .forEach((cb) => (cb.checked = false));
          }
          // Show the bar as soon as selection mode turns on (even with
          // nothing selected yet, so "تحديد الكل" is reachable), and hide
          // it the moment selection mode turns off.
          updateBulkActionBar(isActive);
        }
      };
      actionsBar.appendChild(toggleSelectionBtn);
    }

    container.appendChild(actionsBar);

    // Inline create-quiz card (always visible in this view)
    const inlineCreateCard = createInlineCreateQuizCard();

    // Drag-and-drop JSON import on the whole امتحاناتك section
    wireJsonFileDropZone(container, (files) => importJsonQuizFiles(files), {
      isEnabled: () => container.classList.contains("user-quizzes-drop-zone"),
    });

    // 2. Dedicated container for quiz cards — gets its own border/border-radius
    //    so the sign-in button and create card sit outside the bordered list.
    const quizzesContainer = document.createElement("div");
    quizzesContainer.className = "user-quizzes-container";

    // (Breadcrumbs are now shown in the #Subjects-text header above, not here)

    // Attach Context Menu & Drop events to the container
    quizzesContainer.addEventListener("contextmenu", (e) => {
      if (e.target === quizzesContainer || e.target.closest(".user-quizzes-drop-zone")) {
        showContextMenu(e, "background", null, null);
      }
    });

    quizzesContainer.addEventListener("dragover", handleDragOver);
    quizzesContainer.addEventListener("dragleave", handleDragLeave);
    quizzesContainer.addEventListener("drop", (e) => handleDrop(e, currentFolderId));

    // Filter userQuizzes based on current folder
    const currentChildren = getChildren(userQuizzes, currentFolderId);

    // 3. Quiz cards (or empty state) go into quizzesContainer, not container
    if (currentChildren.length === 0) {
      // Empty state
      const emptyState = document.createElement("div");
      emptyState.setAttribute("role", "status");
      emptyState.style.cssText = `
        grid-column: 1 / -1;
        text-align: center;
        padding: 60px 20px;
        background: var(--color-surface);
        border-radius: 12px;
        box-shadow: var(--shadow-md);
        color: var(--color-text-primary);
      `;
      emptyState.innerHTML = `
        <div style="font-size: 4rem; margin-bottom: 20px; opacity: 0.5;" aria-hidden="true">📝</div>
        <h3 style="margin-bottom: 10px;">${currentFolderId ? "هذا المجلد فارغ" : "لم تقم بإنشاء أي اختبارات أو مجلدات حتى الآن"}</h3>
        <p style="color: var(--color-text-secondary);">انقر على الزر الذي في الأعلى للبدء</p>
      `;
      quizzesContainer.appendChild(emptyState);
    } else {
      currentChildren.forEach((item, index) => {
        if (item.meta?.type === "folder" || item.meta?.type === "course") {
          const folderCard = createFolderOrCourseCard(item);
          quizzesContainer.appendChild(folderCard);
        } else {
          const quizCard = createUserQuizCard(item, index);
          // Attach drag and context menu to quiz card
          quizCard.draggable = true;
          quizCard.addEventListener("dragstart", (e) => handleDragStart(e, item.id || item.meta?.id));
          quizCard.addEventListener("dragend", handleDragEnd);
          quizCard.addEventListener("contextmenu", (e) => {
            e.stopPropagation();
            showContextMenu(e, "item", item.id || item.meta?.id, item.meta?.title);
          });
          quizzesContainer.appendChild(quizCard);
        }
      });
    }

    // Prepend the create card as the first child in the quizzesContainer
    // so it flows inline in the same CSS grid on desktop.
    quizzesContainer.prepend(inlineCreateCard);

    container.appendChild(quizzesContainer);

    // ── AI Helper — floating action button that opens the modal widget on
    // click (see public/src/components/ai-agent/ai-agent.js). Mounted once
    // per render; harmless to recreate since the old one is discarded with
    // container.innerHTML = "" at the top of this function, and a FAB
    // fixed-positioned outside the render flow doesn't need special
    // placement here beyond being present in the DOM.
    //
    // contextSummary: a lightweight { title, questionCount, types } per
    // quiz — NOT the full quiz JSON, which could blow the context window.
    // Read access lets the assistant answer "what quizzes do I have"
    // without a tool round-trip; create access (enableTools +
    // onToolCall) lets it save a new quiz once the user confirms one.
    const getLiveContextSummary = () => {
      const liveQuizzes = JSON.parse(getFromStorage("user_quizzes", "[]"));
      return liveQuizzes.map((quiz) => ({
        title: qz(quiz, "title"),
        questionCount: qz(quiz, "count"),
        types: qz(quiz, "type"),
      }));
    };

    const getLiveFolderTreePrompt = () => {
      const liveQuizzes = JSON.parse(getFromStorage("user_quizzes", "[]"));
      return buildFolderTreeContextPrompt(liveQuizzes);
    };

    container.appendChild(
      createAIAgentFab({
        placeholder: "اسأل الباشــمبصمج",
        pageKey: "home",
        defaultSystemPrompt: HOME_PAGE_SYSTEM_PROMPT,
        suggestedPrompts: HOME_PAGE_SUGGESTED_PROMPTS,
        enableFileUpload: true,
        contextSummary: getLiveContextSummary,
        contextPrompt: getLiveFolderTreePrompt,
        enableTools: true,
        toolNames: ["create_quiz", "edit_quiz", "delete_quiz", "create_folder", "create_course", "move_item"],
        onToolCall: handleQuizToolCall,
      }),
    );

    renderBulkActionBar();
  } catch (error) {
    console.error("Error rendering user quizzes view:", error);
    if (container) {
      container.innerHTML = `
  <div class="error-state" role="alert">
    <p>حدث خطأ أثناء تحميل الإختبارات. يرجى تحديث الصفحة.</p>
    <button onclick="renderRootCategories()" type="button">الرجوع للرئيسية</button>
  </div>
`;
    }
  }
}

// ─── Bulk Action Helpers ────────────────────────────────────────────────────────

function downloadQuizAsJson(quiz) {
  const dataStr =
    "data:text/json;charset=utf-8," +
    encodeURIComponent(JSON.stringify(quiz, null, 2));
  const dlAnchorElem = document.createElement("a");
  dlAnchorElem.setAttribute("href", dataStr);
  const safeTitle = (quiz.meta?.title || quiz.title || "quiz")
    .replace(/[^a-zA-Z0-9\u0600-\u06FF\s-_]/g, "")
    .trim();
  dlAnchorElem.setAttribute("download", safeTitle + ".json");
  dlAnchorElem.click();
}

/**
 * Classifies a bulk selection (raw user_quizzes rows) by item type and
 * decides which upload wizard (if any) the selection should open, per the
 * routing rules in admin-upload-update.md:
 *   - courses only (one or more)              -> "course" wizard
 *   - courses mixed with folders/quizzes       -> "mixed" (blocked; courses
 *                                                 must be uploaded alone
 *                                                 with their own contents)
 *   - folders (+ optionally loose quizzes),
 *     no courses                               -> "folder" wizard
 *   - quizzes only, no courses/folders          -> "quiz" wizard (existing
 *                                                 single/batch flow)
 * @param {Array} rows - raw user_quizzes rows matching the selection
 * @returns {{
 *   mode: "course"|"folder"|"quiz"|"mixed"|"empty",
 *   courses: Array, folders: Array, quizzes: Array
 * }}
 */
function classifyBulkSelection(rows) {
  const courses = [];
  const folders = [];
  const quizzes = [];
  for (const row of rows) {
    if (row?.meta?.type === "course") courses.push(row);
    else if (row?.meta?.type === "folder") folders.push(row);
    else quizzes.push(row);
  }

  let mode;
  if (courses.length === 0 && folders.length === 0 && quizzes.length === 0) {
    mode = "empty";
  } else if (courses.length > 0 && (folders.length > 0 || quizzes.length > 0)) {
    mode = "mixed";
  } else if (courses.length > 0) {
    mode = "course";
  } else if (folders.length > 0) {
    mode = "folder";
  } else {
    mode = "quiz";
  }

  return { mode, courses, folders, quizzes };
}

/**
 * Routes a bulk selection to the right upload wizard (adminUpload.js),
 * per classifyBulkSelection's mode. Shared by both bulk-upload-button
 * wiring sites (renderBulkActionBar's inline build + ensureBulkUploadButton's
 * lazy-attach path) so the routing logic can't drift out of sync between
 * the two.
 * @param {Array} selected - raw user_quizzes rows matching the selection
 */
function routeBulkUpload(selected) {
  const { mode, courses, folders, quizzes } = classifyBulkSelection(selected);

  if (mode === "empty") return;

  if (mode === "mixed") {
    showNotification(
      "لا يمكن رفع هذا التحديد معاً",
      `المواد ترفع وحدها مع محتوياتها الكاملة. تم تحديد ${courses.length} مادة مع ${folders.length + quizzes.length} عنصر آخر — ألغِ تحديد المواد أو حددها بمفردها.`,
      "warning",
    );
    return;
  }

  const userQuizzes = JSON.parse(getFromStorage("user_quizzes", "[]"));

  if (mode === "course") {
    import("./adminUpload.js").then((mod) => {
      mod.openCourseUploadModal(courses, userQuizzes);
    });
    return;
  }

  if (mode === "folder") {
    import("./adminUpload.js").then((mod) => {
      mod.openFolderUploadModal({ folders, quizzes, userQuizzes });
    });
    return;
  }

  // mode === "quiz"
  import("./adminUpload.js").then((mod) => {
    mod.openAdminUploadModal(quizzes);
  });
}

/**
 * Lazily creates and wires the admin-only upload button inside an existing
 * bulk action bar if it's missing and the admin is (now) authenticated.
 *
 * This exists because renderBulkActionBar() below only builds the bar's
 * DOM once per page load and caches it — the upload button's presence was
 * previously decided a single time, at first-build, from whatever
 * isAdminAuthenticated() returned in that instant. If the bar happened to
 * get built before an admin signed in (the totally normal case of
 * browsing anonymously, then logging in as admin mid-session via the
 * sidebar — session-sync.js's onRecovered path — without a full reload),
 * the button was simply never created, and nothing afterward ever
 * re-checked: it stayed permanently absent for the rest of the session.
 * Calling this from updateBulkActionBar() (already invoked on every
 * selection/auth-relevant UI refresh) means the button appears as soon as
 * the admin session is recognized, without needing a reload.
 */
function ensureBulkUploadButton(bar, selectedUserQuizzes) {
  if (bar.querySelector(".bulk-upload-btn") || !isAdminAuthenticated()) return;

  const btn = document.createElement("button");
  btn.className = "btn bulk-upload-btn";
  btn.title = "رفع الامتحان (للمشرفين)";
  btn.style.display = "none";
  btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/></svg>`;

  // Placed right before the "clear selection" (✕) button, matching where
  // it's positioned when built inline at bar-creation time.
  const clearBtn = bar.querySelector(".bulk-clear-btn");
  if (clearBtn) clearBtn.before(btn);
  else bar.querySelector(".bulk-actions")?.appendChild(btn);

  btn.onclick = () => {
    if (selectedUserQuizzes.size === 0) return;
    const userQuizzes = JSON.parse(getFromStorage("user_quizzes", "[]"));
    const selected = userQuizzes.filter((q) =>
      selectedUserQuizzes.has(q.id || q.meta?.id),
    );
    routeBulkUpload(selected);
  };
}

/**
 * Refresh the bulk action bar's visibility, selected-count label, and the
 * "select all" button's state.
 *
 * @param {boolean|undefined} forceActive - when provided, this overrides the
 *   visibility decision (used right when selection mode is toggled on/off,
 *   before any card has necessarily been selected). When omitted, visibility
 *   is inferred from whether the quiz grid is currently in selection mode.
 */
export function updateBulkActionBar(forceActive) {
  const selectedUserQuizzes = getSelectedUserQuizzes();
  const bar = document.getElementById("bulk-action-bar");
  if (!bar) return;

  ensureBulkUploadButton(bar, selectedUserQuizzes);

  const qzContainer = document.querySelector(".user-quizzes-container");
  const selectionModeActive =
    typeof forceActive === "boolean"
      ? forceActive
      : !!qzContainer?.classList.contains("selection-mode-active");

  if (!selectionModeActive) {
    bar.style.display = "none";
    return;
  }

  bar.style.display = "flex";

  const count = selectedUserQuizzes.size;
  bar.querySelector(".bulk-count").textContent =
    count > 0 ? `تم تحديد ${count}` : "لم يتم تحديد أي شيء";

  // Hide the destructive/export actions when nothing is selected (not just
  // disabled — fully hidden so the bar looks clean with only count + select-all
  // when zero items are selected).
  const hasSelection = count > 0;
  bar
    .querySelectorAll(".bulk-delete-btn, .bulk-extract-btn, .bulk-upload-btn, .bulk-move-btn")
    .forEach((btn) => {
      btn.style.display = hasSelection ? "" : "none";
    });

  // Keep the "تحديد الكل" button in sync with whether everything visible
  // is currently selected.
  const selectAllBtn = bar.querySelector(".bulk-select-all-btn");
  if (selectAllBtn) {
    const totalCheckboxes = document.querySelectorAll(
      ".user-quiz-select-checkbox",
    ).length;
    const allSelected = totalCheckboxes > 0 && count >= totalCheckboxes;
    selectAllBtn.textContent = allSelected ? "إلغاء تحديد الكل" : "تحديد الكل";
    selectAllBtn.classList.toggle("all-selected", allSelected);
  }
}

function renderBulkActionBar() {
  const selectedUserQuizzes = getSelectedUserQuizzes();
  let bar = document.getElementById("bulk-action-bar");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "bulk-action-bar";
    bar.className = "bulk-action-bar";
    bar.style.display = "none";

    let uploadBtnHtml = "";
    if (isAdminAuthenticated()) {
      uploadBtnHtml = `<button class="btn bulk-upload-btn" title="رفع الامتحان (للمشرفين)" style="display:none"><svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/></svg></button>`;
    }

    bar.innerHTML = `
      <div class="bulk-count">لم يتم تحديد أي شيء</div>
      <div class="bulk-actions">
        <button class="btn bulk-select-all-btn">تحديد الكل</button>
        <button class="btn bulk-move-btn" style="display:none" title="نقل إلى" aria-label="نقل إلى">${MOVE_TO_ICON_SVG}</button>
        <button class="btn bulk-extract-btn" style="display:none" title="استخراج" aria-label="استخراج">${DOWNLOAD_ICON_SVG}</button>
        <button class="btn bulk-delete-btn" style="display:none" title="حذف" aria-label="حذف">${TRASH_ICON_SVG}</button>
        ${uploadBtnHtml}
        <button class="btn bulk-clear-btn" title="إلغاء التحديد" aria-label="إلغاء التحديد">✕</button>
      </div>
    `;
    document.body.appendChild(bar);

    bar.querySelector(".bulk-clear-btn").onclick = () => {
      selectedUserQuizzes.clear();
      const qzContainer = document.querySelector(".user-quizzes-container");
      if (qzContainer) qzContainer.classList.remove("selection-mode-active");
      const toggleBtn = document.querySelector(".selection-toggle-btn");
      if (toggleBtn) toggleBtn.classList.remove("active");
      document.querySelectorAll(".user-quiz-select-checkbox").forEach((cb) => (cb.checked = false));
      bar.style.display = "none";
    };
    bar.querySelector(".bulk-select-all-btn").onclick = () => {
      const userQuizzes = JSON.parse(getFromStorage("user_quizzes", "[]"));
      const allIds = userQuizzes.map((q) => qz(q, "id") || q.id);
      const allCurrentlySelected =
        allIds.length > 0 && allIds.every((id) => selectedUserQuizzes.has(id));

      if (allCurrentlySelected) {
        selectedUserQuizzes.clear();
      } else {
        allIds.forEach((id) => selectedUserQuizzes.add(id));
      }

      document.querySelectorAll(".user-quiz-select-checkbox").forEach((cb) => {
        cb.checked = !allCurrentlySelected;
      });

      updateBulkActionBar();
    };

    bar.querySelector(".bulk-delete-btn").onclick = async () => {
      if (selectedUserQuizzes.size === 0) return;
      if (await _confirm("هل أنت متأكد من حذف الاختبارات المحددة؟")) {
        let userQuizzes = JSON.parse(getFromStorage("user_quizzes", "[]"));
        userQuizzes = userQuizzes.filter((q) => {
          const qId = qz(q, "id") || q.id;
          return !selectedUserQuizzes.has(qId);
        });
        setInStorage("user_quizzes", JSON.stringify(userQuizzes));
        selectedUserQuizzes.clear();
        renderUserQuizzesView();
      }
    };

    // ── Bulk move — the folder-tree picker (openMoveToDialog) already
    // accepts an array of ids and moves all of them in one storage write
    // (see moveItemsToFolder in user-quizzes-folders.js), so the only work
    // here is collecting the current selection and handing it off. One
    // gap: openMoveToDialog doesn't clear the shared selectedUserQuizzes
    // Set itself (it's also used by the single-item "نقل إلى" menu action,
    // which never touches that Set at all), so without clearing it here the
    // moved ids would stay marked "selected" — stale entries that would
    // silently resurface the next time the bulk bar is used. Delete already
    // clears the same Set for the same reason; move needs to as well.
    bar.querySelector(".bulk-move-btn").onclick = () => {
      if (selectedUserQuizzes.size === 0) return;
      openMoveToDialog([...selectedUserQuizzes]);
      selectedUserQuizzes.clear();
    };

    bar.querySelector(".bulk-extract-btn").onclick = async () => {
      if (selectedUserQuizzes.size === 0) return;
      const userQuizzes = JSON.parse(getFromStorage("user_quizzes", "[]"));
      const selected = userQuizzes.filter((q) => {
        const qId = qz(q, "id") || q.id;
        return selectedUserQuizzes.has(qId);
      });
      if (selected.length === 0) return;
      const dataStr =
        "data:text/json;charset=utf-8," +
        encodeURIComponent(JSON.stringify(selected, null, 2));
      const dlAnchorElem = document.createElement("a");
      dlAnchorElem.setAttribute("href", dataStr);
      dlAnchorElem.setAttribute(
        "download",
        `my-personal-quizzes__${selected.length}.json`,
      );
      dlAnchorElem.click();
    };

    if (isAdminAuthenticated()) {
      bar.querySelector(".bulk-upload-btn").onclick = () => {
        if (selectedUserQuizzes.size === 0) return;
        const userQuizzes = JSON.parse(getFromStorage("user_quizzes", "[]"));
        const selected = userQuizzes.filter((q) =>
          selectedUserQuizzes.has(q.id || q.meta?.id),
        );
        routeBulkUpload(selected);
      };
    }
  }
  updateBulkActionBar(false);
}