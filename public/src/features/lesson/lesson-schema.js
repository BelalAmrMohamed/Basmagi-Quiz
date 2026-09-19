// ============================================================================
// public/src/features/lesson/lesson-schema.js
// LESSON SCHEMA HELPERS — field accessors over the `lessons.content` jsonb
// shape, and the local (localStorage-only) reading-progress state.
// ============================================================================
// Mirrors public/src/features/home/quiz-schema.js's shape: a field-accessor
// function (`ls`, sibling to that file's `qz`), a normalizer for the stored
// content, a progress-entry builder, and the same-level collision check
// reused from user-quizzes-folders.js.
//
// ⚠️ Lessons are NEVER scored. Nothing in this file may write to Supabase
// or touch passed_quizzes_count / current_level / the points system — the
// progress state below is local-only, by explicit product decision (see
// docs/plans/lessons-feature-plan.md's ground rules).
// ============================================================================

import { getFromStorage, setInStorage } from "../../shared/storage-helpers.js";
import { hasSameLevelCollision } from "../home/user-quizzes-folders.js";

/**
 * Read a field off a lesson row. Sibling to quiz-schema.js's qz(), kept as
 * a function rather than direct property access so the Phase 1 "content is
 * a plain markdown string" rows and the Phase 2 sections/blocks rows can be
 * read through one accessor as the data migrates forward.
 *
 * @param {object} lesson - a `lessons` table row
 * @param {string} field
 */
export function ls(lesson, field) {
  switch (field) {
    case "id":
      return lesson?.id || "";
    case "slug":
      return lesson?.slug || "";
    case "title":
      return lesson?.title || "";
    case "courseId":
      return lesson?.course_id || null;
    case "folderId":
      return lesson?.folder_id || null;
    case "createdAt":
      return lesson?.created_at || "";
    case "updatedAt":
      return lesson?.updated_at || "";
    case "sections":
      return normalizeLessonContent(lesson?.content).sections;
    case "readerPrefsDefault":
      return lesson?.reader_prefs_default || null;
    default:
      return undefined;
  }
}

/**
 * Normalizes whatever is in `lessons.content` into the canonical Phase 2
 * shape: `{ sections: [{ id, title, defaultHidden, blocks: [...] }] }`.
 *
 * Accepts three inputs so Phase 1 rows keep rendering unchanged:
 *   - a plain markdown string      -> one untitled section, one markdown block
 *   - `{ body: "..." }`            -> same
 *   - `{ sections: [...] }`        -> the real shape, validated/defaulted
 *
 * Every section is guaranteed an `id` (synthesized positionally when the
 * author didn't set one) because the adaptive-reveal rules and the progress
 * state both key off section ids — a missing id would silently break both.
 *
 * @param {unknown} content
 * @returns {{sections: Array<{id:string,title:string,defaultHidden:boolean,blocks:Array}>}}
 */
export function normalizeLessonContent(content) {
  if (typeof content === "string") {
    return { sections: [makeSection("s1", "", false, [{ type: "markdown", body: content }])] };
  }
  if (!content || typeof content !== "object") return { sections: [] };

  if (Array.isArray(content.sections)) {
    return {
      sections: content.sections.map((section, i) =>
        makeSection(
          section?.id || `s${i + 1}`,
          section?.title || "",
          Boolean(section?.defaultHidden),
          Array.isArray(section?.blocks) ? section.blocks.filter(Boolean) : [],
        ),
      ),
    };
  }

  if (typeof content.body === "string") {
    return { sections: [makeSection("s1", "", false, [{ type: "markdown", body: content.body }])] };
  }
  return { sections: [] };
}

function makeSection(id, title, defaultHidden, blocks) {
  return { id: String(id), title: String(title || ""), defaultHidden: Boolean(defaultHidden), blocks };
}

/**
 * Collects every question block across all sections, in document order.
 * Used by the adaptive-reveal resolver below and by the viewer when it
 * needs to restore previously-answered questions on load.
 *
 * @param {{sections: Array}} normalizedContent
 * @returns {Array<object>} question blocks (each carries its own `id`)
 */
export function collectQuestionBlocks(normalizedContent) {
  const questions = [];
  for (const section of normalizedContent.sections || []) {
    for (const block of section.blocks || []) {
      if (block?.type === "question" && block.id) questions.push(block);
    }
  }
  return questions;
}

