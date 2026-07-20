import { createClient } from "@supabase/supabase-js";
import { applyCors } from "./_middleware.js";

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
  );

  const { data, error } = await supabase
    .from("admin_users")
    .select("display_name, handle, total_quizzes, current_level")
    .order("total_quizzes", { ascending: false })
    .limit(10);

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.status(200).json(data);
}
