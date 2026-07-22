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
import { extractTextFromFile, parseImportContent } from "../../shared/quiz-processor.js";
import { isAdminAuthenticated, fullSignOut } from "../../shared/adminAuth.js";
import { openSignInDialog } from "./sign-in.js";
import { container, title } from "./dom-refs.js";
import {
  getSearchManager,
  getNavigationStack,
  isRestoring,
  getIndexSupabaseClient,
  getSelectedUserQuizzes,
} from "./app-state.js";
import { updateBreadcrumb } from "./breadcrumb.js";
import { qz } from "./quiz-schema.js";
import { buildUserQuizEntry } from "./quiz-schema.js";
import { createUserQuizCard } from "./user-quiz-card.js";
import { createInlineCreateQuizCard } from "./create-quiz-modal.js";
import { renderRootCategories } from "./root-view.js";
import {
  ADMIN_SIGN_OUT_ICON_SVG,
  ADMIN_SIGN_IN_ICON_SVG,
  CHECK_SQUARE_ICON_SVG,
} from "./icons.js";
import { showNotification, confirmationNotification } from "../../components/notifications/notifications.js";


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
            const isActive = qzContainer.classList.contains("selection-mode-active");
            toggleSelectionBtn.classList.toggle("active", isActive);
            if (!isActive) {
               selectedUserQuizzes.clear();
               document.querySelectorAll(".user-quiz-select-checkbox").forEach(cb => cb.checked = false);
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

    // Ensure drag-and-drop import is enabled for this section
    setupUserQuizzesDropZone();

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

function setupUserQuizzesDropZone() {
  const dropContainer = document.getElementById("contentArea");
  if (!dropContainer || dropContainer.dataset.userQuizzesDropReady === "1")
    return;

  dropContainer.dataset.userQuizzesDropReady = "1";

  dropContainer.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropContainer.classList.add("user-quizzes-drag-over");
  });

  dropContainer.addEventListener("dragleave", (e) => {
    if (e.target === dropContainer) {
      dropContainer.classList.remove("user-quizzes-drag-over");
    }
  });

  dropContainer.addEventListener("drop", async (e) => {
    e.preventDefault();
    dropContainer.classList.remove("user-quizzes-drag-over");
    const files = Array.from(e.dataTransfer?.files || []);
    if (!files.length) return;
    await handleUserQuizzesDrop(files);
  });
}

// ─── Bulk Action Helpers ────────────────────────────────────────────────────────

function downloadQuizAsJson(quiz) {
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(quiz, null, 2));
  const dlAnchorElem = document.createElement('a');
  dlAnchorElem.setAttribute("href", dataStr);
  const safeTitle = (quiz.meta?.title || quiz.title || "quiz").replace(/[^a-zA-Z0-9\u0600-\u06FF\s-_]/g, "").trim();
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
  bar.querySelectorAll(".bulk-delete-btn, .bulk-extract-btn, .bulk-upload-btn").forEach((btn) => {
    btn.disabled = !hasSelection;
  });

  // Keep the "تحديد الكل" button in sync with whether everything visible
  // is currently selected.
  const selectAllBtn = bar.querySelector(".bulk-select-all-btn");
  if (selectAllBtn) {
    const totalCheckboxes = document.querySelectorAll(".user-quiz-select-checkbox").length;
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
       const allIds = userQuizzes.map(q => qz(q, "id") || q.id);
       const allCurrentlySelected = allIds.length > 0 && allIds.every(id => selectedUserQuizzes.has(id));

       if (allCurrentlySelected) {
          selectedUserQuizzes.clear();
       } else {
          allIds.forEach(id => selectedUserQuizzes.add(id));
       }

       document.querySelectorAll(".user-quiz-select-checkbox").forEach(cb => {
          cb.checked = !allCurrentlySelected;
       });

       updateBulkActionBar();
    };
    
    bar.querySelector(".bulk-delete-btn").onclick = async () => {
       if (selectedUserQuizzes.size === 0) return;
       if (await confirmationNotification("هل أنت متأكد من حذف الاختبارات المحددة؟")) {
          let userQuizzes = JSON.parse(getFromStorage("user_quizzes", "[]"));
          userQuizzes = userQuizzes.filter(q => {
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
       const selected = userQuizzes.filter(q => {
           const qId = qz(q, "id") || q.id;
           return selectedUserQuizzes.has(qId);
       });
       if (selected.length === 0) return;
       const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(selected, null, 2));
       const dlAnchorElem = document.createElement('a');
       dlAnchorElem.setAttribute("href", dataStr);
       dlAnchorElem.setAttribute("download", `my-personal-quizzes__${selected.length}.json`);
       dlAnchorElem.click();
    };
    
    if (isAdminAuthenticated()) {
      bar.querySelector(".bulk-upload-btn").onclick = () => {
         if (selectedUserQuizzes.size === 0) return;
         const userQuizzes = JSON.parse(getFromStorage("user_quizzes", "[]"));
         const selected = userQuizzes.filter(q => selectedUserQuizzes.has(q.id || q.meta?.id));
         import("./adminUpload.js").then(mod => {
            mod.openAdminUploadModal(selected);
         });
      };
    }
  }
  updateBulkActionBar(false);
}

