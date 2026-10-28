// =============================================================================
// api/og.js
//
// Vercel Edge Function — generates dynamic 1200×630 OG thumbnail images for
// quiz link previews. Powered by @vercel/og (Satori + WebAssembly PNG encoder).
//
// Usage:  /api/og?quizId=ABCD1234
//         /api/og?course=<id>[&folder=A/B]   (course / folder thumbnails)
//         /api/og?lesson=<id|slug>           (lesson thumbnails)
//         /api/og?profile=<handle>[&v=hash]  (admin profile cards — see the
//                                             "Profile OG image" section at the
//                                             bottom of this file)
// Cache:  Immutable 1-year CDN cache. Bust via ?v=N param from render-quiz.js.
//
// No JSX transpiler — uses plain ReactElement-style objects that Satori accepts.
// No raw pg driver — fetches quiz metadata via Supabase REST API over HTTP.
//
// Background: static template PNG at
//   public/assets/images/thumbnails/quiz-thumbnail-customizable.png
// Confirmed 1200×630 RGBA. Measured element bounds (via pixel scan, not
// eyeballing) on that exact file:
//   URL pill:  x 545–813,  y 148–189
//   Button:    x 534–737,  y 383–457
//   Bulb card: x 0–408,    y 25–490
// Everything below y≈490 (across the full 0–1200 width) and above y≈148 is
// empty background — used below for the course pill, description, and
// author line.
// =============================================================================

import { ImageResponse } from "@vercel/og";
import { toVisual } from "./_arabicShape.js";

export const config = { runtime: "edge" };

// ── Supabase REST config (Edge-safe, no supabase-js needed) ──────────────────
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

// ── Brand constants ──────────────────────────────────────────────────────────
const BRAND_BLUE = "#0088cc";

// IMPORTANT: VERCEL_URL is the ephemeral, deployment-specific *.vercel.app
// domain (different for every deploy), not the stable production domain.
// Depending on project settings, unauthenticated requests to that domain can
// be redirected/gated, causing internal fetch() calls below (manifest,
// background image) to silently receive an HTML page instead of the real
// asset — this is what broke the manifest fetch. Always prefer the known
// production origin; set SITE_ORIGIN as an env var if this ever needs to
// point elsewhere (e.g. a genuine staging domain).
const SITE_ORIGIN = process.env.SITE_ORIGIN || "https://basmagi-quiz.vercel.app";

const BACKGROUND_IMAGE_URL = `${SITE_ORIGIN}/assets/images/thumbnails/quiz-thumbnail-customizable.png`;

// ── Layout geometry ────────────────────────────────────────────────────────
// All measured against the real 1200×630 background PNG (see header comment).
// Right-hand content column sits between the bulb card (ends x≈408) and the
// canvas edge, avoiding the pill (y148–189) and button (y383–457).
const TEXT_COLUMN = {
  left: 500,
  right: 1140,
  top: 198,
  bottom: 360,
};
const TEXT_COLUMN_WIDTH = TEXT_COLUMN.right - TEXT_COLUMN.left; // 640

// Small relocated domain label — top-right corner, out of the way of the
// pill's old spot (which now hosts the question-count/type badge instead).
const DOMAIN_LABEL = { right: 40, top: 24 };

// Black "ابدأ الامتحان" button — pixel-measured bounds from the header
// comment (x 534–737, y 383–457). Used as the alignment anchor for the
// badge and course pill above it, so both line up on the button's own
// left edge rather than an independent column edge.
const BUTTON_ROW = { left: 534, right: 737, top: 383, bottom: 457 };

// Course-name pill — directly above the button, own row so it never
// competes with the title/description/badge stack above it. Left edge
// nudged a few px right of BUTTON_ROW.left — pixel-perfect flush-left
// looked slightly too far left visually against the button's own edge
// (per user testing), small manual offset corrects it.
const COURSE_ROW = { left: BUTTON_ROW.left + 6, right: 1140, top: 340, bottom: 372 };

// Author line — full-width footer strip below the bulb card (which ends at
// y≈490), horizontally centered on the button's own center (x≈635), not the
// canvas center, so it visually reads as "attached" to the card/button.
// Pushed down near the bottom edge (canvas height 630px) with a modest
// margin left for breathing room under the larger font size below.
const AUTHOR_ROW = { centerX: 635, top: 588 };

// Max characters before we truncate the title with an ellipsis (after shrinking
// the font still isn't enough to guarantee it fits the column width).
//
// These are NOT guesses — derived from actual glyph-advance-width metrics
// read out of the Tajawal Bold font files (measured via fonttools against
// the 640px TEXT_COLUMN_WIDTH, with a ~8% safety margin for word-boundary
// slack). Arabic glyphs in Tajawal run considerably wider per character
// than assumed in an earlier version of this file, which let titles as
// short as ~39 chars silently overflow past the column's right edge even
// at the smallest font-size tier — there was no tier small enough to
// rescue anything longer, since the tier floor was 34px (fits ~25 chars)
// while TITLE_MAX_CHARS allowed up to 60. English/Latin glyphs in Tajawal
// are narrower, so the Latin limit stays more generous.
const TITLE_MAX_CHARS_ARABIC = 34;
const TITLE_MAX_CHARS_LATIN = 55;
const DESCRIPTION_MAX_CHARS = 90;

// ── Course info fields (mirrors public/src/features/home/course-info-fields.js) ─
// This is a small server-side adapter, not a verbatim reuse: the client's
// buildCourseInfoRows() reads a tree-shaped `course` object (property
// `.faculty`) built client-side from the category tree, while this Edge
// function reads the raw Supabase `courses` row shape (`education_type`,
// `college`, `year`, `term`) fetched in fetchCourseMeta() above. The
// label set, ordering, and "hide empty" rules are kept identical to the
// client version so the OG image visually matches the in-app "معلومات
// المادة" modal.
const EDU_TYPE_AR = {
  University: "جامعي",
  High: "ثانوي",
  Middle: "إعدادي",
  Primary: "إبتدائي",
  Featured: "مادة مميزة",
};

/**
 * Builds course-info rows from the raw Supabase course fields, matching
 * buildCourseInfoRows()'s label set/ordering/omission rules, EXCEPT: for
 * "Featured" (مادة مميزة) courses, the التعليم row is omitted entirely
 * rather than shown as "التعليم: مادة مميزة" — "Featured" isn't a real
 * education-level distinction, so labeling it as one on a shareable image
 * reads as a mistake rather than useful info. (The in-app modal still
 * shows it, highlighted, since it's operating in a denser table context —
 * this is a thumbnail-specific simplification per user request, not a
 * client-side change.)
 *
 * @param {{educationType:string|null, college:string|null, year:string|null, term:string|null}} course
 * @returns {{label:string, val:string}[]}
 */
function buildCourseInfoRowsFromRow(course) {
  const rows = [];
  if (course.educationType !== "Featured") {
    rows.push({
      label: "التعليم",
      val: EDU_TYPE_AR[course.educationType] || course.educationType || "-",
    });
  }
  if (course.college && course.college !== "All") {
    rows.push({ label: "الكلية", val: course.college });
  }
  if (course.year) {
    rows.push({ label: "العام", val: course.year });
  }
  if (course.term) {
    rows.push({ label: "الترم", val: course.term });
  }
  return rows;
}

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

// ── Background image cache (survives across warm invocations) ───────────────
// Same rationale as _fontDataPromise above: BACKGROUND_IMAGE_URL is a
// single static asset (see the header comment — "static template PNG") that
// never varies per-request, yet the fetch + base64-encode of it was
// previously repeated on every single invocation of both renderers (quiz
// AND course/folder), warm or cold. A 1200×630 RGBA PNG easily runs several
// hundred KB, so that repeated fetch/encode/Satori-reparse was plausibly
// the largest single contributor to the >1s response times — far more than
// PNG vs JPEG output encoding would ever cost for an image this size (and
// @vercel/og's ImageResponse has no format option to control that anyway;
// see loadBackgroundImage()'s own doc comment). Caching this the same way
// the font is already cached should meaningfully cut warm-invocation
// latency at near-zero risk, since the asset is static by definition.
let _bgImagePromise = null;

// Family names used on the `fontFamily` CSS property throughout the layout.
// Satori resolves same-named font entries by "first one wins" for every
// glyph — it does NOT do per-character coverage fallback between entries
// sharing one name (see https://github.com/vercel/satori/issues/370). The
// correct mechanism is a CSS-style comma-separated fontFamily fallback list
// across *distinct* family names, which Satori does support and does
// correctly resolve per-glyph. Every mixed-script string in this file (e.g.
// the details badge, which combines Arabic words with digits and a "·"
// separator that only exist in the Latin subset) therefore needs the
// Latin family listed first, so Latin-only characters embedded in Arabic
// text still render instead of showing as tofu boxes.
const FONT_FAMILY_LATIN = "Tajawal-Latin";
const FONT_FAMILY_ARABIC = "Tajawal-Arabic";
const FONT_FAMILY_STACK = `${FONT_FAMILY_LATIN}, ${FONT_FAMILY_ARABIC}`;

/**
 * Fetches the Tajawal Bold TTF font(s) from Google Fonts — both the Arabic
 * and Latin unicode-range subsets, since Google serves Tajawal split into
 * multiple @font-face blocks (one per script) and a single subset only
 * covers its own glyphs. Both are returned, tagged with distinct family
 * names (see FONT_FAMILY_* above) so a single comma-separated fontFamily
 * fallback list can resolve either script — or both mixed in one string,
 * e.g. Arabic words alongside digits/punctuation — correctly per-glyph.
 *
 * Result is cached at module level so warm Edge invocations skip the fetch.
 *
 * IMPORTANT: @vercel/og's ImageResponse (Satori's font parser) does NOT
 * support WOFF2 — passing woff2 bytes throws "Unsupported OpenType
 * signature wOF2" inside ImageResponse, which is uncaught here and results
 * in a broken/empty function response (the blank-thumbnail bug). Only
 * TTF/OTF/WOFF(v1) are supported. Google Fonts picks the format to serve
 * based on User-Agent — modern browser UAs get woff2, but a legacy UA that
 * doesn't advertise woff2 support gets TTF instead. We spoof an old UA here
 * specifically to force the TTF variant.
 *
 * @returns {Promise<{name:string, data:ArrayBuffer}[]>} one entry per
 *   @font-face subset found for weight 700, tagged with its family name.
 */
function loadFont() {
  if (_fontDataPromise) return _fontDataPromise;
  _fontDataPromise = (async () => {
    // Request CSS with a legacy user-agent so Google Fonts falls back to
    // serving TTF (woff2 is unsupported by Satori's font parser).
    const cssRes = await fetch(
      "https://fonts.googleapis.com/css2?family=Tajawal:wght@400;700&display=swap",
      {
        headers: {
          // Old Android browser UA — predates woff2 support, so Google
          // Fonts' UA sniffing serves .ttf in the @font-face src instead.
          "User-Agent":
            "Mozilla/5.0 (Linux; U; Android 2.3.3; en-us; Nexus S Build/GRI40) AppleWebKit/533.1 (KHTML, like Gecko) Version/4.0 Mobile Safari/533.1",
        },
      },
    );
    const css = await cssRes.text();

    // The CSS contains one @font-face block per (weight, script) pair, each
    // with a `unicode-range` comment/descriptor we can sniff to tell Arabic
    // and Latin blocks apart. Fall back to Latin for any subset we can't
    // positively identify as Arabic (safer default — Latin covers digits/
    // punctuation needed by almost every string, including Arabic ones).
    const bold700Blocks = css
      .split("@font-face")
      .filter((block) => block.includes("font-weight: 700"));

    const entries = [];
    for (const block of bold700Blocks) {
      const fontUrl = block.match(/src:\s*url\(([^)]+\.ttf[^)]*)\)/)?.[1];
      if (!fontUrl) continue;
      const rangeMatch = block.match(/unicode-range:\s*([^;]+);/);
      const isArabicSubset = rangeMatch
        ? /U\+06[0-9A-Fa-f]{2}|U\+075|U\+08[0-9A-Fa-f]{2}|U\+FB[5-9A-Fa-f]|U\+FE7|U\+FEF/i.test(
          rangeMatch[1],
        )
        : false;
      entries.push({ url: fontUrl, isArabicSubset });
    }

    if (entries.length === 0) {
      throw new Error("[og] Could not extract any Tajawal ttf URLs from CSS");
    }

    const buffers = await Promise.all(
      entries.map((e) => fetch(e.url).then((res) => res.arrayBuffer())),
    );

    return entries.map((e, i) => ({
      name: e.isArabicSubset ? FONT_FAMILY_ARABIC : FONT_FAMILY_LATIN,
      data: buffers[i],
    }));
  })();
  return _fontDataPromise;
}

/**
 * Fetches the static quiz-thumbnail background PNG and returns its already
 * base64-encoded `url(data:image/png;base64,...)` CSS string, ready to drop
 * straight into a `backgroundImage` style.
 *
 * Result is cached at module level (see _bgImagePromise above) so warm Edge
 * invocations skip both the network fetch AND the base64 encode — the same
 * caching this file already applies to the font, applied here for the same
 * reason: this is one unchanging static asset (BACKGROUND_IMAGE_URL never
 * varies per-request), so re-fetching and re-encoding it on every single
 * invocation was pure waste and a likely major contributor to slow
 * response times.
 *
 * NOTE on image format: @vercel/og's ImageResponse constructor has no
 * `format`/`quality` option — it only ever outputs PNG, regardless of what
 * format the *input* background asset is in (confirmed against Vercel's own
 * docs; there's an open, unresolved upstream GitHub discussion requesting
 * exactly this feature). So switching this background source to .jpg would
 * change what @vercel/og has to decode going IN, but would NOT change the
 * PNG format of the image this function ultimately returns to the client —
 * it cannot, since that step isn't configurable from here. This caching fix
 * targets the actual repeated-fetch/re-encode cost instead, which is a real,
 * controllable source of the slowness.
 *
 * @returns {Promise<string|null>} the CSS `url(data:...)` string, or null if
 *   the fetch failed (caller falls back to a solid background color).
 */
function loadBackgroundImage() {
  if (_bgImagePromise) return _bgImagePromise;
  _bgImagePromise = fetch(BACKGROUND_IMAGE_URL)
    .then((res) => {
      if (!res.ok) throw new Error(`Failed to load background image: ${res.status}`);
      return res.arrayBuffer();
    })
    .then((buf) => `url(data:image/png;base64,${Buffer.from(buf).toString("base64")})`)
    .catch((err) => {
      console.error("[og] bg image fetch error:", err);
      // Don't cache a failure — let the next invocation retry, same as a
      // transient font-fetch hiccup would (see loadFont()'s own null-return
      // fallback for the parallel case).
      _bgImagePromise = null;
      return null;
    });
  return _bgImagePromise;
}

