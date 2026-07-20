import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
);

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const handle = req.query.handle;
  const isLeaderboard = req.query.leaderboard === "true";

  if (isLeaderboard) {
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

  let adminUser = null;

  if (handle) {
    // Find admin id and stats
    const { data, error } = await supabase
      .from("admin_users")
      .select("id, display_name, total_points, total_quizzes, total_badges, current_level, handle, email")
      .eq("handle", handle)
      .maybeSingle();
    adminUser = data;
  } else {
    // If no handle provided, try to resolve via JWT Authorization header
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.split(" ")[1];
      try {
        const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64").toString("utf8"));
        if (payload.email) {
          const { data, error } = await supabase
            .from("admin_users")
            .select("id, display_name, total_points, total_quizzes, total_badges, current_level, handle, email")
            .eq("email", payload.email)
            .maybeSingle();
          adminUser = data;
        }
      } catch (err) {
        console.error("Error decoding token for admin stats", err);
      }
    }
  }

  if (!adminUser) {
    return res.status(404).json({ error: "Admin not found or missing handle parameter" });
  }

  // Count quizzes uploaded
  const { count: quizzesCount, error: quizzesErr } = await supabase
    .from("quizzes")
    .select("id", { count: "exact", head: true })
    .eq("uploaded_by", adminUser.id);

  // For reports, we count them based on the quizzes uploaded by this admin
  // Since we don't have a complex view, we can just fetch quiz IDs first, then count reports
  const { data: adminQuizzes } = await supabase
    .from("quizzes")
    .select("id")
    .eq("uploaded_by", adminUser.id);
  
  const quizIds = (adminQuizzes || []).map((q) => q.id);
  
  let reportsCount = 0;
  if (quizIds.length > 0) {
    const { count } = await supabase
      .from("reports")
      .select("id", { count: "exact", head: true })
      .in("quiz_id", quizIds);
    reportsCount = count || 0;
  }

  const { count: resolvedCount } = await supabase
    .from("reports")
    .select("id", { count: "exact", head: true })
    .eq("resolved_by_admin_id", adminUser.id);

  return res.status(200).json({
    handle: adminUser.handle,
    email: adminUser.email,
    uploadedQuizzes: quizzesCount || 0,
    reportsCount: reportsCount,
    resolvedReports: resolvedCount || 0,
    totalPoints: adminUser.total_points || 0,
    totalQuizzes: adminUser.total_quizzes || 0,
    totalBadges: adminUser.total_badges || 0,
    currentLevel: adminUser.current_level || 1
  });
}
