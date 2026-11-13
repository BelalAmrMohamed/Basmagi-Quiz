// Workspace («محتواي») item helpers: play/delete handlers, ⋮ menus and the
// per-card action bundles consumed by item-card.js.

import { qz } from "./quiz-schema.js";
import { refreshUserQuizzesCard } from "./course-count.js";
import { moveToTrash } from "./user-quizzes-trash.js";
import { getFromStorage, setInStorage } from "../../shared/storage-helpers.js";
import {
  isAdminAuthenticated,
  hasAdminSessionHint,
} from "../../shared/adminAuth.js";
import { createUploadButton, createLessonUploadButton, createNotebookUploadButton } from "./adminUpload.js";
import { showUserQuizDownloadPopup } from "./download-modal.js";
import { showUserQuizInfoModal, formatDateForInfo } from "./quiz-info-modal.js";
import { normalizeSource } from "../../components/quiz-info-modal/info-model.js";
import { showUserLessonInfoModal, collectLessonInfo } from "./lesson-info-modal.js";
import {
  createExamInfoSubmenu,
  createActionGroupSubmenu,
  openItemDropdownMenu,
} from "./item-dropdown-menu.js";
import { renderRootCategories } from "./root-view.js";
import { renderUserQuizzesView } from "./user-quizzes-view.js";
import {
  openMoveToDialog,
  renameItem,
  deleteFolder,
  selectItem,
  moveItemOutOfFolder,
  currentFolderId,
} from "./user-quizzes-folders.js";
import { userProfile } from "../../shared/userProfile.js";
import { LOCK_ICON_SVG, DOWNLOAD_ICON_SVG, EDIT_ICON_SVG, RENAME_ICON_SVG, TRASH_ICON_SVG, MOVE_TO_ICON_SVG } from "./icons.js";
import {
  showNotification,
  _confirm,
  _alert,
} from "../../components/notifications/notifications.js";
// PHASE 2: "اسأل الباشـمبصمج" entry point — opens the AI Agent with this
// quiz pre-attached. Deliberately NOT importing from user-quizzes-view.js
// for the home-page system prompt/tools config (that file already imports
// createUserQuizCard FROM this one — importing back would be circular);
// this button opens the same "home" pageKey with a minimal, safe config
// instead (no tools — the live folder-tree context those tools need is
// built and owned by user-quizzes-view.js, not safely reconstructable
// here), which is enough for the assistant to read/discuss the attached
// quiz. See ai-agent-attach-launcher.js's own top comment for the fuller
// rationale.
import { openAIAgentWithAttachment, resolveUserItemAttachment } from "../../components/ai-agent/ai-agent-attach-launcher.js";
import { downloadLesson } from "./lesson-download.js";
import { withDownloadLoading } from "../../components/download-quiz-modal/export-card.js";
import { openDescriptionSourceModal } from "./description-source-modal.js";
import { appendNotebookMenuEntries, showNotebookDownloadModal } from "./notebook-actions.js";
import { HOME_PAGE_SYSTEM_PROMPT } from "../../components/ai-agent/ai-agent-default-prompts.js";
import { SPARKLE_ICON_SVG } from "./icons.js";

// ─────────────────────────────────────────────────────────────────────────────

export const createUserQuizActions = (quiz) => ({
  open: () => playUserQuiz(quiz),
  download: (btn) => showUserQuizDownloadPopup(quiz, btn),
  more: (btn) => showUserQuizActionsOverlay(quiz, btn),
});

export const createUserLessonActions = (lesson) => ({
  open: () => playUserLesson(lesson),
  download: (btn) => withDownloadLoading(btn, () => downloadLesson(lesson, btn)),
  more: (btn) => showUserLessonActionsOverlay(lesson, btn),
});

export const createUserNotebookActions = (nb) => ({
  open: () => playUserNotebook(nb),
  download: (btn) => showNotebookDownloadModal(nb, btn),
  more: (btn) => showUserNotebookActionsOverlay(nb, btn),
});

