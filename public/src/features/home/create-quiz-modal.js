// ============================================================================
// public/src/features/home/create-quiz-modal.js
// CREATE-QUIZ MODALS
// ============================================================================
// Two related flows, both reachable from the "إمتحاناتك" (My Quizzes) view:
//   1. openPromptSelectionModal() — pick one of the three AI prompt presets
//      (see ai-prompts.js) and copy it to clipboard for use with an external AI.
//   2. createInlineCreateQuizCard()/openInlineCreateQuizModal() — paste text or
//      import a file, parse it into quiz JSON, and save it to localStorage.
//
// Both modals previously leaked a document-level Escape-key listener whenever
// closed via a button rather than Escape/overlay-click — fixed here using the
// shared wireModalDismiss() helper (see modal-utils.js).
// ============================================================================

import { getFromStorage, setInStorage } from "../../shared/storage-helpers.js";
import { parseQuizJson } from "../../shared/quiz-json.js";
import { wireModalDismiss, fadeOutAndRemove } from "./modal-utils.js";
import { UPLOAD_ICON_SVG } from "./icons.js";
import {
  General_Purpose_AI_Prompt,
  English_Specializing_Prompt,
  Math_Specializing_Prompt,
} from "./ai-prompts.js";
import { buildUserQuizEntry } from "./quiz-schema.js";
import { renderRootCategories } from "./root-view.js";
import { renderUserQuizzesView } from "./user-quizzes-view.js";
import { showNotification } from "../../components/notifications/notifications.js";

export function createInlineCreateQuizCard() {
  const card = document.createElement("div");
  card.className = "exam-card user-create-quiz-card";
  card.setAttribute("role", "button");
  card.setAttribute("tabindex", "0");
  card.setAttribute("title", "تحويل نص ← امتحان");
  card.setAttribute("aria-label", "إنشاء إمتحان جديد من نص");

  // Desktop-only large centered icon (hidden on mobile via CSS)
  const icon = document.createElement("div");
  icon.className = "icon";
  icon.textContent = "➕";
  icon.setAttribute("aria-hidden", "true");

  // card-text wrapper (display:contents on desktop, flex column on mobile)
  const textWrap = document.createElement("div");
  textWrap.className = "card-text";

  const titleEl = document.createElement("h3");
  titleEl.innerHTML = `<span class="user-quiz--phone-only-emoji">➕</span> إنشاء إمتحان جديد`;

  const desc = document.createElement("p");
  desc.className = "create-quiz-card-subtitle";
  desc.textContent =
    "الصق أسئلة الإمتحان كنص وسيتم تحويلها تلقائيًا إلى امتحان.";

  textWrap.appendChild(titleEl);
  textWrap.appendChild(desc);

  card.appendChild(icon);
  card.appendChild(textWrap);

  const open = () => openInlineCreateQuizModal();
  card.onclick = open;
  card.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      open();
    }
  });

  return card;
}

function openInlineCreateQuizModal() {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "inlineCreateQuizTitle");
  overlay.style.cssText = `
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    background: rgba(0, 0, 0, 0.6);
  `;

  const modalCard = document.createElement("div");
  modalCard.className = "modal-card create-quiz-inline-modal";

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

