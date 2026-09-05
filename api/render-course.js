// =============================================================================
// api/render-course.js
//
// Serverless function (Node.js runtime) that handles all requests to
// /course/:name. Mirrors render-quiz.js's structure (Supabase lookup, HTML
// template read + meta-tag injection, caching headers) but differs in one
// key way: course pages are NOT a separate HTML file — they render inside
// the existing SPA (public/index.html), so this function injects OG tags
// and a data-island into index.html itself rather than a dedicated template,
// and index.html's own client-side router (navigation.js) takes over from
// there to actually render the course view.
//
// What it does:
//   1. Reads the course name from :name (injected by the vercel.json rewrite).
//   2. Looks up the course by name (+ education_type disambiguation via
//      ?education_type= if present) in the `courses` table.
//   3. Counts folders + quizzes under that course via relational count
//      queries against `folders`/`quizzes` (course_id), NOT the old
//      manifest-walk approach (see public/src/shared/quizManifest.js).
//   4. Reads the raw public/index.html template from disk.
//   5. Injects og:title, og:description, og:image (-> /api/og-course),
//      canonical URL, and a <meta name="course:*"> data-island for the
//      client SPA (navigation.js) to hydrate the correct view from.
//   6. Returns the modified HTML with edge-cache headers.
//
// URL contract:
//   /course/NAME  →  (vercel.json rewrite)  →  /api/render-course?name=NAME
//   Browser URL stays /course/NAME. navigation.js reads the course id from
//   <meta name="course:id"> to render the right view without a hash.
// =============================================================================

import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
);

// index.html is the SPA shell — course pages render inside it, not a
// separate template (see quiz.html for contrast with render-quiz.js).
const TEMPLATE_PATH = path.join(process.cwd(), "public", "index.html");

// Bump when /api/og's course-image layout changes, to bust platforms' cache.
const OG_IMAGE_VERSION = 1;

const SITE_ORIGIN = "https://basmagi-quiz.vercel.app";

// Mirrors public/src/features/home/slug-utils.js's toSlug() exactly (kept in
// sync manually — this is a Node serverless function and can't import an ES
// module from public/src). Converts a display name to the same URL slug the
// client builds, so /course/:name can use readable dashes (e.g.
// "Data-Structures-and-Algorithms") instead of raw percent-encoded spaces.
function toSlug(str) {
    return str.trim().replace(/-/g, "--").replace(/\s+/g, "-");
}

// =============================================================================
// Handler
// =============================================================================
export default async function handler(req, res) {
    if (req.method !== "GET" && req.method !== "HEAD") {
        return res.status(405).end();
    }

    const name = req.query.name;
    if (!name || typeof name !== "string" || name.trim() === "") {
        return res.redirect(302, "/");
    }

    // :name is a URL slug (dashes, e.g. "Data-Structures-and-Algorithms"),
    // NOT the raw course name — resolved against courses' toSlug(name) in
    // fetchCourseMeta(), same case/slug-insensitive approach the client's
    // navigation.js uses for hash-based routing.
    const courseSlug = decodeURIComponent(name.trim());
    const educationType =
        typeof req.query.education_type === "string" ? req.query.education_type : null;

    // ── 1. Fetch course metadata + counts from Supabase ───────────────────────
    let meta = null;
    try {
        meta = await fetchCourseMeta(courseSlug, educationType);
    } catch (err) {
        console.error("[render-course] Supabase lookup failed:", err);
    }

    // ── 2. Read the SPA shell template ─────────────────────────────────────────
    let html;
    try {
        html = fs.readFileSync(TEMPLATE_PATH, "utf8");
    } catch (err) {
        console.error("[render-course] Could not read index.html:", err);
        return res.status(500).send("Internal Server Error");
    }

    if (!meta) {
        // Unknown course slug — let the SPA load normally (it will fall back to
        // the root view client-side once navigation.js fails to resolve it) but
        // still inject the raw slug so the client can retry after the manifest
        // loads, and never cache a miss.
        html = html.replace(
            "</head>",
            `  <meta name="course:name" content="${escapeHtml(courseSlug)}">\n</head>`,
        );
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        return res.status(200).send(html);
    }

    // ── 3. Inject data-island meta tags for the client SPA to hydrate from ────
    html = html.replace(
        "</head>",
        `  <meta name="course:id" content="${escapeHtml(meta.id)}">\n` +
        `  <meta name="course:name" content="${escapeHtml(meta.name)}">\n</head>`,
    );

    // ── 4. Inject OG / title / canonical tags ─────────────────────────────────
    const title = buildTitle(meta);
    const description = buildDescription(meta);
    const canonicalUrl = `${SITE_ORIGIN}/course/${toSlug(meta.name)}`;
    // /api/og handles both quizId= and course= — see that file's handler()
    // dispatch comment for why these two Edge OG generators share one function.
    const ogImageUrl = `${SITE_ORIGIN}/api/og?course=${encodeURIComponent(meta.id)}&v=${OG_IMAGE_VERSION}`;

    html = html.replace(
        /<title>[^<]*<\/title>/i,
        `<title>${escapeHtml(title)}</title>`,
    );

    html = replaceLinkHref(html, "canonical", canonicalUrl);

    html = replaceMetaContent(html, "property", "og:title", title);
    html = replaceMetaContent(html, "property", "og:url", canonicalUrl);
    html = replaceMetaContent(html, "property", "og:image", ogImageUrl);
    html = replaceMetaContent(html, "property", "og:description", description);

    html = replaceMetaContent(html, "name", "twitter:title", title);
    html = replaceMetaContent(html, "name", "twitter:image", ogImageUrl);
    html = replaceMetaContent(html, "name", "twitter:image:alt", title);
    html = replaceMetaContent(html, "name", "twitter:description", description);

    html = replaceMetaContent(html, "name", "description", description);

    // ── 5. Respond ─────────────────────────────────────────────────────────────
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader(
        "Cache-Control",
        "public, s-maxage=3600, stale-while-revalidate=86400",
    );
    return res.status(200).send(html);
}

