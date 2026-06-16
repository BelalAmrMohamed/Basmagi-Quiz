// =============================================================================
// api/upload-quiz.js
// Authenticated endpoint — validates JWT then writes quiz to Supabase.
//
// POST /api/upload-quiz
// Headers: Authorization: Bearer <token>
// Body:    { college, year, term, subject, subfolder?, author?, quiz: {...} }
//
// Path stored as: College/Year/Term/Subject[/Subfolder]
// This matches the codebase structure under public/data/quizzes/
//
// 201: { success: true, id, path }
// =============================================================================

import { createClient } from "@supabase/supabase-js";
import { requireAdmin, applyCors, handleAuthError } from "./_middleware.js";
import {
  validateQuizPayload,
  validatePath,
  computeStats,
} from "./_validateQuiz.js";
import { generateQuizId } from "../scripts/lib/quizId.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
);

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).end();

  // ── 1. Authenticate ────────────────────────────────────────────────────────
  try {
    requireAdmin(req);
  } catch (err) {
    if (handleAuthError(err, res)) return;
    return res.status(401).json({ error: "غير مصرح" });
  }

  // ── 2. Extract & validate fields ──────────
  const { college, year, term, subject, subfolder, author, quiz } =
    req.body || {};

  // Validate each path segment
  try {
    validatePath(college, subject, subfolder);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  // Year must be "1" or "2"
  if (!["1", "2"].includes(String(year))) {
    return res.status(400).json({ error: "INVALID_PATH: year must be 1 or 2" });
  }
  // Term must be "1" or "2"
  if (!["1", "2"].includes(String(term))) {
    return res.status(400).json({ error: "INVALID_PATH: term must be 1 or 2" });
  }

  // Inject a dummy valid Base32 ID to pass strict validation.
  // We deterministically override this ID downstream anyway.
  if (quiz && quiz.meta) {
    quiz.meta.id = "AAAAAAAA";
  }

  let cleanQuiz;
  try {
    cleanQuiz = validateQuizPayload(quiz);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  // ── 3. Build path matching codebase structure ──────────────────────────────
  const pathParts = [
    college.trim(),
    String(year),
    String(term),
    subject.trim(),
  ];
  if (subfolder?.trim()) pathParts.push(subfolder.trim());
  const fullPath = pathParts.join("/");

  const safeTitle = cleanQuiz.meta.title
    .replace(/[^\u0600-\u06FF\w\s\-]/gu, "")
    .trim()
    .replace(/\s+/g, "_");
  const filename = `${safeTitle || "quiz"}.json`;

  // ── 4. Server-side enrichment ──────────────────────────────────────────────
  // Set meta.path (canonical path for ID stability and quiz-data endpoint)
  cleanQuiz.meta.path = `quizzes/${fullPath}/${filename}`;

  // Deterministically generate ID from path (discarding any client-supplied ID)
  cleanQuiz.meta.id = generateQuizId(cleanQuiz.meta.path);

  // Recompute stats server-side — never trust client-submitted stats
  cleanQuiz.stats = computeStats(cleanQuiz.questions);

  // Set author from request body (not from JWT)
  if (author && typeof author === "string" && author.trim()) {
    cleanQuiz.meta.author = author.trim();
  } else {
    delete cleanQuiz.meta.author; // don't store undefined/empty
  }

  // Hash password if present
  if (cleanQuiz.meta.password) {
    const crypto = await import("crypto");
    cleanQuiz.meta.password = crypto
      .createHash("sha256")
      .update(cleanQuiz.meta.password)
      .digest("hex");
  }

  // ── 5. Duplicate check ─────────────────────────────────────────────────────
  const { data: existing } = await supabase
    .from("quizzes")
    .select("id")
    .eq("path", fullPath)
    .eq("filename", filename)
    .maybeSingle();

  if (existing) {
    return res.status(409).json({
      error: `يوجد اختبار بنفس الاسم في هذا المسار:\n${fullPath}/${filename}`,
    });
  }

  // ── 6. Insert ──────────────────────────────────────────────────────────────
  const { data, error } = await supabase
    .from("quizzes")
    .insert({
      path: fullPath,
      category: college.trim(), // "category" column = college name
      subject: subject.trim(),
      subfolder: subfolder?.trim() || null,
      title: cleanQuiz.meta.title,
      filename,
      data: cleanQuiz,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[upload-quiz] Supabase error:", error.message);
    return res.status(500).json({ error: "فشل رفع الاختبار. حاول مجددًا." });
  }

  return res.status(201).json({ success: true, id: data.id, path: fullPath });
}
