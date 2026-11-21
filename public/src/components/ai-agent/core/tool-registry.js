// =============================================================================
// public/src/components/ai-agent/core/tool-registry.js
// Central Client Tool Registry for AI Agent:
// - Standard metadata (labels, icons, formatting) for tool-call cards
// - Pure and client-side handlers for authoring & management tools
// =============================================================================

import { getFromStorage, setInStorage } from "../../../shared/storage-helpers.js";
import { qz, buildUserQuizEntry } from "../../../features/home/quiz-schema.js";
import { hasSameLevelCollision, currentFolderId, findFolderByName } from "../../../features/home/user-content-folders.js";
import { renderUserContentView } from "../../../features/home/user-content-view.js";
import { renderRootCategories } from "../../../features/home/root-view.js";
import { buildLocalNotebookEntry } from "../../../features/home/local-notebook.js";
import { validateNotebookRecord } from "../../../features/home/notebook-input.js";
import { normalizeLessonJson } from "../../../features/lesson/lesson-json.js";
import { applyDraftPatch } from "./item-patch-engine.js";
import { fingerprint } from "./undo.js";
import { authoringRulesText } from "../../../shared/ai-agent-authoring.js";
import { createItemCardResult } from "../ai-agent-result-cards.js";

export const TOOL_METADATA = {
  create_quiz: { label: "إنشاء امتحان", badge: "Quiz", icon: "quiz" },
  create_lesson: { label: "إنشاء درس", badge: "Lesson", icon: "lesson" },
  create_notebook: { label: "إنشاء دفتر", badge: "Notebook", icon: "notebook" },
  edit_quiz: { label: "تعديل الامتحان", badge: "Edit", icon: "edit" },
  edit_current_quiz: { label: "تعديل النموذج", badge: "Edit", icon: "edit" },
  edit_item: { label: "تعديل المحتوى", badge: "Edit", icon: "edit" },
  delete_quiz: { label: "حذف الامتحان", badge: "Delete", icon: "trash" },
  create_folder: { label: "إنشاء مجلد", badge: "Folder", icon: "folder" },
  create_course: { label: "إنشاء مادة", badge: "Course", icon: "course" },
  move_item: { label: "نقل عنصر", badge: "Move", icon: "move" },
  search_library: { label: "بحث في المكتبة", badge: "Search", icon: "search" },
  search_youtube: { label: "بحث في يوتيوب", badge: "YouTube", icon: "search" },
  list_youtube: { label: "محتوى يوتيوب", badge: "YouTube", icon: "search" },
  add_youtube: { label: "حفظ من يوتيوب", badge: "YouTube", icon: "folder" },
  parse_item_info: { label: "فحص العنصر", badge: "Inspect", icon: "info" },
  get_user_activity: { label: "سجل النشاط", badge: "Activity", icon: "activity" },
  get_authoring_guide: { label: "دليل الإنشاء", badge: "Guide", icon: "guide" },
  get_creator_info: { label: "معلومات المطوّر", badge: "Creator", icon: "creator" },
  display_creator_card: { label: "بطاقة المطوّر", badge: "Card", icon: "card" },
  create_flashcards: { label: "بطاقات استذكار", badge: "Flashcards", icon: "flashcards" },
  notebook_add_cell: { label: "إضافة خلية", badge: "Cell", icon: "notebook" },
  notebook_edit_cell: { label: "تعديل خلية", badge: "Cell", icon: "notebook" },
  notebook_delete_cell: { label: "حذف خلية", badge: "Cell", icon: "trash" },
  notebook_run_cell: { label: "تشغيل خلية", badge: "Run", icon: "run" },
  reset_quiz_page: { label: "إعادة ضبط", badge: "Reset", icon: "trash" },
  fetch_attached_quiz: { label: "قراءة امتحان مرفق", badge: "Read", icon: "info" },
  fetch_attached_lesson: { label: "قراءة درس مرفق", badge: "Read", icon: "info" },
};

export function getToolMeta(toolName) {
  return TOOL_METADATA[toolName] || { label: toolName, badge: "Tool", icon: "tool" };
}

/**
 * Client handler for create_notebook tool
 * @param {{name: string, input: object}} toolCall
 * @returns {Promise<string>}
 */
