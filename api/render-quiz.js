// =============================================================================
// api/render-quiz.js
//
// Serverless function (Node.js runtime) that handles all requests to /q/:id.
//
// What it does:
//   1. Reads the quiz ID from ?id= (injected by the vercel.json rewrite rule).
//   2. Fetches quiz metadata from Supabase via @supabase/supabase-js (HTTP/
//      PostgREST — never a raw pg TCP connection, safe on the free tier).
//   3. Reads the raw public/quiz.html template from disk.
//   4. Injects server-side OG meta tags so scrapers see them in the raw HTML.
//   5. Injects a <meta name="quiz:id"> data island for quiz.js to hydrate from.
//   6. Returns the modified HTML with edge-cache headers.
//
// URL contract:
//   /q/QUIZ_ID  →  (vercel.json rewrite)  →  /api/render-quiz?id=QUIZ_ID
//   Browser URL stays /q/QUIZ_ID. quiz.js reads the ID from <meta name="quiz:id">.
// =============================================================================

import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";

// ── Supabase client ──────────────────────────────────────────────────────────
// Uses the anon key — the quizzes table should allow public SELECT via RLS.
// If your RLS policy blocks anon reads, swap to SUPABASE_SERVICE_KEY.
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
);

// ── quiz.html template path ──────────────────────────────────────────────────
// Vercel sets process.cwd() to the project root. The static outputDirectory is
// "public", so quiz.html lives at <root>/public/quiz.html.
const TEMPLATE_PATH = path.join(process.cwd(), "public", "quiz.html");

// ── OG image version bump ────────────────────────────────────────────────────
// Increment this when you change the /api/og layout to bust Telegram's cache.
const OG_IMAGE_VERSION = 1;

// ── Canonical site origin ────────────────────────────────────────────────────
const SITE_ORIGIN = "https://basmagi-quiz.vercel.app";

// =============================================================================
// Handler
// =============================================================================
export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return res.status(405).end();
  }

  const id = req.query.id;

  if (!id || typeof id !== "string" || id.trim() === "") {
    // No quiz ID → redirect to the homepage so users aren't left on a blank page.
    return res.redirect(302, "/");
  }

  const quizId = id.trim();

  // ── 1. Fetch quiz metadata from Supabase ──────────────────────────────────
  let meta = null;
  try {
    meta = await fetchQuizMeta(quizId);
  } catch (err) {
    console.error("[render-quiz] Supabase lookup failed:", err);
    // Fall through with null meta — we'll still serve the page with defaults.
  }

  // ── 2. Read HTML template ─────────────────────────────────────────────────
  let html;
  try {
    html = fs.readFileSync(TEMPLATE_PATH, "utf8");
  } catch (err) {
    console.error("[render-quiz] Could not read quiz.html:", err);
    return res.status(500).send("Internal Server Error");
  }

  // ── 3. Inject quiz ID meta island (always — quiz.js reads this) ───────────
  // Inserted right before </head> so it is available synchronously.
  html = html.replace(
    "</head>",
    `  <meta name="quiz:id" content="${escapeHtml(quizId)}">\n</head>`,
  );

  // ── 4. Inject OG / title tags if we have metadata ────────────────────────
  if (meta) {
    const title = buildTitle(meta);
    const description = meta.description || "";
    const canonicalUrl = `${SITE_ORIGIN}/q/${encodeURIComponent(quizId)}`;
    const ogImageUrl = `${SITE_ORIGIN}/api/og?quizId=${encodeURIComponent(quizId)}&v=${OG_IMAGE_VERSION}`;

    // <title>
    html = html.replace(
      /<title>[^<]*<\/title>/i,
      `<title>${escapeHtml(title)}</title>`,
    );

    // canonical
    html = replaceLinkHref(html, "canonical", canonicalUrl);

    // Open Graph
    html = replaceMetaContent(html, "property", "og:title", title);
    html = replaceMetaContent(html, "property", "og:url", canonicalUrl);
    html = replaceMetaContent(html, "property", "og:image", ogImageUrl);
    if (description) {
      html = replaceMetaContent(html, "property", "og:description", description);
    }

    // Twitter
    html = replaceMetaContent(html, "name", "twitter:title", title);
    html = replaceMetaContent(html, "name", "twitter:image", ogImageUrl);
    html = replaceMetaContent(html, "name", "twitter:image:alt", title);
    if (description) {
      html = replaceMetaContent(html, "name", "twitter:description", description);
    }

    // Standard description
    if (description) {
      html = replaceMetaContent(html, "name", "description", description);
    }
  }

  // ── 5. Respond ────────────────────────────────────────────────────────────
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  if (meta) {
    // Metadata injection succeeded — safe to cache at the edge for 1 hour,
    // serving stale for up to 24 h while revalidating in the background.
    res.setHeader(
      "Cache-Control",
      "public, s-maxage=3600, stale-while-revalidate=86400",
    );
  } else {
    // No metadata (Supabase miss/error) — this response only has default
    // OG tags. Never cache it, so the next request (including the next
    // scraper hit) gets a fresh attempt instead of the fallback being
    // baked into the CDN for up to a day.
    res.setHeader("Cache-Control", "no-store");
  }
  return res.status(200).send(html);
}

