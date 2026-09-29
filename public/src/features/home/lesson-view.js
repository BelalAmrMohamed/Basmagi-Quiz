// ============================================================================
// public/src/features/home/lesson-view.js
// COMPATIBILITY BRIDGE
// ============================================================================
// The real /lesson/:id implementation now lives in the dedicated lesson
// feature. Keep this legacy import path as a tiny re-export for older callers
// instead of retaining a second, outdated viewer (and second loading UI).

export { renderLessonView } from "../lesson/lesson-view.js";
