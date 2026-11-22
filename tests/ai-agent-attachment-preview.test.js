import test from "node:test";
import assert from "node:assert/strict";
import { formatBytes, friendlyType, parseFacts, pageHrefFor } from "../public/src/components/ai-agent/ai-agent-attachment-preview.js";

test("formatBytes / friendlyType describe files", () => {
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(84 * 1024), "84 KB");
  assert.equal(formatBytes(3 * 1024 * 1024), "3.0 MB");
  assert.equal(formatBytes(null), "");
  assert.equal(friendlyType({ mimeType: "image/png" }), "PNG");
  assert.equal(friendlyType({ mimeType: "application/octet-stream", name: "notes.CSV" }), "CSV");
});

test("parseFacts reads the launcher's 'label: value — label: value' summaries", () => {
  assert.deepEqual(parseFacts("عدد الامتحانات: 3 — عدد المجلدات: 1"), [["عدد الامتحانات", "3"], ["عدد المجلدات", "1"]]);
  assert.equal(parseFacts("نص حر بدون تسميات"), null);
  assert.equal(parseFacts("مقدمة: كيف نبدأ", { allowSingle: false }), null);
});

test("pageHrefFor: local items live behind ?type=user, platform ones do not", () => {
  assert.equal(pageHrefFor({ kind: "quiz", id: "q 1", source: "local" }), "/quiz/q%201?type=user");
  assert.equal(pageHrefFor({ kind: "quiz", id: "q1", source: "platform" }), "/quiz/q1");
  assert.equal(pageHrefFor({ kind: "lesson", id: "l1", source: "local" }), "/lesson/l1?type=user");
  assert.equal(pageHrefFor({ kind: "lesson", itemType: "notebook", id: "n1", source: "platform" }), "/notebook/n1");
  assert.equal(pageHrefFor({ kind: "course", id: "c1" }), "");
});
