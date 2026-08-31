// =============================================================================
// public/src/components/report-question/report-question.js
// =============================================================================
import { showNotification } from "../notifications/notifications.js";

// Keep track of reported questions in this session to prevent duplicate reports
const reportedQuestions = new Set();

export function isQuestionReported(quizId, questionIndex) {
  return reportedQuestions.has(`${quizId}-${questionIndex}`);
}

let modalInjected = false;

function injectModalHtml() {
  if (modalInjected) return;
  const html = `
    <div id="reportQuestionOverlay" class="report-modal-overlay">
      <div class="report-modal-card">
        <div class="report-modal-header">
          <h3>الإبلاغ عن سؤال</h3>
          <button type="button" class="report-close-btn" id="reportCloseBtn" aria-label="إغلاق">&times;</button>
        </div>
        <div class="report-question-preview" id="reportQuestionText"></div>
        <form id="reportQuestionForm" class="report-reasons-form">
          <label class="report-reason-label">
            <input type="radio" name="reportReason" value="إجابة خاطئة" required>
            <span>إجابة خاطئة</span>
          </label>
          <label class="report-reason-label">
            <input type="radio" name="reportReason" value="السؤال غير واضح">
            <span>السؤال غير واضح</span>
          </label>
          <label class="report-reason-label">
            <input type="radio" name="reportReason" value="خطأ إملائي/لغوي">
            <span>خطأ إملائي/لغوي</span>
          </label>
          <label class="report-reason-label">
            <input type="radio" name="reportReason" value="أخرى">
            <span>أخرى</span>
          </label>
          <textarea 
            id="reportReasonOther" 
            class="report-reason-other-input" 
            placeholder="يرجى توضيح السبب..."
          ></textarea>
          
          <div class="report-modal-actions">
            <button type="submit" class="report-btn-submit" id="reportSubmitBtn">إرسال البلاغ</button>
          </div>
        </form>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML("beforeend", html);

  const style = document.createElement('link');
  style.rel = 'stylesheet';
  style.href = '/src/components/report-question/report-question.css';
  document.head.appendChild(style);

  modalInjected = true;

  // Setup event listeners
  const overlay = document.getElementById("reportQuestionOverlay");
  const form = document.getElementById("reportQuestionForm");
  const radios = form.querySelectorAll('input[name="reportReason"]');
  const otherInput = document.getElementById("reportReasonOther");

  radios.forEach(radio => {
    radio.addEventListener('change', (e) => {
      if (e.target.value === 'أخرى') {
        otherInput.classList.add('show');
        otherInput.required = true;
      } else {
        otherInput.classList.remove('show');
        otherInput.required = false;
        otherInput.value = '';
      }
    });
  });

  const closeOverlay = () => {
    overlay.classList.remove("show");
    form.reset();
    otherInput.classList.remove('show');
    otherInput.required = false;
  };

  document.getElementById("reportCloseBtn").addEventListener("click", closeOverlay);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeOverlay();
  });
}

/**
 * Opens the report question modal.
 * @param {Object} params
 * @param {string} params.quizId Supabase Quiz ID
 * @param {number} params.questionIndex 0-based question index
 * @param {string} params.questionText Text of the question to display
 * @param {string} [params.quizTitle] Title of the quiz
 * @param {Function} [params.onSuccess] Callback when successfully reported
 */
export function openReportModal({ quizId, questionIndex, questionText, quizTitle, onSuccess }) {
  injectModalHtml();

  if (isQuestionReported(quizId, questionIndex)) {
    showNotification("لقد قمت بالإبلاغ عن هذا السؤال مسبقاً.", true);
    return;
  }

  const overlay = document.getElementById("reportQuestionOverlay");
  const preview = document.getElementById("reportQuestionText");
  const form = document.getElementById("reportQuestionForm");
  const submitBtn = document.getElementById("reportSubmitBtn");

  preview.textContent = questionText || "سؤال غير متوفر";
  
  // Remove any old submit listeners
  const newForm = form.cloneNode(true);
  form.parentNode.replaceChild(newForm, form);
  
  // Re-attach change listeners for the new form
  const radios = newForm.querySelectorAll('input[name="reportReason"]');
  const otherInput = newForm.querySelector("#reportReasonOther");
  
  radios.forEach(radio => {
    radio.addEventListener('change', (e) => {
      if (e.target.value === 'أخرى') {
        otherInput.classList.add('show');
        otherInput.required = true;
      } else {
        otherInput.classList.remove('show');
        otherInput.required = false;
        otherInput.value = '';
      }
    });
  });

  newForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    
    const selectedReason = newForm.querySelector('input[name="reportReason"]:checked')?.value;
    let finalReason = selectedReason;
    if (selectedReason === 'أخرى') {
      finalReason = otherInput.value.trim();
    }

    if (!finalReason) return;

    const newSubmitBtn = newForm.querySelector("#reportSubmitBtn");
    newSubmitBtn.disabled = true;
    newSubmitBtn.textContent = "جاري الإرسال...";

    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "submit",
          quiz_id: quizId,
          question_index: questionIndex,
          reason: finalReason
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "حدث خطأ أثناء إرسال البلاغ");
      }

      reportedQuestions.add(`${quizId}-${questionIndex}`);

      // Save report in user's localStorage history
      try {
        const STORAGE_KEY = "user_reported_questions";
        const existing = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
        const reportRecord = {
          id: data.report?.id || crypto.randomUUID?.() || Date.now().toString(),
          quiz_id: quizId,
          quiz_title: quizTitle || document.title.replace(" | منصة إمتحانات بصمجي", "").trim() || "اختبار",
          question_index: questionIndex,
          question_text: questionText || `سؤال رقم ${questionIndex + 1}`,
          reason: finalReason,
          status: "pending",
          created_at: data.report?.created_at || new Date().toISOString()
        };
        const filtered = Array.isArray(existing) ? existing.filter(r => r.id !== reportRecord.id) : [];
        filtered.unshift(reportRecord);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered.slice(0, 100)));
      } catch (storageErr) {
        console.error("Failed to save report in local storage:", storageErr);
      }

      showNotification("تم إرسال البلاغ بنجاح. شكراً لك!");
      
      overlay.classList.remove("show");
      
      if (typeof onSuccess === 'function') {
        onSuccess(data.report);
      }
    } catch (err) {
      showNotification(err.message, true);
    } finally {
      newSubmitBtn.disabled = false;
      newSubmitBtn.textContent = "إرسال البلاغ";
    }
  });

  overlay.classList.add("show");
}
