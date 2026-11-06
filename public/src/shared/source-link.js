// Pure helpers for the «المصدر» row of every info modal (quiz / lesson / notebook).
// When the source is a Google Drive / Docs link, the modals show the Drive icon.
export const DRIVE_ICON_SRC = "/assets/images/google-drive-icon.webp";

const DRIVE_HOSTS = ["drive.google.com", "docs.google.com", "drive.usercontent.google.com"];

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
  return isGoogleDriveUrl(value)
    ? `<img class="source-drive-icon" src="${DRIVE_ICON_SRC}" alt="Google Drive" title="Google Drive" width="18" height="18" loading="lazy">`
    : "";
}
