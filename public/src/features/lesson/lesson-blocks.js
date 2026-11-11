// ============================================================================
// public/src/features/lesson/lesson-blocks.js
// BLOCK RENDERERS — one function per block type in `lessons.content`.
// ============================================================================
// Block types (see the lessons plan's Phase 2 step 1):
//   markdown | media | quizRef | lesson-reference | question
//
// Each renderer returns an HTML string; interactive wiring (the embedded
// question's click handling) is attached afterwards by equipQuestionBlocks()
// against the already-inserted DOM, so the whole lesson can be built with a
// single innerHTML write instead of per-block node surgery.
// ============================================================================

import { detectDirection, renderMarkdown, renderInlineMediaTag } from "../../shared/markdown.js";
import { escapeHtml } from "../home/escape-html.js";
import { recordQuestionAnswer, appendEssayAnswerText, resetLessonQuestionAnswers, resetQuestionAnswersByIds, getLessonProgress } from "./lesson-schema.js";
import { _confirm } from "../../components/notifications/notifications.js";
import { gradeEssay, isAnswerCorrect } from "../../shared/rate-answers.js";
import { lessonIcon } from "./lesson-icons.js";
import { ogThumbUrl } from "../../shared/og-thumb.js";

const questionRootCleanup = new WeakMap();

/**
 * Math is rendered by shared markdown.js as each markdown block is built.
 */
/**
 * Renders one block to an HTML string.
 *
 * @param {object} block
 * @param {{lessonId: string, quizLookup: Map<string,object>}} ctx
 * @returns {string}
 */
export function renderBlock(block, ctx) {
  switch (block?.type) {
    case "markdown":
      return renderMarkdownBlock(block);
    case "media":
      return renderMediaBlock(block);
    case "quizRef":
      return renderQuizRefBlock(block, ctx);
    case "lesson-reference":
    case "lessonRef":
      return renderLessonReferenceBlock(block, ctx);
    case "notebook-reference":
    case "notebookRef":
      return renderNotebookReferenceBlock(block, ctx);
    case "folder-reference":
    case "folderRef":
      return renderFolderReferenceBlock(block, ctx);
    case "course-reference":
    case "courseRef":
      return renderCourseReferenceBlock(block, ctx);
    case "question":
      return renderQuestionBlock(block, ctx);
    default:
      // Unknown block type — skip silently rather than breaking the whole
      // lesson render. Forward compatibility: a lesson authored against a
      // newer block vocabulary still renders everything this build knows.
      return "";
  }
}

function renderMarkdownBlock(block) {
  return `<div class="lesson-block lesson-block--markdown md-content">${renderMarkdown(block.body || "")}</div>`;
}

function renderMediaBlock(block) {
  const url = block.url || "";
  if (!url) return "";
  const kind = (block.kind || "image").toLowerCase();
  if (kind === "audio" || kind === "video") {
    // Reuse the shared engine's media tag builder so lesson media gets the
    // same skeleton/retry/YouTube handling as media inside quiz markdown.
    return `<div class="lesson-block lesson-block--media">${renderInlineMediaTag(kind, url, null)}</div>`;
  }
  return (
    `<div class="lesson-block lesson-block--media">` +
    `<img src="${escapeHtml(url)}" alt="${escapeHtml(block.alt || "")}" class="md-img" loading="lazy">` +
    `</div>`
  );
}

/**
 * Embedded quiz reference — a compact, READ-ONLY preview plus a link out to
 * /quiz/:id. The full quiz-taking UI is deliberately not inlined here (see
 * the plan's Phase 2 step 5): that would duplicate quiz.js's state machine
 * in a second page, and it keeps scoring unambiguously confined to the real
 * quiz page, which matters because lessons are never scored.
 */
function referenceActionButton(kind, action, id, title, label, icon, disabled = false) {
  return `<button type="button" class="lesson-ref-card__action lesson-ref-card__action--${action}" data-reference-kind="${kind}" data-reference-action="${action}" data-reference-id="${escapeHtml(id)}" data-reference-title="${escapeHtml(title)}" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}"${disabled ? " disabled aria-disabled=\"true\"" : ""}>${lessonIcon(icon)}<span>${escapeHtml(label)}</span></button>`;
}

/**
 * Thumbnail slot: a gradient placeholder with the kind icon is ALWAYS
 * rendered; the <img> (server-rendered /api/og picture) sits on top of it and
 * is removed on error (see equipReferenceThumbs), revealing the placeholder.
 * `thumbUrl` is null for protected/unavailable/unpublished items, so those
 * never trigger a request that could leak a title or show a broken image.
 */
