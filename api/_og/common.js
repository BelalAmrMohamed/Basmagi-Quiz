// =============================================================================
// api/_og/common.js
// Shared helpers for the OG image generators (fonts, Arabic/bidi text, icons,
// Supabase REST, PNG rendering). Underscore-prefixed folder => NOT a Vercel
// function, so it costs nothing against the Hobby 12-function cap.
// =============================================================================
import { ImageResponse } from "@vercel/og";
import { toVisual, hasArabic } from "../_arabicShape.js";

// ── Supabase REST config (Edge-safe, no supabase-js needed) ──────────────────
export const SUPABASE_URL = process.env.SUPABASE_URL;

export const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

// ── Brand constants ──────────────────────────────────────────────────────────
export const BRAND_BLUE = "#0088cc";

// IMPORTANT: VERCEL_URL is the ephemeral, deployment-specific *.vercel.app
// domain (different for every deploy), not the stable production domain.
// Depending on project settings, unauthenticated requests to that domain can
// be redirected/gated, causing internal fetch() calls below (manifest,
// background image) to silently receive an HTML page instead of the real
// asset — this is what broke the manifest fetch. Always prefer the known
// production origin; set SITE_ORIGIN as an env var if this ever needs to
// point elsewhere (e.g. a genuine staging domain).
export const SITE_ORIGIN = process.env.SITE_ORIGIN || "https://basmagi.vercel.app";

// ── Font (self-hosted Tajawal Bold) ──────────────────────────────────────────
// Served from our own origin (public/assets/fonts/Tajawal-Bold.ttf, OFL
// licence alongside it) instead of scraping Google Fonts CSS with a spoofed
// Android User-Agent. One TTF covers Latin + Arabic, so a single family name
// is enough (no per-script subsets / fallback stacks any more).
//
// @vercel/og's font parser supports TTF/OTF/WOFF but NOT WOFF2.
const FONT_URL = `${SITE_ORIGIN}/assets/fonts/Tajawal-Bold.ttf`;
export const FONT_FAMILY = "Tajawal";
export const FONT_FAMILY_STACK = FONT_FAMILY;

let _fontDataPromise = null;

/** @returns {Promise<{name:string, data:ArrayBuffer}[]>} cached across warm invocations */
export function loadFont() {
  if (_fontDataPromise) return _fontDataPromise;
  _fontDataPromise = fetch(FONT_URL)
    .then((res) => {
      if (!res.ok) throw new Error(`[og] font fetch returned ${res.status}`);
      return res.arrayBuffer();
    })
    .then((data) => [{ name: FONT_FAMILY, data }])
    .catch((err) => {
      _fontDataPromise = null; // don't cache a failure
      throw err;
    });
  return _fontDataPromise;
}

// ── Shared palette ───────────────────────────────────────────────────────────
export const TEAL = "#0d9488";

// ── Supabase REST (Edge-safe) ────────────────────────────────────────────────
/** GET one row from a PostgREST table; null on any failure / no row. */
export async function sbGetOne(table, params) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error("[og] Missing SUPABASE_URL or SUPABASE_ANON_KEY");
    return null;
  }
  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
  });
  if (!res.ok) { console.error(`[og] ${table} lookup returned ${res.status}`); return null; }
  const rows = await res.json();
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── PNG rendering with a safety net ──────────────────────────────────────────
const CACHE_COMPLETE = "public, immutable, no-transform, max-age=31536000, s-maxage=31536000";
const CACHE_INCOMPLETE = "public, s-maxage=300, stale-while-revalidate=3600";

/**
 * Renders `element` to a 1200×630 PNG.
 *
 * ImageResponse renders lazily (errors surface while the body is read, after
 * the handler has already returned), so we read the bytes HERE inside a
 * try/catch. On any failure the caller gets a short-cached 302 to a static
 * thumbnail instead of a 500 / broken image.
 *
 * `complete` = fonts + data all loaded → cache for a year (URL is versioned);
 * otherwise cache briefly so the next request can retry.
 */
export async function renderPng(element, fontData, { complete = true, fallback = "/assets/images/thumbnails/thumbnail.png" } = {}) {
  try {
    const img = new ImageResponse(element, {
      width: 1200,
      height: 630,
      fonts: fontData
        ? fontData.map((e) => ({ name: e.name, data: e.data, weight: 700, style: "normal" }))
        : [],
    });
    const bytes = await img.arrayBuffer();
    return new Response(bytes, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": complete ? CACHE_COMPLETE : CACHE_INCOMPLETE,
      },
    });
  } catch (err) {
    console.error("[og] render failed, serving static fallback:", err);
    return new Response(null, {
      status: 302,
      headers: { Location: `${SITE_ORIGIN}${fallback}`, "Cache-Control": "public, s-maxage=60" },
    });
  }
}

export function detectArabic(text) {
  const firstLetter = text.match(/\p{L}/u);
  return (
    firstLetter &&
    /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(firstLetter[0])
  );
}

/**
 * Arabic-safe text run — the SAME technique the /@handle card uses (see
 * profileText, bottom of this file), shared by every OG card.
 *
 * Satori runs its own contextual shaping / bidi reordering on any adjacent
 * Arabic-block characters inside one text node, which swaps neighbouring
 * letters and swallows or stretches spaces (the uneven word spacing). So the
 * text is shaped + reordered ahead of time (api/_arabicShape.js → toVisual)
 * and every Arabic glyph is placed in its OWN flex item in final
 * left-to-right order; spaces become fixed-width spacers; Latin/digit runs
 * stay together as one text node. Nothing is left for Satori to re-join.
 *
 * Returns ONE wrapper element. It sets no font styles (size/colour/weight are
 * inherited from the parent) and spacer widths are in `em`, so it can be
 * dropped into any existing text container as its only child.
 */
