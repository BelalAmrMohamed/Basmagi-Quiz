import test from "node:test";
import assert from "node:assert/strict";
import { makeZip, readZip, crc32 } from "../public/src/shared/workspace-zip.js";
import { checkNotebookAssets, referencedNotebookAssets, checkNotebook } from "../public/src/shared/content-rules.js";
import { validateNotebookContent } from "../api/_validateNotebook.js";
import { prepareNotebook } from "../public/src/features/notebook/notebook-data.js";

const URL_OK = "https://x.supabase.co/storage/v1/object/public/notebook-assets/" + "a".repeat(64) + ".png";
const asset = (over = {}) => ({ path: "cat.png", mime: "image/png", size: 1000, sha256: "a".repeat(64), url: URL_OK, ...over });
const issues = (assets) => { const codes = []; checkNotebookAssets(assets, { err: (c) => codes.push(c), warn() {} }); return codes; };

test("zip round-trips names and bytes (incl. unicode)", async () => {
  const z = makeZip([{ name: "notebook.json", data: new TextEncoder().encode("{}") }, { name: "assets/صورة 1.png", data: new Uint8Array([1, 2, 3, 255]) }]);
  const r = await readZip(z);
  assert.deepEqual(r.map((e) => e.name), ["notebook.json", "assets/صورة 1.png"]);
  assert.deepEqual([...r[1].data], [1, 2, 3, 255]);
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
});

test("asset manifest: valid entry passes", () => assert.deepEqual(issues([asset(), asset({ path: "Neural0.jpg", mime: "image/jpeg" })]), []));
test("asset manifest: rejects bad type, size, hash, url, duplicates, paths", () => {
  assert.ok(issues([asset({ path: "a.exe", mime: "application/x" })]).includes("ASSET_TYPE_INVALID"));
  assert.ok(issues([asset({ mime: "image/jpeg" })]).includes("ASSET_TYPE_INVALID"));
  assert.ok(issues([asset({ size: 3 * 1024 * 1024 })]).includes("ASSET_SIZE_INVALID"));
  assert.ok(issues([asset({ sha256: "zz" })]).includes("ASSET_HASH_INVALID"));
  assert.ok(issues([asset({ url: "https://evil.com/a.png" })]).includes("ASSET_URL_INVALID"));
  assert.ok(issues([asset(), asset({ path: "CAT.png" })]).includes("ASSET_DUPLICATE"));
  assert.ok(issues([asset({ path: "../cat.png" })]).includes("ASSET_PATH_INVALID"));
});

test("only referenced files are picked for upload", () => {
  const cells = [{ source: 'A = imread("Cat.png");' }, { source: "![x](dog.jpg)" }];
  assert.deepEqual(referencedNotebookAssets(cells, ["cat.png", "dog.jpg", "unused.png"]), ["cat.png", "dog.jpg"]);
});

const base = { schemaVersion: 1, cells: [{ type: "code", source: 'imread("cat.png")' }] };
test("validateNotebookContent keeps a valid assets manifest and drops it when empty", () => {
  assert.equal(validateNotebookContent({ ...base, assets: [asset()] }).assets.length, 1);
  assert.equal("assets" in validateNotebookContent({ ...base, assets: [] }), false);
  assert.throws(() => validateNotebookContent({ ...base, assets: [asset({ url: "http://x/y.png" })] }));
  assert.throws(() => validateNotebookContent({ ...base, extra: 1 }));
});
test("checkNotebook (shared rules) flags bad assets", () => {
  assert.ok(checkNotebook({ content: { ...base, assets: [asset({ size: 0 })] } }, { contentOnly: true }).errors.length > 0);
});
test("published notebook rows expose assets to the viewer", () => {
  const r = prepareNotebook({ id: "1", title: "t", runtime: "matlab", content: { ...base, assets: [asset()] } });
  assert.equal(r.ok, true);
  assert.equal(r.notebook.assets[0].path, "cat.png");
  assert.deepEqual(prepareNotebook({ id: "1", title: "t", runtime: "matlab", content: base }).notebook.assets, []);
});
