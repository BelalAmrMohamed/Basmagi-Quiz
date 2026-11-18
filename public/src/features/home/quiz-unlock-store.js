// ============================================================================
// public/src/features/home/quiz-unlock-store.js
// Where the questions of a password-protected quiz live after the SERVER has
// verified the password (public.unlock_quiz). Before that the browser only
// ever receives { meta, stats } for such a quiz (quiz_public view).
//
// Kept in memory, with a best-effort copy in sessionStorage so the quiz page,
// the result page and the home page (same tab) don't re-prompt. Never used for
// anything else; zero imports so any module can read it.
// ============================================================================

const PREFIX = "bq_unlocked_quiz:";
const memory = new Map();

/** @returns {object|null} the full quiz payload ({meta, stats, questions}) */
export function getUnlockedQuiz(dbId) {
  if (!dbId) return null;
  if (memory.has(dbId)) return memory.get(dbId);
  try {
    const raw = sessionStorage.getItem(PREFIX + dbId);
    if (raw) {
      const data = JSON.parse(raw);
      if (data && Array.isArray(data.questions)) {
        memory.set(dbId, data);
        return data;
      }
    }
  } catch (_) { /* storage unavailable or corrupt — treated as locked */ }
  return null;
}

export function storeUnlockedQuiz(dbId, data) {
  if (!dbId || !data || !Array.isArray(data.questions)) return;
  memory.set(dbId, data);
  try { sessionStorage.setItem(PREFIX + dbId, JSON.stringify(data)); } catch (_) { /* quota — memory copy still works */ }
}

export function forgetUnlockedQuiz(dbId) {
  memory.delete(dbId);
  try { sessionStorage.removeItem(PREFIX + dbId); } catch (_) { /* ignore */ }
}
