import { getFromStorage, setInStorage } from "../../shared/storage-helpers.js";
import { showNotification } from "../../components/notifications/notifications.js";
import { hasSameLevelCollision } from "./user-quizzes-folders.js";
import { renderUserQuizzesView } from "./user-quizzes-view.js";
import { wireModalDismiss, fadeOutAndRemove } from "./modal-utils.js";

const LESSON_CREATION_PROMPT = `اكتب درسًا تعليميًا واضحًا ومنظمًا بصيغة Markdown فقط، دون مقدمة خارج الدرس أو أسوار كود. استخدم عناوين الأقسام (##)، وشرحًا مفصلًا مناسبًا للمذاكرة، وأمثلة عند الحاجة، ونقاطًا مختصرة للمراجعة في النهاية. لا تخترع مراجع أو معلومات غير مؤكدة.`;

export function openInlineCreateLessonModal() {
  if (!document.getElementById("modal-pop-in-style")) {
    const style = document.createElement("style");
    style.id = "modal-pop-in-style";
    style.textContent = `
      @keyframes modalPopIn {
        to { transform: translateY(0); opacity: 1; }
      }
    `;
    document.head.appendChild(style);
  }

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "inlineCreateLessonTitle");
  overlay.style.cssText = `
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    background: rgba(0, 0, 0, 0.6);
  `;

  const modalCard = document.createElement("div");
  modalCard.className = "modal-card create-quiz-inline-modal";
  modalCard.innerHTML = `
    <div class="create-quiz-modal__header">
      <h2 id="inlineCreateLessonTitle" class="create-quiz-modal__title">
        <svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5Z"/><path d="M8 7h8M8 11h8M8 15h5"/></svg>
        إنشاء درس جديد
      </h2>
      <button type="button" id="inlineLessonPrompt" class="create-quiz-modal__copy-prompt-btn" aria-label="نسخ برومبت إنشاء درس">Prompt</button>
      <button type="button" id="inlineLessonClose" class="create-quiz-modal__close-btn" aria-label="إغلاق">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
      </button>
    </div>
    <p class="create-quiz-modal__subtitle">أدخل عنوان الدرس ومحتواه. يمكنك كتابة المحتوى بتنسيق Markdown.</p>
    <div class="create-quiz-modal__form-group">
      <label for="inlineLessonTitle" class="create-quiz-modal__label">عنوان الدرس</label>
      <input type="text" id="inlineLessonTitle" class="create-quiz-modal__input" maxlength="120" placeholder="مثال: مقدمة في علم التشريح" autocomplete="off">
    </div>
    <div class="create-quiz-modal__form-group create-quiz-modal__form-group--content">
      <label for="inlineLessonContent" class="create-quiz-modal__label">محتوى الدرس</label>
      <textarea id="inlineLessonContent" class="create-quiz-modal__textarea" rows="7" placeholder="اكتب محتوى الدرس هنا…"></textarea>
    </div>
    <div class="create-quiz-modal__actions">
      <div class="create-quiz-modal__main-actions">
        <button type="button" id="inlineLessonCreate" class="inline-quiz-btn create-quiz-modal__btn create-quiz-modal__btn--create">إنشاء الدرس ✨</button>
      </div>
    </div>
  `;
  overlay.appendChild(modalCard);
  document.body.appendChild(overlay);

  const titleInput = modalCard.querySelector("#inlineLessonTitle");
  const contentInput = modalCard.querySelector("#inlineLessonContent");
  const close = wireModalDismiss(overlay, () => fadeOutAndRemove(overlay, modalCard));
  modalCard.querySelector("#inlineLessonClose").addEventListener("click", close);

  modalCard.querySelector("#inlineLessonPrompt").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(LESSON_CREATION_PROMPT);
      showNotification("تم نسخ البرومبت", "الصقه في أداة الذكاء الاصطناعي لكتابة محتوى الدرس.", "success");
    } catch (error) {
      console.error("[create-lesson-modal] clipboard copy failed:", error);
      showNotification("تعذّر نسخ البرومبت", "انسخ البرومبت يدوياً أو اسمح للمتصفح باستخدام الحافظة.", "error");
    }
  });

  const createLesson = () => {
    const title = titleInput.value.trim();
    const body = contentInput.value.trim();
    if (!title) {
      showNotification("عنوان الدرس مطلوب", "اكتب عنوان الدرس أولاً.", "warning");
      titleInput.focus();
      return;
    }
    if (!body) {
      showNotification("محتوى الدرس مطلوب", "أضف محتوى الدرس قبل إنشائه.", "warning");
      contentInput.focus();
      return;
    }

    let userItems;
    try {
      const stored = JSON.parse(getFromStorage("user_quizzes", "[]"));
      if (!Array.isArray(stored)) throw new Error("بيانات امتحاناتك ليست قائمة صالحة.");
      userItems = stored;
    } catch (error) {
      console.error("[create-lesson-modal] workspace read failed:", error);
      showNotification("تعذّرت قراءة امتحاناتك", "تعذّر تحميل العناصر المحفوظة. أصلح البيانات ثم حاول مجدداً.", "error");
      return;
    }

    if (hasSameLevelCollision(userItems, { type: "lesson", title, parentId: null })) {
      showNotification("تعذّر إنشاء الدرس", "يوجد درس بالاسم نفسه في المستوى الرئيسي من امتحاناتك.", "warning");
      return;
    }

    const id = `user_lesson_${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    userItems.push({
      id,
      meta: {
        type: "lesson",
        title,
        parentId: null,
        createdAt: new Date().toLocaleString("en-US"),
        updatedAt: now,
        readerPrefs: { fontId: "default" },
        description: "",
        source: "",
        passwordProtected: false,
      },
      stats: { questionCount: 0, sectionCount: 1 },
      lesson: {
        sections: [{
          id: `s${Date.now().toString(36)}`,
          title: "",
          defaultHidden: false,
          blocks: [{ type: "markdown", body }],
        }],
      },
      passwordHash: null,
      questions: [],
    });

    if (!setInStorage("user_quizzes", JSON.stringify(userItems))) {
      showNotification("تعذّر حفظ الدرس", "تعذّر حفظ الدرس محلياً. قد تكون مساحة التخزين ممتلئة.", "error");
      return;
    }
    close();
    renderUserQuizzesView();
    showNotification("تم إنشاء الدرس", 'يمكنك العثور عليه في "امتحاناتك".', "success");
  };

  modalCard.querySelector("#inlineLessonCreate").addEventListener("click", createLesson);
  titleInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      createLesson();
    }
  });
  setTimeout(() => titleInput.focus(), 50);
}
