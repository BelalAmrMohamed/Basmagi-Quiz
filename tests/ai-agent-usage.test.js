import test from "node:test";
import assert from "node:assert/strict";
import { weekStart, isoDate, buildGroupUsage, USAGE_GROUPS } from "../api/ai-agent/_usage.js";

const google = USAGE_GROUPS.find((g) => g.provider === "google");

test("weekStart is Monday 00:00 UTC", () => {
  assert.equal(isoDate(weekStart(new Date("2026-11-08T23:57:00Z"))), "2026-11-02"); // Sunday -> prior Monday
  assert.equal(isoDate(weekStart(new Date("2026-11-09T00:00:00Z"))), "2026-11-09"); // Monday itself
});

test("buildGroupUsage computes percent left and next reset", () => {
  process.env.AI_AGENT_GOOGLE_WEEKLY_LIMIT = "1000";
  const u = buildGroupUsage(google, 450, new Date("2026-11-08T12:00:00Z"));
  assert.equal(u.percentLeft, 55);
  assert.equal(u.resetsAt, "2026-11-09T00:00:00.000Z");
  assert.equal(buildGroupUsage(google, 5000, new Date()).percentLeft, 0); // clamped
});
