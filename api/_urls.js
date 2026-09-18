// =============================================================================
// api/_urls.js
// Single source of truth for absolute URL + slug building, shared by every
// SEO/GEO surface (api/seo.js: sitemap-dynamic, feeds, llms-full, cron) and
// by api/_seoNotify.js. Underscore prefix -> not a route (see api/_middleware.js
// and friends for the same convention).
//
// toSlug()/fromSlug() are copy-kept in sync with
// public/src/features/home/slug-utils.js (client) and the inline copies in
// api/render-course.js / api/og.js — this file does NOT replace those (a
// Node serverless function can't import an ES module from public/src), it
// just gives every *new* SEO file one place to import from instead of a
// fourth copy-paste.
// =============================================================================

export const SITE_ORIGIN = process.env.SITE_ORIGIN || "https://basmagi-quiz.vercel.app";

/**
 * Convert a display name to a URL slug. Mirrors
 * public/src/features/home/slug-utils.js toSlug() exactly.
 */
export function toSlug(str) {
    return String(str || "").trim().replace(/-/g, "--").replace(/\s+/g, "-");
}

export function absUrl(pathname) {
    return `${SITE_ORIGIN}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
}

export function quizUrl(metaId) {
    return absUrl(`/quiz/${encodeURIComponent(metaId)}`);
}

export function profileUrl(handle) {
    return absUrl(`/@${encodeURIComponent(handle)}`);
}

/**
 * Lessons resolve by slug when present (falls back to id — see
 * api/render-course.js's contentType=lesson branch), matching how
 * /lesson/:id is documented in vercel.json, but the *catalog* always emits
 * the id-based form since it's guaranteed stable even for lessons with no
 * slug yet.
 */
export function lessonUrl(lessonIdOrSlug) {
    return absUrl(`/lesson/${encodeURIComponent(lessonIdOrSlug)}`);
}

/**
 * Given the full course list, find every slug collision (two courses whose
 * toSlug(name) is identical), mirroring the disambiguation render-course.js
 * already performs via ?education_type=. Returns a Set of colliding slugs.
 */
export function findCollidingSlugs(courses) {
    const bySlug = new Map();
    for (const c of courses) {
        const slug = toSlug(c.name).toLowerCase();
        if (!slug) continue;
        bySlug.set(slug, (bySlug.get(slug) || 0) + 1);
    }
    const colliding = new Set();
    for (const [slug, count] of bySlug.entries()) {
        if (count > 1) colliding.add(slug);
    }
    return colliding;
}

/**
 * Build the course-level URL. Appends ?education_type= only when the
 * course's slug collides with another course's slug (exact match against
 * every other course's toSlug(name)) — see plan §4.4.
 */
export function courseUrl(course, collidingSlugs) {
    const slug = toSlug(course.name);
    const isColliding = collidingSlugs.has(slug.toLowerCase());
    const base = `/course/${slug}`;
    return isColliding
        ? absUrl(`${base}?education_type=${encodeURIComponent(course.education_type)}`)
        : absUrl(base);
}

/**
 * Builds a courseId -> ordered slug-chain URL map for every folder, by
 * walking parent_folder_id chains. Mirrors fetchFolderPath()'s per-segment
 * resolution logic in api/render-course.js, but does it once for the whole
 * table (bulk, for sitemap/feed/llms generation) rather than level-by-level
 * per request.
 *
 * @param {Array<{id:string, course_id:string, name:string, parent_folder_id:string|null}>} folders
 * @param {Map<string,string>} courseSlugById - course_id -> its course-level slug path segment (WITHOUT ?education_type, since folder URLs never need the disambiguator: only fully-resolved course+folder chains are emitted, and folder chains already pin the course by course_id)
 * @returns {Map<string,string>} folder.id -> full pathname, e.g. "/course/Math/Unit-1"
 */
export function buildFolderPaths(folders, courseSlugById) {
    const byId = new Map(folders.map((f) => [f.id, f]));
    const pathCache = new Map();

    function resolve(folderId) {
        if (pathCache.has(folderId)) return pathCache.get(folderId);
        const folder = byId.get(folderId);
        if (!folder) return null;

        const slug = toSlug(folder.name);
        if (!slug) return null;

        let parentPath;
        if (folder.parent_folder_id) {
            parentPath = resolve(folder.parent_folder_id);
            if (!parentPath) return null;
        } else {
            const courseSlug = courseSlugById.get(folder.course_id);
            if (!courseSlug) return null;
            parentPath = `/course/${courseSlug}`;
        }

        const full = `${parentPath}/${slug}`;
        pathCache.set(folderId, full);
        return full;
    }

    const result = new Map();
    for (const folder of folders) {
        const full = resolve(folder.id);
        if (full) result.set(folder.id, full);
    }
    return result;
}

/** XML-escape for sitemap/feed text nodes and attributes. */
export function escapeXml(str) {
    return String(str ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}