// =============================================================================
// public/src/components/ai-agent/ai-agent-page-tools.js
// The tool names each page offers to the AI Agent (the `toolNames` option of
// createAIAgentFab). Kept in one dependency-free module so that
//   1. every page mounts exactly the list defined here, and
//   2. tests/ai-agent-prompts.test.js can check, in plain Node, that a page's
//      system prompt never promises a tool the page does not offer.
// The server only sends the tool schemas named in this list (api/ai-agent/chat.js),
// so a tool that is mentioned in a prompt but missing here simply does not exist
// for the model.
// =============================================================================

/** Read-only library tools (handled by ai-agent-readonly-tools.js). */
export const READONLY_LIBRARY_TOOL_NAMES = ["search_library", "parse_item_info", "get_user_activity"];

/** Read-only creator profile tools (handled by ai-agent-creator-tools.js). */
export const CREATOR_TOOL_NAMES = ["get_creator_info", "display_creator_card"];

/** Home page («محتواي»). */
export const HOME_TOOL_NAMES = [
  "create_lesson",
  "create_quiz",
  "create_notebook",
  "edit_quiz",
  "edit_item",
  "delete_quiz",
  "create_folder",
  "create_course",
  "move_item",
  "fetch_attached_quiz",
  "get_authoring_guide",
  ...READONLY_LIBRARY_TOOL_NAMES,
  ...CREATOR_TOOL_NAMES,
];

/** Quiz editor page (create-quiz.html). */
export const CREATE_QUIZ_PAGE_TOOL_NAMES = ["edit_current_quiz", "reset_quiz_page"];

/** Lesson editor page (create-lesson.html). */
export const CREATE_LESSON_PAGE_TOOL_NAMES = ["create_lesson", "add_lesson_section", "add_lesson_question"];

/** Lesson reading page (lesson.html). */
export const LESSON_VIEW_TOOL_NAMES = ["create_quiz", "create_flashcards", "fetch_attached_quiz", "fetch_attached_lesson"];
