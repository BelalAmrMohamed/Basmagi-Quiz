// =============================================================================
// api/render-course.js
//
// Serverless function (Node.js runtime, flat file) that handles all requests
// to /course/:name and /course/:name/:sub1/:sub2/... Mirrors render-quiz.js's
// structure (Supabase lookup, HTML template read + meta-tag injection,
// caching headers) but differs in one key way: course pages are NOT a
// separate HTML file — they render inside the existing SPA
// (public/index.html), so this function injects OG tags and a data-island
// into index.html itself rather than a dedicated template, and index.html's
// own client-side router (navigation.js) takes over from there to actually
// render the course view.
//
// What it does:
//   1. Reads the course slug + any nested folder slugs from req.query.full
//      (a single "/"-joined string — see the handler below for why this
//      shape was chosen over a path-segment catch-all route file).
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
//   /course/NAME[/SUB1/SUB2/...]  →  (vercel.json rewrite: a single
//   "/course/:full(.*)" → "/api/render-course?full=:full" rule, matching
//   any depth in one shot)  →  this file, with
//   req.query.full = "NAME[/SUB1/SUB2/...]" (one string, split below).
//   Browser URL stays /course/NAME/.... navigation.js reads the course id
//   (and folder path, when present) from the injected <meta> tags to render
//   the right view without a hash.
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
const LESSON_TEMPLATE_PATH = path.join(process.cwd(), "public", "lesson.html");

// Bump when /api/og's course-image layout changes, to bust platforms' cache.
// Bumped to 2: course/folder OG images were redesigned (icon card + course-
// info rows layout, see api/og.js renderCourseImage) and the description's
// "across 0 folders" wording was fixed below — both need every platform
// (Facebook/LinkedIn/X, and any CDN edge) to refetch rather than serve a
// year-old cached image/description under the same URL.
// Bumped to 3: fixed the course-info table's key/value alignment and the
// Arabic title's reversed/spaced-out rendering on folder images (see
// buildInfoTable + the title block in api/og.js renderCourseImage) — old
// folder images were rendered under buggy code and are cached for a full
// year (immutable, max-age=31536000) under the v=2 URL, so this bump is
// required for every folder image already shared anywhere to actually
// refresh instead of continuing to serve the broken layout forever.
const OG_IMAGE_VERSION = 3;

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
// This file is a shared function now (Vercel Hobby's 12-function cap is
// already hit — see docs/plans/lessons-feature-plan.md's ground rules), so
// the course-resolution path and the lesson-resolution path are kept
// visually separate as two clearly-named internal functions called from
// one small dispatcher, rather than interleaving `if` checks through the
// existing course logic line-by-line — this is what keeps the two
// responsibilities easy to read independently instead of accumulating the
// same kind of scar tissue create-quiz.js has.
export default async function handler(req, res) {
    if (req.method !== "GET" && req.method !== "HEAD") {
        return res.status(405).end();
    }

    if (req.query.contentType === "lesson") {
        return handleLessonRequest(req, res);
    }
    return handleCourseRequest(req, res);
}

