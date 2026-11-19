// ============================================================================
// public/src/features/home/quiz-data-loader.js
// QUIZ DATA LOADER — fetches the full quiz payload (questions/meta/stats) for
// a manifest exam entry, which only ever carries a summary (see
// quizManifest.js's buildCompatStructures — no `questions` field exists on
// examEntry).
// ============================================================================
// Extracted from the exam card's onDownloadOption(), which had this exact
// fetch-by-dbId logic inline. showQuizInfoModal() (quiz-info-modal.js) and
// the download popup's copy-to-text button each had their own smaller
// re-implementation of the same "load the full quiz row" step. Centralizing
// here so copy-to-my-content (and any future consumer) doesn't grow a fourth
// copy.
// ============================================================================
//
import { ensureSharedSupabaseClient } from "../../shared/supabaseClientRegistry.js";
import { getUnlockedQuiz } from "./quiz-unlock-store.js";

/**
 * Thrown when a password-protected quiz's questions are requested without an
 * unlock the server has verified (see migration 20261118120000: the browser
 * only receives meta/stats for such a quiz until unlock_quiz() succeeds).
 */
export class QuizLockedError extends Error {
  constructor(dbId) {
    super("QUIZ_LOCKED");
    this.name = "QuizLockedError";
    this.code = "QUIZ_LOCKED";
    this.dbId = dbId || null;
  }
}

/**
 * Loads a DB-hosted quiz from the quiz_public view. For a password-protected
 * quiz the view returns only { meta, stats }; the questions come from the
 * unlock store (filled by unlock_quiz) or, when `whenLocked` is "prompt", from
 * a password dialog.
 *
 * @param {string} dbId
 * @param {{whenLocked?: "prompt"|"cached"|"stub"|"never", title?: string}} [opts]
 *   whenLocked, for a protected quiz:
 *     "prompt" (default) use the unlocked copy, else ask for the password
 *     "cached"  use the unlocked copy, else throw QuizLockedError
 *     "stub"    never read questions: resolve { meta, stats, questions: [], locked: true }
 *     "never"   always throw QuizLockedError (e.g. content bound for the AI model)
 * @returns {Promise<object>} { ...quiz data, dbId }
 */
async function loadDbQuizData(dbId, { whenLocked = "prompt", title = "" } = {}) {
  const supabase = await ensureSharedSupabaseClient();
  if (!supabase) throw new Error("تعذّر الاتصال بقاعدة البيانات");

  const { data, error } = await supabase
    .from("quiz_public")
    .select("id, data, password_protected")
    .eq("id", dbId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("الامتحان غير موجود");

  if (!data.password_protected) {
    return { ...(data.data || {}), dbId: data.id || null };
  }

  // ── Protected quiz ────────────────────────────────────────────────────────
  if (whenLocked === "stub") {
    return { ...(data.data || {}), questions: [], locked: true, dbId: data.id || null };
  }
  if (whenLocked === "never") throw new QuizLockedError(dbId);

  let unlocked = getUnlockedQuiz(dbId);
  if (!unlocked && whenLocked === "prompt") {
    const { unlockQuizWithPrompt } = await import("./download-password.js");
    unlocked = await unlockQuizWithPrompt(dbId, title || data.data?.meta?.title || "");
  }
  if (!unlocked) throw new QuizLockedError(dbId);
  return { ...unlocked, dbId: data.id || dbId };
}

/**
 * Loads the raw quiz payload behind a manifest exam entry.
 *
 * @param {object} exam - manifest exam entry (must have `dbId`)
 * @param {{whenLocked?: "prompt"|"cached"|"stub"|"never"}} [opts] see loadDbQuizData
 * @returns {Promise<{ dbId?: string|null, questions: Array, meta: object|null, stats: object|null }>}
 * @throws QuizLockedError when the quiz is protected and not unlocked; other errors if it can't be loaded
 */
export async function loadFullQuizData(exam, opts = {}) {
  const dbId = exam?.dbId;
  if (!dbId) throw new Error("Exam has no database ID");

  const data = await loadDbQuizData(dbId, { ...opts, title: exam?.title || "" });

  return {
    dbId: data.dbId || dbId,
    questions: data.questions || [],
    meta: data.meta || null,
    stats: data.stats || null,
    ...(data.locked ? { locked: true } : {}),
  };
}

/**
 * Checks whether a DB-hosted quiz currently has a password set. The password
 * column itself is not readable by browsers (see migration
 * 20261114120000_quiz_password_private.sql); this reads the boolean from the
 * quiz_public view. loadFullQuizData()/loadDbQuizData() only ever
 * select `id, data` — the password hash lives in its own column and is
 * stripped out of `data` at upload/update time (see api/admin.js's
 * handleUpdateQuiz header comment) — so callers that need to know *whether*
 * a password exists (not what it is) need this separate, narrower query
 * rather than trying to read it off the loaded quiz payload.
 *
 * @param {string} dbId
 * @returns {Promise<boolean>}
 */
export async function checkQuizHasPassword(dbId) {
  if (!dbId) return false;
  const supabase = await ensureSharedSupabaseClient();
  if (!supabase) throw new Error("تعذّر الاتصال بقاعدة البيانات");

  const { data, error } = await supabase
    .from("quiz_public")
    .select("password_protected")
    .eq("id", dbId)
    .maybeSingle();

  if (error) throw error;
  return Boolean(data?.password_protected);
}