export async function handleCreateNotebookToolCall(toolCall) {
  const input = toolCall?.input || {};
  const title = String(input.title || "").trim();
  if (!title) {
    const err = new Error("create_notebook: 'title' is required.");
    err.agentMessage = "Missing notebook title. Please specify a non-empty 'title'.";
    throw err;
  }

  const runtime = input.runtime === "cpp" ? "cpp" : "matlab";
  const cells = Array.isArray(input.cells) ? input.cells : [];
  if (!cells.length) {
    const err = new Error("create_notebook: 'cells' array must contain at least 1 cell.");
    err.agentMessage = "The notebook must contain at least one cell in 'cells' (markdown or code).";
    throw err;
  }

  const rec = {
    title,
    description: String(input.description || "").trim(),
    source: String(input.source || "").trim(),
    runtime,
    language: input.language === "en" ? "en" : "ar",
    content: { cells },
  };

  const validation = validateNotebookRecord(rec);
  if (validation.errors.length) {
    const err = new Error(`بيانات الدفتر غير صالحة: ${validation.errors.join("; ")}`);
    err.agentMessage = `Notebook validation failed with ${validation.errors.length} error(s):\n- ${validation.errors.join("\n- ")}\nPlease fix the cells/schema and retry.`;
    throw err;
  }

  let userItems;
  try {
    userItems = JSON.parse(getFromStorage("user_quizzes", "[]")) || [];
  } catch {
    userItems = [];
  }

  let targetParentId = currentFolderId || null;
  if (input.folder && typeof input.folder === "string") {
    const targetFolder = findFolderByName(input.folder.trim());
    if (targetFolder) {
      targetParentId = targetFolder.id;
    }
  }

  if (hasSameLevelCollision(userItems, { type: "notebook", title, parentId: targetParentId })) {
    const err = new Error(`يوجد دفتر باسم «${title}» في هذا المجلد بالفعل.`);
    err.agentMessage = `Collision: A notebook titled "${title}" already exists in this folder. Please choose a slightly different title or append (2).`;
    throw err;
  }

  const entry = buildLocalNotebookEntry({ rec, title, parentId: targetParentId });
  userItems.push(entry);

  if (!setInStorage("user_quizzes", JSON.stringify(userItems))) {
    const err = new Error("تعذّر حفظ الدفتر في التخزين المحلي.");
    err.agentMessage = "Browser local storage write failed (storage quota may be full).";
    throw err;
  }

  try {
    renderRootCategories();
    renderUserContentView();
  } catch {
    // Ignore render error if outside home view
  }

  return createItemCardResult({
    kind: "notebook",
    id: entry.id,
    title,
    detail: `${runtime.toUpperCase()} · ${cells.length} خلية`,
    href: `/notebook/${encodeURIComponent(entry.id)}?type=user`,
  });
}

/**
 * Client handler for edit_item tool
 * Supports in-place atomic patching of quizzes, lessons, notebooks, folders, and courses.
 * @param {{name: string, input: object}} toolCall
 * @returns {Promise<string>}
 */
