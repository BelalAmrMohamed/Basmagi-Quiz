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
//   node scripts/build-docs.mjs --chapters [slug]   print the video chapters as a YouTube-description block
//
// Line endings: a generated page uses the same line ending as its source in docs-src/pages/ (CRLF in this
// repo), so a rebuild never rewrites a page whose content did not change.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "docs-src");
const PUBLIC = path.join(ROOT, "public");
const ORIGIN = "https://basmagi-quiz.vercel.app";
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
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
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

const pad2 = (n) => String(n).padStart(2, "0");

/** `0 -> "00:00"`, `275 -> "04:35"`, `3725 -> "1:02:05"` (the timestamp format YouTube reads in a description). */
export function formatTimestamp(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h ? `${h}:${pad2(m)}:${pad2(s)}` : `${pad2(m)}:${pad2(s)}`;
}

/** ISO 8601 duration for schema.org: `275 -> "PT4M35S"`. */
export function isoDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `PT${h ? `${h}H` : ""}${m ? `${m}M` : ""}${s || (!h && !m) ? `${s}S` : ""}`;
}

/** The `.doc-video-chip[data-time]` buttons of one video card, in page order. */
export function parseVideoChapters(cardHtml) {
  const chapters = [];
  for (const m of cardHtml.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
    if (!/\bclass="[^"]*\bdoc-video-chip\b/.test(m[1])) continue;
    const time = m[1].match(/\bdata-time="(\d+)"/);
    if (!time) throw new Error("video: a .doc-video-chip has no numeric data-time");
    const spans = [...m[2].matchAll(/<span\b[^>]*>([\s\S]*?)<\/span>/g)].map((s) => stripTags(s[1]));
    const [label, name] = spans;
    const start = Number(time[1]);
    if (!name) throw new Error(`video: the chapter at ${start}s has no title`);
    // The visible label and data-time must agree, otherwise the page itself is wrong.
    if (label !== formatTimestamp(start)) throw new Error(`video: chapter "${name}" shows ${label} but data-time=${start} is ${formatTimestamp(start)}`);
    chapters.push({ name, start });
  }
  return chapters;
}

/**
 * YouTube only turns a description into chapters when: the first timestamp is 0:00, there are at least
 * three of them, they ascend, and each chapter lasts at least 10 seconds. Offsets are completed here:
 * each chapter ends where the next starts, the last one at the video duration.
 */
export function withChapterEnds(chapters, durationSeconds) {
  if (!Number.isInteger(durationSeconds) || durationSeconds <= 0) throw new Error("video: durationSeconds must be a positive integer");
  if (chapters.length < 3) throw new Error(`video: YouTube needs at least 3 chapters (found ${chapters.length})`);
  if (chapters[0].start !== 0) throw new Error("video: the first chapter must start at 00:00");
  return chapters.map((c, i) => {
    const end = i + 1 < chapters.length ? chapters[i + 1].start : durationSeconds;
    if (end <= c.start) throw new Error(`video: chapter "${c.name}" (${c.start}s) must end after it starts: chapters must ascend and stay inside the ${durationSeconds}s duration`);
    if (end - c.start < 10) throw new Error(`video: chapter "${c.name}" lasts ${end - c.start}s; YouTube needs at least 10s`);
    return { ...c, end };
  });
}

/** Finds the video card of `cfg.id` and returns what the JSON-LD and the YouTube description are built from. */
export function readVideo(meta, body) {
  const cfg = meta.video;
  if (!cfg) return null;
  for (const key of ["id", "uploadDate", "durationSeconds"]) if (cfg[key] === undefined) throw new Error(`video: front matter "video.${key}" is missing`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cfg.uploadDate)) throw new Error('video: "uploadDate" must be YYYY-MM-DD');
  const cards = body.match(/<article class="doc-video-card"[\s\S]*?<\/article>/g) || [];
  const card = cards.find((c) => c.includes(`/embed/${cfg.id}`));
  if (!card) throw new Error(`video: no .doc-video-card embeds ${cfg.id}`);
  const chapters = withChapterEnds(parseVideoChapters(card), cfg.durationSeconds);
  const name = stripTags((card.match(/<h[23]>([\s\S]*?)<\/h[23]>/) || [])[1] || "");
  const description = stripTags((card.match(/<p class="doc-video-card__desc">([\s\S]*?)<\/p>/) || [])[1] || "").replace(/\s*[:：]$/, ".");
  if (!name || !description) throw new Error("video: the card needs a title and a .doc-video-card__desc");
  return { id: cfg.id, uploadDate: cfg.uploadDate, durationSeconds: cfg.durationSeconds, name, description, chapters };
}

