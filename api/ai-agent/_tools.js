// =============================================================================
// api/ai-agent/_tools.js
// Shared tool schema(s) the AI Helper backend can offer to providers. Kept
// provider-agnostic here; each provider adapter in _providerClients.js
// translates this into its own native tool/function-calling shape.
// =============================================================================

// Mirrors the JSON shape parseQuizJson()/buildUserQuizEntry() (in
// public/src/shared/quiz-json.js and public/src/features/home/quiz-schema.js)
// already expect — no new parsing code needed on the save side.
export const CREATE_QUIZ_TOOL = {
  name: "create_quiz",
  description:
    "Create a new quiz and save it for the user. Only call this when the user has explicitly confirmed they want the quiz created (e.g. after you've shown them a preview and they said yes/أنشئ/تمام). " +
    "For MCQ/True-False questions, `correct` MUST always be an array of 0-based option indices — use a single-element array like [2] for one correct answer, or multiple indices like [0, 2] if more than one option is correct. Omit `correct` (and `options`) entirely for essay/free-text questions and use `answer` instead.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string" },
      description: { type: "string" },
      questions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            q: { type: "string" },
            options: { type: "array", items: { type: "string" } },
            // NOTE: Gemini's proto-based tool schema rejects JSON-Schema union
            // types (e.g. type: ["integer","array"]) with a 400 — "Proto
            // field is not repeating, cannot start list." Always use an
            // array of 0-based indices here; the save path (buildUserQuizEntry
            // in quiz-schema.js) unwraps a single-element array to a plain
            // integer for single-answer questions, so no behavior changes.
            correct: { type: "array", items: { type: "integer" } },
            answer: { type: "string" },
            explanation: { type: "string" },
          },
          required: ["q"],
        },
      },
    },
    required: ["title", "questions"],
  },
};

// Same question-shape rules as CREATE_QUIZ_TOOL above. `currentTitle` is how
// the model identifies which existing quiz to modify — it's read out of the
// contextSummary list already given to it (see user-quizzes-view.js). Every
// field besides currentTitle is optional so the model can send only what
// actually changes (e.g. just `title` to rename, without resending all
// questions).
export const EDIT_QUIZ_TOOL = {
  name: "edit_quiz",
  description:
    "Edit an existing quiz's title, description, or questions. Only call this when the user has explicitly confirmed the specific change (e.g. after you've restated what will change and they said yes/عدّل/تمام). " +
    "Identify the quiz using `currentTitle`, matched exactly against one of the titles already given to you. Only include the fields that actually change — omit `questions` entirely if only the title/description changed. " +
    "If `questions` is included, it REPLACES the quiz's entire question list, so include every question that should remain, not just the changed ones.",
  input_schema: {
    type: "object",
    properties: {
      currentTitle: { type: "string" },
      title: { type: "string" },
      description: { type: "string" },
      questions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            q: { type: "string" },
            options: { type: "array", items: { type: "string" } },
            correct: { type: "array", items: { type: "integer" } },
            answer: { type: "string" },
            explanation: { type: "string" },
          },
          required: ["q"],
        },
      },
    },
    required: ["currentTitle"],
  },
};

export const DELETE_QUIZ_TOOL = {
  name: "delete_quiz",
  description:
    "Permanently delete a quiz. Only call this when the user has explicitly confirmed deletion of this specific quiz by name (e.g. they asked to delete it and then replied yes/احذف/تمام to your confirmation). Never call this speculatively or as a suggestion — deletion cannot be undone.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string" },
    },
    required: ["title"],
  },
};

// Create-quiz page only (see chat.js's TOOLS_BY_NAME / toolNames request
// field). Same edit semantics/question-shape as EDIT_QUIZ_TOOL above, but
// deliberately has NO currentTitle field at all — that page has exactly
// one quiz in scope (the one currently in the editor form), so there's
// nothing to disambiguate. A previous version reused EDIT_QUIZ_TOOL as-is
// on this page, but its schema-level `required: ["currentTitle"]` meant
// providers could still push the model to supply *something* there even
// though the page's own tool handler (create-quiz.js::handleAiEditQuizToolCall)
// always ignores it — removing the field entirely is cleaner than leaving
// it present-but-unused.
export const EDIT_CURRENT_QUIZ_TOOL = {
  name: "edit_quiz",
  description:
    "Edit the single quiz currently open in this page's editor — its title, description, and/or questions. There is only one quiz in scope on this page, so no identifier is needed. Only call this when the user has explicitly confirmed the specific change (e.g. after you've restated what will change and they said yes/عدّل/تمام). " +
    "Only include the fields that actually change — omit `questions` entirely if only the title/description changed. " +
    "If `questions` is included, it REPLACES the quiz's entire question list, so include every question that should remain (not just new/changed ones) — this is also how you fully replace the current quiz with a different one in a single call, without a separate reset step.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string" },
      description: { type: "string" },
      questions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            q: { type: "string" },
            options: { type: "array", items: { type: "string" } },
            correct: { type: "array", items: { type: "integer" } },
            answer: { type: "string" },
            explanation: { type: "string" },
          },
          required: ["q"],
        },
      },
    },
  },
};

