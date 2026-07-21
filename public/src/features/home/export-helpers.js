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
import { COPY_TEXT_ICON_SVG, DOWNLOAD_TXT_ICON_SVG } from "./icons.js";

// NOTE: showNotification() is a global provided by src/components/notifications.js,
// loaded as a plain (non-module) <script> in index.html — not imported here,
// matching the original single-file index.js's behavior.

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
 * Creates a mode-grid button that copies quiz text on first click,
 * then offers a .txt download on the second click.
 *
 * @param {Function} getTextFn — async () => string  — called on first click to
 *   retrieve the quiz text (load + format). Throw to surface an error notification.
 * @param {string} downloadFilename — base filename for the .txt download (no extension).
 * @returns {HTMLButtonElement}
 */
export function buildCopyDownloadButton(getTextFn, downloadFilename) {
  const btn = document.createElement("button");
  btn.className = "mode-btn";
  btn.type = "button";
  btn.setAttribute("aria-label", "نسخ كنص");

  const copyIcon = COPY_TEXT_ICON_SVG;
  const downloadIcon = DOWNLOAD_TXT_ICON_SVG;

  btn.innerHTML = `${copyIcon}<strong>نسخ كنص</strong>`;

  let isCopied = false;
  let textBlob = null;

  btn.onclick = (ev) => {
    ev.stopPropagation();
    withDownloadLoading(btn, async () => {
      try {
        if (!isCopied) {
          const text = await getTextFn();
          await copyTextWithFallback(text);
          textBlob = new Blob([text], { type: "text/plain" });
          btn.innerHTML = `${downloadIcon}<strong>تنزيل .txt</strong>`;
          btn.setAttribute("aria-label", "تنزيل .txt");
          isCopied = true;
          showNotification(
            "تم النسخ",
            "تم نسخ نص الإختبار! انقر مرة أخرى لتحميله كملف .txt",
            "success",
          );
        } else {
          triggerDownload(textBlob, `${downloadFilename}.txt`);
          isCopied = false;
        }
      } catch (e) {
        console.error(e);
        showNotification("خطأ", "فشل نسخ أو تحميل الإختبار.", "error");
      }
    }).then(() => {
      if (isCopied) {
        btn.innerHTML = `${downloadIcon}<strong>تنزيل .txt</strong>`;
      } else {
        btn.innerHTML = `${copyIcon}<strong>نسخ كنص</strong>`;
      }
    });
  };

  return btn;
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