function renderReferenceThumb(kind, thumbUrl, protectedContent) {
  const icon = (REF_KIND_META[kind] || REF_KIND_META.lesson).icon;
  return (
    `<div class="lesson-ref-card__thumb" aria-hidden="true">` +
    `<span class="lesson-ref-card__thumb-fallback">${lessonIcon(icon)}${protectedContent ? lessonIcon("lock", "lesson-ref-card__thumb-lock") : ""}</span>` +
    (thumbUrl ? `<img class="lesson-ref-card__thumb-img" src="${escapeHtml(thumbUrl)}" alt="" loading="lazy" decoding="async" width="1200" height="630">` : "") +
    `</div>`
  );
}

/** Removes thumbnails that fail to load so the placeholder underneath shows. */
export function equipReferenceThumbs(root) {
  if (!root) return;
  const drop = (img) => img.remove();
  root.querySelectorAll(".lesson-ref-card__thumb-img").forEach((img) => {
    if (img.complete && img.naturalWidth === 0 && img.getAttribute("src")) drop(img);
  });
  // `error` does not bubble, but it can be captured at the root.
  root.addEventListener("error", (event) => {
    const img = event.target;
    if (img instanceof HTMLImageElement && img.classList.contains("lesson-ref-card__thumb-img")) drop(img);
  }, true);
}

const REF_KIND_META = {
  quiz: { label: "امتحان", icon: "exam", missing: "امتحان غير متاح", start: "ابدأ الامتحان" },
  lesson: { label: "درس", icon: "book", missing: "درس غير متاح", start: "فتح الدرس" },
  notebook: { label: "دفتر", icon: "notebook", missing: "دفتر غير متاح", start: "فتح الدفتر" },
  folder: { label: "مجلد", icon: "folder", missing: "مجلد غير متاح", start: "فتح المجلد" },
  course: { label: "مادة", icon: "course", missing: "مادة غير متاحة", start: "فتح المادة" },
};

/**
 * Shared card for every embed kind. Quiz and lesson references get the full
 * action row. Notebook references keep an open link and add download/info/ask;
 * folder and course cards remain pure link-outs.
 */
function renderReferenceCard({ kind, id, title, description, countLabel, available, protectedContent, thumbUrl = null, href = null }) {
  const meta = REF_KIND_META[kind] || REF_KIND_META.lesson;
  const linkOut = kind !== "quiz" && kind !== "lesson";
  const hasNotebookActions = kind === "notebook";
  const hasInlineActions = !linkOut || hasNotebookActions;
  const bodyTitle = title || meta.missing;
  return (
    `<article class="lesson-ref-card lesson-ref-card--${kind} lesson-ref-card--has-thumb${available ? "" : " is-unavailable"}" data-reference-card data-reference-kind="${kind}">` +
    renderReferenceThumb(kind, available && !protectedContent ? thumbUrl : null, protectedContent) +
    `<div class="lesson-ref-card__main">` +
    `<div class="lesson-ref-card__icon" aria-hidden="true">${lessonIcon(meta.icon)}</div>` +
    `<div class="lesson-ref-card__copy">` +
    `<span class="lesson-ref-card__label">${meta.label}</span>` +
    `<h3 class="lesson-ref-card__title">${escapeHtml(bodyTitle)}</h3>` +
    (description ? `<p class="lesson-ref-card__description">${escapeHtml(description)}</p>` : "") +
    (countLabel ? `<span class="lesson-ref-card__count">${escapeHtml(countLabel)}</span>` : "") +
    (!available ? `<p class="lesson-ref-card__unavailable">العنصر المرجعي لم يعد متاحًا.</p>` : "") +
    (protectedContent ? `<span class="lesson-ref-card__protected">${lessonIcon("lock")} محمي بكلمة مرور</span>` : "") +
    `</div></div>` +
    `<div class="lesson-ref-card__actions" role="group" aria-label="إجراءات العنصر المرتبط">` +
    (linkOut
      ? (available && href
        ? `<a class="lesson-ref-card__action lesson-ref-card__action--start" href="${escapeHtml(href)}">${lessonIcon(meta.icon)}<span>${escapeHtml(meta.start)}</span></a>`
        : `<span class="lesson-ref-card__action lesson-ref-card__action--start" aria-disabled="true">${lessonIcon(meta.icon)}<span>${escapeHtml(meta.start)}</span></span>`)
      : referenceActionButton(kind, "start", id, bodyTitle, meta.start, kind === "quiz" ? "play" : "book", !available)) +
    (hasInlineActions
      ?
        referenceActionButton(kind, "download", id, bodyTitle, "تنزيل", "download", !available) +
        referenceActionButton(kind, "info", id, bodyTitle, "معلومات", "info", hasNotebookActions ? !available : false) +
        referenceActionButton(kind, "ask", id, bodyTitle, "اسأل الباشـمبصمج", "sparkle", !available)
      : "") +
    `</div></article>`
  );
}

