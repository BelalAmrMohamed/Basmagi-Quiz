// =============================================================================
// api/og.js
//
// Vercel Edge Function — generates dynamic 1200×630 OG thumbnail images for
// quiz link previews. Powered by @vercel/og (Satori + WebAssembly PNG encoder).
//
// Usage:  /api/og?quizId=ABCD1234
// Cache:  Immutable 1-year CDN cache. Bust via ?v=N param from render-quiz.js.
//
// No JSX transpiler — uses plain ReactElement-style objects that Satori accepts.
// No raw pg driver — fetches quiz metadata via Supabase REST API over HTTP.
//
// Background: static template PNG at
//   public/assets/images/thumbnails/quiz-thumbnail-customizable.png
// // // One thing to double check on your end: the public/assets/images/thumbnails/... path you gave becomes /assets/images/thumbnails/... when served statically — confirm that matches your actual static file serving setup (Vercel serves public/ at root), otherwise adjust BACKGROUND_IMAGE_URL.
// Title + details text is layered on top of it, positioned in the right-hand
// column between the URL pill and the "ابدأ الامتحان" button baked into the PNG.
// =============================================================================

import { ImageResponse } from "@vercel/og";

export const config = { runtime: "edge" };

// ── Supabase REST config (Edge-safe, no supabase-js needed) ──────────────────
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

// ── Brand constants ──────────────────────────────────────────────────────────
const BRAND_BLUE = "#0088cc";

const SITE_ORIGIN = process.env.SITE_ORIGIN
  || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://basmagi-quiz.vercel.app");

const BACKGROUND_IMAGE_URL = `${SITE_ORIGIN}/assets/images/thumbnails/quiz-thumbnail-customizable.png`;

// ── Local quiz manifest (relative-path quizzes) ──────────────────────────────
// Relative-path quizzes are never written to Supabase — their metadata lives
// only in this static file. Edge runtime has no `fs`, so fetch it over HTTP
// the same way the background image and font are fetched. Served from
// public/data/quiz-manifest.json (see render-quiz.js for the disk-side path).
const MANIFEST_URL = `${SITE_ORIGIN}/data/quiz-manifest.json`;

// ── Text column geometry ──────────────────────────────────────────────────────
// Measured against the 1200×630 background PNG:
//   URL pill:  x 545–814,  y 147–189
//   Button:    x 529–743,  y 378–462
//   Bulb card: ends around x 407
// The safe column below avoids the bulb graphic on the left and sits in the
// gap between the pill and the button.
const TEXT_COLUMN = {
  left: 500,
  right: 1140,
  top: 210,
  bottom: 360,
};
const TEXT_COLUMN_WIDTH = TEXT_COLUMN.right - TEXT_COLUMN.left; // 640
const TEXT_COLUMN_HEIGHT = TEXT_COLUMN.bottom - TEXT_COLUMN.top; // 150

// Max characters before we truncate the title with an ellipsis (after shrinking
// the font still isn't enough to guarantee it fits the column width).
const TITLE_MAX_CHARS = 60;

// ── Question type translation (Arabic) ────────────────────────────────────────
// The quiz-scanning script (see inferQuestionType) always emits these exact,
// case-sensitive English labels. We translate them for display only.
const QUESTION_TYPE_AR = {
  "MCQ": "إختياري",
  "Essay": "مقالي",
  "True/False": "صح/خطأ",
};

/**
 * Translates a questionTypes string (already joined with " · ") into Arabic
 * when isArabic is true, by exact-matching each known English label.
 * Order and separators are preserved; unrecognized labels pass through as-is.
 */
function translateQuestionTypes(questionTypesStr, isArabic) {
  if (!questionTypesStr || !isArabic) return questionTypesStr;
  return questionTypesStr
    .split(" · ")
    .map((part) => QUESTION_TYPE_AR[part] || part)
    .join(" · ");
}

// ── Font cache (survives across warm invocations) ────────────────────────────
let _fontDataPromise = null;

/**
 * Fetches the Tajawal Bold woff2 font from Google Fonts.
 * Result is cached at module level so warm Edge invocations skip the fetch.
 */
function loadFont() {
  if (_fontDataPromise) return _fontDataPromise;
  _fontDataPromise = (async () => {
    // Request CSS with a desktop user-agent so Google returns woff2 format.
    const cssRes = await fetch(
      "https://fonts.googleapis.com/css2?family=Tajawal:wght@400;700&display=swap",
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      },
    );
    const css = await cssRes.text();

    // Extract the woff2 URL for weight 700 (bold).
    // The CSS contains multiple @font-face blocks; grab the one for 700.
    const bold700Block = css.split("@font-face").find((block) =>
      block.includes("font-weight: 700"),
    );
    const fontUrl = (bold700Block || css).match(
      /src:\s*url\(([^)]+\.woff2[^)]*)\)/,
    )?.[1];

    if (!fontUrl) {
      throw new Error("[og] Could not extract Tajawal woff2 URL from CSS");
    }

    const fontRes = await fetch(fontUrl);
    return fontRes.arrayBuffer();
  })();
  return _fontDataPromise;
}

