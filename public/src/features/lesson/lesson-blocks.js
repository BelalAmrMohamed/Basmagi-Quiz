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
import { recordQuestionAnswer, getLessonProgress } from "./lesson-schema.js";

/**
 * KaTeX pass. Ported verbatim from create-quiz.js's renderMathIn() (see the
 * plan's Phase 2 step 8) — same delimiters, same ignoredTags, same
 * no-op-if-not-loaded guard. Call AFTER any innerHTML update that may
 * contain raw LaTeX, so the nodes exist for KaTeX to walk.
 *
 * @param {HTMLElement} container
 */
export function renderMathIn(container) {
  if (!container) return;
  if (typeof window.renderMathInElement !== "function") return;
  try {
    window.renderMathInElement(container, {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "$", right: "$", display: false },
        { left: "\\(", right: "\\)", display: false },
        { left: "\\[", right: "\\]", display: true },
      ],
      throwOnError: false,
      ignoredTags: ["script", "noscript", "style", "textarea", "pre", "code"],
    });
  } catch (err) {
    console.error("KaTeX rendering error:", err);
  }
}

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
 * the local progress state, and never makes a network call.
 */
function renderQuestionBlock(block, ctx) {
  const questionId = block.id || "";
  if (!questionId) return "";
  const options = Array.isArray(block.options) ? block.options : [];
  if (options.length === 0) return "";

  // Restore a previously-recorded answer so a reload shows the same
  // revealed state the reader left behind (the reveal itself is recomputed
  // from progress by resolveRevealedSections, so these must agree).
  const prior = getLessonProgress(ctx.lessonId)?.questions?.[questionId] || null;

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
    `data-question-id="${escapeHtml(questionId)}" ` +
    `data-correct-index="${Number(block.correctIndex) || 0}"` +
    (prior?.answered ? ` data-answered="true"` : "") +
    `>` +
    `<div class="lesson-question__prompt md-content">${renderMarkdown(block.prompt || "")}</div>` +
    `<div class="lesson-question__options">${optionsHtml}</div>` +
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
 * Wires click handling for every embedded question inside `root`.
 *
 * @param {HTMLElement} root
 * @param {string} lessonId
 * @param {() => void} onAnswered - called after progress is written, so the
 *   viewer can re-evaluate adaptive section visibility
 */
export function equipQuestionBlocks(root, lessonId, onAnswered) {
  if (!root) return;
  root.querySelectorAll(".lesson-question").forEach((questionEl) => {
    const questionId = questionEl.dataset.questionId;
    const correctIndex = Number(questionEl.dataset.correctIndex);

    // Replay a stored answer into the DOM without re-firing the handler.
    const prior = getLessonProgress(lessonId)?.questions?.[questionId];
    if (prior?.answered) {
      revealAnswer(questionEl, correctIndex, prior.wasCorrect, null);
    }

    questionEl.querySelectorAll(".lesson-question__option").forEach((optionBtn) => {
      optionBtn.addEventListener("click", () => {
        if (questionEl.dataset.answered === "true") return; // reveal-once
        const chosen = Number(optionBtn.dataset.optionIndex);
        const wasCorrect = chosen === correctIndex;
        recordQuestionAnswer(lessonId, questionId, wasCorrect);
        revealAnswer(questionEl, correctIndex, wasCorrect, chosen);
        if (typeof onAnswered === "function") onAnswered();
      });
    });
  });
}

function revealAnswer(questionEl, correctIndex, wasCorrect, chosenIndex) {
  questionEl.dataset.answered = "true";

  questionEl.querySelectorAll(".lesson-question__option").forEach((btn) => {
    const idx = Number(btn.dataset.optionIndex);
    btn.disabled = true;
    if (idx === correctIndex) btn.classList.add("is-correct");
    // chosenIndex is null when replaying a stored answer on load — we know
    // whether it was right, but not which specific wrong option was picked,
    // so only the correct one is marked in that case.
    if (chosenIndex !== null && idx === chosenIndex && !wasCorrect) btn.classList.add("is-wrong");
  });

  const feedback = questionEl.querySelector(".lesson-question__feedback");
  if (feedback) {
    feedback.hidden = false;
    const verdict = feedback.querySelector(".lesson-question__verdict");
    if (verdict) {
      verdict.textContent = wasCorrect ? "إجابة صحيحة" : "إجابة غير صحيحة";
      verdict.classList.toggle("is-correct", wasCorrect);
      verdict.classList.toggle("is-wrong", !wasCorrect);
    }
    renderMathIn(feedback);
  }
}