function renderQuizRefBlock(block, ctx) {
  const quizId = String(block.quizId || "").trim();
  if (!quizId) return `<div class="lesson-ref-card lesson-ref-card--quiz is-unavailable"><div class="lesson-ref-card__unavailable">مرجع الامتحان غير صالح.</div></div>`;
  const quiz = ctx?.quizLookup?.get(quizId) || null;
  const title = quiz?.title || block.title || "امتحان";
  const count = typeof quiz?.questionCount === "number" ? `${quiz.questionCount} سؤال` : "";
  const quizCode = String(quiz?.meta?.id || quiz?.id || "");
  // Only published platform quizzes (8-char public code) have a rendered thumbnail.
  const thumbUrl = quiz && quiz.source === "platform" && /^[A-Za-z0-9]{8}$/.test(quizCode)
    ? ogThumbUrl("quiz", { id: quizCode, updatedAt: quiz.meta?.updatedAt || quiz.meta?.createdAt || null })
    : null;
  return renderReferenceCard({ kind: "quiz", id: quizId, title, description: quiz?.description || "", countLabel: count, available: Boolean(quiz), protectedContent: Boolean(quiz?.passwordProtected), thumbUrl });
}

function renderLessonReferenceBlock(block, ctx) {
  const lessonId = String(block.lessonId || "").trim();
  if (!lessonId) return `<div class="lesson-ref-card lesson-ref-card--lesson is-unavailable"><div class="lesson-ref-card__unavailable">مرجع الدرس غير صالح.</div></div>`;
  if (String(lessonId) === String(ctx?.lessonId || "")) {
    return `<div class="lesson-ref-card lesson-ref-card--lesson is-unavailable"><div class="lesson-ref-card__unavailable">لا يمكن للدرس أن يربط نفسه.</div></div>`;
  }
  const target = ctx?.lessonLookup?.get(lessonId) || null;
  const title = target?.title || block.title || "درس";
  return renderReferenceCard({
    kind: "lesson",
    id: lessonId,
    title,
    description: target?.description || "",
    countLabel: Number.isFinite(Number(target?.section_count)) ? `${Number(target.section_count)} أقسام` : "",
    available: Boolean(target),
    protectedContent: Boolean(target?.password_protected || target?.passwordProtected),
    // Local (localStorage) lessons have no published id/slug: placeholder only.
    thumbUrl: target && !target.localRow ? ogThumbUrl("lesson", { id: target.slug || target.id, updatedAt: target.updated_at }) : null,
  });
}

function invalidEmbedCard(kind, text) {
  return `<div class="lesson-ref-card lesson-ref-card--${kind} is-unavailable"><div class="lesson-ref-card__unavailable">${text}</div></div>`;
}

function renderNotebookReferenceBlock(block, ctx) {
  const id = String(block.notebookId || "").trim();
  if (!id) return invalidEmbedCard("notebook", "مرجع الدفتر غير صالح.");
  const nb = ctx?.notebookLookup?.get(id) || null;
  return renderReferenceCard({
    kind: "notebook",
    id,
    title: nb?.title || block.title || "دفتر",
    description: nb?.description || "",
    countLabel: Number.isFinite(Number(nb?.cell_count)) ? `${Number(nb.cell_count)} خلية` : "",
    available: Boolean(nb),
    protectedContent: false,
    href: nb ? `/notebook/${encodeURIComponent(nb.slug || nb.id)}` : null,
    thumbUrl: nb ? ogThumbUrl("notebook", { id: nb.slug || nb.id, updatedAt: nb.updated_at }) : null,
  });
}

function renderCourseReferenceBlock(block, ctx) {
  const id = String(block.courseId || "").trim();
  if (!id) return invalidEmbedCard("course", "مرجع المادة غير صالح.");
  const course = ctx?.courseLookup?.get(id) || null;
  return renderReferenceCard({
    kind: "course",
    id,
    title: course?.name || block.title || "مادة",
    description: "",
    countLabel: "",
    available: Boolean(course),
    protectedContent: false,
    href: course?.href || null,
    thumbUrl: course ? ogThumbUrl("course", { id: course.id, updatedAt: course.updated_at }) : null,
  });
}

function renderFolderReferenceBlock(block, ctx) {
  const id = String(block.folderId || "").trim();
  if (!id) return invalidEmbedCard("folder", "مرجع المجلد غير صالح.");
  const folder = ctx?.folderLookup?.get(id) || null;
  return renderReferenceCard({
    kind: "folder",
    id,
    title: folder?.name || block.title || "مجلد",
    description: folder?.pathLabel || "",
    countLabel: "",
    available: Boolean(folder),
    protectedContent: false,
    href: folder?.href || null,
    thumbUrl: folder ? ogThumbUrl("folder", { id: folder.course_id, folderPath: folder.path, updatedAt: folder.updated_at }) : null,
  });
}

