// ============================================================================
// public/src/features/home/user-quizzes-trash-panel.js
// LOCAL TRASH PANEL — "سلة المهملات" dialog for the "امتحاناتك" section.
// Reads/writes exclusively through user-quizzes-trash.js; owns only
// rendering + the confirm flows. See plan §4/§6 (this is the local mirror of
// the admin trash panel in control.js) and §8 Step 8.
// ============================================================================

import {
    listTrashEntries,
    restoreTrashBatch,
    purgeTrashBatch,
    purgeAllTrash,
    getTrashRetentionDays,
    setTrashRetentionDays,
} from "./user-quizzes-trash.js";
import { renderUserQuizzesView } from "./user-quizzes-view.js";
import { refreshUserQuizzesCard } from "./course-count.js";
import { _confirm, _confirmTyped, showNotification } from "../../components/notifications/notifications.js";
import { TRASH_ICON_SVG, RESTORE_ICON_SVG } from "./icons.js";

const TYPE_LABELS = { quiz: "امتحان", folder: "مجلد", course: "مادة" };

function itemTypeOf(rootItem) {
    return rootItem?.meta?.type === "course" || rootItem?.meta?.type === "folder"
        ? rootItem.meta.type
        : "quiz";
}

function formatTrashDate(iso) {
    if (!iso) return "—";
    try {
        return new Date(iso).toLocaleDateString("ar-EG", {
            year: "numeric",
            month: "short",
            day: "numeric",
        });
    } catch {
        return "—";
    }
}