// =============================================================================
// Handler
// =============================================================================
// Also handles /api/og?course=<id> (course OG thumbnails) — merged in here
// rather than as a separate api/og-course.js function so the two Edge OG
// generators (quiz + course) share one Vercel function slot, since Hobby's
// 12-function cap counts them separately otherwise. Course requests are
// dispatched to renderCourseImage() below, which reuses this file's font
// loading and bidi helpers but has its own (much simpler) layout — the
// pixel-measured quiz-thumbnail background here is quiz-specific artwork
// (bulb card, button, pill) that doesn't make sense for a course page.
export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  // ?lesson=<id|slug> — lesson reading-page thumbnail (renderLessonImage,
  // bottom of this file). Dispatched first; same shared-function rationale.
  const lessonId = searchParams.get("lesson");
  if (lessonId) return renderLessonImage(lessonId);

  // ?profile=<handle> — /@handle share card (renderProfileImage, bottom of
  // this file). Merged here instead of a new api/og-profile.js so it does not
  // consume one of Hobby's 12 function slots.
  const profileHandle = searchParams.get("profile");
  if (profileHandle) return renderProfileImage(profileHandle, searchParams.get("v"));

  const courseId = searchParams.get("course");
  if (courseId) {
    // ?folder=Algebra/Second (raw folder names, "/"-joined — see
    // render-course.js's OG image URL builder) requests the nested-folder
    // variant of the course image: same layout, but the title/stats reflect
    // the deepest folder in the chain instead of the course itself, with
    // the full "Course / Sub / Sub2" breadcrumb shown as the title.
    const folderPath = searchParams.get("folder");
    return renderCourseImage(courseId, folderPath ? folderPath.split("/").filter(Boolean) : null);
  }

  const quizId = searchParams.get("quizId");

  // ── 1. Fetch external assets in parallel ─────────────────────────────────
  const [fontData, quizData, bgImageBase64] = await Promise.all([
    // If the font fetch/parse ever fails again (network hiccup, Google
    // Fonts markup change, etc.), fall back to null rather than letting
    // the whole handler throw — ImageResponse still renders fine without
    // a custom font entry, just with the system default instead of Tajawal.
    loadFont().catch((err) => {
      console.error("[og] font load error:", err);
      return null;
    }),
    quizId ? fetchQuizMeta(quizId) : null,
    // Cached at module level via loadBackgroundImage() — see its own doc
    // comment for why (this is a static asset, never varies per-request).
    loadBackgroundImage(),
  ]);

  const meta = quizData;

  // ── 2. Build display strings ──────────────────────────────────────────────
  const rawTitle = meta ? (meta.title || quizId || "امتحان") : "منصة امتحانات بصمجي";
  const isArabic = detectArabic(rawTitle);
  const title = truncateTitle(rawTitle, isArabic ? TITLE_MAX_CHARS_ARABIC : TITLE_MAX_CHARS_LATIN);
  const details = meta ? buildDetails(meta, isArabic) : "";
  const description = meta ? truncateDescription(meta.description) : null;
  const courseName = meta ? meta.course : null;
  const authorName = meta ? meta.author : null;
  const authorIsArabic = authorName ? detectArabic(authorName) : isArabic;
  const authorLabel = authorIsArabic ? "بواسطة" : "By";

  // Shrink font as the title gets longer, so it always fits on one line
  // within TEXT_COLUMN_WIDTH (640px). These tiers are calibrated from
  // actual glyph-advance-width metrics measured against the Tajawal Bold
  // font files (fonttools, ~8% safety margin) — not guessed. An earlier
  // version used untested breakpoints that let Arabic titles as short as
  // ~39 characters silently overflow the column at every available tier,
  // since Arabic glyphs in Tajawal render noticeably wider per character
  // than Latin ones, and no tier was small enough to compensate for that.
  // TITLE_MAX_CHARS_ARABIC/LATIN below are set to what the smallest tier
  // here can actually hold, so truncation and shrinking always agree.
  const titleFontSize = isArabic
    ? title.length > 25
      ? "28px"
      : title.length > 22
        ? "32px"
        : title.length > 19
          ? "38px"
          : title.length > 17
            ? "44px"
            : title.length > 14
              ? "50px"
              : "56px"
    : title.length > 39
      ? "32px"
      : title.length > 33
        ? "38px"
        : title.length > 27
          ? "46px"
          : "54px";

  // Background image CSS string — already fully built (fetched, encoded,
  // and cached) by loadBackgroundImage() above; falls back to "none" (solid
  // fallback color below) if that fetch failed.
  const bgImageCss = bgImageBase64 || "none";

  // ── 3. Build image element (plain objects — no JSX) ───────────────────────
  const element = {
    type: "div",
    props: {
      style: {
        display: "flex",
        width: "100%",
        height: "100%",
        position: "relative",
        fontFamily: FONT_FAMILY_STACK,
        backgroundImage: bgImageCss,
        backgroundSize: "1200px 630px",
        backgroundRepeat: "no-repeat",
        backgroundColor: "#0f172a", // Fallback color
      },
      children: [
        // ── Relocated domain label — small, top-right corner ─────────────
        // Demoted from its old prime spot (now the question-count/type
        // badge below) but kept, since forwarded screenshots in chats lose
        // all OG metadata except these pixels — this is the only branding
        // that survives that path.
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              position: "absolute",
              right: `${DOMAIN_LABEL.right}px`,
              top: `${DOMAIN_LABEL.top}px`,
              fontSize: "16px",
              color: "#9ca3af",
              fontWeight: "400",
              direction: "ltr",
            },
            children: "basmagi-quiz.vercel.app",
          },
        },

        // ── Question count / type badge — now in the old pill's row ──────
        details
          ? {
            type: "div",
            props: {
              style: {
                display: "flex",
                position: "absolute",
                // Left edge pinned to the button's own left edge (x≈534,
                // see BUTTON_ROW below) rather than centered across the
                // full text column, so the badge's left side lines up
                // vertically with the button's left side underneath it.
                left: `${BUTTON_ROW.left}px`,
                top: "148px",
                width: `${TEXT_COLUMN.right - BUTTON_ROW.left}px`,
                height: "41px", // matches old pill height (148–189)
                alignItems: "center",
                justifyContent: "flex-start",
                // ltr here: this wrapper has a single child (the badge
                // div below), so there's no sibling order at this level
                // for flexbox to mirror. The badge's own Arabic mirroring
                // happens one level down, via flexDirection: row-reverse
                // on its sibling token children — leaving this outer
                // wrapper as rtl would double-handle direction and
                // produce the oversized inter-word gaps Satori's Arabic
                // shaper adds under an rtl context.
                direction: "ltr",
              },
              children: [
                {
                  type: "div",
                  props: {
                    style: {
                      display: "flex",
                      flexDirection: isArabic ? "row-reverse" : "row",
                      alignItems: "center",
                      gap: "6px",
                      background: "rgba(0,136,204,0.12)",
                      border: `1px solid rgba(0,136,204,0.3)`,
                      borderRadius: "10px",
                      padding: "8px 22px",
                      fontSize: "20px",
                      color: BRAND_BLUE,
                      fontWeight: "700",
                      // ltr: mirroring for Arabic now happens via
                      // flexDirection: row-reverse above (sibling tokens
                      // from renderBidiChildren), not via a pre-mirrored
                      // text node — see renderBidiChildren's doc comment
                      // for why a single joined string can't safely mix
                      // Arabic words with the digits/"·" this badge
                      // contains (e.g. "12 سؤال").
                      direction: "ltr",
                    },
                    children: renderBidiChildren(details, isArabic),
                  },
                },
              ],
            },
          }
          : null,

        // ── Title + description column ────────────────────────────────────
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
              height: `${TEXT_COLUMN.bottom - TEXT_COLUMN.top}px`,
              textAlign: "center",
              // ltr: this column only stacks title/description vertically
              // (flexDirection: column), so there's no horizontal sibling
              // order for `direction` to mirror — and both leaf texts
              // below are pre-mirrored by renderBidiText, so rtl here
              // would double-handle direction and widen inter-word gaps.
              direction: "ltr",
              gap: "10px",
            },
            children: [
              // ── Title (single line, guaranteed by shrink + truncate) ───
              {
                type: "div",
                props: {
                  style: {
                    display: "flex",
                    flexDirection: isArabic ? "row-reverse" : "row",
                    flexWrap: "nowrap",
                    gap: "0.25em",
                    fontSize: titleFontSize,
                    fontWeight: "700",
                    color: "#111827",
                    lineHeight: "1.25",
                    textAlign: "center",
                    direction: "ltr",
                    width: "100%",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    justifyContent: "center",
                  },
                  // Sibling tokens instead of one pre-mirrored string — a
                  // title is free user text that can contain digits or
                  // "·"/parenthesis punctuation next to Arabic words,
                  // which hits the space-collapse bug documented on
                  // renderBidiText() (confirmed: a title like "مراجعة
                  // الفصل 3 النهائية" paints with several words glued
                  // together with no visible gap). See renderBidiChildren.
                  children: renderBidiChildren(title, isArabic),
                },
              },

              // ── Description (smaller, single line, muted) ──────────────
              description
                ? {
                  type: "div",
                  props: {
                    style: {
                      display: "flex",
                      flexDirection: isArabic ? "row-reverse" : "row",
                      flexWrap: "nowrap",
                      gap: "0.25em",
                      fontSize: "20px",
                      fontWeight: "400",
                      color: "#4b5563",
                      lineHeight: "1.3",
                      textAlign: "center",
                      direction: "ltr",
                      width: "100%",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      justifyContent: "center",
                    },
                    children: renderBidiChildren(description, isArabic),
                  },
                }
                : null,
            ].filter(Boolean),
          },
        },

        // ── Course name pill — its own row, just above the button ────────
        courseName
          ? {
            type: "div",
            props: {
              style: {
                display: "flex",
                position: "absolute",
                left: `${COURSE_ROW.left}px`,
                top: `${COURSE_ROW.top}px`,
                width: `${COURSE_ROW.right - COURSE_ROW.left}px`,
                height: `${COURSE_ROW.bottom - COURSE_ROW.top}px`,
                alignItems: "center",
                // flex-start (not center): the pill's own left edge must
                // line up with the button's left edge directly below it,
                // matching the stats badge's alignment above.
                justifyContent: "flex-start",
                // ltr: single child, text pre-mirrored by renderBidiText.
                direction: "ltr",
              },
              children: [
                {
                  type: "div",
                  props: {
                    style: {
                      display: "flex",
                      alignItems: "center",
                      background: "rgba(17,24,39,0.06)",
                      borderRadius: "8px",
                      padding: "5px 18px",
                      fontSize: "17px",
                      color: "#374151",
                      fontWeight: "700",
                      whiteSpace: "nowrap",
                      direction: "ltr",
                    },
                    children: renderBidiText(courseName, detectArabic(courseName)),
                  },
                },
              ],
            },
          }
          : null,

        // ── Author line — bottom footer strip, centered on the button ────
        // Rendered as ONE pre-mirrored text leaf (label + name combined),
        // not two separate flex children under a `direction: rtl`
        // container. Two mirroring mechanisms were fighting each other:
        // renderBidiText() already reverses word order within the name
        // string itself, and container-level `direction: rtl` *also*
        // reversed the label/name divs' left-right screen position — the
        // combination produced "name-words-reversed, then label" instead
        // of the intended "label, then name in natural word order" (label
        // is a single word, so its own internal order was never the
        // issue — only its position relative to the name was). Combining
        // into one string and mirroring once, as a whole, avoids this.
        authorName
          ? {
            type: "div",
            props: {
              style: {
                display: "flex",
                position: "absolute",
                left: `${AUTHOR_ROW.centerX - 300}px`,
                top: `${AUTHOR_ROW.top}px`,
                width: "600px",
                alignItems: "center",
                justifyContent: "center",
                direction: "ltr",
                fontSize: "22px",
              },
              children: [
                {
                  type: "div",
                  props: {
                    style: { display: "flex", color: "#9ca3af", fontWeight: "400" },
                    children: renderBidiText(`${authorLabel} `, false),
                  },
                },
                {
                  type: "div",
                  props: {
                    style: { display: "flex", color: "#374151", fontWeight: "700" },
                    children: " ",
                  },
                },
              ],
            },
          }
          : null,
      ].filter(Boolean),
    },
  };

  // ── 4. Return ImageResponse ───────────────────────────────────────────────
  // Only cache aggressively when the render is fully correct (background
  // image loaded, font loaded, AND — if a quizId was given — metadata was
  // found). A transient failure (e.g. manifest/Supabase hiccup, bg image or
  // font fetch error) would otherwise be locked into the CDN for a year via
  // the immutable cache below, silently breaking that quiz's thumbnail until
  // OG_IMAGE_VERSION is bumped project-wide.
  const renderIsComplete =
    bgImageBase64 !== null && fontData !== null && (!quizId || meta !== null);

  return new ImageResponse(element, {
    width: 1200,
    height: 630,
    // Only pass font entries when they actually loaded — ImageResponse
    // falls back to a default system font if the array is empty, which is
    // preferable to crashing the whole render over a font hiccup.
    // fontData is an array of {name, data} — one per script subset, each
    // tagged with its own distinct family name (see loadFont()). The
    // FONT_FAMILY_STACK set on the root container's fontFamily resolves
    // each glyph against whichever of these two entries actually covers it.
    fonts: fontData
      ? fontData.map((entry) => ({
        name: entry.name,
        data: entry.data,
        weight: 700,
        style: "normal",
      }))
      : [],
    headers: {
      "Cache-Control": renderIsComplete
        ? "public, immutable, no-transform, max-age=31536000, s-maxage=31536000"
        : "public, s-maxage=300, stale-while-revalidate=3600",
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
 * @returns {Promise<{title:string, description:string|null, questionCount:number|null, questionTypes:string|null, author:string|null, course:string|null}|null>}
 */
async function fetchQuizMeta(quizId) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error("[og] Missing SUPABASE_URL or SUPABASE_ANON_KEY");
    return null;
  }

  try {
    // PostgREST filter: data->meta->>id = quizId
    const url = new URL(`${SUPABASE_URL}/rest/v1/quizzes`);
    url.searchParams.set("select", "data,title,subject");
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
      author: quizMeta.author || null,
      course: row.subject || null,
    };
  } catch (err) {
    console.error("[og] fetchQuizMeta error:", err);
    return null;
  }
}

/**
 * Finds a quiz entry by ID across all subjects in the manifest and shapes it
 * to match fetchQuizMeta's return shape.
 *
 * @param {{subjects: Array}} manifest
 * @param {string} quizId
 * @returns {{title:string, description:string|null, questionCount:number|null, questionTypes:string|null, author:string|null, course:string|null}|null}
 */
// =============================================================================
// Helpers
// =============================================================================

/**
 * Formats the detail line, e.g. "12 سؤال (مقالي · إختياري · صح/خطأ)"
 * (Arabic) or "20 Questions (MCQ · Essay)" (English).
 *
 * questionTypes always arrives from the scanning script as exact, case-sensitive
 * English labels ("MCQ", "Essay", "True/False"), joined with " · ". When the
 * quiz title is Arabic, each recognized label is translated for display;
 * unrecognized labels are left untouched rather than dropped.
 *
 * Always built in natural reading order — count first, then the type list
 * parenthesized — regardless of script. Arabic mirroring (so it *paints*
 * count-first-on-the-right) is handled separately by renderBidiText() at
 * render time, which treats a "(...)" group as one atomic token so it
 * moves as a block without scrambling the types inside it. Do not
 * reintroduce a manual source-order swap here — renderBidiText already
 * owns that concern, and doing it in both places double-reverses.
 */
function buildDetails(meta, isArabic) {
  if (!meta) return "";
  const label = isArabic ? "سؤال" : "Questions";
  const translatedTypes = translateQuestionTypes(meta.questionTypes, isArabic);
  const countPart = meta.questionCount != null ? `${meta.questionCount} ${label}` : "";

  if (!countPart) return translatedTypes || "";
  if (!translatedTypes) return countPart;

  return `${countPart} (${translatedTypes})`;
}

