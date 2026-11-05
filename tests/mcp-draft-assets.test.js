import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeAssetName, sniffImageMime, signUploadToken, verifyUploadToken, safeFetchUrl, driveDirectUrl } from "../supabase/functions/mcp/draft-assets-lib.ts";
import { AUTHORING_GUIDE } from "../supabase/functions/mcp/lib.ts";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);

test("asset names: keeps extension, strips folders, rejects unsupported/odd names", () => {
  assert.deepEqual(sanitizeAssetName("C:\\pics\\Cat.PNG"), { ok: true, name: "Cat.PNG", mime: "image/png" });
  assert.equal(sanitizeAssetName("report.pdf").ok, false);
  assert.equal(sanitizeAssetName(".hidden.png").ok, false);
  assert.equal(sanitizeAssetName("").ok, false);
});
test("magic bytes decide the real type", () => {
  assert.equal(sniffImageMime(PNG), "image/png");
  assert.equal(sniffImageMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
  assert.equal(sniffImageMime(new TextEncoder().encode("<html>not an image</html>")), null);
});
test("upload tokens are bound to one draft+file and expire", async () => {
  const t = await signUploadToken("secret", { code: "abc", name: "a.png" }, 1000);
  assert.deepEqual(await verifyUploadToken("secret", t, 2000), { code: "abc", name: "a.png" });
  assert.equal(await verifyUploadToken("other", t, 2000), null);
  assert.equal(await verifyUploadToken("secret", t, 1000 + 16 * 60_000), null);
  assert.equal(await verifyUploadToken("secret", t.slice(0, -2) + "xx", 2000), null);
});
test("server-side fetch only accepts public https hosts", () => {
  for (const bad of ["http://example.com/a.png", "https://localhost/a.png", "https://127.0.0.1/a.png", "https://[::1]/a.png", "https://user:p@example.com/a.png", "https://intranet/a.png", "https://x.internal/a.png", "https://example.com:8443/a.png"]) assert.equal(safeFetchUrl(bad), null, bad);
  assert.ok(safeFetchUrl("https://example.com/a.png"));
});
test("Drive share links become direct downloads", () => {
  assert.match(driveDirectUrl("https://drive.google.com/file/d/1AbCdEfGhIjK/view"), /drive\.usercontent\.google\.com\/download\?id=1AbCdEfGhIjK/);
  assert.equal(driveDirectUrl("https://example.com/x.png"), "https://example.com/x.png");
});
test("notebook guide documents the three asset tools", () => {
  for (const t of ["add_workspace_asset", "add_workspace_asset_from_url", "request_asset_upload"]) assert.ok(AUTHORING_GUIDE.notebook.includes(t), t);
});
