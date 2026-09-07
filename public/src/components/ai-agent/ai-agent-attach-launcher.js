// =============================================================================
// public/src/components/ai-agent/ai-agent-attach-launcher.js
// PHASE 2c: shared "اسأل الباشـمبصمج" entry-point helper. Every card/tooltip
// that wants an "ask the assistant about this" button calls
// openAIAgentWithAttachment() from here rather than each reimplementing its
// own resolve-then-open logic.
//
// Two distinct data sources this resolves against:
//   - User-created quizzes/folders/courses: live entirely in the browser's
//     localStorage (`user_quizzes`, one flat array, see
//     user-quizzes-folders.js). Fully resolvable client-side — this module
//     builds a real summary (question count/types for a quiz, child counts
//     for a folder/course) from data already on hand.
//   - Server-hosted main-page courses (see course-info-tooltip.js /
//     root-view.js): identified only by `.key`/`.name` from the static
//     category manifest at attach time — their quiz list isn't loaded
//     client-side at that point, so these resolve to a title-only
//     attachment (no deep summary). ai-agent-chat.js's own
//     expandPlatformAttachment() already handles a missing `summary`
//     gracefully ("لا تفاصيل إضافية متاحة عن هذا العنصر").
//
// Deliberately NOT importing quiz-schema/storage helpers into
// ai-agent-chat.js itself (see that file's own header comment on staying
// "takes everything via options/attachments") — all of that lookup work
// happens here instead, and only the resolved
// {kind, id, title, summary, source} shape crosses into the chat panel via
// panel.addPendingAttachment().
// =============================================================================

import { openAIAgentModal, getChatPanelForPageKey } from "./ai-agent.js";
import {
  resolveUserItemById,
  readUserQuizzes,
  buildUserRootAttachment,
} from "./ai-agent-item-lookup.js";
import { loadFullQuizData } from "../../features/home/quiz-data-loader.js";
import {
  handleReadOnlyLibraryToolCall,
  READONLY_LIBRARY_TOOL_NAMES,
} from "./ai-agent-readonly-tools.js";

/**
 * Resolves a user-created quiz/folder/course id (from `user_quizzes`) into
 * the {kind, id, title, summary, source} shape panel.addPendingAttachment
 * expects. Returns null if the id can't be found (e.g. stale reference —
 * deleted since the card was rendered), so callers can no-op rather than
 * attach a broken reference. Thin re-export of
 * ai-agent-item-lookup.js's resolveUserItemById — see that module's own
 * header comment for why the actual lookup logic lives there instead of
 * here (Phase 4's `/`/`@` menu needs the same lookup without pulling in
 * this file's own ai-agent.js dependency).
 * @param {string} id
 * @returns {{kind: "quiz"|"course"|"folder", id: string, title: string, summary: string, source: "local"} | null}
 */
export function resolveUserItemAttachment(id) {
  return resolveUserItemById(id);
}

/**
 * Builds the attachment shape directly for a server-hosted main-page
 * course (see course-info-tooltip.js) — these aren't in `user_quizzes` at
 * all, so there's nothing to look up; just the name the tooltip already
 * has on hand. No `summary` — see this file's own header comment on why
 * that's an acceptable, gracefully-handled gap for this source.
 * @param {{key?: string, name: string}} course
 * @returns {{kind: "course", id: string, title: string, source: "platform"}}
 */
export function buildPlatformCourseAttachment(course, categoryTree = null) {
  const buildTree = (node) => {
    const resolvedNode = typeof node === "string" && categoryTree
      ? categoryTree[node]
      : node;
    return {
      kind: "folder",
      id: resolvedNode?.key || resolvedNode?.name || "course",
      title: resolvedNode?.name || "بدون عنوان",
      children: [
        ...(resolvedNode?.subcategories || []).map((child) => buildTree(child)),
        ...(resolvedNode?.exams || []).map((exam) => ({
          kind: "quiz",
          id: exam.id,
          dbId: exam.dbId,
          title: exam.title || exam.id,
          questionCount: exam.questionCount || 0,
        })),
      ],
    };
  };
  const tree = buildTree(course);
  const countQuizzes = (nodes) => nodes.reduce((n, item) => n + (item.kind === "quiz" ? 1 : countQuizzes(item.children || [])), 0);
  const countFolders = (nodes) => nodes.reduce((n, item) => n + (item.kind === "quiz" ? 0 : 1 + countFolders(item.children || [])), 0);
  return {
    kind: "course",
    id: course.key || course.name,
    title: course.name,
    source: "platform",
    summary: `عدد الامتحانات: ${countQuizzes(tree.children)} — عدد المجلدات: ${countFolders(tree.children)}`,
    payload: {
      totalQuizCount: countQuizzes(tree.children),
      totalFolderCount: countFolders(tree.children),
      tree: [tree],
    },
  };
}

export function buildPlatformQuizAttachment(exam, payload) {
  return {
    kind: "quiz",
    id: exam.id,
    dbId: exam.dbId,
    title: exam.title || exam.id,
    source: "platform",
    payload,
  };
}

export function buildUserRootAttachmentForAskAi() {
  return buildUserRootAttachment(readUserQuizzes());
}

