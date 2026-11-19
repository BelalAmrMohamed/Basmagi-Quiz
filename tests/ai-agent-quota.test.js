import test from "node:test";
import assert from "node:assert/strict";
import { chargeAgentTurn, isValidTurnId } from "../api/ai-agent/_quota.js";

const TURN = "3f2b8c1e-9a4d-4e7b-8c55-0d1f6a7b9e21";

function fakeRpc(result) {
  const calls = [];
  const rpc = async (name, args) => {
    calls.push({ name, args });
    return typeof result === "function" ? result(name, args) : result;
  };
  return { rpc, calls };
}

test("isValidTurnId accepts uuids only", () => {
  assert.ok(isValidTurnId(TURN));
  assert.ok(!isValidTurnId("not-a-uuid"));
  assert.ok(!isValidTurnId(undefined));
  assert.ok(!isValidTurnId(12345));
  assert.ok(!isValidTurnId(`${TURN}; drop table`));
});

test("an invalid turnId uses the legacy per-request RPC", async () => {
  const f = fakeRpc({ data: [{ allowed: true, usage_count: 4 }], error: null });
  const r = await chargeAgentTurn({ rpc: f.rpc, profileId: "p1", turnId: "nope", dailyLimit: 15 });
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].name, "increment_ai_agent_usage");
  assert.deepEqual(f.calls[0].args, { p_profile_id: "p1", p_daily_limit: 15 });
  assert.deepEqual(r, { allowed: true, usageCount: 4, charged: true });
});

test("a missing turnId also uses the legacy RPC, and a denial is not charged", async () => {
  const f = fakeRpc({ data: [{ allowed: false, usage_count: 16 }], error: null });
  const r = await chargeAgentTurn({ rpc: f.rpc, profileId: "p1", dailyLimit: 15 });
  assert.equal(f.calls[0].name, "increment_ai_agent_usage");
  assert.deepEqual(r, { allowed: false, usageCount: 16, charged: false });
});

test("a valid turnId uses the turn RPC with the right args", async () => {
  const f = fakeRpc({ data: [{ allowed: true, usage_count: 3, charged: true }], error: null });
  const r = await chargeAgentTurn({ rpc: f.rpc, profileId: "p1", turnId: TURN, dailyLimit: 15 });
  assert.equal(f.calls[0].name, "increment_ai_agent_usage_turn");
  assert.deepEqual(f.calls[0].args, { p_profile_id: "p1", p_turn_id: TURN, p_daily_limit: 15, p_max_steps: 60 });
  assert.deepEqual(r, { allowed: true, usageCount: 3, charged: true });
});

test("the charged flag is passed through (free continuation step)", async () => {
  const f = fakeRpc({ data: [{ allowed: true, usage_count: 3, charged: false }], error: null });
  const r = await chargeAgentTurn({ rpc: f.rpc, profileId: "p1", turnId: TURN, dailyLimit: 15, maxSteps: 10 });
  assert.equal(f.calls[0].args.p_max_steps, 10);
  assert.deepEqual(r, { allowed: true, usageCount: 3, charged: false });
});

test("an RPC error fails closed", async () => {
  const f = fakeRpc({ data: null, error: { message: "db down" } });
  const origErr = console.error;
  console.error = () => {};
  try {
    const r = await chargeAgentTurn({ rpc: f.rpc, profileId: "p1", turnId: TURN, dailyLimit: 15 });
    assert.deepEqual(r, { allowed: false, usageCount: 0, charged: false });
  } finally { console.error = origErr; }
});

test("a thrown error and an empty result both fail closed", async () => {
  const origErr = console.error;
  console.error = () => {};
  try {
    const thrown = await chargeAgentTurn({ rpc: async () => { throw new Error("net"); }, profileId: "p1", turnId: TURN, dailyLimit: 15 });
    assert.equal(thrown.allowed, false);
    const empty = await chargeAgentTurn({ rpc: async () => ({ data: [], error: null }), profileId: "p1", turnId: TURN, dailyLimit: 15 });
    assert.equal(empty.allowed, false);
  } finally { console.error = origErr; }
});