// =============================================================================
// Data fetching
// =============================================================================

/**
 * Fetches a course by URL slug and its folder/quiz counts.
 * Courses aren't guaranteed globally unique by name (the real uniqueness key
 * is (education_type, college, year, term, name) — see
 * api/_courseFolders.js), so this fetches all courses' (id, name,
 * education_type) and matches toSlug(name) against the incoming slug,
 * exactly like the client's navigation.js does for hash-based routing.
 * ?education_type= (if present) disambiguates when multiple courses share a
 * slug; otherwise the first match wins.
 *
 * Relational count queries against `folders`/`quizzes` (course_id), NOT the
 * old manifest-walk approach (see public/src/shared/quizManifest.js).
 *
 * @param {string} courseSlug
 * @param {string|null} educationType
 * @returns {Promise<{id:string, name:string, folderCount:number, quizCount:number}|null>}
 */
async function fetchCourseMeta(courseSlug, educationType) {
    const { data: courses, error: coursesErr } = await supabase
        .from("courses")
        .select("id, name, education_type");

    if (coursesErr) {
        console.error("[render-course] Supabase course lookup error:", coursesErr.message);
        return null;
    }
    if (!Array.isArray(courses) || courses.length === 0) return null;

    const candidates = courses.filter((c) => toSlug(c.name) === courseSlug);
    if (candidates.length === 0) return null;

    const course =
        (educationType && candidates.find((c) => c.education_type === educationType)) ||
        candidates[0];

    const [{ count: folderCount, error: folderErr }, { count: quizCount, error: quizErr }] =
        await Promise.all([
            supabase
                .from("folders")
                .select("id", { count: "exact", head: true })
                .eq("course_id", course.id),
            supabase
                .from("quizzes")
                .select("id", { count: "exact", head: true })
                .eq("course_id", course.id),
        ]);

    if (folderErr) console.error("[render-course] folder count error:", folderErr.message);
    if (quizErr) console.error("[render-course] quiz count error:", quizErr.message);

    return {
        id: course.id,
        name: course.name,
        folderCount: folderCount || 0,
        quizCount: quizCount || 0,
    };
}

// =============================================================================
// Title / description formatting
// =============================================================================

function isArabicText(text) {
    const firstLetterMatch = text?.match(/\p{L}/u);
    return (
        firstLetterMatch &&
        /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(firstLetterMatch[0])
    );
}

function buildTitle(meta) {
    const isArabic = isArabicText(meta.name);
    const folderLabel = isArabic ? "مجلد" : "Folders";
    const quizLabel = isArabic ? "امتحان" : "Quizzes";
    return `${meta.name}: ${meta.folderCount} ${folderLabel} · ${meta.quizCount} ${quizLabel}`;
}

function buildDescription(meta) {
    const isArabic = isArabicText(meta.name);
    return isArabic
        ? `تصفح ${meta.quizCount} امتحان ضمن ${meta.folderCount} مجلد في مقرر ${meta.name} على منصة امتحانات بصمجي.`
        : `Browse ${meta.quizCount} quizzes across ${meta.folderCount} folders in ${meta.name} on Basmagi Quiz Platform.`;
}

// =============================================================================
// HTML helpers (identical to render-quiz.js)
// =============================================================================

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

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