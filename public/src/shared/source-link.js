// Pure helpers for the «المصدر» row of every info modal (quiz / lesson / notebook).
// When the source is a Google Drive / Docs link, the modals show the Drive icon.
export const DRIVE_ICON_SRC = "/assets/images/google-drive-icon.webp";
export const YOUTUBE_ICON_SRC = "/assets/images/youtube-icon.webp";
export const PLATFORM_ICON_SRC = "/favicon.png";

const DRIVE_HOSTS = ["drive.google.com", "docs.google.com", "drive.usercontent.google.com"];

export function sourceIconSrc(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    const host = url.hostname.toLowerCase();
    if (DRIVE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return DRIVE_ICON_SRC;
    if (host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtu.be" || host.endsWith(".youtu.be")) return YOUTUBE_ICON_SRC;
  } catch { /* non-URL sources have no platform icon */ }
  return "";
}

/** True for http(s) links that point at Google Drive / Docs. */
export function isGoogleDriveUrl(value) {
  try {
    const u = new URL(String(value || "").trim());
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    const host = u.hostname.toLowerCase();
    return DRIVE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

/** Drive icon <img> markup for Drive sources, "" otherwise (safe: no user input inside). */
export function sourceIconHtml(value) {
  const src = sourceIconSrc(value);
  if (!src) return "";
  const label = src === DRIVE_ICON_SRC ? "Google Drive" : "YouTube";
  return `<img class="source-platform-icon" src="${src}" alt="${label}" title="${label}" width="18" height="18" loading="lazy">`;
}
