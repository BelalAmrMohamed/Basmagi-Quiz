// ============================================================================
// public/src/features/home/copy-to-my-quizzes.js
// COPY TO MY QUIZZES — "نسخ لامتحاناتي": clones any manifest exam (static or
// database-backed) into the visitor's own localStorage "user_quizzes" list,
// exactly as if they'd re-imported its JSON via the create-quiz modal.
// ============================================================================
// Available on every quiz, every user, no auth required (see Phase 0 spec,
// Feature B). Unlike download, this never touches the network beyond the one
// fetch already needed to read the quiz's questions (loadFullQuizData) — the
// resulting entry is built with the same buildUserQuizEntry() the JSON-file
// import path uses, so the two ways of getting a quiz into "امتحاناتك" stay
// schema-identical.
// ============================================================================

import { getFromStorage, setInStorage } from "../../shared/storage-helpers.js";
import { buildUserQuizEntry } from "./quiz-schema.js";
import { loadFullQuizData } from "./quiz-data-loader.js";
import { showNotification } from "../../components/notifications/notifications.js";
import { hasSameLevelCollision } from "./user-quizzes-folders.js";

const copiesInFlight = new Set();

function inFlightKey(type, parentId, title) {
  return `${type}:${parentId ?? "root"}:${title}`;
}

/**
 * Shared loading-state wrapper for every "نسخ لامتحاناتي" button (root-view.js,
 * category-view.js, exam-card.js). Copying a whole course tree can take a
 * while (one loadFullQuizData() fetch per quiz, sequentially — see
 * copyCategoryTreeToUserQuizzes below), and the button previously only set
 * `.disabled = true` with no visible change, so a slow copy looked like a
 * dead click. This swaps the button to a spinner + "جاري النسخ..." for the
 * duration of `task` and always restores the original label/enabled state
 * afterward, success or failure, via try/finally.
 *
 * @param {HTMLButtonElement} button
 * @param {() => Promise<any>} task
 */
export async function withCopyButtonLoadingState(button, task) {
  const originalHtml = button.innerHTML;
  button.disabled = true;
  button.classList.add("is-copying");
  button.innerHTML = `<span class="copy-btn-spinner" aria-hidden="true"></span><span>جاري النسخ...</span>`;
  try {
    return await task();
  } finally {
    button.disabled = false;
    button.classList.remove("is-copying");
    button.innerHTML = originalHtml;
  }
}

/**
 * Copies a manifest exam (relative-path or DB-sourced) into the user's
 * local "امتحاناتك" list.
 *
 * @param {object} exam - manifest exam entry (id, title, path, ...)
 * @returns {Promise<boolean>} true if a new copy was created
 */
export async function copyQuizToUserQuizzes(exam) {
  const title = exam.title || exam.id || "";

  const key = inFlightKey("quiz", null, title);
  if (copiesInFlight.has(key)) {
    return false;
  }
  copiesInFlight.add(key);

  try {
    const userQuizzes = JSON.parse(getFromStorage("user_quizzes", "[]"));

    if (hasSameLevelCollision(userQuizzes, { type: "quiz", title, parentId: null })) {
      showNotification(
        "موجود بالفعل",
        "يوجد امتحان بنفس الاسم في المستوى الرئيسي من امتحاناتك بالفعل",
        "warning",
      );
      return false;
    }

    let loaded;
    try {
      loaded = await loadFullQuizData(exam);
    } catch (e) {
      console.error("Copy failed — could not load quiz data:", e);
      showNotification("خطأ", "تعذّر نسخ الامتحان. حاول مرة أخرى.", "error");
      return false;
    }

    // Build the meta/stats shape buildUserQuizEntry() expects, deliberately
    // dropping creator-identifying and access-control fields: a personal copy
    // shouldn't carry the original admin's author/author_email, nor inherit
    // its download password (the copy lives in the copier's own localStorage —
    // gating it against its own owner makes no sense).
    const sourceMeta = loaded.meta || {};
    const parsed = {
      meta: {
        title: exam.title || sourceMeta.title || "",
        description: exam.description || sourceMeta.description || "",
        source: exam.source || sourceMeta.source || "",
        // copiedFrom no longer powers any dedupe check (see above) — kept
        // purely as provenance, e.g. for a future "نسخة من" indicator.
        copiedFrom: exam.id,
      },
      stats: loaded.stats || undefined,
      questions: loaded.questions,
    };

    const entry = buildUserQuizEntry(
      crypto.randomUUID(),
      parsed,
      exam.title || "Quiz",
    );
    // buildUserQuizEntry() only fills meta.createdAt if missing — force it to
    // "now" (copy time), never the original quiz's createdAt.
    entry.meta.createdAt = new Date().toLocaleString("en-US");
    // Schema consistency (see hasSameLevelCollision's doc comment in
    // user-quizzes-folders.js): keep meta.id in sync with the top-level id
    // buildUserQuizEntry() already sets, so every `q.id || q.meta?.id`
    // fallback reader gets the same answer regardless of which function
    // created this row.
    entry.meta.id = entry.id;
    entry.meta.parentId = null;

    const latestUserQuizzes = JSON.parse(getFromStorage("user_quizzes", "[]"));
    latestUserQuizzes.push(entry);
    setInStorage("user_quizzes", JSON.stringify(latestUserQuizzes));

    showNotification(
      "تم النسخ",
      `تم نسخ "${exam.title || exam.id}" إلى امتحاناتك`,
      "success",
    );
    return true;
  } finally {
    copiesInFlight.delete(key);
  }
}

