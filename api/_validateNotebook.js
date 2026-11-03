// =============================================================================
// api/_validateNotebook.js
// Validates and sanitizes a notebook's metadata and its versioned `content`
// document { schemaVersion: 1, cells: [{ id, type, source }] }.
//
// Mirrors _validateLesson.js: semantic rules (limits, runtime, cell types,
// ids, sizes) come from the shared content-rules workflow so the editor page,
// MCP and this upload API cannot drift; only upload-only STRUCTURAL checks
// (key whitelists — unknown keys are rejected, not stripped) live here.
//
// Every validator throws Error(<Arabic message>) on the first problem, like
// the lesson validators, so api/admin.js can map it straight to a 400.
// =============================================================================

import {
    LIMITS,
    NOTEBOOK_RUNTIMES,
    NOTEBOOK_SCHEMA_VERSION,
    checkNotebook,
    formatIssueList,
    normalizeNotebookContent,
} from "../scripts/lib/content-rules.js";

const ALLOWED_DOCUMENT_KEYS = new Set(["schemaVersion", "cells"]);
// `_localId` is editor bookkeeping that may ride along in drafts/exports; it is dropped.
const ALLOWED_CELL_KEYS = new Set(["id", "type", "source", "_localId"]);

function isPlainObject(v) {
    return v !== null && typeof v === "object" && !Array.isArray(v);
}

export function validateNotebookDescription(description) {
    if (description === undefined || description === null || description === "") return "";
    if (typeof description !== "string") throw new Error("وصف الدفتر يجب أن يكون نصاً.");
    const clean = description.trim();
    if (clean.length > LIMITS.notebookDescription) {
        throw new Error(`وصف الدفتر طويل جداً (الحد الأقصى ${LIMITS.notebookDescription} حرف).`);
    }
    return clean;
}

export function validateNotebookSource(source) {
    if (source === undefined || source === null || source === "") return "";
    if (typeof source !== "string") throw new Error("مصدر الدفتر يجب أن يكون نصاً.");
    const clean = source.trim();
    if (clean.length > LIMITS.notebookSource) {
        throw new Error(`مصدر الدفتر طويل جداً (الحد الأقصى ${LIMITS.notebookSource} حرف).`);
    }
    if (clean && !/^https?:\/\/\S+$/i.test(clean)) {
        throw new Error("مصدر الدفتر يجب أن يكون رابطاً كاملاً يبدأ بـ https:// ولا شيء غيره — أو اتركه فارغاً.");
    }
    return clean;
}

/** Unknown / missing runtimes are rejected — never defaulted to MATLAB. */
export function validateNotebookRuntime(runtime) {
    if (typeof runtime !== "string" || !runtime.trim()) {
        throw new Error(`نوع بيئة التشغيل (runtime) مطلوب (المسموح: ${NOTEBOOK_RUNTIMES.join(", ")}).`);
    }
    const clean = runtime.trim();
    if (!NOTEBOOK_RUNTIMES.includes(clean)) {
        throw new Error(`بيئة التشغيل "${clean}" غير مدعومة (المسموح: ${NOTEBOOK_RUNTIMES.join(", ")}).`);
    }
    return clean;
}

/**
 * Validates a notebook content document and returns the clean canonical
 * { schemaVersion, cells } (ids assigned where missing, editor keys dropped).
 * Learner outputs/workspace state are not part of the schema and are rejected
 * as unknown keys.
 */
export function validateNotebookContent(content) {
    if (!isPlainObject(content)) throw new Error("محتوى الدفتر يجب أن يكون كائناً { schemaVersion, cells }.");
    for (const key of Object.keys(content)) {
        if (!ALLOWED_DOCUMENT_KEYS.has(key)) throw new Error(`حقل غير مسموح به في محتوى الدفتر: "${key}".`);
    }
    if (content.schemaVersion !== NOTEBOOK_SCHEMA_VERSION) {
        throw new Error(`schemaVersion غير مدعوم (المدعوم: ${NOTEBOOK_SCHEMA_VERSION}).`);
    }
    if (!Array.isArray(content.cells)) throw new Error("cells يجب أن تكون مصفوفة.");
    content.cells.forEach((cell, i) => {
        if (!isPlainObject(cell)) throw new Error(`الخلية رقم ${i + 1} يجب أن تكون كائناً.`);
        for (const key of Object.keys(cell)) {
            if (!ALLOWED_CELL_KEYS.has(key)) throw new Error(`حقل غير مسموح به في الخلية رقم ${i + 1}: "${key}".`);
        }
    });

    const check = checkNotebook({ content }, { contentOnly: true });
    if (check.errors.length) throw new Error(formatIssueList(check.errors));

    return normalizeNotebookContent(content.cells);
}

/**
 * Full notebook validation used by batch upload / import paths where
 * title+description+source+runtime+content arrive together.
 * @returns {{ title: string, description: string, source: string, runtime: string, content: object }}
 */
export function validateNotebook(input) {
    if (!isPlainObject(input)) throw new Error("بيانات الدفتر يجب أن تكون كائناً.");
    const title = typeof input.title === "string" ? input.title.trim() : "";
    if (!title) throw new Error("عنوان الدفتر مطلوب.");
    if (title.length > LIMITS.notebookTitle) throw new Error(`عنوان الدفتر طويل جداً (الحد الأقصى ${LIMITS.notebookTitle} حرف).`);
    return {
        title,
        description: validateNotebookDescription(input.description),
        source: validateNotebookSource(input.source),
        runtime: validateNotebookRuntime(input.runtime),
        content: validateNotebookContent(input.content),
    };
}
