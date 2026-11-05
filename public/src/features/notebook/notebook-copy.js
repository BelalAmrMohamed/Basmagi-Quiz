// "Edit a copy": clones a published notebook into the visitor's own My Content (browser only)
// together with its workspace files, then the caller opens /notebook/edit/<newId>.
import * as store from "../../shared/workspace-store.js";

function uniqueTitle(items, base) {
  const taken = new Set(items.filter((r) => r.meta?.type === "notebook" && !r.meta?.parentId).map((r) => (r.meta?.title || "").trim().toLowerCase()));
  let n = 1, title = `${base} (copy)`;
  while (taken.has(title.toLowerCase())) title = `${base} (copy ${++n})`;
  return title;
}

/** @param {{ title, description, source, runtime, language, cells, assets, sourceKey }} nb  sourceKey = the viewer's workspace key */
export async function copyNotebookToLocal(nb) {
  let items;
  try { items = JSON.parse(localStorage.getItem("user_quizzes") || "[]"); } catch { items = []; }
  if (!Array.isArray(items)) items = [];
  const id = `user_notebook_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const content = { schemaVersion: 1, ...(nb.language ? { language: nb.language } : {}), cells: nb.cells.map((c, i) => ({ id: c.id || `cell-${i + 1}`, type: c.type === "code" ? "code" : "markdown", source: String(c.source ?? "") })) };
  items.push({
    id,
    meta: { type: "notebook", title: uniqueTitle(items, nb.title), parentId: null, createdAt: new Date().toLocaleString("en-US"), updatedAt: now, description: nb.description || "", source: nb.source || "", passwordHash: null, passwordProtected: false },
    stats: { cellCount: content.cells.length }, notebook: { runtime: nb.runtime || "matlab", content }, passwordHash: null, questions: [],
  });
  localStorage.setItem("user_quizzes", JSON.stringify(items)); // throws when full: caller shows the message
  // Workspace files: the visitor's own saved ones first, then the published manifest.
  const have = new Set();
  for (const f of await store.listFiles(nb.sourceKey).catch(() => [])) { await store.putFile(id, f.blob, f.path); have.add(f.path); }
  for (const a of nb.assets || []) {
    if (have.has(a.path)) continue;
    try { const res = await fetch(a.url); if (res.ok) await store.putFile(id, new File([await res.blob()], a.path, { type: a.mime })); } catch { /* skipped */ }
  }
  return id;
}
