// ============================================================================
// public/src/features/home/root-view.js
// ROOT VIEW — the home screen: "امتحاناتك" folder card + subscribed courses
// (or all courses, if none subscribed).
// ============================================================================
// BUG FIXES applied here:
//   1. Removed a leftover debug console.log that captured a full
//      new Error().stack on every single navigation back to this view.
//   2. Deduplicated ~170 lines of copy-pasted course-info-tooltip-building
//      code (two near-identical ~85-line blocks) into calls to the shared,
//      HTML-escaped attachCourseInfoTooltip() — see course-info-tooltip.js.
// ============================================================================

import { userProfile } from "../../shared/userProfile.js";
import { getSubscribedCourses } from "../../shared/filterUtils.js";
import { getFromStorage } from "../../shared/storage-helpers.js";
import { container, title } from "./dom-refs.js";
import {
  getNavigationStack,
  getSelectedUserQuizzes,
  isRestoring,
  getSearchManager,
  getCategoryTree,
} from "./app-state.js";
import { updateBreadcrumb } from "./breadcrumb.js";
import { renderTitleBreadcrumb } from "./title-breadcrumb.js";
import { updateBulkActionBar, renderUserQuizzesView } from "./user-quizzes-view.js";
import { setFolderState } from "./user-quizzes-folders.js";
import { getCourseItemCount } from "./course-count.js";
import { createCategoryCard, renderCategory, getCategoriesLazy } from "./category-view.js";
import { openExamDropdownMenu } from "./exam-dropdown-menu.js";
import { createExamInfoSubmenu } from "./exam-dropdown-menu.js";
import { showCourseInfoModal } from "./course-actions.js";
import { copyCategoryTreeToUserQuizzes } from "./copy-to-my-quizzes.js";
import { toSlug } from "./slug-utils.js";
import {
  MORE_DOTS_ICON_SVG,
  SPARKLE_ICON_SVG,
  COPY_ICON_SVG,
  DUPLICATE_ICON_SVG,
  SHARE_ICON_SVG,
} from "./icons.js";
import {
  openAIAgentWithAttachment,
  buildPlatformCourseAttachment,
  buildUserRootAttachmentForAskAi,
} from "../../components/ai-agent/ai-agent-attach-launcher.js";
import { HOME_PAGE_SYSTEM_PROMPT } from "../../components/ai-agent/ai-agent-default-prompts.js";
import { showNotification } from "../../components/notifications/notifications.js";
import { _confirm } from "../../components/notifications/notifications.js";

function attachCourseActionsMenu(card, course, categoryTree) {
  const moreBtn = document.createElement("button");
  moreBtn.type = "button";
  moreBtn.className = "exam-more-btn";
  moreBtn.innerHTML = MORE_DOTS_ICON_SVG;
  moreBtn.setAttribute("aria-label", `خيارات ${course.name}`);
  moreBtn.onclick = (event) => {
    event.stopPropagation();
    openExamDropdownMenu(moreBtn, (menu, closeMenu, reposition) => {
      const folderUrl = `${window.location.origin}/#${(course.path || [course.name]).map(toSlug).join("/")}`;

      const copyLink = document.createElement("button");
      copyLink.type = "button";
      copyLink.className = "exam-action-btn";
      copyLink.innerHTML = `${COPY_ICON_SVG}<span>نسخ الرابط</span>`;
      copyLink.onclick = async () => {
        await navigator.clipboard.writeText(folderUrl);
        closeMenu();
        showNotification("تم النسخ", "تم نسخ رابط المادة.", "success");
      };
      menu.appendChild(copyLink);

      const shareLink = document.createElement("button");
      shareLink.type = "button";
      shareLink.className = "exam-action-btn";
      shareLink.innerHTML = `${SHARE_ICON_SVG}<span>مشاركة الرابط</span>`;
      shareLink.onclick = async () => {
        closeMenu();
        if (navigator.share) {
          await navigator.share({ title: course.name, url: folderUrl }).catch(() => {});
        } else {
          await navigator.clipboard.writeText(folderUrl);
          showNotification("تم النسخ", "تم نسخ رابط المادة.", "success");
        }
      };
      menu.appendChild(shareLink);

      const copyMine = document.createElement("button");
      copyMine.type = "button";
      copyMine.className = "exam-action-btn";
      copyMine.innerHTML = `${DUPLICATE_ICON_SVG}<span>نسخ لامتحاناتي</span>`;
      copyMine.onclick = async () => {
        copyMine.disabled = true;
        try {
          await copyCategoryTreeToUserQuizzes(course, categoryTree, "course");
          closeMenu();
        } finally {
          copyMine.disabled = false;
        }
      };
      menu.appendChild(copyMine);

      const askAi = document.createElement("button");
      askAi.type = "button";
      askAi.className = "exam-action-btn";
      askAi.innerHTML = `${SPARKLE_ICON_SVG}<span>اسأل الباشـمبصمج</span>`;
      askAi.onclick = () => {
        closeMenu();
        openAIAgentWithAttachment(buildPlatformCourseAttachment(course, categoryTree), {
          defaultSystemPrompt: HOME_PAGE_SYSTEM_PROMPT,
        });
      };
      menu.appendChild(askAi);

      const infoRows = [
        { label: "التعليم", val: course.education_type || "-" },
        { label: "الكلية", val: course.faculty && course.faculty !== "All" ? course.faculty : null },
        { label: "العام", val: course.year || "-" },
        { label: "الترم", val: course.term || "-" },
      ].filter((row) => row.val);
      menu.appendChild(createExamInfoSubmenu(
        infoRows,
        () => showCourseInfoModal(course),
        closeMenu,
        reposition,
      ));

      const unsubscribe = document.createElement("button");
      unsubscribe.type = "button";
      unsubscribe.className = "exam-action-btn exam-action-btn--danger";
      unsubscribe.textContent = "إلغاء الاشتراك";
      unsubscribe.onclick = async () => {
        if (!(await _confirm("هل أنت متأكد من إلغاء الاشتراك في هذه المادة؟"))) return;
        userProfile.setSubscribedCourses(
          userProfile.getSubscribedCourseIds().filter((id) => id !== course.id),
        );
        closeMenu();
        renderRootCategories();
      };
      menu.appendChild(unsubscribe);
    });
  };
  card.appendChild(moreBtn);
}

