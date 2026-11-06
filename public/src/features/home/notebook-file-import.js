// =============================================================================
// public/src/features/home/notebook-file-import.js
// Drag-and-drop router for the «محتواي» area. Accepts, in any mix:
//   .json  → quiz import (unchanged: importJsonQuizFiles)
//   .ipynb / .m → one notebook per file
//   .zip   → a notebook bundle (notebook.json + assets/), with its files restored
// Dropping 5 files creates 5 notebooks. A bad file never stops the others.
// A notebook whose title already exists at the target level asks the user
// whether to add « (2)» or skip it (with an «apply to all» checkbox).
// =============================================================================
import { getFromStorage, setInStorage } from "../../shared/storage-helpers.js";
import { showNotification } from "../../components/notifications/notifications.js";
import { hasSameLevelCollision, currentFolderId } from "./user-quizzes-folders.js";
import { importJsonQuizFiles } from "./quiz-file-import.js";
import { parseNotebookInput, validateNotebookRecord, NotebookInputError } from "./notebook-input.js";
import { partitionDroppedFiles, classifyDroppedFile, baseNameOf, dedupeTitle, buildLocalNotebookEntry } from "./local-notebook.js";
import { escapeHtml } from "./escape-html.js";

/** Parses one dropped notebook file into a validated record (+ workspace files for bundles). */
async function readNotebookFile(file) {
  if (classifyDroppedFile(file.name) === "notebook-zip") {
    const [{ parseNotebookZip }, { notebookFromPayload }, { normalizeNotebookContent }] = await Promise.all([
      import("../../shared/workspace-zip.js"),
      import("../notebook/notebook-editor-model.js"),
      import("../../shared/content-rules.js"),
    ]);
    const z = await parseNotebookZip(await file.arrayBuffer());
    const st = notebookFromPayload(z.meta);
    const rec = {
      title: st.title, description: st.description, source: st.source, runtime: st.runtime, language: st.language,
      content: { ...normalizeNotebookContent(st.cells, st.language, st.runtime), language: st.language },
      warnings: [],
    };
    return { rec, files: z.files };
  }
  const rec = parseNotebookInput({ text: await file.text(), fileName: file.name });
  return { rec, files: [] };
}

/**
 * Asks what to do about a title clash. Resolves "rename" | "skip".
 * `applyAll` is returned so one answer can cover the remaining conflicts.
 */
export function askNotebookConflict(title, { moreConflictsPossible = false } = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "confirmation-overlay show";
    const modal = document.createElement("div");
    modal.className = "confirmation-modal show";
    modal.setAttribute("role", "alertdialog");
    modal.setAttribute("aria-modal", "true");
    const messageId = `nb-conflict-${Date.now()}`;
    modal.setAttribute("aria-labelledby", messageId);
    modal.innerHTML = `
      <div class="confirmation-content">
        <p class="confirmation-message" id="${messageId}">يوجد دفتر باسم «${escapeHtml(title)}» في هذا المكان بالفعل. هل تريد إضافة النسخة الجديدة باسم «${escapeHtml(title)} (2)» أم تخطّيها؟</p>
        ${moreConflictsPossible ? `<label class="nb-conflict-all"><input type="checkbox" id="nbConflictAll"> تطبيق هذا الاختيار على باقي الملفات المكرّرة</label>` : ""}
        <div class="confirmation-actions">
          <button type="button" class="confirmation-btn confirm" data-act="rename">إضافة (2)</button>
          <button type="button" class="confirmation-btn cancel" data-act="skip">تخطّي</button>
        </div>
      </div>`;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    const previous = document.activeElement;
    const done = (action) => {
      const applyAll = Boolean(modal.querySelector("#nbConflictAll")?.checked);
      window.removeEventListener("keydown", onKey, true);
      overlay.remove();
      if (previous instanceof HTMLElement && document.body.contains(previous)) previous.focus({ preventScroll: true });
      resolve({ action, applyAll });
    };
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); done("skip"); } };
    window.addEventListener("keydown", onKey, true);
    modal.querySelectorAll("button[data-act]").forEach((b) => b.addEventListener("click", () => done(b.dataset.act)));
    modal.querySelector(".confirm").focus();
  });
}

/**
 * Imports dropped / picked notebook files into «محتواي».
 * @returns {Promise<{created:number, skipped:number, failed:{name:string, reason:string}[]}>}
 */
