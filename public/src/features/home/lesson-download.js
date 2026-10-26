import { showNotification } from "../../components/notifications/notifications.js";
import { isLessonProtected, requestLessonPassword, verifyLocalLessonPassword, unlockRemoteLesson } from "../lesson/lesson-access.js";
import { renderBlock } from "../lesson/lesson-blocks.js";
import { normalizeLessonContent } from "../lesson/lesson-schema.js";
import { escapeHtml } from "./escape-html.js";
import { gradeEssay } from "../../shared/rate-answers.js";
import { ensureSharedSupabaseClient } from "../../shared/supabaseClientRegistry.js";
import { buildExportCard } from "../../components/download-quiz-modal/export-card.js";
import { JSON_FILE_ICON_SVG } from "./icons.js";

const HTML_FILE_ICON = '<img src="/assets/images/HTML_Icon.png" alt="" class="icon" aria-hidden="true">';
const PDF_FILE_ICON = '<img src="/assets/images/PDF_Icon.png" alt="" class="icon" aria-hidden="true">';
const JSON_ICON_DATA_URL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(JSON_FILE_ICON_SVG)}`;

function throwIfAborted(signal) {
  if (signal?.aborted) throw new DOMException("The export was cancelled.", "AbortError");
}

function updateProgress(callback, percent, label) {
  callback?.(percent, label);
}

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

export async function downloadLesson(lesson, triggerBtn = null, { format = null, skipProtection = false, signal, onProgress } = {}) {
  if (!lesson) return false;
  if (!format) {
    openLessonDownloadOptions(lesson, triggerBtn);
    return false;
  }
  const originalMarkup = triggerBtn?.innerHTML || "";
  if (triggerBtn) {
    triggerBtn.disabled = true;
    triggerBtn.setAttribute("aria-busy", "true");
  }
  try {
    const payload = await prepareLessonPayload(lesson, { skipProtection, signal, onProgress });
    if (!payload) return false;
    throwIfAborted(signal);

    if (format === "pdf") {
      updateProgress(onProgress, 50, "إنشاء نسخة الطباعة…");
      await printLessonAsPdf(payload, {
        signal,
        onProgress,
        onPrintReady: () => updateProgress(onProgress, 92, "استخدم نافذة الطباعة لحفظ الدرس كـ PDF."),
      });
      throwIfAborted(signal);
      updateProgress(onProgress, 100, "اكتمل تجهيز الدرس.");
      showNotification("جاهز للطباعة", "اختر «حفظ بتنسيق PDF» من نافذة الطباعة لتنزيل الدرس.", "success");
      return true;
    }
    let content;
    let mime;
    let extension;
    let description;
    if (format === "html") {
      updateProgress(onProgress, 52, "إنشاء صفحة HTML التفاعلية…");
      content = await buildStandaloneLessonHtml(payload, { signal, onProgress });
      mime = "text/html;charset=utf-8";
      extension = "html";
      description = "تم تصدير الدرس كملف HTML تفاعلي.";
    } else if (format === "json") {
      updateProgress(onProgress, 72, "تجهيز بيانات JSON…");
      content = JSON.stringify(payload, null, 2);
      mime = "application/json;charset=utf-8";
      extension = "json";
      description = "تم تصدير الدرس كملف JSON.";
    } else {
      throw new Error(`Unsupported lesson format: ${format}`);
    }
    throwIfAborted(signal);
    updateProgress(onProgress, 92, "حفظ الملف…");
    downloadBlob(content, mime, `${sanitizeFilename(payload.title)}.${extension}`);
    updateProgress(onProgress, 100, "اكتمل التنزيل.");
    showNotification("تم التنزيل", description, "success");
    return true;
  } catch (error) {
    if (signal?.aborted || error?.name === "AbortError") {
      showNotification("تم الإلغاء", "أُلغيت عملية تنزيل الدرس.", "info");
      return false;
    }
    console.error("[lesson-download] export failed:", error);
    showNotification("تعذّر التنزيل", error?.message || "تعذّر تصدير الدرس.", "error");
    return false;
  } finally {
    if (triggerBtn) {
      triggerBtn.disabled = false;
      triggerBtn.removeAttribute("aria-busy");
      triggerBtn.innerHTML = originalMarkup || "تنزيل";
    }
  }
}

async function prepareLessonPayload(lesson, { skipProtection = false, signal, onProgress } = {}) {
  throwIfAborted(signal);
  let payload = lessonPayload(lesson);
  updateProgress(onProgress, 12, "التحقق من صلاحية تنزيل الدرس…");
  if (!skipProtection && isLessonProtected(lesson)) {
    const isLocal = Boolean(lesson.lesson || lesson.meta?.type === "lesson" || /^user_lesson_/i.test(String(lesson.id || "")));
    if (isLocal) {
      const row = localRowFromLesson(lesson);
      const password = await requestLessonPassword({
        title: lesson.title || lesson.meta?.title || "هذا الدرس",
        verify: (candidate) => verifyLocalLessonPassword(row, candidate),
        submitLabel: "تنزيل",
        signal,
      });
      throwIfAborted(signal);
      if (!password) return null;
    } else {
      let unlocked = null;
      const password = await requestLessonPassword({
        title: lesson.title || "هذا الدرس",
        verify: async (candidate) => {
          unlocked = await unlockRemoteLesson(lesson.id || lesson.slug, candidate, { signal });
          return Boolean(unlocked);
        },
        submitLabel: "تنزيل",
        signal,
      });
      throwIfAborted(signal);
      if (!password || !unlocked) return null;
      payload = lessonPayload(unlocked);
    }
  }

  // Catalog lesson cards carry summary metadata only. Resolve the published
  // content lazily when the visitor actually chooses an export format.
  if (!lesson.lesson && !payload.content?.sections?.length) {
    throwIfAborted(signal);
    updateProgress(onProgress, 34, "تحميل محتوى الدرس…");
    const supabase = await ensureSharedSupabaseClient();
    throwIfAborted(signal);
    if (!supabase) throw new Error("تعذّر الاتصال بقاعدة البيانات.");
    let query = supabase
      .from("lesson_public")
      .select("id, title, description, source, content, reader_prefs_default");
    query = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(String(lesson.id || ""))
      ? query.eq("id", lesson.id)
      : query.eq("slug", lesson.slug || lesson.id);
    if (signal && typeof query.abortSignal === "function") query = query.abortSignal(signal);
    const { data, error } = await query.maybeSingle();
    throwIfAborted(signal);
    if (error) throw error;
    if (!data?.content) throw new Error("تعذّر تحميل محتوى الدرس للتنزيل.");
    payload = lessonPayload({ ...lesson, ...data });
  }
  updateProgress(onProgress, 44, "تم تجهيز محتوى الدرس.");
  return payload;
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

export async function buildStandaloneLessonHtml(payload, { signal, onProgress } = {}) {
  throwIfAborted(signal);
  updateProgress(onProgress, 58, "تنسيق صفحة الدرس…");
  const normalized = normalizeLessonContent(payload.content);
  const questionLabels = new Map();
  const allQuestions = normalized.sections.flatMap((section) =>
    section.blocks.filter((block) => block?.type === "question" && block.id),
  );
  allQuestions.forEach((question, index) => {
    questionLabels.set(question.id, { index: index + 1, total: allQuestions.length });
  });
  const [lessonCss, markdownCss] = await Promise.all([
    fetch(new URL("../lesson/lesson.css", import.meta.url), { signal }).then(readStylesheet),
    fetch(new URL("../../styles/markdown.css", import.meta.url), { signal }).then(readStylesheet),
  ]);
  throwIfAborted(signal);
  updateProgress(onProgress, 78, "إضافة التفاعلات ومحتوى الدرس…");
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
  overlay.className = "modal-overlay download-modal-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "lessonDownloadTitle");
  const modal = document.createElement("div");
  modal.className = "modal-card dl-modal-card lesson-dl-modal-card";
  const header = document.createElement("div");
  header.className = "modal-header";
  header.innerHTML = `
    <h2 id="lessonDownloadTitle"><svg xmlns="http://www.w3.org/2000/svg" class="page-data-lucide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/></svg> تنزيل الدرس</h2>
    <button type="button" class="close-btn dl-close" aria-label="إغلاق"><svg xmlns="http://www.w3.org/2000/svg" class="page-data-lucide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button>`;
  const subtitle = document.createElement("p");
  subtitle.className = "lesson-dl-subtitle";
  subtitle.textContent = "اختر صيغة الدرس. يمكنك تنزيل الملف أو نسخ محتواه مباشرة.";
  const grid = document.createElement("div");
  grid.className = "mode-grid lesson-dl-grid";
  grid.setAttribute("role", "group");
  grid.setAttribute("aria-label", "خيارات تنزيل الدرس");
  const progressPanel = document.createElement("div");
  progressPanel.className = "dl-progress-panel";
  progressPanel.style.display = "none";
  progressPanel.innerHTML = `
    <img class="dl-progress-icon" src="" alt="" aria-hidden="true">
    <div class="dl-progress-label" role="status" aria-live="polite"></div>
    <div class="dl-progress-track" role="progressbar" aria-label="تقدم تجهيز الدرس" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="dl-progress-fill"></div></div>
    <div class="dl-progress-pct">0%</div>
    <button type="button" class="dl-progress-cancel">إلغاء</button>`;
  const progressIcon = progressPanel.querySelector(".dl-progress-icon");
  const progressLabel = progressPanel.querySelector(".dl-progress-label");
  const progressTrack = progressPanel.querySelector(".dl-progress-track");
  const progressFill = progressPanel.querySelector(".dl-progress-fill");
  const progressPct = progressPanel.querySelector(".dl-progress-pct");
  const cancelButton = progressPanel.querySelector(".dl-progress-cancel");
  let printDialogActive = false;
  let activeController = null;

  const setProgress = (percent, label) => {
    const value = Math.max(0, Math.min(100, Math.round(percent)));
    progressFill.style.width = `${value}%`;
    progressPct.textContent = `${value}%`;
    progressTrack.setAttribute("aria-valuenow", String(value));
    if (label) progressLabel.textContent = label;
  };

  const close = () => {
    if (printDialogActive) return;
    activeController?.abort();
    document.removeEventListener("keydown", onKeyDown);
    overlay.remove();
  };
  const runDownload = async (format, iconUrl, label) => {
    const controller = new AbortController();
    activeController = controller;
    grid.style.display = "none";
    subtitle.style.display = "none";
    progressPanel.style.display = "flex";
    progressIcon.src = iconUrl;
    progressIcon.onerror = () => { progressIcon.style.visibility = "hidden"; };
    progressIcon.style.visibility = "";
    cancelButton.disabled = false;
    cancelButton.textContent = "إلغاء";
    cancelButton.removeAttribute("title");
    printDialogActive = false;
    cancelButton.classList.remove("dl-progress-cancelling");
    setProgress(0, `تجهيز ${label}…`);
    const cancel = () => {
      controller.abort();
      cancelButton.disabled = true;
      cancelButton.textContent = "جارٍ الإلغاء…";
      cancelButton.classList.add("dl-progress-cancelling");
    };
    cancelButton.addEventListener("click", cancel, { once: true });
    let completed = false;
    try {
      completed = await downloadLesson(lesson, triggerBtn, {
        format,
        signal: controller.signal,
        onProgress: (percent, message) => {
          setProgress(percent, message);
          if (message?.startsWith("استخدم نافذة الطباعة")) {
            printDialogActive = true;
            cancelButton.disabled = true;
            cancelButton.textContent = "في نافذة الطباعة";
            cancelButton.title = "أغلق نافذة الطباعة لإكمال أو إلغاء العملية.";
          }
        },
      });
    } finally {
      cancelButton.removeEventListener("click", cancel);
      activeController = null;
      printDialogActive = false;
      if (overlay.isConnected) {
        if (completed) close();
        else {
          progressPanel.style.display = "none";
          subtitle.style.display = "";
          grid.style.display = "";
        }
      }
    }
  };

  const formats = [
    { format: "html", label: "HTML", extension: ".html", icon: HTML_FILE_ICON, iconUrl: "/assets/images/HTML_Icon.png", copy: true },
    { format: "pdf", label: "PDF", extension: ".pdf", icon: PDF_FILE_ICON, iconUrl: "/assets/images/PDF_Icon.png", copy: false },
    { format: "json", label: "JSON", extension: ".json", icon: JSON_FILE_ICON_SVG, iconUrl: JSON_ICON_DATA_URL, copy: true },
  ];
  for (const option of formats) {
    grid.appendChild(buildExportCard({
      format: option.format,
      label: option.label,
      extension: option.extension,
      icon: option.icon,
      canCopy: option.copy,
      onDownload: () => runDownload(option.format, option.iconUrl, option.label),
      onCopy: async () => {
        const payload = await prepareLessonPayload(lesson);
        if (!payload) throw new Error("COPY_CANCELLED");
        return option.format === "json"
          ? JSON.stringify(payload, null, 2)
          : await buildStandaloneLessonHtml(payload);
      },
    }));
  }

  modal.append(header, subtitle, grid, progressPanel);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  const onKeyDown = (event) => {
    if (event.key === "Escape") close();
  };
  document.addEventListener("keydown", onKeyDown);
  modal.querySelector(".dl-close").addEventListener("click", close);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
}