export function showUserNotebookActionsOverlay(nb, triggerBtn) {
  const nbId = nb.id || nb.meta?.id;
  const title = nb.meta?.title || "دفتر بدون عنوان";
  openItemDropdownMenu(triggerBtn, (menu, closeMenu, reposition) => {
    if (isAdminAuthenticated() || hasAdminSessionHint()) {
      const uploadBtn = createNotebookUploadButton(nb);
      uploadBtn.addEventListener("click", () => closeMenu());
      menu.appendChild(uploadBtn);
    }
    appendSelectOption(menu, closeMenu, nbId);
    appendEditGroup(menu, closeMenu, reposition, [
      { label: "تغيير العنوان", icon: RENAME_ICON_SVG, onClick: () => renameItem(nbId, title) },
      {
        label: "الوصف والمصدر",
        icon: EDIT_ICON_SVG,
        onClick: () =>
          openDescriptionSourceModal({
            title,
            description: nb.meta?.description || "",
            source: nb.meta?.source || "",
            onSave: ({ description, source }) => saveLocalItemMetadata(nbId, description, source),
          }),
      },
      {
        label: "تعديل الدفتر",
        icon: EDIT_ICON_SVG,
        onClick: () => { window.location.href = `/notebook/edit/${encodeURIComponent(nbId)}`; },
      },

    ]);
    appendMoveGroup(menu, closeMenu, reposition, nbId);
    appendNotebookMenuEntries(menu, closeMenu, reposition, nb);
    const deleteOpt = document.createElement("button");
    deleteOpt.type = "button";
    deleteOpt.className = "exam-action-btn exam-action-btn--danger";
    deleteOpt.innerHTML = `${TRASH_ICON_SVG}<span>حذف الدفتر</span>`;
    deleteOpt.onclick = (e) => {
      e.stopPropagation();
      closeMenu();
      deleteFolder(nbId);
    };
    menu.appendChild(deleteOpt);
  });
}

export function playUserNotebook(nb) {
  const nbId = nb.id || nb.meta?.id;
  try {
    window.location.href = `/notebook/${encodeURIComponent(nbId)}?type=user`;
  } catch (error) {
    console.error("Error opening user notebook:", error);
    _alert("حدث خطأ أثناء فتح الدفتر. حاول مرة أخرى.");
  }
}

/**
 * Action Overlay for workspace lessons — the lesson twin of
 * showUserQuizActionsOverlay below, built from the same .item-dropdown-menu /
 * .exam-action-btn classes so the two menus are visually identical.
 *
 * Every action reuses a type-generic helper rather than a lesson-specific
 * copy: renameItem / openMoveToDialog / deleteFolder all operate on any
 * user_quizzes row by id (deleteFolder is named for folders but its
 * confirm/trash/cascade/refresh path is fully item-generic — see its doc
 * comment). Admin uploads use the same placement wizard as folder contents,
 * while download formats stay on the lesson card's download button.
 */