modalCard.innerHTML = `
    <h2 id="inlineCreateQuizTitle" class="create-quiz-modal__title">
      <svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-file-plus create-quiz-modal__title-icon"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M9 15h6"/><path d="M12 18v-6"/></svg>
      إنشاء إمتحان جديد
      <button type="button" id="copyAiPromptBtn" class="create-quiz-modal__copy-prompt-btn">
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-sparkles create-quiz-modal__copy-prompt-btn-icon"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/></svg>
        Prompt
        <span id="createQuizPromptHintArrow" class="create-quiz-modal__prompt-hint-arrow" aria-hidden="true">
        <svg xmlns="http://www.w3.org/2000/svg" width="35" height="18" viewBox="0 0 44 18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M42 9H4"/><path d="m11 2-7 7 7 7"/></svg>
        </span>
      </button>
    </h2>
    <p class="create-quiz-modal__subtitle">قم باستخدام ميزة الـ \`prompt\` لتحويل أي إمتحان تملكه إلى كود باستخدام الذكاء الإصطناعي</p>
    <div class="create-quiz-modal__form-group">
      <label for="inlineQuizTitle" class="create-quiz-modal__label">عنوان الإمتحان</label>
      <input type="text" id="inlineQuizTitle" class="create-quiz-modal__input" placeholder="Arrays in C++" />
    </div>
    <div class="create-quiz-modal__form-group create-quiz-modal__form-group--content">
      <label for="inlineQuizContent" class="create-quiz-modal__label">محتوى الإمتحان</label>
      <textarea id="inlineQuizContent" class="inline-quiz-textarea create-quiz-modal__textarea" rows="4"></textarea>
    </div>
    <div class="create-quiz-modal__actions">
      <div class="create-quiz-modal__main-actions">
        <button type="button" id="inlineQuizImport" class="inline-quiz-btn create-quiz-modal__btn create-quiz-modal__btn--import">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-upload"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg>
          استيراد ملف
        </button>
        <button type="button" id="inlineQuizCreate" class="inline-quiz-btn create-quiz-modal__btn create-quiz-modal__btn--create">إنشاء  ✨</button>
      </div>
      <button type="button" id="inlineQuizCancel" class="create-quiz-modal__btn create-quiz-modal__btn--cancel">إلغاء</button>
    </div>
    <input type="file" id="inlineQuizFileInput" class="create-quiz-modal__file-input" accept=".json,application/json" />
  `;

  // Set the JSON example via JS (avoids escaping a huge quoted blob inside an HTML attribute)
  const placeholderJSON = `{
  "questions": [
    {
      "q": "«إنَّ مستشارِي الغدِ مُهيَّؤون لِحمْلِ الأمانةِ.»\\n\\nعند وضع الفعل (عسى) بدلاً من الحرف الناسخ (إنّ)، تصبح الجملة الصحيحة:",
      "explanation": "الفعل (عسى) من أفعال الرجاء يعمل عمل كان برفع الاسم ونصب الخبر، ويشترط في خبره أن يكون جملة فعلية فعلها مضارع ويكثر اقترانها بـ (أن). وبناءً عليه: اسم عسى مرفوع وعلامة رفعه الواو لأنه جمع مذكر سالم وحذفت النون للإضافة فيصبح (مستشارو)، والخبر المقترن بأن الناصبة يصبح الفعل المضارع بعده منصوبًا بحذف النون (أن يُهيَّؤوا).",
      "options": [
        "عسى مستشاري الغدِ أنْ يُهيَّؤوا لِحملِ الأمانةِ.",
        "عسى مستشارو الغدِ مُهيَّئين لِحملِ الأمانةِ.",
        "عسى مستشارو الغدِ أنْ يُهيَّؤوا لِحملِ الأمانةِ.",
        "عسى مستشارو الغدِ يُهيَّؤون لِحملِ الأمانةِ."
      ],
      "correct": 2
    },
    {
      "q": "«من أخلص في عمله، نال تقدير مجتمعه.»\\n\\nصُغ من الجملة السابقة أسلوب شرط مستخدمًا (مَنْ) الشرطية الجازمة، مع جعل فعل جواب الشرط مقترنًا بالفاء، واضبط الفعلين بالشكل.",
      "explanation": "عند تحويل أسلوب الشرط للمضارع الجازم، يُجزم فعل الشرط بالسكون لأنه صحيح الآخر. واقتران جواب الشرط بالفاء يستوجب وجود مسوغ (اسمية طلبية وبجامد وبما وقد وبلن وبالتنفيس)، وعند اختيار السين أو سوف يرتفع المضارع بعدها وتصبح الجملة في محل جزم.",
      "answer": "الصياغة الصحيحة للأسلوب هي:\\n**«مَنْ يُخْلِصْ في عمله، فَسَيَنَالُ تقدير مجتمعه.»** (أو: فَقَدْ يَنَالُ / فَسَوْفَ يَنَالُ)\\n\\n**ضبط الفعلين بالشكل:**\\n1. **يُخْلِصْ:** فعل مضارع مجزوم (فعل الشرط) وعلامة جزمه السكون.\\n2. **يَنَالُ:** فعل مضارع مرفوع وعلامة رفعه الضمة الظاهرة، لأن اقتران جواب الشرط بالفاء ودخول السين/سوف يمنع الجزم المباشر عن الفعل، وتصبح الجملة الفعلية بأكملها (فسينال...) في محل جزم جواب الشرط."
    }
  ]
}`;

  const inlineQuizContentEl = modalCard.querySelector("#inlineQuizContent");
  inlineQuizContentEl.placeholder = placeholderJSON;

  // Bouncing hint arrow above the Prompt button — dismiss it once the user
  // actually notices/clicks the button, so it doesn't nag indefinitely.
  const copyAiPromptBtn = modalCard.querySelector("#copyAiPromptBtn");
  const promptHintArrow = modalCard.querySelector("#createQuizPromptHintArrow");

  const dismissPromptHint = () => {
    promptHintArrow.classList.add("create-quiz-modal__prompt-hint-arrow--hidden");
  };

  copyAiPromptBtn.addEventListener("click", dismissPromptHint, { once: true });

  overlay.appendChild(modalCard);
  document.body.appendChild(overlay);

  const titleInput = modalCard.querySelector("#inlineQuizTitle");
  const contentInput = modalCard.querySelector("#inlineQuizContent");
  const cancelBtn = modalCard.querySelector("#inlineQuizCancel");
  const createBtn = modalCard.querySelector("#inlineQuizCreate");
  const importBtn = modalCard.querySelector("#inlineQuizImport");
  const fileInput = modalCard.querySelector("#inlineQuizFileInput");
  const copyPromptBtn = modalCard.querySelector("#copyAiPromptBtn");

  if (copyPromptBtn) {
    copyPromptBtn.onclick = (e) => {
      e.stopPropagation();
      openPromptSelectionModal();
    };
    copyPromptBtn.onmouseover = () => {
      copyPromptBtn.style.borderColor = "var(--color-primary)";
      copyPromptBtn.style.color = "var(--color-primary)";
    };
    copyPromptBtn.onmouseout = () => {
      copyPromptBtn.style.borderColor = "var(--color-border)";
      copyPromptBtn.style.color = "var(--color-text-secondary)";
    };
  }

  importBtn.onmouseover = () => {
    importBtn.style.borderColor = "var(--color-primary)";
    importBtn.style.color = "var(--color-primary)";
  };
  importBtn.onmouseout = () => {
    importBtn.style.borderColor = "var(--color-border)";
    importBtn.style.color = "var(--color-text-primary)";
  };
  cancelBtn.onmouseover = () => {
    cancelBtn.style.background = "var(--color-background-secondary)";
    cancelBtn.style.color = "var(--color-text-primary)";
  };
  cancelBtn.onmouseout = () => {
    cancelBtn.style.background = "transparent";
    cancelBtn.style.color = "var(--color-text-secondary)";
  };
  createBtn.onmouseover = () => {
    createBtn.style.transform = "translateY(-2px)";
    createBtn.style.boxShadow = "0 6px 20px rgba(220, 38, 38, 0.5)";
  };
  createBtn.onmouseout = () => {
    createBtn.style.transform = "translateY(0)";
    createBtn.style.boxShadow = "0 4px 14px rgba(220, 38, 38, 0.4)";
  };

  // BUG FIX: same leaked-listener issue as openPromptSelectionModal() above —
  // wireModalDismiss() guarantees the Escape listener is removed no matter
  // which button triggers the close.
  const close = wireModalDismiss(overlay, () =>
    fadeOutAndRemove(overlay, modalCard),
  );

  cancelBtn.onclick = close;

  importBtn.onclick = () => fileInput.click();

  fileInput.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    importBtn.innerHTML =
      '<span class="adm-spinner" style="margin: 0; border-color: var(--color-primary); border-top-color: transparent;"></span> استخراج...';
    importBtn.disabled = true;

    try {
      const text = await file.text();
      contentInput.value = text;

      const defaultTitle = file.name
        .replace(/\.json$/i, "")
        .replace(/[-_]/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());

      if (!titleInput.value) {
        titleInput.value = defaultTitle;
      }

      // Prefill title from JSON meta when present
      try {
        const parsed = parseQuizJson(text, defaultTitle);
        if (parsed.meta?.title && !titleInput.value) {
          titleInput.value = parsed.meta.title;
        } else if (parsed.meta?.title && titleInput.value === defaultTitle) {
          titleInput.value = parsed.meta.title;
        }
      } catch (_) {
        /* leave raw text in the textarea for the user to fix */
      }

      showNotification(
        "نجاح",
        "تم تحميل ملف JSON، يمكنك تعديله أو إنشاء الكويز الآن.",
        "success",
      );
    } catch (err) {
      console.error("Import read error:", err);
      showNotification(
        "خطأ في القراءة",
        `تعذّر قراءة ${file.name}: ${err.message}`,
        "error",
      );
    } finally {
      importBtn.innerHTML = `${UPLOAD_ICON_SVG} استيراد ملف`;
      importBtn.disabled = false;
      fileInput.value = "";
    }
  };

  createBtn.onclick = async () => {
    const title = (titleInput.value || "").trim();
    const content = (contentInput.value || "").trim();
    if (!content) {
      showNotification("بيانات ناقصة", "الرجاء إدخال المحتوى.", "warning", 10);
      return;
    }

    let parsed;
    try {
      parsed = parseQuizJson(content, title || "Quiz");
    } catch (err) {
      showNotification("خطأ في التنسيق", err.message, "error", 10);
      return;
    }

    if (!parsed.questions || !parsed.questions.length) {
      showNotification(
        "لا توجد أسئلة",
        "لم يتم العثور على أسئلة صالحة في المحتوى.",
        "error",
      );
      return;
    }

    const quizzes = JSON.parse(getFromStorage("user_quizzes", "[]"));
    const quizId = crypto.randomUUID();

    quizzes.push(buildUserQuizEntry(quizId, parsed, title || "Untitled Quiz"));

    setInStorage("user_quizzes", JSON.stringify(quizzes));
    close();
    showNotification(
      "تم الإنشاء",
      'تم إنشاء الإمتحان وإضافته إلى "إمتحاناتك"',
      "success",
    );
    renderRootCategories();
    renderUserQuizzesView();
  };

  // Escape-key and overlay-click dismissal are already wired by
  // wireModalDismiss() above — no separate handlers needed here.

  setTimeout(() => {
    titleInput.focus();
  }, 50);
}

