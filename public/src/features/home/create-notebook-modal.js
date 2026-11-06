// "دفتر جديد" modal for محتواي — creates a LOCAL notebook (browser only,
// stored in user_quizzes with meta.type "notebook"). Accepts pasted notebook
// JSON (see NOTEBOOK_CREATION_PROMPT), a pasted raw .ipynb JSON, or an
// uploaded .ipynb / .m file. Uses the same shared validation as the admin
// editor, the API and the MCP server.
import { buildLocalNotebookEntry } from "./local-notebook.js";
import { getFromStorage, setInStorage } from "../../shared/storage-helpers.js";
import { showNotification } from "../../components/notifications/notifications.js";
import { hasSameLevelCollision, currentFolderId } from "./user-quizzes-folders.js";
import { renderUserQuizzesView } from "./user-quizzes-view.js";
import { wireModalDismiss, fadeOutAndRemove } from "./modal-utils.js";
import { NOTEBOOK_CREATION_PROMPT, NotebookInputError, parseNotebookInput, validateNotebookRecord } from "./notebook-input.js";

const UPLOAD_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg>`;
const MAX_LISTED = 6;

export function openInlineCreateNotebookModal() {
  if (!document.getElementById("modal-pop-in-style")) {
    const style = document.createElement("style");
    style.id = "modal-pop-in-style";
    style.textContent = `@keyframes modalPopIn { to { transform: translateY(0); opacity: 1; } }`;
    document.head.appendChild(style);
  }

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "inlineCreateNotebookTitle");
  overlay.style.cssText = "backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); background: rgba(0, 0, 0, 0.6);";

  const modalCard = document.createElement("div");
  modalCard.className = "modal-card create-quiz-inline-modal create-notebook-modal";
  modalCard.innerHTML = `
    <div class="create-notebook-modal__scroll">
      <div class="create-quiz-modal__header">
        <h2 id="inlineCreateNotebookTitle" class="create-quiz-modal__title">
          <svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="m8 10 3 2-3 2"/><path d="M13 15h3"/></svg>
          إنشاء دفتر جديد
        </h2>
        <button type="button" id="inlineNotebookPrompt" class="create-quiz-modal__copy-prompt-btn" aria-label="نسخ برومبت إنشاء دفتر">Prompt</button>
        <button type="button" id="inlineNotebookClose" class="create-quiz-modal__close-btn" aria-label="إغلاق">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
        </button>
      </div>
      <p class="create-quiz-modal__subtitle">الصق JSON الدفتر (انسخ البرومبت أولاً وأعطه لأداة الذكاء الاصطناعي)، أو ارفع ملف Jupyter <code>.ipynb</code> أو سكريبت MATLAB <code>.m</code>.</p>
      <div class="create-quiz-modal__form-group create-quiz-modal__form-group--content">
        <label for="inlineNotebookJson" class="create-quiz-modal__label">JSON الدفتر</label>
        <textarea id="inlineNotebookJson" class="create-quiz-modal__textarea" rows="7" spellcheck="false" dir="ltr" aria-describedby="inlineNotebookFeedback" placeholder='{"title":"...","description":"...","source":"https://...","runtime":"matlab","cells":[{"type":"markdown","source":"..."},{"type":"code","source":"x = 1:5"}]}'></textarea>
        <div id="inlineNotebookFile" class="create-notebook-modal__file" hidden></div>
      </div>
      <div id="inlineNotebookFeedback" class="create-notebook-modal__feedback" role="alert" aria-live="assertive" hidden></div>
      <div class="create-quiz-modal__actions">
        <div class="create-quiz-modal__main-actions">
          <button type="button" id="inlineNotebookImport" class="inline-quiz-btn create-quiz-modal__btn create-quiz-modal__btn--import">${UPLOAD_ICON}رفع ملف</button>
          <button type="button" id="inlineNotebookCreate" class="inline-quiz-btn create-quiz-modal__btn create-quiz-modal__btn--create">إنشاء الدفتر ✨</button>
        </div>
      </div>
      <input type="file" id="inlineNotebookFileInput" class="create-quiz-modal__file-input" accept=".ipynb,.m" />
    </div>
  `;
  overlay.appendChild(modalCard);
  document.body.appendChild(overlay);

  const $ = (sel) => modalCard.querySelector(sel);
  const jsonInput = $("#inlineNotebookJson");
  const fileInput = $("#inlineNotebookFileInput");
  const feedback = $("#inlineNotebookFeedback");
  const fileChip = $("#inlineNotebookFile");
  const close = wireModalDismiss(overlay, () => fadeOutAndRemove(overlay, modalCard), { dismissOnBackdrop: false });
  $("#inlineNotebookClose").addEventListener("click", close);

  let pickedFile = null; // { name, text }

  const clearFeedback = () => { feedback.hidden = true; feedback.replaceChildren(); feedback.className = "create-notebook-modal__feedback"; jsonInput.removeAttribute("aria-invalid"); };

  /** kind: "error" | "info"; details: string[]; loc: {line,column,snippet,caret}|null */
  function showFeedback(kind, headline, details = [], loc = null) {
    feedback.replaceChildren();
    feedback.className = `create-notebook-modal__feedback create-notebook-modal__feedback--${kind}`;
    const h = document.createElement("strong");
    h.textContent = headline;
    feedback.append(h);
    if (details.length) {
      const ul = document.createElement("ul");
      for (const d of details) { const li = document.createElement("li"); li.textContent = d; ul.append(li); }
      feedback.append(ul);
    }
    if (loc?.snippet) {
      const pre = document.createElement("pre");
      pre.dir = "ltr";
      pre.textContent = `${loc.line}| ${loc.snippet}\n${" ".repeat(String(loc.line).length + 2 + Math.max(0, loc.caret))}^`;
      feedback.append(pre);
    }
    feedback.hidden = false;
    if (kind === "error") jsonInput.setAttribute("aria-invalid", "true");
    feedback.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function showFailure(error) {
    if (error instanceof NotebookInputError) {
      showFeedback("error", error.headline, error.details, error.loc);
      if (error.loc && !pickedFile) {
        jsonInput.focus();
        try { jsonInput.setSelectionRange(error.loc.offset, Math.min(jsonInput.value.length, error.loc.offset + 1)); } catch { /* ignore */ }
      }
    } else {
      console.error("[create-notebook-modal] unexpected error:", error);
      showFeedback("error", "حدث خطأ غير متوقع", [error?.message || String(error)]);
    }
  }

  function validationDetails(errors) {
    const list = errors.slice(0, MAX_LISTED);
    if (errors.length > MAX_LISTED) list.push(`… و${errors.length - MAX_LISTED} أخطاء أخرى.`);
    return list;
  }

  function renderFileChip() {
    fileChip.replaceChildren();
    if (!pickedFile) { fileChip.hidden = true; return; }
    const name = document.createElement("span");
    name.textContent = `الملف المحدد: ${pickedFile.name}`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "إزالة ✕";
    remove.setAttribute("aria-label", "إزالة الملف المحدد");
    remove.addEventListener("click", () => { pickedFile = null; fileInput.value = ""; renderFileChip(); clearFeedback(); });
    fileChip.append(name, remove);
    fileChip.hidden = false;
  }

  $("#inlineNotebookImport").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    const f = fileInput.files?.[0];
    fileInput.value = "";
    if (!f) return;
    clearFeedback();
    if (!/\.(ipynb|m)$/i.test(f.name)) {
      showFeedback("error", "نوع الملف غير مدعوم", [`الملف «${f.name}» ليس .ipynb ولا .m.`, "المدعوم: ملفات Jupyter (.ipynb) وسكريبتات MATLAB (.m)."]);
      return;
    }
    try {
      pickedFile = { name: f.name, text: await f.text() };
    } catch {
      showFeedback("error", "تعذّرت قراءة الملف", ["لم يتمكن المتصفح من قراءة الملف. جرّب ملفاً آخر."]);
      return;
    }
    jsonInput.value = "";
    renderFileChip();
    try { // check it right away so problems show before pressing "إنشاء"
      const rec = parseNotebookInput({ text: pickedFile.text, fileName: pickedFile.name });
      const v = validateNotebookRecord(rec);
      if (v.errors.length) showFeedback("error", `ملاحظات على ${pickedFile.name}`, validationDetails(v.errors));
      else showFeedback("info", `تم تحميل ${pickedFile.name}: ${rec.content.cells.length} خلية جاهزة`, [...rec.warnings, ...v.warnings].slice(0, 4).concat("اضغط «إنشاء الدفتر» للحفظ."));
    } catch (error) { showFailure(error); }
  });
  jsonInput.addEventListener("input", () => {
    if (jsonInput.value.trim() && pickedFile) { pickedFile = null; renderFileChip(); }
    if (!feedback.hidden) clearFeedback();
  });

  $("#inlineNotebookPrompt").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(NOTEBOOK_CREATION_PROMPT);
      showNotification("تم نسخ البرومبت", "الصقه في أداة الذكاء الاصطناعي ثم أرفق مادتك.", "success");
    } catch (error) {
      console.error("[create-notebook-modal] clipboard copy failed:", error);
      showNotification("تعذّر نسخ البرومبت", "انسخ البرومبت يدوياً أو اسمح للمتصفح باستخدام الحافظة.", "error");
    }
  });

  const createNotebook = () => {
    clearFeedback();
    let rec;
    try {
      rec = parseNotebookInput(pickedFile ? { text: pickedFile.text, fileName: pickedFile.name } : { text: jsonInput.value });
    } catch (error) {
      showFailure(error);
      return;
    }
    const { errors, warnings } = validateNotebookRecord(rec);
    if (errors.length) {
      showFeedback("error", `بيانات الدفتر غير صالحة (${errors.length})`, validationDetails(errors));
      return;
    }

    let userItems;
    try {
      const stored = JSON.parse(getFromStorage("user_quizzes", "[]"));
      if (!Array.isArray(stored)) throw new Error("not a list");
      userItems = stored;
    } catch (error) {
      console.error("[create-notebook-modal] workspace read failed:", error);
      showFeedback("error", "تعذّرت قراءة محتواي", ["تعذّر تحميل العناصر المحفوظة. أصلح البيانات ثم حاول مجدداً."]);
      return;
    }

    const title = rec.title.trim();
    const targetParentId = currentFolderId || null;
    if (hasSameLevelCollision(userItems, { type: "notebook", title, parentId: targetParentId })) {
      showFeedback("error", "تعذّر إنشاء الدفتر", [targetParentId
        ? `يوجد دفتر باسم «${title}» في هذا المجلد بالفعل. غيّر العنوان (title) في JSON.`
        : `يوجد دفتر باسم «${title}» في المستوى الرئيسي من محتواي. غيّر العنوان (title) في JSON.`]);
      return;
    }

    userItems.push(buildLocalNotebookEntry({ rec, title, parentId: targetParentId }));

    if (!setInStorage("user_quizzes", JSON.stringify(userItems))) {
      showFeedback("error", "تعذّر حفظ الدفتر", ["تعذّر الحفظ محلياً. قد تكون مساحة التخزين ممتلئة — احذف عناصر غير مستخدمة ثم أعد المحاولة."]);
      return;
    }
    close();
    renderUserQuizzesView();
    const extra = [...rec.warnings, ...warnings];
    showNotification("تم إنشاء الدفتر",
      extra.length ? extra.slice(0, 2).join("\n")
        : targetParentId ? "تم إنشاء الدفتر وإضافته إلى هذا المجلد بنجاح." : 'يمكنك العثور عليه في "محتواي".',
      "success");
  };

  $("#inlineNotebookCreate").addEventListener("click", createNotebook);
  setTimeout(() => jsonInput.focus(), 50);
}