/**
 * Embedded question — its own small, self-contained UI, NOT a reuse of
 * quiz.js's question renderer (that component is built around a
 * multi-question submit-the-whole-quiz flow; this is a standalone question
 * with the same select/check/review rhythm).
 *
 * Shows correct/incorrect feedback and explanations, writes only to the
 * local progress state, and never makes a network call. Dispatches on
 * `block.questionKind` ("mcq", the default for pre-existing rows without
 * the field, or "essay") to one of two structurally different bodies —
 * see renderMcqQuestionBody/renderEssayQuestionBody below.
 */
function renderQuestionBlock(block, ctx) {
  const questionId = block.id || "";
  if (!questionId) return "";

  const prior = getLessonProgress(ctx.lessonId)?.questions?.[questionId] || null;
  const isEssay = block.questionKind === "essay";
  const questionNumber = ctx.questionLabels?.get(questionId);
  const questionHeader = renderQuestionHeader(
    questionNumber,
    isEssay ? "سؤال مقالي" : block.multiSelect ? "اختيار متعدد" : "اختيار من متعدد",
  );

  if (isEssay) {
    if (!block.modelAnswer) return "";
    return renderEssayQuestionBody(block, questionId, prior, questionHeader);
  }

  const options = Array.isArray(block.options) ? block.options : [];
  if (options.length === 0) return "";
  return renderMcqQuestionBody(block, questionId, options, prior, questionHeader);
}

function renderQuestionHeader(questionNumber, typeLabel) {
  return (
    `<div class="lesson-question__header">` +
    (questionNumber
      ? `<span class="lesson-question__number">سؤال ${questionNumber.index} من ${questionNumber.total}</span>`
      : `<span class="lesson-question__number">سؤال</span>`) +
    `<span class="lesson-question__type">${escapeHtml(typeLabel)}</span>` +
    `</div>`
  );
}

function renderMcqQuestionBody(block, questionId, options, prior, header) {
  const correctIndexes = block.multiSelect
    ? (Array.isArray(block.correctIndexes) ? block.correctIndexes : [block.correctIndex])
    : [Number(block.correctIndex) || 0];
  const multiSelect = Boolean(block.multiSelect);
  // Restore a previously-recorded answer so a reload shows the same
  // revealed state the reader left behind (the reveal itself is recomputed
  // from progress by resolveRevealedSections, so these must agree).
  const optionsHtml = options
    .map(
      (opt, i) => {
        const optionText = String(opt);
        const direction = detectDirection(optionText);
        return `<button type="button" class="lesson-question__option" dir="${direction}" data-option-index="${i}" aria-pressed="false">` +
          `<span class="lesson-question__option-marker" dir="ltr" aria-hidden="true">${String.fromCharCode(65 + i)}</span>` +
          `<span class="lesson-question__option-text md-content">${renderMarkdown(optionText)}</span>` +
          `</button>`;
      },
    )
    .join("");
  const correctAnswers = correctIndexes.map((index) => options[index]).filter(Boolean);

  return (
    `<article class="lesson-block lesson-block--question lesson-question" ` +
    `data-question-kind="mcq" ` +
    `id="lesson-question-${escapeHtml(questionId)}" ` +
    `data-question-id="${escapeHtml(questionId)}" ` +
    `data-correct-indexes="${escapeHtml(JSON.stringify(correctIndexes))}" ` +
    `data-multi-select="${multiSelect}"` +
    (prior?.answered ? ` data-answered="true"` : "") +
    `>` +
    header +
    `<div class="lesson-question__prompt md-content">${renderMarkdown(block.prompt || "")}</div>` +
    `<div class="lesson-question__options" role="group" aria-label="خيارات الإجابة">${optionsHtml}</div>` +
    `<button type="button" class="lesson-question__check-btn" data-question-check disabled>${multiSelect ? "تحقق من الإجابات" : "تحقق من الإجابة"}</button>` +
    `<div class="lesson-question__feedback" role="status" aria-live="polite" hidden>` +
    `<div class="lesson-question__verdict"><span class="lesson-question__verdict-icon" aria-hidden="true"></span><span class="lesson-question__verdict-text"></span></div>` +
    `<div class="lesson-question__correct-answer"><span class="lesson-question__answer-label">${correctAnswers.length > 1 ? "الإجابات الصحيحة" : "الإجابة الصحيحة"}</span><div class="lesson-question__answer-body md-content">${correctAnswers.map((answer) => renderMarkdown(String(answer))).join("")}</div></div>` +
    (block.explanation
      ? `<div class="lesson-question__explanation"><div class="lesson-question__explanation-label">الشرح</div><div class="md-content">${renderMarkdown(block.explanation)}</div></div>`
      : "") +
    `</div>` +
    `</article>`
  );
}

