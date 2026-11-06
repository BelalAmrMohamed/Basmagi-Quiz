import { PLATFORM_ICON_SRC, sourceIconHtml } from "./source-link.js";
import { escapeHtml } from "../features/home/escape-html.js";

const COPY_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';
const COPIED_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>';

export function infoSourceHtml(value) {
  const source = String(value || "").trim();
  const safe = escapeHtml(source);
  const link = /^https?:\/\//i.test(source)
    ? `<a href="${safe}" target="_blank" rel="noopener noreferrer" dir="ltr">${safe}</a>`
    : `<span dir="ltr">${safe}</span>`;
  return `<span class="info-link-group">${sourceIconHtml(source)}${link}<button type="button" class="info-copy-btn" data-copy-value="${safe}" aria-label="نسخ رابط المصدر" title="نسخ رابط المصدر">${COPY_ICON}</button></span>`;
}

export function infoItemLinkHtml(url, title, label) {
  const safeUrl = escapeHtml(url);
  const safeTitle = escapeHtml(title || label);
  return `<span class="info-link-group info-item-link" dir="ltr"><img class="info-platform-icon" src="${PLATFORM_ICON_SRC}" alt="بصمجي" width="16" height="16"><a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${safeTitle}</a><button type="button" class="info-copy-btn" data-copy-value="${safeUrl}" aria-label="نسخ ${escapeHtml(label)}" title="نسخ الرابط">${COPY_ICON}</button></span>`;
}

async function copyText(value) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(value);
  const input = document.createElement("textarea");
  input.value = value;
  input.style.cssText = "position:fixed;top:-9999px;left:-9999px";
  document.body.appendChild(input);
  input.select();
  try {
    if (!document.execCommand("copy")) throw new Error("Copy failed");
  } finally { input.remove(); }
}

export function bindInfoCopyButtons(root) {
  root.querySelectorAll(".info-copy-btn").forEach((button) => {
    button.addEventListener("click", async () => {
      if (button.disabled) return;
      button.disabled = true;
      try {
        await copyText(button.dataset.copyValue || "");
        button.innerHTML = COPIED_ICON;
        button.classList.add("copied");
        button.setAttribute("aria-label", "تم نسخ الرابط");
        button.title = "تم النسخ";
        clearTimeout(button._copyResetTimer);
        button._copyResetTimer = setTimeout(() => {
          button.innerHTML = COPY_ICON;
          button.classList.remove("copied");
          button.disabled = false;
          button.setAttribute("aria-label", button.dataset.copyAriaLabel);
          button.title = button.dataset.copyTitle;
        }, 1800);
      } catch (error) {
        button.disabled = false;
        console.error("[info-modal] copy failed:", error);
      }
    });
    button.dataset.copyAriaLabel = button.getAttribute("aria-label") || "نسخ الرابط";
    button.dataset.copyTitle = button.title || "نسخ الرابط";
  });
}