// Create-quiz page only (see chat.js's TOOLS_BY_NAME / toolNames request
// field). Unlike delete_quiz (which removes a saved quiz from the user's
// library by title), this clears the single in-progress draft the editor
// page is currently showing — there's no title to disambiguate since
// there's only ever one quiz on that page. Input is intentionally empty:
// nothing to configure, it's an unconditional wipe.
// Home page only (see chat.js's TOOLS_BY_NAME / toolNames request field).
// Courses and folders are both plain organizational containers backed by
// the same user_quizzes records as quizzes themselves (see
// createFolderOrCourseNamed in user-quizzes-folders.js) — the model never
// sees or produces an internal id for either; every reference here is a
// title, resolved against the folder-tree text listing already included
// in this page's system prompt (buildFolderTreeContextPrompt in
// user-quizzes-view.js). That listing is the ONLY way the model can know
// what folders/courses currently exist and how they nest, so it must
// always be present in context whenever these tools are offered.
export const CREATE_FOLDER_TOOL = {
  name: "create_folder",
  description:
    "Create a new folder to organize the user's quizzes. Only call this when the user has explicitly confirmed the folder name and location (e.g. after you've restated what will be created and they said yes/أنشئ/تمام). " +
    "`parentFolder` is the exact title of an existing folder or course to nest the new folder inside, matched against the folder tree listing already given to you — omit it (or pass null) to create the new folder at the top level, alongside courses. " +
    "Unlike courses, folders CAN be nested inside other folders (or inside a course) to any depth.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string" },
      parentFolder: { type: "string" },
    },
    required: ["name"],
  },
};

export const CREATE_COURSE_TOOL = {
  name: "create_course",
  description:
    "Create a new course — a top-level subject grouping for quizzes (e.g. \"تشريح\", \"فسيولوجيا\"). Only call this when the user has explicitly confirmed the course name (e.g. after you've restated it and they said yes/أنشئ/تمام). " +
    "Courses always live at the top level and can never be nested inside a folder or another course — there is no parent to specify, unlike create_folder.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string" },
    },
    required: ["name"],
  },
};

export const MOVE_ITEM_TOOL = {
  name: "move_item",
  description:
    "Move an existing quiz, folder, or course to a different location in the user's folder tree. Only call this when the user has explicitly confirmed the specific move (e.g. after you've restated what will move where and they said yes/انقل/تمام). " +
    "`itemName` is the exact title of the quiz/folder/course to move, matched against the folder tree listing and quiz titles already given to you. `destinationFolder` is the exact title of the folder or course to move it into, matched the same way — omit it (or pass null) to move the item to the top level. " +
    "A course can never be moved into a folder (courses only exist at the top level) and nothing can be moved into itself or one of its own descendants — if the user asks for either, tell them it isn't possible instead of calling this tool.",
  input_schema: {
    type: "object",
    properties: {
      itemName: { type: "string" },
      destinationFolder: { type: "string" },
    },
    required: ["itemName"],
  },
};

export const RESET_QUIZ_PAGE_TOOL = {
  name: "reset_quiz_page",
  description:
    "Clear the quiz currently being edited on this page — its title, description, and every question. Only call this when the user has explicitly confirmed they want to start over from a blank quiz (e.g. after you've warned them this deletes everything currently on the page and they replied yes/امسح/ابدأ من جديد/تمام). This cannot be undone. Do NOT use this tool if the user wants to replace the current quiz with a different one — use edit_quiz for that instead (see its own description), since this page only supports one tool call per turn and a reset-then-create plan would silently only execute the reset.",
  input_schema: {
    type: "object",
    properties: {},
  },
};

export const FETCH_ATTACHED_QUIZ_TOOL = {
  name: "fetch_attached_quiz",
  description:
    "Fetch the full questions and answers for one quiz listed in an attached course or folder. Use the exact quiz ID from the attached hierarchy, and only when the user asks for details that the hierarchy does not contain.",
  input_schema: {
    type: "object",
    properties: { quizId: { type: "string" } },
    required: ["quizId"],
  },
};