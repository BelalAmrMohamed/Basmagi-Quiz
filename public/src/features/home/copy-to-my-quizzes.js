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

/**
 * Returns true if `examId` has already been copied into user_quizzes
 * (tracked via meta.copiedFrom on the copy).
 */
function alreadyCopied(examId, userQuizzes) {
  return userQuizzes.some((q) => q.meta?.copiedFrom === examId);
}

/**
 * Copies a manifest exam (relative-path or DB-sourced) into the user's
 * local "امتحاناتك" list.
 *
 * @param {object} exam - manifest exam entry (id, title, path, ...)
 * @returns {Promise<boolean>} true if a new copy was created
 */
export async function copyQuizToUserQuizzes(exam) {
  const userQuizzes = JSON.parse(getFromStorage("user_quizzes", "[]"));

  if (alreadyCopied(exam.id, userQuizzes)) {
    showNotification(
      "منسوخ بالفعل",
      "لقد قمت بنسخ هذا الامتحان إلى امتحاناتك من قبل",
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
      // copiedFrom powers the dedupe check above and lets a future "نسخة
      // من" indicator be added without another schema migration.
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

  userQuizzes.push(entry);
  setInStorage("user_quizzes", JSON.stringify(userQuizzes));

  showNotification(
    "تم النسخ",
    `تم نسخ "${exam.title || exam.id}" إلى امتحاناتك`,
    "success",
  );
  return true;
}

/**
 * Copies a complete manifest course/folder tree while preserving parentId
 * relationships. Unlike copying leaves individually, this keeps the same
 * hierarchy in the user's local collection.
 */
export async function copyCategoryTreeToUserQuizzes(rootNode, categoryTree, rootKind = "folder") {
  const userQuizzes = JSON.parse(getFromStorage("user_quizzes", "[]"));
  const copiedIds = new Map();

  async function copyNode(node, parentId = null, forcedKind = null) {
    const nodeId = node?.key || node?.id || node?.name;
    const title = node?.name || node?.title || "بدون عنوان";
    const isQuiz = Boolean(node?.dbId || node?.questionCount != null) && !node?.subcategories;

    if (isQuiz) {
      if (alreadyCopied(node.id, userQuizzes)) return null;
      let loaded;
      try {
        loaded = await loadFullQuizData({ dbId: node.dbId });
      } catch (error) {
        console.error("Copy tree failed — could not load quiz data:", error);
        return null;
      }
      const parsed = {
        meta: {
          title: title || loaded.meta?.title || "",
          description: loaded.meta?.description || "",
          source: loaded.meta?.source || "",
          copiedFrom: node.id,
          parentId,
        },
        stats: loaded.stats || undefined,
        questions: loaded.questions || [],
      };
      const entry = buildUserQuizEntry(crypto.randomUUID(), parsed, title);
      entry.meta.parentId = parentId;
      entry.meta.createdAt = new Date().toLocaleString("en-US");
      userQuizzes.push(entry);
      return entry.meta.id;
    }

    const copyId = crypto.randomUUID();
    const folderEntry = {
      meta: {
        id: copyId,
        title,
        type: forcedKind || (node?.kind === "course" ? "course" : "folder"),
        parentId,
        createdAt: new Date().toLocaleString("en-US"),
        copiedFrom: nodeId,
      },
      stats: { questionCount: 0, questionTypes: [] },
      questions: [],
    };
    userQuizzes.push(folderEntry);
    copiedIds.set(nodeId, copyId);

    const childKeys = node?.subcategories || [];
    for (const childKey of childKeys) {
      const child = typeof childKey === "string" ? categoryTree?.[childKey] : childKey;
      if (child) await copyNode(child, copyId);
    }
    for (const exam of node?.exams || []) {
      await copyNode({ ...exam, dbId: exam.dbId }, copyId);
    }
    return copyId;
  }

  await copyNode(rootNode, null, rootKind);
  setInStorage("user_quizzes", JSON.stringify(userQuizzes));
  showNotification("تم النسخ", "تم نسخ الشجرة كاملة مع الحفاظ على ترتيب المجلدات.", "success");
  return true;
}