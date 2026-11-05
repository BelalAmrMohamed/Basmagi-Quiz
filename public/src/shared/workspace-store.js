// =============================================================================
// public/src/shared/workspace-store.js
// Browser-only virtual workspace folder for notebooks (IndexedDB). One workspace
// per notebook key ("draft", "user_notebook_<uuid>", a published id...). Files are
// kept byte-for-byte (original name + extension) so imread("cat.png") keeps working.
// Nothing here touches the network or Supabase.
// =============================================================================
const DB_NAME = "BasmagiWorkspaceDB";
const STORE = "files";

let dbPromise = null;
function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const store = req.result.createObjectStore(STORE, { keyPath: ["nb", "path"] });
        store.createIndex("by-nb", "nb");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { dbPromise = null; reject(req.error || new Error("IndexedDB unavailable")); };
    });
  }
  return dbPromise;
}

const done = (tx) => new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });
const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export async function sha256Hex(blob) {
  const buf = await blob.arrayBuffer();
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", buf));
  return Array.from(h, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Stores/overwrites a file. Returns the stored record (without the blob). */
export async function putFile(nb, file, name = file.name, updatedAt = Date.now()) {
  const rec = { nb, path: name, mime: file.type || "application/octet-stream", size: file.size, sha256: await sha256Hex(file), blob: file, updatedAt };
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).put(rec);
  await done(tx);
  const { blob, ...meta } = rec;
  return meta;
}

/** All records of a workspace, blobs included. */
export async function listFiles(nb) {
  const db = await openDb();
  return reqP(db.transaction(STORE).objectStore(STORE).index("by-nb").getAll(nb));
}

export async function deleteFile(nb, path) {
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).delete([nb, path]);
  await done(tx);
}

export async function clearWorkspace(nb) {
  const files = await listFiles(nb);
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  for (const f of files) tx.objectStore(STORE).delete([nb, f.path]);
  await done(tx);
}

/** Moves every file from one key to another (draft -> saved notebook id). */
export async function renameWorkspace(from, to) {
  if (from === to) return;
  const files = await listFiles(from);
  if (!files.length) return;
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  const s = tx.objectStore(STORE);
  for (const f of files) { s.delete([from, f.path]); s.put({ ...f, nb: to }); }
  await done(tx);
}

export async function workspaceSize(nb) {
  return (await listFiles(nb)).reduce((n, f) => n + f.size, 0);
}
