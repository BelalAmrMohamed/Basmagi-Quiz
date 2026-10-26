import { showNotification } from "../notifications/notifications.js";

export async function copyTextWithFallback(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.cssText = "position:fixed;top:-9999px;left:-9999px;opacity:0;pointer-events:none;";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  try {
    if (!document.execCommand("copy")) throw new Error("execCommand copy returned false");
  } finally {
    document.body.removeChild(textarea);
  }
}

export async function withDownloadLoading(buttonEl, asyncFn) {
  const originalHtml = buttonEl.innerHTML;
  const originalWidth = buttonEl.offsetWidth;
  buttonEl.disabled = true;
  buttonEl.style.width = `${originalWidth > 0 ? originalWidth : buttonEl.getBoundingClientRect().width}px`;
  buttonEl.style.justifyContent = "center";
  buttonEl.innerHTML = '<span class="dl-btn-spinner" aria-hidden="true"></span>';
  try {
    await asyncFn();
  } finally {
    buttonEl.disabled = false;
    buttonEl.innerHTML = originalHtml;
    buttonEl.style.width = "";
    buttonEl.style.justifyContent = "";
  }
}

export function buildExportCard({ format, label, extension, icon, canCopy, onDownload, onCopy }) {
  const card = document.createElement("div");
  card.className = "export-card";
  card.setAttribute("role", "button");
  card.setAttribute("tabindex", "0");
  card.setAttribute("aria-label", `Download as ${label}${extension ? ` (${extension})` : ""}`);
  card.dataset.format = format;

  const content = document.createElement("div");
  content.className = "export-card-content";
  content.innerHTML = `
    <div class="export-icon">${icon}</div>
    <div class="export-label">${label}</div>
    ${extension ? `<div class="export-extension">${extension}</div>` : ""}
  `;
  card.appendChild(content);

  card.onclick = (event) => {
    if (event.target.closest(".mode-copy-btn")) return;
    withDownloadLoading(card, async () => {
      try {
        await onDownload();
      } catch (error) {
        console.error(error);
        showNotification("خطأ", "فشل التنزيل.", "error");
      }
    });
  };

  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      card.click();
    }
  });

  if (canCopy) {
    const copyButton = document.createElement("button");
    copyButton.className = "mode-copy-btn";
    copyButton.setAttribute("aria-label", `Copy ${label} to clipboard`);
    copyButton.title = "نسخ كنص";
    const copyIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';
    const checkIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
    copyButton.innerHTML = copyIcon;
    copyButton.onclick = async (event) => {
      event.stopPropagation();
      try {
        copyButton.disabled = true;
        copyButton.innerHTML = '<span class="dl-btn-spinner" style="width:14px;height:14px;" aria-hidden="true"></span>';
        await copyTextWithFallback(await onCopy());
        copyButton.innerHTML = checkIcon;
        copyButton.classList.add("copied");
        showNotification("تم النسخ", "تم نسخ المحتوى بنجاح!", "success");
        setTimeout(() => {
          copyButton.innerHTML = copyIcon;
          copyButton.classList.remove("copied");
          copyButton.disabled = false;
        }, 2000);
      } catch (error) {
        copyButton.innerHTML = copyIcon;
        copyButton.disabled = false;
        if (error?.message === "COPY_CANCELLED") return;
        console.error(error);
        showNotification("خطأ", "فشل النسخ.", "error");
      }
    };
    card.appendChild(copyButton);
  }

  return card;
}
