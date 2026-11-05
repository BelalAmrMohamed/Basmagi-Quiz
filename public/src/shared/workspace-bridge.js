// =============================================================================
// public/src/shared/workspace-bridge.js
// Glue between the (minified) notebook runtime and the IndexedDB workspace store.
// The runtime calls window.__mlwebFileHook.add/del when a learner/author adds or
// removes a workspace file; we persist the ORIGINAL file bytes and restore them
// into the runtime on load via window.__mlweb.addFile. Published notebooks restore
// from their asset manifest (public URLs) instead.
// =============================================================================
import * as store from "./workspace-store.js";

export const SLOW_WORKSPACE_BYTES = 50 * 1024 * 1024; // warning only, never a limit

/**
 * @param {string} key   workspace key (changes via setKey when a draft gets its id)
 * @param {{ persist?: boolean, onWarn?: (msg:string)=>void, onChange?: ()=>void }} [opts]
 */
export function createWorkspaceBridge(key, opts = {}) {
  const persist = opts.persist !== false;
  let current = key;
  let silent = 0;
  let warned = false;

  async function checkSize() {
    if (warned || !opts.onWarn) return;
    const size = await store.workspaceSize(current).catch(() => 0);
    if (size > SLOW_WORKSPACE_BYTES) { warned = true; opts.onWarn(`حجم ملفات الدفتر ${Math.round(size / 1048576)}MB — قد يصبح الدفتر بطيئاً.`); }
  }

  const listeners = new Set();
  const emit = (kind, name) => listeners.forEach((fn) => { try { fn(kind, name); } catch { /* listener errors never break the notebook */ } });

  window.__mlwebFileHook = {
    add(file) {
      if (silent) return;
      opts.onChange?.();
      if (persist) store.putFile(current, file).then(() => { checkSize(); emit("add", file.name); }).catch((e) => console.warn("[workspace] save failed", e));
    },
    del(name) {
      opts.onChange?.();
      if (persist) store.deleteFile(current, name).then(() => emit("del", name)).catch(() => {});
    },
  };

  /** The runtime creates its worker a moment after mount; retry briefly. */
  async function addToRuntime(file) {
    for (let i = 0; i < 40; i++) {
      try { if (window.__mlweb?.addFile) { await window.__mlweb.addFile(file); return true; } } catch { /* worker not ready */ }
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  }

  async function withSilence(fn) { silent++; try { return await fn(); } finally { silent--; } }

  return {
    get key() { return current; },
    setKey(k) { current = k; },
    /** Puts stored files back into the runtime (no re-save). */
    restore: () => withSilence(async () => {
      const files = await store.listFiles(current).catch(() => []);
      for (const f of files) await addToRuntime(new File([f.blob], f.path, { type: f.mime, lastModified: f.updatedAt }));
      return files.length;
    }),
    /** Downloads a published manifest [{path,mime,url}] into the runtime. Failures are skipped. */
    loadManifest: (assets) => withSilence(async () => {
      let ok = 0;
      await Promise.all((assets || []).map(async (a) => {
        try {
          const res = await fetch(a.url);
          if (!res.ok) throw new Error(String(res.status));
          const blob = await res.blob();
          if (await addToRuntime(new File([blob], a.path, { type: a.mime }))) ok++;
        } catch (e) { console.warn("[workspace] asset failed", a.path, e); }
      }));
      return ok;
    }),
    /** Adds Files (zip import / drafts) to both the store and the runtime. */
    addFiles: async (files) => {
      for (const f of files) {
        if (persist) await store.putFile(current, f);
        await withSilence(() => addToRuntime(f));
      }
      await checkSize();
      emit("add", "*");
    },
    /** Puts files into the runtime only (they are already saved elsewhere, e.g. copied from a synced folder). */
    loadIntoRuntime: (files) => withSilence(async () => { for (const f of files) await addToRuntime(f); }),
    list: () => store.listFiles(current),
    /** fn(kind: "add"|"del", name) after a user change was saved to the browser workspace. Returns unsubscribe. */
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
