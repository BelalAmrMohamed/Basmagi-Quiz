import { showNotification } from "../../components/notifications/notifications.js";
import { isLessonProtected, requestLessonPassword, verifyLocalLessonPassword, unlockRemoteLesson } from "../lesson/lesson-access.js";
import { renderBlock } from "../lesson/lesson-blocks.js";
import { normalizeLessonContent } from "../lesson/lesson-schema.js";
import { escapeHtml } from "./escape-html.js";
import { gradeEssay } from "../../shared/rate-answers.js";

const LESSON_INTERACTION_SCRIPT = `
const gradeEssay = (${gradeEssay.toString()});
const revealAdaptiveSection = (question, wasCorrect) => {
  const rules = JSON.parse(question.dataset.revealRule || "{}");
  const target = rules[wasCorrect ? "onCorrect" : "onWrong"]?.revealSection;
  if (!target) return;
  [...document.querySelectorAll("[data-section-id]")].find((section) => section.dataset.sectionId === String(target))?.removeAttribute("hidden");
};
document.querySelectorAll(".lesson-question[data-question-kind='mcq']").forEach((question) => {
  const correct = JSON.parse(question.dataset.correctIndexes || "[0]");
  const multi = question.dataset.multiSelect === "true";
  const reveal = (chosen) => {
    question.dataset.answered = "true";
    question.querySelectorAll(".lesson-question__option").forEach((button) => {
      const index = Number(button.dataset.optionIndex);
      button.disabled = true;
      button.classList.toggle("is-selected", chosen.includes(index));
      button.setAttribute("aria-pressed", String(chosen.includes(index)));
      if (correct.includes(index)) button.classList.add("is-correct");
      if (chosen.includes(index) && !correct.includes(index)) button.classList.add("is-wrong");
    });
    const right = correct.length === chosen.length && correct.every((index) => chosen.includes(index));
    const feedback = question.querySelector(".lesson-question__feedback");
    feedback.hidden = false;
    const verdict = feedback.querySelector(".lesson-question__verdict");
    verdict.textContent = right ? "إجابة صحيحة" : "إجابة غير صحيحة — راجع الإجابة الصحيحة والشرح";
    verdict.classList.toggle("is-correct", right);
    verdict.classList.toggle("is-wrong", !right);
    question.querySelector("[data-question-check]").disabled = true;
    revealAdaptiveSection(question, right);
  };
  question.querySelectorAll(".lesson-question__option").forEach((button) => button.addEventListener("click", () => {
    if (question.dataset.answered === "true") return;
    if (multi) {
      button.classList.toggle("is-selected");
    } else {
      question.querySelectorAll(".lesson-question__option").forEach((option) => {
        const selected = option === button;
        option.classList.toggle("is-selected", selected);
        option.setAttribute("aria-pressed", String(selected));
      });
    }
    button.setAttribute("aria-pressed", String(button.classList.contains("is-selected")));
    question.querySelector("[data-question-check]").disabled =
      !question.querySelector(".lesson-question__option.is-selected");
  }));
  question.querySelector("[data-question-check]")?.addEventListener("click", () => {
    if (question.dataset.answered === "true") return;
    const selected = [...question.querySelectorAll(".lesson-question__option.is-selected")].map((button) => Number(button.dataset.optionIndex));
    if (selected.length) reveal(selected);
  });
});
document.querySelectorAll(".lesson-question[data-question-kind='essay']").forEach((question) => {
  const button = question.querySelector(".lesson-question__essay-check-btn");
  const input = question.querySelector(".lesson-question__essay-input");
  input?.addEventListener("input", () => {
    if (question.dataset.answered !== "true") button.disabled = !input.value.trim();
  });
  button?.addEventListener("click", () => {
    const answer = input?.value.trim() || "";
    if (!answer || question.dataset.answered === "true") return;
    question.dataset.answered = "true";
    input.disabled = true;
    button.disabled = true;
    const feedback = question.querySelector(".lesson-question__feedback");
    feedback.hidden = false;
    const modelAnswer = question.dataset.modelAnswer || "";
    const score = gradeEssay(answer, modelAnswer);
    const wasClose = score >= 3;
    const verdict = feedback.querySelector(".lesson-question__verdict");
    verdict.textContent = wasClose ? "إجابتك قريبة من الإجابة النموذجية" : "راجع الإجابة النموذجية";
    verdict.classList.toggle("is-correct", wasClose);
    verdict.classList.toggle("is-wrong", !wasClose);
    const rating = feedback.querySelector(".lesson-question__essay-rating");
    if (rating) {
      rating.textContent = score + " من 5 · " + "★".repeat(score) + "☆".repeat(5 - score);
      rating.setAttribute("aria-label", "التقييم التقريبي: " + score + " من 5");
    }
    revealAdaptiveSection(question, wasClose);
  });
});
`;

