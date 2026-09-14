// =============================================================================
// api/_catalog.js
// Shared public-content query set: colleges -> courses -> folders -> quizzes
// + public profiles, with URLs pre-built via api/_urls.js. Used by
// api/seo.js's sitemap-dynamic/feeds/llms-full/cron actions so all four
// surfaces enumerate exactly the same set of URLs from one place (plan
// §6.3/§7.3/§8.2 all reuse "the same query set").
//
// Guards applied here (once, centrally) match plan §6.3 "Guards":
//   - skip quizzes with no meta.id, with a password set, or empty title
//   - skip courses/folders whose slug is empty after toSlug()
//   - dedupe is a non-issue: rows come straight from unique table PKs
//
// Underscore prefix -> not a route.
// =============================================================================

import { createClient } from "@supabase/supabase-js";
import { toSlug, courseUrl, quizUrl, profileUrl, buildFolderPaths, findCollidingSlugs, absUrl } from "./_urls.js";

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
);

// Bounded pagination for the `quizzes` table specifically — it's the table
// most likely to grow large (a course/folder count stays roughly proportional
// to curriculum structure; quizzes accumulate with every upload). Fetches in
// fixed-size .range() pages instead of one unbounded SELECT, so a fast-growing
// library can't push a single request past Vercel Hobby's 10s serverless
// timeout — the risk called out explicitly for api/cron-seo.js's underlying
// queries. Same helper backs sitemap/feed/llms-full too, since they share
// loadPublicCatalog() and would hit the identical growth risk otherwise.
const QUIZ_PAGE_SIZE = 500;
const QUIZ_PAGE_HARD_CAP = 20; // 20 * 500 = 10,000 quizzes ceiling per run

async function fetchAllQuizzes() {
    const rows = [];
    for (let page = 0; page < QUIZ_PAGE_HARD_CAP; page++) {
        const from = page * QUIZ_PAGE_SIZE;
        const to = from + QUIZ_PAGE_SIZE - 1;
        const { data, error } = await supabase
            .from("quizzes")
            .select("data, password, created_at, synced_at, course_id, folder_id")
            .range(from, to);

        if (error) return { error };
        rows.push(...(data || []));

        if (!data || data.length < QUIZ_PAGE_SIZE) break; // last page reached

        if (page === QUIZ_PAGE_HARD_CAP - 1) {
            // Hit the hard cap without exhausting the table — log so this
            // shows up before it silently under-reports the catalog. Bump
            // QUIZ_PAGE_HARD_CAP (or add real cursor-based resumption across
            // cron runs) once the library is confirmed to be this large.
            console.error(`[catalog] quizzes table exceeds ${QUIZ_PAGE_HARD_CAP * QUIZ_PAGE_SIZE} rows; truncating this run`);
        }
    }
    return { data: rows };
}

/**
 * @typedef {Object} CatalogQuiz
 * @property {string} url
 * @property {string} title
 * @property {string|null} description
 * @property {number|null} questionCount
 * @property {string|null} questionTypes
 * @property {string} lastmod - ISO timestamp
 * @property {string|null} courseId
 * @property {string|null} folderId
 * @property {string} ogImage
 */

/**
 * Loads the full public catalog via a small number of parallel queries.
 * courses/folders/profiles are fetched in one unbounded SELECT each (these
 * tables track curriculum structure, not upload volume, so they stay small);
 * quizzes are paginated (see fetchAllQuizzes above) since that table grows
 * with every upload. Meant to run inside a 1h-SWR-cached route or a
 * once-daily cron, never on a latency-sensitive hot path. If any query
 * fails, returns null so callers can fall back to a safe, cache-busted
 * response instead of partially-wrong data.
 *
 * @returns {Promise<null|{
 *   courses: Array<{id:string,name:string,education_type:string,url:string,lastmod:string}>,
 *   folders: Array<{id:string,course_id:string,name:string,url:string,lastmod:string}>,
 *   quizzes: CatalogQuiz[],
 *   profiles: Array<{handle:string,url:string,lastmod:string}>,
 * }>}
 */
