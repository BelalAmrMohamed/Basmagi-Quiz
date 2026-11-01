import { LIMITS, checkLesson, cleanSource } from "../../shared/content-rules.js";

function invalid(message) {
  const error = new Error(message);
  error.userMessage = message;
  throw error;
}

function text(value, field, maxLength) {
  if (typeof value !== "string" || value.length > maxLength) {
    invalid(`${field} must be text no longer than ${maxLength} characters.`);
  }
  return value;
}

/**
 * Validates AI-generated lesson JSON and converts blocks to the lesson
 * reader's canonical shape.
 *
 * @param {unknown} value
 * @returns {{title: string, description: string, source: string, sections: Array, questionCount: number}}
 */
export function normalizeLessonJson(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalid("The lesson JSON must be an object with title and sections.");
  }

  const title = typeof value.title === "string" ? value.title.trim() : "";
  const description = typeof value.description === "string" ? value.description.trim() : "";
  const source = typeof value.source === "string" ? value.source.trim() : "";
  if (!title || title.length > 200) invalid("The lesson title is required and must be at most 200 characters.");
  if (description.length > 1200) invalid("The lesson description must be at most 1200 characters.");
  if (source.length > 500) invalid("The lesson source must be at most 500 characters.");
  // Platform JSON downloads wrap reader content as `content.sections`;
  // accept that canonical export alongside the editor's flat shape.
  const inputSections = Array.isArray(value.sections)
    ? value.sections
    : Array.isArray(value.content?.sections)
      ? value.content.sections
      : null;
  if (!inputSections || inputSections.length < 1 || inputSections.length > 60) {
    invalid("The lesson must contain between 1 and 60 sections.");
  }
  if (new TextEncoder().encode(JSON.stringify(value)).length > 200000) {
    invalid("The lesson JSON is too large. Reduce its content and try again.");
  }

  let questionCount = 0;
  const sections = inputSections.map((section, sectionIndex) => {
    const sectionTitle = typeof section?.title === "string" ? section.title.trim() : "";
    if (!sectionTitle || sectionTitle.length > 200) {
      invalid(`Section ${sectionIndex + 1} needs a title of at most 200 characters.`);
    }
    const inputBlocks = Array.isArray(section.blocks)
      ? section.blocks
      : typeof section.content === "string"
        ? [{ type: "markdown", body: section.content }]
        : null;
    if (!inputBlocks || inputBlocks.length > LIMITS.blocksPerSection) {
      invalid(`Section ${sectionIndex + 1} must have a blocks array with at most ${LIMITS.blocksPerSection} blocks.`);
    }

    const blocks = inputBlocks.map((block, blockIndex) => {
      if (block?.type === "markdown") {
        return {
          type: "markdown",
          body: text(block.body ?? "", `Section ${sectionIndex + 1}, block ${blockIndex + 1}`, 20000),
        };
      }
      if (block?.type === "media") {
        const url = text(block.url ?? "", `Section ${sectionIndex + 1}, block ${blockIndex + 1} URL`, 4000).trim();
        if (!url) invalid(`Section ${sectionIndex + 1}, block ${blockIndex + 1} needs a media URL.`);
        const kind = ["image", "audio", "video"].includes(block.kind) ? block.kind : "image";
        return {
          type: "media",
          url,
          kind,
          ...(typeof block.alt === "string" && block.alt ? { alt: block.alt.slice(0, 200) } : {}),
        };
      }
      if (block?.type === "quizRef") {
        const quizId = text(block.quizId ?? "", `Section ${sectionIndex + 1}, block ${blockIndex + 1} quizId`, 200).trim();
        if (!quizId) invalid(`Section ${sectionIndex + 1}, block ${blockIndex + 1} needs a quiz ID.`);
        return {
          type: "quizRef",
          quizId,
          ...(typeof block.title === "string" && block.title ? { title: block.title.slice(0, 200) } : {}),
        };
      }
      if (block?.type === "lesson-reference" || block?.type === "lessonRef") {
        const lessonId = text(block.lessonId ?? block.lessonRefId ?? "", `Section ${sectionIndex + 1}, block ${blockIndex + 1} lessonId`, 200).trim();
        if (!lessonId) invalid(`Section ${sectionIndex + 1}, block ${blockIndex + 1} needs a lesson ID.`);
        return {
          type: "lesson-reference",
          lessonId,
          ...(typeof block.title === "string" && block.title ? { title: block.title.slice(0, 200) } : {}),
          ...(typeof block.slug === "string" && block.slug ? { slug: block.slug.slice(0, 200) } : {}),
        };
      }
      if (block?.type !== "question") {
        invalid(`Section ${sectionIndex + 1}, block ${blockIndex + 1} has an unsupported type.`);
      }

      const prompt = typeof block.prompt === "string" ? block.prompt.trim() : "";
      if (!prompt || prompt.length > LIMITS.promptMax) {
        invalid(`Question ${blockIndex + 1} in section ${sectionIndex + 1} needs a prompt.`);
      }
      questionCount += 1;
      const explanation = text(block.explanation ?? "", "Question explanation", LIMITS.explanationMax);
      if (block.questionKind === "essay") {
        const modelAnswer = typeof block.modelAnswer === "string" ? block.modelAnswer.trim() : "";
        if (!modelAnswer || modelAnswer.length > LIMITS.modelAnswerMax) {
          invalid(`Essay question ${blockIndex + 1} in section ${sectionIndex + 1} needs a modelAnswer.`);
        }
        return {
          type: "question",
          id: crypto.randomUUID(),
          questionKind: "essay",
          prompt,
          modelAnswer,
          explanation,
        };
      }

      const options = block.options;
      if (!Array.isArray(options) || options.length < 2 || options.length > 8 ||
          options.some((option) => typeof option !== "string" || !option.trim() || option.length > 2000)) {
        invalid(`MCQ ${blockIndex + 1} in section ${sectionIndex + 1} needs 2-8 non-empty text options.`);
      }
      const multiSelect = Boolean(block.multiSelect);
      let correctIndexes = Array.isArray(block.correctIndexes)
        ? block.correctIndexes
        : Number.isInteger(block.correctIndex)
          ? [block.correctIndex]
          : [];
      if (!correctIndexes.length || correctIndexes.some((index) => !Number.isInteger(index) || index < 0 || index >= options.length)) {
        invalid(`MCQ ${blockIndex + 1} in section ${sectionIndex + 1} needs valid zero-based correctIndexes.`);
      }
      correctIndexes = [...new Set(correctIndexes)];
      if (!multiSelect && correctIndexes.length !== 1) {
        invalid(`MCQ ${blockIndex + 1} has multiple correctIndexes but multiSelect is false.`);
      }
      return {
        type: "question",
        id: crypto.randomUUID(),
        questionKind: "mcq",
        prompt,
        options: options.map((option) => option.trim()),
        ...(multiSelect ? { multiSelect: true, correctIndexes } : { correctIndex: correctIndexes[0] }),
        explanation,
      };
    });

    return {
      id: crypto.randomUUID(),
      title: sectionTitle,
      defaultHidden: Boolean(section.defaultHidden),
      blocks,
    };
  });

  return { title, description, source, sections, questionCount };
}

