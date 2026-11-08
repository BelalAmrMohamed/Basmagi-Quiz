// =============================================================================
// api/ai-agent/_usage.js
// Platform-key usage metering behind the "View Usage" submenu.
//
// WHY THIS EXISTS: Google free-tier (AI Studio) API keys do not expose their
// remaining quota — not in response headers, not via any API-key endpoint
// (quota is only shown in AI Studio / Cloud Console). So we count our own
// platform-key requests per provider per weekly window and compare that with a
// configured weekly budget. The number is therefore the PLATFORM'S view of its
// shared pool, which is what the menu is meant to show.
//
// Budget (requests per week, whole pool) — env, optional:
//   AI_AGENT_GOOGLE_WEEKLY_LIMIT / AI_AGENT_DEEPSEEK_WEEKLY_LIMIT / AI_AGENT_CLAUDE_WEEKLY_LIMIT
// Default when unset: poolSize * DEFAULT_PER_KEY_WEEKLY_LIMIT.
// =============================================================================
import { createClient } from "@supabase/supabase-js";
import { hasPlatformKeys } from "./_keyPool.js";

const DEFAULT_PER_KEY_WEEKLY_LIMIT = 3500; // ~500 req/day per free-tier key; override via env
const DAY_MS = 86_400_000;

export const USAGE_GROUPS = [
  { provider: "google", label: "Gemini Models", envKey: "AI_AGENT_GOOGLE_KEYS", limitEnv: "AI_AGENT_GOOGLE_WEEKLY_LIMIT" },
  { provider: "claude", label: "Claude models", envKey: "AI_AGENT_CLAUDE_KEYS", limitEnv: "AI_AGENT_CLAUDE_WEEKLY_LIMIT" },
  { provider: "deepseek", label: "DeepSeek models", envKey: "AI_AGENT_DEEPSEEK_KEYS", limitEnv: "AI_AGENT_DEEPSEEK_WEEKLY_LIMIT" },
];

let client = null;
function db() {
  if (!client) client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  return client;
}

/** Monday 00:00 UTC of the week containing `now`. */
export function weekStart(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const sinceMonday = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - sinceMonday * DAY_MS);
}

export const isoDate = (d) => d.toISOString().slice(0, 10);

function poolSize(group) {
  return (process.env[group.envKey] || "").split(",").map((k) => k.trim()).filter(Boolean).length;
}

export function weeklyLimit(group) {
  const fromEnv = Number(process.env[group.limitEnv]);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return Math.floor(fromEnv);
  return Math.max(1, poolSize(group)) * DEFAULT_PER_KEY_WEEKLY_LIMIT;
}

/** Pure: shapes one group's numbers for the client. */
export function buildGroupUsage(group, used, now = new Date()) {
  const limit = weeklyLimit(group);
  const percentLeft = Math.max(0, Math.min(100, Math.round(((limit - used) / limit) * 100)));
  const resetsAt = new Date(weekStart(now).getTime() + 7 * DAY_MS);
  return { id: group.provider, label: group.label, percentLeft, window: "weekly", resetsAt: resetsAt.toISOString() };
}

/** Fire-and-forget: count one successful platform-key request. Never throws. */
export async function recordPlatformUsage(provider) {
  try {
    const { error } = await db().rpc("bump_ai_agent_platform_usage", {
      p_provider: provider,
      p_window_start: isoDate(weekStart()),
    });
    if (error) console.error("[ai-agent/usage] bump error:", error);
  } catch (err) {
    console.error("[ai-agent/usage] bump unexpected error:", err);
  }
}

/** Usage for every provider that has platform keys configured. */
export async function getUsageSummary(now = new Date()) {
  const groups = USAGE_GROUPS.filter((g) => hasPlatformKeys(g.provider));
  if (!groups.length) return { groups: [] };
  const { data, error } = await db()
    .from("ai_agent_platform_usage")
    .select("provider, request_count")
    .eq("window_start", isoDate(weekStart(now)))
    .in("provider", groups.map((g) => g.provider));
  if (error) throw error;
  const used = Object.fromEntries((data || []).map((r) => [r.provider, r.request_count]));
  return { groups: groups.map((g) => buildGroupUsage(g, used[g.provider] || 0, now)) };
}