export async function handleEditItemToolCall(toolCall, ctx) {
  const input = toolCall?.input || {};
  const targetTitle = String(input.targetTitle || input.currentTitle || "").trim();
  if (!targetTitle) {
    const err = new Error("edit_item: targetTitle is required.");
    err.agentMessage = "You must provide targetTitle (the exact title of the item in user's library to edit).";
    throw err;
  }

  let userItems;
  try {
    userItems = JSON.parse(getFromStorage("user_quizzes", "[]")) || [];
  } catch {
    userItems = [];
  }

  const index = userItems.findIndex(
    (it) => qz(it, "title") === targetTitle || it.name === targetTitle || it.title === targetTitle
  );
  if (index === -1) {
    const err = new Error(`لم يتم العثور على عنصر بعنوان «${targetTitle}».`);
    err.agentMessage = `Item not found: no item titled "${targetTitle}" exists in user's library. Available titles in context:\n${userItems.map((u) => `- ${qz(u, "title") || u.name}`).join("\n")}`;
    throw err;
  }

  const item = userItems[index];
  const before = structuredClone(item); // for the card's undo button (item is mutated below)
  const kind =
    item.meta?.type ||
    item.type ||
    (Array.isArray(item.questions) ? "quiz" : item.lesson ? "lesson" : item.notebook ? "notebook" : "quiz");

  const newTitle = input.newTitle ? String(input.newTitle).trim() : null;
  if (newTitle && newTitle !== (qz(item, "title") || item.name)) {
    const parentId = item.meta?.parentId ?? item.parentId ?? null;
    if (hasSameLevelCollision(userItems, { type: kind, title: newTitle, parentId, excludeId: item.id })) {
      const err = new Error(`يوجد عنصر بنفس الاسم «${newTitle}» في هذا المستوى بالفعل.`);
      err.agentMessage = `Collision: Renaming to "${newTitle}" collides with another item in the same folder. Choose a distinct title.`;
      throw err;
    }
    if (item.meta) item.meta.title = newTitle;
    if (item.name) item.name = newTitle;
    if (item.title) item.title = newTitle;
  }

  if (input.description !== undefined) {
    const desc = String(input.description || "").trim();
    if (item.meta) item.meta.description = desc;
  }

  const changesApplied = [];
  if (newTitle) changesApplied.push(`العنوان → "${newTitle}"`);
  if (input.description !== undefined) changesApplied.push("الوصف");

  // Apply atomic patch if provided
  if (input.patch && typeof input.patch === "object") {
    let rawContent;
    if (kind === "quiz") {
      rawContent = { meta: item.meta || {}, questions: item.questions || [] };
    } else if (kind === "lesson") {
      rawContent = { ...(item.meta || {}), sections: item.lesson?.sections || [] };
    } else if (kind === "notebook") {
      rawContent = { ...(item.meta || {}), runtime: item.notebook?.runtime || "matlab", cells: item.notebook?.content?.cells || [] };
    }

    if (rawContent) {
      const patchRes = applyDraftPatch(kind, rawContent, input.patch);
      if (patchRes.error) {
        const err = new Error(`فشل تطبيق التعديل: ${patchRes.error}`);
        err.agentMessage = `Patch operation error: ${patchRes.error}. Fix your patch.ops and try again.`;
        throw err;
      }
      if (kind === "quiz") {
        item.questions = patchRes.data.questions;
        if (patchRes.data.meta?.title && !newTitle) item.meta.title = patchRes.data.meta.title;
        if (patchRes.data.meta?.description) item.meta.description = patchRes.data.meta.description;
      } else if (kind === "lesson") {
        normalizeLessonJson({ ...item.meta, sections: patchRes.data.sections });
        item.lesson = { ...(item.lesson || {}), sections: patchRes.data.sections };
      } else if (kind === "notebook") {
        const rec = {
          title: qz(item, "title"),
          description: item.meta?.description || "",
          runtime: item.notebook?.runtime || "matlab",
          content: { cells: patchRes.data.cells },
        };
        const v = validateNotebookRecord(rec);
        if (v.errors.length) {
          const err = new Error(`بيانات الدفتر غير صالحة بعد التعديل: ${v.errors.join("; ")}`);
          err.agentMessage = `Notebook validation error after patch:\n- ${v.errors.join("\n- ")}`;
          throw err;
        }
        item.notebook.content = { cells: patchRes.data.cells };
        item.stats = { cellCount: patchRes.data.cells.length };
      }
      changesApplied.push(...(patchRes.applied || []));
    }
  }

  // Fallback direct replacements
  if (Array.isArray(input.questions) && kind === "quiz") {
    item.questions = input.questions;
    changesApplied.push(`استبدال ${input.questions.length} أسئلة`);
  }
  if (Array.isArray(input.sections) && kind === "lesson") {
    normalizeLessonJson({ ...item.meta, sections: input.sections });
    item.lesson = { ...(item.lesson || {}), sections: input.sections };
    changesApplied.push(`استبدال ${input.sections.length} أقسام`);
  }
  if (Array.isArray(input.cells) && kind === "notebook") {
    const rec = {
      title: qz(item, "title"),
      description: item.meta?.description || "",
      runtime: item.notebook?.runtime || "matlab",
      content: { cells: input.cells },
    };
    const v = validateNotebookRecord(rec);
    if (v.errors.length) {
      const err = new Error(`بيانات الخلايا غير صالحة: ${v.errors.join("; ")}`);
      err.agentMessage = `Cells validation error: ${v.errors.join("; ")}`;
      throw err;
    }
    item.notebook.content = { cells: input.cells };
    item.stats = { cellCount: input.cells.length };
    changesApplied.push(`استبدال ${input.cells.length} خلايا`);
  }

  if (item.meta) item.meta.updatedAt = new Date().toISOString();
  userItems[index] = item;
  setInStorage("user_quizzes", JSON.stringify(userItems));

  const itemId = item.id || item.meta?.id || qz(item, "id");
  const afterFp = fingerprint(item);
  const findCurrent = () => {
    let list;
    try {
      list = JSON.parse(getFromStorage("user_quizzes", "[]")) || [];
    } catch {
      list = [];
    }
    const i = list.findIndex((it) => (it.id || it.meta?.id || qz(it, "id")) === itemId);
    return { list, i };
  };
  if (itemId) {
    ctx?.registerUndo?.({
      label: `استرجاع «${qz(before, "title") || before.name || targetTitle}» كما كان`,
      isStale: () => {
        const { list, i } = findCurrent();
        return i === -1 || fingerprint(list[i]) !== afterFp;
      },
      run: () => {
        const { list, i } = findCurrent();
        if (i === -1) return { ok: false, reason: "لم يعد العنصر موجوداً." };
        if (fingerprint(list[i]) !== afterFp) return { ok: false, reason: "تم تعديل العنصر بعد هذه العملية." };
        list[i] = before;
        setInStorage("user_quizzes", JSON.stringify(list));
        try {
          renderRootCategories();
          renderUserContentView();
        } catch {
          // Ignore render error outside view
        }
      },
    });
  }

  try {
    renderRootCategories();
    renderUserContentView();
  } catch {
    // Ignore render error outside view
  }

  const effectiveTitle = newTitle || targetTitle;
  return `✅ تم تعديل «${effectiveTitle}» بنجاح! التغييرات المنفذة: ${changesApplied.join("، ") || "تحديث البيانات"}.`;
}