/**
 * Copies a complete manifest course/folder tree while preserving parentId
 * relationships. Unlike copying leaves individually, this keeps the same
 * hierarchy in the user's local collection.
 */
export async function copyCategoryTreeToUserQuizzes(rootNode, categoryTree, rootKind = "folder") {
  const rootTitle = rootNode?.name || rootNode?.title || "بدون عنوان";
  const key = inFlightKey(rootKind === "course" ? "course" : "folder", null, rootTitle);
  if (copiesInFlight.has(key)) {
    return false;
  }
  copiesInFlight.add(key);

  const userQuizzes = JSON.parse(getFromStorage("user_quizzes", "[]"));
  const copiedIds = new Map();
  const newEntries = [];
  let rootBlocked = false;
  let anySkipped = false;

  async function copyNode(node, parentId = null, forcedKind = null, isQuizNode = false, isRoot = false) {
    const sourceNode = node?.key && categoryTree?.[node.key]
      ? categoryTree[node.key]
      : node;
    const nodeId = sourceNode?.key || sourceNode?.id || sourceNode?.name;
    const title = sourceNode?.name || sourceNode?.title || "بدون عنوان";
    const isQuiz = isQuizNode || (
      Boolean(sourceNode?.dbId || sourceNode?.questionCount != null) &&
      !Array.isArray(sourceNode?.subcategories)
    );

    if (isQuiz) {
      if (hasSameLevelCollision(userQuizzes, { type: "quiz", title, parentId })) {
        anySkipped = true;
        if (isRoot) rootBlocked = true;
        return null;
      }
      let loaded;
      try {
        loaded = await loadFullQuizData({ dbId: sourceNode.dbId || sourceNode.id });
      } catch (error) {
        console.error("Copy tree failed — could not load quiz data:", error);
        return null;
      }
      const parsed = {
        meta: {
          title: title || loaded.meta?.title || "",
          description: loaded.meta?.description || "",
          source: loaded.meta?.source || "",
          copiedFrom: sourceNode.id,
          parentId,
        },
        stats: loaded.stats || undefined,
        questions: loaded.questions || [],
      };
      const entry = buildUserQuizEntry(crypto.randomUUID(), parsed, title);
      entry.meta.parentId = parentId;
      entry.meta.createdAt = new Date().toLocaleString("en-US");
      // Schema consistency (see hasSameLevelCollision's doc comment in
      // user-quizzes-folders.js) — keep meta.id synced with the top-level
      // id so every `q.id || q.meta?.id` fallback reader agrees.
      entry.meta.id = entry.id;
      userQuizzes.push(entry);
      newEntries.push(entry);
      return entry.id;
    }

    const nodeType = forcedKind || (node?.kind === "course" ? "course" : "folder");
    if (hasSameLevelCollision(userQuizzes, { type: nodeType, title, parentId })) {
      anySkipped = true;
      if (isRoot) rootBlocked = true;
      return null;
    }

    const copyId = crypto.randomUUID();
    const folderEntry = {
      id: copyId,
      meta: {
        id: copyId,
        title,
        type: nodeType,
        parentId,
        createdAt: new Date().toLocaleString("en-US"),
        copiedFrom: nodeId,
      },
      stats: { questionCount: 0, questionTypes: [] },
      questions: [],
    };
    userQuizzes.push(folderEntry);
    newEntries.push(folderEntry);
    copiedIds.set(nodeId, copyId);

    const childKeys = sourceNode?.subcategories || [];
    for (const childKey of childKeys) {
      const child = typeof childKey === "string" ? categoryTree?.[childKey] : childKey;
      if (child) await copyNode(child, copyId);
    }
    const exams = sourceNode?.exams || sourceNode?.quizzes || [];
    for (const exam of exams) {
      await copyNode({ ...exam, dbId: exam.dbId }, copyId, null, true);
    }
    return copyId;
  }

  try {
    await copyNode(rootNode, null, rootKind, false, true);

    const latestUserQuizzes = JSON.parse(getFromStorage("user_quizzes", "[]"));
    setInStorage(
      "user_quizzes",
      JSON.stringify(latestUserQuizzes.concat(newEntries)),
    );

    if (rootBlocked) {
      showNotification(
        "موجود بالفعل",
        "يوجد عنصر بنفس الاسم والنوع في هذا المستوى من امتحاناتك بالفعل.",
        "warning",
      );
      return false;
    }
    if (anySkipped) {
      showNotification(
        "تم النسخ جزئياً",
        "تم نسخ الشجرة، لكن بعض العناصر تم تخطيها لوجود عنصر بنفس الاسم والنوع في نفس المستوى بالفعل.",
        "warning",
      );
      return true;
    }
    showNotification("تم النسخ", "تم نسخ الشجرة كاملة مع الحفاظ على ترتيب المجلدات.", "success");
    return true;
  } finally {
    copiesInFlight.delete(key);
  }
}