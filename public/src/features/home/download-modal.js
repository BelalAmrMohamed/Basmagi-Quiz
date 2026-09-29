// ============================================================================
// public/src/features/home/download-modal.js
// DOWNLOAD MODAL — the format-picker popup for
// user-made quizzes. The manifest-exam equivalent lives as a closure
// inside createExamCard() (exam-card.js) since it captures per-card state.
//
// This renders the shared download-quiz-modal component (see
// showDownloadModal() in components/download-quiz-modal/download-quiz-modal.js)
// instead of a separately-styled copy — the two had drifted out of sync
// before this was extracted. The only thing this module still owns is the
// password gate (ensureDownloadAllowed), which the create-quiz page doesn't
// need since you're actively editing your own quiz there.
// ============================================================================

import { qz } from "./quiz-schema.js";
import { ensureDownloadAllowed } from "./download-password.js";
import { loadFullQuizData } from "./quiz-data-loader.js";
import { formatQuestionTypesForDownload } from "./quiz-schema.js";
import {
  showDownloadModal,
  withDownloadLoading,
} from "../../components/download-quiz-modal/download-quiz-modal.js";

// ============================================================================
// show UserQuiz Download Popup
// ============================================================================
/**
 * @param {object} quiz
 * @param {HTMLElement} [triggerBtn] — the button that was clicked to open
 *   this popup. When provided, it's put into a disabled/spinner loading
 *   state for the duration of ensureDownloadAllowed()'s async password
 *   check — otherwise that await is invisible to the user and the click
 *   reads as unresponsive lag before the modal appears.
 */
export async function showUserQuizDownloadPopup(quiz, triggerBtn) {
  const run = async () => {
    const allowed = await ensureDownloadAllowed(
      qz(quiz, "id") || quiz.id,
      qz(quiz, "password"),
      qz(quiz, "title"),
    );
    if (!allowed) return;

    // Config object for export functions.
    // All fields below are correctly sourced via qz() against quiz.meta/stats —
    // this path was never broken. The actual bug was in the static/manifest
    // exam path (see onDownloadOption above) and in quizManifest.js, which
    // dropped author_email/password before they ever reached the page.
    const config = {
      id: qz(quiz, "id") || quiz.id,
      title: qz(quiz, "title"),
      description: qz(quiz, "description"),
      source: qz(quiz, "source"),
      createdAt: qz(quiz, "createdAt"),
      author: qz(quiz, "author"),
      author_email: qz(quiz, "author_email"),
      password: qz(quiz, "password"),
      view: qz(quiz, "view"),
      mode: qz(quiz, "mode"),
      questionTypes: qz(quiz, "type"),
      questionCount: qz(quiz, "count"),
    };

    showDownloadModal({
      config,
      questions: quiz.questions,
      filenameBase: config.title || config.id || "quiz",
    });
  };

  if (triggerBtn) {
    await withDownloadLoading(triggerBtn, run);
  } else {
    await run();
  }
}
/** Shared public/manifest quiz download entry-point used by home cards and
 * embedded lesson references. It keeps password checks and lazy full-data
 * loading identical across surfaces. */
export async function showQuizDownloadPopup(exam, triggerBtn) {
  const run = async () => {
    let password = exam?.password || null;
    if (!password && exam?.dbId) {
      try {
        const loaded = await loadFullQuizData(exam);
        password = loaded?.meta?.password || null;
      } catch (_) {
        // The modal's lazy loader will surface the actual data error later.
      }
    }
    const allowed = await ensureDownloadAllowed(exam?.id || exam?.dbId, password, exam?.title || exam?.id);
    if (!allowed) return;
    const initialConfig = {
      id: exam?.id || exam?.dbId,
      dbId: exam?.dbId || null,
      title: exam?.title || exam?.id || "quiz",
      source: exam?.source || null,
      description: exam?.description || null,
      createdAt: exam?.createdAt || null,
      author: exam?.author || null,
      author_email: exam?.author_email || null,
      password: password || null,
      view: null,
      mode: null,
      questionTypes: exam?.questionTypes ? formatQuestionTypesForDownload(exam.questionTypes) : null,
      questionCount: exam?.questionCount || null,
    };
    showDownloadModal({
      config: initialConfig,
      questions: [],
      filenameBase: exam?.title || exam?.id || "quiz",
      resolveExportData: async ({ config }) => {
        const loaded = await loadFullQuizData(exam);
        const rawMeta = loaded.meta || {};
        const rawStats = loaded.stats || {};
        return {
          config: {
            ...config,
            source: config.source || rawMeta.source || null,
            description: config.description || rawMeta.description || null,
            createdAt: config.createdAt || rawMeta.createdAt || null,
            author: config.author || rawMeta.author || null,
            author_email: config.author_email || rawMeta.author_email || null,
            view: rawMeta.view || null,
            mode: rawMeta.mode || null,
            questionTypes: config.questionTypes || formatQuestionTypesForDownload(rawStats.questionTypes),
            questionCount: config.questionCount || rawStats.questionCount || loaded.questions.length,
          },
          questions: loaded.questions || [],
        };
      },
    });
  };
  if (triggerBtn) return withDownloadLoading(triggerBtn, run);
  return run();
}
