// ============================================================================
// public/src/features/home/delete-quiz.js
// DELETE QUIZ — "حذف": permanently removes a database-backed quiz.
// ============================================================================
// Visibility (canDeleteQuiz): database quizzes only (never static
// relative-path quizzes, which don't exist as a deletable row anywhere), and
// only for the quiz's own creator (matched by admin email against
// exam.author_email) or a platform owner (getAdminRoleInfo().isOwner).
//
// IMPORTANT — this client-side check is UX only, not the real authorization
// boundary. Every other privileged write in this codebase goes through a
// server-validated /api/* endpoint (see adminAuth.js's signIn()/signInWithSupabase()
// hitting /api/auth, and quizManifest.js's DB reads hitting /api/quiz-manifest)
// rather than a raw Supabase client call from the browser — no Supabase
// client instance is ever exposed to this module for that reason. Deletion
// follows the same pattern: it calls /api/delete-quiz with the admin JWT,
// and that endpoint must re-validate role/ownership server-side (via
// Supabase RLS and/or an explicit creator/owner check) before deleting the
// row. This module cannot itself guarantee authorization — the backend must.
// ============================================================================

import {
  isAdminAuthenticated,
  getAdminRoleInfo,
  getToken,
} from "../../shared/adminAuth.js";
import { invalidateManifestCache } from "../../shared/quizManifest.js";
import { showNotification } from "../../components/notifications/notifications.js";

/**
 * Returns true if the currently-authenticated admin is allowed to see a
 * "حذف" option for this exam: it must be a database quiz, and the admin
 * must either be the quiz's own creator or a platform owner.
 *
 * @param {object} exam - manifest exam entry (id, dbSource, author_email, ...)
 * @returns {boolean}
 */
export function canDeleteQuiz(exam) {
  if (!exam || exam.dbSource !== "db") return false;
  if (!isAdminAuthenticated()) return false;

  const roleInfo = getAdminRoleInfo();
  // Condition 1: Admin is owner
  if (roleInfo.isOwner) return true;

  // Condition 2: Admin is the original creator
  if (exam.author_handle && roleInfo.handle && exam.author_handle === roleInfo.handle) {
    return true;
  }

  // Condition 3: Admin has the scope for this education type
  if (exam.education_type && roleInfo.allowed_scopes && roleInfo.allowed_scopes.includes(exam.education_type)) {
    return true;
  }

  return false;
}

/**
 * Deletes a database-backed quiz via the server-validated /api/delete-quiz
 * endpoint, then invalidates the in-memory manifest cache so the next
 * getManifest() call (e.g. a full page reload) no longer includes it.
 *
 * Callers are responsible for their own confirmation dialog before calling
 * this (see exam-card.js's showExamActionsOverlay) and for removing the
 * quiz's card from the DOM on success — this function only handles the
 * network call, cache invalidation, and user-facing notifications.
 *
 * @param {object} exam - manifest exam entry (must have `id`, dbSource: "db")
 * @returns {Promise<boolean>} true if the quiz was deleted
 */
export async function deleteQuizFromDatabase(exam) {
  const token = getToken();
  if (!token) {
    showNotification("خطأ", "يجب تسجيل الدخول كمشرف أولاً", "error");
    return false;
  }

  let res;
  try {
    res = await fetch("/api/delete-quiz", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ id: exam.id }),
    });
  } catch (networkErr) {
    console.error("Network error deleting quiz:", networkErr);
    showNotification(
      "خطأ",
      "تعذّر الاتصال بالخادم. تحقق من اتصالك بالإنترنت.",
      "error",
    );
    return false;
  }

  if (!res.ok) {
    let body = {};
    try {
      body = await res.json();
    } catch (_) {}
    console.error("Delete failed:", res.status, body);
    showNotification(
      "خطأ",
      body.error || "فشل حذف الإمتحان. حاول مرة أخرى.",
      "error",
    );
    return false;
  }

  // Server confirmed deletion — the merged manifest cached in memory is now
  // stale (see quizManifest.js's own doc comment: "Call invalidateManifestCache()
  // after an admin upload" — deletion is the same category of write).
  invalidateManifestCache();

  showNotification(
    "تم الحذف",
    `تم حذف "${exam.title || exam.id}" بنجاح`,
    "success",
  );
  return true;
}