export async function importNotebookFiles(files, { parentId = currentFolderId || null, ask = askNotebookConflict } = {}) {
  const result = { created: 0, skipped: 0, failed: [] };
  let userItems;
  try {
    userItems = JSON.parse(getFromStorage("user_quizzes", "[]"));
    if (!Array.isArray(userItems)) throw new Error("not a list");
  } catch {
    showNotification("تعذّرت قراءة محتواي", "تعذّر تحميل العناصر المحفوظة. أصلح البيانات ثم حاول مجدداً.", "error");
    return result;
  }

  const list = Array.from(files || []);
  const pendingFiles = []; // [{ id, files }] workspace files to store after the row is saved
  let rememberedAction = null;

  for (let i = 0; i < list.length; i++) {
    const file = list[i];
    try {
      const { rec, files: wsFiles } = await readNotebookFile(file);
      rec.title = String(rec.title || "").trim() || baseNameOf(file.name) || "دفتر بدون عنوان";
      const { errors } = validateNotebookRecord(rec);
      if (errors.length) { result.failed.push({ name: file.name, reason: errors[0] }); continue; }

      let title = rec.title;
      if (hasSameLevelCollision(userItems, { type: "notebook", title, parentId })) {
        let action = rememberedAction;
        if (!action) {
          const answer = await ask(title, { moreConflictsPossible: i < list.length - 1 });
          action = answer.action;
          if (answer.applyAll) rememberedAction = action;
        }
        if (action === "skip") { result.skipped++; continue; }
        title = dedupeTitle(title, (t) => hasSameLevelCollision(userItems, { type: "notebook", title: t, parentId }));
      }

      const entry = buildLocalNotebookEntry({ rec, title, parentId });
      userItems.push(entry);
      if (wsFiles.length) pendingFiles.push({ id: entry.id, files: wsFiles });
      result.created++;
    } catch (error) {
      const reason = error instanceof NotebookInputError ? [error.headline, ...(error.details || [])].filter(Boolean).slice(0, 2).join(" — ") : (error?.message || "ملف غير صالح");
      result.failed.push({ name: file.name, reason });
    }
  }

  if (result.created) {
    if (!setInStorage("user_quizzes", JSON.stringify(userItems))) {
      showNotification("تعذّر حفظ الدفاتر", "تعذّر الحفظ محلياً. قد تكون مساحة التخزين ممتلئة — احذف عناصر غير مستخدمة ثم أعد المحاولة.", "error");
      return { created: 0, skipped: result.skipped, failed: [...result.failed, { name: "—", reason: "تعذّر الحفظ" }] };
    }
    if (pendingFiles.length) {
      const store = await import("../../shared/workspace-store.js");
      for (const { id, files: wsFiles } of pendingFiles) {
        for (const f of wsFiles) { try { await store.putFile(id, f); } catch (e) { console.warn("[notebook-file-import] workspace file skipped:", f.name, e); } }
      }
    }
  }
  return result;
}

/** One summary notification for a whole drop (e.g. «تم إنشاء 4 دفاتر، تخطّي 1، فشل 0»). */
export function notifyNotebookImportSummary({ created, skipped, failed }) {
  if (!created && !skipped && !failed.length) return;
  const parts = [];
  if (created) parts.push(`تم إنشاء ${created} ${created === 1 ? "دفتر" : "دفاتر"}`);
  if (skipped) parts.push(`تخطّي ${skipped}`);
  if (failed.length) parts.push(`فشل ${failed.length}`);
  const details = failed.slice(0, 3).map((f) => `• ${f.name}: ${f.reason}`).join("\n");
  const body = [parts.join("، "), details].filter(Boolean).join("\n");
  showNotification(created ? "استيراد الدفاتر" : "تعذّر استيراد الدفاتر", body, failed.length ? (created ? "warning" : "error") : "success");
}

/**
 * Entry point wired to the «محتواي» drop zone: routes a mixed drop.
 * Quiz JSON keeps its old behaviour; notebooks are created at the current folder level.
 */
export async function handleMyContentDrop(files) {
  const { quizFiles, notebookFiles, unsupported } = partitionDroppedFiles(files);
  if (unsupported.length) {
    showNotification("ملفات غير مدعومة", `المدعوم: .json (امتحان) و .ipynb / .m / .zip (دفتر). تم تجاهل:\n${unsupported.map((f) => f.name).join(", ")}`, "warning");
  }
  let notebooksChanged = false;
  if (notebookFiles.length) {
    const summary = await importNotebookFiles(notebookFiles);
    notifyNotebookImportSummary(summary);
    notebooksChanged = summary.created > 0;
  }
  if (quizFiles.length) {
    await importJsonQuizFiles(quizFiles); // refreshes the view itself
  } else if (notebooksChanged) {
    const { renderUserQuizzesView } = await import("./user-quizzes-view.js");
    renderUserQuizzesView();
  }
}
