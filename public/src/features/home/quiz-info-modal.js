// ============================================================================
// public/src/features/home/quiz-info-modal.js
// QUIZ INFO MODAL — the "معلومات الإمتحان" read-only info table shown from
// both manifest exams (showQuizInfoModal) and user-made quizzes
// (showUserQuizInfoModal). Both build the same row list from a shared
// config-shaped object and render through the same table renderer.
// ============================================================================

import { extractFolderSegmentsFromQuizPath } from "../../shared/quizPath.js";
import { escapeHtml } from "./escape-html.js";
import { qz, formatQuestionTypesForDownload } from "./quiz-schema.js";

/**
 * extractCategoryFromPath — derives the quiz category from a manifest path.
 * Ported verbatim from result.js so both pages display the category
 * identically. See result.js for the full doc comment.
 */
export function extractCategoryFromPath(path) {
  if (!path) return "";
  const subfolders = extractFolderSegmentsFromQuizPath(path);
  if (subfolders.length > 0) return subfolders.join(" / ");
  return "";
}

/** Normalise a stored date string down to just its date portion. Mirrors
 * the formatDate() helper in result.js's quiz-info dialog. */
export function formatDateForInfo(raw) {
  if (!raw) return null;
  let d = String(raw);
  if (d.includes(",")) d = d.split(",")[0];
  else if (d.includes(" - ")) d = d.split(" - ")[0];
  else if (d.includes(" ")) d = d.split(" ")[0];
  return d || null;
}

/**
 * Builds the label/value row list for the "معلومات الإمتحان" info table.
 * Shared by showQuizInfoModal (normal/manifest exams) and
 * showUserQuizInfoModal (user-created quizzes) so both render identical
 * rows from a `config` object shaped the same way, plus a question count.
 * Rows with no value are dropped.
 */
export function buildQuizInfoRows(config, questionCount) {
  return [
    { label: "ID", val: config.id },
    { label: "العنوان", val: config.title },
    { label: "الوصف", val: config.description },
    {
      label: "المادة",
      val: config.category || extractCategoryFromPath(config.path) || null,
    },
    { label: "التاريخ", val: formatDateForInfo(config.createdAt) },
    { label: "المصدر", val: config.source },
    { label: "صاحب الإمتحان", val: config.author },
    { label: "النوع الإجباري", val: config.mode },
    {
      label: "الشكل الإجباري",
      val:
        config.view === "pagination"
          ? "كل سؤال في صفحة (Pagination)"
          : config.view === "vertical"
            ? "كل الأسئلة في صفحة واحدة (Vertical)"
            : null,
    },
    { label: "نوع الأسئلة", val: config.questionTypes },
    { label: "عدد الأسئلة", val: questionCount },
  ].filter((r) => r.val);
}

/**
 * Renders the built ROWS into the info modal's table wrapper, or an
 * "empty" message if there are no rows. Shared by showQuizInfoModal and
 * showUserQuizInfoModal.
 */
export function renderQuizInfoTable(tableWrap, rows) {
  if (!rows.length) {
    tableWrap.innerHTML = `<p class="quiz-info-empty">لا توجد معلومات إضافية</p>`;
    return;
  }

  const isUrl = (s) => /^https?:\/\//i.test(s);
  tableWrap.innerHTML = `<table class="quiz-info-table">${rows
    .map(({ label, val }) => {
      const v = String(val);
      const displayVal = isUrl(v)
        ? `<a href="${escapeHtml(v)}" target="_blank" rel="noopener noreferrer">${escapeHtml(v)}</a>`
        : escapeHtml(v);
      return `<tr><th scope="row">${escapeHtml(label)}</th><td>${displayVal}</td></tr>`;
    })
    .join("")}</table>`;
}

/**
 * Shows a read-only "quiz info" modal, listing the same fields as the
 * quiz-info dialog on result.js (title, description, category, date,
 * source, author, mode, view, question types, question count).
 *
 * Works for any exam-shaped object carrying at least an `id`/`path`; if
 * fields the manifest doesn't carry (mode/view/questionCount fallback)
 * are missing, the raw quiz file is fetched once to fill them in — same
 * defensive-patch pattern used for downloads.
 */
