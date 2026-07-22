// ============================================================================
// public/src/features/home/quiz-navigation.js
// QUIZ NAVIGATION — navigating to the quiz-taking page for a manifest exam.
// (The user-created-quiz equivalent, playUserQuiz(), lives in
// user-quiz-card.js since it's only ever called from that card.)
// ============================================================================

export function startQuiz(id) {
  try {
    localStorage.setItem("quiz_start_time", Date.now().toString());

    // Only the quiz ID travels in the URL → links are shareable
    window.location.href = `/q/${encodeURIComponent(id)}`;
  } catch (error) {
    console.error("Error starting quiz:", error);
    alert("حدث خطأ أثناء بدء الاختبار. حاول مرة أخرى.");
  }
}