// =============================================================================
// Handler
// =============================================================================
export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const quizId = searchParams.get("quizId");

  // ── 1. Fetch external assets in parallel ─────────────────────────────────
  const [fontData, quizData, bgImageArrayBuffer, manifestData] = await Promise.all([
    loadFont(),
    quizId ? fetchQuizMeta(quizId) : null,
    fetch(BACKGROUND_IMAGE_URL).then((res) => {
      if (!res.ok) throw new Error(`Failed to load background image: ${res.status}`);
      return res.arrayBuffer();
    }).catch(err => {
      console.error("[og] bg image fetch error:", err);
      return null;
    }),
    quizId ? fetchManifest() : null,
  ]);

  // Supabase only holds DB-uploaded quizzes. A miss there is expected and
  // normal for relative-path quizzes — fall back to the local manifest
  // before giving up and using generic defaults.
  const meta = quizData || (manifestData ? findQuizInManifest(manifestData, quizId) : null);

  // ── 2. Build display strings ──────────────────────────────────────────────
  const rawTitle = meta ? (meta.title || quizId || "إمتحان") : "منصة إمتحانات بصمجي";
  const isArabic = detectArabic(rawTitle);
  const title = truncateTitle(rawTitle);
  const details = meta ? buildDetails(meta, isArabic) : "";

  // Shrink font further as either the title or the column gets tighter.
  const titleFontSize = title.length > 40 ? "38px" : title.length > 25 ? "46px" : "54px";

  // Build Base64 background image
  const bgImageBase64 = bgImageArrayBuffer
    ? `url(data:image/png;base64,${Buffer.from(bgImageArrayBuffer).toString("base64")})`
    : `none`;

  // ── 3. Build image element (plain objects — no JSX) ───────────────────────
  const element = {
    type: "div",
    props: {
      style: {
        display: "flex",
        width: "100%",
        height: "100%",
        position: "relative",
        fontFamily: "Tajawal",
        backgroundImage: bgImageBase64,
        backgroundSize: "1200px 630px",
        backgroundRepeat: "no-repeat",
        backgroundColor: "#0f172a", // Fallback color
      },
      children: [
        // ── Text column, absolutely positioned over the background ───────
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              position: "absolute",
              left: `${TEXT_COLUMN.left}px`,
              top: `${TEXT_COLUMN.top}px`,
              width: `${TEXT_COLUMN_WIDTH}px`,
              height: `${TEXT_COLUMN_HEIGHT}px`,
              textAlign: "center",
              gap: "14px",
            },
            children: [
              // ── Title ──────────────────────────────────────────────────
              {
                type: "div",
                props: {
                  style: {
                    display: "flex",
                    fontSize: titleFontSize,
                    fontWeight: "700",
                    color: "#111827",
                    lineHeight: "1.3",
                    textAlign: "center",
                    direction: isArabic ? "rtl" : "ltr",
                    width: "100%",
                    wordBreak: "break-word",
                    justifyContent: "center",
                  },
                  children: title,
                },
              },

              // ── Details badge ─────────────────────────────────────────
              details
                ? {
                    type: "div",
                    props: {
                      style: {
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                        background: "rgba(0,136,204,0.12)",
                        border: `1px solid rgba(0,136,204,0.3)`,
                        borderRadius: "10px",
                        padding: "8px 22px",
                        fontSize: "20px",
                        color: BRAND_BLUE,
                        fontWeight: "700",
                        direction: isArabic ? "rtl" : "ltr",
                      },
                      children: details,
                    },
                  }
                : null,
            ].filter(Boolean),
          },
        },
      ],
    },
  };

  // ── 4. Return ImageResponse ───────────────────────────────────────────────
  return new ImageResponse(element, {
    width: 1200,
    height: 630,
    fonts: [
      {
        name: "Tajawal",
        data: fontData,
        weight: 700,
        style: "normal",
      },
    ],
    headers: {
      "Cache-Control":
        "public, immutable, no-transform, max-age=31536000, s-maxage=31536000",
    },
  });
}

// =============================================================================
// Data fetching (Edge-safe — raw fetch against Supabase REST API)
// =============================================================================

/**
 * Fetches quiz metadata via the Supabase PostgREST HTTP API.
 * Uses only `fetch` — fully Edge-compatible, zero TCP connections.
 *
 * @param {string} quizId
 * @returns {Promise<{title:string, description:string|null, questionCount:number|null, questionTypes:string|null}|null>}
 */
