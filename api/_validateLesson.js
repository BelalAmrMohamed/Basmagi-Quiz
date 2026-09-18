// =============================================================================
// api/_validateLesson.js
// Validates and sanitizes a lesson's `content` jsonb payload (the
// {sections: [{id, title, defaultHidden, blocks}]} shape defined by
// public/src/features/lessons/lesson-schema.js's normalizeLessonContent()
// — see docs/plans/lessons-feature-plan.md's Phase 2 step 1 for the shape
// and the ⚠️ on keeping onWrong/onCorrect to a single revealSection target).
//
// Mirrors _validateQuiz.js's whitelist-based approach (unknown keys are
// REJECTED, not stripped) and its overall shape (a MAX_SIZE_BYTES cap, one
// exported validate function that throws Error(message) on the first
// problem found, called from api/admin.js's create-lesson/update-lesson
// action handlers before any Supabase write).
// =============================================================================

const MAX_SIZE_BYTES = 200_000; // lessons carry more prose than a quiz; generous but bounded
const MAX_SECTIONS = 60;
const MAX_BLOCKS_PER_SECTION = 40;
const MAX_TITLE_LENGTH = 200;
const MAX_MARKDOWN_LENGTH = 20_000;
const MAX_OPTIONS = 8;

const ALLOWED_SECTION_KEYS = new Set(["id", "title", "defaultHidden", "blocks"]);
const ALLOWED_BLOCK_KEYS_BY_TYPE = {
    markdown: new Set(["type", "body"]),
    media: new Set(["type", "url", "kind", "alt"]),
    quizRef: new Set(["type", "quizId", "title"]),
    question: new Set([
        "type",
        "id",
        "prompt",
        "options",
        "correctIndex",
        "explanation",
        "onWrong",
        "onCorrect",
    ]),
};

function isPlainObject(v) {
    return v !== null && typeof v === "object" && !Array.isArray(v);
}

function assertNoExtraKeys(obj, allowed, label) {
    for (const key of Object.keys(obj)) {
        if (!allowed.has(key)) {
            throw new Error(`حقل غير مسموح به في ${label}: "${key}".`);
        }
    }
}

function validateRevealRule(rule, sectionIds, label) {
    if (rule === undefined || rule === null) return undefined;
    if (!isPlainObject(rule)) throw new Error(`${label} يجب أن يكون كائناً.`);
    assertNoExtraKeys(rule, new Set(["revealSection"]), label);
    const target = rule.revealSection;
    if (target === undefined || target === null) return undefined;
    if (typeof target !== "string" || !target.trim()) {
        throw new Error(`${label}.revealSection يجب أن يكون نصاً.`);
    }
    // Kept to a single-step reveal rule by construction (see the plan's
    // Phase 2 step 1 ⚠️) — no chained targets, so this is just "does the
    // named section exist" rather than any graph validation.
    if (!sectionIds.has(target)) {
        throw new Error(`${label}.revealSection يشير إلى قسم غير موجود: "${target}".`);
    }
    return { revealSection: target };
}

function validateBlock(block, index, sectionIds) {
    if (!isPlainObject(block)) throw new Error(`العنصر رقم ${index + 1} يجب أن يكون كائناً.`);
    const type = block.type;
    const allowedKeys = ALLOWED_BLOCK_KEYS_BY_TYPE[type];
    if (!allowedKeys) {
        throw new Error(`نوع عنصر غير معروف في العنصر رقم ${index + 1}: "${type}".`);
    }
    assertNoExtraKeys(block, allowedKeys, `العنصر رقم ${index + 1}`);

    if (type === "markdown") {
        const body = typeof block.body === "string" ? block.body : "";
        if (body.length > MAX_MARKDOWN_LENGTH) {
            throw new Error(`نص العنصر رقم ${index + 1} طويل جداً (الحد الأقصى ${MAX_MARKDOWN_LENGTH} حرف).`);
        }
        return { type: "markdown", body };
    }

    if (type === "media") {
        const url = typeof block.url === "string" ? block.url.trim() : "";
        if (!url) throw new Error(`رابط الوسائط مفقود في العنصر رقم ${index + 1}.`);
        const kind = ["image", "audio", "video"].includes(block.kind) ? block.kind : "image";
        const clean = { type: "media", url, kind };
        if (typeof block.alt === "string" && block.alt) clean.alt = block.alt.slice(0, MAX_TITLE_LENGTH);
        return clean;
    }

    if (type === "quizRef") {
        const quizId = typeof block.quizId === "string" ? block.quizId.trim() : "";
        if (!quizId) throw new Error(`معرف الامتحان المرتبط مفقود في العنصر رقم ${index + 1}.`);
        const clean = { type: "quizRef", quizId };
        if (typeof block.title === "string" && block.title) clean.title = block.title.slice(0, MAX_TITLE_LENGTH);
        return clean;
    }

    // type === "question"
    const id = typeof block.id === "string" ? block.id.trim() : "";
    if (!id) throw new Error(`معرف السؤال مفقود في العنصر رقم ${index + 1}.`);
    const prompt = typeof block.prompt === "string" ? block.prompt : "";
    if (!prompt.trim()) throw new Error(`نص السؤال مطلوب في العنصر رقم ${index + 1}.`);
    if (prompt.length > MAX_MARKDOWN_LENGTH) {
        throw new Error(`نص السؤال طويل جداً في العنصر رقم ${index + 1}.`);
    }
    const options = Array.isArray(block.options) ? block.options : [];
    if (options.length < 2) throw new Error(`السؤال في العنصر رقم ${index + 1} يحتاج خيارين على الأقل.`);
    if (options.length > MAX_OPTIONS) throw new Error(`عدد كبير جداً من الخيارات في العنصر رقم ${index + 1}.`);
    const cleanOptions = options.map((opt, i) => {
        const text = typeof opt === "string" ? opt : "";
        if (!text.trim()) throw new Error(`الخيار رقم ${i + 1} فارغ في العنصر رقم ${index + 1}.`);
        return text;
    });
    const correctIndex = Number(block.correctIndex);
    if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= cleanOptions.length) {
        throw new Error(`فهرس الإجابة الصحيحة غير صالح في العنصر رقم ${index + 1}.`);
    }
    const clean = {
        type: "question",
        id,
        prompt,
        options: cleanOptions,
        correctIndex,
    };
    if (typeof block.explanation === "string" && block.explanation) {
        clean.explanation = block.explanation.slice(0, MAX_MARKDOWN_LENGTH);
    }
    const onWrong = validateRevealRule(block.onWrong, sectionIds, `العنصر رقم ${index + 1}.onWrong`);
    if (onWrong) clean.onWrong = onWrong;
    const onCorrect = validateRevealRule(block.onCorrect, sectionIds, `العنصر رقم ${index + 1}.onCorrect`);
    if (onCorrect) clean.onCorrect = onCorrect;
    return clean;
}

