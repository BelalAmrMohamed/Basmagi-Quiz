// =============================================================================
// api/ai-agent/_botTools.js
// Gemini function-calling tool definitions and execution router for the
// Telegram bot. All database access goes through the Supabase service_role
// client passed in by the bot handler.
//
// Tool schemas (BOT_TOOLS) are formatted for Gemini's functionDeclarations.
// executeBotTool() dispatches each tool call to the right handler, which
// either queries the database or generates + sends files back to the user.
//
// All tools are READ-ONLY against the platform data. File generation tools
// build in-memory buffers and send them via the Telegram Bot API.
// =============================================================================

import {
  generateStandaloneQuizHtml,
  generateQuizJson,
  generateQuizMarkdown,
  generateQuizPdf,
  generateLessonMarkdown,
  generateLessonJson,
  generateLessonHtml,
  generateLessonPdf,
} from "./_botGenerators.js";

import {
  sendTelegramDocument,
  sendTelegramChatAction,
} from "./_telegramFiles.js";

// ── 4.1: Tool Schema Definitions ────────────────────────────────────────────

export const BOT_TOOLS = [
  {
    name: "search_courses",
    description:
      "Search the platform's course catalog. Use when a user asks about available courses, subjects, or university content. Returns matching courses with their IDs and metadata.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Free-text search term to match against course names (e.g. 'تشريح', 'anatomy', 'كيمياء').",
        },
        education_type: {
          type: "string",
          description:
            "Filter by education type: 'University', 'Primary', 'Middle', 'High'. Omit to search all.",
        },
        college: {
          type: "string",
          description: "Filter by college name (e.g. 'طب', 'صيدلة').",
        },
        year: {
          type: "string",
          description: "Filter by academic year.",
        },
        term: {
          type: "string",
          description: "Filter by term/semester.",
        },
      },
    },
  },

  {
    name: "get_course_contents",
    description:
      "Get the folders, quizzes, and lessons inside a specific course. Use after search_courses returns a course_id the user is interested in.",
    parameters: {
      type: "object",
      properties: {
        course_id: {
          type: "string",
          description: "The UUID of the course to inspect.",
        },
      },
      required: ["course_id"],
    },
  },

  {
    name: "fetch_quiz",
    description:
      "Fetch full quiz data (questions, answers, explanations) by quiz ID. Also returns the web URL for the quiz.",
    parameters: {
      type: "object",
      properties: {
        quiz_id: {
          type: "string",
          description: "The quiz identifier (8-character ID or database UUID).",
        },
      },
      required: ["quiz_id"],
    },
  },

  {
    name: "export_quiz",
    description:
      "Export and send an existing quiz from the platform to the user as an interactive HTML (.html), PDF (.pdf), Markdown (.md), or JSON (.json) file. If the user does not specify a format or extension, default to HTML. For PDF, honor the user's requested PDF options.",
    parameters: {
      type: "object",
      properties: {
        quiz_id: {
          type: "string",
          description: "The quiz ID (either the 8-character ID like 'N6QFXNCX' or the database UUID).",
        },
        format: {
          type: "string",
          enum: ["html", "pdf", "markdown", "json"],
          description: "Desired export format. Defaults to html when omitted or unspecified.",
        },
        pdf_options: {
          type: "object",
          description: "PDF-only options. Defaults match the platform export settings: omit answers and explanations, place answers inline if included, and use a light background.",
          properties: {
            backgroundColor: {
              type: "string",
              enum: ["light", "dark"],
              description: "PDF page background; defaults to light.",
            },
            includeAnswers: {
              type: "boolean",
              description: "Whether to include correct answers; defaults to false.",
            },
            includeExplanations: {
              type: "boolean",
              description: "Whether to include explanations; defaults to false.",
            },
            answerPlacement: {
              type: "string",
              enum: ["inline", "final-page"],
              description: "Place included answers below each question or together in a final answer key; defaults to inline.",
            },
          },
        },
      },
      required: ["quiz_id"],
    },
  },

  {
    name: "fetch_lesson",
    description:
      "Fetch a lesson's full content and metadata by lesson ID. Returns the lesson data and web URL.",
    parameters: {
      type: "object",
      properties: {
        lesson_id: {
          type: "string",
          description: "The UUID of the lesson.",
        },
      },
      required: ["lesson_id"],
    },
  },

  {
    name: "generate_quiz_file",
    description:
      "Generate and send a brand new quiz file to the user from questions created by AI or extracted from user notes. Supported formats: 'html' (standalone interactive), 'pdf', 'markdown', 'json' (platform-importable). Defaults to HTML when the user does not choose a format.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Quiz title." },
        format: {
          type: "string",
          enum: ["html", "pdf", "markdown", "json"],
          description: "Output file format. Defaults to html if the user does not choose one.",
        },
        pdf_options: {
          type: "object",
          description: "PDF-only options, matching the platform PDF export settings.",
          properties: {
            backgroundColor: { type: "string", enum: ["light", "dark"] },
            includeAnswers: { type: "boolean" },
            includeExplanations: { type: "boolean" },
            answerPlacement: { type: "string", enum: ["inline", "final-page"] },
          },
        },
        questions: {
          type: "array",
          description: "Array of question objects.",
          items: {
            type: "object",
            properties: {
              q: { type: "string" },
              options: { type: "array", items: { type: "string" } },
              correct: { type: "array", items: { type: "integer" } },
              multiSelect: { type: "boolean" },
              answer: { type: "string" },
              explanation: { type: "string" },
            },
            required: ["q"],
          },
        },
      },
      required: ["title", "questions"],
    },
  },

  {
    name: "generate_lesson_file",
    description:
      "Generate and send a lesson file to the user. Supported formats: interactive 'html', 'pdf', 'markdown', and 'json'.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Lesson title." },
        format: {
          type: "string",
          enum: ["html", "pdf", "markdown", "json"],
          description: "Output file format. Defaults to html if the user does not choose one.",
        },
        sections: {
          type: "array",
          description: "Ordered lesson sections. Each section uses a blocks array: Markdown blocks use {type:'markdown',body}; embedded questions use {type:'question',questionKind,prompt,...}. Legacy content/questions fields are also accepted.",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              content: { type: "string" },
              blocks: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    type: { type: "string", enum: ["markdown", "question"] },
                    body: { type: "string" },
                    questionKind: { type: "string", enum: ["mcq", "essay"] },
                    prompt: { type: "string" },
                    options: { type: "array", items: { type: "string" } },
                    correctIndex: { type: "integer", description: "Zero-based correct option index for a single-answer MCQ." },
                    correctIndexes: { type: "array", items: { type: "integer" }, description: "Zero-based correct option indexes for a multi-select MCQ." },
                    multiSelect: { type: "boolean" },
                    modelAnswer: { type: "string" },
                    explanation: { type: "string" },
                  },
                },
              },
              questions: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    q: { type: "string" },
                    options: { type: "array", items: { type: "string" } },
                    correct: { type: "array", items: { type: "integer" }, description: "Correct option indexes, starting at 0." },
                    multiSelect: { type: "boolean" },
                    answer: { type: "string" },
                    modelAnswer: { type: "string" },
                    explanation: { type: "string" },
                  },
                },
              },
            },
            required: ["title", "blocks"],
          },
        },
      },
      required: ["title", "sections"],
    },
  },
];