/**
 * Client handler for get_authoring_guide tool
 * @param {{name: string, input: object}} toolCall
 * @returns {Promise<string>}
 */
export async function handleGetAuthoringGuideToolCall(toolCall) {
  const topic = toolCall?.input?.topic || "all";
  const guides = {
    workflow: `## خطوات الإنشاء الذكي في منصة بصمجي
1. نفّذ الإجراء مباشرة فور وضوح طلب المستخدم (create_quiz, create_lesson, create_notebook, create_folder, create_course).
2. لا تطلب تأكيداً مسبقاً ("هل تريد...") للإنشاء — نفّذ الأداة فوراً. احتفظ بطلب التأكيد فقط لعمليات الحذف أو مسح المحتوى.
3. للتعديل على عناصر موجودة، استخدم edit_item مع patch.ops لتعديل الأسئلة أو الخلايا بدقة دون إعادة إرسال المحتوى كاملاً.
4. الرياضيات: دائماً LaTeX: $...$ inline، $$...$$ display.`,
    quiz: `## مواصفات الامتحانات (create_quiz)
- MCQ: options (2-8), correct, explanation.
${authoringRulesText()}
- مثال Complete: q: "عاصمة مصر {{القاهرة|Cairo}}", questionKind: "complete".`,
    lesson: `## مواصفات الدروس (create_lesson)
- يتكون الدرس من أقسام (sections)، وكل قسم يحتوي مصفوفة كتل (blocks).
- الكتل: markdown {type:"markdown", body:"..."}، أو أسئلة تفاعلية مدمجة {type:"question", prompt:"...", questionKind:"mcq"|"essay"|"complete"}.`,
    notebook: `## مواصفات دفاتر البرمجة التفاعلية (create_notebook)
- runtime: "matlab" (متصفح) أو "cpp" (مترجم C++17).
- الخلايا (cells):
  - markdown: شروحات بتنسيق Markdown وLaTeX للرياضيات.
  - code: كود برمجي تنفيذي باللغة المختارة.
  - challenge (اختياري لخلايا الكود): تحويل الخلية لتحدي برمجي يُقيّم على ناتج الطباعة expectedOutput (stdout).`,
    convert: `## دليل تحويل الملفات والمجلدات
- ملفات الأسئلة والامتحانات السابقة (.pdf, .docx, صور) → create_quiz.
- المحاضرات والشروحات والكتب → create_lesson مع أسئلة مدمجة للتقييم الذاتي.
- الأكواد وخوارزميات البرمجة وملفات .ipynb و .m و .cpp → create_notebook.`,
  };

  if (topic === "all" || !guides[topic]) {
    return Object.values(guides).join("\n\n---\n\n");
  }
  return guides[topic];
}
