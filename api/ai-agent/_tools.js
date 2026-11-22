// =============================================================================
// api/ai-agent/_tools.js
// Shared tool schema(s) the AI Helper backend can offer to providers. Kept
// provider-agnostic here; each provider adapter in _providerClients.js
// translates this into its own native tool/function-calling shape.
// =============================================================================
import { QUESTION_ITEM_SCHEMA, LESSON_BLOCK_SCHEMA, LESSON_SECTION_SCHEMA } from "./_schemas.js";

// Mirrors the JSON shape parseQuizJson()/buildUserQuizEntry() (in
// public/src/shared/quiz-json.js and public/src/features/home/quiz-schema.js)
// already expect — no new parsing code needed on the save side.
export const CREATE_QUIZ_TOOL = {
  name: "create_quiz",
  description:
    "Create a new quiz and save it directly in the user's library («محتواي»). Execute immediately when the user's request to create a quiz is clear; do not ask for confirmation or propose a draft first unless critical details are missing. " +
    "For MCQ/True-False questions, `correct` MUST always be an array of 0-based option indices — use a single-element array like [2] for one correct answer, or multiple indices like [0, 2] if more than one option is correct. Omit `correct` (and `options`) entirely for essay/free-text questions and use `answer` instead. " +
    "For fill-in-the-blank (complete) questions set `questionKind` to \"complete\" and write each blank inline in `q` as {{answer}} or {{answer|alternative|alternative}} (all accepted answers, separated by |); omit `options`, `correct` and `answer`. Use 1-20 blanks; `strictMatch: true` makes matching case/diacritics-sensitive (default lenient). " +
    "`multiSelect` controls whether the quiz-taker sees checkboxes (true) or radio buttons (false) — it is independent of how many indices are in `correct`. Default to `false` unless the user specifically wants a \"choose one or more\" question or `correct` has more than one index (in which case set it to `true`). " +
    "Math must always be LaTeX ($...$ inline, $$...$$ display) in `q`, options, `answer` and `explanation` — never plain text like x^2, sqrt(x), 1/2, x² or ≤. " +
    "True/False options must be in the quiz's language: [\"صح\",\"خطأ\"] for Arabic, [\"True\",\"False\"] for English. " +
    "To embed an image, audio, or video in a question, do NOT use dedicated fields — embed it directly inline inside `q` (or `explanation`/`answer`) using markdown bracket syntax: `![alt text](url)` for an image, `![audio](url)` for audio, `![video](url)` for video (YouTube links auto-embed). Place the tag on its own line, typically after the question text. " +
    "`folder` is the exact title of an existing folder or course (from the folder tree listing already given to you) to place the new quiz directly inside, e.g. so the user can ask for it under \"math/algebra\" instead of always landing at the top level — omit it (or pass null) to save at the top level, alongside courses.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string" },
      description: { type: "string" },
      folder: { type: "string" },
      questions: {
        type: "array",
        items: QUESTION_ITEM_SCHEMA,
      },
    },
    required: ["title", "questions"],
  },
};

// Same question-shape rules as CREATE_QUIZ_TOOL above. `currentTitle` is how
// the model identifies which existing quiz to modify — it's read out of the
// contextSummary list already given to it (see user-content-view.js). Every
// field besides currentTitle is optional so the model can send only what
// actually changes (e.g. just `title` to rename, without resending all
// questions).
export const EDIT_QUIZ_TOOL = {
  name: "edit_quiz",
  description:
    "Edit an existing quiz's title, description, or questions. Execute immediately when the requested edit is clear. " +
    "Identify the quiz using `currentTitle`, matched exactly against one of the titles already given to you. Only include the fields that actually change — omit `questions` entirely if only the title/description changed. " +
    "If `questions` is included, it REPLACES the quiz's entire question list, so include every question that should remain, not just the changed ones. (For atomic edits to individual questions without rewriting all of them, use edit_item instead). " +
    "`multiSelect` controls whether the quiz-taker sees checkboxes (true) or radio buttons (false) — it is independent of how many indices are in `correct`. Default to `false` unless the user specifically wants a \"choose one or more\" question or `correct` has more than one index. " +
    "To embed an image, audio, or video in a question, do NOT use dedicated fields — embed it directly inline inside `q` (or `explanation`/`answer`) using markdown bracket syntax: `![alt text](url)` for an image, `![audio](url)` for audio, `![video](url)` for video (YouTube links auto-embed).",
  input_schema: {
    type: "object",
    properties: {
      currentTitle: { type: "string" },
      title: { type: "string" },
      description: { type: "string" },
      questions: {
        type: "array",
        items: QUESTION_ITEM_SCHEMA,
      },
    },
    required: ["currentTitle"],
  },
};