/** Days remaining until expiresAt — mirrors control.js's daysUntil(). */
function daysUntil(expiresAtIso) {
    if (!expiresAtIso) return null;
    const diffMs = new Date(expiresAtIso).getTime() - Date.now();
    return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

let dialogEl = null;

function closeDialog() {
    if (!dialogEl) return;
    dialogEl.close();
    dialogEl.remove();
    dialogEl = null;
}

function renderEntries(listEl) {
    const entries = listTrashEntries();

    if (!entries.length) {
        listEl.innerHTML = `<p class="quiz-info-empty">سلة المهملات فارغة</p>`;
        return;
    }

    listEl.replaceChildren();
    entries.forEach((entry) => {
        const rootItem = entry.items?.[0] || null;
        const type = itemTypeOf(rootItem);
        const daysLeft = daysUntil(entry.expiresAt);
        const urgent = daysLeft !== null && daysLeft <= 3;
        const extraCount = (entry.items?.length || 1) - 1;

        const row = document.createElement("div");
        row.className = "local-trash-row";
        row.innerHTML = `
      <div class="local-trash-row-info">
        <div class="local-trash-row-name">
          <span class="local-trash-type-badge">${TYPE_LABELS[type] || type}</span>
          <span class="local-trash-row-title"></span>
        </div>
        <div class="local-trash-row-meta">
          <span>حُذف في: ${formatTrashDate(entry.deletedAt)}</span>
          <span class="local-trash-dot">·</span>
          <span class="${urgent ? "local-trash-expiry local-trash-expiry--urgent" : "local-trash-expiry"}">
            ${daysLeft === null ? "—" : daysLeft > 0 ? `يُحذف نهائياً خلال ${daysLeft} يوم` : "سيُحذف نهائياً قريباً"}
          </span>
          ${extraCount > 0 ? `<span class="local-trash-dot">·</span><span>و${extraCount} عنصر آخر بداخله</span>` : ""}
        </div>
      </div>
      <div class="local-trash-row-actions">
        <button type="button" class="local-trash-btn local-trash-btn--restore" data-action="restore">${RESTORE_ICON_SVG}<span>استعادة</span></button>
        <button type="button" class="local-trash-btn local-trash-btn--purge" data-action="purge">${TRASH_ICON_SVG}<span>حذف نهائي</span></button>
      </div>
    `;
        row.querySelector(".local-trash-row-title").textContent =
            entry.label || rootItem?.meta?.title || "عنصر بلا اسم";

        row.querySelector('[data-action="restore"]').onclick = () => handleRestore(entry, listEl);
        row.querySelector('[data-action="purge"]').onclick = () => handlePurge(entry, listEl);

        listEl.appendChild(row);
    });
}

function handleRestore(entry, listEl) {
    const result = restoreTrashBatch(entry.batchId);
    if (!result.ok) {
        showNotification("تعذرت الاستعادة", result.reason, "warning");
        return;
    }
    showNotification("تمت الاستعادة", `تم استعادة "${entry.label}" بنجاح.`, "success");
    renderEntries(listEl);
    renderUserQuizzesView();
    refreshUserQuizzesCard();
}

async function handlePurge(entry, listEl) {
    const label = entry.items?.length > 1 ? `"${entry.label}" وكل ما بداخله` : `"${entry.label}"`;
    if (!(await _confirm(`سيتم حذف ${label} نهائياً ولا يمكن التراجع عن هذا الإجراء. متابعة؟`))) {
        return;
    }
    purgeTrashBatch(entry.batchId);
    showNotification("تم الحذف النهائي", `تم حذف ${label}.`, "success");
    renderEntries(listEl);
}

async function handleEmptyTrash(listEl) {
    const entries = listTrashEntries();
    if (!entries.length) return;

    const confirmed = await _confirmTyped({
        message:
            "سيتم حذف كل العناصر الموجودة في سلة المهملات نهائياً ولا يمكن التراجع عن هذا الإجراء.\nللمتابعة، اضغط \"نعم\" ثم اكتب العبارة المطلوبة في الخطوة التالية.",
        confirmPhrase: "إفراغ السلة",
        confirmButtonLabel: "إفراغ السلة نهائياً",
    });
    if (!confirmed) return;

    const { purged } = purgeAllTrash();
    showNotification("تم إفراغ السلة", `تم حذف ${purged} عنصر نهائياً.`, "success");
    renderEntries(listEl);
}

function buildHtml() {
    const retentionDays = getTrashRetentionDays();
    return `
    <div class="quiz-info-dialog-inner">
      <div class="quiz-info-dialog-header">
        <h2 id="localTrashDialogTitle">سلة المهملات</h2>
        <button class="quiz-info-dialog-close" type="button" aria-label="إغلاق">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div class="quiz-info-dialog-body">
        <div class="local-trash-toolbar">
          <label class="local-trash-retention-label">
            الاحتفاظ لمدة
            <input type="number" min="1" max="365" class="local-trash-retention-input" value="${retentionDays}">
            يوم قبل الحذف التلقائي
            <button type="button" class="local-trash-btn local-trash-btn--save-retention">حفظ</button>
          </label>
          <button type="button" class="local-trash-btn local-trash-btn--empty-all">${TRASH_ICON_SVG}<span>إفراغ السلة</span></button>
        </div>
        <div class="local-trash-list"></div>
      </div>
    </div>
  `;
}

/**
 * Opens the local trash panel dialog. Entry point wired from the
 * "امتحاناتك" card's dropdown (root-view.js), same pattern as
 * showUserQuizInfoModal()'s createAndShowDialog usage in
 * quiz-info-modal.js — reuses that same `.quiz-info-dialog` shell class so
 * no new dialog chrome/CSS is needed for the outer frame, only the
 * trash-specific rows inside it (see user-quizzes-trash-panel.css).
 */
export function openLocalTrashPanel() {
    if (dialogEl) return; // already open

    dialogEl = document.createElement("dialog");
    dialogEl.className = "quiz-info-dialog local-trash-dialog";
    dialogEl.setAttribute("aria-labelledby", "localTrashDialogTitle");
    dialogEl.innerHTML = buildHtml();
    document.body.appendChild(dialogEl);

    const listEl = dialogEl.querySelector(".local-trash-list");
    renderEntries(listEl);

    dialogEl.querySelector(".quiz-info-dialog-close").onclick = closeDialog;
    dialogEl.addEventListener("click", (e) => {
        if (e.target === dialogEl) closeDialog();
    });

    dialogEl.querySelector(".local-trash-btn--empty-all").onclick = () => handleEmptyTrash(listEl);

    dialogEl.querySelector(".local-trash-btn--save-retention").onclick = () => {
        const input = dialogEl.querySelector(".local-trash-retention-input");
        const result = setTrashRetentionDays(input.value);
        if (!result.ok) {
            showNotification("تعذر الحفظ", result.reason, "warning");
            return;
        }
        showNotification("تم الحفظ", "تم تحديث مدة الاحتفاظ بنجاح.", "success");
    };

    dialogEl.showModal();
}