/** schema.org VideoObject with one Clip per chapter chip (Google "key moments"), built from the page so it cannot drift. */
export function buildVideoObject(meta, body) {
  const v = readVideo(meta, body);
  if (!v) return null;
  return {
    "@context": "https://schema.org",
    "@type": "VideoObject",
    name: v.name,
    description: v.description,
    inLanguage: "ar",
    thumbnailUrl: [`https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`],
    uploadDate: v.uploadDate,
    duration: isoDuration(v.durationSeconds),
    contentUrl: `https://www.youtube.com/watch?v=${v.id}`,
    embedUrl: `https://www.youtube.com/embed/${v.id}`,
    hasPart: v.chapters.map((c) => ({
      "@type": "Clip",
      name: c.name,
      startOffset: c.start,
      endOffset: c.end,
      url: `https://youtu.be/${v.id}?t=${c.start}`,
    })),
  };
}

/** The same chapters as plain text for the YouTube description: `00:00 Title`, one per line. */
export function youtubeChapterBlock(meta, body) {
  const v = readVideo(meta, body);
  if (!v) return null;
  return v.chapters.map((c) => `${formatTimestamp(c.start)} ${c.name}`).join("\n");
}

async function loadNav() {
  return import(pathToFileURL(path.join(PUBLIC, "src/features/documents/docs-nav.js")).href);
}

function nextGuideHtml(slug, nav) {
  if (slug === "docs") return "";
  if (!nav.GUIDE_ORDER.includes(`/${slug}`)) return "";
  return `            <nav class="doc-back-hub" aria-label="مركز الأدلة والمساعدة">
                <a class="doc-back-hub__card" href="/docs">
                    <div class="doc-back-hub__icon" aria-hidden="true">
                        <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
                            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
                        </svg>
                    </div>
                    <div class="doc-back-hub__body">
                        <span class="doc-back-hub__label">مركز الأدلة والمساعدة</span>
                        <strong class="doc-back-hub__title">العودة إلى فهرس الأدلة والمستندات</strong>
                        <p class="doc-back-hub__desc">استعرض جميع أدلة الطلاب، وصنّاع المحتوى، والمشرفين، والربط بالذكاء الاصطناعي</p>
                    </div>
                    <div class="doc-back-hub__action" aria-hidden="true">
                        <span class="doc-back-hub__btn">تصفح الأدلة</span>
                        <svg class="doc-back-hub__arrow" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="m15 18-6-6 6-6"/>
                        </svg>
                    </div>
                </a>
            </nav>`;
}

export async function buildAll({ write = true } = {}) {
  const nav = await loadNav();
  const footer = fs.readFileSync(path.join(SRC, "shells/_legal-footer.html"), "utf8").replace(/\s+$/, "");
  const headTpl = fs.readFileSync(path.join(SRC, "shells/_head.html"), "utf8");
  const results = [];

  for (const file of fs.readdirSync(path.join(SRC, "pages")).filter((f) => f.endsWith(".html")).sort()) {
    const slug = file.replace(/\.html$/, "");
    const source = fs.readFileSync(path.join(SRC, "pages", file), "utf8");
    const { meta, body } = parsePage(source, file);
    const eol = source.includes("\r\n") ? "\r\n" : "\n";
    const shellTpl = fs.readFileSync(path.join(SRC, "shells", `${meta.shell}.html`), "utf8");

    const extraStyles = (meta.styles || [])
      .filter((s) => !BASE_STYLES.has(s))
      .map((s) => `    <link rel="stylesheet" href="${s}" />\n`)
      .join("");
    const url = `${ORIGIN}/${slug}`;
    // HowTo first (tests and crawlers read the first block), then the VideoObject when the page has a video.
    const jsonLd = [meta.jsonLd || buildHowTo(meta, body, url), buildVideoObject(meta, body)]
      .filter(Boolean)
      .map((ld) => `    <script type="application/ld+json">\n${JSON.stringify(ld, null, 2).replace(/</g, "\\u003c")}\n    </script>\n`)
      .join("");
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
    }).replace(/\n{3,}/g, "\n\n").replace(/\r?\n/g, eol);

    const out = path.join(PUBLIC, `${slug}.html`);
    const current = fs.existsSync(out) ? fs.readFileSync(out, "utf8") : null;
    results.push({ slug, out, html, stale: current !== html });
    if (write && current !== html) fs.writeFileSync(out, html);
  }
  return results;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv.includes("--chapters")) {
  const arg = process.argv[process.argv.indexOf("--chapters") + 1];
  const slug = arg && !arg.startsWith("--") ? arg : "how-to-connect-mcp";
  const { meta, body } = parsePage(fs.readFileSync(path.join(SRC, "pages", `${slug}.html`), "utf8"), `${slug}.html`);
  const block = youtubeChapterBlock(meta, body);
  if (!block) {
    console.error(`${slug}: no "video" in the front matter`);
    process.exit(1);
  }
  console.log(block);
} else if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
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
