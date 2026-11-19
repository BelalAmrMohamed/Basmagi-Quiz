// =============================================================================
// api/ai-agent/_quota.js
// Daily platform-key quota for regular (non-admin) users, counted ONCE PER USER
// MESSAGE ("turn") instead of once per model round-trip.
//
// The client sends a `turnId` (uuid, one per user message) with every request of
// the turn. The Postgres function increment_ai_agent_usage_turn() charges the
// daily counter on the first request of a turn and lets later requests of the
// same live turn through for free (see the migration for the step/time cap).
//
// A request without a valid uuid turnId is charged per request through the old
// increment_ai_agent_usage() function, so old cached front-ends keep working.
//
// The Supabase client is injected as `rpc(name, args) => Promise<{data, error}>`
// so this file has no imports and can be unit-tested with a fake.
// =============================================================================

export const MAX_FREE_STEPS_PER_TURN = 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidTurnId(value) {
  return typeof value === "string" && UUID_RE.test(value);
}

/**
 * @param {object} p
 * @param {(name: string, args: object) => Promise<{data: any, error: any}>} p.rpc
 * @param {string} p.profileId
 * @param {unknown} p.turnId
 * @param {number} p.dailyLimit
 * @param {number} [p.maxSteps]
 * @returns {Promise<{allowed: boolean, usageCount: number, charged: boolean}>}
 *   Fails CLOSED (allowed: false) on any RPC error, so an outage can't silently
 *   uncap usage.
 */
export async function chargeAgentTurn({ rpc, profileId, turnId, dailyLimit, maxSteps = MAX_FREE_STEPS_PER_TURN }) {
  const turnAware = isValidTurnId(turnId);
  const fnName = turnAware ? "increment_ai_agent_usage_turn" : "increment_ai_agent_usage";
  const args = turnAware
    ? { p_profile_id: profileId, p_turn_id: turnId, p_daily_limit: dailyLimit, p_max_steps: maxSteps }
    : { p_profile_id: profileId, p_daily_limit: dailyLimit };
  try {
    const { data, error } = await rpc(fnName, args);
    if (error || !Array.isArray(data) || !data.length) {
      console.error(`[ai-agent/quota] ${fnName} error:`, error);
      return { allowed: false, usageCount: 0, charged: false };
    }
    const row = data[0];
    return {
      allowed: !!row.allowed,
      usageCount: Number(row.usage_count) || 0,
      // The legacy function charges every request.
      charged: turnAware ? !!row.charged : !!row.allowed,
    };
  } catch (err) {
    console.error(`[ai-agent/quota] ${fnName} unexpected error:`, err);
    return { allowed: false, usageCount: 0, charged: false };
  }
}
