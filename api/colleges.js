import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
);

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const educationType = String(req.query?.education_type || "University");
  if (!/^(University|Primary|Middle|High)$/.test(educationType)) {
    return res.status(400).json({ error: "Invalid education type" });
  }

  const { data, error } = await supabase
    .from("colleges")
    .select("id, education_type, name, year_count, terms")
    .eq("education_type", educationType)
    .eq("is_active", true)
    .order("name", { ascending: true });

  if (error) {
    console.error("[colleges] list failed:", error.message);
    return res.status(500).json({ error: "Failed to fetch colleges" });
  }

  return res.status(200).json({ colleges: data || [] });
}