// ── 4.2: Tool Execution Router ──────────────────────────────────────────────

/**
 * Executes a single bot tool call and returns the result to feed back to Gemini.
 *
 * @param {string} toolName
 * @param {object} args - tool arguments from Gemini's functionCall
 * @param {number|string} chatId - Telegram chat ID (for sending documents)
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @returns {Promise<object>} result object to return as functionResponse
 */
export async function executeBotTool(toolName, args, chatId, supabase) {
  switch (toolName) {
    case "search_courses":
      return await handleSearchCourses(args, supabase);
    case "get_course_contents":
      return await handleGetCourseContents(args, supabase);
    case "fetch_quiz":
      return await handleFetchQuiz(args, supabase);
    case "export_quiz":
      return await handleExportQuiz(args, chatId, supabase);
    case "fetch_lesson":
      return await handleFetchLesson(args, supabase);
    case "generate_quiz_file":
      return await handleGenerateQuizFile(args, chatId);
    case "generate_lesson_file":
      return await handleGenerateLessonFile(args, chatId);
    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}

// ── Tool Handlers ───────────────────────────────────────────────────────────

async function handleSearchCourses(args, supabase) {
  let query = supabase
    .from("courses")
    .select("id, name, education_type, college, year, term")
    .limit(10);

  if (args.education_type) {
    query = query.eq("education_type", args.education_type);
  }
  if (args.college) {
    query = query.ilike("college", `%${args.college}%`);
  }
  if (args.year) {
    query = query.eq("year", args.year);
  }
  if (args.term) {
    query = query.eq("term", args.term);
  }
  if (args.query) {
    query = query.ilike("name", `%${args.query}%`);
  }

  const { data, error } = await query;
  if (error) return { error: error.message };

  return {
    courses: (data || []).map((c) => ({
      id: c.id,
      name: c.name,
      education_type: c.education_type,
      college: c.college,
      year: c.year,
      term: c.term,
    })),
    count: (data || []).length,
  };
}

async function handleGetCourseContents(args, supabase) {
  const courseId = args.course_id;

  // Fetch folders
  const { data: folders } = await supabase
    .from("folders")
    .select("id, name, parent_folder_id")
    .eq("course_id", courseId)
    .limit(50);

  // Fetch quizzes
  const { data: quizzes } = await supabase
    .from("quizzes")
    .select("id, title, data")
    .eq("course_id", courseId)
    .limit(50);

  // Fetch lessons
  const { data: lessons } = await supabase
    .from("lesson_public")
    .select("id, title, slug")
    .eq("course_id", courseId)
    .limit(50);

  return {
    folders: (folders || []).map((f) => ({
      id: f.id,
      name: f.name,
      parent_folder_id: f.parent_folder_id,
    })),
    quizzes: (quizzes || []).map((q) => {
      const metaId = q.data?.meta?.id || q.id;
      return {
        id: metaId,
        db_id: q.id,
        title: q.title,
        questionCount: q.data?.questions?.length || 0,
        url: `https://basmagi-quiz.vercel.app/quiz/${metaId}`,
      };
    }),
    lessons: (lessons || []).map((l) => ({
      id: l.id,
      title: l.title,
      url: `https://basmagi-quiz.vercel.app/lesson/${l.id}`,
    })),
    totalFolders: (folders || []).length,
    totalQuizzes: (quizzes || []).length,
    totalLessons: (lessons || []).length,
  };
}

async function handleFetchQuiz(args, supabase) {
  // Allow lookup by either 8-char base32 ID or UUID
  let { data, error } = await supabase
    .from("quizzes")
    .select("id, title, data, path")
    .filter("data->meta->>id", "eq", args.quiz_id)
    .limit(1)
    .maybeSingle();

  if (!data) {
    const res = await supabase
      .from("quizzes")
      .select("id, title, data, path")
      .eq("id", args.quiz_id)
      .limit(1)
      .maybeSingle();
    data = res.data;
    error = res.error;
  }

  if (error) return { error: error.message };
  if (!data) return { error: "Quiz not found." };

  const quiz = data.data || {};
  const metaId = quiz.meta?.id || data.id;

  return {
    id: metaId,
    db_id: data.id,
    title: data.title || quiz.meta?.title || "",
    description: quiz.meta?.description || "",
    questionCount: quiz.questions?.length || 0,
    questions: (quiz.questions || []).slice(0, 50).map((q) => ({
      q: q.q,
      options: q.options,
      correct: q.correct,
      multiSelect: q.multiSelect,
      answer: q.answer,
      explanation: q.explanation,
    })),
    url: `https://basmagi-quiz.vercel.app/quiz/${metaId}`,
  };
}

async function handleExportQuiz(args, chatId, supabase) {
  const { quiz_id } = args;
  const format = normalizeExportFormat(args.format);

  // Look up quiz by 8-char meta ID first, then fallback to row UUID
  let { data: quizRow, error } = await supabase
    .from("quizzes")
    .select("id, title, data")
    .filter("data->meta->>id", "eq", quiz_id)
    .limit(1)
    .maybeSingle();

  if (!quizRow) {
    const res = await supabase
      .from("quizzes")
      .select("id, title, data")
      .eq("id", quiz_id)
      .limit(1)
      .maybeSingle();
    quizRow = res.data;
    error = res.error;
  }

  if (error) return { error: error.message };
  if (!quizRow) return { error: `Quiz not found with ID: ${quiz_id}` };

  const quizData = quizRow.data || {};
  const title = quizRow.title || quizData.meta?.title || "Quiz";
  const questions = quizData.questions || [];

  if (!questions.length) {
    return { error: `Quiz "${title}" has no questions to export.` };
  }

  return await handleGenerateQuizFile(
    {
      title,
      format,
      questions,
      quizId: quizData.meta?.id || quizRow.id,
      pdfOptions: args.pdf_options,
    },
    chatId
  );
}

async function handleFetchLesson(args, supabase) {
  const { data, error } = await supabase
    .from("lesson_public")
    .select("id, title, slug, description, content, password_protected")
    .eq("id", args.lesson_id)
    .maybeSingle();

  if (error) return { error: error.message };
  if (!data) return { error: "Lesson not found." };

  if (data.password_protected) {
    return {
      id: data.id,
      title: data.title,
      description: data.description || "",
      url: `https://basmagi-quiz.vercel.app/lesson/${data.id}`,
      note: "This lesson is password-protected. The user must open it on the website to access the full content.",
    };
  }

  const lesson = data.content || {};
  return {
    id: data.id,
    title: data.title,
    description: data.description || "",
    sections: Array.isArray(lesson.sections)
      ? lesson.sections.map((s) => ({
          title: s.title || "",
          contentPreview: (s.content || "").slice(0, 500),
        }))
      : [],
    url: `https://basmagi-quiz.vercel.app/lesson/${data.id}`,
  };
}

async function handleGenerateQuizFile(args, chatId) {
  const { title, questions, quizId } = args;
  const format = normalizeExportFormat(args.format);

  await sendTelegramChatAction(chatId, "upload_document");

  const safeName =
    (title || "quiz")
      .replace(/[^\u0600-\u06FF\w\s-]/gu, "")
      .trim()
      .replace(/\s+/g, "_") || "quiz";

  let buffer, filename;

  switch (format) {
    case "html":
      buffer = await generateStandaloneQuizHtml(title, questions, { id: quizId });
      filename = `${safeName}.html`;
      break;
    case "pdf":
      buffer = await generateQuizPdf(
        title,
        questions,
        args.pdf_options || args.pdfOptions || {},
      );
      filename = `${safeName}.pdf`;
      break;
    case "markdown":
      buffer = generateQuizMarkdown(title, questions, { id: quizId });
      filename = `${safeName}.md`;
      break;
    case "json":
      buffer = generateQuizJson(title, questions);
      filename = `${safeName}.json`;
      break;
    default:
      return { error: `Unsupported format: ${format}` };
  }

  await sendTelegramDocument(
    chatId,
    buffer,
    filename,
    `📝 ${title} (${format.toUpperCase()})`
  );

  return {
    success: true,
    format,
    filename,
    message: `File "${filename}" has been sent to the user.`,
  };
}

function normalizeExportFormat(format) {
  if (typeof format !== "string" || !format.trim()) return "html";

  const normalized = format.trim().toLowerCase().replace(/^\./, "");
  return normalized === "md" ? "markdown" : normalized;
}

async function handleGenerateLessonFile(args, chatId) {
  const { title, sections } = args;
  const format = normalizeExportFormat(args.format);

  await sendTelegramChatAction(chatId, "upload_document");

  const safeName =
    (title || "lesson")
      .replace(/[^\u0600-\u06FF\w\s-]/gu, "")
      .trim()
      .replace(/\s+/g, "_") || "lesson";

  let buffer, filename;

  switch (format) {
    case "html":
      buffer = generateLessonHtml(title, sections);
      filename = `${safeName}.html`;
      break;
    case "pdf":
      buffer = await generateLessonPdf(title, sections);
      filename = `${safeName}.pdf`;
      break;
    case "markdown":
      buffer = generateLessonMarkdown(title, sections);
      filename = `${safeName}.md`;
      break;
    case "json":
      buffer = generateLessonJson(title, sections);
      filename = `${safeName}.json`;
      break;
    default:
      return { error: `Unsupported lesson format: ${format}` };
  }

  await sendTelegramDocument(
    chatId,
    buffer,
    filename,
    `📖 ${title} (${format.toUpperCase()})`
  );

  return {
    success: true,
    format,
    filename,
    message: `Lesson file "${filename}" has been sent to the user.`,
  };
}
