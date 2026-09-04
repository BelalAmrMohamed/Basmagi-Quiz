// ============================================================================
// public/src/features/home/user-quiz-card.js
// USER QUIZ CARD — renders a single locally-stored (user-created) quiz card,
// its ⋮ actions menu, play/delete handlers.
// ============================================================================
//
// SECURITY FIX (stored XSS): createUserQuizCard() previously interpolated
// the user-supplied quiz title into innerHTML with no escaping — a title
// like `<img src=x onerror=...>` typed into the create-quiz modal would
// execute on every render of that card. Fixed below by building the title
// with textContent instead of innerHTML, so it's never parsed as markup.
// ============================================================================

import { qz } from "./quiz-schema.js";
import { formatArabicQuestionCount } from "./course-count.js";
import { getSelectedUserQuizzes } from "./app-state.js";
import { getFromStorage, setInStorage } from "../../shared/storage-helpers.js";
import {
  isAdminAuthenticated,
  hasAdminSessionHint,
} from "../../shared/adminAuth.js";
import { createUploadButton } from "./adminUpload.js";
import { showUserQuizDownloadPopup } from "./download-modal.js";
import { showUserQuizInfoModal, formatDateForInfo } from "./quiz-info-modal.js";
import {
  createExamInfoSubmenu,
  openExamDropdownMenu,
} from "./exam-dropdown-menu.js";
import { renderRootCategories } from "./root-view.js";
import {
  renderUserQuizzesView,
  updateBulkActionBar,
} from "./user-quizzes-view.js";
import { openMoveToDialog } from "./user-quizzes-folders.js";
import { userProfile } from "../../shared/userProfile.js";
import {
  LOCK_ICON_SVG,
  DOWNLOAD_ICON_SVG,
  EDIT_ICON_SVG,
  TRASH_ICON_SVG,
  MORE_DOTS_ICON_SVG,
  MOVE_TO_ICON_SVG,
} from "./icons.js";
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
import { openAIAgentWithAttachment } from "../../components/ai-agent/ai-agent-attach-launcher.js";
import { HOME_PAGE_SYSTEM_PROMPT } from "../../components/ai-agent/ai-agent-default-prompts.js";
import { SPARKLE_ICON_SVG } from "./icons.js";

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a card for a user-created quiz
 */