function localRowFromLesson(lesson) {
  if (lesson?.lesson) return lesson;
  try {
    const rows = JSON.parse(localStorage.getItem("user_quizzes") || "[]");
    return Array.isArray(rows) ? rows.find((row) => (row.id || row.meta?.id) === lesson?.id) || lesson : lesson;
  } catch {
    return lesson;
  }
}

export async function downloadLesson(lesson, triggerBtn = null, { format = null, skipProtection = false } = {}) {
  if (!lesson) return;
  if (!format) {
    openLessonDownloadOptions(lesson, triggerBtn);
    return;
  }
  const originalMarkup = triggerBtn?.innerHTML || "";
  if (triggerBtn) {
    triggerBtn.disabled = true;
    triggerBtn.setAttribute("aria-busy", "true");
  }
  try {
    let payload = lessonPayload(lesson);
    if (!skipProtection && isLessonProtected(lesson)) {
      const isLocal = Boolean(lesson.lesson || lesson.meta?.type === "lesson" || /^user_lesson_/i.test(String(lesson.id || "")));
      if (isLocal) {
        const row = localRowFromLesson(lesson);
        const password = await requestLessonPassword({
          title: lesson.title || lesson.meta?.title || "هذا الدرس",
          verify: (candidate) => verifyLocalLessonPassword(row, candidate),
          submitLabel: "تنزيل",
        });
        if (!password) return;
      } else {
        let unlocked = null;
        const password = await requestLessonPassword({
          title: lesson.title || "هذا الدرس",
          verify: async (candidate) => {
            unlocked = await unlockRemoteLesson(lesson.id || lesson.slug, candidate);
            return Boolean(unlocked);
          },
          submitLabel: "تنزيل",
        });
        if (!password || !unlocked) return;
        payload = lessonPayload(unlocked);
      }
    }

    if (format === "pdf") {
      await printLessonAsPdf(payload);
      showNotification("جاهز للطباعة", "اختر «حفظ بتنسيق PDF» من نافذة الطباعة لتنزيل الدرس.", "success");
      return;
    }
    let content;
    let mime;
    let extension;
    let description;
    if (format === "html") {
      content = await buildStandaloneLessonHtml(payload);
      mime = "text/html;charset=utf-8";
      extension = "html";
      description = "تم تصدير الدرس كملف HTML تفاعلي.";
    } else if (format === "json") {
      content = JSON.stringify(payload, null, 2);
      mime = "application/json;charset=utf-8";
      extension = "json";
      description = "تم تصدير الدرس كملف JSON.";
    } else {
      throw new Error(`Unsupported lesson format: ${format}`);
    }
    downloadBlob(content, mime, `${sanitizeFilename(payload.title)}.${extension}`);
    showNotification("تم التنزيل", description, "success");
  } catch (error) {
    console.error("[lesson-download] export failed:", error);
    showNotification("تعذّر التنزيل", error?.message || "تعذّر تصدير الدرس.", "error");
  } finally {
    if (triggerBtn) {
      triggerBtn.disabled = false;
      triggerBtn.removeAttribute("aria-busy");
      triggerBtn.innerHTML = originalMarkup || "تنزيل";
    }
  }
}

export function lessonPayload(lesson) {
  const content = lesson?.content ?? lesson?.lesson ?? { sections: [] };
  return {
    id: lesson?.id || lesson?.dbId || "",
    title: lesson?.title || lesson?.meta?.title || "درس بدون عنوان",
    description: lesson?.description || lesson?.meta?.description || "",
    source: lesson?.source || lesson?.meta?.source || "",
    reader_prefs_default: lesson?.reader_prefs_default || lesson?.readerPrefsDefault || {},
    content,
  };
}