// ============================================================================
// LOCAL PROGRESS STATE
// ============================================================================
// One localStorage key per lesson. Key style mirrors the existing
// "user_quizzes" convention (lowercase, underscore-separated, app-scoped
// prefix) with the lesson id appended: `lesson_progress_<lessonId>`.
//
// ⚠️ SHAPE STABILITY: Phase 4's cross-lesson aggregation reads this exact
// shape as-is, with no lesson-side changes — so this is a storage contract,
// not an internal detail. Adding a field later is fine; renaming or
// re-nesting `visitedSections` / `questions[id].{answered,wasCorrect}`
// becomes a data migration, not just a viewer bug.
//
//   {
//     "visitedSections": ["s1", "s2"],
//     "questions": { "q1": { "answered": true, "wasCorrect": false } }
//   }
// ============================================================================

const LESSON_PROGRESS_KEY_PREFIX = "lesson_progress_";

export function lessonProgressKey(lessonId) {
  return `${LESSON_PROGRESS_KEY_PREFIX}${lessonId}`;
}

/** The empty/default progress entry — also the shape written on first save. */
export function buildLocalLessonProgressEntry() {
  return { visitedSections: [], questions: {} };
}

/**
 * Reads a lesson's local progress, always returning a well-formed entry
 * (never null) so callers never have to null-check before reading
 * `.visitedSections` / `.questions`. Corrupt/partial JSON degrades to a
 * fresh entry rather than throwing.
 *
 * @param {string} lessonId
 */
export function getLessonProgress(lessonId) {
  if (!lessonId) return buildLocalLessonProgressEntry();
  try {
    const raw = getFromStorage(lessonProgressKey(lessonId), null);
    if (!raw) return buildLocalLessonProgressEntry();
    const parsed = JSON.parse(raw);
    return {
      visitedSections: Array.isArray(parsed?.visitedSections) ? parsed.visitedSections : [],
      questions: parsed?.questions && typeof parsed.questions === "object" ? parsed.questions : {},
    };
  } catch (err) {
    console.error("[lesson-schema] Could not read lesson progress:", err);
    return buildLocalLessonProgressEntry();
  }
}

function saveLessonProgress(lessonId, entry) {
  if (!lessonId) return;
  try {
    setInStorage(lessonProgressKey(lessonId), JSON.stringify(entry));
  } catch (err) {
    console.error("[lesson-schema] Could not save lesson progress:", err);
  }
}

/** Marks a section as visited (idempotent). Drives the ToC checkmarks. */
export function markSectionVisited(lessonId, sectionId) {
  if (!lessonId || !sectionId) return;
  const entry = getLessonProgress(lessonId);
  if (!entry.visitedSections.includes(sectionId)) {
    entry.visitedSections.push(sectionId);
    saveLessonProgress(lessonId, entry);
  }
}

/**
 * Records an embedded question's answer. Local-only, never a network call
 * — an embedded question is reveal-on-answer, not a graded submission.
 *
 * @param {string} lessonId
 * @param {string} questionId
 * @param {boolean} wasCorrect
 */
export function recordQuestionAnswer(lessonId, questionId, wasCorrect) {
  if (!lessonId || !questionId) return;
  const entry = getLessonProgress(lessonId);
  entry.questions[questionId] = { answered: true, wasCorrect: Boolean(wasCorrect) };
  saveLessonProgress(lessonId, entry);
}

/**
 * Resolves which `defaultHidden` sections should currently be revealed,
 * by replaying every question's recorded answer against its one-rule
 * `onWrong` / `onCorrect` reveal target.
 *
 * v1 is deliberately single-step: a rule may only name one `revealSection`,
 * and a revealed section's own questions do NOT chain into further reveals
 * (no multi-step branching — see the plan's Phase 2 step 1). Because this
 * recomputes from stored answers on every call rather than mutating state
 * when an answer happens, a reload restores exactly the same visibility.
 *
 * @param {{sections: Array}} normalizedContent
 * @param {{questions: object}} progress
 * @returns {Set<string>} section ids that should be visible despite defaultHidden
 */
export function resolveRevealedSections(normalizedContent, progress) {
  const revealed = new Set();
  for (const question of collectQuestionBlocks(normalizedContent)) {
    const answer = progress?.questions?.[question.id];
    if (!answer?.answered) continue;
    const rule = answer.wasCorrect ? question.onCorrect : question.onWrong;
    const target = rule?.revealSection;
    if (target) revealed.add(String(target));
  }
  return revealed;
}

/**
 * Same-level naming rule for lessons on the local "امتحاناتك" side,
 * mirroring quiz-schema.js's saveNewUserQuiz() guard. The server-side
 * equivalent is hasLessonNameCollision() in api/_itemActions.js.
 *
 * @param {Array} userItems - the live user_quizzes array
 * @param {{title: string, parentId: string|null, excludeId?: string}} candidate
 * @returns {boolean}
 */
export function hasLessonLevelCollision(userItems, { title, parentId, excludeId = null }) {
  return hasSameLevelCollision(userItems, {
    type: "lesson",
    title,
    parentId: parentId || null,
    excludeId,
  });
}