// =============================================================================
// Data fetching
// =============================================================================

/**
 * Fetches quiz metadata from Supabase.
 * The `data` JSONB column contains:
 *   { meta: { id, title, description, … }, stats: { questionCount, questionTypes, … } }
 *
 * @param {string} quizId - The 8-char base32 quiz ID.
 * @returns {Promise<{title:string, description:string|null, questionCount:number|null, questionTypes:string|null}|null>}
 */
async function fetchQuizMeta(quizId) {
  // The quiz ID is stored inside the JSONB column: data->meta->>'id'
  const { data, error } = await supabase
    .from("quizzes")
    .select("data, title")
    .filter("data->meta->>id", "eq", quizId)
    .limit(1)
    .maybeSingle();

  // TEMP DIAGNOSTIC — remove once root cause of the OG bug is confirmed.
  console.log(
    "[render-quiz][debug] quizId:", quizId,
    "error:", error ? JSON.stringify(error) : null,
    "data:", JSON.stringify(data),
  );

  if (error) {
    console.error("[render-quiz] Supabase error:", error.message);
    return null;
  }

  if (!data) return null;

  const quizMeta = data.data?.meta || {};
  const quizStats = data.data?.stats || {};

  return {
    title: quizMeta.title || data.title || quizId,
    description: quizMeta.description || null,
    questionCount: quizStats.questionCount != null ? quizStats.questionCount : null,
    questionTypes: formatQuestionTypes(quizStats.questionTypes),
  };
}

// =============================================================================
// Title formatting
// =============================================================================

/**
 * Formats the page title.
 * Example (Arabic):  "قواعد اللغة: 20 سؤال (اختيار من متعدد)"
 * Example (English): "Calculus Midterm: 15 Questions (MCQ)"
 */
function buildTitle(meta) {
  if (!meta?.title) return "";
  const firstLetterMatch = meta.title.match(/\p{L}/u);
  const isArabic =
    firstLetterMatch &&
    /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(firstLetterMatch[0]);
  const label = isArabic ? "سؤال" : "Questions";

  let details = "";
  if (meta.questionCount != null) {
    details = `${meta.questionCount} ${label}`;
    if (meta.questionTypes) {
      details += ` (${meta.questionTypes})`;
    }
  } else if (meta.questionTypes) {
    details = meta.questionTypes;
  }

  return details ? `${meta.title}: ${details}` : meta.title;
}

// =============================================================================
// HTML helpers
// =============================================================================

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Finds a <meta attr="value"> tag and replaces its content="…" value.
 * Attribute order in the tag does not matter.
 */
function replaceMetaContent(html, attr, value, newContent) {
  const tagRe = new RegExp(
    `<meta[^>]*\\b${attr}=["']${escapeRegex(value)}["'][^>]*>`,
    "i",
  );
  return html.replace(tagRe, (tag) => {
    if (/content=["'][^"']*["']/i.test(tag)) {
      return tag.replace(
        /content=["'][^"']*["']/i,
        `content="${escapeHtml(newContent)}"`,
      );
    }
    return tag;
  });
}

/**
 * Finds a <link rel="canonical"> and replaces its href.
 */
function replaceLinkHref(html, rel, newHref) {
  const tagRe = new RegExp(
    `<link[^>]*\\brel=["']${escapeRegex(rel)}["'][^>]*>`,
    "i",
  );
  return html.replace(tagRe, (tag) => {
    if (/href=["'][^"']*["']/i.test(tag)) {
      return tag.replace(
        /href=["'][^"']*["']/i,
        `href="${escapeHtml(newHref)}"`,
      );
    }
    return tag;
  });
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatQuestionTypes(qt) {
  if (!qt) return null;
  if (Array.isArray(qt)) return qt.length ? qt.join(" · ") : null;
  return String(qt) || null;
}