// =============================================================================
// public/src/shared/notebook-publish-assets.js
// Admin publish step shared by EVERY path that sends a notebook to the platform
// (editor publish, "upload to platform" from My Content): uploads ONLY the workspace
// files that the cells reference (content-addressed, deduplicated) and returns the
// manifest. Unused files stay in the browser.
// =============================================================================
import * as store from "./workspace-store.js";
import { requestNotebookUploads, releaseStorage } from "./storage-guard.js";
import { referencedNotebookAssets } from "./content-rules.js";
import { ensureSharedSupabaseClient } from "./supabaseClientRegistry.js";

const toWebp = async (blob) => {
  try {
    const bmp = await createImageBitmap(blob);
    const cv = document.createElement("canvas"); cv.width = bmp.width; cv.height = bmp.height;
    cv.getContext("2d").drawImage(bmp, 0, 0);
    return await new Promise((r) => cv.toBlob(r, "image/webp", 0.85));
  } catch { return null; }
};

/**
 * @param {{ workspaceKey: string, cells: {type,source}[], knownAssets?: object[], compress?: boolean }} o
 * @returns {Promise<{ cells, assets, reserved: string[], unused: number }>}  `reserved` = objects created in THIS run
 *          (pass to rollbackAssets if the following save fails).
 */
export async function prepareNotebookAssets({ workspaceKey, cells, knownAssets = [], compress = false }) {
  const stored = await store.listFiles(workspaceKey).catch(() => []);
  const known = new Map(knownAssets.map((a) => [a.path.toLowerCase(), a]));
  const names = [...new Set([...stored.map((f) => f.path), ...known.keys()])];
  const used = new Set(referencedNotebookAssets(cells, names).map((n) => n.toLowerCase()));
  let outCells = cells;
  const entries = [];
  const reuse = [];
  for (const f of stored) {
    if (!used.has(f.path.toLowerCase())) continue;
    let { path, mime, blob } = { path: f.path, mime: f.mime, blob: f.blob };
    if (compress && /\.(png|jpe?g)$/i.test(path)) {
      const w = await toWebp(blob);
      if (w && w.size < blob.size) {
        path = path.replace(/\.[^.]+$/, ".webp"); mime = "image/webp"; blob = w;
        outCells = outCells.map((c) => ({ ...c, source: c.source.split(f.path).join(path) }));
      }
    }
    entries.push({ path, mime, blob });
  }
  for (const [lc, a] of known) if (used.has(lc) && !stored.some((f) => f.path.toLowerCase() === lc)) reuse.push(a);
  const unused = names.length - used.size;
  if (!entries.length) return { cells: outCells, assets: reuse, reserved: [], unused };

  const metas = await Promise.all(entries.map(async (e) => ({ path: e.path, mime: e.mime, size: e.blob.size, sha256: await store.sha256Hex(e.blob) })));
  const { files } = await requestNotebookUploads(metas);
  const sb = await ensureSharedSupabaseClient();
  const reserved = [];
  try {
    for (let i = 0; i < files.length; i++) {
      if (files[i].exists) continue;
      reserved.push(files[i].storagePath);
      const { error } = await sb.storage.from("notebook-assets").uploadToSignedUrl(files[i].storagePath, files[i].token, entries[i].blob, { contentType: entries[i].mime });
      if (error) throw new Error(`${entries[i].path}: ${error.message}`);
    }
  } catch (e) { await releaseStorage("notebook-assets", reserved); throw e; }
  return { cells: outCells, assets: [...reuse, ...entries.map((e, i) => ({ ...metas[i], url: files[i].url }))], reserved, unused };
}

export const rollbackAssets = (reserved) => (reserved?.length ? releaseStorage("notebook-assets", reserved) : Promise.resolve());