/**
 * Truncates an overly long title so it can never overflow the fixed-width
 * text column or collide with the bulb graphic / button, even after the
 * font-size shrink rule in the handler. maxChars must match whichever of
 * TITLE_MAX_CHARS_ARABIC/LATIN corresponds to the title's detected script,
 * since the two scripts have very different safe character budgets.
 */
function truncateTitle(title, maxChars) {
  if (!title || title.length <= maxChars) return title;
  return title.slice(0, maxChars - 1).trimEnd() + "…";
}

/**
 * Truncates the description line, which sits below the title at a smaller
 * size and must also never wrap (single line only).
 */
function truncateDescription(description) {
  if (!description || description.length <= DESCRIPTION_MAX_CHARS) return description;
  return description.slice(0, DESCRIPTION_MAX_CHARS - 1).trimEnd() + "…";
}

function detectArabic(text) {
  const firstLetter = text.match(/\p{L}/u);
  return (
    firstLetter &&
    /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(firstLetter[0])
  );
}

/**
 * Satori does NOT run the Unicode Bidirectional Algorithm — it lays out a
 * text node's characters/words in raw source (storage) order. Critically,
 * this means `direction: "rtl"` on the div wrapping a pre-reversed string
 * is not a no-op "just in case" setting — Satori's text shaper applies
 * extra inter-word spacing/justification for Arabic runs under an RTL
 * writing-direction context (visible as the oversized gaps between words
 * once this function has already reordered them). Once a string has been
 * run through this function, the container/leaf holding it must be set to
 * `direction: "ltr"` — the words are now in final left-to-right paint
 * order and should be shaped as a plain LTR string, not re-processed.
 *
 * `direction: rtl` should only still be used on containers whose *children
 * are separate sibling elements* (e.g. an author label div + author name
 * div) where flexbox's own row-reversal is the thing doing the mirroring —
 * never on a container/leaf whose text content this function has touched.
 *
 * Algorithm: split on whitespace, reverse token order, rejoin. Within any
 * single Arabic word the glyphs are already stored in correct visual
 * order — only word order needs mirroring. Numbers/Latin/punctuation
 * tokens (e.g. "12", "·") move with the reversal as atomic units and are
 * never internally re-reversed, so "12" never becomes "21".
 *
 * Parenthesized groups are treated as a single atomic unit: "(a · b · c)"
 * keeps its internal word order and only moves as a block, so opening/
 * closing parens stay correctly paired with their contents after the
 * surrounding sentence is mirrored. This matters for strings built via
 * buildDetails(), e.g. "12 سؤال (مقالي · إختياري · صح/خطأ)".
 *
 * KNOWN LIMITATION — do not use this for strings mixing Arabic words with
 * digits/Latin/"·" (rejoined with a plain " "): Satori's shaper silently
 * collapses the space at any boundary where an Arabic-script character is
 * the very next glyph in storage order (confirmed by direct Satori
 * rendering, not just code reading — e.g. "12 سؤال" round-trips through
 * this function fine as a STRING, but paints as "12سؤال" with zero visible
 * gap, and reversing the boundary doesn't reliably fix it either — nor
 * does substituting NBSP, which "fixes" the gap but then corrupts the
 * digit's own internal shaping ("12" paints as "21"). There is no
 * single-text-node fix. For any string that mixes Arabic words with
 * digits, Latin, or "·"/parenthesis punctuation, use renderBidiChildren()
 * instead, which sidesteps the bug entirely by never emitting a shared
 * text node across that boundary. Reserve this function for strings that
 * are pure Arabic-script words throughout (e.g. a title, a two-word
 * label) — those have no such boundary and are unaffected.
 */
function renderBidiText(text, isArabic) {
  if (!text || !isArabic) return text;
  return tokenizeBidiText(text).reverse().join(" ");
}

/**
 * Splits text into bidi-reorderable tokens: whitespace-separated, with any
 * "(...)" group merged back into one atomic token so its internal order
 * survives the later reversal intact. Shared by renderBidiText() (string
 * output) and renderBidiChildren() (sibling-node output).
 */
function tokenizeBidiText(text) {
  const rawTokens = text.split(" ");
  const tokens = [];
  let buffer = null;
  for (const tok of rawTokens) {
    if (buffer !== null) {
      buffer.push(tok);
      if (tok.endsWith(")")) {
        tokens.push(buffer.join(" "));
        buffer = null;
      }
      continue;
    }
    if (tok.startsWith("(") && !tok.endsWith(")")) {
      buffer = [tok];
      continue;
    }
    tokens.push(tok);
  }
  if (buffer !== null) tokens.push(...buffer); // unterminated "(" — bail safely
  return tokens;
}

/**
 * Bidi-safe alternative to renderBidiText() for any string that mixes
 * Arabic words with digits, Latin, or "·"/parenthesis punctuation — see
 * the KNOWN LIMITATION note on renderBidiText() for why a single joined
 * text node can't be made to work here (confirmed by direct Satori
 * rendering: no separator character both preserves the gap AND leaves
 * digit shaping uncorrupted at every boundary direction).
 *
 * Returns an ARRAY of sibling `div` nodes — one per token, already in
 * final (reversed, for Arabic) paint order — instead of one string. The
 * caller must render these as flex children of a container with a `gap`
 * (not a plain text node), so spacing between tokens comes from flexbox
 * layout rather than a text-run space Satori can collapse. This is the
 * same sibling-elements-plus-gap pattern already used elsewhere in this
 * file (e.g. buildInfoRowChildren, the parent-course line) for exactly
 * this reason.
 *
 * For non-Arabic text, still returns an array (of one token per
 * whitespace-separated word, in original order) so callers can use one
 * rendering path regardless of script — flex order for LTR content is
 * just its natural left-to-right order, so no reversal is needed.
 *
 * Callers apply `flexDirection: isArabic ? "row-reverse" : "row"` — NOT a
 * pre-reversed array with plain "row" — so alignment/gap math and any
 * future RTL-aware flex features (e.g. wrapping) behave the same as this
 * file's other sibling-based rows.
 */
function renderBidiChildren(text, isArabic) {
  if (!text) return [];
  const tokens = isArabic ? tokenizeBidiText(text) : text.split(" ");
  return tokens.map((tok) => ({
    type: "div",
    props: { style: { display: "flex" }, children: tok },
  }));
}

function formatQuestionTypes(qt) {
  if (!qt) return null;
  if (Array.isArray(qt)) return qt.length ? qt.join(" · ") : null;
  return String(qt) || null;
}

/**
 * Slug/URL-path counterpart to renderBidiText(). A slugified Arabic segment
 * (e.g. "إمتحانات-سابقة-لنفس-الدكتور") is hyphen-joined, not space-joined —
 * renderBidiText()'s word split on " " is a no-op on a string like this, so
 * without this helper the segment reaches Satori completely untouched and
 * comes out in raw storage order (first word painted rightmost-of-nowhere
 * instead of rightmost-visually — the same class of bug renderBidiText
 * fixes for sentences, just with "-" as the token separator instead of " ").
 *
 * Only reorders a segment that is itself Arabic (detectArabic on the whole
 * segment) — Latin segments (e.g. a course slug like
 * "Data-Structures-and-Algorithms") must never be touched, since flipping a
 * segment's own word order would break EN slugs.
 *
 * Only the ORDER of hyphen-separated tokens is reversed — never the
 * characters within a token — matching renderBidiText's word vs.
 * glyph distinction. A leading/trailing empty token (from slugify()'s own
 * "-" -> "--" doubling, or an edge hyphen) is preserved in place rather
 * than moved, so doubled hyphens don't collapse or migrate.
 */
function renderBidiSlugSegment(segment) {
  if (!segment || !detectArabic(segment)) return segment;
  return segment.split("-").reverse().join("-");
}

// =============================================================================
// Course / folder OG image (used by /api/og?course=<id>[&folder=...]) — see
// handler() dispatch above. Deliberately mirrors the quiz thumbnail's own
// composition (white background, rotated card holding a big icon on the
// left, content column on the right) instead of the old flat brand-gradient
// layout, so course/folder previews read as the same product as quiz
// previews rather than a completely different visual language. No
// background PNG is fetched here — the icon "card" is drawn from plain
// Satori shapes + a large emoji glyph, so a course/folder image needs no
// extra network round-trip beyond the font + Supabase metadata fetch.
// Reuses this file's font loading + Arabic bidi helpers.
// =============================================================================

const COURSE_TITLE_MAX_CHARS_ARABIC = 22;
const COURSE_TITLE_MAX_CHARS_LATIN = 36;

// Icon card geometry — deliberately matching the quiz thumbnail's own bulb
// card bounds (x 0–408, y 25–490 on the 1200×630 canvas — see the header
// comment at the top of this file) so course/folder images share the same
// visual rhythm as quiz images despite having no shared background asset.
const ICON_CARD = { left: 24, top: 25, width: 380, height: 465, rotationDeg: -6 };

// Right-hand content column — starts just past the icon card, runs the
// full remaining height of the canvas (not just a short top band) so the
// larger text sizes below have room to breathe and the link line can sit
// pinned to the bottom instead of immediately under the info rows.
const COURSE_CONTENT = { left: 470, right: 1152, top: 56, bottom: 630 - 40 };

// Info-table column widths — FIXED pixels, not percentages. The table
// itself always renders at the full content-column width (see
// `contentWidth` below, used as the table's `width: "100%"`), so its
// total pixel width is already a known constant; deriving the two column
// widths from that constant up front (once) means every row gets the
// exact same column boundary. This replaces an earlier version that used
// percentage flex-basis ("1 1 54%" / "0 0 46%") directly on each row's
// columns — percentages recompute per row, and Satori's layout doesn't
// always resolve that computation to an identical pixel figure for rows
// with very different content lengths ("2" vs "Computer Science"),
// which is what produced the misaligned-column bug (values/keys not
// sitting on a shared x-position row to row). Split kept at the same
// 54/46 ratio as before for visual continuity.
const INFO_TABLE_WIDTH = COURSE_CONTENT.right - COURSE_CONTENT.left; // 682
const INFO_TABLE_VALUE_COL_WIDTH = Math.round(INFO_TABLE_WIDTH * 0.54);
const INFO_TABLE_KEY_COL_WIDTH = INFO_TABLE_WIDTH - INFO_TABLE_VALUE_COL_WIDTH;