export function createUserQuizCard(quiz, index) {
  const card = document.createElement("div");
  card.className = "exam-card user-quiz-card";
  card.setAttribute("role", "article");
  card.setAttribute("aria-label", `امتحان: ${qz(quiz, "title")}`);
  card.setAttribute(
    "title",
    `${qz(quiz, "description") ? `Description: ${qz(quiz, "description")}` : `Type: ${qz(quiz, "type")}`}`,
  );
  card.style.position = "relative";

  const quizId = qz(quiz, "id") || quiz.id;

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "user-quiz-select-checkbox";
  checkbox.setAttribute("data-quiz-id", quizId);
  const selectedUserQuizzes = getSelectedUserQuizzes();
  checkbox.checked = selectedUserQuizzes.has(quizId);
  checkbox.onclick = (e) => {
    e.stopPropagation();
    if (checkbox.checked) {
      selectedUserQuizzes.add(quizId);
    } else {
      selectedUserQuizzes.delete(quizId);
    }
    updateBulkActionBar();
  };
  card.appendChild(checkbox);

  const h = document.createElement("h3");
  // SECURITY FIX (stored XSS): quiz.title is free-text the user typed into
  // the create-quiz modal's title input and is persisted to localStorage
  // verbatim. textContent (rather than innerHTML) means it's never parsed
  // as markup, so a title like `<img src=x onerror=...>` can't execute —
  // closes the same stored-XSS gap the original innerHTML interpolation
  // had, just without needing an escaping step at all.
  h.textContent = qz(quiz, "title") || quizId;

  // ── Phone-only leading emoji — sibling of .card-text, not nested inside
  // h3. BUG FIX: the emoji used to live inside <h3>, so on the mobile list
  // row its vertical centering was governed by the title text's line-height
  // instead of the row's own flex alignment — sitting slightly too high
  // compared to course/subfolder cards, which use a dedicated sibling
  // `.icon` element (see createCategoryCard in category-view.js). Kept as
  // `.user-quiz--phone-only-emoji` so the existing mobile CSS still applies.
  const iconEl = document.createElement("span");
  iconEl.className = "user-quiz--phone-only-emoji";
  iconEl.textContent = "👤";
  iconEl.setAttribute("aria-hidden", "true");

  const questionCountLine = document.createElement("p");
  questionCountLine.className = "exam-question-count";
  const count = qz(quiz, "count");
  questionCountLine.textContent = formatArabicQuestionCount(count);

  // ── Play button — mirrors createExamCard's .start-btn ───────────────────
  const playBtn = document.createElement("button");
  playBtn.className = "start-btn";
  playBtn.type = "button";
  playBtn.style.flex = "1";
  playBtn.style.minWidth = "0";
  playBtn.textContent = "إبدأ";
  playBtn.setAttribute("aria-label", `بدء اختبار ${qz(quiz, "title")}`);
  playBtn.onclick = (e) => {
    e.stopPropagation();
    playUserQuiz(quiz);
  };

  // ── Download button — mirrors createExamCard's desktop-download-btn ─────
  const userQuizPassword = qz(quiz, "password");
  const downloadBtn = document.createElement("button");
  downloadBtn.className = userQuizPassword
    ? "start-btn desktop-download-btn is-password-protected"
    : "start-btn desktop-download-btn";
  downloadBtn.type = "button";
  downloadBtn.style.flex = "1";
  downloadBtn.style.minWidth = "0";
  downloadBtn.style.background =
    "linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)";
  downloadBtn.style.color = "white";
  downloadBtn.style.boxShadow = "0 4px 14px rgba(220, 38, 38, 0.4)";
  downloadBtn.innerHTML = userQuizPassword
    ? `${LOCK_ICON_SVG}<span>تحميل</span>`
    : "تحميل";
  downloadBtn.setAttribute(
    "aria-label",
    userQuizPassword
      ? `تحميل اختبار ${qz(quiz, "title")} (محمي بكلمة مرور)`
      : `تحميل اختبار ${qz(quiz, "title")}`,
  );
  if (userQuizPassword) downloadBtn.title = "هذا الامتحان محمي بكلمة مرور";
  downloadBtn.onclick = (e) => {
    e.stopPropagation();
    showUserQuizDownloadPopup(quiz);
  };

  // ── More (⋮) button — opens the Action Overlay ──────────────────────────
  const moreBtn = document.createElement("button");
  moreBtn.className = "exam-more-btn";
  moreBtn.type = "button";
  moreBtn.innerHTML = MORE_DOTS_ICON_SVG;
  moreBtn.setAttribute(
    "aria-label",
    `خيارات إضافية لـ ${qz(quiz, "title") || qz(quiz, "id")}`,
  );
  moreBtn.onclick = (e) => {
    e.stopPropagation();
    showUserQuizActionsOverlay(quiz, moreBtn);
  };

  const btnWrap = document.createElement("div");
  btnWrap.className = "exam-card-actions-wrap";
  btnWrap.appendChild(moreBtn);
  btnWrap.appendChild(playBtn);
  btnWrap.appendChild(downloadBtn);

  // ── Build text wrapper (display:contents on desktop, flex-col on mobile) ──
  const textWrap = document.createElement("div");
  textWrap.className = "card-text";
  textWrap.appendChild(h);

  // Meta wrapper: holds types + count — same role as .exam-card-meta, but
  // keeps the uniquely-designed typesRow chips as a 👤 user-quiz indicator.
  const metaWrap = document.createElement("div");
  metaWrap.className = "exam-card-meta user-quiz-card-meta";

  // ── Question type badges (kept unique to user quizzes) ──────────────────
  const typeStr = qz(quiz, "type");
  if (typeStr) {
    const typesRow = document.createElement("div");
    typesRow.className = "user-quiz-types-row exam-types-subtext";
    typeStr.split(" · ").forEach((t) => {
      const chip = document.createElement("span");
      chip.textContent = t;
      const colorMap = {
        MCQ: "var(--color-primary-light)",
        Essay: "var(--color-success-light)",
        "True/False": "var(--color-warning-light)",
      };
      chip.style.cssText = `
        padding: 2px 10px;
        border-radius: 20px;
        font-size: 0.75rem;
        font-weight: 600;
        background: ${colorMap[t] || "var(--color-border)"};
        color: var(--color-text-primary);
      `;
      typesRow.appendChild(chip);
    });
    metaWrap.appendChild(typesRow);
  }

  metaWrap.appendChild(questionCountLine);
  textWrap.appendChild(metaWrap);

  // DOM order: [icon] [textWrap] [btnWrap] — icon as a sibling of textWrap
  // (not nested in h3) matches createCategoryCard's pattern, same as
  // createExamCard. On desktop: .user-quiz--phone-only-emoji is display:none.
  card.appendChild(iconEl);
  card.appendChild(textWrap);
  card.appendChild(btnWrap);

  // Admin upload button now lives exclusively inside the ⋮ dropdown menu
  // (see showUserQuizActionsOverlay below), on all screen sizes — no
  // top-left card placement anymore.

  return card;
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
    window.location.href = `/q/${encodeURIComponent(quiz.id)}?type=user`;
  } catch (error) {
    console.error("Error playing user quiz:", error);
    _alert("حدث خطأ أثناء بدء الاختبار. حاول مرة أخرى.");
  }
}

