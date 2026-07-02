// =============================================================================
// api/list-paths.js
// Returns existing categories / subjects / subfolders for the upload modal.
//
// GET /api/list-paths
// Headers: Authorization: Bearer <token>
// 200: { paths: { [category]: { [subject]: string[] } } }
// =============================================================================

import { createClient } from "@supabase/supabase-js";
import { requireAdmin, applyCors, handleAuthError } from "./_middleware.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
);

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).end();

  try {
    requireAdmin(req);
  } catch (err) {
    if (handleAuthError(err, res)) return;
    return res.status(401).json({ error: "غير مصرح" });
  }

  const { data, error } = await supabase
    .from("quizzes")
    .select("category, subject, subfolder, education_type")
    .order("category", { ascending: true });

  if (error) {
    console.error("[list-paths] Supabase error:", error.message);
    return res.status(500).json({ error: "فشل تحميل المسارات" });
  }

  const tracks = {};
  for (const row of data) {
    const track = row.education_type || "University";
    if (!tracks[track]) tracks[track] = {};
    if (!tracks[track][row.category]) tracks[track][row.category] = {};
    if (!tracks[track][row.category][row.subject])
      tracks[track][row.category][row.subject] = new Set();
    if (row.subfolder) tracks[track][row.category][row.subject].add(row.subfolder);
  }

  const resultTracks = {};
  for (const [track, cats] of Object.entries(tracks)) {
    resultTracks[track] = {};
    for (const [cat, subjects] of Object.entries(cats)) {
      resultTracks[track][cat] = {};
      for (const [sub, folders] of Object.entries(subjects)) {
        resultTracks[track][cat][sub] = [...folders].sort((a, b) => a.localeCompare(b, "ar"));
      }
    }
  }

  const paths = resultTracks["University"] || {};

  return res.status(200).json({ paths, tracks: resultTracks });
}