async function printLessonAsPdf(payload, { signal, onPrintReady, onProgress } = {}) {
  const html = await buildStandaloneLessonHtml(payload, { signal, onProgress });
  throwIfAborted(signal);
  const printable = html.replace("</head>", `<style>@media print{ @page{size:A4;margin:16mm} body{max-width:none;padding:0} .lesson-section[hidden]{display:block!important} .lesson-question__check-btn,.lesson-question__essay-check-btn{display:none!important} .lesson-question__feedback[hidden]{display:grid!important} .lesson-question__verdict:empty{display:none} .lesson-section,.lesson-question{break-inside:avoid-page} }</style></head>`);
  await new Promise((resolve, reject) => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
    document.body.appendChild(iframe);
    let settled = false;
    const abort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new DOMException("The export was cancelled.", "AbortError"));
    };
    const cleanup = () => setTimeout(() => iframe.remove(), 1000);
    signal?.addEventListener("abort", abort, { once: true });
    iframe.onerror = () => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      cleanup();
      reject(new Error("Failed to load the lesson PDF print view."));
    };
    iframe.onload = () => {
      try {
        const win = iframe.contentWindow;
        win.addEventListener("afterprint", cleanup, { once: true });
        win.focus();
        onPrintReady?.();
        win.print();
        settled = true;
        signal?.removeEventListener("abort", abort);
        resolve();
        setTimeout(cleanup, 60000);
      } catch (error) {
        if (!settled) {
          settled = true;
          signal?.removeEventListener("abort", abort);
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
