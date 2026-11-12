// Guards the documentation pipeline: pages are generated from docs-src/, the sidebar
// groups cover every doc page, and the docs stay in one language register.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildAll, parsePage, formatArabicDate } from "../scripts/build-docs.mjs";
import { DOCS_GROUPS, DOCS_LINKS, GUIDE_ORDER } from "../public/src/features/documents/docs-nav.js";

const ROOT = new URL("../", import.meta.url).pathname;
const PAGES_DIR = path.join(ROOT, "docs-src/pages");

test("generated pages are in sync with docs-src (run `npm run docs:build`)", async () => {
  const results = await buildAll({ write: false });
  assert.equal(results.length, 6);
  const stale = results.filter((r) => r.stale).map((r) => r.slug);
  assert.deepEqual(stale, []);
});

test("every sidebar link points to a real page, grouped Start / Create / AI / Legal", () => {
  assert.deepEqual(DOCS_GROUPS.map((g) => g.id), ["start", "create", "ai", "legal"]);
  for (const { href } of DOCS_LINKS) {
    assert.ok(fs.existsSync(path.join(ROOT, "public", `${href.slice(1)}.html`)), `${href} has no page`);
  }
  assert.deepEqual(GUIDE_ORDER, [
    "/how-to-create-content",
    "/how-to-upload-content",
    "/how-to-connect-mcp",
    "/how-to-use-ai-agent",
  ]);
  for (const href of GUIDE_ORDER) assert.ok(DOCS_LINKS.some((l) => l.href === href));
});

test("every doc page has a last-updated date, a valid shell and the shared scripts", () => {
  for (const file of fs.readdirSync(PAGES_DIR)) {
    const { meta } = parsePage(fs.readFileSync(path.join(PAGES_DIR, file), "utf8"), file);
    assert.ok(["howto", "legal"].includes(meta.shell), `${file}: unknown shell`);
    const html = fs.readFileSync(path.join(ROOT, "public", file), "utf8");
    assert.ok(html.includes(`<time datetime="${meta.updated}">آخر تحديث: ${formatArabicDate(meta.updated)}</time>`), `${file}: no last-updated chip`);
    assert.ok(html.includes("documents-shell.js") && html.includes("doc-toc.js"), `${file}: missing shell scripts`);
    // No script may sit after </body> (the old hand-written pages did).
    assert.ok(!/<\/body>\s*<script/.test(html), `${file}: script after </body>`);
  }
});

test("docs use one register: no Egyptian-dialect words in doc content", () => {
  const dialect = /دلوقتي|بقى\b|بيديك|بيتحفظ|بيعدّل|بينسخه|بيتغير|عايز|عشان|قولولي|جرّبوه|اعملي|إزاي|ازاي|جوّه|تانية\b|بكتير/;
  for (const file of fs.readdirSync(PAGES_DIR)) {
    const text = fs.readFileSync(path.join(PAGES_DIR, file), "utf8");
    const hit = text.match(dialect);
    assert.equal(hit, null, `${file}: dialect word "${hit && hit[0]}"`);
  }
});

test("MCP page ships HowTo structured data built from its own steps, with WebP screenshots", () => {
  const html = fs.readFileSync(path.join(ROOT, "public/how-to-connect-mcp.html"), "utf8");
  const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(ld["@type"], "HowTo");
  assert.equal(ld.step.length, 5);
  assert.ok(ld.step.every((s) => s.name && s.text && s.image.endsWith(".webp")));
  for (const src of html.match(/\/assets\/document-pages\/[^"]+/g)) {
    assert.ok(src.endsWith(".webp"), `${src} is not WebP`);
    assert.ok(fs.existsSync(path.join(ROOT, "public", src)), `${src} is missing`);
  }
});
