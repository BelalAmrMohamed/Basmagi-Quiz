// ============================================================================
// public/src/features/home/lesson-view.js
// LESSON VIEW — Phase 1 skeleton (see docs/plans/lessons-feature-plan.md).
// Renders a lesson's title + raw markdown body via renderMarkdown() with no
// chrome (no sections/blocks/embeds/fonts — that's Phase 2). Intentionally
// the smallest possible viewer, called from navigation.js's
// restoreViewFromURL() for the /lesson/:id route.
// ============================================================================

import { container } from "./dom-refs.js";
import { renderMarkdown } from "../../shared/markdown.js";
import { ensureSharedSupabaseClient } from "../../shared/supabaseClientRegistry.js";
import { escapeHtml } from "./escape-html.js";

/**
 * Reads the lesson id injected by api/render-course.js's contentType=lesson
 * branch (<meta name="lesson:id">) and the raw pathname as a fallback for
 * client-side navigations that never hit that server route (e.g. an SPA
 * link click, where the meta tag from the last full page load is stale or
 * absent).
 */
function resolveLessonId() {
    const pathMatch = window.location.pathname.match(/^\/lesson\/([^/]+)\/?$/);
    if (pathMatch) {
        try {
            return decodeURIComponent(pathMatch[1]);
        } catch {
            return pathMatch[1];
        }
    }
    const metaTag = document.querySelector('meta[name="lesson:id"]');
    return metaTag ? metaTag.getAttribute("content") : null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Fetches the lesson row directly from Supabase (id or slug lookup, same
 * dual-mode resolution as api/render-course.js's fetchLessonMeta) — the
 * server-injected data-island only carries id/title for OG purposes, not
 * the content body, so the client always makes one query here regardless
 * of whether this is a fresh load or an in-SPA navigation.
 *
 * @param {string} idOrSlug
 * @returns {Promise<{id:string, title:string, content:unknown}|null>}
 */
async function fetchLesson(idOrSlug) {
    const supabase = await ensureSharedSupabaseClient();
    if (!supabase) return null;

    const query = supabase.from("lessons").select("id, slug, title, content");
    const { data, error } = UUID_RE.test(idOrSlug)
        ? await query.eq("id", idOrSlug).maybeSingle()
        : await query.eq("slug", idOrSlug).maybeSingle();

    if (error) {
        console.error("[lesson-view] Supabase lesson lookup failed:", error.message);
        return null;
    }
    return data || null;
}

/**
 * Phase 1's `content` shape is just a plain markdown body (string) — see
 * the lessons migration's comment on that column. Phase 2 introduces real
 * sections/blocks; this stays a thin adapter so that shape change doesn't
 * need to touch renderLessonView() itself, only this function.
 *
 * @param {unknown} content
 * @returns {string} markdown source
 */
function extractMarkdownBody(content) {
    if (typeof content === "string") return content;
    if (content && typeof content === "object") {
        if (typeof content.body === "string") return content.body;
        const firstSection = Array.isArray(content.sections) ? content.sections[0] : null;
        if (firstSection && typeof firstSection.text === "string") return firstSection.text;
        if (firstSection && typeof firstSection.body === "string") return firstSection.body;
    }
    return "";
}

/**
 * Renders the /lesson/:id view into #contentArea. No result page, no
 * scoring, no interaction with passed_quizzes_count/current_level/points —
 * lessons are never scored (explicit product decision, see the plan's
 * ground rules).
 */
export async function renderLessonView() {
    if (!container) return;

    const lessonId = resolveLessonId();
    if (!lessonId) {
        container.innerHTML = `<div class="lesson-view lesson-view--error">تعذّر تحديد الدرس المطلوب.</div>`;
        return;
    }

    container.setAttribute("aria-busy", "true");
    container.innerHTML = `<div class="lesson-view lesson-view--loading">جاري تحميل الدرس…</div>`;

    let lesson = null;
    try {
        lesson = await fetchLesson(lessonId);
    } catch (err) {
        console.error("[lesson-view] Failed to load lesson:", err);
    }

    container.setAttribute("aria-busy", "false");

    if (!lesson) {
        container.innerHTML = `<div class="lesson-view lesson-view--error">لم يتم العثور على هذا الدرس.</div>`;
        return;
    }

    const markdownBody = extractMarkdownBody(lesson.content);
    const bodyHtml = renderMarkdown(markdownBody);

    container.innerHTML = `
    <article class="lesson-view">
      <h1 class="lesson-view__title">${escapeHtml(lesson.title || "")}</h1>
      <div class="lesson-view__body markdown-body">${bodyHtml}</div>
    </article>
  `;
}