// Guards the documentation pipeline: pages are generated from docs-src/, the sidebar
// groups cover every doc page, and the docs stay in one language register.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildAll, parsePage, formatArabicDate } from "../scripts/build-docs.mjs";
import { DOCS_GROUPS, DOCS_LINKS, GUIDE_ORDER } from "../public/src/features/documents/docs-nav.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PAGES_DIR = path.join(ROOT, "docs-src/pages");

test("generated pages are in sync with docs-src (run `npm run docs:build`)", async () => {
  const results = await buildAll({ write: false });
  assert.equal(results.length, 7);
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
    assert.ok(["howto", "legal", "hub"].includes(meta.shell), `${file}: unknown shell`);
    const html = fs.readFileSync(path.join(ROOT, "public", file), "utf8");
    assert.ok(html.includes(`<time datetime="${meta.updated}">آخر تحديث: ${formatArabicDate(meta.updated)}</time>`), `${file}: no last-updated chip`);
    assert.ok(html.includes("documents-shell.js"), `${file}: missing documents-shell.js`);
    if (meta.shell !== "hub") {
      assert.ok(html.includes("doc-toc.js"), `${file}: missing doc-toc.js`);
    }
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

test("/docs hub: first in the sidebar, unsectioned cards list each guide once with title and description", () => {
  assert.equal(DOCS_GROUPS[0].links[0].href, "/docs");
  assert.ok(!GUIDE_ORDER.includes("/docs"), "the hub is not part of the guide reading order");
  const html = fs.readFileSync(path.join(ROOT, "public/docs.html"), "utf8");
  const cards = [...html.matchAll(/<a class="doc-hub__card" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
  assert.equal(cards.length, GUIDE_ORDER.length, "each guide has exactly one card (no duplicates)");
  const linked = cards.map((c) => c[1]);
  assert.deepEqual(linked, GUIDE_ORDER, "all guides are present in guide order");
  for (const [, href, inner] of cards) {
    assert.match(inner, /doc-hub__title">[^<]+</, `${href}: card has no title`);
    assert.match(inner, /doc-hub__desc">[^<]+</, `${href}: card has no description`);
    if (href === "/how-to-upload-content") {
      assert.match(inner, /doc-hub__note|doc-hub__tag--admin/, `${href}: upload guide should carry admin note`);
    }
  }
});

test("/docs is registered like the other guides: vercel.json, sitemap, llms.txt, page bundle, hand-written sidebars", () => {
  const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
  assert.match(read("vercel.json"), /\|docs\$\|/);
  assert.match(read("public/sitemap-static.xml"), /<loc>https:\/\/basmagi-quiz\.vercel\.app\/docs<\/loc>/);
  assert.match(read("public/llms.txt"), /\(https:\/\/basmagi-quiz\.vercel\.app\/docs\)/);
  assert.ok(JSON.parse(read("scripts/page-bundles.json")).docs, "scripts/page-bundles.json has no \"docs\" entry");
  for (const f of ["index", "create-quiz", "create-lesson", "lesson", "notebook", "profile", "result", "reports", "settings"]) {
    assert.match(read(`public/${f}.html`), /<a href="\/docs" class="menu-item" data-tooltip="الأدلة والمساعدة">/, `${f}.html: «الأدلة والمساعدة» does not open /docs`);
  }
});
