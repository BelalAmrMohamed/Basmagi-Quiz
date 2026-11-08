import test from "node:test";
import assert from "node:assert/strict";
import { OG_LAYOUT_VERSION as serverVersions, ogVersion } from "../api/_og/version.js";
import { OG_LAYOUT_VERSION as clientVersions, ogThumbUrl } from "../public/src/shared/og-thumb.js";

test("client OG layout versions mirror api/_og/version.js", () => {
  assert.deepEqual(clientVersions, serverVersions);
});

test("ogThumbUrl builds URLs for every kind with the server's v= format", () => {
  const stamp = 1700000000000;
  const iso = new Date(stamp).toISOString();
  assert.equal(ogThumbUrl("quiz", { id: "abcd1234", updatedAt: iso }), `/api/og?quizId=abcd1234&v=${ogVersion("quiz", stamp)}`);
  assert.equal(ogThumbUrl("lesson", { id: "my-slug", updatedAt: iso }), `/api/og?lesson=my-slug&v=${ogVersion("lesson", stamp)}`);
  assert.equal(ogThumbUrl("notebook", { id: "nb", updatedAt: iso }), `/api/og?notebook=nb&v=${ogVersion("notebook", stamp)}`);
  assert.equal(ogThumbUrl("course", { id: "c-uuid", updatedAt: iso }), `/api/og?course=c-uuid&v=${ogVersion("course", stamp)}`);
  assert.equal(
    ogThumbUrl("folder", { id: "c-uuid", folderPath: ["A", "B ج"], updatedAt: iso }),
    `/api/og?course=c-uuid&folder=${encodeURIComponent("A/B ج")}&v=${ogVersion("course", stamp)}`,
  );
});

test("ogThumbUrl omits the stamp when unknown and returns null without an id", () => {
  assert.equal(ogThumbUrl("lesson", { id: "x" }), `/api/og?lesson=x&v=${ogVersion("lesson")}`);
  assert.equal(ogThumbUrl("lesson", { id: "" }), null);
  assert.equal(ogThumbUrl("folder", { id: "c", folderPath: [] }), null);
  assert.equal(ogThumbUrl("bogus", { id: "x" }), null);
});