async function renderCourseImage(courseId, folderPath) {
  const [fontData, meta] = await Promise.all([
    loadFont().catch((err) => {
      console.error("[og] course font load error:", err);
      return null;
    }),
    fetchCourseMeta(courseId, folderPath),
  ]);

  const isFolder = !!(meta && meta.isFolder);

  // Whether the (course-level) educationType is "Featured" — drives the
  // "مادة مميزة" badge next to the kind label below. Always the COURSE's
  // own field (see fetchCourseMeta's comment: a folder has no
  // education_type of its own), same source buildCourseInfoRowsFromRow()
  // already reads to decide whether to omit the التعليم row.
  const isFeatured = !!(meta && meta.educationType === "Featured");

  // Title is the item's OWN name — the folder's own name for a folder
  // image, or the course's own name for a course image — never the full
  // concatenated breadcrumb. The parent course (for a folder) is shown
  // as its own labeled line in the info block below, per spec: folder
  // name + parent COURSE's info, not a smashed-together path string.
  const rawTitle = meta ? meta.name : "منصة امتحانات بصمجي";
  // NOTE: `isArabic` here is used ONLY to decide word-order reversal for a
  // given text run (per renderBidiText's own doc comment) and text-length
  // budgets/font sizing — it must NEVER be used to pick which side of the
  // canvas things are laid out on, or the layout would move around
  // depending on whatever the current title happens to be (this is
  // exactly the bug that shipped previously — course-info sometimes on
  // the left, sometimes the right). This page's overall reading direction
  // is fixed to RTL — see the static layout below — independent of title
  // language.
  const isArabic = detectArabic(rawTitle);
  const title = truncateTitle(
    rawTitle,
    isArabic ? COURSE_TITLE_MAX_CHARS_ARABIC : COURSE_TITLE_MAX_CHARS_LATIN,
  );

  // Sized up from the first pass — the old tiers (56/48/40) left a lot of
  // the card's height unused. These top out at 72px (course/folder titles
  // are short, 1-3 words, so the common case hits the largest tier).
  const titleFontSize = isArabic
    ? title.length > 18
      ? "48px"
      : title.length > 13
        ? "58px"
        : "72px"
    : title.length > 26
      ? "44px"
      : title.length > 20
        ? "56px"
        : "68px";

  // Course-info rows — always the top-level COURSE's own fields (see
  // fetchCourseMeta's comment: a folder has no education_type/college/
  // year/term of its own), matching buildCourseInfoRows()'s label set,
  // order, and "hide empty" rules (except the Featured special-case, see
  // buildCourseInfoRowsFromRow's own doc comment).
  const infoRows = meta ? buildCourseInfoRowsFromRow(meta) : [];

  // For a folder image, the course name gets its own small line above the
  // info rows so it's unambiguous which course "التعليم"/"الكلية"/etc.
  // belong to (they're the course's, not the folder's).
  const parentCourseLine =
    isFolder && meta && meta.courseName ? meta.courseName : null;

  // Token array, not a joined string — "70 مجلد" mixes a digit with an
  // Arabic word, which hits the space-collapse bug documented on
  // renderBidiText() ("70سؤال" with zero visible gap). Rendered as sibling
  // flex children with a `gap` at the call site instead (see
  // renderBidiChildren's doc comment).
  const countsTokens = meta
    ? isArabic
      ? [
          String(meta.folderCount),
          "مجلد",
          "·",
          String(meta.quizCount),
          "امتحان",
          "·",
          String(meta.lessonCount ?? 0),
          "درس",
        ]
      : [
          String(meta.folderCount),
          "Folders",
          "·",
          String(meta.quizCount),
          "Quizzes",
          "·",
          String(meta.lessonCount ?? 0),
          "Lessons",
        ]
    : null;

  // Human-readable link line, mirroring the actual /course/:slug[/...] URL
  // shape render-course.js builds (course name -> slug via toSlug(), then
  // raw folder names joined by "/"). This is a readable approximation for
  // display purposes only — the real canonical URL (with proper
  // encodeURIComponent + toSlug on each segment) is what's actually set as
  // og:url by render-course.js; this line just needs to look right, not be
  // clickable. Rendered at the bottom of the card (see layout below), not
  // immediately under the info rows, so it always reads as a footer.
  const slugify = (s) => (s || "").trim().replace(/-/g, "--").replace(/\s+/g, "-");
  // Each slug segment is bidi-fixed independently via renderBidiSlugSegment
  // (see its doc comment) — the course slug can itself be Arabic (an
  // Arabic-named course with no folder path), and each folder-path segment
  // is checked/fixed on its own rather than after joining, so a mixed
  // Arabic/Latin path (e.g. an English course containing an Arabic folder)
  // only reorders the segment(s) that actually need it.
  const courseSlug = meta
    ? renderBidiSlugSegment(slugify(meta.courseName || meta.name))
    : "";
  const fullLinkPath =
    folderPath && folderPath.length > 0
      ? `basmagi-quiz.vercel.app/course/${courseSlug}/${folderPath
        .map((seg) => renderBidiSlugSegment(slugify(seg)))
        .join("/")}`
      : `basmagi-quiz.vercel.app/course/${courseSlug}`;

  // Footer link — MUST stay on one line. Long paths used to wrap onto a
  // second line (ugly). Fix: hard single-line + truncate from the FRONT
  // ("…" + tail) once it's too long to fit, so the most identifying part
  // — the actual course/folder slug at the end of the path — stays
  // visible instead of the always-identical "basmagi-quiz.vercel.app/
  // course/" prefix. Budget is generous (the footer now spans the full
  // centered canvas width, ~1120px, not just the narrow right-hand
  // content column) — this is a plain character-count clamp, not a
  // font-metrics measurement, so it errs conservative rather than risking
  // overflow past the canvas edges.
  const LINK_MAX_CHARS = 100;
  const linkPath =
    fullLinkPath.length > LINK_MAX_CHARS
      ? "…" + fullLinkPath.slice(fullLinkPath.length - (LINK_MAX_CHARS - 1))
      : fullLinkPath;

  const contentWidth = COURSE_CONTENT.right - COURSE_CONTENT.left;

  // ── Course-info TABLE ────────────────────────────────────────────────
  // Per spec: this is a table, not a pair of independently-mirrorable
  // flex rows. Keys always sit on the right and read RTL; values always
  // sit on the left and read LTR — even when the value itself is Arabic
  // text (e.g. "Computer Science" vs. "نظم معلومات") — because a
  // consistent two-column grid reads better than a layout that
  // reorders itself per-row based on each value's own script. The whole
  // table is a fixed-position, fixed-width block (see COURSE_INFO_TABLE
  // geometry below) so its position on the canvas never moves, no matter
  // what the title or values are — this directly fixes the "info block
  // moves left/right depending on the quiz title" bug.
  function buildInfoTable(rows) {
    return {
      type: "div",
      props: {
        style: {
          display: "flex",
          flexDirection: "column",
          width: "100%",
          border: "1px solid rgba(15,23,42,0.10)",
          borderRadius: "16px",
          overflow: "hidden",
          direction: "ltr",
        },
        children: rows.map((row, i) => ({
          type: "div",
          props: {
            style: {
              display: "flex",
              flexDirection: "row",
              width: "100%",
              borderTop: i === 0 ? "none" : "1px solid rgba(15,23,42,0.08)",
              background: i % 2 === 1 ? "rgba(15,23,42,0.02)" : "transparent",
            },
            children: [
              // Value column — always the LEFT side, always LTR-aligned,
              // even for an Arabic value — this is the "even if they are
              // Arabic, tables look better this way" rule from the brief.
              //
              // NOTE: Satori lays out flex children strictly by their
              // ARRAY order — it does NOT honor the CSS `order` property
              // for positioning (confirmed by direct rendering: a `div`
              // listed first in `children` always paints leftmost in an
              // LTR row, regardless of its own `order` value). The
              // previous version of this table relied on `order: 1` /
              // `order: 2` to place the value on the left and the key on
              // the right while still listing the key div FIRST in the
              // array — since Satori ignores `order`, that always painted
              // the key on the left and the value on the right, exactly
              // backwards from spec. The fix is to put the columns in
              // the array in their actual final left-to-right paint
              // order — value first (left), key second (right) — with no
              // `order` property at all.
              //
              // NOTE on column widths: these were originally percentage
              // flex-basis ("1 1 54%" / "0 0 46%"). Percentages resolve
              // against each row's own computed width, and because Satori
              // (unlike a browser) doesn't always re-settle every row to
              // an IDENTICAL final pixel width in a flex column, two rows
              // with very different content lengths ("2" vs "Computer
              // Science") could each compute a very slightly different
              // 54%-of-row pixel value — which shows up as the value
              // column's left edge (and therefore the text start
              // position) drifting a few px row to row, i.e. the
              // "right column isn't aligned" bug. Fixed PIXEL widths
              // (derived from the table's own known, constant rendered
              // width — see INFO_TABLE_WIDTH below) give every row the
              // exact same column boundary regardless of content, since
              // there's no per-row percentage math left to disagree.
              {
                type: "div",
                props: {
                  style: {
                    display: "flex",
                    flex: `0 0 ${INFO_TABLE_VALUE_COL_WIDTH}px`,
                    width: `${INFO_TABLE_VALUE_COL_WIDTH}px`,
                    justifyContent: "flex-start",
                    alignItems: "center",
                    padding: "14px 22px",
                    color: "#111827",
                    fontWeight: "700",
                    fontSize: "24px",
                    borderRight: "1px solid rgba(15,23,42,0.08)",
                    direction: "ltr",
                    whiteSpace: "nowrap",
                    textAlign: "left",
                  },
                  children: String(row.val),
                },
              },
              // Key column — always the RIGHT side, always RTL-reading
              // text, regardless of the value's script. Rendered as a
              // single pre-mirrored string in a plain LTR div — the SAME
              // pattern already confirmed working elsewhere in this file
              // for a leaf holding Arabic prose (the quiz-thumbnail
              // course pill: `children: renderBidiText(courseName, ...)`
              // inside a plain `direction: ltr` div). Two earlier
              // attempts both failed against real screenshots: (1) the
              // raw untouched string with `direction: rtl` on the
              // container — Satori doesn't run the bidi algorithm, so
              // this never reorders words, it only adds inter-word
              // spacing; (2) sibling divs with `flexDirection:
              // row-reverse` — that flips the WRONG thing (row-reverse
              // mirrors which array item paints rightmost, but the
              // tokens were still in original storage order, so it just
              // moved the ordering problem instead of fixing it).
              // Pre-reversing the token order with renderBidiText() and
              // then painting the joined result as one plain-LTR string
              // sidesteps both failure modes: by the time Satori sees
              // it, the text is already in final left-to-right paint
              // order, so there's no per-run RTL spacing applied and no
              // word order left to get backwards.
              // NOTE on `whiteSpace`/`textAlign` here: fixed-pixel column
              // widths (above) fixed the column BOUNDARY drifting row to
              // row, but the visible right edges of "التعليم"/"العام"/
              // "الترم" were still landing at different x-positions within
              // an otherwise identically-sized, `justifyContent: flex-end`
              // box. `justifyContent` positions the text's flex-item
              // *box*, but without an explicit `textAlign` Satori doesn't
              // reliably right-align the glyph run's own contents inside
              // that box for every string (confirmed by direct
              // rendering — short single-word Arabic labels of different
              // lengths each drifted independently). The title element
              // above already pairs `justifyContent: flex-end` with
              // `textAlign: "right"` (+ `whiteSpace: nowrap` so the box
              // never wraps and quietly narrows) for exactly this reason;
              // this column needed the same pairing.
              {
                type: "div",
                props: {
                  style: {
                    display: "flex",
                    flex: `0 0 ${INFO_TABLE_KEY_COL_WIDTH}px`,
                    width: `${INFO_TABLE_KEY_COL_WIDTH}px`,
                    justifyContent: "flex-end",
                    alignItems: "center",
                    padding: "14px 22px",
                    color: "#6b7280",
                    fontWeight: "400",
                    fontSize: "24px",
                    direction: "ltr",
                    whiteSpace: "nowrap",
                    textAlign: "right",
                  },
                  children: renderBidiText(row.label, detectArabic(row.label)),
                },
              },
            ],
          },
        })),
      },
    };
  }

  const element = {
    type: "div",
    props: {
      style: {
        display: "flex",
        width: "100%",
        height: "100%",
        position: "relative",
        fontFamily: FONT_FAMILY_STACK,
        backgroundColor: "#ffffff",
        backgroundImage:
          "radial-gradient(circle at 0% 0%, rgba(124,58,237,0.10) 0%, rgba(124,58,237,0) 45%)",
      },
      children: [
        // ── Domain label — top-right corner, matches quiz thumbnail ──────
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              position: "absolute",
              right: "40px",
              top: "24px",
              fontSize: "16px",
              color: "#9ca3af",
              fontWeight: "400",
              direction: "ltr",
            },
            children: "basmagi-quiz.vercel.app",
          },
        },

        // ── Icon card — mirrors the quiz thumbnail's rotated bulb card,
        // holding a large emoji instead of the bulb PNG. 🎓 distinguishes
        // a course, 📁 a folder — this is the "big, distinguishing icon"
        // requested, sized to match the bulb's own visual weight rather
        // than a small badge. ────────────────────────────────────────────
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              position: "absolute",
              left: `${ICON_CARD.left}px`,
              top: `${ICON_CARD.top}px`,
              width: `${ICON_CARD.width}px`,
              height: `${ICON_CARD.height}px`,
              borderRadius: "36px",
              backgroundColor: "#ffffff",
              boxShadow: "0 30px 60px rgba(15,23,42,0.12)",
              border: "1px solid rgba(15,23,42,0.06)",
              transform: `rotate(${ICON_CARD.rotationDeg}deg)`,
              alignItems: "center",
              justifyContent: "center",
            },
            children: [
              {
                type: "div",
                props: {
                  style: {
                    display: "flex",
                    fontSize: "220px",
                    lineHeight: "1",
                    transform: `rotate(${-ICON_CARD.rotationDeg}deg)`,
                  },
                  children: isFolder ? "📁" : "🎓",
                },
              },
            ],
          },
        },

        // ── Content column ────────────────────────────────────────────────
        // justifyContent: space-between + absolute top/bottom pinning
        // spreads the header block and the link footer across the full
        // available height, instead of everything bunching up near the
        // top and leaving a large empty band below it (the "unused white
        // space" issue).
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              position: "absolute",
              left: `${COURSE_CONTENT.left}px`,
              top: `${COURSE_CONTENT.top}px`,
              bottom: `${630 - COURSE_CONTENT.bottom}px`,
              width: `${contentWidth}px`,
              direction: "ltr",
              // FIXED regardless of title/value language — this column's
              // side never moves based on what text happens to be in it
              // (see the isArabic doc comment above renderCourseImage's
              // title logic for why). The product itself is Arabic-first,
              // so the column is always right-aligned/RTL-reading.
              alignItems: "flex-end",
              textAlign: "right",
            },
            children: [
              // ── Header block (kind label, parent line, title, info
              // rows, counts pill) — grouped together so the space-between
              // above only inserts one gap: between this block and the
              // link footer. ──────────────────────────────────────────────
              {
                type: "div",
                props: {
                  style: {
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-end",
                    width: "100%",
                  },
                  children: [
                    // Kind label row — COURSE / FOLDER, plus the
                    // "مادة مميزة" (Featured) badge when applicable.
                    // Rendered as a row (not a single text node) so the
                    // badge can sit beside the label without going
                    // through renderBidiText/renderBidiChildren — flex
                    // row-reverse handles the RTL ordering here since
                    // these are two independent sibling elements, not
                    // tokens of one string.
                    {
                      type: "div",
                      props: {
                        style: {
                          display: "flex",
                          flexDirection: isArabic ? "row-reverse" : "row",
                          alignItems: "center",
                          gap: "10px",
                          direction: "ltr",
                        },
                        children: [
                          // Kind label — COURSE / FOLDER
                          //
                          // letterSpacing is intentionally omitted for
                          // the Arabic labels ("مجلد" / "مقرر دراسي") —
                          // Satori applies letter-spacing between EVERY
                          // glyph, including within a single Arabic
                          // word, which reads as words/letters being
                          // oddly far apart (confirmed by direct
                          // rendering). It's kept only for the English
                          // "COURSE" label, where 1px tracking on Latin
                          // caps is an intentional, legible style choice.
                          {
                            type: "div",
                            props: {
                              style: {
                                display: "flex",
                                fontSize: "24px",
                                color: BRAND_BLUE,
                                fontWeight: "700",
                                ...(isFolder || isArabic ? {} : { letterSpacing: "1px" }),
                                direction: "ltr",
                              },
                              children: isFolder
                                ? "مجلد"
                                : isArabic ? "مقرر دراسي" : "COURSE",
                            },
                          },
                          // "مادة مميزة" badge — Featured courses only.
                          // Previously this file omitted the التعليم row
                          // for Featured courses (see
                          // buildCourseInfoRowsFromRow) but never
                          // actually surfaced the "featured" status
                          // anywhere else on the image, so it silently
                          // disappeared instead of being shown as a
                          // badge. Folder images never show this — a
                          // folder isn't itself Featured, only its
                          // parent course can be, and the course-level
                          // badge would be ambiguous attached to a
                          // folder's own name.
                          !isFolder && isFeatured
                            ? {
                              type: "div",
                              props: {
                                style: {
                                  display: "flex",
                                  fontSize: "16px",
                                  fontWeight: "700",
                                  color: "#b45309",
                                  background: "rgba(245,158,11,0.14)",
                                  border: "1px solid rgba(245,158,11,0.4)",
                                  borderRadius: "8px",
                                  padding: "4px 12px",
                                  direction: "ltr",
                                },
                                children: EDU_TYPE_AR.Featured,
                              },
                            }
                            : null,
                        ],
                      },
                    },

                    // Parent-course line — folder images only.
                    parentCourseLine
                      ? {
                        type: "div",
                        props: {
                          style: {
                            display: "flex",
                            flexDirection: "row-reverse",
                            marginTop: "12px",
                            fontSize: "26px",
                            color: "#6b7280",
                            fontWeight: "400",
                            gap: "8px",
                            direction: "ltr",
                          },
                          children: [
                            {
                              type: "div",
                              props: { style: { display: "flex" }, children: "في" },
                            },
                            {
                              type: "div",
                              props: {
                                style: { display: "flex", fontWeight: "700", color: "#374151" },
                                // Pre-mirrored with renderBidiText — this leaf
                                // was previously the one place in the file
                                // rendering a raw, un-mirrored Arabic string
                                // (every other Arabic text leaf, e.g. the
                                // title at renderBidiText(title, isArabic)
                                // and the quiz thumbnail's courseName pill,
                                // already goes through this). Satori doesn't
                                // run the Unicode bidi algorithm, so a
                                // multi-word Arabic course name painted here
                                // unmirrored (e.g. "اللغة العربية") came out
                                // in raw storage order — reversed relative to
                                // correct visual order ("العربية اللغة").
                                // The parent div's own `direction: "ltr"`
                                // (see the row wrapper above) is exactly the
                                // "container holding pre-mirrored text must
                                // be ltr" case from renderBidiText's doc
                                // comment, so no other change is needed here.
                                children: renderBidiText(
                                  parentCourseLine,
                                  detectArabic(parentCourseLine),
                                ),
                              },
                            },
                          ],
                        },
                      }
                      : null,

                    // Title — the item's own name.
                    {
                      type: "div",
                      props: {
                        style: {
                          display: "flex",
                          marginTop: "18px",
                          fontSize: titleFontSize,
                          fontWeight: "700",
                          color: "#111827",
                          lineHeight: "1.2",
                          // Satori does not run the Unicode Bidi Algorithm
                          // (see renderBidiText's doc comment) — it always
                          // paints a text node's words in raw storage
                          // order, and `direction: "rtl"` on that node
                          // does NOT reorder words for it; it only adds
                          // extra inter-word spacing to an Arabic run.
                          // That combination — untouched word order +
                          // `direction: rtl` — is exactly what produced
                          // this element's own bug (multi-word titles
                          // like "الذكاء الإصطناعي" painting reversed
                          // AND with oversized gaps). The fix is the same
                          // one used elsewhere in this file for a single
                          // leaf holding Arabic prose (e.g. the courseName
                          // line): pre-reverse word order with
                          // renderBidiText(), then paint as a plain LTR
                          // string so Satori doesn't re-space it.
                          direction: "ltr",
                          width: "100%",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          justifyContent: "flex-end",
                          textAlign: "right",
                        },
                        children: renderBidiText(title, isArabic),
                      },
                    },

                    // Course-info rows — التعليم / الكلية / العام /
                    // الترم, same label set + ordering as the in-app
                    // "معلومات المادة" modal (minus التعليم for
                    // Featured courses — see buildCourseInfoRowsFromRow).
                    // Each row is two separate flex children, not a
                    // word-reversed joined string — see
                    // buildInfoRowChildren's doc comment for why.
                    infoRows.length > 0
                      ? {
                        type: "div",
                        props: {
                          style: {
                            display: "flex",
                            flexDirection: "column",
                            width: "100%",
                            marginTop: "28px",
                          },
                          children: [buildInfoTable(infoRows)],
                        },
                      }
                      : null,

                    // Counts pill — reuses the quiz thumbnail badge
                    // styling for visual consistency between quiz and
                    // course/folder previews. Bumped up in size to match
                    // the larger text used everywhere else in this
                    // layout. Rendered as sibling tokens (renderBidiChildren)
                    // + flexDirection: row-reverse rather than one
                    // pre-mirrored string — "70 مجلد" mixes a digit with
                    // an Arabic word, which hits the space-collapse bug
                    // documented on renderBidiText() (paints as "70مجلد"
                    // with no visible gap). See renderBidiChildren's doc
                    // comment.
                    countsTokens
                      ? {
                        type: "div",
                        props: {
                          style: {
                            display: "flex",
                            flexDirection: isArabic ? "row-reverse" : "row",
                            marginTop: "32px",
                            alignItems: "center",
                            gap: "8px",
                            background: "rgba(0,136,204,0.12)",
                            border: "1px solid rgba(0,136,204,0.3)",
                            borderRadius: "12px",
                            padding: "12px 26px",
                            fontSize: "26px",
                            color: BRAND_BLUE,
                            fontWeight: "700",
                            direction: "ltr",
                          },
                          children: countsTokens.map((tok) => ({
                            type: "div",
                            props: { style: { display: "flex" }, children: tok },
                          })),
                        },
                      }
                      : null,
                  ].filter(Boolean),
                },
              },
            ],
          },
        },

        // ── Link footer — full canvas width, horizontally centered
        // (per request: previously confined to the narrow right-hand
        // content column, which both clipped long paths and left all the
        // space under the icon card on the left unused). Absolutely
        // positioned independently of the content column so centering is
        // against the whole 1200px canvas, not just its own column. Still
        // single-line (`whiteSpace: nowrap` + `overflow: hidden`) — but
        // the char budget above is generous enough, and centered text
        // rarely needs the aggressive front-truncation a right-anchored
        // line does, so nothing meaningful gets clipped in practice. ─────
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              position: "absolute",
              left: "40px",
              right: "40px",
              bottom: "40px",
              justifyContent: "center",
              fontSize: "20px",
              color: "#9ca3af",
              fontWeight: "400",
              whiteSpace: "nowrap",
              overflow: "hidden",
              direction: "ltr",
            },
            children: linkPath,
          },
        },
      ],
    },
  };

  const renderIsComplete = fontData !== null && meta !== null;

  return new ImageResponse(element, {
    width: 1200,
    height: 630,
    fonts: fontData
      ? fontData.map((entry) => ({
        name: entry.name,
        data: entry.data,
        weight: 700,
        style: "normal",
      }))
      : [],
    headers: {
      "Cache-Control": renderIsComplete
        ? "public, immutable, no-transform, max-age=31536000, s-maxage=31536000"
        : "public, s-maxage=300, stale-while-revalidate=3600",
    },
  });
}

