// ============================================================================
// public/src/features/home/user-course-card.js
// «محتواي» course card — a closed course BOOK: coloured spine with the subject
// emoji, a bookmark ribbon, a page-edge stack, and a mini table of contents
// with dotted leaders. Styles: user-course-card.css.
//
// Behaviour is a 1:1 port of the course path of createFolderOrCourseCard()
// (user-quizzes-folders.js). That module imports this one, so everything that
// lives there is injected through `deps` instead of imported (no import cycle).
//
// deps = {
//   showContextMenu, navigateToFolder, handleDragOver, handleDragLeave, handleDrop,
//   getSelectedUserQuizzes, updateBulkActionBar, readUserQuizzes, getChildren
// }
// ============================================================================

import { getFolderContentsCount, formatFolderAndQuizCount } from "./folder-counts.js";
import { getSubjectIcon } from "./subject-icons.js";
import { MORE_DOTS_ICON_SVG } from "./icons.js";

const TOC_MAX = 3;
const TYPE_INFO = {
  folder: { glyph: "📁", label: "مجلد" },
  course: { glyph: "📚", label: "مادة" },
  lesson: { glyph: "📘", label: "درس" },
  notebook: { glyph: "💻", label: "دفتر" },
  quiz: { glyph: "📄", label: "امتحان" },
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function buildToc(children, all, getCounts) {
  const toc = el("ol", "ucc-toc");
  toc.setAttribute("aria-hidden", "true"); // the card's aria-label already carries the summary
  children.slice(0, TOC_MAX).forEach((child) => {
    const type = TYPE_INFO[child.meta?.type] ? child.meta.type : "quiz";
    const li = el("li", "ucc-toc-row");
    li.appendChild(el("span", "ucc-toc-ic", TYPE_INFO[type].glyph));
    const name = el("span", "ucc-toc-name", child.meta?.title || "");
    name.dir = "auto";
    li.appendChild(name);
    li.appendChild(el("span", "ucc-toc-dots"));
    let tail = TYPE_INFO[type].label;
    if (type === "folder") {
      const c = getCounts(all, child.id || child.meta?.id);
      const n = c.quizCount + c.lessonCount + c.notebookCount;
      if (n > 0) tail = String(n);
    }
    li.appendChild(el("span", "ucc-toc-tail", tail));
    toc.appendChild(li);
  });
  if (children.length > TOC_MAX) {
    toc.appendChild(el("li", "ucc-toc-more", `و${children.length - TOC_MAX} أخرى`));
  }
  return toc;
}

export function createUserCourseCard(item, deps) {
  const {
    showContextMenu, navigateToFolder, handleDragOver, handleDragLeave, handleDrop,
    getSelectedUserQuizzes, updateBulkActionBar, readUserQuizzes, getChildren,
  } = deps;

  const itemId = item.id || item.meta?.id;
  const title = item.meta?.title || "";

  const card = el("div", "user-course-card");
  card.setAttribute("role", "button");
  card.setAttribute("tabindex", "0");
  card.draggable = false; // courses are top-level: no valid drop target for one
  card.dataset.itemId = itemId || "";

  // ── Data ──────────────────────────────────────────────────────────────────
  const all = readUserQuizzes();
  const { subfolderCount, quizCount, lessonCount, notebookCount } = getFolderContentsCount(all, itemId);
  const total = subfolderCount + quizCount + lessonCount + notebookCount;
  const summary = formatFolderAndQuizCount(subfolderCount, quizCount, lessonCount, notebookCount);
  let children = [];
  try { children = getChildren(all, itemId) || []; } catch { children = []; }
  if (total === 0) card.classList.add("is-empty");
  card.setAttribute("aria-label", `${title}, ${summary}`);

  // ── Selection checkbox (out-of-flow, same contract as the other cards) ────
  const selected = getSelectedUserQuizzes();
  const checkbox = el("input", "user-quiz-select-checkbox");
  checkbox.type = "checkbox";
  checkbox.setAttribute("data-quiz-id", itemId);
  checkbox.setAttribute("aria-label", "تحديد");
  checkbox.checked = selected.has(itemId);
  checkbox.onclick = (e) => {
    e.stopPropagation();
    if (checkbox.checked) selected.add(itemId); else selected.delete(itemId);
    updateBulkActionBar();
  };
  card.appendChild(checkbox);

  // ── Silhouette: page stack + cover + bookmark ribbon (all painted, no text)
  const shape = el("span", "ucc-shape");
  shape.setAttribute("aria-hidden", "true");
  shape.append(el("i", "ucc-pages"), el("i", "ucc-cover"), el("i", "ucc-ribbon"));
  card.appendChild(shape);

  // ── Spine: subject emoji + total count ────────────────────────────────────
  const spine = el("div", "ucc-spine");
  spine.setAttribute("aria-hidden", "true");
  spine.appendChild(el("span", "ucc-emoji", getSubjectIcon(title, false) || "📚"));
  spine.appendChild(el("span", "ucc-total", total > 0 ? String(total) : "٠"));
  card.appendChild(spine);

  // ── Body ──────────────────────────────────────────────────────────────────
  const body = el("div", "ucc-body");
  body.appendChild(el("span", "ucc-tag", "🎓 مادة"));
  const h = el("h3", "ucc-title", title);
  h.dir = "auto";
  h.setAttribute("data-tooltip-text", title);
  h.setAttribute("data-tooltip-clamped-only", "true");
  body.appendChild(h);
  if (children.length) {
    body.appendChild(buildToc(children, all, getFolderContentsCount));
  } else {
    body.appendChild(el("p", "ucc-hint", "فارغة · اسحب محتوى إلى هنا"));
  }
  body.appendChild(el("p", "ucc-summary", summary));
  card.appendChild(body);

  // ── ⋮ menu ────────────────────────────────────────────────────────────────
  const more = el("button", "ucc-more");
  more.type = "button";
  more.innerHTML = MORE_DOTS_ICON_SVG;
  more.setAttribute("aria-label", `خيارات ${title}`);
  more.onclick = (e) => {
    e.stopPropagation();
    showContextMenu(e, "course", itemId, title);
  };
  card.appendChild(more);

  // ── Interaction (same as the folder path) ─────────────────────────────────
  card.onclick = () => {
    const list = document.querySelector(".user-quizzes-container");
    if (list?.classList.contains("selection-mode-active")) {
      checkbox.click();
      return;
    }
    navigateToFolder(itemId, title);
  };
  card.addEventListener("keydown", (e) => {
    if (e.target !== card) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      card.click();
    }
  });
  card.ondragover = handleDragOver;
  card.ondragleave = handleDragLeave;
  card.ondrop = (e) => {
    e.stopPropagation();
    handleDrop(e, itemId);
  };
  card.oncontextmenu = (e) => {
    e.stopPropagation();
    showContextMenu(e, "course", itemId, title);
  };

  return card;
}
