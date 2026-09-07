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