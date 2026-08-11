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
  buildCopyDownloadButton,
} from "./export-helpers.js";
import { buildQuizText } from "../../features/export/export-to-text.js";
import { buildJsonQuizExport } from "../../shared/quiz-json.js";
import { JSON_FILE_ICON_SVG, DOWNLOAD_SOURCE_ICON_SVG } from "./icons.js";

// ============================================================================
// show UserQuiz Download Popup
// ============================================================================
const opts = [
  ["./favicon.png", "Quiz (.html)", "quiz"],
  ["./assets/images/HTML_Icon.png", "HTML (.html)", "html"],
  ["./assets/images/mardownIcon.png", "Markdown (.md)", "md"],
  ["./assets/images/PDF_Icon.png", "PDF (.pdf)", "pdf"],
  ["./assets/images/pptx_icon.png", "PowerPoint (.pptx)", "pptx"],
  ["./assets/images/word_icon.png", "Word (.docx)", "docx"],
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

  const onDownloadOption = async (format) => {
    await executeExport(format, config, questions);
  };

  opts.forEach(([icon, label, format]) => {
    const b = document.createElement("button");
    b.className = "mode-btn";
    b.type = "button";
    b.setAttribute("aria-label", `تنزيل كـ ${label}`);
    b.innerHTML = `<img src="${icon}" alt="" class="icon" aria-hidden="true"><strong>${label}</strong>`;
    b.onclick = (ev) => {
      ev.stopPropagation();
      withDownloadLoading(b, () => onDownloadOption(format)).then(() =>
        modal.remove(),
      );
    };
    grid.appendChild(b);
  });

  const copyBtn = buildCopyDownloadButton(
    async () => {
      const config = {
        id: qz(quiz, "id") || quiz.id,
        title: qz(quiz, "title") || quiz.id,
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
      return buildQuizText(config, quiz.questions);
    },
    (qz(quiz, "title") || quiz.id).replace(/[^a-zA-Z0-9\u0600-\u06FF]/g, "_"),
  );
  grid.appendChild(copyBtn);

  const jsonBtn = document.createElement("button");
  jsonBtn.className = "mode-btn";
  jsonBtn.type = "button";
  jsonBtn.setAttribute("aria-label", `Download JSON (.json)`);
  jsonBtn.innerHTML = `${JSON_FILE_ICON_SVG}<strong>JSON (.json)</strong>`;
  jsonBtn.onclick = (ev) => {
    ev.stopPropagation();
    withDownloadLoading(jsonBtn, async () => {
      try {
        const title = qz(quiz, "title");
        const description = qz(quiz, "description");
        const source = qz(quiz, "source");
        const createdAt = qz(quiz, "createdAt");

        const payload = await buildJsonQuizExport(
          title,
          description,
          source,
          quiz.questions || [],
          createdAt,
        );

        const fileContent = JSON.stringify(payload, null, 2);
        const blob = new Blob([fileContent], { type: "application/json" });
        triggerDownload(blob, `${title || "quiz"}.json`);
      } catch (e) {
        console.error("JSON Error:", e);
        alert("فشل تنزيل ملف JSON");
      }
    }).then(() => modal.remove());
  };
  grid.appendChild(jsonBtn);

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
