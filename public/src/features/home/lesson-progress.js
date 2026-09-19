// ============================================================================
// COURSE LESSON PROGRESS — same-device aggregation only (Phase 4a).
// ============================================================================
// Lesson readers own the per-lesson localStorage contract. This module only
// aggregates that existing state for a course/folder catalog node; it never
// writes progress and deliberately has no points, profile, or network path.

import { getLessonProgress } from "../lesson/lesson-schema.js";
import { getCategoryTree } from "./app-state.js";

function collectLessons(category, collected = []) {
  if (!category) return collected;
  collected.push(...(Array.isArray(category.lessons) ? category.lessons : []));
  const tree = getCategoryTree();
  for (const key of category.subcategories || []) {
    collectLessons(tree?.[key], collected);
  }
  return collected;
}

/** A lesson is complete once every authored section has been visited. */
export function isLessonComplete(lesson) {
  const sectionIds = Array.isArray(lesson?.sectionIds) ? lesson.sectionIds : [];
  if (!lesson?.id || sectionIds.length === 0) return false;
  const visited = new Set(getLessonProgress(lesson.id).visitedSections);
  return sectionIds.every((id) => visited.has(id));
}

export function getCourseLessonProgress(category) {
  const lessons = collectLessons(category);
  return {
    total: lessons.length,
    completed: lessons.filter(isLessonComplete).length,
  };
}

export function createCourseLessonProgressSummary(category) {
  const { completed, total } = getCourseLessonProgress(category);
  if (total === 0) return null;
  const summary = document.createElement("p");
  summary.className = "course-lesson-progress";
  summary.setAttribute("role", "status");
  summary.textContent = `${completed} من ${total} درس مكتمل`;
  return summary;
}