/**
 * Fetches course metadata + folder/quiz counts via the Supabase PostgREST
 * HTTP API (Edge-safe, fetch-only). Uses relational count queries (Prefer:
 * count=exact HEAD requests) against `folders`/`quizzes` by course_id,
 * matching the approach public/src/shared/quizManifest.js uses client-side —
 * not a manifest re-walk.
 *
 * @param {string} courseId
 * @param {string[]|null} folderPath Raw folder names to walk under the
 *   course (e.g. ["Algebra", "Second"]), or null/[] for the course itself.
 * @returns {Promise<{name:string, breadcrumb:string, folderCount:number, quizCount:number, questionCount:number|null, lastUpdated:string|null}|null>}
 */
async function fetchCourseMeta(courseId, folderPath) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error("[og] Missing SUPABASE_URL or SUPABASE_ANON_KEY");
    return null;
  }

  const headers = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  };

  try {
    const courseUrl = new URL(`${SUPABASE_URL}/rest/v1/courses`);
    courseUrl.searchParams.set("select", "id,name,education_type,college,year,term");
    courseUrl.searchParams.set("id", `eq.${courseId}`);
    courseUrl.searchParams.set("limit", "1");

    const courseRes = await fetch(courseUrl.toString(), { headers });
    if (!courseRes.ok) {
      console.error(`[og] course lookup returned ${courseRes.status}`);
      return null;
    }
    const courseRows = await courseRes.json();
    if (!courseRows || courseRows.length === 0) return null;
    const course = courseRows[0];

    // ── Walk the folder path (if any), matching each segment by raw name ──
    // (render-course.js already resolved the slug → real name server-side
    // before building this /api/og?folder= URL, so here it's an exact-name
    // match at each level — no toSlug needed on this side.)
    let targetFolderId = null;
    let targetName = course.name;
    const breadcrumbParts = [course.name];

    if (Array.isArray(folderPath) && folderPath.length > 0) {
      let parentFolderId = null;
      for (const segment of folderPath) {
        const folderUrl = new URL(`${SUPABASE_URL}/rest/v1/folders`);
        folderUrl.searchParams.set("select", "id,name");
        folderUrl.searchParams.set("course_id", `eq.${courseId}`);
        folderUrl.searchParams.set(
          "parent_folder_id",
          parentFolderId ? `eq.${parentFolderId}` : "is.null",
        );
        folderUrl.searchParams.set("name", `eq.${segment}`);
        folderUrl.searchParams.set("limit", "1");

        const folderRes = await fetch(folderUrl.toString(), { headers });
        if (!folderRes.ok) break;
        const folderRows = await folderRes.json();
        if (!folderRows || folderRows.length === 0) break; // unresolved — fall back to course-level below

        parentFolderId = folderRows[0].id;
        breadcrumbParts.push(folderRows[0].name);
      }
      // Only treat the walk as successful if every segment resolved.
      if (breadcrumbParts.length === folderPath.length + 1) {
        targetFolderId = parentFolderId;
        targetName = breadcrumbParts[breadcrumbParts.length - 1];
      } else {
        breadcrumbParts.length = 1; // reset to course-only breadcrumb
      }
    }

    const countFor = async (table, idColumn) => {
      const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
      url.searchParams.set("select", "id");
      url.searchParams.set(idColumn, `eq.${targetFolderId || courseId}`);
      const res = await fetch(url.toString(), {
        method: "HEAD",
        headers: { ...headers, Prefer: "count=exact" },
      });
      if (!res.ok) return 0;
      const range = res.headers.get("content-range"); // "0-24/123"
      const total = range ? Number(range.split("/")[1]) : 0;
      return Number.isFinite(total) ? total : 0;
    };

    // Direct children only: scoped to the resolved folder via
    // parent_folder_id/folder_id when a folder resolved, otherwise scoped
    // to the whole course via course_id — matching render-course.js's
    // same course-vs-folder count distinction.
    //
    // Run alongside the extra-stats fetch below (Promise.all), not before
    // it — the extra-stats query only depends on targetFolderId/courseId
    // (already resolved above), not on these counts, so there was no real
    // reason for it to wait on this step finishing first. That was an
    // unforced sequential round-trip; folding it into the same parallel
    // batch removes one full network hop from every course/folder request.
    const countsPromise = targetFolderId
      ? Promise.all([
        countFor("folders", "parent_folder_id"),
        countFor("quizzes", "folder_id"),
        countFor("lesson_public", "folder_id"),
      ])
      : Promise.all([
        countFor("folders", "course_id"),
        countFor("quizzes", "course_id"),
        countFor("lesson_public", "course_id"),
      ]);

    // Best-effort extra stats (question count total, last-updated date) —
    // not fatal if this sub-fetch fails. Kicked off in parallel with the
    // counts above (see countsPromise's comment) rather than awaited after.
    const extraStatsPromise = (async () => {
      let questionCount = null;
      let lastUpdated = null;
      try {
        const quizzesUrl = new URL(`${SUPABASE_URL}/rest/v1/quizzes`);
        quizzesUrl.searchParams.set("select", "data,created_at");
        // Scoped to the resolved folder's direct quizzes when a folder path
        // resolved, otherwise the whole course — same distinction as the
        // folderCount/quizCount queries above.
        quizzesUrl.searchParams.set(
          targetFolderId ? "folder_id" : "course_id",
          `eq.${targetFolderId || courseId}`,
        );
        quizzesUrl.searchParams.set("order", "created_at.desc");
        quizzesUrl.searchParams.set("limit", "500");
        const quizzesRes = await fetch(quizzesUrl.toString(), { headers });
        if (quizzesRes.ok) {
          const rows = await quizzesRes.json();
          if (Array.isArray(rows) && rows.length > 0) {
            questionCount = rows.reduce((sum, row) => {
              const qc = row?.data?.stats?.questionCount;
              return sum + (typeof qc === "number" ? qc : 0);
            }, 0);
            const newest = rows[0]?.created_at;
            if (newest) lastUpdated = new Date(newest).toLocaleDateString("en-CA");
          }
        }
      } catch (err) {
        console.error("[og] course extra stats fetch error:", err);
      }
      return { questionCount, lastUpdated };
    })();

    const [[folderCount, quizCount, lessonCount], { questionCount, lastUpdated }] =
      await Promise.all([countsPromise, extraStatsPromise]);

    return {
      // The item this image is actually about — the deepest resolved
      // folder's own name when a folder path was given, otherwise the
      // course's own name. Used as the big title.
      name: targetName || "Course",
      isFolder: targetFolderId !== null,
      // Full "Course / Sub / Sub2" chain — kept for callers that still
      // want the old breadcrumb string (e.g. logs), not used as the
      // title directly anymore (see renderCourseImage).
      breadcrumb: breadcrumbParts.join(" / "),
      // The top-level course's own name — always the *course's*, never
      // the immediate parent folder's, so a folder several levels deep
      // still shows which course it belongs to.
      courseName: course.name,
      // Course-info fields — mirrors buildCourseInfoRows() in
      // course-info-fields.js exactly (التعليم/الكلية/العام/الترم),
      // but read from the raw Supabase row shape (education_type/college/
      // year/term) rather than the client's tree-shaped course object
      // (which calls the same field `faculty`, not `college`). These are
      // always the COURSE's own fields, never the folder's — a folder has
      // no education_type/college/year/term of its own.
      educationType: course.education_type || null,
      college: course.college || null,
      year: course.year != null ? String(course.year) : null,
      term: course.term != null ? String(course.term) : null,
      folderCount,
      quizCount,
      lessonCount,
      questionCount,
      lastUpdated,
    };
  } catch (err) {
    console.error("[og] fetchCourseMeta error:", err);
    return null;
  }
}
// =============================================================================
// Lesson OG image — /api/og?lesson=<id|slug>&v=<n>
// =============================================================================
// Third generator merged into this file (quiz + course + lesson) so the
// project stays inside Vercel Hobby's 12-function cap — no new api/*.js file.
//
// Design: a "reading page" — a tilted paper card on the left previews the
// lesson's real table of contents (first visible section titles, numbered),
// backed by a second sheet for depth. The right column (fixed RTL, same as
// the course image) shows the kind label, the course › folder breadcrumb,
// a up-to-two-line title, a two-line description/excerpt, and a row of stat
// chips (reading time / sections / questions or media). Everything is drawn
// with Satori shapes + inline SVG icons — no emoji, so there are no extra
// Twemoji network round-trips.
//
// Privacy: a password-protected lesson's `content` is NULL in lesson_public,
// so the card falls back to skeleton lines + a lock badge and never leaks
// section titles, excerpts or counts.
//
// Bidi: see lessonTextRun — pure-Arabic runs use renderBidiText(), mixed
// Arabic+digit/Latin runs use sibling tokens (renderBidiChildren pattern).
// Consecutive Latin tokens are merged into one run so "Machine Learning"
// inside an Arabic title keeps its order.
// =============================================================================

const LESSON_ACCENT = "#0d9488"; // teal — lesson identity colour next to BRAND_BLUE
const LESSON_COLUMN = { left: 470, right: 1130 };
const LESSON_COLUMN_WIDTH = LESSON_COLUMN.right - LESSON_COLUMN.left; // 660
const LESSON_WORDS_PER_MINUTE = 180; // conservative — Arabic reads slower than English

/** Inline-SVG icon (Satori renders <svg> nodes natively). */
function lessonIcon(paths, size, color, strokeWidth = 2) {
  return {
    type: "svg",
    props: {
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: color,
      strokeWidth,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      children: paths.map((d) => ({ type: "path", props: { d } })),
    },
  };
}

const LESSON_ICONS = {
  clock: ["M12 6v6l4 2", "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z"],
  layers: ["M12 3 2 8l10 5 10-5-10-5z", "M2 13l10 5 10-5", "M2 17.5l10 5 10-5"],
  help: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1.9-1.1 1.8", "M12 17h.01"],
  image: ["M4 5h16v14H4z", "M4 16l5-5 4 4 3-3 4 4", "M9 9h.01"],
  lock: ["M6 11h12v9H6z", "M8 11V8a4 4 0 0 1 8 0v3"],
  book: ["M5 3h14v18H5z", "M9 3v18", "M12.5 8h3.5", "M12.5 12h3.5"],
  folder: ["M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v8.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5v-11z"],
};

/**
 * Splits text into bidi-safe tokens. Whitespace-separated, but consecutive
 * tokens with no Arabic letters (Latin words, digits, punctuation) are merged
 * into a single run so their internal LTR order survives the row-reverse.
 */
function lessonTokens(text) {
  const out = [];
  let latinRun = null;
  for (const tok of String(text || "").split(/\s+/).filter(Boolean)) {
    const hasArabic = /[؀-ۿݐ-ݿࢠ-ࣿ]/.test(tok);
    if (hasArabic) {
      if (latinRun !== null) { out.push(latinRun); latinRun = null; }
      out.push(tok);
    } else {
      latinRun = latinRun === null ? tok : `${latinRun} ${tok}`;
    }
  }
  if (latinRun !== null) out.push(latinRun);
  return out;
}

/**
 * One single-line, right-anchored text run.
 *  - pure Arabic  → one pre-mirrored string (renderBidiText) — the approach
 *    already proven in prod; sibling tokens measured/painted with uneven gaps.
 *  - pure Latin   → plain string, right-aligned.
 *  - mixed (Arabic + digits/Latin) → sibling token divs in a row-reverse flex
 *    with a gap, the renderBidiChildren() pattern, which dodges the
 *    space-collapse bug documented on renderBidiText().
 */
function lessonTextRun(text, isArabic, style = {}) {
  const fs = parseInt(style.fontSize, 10) || 24;
  const tokens = lessonTokens(text);
  const arabicTok = tokens.filter((t) => /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(t)).length;
  const mixed = arabicTok > 0 && arabicTok < tokens.length;
  const base = { display: "flex", whiteSpace: "nowrap", direction: "ltr", ...style };

  if (!mixed) {
    return {
      type: "div",
      props: {
        style: { ...base, justifyContent: "flex-end", textAlign: "right" },
        children: arabicTok > 0 ? renderBidiText(tokens.join(" "), true) : tokens.join(" "),
      },
    };
  }
  return {
    type: "div",
    props: {
      style: { ...base, flexDirection: "row-reverse", justifyContent: "flex-start", gap: `${Math.round(fs * 0.28)}px` },
      children: tokens.map((tok) => ({ type: "div", props: { style: { display: "flex" }, children: tok } })),
    },
  };
}

