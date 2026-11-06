// =============================================================================
// public/src/features/home/local-notebook.js
// PURE helpers (no DOM / storage) for creating notebooks in «محتواي», shared by the
// «دفتر جديد» modal and the drag-and-drop importer, plus the file-type router for
// drops onto the «محتواي» area. Unit-tested.
// =============================================================================

/** Extension → what the importer does with a dropped file. */
export function classifyDroppedFile(fileName) {
  const name = String(fileName || "").toLowerCase();
  if (name.endsWith(".json")) return "quiz";
  if (/\.(ipynb|m|cpp|cc|cxx|h|hpp)$/.test(name)) return "notebook";
  if (name.endsWith(".zip")) return "notebook-zip";
  return "unsupported";
}

/** Splits dropped files into quiz JSON / notebook files (.ipynb .m .cpp .cc .cxx .h .hpp .zip) / unsupported. */
export function partitionDroppedFiles(files) {
  const out = { quizFiles: [], notebookFiles: [], unsupported: [] };
  for (const file of Array.from(files || [])) {
    const kind = classifyDroppedFile(file?.name);
    if (kind === "quiz") out.quizFiles.push(file);
    else if (kind === "notebook" || kind === "notebook-zip") out.notebookFiles.push(file);
    else out.unsupported.push(file);
  }
  return out;
}

/** File name without its extension ("Lecture 1.ipynb" → "Lecture 1"). */
export function baseNameOf(fileName) {
  return String(fileName || "").replace(/\.[^.\\/]+$/, "").trim();
}

/**
 * "Title" → "Title (2)" → "Title (3)" … the first variant not in `isTaken`.
 * @param {string} title
 * @param {(candidate: string) => boolean} isTaken
 */
export function dedupeTitle(title, isTaken) {
  const base = String(title || "").trim();
  let n = 2;
  let candidate = `${base} (${n})`;
  while (isTaken(candidate) && n < 1000) candidate = `${base} (${++n})`;
  return candidate;
}

/**
 * Builds the «محتواي» storage row for a notebook.
 * @param {{title?:string, description?:string, source?:string, runtime?:string, content:{cells:any[]}}} rec  validated notebook record
 */
export function buildLocalNotebookEntry({ rec, title, parentId = null, id = `user_notebook_${crypto.randomUUID()}`, now = new Date() }) {
  return {
    id,
    meta: {
      type: "notebook",
      title,
      parentId: parentId || null,
      createdAt: now.toLocaleString("en-US"),
      updatedAt: now.toISOString(),
      description: String(rec.description || "").trim(),
      source: String(rec.source || "").trim(),
      passwordProtected: false,
    },
    stats: { cellCount: rec.content.cells.length },
    notebook: { runtime: rec.runtime, content: rec.content },
    passwordHash: null,
    questions: [],
  };
}
