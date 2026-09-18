// ============================================================================
// public/src/features/lessons/lesson-view.js
// LESSON VIEWER — the real /lesson/:id reading experience (Phase 2).
// ============================================================================
// Replaces the Phase 1 skeleton that lived at features/home/lesson-view.js
// (moved here per the plan's Phase 2 step 2: lessons are big enough to
// warrant their own feature directory rather than crowding into home/).
//
// Composes: sections + blocks (lesson-blocks.js), the jump-nav
// (lesson-toc.js), reader font/highlight prefs (lesson-reader-prefs.js),
// read-aloud (lesson-tts.js), and the local progress state
// (lesson-schema.js).
//
// ⚠️ Lessons are NEVER scored: no result page, no points, no level, and no
// Supabase write from any interaction here. The only persistence is
// localStorage.
// ============================================================================

import { container } from "../home/dom-refs.js";
import { escapeHtml } from "../home/escape-html.js";
import { ensureSharedSupabaseClient } from "../../shared/supabaseClientRegistry.js";
import {
  normalizeLessonContent,
  getLessonProgress,
  resolveRevealedSections,
} from "./lesson-schema.js";
import { renderBlock, equipQuestionBlocks, renderMathIn } from "./lesson-blocks.js";
import { renderLessonToc, equipLessonToc } from "./lesson-toc.js";
import {
  getReaderPrefs,
  setReaderPrefs,
  applyReaderPrefs,
  FONT_CHOICES,
  HIGHLIGHT_CHOICES,
} from "./lesson-reader-prefs.js";
import { renderTtsControl, equipTts } from "./lesson-tts.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolves the lesson id from the pathname, falling back to the
 * <meta name="lesson:id"> data-island injected by api/render-course.js's
 * contentType=lesson branch.
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