export const DELETE_QUIZ_TOOL = {
  name: "delete_quiz",
  description:
    "Delete a quiz (it is moved to the trash and can be restored from the tool card's undo button or the trash panel). Only call this when the user has explicitly confirmed deletion of this specific quiz by name (e.g. they asked to delete it and then replied yes/احذف/تمام to your confirmation). Never call this speculatively or as a suggestion.",
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
// nothing to disambiguate.
export const EDIT_CURRENT_QUIZ_TOOL = {
  name: "edit_quiz",
  description:
    "Edit the single quiz currently open in this page's editor — its title, description, and/or questions. There is only one quiz in scope on this page, so no identifier is needed. Execute immediately when the requested edit is clear. " +
    "Only include the fields that actually change — omit `questions` entirely if only the title/description changed. " +
    "If `questions` is included, it REPLACES the quiz's entire question list, so include every question that should remain (not just new/changed ones) — this is also how you fully replace the current quiz with a different one in a single call, without a separate reset step. " +
    "`multiSelect` controls whether the quiz-taker sees checkboxes (true) or radio buttons (false) — it is independent of how many indices are in `correct`. Default to `false` unless the user specifically wants a \"choose one or more\" question or `correct` has more than one index. " +
    "To embed an image, audio, or video in a question, do NOT use dedicated fields — embed it directly inline inside `q` (or `explanation`/`answer`) using markdown bracket syntax: `![alt text](url)` for an image, `![audio](url)` for audio, `![video](url)` for video (YouTube links auto-embed).",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string" },
      description: { type: "string" },
      questions: {
        type: "array",
        items: QUESTION_ITEM_SCHEMA,
      },
    },
  },
};