export function showUserLessonActionsOverlay(lesson, triggerBtn) {
  const lessonId = lesson.id || lesson.meta?.id;
  const title = lesson.meta?.title || "درس بدون عنوان";

  openItemDropdownMenu(triggerBtn, (menu, closeMenu, reposition) => {
    if (isAdminAuthenticated() || hasAdminSessionHint()) {
      const uploadBtn = createLessonUploadButton(lesson);
      uploadBtn.addEventListener("click", () => closeMenu());
      menu.appendChild(uploadBtn);
    }

    appendSelectOption(menu, closeMenu, lessonId);

    appendEditGroup(menu, closeMenu, reposition, [
      { label: "تغيير العنوان", icon: RENAME_ICON_SVG, onClick: () => renameItem(lessonId, title) },
      {
        label: "الوصف والمصدر",
        icon: EDIT_ICON_SVG,
        onClick: () =>
          openDescriptionSourceModal({
            title,
            description: lesson.meta?.description || lesson.description || "",
            source: lesson.meta?.source || lesson.source || "",
            onSave: ({ description, source }) => saveLocalItemMetadata(lessonId, description, source),
          }),
      },
      {
        label: "تعديل الدرس",
        icon: EDIT_ICON_SVG,
        onClick: () => { window.location.href = `/create-lesson?edit=${encodeURIComponent(lessonId)}`; },
      },
    ]);

    // ── "معلومات الدرس" submenu — same quick-rows-then-"كل المعلومات"
    // pattern as the quiz menu, but the rows come from collectLessonInfo()
    // (sections/questions/dates), not quiz fields. The full dialog is the
    // lesson-specific modal, never the quiz one.
    const info = collectLessonInfo(lesson);
    const basicRows = [
      { label: "ID", val: info.id, multiline: true, copyable: true, ltr: true },
      { label: "الأقسام", val: info.sectionCount || null },
      { label: "الأسئلة المدمجة", val: info.questionCount || null },
      { label: "التاريخ", val: formatDateForInfo(info.createdAt), ltr: true },
    ].filter((r) => r.val);
    menu.appendChild(
      createExamInfoSubmenu(
        basicRows,
        () => showUserLessonInfoModal(lesson),
        closeMenu,
        reposition,
        "معلومات الدرس",
      ),
    );

    appendMoveGroup(menu, closeMenu, reposition, lessonId);

    const askAiOpt = document.createElement("button");
    askAiOpt.type = "button";
    askAiOpt.className = "exam-action-btn";
    askAiOpt.innerHTML = `${SPARKLE_ICON_SVG}<span>اسأل الباشـمبصمج</span>`;
    askAiOpt.onclick = (e) => {
      e.stopPropagation();
      closeMenu();
      const attachment = resolveUserItemAttachment(lessonId);
      if (attachment) {
        openAIAgentWithAttachment(attachment, { defaultSystemPrompt: HOME_PAGE_SYSTEM_PROMPT });
      }
    };
    menu.appendChild(askAiOpt);

    const deleteOpt = document.createElement("button");
    deleteOpt.type = "button";
    deleteOpt.className = "exam-action-btn exam-action-btn--danger";
    deleteOpt.innerHTML = `${TRASH_ICON_SVG}<span>حذف الدرس</span>`;
    deleteOpt.onclick = (e) => {
      e.stopPropagation();
      closeMenu();
      deleteFolder(lessonId);
    };
    menu.appendChild(deleteOpt);
  });
}

export function playUserLesson(lesson) {
  const lessonId = lesson.id || lesson.meta?.id;
  try {
    sessionStorage.setItem("active_user_lesson", JSON.stringify(lesson));
    window.location.href = `/lesson/${encodeURIComponent(lessonId)}?type=user`;
  } catch (error) {
    console.error("Error opening user lesson:", error);
    _alert("حدث خطأ أثناء فتح الدرس. حاول مرة أخرى.");
  }
}

/**
 * Play a user-created quiz
 */
export function playUserQuiz(quiz) {
  try {
    // Store the quiz data temporarily for the quiz page to access
    sessionStorage.setItem("active_user_quiz", JSON.stringify(quiz));

    // Navigate to quiz page with special parameter
    const mode = userProfile.getDefaultQuizMode();
    window.location.href = `/quiz/${encodeURIComponent(quiz.id)}?type=user`;
  } catch (error) {
    console.error("Error playing user quiz:", error);
    _alert("حدث خطأ أثناء بدء الامتحان. حاول مرة أخرى.");
  }
}

/**
 * Delete a user-created quiz — soft delete into the local trash (see
 * user-quizzes-trash.js and plan §4) rather than discarding it outright. */
export async function deleteUserQuiz(quizId) {
  try {
    if (!(await _confirm("سيُنقل هذا الامتحان إلى سلة المهملات. هل تريد المتابعة؟"))) {
      return;
    }

    const userQuizzes = JSON.parse(getFromStorage("user_quizzes", "[]"));
    const target = userQuizzes.find((q) => q.id === quizId);
    if (!target) return;

    const filteredQuizzes = userQuizzes.filter((q) => q.id !== quizId);
    moveToTrash([target], qz(target, "title") || target.meta?.title || "امتحان بلا اسم");
    setInStorage("user_quizzes", JSON.stringify(filteredQuizzes));

    // Re-render the folder view
    renderRootCategories();
    renderUserQuizzesView();
    refreshUserQuizzesCard();

    showNotification("تم النقل إلى السلة", "تم نقل الامتحان إلى سلة المهملات بنجاح", "./favicon.png");
  } catch (error) {
    console.error("Error deleting quiz:", error);
    _alert("Error deleting quiz. Please try again.");
  }
}

