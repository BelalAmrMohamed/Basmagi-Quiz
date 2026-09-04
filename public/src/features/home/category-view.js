// ============================================================================
// public/src/features/home/category-view.js
// CATEGORY VIEW — the drilled-into category screen (subcategory + exam
// cards), the category card builder, and lazy root-category listing.
// ============================================================================
// BUG FIX: removed a dead, commented-out debug setTimeout/console.log block
// left over from a prior debugging session (see renderCategory below).
// ============================================================================

import { toSlug } from "./slug-utils.js";
import { container, title } from "./dom-refs.js";
import {
  getNavigationStack,
  setNavigationStack,
  isRestoring,
  getSearchManager,
  getCategoryTree,
  getCategoriesCache,
  setCategoriesCache,
} from "./app-state.js";
import { updateBreadcrumb } from "./breadcrumb.js";
import { renderTitleBreadcrumb } from "./title-breadcrumb.js";
import { getCourseItemCount } from "./course-count.js";
import { isRecentlyAdded } from "./date-utils.js";
import { getSubjectIcon } from "./subject-icons.js";
import { createExamCard } from "./exam-card.js";

export function getCategoriesLazy() {
  const cached = getCategoriesCache();
  if (cached) return cached;

  const categoryTree = getCategoryTree();
  const computed = Object.values(categoryTree || {})
    .filter((cat) => !cat.parent)
    .sort((a, b) => a.name.localeCompare(b.name));
  setCategoriesCache(computed);

  return computed;
}

export function renderCategory(category) {
  try {
    const navigationStack = getNavigationStack();
    navigationStack.push(category);
    updateBreadcrumb();

    // ── Obj 4: Update URL hash using clean slug-based scheme ─────────────────
    // URL format:  #{categorySlug}  or  #{categorySlug}/{subfolderSlug}/...
    // Each "/" segment of the categoryTree key is passed through toSlug().
    // Literal hyphens in names are double-encoded ("--") so they survive a
    // round-trip; spaces become single "-".
    const categoryTree = getCategoryTree();
    const catKey = category.key || Object.keys(categoryTree || {}).find(
      (k) => categoryTree[k] === category,
    );
    if (catKey) {
      const slugPath = catKey.split("/").map(toSlug).join("/");
      // Encode each segment individually (encodeURIComponent handles Arabic,
      // Cyrillic, etc.) then rejoin with "/" so the path separator is preserved.
      // "-" and "--" are ASCII and pass through encodeURIComponent unchanged,
      // so the space↔hyphen and literal-hyphen↔"--" round-trip is unaffected.
      const url = `#${slugPath.split("/").map(encodeURIComponent).join("/")}`;

      // ── Bug 1 Fix: record this navigation in the browser history ───────────
      // pushState so back fires popstate → restoreViewFromURL(); during popstate
      // restoration only replaceState so we don't create a phantom entry.
      try {
        if (!isRestoring()) {
          history.pushState({ view: "category", slugPath }, "", url);
        } else {
          history.replaceState({ view: "category", slugPath }, "", url);
        }
      } catch (pushErr) {
        // Genuine error handling (kept) — history.pushState/replaceState can
        // throw (e.g. SecurityError from too-frequent calls, or a
        // non-serializable state object), and silently swallowing that would
        // leave the URL out of sync with the rendered view.
        console.error("Failed to update URL for category navigation:", pushErr, {
          urlAttempted: url,
        });
      }
      // BUG FIX (removed dead code): a commented-out setTimeout/console.log
      // block left over from debugging a since-fixed search-manager.js issue
      // was removed from here — it never executed, but it was noise for
      // anyone reading this function.
    }
    // Update search context when entering a category
    const searchManager = getSearchManager();
    if (searchManager) {
      searchManager.updateContextVisibility();
    }

    // Update the #Subjects-text pill with a smart collapsible breadcrumb.
    // Build the items array from the navigationStack (which already includes
    // the just-pushed category at the end).
    if (title) {
      // Snapshot the stack at this moment
      const stackSnapshot = [...navigationStack];
      const items = [
        // Root item — always first
        {
          label: "الرئيسية",
          icon: "🏠",
          onClick: () => {
            // Lazy import to avoid circular dependency (root-view imports category-view)
            import("./root-view.js").then((m) => m.renderRootCategories());
          },
        },
        // Intermediate + current items from the stack
        ...stackSnapshot.map((cat, idx) => ({
          label: cat.name,
          icon: cat.icon || getSubjectIcon(cat.name, idx > 0),
          onClick:
            idx < stackSnapshot.length - 1
              ? () => {
                  // Navigate to this ancestor: reset the stack to the items
                  // above it, then renderCategory (which pushes it again).
                  setNavigationStack(stackSnapshot.slice(0, idx));
                  renderCategory(stackSnapshot[idx]);
                }
              : undefined, // last = current page, non-clickable
        })),
      ];
      renderTitleBreadcrumb(title, items);
    }

    container.innerHTML = "";
    container.className = "grid-container";

    const fragment = document.createDocumentFragment();

    // Render subcategories
    (category.subcategories || []).forEach((subCatKey) => {
      const subCat = categoryTree[subCatKey];
      if (subCat) {
        const itemCount = getCourseItemCount(subCat);
        const card = createCategoryCard(
          subCat.name,
          itemCount,
          true,
          null,
          true,
        );
        card.onclick = () => renderCategory(subCat);
        fragment.appendChild(card);
      }
    });

    // Render exams
    (category.exams || []).forEach((exam) => {
      const card = createExamCard(exam);
      fragment.appendChild(card);
    });

    container.appendChild(fragment);

    // Show empty state if no content
    if ((category.subcategories || []).length === 0 && (category.exams || []).length === 0) {
      container.innerHTML = `
        <div class="empty-state" role="status">
          <div class="empty-state-icon" aria-hidden="true">🔭</div>
          <h3>لا يوجد محتوى بعد</h3>
          <p>هذا القسم فارغ حالياً، تابعنا لمزيد من المحتوى قريباً!</p>
        </div>
      `;
    }
  } catch (error) {
    console.error("Error rendering category:", error);
    if (container) {
      container.innerHTML = `
        <div class="error-state" role="alert">
          <p>حدث خطأ أثناء تحميل المحتوى. يرجى تحديث الصفحة.</p>
          <button onclick="renderRootCategories()" type="button">الرجوع للرئيسية</button>
        </div>
      `;
    }
  }
}

