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
import { getCourseItemCount, refreshUserQuizzesCard } from "./course-count.js";
import { isRecentlyAdded } from "./date-utils.js";
import { getSubjectIcon } from "./subject-icons.js";
import { createExamCard } from "./exam-card.js";
import { openExamDropdownMenu, createActionGroupSubmenu } from "./exam-dropdown-menu.js";
import {
  canManageItem,
  openSharedMoveToDialog,
  renameSharedItem,
  deleteSharedItem,
} from "./admin-item-actions.js";
import {
  COPY_ICON_SVG,
  DUPLICATE_ICON_SVG,
  SHARE_ICON_SVG,
  SPARKLE_ICON_SVG,
  RENAME_ICON_SVG,
  MOVE_TO_ICON_SVG,
  TRASH_ICON_SVG,
} from "./icons.js";
import { copyCategoryTreeToUserQuizzes, withCopyButtonLoadingState } from "./copy-to-my-quizzes.js";
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

    // ── Obj 4: Update the URL — real pathname segments for both the course
    // and any nested subfolders ─────────────────────────────────────────────
    // Courses cannot be nested (single-segment categoryTree key, parent ===
    // null), so a top-level course gets a real, crawlable pathname:
    //   /course/{courseSlug}
    // (courseSlug is toSlug(course.name) — dashes, not raw %20-encoded
    // spaces — matching render-course.js's slug-based fetchCourseMeta()
    // lookup.)
    //
    // Nested subfolders *within* a course now get their own real path
    // segments too (not a #hash), so each folder level is server-visible and
    // gets its own accurate OG image/title (see render-course.js's :path*
    // handling and api/og.js's ?folder= support) — a hash is never sent to
    // the server, so a crawler hitting a hash-based link could only ever see
    // the course-level page, not the specific folder that was shared:
    //   /course/{courseSlug}/{subSlug}/{subSlug2}/...
    // Each "/" segment of the categoryTree key (including the course-name
    // prefix) is passed through toSlug(). Literal hyphens in names are
    // double-encoded ("--") so they survive a round-trip; spaces become a
    // single "-".
    const categoryTree = getCategoryTree();
    const catKey = category.key || Object.keys(categoryTree || {}).find(
      (k) => categoryTree[k] === category,
    );
    if (catKey) {
      const keyParts = catKey.split("/");

      // Encode each slug segment individually (encodeURIComponent handles
      // Arabic, Cyrillic, etc.) then rejoin with "/" so the path separator
      // is preserved. "-" and "--" are ASCII and pass through
      // encodeURIComponent unchanged, so the space↔hyphen and literal-
      // hyphen↔"--" round-trip is unaffected.
      const url = "/course/" + keyParts.map((part) => encodeURIComponent(toSlug(part))).join("/");

      // ── Bug 1 Fix: record this navigation in the browser history ───────────
      // pushState so back fires popstate → restoreViewFromURL(); during popstate
      // restoration only replaceState so we don't create a phantom entry.
      try {
        if (!isRestoring()) {
          history.pushState({ view: "category", catKey }, "", url);
        } else {
          history.replaceState({ view: "category", catKey }, "", url);
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
  subtextOverride = null, // ← optional: exact subtext string, bypassing the
  // generic itemCount/getItemText() "N امتحان(ات)" phrasing below. Used by
  // the "امتحاناتك" root card, whose contents aren't purely quizzes (can
  // include folders/courses too), so a single "N امتحان" label is wrong for
  // it — see getUserQuizzesBreakdown()/formatUserQuizzesBreakdown().
) {
  const card = document.createElement("div");

  card.className = "card category-card";
  card.setAttribute("role", "button");
  card.setAttribute("tabindex", "0");
  card.setAttribute("title", `${name}`);
  card.setAttribute(
    "aria-label",
    `${name}, ${subtextOverride || `${itemCount} ${getItemText(itemCount)}`}`,
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

  p.textContent = subtextOverride || `${itemCount > 2 ? itemCount : ""} ${getItemText(itemCount)}`;

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
    moreBtn.className = "exam-more-btn exam-more-btn--lg";
    moreBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="1.5"></circle><circle cx="12" cy="5" r="1.5"></circle><circle cx="12" cy="19" r="1.5"></circle></svg>`;
    moreBtn.setAttribute("aria-label", `خيارات ${name}`);
    moreBtn.onclick = (event) => {
      event.stopPropagation();
      openExamDropdownMenu(moreBtn, (menu, closeMenu, reposition) => {
        // Build a shareable URL matching the real-path scheme used by
        // renderCategory(): /course/{courseSlug}/{subSlug}/{subSlug2}/...
        // (all real path segments now, not a #hash — see renderCategory()'s
        // comment for why: a hash is never sent to the server, so a shared
        // link to a nested folder needs a real path segment to get its own
        // accurate OG image.)
        const pathSegments = courseData.path || [courseData.name];
        const folderUrl = `${window.location.origin}/course/` +
          pathSegments.map((seg) => encodeURIComponent(toSlug(seg))).join("/");
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
            await navigator.share({ title: courseData.name, url: folderUrl }).catch(() => { });
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
          await withCopyButtonLoadingState(copyToMine, () =>
            copyCategoryTreeToUserQuizzes(courseData, getCategoryTree(), "folder"),
          );
          // BUG FIX: refresh the "امتحاناتك" card's subtext right away
          // instead of leaving it stale until the next navigation back to
          // the root view (see refreshUserQuizzesCard() in course-count.js).
          refreshUserQuizzesCard();
          closeMenu();
        };
        menu.appendChild(copyToMine);

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

        const counts = document.createElement("div");
        counts.className = "exam-action-btn";
        counts.disabled = true;
        counts.textContent = `${itemCount} امتحان · ${(courseData.subcategories || []).length} مجلد فرعي`;
        menu.appendChild(counts);

        // ── Admin manage group — نقل / إعادة تسمية / حذف (→ trash) ──────
        // Folders only: gated on the same canManageItem() 3-tier check as
        // quizzes (owner → creator match → scope match), grouped below the
        // public actions with a divider, collapsed into a single "إدارة"
        // submenu-trigger row. `courseData` here is the category-tree
        // folder node, which quizManifest.js now threads with the DB
        // folder id / course_id / parent_folder_id / created_by it needs.
        if (canManageItem(courseData)) {
          const divider = document.createElement("div");
          divider.className = "exam-action-divider";
          menu.appendChild(divider);

          const adminSubmenu = createActionGroupSubmenu(
            [
              {
                // نقل — shared Move-Source dialog over the DB
                // courses+folders tree.
                label: "نقل",
                icon: MOVE_TO_ICON_SVG,
                onClick: () => openSharedMoveToDialog(courseData),
              },
              {
                // إعادة تسمية.
                label: "إعادة تسمية",
                icon: RENAME_ICON_SVG,
                onClick: () => renameSharedItem(courseData),
              },
              {
                // حذف — soft-deletes the folder + its whole subtree to the
                // shared trash (one batch, fully restorable until purged).
                label: "حذف المجلد",
                icon: TRASH_ICON_SVG,
                danger: true,
                onClick: () => deleteSharedItem(courseData),
              },
            ],
            closeMenu,
            reposition,
          );
          menu.appendChild(adminSubmenu);
        }
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