/** Greedy word-wrap to at most `maxLines`, ellipsising the overflow. */
function lessonWrap(text, charsPerLine, maxLines) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = "";
  let i = 0;
  for (; i < words.length; i++) {
    const next = cur ? `${cur} ${words[i]}` : words[i];
    if (next.length <= charsPerLine || !cur) {
      cur = next;
    } else {
      lines.push(cur);
      cur = words[i];
      if (lines.length === maxLines) { cur = ""; break; }
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  const truncated = i < words.length;
  if (truncated && lines.length) {
    const last = lines[lines.length - 1];
    lines[lines.length - 1] =
      (last.length > charsPerLine - 1 ? last.slice(0, charsPerLine - 1) : last).trimEnd() + "…";
  }
  // A single over-long word must still respect the line budget.
  return lines.map((l) => (l.length > charsPerLine ? l.slice(0, charsPerLine - 1) + "…" : l));
}

function lessonClamp(text, max) {
  const t = String(text || "").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const sp = cut.lastIndexOf(" ");
  // Prefer a word boundary when it doesn't throw away most of the budget.
  return (sp >= max * 0.5 ? cut.slice(0, sp) : cut).trimEnd() + "…";
}

/**
 * Arabic count phrase as logical-order tokens: 1 → "قسم واحد", 2 → "قسمان",
 * 3–10 → "5 أقسام", 11+ → "12 قسم".
 */
function lessonCount(n, f) {
  if (n === 1) return f.one;
  if (n === 2) return [f.two];
  return [String(n), n <= 10 ? f.few : f.many];
}

/** Plain-text excerpt from the first visible markdown block (OG-safe). */
function lessonExcerpt(sections) {
  for (const s of sections) {
    const b = (s.blocks || []).find((x) => x && x.type === "markdown" && typeof x.body === "string" && x.body.trim());
    if (!b) continue;
    const plain = b.body
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/\$\$[\s\S]*?\$\$/g, " ")
      .replace(/\$[^$\n]*\$/g, " ")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/<[^>]+>/g, " ")
      .replace(/^[#>\-*+\s\d.]+/gm, " ")
      .replace(/[*_`~|]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (plain) return plain;
  }
  return "";
}

/** Derives display stats from the (already visible-only) sections. */
function lessonStats(sections) {
  let words = 0, questions = 0, media = 0, quizzes = 0;
  for (const s of sections) {
    for (const b of s.blocks || []) {
      if (!b) continue;
      if (b.type === "markdown" && typeof b.body === "string") {
        const plain = b.body.replace(/```[\s\S]*?```/g, " ").replace(/[#>*_`~|\[\]()$\\-]/g, " ");
        words += plain.split(/\s+/).filter(Boolean).length;
      } else if (b.type === "question") questions++;
      else if (b.type === "media") media++;
      else if (b.type === "quizRef") quizzes++;
    }
  }
  const questionTotal = questions + quizzes;
  return {
    minutes: Math.max(1, Math.ceil(words / LESSON_WORDS_PER_MINUTE)),
    sectionCount: sections.length,
    questions: questionTotal,
    media,
  };
}

async function fetchLessonOgMeta(idOrSlug) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error("[og] Missing SUPABASE_URL or SUPABASE_ANON_KEY");
    return null;
  }
  const headers = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };
  const get = async (table, params) => {
    const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await fetch(url.toString(), { headers });
    if (!res.ok) { console.error(`[og] ${table} lookup returned ${res.status}`); return null; }
    const rows = await res.json();
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  };

  try {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);
    const lesson = await get("lesson_public", {
      select: "id,slug,title,description,source,course_id,folder_id,content,password_protected,updated_at",
      [isUuid ? "id" : "slug"]: `eq.${idOrSlug}`,
      limit: "1",
    });
    if (!lesson) return null;

    const [course, folder] = await Promise.all([
      lesson.course_id ? get("courses", { select: "name", id: `eq.${lesson.course_id}`, limit: "1" }) : null,
      lesson.folder_id ? get("folders", { select: "name", id: `eq.${lesson.folder_id}`, limit: "1" }) : null,
    ]);

    const protectedLesson = Boolean(lesson.password_protected);
    let sections = [];
    if (!protectedLesson) {
      const c = lesson.content;
      if (typeof c === "string") sections = [{ title: "", blocks: [{ type: "markdown", body: c }] }];
      else if (c && Array.isArray(c.sections)) sections = c.sections.filter((s) => s && !s.defaultHidden);
      else if (c && typeof c.body === "string") sections = [{ title: "", blocks: [{ type: "markdown", body: c.body }] }];
    }

    return {
      id: lesson.id,
      slug: lesson.slug || null,
      title: lesson.title || "",
      description: (lesson.description || "").trim(),
      protectedLesson,
      courseName: course?.name || null,
      folderName: folder?.name || null,
      sectionTitles: sections.map((s) => String(s.title || "").trim()).filter(Boolean),
      stats: protectedLesson ? null : lessonStats(sections),
      excerpt: protectedLesson ? "" : lessonExcerpt(sections),
    };
  } catch (err) {
    console.error("[og] fetchLessonOgMeta error:", err);
    return null;
  }
}

