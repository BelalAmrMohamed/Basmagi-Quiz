// =============================================================================
// public/src/components/ai-agent/ai-agent-library-search.js
// Headless (no DOM) keyword search across BOTH data sources the AI Agent's
// `@` mention menu and `search_library`/`parse_item_info` tools need:
//   - the user's own library (`user_quizzes` in localStorage — via
//     ai-agent-item-lookup.js, already pure/DOM-free)
//   - the platform's main-page content (Supabase `courses`/`folders`/
//     `quizzes`, via the client-side manifest — see quizManifest.js's own
//     header comment: this project moved manifest loading off a serverless
//     function specifically because of Vercel Hobby's 12-function cap, so
//     there is already a fully client-resolvable path to this data with NO
//     new API route needed here either).
//
// Deliberately NOT reusing search-manager.js's SearchManager class: that
// class is DOM-bound (constructor does `document.querySelector`, binds
// radio/input listeners, reads `this.container`) and stateful in ways that
// assume it's driving the home page's own search bar. Instantiating it here
// just to call one filter method would mean faking out a DOM it doesn't
// need to touch. Its multi-term "every term must match, AND logic" substring
// algorithm is deliberately mirrored below (see matchesQuery()) so results
// feel consistent with the platform's existing search bar, without the
// coupling.
// =============================================================================

import { getManifest } from "../../shared/quizManifest.js";
import { listRecentUserItems, resolveUserItemById, readUserQuizzes } from "./ai-agent-item-lookup.js";

/**
 * Same substring/AND-across-terms matching search-manager.js's own
 * filterQuizzesBySearchQuery/filterCoursesBySearchQuery use, extracted as a
 * standalone function so both this module and (indirectly) the mention menu
 * apply one consistent definition of "matches".
 * @param {string} query
 * @param {string[]} fields - searchable text fields for one item
 * @returns {boolean}
 */
function matchesQuery(query, fields) {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    const terms = q.split(/\s+/);
    const haystack = fields.filter(Boolean).join(" ").toLowerCase();
    return terms.every((term) => haystack.includes(term));
}

/**
 * Searches the platform's main-page content (courses + every quiz in the
 * manifest) by keyword. Folders aren't independently searchable here the
 * way they are for the user's own library — the manifest's categoryTree
 * keys folders by a synthetic "Course/Sub/Sub" path rather than a stable
 * id a model could usefully reference, so only top-level courses (which DO
 * have a real db id) and quizzes are returned. A folder can still be
 * reached by attaching its parent course, same as the `@` menu's platform
 * branch already does via buildPlatformCourseAttachment's recursive tree.
 * @param {string} query
 * @param {number} [limit=8]
 * @returns {Promise<Array<{kind: "course"|"quiz", id: string, title: string, source: "platform"}>>}
 */
export async function searchPlatformLibrary(query, limit = 8) {
    const { categoryTree, examList } = await getManifest();

    const courseResults = Object.values(categoryTree)
        .filter((node) => !node.parent) // top-level nodes only == courses
        .filter((course) => matchesQuery(query, [course.name, course.faculty, course.education_type]))
        .map((course) => ({ kind: "course", id: course.key, title: course.name, source: "platform" }));

    const quizResults = examList
        .filter((exam) => matchesQuery(query, [exam.title, exam.description, exam.category]))
        .map((exam) => ({
            kind: "quiz",
            id: exam.id,
            dbId: exam.dbId,
            title: exam.title,
            source: "platform",
        }));

    // Courses first — a matching subject is usually what the user means when
    // a course name and a quiz title both happen to contain the term (e.g.
    // searching "تشريح" matches the "تشريح" course AND quizzes titled
    // "امتحان تشريح 1"); quizzes fill the remainder of the limit.
    return [...courseResults, ...quizResults].slice(0, limit);
}

/**
 * Searches the user's own library by keyword. Thin wrapper around
 * listRecentUserItems (already does substring-on-title filtering) kept
 * here so callers needing BOTH sources have one entry point instead of
 * importing from two modules with different call shapes.
 * @param {string} query
 * @param {number} [limit=8]
 */
export function searchMyLibrary(query, limit = 8) {
    return listRecentUserItems(query, limit);
}

/**
 * Combined search across both sources — the shape `search_library`'s
 * client-side tool handler and the `@` menu both want. Runs the (instant,
 * synchronous) local search and the (async, network) platform search in
 * parallel rather than sequencing them, so a slow platform fetch never
 * delays local results from being usable.
 * @param {string} query
 * @param {{scope?: "mine"|"platform"|"both", limit?: number}} [options]
 * @returns {Promise<{mine: Array<object>, platform: Array<object>}>}
 */
export async function searchLibrary(query, options = {}) {
    const { scope = "both", limit = 8 } = options;

    const mine = scope === "platform" ? [] : searchMyLibrary(query, limit);
    const platform = scope === "mine" ? [] : await searchPlatformLibrary(query, limit);

    return { mine, platform };
}

/**
 * Resolves one item by id, trying the user's own library first (instant,
 * no network) and falling back to platform content. Mirrors
 * resolveUserItemById's return shape ({kind, id, title, summary, source,
 * payload}) so both branches produce something ai-agent-chat.js's
 * addPendingAttachment / the tool-result formatter can treat identically.
 * @param {string} id
 * @param {"quiz"|"course"|"folder"} [kindHint] - narrows platform lookup;
 *   omit to try quiz first, then course (folders aren't independently
 *   resolvable platform-side — see searchPlatformLibrary's own note).
 * @returns {Promise<object|null>}
 */
export async function resolveLibraryItemById(id, kindHint) {
    const local = resolveUserItemById(id, readUserQuizzes());
    if (local) return local;

    const { categoryTree, examList } = await getManifest();

    if (kindHint !== "course") {
        const exam = examList.find((e) => e.id === id || String(e.dbId) === String(id));
        if (exam) {
            return {
                kind: "quiz",
                id: exam.id,
                dbId: exam.dbId,
                title: exam.title,
                source: "platform",
                summary: `عدد الأسئلة: ${exam.questionCount || 0}`,
            };
        }
    }

    const course = categoryTree[id] && !categoryTree[id].parent ? categoryTree[id] : null;
    if (course) {
        const countQuizzes = (node, visited = new Set()) => {
            if (!node || visited.has(node.key)) return 0;
            visited.add(node.key);
            const own = (node.exams || []).length;
            const nested = (node.subcategories || []).reduce(
                (n, subKey) => n + countQuizzes(categoryTree[subKey], visited),
                0,
            );
            return own + nested;
        };
        return {
            kind: "course",
            id: course.key,
            title: course.name,
            source: "platform",
            summary: `عدد الامتحانات: ${countQuizzes(course)} — عدد المجلدات: ${(course.subcategories || []).length}`,
        };
    }

    return null;
}