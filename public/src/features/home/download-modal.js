// ============================================================================
// public/src/features/home/download-modal.js
// DOWNLOAD MODAL — the "اختر طريقة التنزيل" format-picker popup for
// user-made quizzes. The manifest-exam equivalent lives as a closure
// inside createExamCard() (exam-card.js) since it captures per-card state.
// ============================================================================

import { qz } from "./quiz-schema.js";
import { ensureDownloadAllowed } from "./download-password.js";
import {
  executeExport,
  triggerDownload,
  withDownloadLoading,
  buildExportCard,
} from "./export-helpers.js";
import { buildStandaloneQuizHtml } from "../../features/export/export-to-quiz.js";
import { buildQuizHtml } from "../../features/export/export-to-html.js";
import { buildQuizMarkdown } from "../../features/export/export-to-markdown.js";
import { buildQuizText } from "../../features/export/export-to-text.js";
import { buildJsonQuizExport } from "../../shared/quiz-json.js";
import { JSON_FILE_ICON_SVG, DOWNLOAD_SOURCE_ICON_SVG, COPY_TEXT_ICON_SVG } from "./icons.js";

// ============================================================================
// show UserQuiz Download Popup
// ============================================================================
const allExportOptions = [
  { format: "quiz", label: "Quiz (.html)", iconUrl: "./favicon.png", canCopy: true },
  { format: "html", label: "HTML (.html)", iconUrl: "./assets/images/HTML_Icon.png", canCopy: true },
  { format: "md", label: "Markdown (.md)", iconUrl: "./assets/images/mardownIcon.png", canCopy: true },
  { format: "text", label: "Text (.txt)", iconSvg: COPY_TEXT_ICON_SVG, canCopy: true },
  { format: "json", label: "JSON (.json)", iconSvg: JSON_FILE_ICON_SVG, canCopy: true },
  { format: "pdf", label: "PDF (.pdf)", iconUrl: "./assets/images/PDF_Icon.png", canCopy: false },
  { format: "pptx", label: "PowerPoint (.pptx)", iconUrl: "./assets/images/pptx_icon.png", canCopy: false },
  { format: "docx", label: "Word (.docx)", iconUrl: "./assets/images/word_icon.png", canCopy: false },
];
export async function showUserQuizDownloadPopup(quiz) {
  const allowed = await ensureDownloadAllowed(
    qz(quiz, "id") || quiz.id,
    qz(quiz, "password"),
    qz(quiz, "title"),
  );
  if (!allowed) return;

  const modal = document.createElement("div");
  modal.className = "modal-overlay";
  modal.style.transform = "translateZ(0)";
  modal.style.willChange = "opacity";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-labelledby", "userQuizDownloadTitle");

  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.remove();
  });

  const modalCard = document.createElement("div");
  modalCard.className = "modal-card";
  modalCard.style.contain = "layout style paint";

  const h2 = document.createElement("h2");
  h2.id = "userQuizDownloadTitle";
  h2.textContent = qz(quiz, "title");

  const p = document.createElement("p");
  p.textContent = "اختر طريقة التنزيل";

  const grid = document.createElement("div");
  grid.className = "mode-grid";
  grid.setAttribute("role", "group");
  grid.setAttribute("aria-label", "خيارات التنزيل");

  // Config object for export functions.
  // All fields below are correctly sourced via qz() against quiz.meta/stats —
  // this path was never broken. The actual bug was in the static/manifest
  // exam path (see onDownloadOption above) and in quizManifest.js, which
  // dropped author_email/password before they ever reached the page.
  const config = {
    id: qz(quiz, "id") || quiz.id,
    title: qz(quiz, "title"),
    description: qz(quiz, "description"),
    source: qz(quiz, "source"),
    createdAt: qz(quiz, "createdAt"),
    author: qz(quiz, "author"),
    author_email: qz(quiz, "author_email"),
    password: qz(quiz, "password"),
    view: qz(quiz, "view"),
    mode: qz(quiz, "mode"),
    questionTypes: qz(quiz, "type"),
    questionCount: qz(quiz, "count"),
  };

  const questions = quiz.questions;

  allExportOptions.forEach(opt => {
    const iconHtml = opt.iconSvg ? opt.iconSvg : `<img src="${opt.iconUrl}" alt="" class="icon" aria-hidden="true">`;
    const card = buildExportCard({
      format: opt.format,
      label: opt.label,
      icon: iconHtml,
      canCopy: opt.canCopy,
      onDownload: async () => {
         if (opt.format === "text") {
             const text = await buildQuizText(config, quiz.questions);
             const blob = new Blob([text], { type: "text/plain" });
             triggerDownload(blob, `${config.title || quiz.id}.txt`);
         } else if (opt.format === "json") {
             const payload = await buildJsonQuizExport(config.title, config.description, config.source, quiz.questions || [], config.createdAt);
             const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
             triggerDownload(blob, `${config.title || "quiz"}.json`);
         } else {
             await executeExport(opt.format, config, quiz.questions);
         }
         modal.remove();
      },
      onCopy: async () => {
          if (opt.format === "quiz") return await buildStandaloneQuizHtml(config, quiz.questions);
          if (opt.format === "html") return await buildQuizHtml(config, quiz.questions);
          if (opt.format === "md") return buildQuizMarkdown(config, quiz.questions);
          if (opt.format === "text") return await buildQuizText(config, quiz.questions);
          if (opt.format === "json") {
              const payload = await buildJsonQuizExport(config.title, config.description, config.source, quiz.questions || [], config.createdAt);
              return JSON.stringify(payload, null, 2);
          }
      }
    });
    grid.appendChild(card);
  });

  // Show source button if the quiz has a source URL
  const quizSource = qz(quiz, "source");
  if (quizSource && typeof quizSource === "string") {
    const sourceBtn = document.createElement("button");
    sourceBtn.className = "mode-btn";
    sourceBtn.type = "button";
    sourceBtn.setAttribute("aria-label", `Download Source`);
    sourceBtn.innerHTML = `${DOWNLOAD_SOURCE_ICON_SVG}<strong>Download Source</strong>`;
    sourceBtn.onclick = (ev) => {
      ev.stopPropagation();
      window.open(quizSource, "_blank");
      modal.remove();
    };
    grid.appendChild(sourceBtn);
  }

  const closeBtn = document.createElement("button");
  closeBtn.className = "close-modal";
  closeBtn.type = "button";
  closeBtn.textContent = "إلغاء";
  closeBtn.setAttribute("aria-label", "إغلاق النافذة");
  closeBtn.onclick = () => modal.remove();

  modalCard.appendChild(h2);
  modalCard.appendChild(p);
  modalCard.appendChild(grid);
  modalCard.appendChild(closeBtn);
  modal.appendChild(modalCard);

  requestAnimationFrame(() => {
    document.body.appendChild(modal);
    // Focus first button
    const firstBtn = grid.querySelector("button");
    if (firstBtn) firstBtn.focus();
  });
}
