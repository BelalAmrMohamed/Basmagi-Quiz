import test from "node:test";
import assert from "node:assert/strict";

// Stub the browser globals BEFORE the module evaluates (it reads location once).
globalThis.location = { pathname: "/ai-agent", search: "", hash: "" };
globalThis.document = { title: "منصة امتحانات بصمجي" };
const calls = [];
globalThis.history = {
  state: null,
  replaceState(_s, _t, url) {
    calls.push(url);
    const u = new URL(url, "https://x.test");
    globalThis.location.pathname = u.pathname;
    globalThis.location.search = u.search;
    globalThis.location.hash = u.hash;
  },
};

const r = await import("../public/src/components/ai-agent/ai-agent-route.js");

test("isAIAgentPath: canonical, alias, trailing slash; nothing else", () => {
  assert.ok(r.isAIAgentPath("/ai-agent"));
  assert.ok(r.isAIAgentPath("/ai-agent/"));
  assert.ok(r.isAIAgentPath("/my-content/ai-agent"));
  assert.ok(!r.isAIAgentPath("/my-content"));
  assert.ok(!r.isAIAgentPath("/my-content/ai-agent/x"));
  assert.ok(!r.isAIAgentPath("/api/ai-agent/chat"));
  assert.ok(!r.isAIAgentPath(""));
});

test("deep-link open intent is one-shot", () => {
  assert.equal(r.consumeAgentOpenIntent(), true); // page was opened on /ai-agent
  assert.equal(r.consumeAgentOpenIntent(), false);
  assert.equal(r.consumeMaximizedOpen(), false);
  r.requestMaximizedOpen();
  assert.equal(r.consumeMaximizedOpen(), true);
  assert.equal(r.consumeMaximizedOpen(), false);
});

test("deep-link load: leaving restores the plain my-content URL", () => {
  r.enterAgentUrl();
  assert.equal(location.pathname, "/ai-agent");
  r.leaveAgentUrl();
  assert.equal(location.pathname, "/my-content");
  assert.equal(document.title, "منصة امتحانات بصمجي");
});

test("maximize from a folder: leaving restores that exact folder URL + title", () => {
  Object.assign(location, { pathname: "/my-content/algo", search: "?a=1", hash: "" });
  r.enterAgentUrl();
  assert.equal(location.pathname, "/ai-agent");
  assert.notEqual(document.title, "منصة امتحانات بصمجي");
  r.leaveAgentUrl();
  assert.equal(location.pathname + location.search, "/my-content/algo?a=1");
  assert.equal(document.title, "منصة امتحانات بصمجي");
});

test("leaveAgentUrl never rewrites a URL the user already navigated away from", () => {
  Object.assign(location, { pathname: "/my-content/other", search: "", hash: "" });
  const before = calls.length;
  r.leaveAgentUrl();
  assert.equal(calls.length, before);
});
