// ============================================================================
// BREADCRUMB — the "الرجوع إلى ..." back-navigation bar shown once the user
// has drilled into at least one category or the My Quizzes view.
// ============================================================================

import { breadcrumb } from "./dom-refs.js";
import { getNavigationStack } from "./app-state.js";
import { renderRootCategories } from "./root-view.js";
import { renderCategory } from "./category-view.js";

export function updateBreadcrumb() {
  if (!breadcrumb) return;

  const navigationStack = getNavigationStack();
  if (navigationStack.length === 0) {
    breadcrumb.classList.remove("show");
    breadcrumb.setAttribute("aria-hidden", "true");
    return;
  }

  breadcrumb.classList.add("show");
  breadcrumb.setAttribute("aria-hidden", "false");
  const breadcrumbText = breadcrumb.querySelector(".breadcrumb-text");

  if (navigationStack.length === 1) {
    breadcrumbText.textContent = "الرجوع إلى المواد ←";
    breadcrumb.onclick = renderRootCategories;
    breadcrumb.setAttribute("aria-label", "الرجوع إلى المواد ←");
  } else {
    const parentName = navigationStack[navigationStack.length - 2].name;
    breadcrumbText.textContent = `الرجوع إلى ${parentName} ←`;
    breadcrumb.onclick = () => {
      navigationStack.pop();
      const parent = navigationStack[navigationStack.length - 1];
      navigationStack.pop();
      renderCategory(parent);
    };
    breadcrumb.setAttribute("aria-label", `الرجوع إلى ${parentName}  ←`);
  }
}
