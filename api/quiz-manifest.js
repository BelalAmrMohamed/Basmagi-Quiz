// =============================================================================
// api/quiz-manifest.js
// Public endpoint — returns all DB-hosted quizzes shaped like quiz-manifest.json
// =============================================================================

import { createClient } from "@supabase/supabase-js";
import { applyCors } from "./_middleware.js";
import { generateQuizId } from "../scripts/lib/quizId.js";
import {
  parseDbPath,
  buildCourseKey,
  buildSubjectManifestEntry,
} from "../scripts/lib/quizPath.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
);

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).end();

  const { data, error } = await supabase
    .from("quizzes")
    .select(
      "path, filename, title, category, subject, subfolder, data, education_type, password",
    )
    .order("category", { ascending: true });

  if (error) {
    console.error("[quiz-manifest] Supabase error:", error.message);
    return res.status(500).json({ error: "فشل تحميل الاختبارات" });
  }

  const subjectsMap = new Map();

  for (const row of data) {
    let rawPath = row.path;
    let parsed = parseDbPath(rawPath, row.filename);
    
    if (!parsed) {
      if (row.education_type === 'University') {
        console.warn(`[quiz-manifest] Unrecognized path: ${row.path}, attempting legacy University fallback`);
        rawPath = `University/${row.path}`;
        parsed = parseDbPath(rawPath, row.filename);
      }
      
      if (!parsed) {
        console.warn(`[quiz-manifest] Unrecognized path: ${row.path}`);
        continue;
      }
    }

    const education_type = row.education_type || parsed.education_type;
    parsed.education_type = education_type;

    const courseKey = buildCourseKey(parsed);

    if (!subjectsMap.has(courseKey)) {
      subjectsMap.set(
        courseKey,
        buildSubjectManifestEntry(parsed, []),
      );
    }

    const subjectEntry = subjectsMap.get(courseKey);
    const examRelPath = `quizzes/${row.path}/${row.filename}`;
    const examFetchPath = `/api/quiz-data?path=${encodeURIComponent(examRelPath)}`;

    const quizMeta = row.data?.meta || {};
    const quizStats = row.data?.stats || {};

    const quizEntry = {
      id: quizMeta.id || generateQuizId(examRelPath),
      title: quizMeta.title || row.title,
      path: examFetchPath,
      questionCount: quizStats.questionCount ?? 0,
      questionTypes: quizStats.questionTypes ?? [],
      education_type,
      dbSource: "db",
    };

    if (quizMeta.description) quizEntry.description = quizMeta.description;
    if (quizMeta.author) quizEntry.author = quizMeta.author;
    if (quizMeta.author_email) quizEntry.author_email = quizMeta.author_email;
    if (quizMeta.author_handle) quizEntry.author_handle = quizMeta.author_handle;
    if (row.password) quizEntry.password = row.password;

    //  This might be wrong, it might be `dbSource`, but I don't know, insure it's correct.
    if (quizMeta.source) quizEntry.source = quizMeta.source;
    if (quizMeta.createdAt) quizEntry.createdAt = quizMeta.createdAt;

    subjectEntry.quizzes.push(quizEntry);
  }

  const subjects = Array.from(subjectsMap.values());

  res.setHeader(
    "Cache-Control",
    "public, s-maxage=60, stale-while-revalidate=300",
  );

  return res.status(200).json({ subjects });
}