export async function buildStandaloneLessonHtml(payload) {
  const normalized = normalizeLessonContent(payload.content);
  const questionLabels = new Map();
  const allQuestions = normalized.sections.flatMap((section) =>
    section.blocks.filter((block) => block?.type === "question" && block.id),
  );
  allQuestions.forEach((question, index) => {
    questionLabels.set(question.id, { index: index + 1, total: allQuestions.length });
  });
  const [lessonCss, markdownCss] = await Promise.all([
    fetch(new URL("../lesson/lesson.css", import.meta.url)).then(readStylesheet),
    fetch(new URL("../../styles/markdown.css", import.meta.url)).then(readStylesheet),
  ]);
  const ctx = { lessonId: "__lesson_export__", quizLookup: new Map(), lessonLookup: new Map(), questionLabels };
  const sections = normalized.sections.map((section, sectionIndex) => {
    const blocks = section.blocks.map((block) => {
      let markup = renderBlock(block, ctx);
      if (block?.type === "question" && block.id) {
        const revealRule = escapeHtml(JSON.stringify({
          onCorrect: block.onCorrect || null,
          onWrong: block.onWrong || null,
        }));
        markup = markup.replace(`data-question-id="${escapeHtml(block.id)}"`, `data-question-id="${escapeHtml(block.id)}" data-reveal-rule="${revealRule}"`);
      }
      return markup;
    }).join("");
    const title = section.title || `قسم ${sectionIndex + 1}`;
    return `<section class="lesson-section" data-section-id="${escapeHtml(section.id)}"${section.defaultHidden ? " hidden" : ""}><div class="lesson-section__header"><h2 class="lesson-section__title">${escapeHtml(title)}</h2></div><div class="lesson-section__body">${blocks}</div></section>`;
  }).join("");
  const title = escapeHtml(payload.title || "درس بدون عنوان");
  return `<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>${markdownCss}\n${lessonCss}
:root{color-scheme:light;--color-primary:#2563eb;--color-primary-light:#dbeafe;--color-border:#d1d5db;--color-text-primary:#171717;--color-text-secondary:#52525b;--color-background:#fff;--color-background-secondary:#f4f4f5}
body{max-width:900px;margin:0 auto;padding:24px;font-family:Tahoma,Arial,sans-serif;color:#171717;background:#fff}
.lesson-view__title{margin:0 0 1.5rem}.lesson-section[hidden]{display:none}
.lesson-question__essay-check-btn,.lesson-question__check-btn{margin-top:.75rem;padding:.5rem 1rem;border:0;border-radius:8px;background:#2563eb;color:#fff;font:inherit;cursor:pointer}
@media(max-width:600px){body{padding:14px}}
@media print{body{max-width:none;padding:0}.lesson-section[hidden]{display:block!important}.lesson-question__option{color:#111}.lesson-question__check-btn,.lesson-question__essay-check-btn{display:none}.lesson-question__feedback[hidden]{display:grid!important}.lesson-question__verdict:empty{display:none}}</style>
</head><body><main class="lesson-view"><header class="lesson-view__header"><h1 class="lesson-view__title">${title}</h1></header><div class="lesson-view__body">${sections}</div></main>
<script>${LESSON_INTERACTION_SCRIPT}</script></body></html>`;
}

function readStylesheet(response) {
  if (!response.ok) throw new Error(`Could not load lesson export styles (${response.status}).`);
  return response.text();
}

function openLessonDownloadOptions(lesson, triggerBtn) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "lessonDownloadTitle");
  const modal = document.createElement("div");
  modal.className = "modal-card";
  modal.style.cssText = "width:min(440px,calc(100vw - 32px));padding:24px";
  modal.innerHTML = `
    <div class="create-quiz-modal__header"><h2 id="lessonDownloadTitle" class="create-quiz-modal__title">تنزيل الدرس</h2>
    <button type="button" class="create-quiz-modal__close-btn" aria-label="إغلاق">×</button></div>
    <p class="create-quiz-modal__subtitle">اختر صيغة الملف التي تريد تنزيلها.</p>
    <div class="lesson-download-options">
      <button type="button" data-format="html">Lesson (.html)<small>نسخة مستقلة وتفاعلية</small></button>
      <button type="button" data-format="pdf">PDF (.pdf)<small>طباعة الدرس أو حفظه كملف PDF</small></button>
      <button type="button" data-format="json">JSON (.json)<small>نسخة قابلة للاستيراد</small></button>
    </div>`;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  const close = () => {
    document.removeEventListener("keydown", onKeyDown);
    overlay.remove();
  };
  const onKeyDown = (event) => {
    if (event.key === "Escape") close();
  };
  document.addEventListener("keydown", onKeyDown);
  modal.querySelector(".create-quiz-modal__close-btn").addEventListener("click", close);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
  modal.querySelectorAll("[data-format]").forEach((button) => {
    button.addEventListener("click", () => {
      const selectedFormat = button.dataset.format;
      close();
      void downloadLesson(lesson, triggerBtn, { format: selectedFormat });
    });
  });
}

async function printLessonAsPdf(payload) {
  const html = await buildStandaloneLessonHtml(payload);
  const printable = html.replace("</head>", `<style>@media print{ @page{size:A4;margin:16mm} body{max-width:none;padding:0} .lesson-section[hidden]{display:block!important} .lesson-question__check-btn,.lesson-question__essay-check-btn{display:none!important} .lesson-question__feedback[hidden]{display:grid!important} .lesson-question__verdict:empty{display:none} .lesson-section,.lesson-question{break-inside:avoid-page} }</style></head>`);
  await new Promise((resolve, reject) => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
    document.body.appendChild(iframe);
    let settled = false;
    const cleanup = () => setTimeout(() => iframe.remove(), 1000);
    iframe.onerror = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("Failed to load the lesson PDF print view."));
    };
    iframe.onload = () => {
      try {
        const win = iframe.contentWindow;
        win.addEventListener("afterprint", cleanup, { once: true });
        win.focus();
        win.print();
        settled = true;
        resolve();
        setTimeout(cleanup, 60000);
      } catch (error) {
        if (!settled) {
          settled = true;
          cleanup();
          reject(error);
        }
      }
    };
    iframe.srcdoc = printable;
  });
}

function downloadBlob(content, mime, filename) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function sanitizeFilename(name) {
  return String(name || "lesson")
    .replace(/[\\/:*?"<>|\u0000-\u001F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100) || "lesson";
}
