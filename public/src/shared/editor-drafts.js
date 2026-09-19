// Drafts intentionally live outside the workspace item tree, so incomplete
// editors cannot appear as quizzes or lessons in "امتحاناتك".
const DRAFTS_KEY = "user_quiz_drafts";
const WORKSPACE_KEY = "user_quizzes";

export function readEditorDrafts() {
  try {
    const value = JSON.parse(localStorage.getItem(DRAFTS_KEY) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export function writeEditorDrafts(drafts) {
  localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
}

export function upsertEditorDraft(draft) {
  const drafts = readEditorDrafts();
  const index = drafts.findIndex((item) => item.id === draft.id);
  if (index >= 0) drafts[index] = draft;
  else drafts.push(draft);
  writeEditorDrafts(drafts);
}

export function removeEditorDraft(id) {
  writeEditorDrafts(readEditorDrafts().filter((draft) => draft.id !== id));
}

/** Move old draft rows out of the user workspace once. */
export function migrateWorkspaceDrafts() {
  const drafts = readEditorDrafts();
  try {
    const workspace = JSON.parse(localStorage.getItem(WORKSPACE_KEY) || "[]");
    if (!Array.isArray(workspace)) return;
    const legacy = workspace.filter((item) =>
      item?.meta?.type === "draft" || item?.meta?.type === "draft-lesson",
    );
    if (!legacy.length) return;
    const known = new Set(drafts.map((item) => item.id));
    writeEditorDrafts([...drafts, ...legacy.filter((item) => !known.has(item.id))]);
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify(workspace.filter((item) => !legacy.includes(item))));
  } catch {
    // Ignore malformed legacy storage and allow the editor to load.
  }
}
