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
import { attachCourseInfoTooltip } from "./course-info-tooltip.js";
import { createCategoryCard, renderCategory, getCategoriesLazy } from "./category-view.js";

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
        attachCourseInfoTooltip(card, course, {
          withUnsubscribe: true,
          onUnsubscribe: () => renderRootCategories(),
        });

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
        attachCourseInfoTooltip(card, category);

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
