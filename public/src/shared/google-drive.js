// =============================================================================
// public/src/shared/google-drive.js
// Optional Google Drive connection for notebooks (import files / back up).
//   * Uses Google Identity Services' token flow ONLY. It never touches Supabase auth: no platform
//     session, no profile, no email stored anywhere. The access token lives in this module's memory.
//   * Scope drive.file: the app only sees files the user picks in the Google Picker or files it creates.
//   * Admins use the same flow and may choose any Google account in the popup (Drive-only identity).
// =============================================================================
const SCOPE = "https://www.googleapis.com/auth/drive.file";
const BACKUP_FOLDER = "Basmagi Notebooks";

let token = null;
let tokenExpires = 0;
let cfgPromise = null;
const scripts = new Map();

function loadScript(src) {
  if (!scripts.has(src)) {
    scripts.set(src, new Promise((resolve, reject) => {
      const s = Object.assign(document.createElement("script"), { src, async: true });
      s.onload = resolve; s.onerror = () => { scripts.delete(src); reject(new Error("تعذر تحميل خدمة Google.")); };
      document.head.append(s);
    }));
  }
  return scripts.get(src);
}

/** Public OAuth values come from the server's env (GOOGLE_DRIVE_CLIENT_ID, GOOGLE_PICKER_API_KEY, GOOGLE_PROJECT_NUMBER). */
export function driveConfig() {
  cfgPromise ||= fetch("/api/admin?config=google", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((c) => { if (!c?.clientId || !c?.apiKey || !c?.projectNumber) throw new Error("ربط Google Drive غير مُفعّل على هذا الموقع."); return c; })
    .catch((e) => { cfgPromise = null; throw e; });
  return cfgPromise;
}

export const driveConnected = () => !!token && Date.now() < tokenExpires;

/** Opens Google's consent popup (must run inside a click). Always lets the user pick the account. */
export async function connectDrive() {
  const cfg = await driveConfig();
  await loadScript("https://accounts.google.com/gsi/client");
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: cfg.clientId, scope: SCOPE, prompt: "select_account",
      callback: (r) => {
        if (r.error) return reject(new Error(r.error_description || r.error));
        token = r.access_token; tokenExpires = Date.now() + (Number(r.expires_in || 3600) - 60) * 1000; resolve(token);
      },
      error_callback: (e) => reject(new Error(e?.type === "popup_closed" ? "تم إغلاق نافذة Google." : "تعذر الاتصال بـ Google.")),
    });
    client.requestAccessToken();
  });
}

export function disconnectDrive() {
  if (token && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(token, () => {});
  token = null; tokenExpires = 0;
}

/** Google Picker: multi-select, My Drive + Shared with me. Resolves to [{ id, name, mimeType, size }] ([] if cancelled). */
export async function pickDriveFiles() {
  if (!driveConnected()) throw new Error("NOT_CONNECTED");
  const cfg = await driveConfig();
  await loadScript("https://apis.google.com/js/api.js");
  await new Promise((res) => window.gapi.load("picker", { callback: res }));
  const g = window.google.picker;
  return new Promise((resolve) => {
    const mine = new g.DocsView().setIncludeFolders(true).setSelectFolderEnabled(false).setMode(g.DocsViewMode.LIST);
    const shared = new g.DocsView().setIncludeFolders(true).setSelectFolderEnabled(false).setOwnedByMe(false).setMode(g.DocsViewMode.LIST);
    new g.PickerBuilder()
      .addView(mine).addView(shared)
      .enableFeature(g.Feature.MULTISELECT_ENABLED)
      .setAppId(cfg.projectNumber).setDeveloperKey(cfg.apiKey).setOAuthToken(token)
      .setCallback((d) => {
        if (d.action === g.Action.PICKED) resolve((d.docs || []).map((x) => ({ id: x.id, name: x.name, mimeType: x.mimeType, size: Number(x.sizeBytes || 0) })));
        else if (d.action === g.Action.CANCEL) resolve([]);
      })
      .build().setVisible(true);
  });
}

export async function downloadDriveFile(id) {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Drive ${res.status}`);
  return res.blob();
}

const auth = () => ({ Authorization: `Bearer ${token}` });
async function findOrCreateFolder() {
  const q = encodeURIComponent(`name='${BACKUP_FOLDER}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const found = await (await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&spaces=drive`, { headers: auth() })).json();
  if (found.files?.[0]?.id) return found.files[0].id;
  const made = await (await fetch("https://www.googleapis.com/drive/v3/files?fields=id", { method: "POST", headers: { ...auth(), "Content-Type": "application/json" }, body: JSON.stringify({ name: BACKUP_FOLDER, mimeType: "application/vnd.google-apps.folder" }) })).json();
  if (!made.id) throw new Error("تعذر إنشاء مجلد النسخ الاحتياطي.");
  return made.id;
}

function multipart(metadata, blob) {
  const boundary = `bsm${Math.random().toString(36).slice(2)}`;
  const body = new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${blob.type || "application/zip"}\r\n\r\n`, blob, `\r\n--${boundary}--`]);
  return { body, type: `multipart/related; boundary=${boundary}` };
}

/** Uploads (or updates, when `fileId` is known) one bundle zip. Returns the Drive file id. */
export async function backupToDrive({ blob, fileName, fileId }) {
  if (!driveConnected()) throw new Error("NOT_CONNECTED");
  if (fileId) {
    const m = multipart({ name: fileName }, blob);
    const res = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart&fields=id`, { method: "PATCH", headers: { ...auth(), "Content-Type": m.type }, body: m.body });
    if (res.ok) return (await res.json()).id;
    if (res.status !== 404 && res.status !== 403) throw new Error(`Drive ${res.status}`); // 404/403: file gone or from another account -> create anew
  }
  const parent = await findOrCreateFolder();
  const m = multipart({ name: fileName, parents: [parent] }, blob);
  const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", { method: "POST", headers: { ...auth(), "Content-Type": m.type }, body: m.body });
  if (!res.ok) throw new Error(`Drive ${res.status}`);
  return (await res.json()).id;
}
