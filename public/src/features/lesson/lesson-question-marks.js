// ============================================================================
// public/src/features/lesson/lesson-question-marks.js
// Per-lesson, per-question "star" (save) and "flag" (review) marks for the
// embedded questions' action buttons. Local to this browser only.
//
// Deliberately NOT stored through gameEngine.toggleBookmark/toggleFlag: those
// keys are `${quizId}_${questionIndex}` and the profile page turns them into
// "/quiz/<id>?startAt=<n>" links, which would be dead links for a lesson.
// ============================================================================

const KEY = "basmagi:lesson-question-marks:v1";

function readAll() {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || "{}");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function writeAll(value) {
  try {
    localStorage.setItem(KEY, JSON.stringify(value));
  } catch (error) {
    console.warn("[lesson-question-marks] Could not persist marks", error);
  }
}

/** @returns {{star?: true, flag?: true}} */
export function getQuestionMarks(lessonId, questionId) {
  return readAll()?.[lessonId]?.[questionId] || {};
}

/** Toggles `kind` ("star" | "flag"); returns the new boolean state. */
export function toggleQuestionMark(lessonId, questionId, kind) {
  if (!lessonId || !questionId || (kind !== "star" && kind !== "flag")) return false;
  const all = readAll();
  const lesson = (all[lessonId] ||= {});
  const marks = (lesson[questionId] ||= {});
  if (marks[kind]) delete marks[kind];
  else marks[kind] = true;
  const active = Boolean(marks[kind]);
  if (!Object.keys(marks).length) delete lesson[questionId];
  if (!Object.keys(lesson).length) delete all[lessonId];
  writeAll(all);
  return active;
}
