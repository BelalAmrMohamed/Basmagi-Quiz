#!/usr/bin/env node
// Generates the documentation pages from one source.
//
//   docs-src/pages/*.html     front matter (JSON) + the page body
//   docs-src/shells/*.html    the two shells: howto.html, legal.html (about.html keeps its own layout)
//   public/src/features/documents/docs-nav.js   navigation groups / order (shared with the sidebar)
//
// Output goes to public/<slug>.html (Vercel serves `public/` directly, so the generated files are committed).
//
//   node scripts/build-docs.mjs           write the pages
//   node scripts/build-docs.mjs --check   exit 1 if any page is out of date (CI / tests)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "docs-src");
const PUBLIC = path.join(ROOT, "public");
const ORIGIN = "https://basmagi.vercel.app";
const DEFAULT_OG = `${ORIGIN}/assets/images/thumbnails/thumbnail.png`;
const BASE_STYLES = new Set([
  "src/styles/themes.css",
  "src/components/side-menu/side-menu.css",
  "src/features/documents/documents.css",
]);

const escapeAttr = (s) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeText = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** `{{{raw}}}` inserts HTML as is, `{{name}}` is attribute/text-escaped. */
function render(template, values) {
  return template
    .replace(/\{\{\{\s*(\w+)\s*\}\}\}/g, (_, k) => (values[k] ?? ""))
    .replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => escapeAttr(values[k]));
}

export function formatArabicDate(iso) {
  return new Intl.DateTimeFormat("ar-EG-u-nu-latn", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${iso}T00:00:00Z`),
  );
}

export function parsePage(raw, file = "page") {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error(`${file}: missing front matter`);
  const meta = JSON.parse(m[1]);
  for (const key of ["shell", "title", "description", "h1", "updated", "group", "order"]) {
    if (meta[key] === undefined) throw new Error(`${file}: front matter is missing "${key}"`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(meta.updated)) throw new Error(`${file}: "updated" must be YYYY-MM-DD`);
  return { meta, body: m[2].replace(/\s+$/, "") };
}

const stripTags = (html) =>
  html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();

/** Builds schema.org HowTo JSON-LD from the numbered `.doc-step` items of one section, so it never drifts from the page. */
export function buildHowTo(meta, body, url) {
  const cfg = meta.howTo;
  if (!cfg) return null;
  const section = body.match(new RegExp(`<h2 id="${cfg.sectionId}"[\\s\\S]*?(?=<section class="section"|$)`));
  if (!section) throw new Error(`howTo: section #${cfg.sectionId} not found`);
  const steps = [...section[0].matchAll(/<li class="doc-step">([\s\S]*?)<\/li>/g)].map((m, i) => {
    const name = stripTags((m[1].match(/<h3>([\s\S]*?)<\/h3>/) || [])[1] || "");
    const text = stripTags((m[1].match(/<p>([\s\S]*?)<\/p>/) || [])[1] || "");
    const img = (m[1].match(/<img src="([^"]+)"/) || [])[1];
    return {
      "@type": "HowToStep",
      position: i + 1,
      name,
      text,
      url: `${url}#${cfg.sectionId}`,
      ...(img ? { image: `${ORIGIN}${img}` } : {}),
    };
  });
  if (!steps.length) throw new Error(`howTo: no steps found in #${cfg.sectionId}`);
  return {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: cfg.name,
    description: cfg.description,
    inLanguage: "ar",
    totalTime: cfg.totalTime,
    dateModified: meta.updated,
    step: steps,
  };
}

async function loadNav() {
  return import(pathToFileURL(path.join(PUBLIC, "src/features/documents/docs-nav.js")).href);
}

function nextGuideHtml(slug, nav) {
  const idx = nav.GUIDE_ORDER.indexOf(`/${slug}`);
  if (idx === -1 || idx === nav.GUIDE_ORDER.length - 1) return "";
  const href = nav.GUIDE_ORDER[idx + 1];
  const link = nav.DOCS_LINKS.find((l) => l.href === href);
  if (!link) return "";
  return `            <nav class="doc-next" aria-label="الدليل التالي">
                <span class="doc-next__label">الدليل التالي</span>
                <a class="doc-next__link" href="${href}">${escapeText(link.label)} ←</a>
            </nav>`;
}

export async function buildAll({ write = true } = {}) {
  const nav = await loadNav();
  const footer = fs.readFileSync(path.join(SRC, "shells/_legal-footer.html"), "utf8").replace(/\s+$/, "");
  const headTpl = fs.readFileSync(path.join(SRC, "shells/_head.html"), "utf8");
  const results = [];

  for (const file of fs.readdirSync(path.join(SRC, "pages")).filter((f) => f.endsWith(".html")).sort()) {
    const slug = file.replace(/\.html$/, "");
    const { meta, body } = parsePage(fs.readFileSync(path.join(SRC, "pages", file), "utf8"), file);
    const shellTpl = fs.readFileSync(path.join(SRC, "shells", `${meta.shell}.html`), "utf8");

    const extraStyles = (meta.styles || [])
      .filter((s) => !BASE_STYLES.has(s))
      .map((s) => `    <link rel="stylesheet" href="${s}" />\n`)
      .join("");
    const url = `${ORIGIN}/${slug}`;
    const ld = meta.jsonLd || buildHowTo(meta, body, url);
    const jsonLd = ld
      ? `    <script type="application/ld+json">\n${JSON.stringify(ld, null, 2).replace(/</g, "\\u003c")}\n    </script>\n`
      : "";
    const head = render(headTpl, {
      description: meta.description,
      keywords: meta.keywords || `بصمجي، ${meta.title}، منصة امتحانات`,
      title: meta.title,
      url,
      ogImage: meta.ogImage || DEFAULT_OG,
      updated: meta.updated,
      extraStyles,
      jsonLd,
    });

    const chips = [...(meta.chips || [])];
    chips.push(`آخر تحديث: ${formatArabicDate(meta.updated)}`);
    if (meta.version) chips.push(`الإصدار ${meta.version}`);
    const chipsHtml = "\n" + chips.map((c, i) => {
      const last = c.startsWith("آخر تحديث");
      return last
        ? `                    <span><time datetime="${meta.updated}">${escapeText(c)}</time></span>`
        : `                    <span>${escapeText(c)}</span>`;
    }).join("\n") + "\n                ";

    const extraScripts =
      (meta.scripts || []).map((s) => `    <script type="module" src="${s}"></script>\n`).join("") +
      (meta.inlineModule || []).map((code) => `    <script type="module">\n${code}\n    </script>\n`).join("");

    const html = render(shellTpl, {
      head,
      h1: meta.h1,
      chips: chipsHtml,
      body: body.replace(/^/gm, "").replace(/\n{3,}/g, "\n\n"),
      next: nextGuideHtml(slug, nav),
      footer,
      extraScripts,
    }).replace(/\n{3,}/g, "\n\n");

    const out = path.join(PUBLIC, `${slug}.html`);
    const current = fs.existsSync(out) ? fs.readFileSync(out, "utf8") : null;
    results.push({ slug, out, html, stale: current !== html });
    if (write && current !== html) fs.writeFileSync(out, html);
  }
  return results;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes("--check");
  const results = await buildAll({ write: !check });
  const stale = results.filter((r) => r.stale);
  if (check) {
    if (stale.length) {
      console.error(`Out of date: ${stale.map((r) => r.slug).join(", ")}. Run: npm run docs:build`);
      process.exit(1);
    }
    console.log(`docs: ${results.length} pages up to date`);
  } else {
    console.log(`docs: built ${results.length} pages (${stale.length} changed)`);
  }
}