export async function loadPublicCatalog() {
    const [coursesRes, foldersRes, quizzesRes, profilesRes] = await Promise.all([
        supabase.from("courses").select("id, name, education_type, college, year, term, created_at, updated_at"),
        supabase.from("folders").select("id, course_id, parent_folder_id, name, created_at, updated_at"),
        fetchAllQuizzes(),
        supabase.from("admin_users").select("handle, display_name, updated_at").not("handle", "is", null),
    ]);

    if (coursesRes.error || foldersRes.error || quizzesRes.error || profilesRes.error) {
        console.error(
            "[catalog] load failed:",
            coursesRes.error?.message,
            foldersRes.error?.message,
            quizzesRes.error?.message,
            profilesRes.error?.message,
        );
        return null;
    }

    const rawCourses = coursesRes.data || [];
    const rawFolders = foldersRes.data || [];
    const rawQuizzes = quizzesRes.data || [];
    const rawProfiles = profilesRes.data || [];

    // ── Courses ────────────────────────────────────────────────────────────
    const collidingSlugs = findCollidingSlugs(rawCourses);
    const courseSlugById = new Map();
    const courses = [];
    for (const c of rawCourses) {
        const slug = toSlug(c.name);
        if (!slug) continue; // guard: empty slug after toSlug
        courseSlugById.set(c.id, slug); // used by folder path building below (never carries ?education_type — see _urls.js buildFolderPaths doc)
        courses.push({
            id: c.id,
            name: c.name,
            education_type: c.education_type,
            college: c.college || null,
            year: c.year || null,
            term: c.term || null,
            url: courseUrl(c, collidingSlugs),
            lastmod: c.updated_at || c.created_at || null,
        });
    }

    // ── Folders (full ancestor-slug-chain URLs) ───────────────────────────
    const folderPaths = buildFolderPaths(rawFolders, courseSlugById);
    const folders = [];
    for (const f of rawFolders) {
        const pathname = folderPaths.get(f.id);
        if (!pathname) continue; // guard: unresolved chain (bad slug/orphan) — skip rather than emit a wrong URL
        folders.push({
            id: f.id,
            course_id: f.course_id,
            parent_folder_id: f.parent_folder_id || null,
            name: f.name,
            url: absUrl(pathname),
            lastmod: f.updated_at || f.created_at || null,
        });
    }
    const folderById = new Map(folders.map((f) => [f.id, f]));

    // ── Quizzes ────────────────────────────────────────────────────────────
    const quizzes = [];
    for (const q of rawQuizzes) {
        const meta = q.data?.meta || {};
        const stats = q.data?.stats || {};
        const metaId = meta.id;
        if (!metaId) continue; // guard: no meta.id
        if (!meta.title) continue; // guard: empty title
        if (q.password) continue; // guard: password-protected — never listed publicly

        quizzes.push({
            metaId,
            url: quizUrl(metaId),
            title: meta.title,
            description: meta.description || null,
            questionCount: stats.questionCount ?? null,
            questionTypes: stats.questionTypes || null,
            lastmod: q.synced_at || q.created_at || null,
            createdAt: q.created_at || null,
            courseId: q.course_id || null,
            folderId: q.folder_id || null,
            courseName: q.course_id ? (rawCourses.find((c) => c.id === q.course_id)?.name ?? null) : null,
            folderName: q.folder_id ? (folderById.get(q.folder_id)?.name ?? null) : null,
        });
    }

    // ── Public profiles ────────────────────────────────────────────────────
    const profiles = [];
    for (const p of rawProfiles) {
        if (!p.handle) continue;
        profiles.push({
            handle: p.handle,
            displayName: p.display_name || p.handle,
            url: profileUrl(p.handle),
            lastmod: p.updated_at || null,
        });
    }

    return { courses, folders, quizzes, profiles };
}

/**
 * Filters a loaded catalog down to entries touched in the last `hours`
 * hours, by lastmod/createdAt. Used by the cron sweep (plan §7.3) to
 * re-announce anything that might have been missed by real-time notify
 * calls (e.g. bulk uploads, restores).
 */
export function filterRecentlyChanged(catalog, hours = 24) {
    const cutoff = Date.now() - hours * 60 * 60 * 1000;
    const isRecent = (iso) => {
        if (!iso) return false;
        const t = new Date(iso).getTime();
        return Number.isFinite(t) && t >= cutoff;
    };

    return {
        courses: catalog.courses.filter((c) => isRecent(c.lastmod)),
        folders: catalog.folders.filter((f) => isRecent(f.lastmod)),
        quizzes: catalog.quizzes.filter((q) => isRecent(q.lastmod) || isRecent(q.createdAt)),
        profiles: catalog.profiles.filter((p) => isRecent(p.lastmod)),
    };
}