// ============================================================================
// public/src/features/home/quiz-info-modal.js
// QUIZ INFO MODAL — the "معلومات الامتحان" read-only info dialog shown from
// both manifest exams (showQuizInfoModal) and user-made quizzes
// (showUserQuizInfoModal).
// ============================================================================

import { qz, formatQuestionTypesForDownload } from "./quiz-schema.js";
import { loadFullQuizData } from "./quiz-data-loader.js";
import { buildQuizInfoModalHtml, fetchCreatorProfile } from "../../components/quiz-info-modal/quiz-info-html.js";
import { fetchQuizDetails, buildInfoSkeletonDialogHtml } from "./info-details.js";
import { getEduTypeLabel } from "./course-info-fields.js";
export { formatDateForInfo } from "../../components/quiz-info-modal/quiz-info-html.js";

/**
 * Creates and shows the dialog element
 */
function createAndShowDialog(htmlContent) {
  const dialog = document.createElement("dialog");
  dialog.className = "quiz-info-dialog";
  dialog.setAttribute("aria-labelledby", "quizInfoDialogTitle");
  
  // Set content
  dialog.innerHTML = htmlContent;
  
  document.body.appendChild(dialog);
  
  // Close handlers
  const closeBtn = dialog.querySelector(".quiz-info-dialog-close");
  if (closeBtn) {
    closeBtn.onclick = () => {
      dialog.close();
      dialog.remove();
    };
  }
  
  // Backdrop click handler
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) {
      dialog.close();
      dialog.remove();
    }
  });

  dialog.showModal();
  return dialog;
}

/**
 * Shows a read-only "quiz info" modal for manifest exams.
 */
export async function showQuizInfoModal(exam) {
  // Show the shimmer skeleton first
  const loadingHtml = buildInfoSkeletonDialogHtml("معلومات الامتحان");
  const dialog = createAndShowDialog(loadingHtml);

  const config = {
    id: exam.id,
    quizUrl: `${window.location.origin}/quiz/${encodeURIComponent(exam.id || "")}`,
    dbId: exam.dbId,
    title: exam.title || exam.id,
    description: exam.description || null,
    category: exam.category || null,
    createdAt: exam.createdAt || null,
    source: exam.source || null,
    author: exam.author || null,
    authorHandle: exam.authorHandle || null, // Can be provided in newer manifests
    authorId: exam.author_id || null,
    mode: null,
    view: null,
    questionTypes: formatQuestionTypesForDownload(exam.questionTypes),
    // Password is never shown — only whether the quiz has one.
    passwordProtected: Boolean(exam.password),
    eduTypeLabel: exam.education_type ? getEduTypeLabel(exam) : null,
  };
  let questionCount = typeof exam.questionCount === "number" ? exam.questionCount : null;

  // Extra DB facts (dates, uploader, college/year/term, attempts) are
  // fetched in parallel with the quiz body so the modal doesn't wait twice.
  const detailsPromise = exam.dbId ? fetchQuizDetails(exam.dbId) : Promise.resolve(null);

  try {
    if (exam.dbId) {
      const { questions, meta, stats } = await loadFullQuizData(exam);
      if (meta) {
        if (!config.description) config.description = meta.description || null;
        if (!config.source) config.source = meta.source || null;
        if (!config.author) config.author = meta.author || null;
        if (!config.authorHandle) config.authorHandle = meta.author_handle || null;
        if (!config.authorId) config.authorId = meta.author_id || null;
        if (!config.createdAt) config.createdAt = meta.createdAt || null;
        config.mode = meta.mode || null;
        config.view = meta.view || null;
      }
      if (stats && !config.questionTypes) {
        config.questionTypes = formatQuestionTypesForDownload(stats.questionTypes);
      }
      if (questionCount === null) {
        questionCount = stats?.questionCount ?? (questions || []).length ?? null;
      }
    }
  } catch (e) {
    console.warn("Failed to load quiz file for info modal", e);
  }

  const details = await detailsPromise;
  if (details) {
    if (!config.createdAt) config.createdAt = details.created_at || null;
    config.syncedAt = details.synced_at || null;
    if (!config.authorId && !config.authorHandle) config.authorId = details.uploaded_by || null;
    if (details.college && details.college !== "All") config.college = details.college;
    if (details.year) config.year = details.year;
    if (details.term) config.term = details.term;
    if (!config.eduTypeLabel && details.education_type) {
      config.eduTypeLabel = getEduTypeLabel({ education_type: details.education_type });
    }
    if (typeof details.attempt_count === "number") config.attemptCount = details.attempt_count;
  }

  let creatorProfile = null;
  const authorIdentifier = config.authorId || config.authorHandle;
  if (authorIdentifier) {
    const type = config.authorId ? "id" : "handle";
    creatorProfile = await fetchCreatorProfile(authorIdentifier, type);
  }

  if (!dialog.isConnected) return; // user closed the modal while we were fetching

  // Replace with fully loaded HTML
  dialog.innerHTML = buildQuizInfoModalHtml(config, questionCount, creatorProfile);
  
  // Re-bind close handler after innerHTML replacement
  const closeBtn = dialog.querySelector(".quiz-info-dialog-close");
  if (closeBtn) {
    closeBtn.onclick = () => {
      dialog.close();
      dialog.remove();
    };
  }
}

/**
 * "معلومات الامتحان" info modal for user-made quizzes.
 */
export function showUserQuizInfoModal(quiz) {
  const config = {
    id: qz(quiz, "id") || quiz.id,
    quizUrl: `${window.location.origin}/quiz/${encodeURIComponent(qz(quiz, "id") || quiz.id || "")}?type=user`,
    title: qz(quiz, "title") || quiz.id,
    description: qz(quiz, "description") || null,
    category: null, 
    path: null,
    createdAt: qz(quiz, "createdAt") || null,
    source: qz(quiz, "source") || null,
    author: qz(quiz, "author") || null,
    mode: qz(quiz, "mode") || null,
    view: qz(quiz, "view") || null,
    questionTypes: formatQuestionTypesForDownload(quiz.stats?.questionTypes),
  };
  const questionCount = qz(quiz, "count") || null;

  const html = buildQuizInfoModalHtml(config, questionCount, null);
  createAndShowDialog(html);
}