/**
 * Essay body: a free-text <textarea> plus a "تحقق" (check) button, rather
 * than the MCQ's click-an-option interaction. Grading is client-side text
 * similarity only (gradeEssay(), the same function quiz.js uses for essay
 * questions) — never a network call or an overall lesson grade. The
 * approximate 0–5 rating is shown beside the model answer as self-check
 * feedback.
 */
function renderEssayQuestionBody(block, questionId, prior, header) {
  const priorAnswer = typeof prior?.answerText === "string" ? prior.answerText : "";
  return (
    `<article class="lesson-block lesson-block--question lesson-question" ` +
    `data-question-kind="essay" ` +
    `id="lesson-question-${escapeHtml(questionId)}" ` +
    `data-question-id="${escapeHtml(questionId)}" ` +
    `data-model-answer="${escapeHtml(block.modelAnswer || "")}"` +
    (prior?.answered ? ` data-answered="true"` : "") +
    `>` +
    header +
    `<div class="lesson-question__prompt md-content">${renderMarkdown(block.prompt || "")}</div>` +
    `<label class="lesson-question__essay-wrap"><span class="lesson-question__essay-label">إجابتك</span><textarea dir="auto" class="lesson-question__essay-input" rows="4" placeholder="اكتب إجابتك هنا…" ${prior?.answered ? "disabled" : ""}>${escapeHtml(priorAnswer)}</textarea></label>` +
    `<div class="lesson-question__essay-actions">` +
    `<button type="button" class="lesson-question__essay-check-btn" ${prior?.answered || !priorAnswer.trim() ? "disabled" : ""}>تحقق من الإجابة</button>` +
    `</div>` +
    `<div class="lesson-question__feedback" role="status" aria-live="polite" hidden>` +
    `<div class="lesson-question__verdict"><span class="lesson-question__verdict-icon" aria-hidden="true"></span><span class="lesson-question__verdict-text"></span></div>` +
    `<div class="lesson-question__essay-rating" aria-label="التقييم التقريبي من خمسة"><span class="lesson-question__score-badge"></span><span class="lesson-question__stars" aria-hidden="true"></span></div>` +
    `<div class="lesson-question__model-answer"><span class="lesson-question__answer-label">الإجابة النموذجية</span><div class="lesson-question__answer-body md-content">${renderMarkdown(block.modelAnswer || "")}</div></div>` +
    (block.explanation
      ? `<div class="lesson-question__explanation"><div class="lesson-question__explanation-label">الشرح</div><div class="md-content">${renderMarkdown(block.explanation)}</div></div>`
      : "") +
    `</div>` +
    `</article>`
  );
}

/**
 * Wires click handling for every embedded question inside `root`.
 *
 * @param {HTMLElement} root
 * @param {string} lessonId
 * @param {() => void} onAnswered - called after progress is written, so the
 *   viewer can re-evaluate adaptive section visibility
 */