/**
 * Open a prompt selection modal to choose between different AI prompts
 * (General Purpose, English Specializing, Math Specializing)
 */
export function openPromptSelectionModal() {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "promptSelectionTitle");
  overlay.style.cssText = `
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    background: rgba(0, 0, 0, 0.6);
  `;

  const modalCard = document.createElement("div");
  modalCard.className = "modal-card prompt-selection-modal";

  // Ensure modal pop-in style exists
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

  modalCard.innerHTML = `
    <h2 id="promptSelectionTitle" style="margin-bottom: 16px; font-size: 1.3rem; display: flex; align-items: center; gap: 10px; color: var(--color-text-primary);">
    <svg xmlns="http://www.w3.org/2000/svg" height="24" width="24" viewBox="0 -960 960 960" fill="currentColor" style="color: var(--color-primary);">
      <path d="M160-120v-200q0-33 23.5-56.5T240-400h480q33 0 56.5 23.5T800-320v200H160Zm200-320q-83 0-141.5-58.5T160-640q0-83 58.5-141.5T360-840h240q83 0 141.5 58.5T800-640q0 83-58.5 141.5T600-440H360ZM240-200h480v-120H240v120Zm120-320h240q50 0 85-35t35-85q0-50-35-85t-85-35H360q-50 0-85 35t-35 85q0 50 35 85t85 35Zm28.5-91.5Q400-623 400-640t-11.5-28.5Q377-680 360-680t-28.5 11.5Q320-657 320-640t11.5 28.5Q343-600 360-600t28.5-11.5Zm240 0Q640-623 640-640t-11.5-28.5Q617-680 600-680t-28.5 11.5Q560-657 560-640t11.5 28.5Q583-600 600-600t28.5-11.5ZM480-200Zm0-440Z"/>
    </svg>
      اختر البرومبت
    </h2>
    <p style="margin-bottom: 20px; color: var(--color-text-secondary); font-size: 0.95rem; line-height: 1.5;">اختر النموذج الأنسب لنوع الامتحان الذي تريد إنشاءه</p>
    
    <div class="prompt-buttons-container" style="display: flex; flex-direction: column; gap: 12px;">
      <button type="button" class="prompt-btn prompt-btn-general" data-prompt="general" style="padding: 14px 16px; border: 1.5px solid var(--color-border); border-radius: 12px; background: var(--color-background-secondary); color: var(--color-text-primary); font-family: inherit; font-size: 0.95rem; font-weight: 500; cursor: pointer; transition: all 0.2s; text-align: right;">
        <div style="display: flex; align-items: center; gap: 12px;">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-lightbulb" style="flex-shrink: 0;"><path d="M15 12c0 1.657-1.343 3-3 3s-3-1.343-3-3"/><path d="M9 17H7a2 2 0 0 0-2 2v2h12v-2a2 2 0 0 0-2-2h-2"/><path d="M12 21v1"/><path d="M9 12h6"/></svg>
          <div style="text-align: right;">
            <div style="font-weight: 600; font-size: 1rem;">الاستخدام العام</div>
            <div style="font-size: 0.85rem; color: var(--color-text-secondary); margin-top: 2px;">تحويل أي نوع امتحان إلى JSON</div>
          </div>
        </div>
      </button>
      
      <button type="button" class="prompt-btn prompt-btn-english" data-prompt="english" style="padding: 14px 16px; border: 1.5px solid var(--color-border); border-radius: 12px; background: var(--color-background-secondary); color: var(--color-text-primary); font-family: inherit; font-size: 0.95rem; font-weight: 500; cursor: pointer; transition: all 0.2s; text-align: right;">
        <div style="display: flex; align-items: center; gap: 12px;">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-book-open" style="flex-shrink: 0;"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
          <div style="text-align: right;">
            <div style="font-weight: 600; font-size: 1rem;">اللغة الإنجليزية</div>
            <div style="font-size: 0.85rem; color: var(--color-text-secondary); margin-top: 2px;">تخصص في امتحانات اللغة الإنجليزية</div>
          </div>
        </div>
      </button>
      
      <button type="button" class="prompt-btn prompt-btn-math" data-prompt="math" style="padding: 14px 16px; border: 1.5px solid var(--color-border); border-radius: 12px; background: var(--color-background-secondary); color: var(--color-text-primary); font-family: inherit; font-size: 0.95rem; font-weight: 500; cursor: pointer; transition: all 0.2s; text-align: right;">
        <div style="display: flex; align-items: center; gap: 12px;">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-function-square" style="flex-shrink: 0;"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><path d="M9 17c0-1 1-4 3-5m0 0c2-1 3-4 3-5s-1-3-3-3-3 1-3 3m0 0c-1 2-2 3-2 5"/></svg>
          <div style="text-align: right;">
            <div style="font-weight: 600; font-size: 1rem;">الرياضيات والعلوم</div>
            <div style="font-size: 0.85rem; color: var(--color-text-secondary); margin-top: 2px;">تخصص في المعادلات والمسائل الحسابية</div>
          </div>
        </div>
      </button>
    </div>
    
    <div style="margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--color-border); display: flex; justify-content: flex-end;">
      <button type="button" id="promptSelectionCancel" style="padding: 10px 16px; background: transparent; border: 1.5px solid var(--color-border); border-radius: 8px; color: var(--color-text-secondary); font-family: inherit; cursor: pointer; transition: all 0.2s;">إغلاق</button>
    </div>
  `;

  overlay.appendChild(modalCard);
  document.body.appendChild(overlay);

  const promptButtons = modalCard.querySelectorAll(".prompt-btn");
  const cancelBtn = modalCard.querySelector("#promptSelectionCancel");

  // Close modal function — MUST be defined before being referenced.
  // BUG FIX: previously this modal only removed its document-level Escape
  // listener from the Escape-key handler and the overlay-click handler —
  // closing via a prompt button or the Cancel button leaked that listener
  // forever. wireModalDismiss() centralizes cleanup so every close path
  // (button clicks included) removes it exactly once. See modal-utils.js.
  const close = wireModalDismiss(overlay, () =>
    fadeOutAndRemove(overlay, modalCard),
  );

  // Handle button hover effects and click handlers
  promptButtons.forEach((btn) => {
    btn.onmouseover = () => {
      btn.style.borderColor = "var(--color-primary)";
      btn.style.background = "var(--color-background)";
      btn.style.transform = "translateX(-4px)";
    };
    btn.onmouseout = () => {
      btn.style.borderColor = "var(--color-border)";
      btn.style.background = "var(--color-background-secondary)";
      btn.style.transform = "translateX(0)";
    };

    // Copy prompt on click
    btn.onclick = async (e) => {
      e.stopPropagation();
      let promptText = "";
      const promptType = btn.getAttribute("data-prompt");

      if (promptType === "general") {
        promptText = General_Purpose_AI_Prompt;
      } else if (promptType === "english") {
        promptText = English_Specializing_Prompt;
      } else if (promptType === "math") {
        promptText = Math_Specializing_Prompt;
      }

      try {
        await navigator.clipboard.writeText(promptText);
        close();
        const promptLabel = {
          general: "البرومبت العام",
          english: "برومبت اللغة الإنجليزية",
          math: "برومبت الرياضيات",
        }[promptType];
        showNotification(
          "تم نسخ البرومبت",
          `تم نسخ ${promptLabel}، يمكنك الآن لصقه في أي ذكاء اصطناعي`,
          "success",
        );
      } catch (err) {
        console.error("Clipboard copy error:", err);
        showNotification(
          "خطأ في النسخ",
          "فشل نسخ البرومبت. حاول مرة أخرى.",
          "error",
        );
      }
    };
  });

  // Handle cancel button
  cancelBtn.onmouseover = () => {
    cancelBtn.style.background = "var(--color-background-secondary)";
    cancelBtn.style.color = "var(--color-text-primary)";
  };
  cancelBtn.onmouseout = () => {
    cancelBtn.style.background = "transparent";
    cancelBtn.style.color = "var(--color-text-secondary)";
  };
  cancelBtn.onclick = close;

  // Escape-key and overlay-click dismissal are already wired by
  // wireModalDismiss() above — no separate handlers needed here.

  // Auto-focus first button
  setTimeout(() => {
    promptButtons[0]?.focus();
  }, 50);
}