// =============================================================================
// Lesson resolution (Phase 1 skeleton) — /lesson/:id
// =============================================================================
// vercel.json: { "source": "/lesson/:id", "destination":
// "/api/render-course?contentType=lesson&id=:id" }. Deliberately reuses this
// file rather than a new api/render-lesson.js — see the plan's ⚠️ note on
// the function-budget cap. Unlike course resolution, there is no slug-chain
// to walk: a lesson is looked up directly by id (or slug, when present),
// with no folder/course tree traversal.
//
// OG tags come straight from the lesson's title + a short plain-text
// excerpt of its first content block — no dedicated OG image variant for
// v1 (a generic site OG image is an acceptable fallback; og.js is already
// one of the 12 functions, so a new branch there isn't justified for this).
async function handleLessonRequest(req, res) {
    const rawId = typeof req.query.id === "string" ? req.query.id : "";
    if (!rawId) {
        return res.redirect(302, "/");
    }
    let lessonId;
    try {
        lessonId = decodeURIComponent(rawId);
    } catch {
        lessonId = rawId;
    }

    let lesson = null;
    try {
        lesson = await fetchLessonMeta(lessonId);
    } catch (err) {
        console.error("[render-course] Lesson lookup failed:", err);
    }

    let html;
    try {
        html = fs.readFileSync(LESSON_TEMPLATE_PATH, "utf8");
    } catch (err) {
        console.error("[render-course] Could not read lesson.html:", err);
        return res.status(500).send("Internal Server Error");
    }

    if (!lesson) {
        // Unknown lesson id/slug — let the SPA load normally, same
        // never-cache-a-miss approach the course branch takes below.
        html = html.replace(
            "</head>",
            `  <meta name="lesson:id" content="${escapeHtml(lessonId)}">\n</head>`,
        );
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        return res.status(200).send(html);
    }

    // ── Data-island for the client SPA (navigation.js) to hydrate from ───────
    html = html.replace(
        "</head>",
        `  <meta name="lesson:id" content="${escapeHtml(lesson.id)}">\n` +
        `  <meta name="lesson:title" content="${escapeHtml(lesson.title)}">\n` +
        `</head>`,
    );

    // ── OG / title / canonical tags ───────────────────────────────────────────
    const excerpt = buildLessonExcerpt(lesson.content);
    const canonicalUrl = `${SITE_ORIGIN}/lesson/${encodeURIComponent(lesson.slug || lesson.id)}`;

    html = html.replace(
        /<title>[^<]*<\/title>/i,
        `<title>${escapeHtml(lesson.title)}</title>`,
    );

    html = replaceLinkHref(html, "canonical", canonicalUrl);

    html = replaceMetaContent(html, "property", "og:title", lesson.title);
    html = replaceMetaContent(html, "property", "og:url", canonicalUrl);
    // No lesson-specific OG image variant for v1 — leave og:image as
    // whatever the template's generic site image already is (a deliberate
    // fallback, see the plan's ⚠️ note above). og:description/twitter still
    // get the lesson's own excerpt, same as the course branch's title/desc.
    if (excerpt) {
        html = replaceMetaContent(html, "property", "og:description", excerpt);
        html = replaceMetaContent(html, "name", "twitter:description", excerpt);
        html = replaceMetaContent(html, "name", "description", excerpt);
    }
    html = replaceMetaContent(html, "name", "twitter:title", lesson.title);

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader(
        "Cache-Control",
        "public, s-maxage=3600, stale-while-revalidate=86400",
    );
    return res.status(200).send(html);
}

/**
 * Fetches a lesson by id (or slug, when the lookup value isn't a UUID) for
 * the /lesson/:id route. Phase 1 keeps this to a single direct lookup — no
 * folder/course tree walk, since a lesson page doesn't need the
 * folderCount/quizCount siblings a course page shows.
 *
 * @param {string} idOrSlug
 * @returns {Promise<{id:string, slug:string|null, title:string, content:unknown}|null>}
 */
async function fetchLessonMeta(idOrSlug) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);
    const query = supabase.from("lessons").select("id, slug, title, content");
    const { data, error } = isUuid
        ? await query.eq("id", idOrSlug).maybeSingle()
        : await query.eq("slug", idOrSlug).maybeSingle();

    if (error) {
        console.error("[render-course] Supabase lesson lookup error:", error.message);
        return null;
    }
    if (!data) return null;

    return {
        id: data.id,
        slug: data.slug || null,
        title: data.title,
        content: data.content,
    };
}

/**
 * Short plain-text excerpt of a lesson's first content block, for OG/
 * meta-description tags. Phase 1's `content` shape is just a plain
 * markdown body (see the lessons migration's comment on this column) —
 * Phase 2 introduces real sections/blocks, at which point this should read
 * the first block's text instead of assuming a single string.
 *
 * @param {unknown} content
 * @returns {string} plain text, truncated to ~160 chars, or "" if none
 */