export async function showQuizInfoModal(exam) {
  const modal = document.createElement("div");
  modal.className = "modal-overlay";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-labelledby", "quizInfoModalTitle");
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.remove();
  });

  const modalCard = document.createElement("div");
  modalCard.className = "modal-card quiz-info-modal-card";

  const h2 = document.createElement("h2");
  h2.id = "quizInfoModalTitle";
  h2.textContent = "معلومات الإمتحان";

  const tableWrap = document.createElement("div");
  tableWrap.className = "quiz-info-table-wrap";
  tableWrap.innerHTML = `<p class="quiz-info-loading">جاري التحميل...</p>`;

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "close-modal";
  closeBtn.textContent = "إغلاق";
  closeBtn.onclick = () => modal.remove();

  modalCard.appendChild(h2);
  modalCard.appendChild(tableWrap);
  modalCard.appendChild(closeBtn);
  modal.appendChild(modalCard);
  document.body.appendChild(modal);

  // Build a config object shaped like the one result.js uses, backfilling
  // anything the manifest entry doesn't carry (view/mode, and a question
  // count fallback) from the raw quiz file — same approach as the download
  // path's defensive patch.
  const config = {
    id: exam.id,
    title: exam.title || exam.id,
    description: exam.description || null,
    category: exam.category || null,
    path: exam.path || null,
    createdAt: exam.createdAt || null,
    source: exam.source || null,
    author: exam.author || null,
    mode: null,
    view: null,
    questionTypes: formatQuestionTypesForDownload(exam.questionTypes),
  };
  let questionCount =
    typeof exam.questionCount === "number" ? exam.questionCount : null;

  try {
    if (exam.path) {
      let data = null;
      if (exam.path.endsWith(".json")) {
        const res = await fetch(exam.path);
        if (res.ok) data = await res.json();
      } else {
        const mod = await import(exam.path).catch(() => null);
        if (mod) data = mod;
      }
      if (data) {
        const meta = data.meta || {};
        const stats = data.stats || {};
        if (!config.description) config.description = meta.description || null;
        if (!config.source) config.source = meta.source || null;
        if (!config.author) config.author = meta.author || null;
        if (!config.createdAt) config.createdAt = meta.createdAt || null;
        config.mode = meta.mode || null;
        config.view = meta.view || null;
        if (!config.questionTypes)
          config.questionTypes = formatQuestionTypesForDownload(
            stats.questionTypes,
          );
        if (questionCount === null) {
          questionCount =
            stats.questionCount ?? (data.questions || []).length ?? null;
        }
      }
    }
  } catch (e) {
    console.warn("Failed to load quiz file for info modal", e);
  }

  const ROWS = buildQuizInfoRows(config, questionCount);

  if (!modal.isConnected) return; // user closed the modal while we were fetching

  renderQuizInfoTable(tableWrap, ROWS);
}

/**
 * "معلومات الإمتحان" info modal for user-made quizzes.
 *
 * Mirrors showQuizInfoModal's UI (same modal-card/table markup and the
 * shared buildQuizInfoRows/renderQuizInfoTable row logic) but skips the
 * async fetch entirely: user quizzes are stored in full in localStorage
 * (quiz.meta/quiz.stats/quiz.questions), so the `config` object can be
 * built synchronously straight from qz() — there's no `path` to fetch.
 */
export function showUserQuizInfoModal(quiz) {
  const modal = document.createElement("div");
  modal.className = "modal-overlay";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-labelledby", "quizInfoModalTitle");
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.remove();
  });

  const modalCard = document.createElement("div");
  modalCard.className = "modal-card quiz-info-modal-card";

  const h2 = document.createElement("h2");
  h2.id = "quizInfoModalTitle";
  h2.textContent = "معلومات الإمتحان";

  const tableWrap = document.createElement("div");
  tableWrap.className = "quiz-info-table-wrap";

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "close-modal";
  closeBtn.textContent = "إغلاق";
  closeBtn.onclick = () => modal.remove();

  modalCard.appendChild(h2);
  modalCard.appendChild(tableWrap);
  modalCard.appendChild(closeBtn);
  modal.appendChild(modalCard);

  // Build config directly from already-available data — no fetch needed,
  // since user quizzes carry everything in quiz.meta/quiz.stats already.
  const config = {
    id: qz(quiz, "id") || quiz.id,
    title: qz(quiz, "title") || quiz.id,
    description: qz(quiz, "description") || null,
    category: null, // user quizzes aren't filed under a category/path
    path: null,
    createdAt: qz(quiz, "createdAt") || null,
    source: qz(quiz, "source") || null,
    author: qz(quiz, "author") || null,
    mode: qz(quiz, "mode") || null,
    view: qz(quiz, "view") || null,
    questionTypes: formatQuestionTypesForDownload(
      quiz.stats?.questionTypes,
    ),
  };
  const questionCount = qz(quiz, "count") || null;

  const ROWS = buildQuizInfoRows(config, questionCount);
  renderQuizInfoTable(tableWrap, ROWS);

  document.body.appendChild(modal);
}

