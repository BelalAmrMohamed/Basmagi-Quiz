// ============================================================================
// public/src/features/home/download-modal.js
// DOWNLOAD MODAL — the "اختر صيغة التحميل" format-picker popup for
// user-made quizzes. The manifest-exam equivalent lives as a closure
// inside createExamCard() (exam-card.js) since it captures per-card state.
//
// This now renders the exact same modal as the create-quiz page's download
// popup (see showDownloadModal() in export-helpers.js) instead of a
// separately-styled copy — the two had drifted out of sync, and the
// create-quiz version is the better-looking, better-formatted one. The only
// thing this module still owns is the password gate (ensureDownloadAllowed),
// which the create-quiz page doesn't need since you're actively editing your
// own quiz there.
// ============================================================================

import { qz } from "./quiz-schema.js";
import { ensureDownloadAllowed } from "./download-password.js";
import { showDownloadModal } from "./export-helpers.js";

// ============================================================================
// show UserQuiz Download Popup
// ============================================================================
export async function showUserQuizDownloadPopup(quiz) {
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
}
