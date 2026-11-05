// =============================================================================
// public/src/shared/folder-sync.js
// Optional two-way sync between a notebook's browser workspace and a real folder
// (File System Access API: Chrome / Edge desktop). The user picks ONE root folder once;
// every notebook gets its own sub-folder. Newest change wins; nothing is ever deleted
// without asking (see planSync). Pure planning logic is exported for unit tests.
// =============================================================================
import * as store from "./workspace-store.js";
import { RUNTIME_CONFIG } from "./runtime-config.js";

export const folderSyncSupported = () => typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";

const MTIME_TOLERANCE = 2000;

/**
 * @param {{path,mtime}[]} local   browser workspace files
 * @param {{path,mtime}[]} remote  files on disk
 * @param {Record<string,{l:number,r:number}>} snap  state after the previous sync (mtimes seen on each side)
 * @returns {{ toDisk: string[], toBrowser: string[], askDeleteBrowser: string[], askDeleteDisk: string[] }}
 */
export function planSync(local, remote, snap = {}) {
  const L = new Map(local.map((f) => [f.path, f.mtime]));
  const R = new Map(remote.map((f) => [f.path, f.mtime]));
  const out = { toDisk: [], toBrowser: [], askDeleteBrowser: [], askDeleteDisk: [] };
  for (const path of new Set([...L.keys(), ...R.keys()])) {
    const l = L.get(path), r = R.get(path), s = snap[path];
    if (l !== undefined && r !== undefined) {
      if (!s) { if (Math.abs(l - r) > MTIME_TOLERANCE) (l > r ? out.toDisk : out.toBrowser).push(path); continue; }
      const lc = Math.abs(l - s.l) > MTIME_TOLERANCE, rc = Math.abs(r - s.r) > MTIME_TOLERANCE;
      if (lc && !rc) out.toDisk.push(path);
      else if (rc && !lc) out.toBrowser.push(path);
      else if (lc && rc) (l >= r ? out.toDisk : out.toBrowser).push(path); // both changed: newest wins
    } else if (l !== undefined) (s ? out.askDeleteBrowser : out.toDisk).push(path); // gone from disk since last sync -> ask
    else (s ? out.askDeleteDisk : out.toBrowser).push(path);                          // gone from browser since last sync -> ask
  }
  return out;
}

export const notebookFolderName = (title, key) =>
  `${String(title || "notebook").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) || "notebook"}-${String(key).slice(-6)}`;

// ── persistence of the root handle + last-sync snapshots (own DB, no migration of the workspace DB) ──
let dbp = null;
const db = () => dbp || (dbp = new Promise((res, rej) => {
  const rq = indexedDB.open("BasmagiFolderSyncDB", 1);
  rq.onupgradeneeded = () => { rq.result.createObjectStore("kv"); };
  rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
}));
const kv = async (mode, fn) => { const d = await db(); const tx = d.transaction("kv", mode); const r = fn(tx.objectStore("kv")); return new Promise((res, rej) => { tx.oncomplete = () => res(r.result); tx.onerror = () => rej(tx.error); }); };
const getKv = (k) => kv("readonly", (s) => s.get(k));
const setKv = (k, v) => kv("readwrite", (s) => s.put(v, k));
export const clearRoot = () => kv("readwrite", (s) => s.delete("root"));

export async function pickRoot() {
  const handle = await window.showDirectoryPicker({ id: "basmagi-notebooks", mode: "readwrite" });
  await setKv("root", handle);
  return handle;
}

/** Saved root handle with write permission, or null. `request` must run inside a user click. */
export async function getRoot({ request = false } = {}) {
  const h = await getKv("root").catch(() => null);
  if (!h) return null;
  let p = await h.queryPermission({ mode: "readwrite" });
  if (p === "prompt" && request) p = await h.requestPermission({ mode: "readwrite" });
  return p === "granted" ? h : null;
}
export const hasSavedRoot = async () => !!(await getKv("root").catch(() => null));

async function readDir(dir, allowed) {
  const out = [];
  for await (const [name, h] of dir.entries()) {
    if (h.kind !== "file" || !allowed.some((e) => name.toLowerCase().endsWith(e))) continue;
    const f = await h.getFile();
    out.push({ path: name, mtime: f.lastModified, file: f });
  }
  return out;
}

/**
 * Runs one sync for a notebook workspace.
 * @param {{ root: FileSystemDirectoryHandle, key: string, title: string, runtime?: string,
 *           confirmDelete: (where: "browser"|"disk", names: string[]) => Promise<boolean>,
 *           onApplied?: (files: File[]) => Promise<void> }} o   onApplied receives files copied TO the browser (to refresh the runtime)
 * @returns {Promise<{toDisk:number,toBrowser:number,deleted:number}>}
 */
export async function syncNotebook({ root, key, title, runtime = "matlab", confirmDelete, onApplied }) {
  const allowed = (RUNTIME_CONFIG[runtime] || RUNTIME_CONFIG.matlab).workspaceExts;
  const dir = await root.getDirectoryHandle(notebookFolderName(title, key), { create: true });
  const localRecs = (await store.listFiles(key)).filter((f) => allowed.some((e) => f.path.toLowerCase().endsWith(e)));
  const remote = await readDir(dir, allowed);
  const snapKey = `snap:${key}`;
  const snap = (await getKv(snapKey)) || {};
  const plan = planSync(localRecs.map((f) => ({ path: f.path, mtime: f.updatedAt })), remote.map((f) => ({ path: f.path, mtime: f.mtime })), snap);
  const L = new Map(localRecs.map((f) => [f.path, f])), R = new Map(remote.map((f) => [f.path, f]));
  let deleted = 0;

  for (const p of plan.toDisk) {
    const w = await (await dir.getFileHandle(p, { create: true })).createWritable();
    await w.write(L.get(p).blob); await w.close();
  }
  const toBrowser = [];
  for (const p of plan.toBrowser) {
    const f = R.get(p).file;
    await store.putFile(key, f, p, f.lastModified);
    toBrowser.push(new File([f], p, { type: f.type, lastModified: f.lastModified }));
  }
  if (plan.askDeleteBrowser.length && (await confirmDelete("browser", plan.askDeleteBrowser))) {
    for (const p of plan.askDeleteBrowser) { await store.deleteFile(key, p); deleted++; }
  } else for (const p of plan.askDeleteBrowser) { // user said keep: copy back to disk
    const w = await (await dir.getFileHandle(p, { create: true })).createWritable(); await w.write(L.get(p).blob); await w.close();
  }
  if (plan.askDeleteDisk.length && (await confirmDelete("disk", plan.askDeleteDisk))) {
    for (const p of plan.askDeleteDisk) { await dir.removeEntry(p).catch(() => {}); deleted++; }
  } else for (const p of plan.askDeleteDisk) { // keep: bring it back to the browser
    const f = R.get(p).file; await store.putFile(key, f, p, f.lastModified);
    toBrowser.push(new File([f], p, { type: f.type, lastModified: f.lastModified }));
  }

  // New snapshot from what both sides look like now.
  const nowLocal = (await store.listFiles(key)).filter((f) => allowed.some((e) => f.path.toLowerCase().endsWith(e)));
  const nowRemote = await readDir(dir, allowed);
  const nr = new Map(nowRemote.map((f) => [f.path, f.mtime]));
  const next = {};
  for (const f of nowLocal) if (nr.has(f.path)) next[f.path] = { l: f.updatedAt, r: nr.get(f.path) };
  await setKv(snapKey, next);
  if (toBrowser.length) await onApplied?.(toBrowser);
  return { toDisk: plan.toDisk.length, toBrowser: toBrowser.length, deleted };
}
