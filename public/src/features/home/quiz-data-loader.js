// ============================================================================
// public/src/features/home/quiz-data-loader.js
// QUIZ DATA LOADER — fetches the full quiz payload (questions/meta/stats) for
// a manifest exam entry, which only ever carries a summary (see
// quizManifest.js's buildCompatStructures — no `questions` field exists on
// examEntry).
// ============================================================================
// Extracted from exam-card.js's onDownloadOption(), which had this exact
// fetch-or-import logic inline. showQuizInfoModal() (quiz-info-modal.js) and
// the download popup's copy-to-text button each had their own smaller
// re-implementation of the same "fetch exam.path" step. Centralizing here so
// copy-to-my-quizzes (and any future consumer) doesn't grow a fourth copy.
// ============================================================================
//
// DB-hosted quizzes carry a `/api/quiz-data?path=...`-shaped `path` field
// (see quizManifest.js) for backward compatibility with every other module
// that treats `exam.path` as an opaque fetchable URL — but that serverless
// function was removed to stay under Vercel Hobby's 12-function cap (see
// CHANGELOG). Paths matching that shape are now served by querying Supabase
// directly (public SELECT on `quizzes` is allowed by RLS) instead of an
// actual network request to /api/quiz-data.

import { parseCanonicalPath } from "../../shared/quizPath.js";
import { ensureSharedSupabaseClient } from "../../shared/supabaseClientRegistry.js";

const DB_QUIZ_DATA_PREFIX = "/api/quiz-data?path=";

/**
 * Loads a DB-hosted quiz's full JSON directly from Supabase, given the
 * same `/api/quiz-data?path=...`-shaped URL previously fetched over HTTP.
 * @param {string} path
 * @returns {Promise<object>} the quiz's `data` column (questions/meta/stats)
 */
async function loadDbQuizData(path) {
  const rawPath = decodeURIComponent(path.slice(DB_QUIZ_DATA_PREFIX.length));
  const normalised = rawPath
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\.\.+/g, "");

  if (!normalised.startsWith("quizzes/") || !normalised.endsWith(".json")) {
    throw new Error("مسار غير صالح");
  }

  const parsed = parseCanonicalPath(normalised);
  if (!parsed) throw new Error("مسار غير صالح");

  const lastSlash = parsed.dbPath.lastIndexOf("/");
  const dbPath = parsed.dbPath.slice(0, lastSlash);
  const filename = parsed.dbPath.slice(lastSlash + 1);

  const supabase = await ensureSharedSupabaseClient();
  if (!supabase) throw new Error("تعذّر الاتصال بقاعدة البيانات");

  const { data, error } = await supabase
    .from("quizzes")
    .select("id, data")
    .eq("path", dbPath)
    .eq("filename", filename)
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
 * Handles the .json / .js / mislabeled-.js-that's-really-.json cases the
 * static and DB manifests can both produce.
 *
 * @param {object} exam - manifest exam entry (must have `path`)
 * @returns {Promise<{ dbId?: string|null, questions: Array, meta: object|null, stats: object|null }>}
 * @throws if the quiz file can't be loaded by any strategy
 */
export async function loadFullQuizData(exam) {
  const path = exam?.path;
  if (!path) throw new Error("Exam has no path to load");

  let questions = [];
  let rawMeta = null;
  let rawStats = null;

  // DB-hosted quizzes: go straight to Supabase instead of a network fetch.
  if (path.startsWith(DB_QUIZ_DATA_PREFIX)) {
    const data = await loadDbQuizData(path);
    return {
      dbId: data.dbId || exam.dbId || null,
      questions: data.questions || [],
      meta: data.meta || null,
      stats: data.stats || null,
    };
  }

  let fetchUrl;
  if (path.startsWith("/") || path.startsWith("http")) {
    fetchUrl = new URL(path, window.location.origin).href;
  } else {
    fetchUrl = new URL(path, new URL("/data/", window.location.origin)).href;
  }

  if (path.endsWith(".json") || path.startsWith("/api/") || path.includes("?")) {
    const res = await fetch(fetchUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    questions = data.questions;
    rawMeta = data.meta || null;
    rawStats = data.stats || null;
  } else if (path.endsWith(".js")) {
    // Try importing as a real JS module first. Some manifest entries point
    // at a ".js" path that's actually a mislabeled/renamed JSON file — if
    // the dynamic import fails, fall back to fetching the same path with a
    // ".json" extension instead.
    try {
      const mod = await import(/* @vite-ignore */ fetchUrl);
      questions = mod.questions;
      rawMeta = mod.meta || null;
      rawStats = mod.stats || null;
    } catch (jsErr) {
      console.warn("Failed to load as JS, trying JSON substitute...", jsErr);
      const jsonUrl = fetchUrl.replace(/\.js$/, ".json");
      const res = await fetch(jsonUrl);
      if (!res.ok) throw new Error("Failed to load as JSON as well");
      const data = await res.json();
      questions = data.questions;
      rawMeta = data.meta || null;
      rawStats = data.stats || null;
    }
  } else {
    // Fallback: try fetching as JSON first
    try {
      const res = await fetch(fetchUrl);
      if (res.ok) {
        const data = await res.json();
        questions = data.questions;
        rawMeta = data.meta || null;
        rawStats = data.stats || null;
      }
    } catch (_) {
      const mod = await import(/* @vite-ignore */ fetchUrl);
      questions = mod.questions;
      rawMeta = mod.meta || null;
      rawStats = mod.stats || null;
    }
  }

  return { questions: questions || [], meta: rawMeta, stats: rawStats };
}