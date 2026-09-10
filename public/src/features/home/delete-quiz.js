// ============================================================================
// public/src/features/home/delete-quiz.js
// DELETE QUIZ — "حذف": SOFT-deletes a database-backed quiz (moves it to the
// shared trash, fully restorable until purged). See
// docs/plans/Admin actions and deletion flow for quizzes.md §2.
// ============================================================================
// Visibility (canDeleteQuiz): database quizzes only (never static
// relative-path quizzes, which don't exist as a deletable row anywhere), and
// only for the quiz's own creator (matched by admin email/handle against
// exam.author_email) or a platform owner. This is a thin alias of the
// generalized canManageItem() gate in admin-item-actions.js, kept here so
// existing importers keep working — the exam-card ⋮ dropdown now uses
// canManageItem() directly.
//
// IMPORTANT — this client-side check is UX only, not the real authorization
// boundary. Every privileged write goes through a server-validated /api/*
// endpoint (see adminAuth.js's signIn()/signInWithSupabase() hitting
// /api/auth) rather than a raw Supabase client call from the browser — no
// Supabase client instance is ever exposed to this module for that reason.
// Deletion follows the same pattern: /api/delete-quiz validates the JWT and
// re-checks ownership/scope server-side before writing the trash snapshot.
// This module cannot itself guarantee authorization — the backend must.
// ============================================================================

import { getToken } from "../../shared/adminAuth.js";
import { canManageItem } from "./admin-item-actions.js";
import { invalidateManifestCache } from "../../shared/quizManifest.js";
import { showNotification } from "../../components/notifications/notifications.js";

/**
 * Returns true if the currently-authenticated admin is allowed to see a
 * "حذف" option for this exam: it must be a database quiz, and the admin
 * must pass the generalized canManageItem() 3-tier gate (owner → creator
 * match → scope match). Kept as an alias so old callers don't change.
 *
 * @param {object} exam - manifest exam entry (id, dbId, author_email, ...)
 * @returns {boolean}
 */
export function canDeleteQuiz(exam) {
  return canManageItem(exam);
}

/**
 * SOFT-deletes a database-backed quiz via the server-validated /api/delete-quiz
 * endpoint (the server snapshots the full row into trash_items and removes the
 * live row — fully restorable from the trash UI until purged), then
 * invalidates the in-memory manifest cache so the next getManifest() call no
 * longer includes it.
 *
 * Callers are responsible for their own confirmation dialog before calling
 * this (see admin-item-actions.js's deleteSharedItem) and for re-rendering
 * the view on success — this function only handles the network call, cache
 * invalidation, and user-facing notifications.
 *
 * @param {object} exam - manifest exam entry (must have `id`, `dbId`)
 * @returns {Promise<boolean>} true if the quiz was moved to the trash
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
      body.error || "فشل حذف الامتحان. حاول مرة أخرى.",
      "error",
    );
    return false;
  }

  // Server confirmed the move-to-trash — the merged manifest cached in memory
  // is now stale (see quizManifest.js's own doc comment: "Call
  // invalidateManifestCache() after an admin upload" — deletion is the same
  // category of write).
  invalidateManifestCache();

  showNotification(
    "تم النقل إلى سلة المهملات",
    `تم نقل "${exam.title || exam.id}" إلى سلة المهملات`,
    "success",
  );
  return true;
}