export const CREATE_FOLDER_TOOL = {
  name: "create_folder",
  description:
    "Create a new folder to organize the user's content in «محتواي». Execute immediately when the user's intent to create a folder is clear. " +
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
    "Create a new course — a top-level subject grouping in «محتواي» (e.g. \"تشريح\", \"فسيولوجيا\"). Execute immediately when the user's intent to create a course is clear. " +
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
    "Move an existing quiz, lesson, notebook, folder, or course to a different location in the user's folder tree. Execute immediately when the user's intent is clear. " +
    "`itemName` is the exact title of the item to move, matched against the folder tree listing and titles already given to you. `destinationFolder` is the exact title of the folder or course to move it into, matched the same way — omit it (or pass null) to move the item to the top level. " +
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
    "Clear the quiz currently being edited on this page — its title, description, and every question. Only call this when the user has explicitly confirmed they want to start over from a blank quiz (e.g. after you've warned them this deletes everything currently on the page and they replied yes/امسح/ابدأ من جديد/تمام). Use it only for \"clear the page and stop there\". Do NOT use this tool if the user wants to replace the current quiz with a different one — call edit_quiz once with the new title, description and all the new questions instead; that replaces everything in a single step.",
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

export const FETCH_ATTACHED_LESSON_TOOL = {
  name: "fetch_attached_lesson",
  description:
    "Fetch the full readable content and metadata for one lesson attached to the conversation. Use the exact lesson ID from the attached lesson reference, and only when the user asks about details not already included in the attachment summary. Protected lessons cannot be unlocked by this tool; ask the user to open/unlock the lesson first.",
  input_schema: {
    type: "object",
    properties: { lessonId: { type: "string" } },
    required: ["lessonId"],
  },
};

export const SEARCH_LIBRARY_TOOL = {
  name: "search_library",
  description:
    "Search both the user's personal quiz library and the platform's main-page content by keyword. Use this when the user asks a conversational question about content that isn't already attached (e.g. \"find some quizzes about data structures\"), instead of asking them to attach something manually. " +
    "Returns up to a handful of matching quizzes/courses from each source, with id/title/kind. Call parse_item_info afterward with a specific result's id if you need its full contents rather than just its title.",
  input_schema: {
    type: "object",
    properties: {
      query: { type: "string" },
      scope: {
        type: "string",
        enum: ["mine", "platform", "both"],
        description: "\"mine\" searches only the user's own library, \"platform\" only the main-page content, \"both\" (default) searches everything.",
      },
    },
    required: ["query"],
  },
};

export const PARSE_ITEM_INFO_TOOL = {
  name: "parse_item_info",
  description:
    "Fetch full contents and metadata for one specific quiz, folder, course, lesson, or notebook by id or title — from either the user's own library or the platform's catalog. Supports format 'outline' (compact numbered list of questions, sections, or cells) or 'json' / 'text'.",
  input_schema: {
    type: "object",
    properties: {
      id: { type: "string" },
      kind: { type: "string", enum: ["quiz", "folder", "course", "lesson", "notebook"] },
      format: { type: "string", enum: ["outline", "text", "json"], description: "Defaults to 'outline' for cheap, structured inspection before editing." },
    },
    required: ["id"],
  },
};

export const GET_USER_ACTIVITY_TOOL = {
  name: "get_user_activity",
  description:
    "Look up the user's own recent activity on this device: their last created quiz, or the quiz they last took (including its score). Use when the user asks conversationally (e.g. \"how did I do on my last quiz?\" or \"what was the last quiz I made?\") instead of attaching it manually via @-mention. " +
    "Note: \"last taken\" and \"last result\" both come from the same stored record (this device only tracks the single most recent attempt, not a full history) — if the user asks either question, answer from whichever fields are relevant (quiz identity vs. score).",
  input_schema: {
    type: "object",
    properties: {
      which: { type: "string", enum: ["last_created", "last_taken_or_result"] },
    },
    required: ["which"],
  },
};

export const GET_CREATOR_INFO_TOOL = {
  name: "get_creator_info",
  description: "Read the full public profile and contact links of Basamgy's creator, Belal Amr Mohamed, from the site's About page. Use to answer factual questions about the creator; this is public creator information, not private information about the current chat user.",
  input_schema: { type: "object", properties: {}, required: [] },
};

export const DISPLAY_CREATOR_CARD_TOOL = {
  name: "display_creator_card",
  description: "Display an interactive in-chat card with the creator's real profile photo, portfolio thumbnail, and links. Use when the user asks to see or visit the creator's portfolio, YouTube, social profiles, or contact options.",
  input_schema: {
    type: "object",
    properties: { section: { type: "string", enum: ["all", "portfolio", "social", "contact"] } },
    required: [],
  },
};

export const CREATE_FLASHCARDS_TOOL = {
  name: "create_flashcards",
  description: "Create an interactive flashcard deck from the currently open lesson. Return concise, accurate question/answer pairs grounded only in that lesson. Aim for 6–12 cards unless the user requests another count, and include at least two useful cards. The website renders them as clickable flip cards in the current chat; do not save them as a quiz or lesson.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "A short title for the review deck." },
      cards: {
        type: "array",
        items: {
          type: "object",
          properties: {
            question: { type: "string", description: "One concise recall prompt." },
            answer: { type: "string", description: "A clear, accurate answer grounded in the lesson." },
          },
          required: ["question", "answer"],
        },
      },
    },
    required: ["title", "cards"],
  },
};