/**
 * Opens the AI Agent modal (pageKey: "home", matching the home page's own
 * createAIAgentFab configuration — see user-quizzes-view.js) with the
 * given platform-item attachment pre-attached, ready for the user to type
 * a prompt and send. Never auto-sends (see panel.addPendingAttachment's
 * own doc comment) — the user stays in control of when/whether to
 * actually send.
 *
 * Deliberately mirrors "home" pageKey's system prompt but only enables
 * `fetch_attached_quiz` plus the three read-only lookup tools
 * (search_library/parse_item_info/get_user_activity, via
 * ai-agent-readonly-tools.js) — never the write-side actions
 * (create_quiz/edit_quiz/delete_quiz/create_folder/create_course/
 * move_item). Those depend on live folder-tree context
 * (buildFolderTreeContextPrompt) that's private to user-quizzes-view.js
 * and not safely reconstructable from a card/tooltip click handler
 * without real risk of circular imports or stale/wrong tool wiring — see
 * this module's own header comment. The read-only tools have no such
 * dependency (they're pure lookups against already-shared, DOM-free
 * modules), and are needed here because this panel shares pageKey "home"
 * — and therefore HOME_PAGE_SYSTEM_PROMPT, which tells the model these
 * tools exist — with the main home-page panel; the user types free-text
 * search queries into this launcher too, so it must be able to actually
 * answer them rather than throw "Unknown attachment tool".
 * @param {{kind: "quiz"|"course"|"folder", id: string, title: string, summary?: string, source: "local"|"platform"}} attachment
 * @param {{defaultSystemPrompt?: string, placeholder?: string}} [pageOptions] -
 *   HOME_PAGE_SYSTEM_PROMPT/placeholder, passed by the caller (see
 *   ai-agent-default-prompts.js) so this module doesn't need its own
 *   import of page-specific prompt text.
 */
export function openAIAgentWithAttachment(attachment, pageOptions = {}) {
  if (!attachment) return;

  const options = {
    pageKey: "home",
    enableFileUpload: true,
    enableTools: true,
    // This panel shares pageKey "home" with the main home-page panel, so
    // it also shares HOME_PAGE_SYSTEM_PROMPT (see getSystemPrompt in
    // ai-agent-settings.js — the persisted per-pageKey prompt, which every
    // caller of openAIAgentWithAttachment sets to HOME_PAGE_SYSTEM_PROMPT,
    // or falls back to the same stored "home" prompt if unset). That
    // prompt already tells the model search_library/parse_item_info/
    // get_user_activity exist — the user types free-text search queries
    // into this launcher, so it needs to actually be able to answer them,
    // not just fetch_attached_quiz. See ai-agent-readonly-tools.js for the
    // shared handlers (same ones the home-page panel uses).
    toolNames: ["fetch_attached_quiz", ...READONLY_LIBRARY_TOOL_NAMES],
    onToolCall: async (toolCall) => {
      if (READONLY_LIBRARY_TOOL_NAMES.includes(toolCall?.name)) {
        return handleReadOnlyLibraryToolCall(toolCall);
      }
      if (toolCall?.name !== "fetch_attached_quiz") {
        throw new Error("Unknown attachment tool");
      }
      const requestedId = String(toolCall.input?.quizId || "");
      const findAttachedQuiz = (node) => {
        if (!node) return null;
        if (node.kind === "quiz" && [node.id, node.dbId].some((id) => String(id || "") === requestedId)) {
          return node;
        }
        return (node.children || []).reduce(
          (found, child) => found || findAttachedQuiz(child),
          null,
        );
      };
      const attachedQuiz = (attachment.payload?.tree || []).reduce(
        (found, node) => found || findAttachedQuiz(node),
        null,
      );
      const directAttachedQuiz = attachment.kind === "quiz" &&
        [attachment.id, attachment.dbId].some((id) => String(id || "") === requestedId)
        ? attachment
        : null;
      const quiz = resolveUserItemById(requestedId, readUserQuizzes());
      if (!directAttachedQuiz && !attachedQuiz && (!quiz || quiz.kind !== "quiz")) {
        throw new Error("الامتحان المطلوب غير موجود في المرفق الحالي.");
      }
      let payload = directAttachedQuiz?.payload || attachedQuiz?.payload || quiz?.payload;
      if (!payload && attachedQuiz?.dbId) {
        const loaded = await loadFullQuizData({ dbId: attachedQuiz.dbId });
        payload = {
          meta: loaded.meta || {},
          stats: loaded.stats || {},
          questions: loaded.questions || [],
        };
      }
      return `بيانات الامتحان ${directAttachedQuiz?.title || attachedQuiz?.title || quiz?.title} (المعرّف ${requestedId}):\n${JSON.stringify(payload || {})}`;
    },
    ...pageOptions,
  };

  openAIAgentModal(options, null);
  // openAIAgentModal builds (or reuses) the "home" pageKey's cached panel
  // synchronously before returning, so it's available immediately via
  // getChatPanelForPageKey — no need to await/poll for it.
  //
  // NOTE (pre-existing, not introduced by this file): getOrCreateChatPanel
  // (ai-agent.js) only uses `options` the very FIRST time pageKey "home"
  // is created; a later openAIAgentModal call for the same pageKey reuses
  // that cached panel as-is, ignoring its own toolNames/onToolCall/
  // contextSummary/contextPrompt/defaultSystemPrompt. So if this launcher
  // is opened before the home page's own FAB ever is, the "home" panel
  // gets built with THIS options object (fetch_attached_quiz + the
  // read-only tools, no create/edit/delete/folder tools) and stays that
  // way for the rest of the page's lifetime — the home FAB's write-side
  // tools won't work until a reload rebuilds the cache. This ordering
  // hazard predates and is unrelated to the read-only-tools fix below;
  // flagged here rather than silently worked around.
  const panel = getChatPanelForPageKey("home");
  if (panel && typeof panel.addPendingAttachment === "function") {
    panel.setAttachmentToolHandler?.(options.onToolCall);
    panel.addPendingAttachment(attachment);
  }
}

export function buildPlatformFolderAttachment(folder, categoryTree = null) {
  return { ...buildPlatformCourseAttachment(folder, categoryTree), kind: "folder" };
}