// ============================================================================
// public/src/features/home/export-helpers.js
// EXPORT / DOWNLOAD HELPERS — clipboard copy, format-dispatch, blob download,
// and the shared "loading state" wrapper used by every download button.
// ============================================================================

import { exportToQuiz } from "../../features/export/export-to-quiz.js";
import { exportToHtml } from "../../features/export/export-to-html.js";
import { exportToPdf } from "../../features/export/export-to-pdf.js";
import { exportToWord } from "../../features/export/export-to-word.js";
import { exportToPptx } from "../../features/export/export-to-pptx.js";
import { exportToMarkdown } from "../../features/export/export-to-markdown.js";
import {
  COPY_TEXT_ICON_SVG,
  DOWNLOAD_TXT_ICON_SVG,
  JSON_FILE_ICON_SVG,
  DOWNLOAD_SOURCE_ICON_SVG,
} from "./icons.js";
import { showNotification } from "../../components/notifications/notifications.js";
import { buildStandaloneQuizHtml } from "../../features/export/export-to-quiz.js";
import { buildQuizHtml } from "../../features/export/export-to-html.js";
import { buildQuizMarkdown } from "../../features/export/export-to-markdown.js";
import { buildQuizText } from "../../features/export/export-to-text.js";
import { buildJsonQuizExport } from "../../shared/quiz-json.js";

/**
 * Copies text to the clipboard.
 * Prefers the async Clipboard API; falls back to a hidden textarea
 * select-and-copy for non-HTTPS or focus-restricted contexts.
 * @param {string} text
 * @returns {Promise<void>}
 */
export async function copyTextWithFallback(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  // Fallback: temporary textarea
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.cssText =
    "position:fixed;top:-9999px;left:-9999px;opacity:0;pointer-events:none;";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try {
    const ok = document.execCommand("copy");
    if (!ok) throw new Error("execCommand copy returned false");
  } finally {
    document.body.removeChild(ta);
  }
}

/**
 * Creates an export card with an optional top-left copy button.
 *
 * @param {object} options
 * @param {string} options.format — The format identifier.
 * @param {string} options.label — The text label on the card.
 * @param {string} [options.extension] — File extension (e.g. ".json"),
 *   rendered as smaller subtext under the label instead of being folded
 *   into it.
 * @param {string} options.icon — The SVG icon for the card.
 * @param {boolean} options.canCopy — Whether this format can be copied to clipboard.
 * @param {Function} options.onDownload — Async function triggered on card click.
 * @param {Function} options.onCopy — Async function triggered on copy button click (if canCopy=true). Returns the text to copy.
 * @returns {HTMLDivElement}
 */