// Create-lesson page only.
export const ADD_LESSON_QUESTION_TOOL = {
  name: "add_lesson_question",
  description: "Insert one embedded question into the current lesson. Execute immediately when the creator's request is clear. Use questionKind 'complete' for fill-in-the-blank (write each blank inline in prompt as {{answer}} or {{answer|alt}}; no options or modelAnswer; optional strictMatch). Use questionKind 'essay' with a complete modelAnswer and an explanation; the reader sees an approximate 0-5 self-check rating. For MCQ, provide 2-8 options, an explanation, and a zero-based correctIndexes array; use one index for a single-answer question and set multiSelect true when there is more than one correct option. Represent true/false as two options. sectionTitle must exactly match a section supplied in the current lesson summary, or omit it to use the first section.",
  input_schema: {
    type: "object",
    properties: {
      sectionTitle: { type: "string" },
      questionKind: { type: "string", enum: ["mcq", "essay", "complete"] },
      prompt: { type: "string" },
      options: { type: "array", items: { type: "string" } },
      correctIndexes: { type: "array", items: { type: "integer" } },
      multiSelect: { type: "boolean" },
      modelAnswer: { type: "string" },
      strictMatch: { type: "boolean" },
      explanation: { type: "string" },
    },
    required: ["prompt"],
  },
};

export const CREATE_LESSON_TOOL = {
  name: "create_lesson",
  description: "Create a lesson with ordered sections containing a blocks array and save it in «محتواي». Execute immediately when the user's intent to create a lesson is clear; do not ask for confirmation or propose a draft first unless critical details are missing. Use {type:'markdown',body} for lesson content and {type:'question',questionKind:'mcq'|'essay'|'complete',prompt,...} (a 'complete' question writes blanks inline in prompt as {{answer|alt}} with no options) for embedded questions. MCQs require 2-8 options, an explanation, a zero-based correctIndex (single answer) or correctIndexes (multiple answers), and multiSelect:true for multiple answers; represent true/false as a two-option MCQ. Essays require a complete modelAnswer and explanation; readers see an approximate 0-5 self-check rating, not an overall lesson grade. Keep title, description, section titles, Markdown, and question data in this structured JSON shape.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string" },
      description: { type: "string" },
      folder: { type: "string", description: "Optional folder or course title to place the lesson inside." },
      sections: {
        type: "array",
        items: LESSON_SECTION_SCHEMA,
      },
    },
    required: ["title", "sections"],
  },
};

export const ADD_LESSON_SECTION_TOOL = {
  name: "add_lesson_section",
  description: "Append one section to the lesson currently open in the lesson editor. The section content is Markdown. Execute immediately when the requested section is clear.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string" },
      content: { type: "string" },
    },
    required: ["title", "content"],
  },
};

// ── Notebook page tools (executed client-side by notebook-agent.js) ─────────
// Cells are addressed by their 1-based number as shown in the notebook context the
// page sends along; the page re-validates everything against the shared content rules.
const NOTEBOOK_CHALLENGE_SCHEMA = {
  type: "object",
  description: "Turns a code cell into a graded coding challenge. Grading compares what the program PRINTS (stdout) with expectedOutput, never the code text. The cell's source is the learner's starter code.",
  properties: {
    expectedOutput: { type: "string", description: "Exact text the correct program prints. For matchMode=regex: a regular expression matching the whole output." },
    matchMode: { type: "string", enum: ["trimmed", "exact", "numeric", "regex"], description: "Default trimmed (ignores CRLF, trailing spaces per line, trailing blank lines). numeric: numbers within tolerance, words exact." },
    tolerance: { type: "number", description: "numeric mode only (default 1e-6)." },
    testStdin: { type: "string", description: "C++ notebooks only: input fed to cin when graded." },
    hint: { type: "string" },
    solution: { type: "string", description: "Optional model solution CODE the learner can reveal." },
  },
  required: ["expectedOutput"],
};

