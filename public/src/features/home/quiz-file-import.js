// ============================================================================
// public/src/features/home/quiz-file-import.js
// Shared JSON quiz file import used by the امتحاناتك drop-zone and the
// inline create-quiz modal drop-zone.
// ============================================================================

import { getFromStorage, setInStorage } from "../../shared/storage-helpers.js";
import { parseQuizJson } from "../../shared/quiz-json.js";
import { buildUserQuizEntry } from "./quiz-schema.js";
import { showNotification } from "../../components/notifications/notifications.js";

function defaultTitleFromFilename(name) {
  return String(name || "quiz")
    .replace(/\.json$/i, "")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function looksLikeQuizEntry(item) {
  return (
    item &&
    typeof item === "object" &&
    !Array.isArray(item) &&
    Array.isArray(item.questions)
  );
}

function looksLikeQuestionEntry(item) {
  return (
    item &&
    typeof item === "object" &&
    !Array.isArray(item) &&
    (typeof item.q === "string" || typeof item.question === "string")
  );
}

/**
 * Normalize one parsed JSON value into zero or more user-quiz entries.
 * Supports:
 *  - single quiz object `{ meta?, questions, stats? }`
 *  - questions-only array `[{ q, options... }, ...]`
 *  - multi-quiz array `[{ meta, questions }, ...]`
 *  - bulk wrapper `{ quizzes: [...] }`
 *
 * @param {unknown} data
 * @param {string} titleFallback
 * @returns {object[]}
 */
export function quizzesFromParsedJson(data, titleFallback = "Quiz") {
  const out = [];

  if (Array.isArray(data)) {
    if (data.length === 0) return out;

    // Multi-quiz export: array of full quiz entries
    if (data.some(looksLikeQuizEntry)) {
      data.forEach((entry, index) => {
        if (!looksLikeQuizEntry(entry)) return;
        const id =
          entry.id || entry.meta?.id || crypto.randomUUID();
        out.push(
          buildUserQuizEntry(
            id,
            {
              meta: entry.meta || {
                title: entry.title || `${titleFallback} ${index + 1}`,
                description: entry.description || "",
                source: entry.source || "",
                createdAt: entry.createdAt,
              },
              stats: entry.stats,
              questions: entry.questions,
            },
            titleFallback,
          ),
        );
      });
      return out;
    }

    // Bare questions array → one quiz
    if (data.every(looksLikeQuestionEntry) || data.some(looksLikeQuestionEntry)) {
      const parsed = parseQuizJson(JSON.stringify(data), titleFallback);
      out.push(buildUserQuizEntry(crypto.randomUUID(), parsed, titleFallback));
      return out;
    }

    throw new Error("JSON array is not a quiz or questions list");
  }

  if (!data || typeof data !== "object") {
    throw new Error("JSON must be an object or array");
  }

  // `{ quizzes: [...] }`
  if (Array.isArray(data.quizzes)) {
    return quizzesFromParsedJson(data.quizzes, titleFallback);
  }

  const parsed = parseQuizJson(JSON.stringify(data), titleFallback);
  out.push(buildUserQuizEntry(crypto.randomUUID(), parsed, titleFallback));
  return out;
}

/**
 * Import one or more .json quiz files into localStorage user_quizzes.
 *
 * @param {File[]} files
 * @param {{ refresh?: boolean }} [options]
 * @returns {Promise<number>} number of quizzes imported
 */
export async function importJsonQuizFiles(files, { refresh = true } = {}) {
  const list = Array.from(files || []);
  const validFiles = [];
  const invalidNames = [];

  list.forEach((file) => {
    if (String(file.name || "").toLowerCase().endsWith(".json")) {
      validFiles.push(file);
    } else {
      invalidNames.push(file.name);
    }
  });

  if (invalidNames.length) {
    showNotification(
      "ملفات غير مدعومة",
      `يُقبل JSON فقط. تم تجاهل:\n${invalidNames.join(", ")}`,
      "warning",
    );
  }

  if (!validFiles.length) return 0;

  const existingQuizzes = JSON.parse(getFromStorage("user_quizzes", "[]"));
  let importedCount = 0;

  for (const file of validFiles) {
    let text;
    try {
      text = await file.text();
    } catch (err) {
      showNotification(
        "خطأ في القراءة",
        `تعذّر قراءة ${file.name}: ${err.message}`,
        "error",
      );
      continue;
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      showNotification(
        "خطأ في التنسيق",
        `${file.name}: JSON غير صالح`,
        "error",
      );
      continue;
    }

    try {
      const entries = quizzesFromParsedJson(
        data,
        defaultTitleFromFilename(file.name),
      );
      if (!entries.length) {
        showNotification(
          "لا توجد أسئلة",
          `${file.name}: لم يتم العثور على امتحانات صالحة`,
          "warning",
        );
        continue;
      }
      entries.forEach((entry) => {
        existingQuizzes.push(entry);
        importedCount++;
      });
    } catch (err) {
      showNotification(
        "خطأ في التنسيق",
        `${file.name}: ${err.message}`,
        "error",
      );
    }
  }

  if (importedCount > 0) {
    const quizCountText =
      importedCount === 1
        ? "امتحان واحد"
        : importedCount === 2
          ? "امتحانان"
          : importedCount > 2 && importedCount < 11
            ? `${importedCount} امتحانات`
            : `${importedCount} امتحان`;

    setInStorage("user_quizzes", JSON.stringify(existingQuizzes));
    showNotification(
      "تم الإنشاء",
      `تم إنشاء ${quizCountText} في "امتحاناتك"`,
      "success",
    );

    if (refresh) {
      const { renderRootCategories } = await import("./root-view.js");
      const { renderUserQuizzesView } = await import("./user-quizzes-view.js");
      renderRootCategories();
      renderUserQuizzesView();
    }
  } else if (validFiles.length) {
    showNotification(
      "لم يُستورد شيء",
      "تعذّر استيراد الملفات. تأكد أن الملف JSON يحتوي على questions.",
      "warning",
    );
  }

  return importedCount;
}

/**
 * Wire drag-and-drop import onto an element.
 * @param {HTMLElement} el
 * @param {(files: File[]) => void | Promise<void>} onFiles
 * @param {{
 *   activeClass?: string,
 *   isEnabled?: () => boolean,
 * }} [options]
 */
export function wireJsonFileDropZone(el, onFiles, options = {}) {
  if (!el || el.dataset.jsonDropReady === "1") return;
  el.dataset.jsonDropReady = "1";

  const activeClass = options.activeClass || "user-quizzes-drag-over";
  const isEnabled = options.isEnabled || (() => true);

  const isFileDrag = (e) =>
    Array.from(e.dataTransfer?.types || []).includes("Files");

  el.addEventListener("dragenter", (e) => {
    if (!isEnabled() || !isFileDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    el.classList.add(activeClass);
  });

  el.addEventListener("dragover", (e) => {
    if (!isEnabled() || !isFileDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    el.classList.add(activeClass);
  });

  el.addEventListener("dragleave", (e) => {
    // Only clear when leaving the element itself (not entering a child).
    if (e.relatedTarget && el.contains(e.relatedTarget)) return;
    el.classList.remove(activeClass);
  });

  el.addEventListener("drop", async (e) => {
    el.classList.remove(activeClass);
    if (!isEnabled() || !isFileDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    const files = Array.from(e.dataTransfer?.files || []);
    if (!files.length) return;
    await onFiles(files);
  });
}