async function renderLessonImage(lessonId) {
  const [fontData, meta] = await Promise.all([
    loadFont().catch((err) => { console.error("[og] lesson font load error:", err); return null; }),
    fetchLessonOgMeta(lessonId),
  ]);

  const rawTitle = meta?.title || "درس على منصة بصمجي";
  const isArabic = !!detectArabic(rawTitle);

  // ── Title: up to two lines, font tier by length ──────────────────────
  const tFont = rawTitle.length <= 14 ? 68 : rawTitle.length <= 34 ? 56 : 46;
  const tCpl = Math.floor(LESSON_COLUMN_WIDTH / (tFont * (isArabic ? 0.62 : 0.6)));
  const titleLines = lessonWrap(rawTitle, tCpl, 2);

  // ── Description: stored description, else first-paragraph excerpt ────
  const descRaw = meta ? (meta.description || meta.excerpt) : "";
  const dFont = 26;
  const descIsArabic = !!detectArabic(descRaw || "ا");
  const descLines = descRaw
    ? lessonWrap(descRaw, Math.floor(LESSON_COLUMN_WIDTH / (dFont * (descIsArabic ? 0.72 : 0.58))), titleLines.length > 1 ? 2 : 3)
    : [];

  // ── Stat chips (max 3) ───────────────────────────────────────────────
  const chips = [];
  if (meta?.stats) {
    const st = meta.stats;
    chips.push({
      icon: "clock", color: BRAND_BLUE,
      tokens: lessonCount(st.minutes, { one: ["دقيقة", "واحدة"], two: "دقيقتان", few: "دقائق", many: "دقيقة" }),
    });
    if (st.sectionCount > 0) {
      chips.push({
        icon: "layers", color: LESSON_ACCENT,
        tokens: lessonCount(st.sectionCount, { one: ["قسم", "واحد"], two: "قسمان", few: "أقسام", many: "قسم" }),
      });
    }
    if (st.questions > 0) {
      chips.push({
        icon: "help", color: "#7c3aed",
        tokens: lessonCount(st.questions, { one: ["سؤال", "واحد"], two: "سؤالان", few: "أسئلة", many: "سؤال" }),
      });
    } else if (st.media > 0) {
      chips.push({
        icon: "image", color: "#d97706",
        tokens: lessonCount(st.media, { one: ["وسيط", "واحد"], two: "وسيطان", few: "وسائط", many: "وسيط" }),
      });
    }
  }

  // ── Breadcrumb: course / folder ──────────────────────────────────────
  const crumbParts = [meta?.courseName, meta?.folderName].filter(Boolean).map((p) => lessonClamp(p, 20));

  // ── Footer link ──────────────────────────────────────────────────────
  const slugSeg = meta ? renderBidiSlugSegment(meta.slug || meta.id) : "";
  const fullLink = `basmagi-quiz.vercel.app/lesson/${slugSeg}`;
  const linkPath = fullLink.length > 90 ? "…" + fullLink.slice(fullLink.length - 89) : fullLink;

  // ── Left "reading page" card ─────────────────────────────────────────
  const tocTitles = meta?.sectionTitles || [];
  const MAX_TOC = 5;
  const shownToc = tocTitles.slice(0, MAX_TOC);
  const extraToc = Math.max(0, tocTitles.length - shownToc.length);

  const skeletonBar = (w, o = 1) => ({
    type: "div",
    props: {
      style: {
        display: "flex", height: "12px", width: w, borderRadius: "6px",
        background: `rgba(15,23,42,${0.09 * o})`,
      },
    },
  });

  const tocRow = (title, i) => {
    const ar = !!detectArabic(title);
    return {
      type: "div",
      props: {
        style: { display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", width: "100%", gap: "12px" },
        children: [
          // Title (left) — number badge (right), RTL reading order.
          {
            type: "div",
            props: {
              style: { display: "flex", flex: "1", justifyContent: "flex-end", overflow: "hidden" },
              children: lessonTextRun(lessonClamp(title, ar ? 21 : 24), ar, {
                fontSize: "21px", fontWeight: "700", color: "#1f2937",
              }),
            },
          },
          {
            type: "div",
            props: {
              style: {
                display: "flex", alignItems: "center", justifyContent: "center",
                width: "34px", height: "34px", borderRadius: "17px", flexShrink: 0,
                background: i === 0 ? LESSON_ACCENT : "rgba(13,148,136,0.12)",
                color: i === 0 ? "#ffffff" : LESSON_ACCENT,
                fontSize: "18px", fontWeight: "700", direction: "ltr",
              },
              children: String(i + 1),
            },
          },
        ],
      },
    };
  };

  const cardBody =
    shownToc.length > 0
      ? [
        ...shownToc.map(tocRow),
        extraToc > 0
          ? {
            type: "div",
            props: {
              style: { display: "flex", justifyContent: "flex-end", width: "100%", marginTop: "4px" },
              children: lessonTextRun(`+ ${extraToc} ${extraToc <= 10 ? "أقسام" : "قسم"} أخرى`, true, {
                fontSize: "19px", color: "#9ca3af", fontWeight: "700",
              }),
            },
          }
          : null,
        ...(shownToc.length < 4
          ? [
            { type: "div", props: { style: { display: "flex", height: "8px" } } },
            skeletonBar("96%", 0.8), skeletonBar("80%"), skeletonBar("90%", 0.8), skeletonBar("58%"),
          ]
          : []),
      ].filter(Boolean)
      : // No titled sections (or protected) — skeleton "text lines" page.
      [
        ...(meta?.protectedLesson
          ? [{
            type: "div",
            props: {
              style: { display: "flex", alignItems: "center", justifyContent: "center", width: "100%", padding: "10px 0 6px" },
              children: [{
                type: "div",
                props: {
                  style: {
                    display: "flex", alignItems: "center", justifyContent: "center",
                    width: "92px", height: "92px", borderRadius: "46px",
                    background: "rgba(217,119,6,0.12)", border: "2px solid rgba(217,119,6,0.35)",
                  },
                  children: lessonIcon(LESSON_ICONS.lock, 46, "#b45309", 2),
                },
              }],
            },
          }]
          : []),
        skeletonBar("100%"), skeletonBar("86%", 0.8), skeletonBar("94%"), skeletonBar("62%", 0.8),
        { type: "div", props: { style: { display: "flex", height: "10px" } } },
        skeletonBar("98%"), skeletonBar("78%", 0.8), skeletonBar("90%"),
      ];

  const pageCard = {
    type: "div",
    props: {
      style: {
        display: "flex", flexDirection: "column", position: "absolute",
        left: `${ICON_CARD.left + 6}px`, top: `${ICON_CARD.top + 6}px`,
        width: `${ICON_CARD.width}px`, height: `${ICON_CARD.height}px`,
        borderRadius: "30px", backgroundColor: "#ffffff", overflow: "hidden",
        boxShadow: "0 30px 60px rgba(15,23,42,0.14)",
        border: "1px solid rgba(15,23,42,0.06)",
        transform: `rotate(${ICON_CARD.rotationDeg}deg)`,
      },
      children: [
        // Header strip — brand gradient with the book icon + label.
        {
          type: "div",
          props: {
            style: {
              display: "flex", flexDirection: "row-reverse", alignItems: "center", gap: "12px",
              padding: "20px 24px", height: "78px",
              backgroundImage: `linear-gradient(135deg, ${BRAND_BLUE} 0%, ${LESSON_ACCENT} 100%)`,
            },
            children: [
              {
                type: "div",
                props: {
                  style: { display: "flex", alignItems: "center", justifyContent: "center", width: "46px", height: "46px", borderRadius: "23px", flexShrink: 0, background: "rgba(255,255,255,0.22)" },
                  children: {
                    type: "div",
                    props: {
                      style: { display: "flex", flexDirection: "row", width: "22px", height: "28px", borderRadius: "4px", background: "#ffffff", overflow: "hidden" },
                      children: [{ type: "div", props: { style: { display: "flex", width: "5px", height: "28px", background: "rgba(13,148,136,0.45)" } } }],
                    },
                  },
                },
              },
              lessonTextRun(shownToc.length > 0 ? "محتوى الدرس" : "صفحة الدرس", true, {
                fontSize: "28px", fontWeight: "700", color: "#ffffff",
              }),
            ],
          },
        },
        {
          type: "div",
          props: {
            style: { display: "flex", flexDirection: "column", gap: "17px", padding: "26px 26px 0", width: "100%" },
            children: cardBody,
          },
        },
      ],
    },
  };

  // Back sheet — peeks out behind the card for a stacked-pages feel.
  const backSheet = {
    type: "div",
    props: {
      style: {
        display: "flex", position: "absolute",
        left: `${ICON_CARD.left - 8}px`, top: `${ICON_CARD.top + 4}px`,
        width: `${ICON_CARD.width}px`, height: `${ICON_CARD.height}px`,
        borderRadius: "30px", backgroundColor: "rgba(0,136,204,0.10)",
        border: "1px solid rgba(0,136,204,0.18)",
        transform: `rotate(${ICON_CARD.rotationDeg + 7}deg)`,
      },
    },
  };

  // ── Right column ─────────────────────────────────────────────────────
  const kindRow = {
    type: "div",
    props: {
      style: { display: "flex", flexDirection: "row-reverse", alignItems: "center", gap: "12px" },
      children: [
        lessonTextRun("درس", true, { fontSize: "26px", color: BRAND_BLUE, fontWeight: "700" }),
        meta?.protectedLesson
          ? {
            type: "div",
            props: {
              style: {
                display: "flex", flexDirection: "row-reverse", alignItems: "center", gap: "8px",
                background: "rgba(245,158,11,0.14)", border: "1px solid rgba(245,158,11,0.4)",
                borderRadius: "8px", padding: "4px 12px",
              },
              children: [
                lessonIcon(LESSON_ICONS.lock, 16, "#b45309", 2.4),
                lessonTextRun("محمي بكلمة مرور", true, { fontSize: "16px", color: "#b45309", fontWeight: "700" }),
              ],
            },
          }
          : null,
      ].filter(Boolean),
    },
  };

  const crumbRow = crumbParts.length
    ? {
      type: "div",
      props: {
        style: { display: "flex", flexDirection: "row-reverse", alignItems: "center", gap: "10px", marginTop: "14px" },
        children: [
          { type: "div", props: { style: { display: "flex", alignItems: "center", justifyContent: "center", width: "28px", height: "28px", flexShrink: 0 }, children: lessonIcon(LESSON_ICONS.folder, 24, "#9ca3af", 2) } },
          ...crumbParts.flatMap((p, i) => [
            i > 0 ? { type: "div", props: { style: { display: "flex", fontSize: "24px", color: "#cbd5e1" }, children: "/" } } : null,
            lessonTextRun(p, !!detectArabic(p), {
              fontSize: "24px", color: i === crumbParts.length - 1 ? "#374151" : "#6b7280", fontWeight: "700",
            }),
          ]).filter(Boolean),
        ],
      },
    }
    : null;

  const titleBlock = {
    type: "div",
    props: {
      style: { display: "flex", flexDirection: "column", alignItems: "flex-end", marginTop: crumbRow ? "18px" : "22px", width: "100%" },
      children: titleLines.map((line) =>
        lessonTextRun(line, isArabic, {
          fontSize: `${tFont}px`, fontWeight: "700", color: "#111827", lineHeight: "1.25", width: "100%",
        }),
      ),
    },
  };

  const descBlock = descLines.length
    ? {
      type: "div",
      props: {
        style: {
          display: "flex", flexDirection: "column", alignItems: "flex-end", marginTop: "20px", width: "100%",
          paddingRight: "18px", borderRight: `4px solid ${LESSON_ACCENT}`, gap: "2px",
        },
        children: descLines.map((line) =>
          lessonTextRun(line, descIsArabic, { fontSize: `${dFont}px`, color: "#4b5563", fontWeight: "400", lineHeight: "1.4", width: "100%" }),
        ),
      },
    }
    : null;

  const chipsRow = chips.length
    ? {
      type: "div",
      props: {
        style: { display: "flex", flexDirection: "row-reverse", alignItems: "center", gap: "14px", marginTop: "30px" },
        children: chips.map((c) => ({
          type: "div",
          props: {
            style: {
              display: "flex", flexDirection: "row-reverse", alignItems: "center", gap: "10px",
              backgroundColor: "#ffffff", border: `1.5px solid ${c.color}33`, borderRadius: "14px",
              padding: "11px 20px", boxShadow: "0 6px 18px rgba(15,23,42,0.06)",
            },
            children: [
              lessonIcon(LESSON_ICONS[c.icon], 28, c.color, 2.2),
              {
                type: "div",
                props: {
                  style: { display: "flex", flexDirection: "row-reverse", gap: "8px", fontSize: "26px", fontWeight: "700", color: "#1f2937", direction: "ltr", whiteSpace: "nowrap" },
                  children: c.tokens.map((t) => ({ type: "div", props: { style: { display: "flex" }, children: t } })),
                },
              },
            ],
          },
        })),
      },
    }
    : null;

  const element = {
    type: "div",
    props: {
      style: {
        display: "flex", width: "100%", height: "100%", position: "relative",
        fontFamily: FONT_FAMILY_STACK, backgroundColor: "#f8fafc",
        backgroundImage:
          "radial-gradient(circle at 0% 0%, rgba(0,136,204,0.13) 0%, rgba(0,136,204,0) 46%), radial-gradient(circle at 100% 100%, rgba(13,148,136,0.12) 0%, rgba(13,148,136,0) 42%)",
      },
      children: [
        // Right-edge identity stripe (brand blue → teal).
        {
          type: "div",
          props: {
            style: {
              display: "flex", position: "absolute", right: "0px", top: "0px", width: "14px", height: "630px",
              backgroundImage: `linear-gradient(180deg, ${BRAND_BLUE} 0%, ${LESSON_ACCENT} 100%)`,
            },
          },
        },
        backSheet,
        pageCard,
        {
          type: "div",
          props: {
            style: {
              display: "flex", flexDirection: "column", alignItems: "flex-end", justifyContent: "center", position: "absolute",
              left: `${LESSON_COLUMN.left}px`, top: "0px", height: "570px", width: `${LESSON_COLUMN_WIDTH}px`,
              direction: "ltr", textAlign: "right",
            },
            children: [kindRow, crumbRow, titleBlock, descBlock, chipsRow].filter(Boolean),
          },
        },
        // Footer link — centered, single line.
        {
          type: "div",
          props: {
            style: {
              display: "flex", position: "absolute", left: "40px", right: "54px", bottom: "36px",
              justifyContent: "center", fontSize: "20px", color: "#9ca3af", fontWeight: "400",
              whiteSpace: "nowrap", overflow: "hidden", direction: "ltr",
            },
            children: linkPath,
          },
        },
      ],
    },
  };

  const renderIsComplete = fontData !== null && meta !== null;

  return new ImageResponse(element, {
    width: 1200,
    height: 630,
    fonts: fontData
      ? fontData.map((entry) => ({ name: entry.name, data: entry.data, weight: 700, style: "normal" }))
      : [],
    headers: {
      "Cache-Control": renderIsComplete
        ? "public, immutable, no-transform, max-age=31536000, s-maxage=31536000"
        : "public, s-maxage=300, stale-while-revalidate=3600",
    },
  });
}

// =============================================================================
// Profile OG image  —  /api/og?profile=<handle>[&v=<hash>]
// =============================================================================
// 1200×630 share card for /@handle. Layout (RTL):
//
//   ┌────────────────────────────────────────────────────────────┐
//   │ [brand pill]                  BANNER (user's thumbnail)    │ 0–260
//   │                                                  ◯ avatar  │
//   │   Name (fit-to-width)                           ━━━━━━━    │
//   │   @handle  · مشرف                          ★ المستوى 12    │
//   │   │ bio, up to two lines                                   │
//   │ [ شارات ] [ النقاط ] [ الامتحانات المرفوعة ]                │ 482–566
//   │               basmagi-quiz.vercel.app/@handle              │
//   └────────────────────────────────────────────────────────────┘
//
// Data comes straight from the public `admin_users` row over Supabase REST
// (RLS "Public can read admin profile fields"), so it works at the edge with
// no supabase-js and no new serverless function.
//
// Robustness: Satori throws (lazily, while the PNG stream is read) on an
// undecodable <img>. Avatar/banner are therefore (a) sniffed by magic bytes
// and only passed through if PNG/JPEG/GIF/SVG, (b) fetched with a timeout and
// size cap when they are URLs, and (c) the whole render is retried once
// without user images (initial-letter avatar + brand gradient banner) if it
// still fails. The finished PNG is palette-quantised (profileOptimizePng) so a
// sharp photo banner stays ~100–150KB. A profile that doesn't exist redirects to the static profile
// thumbnail instead of returning an error image.
// =============================================================================

const PROFILE_DEFAULT_BANNER = "/assets/profile-featured/thumbnails/2.jpg";
const PROFILE_FALLBACK_IMAGE = `${SITE_ORIGIN}/assets/images/thumbnails/profile-thumbnail.png`;
const PROFILE_LOGO_URL = `${SITE_ORIGIN}/assets/images/icon-192.png`;
const PROFILE_GOLD = "#f59e0b";
const PROFILE_IMAGE_MAX_BYTES = 2_500_000;

const PROFILE_ICONS = {
  upload: ["M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", "M17 8l-5-5-5 5", "M12 3v12"],
  zap: ["M13 2 4 14h7l-1 8 9-12h-7l1-8z"],
  award: ["M12 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12z", "M8.2 13.9 7 22l5-3 5 3-1.2-8.1"],
  star: ["M12 2.5 15 9l7 1-5 5 1.3 7L12 18.5 5.7 22 7 15 2 10l7-1z"],
  shield: ["M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"], // same glyphs as profile.js role badges
  code: ["M16 18l6-6-6-6", "M8 6l-6 6 6 6"],
};

// Role badge palette — identical gradients to .role-badge in profile.css.
const PROFILE_ROLES = {
  admin: { label: "مشرف", icon: "shield", from: "#3b82f6", to: "#1e40af", shadow: "rgba(37,99,235,0.40)" },
  developer: { label: "مطور", icon: "code", from: "#a855f7", to: "#6d28d9", shadow: "rgba(109,40,217,0.40)" },
};

// Initial-letter avatar palettes (brand-family gradients), picked by name hash.
const PROFILE_AVATAR_GRADIENTS = [
  ["#0088cc", "#0d9488"],
  ["#7c3aed", "#0088cc"],
  ["#0d9488", "#16a34a"],
  ["#db2777", "#7c3aed"],
  ["#ea580c", "#d97706"],
];

let _profileLogoPromise = null;

function profileFetchTimeout(url, init, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

function profileBytesToBase64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

/** Magic-byte sniff → "image/png" | "image/jpeg" | "image/gif" | "image/svg+xml" | null (WebP etc. unsupported by Satori). */
function profileSniffMime(b) {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 4 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "image/gif";
  const head = String.fromCharCode(...b.subarray(0, 16)).trimStart().toLowerCase();
  if (head.startsWith("<svg") || head.startsWith("<?xml")) return "image/svg+xml";
  return null;
}

/**
 * Turns an avatar/thumbnail value (data URL, site-relative path, or an
 * https URL on our own origin / Supabase storage) into a Satori-safe data URL,
 * or null when it can't be used.
 */
async function profileSafeImage(src) {
  if (!src || typeof src !== "string") return null;
  try {
    if (src.startsWith("data:")) {
      const comma = src.indexOf(",");
      if (comma < 0 || !/;base64$/i.test(src.slice(0, comma))) return null;
      const b64 = src.slice(comma + 1);
      if (b64.length > PROFILE_IMAGE_MAX_BYTES * 1.4) return null;
      const head = Uint8Array.from(atob(b64.slice(0, 24)), (c) => c.charCodeAt(0));
      const mime = profileSniffMime(head);
      return mime ? `data:${mime};base64,${b64}` : null;
    }

    let url;
    if (src.startsWith("/")) url = new URL(src, SITE_ORIGIN);
    else url = new URL(src);
    // Satori cannot decode WebP. Static assets that are (or will be) shipped as
    // .webp for the site keep a .jpg twin next to them for this renderer.
    if (url.origin === new URL(SITE_ORIGIN).origin) url.pathname = url.pathname.replace(/\.webp$/i, ".jpg");
    const allowed = new Set([new URL(SITE_ORIGIN).origin]);
    if (SUPABASE_URL) allowed.add(new URL(SUPABASE_URL).origin);
    if (url.protocol !== "https:" || !allowed.has(url.origin)) return null;

    const res = await profileFetchTimeout(url.toString(), {}, 3000);
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length === 0 || bytes.length > PROFILE_IMAGE_MAX_BYTES) return null;
    const mime = profileSniffMime(bytes);
    return mime ? `data:${mime};base64,${profileBytesToBase64(bytes)}` : null;
  } catch (err) {
    console.error("[og] profile image skipped:", err?.message || err);
    return null;
  }
}

function loadProfileLogo() {
  if (_profileLogoPromise) return _profileLogoPromise;
  _profileLogoPromise = profileFetchTimeout(PROFILE_LOGO_URL, {}, 3000)
    .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(`logo ${res.status}`))))
    .then((buf) => `data:image/png;base64,${profileBytesToBase64(new Uint8Array(buf))}`)
    .catch((err) => {
      console.error("[og] profile logo error:", err);
      _profileLogoPromise = null;
      return null;
    });
  return _profileLogoPromise;
}

/**
 * Developer vs admin. A developer is an admin whose email is in OWNER_EMAILS
 * (same rule as api/admin.js getOwnerEmails / auth.js isOwner). The email is
 * read with the service key, compared here and never leaves this function.
 * Any failure (no env, no key, timeout) degrades to "admin".
 */
async function fetchProfileRole(handle) {
  const owners = (process.env.OWNER_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const serviceKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!owners.length || !serviceKey || !SUPABASE_URL) return "admin";
  try {
    const url = new URL(`${SUPABASE_URL}/rest/v1/admin_users`);
    url.searchParams.set("select", "email");
    url.searchParams.set("handle", `ilike.${handle.replace(/[%_\\*]/g, "\\$&")}`);
    url.searchParams.set("limit", "1");
    const res = await profileFetchTimeout(
      url.toString(),
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
      2500,
    );
    if (!res.ok) return "admin";
    const rows = await res.json();
    const email = String(rows?.[0]?.email || "").trim().toLowerCase();
    return email && owners.includes(email) ? "developer" : "admin";
  } catch (err) {
    console.error("[og] profile role lookup failed:", err?.message || err);
    return "admin";
  }
}

async function fetchProfileOgMeta(handle) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error("[og] Missing SUPABASE_URL or SUPABASE_ANON_KEY");
    return null;
  }
  try {
    const url = new URL(`${SUPABASE_URL}/rest/v1/admin_users`);
    url.searchParams.set(
      "select",
      "display_name,handle,bio,avatar_url,thumbnail_url,current_level,uploaded_quizzes,uploaded_lessons,total_points,total_badges",
    );
    // ilike = case-insensitive like render-profile.js; escape LIKE wildcards
    // ("_" is legal in handles).
    url.searchParams.set("handle", `ilike.${handle.replace(/[%_\\*]/g, "\\$&")}`);
    url.searchParams.set("limit", "1");
    const [res, role] = await Promise.all([
      profileFetchTimeout(
        url.toString(),
        { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } },
        3000,
      ),
      fetchProfileRole(handle),
    ]);
    if (!res.ok) {
      console.error(`[og] admin_users lookup returned ${res.status}`);
      return null;
    }
    const rows = await res.json();
    return Array.isArray(rows) && rows.length ? { ...rows[0], role } : null;
  } catch (err) {
    console.error("[og] fetchProfileOgMeta error:", err);
    return null;
  }
}

function profileHexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function profileFormatCount(n) {
  const v = Math.max(0, Math.floor(Number(n) || 0));
  if (v >= 1_000_000) return `${Math.floor(v / 100_000) / 10}M`;
  return v.toLocaleString("en-US");
}

function profileHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Tiny element helper: every Satori div needs display:flex when it has >1 child. */
function pd(style, children) {
  return { type: "div", props: { style: { display: "flex", ...style }, children } };
}

function profileBannerImage(dataUrl) {
  return {
    type: "img",
    props: {
      src: dataUrl, width: 1200, height: 244,
      style: { position: "absolute", left: "0px", top: "0px", width: "1200px", height: "244px", objectFit: "cover" },
    },
  };
}

/**
 * One right-anchored text line, pre-shaped (see api/_arabicShape.js).
 *
 * Satori still runs its own contextual shaping / bidi reordering on any
 * adjacent Arabic-block characters inside one text node (it swaps neighbouring
 * isolated letters and swallows spaces next to them). So after shaping, every
 * Arabic glyph is placed in its OWN flex item, in final left-to-right order:
 * nothing is left for Satori to re-join or reorder, and each box is exactly
 * one glyph wide. Latin/digit runs stay together as one text node.
 */
const PROFILE_ARABIC_GLYPH = /[\u0600-\u06ff\ufb50-\ufdff\ufe70-\ufeff]/;