export function equipQuestionBlocks(root, lessonId, onAnswered, onExplainWrong) {
  if (!root) return;

  questionRootCleanup.get(root)?.();

  // The lesson-wide reset lives in the viewer header, but the question block
  // module owns the actual progress mutation so every question source is
  // cleared, including adaptive questions that are currently hidden.
  const handleRootClick = async (e) => {
    const resetAll = e.target.closest("[data-reset-all-questions]");
    if (resetAll) {
      if (resetAll.disabled) return;
      resetAll.disabled = true;
      try {
        const accepted = await _confirm(
          "سيتم مسح جميع إجابات أسئلة هذا الدرس، مع الإبقاء على تقدّم القراءة والعلامات المرجعية. هل تريد المتابعة؟",
        );
        if (!accepted) return;
        resetLessonQuestionAnswers(lessonId);
        onAnswered?.();
      } finally {
        resetAll.disabled = false;
      }
      return;
    }
    const jump = e.target.closest("[data-recap-jump]");
    if (jump) {
      e.preventDefault();
      const target = root.querySelector(`.lesson-question[data-question-id="${CSS.escape(jump.dataset.recapJump)}"]`);
      target?.scrollIntoView({ behavior: document.documentElement.dataset.motion === "reduced" ? "auto" : "smooth", block: "center" });
      return;
    }
    const retryWrong = e.target.closest("[data-retry-wrong]");
    if (retryWrong) {
      if (retryWrong.disabled) return;
      let ids = [];
      try { ids = JSON.parse(retryWrong.closest("[data-lesson-recap]")?.dataset.wrongIds || "[]"); } catch { ids = []; }
      if (!ids.length) return;
      // Clears ONLY the wrong questions' stored answers, resets just their DOM,
      // then follows the same refresh path as reset-all (onAnswered).
      resetQuestionAnswersByIds(lessonId, ids);
      ids.forEach((id) => {
        const qEl = root.querySelector(`.lesson-question[data-question-id="${CSS.escape(id)}"]`);
        if (qEl) resetQuestionElement(qEl);
      });
      onAnswered?.();
      root.querySelector(`.lesson-question[data-question-id="${CSS.escape(ids[0])}"]`)
        ?.scrollIntoView({ behavior: document.documentElement.dataset.motion === "reduced" ? "auto" : "smooth", block: "center" });
      return;
    }
    const btn = e.target.closest("[data-explain-wrong]");
    if (!btn || typeof onExplainWrong !== "function") return;
    const questionEl = btn.closest(".lesson-question");
    if (!questionEl) return;
    const promptEl = questionEl.querySelector(".lesson-question__prompt");
    const questionText = promptEl?.textContent?.trim() || "";
    if (questionEl.dataset.questionKind === "mcq") {
      const options = [...questionEl.querySelectorAll(".lesson-question__option-text")].map((el) => el.textContent.trim());
      const correctIndexes = (() => { try { return JSON.parse(questionEl.dataset.correctIndexes || "[]"); } catch { return []; } })();
      const chosenIndexes = [...questionEl.querySelectorAll(".lesson-question__option.is-selected")]
        .map((el) => Number(el.dataset.optionIndex));
      onExplainWrong({
        kind: "mcq",
        question: questionText,
        options,
        correctAnswers: correctIndexes.map((i) => options[i]).filter(Boolean),
        chosenAnswers: chosenIndexes.map((i) => options[i]).filter(Boolean),
      });
    } else {
      const modelAnswer = questionEl.dataset.modelAnswer || "";
      const myAnswer = questionEl.querySelector(".lesson-question__essay-input")?.value || "";
      onExplainWrong({ kind: "essay", question: questionText, modelAnswer, myAnswer });
    }
  };

  root.addEventListener("click", handleRootClick);
  questionRootCleanup.set(root, () => root.removeEventListener("click", handleRootClick));

  root.querySelectorAll('.lesson-question[data-question-kind="mcq"]').forEach((questionEl) => {
    const questionId = questionEl.dataset.questionId;
    let correctIndexes = [0];
    try { correctIndexes = JSON.parse(questionEl.dataset.correctIndexes || "[0]"); } catch (_) { }
    const multiSelect = questionEl.dataset.multiSelect === "true";

    // Replay a stored answer into the DOM without re-firing the handler.
    const prior = getLessonProgress(lessonId)?.questions?.[questionId];
    if (prior?.answered) {
      revealMcqAnswer(questionEl, correctIndexes, prior.wasCorrect, prior.selectedIndexes || null);
    }

    questionEl.querySelectorAll(".lesson-question__option").forEach((optionBtn) => {
      optionBtn.addEventListener("click", () => {
        if (questionEl.dataset.answered === "true") return; // reveal-once
        const chosen = Number(optionBtn.dataset.optionIndex);
        if (multiSelect) {
          optionBtn.classList.toggle("is-selected");
        } else {
          questionEl.querySelectorAll(".lesson-question__option").forEach((option) => {
            const selected = option === optionBtn;
            option.classList.toggle("is-selected", selected);
            option.setAttribute("aria-pressed", String(selected));
          });
        }
        optionBtn.setAttribute("aria-pressed", String(optionBtn.classList.contains("is-selected")));
        const checkBtn = questionEl.querySelector("[data-question-check]");
        if (checkBtn) checkBtn.disabled = questionEl.querySelectorAll(".lesson-question__option.is-selected").length === 0;
      });
    });
    questionEl.querySelector("[data-question-check]")?.addEventListener("click", () => {
      if (questionEl.dataset.answered === "true") return;
      const selected = [...questionEl.querySelectorAll(".lesson-question__option.is-selected")]
        .map((button) => Number(button.dataset.optionIndex));
      if (!selected.length) return;
      const wasCorrect = isAnswerCorrect(selected, correctIndexes);
      recordQuestionAnswer(lessonId, questionId, wasCorrect, selected);
      revealMcqAnswer(questionEl, correctIndexes, wasCorrect, selected);
      if (typeof onAnswered === "function") onAnswered();
    });
  });

  root.querySelectorAll('.lesson-question[data-question-kind="essay"]').forEach((questionEl) => {
    const questionId = questionEl.dataset.questionId;
    const modelAnswer = questionEl.dataset.modelAnswer || "";

    const prior = getLessonProgress(lessonId)?.questions?.[questionId];
    if (prior?.answered) {
      revealEssayAnswer(questionEl, modelAnswer, prior.answerText || "");
    }

    const checkBtn = questionEl.querySelector(".lesson-question__essay-check-btn");
    const textarea = questionEl.querySelector(".lesson-question__essay-input");
    textarea?.addEventListener("input", () => {
      if (questionEl.dataset.answered !== "true" && checkBtn) {
        checkBtn.disabled = !textarea.value.trim();
      }
    });
    checkBtn?.addEventListener("click", () => {
      if (questionEl.dataset.answered === "true") return; // reveal-once
      const answerText = textarea?.value || "";
      // The 0–5 score is approximate self-check feedback, computed locally;
      // it is not submitted or included in an overall lesson score.
      const score = gradeEssay(answerText, modelAnswer);
      recordQuestionAnswer(lessonId, questionId, score >= 3);
      // recordQuestionAnswer only stores {answered, wasCorrect} by default
      // (see lesson-schema.js) — essay questions additionally need their
      // own answer text preserved so a reload can redisplay what the
      // reader wrote, so this call directly extends that same stored
      // entry rather than growing recordQuestionAnswer's signature for a
      // field only essay questions use.
      appendEssayAnswerText(lessonId, questionId, answerText);
      revealEssayAnswer(questionEl, modelAnswer, answerText);
      if (typeof onAnswered === "function") onAnswered();
    });
  });
}