/**
 * Delete a user-created quiz
 */
export async function deleteUserQuiz(quizId) {
  try {
    if (!(await _confirm("هل أنت متأكد من مسح الامتحان؟ لا يمكن إسترداده"))) {
      return;
    }

    const userQuizzes = JSON.parse(getFromStorage("user_quizzes", "[]"));
    const filteredQuizzes = userQuizzes.filter((q) => q.id !== quizId);
    setInStorage("user_quizzes", JSON.stringify(filteredQuizzes));

    // Re-render the folder view
    renderRootCategories();
    renderUserQuizzesView();

    showNotification("تم الحذف", "تم حذف الاختبار بنجاح", "./favicon.png");
  } catch (error) {
    console.error("Error deleting quiz:", error);
    _alert("Error deleting quiz. Please try again.");
  }
}

/**
 * Action Overlay for user-made quizzes — styled identically to
 * showExamActionsOverlay (same .exam-dropdown-menu/.exam-action-btn
 * classes), but with only the options that make sense for a locally-stored,
 * non-shareable quiz: edit, info, and delete. No copy-link/share here since
 * user quizzes aren't shareable (they live in localStorage, not on a
 * server), and Download already has its own dedicated button on the card.
 */
export function showUserQuizActionsOverlay(quiz, triggerBtn) {
  openExamDropdownMenu(triggerBtn, (menu, closeMenu, reposition) => {
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

    // ── Edit — present in the menu on all screen sizes (desktop and
    // mobile). There is no standalone edit icon on the card itself — this
    // menu is the single entry-point for editing on both form factors.
    const editOpt = document.createElement("button");
    editOpt.type = "button";
    editOpt.className = "exam-action-btn";
    editOpt.innerHTML = `${EDIT_ICON_SVG}<span>تعديل الامتحان</span>`;
    editOpt.onclick = (e) => {
      e.stopPropagation();
      closeMenu();
      window.location.href = `create-quiz.html?edit=${encodeURIComponent(quiz.id)}`;
    };
    menu.appendChild(editOpt);

    // ── "معلومات الامتحان" submenu — user quizzes carry everything already
    // in localStorage (quiz.meta/quiz.stats), so the preview builds
    // synchronously straight from qz(). Shows only id, description,
    // category, date, and source (المصدر is copy-to-clipboard).
    const basicRows = [
      { label: "ID", val: quiz.id, multiline: true, copyable: true },
      { label: "المادة", val: qz(quiz, "category") || null, multiline: true },
      { label: "الوصف", val: qz(quiz, "description") || null, multiline: true },
      { label: "التاريخ", val: formatDateForInfo(qz(quiz, "createdAt")) },
      {
        label: "المصدر",
        val: qz(quiz, "source") || null,
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

    // ── Move to / out of a folder — the touch-friendly fallback for the
    // drag-and-drop move gesture, since mobile has no usable drag here.
    const moveOpt = document.createElement("button");
    moveOpt.type = "button";
    moveOpt.className = "exam-action-btn";
    moveOpt.innerHTML = `${MOVE_TO_ICON_SVG}<span>نقل إلى</span>`;
    moveOpt.onclick = (e) => {
      e.stopPropagation();
      closeMenu();
      openMoveToDialog([quiz.id || quiz.meta?.id]);
    };
    menu.appendChild(moveOpt);

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