function profileText(text, style = {}) {
  const fs = parseInt(style.fontSize, 10) || 24;
  const visual = Array.from(toVisual(text));
  const children = [];
  let latin = "";
  const flush = () => {
    if (latin) children.push({ type: "div", props: { style: { display: "flex" }, children: latin } });
    latin = "";
  };
  for (const ch of visual) {
    if (ch === " ") {
      flush();
      children.push({ type: "div", props: { style: { display: "flex", width: `${Math.round(fs * 0.26)}px`, height: "1px", flexShrink: 0 } } });
    } else if (PROFILE_ARABIC_GLYPH.test(ch)) {
      flush();
      children.push({ type: "div", props: { style: { display: "flex" }, children: ch } });
    } else {
      latin += ch;
    }
  }
  flush();
  return {
    type: "div",
    props: {
      style: {
        display: "flex", flexDirection: "row", direction: "ltr", whiteSpace: "nowrap",
        justifyContent: "flex-end", alignItems: "baseline", ...style,
      },
      children,
    },
  };
}

function buildProfileElement({ meta, avatar, banner, logo }) {
  const handle = String(meta.handle || "").toLowerCase();
  const nameRaw = String(meta.display_name || meta.handle || "").replace(/\s+/g, " ").trim();
  const nameAr = !!detectArabic(nameRaw);
  const level = Math.max(1, Math.floor(Number(meta.current_level) || 1));

  // ── Name: biggest tier that fits one line in the identity column ──────────
  const COL_LEFT = 64;
  const COL_RIGHT = 868; // 1200 − (avatar ring 232 + right gap 60 + gutter 40)
  const COL_W = COL_RIGHT - COL_LEFT;
  const nameFactor = nameAr ? 0.62 : 0.58;
  let nFont = 60;
  for (const f of [60, 54, 48, 42, 36]) {
    nFont = f;
    if (nameRaw.length <= Math.floor(COL_W / (f * nameFactor))) break;
  }
  const nameText = lessonClamp(nameRaw, Math.floor(COL_W / (nFont * nameFactor)));

  // ── Bio: up to two lines ─────────────────────────────────────────────────
  const bioRaw = String(meta.bio || "").replace(/\s+/g, " ").trim();
  const hasBio = bioRaw.length > 0;
  const bioText = hasBio
    ? bioRaw
    : meta.role === "developer"
      ? "ضمن فريق تطوير منصة امتحانات بصمجي"
      : "مشرف يساهم بالمحتوى التعليمي على منصة امتحانات بصمجي";
  const bioAr = !!detectArabic(bioText);
  const bFont = 25;
  const bioLines = lessonWrap(bioText, Math.floor((COL_W - 22) / (bFont * (bioAr ? 0.74 : 0.58))), 2);

  // ── Banner ───────────────────────────────────────────────────────────────
  const bannerLayers = [
    banner ? profileBannerImage(banner) : null,
    pd({
      position: "absolute", left: "0px", top: "0px", width: "1200px", height: "244px",
      backgroundImage: banner
        ? "linear-gradient(180deg, rgba(6,14,34,0.62) 0%, rgba(6,14,34,0.12) 48%, rgba(6,14,34,0.50) 100%)"
        : "linear-gradient(120deg, #0a3552 0%, #0088cc 58%, #0d9488 100%)",
    }),
    // Brand accent line where banner meets the card body.
    pd({
      position: "absolute", left: "0px", top: "238px", width: "1200px", height: "6px",
      backgroundImage: `linear-gradient(90deg, ${BRAND_BLUE} 0%, ${LESSON_ACCENT} 100%)`,
    }),
  ].filter(Boolean);

  // Platform mark (top-left of banner): logo only, in a round glass badge.
  const brandPill = pd({
    position: "absolute", left: "34px", top: "26px", width: "88px", height: "88px", borderRadius: "44px",
    alignItems: "center", justifyContent: "center",
    background: "rgba(6,14,34,0.50)", border: "2px solid rgba(255,255,255,0.34)",
    boxShadow: "0 10px 28px rgba(0,0,0,0.30)",
  }, logo
    ? { type: "img", props: { src: logo, width: 68, height: 68, style: { width: "68px", height: "68px", borderRadius: "34px" } } }
    : pd({ width: "68px", height: "68px", borderRadius: "34px", background: BRAND_BLUE }));

  // ── Avatar (gradient ring + white gap) ───────────────────────────────────
  const AV = { outer: 232, right: 60, top: 126 };
  const [g1, g2] = PROFILE_AVATAR_GRADIENTS[profileHash(handle) % PROFILE_AVATAR_GRADIENTS.length];
  const initial = Array.from(nameRaw || handle)[0] || "؟";
  const avatarFace = avatar
    ? { type: "img", props: { src: avatar, width: 210, height: 210, style: { width: "210px", height: "210px", borderRadius: "105px", objectFit: "cover" } } }
    : pd({
      width: "210px", height: "210px", borderRadius: "105px", alignItems: "center", justifyContent: "center",
      backgroundImage: `linear-gradient(135deg, ${g1} 0%, ${g2} 100%)`,
      color: "#ffffff", fontSize: "104px", fontWeight: "700",
    }, initial);

  const avatarGlow = pd({
    position: "absolute", right: `${AV.right - 70}px`, top: `${AV.top - 70}px`,
    width: `${AV.outer + 140}px`, height: `${AV.outer + 140}px`, borderRadius: "999px",
    backgroundImage: "radial-gradient(circle, rgba(0,136,204,0.20) 0%, rgba(0,136,204,0) 68%)",
  });

  const avatarRing = pd({
    position: "absolute", right: `${AV.right}px`, top: `${AV.top}px`,
    width: `${AV.outer}px`, height: `${AV.outer}px`, borderRadius: "116px",
    alignItems: "center", justifyContent: "center",
    backgroundImage: `linear-gradient(135deg, ${BRAND_BLUE} 0%, ${LESSON_ACCENT} 100%)`,
    boxShadow: "0 22px 44px rgba(15,23,42,0.28)",
  }, pd({
    width: "220px", height: "220px", borderRadius: "110px", background: "#ffffff",
    alignItems: "center", justifyContent: "center",
  }, avatarFace));

  // ── Level medal straddling the avatar's lower edge ───────────────────────
  const PILL_W = 244;
  const avatarCx = 1200 - AV.right - AV.outer / 2;
  // Children are absolutely placed: Satori under-measures Arabic runs, so a
  // flow layout lets the digits collide with the label.
  const levelPill = pd({
    position: "absolute", left: `${avatarCx - PILL_W / 2}px`, top: `${AV.top + AV.outer - 30}px`,
    width: `${PILL_W}px`, height: "54px", borderRadius: "27px",
    backgroundImage: "linear-gradient(135deg, #fde68a 0%, #f59e0b 55%, #d97706 100%)",
    border: "4px solid #ffffff", boxShadow: "0 12px 26px rgba(180,83,9,0.35)",
  }, [
    pd({ position: "absolute", right: "14px", top: "11px" }, lessonIcon(PROFILE_ICONS.star, 24, "#3b2300", 2.4)),
    pd({ position: "absolute", right: "46px", top: "7px", width: "120px", justifyContent: "flex-end" },
      profileText("المستوى", { fontSize: "25px", fontWeight: "700", color: "#3b2300" })),
    pd({
      position: "absolute", left: "8px", top: "5px", width: "40px", height: "36px", borderRadius: "18px",
      alignItems: "center", justifyContent: "center", background: "#ffffff",
      fontSize: level >= 100 ? "20px" : "25px", fontWeight: "700", color: "#92400e", direction: "ltr",
    }, String(level)),
  ]);

  // ── Identity column ──────────────────────────────────────────────────────
  const nameRow = profileText(nameText, {
    fontSize: `${nFont}px`, fontWeight: "700", color: "#0f172a", lineHeight: "1.2", width: "100%",
  });

  const handleChip = pd({
    flexDirection: "row", alignItems: "center", padding: "3px 18px", borderRadius: "999px",
    background: profileHexA(BRAND_BLUE, 0.10), border: `1.5px solid ${profileHexA(BRAND_BLUE, 0.30)}`,
    color: BRAND_BLUE, fontSize: "27px", fontWeight: "700", direction: "ltr", whiteSpace: "nowrap",
  }, `@${handle.length > 24 ? handle.slice(0, 23) + "…" : handle}`);

  const role = PROFILE_ROLES[meta.role === "developer" ? "developer" : "admin"];
  const adminChip = pd({
    flexDirection: "row-reverse", alignItems: "center", gap: "9px", padding: "4px 18px 4px 14px", borderRadius: "999px",
    backgroundImage: `linear-gradient(135deg, ${role.from} 0%, ${role.to} 100%)`,
    boxShadow: `0 6px 14px ${role.shadow}`,
  }, [
    lessonIcon(PROFILE_ICONS[role.icon], 24, "#ffffff", 2.5),
    profileText(role.label, { fontSize: "24px", fontWeight: "700", color: "#ffffff" }),
  ]);

  const badgeRow = pd({ flexDirection: "row-reverse", alignItems: "center", gap: "12px", marginTop: "6px" }, [handleChip, adminChip]);

  const bioBlock = pd({
    flexDirection: "column", alignItems: "flex-end", width: "100%", marginTop: "14px",
    paddingRight: "18px", borderRight: `4px solid ${hasBio ? LESSON_ACCENT : "#cbd5e1"}`, gap: "2px",
  }, bioLines.map((line) =>
    profileText(line, {
      fontSize: `${bFont}px`, color: hasBio ? "#475569" : "#94a3b8", fontWeight: "400", lineHeight: "1.4", width: "100%",
    }),
  ));

  const identity = pd({
    position: "absolute", left: `${COL_LEFT}px`, top: "262px", width: `${COL_W}px`,
    flexDirection: "column", alignItems: "flex-end", direction: "ltr", textAlign: "right",
  }, [nameRow, badgeRow, bioBlock]);

  // ── Stat tiles ───────────────────────────────────────────────────────────
  const tile = (icon, color, value, label) =>
    pd({
      flex: "1", flexDirection: "row-reverse", alignItems: "center", gap: "14px", height: "80px",
      padding: "0 20px", backgroundColor: "#ffffff", border: `1.5px solid ${profileHexA(color, 0.22)}`,
      borderRadius: "22px", boxShadow: "0 10px 24px rgba(15,23,42,0.07)", overflow: "hidden",
    }, [
      pd({
        width: "54px", height: "54px", borderRadius: "27px", flexShrink: 0,
        alignItems: "center", justifyContent: "center", background: profileHexA(color, 0.12),
      }, lessonIcon(icon, 28, color, 2.2)),
      pd({ flexDirection: "column", alignItems: "flex-end", flex: "1" }, [
        pd({ fontSize: "34px", fontWeight: "700", color: "#0f172a", direction: "ltr", lineHeight: "1.1" }, value),
        profileText(label, { fontSize: "20px", color: "#64748b", fontWeight: "700" }),
      ]),
    ]);

  const stats = pd({
    position: "absolute", left: "60px", right: "60px", top: "490px", flexDirection: "row-reverse", gap: "20px",
  }, [
    tile(PROFILE_ICONS.upload, BRAND_BLUE, // Quizzes + lessons in one tile: a 4th tile would not fit the card width.
    profileFormatCount((Number(meta.uploaded_quizzes) || 0) + (Number(meta.uploaded_lessons) || 0)), "المحتوى المرفوع"),
    tile(PROFILE_ICONS.zap, "#d97706", profileFormatCount(meta.total_points), "النقاط"),
    tile(PROFILE_ICONS.award, "#7c3aed", profileFormatCount(meta.total_badges), "الشارات"),
  ]);

  const footer = pd({
    position: "absolute", left: "40px", right: "40px", bottom: "16px", justifyContent: "center",
    fontSize: "20px", color: "#94a3b8", fontWeight: "400", whiteSpace: "nowrap", direction: "ltr",
  }, `basmagi-quiz.vercel.app/@${handle.length > 40 ? handle.slice(0, 39) + "…" : handle}`);

  return pd({
    width: "100%", height: "100%", position: "relative", fontFamily: FONT_FAMILY_STACK, backgroundColor: "#f8fafc",
    backgroundImage:
      "radial-gradient(circle at 0% 100%, rgba(13,148,136,0.12) 0%, rgba(13,148,136,0) 42%), radial-gradient(circle at 100% 100%, rgba(0,136,204,0.10) 0%, rgba(0,136,204,0) 40%)",
  }, [...bannerLayers, brandPill, avatarGlow, avatarRing, levelPill, identity, stats, footer]);
}

/** Renders to PNG bytes inside try/catch — Satori errors surface while reading, not on construction. */
async function profileRenderPng(element, fontData) {
  try {
    const res = new ImageResponse(element, {
      width: 1200,
      height: 630,
      fonts: fontData
        ? fontData.map((f) => ({ name: f.name, data: f.data, weight: 700, style: "normal" }))
        : [],
    });
    return await res.arrayBuffer();
  } catch (err) {
    console.error("[og] profile render failed:", err);
    return null;
  }
}

/**
 * ImageResponse can only emit 24-bit PNG, and a photo banner makes that
 * 450–700KB (WhatsApp previews get unreliable above ~300KB). Re-encoding to a
 * 256-colour palette PNG (UPNG's quantiser) keeps the banner fully sharp at
 * ~100–150KB. Loaded lazily and wrapped in try/catch: if the library or the
 * quantiser ever fails, the original PNG is served unchanged.
 */
async function profileOptimizePng(pngBuffer) {
  try {
    const UPNG = (await import("upng-js")).default;
    const img = UPNG.decode(pngBuffer);
    const rgba = UPNG.toRGBA8(img)[0];
    const out = UPNG.encode([rgba], img.width, img.height, 256);
    return out.byteLength > 0 && out.byteLength < pngBuffer.byteLength ? out : pngBuffer;
  } catch (err) {
    console.error("[og] png optimise skipped:", err?.message || err);
    return pngBuffer;
  }
}

async function renderProfileImage(handleRaw, version) {
  const handle = String(handleRaw || "").trim().toLowerCase();
  const fallback = () =>
    new Response(null, {
      status: 302,
      headers: { Location: PROFILE_FALLBACK_IMAGE, "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600" },
    });
  if (!/^[a-z0-9_-]{1,64}$/.test(handle)) return fallback();

  const [fontData, meta, logo] = await Promise.all([
    loadFont().catch((err) => { console.error("[og] profile font load error:", err); return null; }),
    fetchProfileOgMeta(handle),
    loadProfileLogo(),
  ]);
  if (!meta) return fallback();

  const [avatar, banner] = await Promise.all([
    profileSafeImage(meta.avatar_url),
    profileSafeImage(meta.thumbnail_url || PROFILE_DEFAULT_BANNER),
  ]);

  let png = await profileRenderPng(buildProfileElement({ meta, avatar, banner, logo }), fontData);
  let degraded = false;
  if (!png && (avatar || banner)) {
    degraded = true;
    png = await profileRenderPng(buildProfileElement({ meta, avatar: null, banner: null, logo }), fontData);
  }
  if (!png) return fallback();
  png = await profileOptimizePng(png);

  // With ?v=<content hash> (render-profile.js changes it whenever the profile
  // changes) the URL is immutable; without it, revalidate hourly.
  const complete = fontData !== null && !degraded && Boolean(avatar || !meta.avatar_url) && Boolean(banner);
  const cache = complete && version && /^[a-z0-9]{4,32}$/i.test(version)
    ? "public, immutable, no-transform, max-age=31536000, s-maxage=31536000"
    : complete
      ? "public, s-maxage=3600, stale-while-revalidate=86400"
      : "public, s-maxage=300, stale-while-revalidate=3600";

  return new Response(png, { headers: { "Content-Type": "image/png", "Cache-Control": cache } });
}