async function fetchQuizMeta(quizId) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error("[og] Missing SUPABASE_URL or SUPABASE_ANON_KEY");
    return null;
  }

  try {
    // PostgREST filter: data->meta->>id = quizId
    const url = new URL(`${SUPABASE_URL}/rest/v1/quizzes`);
    url.searchParams.set("select", "data,title");
    url.searchParams.set("data->meta->>id", `eq.${quizId}`);
    url.searchParams.set("limit", "1");

    const res = await fetch(url.toString(), {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    });

    if (!res.ok) {
      console.error(`[og] Supabase returned ${res.status}`);
      return null;
    }

    const rows = await res.json();
    if (!rows || rows.length === 0) return null;

    const row = rows[0];
    const quizMeta = row.data?.meta || {};
    const quizStats = row.data?.stats || {};

    return {
      title: quizMeta.title || row.title || quizId,
      description: quizMeta.description || null,
      questionCount:
        quizStats.questionCount != null ? quizStats.questionCount : null,
      // Kept as the raw, untranslated English string (e.g. "MCQ · Essay").
      // Translation happens later in buildDetails, once we know the title's
      // language, since that's what currently drives RTL/label selection.
      questionTypes: formatQuestionTypes(quizStats.questionTypes),
    };
  } catch (err) {
    console.error("[og] fetchQuizMeta error:", err);
    return null;
  }
}

// ── Manifest cache (survives across warm invocations) ────────────────────────
let _manifestPromise = null;

/**
 * Fetches quiz-manifest.json — the source of truth for relative-path quizzes,
 * which are never written to Supabase. Cached at module level like loadFont(),
 * since the manifest only changes on deploy.
 *
 * @returns {Promise<{subjects: Array}|null>}
 */
function fetchManifest() {
  if (_manifestPromise) return _manifestPromise;
  _manifestPromise = fetch(MANIFEST_URL)
    .then((res) => {
      if (!res.ok) throw new Error(`Manifest fetch failed: ${res.status}`);
      return res.json();
    })
    .catch((err) => {
      console.error("[og] fetchManifest error:", err);
      _manifestPromise = null; // allow retry on next request rather than caching a failure
      return null;
    });
  return _manifestPromise;
}

/**
 * Finds a quiz entry by ID across all subjects in the manifest and shapes it
 * to match fetchQuizMeta's return shape.
 *
 * @param {{subjects: Array}} manifest
 * @param {string} quizId
 * @returns {{title:string, description:string|null, questionCount:number|null, questionTypes:string|null}|null}
 */
function findQuizInManifest(manifest, quizId) {
  for (const subject of manifest.subjects ?? []) {
    for (const quiz of subject.quizzes ?? []) {
      if (quiz.id === quizId) {
        return {
          title: quiz.title || quizId,
          description: quiz.description || null,
          questionCount: quiz.questionCount != null ? quiz.questionCount : null,
          questionTypes: formatQuestionTypes(quiz.questionTypes),
        };
      }
    }
  }
  return null;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Formats the detail line below the title, e.g. "20 سؤال · إختياري · مقالي"
 * (Arabic) or "20 Questions · MCQ · Essay" (English).
 *
 * questionTypes always arrives from the scanning script as exact, case-sensitive
 * English labels ("MCQ", "Essay", "True/False"), joined with " · ". When the
 * quiz title is Arabic, each recognized label is translated for display;
 * unrecognized labels are left untouched rather than dropped.
 */
function buildDetails(meta, isArabic) {
  if (!meta) return "";
  const label = isArabic ? "سؤال" : "Questions";
  const translatedTypes = translateQuestionTypes(meta.questionTypes, isArabic);

  let parts = "";
  if (meta.questionCount != null) {
    parts = `${meta.questionCount} ${label}`;
    if (translatedTypes) {
      parts += ` · ${translatedTypes}`;
    }
  } else if (translatedTypes) {
    parts = translatedTypes;
  }
  return parts;
}

/**
 * Truncates an overly long title so it can never overflow the fixed-width
 * text column or collide with the bulb graphic / button, even after the
 * font-size shrink rule in the handler.
 */
function truncateTitle(title) {
  if (!title || title.length <= TITLE_MAX_CHARS) return title;
  return title.slice(0, TITLE_MAX_CHARS - 1).trimEnd() + "…";
}

function detectArabic(text) {
  const firstLetter = text.match(/\p{L}/u);
  return (
    firstLetter &&
    /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(firstLetter[0])
  );
}

function formatQuestionTypes(qt) {
  if (!qt) return null;
  if (Array.isArray(qt)) return qt.length ? qt.join(" · ") : null;
  return String(qt) || null;
}