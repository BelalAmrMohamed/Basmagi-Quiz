// ============================================================================
// public/src/features/lesson/lesson-progress-sync.js
// CROSS-DEVICE LESSON PROGRESS SYNC (Phase 4a, optional cross-device branch).
// ============================================================================
// localStorage (lesson-schema.js) stays the source of truth for what the
// *current* device renders — nothing here changes that. This module is a
// best-effort push/pull layer on top of it:
//   - push: whenever markSectionVisited() completes a lesson on this device,
//     tell the lesson-progress Edge Function so other devices can learn
//     about it too.
//   - pull: on lesson load, ask the Edge Function whether this profile has
//     already completed the lesson elsewhere, and if so, backfill this
//     device's local visitedSections so the ToC/progress UI agrees
//     immediately instead of waiting for a full re-visit.
//
// Uses the SAME device-identity JWT as the quiz progress system
// (public/src/shared/userLevel.js::getUserToken) — one identity, reused,
// not a second one invented for lessons.
//
// ⚠️ Never touches passed_quizzes_count / current_level / points. This talks
// to a separate Supabase Edge Function (supabase/functions/lesson-progress),
// not api/user-profile.js, and the server side enforces that separation —
// see that function's own header comment.
//
// Best-effort by design: every call here swallows its own errors. A failed
// sync (offline, cold-started function, etc.) must never block the reading
// experience or throw into the caller — local progress already worked
// before this module existed, and continues to work if this silently fails.
// ============================================================================

import { getUserToken } from "../../shared/userLevel.js";
import { SUPABASE_URL } from "../../shared/public-config.js";
import { getLessonProgress, markSectionVisited } from "./lesson-schema.js";

const FUNCTION_BASE = `${SUPABASE_URL}/functions/v1/lesson-progress`;

/**
 * Call after any progress-mutating action on a lesson (section visited,
 * question answered). Cheap no-op unless every authored section has now
 * been visited — the server independently re-checks this rule, so a bug
 * here can only fail to sync a real completion, never fabricate a fake one.
 *
 * @param {string} lessonId
 * @param {string[]} allSectionIds - every section id authored on this lesson
 *   (e.g. normalizeLessonContent(lesson.content).sections.map(s => s.id))
 */
export async function syncLessonCompletionIfDone(lessonId, allSectionIds) {
    if (!lessonId || !Array.isArray(allSectionIds) || allSectionIds.length === 0) return;

    const progress = getLessonProgress(lessonId);
    const visited = new Set(progress.visitedSections);
    const isComplete = allSectionIds.every((id) => visited.has(id));
    if (!isComplete) return;

    try {
        const token = await getUserToken();
        if (!token) return; // offline / identify failed — stay local-only silently

        await fetch(`${FUNCTION_BASE}?action=complete`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
                lessonId,
                visitedSectionIds: [...visited],
                allSectionIds,
            }),
        });
        // Response intentionally unread: this device already has the complete
        // local state that drove this call, so there's nothing new to apply.
    } catch (err) {
        console.warn("[lesson-progress-sync] completion push failed (non-fatal):", err);
    }
}

/**
 * Call once when a lesson finishes loading. If the server already knows
 * this profile completed the lesson (on another device) but this device's
 * local state doesn't yet reflect that, backfill visitedSections so the
 * viewer/ToC/course-progress summary agree immediately.
 *
 * Only ever ADDS to local state — never removes a locally-recorded visit,
 * and never marks a lesson incomplete based on server silence (e.g. first
 * visit ever, or the fetch failing offline).
 *
 * @param {string} lessonId
 * @param {string[]} allSectionIds
 */
export async function pullLessonCompletionIfNewer(lessonId, allSectionIds) {
    if (!lessonId || !Array.isArray(allSectionIds) || allSectionIds.length === 0) return;

    const progress = getLessonProgress(lessonId);
    const visited = new Set(progress.visitedSections);
    const alreadyCompleteLocally = allSectionIds.every((id) => visited.has(id));
    if (alreadyCompleteLocally) return; // nothing to backfill

    try {
        const token = await getUserToken();
        if (!token) return;

        const res = await fetch(`${FUNCTION_BASE}?action=list`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;

        const data = await res.json();
        const completedIds = new Set(Array.isArray(data?.completedLessonIds) ? data.completedLessonIds : []);
        if (!completedIds.has(lessonId)) return;

        // Server says this lesson is done on some device — backfill every
        // authored section as visited locally too, one write per section
        // through the existing single-writer path (keeps this module from
        // needing its own localStorage write logic / shape knowledge).
        for (const sectionId of allSectionIds) {
            markSectionVisited(lessonId, sectionId);
        }
    } catch (err) {
        console.warn("[lesson-progress-sync] completion pull failed (non-fatal):", err);
    }
}