async function handleUserQuizzesDrop(files) {
  const allowedExts = [".txt", ".docx", ".pdf", ".pptx", ".json"];
  const validFiles = [];
  const invalidNames = [];

  files.forEach((file) => {
    const lower = file.name.toLowerCase();
    if (allowedExts.some((ext) => lower.endsWith(ext))) {
      validFiles.push(file);
    } else {
      invalidNames.push(file.name);
    }
  });

  if (invalidNames.length) {
    showNotification(
      "ملفات غير مدعومة",
      `بعض الملفات تم تجاهلها:\n${invalidNames.join(", ")}`,
      "warning",
    );
  }

  if (!validFiles.length) return;

  const existingQuizzes = JSON.parse(getFromStorage("user_quizzes", "[]"));
  let importedCount = 0;

  for (const file of validFiles) {
    let text;
    try {
      text = await extractTextFromFile(file);
    } catch (err) {
      console.error("Import extract error:", err);
      showNotification(
        "خطأ في القراءة",
        `تعذّر قراءة ${file.name}: ${err.message}`,
        "error",
      );
      continue;
    }

    if (file.name.toLowerCase().endsWith(".json")) {
       let parsedJson = null;
       try {
          parsedJson = JSON.parse(text);
       } catch(e) {}
       
       if (Array.isArray(parsedJson) && parsedJson.length > 0 && (parsedJson[0].questions || parsedJson[0].id)) {
           for (const q of parsedJson) {
               if (q.questions) {
                   existingQuizzes.push(q);
                   importedCount++;
               }
           }
           continue; 
       }
    }

    const defaultTitle = file.name
      .replace(/\.(json|txt|pdf|docx|pptx)$/i, "")
      .replace(/[-_]/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());

    let parsed;
    try {
      parsed = parseImportContent(text, defaultTitle);
    } catch (err) {
      console.error("Import parse error:", err);
      showNotification(
        "خطأ في التنسيق",
        `${file.name}: ${err.message}`,
        "error",
      );
      continue;
    }

    if (!parsed.questions || !parsed.questions.length) continue;

    const quizId = crypto.randomUUID();

    existingQuizzes.push(buildUserQuizEntry(quizId, parsed, defaultTitle));
    importedCount++;
  }

  if (importedCount > 0) {
    const quizCountText =
      importedCount === 1
        ? "إمتحان واحد"
        : importedCount === 2
          ? "إمتحانان"
          : importedCount > 2 && importedCount < 11
            ? `${importedCount} إمتحانات`
            : `${importedCount} إمتحان`;

    setInStorage("user_quizzes", JSON.stringify(existingQuizzes));
    showNotification(
      "تم الإنشاء",
      `تم إنشاء ${quizCountText} في "إمتحاناتك"`,
      "success",
    );
    renderRootCategories();
    renderUserQuizzesView();
  }
}
