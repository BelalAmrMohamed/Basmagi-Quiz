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
import { openExamDropdownMenu } from "./exam-dropdown-menu.js";
import {
  COPY_ICON_SVG,
  DUPLICATE_ICON_SVG,
  SHARE_ICON_SVG,
  SPARKLE_ICON_SVG,
} from "./icons.js";
import { copyQuizToUserQuizzes } from "./copy-to-my-quizzes.js";
import { loadFullQuizData } from "./quiz-data-loader.js";
import { showNotification } from "../../components/notifications/notifications.js";
import {
  openAIAgentWithAttachment,
  buildPlatformFolderAttachment,
} from "../../components/ai-agent/ai-agent-attach-launcher.js";
import { HOME_PAGE_SYSTEM_PROMPT } from "../../components/ai-agent/ai-agent-default-prompts.js";

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
        const card = createCategoryCard(subCat.name, itemCount, true, subCat, true);
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

  if (isSubfolder && courseData) {
    const moreBtn = document.createElement("button");
    moreBtn.type = "button";
    moreBtn.className = "exam-more-btn";
    moreBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>`;
    moreBtn.setAttribute("aria-label", `خيارات ${name}`);
    moreBtn.onclick = (event) => {
      event.stopPropagation();
      openExamDropdownMenu(moreBtn, (menu, closeMenu) => {
        const askAi = document.createElement("button");
        askAi.type = "button";
        askAi.className = "exam-action-btn";
        askAi.innerHTML = `${SPARKLE_ICON_SVG}<span>اسأل الباشـمبصمج</span>`;
        askAi.onclick = () => {
          closeMenu();
          openAIAgentWithAttachment(buildPlatformFolderAttachment(courseData, getCategoryTree()), {
            defaultSystemPrompt: HOME_PAGE_SYSTEM_PROMPT,
          });
        };
        menu.appendChild(askAi);

        const folderUrl = `${window.location.origin}/#${(courseData.path || [courseData.name])
          .map((segment) => encodeURIComponent(segment))
          .join("/")}`;
        const copyLink = document.createElement("button");
        copyLink.type = "button";
        copyLink.className = "exam-action-btn";
        copyLink.innerHTML = `${COPY_ICON_SVG}<span>نسخ الرابط</span>`;
        copyLink.onclick = async () => {
          await navigator.clipboard.writeText(folderUrl);
          closeMenu();
          showNotification("تم النسخ", "تم نسخ رابط المجلد.", "success");
        };
        menu.appendChild(copyLink);

        const shareLink = document.createElement("button");
        shareLink.type = "button";
        shareLink.className = "exam-action-btn";
        shareLink.innerHTML = `${SHARE_ICON_SVG}<span>مشاركة الرابط</span>`;
        shareLink.onclick = async () => {
          closeMenu();
          if (navigator.share) {
            await navigator.share({ title: courseData.name, url: folderUrl }).catch(() => {});
          } else {
            await navigator.clipboard.writeText(folderUrl);
            showNotification("تم النسخ", "تم نسخ رابط المجلد.", "success");
          }
        };
        menu.appendChild(shareLink);

        const copyToMine = document.createElement("button");
        copyToMine.type = "button";
        copyToMine.className = "exam-action-btn";
        copyToMine.innerHTML = `${DUPLICATE_ICON_SVG}<span>نسخ لامتحاناتي</span>`;
        copyToMine.onclick = async () => {
          copyToMine.disabled = true;
          try {
            const attachment = buildPlatformFolderAttachment(courseData, getCategoryTree());
            const exams = [];
            const collectExams = (node) => {
              (node.children || []).forEach((child) => {
                if (child.kind === "quiz") exams.push(child);
                else collectExams(child);
              });
            };
            collectExams(attachment.payload.tree[0]);
            for (const exam of exams) {
              if (!exam.dbId) continue;
              const loaded = await loadFullQuizData({ dbId: exam.dbId });
              await copyQuizToUserQuizzes({
                id: exam.id,
                dbId: exam.dbId,
                title: exam.title,
                data: loaded,
              });
            }
            closeMenu();
            showNotification("تم النسخ", "تم نسخ اختبارات المجلد إلى امتحاناتك.", "success");
          } finally {
            copyToMine.disabled = false;
          }
        };
        menu.appendChild(copyToMine);

        const counts = document.createElement("div");
        counts.className = "exam-action-btn";
        counts.disabled = true;
        counts.textContent = `${itemCount} اختبار · ${(courseData.subcategories || []).length} مجلد فرعي`;
        menu.appendChild(counts);
      });
    };
    card.appendChild(moreBtn);
  }

  // Keyboard support
  card.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      card.click();
    }
  });

  return card;
}
