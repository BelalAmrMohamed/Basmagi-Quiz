// "نسخ كود التضمين" — copies an <iframe> snippet for embedding a quiz/lesson
// (Notion, blogs…). Targets ?embed=1, which strips the platform chrome
// (see shared/embed-mode.js).
import { showNotification } from "../../components/notifications/notifications.js";

export const EMBED_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/></svg>`;

export function buildEmbedUrl(kind, idOrSlug) {
  return `${window.location.origin}/${kind}/${encodeURIComponent(idOrSlug)}?embed=1`;
}

export function buildEmbedCode(kind, idOrSlug, title = "") {
  const safeTitle = String(title || (kind === "quiz" ? "امتحان" : "درس")).replace(/"/g, "&quot;");
  return `<iframe src="${buildEmbedUrl(kind, idOrSlug)}" title="${safeTitle}" width="100%" height="700" style="border:0;border-radius:12px" loading="lazy" allowfullscreen></iframe>`;
}

export async function copyEmbedCode(kind, idOrSlug, title) {
  try {
    await navigator.clipboard.writeText(buildEmbedCode(kind, idOrSlug, title));
    showNotification("تم النسخ", "تم نسخ كود التضمين. الصقه في Notion (/embed) أو في صفحة HTML.", "success");
  } catch {
    showNotification("تعذر النسخ", buildEmbedUrl(kind, idOrSlug), "warning");
  }
}
