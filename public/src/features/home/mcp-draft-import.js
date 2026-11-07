// =============================================================================
// public/src/features/home/mcp-draft-import.js
// MCP draft links open «محتواي» directly: /my-content?draft=<code>
//
// The link used to open a creator page pre-filled. Now the item is saved into
// «محتواي» (localStorage "user_quizzes", root level) the moment the link is
// opened — no editor, no confirmation, no admin review (notebooks included).
// Anyone can open a link, exactly as before; only the destination changed.
//
// Flow (runs once from index-entrypoint.js, BEFORE initApp renders the view):
//   1. read ?draft=<code>; if this browser already imported it, just highlight
//      the existing item (a refresh / second click must never duplicate);
//   2. GET /api/mcp/draft/<code> → { kind, payload, assets };
//   3. build the row for the kind (quiz / lesson / notebook) with the same
//      normalizers the editors use, save it, copy notebook files to the browser
//      workspace, delete the server draft, clean the URL;
//   4. remember the new id so the grid can highlight it (takePendingHighlight).
// =============================================================================
import { getFromStorage, setInStorage } from "../../shared/storage-helpers.js";
import { parseQuizJson } from "../../shared/quiz-json.js";
import { cleanSource } from "../../shared/content-rules.js";
import { normalizeLessonDraft } from "../lesson/lesson-json.js";
import { notebookFromPayload, buildPayload as buildNotebookPayload, validateState as validateNotebookState } from "../notebook/notebook-editor-model.js";
import { buildUserQuizEntry } from "./quiz-schema.js";
import { buildLocalNotebookEntry, dedupeTitle } from "./local-notebook.js";
import { hasSameLevelCollision } from "./user-quizzes-folders.js";
import * as wsStore from "../../shared/workspace-store.js";
import { showNotification as showToast } from "../../components/notifications/notifications.js";

/** A toast must never turn an already-saved import into a reported failure. */
const showNotification = (...args) => { try { showToast(...args); } catch (e) { console.warn("[mcp-draft-import] toast failed", e); } };

const DRAFT_RE = /^[2-9a-hj-km-np-z]{10}$/;
const IMPORTED_KEY = "mcp_imported_drafts"; // { [code]: itemId } — makes re-opening a link idempotent
const IMPORTED_MAX = 50;

const KIND_LABEL = { quiz: "الامتحان", lesson: "الدرس", notebook: "الدفتر" };

/** { id, title, kind } of the item that was just created from a link; consumed by the grid. */
let pendingHighlight = null;

/** Returns the id to highlight once (then forgets it), or null. */
export function takePendingHighlight() {
  const id = pendingHighlight?.id || null;
  pendingHighlight = null;
  return id;
}

export function peekPendingHighlight() {
  return pendingHighlight?.id || null;
}

function draftCodeFromUrl() {
  try {
    const q = new URLSearchParams(window.location.search).get("draft");
    return q && DRAFT_RE.test(q) ? q : null;
  } catch {
    return null;
  }
}

/** Removes ?draft= (keeps any other query + the hash) without adding a history entry. */
function stripDraftParam() {
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete("draft");
    history.replaceState(history.state, "", url.pathname + url.search + url.hash);
  } catch { /* ignore */ }
}