const NOTEBOOK_CELL_ITEM_SCHEMA = {
  type: "object",
  properties: {
    type: { type: "string", enum: ["markdown", "code"] },
    source: { type: "string", description: "Cell markdown or code source." },
    stdin: { type: "string", description: "C++ only: input for cin." },
    challenge: NOTEBOOK_CHALLENGE_SCHEMA,
  },
  required: ["type", "source"],
};

export const NOTEBOOK_ADD_CELL_TOOL = {
  name: "notebook_add_cell",
  description: "Insert one cell into the notebook currently open. type 'markdown' for explanations (Markdown, math in LaTeX) or 'code' for runnable code in the notebook's language. Use position to insert before an existing cell number; omit it to append at the end. Execute immediately when the user's request is clear.",
  input_schema: {
    type: "object",
    properties: {
      type: { type: "string", enum: ["markdown", "code"] },
      source: { type: "string", description: "Cell text or code." },
      position: { type: "integer", description: "1-based cell number the new cell is inserted BEFORE. Omit to append." },
      challenge: NOTEBOOK_CHALLENGE_SCHEMA,
    },
    required: ["type", "source"],
  },
};

export const NOTEBOOK_EDIT_CELL_TOOL = {
  name: "notebook_edit_cell",
  description: "Replace the content of an existing cell (fix a bug, improve code, rewrite an explanation). Give the cell number exactly as listed in the notebook context, and the COMPLETE new source (not a diff). Optionally set or remove its challenge. Execute immediately when the user's request is clear.",
  input_schema: {
    type: "object",
    properties: {
      cell: { type: "integer", description: "1-based cell number." },
      source: { type: "string", description: "Complete new source for the cell." },
      challenge: { ...NOTEBOOK_CHALLENGE_SCHEMA, description: NOTEBOOK_CHALLENGE_SCHEMA.description + " Omit to leave the cell's challenge unchanged." },
      removeChallenge: { type: "boolean", description: "true to turn a challenge cell back into an ordinary code cell." },
    },
    required: ["cell"],
  },
};

export const NOTEBOOK_DELETE_CELL_TOOL = {
  name: "notebook_delete_cell",
  description: "Delete one cell from the open notebook by its 1-based number. ALWAYS show which cell will be deleted and get explicit confirmation first, unless the user used the explicit /delete-cell command naming the cell.",
  input_schema: {
    type: "object",
    properties: { cell: { type: "integer", description: "1-based cell number." } },
    required: ["cell"],
  },
};

export const NOTEBOOK_RUN_CELL_TOOL = {
  name: "notebook_run_cell",
  description: "Run one code cell of the open notebook (earlier cells replay automatically where the language needs it) and report what it printed. Use it to check a fix or a challenge. Safe: it only executes code already in the notebook.",
  input_schema: {
    type: "object",
    properties: { cell: { type: "integer", description: "1-based cell number of a code cell." } },
    required: ["cell"],
  },
};

// ── Authoring & Management Tools (Parity with MCP) ──────────────────────────

