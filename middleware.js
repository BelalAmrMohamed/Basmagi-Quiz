// middleware.js  (project root, next to vercel.json)
//
// Injects a per-quiz og:title / og:description (+ matching <title>,
// description, and twitter:* tags) into quiz.html — but ONLY for requests
// from link-preview crawlers (WhatsApp, Telegram, Facebook, X/Twitter,
// Discord, Slack, LinkedIn, Googlebot, ...) that include a `?id=` param.
//
// Every other request — i.e. essentially all real human visitors — is
// passed straight through untouched, with zero added latency. quiz.js
// already sets document.title client-side for real users, and the static
// defaults already baked into quiz.html are correct as-is when there's no
// `id` in the URL. This file only fixes what real users never see anyway:
// the preview a crawler builds *before* any JavaScript would run.
//
// ─── Architecture ────────────────────────────────────────────────────────────
// Meta is resolved in two parallel fetches:
//   1. /data/quiz-manifest.json  — static, always available, fast (CDN-cached)
//   2. /api/quiz-manifest        — DB-hosted quizzes via Supabase
//
// Both manifests share the same shape:
//   { subjects: [ { quizzes: [ { id, title, questionCount, questionTypes,
//                                description? } ] } ] }
//
// All the data we need (title, questionCount, questionTypes, description) is
// already embedded in the manifest entries — no secondary fetch to the
// individual quiz JSON is ever required. This keeps bot-facing latency low.
//
// The edge-cached response (s-maxage=3600) means repeat scrapes of the same
// shared link (common on Telegram/Slack) are served instantly.
// ─────────────────────────────────────────────────────────────────────────────

export const config = {
  matcher: "/quiz.html",
};

const STATIC_MANIFEST_PATH = "/data/quiz-manifest.json";
const DB_MANIFEST_PATH = "/api/quiz-manifest";

// Covers the major link-unfurling bots + search crawlers. Add more if you
// notice a platform's preview isn't picking up the dynamic tags — check the
// User-Agent it sent (e.g. via your server logs) and extend this list.
const BOT_UA_REGEX =
  /facebookexternalhit|Facebot|Twitterbot|Slackbot|TelegramBot|Discordbot|LinkedInBot|WhatsApp|SkypeUriPreview|redditbot|Pinterest|vkShare|Viber|Line\/|Iframely|W3C_Validator|Googlebot|Bingbot|Applebot|Yandex/i;

// Prevents this middleware from re-triggering itself when it fetches its
// own quiz.html template below (that internal fetch also hits /quiz.html).
const BYPASS_HEADER = "x-quiz-meta-bypass";

export default async function middleware(request) {
  if (request.headers.get(BYPASS_HEADER)) return; // internal fetch, let it pass through raw

  const ua = request.headers.get("user-agent") || "";
  const url = new URL(request.url);
  const id = url.searchParams.get("id");

  // No id → quiz.html's baked-in defaults are already correct.
  // Not a known crawler → real visitor, let quiz.js handle it client-side.
  if (!id || !BOT_UA_REGEX.test(ua)) return;

  try {
    const meta = await withTimeout(resolveQuizMeta(id, url.origin), 2500);
    if (!meta) return; // not found / lookup too slow → serve defaults, don't hang the crawler

    const templateRes = await fetch(new URL("/quiz.html", url.origin), {
      headers: { [BYPASS_HEADER]: "1" },
    });
    if (!templateRes.ok) return;

    const html = injectMeta(await templateRes.text(), meta, url);

    return new Response(html, {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        // Cache the *bot-facing* response at the edge so repeat scrapes of
        // the same link (Facebook/Slack/Telegram often re-check a link
        // multiple times) are served instantly instead of re-doing the
        // manifest lookups every time.
        "cache-control": "public, s-maxage=3600, stale-while-revalidate=86400",
      },
    });
  } catch (err) {
    console.error("[quiz-meta middleware] falling back to defaults:", err);
    return; // never break the page over a meta-tag lookup failure
  }
}

// === Data lookup ============================================================

/**
 * Fetches both manifests in parallel and searches for the quiz by ID.
 * Returns a meta object with title, description, questionCount, and
 * questionTypes — all sourced directly from the manifest entry, with no
 * secondary fetch to the individual quiz JSON.
 *
 * @param {string} id   - The quiz ID from the URL's `?id=` param.
 * @param {string} origin - The request origin (e.g. "https://basmagi-quiz.vercel.app").
 * @returns {Promise<{title:string, description:string|null, questionCount:number|null, questionTypes:string|null}|null>}
 */
