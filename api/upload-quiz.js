// =============================================================================
// api/upload-quiz.js
// Authenticated endpoint — validates JWT then writes quiz to Supabase.
//
// POST /api/upload-quiz
// Headers: Authorization: Bearer <token>
// Body:    { college, year, term, subject, subfolder?, author?, author_email?,
//            education_type?, quiz: {...} }
//
// Path stored as: University/College/Year/Term/Subject[/Subfolder]
// =============================================================================

import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin, applyCors, handleAuthError } from "./_middleware.js";
import {
  validateQuizPayload,
  validatePath,
  computeStats,
} from "./_validateQuiz.js";
import { generateQuizId } from "../scripts/lib/quizId.js";
import { 
  isValidEducationType, 
  validateTrackPath, 
  buildDbPath, 
  buildDbColumns, 
  parseDbPath 
} from "../scripts/lib/quizPath.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
);

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).end();

  let adminPayload;
  try {
    adminPayload = requireAdmin(req);
  } catch (err) {
    if (handleAuthError(err, res)) return;
    return res.status(401).json({ error: "غير مصرح" });
  }

  const {
    college,
    year,
    term,
    subject,
    subfolder,
    education_type: rawEducationType,
    quiz,
  } = req.body || {};

  const education_type =
    rawEducationType && isValidEducationType(rawEducationType)
      ? rawEducationType
      : "University";

  if (!adminPayload.isOwner && adminPayload.allowed_scopes) {
    if (!adminPayload.allowed_scopes.includes(education_type)) {
      return res.status(403).json({ error: "ليس لديك صلاحية لإضافة امتحانات في هذا المسار." });
    }
  }

  try {
    validatePath({ college, year, term, subject, subfolder });
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  try {
    validateTrackPath(education_type, { college, year, term, subject, subfolder });
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  if (quiz && quiz.meta) {
    quiz.meta.id = "AAAAAAAA";
  }

  let cleanQuiz;
  try {
    cleanQuiz = validateQuizPayload(quiz);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  const fullPath = buildDbPath({ education_type, college, year, term, subject, subfolder });
  const parsedPath = parseDbPath(fullPath);
  const dbCols = buildDbColumns(parsedPath);

  const safeTitle = cleanQuiz.meta.title
    .replace(/[^\u0600-\u06FF\w\s\-]/gu, "")
    .trim()
    .replace(/\s+/g, "_");
  const filename = `${safeTitle || "quiz"}.json`;

  cleanQuiz.meta.path = `quizzes/${fullPath}/${filename}`;
  cleanQuiz.meta.id = generateQuizId(cleanQuiz.meta.path);
  cleanQuiz.stats = computeStats(cleanQuiz.questions);

  // Fetch admin profile to enforce server-side identity
  let adminId = null;
  let adminHandle = null;
  let adminDisplayName = "مشرف";

  if (adminPayload?.email) {
    const { data: adminData, error: adminErr } = await supabase
      .from("admin_users")
      .select("id, handle, display_name")
      .eq("email", adminPayload.email)
      .maybeSingle();

    if (adminData && !adminErr) {
      adminId = adminData.id;
      adminHandle = adminData.handle || null;
      adminDisplayName = adminData.display_name || "مشرف";
    }
  }

  // Identity enforcement:
  // - `author_id` (adminId) is ALWAYS server-derived and never trusted from the client.
  //   This is the stable identifier used to fetch up-to-date admin profile data
  //   (display name, handle, avatar) during rendering.
  cleanQuiz.meta.author_id = adminId;

  // `view` / `mode` come from validated quiz.meta — already in cleanQuiz

  let passwordHash = null;
  if (cleanQuiz.meta.password) {
    passwordHash = crypto
      .createHash("sha256")
      .update(cleanQuiz.meta.password)
      .digest("hex");
    delete cleanQuiz.meta.password;
  }

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

  const { data, error } = await supabase
    .from("quizzes")
    .insert({
      path: fullPath,
      category: dbCols.category,
      subject: dbCols.subject,
      subfolder: dbCols.subfolder,
      title: cleanQuiz.meta.title,
      filename,
      data: cleanQuiz,
      education_type,
      password: passwordHash,
      college: dbCols.college || null,
      year: dbCols.year || null,
      term: dbCols.term || null,
      uploaded_by: adminId,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[upload-quiz] Supabase error:", error.message);
    return res.status(500).json({ error: "فشل رفع الاختبار. حاول مجددًا." });
  }

  if (adminId) {
    // Use an atomic DB-side increment via an RPC for safety under concurrency.
    try {
      await supabase.rpc("increment_uploaded_quizzes", { p_admin_id: adminId });
    } catch (rpcErr) {
      console.error("Failed to call increment_uploaded_quizzes RPC:", rpcErr.message || rpcErr);
    }
  }

  return res.status(201).json({
    success: true,
    id: data.id,
    quizId: cleanQuiz.meta.id,
    path: fullPath,
  });
}
