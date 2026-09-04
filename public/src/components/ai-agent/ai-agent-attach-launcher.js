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
import { resolveUserItemById } from "./ai-agent-item-lookup.js";

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
export function buildPlatformCourseAttachment(course) {
  return {
    kind: "course",
    id: course.key || course.name,
    title: course.name,
    source: "platform",
  };
}

/**
 * Opens the AI Agent modal (pageKey: "home", matching the home page's own
 * createAIAgentFab configuration — see user-quizzes-view.js) with the
 * given platform-item attachment pre-attached, ready for the user to type
 * a prompt and send. Never auto-sends (see panel.addPendingAttachment's
 * own doc comment) — the user stays in control of when/whether to
 * actually send.
 *
 * Deliberately mirrors "home" pageKey's system prompt but WITHOUT
 * enableTools/toolNames: the home page's tool-enabled actions
 * (create_quiz/edit_quiz) depend on live folder-tree context
 * (buildFolderTreeContextPrompt) that's private to user-quizzes-view.js
 * and not safely reconstructable from a card/tooltip click handler
 * without real risk of circular imports or stale/wrong tool wiring — see
 * this module's own header comment. A minimal, safe, read/discuss-only
 * chat is judged better than a broken or duplicated tool config.
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
    ...pageOptions,
  };

  openAIAgentModal(options, null);
  // openAIAgentModal builds (or reuses) the "home" pageKey's cached panel
  // synchronously before returning, so it's available immediately via
  // getChatPanelForPageKey — no need to await/poll for it.
  const panel = getChatPanelForPageKey("home");
  if (panel && typeof panel.addPendingAttachment === "function") {
    panel.addPendingAttachment(attachment);
  }
}