export const CREATE_NOTEBOOK_TOOL = {
  name: "create_notebook",
  description:
    "Create a new interactive executable notebook (MATLAB or C++) and save it directly in the user's library («محتواي»). " +
    "Execute immediately when the user asks to create a notebook; do not ask for confirmation or propose a draft first. " +
    "runtime MUST be 'matlab' or 'cpp'. language is 'ar' or 'en' (defaults to 'ar'). " +
    "Alternate short Markdown cells (explanations) with runnable code cells. Each cell must be clear and self-contained. " +
    "Math in Markdown must always be LaTeX ($...$ inline, $$...$$ display). " +
    "Optional 'challenge' object on code cells turns them into graded coding challenges evaluated on program stdout. " +
    "Optional 'folder' specifies the exact title of an existing folder or course to save inside.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Notebook title (1-200 chars)." },
      description: { type: "string", description: "Short summary of the notebook." },
      runtime: { type: "string", enum: ["matlab", "cpp"], description: "Execution environment ('matlab' for web MATLAB, 'cpp' for C++)." },
      language: { type: "string", enum: ["ar", "en"], description: "Language for markdown explanations. Defaults to 'ar'." },
      source: { type: "string", description: "Direct URL to source material, or empty string." },
      folder: { type: "string", description: "Exact title of an existing folder or course to place the notebook inside." },
      cells: {
        type: "array",
        description: "Ordered cells (1-200 cells).",
        items: NOTEBOOK_CELL_ITEM_SCHEMA,
      },
    },
    required: ["title", "runtime", "cells"],
  },
};

export const EDIT_ITEM_TOOL = {
  name: "edit_item",
  description:
    "Edit an existing quiz, lesson, notebook, folder, or course in «محتواي». " +
    "Execute immediately when the user's requested edit is clear. " +
    "Identify the item using `targetTitle` (matched exactly against one of the titles in the user's library). " +
    "To rename or update description, pass `newTitle` and/or `description`. " +
    "To modify questions, sections, blocks, or cells without resending the entire item, pass atomic operations in `patch.ops`: " +
    "For quizzes: set_question{at, question}, insert_question{at, question}, append_questions{questions}, delete_question{at}, move_question{at, to}. " +
    "For notebooks: set_cell{at, cell}, insert_cell{at, cell}, append_cells{cells}, delete_cell{at}, move_cell{at, to}. " +
    "For lessons: set_section{at, section}, insert_section{at, section}, append_sections{sections}, delete_section{at}, move_section{at, to}, set_block{section, at, block}, insert_block{section, at, block}, append_blocks{section, blocks}, delete_block{section, at}, move_block{section, at, to}. " +
    "For all items: replace_text{find, replace} to search and replace text across all strings in the item. Positions are 1-based.",
  input_schema: {
    type: "object",
    properties: {
      targetTitle: { type: "string", description: "Exact title of the existing item to edit." },
      newTitle: { type: "string", description: "Optional new title to rename the item." },
      description: { type: "string", description: "Optional new description." },
      patch: {
        type: "object",
        description: "Atomic patch operations object: { meta?: {title, description, source, runtime}, ops?: [...] }",
        properties: {
          meta: {
            type: "object",
            properties: {
              title: { type: "string" },
              description: { type: "string" },
              source: { type: "string" },
              runtime: { type: "string" },
            },
          },
          ops: {
            type: "array",
            items: {
              type: "object",
              properties: {
                op: { type: "string" },
                at: { type: "integer" },
                to: { type: "integer" },
                section: { type: "integer" },
                find: { type: "string" },
                replace: { type: "string" },
                question: { type: "object" },
                questions: { type: "array", items: QUESTION_ITEM_SCHEMA },
                cell: { type: "object" },
                cells: { type: "array", items: NOTEBOOK_CELL_ITEM_SCHEMA },
                sectionItem: { type: "object" },
                sections: { type: "array", items: LESSON_SECTION_SCHEMA },
                block: { type: "object" },
                blocks: { type: "array", items: LESSON_BLOCK_SCHEMA },
              },
              required: ["op"],
            },
          },
        },
      },
      questions: { type: "array", items: QUESTION_ITEM_SCHEMA, description: "Optional full questions replacement for a quiz." },
      sections: { type: "array", items: LESSON_SECTION_SCHEMA, description: "Optional full sections replacement for a lesson." },
      cells: { type: "array", items: NOTEBOOK_CELL_ITEM_SCHEMA, description: "Optional full cells replacement for a notebook." },
    },
    required: ["targetTitle"],
  },
};