/** Returns one embedded question's DOM to its unanswered state (no storage writes). */
export function resetQuestionElement(qEl) {
  qEl.dataset.answered = "false";
  delete qEl.dataset.result;
  qEl.querySelectorAll(".lesson-question__option").forEach((btn) => {
    btn.classList.remove("is-selected", "is-correct", "is-wrong", "is-missed");
    btn.disabled = false;
    btn.setAttribute("aria-pressed", "false");
  });
  const checkBtn = qEl.querySelector("[data-question-check]");
  if (checkBtn) checkBtn.disabled = true;

  const textarea = qEl.querySelector(".lesson-question__essay-input");
  if (textarea) {
    textarea.value = "";
    textarea.disabled = false;
  }
  const essayCheck = qEl.querySelector(".lesson-question__essay-check-btn");
  if (essayCheck) essayCheck.disabled = true;

  const feedback = qEl.querySelector(".lesson-question__feedback");
  if (feedback) {
    feedback.hidden = true;
    feedback.querySelector("[data-explain-wrong]")?.remove();
  }
}

/** Static recap card shell, mounted after the last section; filled by refreshLessonRecap(). */
export function renderLessonRecap() {
  return (
    `<section class="lesson-recap" data-lesson-recap hidden aria-labelledby="lessonRecapTitle">` +
    `<h2 class="lesson-recap__title" id="lessonRecapTitle">ملخص الأسئلة</h2>` +
    `<div class="lesson-recap__stats">` +
    `<span class="lesson-recap__stat" data-recap-answered></span>` +
    `<span class="lesson-recap__stat lesson-recap__stat--correct" data-recap-correct></span>` +
    `</div>` +
    `<div class="lesson-recap__bar" role="progressbar" aria-label="نسبة الأسئلة المجاب عنها" aria-valuemin="0" aria-valuemax="100"><span data-recap-bar></span></div>` +
    `<div class="lesson-recap__wrong-wrap" data-recap-wrong-wrap hidden>` +
    `<div class="lesson-recap__wrong-title">أسئلة تحتاج مراجعة</div>` +
    `<ul class="lesson-recap__wrong" data-recap-wrong></ul>` +
    `<button type="button" class="lesson-recap__retry" data-retry-wrong>إعادة المحاولة للأسئلة الخاطئة</button>` +
    `</div>` +
    `</section>`
  );
}

/**
 * Updates the recap from stored progress. `questions` = the questions
 * currently reachable (visible sections), as [{ id, label, number }].
 */
export function refreshLessonRecap(root, lessonId, questions) {
  const recap = root?.querySelector("[data-lesson-recap]");
  if (!recap) return;
  const list = Array.isArray(questions) ? questions : [];
  recap.hidden = list.length === 0;
  if (!list.length) return;

  const stored = getLessonProgress(lessonId)?.questions || {};
  const answered = list.filter((q) => stored[q.id]?.answered);
  const correct = answered.filter((q) => stored[q.id]?.wasCorrect);
  const wrong = answered.filter((q) => !stored[q.id]?.wasCorrect);

  recap.querySelector("[data-recap-answered]").textContent = `أجبت على ${answered.length} من ${list.length}`;
  recap.querySelector("[data-recap-correct]").textContent = `الصحيحة: ${correct.length}`;
  const pct = Math.round((answered.length / list.length) * 100);
  const bar = recap.querySelector(".lesson-recap__bar");
  bar?.setAttribute("aria-valuenow", String(pct));
  const fill = recap.querySelector("[data-recap-bar]");
  if (fill) fill.style.width = `${pct}%`;

  const wrongWrap = recap.querySelector("[data-recap-wrong-wrap]");
  const wrongList = recap.querySelector("[data-recap-wrong]");
  wrongWrap.hidden = wrong.length === 0;
  recap.dataset.wrongIds = JSON.stringify(wrong.map((q) => q.id));
  wrongList.replaceChildren(...wrong.map((q) => {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = `#lesson-question-${q.id}`;
    a.dataset.recapJump = q.id;
    a.textContent = `${q.number ? `سؤال ${q.number}: ` : ""}${q.label}`;
    li.appendChild(a);
    return li;
  }));
}

