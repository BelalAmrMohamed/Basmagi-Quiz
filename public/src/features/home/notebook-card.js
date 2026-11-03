// Platform notebook card (executable MATLAB-style notebook). Notebooks are
// unscored leaves: no quiz-only actions (attempts, results, downloads of
// quiz files) — just open, link/share, and admin management.
import { openExamDropdownMenu, createActionGroupSubmenu } from "./exam-dropdown-menu.js";
import { canManageItem, openSharedMoveToDialog, renameSharedItem, editSharedItemMetadata, deleteSharedItem } from "./admin-item-actions.js";
import { showNotification } from "../../components/notifications/notifications.js";
import { appendNotebookMenuEntries, fetchPlatformNotebookRow, showNotebookDownloadModal } from "./notebook-actions.js";
import { MORE_DOTS_ICON_SVG, COPY_ICON_SVG, SHARE_ICON_SVG, DOWNLOAD_ICON_SVG, EDIT_ICON_SVG, MOVE_TO_ICON_SVG, RENAME_ICON_SVG, TRASH_ICON_SVG } from "./icons.js";

const RUNTIME_LABELS = { matlab: "MATLAB (تعليمي)" };

export function notebookPath(notebook) {
  return `/notebook/${encodeURIComponent(notebook.slug || notebook.id)}`;
}

function addMenuAction(menu, closeMenu, { label, icon, onClick }) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "exam-action-btn";
  button.innerHTML = `${icon}<span>${label}</span>`;
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    closeMenu();
    onClick();
  });
  menu.appendChild(button);
}

export function createNotebookCard(notebook) {
  const card = document.createElement("div");
  card.className = "card exam-card lesson-card notebook-card";
  card.setAttribute("role", "article");
  card.setAttribute("aria-label", `دفتر تفاعلي: ${notebook.title || notebook.id}`);

  const icon = document.createElement("span");
  icon.className = "phone-only-emoji";
  icon.textContent = "💻";
  icon.setAttribute("aria-hidden", "true");

  const text = document.createElement("div");
  text.className = "card-text";
  const heading = document.createElement("h3");
  heading.textContent = notebook.title || "دفتر بدون عنوان";
  text.appendChild(heading);
  const description = String(notebook.description || "").trim();
  if (description) {
    const desc = document.createElement("p");
    desc.className = "lesson-card-description";
    desc.textContent = description;
    text.appendChild(desc);
  }
  const meta = document.createElement("div");
  meta.className = "exam-card-meta user-quiz-card-meta";
  const cells = document.createElement("p");
  cells.className = "exam-question-count";
  cells.textContent = `الخلايا: ${Number(notebook.cellCount) || 0}`;
  const runtime = document.createElement("p");
  runtime.className = "exam-types-subtext";
  runtime.textContent = RUNTIME_LABELS[notebook.runtime] || notebook.runtime || "";
  meta.append(cells, runtime);
  text.appendChild(meta);

  const actions = document.createElement("div");
  actions.className = "exam-card-actions-wrap";
  const more = document.createElement("button");
  more.type = "button";
  more.className = "exam-more-btn";
  more.innerHTML = MORE_DOTS_ICON_SVG;
  more.title = "خيارات الدفتر";
  more.setAttribute("aria-label", `خيارات إضافية لـ ${notebook.title || "الدفتر"}`);
  more.addEventListener("click", (event) => {
    event.stopPropagation();
    openNotebookActionsMenu(notebook, more);
  });

  const start = document.createElement("button");
  start.type = "button";
  start.className = "start-btn";
  start.style.flex = "1";
  start.style.minWidth = "0";
  start.textContent = "افتح الدفتر";
  start.setAttribute("aria-label", `افتح الدفتر ${notebook.title || ""}`);
  start.addEventListener("click", (event) => {
    event.stopPropagation();
    window.location.href = notebookPath(notebook);
  });

  const download = document.createElement("button");
  download.type = "button";
  download.className = "start-btn desktop-download-btn";
  download.style.flex = "1";
  download.style.minWidth = "0";
  download.innerHTML = `${DOWNLOAD_ICON_SVG}<span>تحميل</span>`;
  download.setAttribute("aria-label", `تحميل دفتر ${notebook.title || ""}`);
  download.addEventListener("click", async (event) => {
    event.stopPropagation();
    try {
      showNotebookDownloadModal(await fetchPlatformNotebookRow(notebook), download);
    } catch {
      showNotification("تعذّر تحميل الدفتر", "تحقق من اتصالك ثم حاول مرة أخرى.", "error");
    }
  });

  actions.append(more, start, download);
  card.append(icon, text, actions);
  return card;
}

function openNotebookActionsMenu(notebook, trigger) {
  const url = `${window.location.origin}${notebookPath(notebook)}`;
  const item = { ...notebook, itemType: "notebook" };
  openExamDropdownMenu(trigger, (menu, closeMenu, reposition) => {
    addMenuAction(menu, closeMenu, {
      label: "نسخ الرابط", icon: COPY_ICON_SVG,
      onClick: () => navigator.clipboard.writeText(url).then(() => showNotification("تم النسخ", "تم نسخ رابط الدفتر.", "success")),
    });
    addMenuAction(menu, closeMenu, {
      label: "مشاركة الرابط", icon: SHARE_ICON_SVG,
      onClick: () => {
        if (navigator.share) void navigator.share({ title: notebook.title || "دفتر", url }).catch(() => { });
        else void navigator.clipboard.writeText(url).then(() => showNotification("تم النسخ", "تم نسخ رابط الدفتر.", "success"));
      },
    });
    appendNotebookMenuEntries(menu, closeMenu, reposition, notebook, { platform: true });
    if (canManageItem(item)) {
      menu.appendChild(createActionGroupSubmenu([
        { label: "تعديل التفاصيل", icon: EDIT_ICON_SVG, onClick: () => editSharedItemMetadata(item) },
        { label: "تعديل", icon: EDIT_ICON_SVG, onClick: () => { window.location.href = `/create-notebook?edit=${encodeURIComponent(notebook.id)}`; } },
        { label: "نقل", icon: MOVE_TO_ICON_SVG, onClick: () => openSharedMoveToDialog(item) },
        { label: "إعادة تسمية", icon: RENAME_ICON_SVG, onClick: () => renameSharedItem(item) },
        { label: "حذف الدفتر", icon: TRASH_ICON_SVG, danger: true, onClick: () => deleteSharedItem(item) },
      ], closeMenu, reposition));
    }
  });
}