export const GET_AUTHORING_GUIDE_TOOL = {
  name: "get_authoring_guide",
  description:
    "Retrieve authoritative guidelines, specifications, quality rules, and JSON schemas for authoring or converting quizzes, lessons, and notebooks in Basmagi platform. Call topic='convert' when converting existing files or Google Drive folders.",
  input_schema: {
    type: "object",
    properties: {
      topic: {
        type: "string",
        enum: ["all", "workflow", "convert", "quiz", "lesson", "notebook", "markdown"],
        description: "Guide topic. Defaults to 'all'.",
      },
    },
  },
};

// YouTube tools (the in-app AI agent only: personal content lives in the browser,
// so the server never sees it). Handled client-side by youtube-agent-tools.js.
export const SEARCH_YOUTUBE_TOOL = {
  name: "search_youtube",
  description:
    "Search YouTube for videos and return up to 10 results with title, channel, and watch URL. Read-only. " +
    "Use it when the user wants to find a video; save one with add_youtube only when the user asks to save it.",
  input_schema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search text, up to 100 characters." },
    },
    required: ["query"],
  },
};

export const LIST_YOUTUBE_TOOL = {
  name: "list_youtube",
  description:
    "List the YouTube videos and playlists saved in the user's library («محتواي»), optionally filtered by kind or by title text. Read-only.",
  input_schema: {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["video", "playlist", "all"], description: "Default \"all\"." },
      query: { type: "string", description: "Optional text to match against titles." },
    },
  },
};

export const SUMMARIZE_YOUTUBE_TOOL = {
  name: "summarize_youtube",
  description:
    "Read a YouTube video's actual content so you can summarize it, explain it, or build a lesson/quiz from it. Give a YouTube URL, a bare video ID, or the title of a video saved in the user's library. " +
    "It returns the video's transcript with timestamps (human captions when available, otherwise auto-generated), in parts for long videos: pass `part` (1, 2, …) to read the next part, and read all parts before writing a full summary. " +
    "If the video has no transcript it returns the title and description only and says so — then tell the user the summary is based on the description, and never invent what was said. " +
    "Read-only. To keep the result, offer create_lesson (or create_quiz) afterwards; do not save anything unless the user asks.",
  input_schema: {
    type: "object",
    properties: {
      video: { type: "string", description: "A YouTube watch, youtu.be, or Shorts URL, a bare 11-character video ID, or the exact title of a saved video." },
      part: { type: "integer", description: "Which part of a long transcript to read. Default 1." },
      language: { type: "string", description: "Preferred caption language code, e.g. \"ar\" or \"en\". Optional." },
    },
    required: ["video"],
  },
};

export const REMOVE_YOUTUBE_TOOL = {
  name: "remove_youtube",
  description:
    "Remove a saved YouTube video or playlist from the user's library («محتواي»). It moves to the trash and the user can undo it from the tool card. " +
    "Identify it by its exact title (as shown by list_youtube) or its YouTube URL/ID. ALWAYS confirm with the user before calling this. Use move_item (not this) to move it to another folder.",
  input_schema: {
    type: "object",
    properties: {
      item: { type: "string", description: "Exact title, YouTube URL, video ID or playlist ID of the saved item." },
    },
    required: ["item"],
  },
};

export const ADD_YOUTUBE_TOOL = {
  name: "add_youtube",
  description:
    "Save a YouTube video or playlist into the user's library («محتواي») in the current folder. Give a YouTube URL or a bare video ID. " +
    "A playlist URL is saved as ONE card (up to 200 items), not one card per video. A watch URL that also has a list parameter is saved as the single video. " +
    "Titles, channels, and thumbnails come from YouTube and are read-only. Only call this when the user asks to save something.",
  input_schema: {
    type: "object",
    properties: {
      url: { type: "string", description: "A YouTube watch, youtu.be, Shorts, or playlist URL, or a bare 11-character video ID." },
    },
    required: ["url"],
  },
};
