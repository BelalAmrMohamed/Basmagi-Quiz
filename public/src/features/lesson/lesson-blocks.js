// ============================================================================
// public/src/features/lesson/lesson-blocks.js
// BLOCK RENDERERS — one function per block type in `lessons.content`.
// ============================================================================
// Block types (see the lessons plan's Phase 2 step 1):
//   markdown | media | quizRef | question
//
// Each renderer returns an HTML string; interactive wiring (the embedded
// question's click handling) is attached afterwards by equipQuestionBlocks()
// against the already-inserted DOM, so the whole lesson can be built with a
// single innerHTML write instead of per-block node surgery.
// ============================================================================

import { renderMarkdown, renderInlineMediaTag } from "../../shared/markdown.js";
import { escapeHtml } from "../home/escape-html.js";
import { recordQuestionAnswer, appendEssayAnswerText, getLessonProgress } from "./lesson-schema.js";
import { gradeEssay, isAnswerCorrect } from "../../shared/rate-answers.js";

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
function renderQuizRefBlock(block, ctx) {
  const quizId = block.quizId || "";
  if (!quizId) return "";
  const quiz = ctx?.quizLookup?.get(quizId) || null;
  const title = quiz?.title || block.title || "امتحان";
  const countLabel =
    typeof quiz?.questionCount === "number" ? `${quiz.questionCount} سؤال` : "";

  return (
    `<div class="lesson-block lesson-block--quiz-ref">` +
    `<div class="lesson-quiz-ref__info">` +
    `<span class="lesson-quiz-ref__label">امتحان مرتبط</span>` +
    `<h4 class="lesson-quiz-ref__title">${escapeHtml(title)}</h4>` +
    (countLabel ? `<span class="lesson-quiz-ref__count">${escapeHtml(countLabel)}</span>` : "") +
    `</div>` +
    `<a class="lesson-quiz-ref__link" href="/quiz/${encodeURIComponent(quizId)}">ابدأ الامتحان</a>` +
    `</div>`
  );
}

/**
 * Embedded question — its own small, self-contained UI, NOT a reuse of
 * quiz.js's question renderer (that component is built around a
 * multi-question submit-the-whole-quiz flow; this is a single standalone
 * question revealed immediately on answer — see the plan's Phase 2 step 6).
 *
 * Reveal-only: shows correct/incorrect + explanation on click, writes to
 * the local progress state, and never makes a network call. Dispatches on
 * `block.questionKind` ("mcq", the default for pre-existing rows without
 * the field, or "essay") to one of two structurally different bodies —
 * see renderMcqQuestionBody/renderEssayQuestionBody below.
 */
function renderQuestionBlock(block, ctx) {
  const questionId = block.id || "";
  if (!questionId) return "";

  const prior = getLessonProgress(ctx.lessonId)?.questions?.[questionId] || null;
  const isEssay = block.questionKind === "essay";

  if (isEssay) {
    if (!block.modelAnswer) return "";
    return renderEssayQuestionBody(block, questionId, prior);
  }

  const options = Array.isArray(block.options) ? block.options : [];
  if (options.length === 0) return "";
  return renderMcqQuestionBody(block, questionId, options, prior);
}

function renderMcqQuestionBody(block, questionId, options, prior) {
  const correctIndexes = block.multiSelect
    ? (Array.isArray(block.correctIndexes) ? block.correctIndexes : [block.correctIndex])
    : [Number(block.correctIndex) || 0];
  const multiSelect = Boolean(block.multiSelect);
  // Restore a previously-recorded answer so a reload shows the same
  // revealed state the reader left behind (the reveal itself is recomputed
  // from progress by resolveRevealedSections, so these must agree).
  const optionsHtml = options
    .map(
      (opt, i) =>
        `<button type="button" class="lesson-question__option" data-option-index="${i}">` +
        `<span class="lesson-question__option-text md-content">${renderMarkdown(String(opt))}</span>` +
        `</button>`,
    )
    .join("");

  return (
    `<div class="lesson-block lesson-block--question lesson-question" ` +
    `data-question-kind="mcq" ` +
    `data-question-id="${escapeHtml(questionId)}" ` +
    `data-correct-indexes="${escapeHtml(JSON.stringify(correctIndexes))}" ` +
    `data-multi-select="${multiSelect}"` +
    (prior?.answered ? ` data-answered="true"` : "") +
    `>` +
    `<div class="lesson-question__prompt md-content">${renderMarkdown(block.prompt || "")}</div>` +
    `<div class="lesson-question__options">${optionsHtml}</div>` +
    (multiSelect ? `<button type="button" class="lesson-question__check-btn">تحقق من الإجابات</button>` : "") +
    `<div class="lesson-question__feedback" hidden>` +
    `<span class="lesson-question__verdict"></span>` +
    (block.explanation
      ? `<div class="lesson-question__explanation md-content">${renderMarkdown(block.explanation)}</div>`
      : "") +
    `</div>` +
    `</div>`
  );
}

