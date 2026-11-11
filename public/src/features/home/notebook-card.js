// Platform notebook card (executable MATLAB-style notebook). Notebooks are
// unscored leaves: no quiz-only actions (attempts, results, downloads of
// quiz files) — just open, copy/share/embed, info and admin management.
// The card body is shared with «محتواي» (notebook-card-view.js) and the menu
// order is enforced centrally (item-menu-order.js).
import { openItemDropdownMenu, createActionGroupSubmenu } from "./item-dropdown-menu.js";
import { canManageItem, openSharedMoveToDialog, renameSharedItem, editSharedItemMetadata, deleteSharedItem } from "./admin-item-actions.js";
import { showNotification } from "../../components/notifications/notifications.js";
import { appendNotebookMenuEntries, fetchPlatformNotebookRow, showNotebookDownloadModal } from "./notebook-actions.js";
import { createNotebookCardShell, createNotebookActionRow } from "./notebook-card-view.js";
import { copyNotebookToUserQuizzes, withCopyButtonLoadingState } from "./copy-to-my-quizzes.js";
import { EMBED_ICON_SVG, copyEmbedCode } from "./embed-code.js";
import { COPY_ICON_SVG, SHARE_ICON_SVG, DUPLICATE_ICON_SVG, EDIT_ICON_SVG, MOVE_TO_ICON_SVG, RENAME_ICON_SVG, TRASH_ICON_SVG } from "./icons.js";

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
  return button;
}

export function createNotebookCard(notebook) {
  const { card, icon, text } = createNotebookCardShell({
    title: notebook.title,
    description: notebook.description,
    cellCount: notebook.cellCount,
    runtime: notebook.runtime,
  });

  const actions = createNotebookActionRow({
    title: notebook.title,
    onMore: (trigger) => openNotebookActionsMenu(notebook, trigger),
    onOpen: () => { window.location.href = notebookPath(notebook); },
    onDownload: async (button) => {
      try {
        showNotebookDownloadModal(await fetchPlatformNotebookRow(notebook), button);
      } catch {
        showNotification("تعذّر تحميل الدفتر", "تحقق من اتصالك ثم حاول مرة أخرى.", "error");
      }
    },
  });

  card.append(icon, text, actions);
  return card;
}

function openNotebookActionsMenu(notebook, trigger) {
  const url = `${window.location.origin}${notebookPath(notebook)}`;
  const item = { ...notebook, itemType: "notebook" };
  openItemDropdownMenu(trigger, (menu, closeMenu, reposition) => {
    // The ⋮ menu is re-ordered centrally, so the order of these calls doesn't matter.
    const copyMine = document.createElement("button");
    copyMine.type = "button";
    copyMine.className = "exam-action-btn";
    copyMine.innerHTML = `${DUPLICATE_ICON_SVG}<span>نسخ إلى محتواي</span>`;
    copyMine.addEventListener("click", async (event) => {
      event.stopPropagation();
      await withCopyButtonLoadingState(copyMine, () => copyNotebookToUserQuizzes(notebook));
      closeMenu();
    });
    menu.appendChild(copyMine);

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
    addMenuAction(menu, closeMenu, {
      label: "نسخ كود التضمين", icon: EMBED_ICON_SVG,
      onClick: () => { void copyEmbedCode("notebook", notebook.slug || notebook.id, notebook.title); },
    });
    appendNotebookMenuEntries(menu, closeMenu, reposition, notebook, { platform: true });
    if (canManageItem(item)) {
      menu.appendChild(createActionGroupSubmenu([
        { label: "تغيير العنوان", icon: RENAME_ICON_SVG, onClick: () => renameSharedItem(item) },
        { label: "الوصف والمصدر", icon: EDIT_ICON_SVG, onClick: () => editSharedItemMetadata(item) },
        { label: "تعديل الدفتر", icon: EDIT_ICON_SVG, onClick: () => { window.location.href = `/notebook/edit/${encodeURIComponent(notebook.id)}`; } },
        { label: "نقل", icon: MOVE_TO_ICON_SVG, onClick: () => openSharedMoveToDialog(item) },
        { label: "حذف الدفتر", icon: TRASH_ICON_SVG, danger: true, onClick: () => deleteSharedItem(item) },
      ], closeMenu, reposition));
    }
  });
}