async function fetchLesson(idOrSlug) {
  const supabase = await ensureSharedSupabaseClient();
  if (!supabase) return null;

  const query = supabase
    .from("lessons")
    .select("id, slug, title, content, reader_prefs_default");
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
 * Batch-loads the referenced quizzes' titles/question counts for every
 * quizRef block, in ONE query rather than per-block, so a lesson with six
 * quiz references still costs a single round trip.
 *
 * A failure here is non-fatal: quizRef blocks fall back to their own
 * `title` (or a generic label) and still render a working link out.
 *
 * @param {string[]} quizIds
 * @returns {Promise<Map<string,{title:string,questionCount:number|null}>>}
 */
async function fetchQuizRefs(quizIds) {
  const lookup = new Map();
  if (quizIds.length === 0) return lookup;
  try {
    const supabase = await ensureSharedSupabaseClient();
    if (!supabase) return lookup;
    const { data, error } = await supabase.from("quizzes").select("data").in("id", quizIds);
    if (error) {
      console.error("[lesson-view] quizRef lookup failed:", error.message);
      return lookup;
    }
    for (const row of data || []) {
      const meta = row?.data?.meta || {};
      const stats = row?.data?.stats || {};
      if (!meta.id) continue;
      lookup.set(meta.id, {
        title: meta.title || "",
        questionCount: stats.questionCount ?? null,
      });
    }
  } catch (err) {
    console.error("[lesson-view] quizRef lookup threw:", err);
  }
  return lookup;
}

function collectQuizRefIds(normalized) {
  const ids = [];
  for (const section of normalized.sections) {
    for (const block of section.blocks) {
      if (block?.type === "quizRef" && block.quizId) ids.push(block.quizId);
    }
  }
  return Array.from(new Set(ids));
}

/**
 * Decides which sections are currently visible: everything not
 * `defaultHidden`, plus any hidden section a recorded answer has revealed.
 */
function computeVisibleSections(normalized, progress) {
  const revealed = resolveRevealedSections(normalized, progress);
  return normalized.sections.filter((s) => !s.defaultHidden || revealed.has(s.id));
}

function renderSection(section, ctx) {
  const blocksHtml = section.blocks.map((block) => renderBlock(block, ctx)).join("");
  return (
    `<section class="lesson-section" id="lesson-section-${escapeHtml(section.id)}" ` +
    `data-section-id="${escapeHtml(section.id)}">` +
    (section.title
      ? `<div class="lesson-section__header">` +
        `<h2 class="lesson-section__title">${escapeHtml(section.title)}</h2>` +
        renderTtsControl(escapeHtml(section.id)) +
        `</div>`
      : "") +
    `<div class="lesson-section__body">${blocksHtml}</div>` +
    `</section>`
  );
}

/** The reader's font/highlight picker — lesson-page-only, not part of the
 * shared markdown engine (only the CSS-variable hook is shared). */
function renderPrefsPopover(prefs) {
  const fontOptions = FONT_CHOICES.map(
    (f) =>
      `<option value="${escapeHtml(f.id)}"${f.id === prefs.fontId ? " selected" : ""}>` +
      `${escapeHtml(f.label)}</option>`,
  ).join("");
  const highlightSwatches = HIGHLIGHT_CHOICES.map(
    (h) =>
      `<button type="button" class="lesson-prefs__swatch${h.id === prefs.highlightId ? " is-active" : ""}" ` +
      `data-highlight-id="${escapeHtml(h.id)}" style="background:${h.value}" ` +
      `title="${escapeHtml(h.label)}" aria-label="${escapeHtml(h.label)}"></button>`,
  ).join("");

  return (
    `<div class="lesson-prefs">` +
    `<button type="button" class="lesson-prefs__toggle" aria-expanded="false">إعدادات القراءة</button>` +
    `<div class="lesson-prefs__panel" hidden>` +
    `<label class="lesson-prefs__row"><span>الخط</span>` +
    `<select class="lesson-prefs__font">${fontOptions}</select></label>` +
    `<div class="lesson-prefs__row"><span>لون التظليل</span>` +
    `<div class="lesson-prefs__swatches">${highlightSwatches}</div></div>` +
    `</div></div>`
  );
}

function equipPrefs(root, lessonEl, authorDefaults) {
  const prefsEl = root.querySelector(".lesson-prefs");
  if (!prefsEl) return;

  const toggle = prefsEl.querySelector(".lesson-prefs__toggle");
  const panel = prefsEl.querySelector(".lesson-prefs__panel");
  toggle?.addEventListener("click", () => {
    const open = panel.hidden;
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
  });

  prefsEl.querySelector(".lesson-prefs__font")?.addEventListener("change", (e) => {
    const next = setReaderPrefs({ fontId: e.target.value });
    applyReaderPrefs(lessonEl, next);
  });

  prefsEl.querySelectorAll(".lesson-prefs__swatch").forEach((swatch) => {
    swatch.addEventListener("click", () => {
      const next = setReaderPrefs({ highlightId: swatch.dataset.highlightId });
      applyReaderPrefs(lessonEl, next);
      prefsEl
        .querySelectorAll(".lesson-prefs__swatch")
        .forEach((s) => s.classList.toggle("is-active", s === swatch));
    });
  });

  // Author-set defaults only seed fields the reader hasn't chosen yet —
  // getReaderPrefs() handles that merge, so applying on load is enough.
  applyReaderPrefs(lessonEl, getReaderPrefs(authorDefaults));
}

/**
 * Renders the /lesson/:id view into #contentArea.
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

  const normalized = normalizeLessonContent(lesson.content);
  const quizLookup = await fetchQuizRefs(collectQuizRefIds(normalized));

  // paint() is re-run after an answer, because revealing an adaptive
  // section changes both the section list and the ToC. Progress is re-read
  // from storage each time rather than held in a local variable, so the
  // rendered state always matches what Phase 4 would later aggregate.
  const paint = () => {
    const progress = getLessonProgress(lesson.id);
    const visibleSections = computeVisibleSections(normalized, progress);
    const ctx = { lessonId: lesson.id, quizLookup };

    container.innerHTML =
      `<article class="lesson-view" data-lesson-id="${escapeHtml(lesson.id)}">` +
      `<header class="lesson-view__header">` +
      `<h1 class="lesson-view__title">${escapeHtml(lesson.title || "")}</h1>` +
      renderPrefsPopover(getReaderPrefs(lesson.reader_prefs_default)) +
      `</header>` +
      renderLessonToc(visibleSections, progress.visitedSections) +
      `<div class="lesson-view__body">` +
      visibleSections.map((section) => renderSection(section, ctx)).join("") +
      `</div></article>`;

    const lessonEl = container.querySelector(".lesson-view");
    equipPrefs(container, lessonEl, lesson.reader_prefs_default);
    equipQuestionBlocks(container, lesson.id, paint);
    equipLessonToc(container, lesson.id);
    equipTts(container);
    // KaTeX pass AFTER the innerHTML write, so the nodes exist for it to
    // walk (same ordering rule create-quiz.js follows).
    renderMathIn(lessonEl);
  };

  paint();
}
