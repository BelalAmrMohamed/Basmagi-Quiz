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
import { showNotification } from "../../components/notifications/notifications.js";

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
 * @param {string} options.icon — The SVG icon for the card.
 * @param {boolean} options.canCopy — Whether this format can be copied to clipboard.
 * @param {Function} options.onDownload — Async function triggered on card click.
 * @param {Function} options.onCopy — Async function triggered on copy button click (if canCopy=true). Returns the text to copy.
 * @returns {HTMLDivElement}
 */
export function buildExportCard({ format, label, icon, canCopy, onDownload, onCopy }) {
  const card = document.createElement("div");
  card.className = "export-card";
  card.setAttribute("role", "button");
  card.setAttribute("tabindex", "0");
  card.setAttribute("aria-label", `Download as ${label}`);
  card.dataset.format = format;
  
  const content = document.createElement("div");
  content.className = "export-card-content";
  content.innerHTML = `
    <div class="export-icon">${icon}</div>
    <div class="export-label">${label}</div>
  `;
  card.appendChild(content);

  // Click on card -> download
  card.onclick = (e) => {
    // If clicked on the copy button, ignore
    if (e.target.closest('.mode-copy-btn')) return;
    
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
        copyBtn.innerHTML = '<i data-lucide="loader-circle" class="spin" style="width:14px;height:14px;"></i>';
        const textToCopy = await onCopy();
        await copyTextWithFallback(textToCopy);
        
        copyBtn.innerHTML = checkIconSvg;
        copyBtn.classList.add('copied');
        
        showNotification(
          "تم النسخ",
          "تم نسخ المحتوى بنجاح!",
          "success"
        );
        
        setTimeout(() => {
          copyBtn.innerHTML = copyIconSvg;
          copyBtn.classList.remove('copied');
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