/**
 * Returns an Arabic pluralised label for the exam count on a category card.
 * @param {number} count
 * @returns {string}
 */
function getItemText(count) {
  if (count === 0) return "لا يوجد امتحانات";
  if (count === 1) return "امتحان واحد";
  if (count === 2) return "امتحانان";
  if (count <= 10) return "امتحانات";
  return "امتحان";
}

export function createCategoryCard(
  name,
  itemCount,
  isFolder = false,
  courseData = null,
  isSubfolder = false, // ← new param: true for subcategories inside a course
) {
  const card = document.createElement("div");

  card.className = "card category-card";
  card.setAttribute("role", "button");
  card.setAttribute("tabindex", "0");
  card.setAttribute("title", `${name}`);
  card.setAttribute(
    "aria-label",
    `${name}, ${itemCount} ${getItemText(itemCount)}`,
  );

  if (courseData && isRecentlyAdded(courseData.createdAt)) {
    const newBadge = document.createElement("span");
    newBadge.className = "new-badge";
    newBadge.textContent = "جديد";
    newBadge.setAttribute("aria-label", "مضاف حديثاً");
    card.appendChild(newBadge);
  }

  const icon = getSubjectIcon(name, isSubfolder);

  const iconDiv = document.createElement("div");
  iconDiv.className = "icon";
  iconDiv.textContent = icon;
  iconDiv.setAttribute("aria-hidden", "true");

  const h3 = document.createElement("h3");
  h3.textContent = name;

  const p = document.createElement("p");

  p.textContent = `${itemCount > 2 ? itemCount : ""} ${getItemText(itemCount)}`;

  // Wrap text elements — display:contents on desktop (transparent), flex col on mobile
  const textWrap = document.createElement("div");
  textWrap.className = "card-text";
  textWrap.appendChild(h3);

  // tags removed for cleaner UI
  textWrap.appendChild(p);

  card.appendChild(iconDiv);
  card.appendChild(textWrap);

  // Keyboard support
  card.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      card.click();
    }
  });

  return card;
}