async function resolveQuizMeta(id, origin) {
  // Run both manifest fetches in parallel — static CDN file + DB API.
  const [staticResult, dbResult] = await Promise.allSettled([
    fetch(new URL(STATIC_MANIFEST_PATH, origin)).then((r) =>
      r.ok ? r.json() : Promise.reject(new Error(`Static manifest ${r.status}`)),
    ),
    fetch(new URL(DB_MANIFEST_PATH, origin)).then((r) =>
      r.ok ? r.json() : Promise.reject(new Error(`DB manifest ${r.status}`)),
    ),
  ]);

  if (staticResult.status === "rejected") {
    console.warn("[quiz-meta middleware] Static manifest unavailable:", staticResult.reason);
  }
  if (dbResult.status === "rejected") {
    console.warn("[quiz-meta middleware] DB manifest unavailable:", dbResult.reason);
  }

  // Search static manifest first, then DB manifest.
  const manifests = [
    staticResult.status === "fulfilled" ? staticResult.value : null,
    dbResult.status === "fulfilled" ? dbResult.value : null,
  ];

  for (const manifest of manifests) {
    if (!manifest) continue;
    const entry = findQuizInManifest(manifest, id);
    if (entry) return buildMeta(entry);
  }

  return null; // quiz not found in either manifest
}

/**
 * Walks a manifest's subjects[].quizzes[] tree and returns the quiz entry
 * matching the given ID, or null if not found.
 *
 * Handles both manifest shapes:
 *   { subjects: [...] }          ← new shape (both static + DB manifests)
 *   [ ... ]                      ← legacy flat array (unlikely, but safe)
 *
 * @param {object|Array} manifest
 * @param {string} id
 * @returns {object|null}
 */
function findQuizInManifest(manifest, id) {
  const subjects = Array.isArray(manifest)
    ? manifest              // legacy: bare array of subjects
    : manifest.subjects;    // current shape

  if (!Array.isArray(subjects)) return null;

  for (const subject of subjects) {
    const quizzes = subject.quizzes;
    if (!Array.isArray(quizzes)) continue;
    const found = quizzes.find((q) => q.id === id);
    if (found) return found;
  }

  return null;
}

/**
 * Maps a manifest quiz entry to the meta object used by buildTitle() and
 * injectMeta(). All fields are already present in the manifest — no extra
 * fetch is needed.
 *
 * @param {object} entry - A quiz entry from subjects[].quizzes[].
 * @returns {{ title: string, description: string|null, questionCount: number|null, questionTypes: string|null }}
 */
function buildMeta(entry) {
  return {
    title: entry.title || entry.id,
    description: entry.description || null,
    questionCount: entry.questionCount != null ? entry.questionCount : null,
    questionTypes: formatQuestionTypes(entry.questionTypes),
  };
}

// === Helpers =================================================================

/**
 * Normalises stats.questionTypes (or a manifest's questionTypes field) into a
 * display string, e.g. "MCQ · Essay". Returns null when absent or empty.
 * Mirrors the same helper in quiz.js — kept in sync intentionally.
 *
 * @param {string|string[]|null|undefined} qt
 * @returns {string|null}
 */
function formatQuestionTypes(qt) {
  if (!qt) return null;
  if (Array.isArray(qt)) return qt.length ? qt.join(" · ") : null;
  return String(qt) || null;
}

/**
 * Wraps a promise with a hard timeout. Rejects with a timeout error when the
 * deadline elapses first. Used to guarantee the middleware never blocks a
 * crawler for more than `ms` milliseconds.
 *
 * @param {Promise<T>} promise
 * @param {number} ms - Milliseconds before the timeout fires.
 * @returns {Promise<T>}
 */
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms),
    ),
  ]);
}

// === Title formatting ========================================================
// "{quiz title}: {N} سؤال، {questionTypes}"
// e.g. "قواعد اللغة الإنجليزية: 20 سؤال، اختيار من متعدد"
// Falls back gracefully when questionCount / questionTypes are not available.

function buildTitle(meta) {
  const parts = [];
  if (meta.questionCount != null) parts.push(`${meta.questionCount} سؤال`);
  if (meta.questionTypes) parts.push(meta.questionTypes);
  return parts.length ? `${meta.title}: ${parts.join("، ")}` : meta.title;
}

// === HTML injection ==========================================================

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Finds a <meta ...> tag by one of its attributes (name= or property=) and
// replaces its content="..." value, regardless of attribute order.
function replaceMetaTag(html, attr, value, newContent) {
  const tagRe = new RegExp(`<meta[^>]*\\b${attr}=["']${value}["'][^>]*>`, "i");
  return html.replace(tagRe, (tag) =>
    /content=["'][^"']*["']/i.test(tag)
      ? tag.replace(/content=["'][^"']*["']/i, `content="${escapeHtml(newContent)}"`)
      : tag,
  );
}

function injectMeta(html, meta, url) {
  const title = buildTitle(meta);
  const description = meta.description;

  html = html.replace(/<title>[^<]*<\/title>/i, `<title>${escapeHtml(title)}</title>`);
  html = replaceMetaTag(html, "property", "og:title", title);
  html = replaceMetaTag(html, "property", "og:url", url.href);
  html = replaceMetaTag(html, "name", "twitter:title", title);
  html = replaceMetaTag(html, "name", "twitter:image:alt", title);

  // Only touch description-related tags if the quiz actually has one —
  // otherwise leave the existing defaults in place, same as the "no id"
  // case requires.
  if (description) {
    html = replaceMetaTag(html, "name", "description", description);
    html = replaceMetaTag(html, "property", "og:description", description);
    html = replaceMetaTag(html, "name", "twitter:description", description);
  }

  return html;
}