const readImported = () => {
  try {
    const v = JSON.parse(getFromStorage(IMPORTED_KEY, "{}"));
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
};

function rememberImported(code, id) {
  const map = readImported();
  map[code] = id;
  const keys = Object.keys(map);
  for (const k of keys.slice(0, Math.max(0, keys.length - IMPORTED_MAX))) delete map[k];
  setInStorage(IMPORTED_KEY, JSON.stringify(map));
}

const readItems = () => {
  try {
    const a = JSON.parse(getFromStorage("user_quizzes", "[]"));
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
};

/** Title that does not collide with a same-type sibling at the root: "T" → "T (2)" … */
function freeTitle(items, type, rawTitle, fallback) {
  const base = String(rawTitle || "").trim() || fallback;
  const taken = (t) => hasSameLevelCollision(items, { type, title: t, parentId: null });
  return taken(base) ? dedupeTitle(base, taken) : base;
}

// ── Row builders (pure: payload → row) ───────────────────────────────────────

function buildQuizRow(payload, items) {
  const parsed = parseQuizJson(JSON.stringify(payload));
  if (!parsed.questions.length) throw new Error("المسودة لا تحتوي على أسئلة.");
  const title = freeTitle(items, "quiz", parsed.meta?.title, "امتحان جديد");
  const meta = { ...(parsed.meta || {}), title, updatedAt: new Date().toISOString() };
  // `source` is a link and nothing else (same rule the editor applies).
  const source = cleanSource(String(meta.source ?? "").trim());
  if (source) meta.source = source; else delete meta.source;
  const entry = buildUserQuizEntry(crypto.randomUUID(), { ...parsed, meta }, title, null);
  return { entry, title };
}

function buildLessonRow(payload, items) {
  const lesson = normalizeLessonDraft(payload); // lenient, like the editor: fixable problems are never fatal
  const title = freeTitle(items, "lesson", lesson.title, "درس جديد");
  const id = `user_lesson_${Date.now()}`;
  let questionCount = 0;
  for (const s of lesson.sections) for (const b of s.blocks) if (b.type === "question") questionCount++;
  const now = new Date();
  const entry = {
    id,
    meta: {
      type: "lesson",
      title,
      parentId: null,
      createdAt: now.toLocaleString("en-US"),
      updatedAt: now.toISOString(),
      readerPrefs: { fontId: "default" },
      description: lesson.description || "",
      source: lesson.source || "",
      passwordProtected: false,
    },
    stats: { questionCount, sectionCount: lesson.sections.length },
    lesson: { sections: lesson.sections },
    passwordHash: null,
    questions: [],
  };
  return { entry, title };
}

function buildNotebookRow(payload, items) {
  const state = notebookFromPayload(payload);
  const v = validateNotebookState(state, "ar");
  if (v.errors.length) throw new Error(v.errors[0]);
  const rec = buildNotebookPayload(state);
  const title = freeTitle(items, "notebook", rec.title, "دفتر جديد");
  const entry = buildLocalNotebookEntry({ rec, title });
  return { entry, title };
}

const BUILDERS = { quiz: buildQuizRow, lesson: buildLessonRow, notebook: buildNotebookRow };

// ── Network ──────────────────────────────────────────────────────────────────

async function fetchDraft(code) {
  let res;
  try {
    res = await fetch(`/api/mcp/draft/${code}`, { cache: "no-store" });
  } catch {
    throw new Error("تعذّر الاتصال بالخادم لتحميل الرابط. تحقق من الإنترنت وحاول مجدداً.");
  }
  if (res.status === 404) throw new Error("انتهت صلاحية هذا الرابط (يدوم 72 ساعة) أو تم استخدامه من قبل. اطلب من Claude رابطاً جديداً.");
  if (!res.ok) throw new Error("تعذّر تحميل الرابط.");
  return res.json();
}

/** Notebook workspace files (signed URLs) → this browser's workspace for the new notebook. Returns how many were skipped. */
async function copyNotebookAssets(notebookId, assets) {
  let failed = 0;
  for (const a of Array.isArray(assets) ? assets : []) {
    try {
      const res = await fetch(a.url);
      if (!res.ok) throw new Error(String(res.status));
      await wsStore.putFile(notebookId, new File([await res.blob()], a.path, { type: a.mime || "" }), a.path);
    } catch {
      failed++;
    }
  }
  return failed;
}

// ── Public entry point ───────────────────────────────────────────────────────

/**
 * Imports the draft named by ?draft= (if any) into «محتواي».
 * Never throws: failures are shown as a notification and the page loads normally.
 * @returns {Promise<{id: string, title: string, kind: string, existing?: boolean}|null>}
 */
export async function importMcpDraftFromUrl() {
  const code = draftCodeFromUrl();
  if (!code) return null;
  try {
    // Same browser, same link (refresh / double click / back button): don't create a second copy.
    const knownId = readImported()[code];
    if (knownId && readItems().some((r) => (r.id || r.meta?.id) === knownId)) {
      stripDraftParam();
      const row = readItems().find((r) => (r.id || r.meta?.id) === knownId);
      pendingHighlight = { id: knownId, title: row?.meta?.title || "", kind: row?.meta?.type || "quiz" };
      showNotification("أُضيف مسبقاً", `«${pendingHighlight.title}» موجود بالفعل في «محتواي».`, "info");
      return { ...pendingHighlight, existing: true };
    }

    const draft = await fetchDraft(code);
    const build = BUILDERS[draft.kind];
    if (!build) throw new Error("نوع هذا الرابط غير مدعوم.");

    const items = readItems();
    const { entry, title } = build(draft.payload, items);
    const id = entry.id || entry.meta?.id;

    if (!setInStorage("user_quizzes", JSON.stringify([...items, entry]))) {
      throw new Error("تعذّر الحفظ محلياً. قد تكون مساحة التخزين ممتلئة.");
    }
    rememberImported(code, id);

    let skippedFiles = 0;
    if (draft.kind === "notebook") skippedFiles = await copyNotebookAssets(id, draft.assets);

    // The content now lives in this browser; the server copy (and its temporary files) can go.
    fetch(`/api/mcp/draft/${code}`, { method: "DELETE", keepalive: true }).catch(() => { /* expires on its own after 72 h */ });
    stripDraftParam();

    pendingHighlight = { id, title, kind: draft.kind };
    showNotification(
      `تمت إضافة ${KIND_LABEL[draft.kind] || "العنصر"} إلى «محتواي»`,
      `«${title}» جاهز الآن — مميّز بشارة «جديد» في القائمة.`,
      "success",
      8,
    );
    if (skippedFiles) showNotification("", "تعذّر تنزيل بعض الملفات التي أرفقها Claude بالدفتر. أضفها يدوياً من مساحة عمل الدفتر.", "warning", 8);
    return pendingHighlight;
  } catch (err) {
    console.error("[mcp-draft-import]", err);
    stripDraftParam();
    showNotification("تعذّر إضافة المحتوى", err?.message || "حدث خطأ غير متوقع.", "error", 10);
    return null;
  }
}
