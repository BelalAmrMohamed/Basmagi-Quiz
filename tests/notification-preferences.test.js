import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MUTABLE_TYPES, IMPORTANT_TYPES, NOTIFICATION_ACTIONS, handleNotificationAction } from "../api/_notifications.js";

const ADMIN = "11111111-1111-4111-8111-111111111111";

function fakeSupabase(state) {
  return {
    from(table) {
      const q = {
        select: () => q,
        eq: () => q,
        is: () => q,
        order: () => q,
        limit: () => q,
        lt: () => q,
        update(v) { if (table === "admin_users") { state.muted = v.notification_muted; state.quiet = v.notification_quiet; } return q; },
        in(...args) { state.inArgs = args; return q; },
        not(...args) { state.notArgs = args; return q; },
        maybeSingle: async () => ({ data: { notification_muted: state.muted, notification_quiet: state.quiet || [] }, error: null }),
        then: (resolve) => resolve({ data: table === "admin_users" ? state.admins || [] : [], count: 3, error: null }),
      };
      return q;
    },
  };
}

function run(action, body, state, payload = {}) {
  return new Promise((resolve) => {
    const res = { status: (c) => ({ json: (j) => resolve({ code: c, json: j }) }) };
    handleNotificationAction({ body }, res, action, payload, ADMIN, fakeSupabase(state));
  });
}

test("prefs actions are routed", () => {
  assert.ok(NOTIFICATION_ACTIONS.has("notifications-prefs-get"));
  assert.ok(NOTIFICATION_ACTIONS.has("notifications-prefs-set"));
});

test("welcome / storage_warning can never be muted", () => {
  assert.ok(!MUTABLE_TYPES.includes("welcome"));
  assert.ok(!MUTABLE_TYPES.includes("storage_warning"));
});

test("prefs-set keeps only mutable types, de-duplicated", async () => {
  const state = { muted: [] };
  const r = await run("notifications-prefs-set", { muted: ["badge", "badge", "welcome", "storage_warning", "x", "level_up"] }, state);
  assert.equal(r.code, 200);
  assert.deepEqual(r.json.muted, ["badge", "level_up"]);
  assert.deepEqual(state.muted, ["badge", "level_up"]);
});

test("quiet types are kept, never overlap muted, and are hidden from the badge", async () => {
  const state = { muted: [] };
  const r = await run("notifications-prefs-set", { muted: ["badge"], quiet: ["badge", "upload", "welcome"] }, state);
  assert.deepEqual(r.json.muted, ["badge"]);
  assert.deepEqual(r.json.quiet, ["upload"]);
  assert.deepEqual(state.notArgs, ["type", "in", "(badge,upload)"]);
});

test("important filter uses the important types", async () => {
  const state = { muted: [] };
  await run("notifications-list", { filter: "important" }, state);
  assert.deepEqual(state.inArgs, ["type", IMPORTANT_TYPES]);
  assert.ok(!IMPORTANT_TYPES.some((t) => MUTABLE_TYPES.includes(t) && t === "badge"));
});

test("broadcast preview is owner-only and counts muted / quiet admins", async () => {
  const state = {
    muted: [],
    admins: [
      { notification_muted: ["announcement"], notification_quiet: [] },
      { notification_muted: [], notification_quiet: ["announcement"] },
      { notification_muted: [], notification_quiet: [] },
    ],
  };
  assert.equal((await run("notifications-broadcast-preview", {}, state, { isOwner: false })).code, 403);
  const r = await run("notifications-broadcast-preview", {}, state, { isOwner: true });
  assert.deepEqual(r.json, { total: 3, receiving: 2, silent: 1 });
});

test("prefs-set rejects a non-array", async () => {
  const r = await run("notifications-prefs-set", { muted: "badge" }, { muted: [] });
  assert.equal(r.code, 400);
});

test("count hides muted types", async () => {
  const state = { muted: ["milestone", "bogus"] };
  const r = await run("notifications-count", {}, state);
  assert.equal(r.code, 200);
  assert.deepEqual(state.notArgs, ["type", "in", "(milestone)"]);
});

test("client list matches the server list", () => {
  const src = readFileSync(new URL("../public/src/components/notification-center/notification-center.js", import.meta.url), "utf8");
  const client = [...src.matchAll(/\{ type: "([a-z_]+)", label:/g)].map((m) => m[1]).sort();
  assert.deepEqual(client, [...MUTABLE_TYPES].sort());
});