const SHAPED_ARABIC_GLYPH = /[\u0600-\u06ff\ufb50-\ufdff\ufe70-\ufeff]/;

/** Plain string for non-Arabic text, a pre-shaped run (as children) otherwise. */
export function txt(text) {
  const str = String(text ?? "");
  return hasArabic(str) ? [shapedRun(str)] : str;
}

export function shapedRun(text) {
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
      children.push({ type: "div", props: { style: { display: "flex", width: "0.26em", height: "1px", flexShrink: 0 } } });
    } else if (SHAPED_ARABIC_GLYPH.test(ch)) {
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
      style: { display: "flex", flexDirection: "row", direction: "ltr", whiteSpace: "nowrap", alignItems: "baseline", flexShrink: 0 },
      children,
    },
  };
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
export function renderBidiText(text, isArabic) {
  if (text && hasArabic(text)) return [shapedRun(text)];
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
export function renderBidiChildren(text, isArabic, { noShrink = false } = {}) {
  if (!text) return [];
  if (hasArabic(text)) return [shapedRun(text)];
  const tokens = isArabic ? tokenizeBidiText(text) : text.split(" ");
  return tokens.map((tok) => ({
    type: "div",
    // noShrink: in a nowrap row, flex items otherwise shrink below their
    // content width when the line is too long, squashing words together.
    props: { style: noShrink ? { display: "flex", flexShrink: 0 } : { display: "flex" }, children: tok },
  }));
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
export function renderBidiSlugSegment(segment) {
  // The footer link is now pre-shaped by shapedRun()/toVisual (real bidi), so
  // segments must stay in LOGICAL order — pre-reversing them would flip twice.
  if (true) return segment;
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

/**
 * Truncates an overly long title so it can never overflow the fixed-width
 * text column or collide with the bulb graphic / button, even after the
 * font-size shrink rule in the handler. maxChars must match whichever of
 * TITLE_MAX_CHARS_ARABIC/LATIN corresponds to the title's detected script,
 * since the two scripts have very different safe character budgets.
 */
export function truncateTitle(title, maxChars) {
  if (!title || title.length <= maxChars) return title;
  return title.slice(0, maxChars - 1).trimEnd() + "…";
}

// Icon card geometry — deliberately matching the quiz thumbnail's own bulb
// card bounds (x 0–408, y 25–490 on the 1200×630 canvas — see the header
// comment at the top of this file) so course/folder images share the same
// visual rhythm as quiz images despite having no shared background asset.
export const ICON_CARD = { left: 24, top: 25, width: 380, height: 465, rotationDeg: -6 };

/** Inline-SVG icon (Satori renders <svg> nodes natively). */
export function svgIcon(paths, size, color, strokeWidth = 2) {
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

export const ICONS = {
  clock: ["M12 6v6l4 2", "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z"],
  layers: ["M12 3 2 8l10 5 10-5-10-5z", "M2 13l10 5 10-5", "M2 17.5l10 5 10-5"],
  help: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1.9-1.1 1.8", "M12 17h.01"],
  image: ["M4 5h16v14H4z", "M4 16l5-5 4 4 3-3 4 4", "M9 9h.01"],
  lock: ["M6 11h12v9H6z", "M8 11V8a4 4 0 0 1 8 0v3"],
  book: ["M5 3h14v18H5z", "M9 3v18", "M12.5 8h3.5", "M12.5 12h3.5"],
  cap: ["M22 10 12 5 2 10l10 5 10-5z", "M6 12v5c3 3 9 3 12 0v-5", "M22 10v6"],
  play: ["M7 4l13 8-13 8z"],
  code: ["M16 18l6-6-6-6", "M8 6l-6 6 6 6"],
  folder: ["M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v8.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5v-11z"],
};

/**
 * Splits text into bidi-safe tokens. Whitespace-separated, but consecutive
 * tokens with no Arabic letters (Latin words, digits, punctuation) are merged
 * into a single run so their internal LTR order survives the row-reverse.
 */
function splitBidiTokens(text) {
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
export function textRun(text, isArabic, style = {}) {
  const fs = parseInt(style.fontSize, 10) || 24;
  const tokens = splitBidiTokens(text);
  const arabicTok = tokens.filter((t) => /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(t)).length;
  const mixed = arabicTok > 0 && arabicTok < tokens.length;
  const base = { display: "flex", whiteSpace: "nowrap", direction: "ltr", ...style };

  if (arabicTok > 0) {
    // Any Arabic (pure or mixed with digits/Latin): one pre-shaped run — see shapedRun().
    return {
      type: "div",
      props: {
        style: { ...base, justifyContent: "flex-end", textAlign: "right" },
        children: [shapedRun(tokens.join(" "))],
      },
    };
  }
  if (!mixed) {
    return {
      type: "div",
      props: {
        style: { ...base, justifyContent: "flex-end", textAlign: "right" },
        children: tokens.join(" "),
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
export function wrapText(text, charsPerLine, maxLines) {
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

export function clampText(text, max) {
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
export function arabicCount(n, f) {
  if (n === 1) return f.one;
  if (n === 2) return [f.two];
  return [String(n), n <= 10 ? f.few : f.many];
}

