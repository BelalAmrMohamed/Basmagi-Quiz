// ============================================================================
// public/src/features/home/user-quizzes-view.js
// USER QUIZZES VIEW — the "إمتحاناتك" (My Quizzes) screen: card grid,
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
import { openSignInDialog } from "../../components/log-in/sign-in.js";
import { container, title } from "./dom-refs.js";
import {
  getSearchManager,
  getNavigationStack,
  isRestoring,
  getIndexSupabaseClient,
  getSelectedUserQuizzes,
} from "./app-state.js";
import { updateBreadcrumb } from "./breadcrumb.js";
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
      "لم يتمكن البشــمبصمج من إنشاء الامتحان: لا توجد أسئلة صالحة.",
      "warning",
      10,
    );
    const err = new Error("create_quiz tool call had no questions");
    err.userMessage = "تعذر إنشاء الإمتحان: لا توجد أسئلة صالحة.";
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
    'تم إنشاء الإمتحان وإضافته إلى "إمتحاناتك"',
    "success",
  );
  renderRootCategories();
  renderUserQuizzesView();
  return `✅ تم إنشاء الإمتحان: ${title}`;
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
    err.userMessage = "تعذر تعديل الإمتحان: لم يتم تحديد الامتحان المطلوب تعديله.";
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

  showNotification("تم التعديل", `تم تعديل الإمتحان "${newTitle}"`, "success");
  renderRootCategories();
  renderUserQuizzesView();
  return `✅ تم تعديل الإمتحان: ${newTitle}`;
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
    err.userMessage = "تعذر حذف الإمتحان: لم يتم تحديد اسم الامتحان.";
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

  showNotification("تم الحذف", `تم حذف الإمتحان "${title}"`, "success");
  renderRootCategories();
  renderUserQuizzesView();
  return `🗑️ تم حذف الإمتحان: ${title}`;
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
    // bulk delete) pushes a second "إمتحاناتك" frame, making the breadcrumb
    // read navigationStack[length - 2] (undefined) instead of the actual
    // parent, which broke both its label and its onclick handler.
    const navigationStack = getNavigationStack();
    const topOfStack = navigationStack[navigationStack.length - 1];
    if (!topOfStack || topOfStack.name !== "إمتحاناتك") {
      navigationStack.push({ name: "إمتحاناتك" });
    }
    updateBreadcrumb();

    if (!isRestoring()) {
      history.pushState({ view: "my-quizzes" }, "", "#my-quizzes");
    } else {
      history.replaceState({ view: "my-quizzes" }, "", "#my-quizzes");
    }

    // Update Title & Clear Container
    if (title) title.textContent = "إمتحاناتك";
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

    if (isAdminAuthenticated()) {
      const adminSignOutBtn = document.createElement("button");
      adminSignOutBtn.type = "button";
      adminSignOutBtn.innerHTML = `<span>تسجيل الخروج</span> ${ADMIN_SIGN_OUT_ICON_SVG}`;
      adminSignOutBtn.className = "btn admin-log-out-btn";
      adminSignOutBtn.setAttribute("aria-label", "تسجيل خروج المشرف");
      adminSignOutBtn.onclick = async () => {
        adminSignOutBtn.disabled = true;
        await fullSignOut(getIndexSupabaseClient());
        window.location.reload();
      };
      actionsBar.appendChild(adminSignOutBtn);
    } else {
      const adminSignInBtn = document.createElement("button");
      adminSignInBtn.type = "button";
      adminSignInBtn.innerHTML = `<span>دخول المشرفين</span> ${ADMIN_SIGN_IN_ICON_SVG}`;
      adminSignInBtn.className = "btn admin-log-in-btn";
      adminSignInBtn.setAttribute("aria-label", "لوحة دخول المشرفين");
      // Opens the sign-in dialog directly — no full-page navigation.
      adminSignInBtn.onclick = () => openSignInDialog();
      actionsBar.appendChild(adminSignInBtn);
    }

    // Selection mode only makes sense when there's actually something to
    // select — hide the toggle entirely for an empty quiz list.
    if (userQuizzes.length > 0) {
      const toggleSelectionBtn = document.createElement("button");
      toggleSelectionBtn.type = "button";
      toggleSelectionBtn.className = "btn selection-toggle-btn";
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

    // Drag-and-drop JSON import on the whole إمتحاناتك section
    wireJsonFileDropZone(container, (files) => importJsonQuizFiles(files), {
      isEnabled: () => container.classList.contains("user-quizzes-drop-zone"),
    });

    // 2. Dedicated container for quiz cards — gets its own border/border-radius
    //    so the sign-in button and create card sit outside the bordered list.
    const quizzesContainer = document.createElement("div");
    quizzesContainer.className = "user-quizzes-container";

    // 3. Quiz cards (or empty state) go into quizzesContainer, not container
    if (userQuizzes.length === 0) {
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
        <h3 style="margin-bottom: 10px;">لم تقم بإنشاء أي اختبارات حتى الآن</h3>
        <p style="color: var(--color-text-secondary);">انقر على الزر الذي في الأعلى للبدء</p>
      `;
      quizzesContainer.appendChild(emptyState);
    } else {
      userQuizzes.forEach((quiz, index) => {
        const quizCard = createUserQuizCard(quiz, index);
        quizzesContainer.appendChild(quizCard);
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
    const contextSummary = userQuizzes.map((quiz) => ({
      title: qz(quiz, "title"),
      questionCount: qz(quiz, "count"),
      types: qz(quiz, "type"),
    }));

    container.appendChild(
      createAIAgentFab({
        placeholder: "اسأل عن امتحاناتك، أو اطلب شرحًا لأي موضوع...",
        pageKey: "home",
        defaultSystemPrompt: HOME_PAGE_SYSTEM_PROMPT,
        suggestedPrompts: HOME_PAGE_SUGGESTED_PROMPTS,
        enableFileUpload: true,
        contextSummary,
        enableTools: true,
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

  // Disable the destructive/export actions until something is selected.
  const hasSelection = count > 0;
  bar
    .querySelectorAll(".bulk-delete-btn, .bulk-extract-btn, .bulk-upload-btn")
    .forEach((btn) => {
      btn.disabled = !hasSelection;
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
      uploadBtnHtml = `<button class="btn bulk-upload-btn">رفع المحدد ☁️</button>`;
    }

    bar.innerHTML = `
      <div class="bulk-count">لم يتم تحديد أي شيء</div>
      <div class="bulk-actions">
        <button class="btn bulk-select-all-btn">تحديد الكل</button>
        <button class="btn bulk-delete-btn">حذف</button>
        <button class="btn bulk-extract-btn">استخراج</button>
        ${uploadBtnHtml}
      </div>
    `;
    document.body.appendChild(bar);

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
        import("./adminUpload.js").then((mod) => {
          mod.openAdminUploadModal(selected);
        });
      };
    }
  }
  updateBulkActionBar(false);
}