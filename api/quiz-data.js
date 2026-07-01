// =============================================================================
// api/quiz-data.js
// Public endpoint — serves the full quiz JSON for a single DB-hosted quiz.
// =============================================================================

import { createClient } from "@supabase/supabase-js";
import { applyCors } from "./_middleware.js";
import { parseCanonicalPath } from "../scripts/lib/quizPath.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
);

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).end();

  const rawPath = req.query?.path || "";

  if (!rawPath) {
    return res.status(400).json({ error: "معامل المسار مفقود" });
  }

  const normalised = rawPath
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\.\.+/g, "");

  if (!normalised.startsWith("quizzes/") || !normalised.endsWith(".json")) {
    return res.status(400).json({ error: "مسار غير صالح" });
  }

  const parsed = parseCanonicalPath(normalised);
  if (!parsed) {
    return res.status(400).json({ error: "مسار غير صالح" });
  }

  const lastSlash = parsed.dbPath.lastIndexOf("/");
  const dbPath = parsed.dbPath.slice(0, lastSlash);
  const filename = parsed.dbPath.slice(lastSlash + 1);

  const { data, error } = await supabase
    .from("quizzes")
    .select("data")
    .eq("path", dbPath)
    .eq("filename", filename)
    .maybeSingle();

  if (error) {
    console.error("[quiz-data] Supabase error:", error.message);
    return res.status(500).json({ error: "فشل تحميل الاختبار" });
  }

  if (!data) {
    return res.status(404).json({ error: "الاختبار غير موجود" });
  }

  res.setHeader(
    "Cache-Control",
    "public, s-maxage=300, stale-while-revalidate=600",
  );
  return res.status(200).json(data.data);
}
