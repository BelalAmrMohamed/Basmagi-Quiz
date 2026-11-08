// =============================================================================
// api/ai-agent/usage.js
// GET /api/ai-agent/usage
// Public, read-only: how much of the platform's shared API-key pool is left this
// week, per provider (percentages only — no counts, keys or user data).
// Response: { groups: [{ id, label, percentLeft, window, resetsAt }] }
// =============================================================================
import { applyCors } from "../_middleware.js";
import { getUsageSummary } from "./_usage.js";

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  try {
    res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=60");
    return res.status(200).json(await getUsageSummary());
  } catch (err) {
    console.error("[ai-agent/usage] error:", err);
    return res.status(503).json({ error: "تعذّر قراءة الاستخدام الآن" });
  }
}