/**
 * Lenient import for the editor's ?draft= / #data= links.
 *
 * Unlike normalizeLessonJson (strict: throws on the first content problem), this
 * never discards an AI draft because of fixable content problems. It throws only
 * when there is nothing to load (not an object / no sections) and otherwise
 * returns the best-effort lesson plus `issues`: Arabic messages from the shared
 * rules (the same checks the editor's save button and the upload step run).
 *
 * @param {unknown} value
 * @returns {{title: string, description: string, source: string, sections: Array, issues: string[], droppedSource: boolean}}
 */
export function normalizeLessonDraft(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("بيانات الدرس يجب أن تكون كائناً يحتوي على title و sections.");
  }
  const inputSections = Array.isArray(value.sections)
    ? value.sections
    : Array.isArray(value.content?.sections)
      ? value.content.sections
      : null;
  if (!inputSections || !inputSections.length) {
    throw new Error("الدرس لا يحتوي على أقسام (sections فارغة أو مفقودة).");
  }

  const issues = checkLesson(value, { publish: false }).errors.map((e) => e.message);
  const str = (v) => (v === undefined || v === null ? "" : String(v));
  const ints = (arr) => (Array.isArray(arr) ? arr.map(Number).filter((n) => Number.isInteger(n)) : []);

  const sections = inputSections.map((section) => {
    const inputBlocks = Array.isArray(section?.blocks)
      ? section.blocks
      : typeof section?.content === "string"
        ? [{ type: "markdown", body: section.content }]
        : [];
    const blocks = [];
    for (const block of inputBlocks) {
      if (!block || typeof block !== "object") continue;
      const type = block.type || (block.prompt || block.q ? "question" : "markdown");
      if (type === "markdown") {
        blocks.push({ type: "markdown", body: str(block.body ?? block.content) });
      } else if (type === "media") {
        blocks.push({
          type: "media",
          url: str(block.url).trim(),
          kind: ["image", "audio", "video"].includes(block.kind) ? block.kind : "image",
          ...(block.alt ? { alt: str(block.alt).slice(0, 200) } : {}),
        });
      } else if (type === "quizRef") {
        blocks.push({ type: "quizRef", quizId: str(block.quizId).trim(), ...(block.title ? { title: str(block.title).slice(0, 200) } : {}) });
      } else if (type === "lesson-reference" || type === "lessonRef") {
        blocks.push({
          type: "lesson-reference",
          lessonId: str(block.lessonId ?? block.lessonRefId).trim(),
          ...(block.title ? { title: str(block.title).slice(0, 200) } : {}),
          ...(block.slug ? { slug: str(block.slug).slice(0, 200) } : {}),
        });
      } else if (type === "question") {
        const prompt = str(block.prompt ?? block.q);
        const explanation = str(block.explanation);
        const hasOptions = Array.isArray(block.options) && block.options.length > 0;
        const modelAnswer = str(block.modelAnswer ?? block.answer);
        if (block.questionKind === "essay" || (!hasOptions && modelAnswer)) {
          blocks.push({ type: "question", id: crypto.randomUUID(), questionKind: "essay", prompt, modelAnswer, explanation });
        } else {
          const options = hasOptions ? block.options.map((o) => str(o)) : ["", ""];
          const picked = Array.isArray(block.correctIndexes)
            ? ints(block.correctIndexes)
            : Number.isInteger(block.correctIndex)
              ? [block.correctIndex]
              : Number.isInteger(block.correct)
                ? [block.correct]
                : ints(block.correct);
          const correctIndexes = [...new Set(picked)];
          const multiSelect = block.multiSelect === true || correctIndexes.length > 1;
          // An invalid/missing correct answer is kept invalid (never guessed) so the editor flags it.
          blocks.push({
            type: "question",
            id: crypto.randomUUID(),
            questionKind: "mcq",
            prompt,
            options,
            multiSelect,
            correctIndexes,
            correctIndex: correctIndexes.length ? correctIndexes[0] : null,
            explanation,
          });
        }
      }
      // unknown block types are skipped; the issue list already names them
    }
    return {
      id: crypto.randomUUID(),
      title: str(section?.title).trim(),
      defaultHidden: Boolean(section?.defaultHidden),
      blocks,
    };
  });

  const rawSource = str(value.source).trim();
  const source = cleanSource(rawSource);
  return {
    title: str(value.title).trim(),
    description: str(value.description).trim(),
    source,
    sections,
    issues,
    droppedSource: Boolean(rawSource) && !source && rawSource !== "تم التوليد بواسطة الذكاء الاصطناعي",
  };
}
