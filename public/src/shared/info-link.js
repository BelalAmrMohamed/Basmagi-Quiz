import { showNotification } from "../components/notifications/notifications.js";
import { PLATFORM_ICON_SRC, sourceIconHtml } from "./source-link.js";
import { escapeHtml } from "../features/home/escape-html.js";

const COPY_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';

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
      try {
        await copyText(button.dataset.copyValue || "");
        showNotification("تم النسخ", "تم نسخ الرابط.", "success");
      } catch (error) {
        console.error("[info-modal] copy failed:", error);
        showNotification("تعذّر النسخ", "تعذّر نسخ الرابط.", "error");
      }
    });
  });
}