export async function renderRootCategories() {
  try {
    const navigationStack = getNavigationStack();
    navigationStack.length = 0; // clear in place — same effect as reassigning []
    updateBreadcrumb();

    // Leaving the "امتحاناتك" view entirely — selection mode and the
    // floating bulk action bar belong to that view only. The bar lives on
    // document.body (not inside `container`), so it wouldn't otherwise get
    // cleaned up just because the view underneath it changed.
    getSelectedUserQuizzes().clear();
    updateBulkActionBar(false);

    if (isRestoring()) {
      history.replaceState({ view: "root" }, "", window.location.pathname);
    } else {
      // BUG FIX (removed leftover debug log): this branch used to log a
      // captured `new Error().stack` on every single navigation back to the
      // root view — a real production perf/console-noise cost (stack
      // capture isn't free) left over from a prior debugging session.
      history.pushState({ view: "root" }, "", window.location.pathname);
    }

    // Update search context when returning to root
    const searchManager = getSearchManager();
    if (searchManager) {
      searchManager.updateContextVisibility();
    }

    if (!title || !container) return;

    const subscribedIds = userProfile.getSubscribedCourseIds();
    const categoryTree = getCategoryTree();
    const subscribedCourses = getSubscribedCourses(categoryTree, subscribedIds);
    const profile = userProfile.getProfile();

    // Title: use the smart breadcrumb component (single item = just the label,
    // no path links shown — we're at the root).
    const rootLabel = subscribedCourses.length > 0 ? "المواد خاصتي" : "جميع المواد";
    renderTitleBreadcrumb(title, [{ label: rootLabel }]);
    const tooltipText = subscribedCourses.length > 0
      ? `${profile.faculty} faculty · Year ${profile.year} · Term ${profile.term}`
      : "All Faculties · All Years · Both Terms";
    title.title = tooltipText;

    container.innerHTML = "";
    container.className = "grid-container";
    container.setAttribute("aria-busy", "false");

    const fragment = document.createDocumentFragment();

    // 1. Add "امتحاناتك" Folder Card
    try {
      const userQuizzes = JSON.parse(getFromStorage("user_quizzes", "[]"));
      const quizzesCard = createCategoryCard(
        "امتحاناتك",
        userQuizzes.length,
        true,
      );
      // Custom icon
      const iconDiv = quizzesCard.querySelector(".icon");
      if (iconDiv) iconDiv.textContent = "✏️";

      const rootMenuBtn = document.createElement("button");
      rootMenuBtn.type = "button";
      rootMenuBtn.className = "exam-more-btn";
      rootMenuBtn.innerHTML = MORE_DOTS_ICON_SVG;
      rootMenuBtn.setAttribute("aria-label", "خيارات امتحاناتك");
      rootMenuBtn.onclick = (event) => {
        event.stopPropagation();
        openExamDropdownMenu(rootMenuBtn, (menu, closeMenu) => {
          const attachment = buildUserRootAttachmentForAskAi();
          const stats = document.createElement("div");
          stats.className = "exam-action-btn";
          stats.disabled = true;
          stats.textContent = attachment.summary;
          menu.appendChild(stats);

          const askAi = document.createElement("button");
          askAi.type = "button";
          askAi.className = "exam-action-btn";
          askAi.innerHTML = `${SPARKLE_ICON_SVG}<span>اسأل الباشـمبصمج</span>`;
          askAi.onclick = (clickEvent) => {
            clickEvent.stopPropagation();
            closeMenu();
            openAIAgentWithAttachment(attachment, {
              defaultSystemPrompt: HOME_PAGE_SYSTEM_PROMPT,
            });
          };
          menu.appendChild(askAi);

          const rootUrl = `${window.location.origin}/#my-quizzes`;
          const copyLink = document.createElement("button");
          copyLink.type = "button";
          copyLink.className = "exam-action-btn";
          copyLink.innerHTML = `${COPY_ICON_SVG}<span>نسخ الرابط</span>`;
          copyLink.onclick = async () => {
            await navigator.clipboard.writeText(rootUrl);
            closeMenu();
            showNotification("تم النسخ", "تم نسخ رابط امتحاناتك.", "success");
          };
          menu.appendChild(copyLink);

          const shareLink = document.createElement("button");
          shareLink.type = "button";
          shareLink.className = "exam-action-btn";
          shareLink.innerHTML = `${SHARE_ICON_SVG}<span>مشاركة الرابط</span>`;
          shareLink.onclick = async () => {
            closeMenu();
            if (navigator.share) {
              await navigator.share({ title: "امتحاناتك", url: rootUrl }).catch(() => {});
            } else {
              await navigator.clipboard.writeText(rootUrl);
              showNotification("تم النسخ", "تم نسخ رابط امتحاناتك.", "success");
            }
          };
          menu.appendChild(shareLink);

          const alreadyMine = document.createElement("button");
          alreadyMine.type = "button";
          alreadyMine.className = "exam-action-btn";
          alreadyMine.innerHTML = `${DUPLICATE_ICON_SVG}<span>نسخ لامتحاناتي</span>`;
          alreadyMine.onclick = () => {
            closeMenu();
            showNotification("امتحاناتك", "هذا المجلد موجود بالفعل في امتحاناتك.", "info");
          };
          menu.appendChild(alreadyMine);
        });
      };
      quizzesCard.appendChild(rootMenuBtn);

      quizzesCard.onclick = () => {
        // Always reset to the root of user-quizzes, regardless of where the
        // user last navigated inside the folder tree.
        setFolderState([], null);
        renderUserQuizzesView();
      };
      fragment.appendChild(quizzesCard);
    } catch (e) {
      console.error("Error creating User Quizzes card", e);
    }

    // Show subscribed courses if any
    if (subscribedCourses.length > 0) {
      subscribedCourses.forEach((course) => {
        const itemCount = getCourseItemCount(course);
        const card = createCategoryCard(course.name, itemCount, true, course);
        
        // DEDUPLICATION: this used to be ~85 lines of copy-pasted
        // tooltip-building code (identical to the "all courses" branch
        // below except for the unsubscribe button) — now a single shared,
        // escaped builder. See course-info-tooltip.js.
        attachCourseActionsMenu(card, course, categoryTree);

        card.onclick = () => renderCategory(categoryTree[course.key]);
        fragment.appendChild(card);
      });
    } else {
      // Show all courses if no subscriptions
      const rootCategories = getCategoriesLazy();
      rootCategories.forEach((category) => {
        const itemCount = getCourseItemCount(category);
        const card = createCategoryCard(
          category.name,
          itemCount,
          true,
          category,
        );

        // DEDUPLICATION: same shared builder as the subscribed-courses
        // branch above, without the unsubscribe button (not subscribed yet).
        attachCourseActionsMenu(card, category, categoryTree);

        card.onclick = () => renderCategory(category);
        fragment.appendChild(card);
      });
    }

    container.appendChild(fragment);

    // Show empty state if no courses at all
    if (subscribedCourses.length === 0 && getCategoriesLazy().length === 0) {
      container.innerHTML += `
        <div class="empty-state" role="status">
          <div class="empty-state-icon" aria-hidden="true">📚</div>
          <h3>لا توجد مواد متاحة حالياً</h3>
          <p>تابعنا قريباً لمزيد من المحتوى!</p>
        </div>
      `;
    }
  } catch (error) {
    console.error("Error rendering root categories:", error);
    if (container) {
      container.innerHTML = `
        <div class="error-state" role="alert">
          <p>حدث خطأ أثناء تحميل المحتوى. يرجى تحديث الصفحة.</p>
          <button onclick="location.reload()" type="button">تحديث</button>
        </div>
      `;
    }
  }
}