/**
 * Validates a lesson's `content` payload, returning a cleaned/whitelisted
 * copy on success. Throws Error(message) — a user-facing Arabic string,
 * same convention as _validateQuiz.js — on the first problem found.
 *
 * @param {unknown} content - the {sections: [...]} shape from the client
 * @returns {{sections: Array}}
 */
export function validateLessonContent(content) {
    const size = Buffer.byteLength(JSON.stringify(content ?? {}), "utf8");
    if (size > MAX_SIZE_BYTES) {
        throw new Error(`حجم محتوى الدرس كبير جداً (الحد الأقصى ${Math.round(MAX_SIZE_BYTES / 1000)} كيلوبايت).`);
    }

    if (!isPlainObject(content)) throw new Error("محتوى الدرس يجب أن يكون كائناً.");
    assertNoExtraKeys(content, new Set(["sections"]), "محتوى الدرس");

    const sections = Array.isArray(content.sections) ? content.sections : [];
    if (sections.length === 0) throw new Error("الدرس يحتاج قسماً واحداً على الأقل.");
    if (sections.length > MAX_SECTIONS) throw new Error(`عدد كبير جداً من الأقسام (الحد الأقصى ${MAX_SECTIONS}).`);

    // Every question id and section id must be unique across the WHOLE
    // lesson (not just within one section) — adaptive-reveal rules and the
    // reader's local progress state both key off these ids flatly (see
    // lesson-schema.js's collectQuestionBlocks/resolveRevealedSections), so
    // a duplicate anywhere would let one question's answer silently affect
    // another's reveal state.
    const sectionIds = new Set();
    for (const section of sections) {
        if (!isPlainObject(section)) throw new Error("كل قسم يجب أن يكون كائناً.");
        const id = typeof section.id === "string" ? section.id.trim() : "";
        if (!id) throw new Error("كل قسم يحتاج معرفاً (id).");
        if (sectionIds.has(id)) throw new Error(`معرف قسم مكرر: "${id}".`);
        sectionIds.add(id);
    }

    const questionIds = new Set();
    const cleanSections = sections.map((section, sIndex) => {
        assertNoExtraKeys(section, ALLOWED_SECTION_KEYS, `القسم رقم ${sIndex + 1}`);
        const title = typeof section.title === "string" ? section.title.slice(0, MAX_TITLE_LENGTH) : "";
        const defaultHidden = Boolean(section.defaultHidden);
        const blocks = Array.isArray(section.blocks) ? section.blocks : [];
        if (blocks.length > MAX_BLOCKS_PER_SECTION) {
            throw new Error(`عدد كبير جداً من العناصر في القسم رقم ${sIndex + 1} (الحد الأقصى ${MAX_BLOCKS_PER_SECTION}).`);
        }
        const cleanBlocks = blocks.map((block, bIndex) => {
            const clean = validateBlock(block, bIndex, sectionIds);
            if (clean.type === "question") {
                if (questionIds.has(clean.id)) throw new Error(`معرف سؤال مكرر: "${clean.id}".`);
                questionIds.add(clean.id);
            }
            return clean;
        });
        return {
            id: section.id.trim(),
            title,
            defaultHidden,
            blocks: cleanBlocks,
        };
    });

    return { sections: cleanSections };
}