function buildLessonExcerpt(content) {
    let raw = "";
    if (typeof content === "string") {
        raw = content;
    } else if (content && typeof content === "object") {
        if (Array.isArray(content.sections)) {
            // Real (Phase 2) shape: text lives in section.blocks[].body of
            // type "markdown". Take the first markdown block from the first
            // section that has one, skipping defaultHidden sections — those
            // are adaptive remediation, and a link preview must not show
            // content most readers are never supposed to see first.
            // (Legacy section.text / section.body is still honoured.)
            for (const section of content.sections) {
                if (!section || section.defaultHidden) continue;
                const block = Array.isArray(section.blocks)
                    ? section.blocks.find(
                        (b) => b && b.type === "markdown" && typeof b.body === "string" && b.body.trim(),
                    )
                    : null;
                raw = block?.body || section.text || section.body || "";
                if (raw) break;
            }
        } else {
            raw = content.body || "";
        }
    }
    const plain = String(raw)
        .replace(/[#*_`>[\]]/g, "")
        .replace(/\s+/g, " ")
        .trim();
    if (!plain) return "";
    return plain.length > 160 ? `${plain.slice(0, 157)}...` : plain;
}

// =============================================================================
// Course resolution — /course/:name[/:sub1/:sub2/...]
// =============================================================================
async function handleCourseRequest(req, res) {
    // This file lives at api/render-course.js (a flat file). vercel.json
    // rewrites the /course/... subtree with a single named-param capture
    // that matches ANY depth in one shot:
    //   "/course/:full(.*)" -> "/api/render-course?full=:full"
    // ":full(.*)" is a single, non-repeating custom-regex param (not a
    // repeating ":x*" token), so Vercel is happy putting it directly after
    // "?full=" in the destination -- the earlier "PATH TO REGEXP ERROR" was
    // specifically about repeating params glued after "?key=", which this
    // isn't. Because the destination is a query string (not literal path
    // segments), Vercel matches this flat file unambiguously regardless of
    // how many real segments were in the URL -- there's no dynamic-route
    // filename depth-matching involved at all, which is what made an
    // earlier "[...path].js" catch-all file version unreliable for 2+
    // segments specifically in `vercel dev` (1-segment requests worked;
    // 2+ segments 404'd, even though this handler has no code path capable
    // of producing a 404 itself -- only a 302 redirect or a 200 response --
    // meaning the catch-all route file wasn't being matched consistently at
    // that depth by this Vercel CLI version, despite the rewrite's own
    // source pattern provably matching any depth via path-to-regexp).
    //
    // req.query.full is a single string like "Website-Demo" or
    // "Website-Demo/All-Features" -- split it ourselves.
    const fullParam = typeof req.query.full === "string" ? req.query.full : "";
    const allSegments = fullParam
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

    // ── 4b. JSON-LD + visible spider island (plan §8.4/§8.5) ──────────────────
    // Kept as its own step, fetching real immediate children so the
    // ItemList/noscript island reflect actual content rather than just the
    // counts already computed above. Best-effort: a failure here degrades to
    // "no children listed" rather than failing the whole page render, since
    // this is supplementary discoverability, not the SPA's core content.
    let rawChildren = { folders: [], quizzes: [] };
    try {
        rawChildren = await fetchImmediateChildren(folderMeta ? folderMeta.id : meta.id, !!folderMeta);
    } catch (err) {
        console.error("[render-course] immediate-children lookup failed (non-fatal):", err?.message || err);
    }
    // Child folder URLs need the full slug chain back to the course root,
    // which only the caller (this scope) knows at this point.
    const childFolderBase = folderMeta
        ? `${courseSlugPath}/${folderMeta.path.map((seg) => toSlug(seg)).join("/")}`
        : courseSlugPath;
    const children = {
        folders: rawChildren.folders.map((f) => ({
            name: f.name,
            url: `/course/${encodeURIComponent(childFolderBase)}/${encodeURIComponent(toSlug(f.name))}`,
        })),
        quizzes: rawChildren.quizzes,
    };

    const breadcrumbItems = [{ name: "الرئيسية", url: SITE_ORIGIN }];
    breadcrumbItems.push({ name: meta.name, url: `${SITE_ORIGIN}/course/${encodeURIComponent(courseSlugPath)}` });
    if (folderMeta) {
        let acc = courseSlugPath;
        for (const seg of folderMeta.path) {
            acc += `/${toSlug(seg)}`;
            breadcrumbItems.push({ name: seg, url: `${SITE_ORIGIN}/course/${encodeURIComponent(acc)}` });
        }
    }

    const breadcrumbJsonLd = {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: breadcrumbItems.map((item, i) => ({
            "@type": "ListItem",
            position: i + 1,
            name: item.name,
            item: item.url,
        })),
    };

    const childItems = [
        ...children.folders.map((f) => ({ name: f.name, url: `${SITE_ORIGIN}${f.url}` })),
        ...children.quizzes.map((q) => ({ name: q.title, url: `${SITE_ORIGIN}${q.url}` })),
    ];

    const collectionJsonLd = {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: title,
        description,
        url: canonicalUrl,
        inLanguage: "ar",
        isPartOf: { "@type": "WebSite", name: "منصة امتحانات بصمجي", url: SITE_ORIGIN },
    };

    const itemListJsonLd = {
        "@context": "https://schema.org",
        "@type": "ItemList",
        itemListElement: childItems.map((item, i) => ({
            "@type": "ListItem",
            position: i + 1,
            name: item.name,
            url: item.url,
        })),
    };

    const jsonLdScripts =
        `  <script type="application/ld+json">${JSON.stringify(collectionJsonLd)}</script>\n` +
        (childItems.length
            ? `  <script type="application/ld+json">${JSON.stringify(itemListJsonLd)}</script>\n`
            : "") +
        `  <script type="application/ld+json">${JSON.stringify(breadcrumbJsonLd)}</script>\n`;
    html = html.replace("</head>", `${jsonLdScripts}</head>`);

    // Visible-but-offscreen spider island (plan §8.5): real <a> links to
    // immediate children, for HTML-only crawlers/LLM fetchers that don't
    // execute the SPA's client-side router. Wrapped in <noscript> so it
    // never affects the JS-enabled app UI, and inserted right after <body>
    // so it exists regardless of how deep index.html's own body markup is.
    if (childItems.length > 0) {
        const islandLinks = childItems
            .map((item) => `<li><a href="${escapeHtml(item.url)}">${escapeHtml(item.name)}</a></li>`)
            .join("");
        const island =
            `<noscript><div class="seo-catalog" style="position:absolute;left:-9999px" aria-hidden="true">` +
            `<h2>${escapeHtml(title)}</h2><ul>${islandLinks}</ul></div></noscript>`;
        html = html.replace(/<body[^>]*>/i, (bodyTag) => `${bodyTag}\n${island}`);
    }

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

/**
 * Fetches the real immediate children (direct-child folders + quizzes, no
 * deeper subtree walk — matching the existing folderCount/quizCount
 * semantics above) of either a course or a folder, for the CollectionPage
 * ItemList JSON-LD and the noscript spider island (plan §8.4/§8.5).
 * Excludes password-protected quizzes, same guard as api/_catalog.js's
 * sitemap/feed/llms-full query set.
 *
 * @param {string} parentId - course.id or folder.id
 * @param {boolean} isFolder - true when parentId is a folder id
 * @returns {Promise<{folders: Array<{name:string}>, quizzes: Array<{title:string,url:string}>}>}
 *   (folder URLs are resolved by the caller, which knows the full slug chain)
 */
async function fetchImmediateChildren(parentId, isFolder) {
    const folderQuery = isFolder
        ? supabase.from("folders").select("id, name").eq("parent_folder_id", parentId)
        : supabase.from("folders").select("id, name").eq("course_id", parentId).is("parent_folder_id", null);
    const quizQuery = isFolder
        ? supabase.from("quizzes").select("data, password").eq("folder_id", parentId)
        : supabase.from("quizzes").select("data, password").eq("course_id", parentId).is("folder_id", null);

    const [{ data: folderRows, error: folderErr }, { data: quizRows, error: quizErr }] = await Promise.all([
        folderQuery,
        quizQuery,
    ]);

    if (folderErr) console.error("[render-course] children folder lookup error:", folderErr.message);
    if (quizErr) console.error("[render-course] children quiz lookup error:", quizErr.message);

    // Folder URLs need the full slug chain back to the course root, which
    // this function's caller already knows (courseSlugPath/folderMeta.path)
    // but a child folder one level down doesn't — resolved here by walking
    // up via the same shape fetchFolderPath() uses, kept local and simple
    // since this is one extra level, not an arbitrary-depth walk.
    const folders = (folderRows || []).map((f) => ({ name: f.name }));

    const quizzes = [];
    for (const q of quizRows || []) {
        if (q.password) continue; // exclude password-gated quizzes (plan §4.3 "quiz_access is unused" note)
        const metaId = q.data?.meta?.id;
        const title = q.data?.meta?.title;
        if (!metaId || !title) continue;
        quizzes.push({ title, url: `/quiz/${encodeURIComponent(metaId)}` });
    }

    return { folders, quizzes };
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
    // Branch on folderCount rather than always saying "across N folders" —
    // "across 0 folders" reads like an error rather than a legitimate
    // count of zero, so a course/folder with no subfolders gets its own
    // sentence shape instead of the folder clause being force-filled with
    // "0".
    if (meta.folderCount === 0) {
        return isArabic
            ? `تصفح ${meta.quizCount} امتحان في ${label} على منصة امتحانات بصمجي.`
            : `Browse ${meta.quizCount} quizzes in ${label} on Basmagi Quiz Platform.`;
    }
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