/**
 * Essay body: a free-text <textarea> plus a "تحقق" (check) button, rather
 * than the MCQ's click-an-option interaction. Grading is client-side text
 * similarity only (gradeEssay(), same function quiz.js uses for its own
 * essay questions) — never a network call, and never anything that could
 * be mistaken for a real score: the reveal shows the reader's own answer
 * next to the model answer and a rough "قريب/بعيد عن الإجابة" read rather
 * than a numeric grade, since a 0–5 similarity score has no meaning to a
 * reader outside a scored-quiz context and lessons are never scored (see
 * the plan's ground rules).
 */
function renderEssayQuestionBody(block, questionId, prior) {
  const priorAnswer = typeof prior?.answerText === "string" ? prior.answerText : "";
  return (
    `<div class="lesson-block lesson-block--question lesson-question" ` +
    `data-question-kind="essay" ` +
    `data-question-id="${escapeHtml(questionId)}" ` +
    `data-model-answer="${escapeHtml(block.modelAnswer || "")}"` +
    (prior?.answered ? ` data-answered="true"` : "") +
    `>` +
    `<div class="lesson-question__prompt md-content">${renderMarkdown(block.prompt || "")}</div>` +
    `<textarea class="lesson-question__essay-input" rows="4" placeholder="اكتب إجابتك هنا…" ${prior?.answered ? "disabled" : ""}>${escapeHtml(priorAnswer)}</textarea>` +
    `<div class="lesson-question__essay-actions">` +
    `<button type="button" class="lesson-question__essay-check-btn" ${prior?.answered ? "disabled" : ""}>تحقق من إجابتي</button>` +
    `</div>` +
    `<div class="lesson-question__feedback" hidden>` +
    `<span class="lesson-question__verdict"></span>` +
    `<div class="lesson-question__model-answer md-content"></div>` +
    (block.explanation
      ? `<div class="lesson-question__explanation md-content">${renderMarkdown(block.explanation)}</div>`
      : "") +
    `</div>` +
    `</div>`
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
export function equipQuestionBlocks(root, lessonId, onAnswered) {
  if (!root) return;
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
          return;
        }
        const wasCorrect = isAnswerCorrect(chosen, correctIndexes);
        recordQuestionAnswer(lessonId, questionId, wasCorrect, [chosen]);
        revealMcqAnswer(questionEl, correctIndexes, wasCorrect, [chosen]);
        if (typeof onAnswered === "function") onAnswered();
      });
    });
    questionEl.querySelector(".lesson-question__check-btn")?.addEventListener("click", () => {
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
    checkBtn?.addEventListener("click", () => {
      if (questionEl.dataset.answered === "true") return; // reveal-once
      const answerText = textarea?.value || "";
      // gradeEssay() is a rough 0–5 text-similarity score, purely
      // client-side (see rate-answers.js) — never a network call, and
      // never persisted or reported anywhere as a "grade": lessons are
      // never scored (see the plan's ground rules). It only decides which
      // of two self-check labels to show next to the model answer.
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

function revealMcqAnswer(questionEl, correctIndexes, wasCorrect, chosenIndexes) {
  questionEl.dataset.answered = "true";

  questionEl.querySelectorAll(".lesson-question__option").forEach((btn) => {
    const idx = Number(btn.dataset.optionIndex);
    btn.disabled = true;
    if (correctIndexes.includes(idx)) btn.classList.add("is-correct");
    if (chosenIndexes?.includes(idx) && !correctIndexes.includes(idx)) btn.classList.add("is-wrong");
  });

  const feedback = questionEl.querySelector(".lesson-question__feedback");
  if (feedback) {
    feedback.hidden = false;
    const verdict = feedback.querySelector(".lesson-question__verdict");
    if (verdict) {
      verdict.textContent = wasCorrect ? "إجابة صحيحة" : "إجابة غير صحيحة — راجع الخيارات الصحيحة";
      verdict.classList.toggle("is-correct", wasCorrect);
      verdict.classList.toggle("is-wrong", !wasCorrect);
    }
  }
}

/**
 * Reveals an essay question's self-check: disables further editing, shows
 * the model answer, and labels the reader's own answer "قريب من الإجابة
 * النموذجية" / "يختلف عن الإجابة النموذجية" based on gradeEssay()'s
 * similarity score — deliberately NOT a numeric grade (see
 * renderEssayQuestionBody's header comment on why).
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

  const feedback = questionEl.querySelector(".lesson-question__feedback");
  if (feedback) {
    feedback.hidden = false;
    const verdict = feedback.querySelector(".lesson-question__verdict");
    if (verdict) {
      verdict.textContent = `تقدير الإجابة: ${score} من 5${wasClose ? " — إجابتك قريبة من الإجابة النموذجية" : " — راجع الإجابة النموذجية"}`;
      verdict.classList.toggle("is-correct", wasClose);
      verdict.classList.toggle("is-wrong", !wasClose);
    }
    const modelEl = feedback.querySelector(".lesson-question__model-answer");
    if (modelEl) modelEl.innerHTML = `<strong>الإجابة النموذجية:</strong> ${renderMarkdown(modelAnswer || "")}`;
  }
}
