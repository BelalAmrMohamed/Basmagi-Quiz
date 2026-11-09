// =============================================================================
// public/src/shared/notebook-bundle.js
// "Notebook + files (.zip)" export shared by every place that offers a download:
// the runtime's Export dialog (create + view pages) and the download modal
// (My Content + published notebooks). Files come from the browser workspace
// (IndexedDB) and, for published notebooks, from the public asset manifest.
// =============================================================================
import * as store from "./workspace-store.js";
import { buildNotebookZip, downloadBlob, bundleFileName } from "./workspace-zip.js";

/**
 * @param {{ title, description?, source?, runtime?, language?, cells: {id?,type,source}[],
 *           assets?: {path,mime,url}[], keys?: string[] }} nb
 * keys = workspace keys to read from IndexedDB (first key wins on name clashes).
 */
export async function buildNotebookBundle(nb) {
  const files = new Map();
  for (const key of nb.keys || []) {
    for (const f of await store.listFiles(key).catch(() => [])) if (!files.has(f.path)) files.set(f.path, f.blob);
  }
  for (const a of nb.assets || []) {
    if (files.has(a.path)) continue;
    try {
      const res = await fetch(a.url);
      if (res.ok) files.set(a.path, await res.blob());
    } catch { /* a missing published file is skipped, not fatal */ }
  }
  const cells = (nb.cells || []).map((c, i) => ({ id: c.id || `cell-${i + 1}`, type: c.type === "code" ? "code" : "markdown", source: String(c.source ?? ""), ...(typeof c.stdin === "string" ? { stdin: c.stdin } : {}), ...(c.challenge && typeof c.challenge === "object" ? { challenge: c.challenge } : {}) }));
  const meta = {
    title: nb.title || "notebook", description: nb.description || "", source: nb.source || "", runtime: nb.runtime || "matlab",
    content: { schemaVersion: 1, ...(nb.language ? { language: nb.language } : {}), cells },
  };
  const blob = await buildNotebookZip(meta, [...files].map(([path, blob]) => ({ path, blob })));
  return { blob, fileName: bundleFileName(meta.title), count: files.size };
}

export async function exportNotebookZip(nb) {
  const { blob, fileName, count } = await buildNotebookBundle(nb);
  downloadBlob(blob, fileName);
  return count;
}
