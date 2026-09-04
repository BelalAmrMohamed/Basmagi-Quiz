// ============================================================================
// public/src/features/home/quiz-data-loader.js
// QUIZ DATA LOADER — fetches the full quiz payload (questions/meta/stats) for
// a manifest exam entry, which only ever carries a summary (see
// quizManifest.js's buildCompatStructures — no `questions` field exists on
// examEntry).
// ============================================================================
// Extracted from exam-card.js's onDownloadOption(), which had this exact
// fetch-by-dbId logic inline. showQuizInfoModal() (quiz-info-modal.js) and
// the download popup's copy-to-text button each had their own smaller
// re-implementation of the same "load the full quiz row" step. Centralizing
// here so copy-to-my-quizzes (and any future consumer) doesn't grow a fourth
// copy.
// ============================================================================
//
import { ensureSharedSupabaseClient } from "../../shared/supabaseClientRegistry.js";

/**
 * Loads a DB-hosted quiz's full JSON directly from Supabase.
 * @param {string} dbId
 * @returns {Promise<object>} the quiz's `data` column (questions/meta/stats)
 */
async function loadDbQuizData(dbId) {
  const supabase = await ensureSharedSupabaseClient();
  if (!supabase) throw new Error("تعذّر الاتصال بقاعدة البيانات");

  const { data, error } = await supabase
    .from("quizzes")
    .select("id, data")
    .eq("id", dbId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("الاختبار غير موجود");

  return {
    ...(data.data || {}),
    dbId: data.id || null,
  };
}

/**
 * Loads the raw quiz payload behind a manifest exam entry.
 * Loads the raw quiz payload behind a relational manifest entry.
 *
 * @param {object} exam - manifest exam entry (must have `dbId`)
 * @returns {Promise<{ dbId?: string|null, questions: Array, meta: object|null, stats: object|null }>}
 * @throws if the quiz file can't be loaded by any strategy
 */
export async function loadFullQuizData(exam) {
  const dbId = exam?.dbId;
  if (!dbId) throw new Error("Exam has no database ID");

  const data = await loadDbQuizData(dbId);

  return {
    dbId: data.dbId || dbId,
    questions: data.questions || [],
    meta: data.meta || null,
    stats: data.stats || null,
  };
}