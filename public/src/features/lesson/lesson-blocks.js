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

import { renderMarkdown, renderInlineMediaTag } from "../../shared/markdown.js";
import { escapeHtml } from "../home/escape-html.js";
import { recordQuestionAnswer, appendEssayAnswerText, resetLessonQuestionAnswers, getLessonProgress } from "./lesson-schema.js";
import { _confirm } from "../../components/notifications/notifications.js";
import { gradeEssay, isAnswerCorrect } from "../../shared/rate-answers.js";
import { lessonIcon } from "./lesson-icons.js";

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
function referenceActionButton(kind, action, id, title, label, icon) {
  return `<button type="button" class="lesson-ref-card__action lesson-ref-card__action--${action}" data-reference-kind="${kind}" data-reference-action="${action}" data-reference-id="${escapeHtml(id)}" data-reference-title="${escapeHtml(title)}" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">${lessonIcon(icon)}<span>${escapeHtml(label)}</span></button>`;
}

function renderReferenceCard({ kind, id, title, description, countLabel, available, protectedContent }) {
  const labels = kind === "quiz"
    ? { start: "ابدأ الامتحان", open: "ابدأ الامتحان" }
    : { start: "فتح الدرس", open: "فتح الدرس" };
  const bodyTitle = title || (kind === "quiz" ? "امتحان غير متاح" : "درس غير متاح");
  return (
    `<article class="lesson-ref-card lesson-ref-card--${kind}${available ? "" : " is-unavailable"}" data-reference-card data-reference-kind="${kind}">` +
    `<div class="lesson-ref-card__main">` +
    `<div class="lesson-ref-card__icon" aria-hidden="true">${lessonIcon(kind === "quiz" ? "exam" : "book")}</div>` +
    `<div class="lesson-ref-card__copy">` +
    `<span class="lesson-ref-card__label">${kind === "quiz" ? "امتحان مرتبط" : "درس مرتبط"}</span>` +
    `<h3 class="lesson-ref-card__title">${escapeHtml(bodyTitle)}</h3>` +
    (description ? `<p class="lesson-ref-card__description">${escapeHtml(description)}</p>` : "") +
    (countLabel ? `<span class="lesson-ref-card__count">${escapeHtml(countLabel)}</span>` : "") +
    (!available ? `<p class="lesson-ref-card__unavailable">العنصر المرجعي لم يعد متاحًا.</p>` : "") +
    (protectedContent ? `<span class="lesson-ref-card__protected">${lessonIcon("lock")} محمي بكلمة مرور</span>` : "") +
    `</div></div>` +
    `<div class="lesson-ref-card__actions" role="group" aria-label="إجراءات العنصر المرتبط">` +
    referenceActionButton(kind, "start", id, bodyTitle, labels.start, kind === "quiz" ? "play" : "book") +
    referenceActionButton(kind, "download", id, bodyTitle, "تنزيل", "download") +
    referenceActionButton(kind, "info", id, bodyTitle, "معلومات", "info") +
    referenceActionButton(kind, "ask", id, bodyTitle, "اسأل الباشـمبصمج", "sparkle") +
    `</div></article>`
  );
}

function renderQuizRefBlock(block, ctx) {
  const quizId = String(block.quizId || "").trim();
  if (!quizId) return `<div class="lesson-ref-card lesson-ref-card--quiz is-unavailable"><div class="lesson-ref-card__unavailable">مرجع الامتحان غير صالح.</div></div>`;
  const quiz = ctx?.quizLookup?.get(quizId) || null;
  const title = quiz?.title || block.title || "امتحان";
  const count = typeof quiz?.questionCount === "number" ? `${quiz.questionCount} سؤال` : "";
  return renderReferenceCard({ kind: "quiz", id: quizId, title, description: quiz?.description || "", countLabel: count, available: Boolean(quiz), protectedContent: Boolean(quiz?.passwordProtected) });
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
  });
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
    const btn = e.target.closest("[data-explain-wrong]");
    if (!btn || typeof onExplainWrong !== "function") return;
    const questionEl = btn.closest(".lesson-question");
    if (!questionEl) return;
    const promptEl = questionEl.querySelector(".lesson-question__prompt");
    const questionText = promptEl?.textContent?.trim() || "";
    if (questionEl.dataset.questionKind === "mcq") {
      const options = [...questionEl.querySelectorAll(".lesson-question__option-text")].map((el) => el.textContent.trim());
      const correctIndexes = (() => { try { return JSON.parse(questionEl.dataset.correctIndexes || "[]"); } catch { return []; } })();
      const chosenIndexes = [...questionEl.querySelectorAll(".lesson-question__option.is-wrong")]
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
    if (!wasCorrect) renderExplainWrongButton(feedback);
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
      verdict.textContent = `تقدير الإجابة: ${score} من 5`;
      verdict.classList.toggle("is-correct", wasClose);
      verdict.classList.toggle("is-wrong", !wasClose);
    }
    const modelEl = feedback.querySelector(".lesson-question__model-answer");
    if (modelEl) modelEl.innerHTML = `<strong>الإجابة النموذجية:</strong> ${renderMarkdown(modelAnswer || "")}`;
    if (!wasClose) renderExplainWrongButton(feedback);
  }
}