export function buildExportCard({
  format,
  label,
  extension,
  icon,
  canCopy,
  onDownload,
  onCopy,
}) {
  const card = document.createElement("div");
  card.className = "export-card";
  card.setAttribute("role", "button");
  card.setAttribute("tabindex", "0");
  card.setAttribute(
    "aria-label",
    `Download as ${label}${extension ? ` (${extension})` : ""}`,
  );
  card.dataset.format = format;

  const content = document.createElement("div");
  content.className = "export-card-content";
  content.innerHTML = `
    <div class="export-icon">${icon}</div>
    <div class="export-label">${label}</div>
    ${extension ? `<div class="export-extension">${extension}</div>` : ""}
  `;
  card.appendChild(content);

  // Click on card -> download
  card.onclick = (e) => {
    // If clicked on the copy button, ignore
    if (e.target.closest(".mode-copy-btn")) return;

    withDownloadLoading(card, async () => {
      try {
        await onDownload();
      } catch (err) {
        console.error(err);
        showNotification("خطأ", "فشل التنزيل.", "error");
      }
    });
  };

  // Keyboard support for card
  card.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      card.click();
    }
  });

  if (canCopy) {
    const copyBtn = document.createElement("button");
    copyBtn.className = "mode-copy-btn";
    copyBtn.setAttribute("aria-label", `Copy ${label} to clipboard`);
    copyBtn.title = `نسخ كنص`;

    const copyIconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;
    const checkIconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>`;

    copyBtn.innerHTML = copyIconSvg;

    copyBtn.onclick = async (e) => {
      e.stopPropagation();
      const originalHtml = copyBtn.innerHTML;
      try {
        copyBtn.innerHTML =
          '<i data-lucide="loader-circle" class="spin" style="width:14px;height:14px;"></i>';
        const textToCopy = await onCopy();
        await copyTextWithFallback(textToCopy);

        copyBtn.innerHTML = checkIconSvg;
        copyBtn.classList.add("copied");

        showNotification("تم النسخ", "تم نسخ المحتوى بنجاح!", "success");

        setTimeout(() => {
          copyBtn.innerHTML = copyIconSvg;
          copyBtn.classList.remove("copied");
        }, 2000);
      } catch (err) {
        console.error(err);
        copyBtn.innerHTML = copyIconSvg;
        showNotification("خطأ", "فشل النسخ.", "error");
      }
    };

    card.appendChild(copyBtn);
  }

  return card;
}

/**
 * Dispatches an export operation to the correct export module.
 * @param {string} format — one of: "quiz" | "html" | "md" | "pdf" | "pptx" | "docx"
 * @param {object} config — { id, title, description, path?, source? }
 * @param {Array}  questions
 */
export async function executeExport(format, config, questions) {
  switch (format) {
    case "quiz":
      await exportToQuiz(config, questions);
      break;
    case "html":
      await exportToHtml(config, questions);
      break;
    case "pdf":
      await exportToPdf(config, questions);
      break;
    case "docx":
      await exportToWord(config, questions);
      break;
    case "pptx":
      await exportToPptx(config, questions);
      break;
    case "md":
      exportToMarkdown(config, questions);
      break;
  }
}

/**
 * Triggers a file download from a Blob without leaving orphaned object URLs.
 * @param {Blob} blob
 * @param {string} filename
 */
export function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Wrapper for download buttons to show loading state
 */
export async function withDownloadLoading(buttonEl, asyncFn) {
  const originalHtml = buttonEl.innerHTML;
  const originalWidth = buttonEl.offsetWidth;

  buttonEl.disabled = true;
  buttonEl.style.width = `${originalWidth > 0 ? originalWidth : buttonEl.getBoundingClientRect().width}px`;
  buttonEl.style.justifyContent = "center";
  buttonEl.innerHTML =
    '<i data-lucide="loader-circle" class="spin"></i> جاري التحميل...';
  try {
    await asyncFn();
  } finally {
    buttonEl.disabled = false;
    buttonEl.innerHTML = originalHtml;
    buttonEl.style.width = "";
    buttonEl.style.justifyContent = "";
  }
}

// ============================================================================
// SHARED DOWNLOAD MODAL — the "اختر صيغة التحميل" format-picker popup.
// ============================================================================
// This is the create-quiz page's modal (`.dl-modal-card`), now shared so the
// homepage's "My Quizzes" download popup uses the exact same markup/styling
// instead of its own (previously out-of-sync) copy. See download-modal.js
// (home) and create-quiz.js for the two call sites.

const DOWNLOAD_FORMAT_OPTIONS = [
  {
    format: "quiz",
    label: "Quiz",
    extension: ".html",
    iconUrl: "./favicon.png",
    canCopy: true,
  },
  {
    format: "html",
    label: "HTML",
    extension: ".html",
    iconUrl: "./assets/images/HTML_Icon.png",
    canCopy: true,
  },
  {
    format: "md",
    label: "Markdown",
    extension: ".md",
    iconUrl: "./assets/images/mardownIcon.png",
    canCopy: true,
  },
  {
    format: "text",
    label: "Text",
    extension: ".txt",
    iconSvg: COPY_TEXT_ICON_SVG,
    canCopy: true,
  },
  {
    format: "json",
    label: "JSON",
    extension: ".json",
    iconSvg: JSON_FILE_ICON_SVG,
    canCopy: true,
  },
  {
    format: "pdf",
    label: "PDF",
    extension: ".pdf",
    iconUrl: "./assets/images/PDF_Icon.png",
    canCopy: false,
  },
  {
    format: "pptx",
    label: "PowerPoint",
    extension: ".pptx",
    iconUrl: "./assets/images/pptx_icon.png",
    canCopy: false,
  },
  {
    format: "docx",
    label: "Word",
    extension: ".docx",
    iconUrl: "./assets/images/word_icon.png",
    canCopy: false,
  },
];

/**
 * Builds and shows the shared download-format modal (the "دي.إل" popup
 * previously only used on the create-quiz page). Handles its own overlay,
 * close button, and click-outside/removal — the caller doesn't need to
 * manage the DOM node afterwards.
 *
 * @param {object} options
 * @param {object} options.config — export config: { id, title, description,
 *   source, createdAt, author, author_email, password, view, mode,
 *   questionTypes, questionCount }. Only `title`/`description`/`source` are
 *   required by the exporters; the rest are passed through when present.
 * @param {Array}  options.questions — quiz questions array.
 * @param {Function} [options.buildJsonPayloadString] — async () => string.
 *   Optional override for building the JSON export payload (lets callers
 *   fold in extra export-time metadata, e.g. create-quiz.js's password/view/
 *   mode fields). Defaults to a plain buildJsonQuizExport() call.
 * @param {string} [options.filenameBase] — base filename (without
 *   extension) for text/json downloads. Defaults to config.title/"quiz".
 * @param {Function} [options.resolveExportData] — async ({config, questions})
 *   => {config, questions}. Optional hook run lazily, once, right before the
 *   first download/copy action fires. Lets a caller open the modal
 *   immediately from a lightweight/summary config (e.g. a manifest exam
 *   entry) while deferring a slower async fetch — for the raw quiz file,
 *   fields like view/mode/questions — until the user actually picks a
 *   format. The result is cached and reused for subsequent clicks in the
 *   same modal. Defaults to a no-op that returns {config, questions} as-is.
 */
export function showDownloadModal({
  config,
  questions,
  buildJsonPayloadString,
  filenameBase,
  resolveExportData,
}) {
  const safeBase = filenameBase || config.title || "quiz";

  // Lazily resolves (and caches) the real {config, questions} to export.
  // Every onDownload/onCopy handler below should read through this instead
  // of closing over `config`/`questions` directly, so a resolveExportData
  // hook — if provided — only ever runs once no matter which/how many
  // format cards get clicked.
  let resolvedPromise = null;
  const getExportData = () => {
    if (!resolvedPromise) {
      resolvedPromise = resolveExportData
        ? Promise.resolve(resolveExportData({ config, questions }))
        : Promise.resolve({ config, questions });
    }
    return resolvedPromise;
  };

  const buildJsonString =
    buildJsonPayloadString ||
    (async () => {
      const { config: c, questions: q } = await getExportData();
      const payload = await buildJsonQuizExport(
        c.title,
        c.description,
        c.source,
        q || [],
        config.createdAt,
      );
      return JSON.stringify(payload, null, 2);
    });

  const modal = document.createElement("div");
  modal.className = "modal-overlay download-modal-overlay";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-labelledby", "downloadModalTitle");

  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.remove();
  });

  const modalCard = document.createElement("div");
  modalCard.className = "modal-card dl-modal-card";

  const header = document.createElement("div");
  header.className = "modal-header";
  header.innerHTML = `
    <h2 id="downloadModalTitle"><svg xmlns="http://www.w3.org/2000/svg" class="page-data-lucide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/></svg> تحميل الإمتحان</h2>
    <button type="button" class="close-btn dl-close" aria-label="إغلاق"><svg xmlns="http://www.w3.org/2000/svg" class="page-data-lucide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button>
  `;

  const subtitle = document.createElement("p");
  subtitle.className = "dl-subtitle";
  subtitle.textContent = "اختر صيغة التحميل";

  const grid = document.createElement("div");
  grid.className = "mode-grid";
  grid.setAttribute("role", "group");
  grid.setAttribute("aria-label", "خيارات التنزيل");

  DOWNLOAD_FORMAT_OPTIONS.forEach((opt) => {
    const iconHtml = opt.iconSvg
      ? opt.iconSvg
      : `<img src="${opt.iconUrl}" alt="" class="icon" aria-hidden="true">`;
    const card = buildExportCard({
      format: opt.format,
      label: opt.label,
      extension: opt.extension,
      icon: iconHtml,
      canCopy: opt.canCopy,
      onDownload: async () => {
        if (opt.format === "text") {
          const { config: c, questions: q } = await getExportData();
          const text = await buildQuizText(c, q);
          const blob = new Blob([text], { type: "text/plain" });
          triggerDownload(blob, `${safeBase}.txt`);
        } else if (opt.format === "json") {
          const fileContent = await buildJsonString();
          const blob = new Blob([fileContent], { type: "application/json" });
          triggerDownload(blob, `${safeBase}.json`);
        } else {
          const { config: c, questions: q } = await getExportData();
          await executeExport(opt.format, c, q);
        }
        modal.remove();
      },
      onCopy: async () => {
        const { config: c, questions: q } = await getExportData();
        if (opt.format === "quiz") return await buildStandaloneQuizHtml(c, q);
        if (opt.format === "html") return await buildQuizHtml(c, q);
        if (opt.format === "md") return buildQuizMarkdown(c, q);
        if (opt.format === "text") return await buildQuizText(c, q);
        if (opt.format === "json") return await buildJsonString();
      },
    });
    grid.appendChild(card);
  });

  // Show source button if the quiz has a source URL
  const quizSource = config.source;
  if (quizSource && typeof quizSource === "string" && quizSource.trim()) {
    const sourceBtn = document.createElement("button");
    sourceBtn.className = "mode-btn";
    sourceBtn.type = "button";
    sourceBtn.setAttribute("aria-label", "Download Source");
    sourceBtn.innerHTML = `${DOWNLOAD_SOURCE_ICON_SVG}<strong>Download Source</strong>`;
    sourceBtn.onclick = (ev) => {
      ev.stopPropagation();
      window.open(quizSource, "_blank");
      modal.remove();
    };
    grid.appendChild(sourceBtn);
  }

  modalCard.appendChild(header);
  modalCard.appendChild(subtitle);
  modalCard.appendChild(grid);
  modal.appendChild(modalCard);

  modal.querySelector(".dl-close").onclick = () => modal.remove();

  document.body.appendChild(modal);

  return modal;
}