/**
 * Action Overlay for user-made quizzes — styled identically to
 * showExamActionsOverlay (same .item-dropdown-menu/.exam-action-btn
 * classes), but with only the options that make sense for a locally-stored,
 * non-shareable quiz: edit, info, and delete. No copy-link/share here since
 * user quizzes aren't shareable (they live in localStorage, not on a
 * server), and Download already has its own dedicated button on the card.
 */
export function showUserQuizActionsOverlay(quiz, triggerBtn) {
  openItemDropdownMenu(triggerBtn, (menu, closeMenu, reposition) => {
    // Admin upload — only rendered for authenticated admins. Shown inside
    // the dropdown on ALL screen sizes (desktop and mobile) now, styled
    // identically to Edit/Delete via createUploadButton()'s own
    // .exam-action-btn class — no wrapper div needed.
    if (isAdminAuthenticated() || hasAdminSessionHint()) {
      const uploadBtn = createUploadButton(quiz);
      uploadBtn.addEventListener("click", () => closeMenu());
      menu.appendChild(uploadBtn);
    }

    // ── Mobile-only Download button ───────────────────────────────────────
    // Mirrors showExamActionsOverlay's mobile download option. Hidden on
    // desktop (≥641px) via the .mobile-only class — the card's own
    // desktop-download-btn handles that form factor.
    const userQuizPwd = qz(quiz, "password");
    const downloadOpt = document.createElement("button");
    downloadOpt.type = "button";
    downloadOpt.className = userQuizPwd
      ? "exam-action-btn mobile-only exam-action-btn--primary is-password-protected"
      : "exam-action-btn mobile-only exam-action-btn--primary";
    downloadOpt.innerHTML = userQuizPwd
      ? `${LOCK_ICON_SVG}<span>تحميل</span>`
      : `${DOWNLOAD_ICON_SVG}<span>تحميل</span>`;
    if (userQuizPwd) downloadOpt.title = "هذا الامتحان محمي بكلمة مرور";
    downloadOpt.onclick = (e) => {
      e.stopPropagation();
      closeMenu();
      showUserQuizDownloadPopup(quiz);
    };
    menu.appendChild(downloadOpt);

    appendSelectOption(menu, closeMenu, quiz.id || quiz.meta?.id);

    // ── Edit group — تعديل الامتحان / الوصف والمصدر / تغيير العنوان in one
    // submenu (this menu is the single entry-point for editing; the card has
    // no standalone edit icon).
    appendEditGroup(menu, closeMenu, reposition, [
      { label: "تغيير العنوان", icon: RENAME_ICON_SVG, onClick: () => renameItem(quiz.id || quiz.meta?.id, qz(quiz, "title")) },
      {
        label: "الوصف والمصدر",
        icon: EDIT_ICON_SVG,
        onClick: () =>
          openDescriptionSourceModal({
            title: qz(quiz, "title") || "الامتحان",
            description: qz(quiz, "description") || "",
            source: qz(quiz, "source") || "",
            onSave: ({ description, source }) => saveLocalItemMetadata(quiz.id || quiz.meta?.id, description, source),
          }),
      },
      {
        label: "تعديل الامتحان",
        icon: EDIT_ICON_SVG,
        onClick: () => { window.location.href = `create-quiz?edit=${encodeURIComponent(quiz.id)}`; },
      },
    ]);

    // ── "معلومات الامتحان" submenu — user quizzes carry everything already
    // in localStorage (quiz.meta/quiz.stats), so the preview builds
    // synchronously straight from qz(). Shows only id, description,
    // category, date, and source (المصدر is copy-to-clipboard).
    const basicRows = [
      { label: "ID", val: quiz.id, multiline: true, copyable: true, ltr: true },
      { label: "المادة", val: qz(quiz, "category") || null, multiline: true },
      { label: "الوصف", val: qz(quiz, "description") || null, multiline: true },
      { label: "التاريخ", val: formatDateForInfo(qz(quiz, "createdAt")), ltr: true },
      {
        label: "المصدر",
        val: normalizeSource(qz(quiz, "source")),
        multiline: true,
        copyable: true,
      },
    ].filter((r) => r.val);
    const infoSubmenu = createExamInfoSubmenu(
      basicRows,
      () => showUserQuizInfoModal(quiz),
      closeMenu,
      reposition,
    );
    menu.appendChild(infoSubmenu);

    // ── Move group — نقل إلى / نقل إلى الخارج (touch-friendly fallback for
    // drag-and-drop).
    appendMoveGroup(menu, closeMenu, reposition, quiz.id || quiz.meta?.id);

    // ── PHASE 2: "اسأل الباشـمبصمج" — opens the AI Agent with this
    // quiz/folder/course pre-attached (see ai-agent-attach-launcher.js's
    // own doc comment for the full rationale on why this is a minimal,
    // tool-free "home" pageKey chat rather than reusing
    // user-quizzes-view.js's own live tool config directly).
    const askAiOpt = document.createElement("button");
    askAiOpt.type = "button";
    askAiOpt.className = "exam-action-btn";
    askAiOpt.innerHTML = `${SPARKLE_ICON_SVG}<span>اسأل الباشـمبصمج</span>`;
    askAiOpt.onclick = (e) => {
      e.stopPropagation();
      closeMenu();
      const itemId = qz(quiz, "id") || quiz.id || quiz.meta?.id;
      const attachment = resolveUserItemAttachment(itemId);
      if (attachment) {
        openAIAgentWithAttachment(attachment, {
          defaultSystemPrompt: HOME_PAGE_SYSTEM_PROMPT,
        });
      }
    };
    menu.appendChild(askAiOpt);

    const deleteOpt = document.createElement("button");
    deleteOpt.type = "button";
    deleteOpt.className = "exam-action-btn exam-action-btn--danger";
    deleteOpt.innerHTML = `${TRASH_ICON_SVG}<span>حذف الامتحان</span>`;
    deleteOpt.onclick = (e) => {
      e.stopPropagation();
      closeMenu();
      deleteUserQuiz(quiz.id);
    };
    menu.appendChild(deleteOpt);
  });
}

