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

    // vercel.json rewrites the entire /course/... subtree with a single rule
    // ("/course/:path*" → "/api/render-course/:path*"), rather than a
    // separate ":name" rewrite plus a ":name/:path*" one, and rather than a
    // "?path=:path*" query-string destination — this Vercel CLI version's
    // path compiler rejects both of those shapes outright as soon as a
    // repeating (":x*") param either follows another dynamic segment, or is
    // glued directly after a "?key=" in the destination ("Can not repeat
    // 'x' without a prefix and suffix" / "Unexpected MODIFIER"). The only
    // shape it accepts is a single wildcard directly after a literal
    // prefix, substituted as literal path segments in the destination too
    // (matching Vercel's own documented "/api/:path*" → ".../:path*"
    // example) — which means the segments arrive as real extra path
    // segments on req.url (e.g. "/api/render-course/Website-Demo/All-
    // Features"), NOT as req.query.path, since api/render-course.js is a
    // single fixed-name file, not a "[...path].js" catch-all route file.
    // So this handler parses req.url's pathname itself, splits the first
    // segment (course slug) from any remaining segments (folder path).
    const urlPath = (req.url || "").split("?")[0]; // strip any query string
    const allSegments = urlPath
        .replace(/^\/api\/render-course\/?/, "") // strip the fixed function path prefix
        .split("/")
        .filter(Boolean)
        .map((seg) => {
            try {
                return decodeURIComponent(seg);
            } catch {
                return seg;
            }
        });

    if (allSegments.length === 0) {
        return res.redirect(302, "/");
    }

    // First segment is the course slug (dashes, e.g.
    // "Data-Structures-and-Algorithms"), NOT the raw course name — resolved
    // against courses' toSlug(name) in fetchCourseMeta(), same case/slug-
    // insensitive approach the client's navigation.js uses. Any remaining
    // segments are nested-folder-name slugs, resolved level-by-level via
    // fetchFolderPath() below (parent_folder_id chain in the `folders`
    // table). This gives nested folders their own server-visible URL and
    // OG image, instead of the client-only #hash scheme (which crawlers
    // never see, so they'd otherwise always get the course-level image).
    const courseSlug = allSegments[0];
    const pathSlugs = allSegments.slice(1);
    const educationType =
        typeof req.query.education_type === "string" ? req.query.education_type : null;

    // ── 1. Fetch course metadata + counts from Supabase ───────────────────────
    let meta = null;
    try {
        meta = await fetchCourseMeta(courseSlug, educationType);
    } catch (err) {
        console.error("[render-course] Supabase lookup failed:", err);
    }

    // ── 1b. Walk the folder path (if any) under the resolved course ───────────
    // folderMeta is null when there's no path, the course itself is unknown,
    // or a segment fails to resolve (unknown/renamed folder) — in all of
    // those cases we fall back to rendering the course-level page/meta,
    // same as an unresolved hash does client-side.
    let folderMeta = null;
    if (meta && pathSlugs.length > 0) {
        try {
            folderMeta = await fetchFolderPath(meta.id, pathSlugs);
        } catch (err) {
            console.error("[render-course] Folder path lookup failed:", err);
        }
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
    // course:folder-path (when present) lets navigation.js resolve straight
    // to the nested folder on load, instead of resolving the course only and
    // relying on a hash the server never sees.
    html = html.replace(
        "</head>",
        `  <meta name="course:id" content="${escapeHtml(meta.id)}">\n` +
        `  <meta name="course:name" content="${escapeHtml(meta.name)}">\n` +
        (folderMeta
            ? `  <meta name="course:folder-path" content="${escapeHtml(pathSlugs.join("/"))}">\n`
            : "") +
        `</head>`,
    );

    // ── 4. Inject OG / title / canonical tags ─────────────────────────────────
    // When a folder path resolved, every tag reflects the deepest folder
    // (title, description, canonical, OG image all show the full chain, e.g.
    // "Math / Algebra / Second") rather than the course alone.
    const pageMeta = folderMeta || meta;
    const title = buildTitle(pageMeta, meta.name);
    const description = buildDescription(pageMeta, meta.name);
    const courseSlugPath = toSlug(meta.name);
    const folderSlugPath = folderMeta
        ? "/" + folderMeta.path.map((seg) => encodeURIComponent(toSlug(seg))).join("/")
        : "";
    const canonicalUrl = `${SITE_ORIGIN}/course/${encodeURIComponent(courseSlugPath)}${folderSlugPath}`;
    // /api/og handles quizId=, course=, and course=+folder= — see that
    // file's handler() dispatch comment for why these Edge OG generators
    // share one function.
    const ogImageUrl = folderMeta
        ? `${SITE_ORIGIN}/api/og?course=${encodeURIComponent(meta.id)}&folder=${encodeURIComponent(folderMeta.path.join("/"))}&v=${OG_IMAGE_VERSION}`
        : `${SITE_ORIGIN}/api/og?course=${encodeURIComponent(meta.id)}&v=${OG_IMAGE_VERSION}`;

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

/**
 * Walks a chain of folder-name slugs under a course, level by level, using
 * `folders.parent_folder_id` (null at the top level, directly under the
 * course). Each segment is matched via toSlug(name) against the slug in the
 * URL — same case/slug-insensitive approach fetchCourseMeta() and the
 * client's navigation.js use. Returns null (falls back to the course page)
 * if any segment fails to resolve, e.g. a stale/renamed folder link.
 *
 * Direct-child-only counts are used for folderCount/quizCount (not a full
 * subtree walk) to match what the course page's own counts represent
 * (immediate children), and to keep this to one query pair regardless of
 * how deep the path is.
 *
 * @param {string} courseId
 * @param {string[]} pathSlugs e.g. ["Algebra", "Second"]
 * @returns {Promise<{id:string, name:string, path:string[], folderCount:number, quizCount:number}|null>}
 */
async function fetchFolderPath(courseId, pathSlugs) {
    let parentFolderId = null;
    let folder = null;
    const resolvedNames = [];

    for (const slug of pathSlugs) {
        const query = supabase
            .from("folders")
            .select("id, name")
            .eq("course_id", courseId);
        const { data: siblings, error } = parentFolderId
            ? await query.eq("parent_folder_id", parentFolderId)
            : await query.is("parent_folder_id", null);

        if (error) {
            console.error("[render-course] folder path lookup error:", error.message);
            return null;
        }
        if (!Array.isArray(siblings) || siblings.length === 0) return null;

        const match = siblings.find((f) => toSlug(f.name) === slug);
        if (!match) return null;

        folder = match;
        parentFolderId = match.id;
        resolvedNames.push(match.name);
    }

    if (!folder) return null;

    const [{ count: folderCount, error: folderErr }, { count: quizCount, error: quizErr }] =
        await Promise.all([
            supabase
                .from("folders")
                .select("id", { count: "exact", head: true })
                .eq("parent_folder_id", folder.id),
            supabase
                .from("quizzes")
                .select("id", { count: "exact", head: true })
                .eq("folder_id", folder.id),
        ]);

    if (folderErr) console.error("[render-course] folder-count error:", folderErr.message);
    if (quizErr) console.error("[render-course] folder quiz-count error:", quizErr.message);

    return {
        id: folder.id,
        name: folder.name,
        path: resolvedNames,
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

// `meta` is either the course-level object (from fetchCourseMeta) or a
// folder-level object (from fetchFolderPath, which additionally carries
// `path`: the full breadcrumb of resolved folder names under the course).
// When `courseName` + `meta.path` are both given, the displayed name/breadcrumb
// reads "Course / Sub / Sub2" instead of just the deepest folder's own name,
// so a deeply nested folder's title/OG image still shows which course it's
// under.
function displayPath(courseName, meta) {
    if (!meta.path) return meta.name; // course-level: no breadcrumb needed
    return [courseName, ...meta.path].join(" / ");
}

function buildTitle(meta, courseName) {
    const label = displayPath(courseName, meta);
    const isArabic = isArabicText(meta.name);
    const folderLabel = isArabic ? "مجلد" : "Folders";
    const quizLabel = isArabic ? "امتحان" : "Quizzes";
    return `${label}: ${meta.folderCount} ${folderLabel} · ${meta.quizCount} ${quizLabel}`;
}

function buildDescription(meta, courseName) {
    const label = displayPath(courseName, meta);
    const isArabic = isArabicText(meta.name);
    return isArabic
        ? `تصفح ${meta.quizCount} امتحان ضمن ${meta.folderCount} مجلد في ${label} على منصة امتحانات بصمجي.`
        : `Browse ${meta.quizCount} quizzes across ${meta.folderCount} folders in ${label} on Basmagi Quiz Platform.`;
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