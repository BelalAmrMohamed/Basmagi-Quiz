// Contextual deep links: every error link must land on a real section/entry of its guide,
// and the failures that own a link must actually carry it.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { GUIDE_LINKS, guideAction, guideOptions, withGuide } from "../public/src/shared/guide-links.js";

const ROOT = new URL("../", import.meta.url).pathname;
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

test("every guide link points to an id that exists in the generated guide page", () => {
  for (const [key, { href }] of Object.entries(GUIDE_LINKS)) {
    const [page, id] = href.slice(1).split("#");
    const html = read(`public/${page}.html`);
    assert.ok(html.includes(`id="${id}"`), `${key}: #${id} is missing in ${page}.html`);
  }
});

test("link targets: FAQ section #s8, FAQ entry for a missing item, upload verification step", () => {
  assert.equal(GUIDE_LINKS.draftExpired.href, "/how-to-connect-mcp#s8");
  assert.equal(GUIDE_LINKS.itemMissing.href, "/how-to-connect-mcp#faq-item-missing");
  assert.equal(GUIDE_LINKS.uploadVerify.href, "/how-to-upload-content#s4");
  assert.match(read("docs-src/pages/how-to-connect-mcp.html"), /<details class="doc-faq" id="faq-item-missing">\s*<summary>فتحت الرابط ولا أجد العنصر/);
  assert.match(read("docs-src/pages/how-to-upload-content.html"), /<h2 id="s4">\s*٤\. التحقق من سلامة الرفع/);
});

test("guideAction / guideOptions: link only when the error carries a guide key", () => {
  assert.deepEqual(guideAction("uploadVerify"), { href: "/how-to-upload-content#s4", label: GUIDE_LINKS.uploadVerify.label.ar });
  assert.equal(guideAction("nope"), undefined);
  assert.equal(guideAction("itemMissing", "en").label, GUIDE_LINKS.itemMissing.label.en);
  assert.deepEqual(guideOptions(new Error("network")), {});
  assert.deepEqual(guideOptions(null), {});
  assert.equal(guideOptions(withGuide(new Error("x"), "draftExpired")).action.href, "/how-to-connect-mcp#s8");
});

test("fetchImportDraft: expired → #s8, wrong kind / server error → missing-item entry, network → no link", async () => {
  const { fetchImportDraft } = await import("../public/src/shared/import-draft.js");
  globalThis.window = { location: new URL("https://x.test/create-quiz?draft=aaaaaaaaaa") };
  const respond = (r) => { globalThis.fetch = async () => { if (r instanceof Error) throw r; return r; }; };
  const guideOf = async () => { try { await fetchImportDraft("quiz"); } catch (e) { return e.guide; } };
  respond({ ok: false, status: 404 });
  assert.equal(await guideOf(), "draftExpired");
  respond({ ok: false, status: 409 });
  assert.equal(await guideOf(), "itemMissing");
  respond({ ok: false, status: 500 });
  assert.equal(await guideOf(), "itemMissing");
  respond(new Error("offline"));
  assert.equal(await guideOf(), undefined);
});

test("success toasts carry no guide link; upload failures do", () => {
  const upload = read("public/src/features/home/adminUpload.js");
  assert.doesNotMatch(upload, /showNotification\("تم الرفع بنجاح", "", "success", [^)]*guide/);
  assert.ok((upload.match(/uploadFailToast\(/g) || []).length >= 8);
});