export function saveLocalItemMetadata(itemId, description, source) {
  const items = JSON.parse(getFromStorage("user_quizzes", "[]"));
  const item = items.find((row) => (row.id || row.meta?.id) === itemId);
  if (!item) throw new Error("لم يتم العثور على العنصر في «محتواي».");
  item.meta = { ...(item.meta || {}), description, source, updatedAt: new Date().toISOString() };
  if (!setInStorage("user_quizzes", JSON.stringify(items))) {
    throw new Error("تعذّر حفظ التغييرات في التخزين المحلي.");
  }
  renderRootCategories();
  renderUserQuizzesView();
  return true;
}


// ── Shared ⋮ menu groups ────────────────────────────────────────────────────
// Related actions are collapsed into submenus so the dropdown stays short.
// Used by both the quiz and lesson menus so they can never drift apart.

function appendSelectOption(menu, closeMenu, itemId) {
  const selectOpt = document.createElement("button");
  selectOpt.type = "button";
  selectOpt.className = "exam-action-btn";
  selectOpt.innerHTML = `${CHECK_SQUARE_SVG}<span>تحديد</span>`;
  selectOpt.onclick = (e) => {
    e.stopPropagation();
    closeMenu();
    selectItem(itemId);
  };
  menu.appendChild(selectOpt);
}

function appendEditGroup(menu, closeMenu, reposition, actions) {
  menu.appendChild(createActionGroupSubmenu(actions, closeMenu, reposition, "تعديل", EDIT_ICON_SVG));
}

function appendMoveGroup(menu, closeMenu, reposition, itemId) {
  const actions = [{ label: "نقل إلى", icon: MOVE_TO_ICON_SVG, onClick: () => openMoveToDialog([itemId]) }];
  if (currentFolderId !== null) {
    actions.push({ label: "نقل إلى الخارج", icon: MOVE_TO_ICON_SVG, onClick: () => moveItemOutOfFolder(itemId) });
  }
  menu.appendChild(createActionGroupSubmenu(actions, closeMenu, reposition, "نقل", MOVE_TO_ICON_SVG));
}

const CHECK_SQUARE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>`;
