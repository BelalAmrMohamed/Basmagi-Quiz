import test from "node:test";
import assert from "node:assert/strict";
import { resolvePlatformModelId, resolveModelId, resolveEffort, getModelMeta, DEFAULT_MODELS, OWN_KEY_DEFAULT_MODELS } from "../public/src/shared/ai-models.js";
import { describeProviderError } from "../api/ai-agent/_providerErrors.js";

test("platform keys only honor free-tier models; legacy ids are mapped", () => {
  assert.equal(resolvePlatformModelId("google", "gemini-4-hydrogen"), "gemini-4-hydrogen");
  assert.equal(resolvePlatformModelId("google", "gemini-4-argon"), DEFAULT_MODELS.google);
  assert.equal(resolvePlatformModelId("google", "bogus"), DEFAULT_MODELS.google);
  assert.equal(getModelMeta("google", "gemini-3.8-flash").id, "gemini-4-hydrogen");
  assert.equal(resolveModelId("google", "", OWN_KEY_DEFAULT_MODELS.google), "gemini-4-argon");
});

test("thinking level is only sent when the model supports it", () => {
  assert.equal(resolveEffort("google", "gemini-4-hydrogen", "xhigh"), "xhigh");
  assert.equal(resolveEffort("google", "gemini-4-argon", "xhigh"), "");
  assert.equal(resolveEffort("google", "gemini-flash-lite-latest", "high"), "");
});

test("a paid-only Gemini model on a free own key gets a plain explanation + debug text", () => {
  const body = { error: { code: 429, message: "Quota exceeded ... limit: 0, model: gemini-4-argon", status: "RESOURCE_EXHAUSTED" } };
  const err = Object.assign(new Error(`Google AI Studio error (429): ${JSON.stringify(body)}`), { upstreamStatus: 429 });
  const out = describeProviderError(err, { provider: "google", model: "gemini-4-argon", ownKey: true });
  assert.equal(out.code, "model_needs_paid_plan");
  assert.match(out.message, /الخطة المجانية/);
  assert.match(out.debug, /RESOURCE_EXHAUSTED/);
});

test("keys are redacted from debug text and unknown errors are left alone", () => {
  const err = Object.assign(new Error('Google AI Studio error (400): {"error":{"message":"API key not valid key=AIzaSyA1234567890123456789012"}}'), { upstreamStatus: 400 });
  const out = describeProviderError(err, { provider: "google", model: "gemini-4-hydrogen", ownKey: true });
  assert.ok(!out.debug.includes("AIzaSyA1234567890123456789012"));
  const weird = Object.assign(new Error("Claude error (400): {}"), { upstreamStatus: 400 });
  assert.equal(describeProviderError(weird, { provider: "claude", model: "x", ownKey: true }), null);
});