function renderExplainWrongButton(feedback) {
  // One "اشرح لي إجابتي" trigger per feedback block — re-grading via
  // "إعادة المحاولة" removes the whole feedback block anyway (see the
  // reset handler above), so there's no separate cleanup needed when a
  // question moves from wrong back to ungraded.
  if (feedback.querySelector("[data-explain-wrong]")) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "lesson-question__explain-wrong-btn";
  btn.dataset.explainWrong = "true";
  btn.textContent = "اشرح لي ليه إجابتي غلط";
  feedback.appendChild(btn);
}

function setVerdict(verdict, text, good) {
  verdict.querySelector(".lesson-question__verdict-text").textContent = text;
  verdict.querySelector(".lesson-question__verdict-icon").textContent = good ? "✓" : "✕";
  verdict.classList.toggle("is-correct", good);
  verdict.classList.toggle("is-wrong", !good);
}

function revealMcqAnswer(questionEl, correctIndexes, wasCorrect, chosenIndexes) {
  questionEl.dataset.answered = "true";
  questionEl.dataset.result = wasCorrect ? "correct" : "wrong";
  const multi = questionEl.dataset.multiSelect === "true";
  questionEl.querySelectorAll(".lesson-question__option").forEach((btn) => {
    const idx = Number(btn.dataset.optionIndex);
    const selected = chosenIndexes?.includes(idx) || false;
    btn.classList.toggle("is-selected", selected);
    btn.setAttribute("aria-pressed", String(selected));
    btn.disabled = true;
    const isCorrect = correctIndexes.includes(idx);
    // A correct option the reader skipped in a multi-select question is
    // marked "missed" (dashed) so it reads differently from a correct pick.
    if (isCorrect && (selected || !multi)) btn.classList.add("is-correct");
    if (isCorrect && !selected && multi) btn.classList.add("is-missed");
    if (selected && !isCorrect) btn.classList.add("is-wrong");
  });
  const checkBtn = questionEl.querySelector("[data-question-check]");
  if (checkBtn) checkBtn.disabled = true;

  const feedback = questionEl.querySelector(".lesson-question__feedback");
  if (feedback) {
    feedback.hidden = false;
    const verdict = feedback.querySelector(".lesson-question__verdict");
    if (verdict) setVerdict(verdict, wasCorrect ? "إجابة صحيحة" : "إجابة غير صحيحة — راجع الخيارات الصحيحة", wasCorrect);
    if (!wasCorrect) renderExplainWrongButton(feedback);
  }
}

/**
 * Reveals an essay question's self-check: disables further editing, shows
 * the model answer, and displays gradeEssay()'s approximate local rating.
 */
function revealEssayAnswer(questionEl, modelAnswer, answerText) {
  questionEl.dataset.answered = "true";
  const textarea = questionEl.querySelector(".lesson-question__essay-input");
  if (textarea) {
    textarea.value = answerText;
    textarea.disabled = true;
  }
  const checkBtn = questionEl.querySelector(".lesson-question__essay-check-btn");
  if (checkBtn) checkBtn.disabled = true;

  const score = gradeEssay(answerText, modelAnswer);
  const wasClose = score >= 3;
  questionEl.dataset.result = wasClose ? "correct" : "wrong";

  const feedback = questionEl.querySelector(".lesson-question__feedback");
  if (feedback) {
    feedback.hidden = false;
    const verdict = feedback.querySelector(".lesson-question__verdict");
    if (verdict) setVerdict(verdict, wasClose ? "إجابتك قريبة من النموذجية" : "راجع الإجابة النموذجية", wasClose);
    const rating = feedback.querySelector(".lesson-question__essay-rating");
    if (rating) {
      const badge = rating.querySelector(".lesson-question__score-badge");
      const stars = rating.querySelector(".lesson-question__stars");
      if (badge) badge.textContent = `${score}/5`;
      if (stars) stars.textContent = "★".repeat(score) + "☆".repeat(5 - score);
      rating.setAttribute("aria-label", `التقييم التقريبي: ${score} من 5`);
    }
    if (!wasClose) renderExplainWrongButton(feedback);
  }
}
