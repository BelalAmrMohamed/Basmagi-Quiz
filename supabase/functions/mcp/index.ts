// =============================================================================
// supabase/functions/mcp/index.ts
// Model Context Protocol (MCP) Server for Basmagi Quiz (منصة إمتحانات بصمجي)
// Connects Claude.ai and ChatGPT.com to Basmagi Quiz tools, prompts, and catalog.
//
// Version 3.1.0: get_import_draft, update_import_draft (atomic patch ops), clone_to_draft,
//   dry_run on create tools, format 'outline' on get_quiz / get_lesson_content.
//
// Version 3.0.0:
//   - create_*_import_link now stores a short-lived draft (table import_drafts) and returns a
//     SHORT link (/create-quiz?draft=<code>) instead of a huge base64 URL. Falls back to base64
//     only if the database write fails. No sign-in involved.
//   - Strict validation with ERRORS (nothing saved) and WARNINGS (saved), never silent guessing.
//   - Fixed: essay questions no longer get fake "نعم/لا" options; search_catalog searches ALL quizzes.
//   - New: get_authoring_guide; get_creator_info(section) rebuilt from the /about page;
//     tool annotations (readOnly / destructive hints).
//   - GET /draft/<code> → JSON, used by the create-quiz / create-lesson pages.
//
// Version 2.2.0:
//   - Full content retrieval for courses & folders (with recursive traversal)
//   - Format toggle (text summary vs raw JSON) on quizzes, lessons, and course/folder content
//   - New tools: list_courses, list_colleges, get_course_contents, get_folder_contents,
//     list_folder_tree, get_quiz, get_quiz_by_url, get_lesson, get_lesson_content,
//     list_recent_content, get_platform_stats, search_catalog, get_prompts,
//     create_quiz_import_link, create_lesson_import_link, get_creator_info
// =============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  AUTHORING_GUIDE, CREATOR_INFO, DRAFT_CODE_RE, DRAFT_TTL_HOURS, SITE,
  draftUrl, makeDraftCode, validateLesson, validateQuiz,
  applyDraftPatch, lessonToDraftInput, outlineLesson, outlineQuiz, quizToDraftInput,
} from "./lib.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
  Deno.env.get("SUPABASE_ANON_KEY") ||
  "";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Authorization, Content-Type, Accept, X-Requested-With, mcp-session-id",
  "Access-Control-Expose-Headers": "Content-Type",
};

// ── Prompts Library ─────────────────────────────────────────────────────────

const QUIZ_JSON_INSTRUCTIONS = `Create a quiz from the material I provide. Return one valid JSON object only.

The object must use this shape:
{
  "meta": {
    "title": "A clear, specific quiz title",
    "description": "A short description of the quiz and what it assesses",
    "source": "https://... (the source link of the quiz, like the drive link of the original quiz, or \"\" if none)"
  },
  "questions": [
    {
      "q": "Question text",
      "options": ["First option", "Second option", "Third option", "Fourth option"],
      "correct": 1,
      "explanation": "A helpful explanation of why the answer is correct"
    },
    {
      "q": "A question that can have more than one correct answer",
      "options": ["First option", "Second option", "Third option"],
      "correct": [0, 2],
      "multiSelect": true,
      "explanation": "Explain why each selected option is correct"
    },
    {
      "q": "An open-ended question",
      "answer": "A model answer or grading guidance",
      "explanation": "Additional teaching context"
    }
  ]
}

Schema and content rules:
- Always provide a meaningful meta.title and meta.description.
- meta.source: copy the real link to the source material (Google Drive/Docs/Slides link, PDF URL, YouTube/video URL, article or book page). It must be a complete URL starting with https:// or http://. If there is no link, use an empty string "".
- Include a non-empty questions array. Each question needs q and an explanation. For multiple-choice questions, provide options and set correct to the zero-based index of the right option. For a genuinely multi-answer question, set correct to an array of zero-based indexes and multiSelect to true.
- Use {"q":"...","answer":"...","explanation":"..."} for open-ended/essay questions.
- A two-option question can be used for true/false.
- Media is written inline with Markdown syntax: ![description](url) for image, ![audio](url) for audio, ![video](url) for video.`;

const PROMPTS_REGISTRY: Record<string, { description: string; text: string }> = {
  general_purpose_quiz: {
    description: "Standard prompt for generating quizzes from raw study material",
    text: `${QUIZ_JSON_INSTRUCTIONS}\n\nAdapt the question types and difficulty to the supplied subject and audience. For unsolved questions, solve them carefully and explain the reasoning. The "source" MUST be a direct link/URL (e.g. Google Drive link to lecture slides or PDF), not plain text.\n\nNow convert the source material I provide:`,
  },
  english_specializing: {
    description: "Specialized prompt for English grammar, vocabulary, and reading comprehension quizzes",
    text: `${QUIZ_JSON_INSTRUCTIONS}\n\nFor English-language material:\n- Assess skills present (grammar, vocabulary, reading comprehension, usage).\n- Use natural English, plausible distractors, and context-rich examples.\n- For reading questions, include the passage in the question text with Markdown formatting, then ask a focused question about it.\n- The "source" MUST be a direct link/URL (e.g. Google Drive link or web URL), not plain text.\n\nNow convert the English source material I provide:`,
  },
  math_specializing: {
    description: "Specialized prompt for mathematics and science quizzes with LaTeX formula support",
    text: `${QUIZ_JSON_INSTRUCTIONS}\n\nFor mathematics and science material:\n- Preserve mathematical meaning and use correct LaTeX delimiters: $...$ inline and $$...$$ display math.\n- Include a mix of conceptual and computational questions when appropriate.\n- Check calculations and symbolic answers before returning them.\n- The "source" MUST be a direct link/URL (e.g. Google Drive link or web URL), not plain text.\n\nNow convert the mathematics/science source material I provide:`,
  },
  assistant_system_prompt: {
    description: "Official system prompt of El-Bashmebasamag the smart platform assistant",
    text: `You are El-Bashmebasamag, the smart assistant for Basamgy Exams Platform — an educational platform that lets users create, browse, and manage exams and lessons.\nExplain academic topics accurately. Propose quiz and lesson content cleanly. Always respect zero-based indexing for question options (correct: 0 is the first option). When creating quizzes or lessons, the "source" field MUST always be a link/URL (like a Google Drive lecture link or web URL), never just plain text.`,
  },
};

// ── MCP Tools Registry ──────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "search_catalog",
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: "Search public educational content on Basmagi Platform: courses, folders, quizzes, and lessons by keyword with optional scope filter.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Keyword or topic to search for" },
        scope: { type: "string", enum: ["all", "quizzes", "lessons", "courses", "folders"], description: "Optional scope filter. Defaults to 'all'." },
      },
      required: ["query"],
    },
  },
  {
    name: "list_courses",
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: "List courses on Basmagi Platform with optional filters (education track, college, year, term). Use this to discover available subjects and get their IDs.",
    inputSchema: {
      type: "object",
      properties: {
        education_type: { type: "string", enum: ["University", "Primary", "Middle", "High", "Featured"], description: "Filter by education stage." },
        college: { type: "string", description: "Filter by college or faculty name (case-insensitive substring)." },
        year: { type: "integer", description: "Filter by academic year number." },
        term: { type: "integer", description: "Filter by semester/term number." },
        limit: { type: "integer", description: "Max courses to return (1-100). Defaults to 50." },
      },
      required: [],
    },
  },
  {
    name: "list_colleges",
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: "List all active colleges and institutions registered on Basmagi Platform, with metadata on years and terms.",
    inputSchema: {
      type: "object",
      properties: {
        education_type: { type: "string", enum: ["University", "Primary", "Middle", "High"], description: "Filter by education stage. Defaults to all." },
      },
      required: [],
    },
  },
  {
    name: "get_course_contents",
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: "Retrieve all content inside a specific course. Supports 'recursive: true' to gather ALL quizzes and lessons across all nested subfolders in one single call, or direct items when false.",
    inputSchema: {
      type: "object",
      properties: {
        courseId: { type: "string", description: "The UUID of the course to inspect." },
        recursive: { type: "boolean", description: "If true, traverses all subfolders recursively to collect all quizzes and lessons across the entire course. Defaults to false." },
        include_quizzes: { type: "boolean", description: "Include quizzes. Defaults to true." },
        include_lessons: { type: "boolean", description: "Include lessons. Defaults to true." },
        format: { type: "string", enum: ["summary", "json"], description: "Output format: 'summary' for readable Markdown inventory, or 'json' for raw structured data. Defaults to 'summary'." },
      },
      required: ["courseId"],
    },
  },
  {
    name: "get_folder_contents",
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: "Retrieve all content inside a specific folder: sub-folders, quizzes, and lessons. Supports 'recursive: true' to gather everything inside all descendant subfolders.",
    inputSchema: {
      type: "object",
      properties: {
        folderId: { type: "string", description: "The UUID of the folder to inspect." },
        recursive: { type: "boolean", description: "If true, traverses all nested subfolders recursively. Defaults to false." },
        include_quizzes: { type: "boolean", description: "Include quizzes. Defaults to true." },
        include_lessons: { type: "boolean", description: "Include lessons. Defaults to true." },
        format: { type: "string", enum: ["summary", "json"], description: "Output format: 'summary' for readable Markdown inventory, or 'json' for raw structured data. Defaults to 'summary'." },
      },
      required: ["folderId"],
    },
  },
  {
    name: "list_folder_tree",
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: "Get the complete hierarchical folder tree of a course in a single visual ASCII call, with counts of quizzes and lessons in each folder.",
    inputSchema: {
      type: "object",
      properties: {
        courseId: { type: "string", description: "The UUID of the course whose folder hierarchy to retrieve." },
      },
      required: ["courseId"],
    },
  },
  {
    name: "get_quiz",
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: "Fetch a public quiz by its ID (8-character short ID or UUID). Returns either formatted readable questions with answers and explanations, or raw JSON.",
    inputSchema: {
      type: "object",
      properties: {
        quizId: { type: "string", description: "The unique identifier of the quiz (short ID like 'a1b2c3d4' or full UUID)." },
        format: { type: "string", enum: ["text", "json", "outline"], description: "'text' (default) readable questions & answers · 'json' exact quiz JSON · 'outline' compact numbered list (type, #options, correct index, first words) + folder path — cheapest way to inspect a quiz." },
      },
      required: ["quizId"],
    },
  },
  {
    name: "get_quiz_by_url",
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: "Resolve and fetch a quiz directly from any Basmagi URL, short ID, or UUID.",
    inputSchema: {
      type: "object",
      properties: {
        url_or_id: { type: "string", description: "A Basmagi quiz URL (e.g. https://basmagi-quiz.vercel.app/quiz/...), short ID, or UUID." },
        format: { type: "string", enum: ["text", "json", "outline"], description: "'text' (default), 'json', or 'outline' (compact numbered list + folder path)." },
      },
      required: ["url_or_id"],
    },
  },
  {
    name: "get_lesson",
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: "Fetch metadata (title, description, source, section count, protection status) of a public lesson by ID or slug.",
    inputSchema: {
      type: "object",
      properties: {
        lessonId: { type: "string", description: "The UUID or slug of the lesson." },
      },
      required: ["lessonId"],
    },
  },
  {
    name: "get_lesson_content",
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: "Fetch the complete content of a public lesson: sections, full markdown bodies, embedded questions (MCQ/essay), and media references.",
    inputSchema: {
      type: "object",
      properties: {
        lessonId: { type: "string", description: "The UUID or slug of the lesson." },
        format: { type: "string", enum: ["text", "json", "outline"], description: "'text' (default) rendered markdown · 'json' raw sections/blocks · 'outline' numbered sections.blocks list (cheapest way to inspect a lesson)." },
      },
      required: ["lessonId"],
    },
  },
  {
    name: "list_recent_content",
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: "Retrieve recently published or updated public quizzes and lessons on Basmagi Platform.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "integer", description: "Number of recent items to return (1-50). Defaults to 15." },
        type: { type: "string", enum: ["all", "quizzes", "lessons"], description: "Filter by content type. Defaults to 'all'." },
      },
      required: [],
    },
  },
  {
    name: "get_platform_stats",
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: "Retrieve high-level platform statistics: total count of public quizzes, lessons, courses, folders, and colleges.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "get_prompts",
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: "Retrieve ready-to-use prompt templates for generating quizzes and lessons aligned with Basmagi specifications.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          enum: ["all", "general_purpose_quiz", "english_specializing", "math_specializing", "assistant_system_prompt"],
          description: "Name of the prompt template, or 'all'.",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "create_quiz_import_link",
    annotations: { title: "Create quiz (short import link)", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    description: "Validate a quiz and return ONE SHORT link (…/create-quiz?draft=CODE, valid 72h, no sign-in) that opens the Quiz Creator pre-filled. Nothing is published until the user saves in the editor. Returns ERRORS (nothing saved — fix and retry) or a link plus WARNINGS. Call get_authoring_guide(topic='quiz') first for the schema. Essay questions: give `answer` and NO options.",
    inputSchema: {
      type: "object",
      properties: {
        dry_run: { type: "boolean", description: "Validate only: return errors/warnings/stats and save NO draft." },
        title: { type: "string", description: "Quiz title" },
        description: { type: "string", description: "Quiz description" },
        source: { type: "string", description: "Direct URL/link to the source material (e.g. Google Drive link to lecture slides/PDF, video URL, or document link). MUST be a URL (https://...), NEVER plain text. Leave it empty if there is no link available." },
        questions: {
          type: "array",
          description: "Array of questions",
          items: {
            type: "object",
            properties: {
              q: { type: "string", description: "Question text" },
              options: { type: "array", items: { type: "string" }, description: "Choices for MCQ" },
              correct: {
                description: "Zero-based index of correct option (number) or array of numbers for multi-select",
                oneOf: [{ type: "integer" }, { type: "array", items: { type: "integer" } }],
              },
              multiSelect: { type: "boolean", description: "True if multiple choices are correct" },
              answer: { type: "string", description: "Model answer for open-ended / essay question" },
              explanation: { type: "string", description: "Educational explanation of the correct answer" },
            },
            required: ["q"],
          },
        },
      },
      required: ["title", "questions"],
    },
  },
  {
    name: "create_lesson_import_link",
    annotations: { title: "Create lesson (short import link)", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    description: "Validate a lesson and return ONE SHORT link (…/create-lesson?draft=CODE, valid 72h, no sign-in) that opens the Lesson Creator pre-filled. Nothing is published until the user saves. Returns ERRORS (nothing saved — fix and retry) or a link plus WARNINGS. Call get_authoring_guide(topic='lesson') first for block types and structure tips.",
    inputSchema: {
      type: "object",
      properties: {
        dry_run: { type: "boolean", description: "Validate only: return errors/warnings/stats and save NO draft." },
        title: { type: "string", description: "Lesson title (1-200 chars)." },
        description: { type: "string", description: "Short summary (max 1200 chars)." },
        source: { type: "string", description: "Direct URL/link to the source lecture, Drive folder, PDF, or recording (e.g. Google Drive link or web URL). MUST be a URL (https://...), NEVER plain text. Leave empty if no link is available." },
        sections: {
          type: "array",
          description: "Array of sections (1-60 sections)",
          items: {
            type: "object",
            properties: {
              title: { type: "string", description: "Section title" },
              defaultHidden: { type: "boolean", description: "Collapsed by default" },
              blocks: {
                type: "array",
                description: "Content blocks in this section",
                items: {
                  type: "object",
                  properties: {
                    type: { type: "string", enum: ["markdown", "media", "quizRef", "lesson-reference", "question"] },
                    body: { type: "string", description: "Markdown text for markdown blocks" },
                    url: { type: "string", description: "Media URL" },
                    kind: { type: "string", enum: ["image", "audio", "video"] },
                    alt: { type: "string" },
                    quizId: { type: "string" },
                    lessonId: { type: "string" },
                    questionKind: { type: "string", enum: ["mcq", "essay"] },
                    prompt: { type: "string" },
                    options: { type: "array", items: { type: "string" } },
                    correctIndex: { type: "integer" },
                    correctIndexes: { type: "array", items: { type: "integer" } },
                    multiSelect: { type: "boolean" },
                    modelAnswer: { type: "string" },
                    explanation: { type: "string" },
                  },
                  required: ["type"],
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
  {
    name: "get_import_draft",
    annotations: { title: "Read back a draft", readOnlyHint: true, openWorldHint: false },
    description: "Read a draft made by create_*_import_link / clone_to_draft (by the 10-char code or the full link). format 'outline' (default) = numbered, compact; 'json' = full content. Use it to get the numbers you need for update_import_draft, or to recover after losing context.",
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string", description: "Draft code or the full ?draft= link." },
        format: { type: "string", enum: ["outline", "json"] },
      },
      required: ["code"],
    },
  },
  {
    name: "update_import_draft",
    annotations: { title: "Edit a draft in place", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    description: "Edit an existing draft instead of re-sending it whole. The SAME link keeps working (expiry is renewed); the user just reloads/opens it again. Atomic: the whole patch is validated and, on any error, nothing changes. patch = { meta?: {title?, description?, source?}, ops?: [...] }. 1-based positions. Quiz ops: set_question{at,question} insert_question{at,question} append_questions{questions} delete_question{at} move_question{at,to}. Lesson ops: set_section/insert_section{at,section} append_sections{sections} delete_section{at} move_section{at,to}; set_block/insert_block{section,at,block} append_blocks{section,blocks} delete_block{section,at} move_block{section,at,to}. Both: replace_text{find,replace} (every string, e.g. fix a term everywhere). Questions/blocks use the same shape as the create tools.",
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string", description: "Draft code or the full ?draft= link." },
        patch: { type: "object", description: "{ meta?, ops? } — see tool description." },
      },
      required: ["code", "patch"],
    },
  },
  {
    name: "clone_to_draft",
    annotations: { title: "Copy an existing quiz/lesson into a draft", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    description: "Server-side copy of a PUBLIC quiz or lesson into a new editable draft (platform ids/paths/authors dropped). Use for translating, fixing, shortening, extending or making variants without re-sending the whole content: clone, then update_import_draft with only the changes. The original is never modified. Returns the short link + outline.",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["quiz", "lesson"] },
        id: { type: "string", description: "Quiz id / URL, or lesson id / slug." },
      },
      required: ["type", "id"],
    },
  },
  {
    name: "get_authoring_guide",
    annotations: { title: "Authoring guide for Claude", readOnlyHint: true, openWorldHint: false },
    description: "Read-me for creating quizzes and lessons: workflow, exact schemas, limits, quality rules and supported Markdown. Call once before create_quiz_import_link / create_lesson_import_link.",
    inputSchema: {
      type: "object",
      properties: {
        topic: { type: "string", enum: ["all", "workflow", "quiz", "lesson", "markdown"], description: "Defaults to 'all'." },
      },
    },
  },
  {
    name: "get_creator_info",
    annotations: { title: "About the creator & platform", readOnlyHint: true, openWorldHint: false },
    description: "Who built Basmagi and how to reach them: profile, all links (site, GitHub, YouTube, Upwork, Mostaql), contact (WhatsApp/Telegram/email), platform story & principles, tech stack, Telegram bot, useful pages. Use `section` to fetch only one part.",
    inputSchema: {
      type: "object",
      properties: {
        section: { type: "string", enum: ["all", "profile", "links", "contact", "platform", "pages"], description: "Defaults to 'all'." },
      },
    },
  },
];

// ── Tool Call Implementations ───────────────────────────────────────────────

async function handleSearchCatalog(args: { query: string; scope?: string }) {
  const query = (args?.query || "").trim();
  if (!query) return "الرجاء تحديد كلمة بحث صالحة.";

  const scope = args?.scope || "all";
  const searchPattern = `%${query}%`;
  const sections: string[] = [];

  if (scope === "all" || scope === "quizzes") {
    const safe = query.replace(/[,()%*]/g, " ").trim();
    const pat = `%${safe}%`;
    const { data: quizzes } = await supabase
      .from("quizzes")
      .select("id, data")
      .is("password", null)
      .or(`data->meta->>title.ilike.${pat},data->meta->>description.ilike.${pat},data->>title.ilike.${pat}`)
      .limit(30);

    if (quizzes) {
      const matched = quizzes.map((row: any) => ({ pk: row.id, ...row.data }));

      if (matched.length > 0) {
        const lines = matched.slice(0, 10).map((q: any) => {
          const id = q.meta?.id || q.id || q.pk || "unknown";
          const title = q.meta?.title || q.title || "امتحان بدون عنوان";
          const qCount = q.questions?.length || 0;
          return `  - 📝 [امتحان] ${title} (${qCount} أسئلة) — id: ${id}\n    رابط: https://basmagi-quiz.vercel.app/quiz/${id}`;
        });
        sections.push(`### امتحانات مطابقة (${matched.length}):\n${lines.join("\n")}`);
      }
    }
  }

  if (scope === "all" || scope === "lessons") {
    const { data: lessons } = await supabase
      .from("lesson_public")
      .select("id, slug, title, description")
      .or(`title.ilike.${searchPattern},description.ilike.${searchPattern}`)
      .limit(10);

    if (lessons && lessons.length > 0) {
      const lines = lessons.map((l: any) =>
        `  - 📖 [درس] ${l.title} — id: ${l.id}\n    رابط: https://basmagi-quiz.vercel.app/lesson/${l.slug || l.id}`
      );
      sections.push(`### دروس مطابقة (${lessons.length}):\n${lines.join("\n")}`);
    }
  }

  if (scope === "all" || scope === "courses") {
    const { data: courses } = await supabase
      .from("courses")
      .select("id, name, education_type, college, year, term")
      .or(`name.ilike.${searchPattern},college.ilike.${searchPattern}`)
      .limit(10);

    if (courses && courses.length > 0) {
      const lines = courses.map((c: any) => {
        const details = [c.education_type, c.college, c.year ? `سنة ${c.year}` : null].filter(Boolean).join(" | ");
        return `  - 🎓 [مادة] ${c.name} [${details}] — id: ${c.id}`;
      });
      sections.push(`### مواد دراسية مطابقة (${courses.length}):\n${lines.join("\n")}`);
    }
  }

  if (scope === "all" || scope === "folders") {
    const { data: folders } = await supabase
      .from("folders")
      .select("id, name, course_id")
      .ilike("name", searchPattern)
      .limit(10);

    if (folders && folders.length > 0) {
      const lines = folders.map((f: any) => `  - 📁 [مجلد] ${f.name} — id: ${f.id} (course_id: ${f.course_id})`);
      sections.push(`### مجلدات مطابقة (${folders.length}):\n${lines.join("\n")}`);
    }
  }

  if (sections.length === 0) return `لم يتم العثور على نتائج تطابق "${query}" في منصة بصمجي.`;
  return `# نتائج البحث عن "${query}":\n\n${sections.join("\n\n")}`;
}

async function handleListCourses(args: {
  education_type?: string;
  college?: string;
  year?: number;
  term?: number;
  limit?: number;
}) {
  const cap = Math.min(Math.max(1, args?.limit || 50), 100);
  let query = supabase
    .from("courses")
    .select("id, name, education_type, college, year, term")
    .limit(cap)
    .order("name", { ascending: true });

  if (args?.education_type) query = query.eq("education_type", args.education_type);
  if (args?.college) query = query.ilike("college", `%${args.college}%`);
  if (args?.year != null) query = query.eq("year", args.year);
  if (args?.term != null) query = query.eq("term", args.term);

  const { data, error } = await query;
  if (error || !data) return `تعذر استرداد قائمة المواد: ${error?.message || "خطأ غير معروف"}`;
  if (data.length === 0) return "لا توجد مواد دراسية تطابق الفلاتر المحددة.";

  const lines = data.map((c: any) => {
    const parts = [c.education_type];
    if (c.college) parts.push(c.college);
    if (c.year) parts.push(`سنة ${c.year}`);
    if (c.term) parts.push(`ترم ${c.term}`);
    return `- 🎓 ${c.name} [${parts.join(" | ")}]\n  id: ${c.id}`;
  });

  return `# المواد الدراسية في منصة بصمجي (${data.length}):\n\n${lines.join("\n\n")}`;
}

async function handleListColleges(args: { education_type?: string }) {
  let query = supabase
    .from("colleges")
    .select("id, name, education_type, year_count, terms, is_active")
    .order("name", { ascending: true });

  if (args?.education_type) {
    query = query.eq("education_type", args.education_type);
  }

  const { data, error } = await query;
  if (error || !data) return `تعذر استرداد قائمة الكليات: ${error?.message || "خطأ غير معروف"}`;
  if (data.length === 0) return "لا توجد كليات مسجلة.";

  const lines = data.map((c: any) => {
    const parts = [c.education_type];
    if (c.year_count) parts.push(`${c.year_count} سنوات`);
    if (c.terms) parts.push(`${c.terms} فصول دراسية`);
    return `- 🏛️ ${c.name} [${parts.join(" | ")}] (id: ${c.id})`;
  });

  return `# قائمة الكليات والمؤسسات التعليمية (${data.length}):\n\n${lines.join("\n")}`;
}

async function handleGetCourseContents(args: {
  courseId: string;
  recursive?: boolean;
  include_quizzes?: boolean;
  include_lessons?: boolean;
  format?: string;
}) {
  const courseId = (args?.courseId || "").trim();
  if (!courseId) return "الرجاء تحديد معرف المادة (courseId).";

  const recursive = Boolean(args?.recursive);
  const includeQuizzes = args?.include_quizzes !== false;
  const includeLessons = args?.include_lessons !== false;
  const isJson = args?.format === "json";

  const { data: course, error: courseErr } = await supabase
    .from("courses")
    .select("id, name, education_type, college, year, term")
    .eq("id", courseId)
    .maybeSingle();

  if (courseErr || !course) return `لم يتم العثور على مادة بالمعرف "${courseId}".`;

  if (recursive) {
    // ── Recursive Retrieval: Fetch all folders, quizzes, and lessons for the whole course ──
    const [foldersRes, quizzesRes, lessonsRes] = await Promise.all([
      supabase.from("folders").select("id, name, parent_folder_id").eq("course_id", courseId).order("name", { ascending: true }),
      includeQuizzes
        ? supabase.from("quizzes").select("id, data, folder_id").eq("course_id", courseId).is("password", null)
        : Promise.resolve({ data: [] }),
      includeLessons
        ? supabase.from("lesson_public").select("id, slug, title, folder_id, password_protected, section_count").eq("course_id", courseId)
        : Promise.resolve({ data: [] }),
    ]);

    const allFolders = foldersRes.data || [];
    const allQuizzes = quizzesRes.data || [];
    const allLessons = lessonsRes.data || [];

    // Map folder paths
    const folderMap = new Map<string, any>(allFolders.map((f: any) => [f.id, f]));
    const getFolderPath = (folderId: string): string => {
      const parts: string[] = [];
      let curr = folderMap.get(folderId);
      const visited = new Set<string>();
      while (curr && !visited.has(curr.id)) {
        visited.add(curr.id);
        parts.unshift(curr.name);
        curr = curr.parent_folder_id ? folderMap.get(curr.parent_folder_id) : null;
      }
      return parts.join(" / ");
    };

    if (isJson) {
      return JSON.stringify({
        course,
        totalFolders: allFolders.length,
        totalQuizzes: allQuizzes.length,
        totalLessons: allLessons.length,
        folders: allFolders.map((f: any) => ({ ...f, path: getFolderPath(f.id) })),
        quizzes: allQuizzes.map((q: any) => {
          const m = q.data?.meta || {};
          return {
            id: m.id || q.id,
            title: m.title || "امتحان بدون عنوان",
            folder_id: q.folder_id,
            folder_path: q.folder_id ? getFolderPath(q.folder_id) : "جذر المادة (Root)",
            questionCount: q.data?.questions?.length || 0,
            url: `https://basmagi-quiz.vercel.app/quiz/${m.id || q.id}`,
          };
        }),
        lessons: allLessons.map((l: any) => ({
          ...l,
          folder_path: l.folder_id ? getFolderPath(l.folder_id) : "جذر المادة (Root)",
          url: `https://basmagi-quiz.vercel.app/lesson/${l.slug || l.id}`,
        })),
      }, null, 2);
    }

    // Markdown summary
    const parts = [course.education_type, course.college, course.year ? `سنة ${course.year}` : null, course.term ? `ترم ${course.term}` : null].filter(Boolean);
    const output: string[] = [
      `# 🎓 فهرس شامل لمادة: ${course.name}\n[${parts.join(" | ")}]\nID: ${courseId}\nإجمالي المجلدات: ${allFolders.length} | إجمالي الامتحانات: ${allQuizzes.length} | إجمالي الدروس: ${allLessons.length}`,
    ];

    // Root items (folder_id is null)
    const rootQuizzes = allQuizzes.filter((q: any) => !q.folder_id);
    const rootLessons = allLessons.filter((l: any) => !l.folder_id);

    if (rootQuizzes.length > 0 || rootLessons.length > 0) {
      const rootLines: string[] = [];
      for (const q of rootQuizzes) {
        const m = q.data?.meta || {};
        const id = m.id || q.id;
        rootLines.push(`  - 📝 ${m.title || "امتحان"} (${q.data?.questions?.length || 0} أسئلة) — id: ${id} — https://basmagi-quiz.vercel.app/quiz/${id}`);
      }
      for (const l of rootLessons) {
        const lock = l.password_protected ? " 🔒" : "";
        rootLines.push(`  - 📖 ${l.title}${lock} (${l.section_count || 0} أقسام) — id: ${l.id} — https://basmagi-quiz.vercel.app/lesson/${l.slug || l.id}`);
      }
      output.push(`## 📂 محتويات جذر المادة (مباشرة):\n${rootLines.join("\n")}`);
    }

    // Group items by folder
    if (allFolders.length > 0) {
      output.push(`## 📁 المحتويات داخل المجلدات (${allFolders.length} مجلد):`);
      for (const f of allFolders) {
        const pathStr = getFolderPath(f.id);
        const fQuizzes = allQuizzes.filter((q: any) => q.folder_id === f.id);
        const fLessons = allLessons.filter((l: any) => l.folder_id === f.id);

        const itemLines: string[] = [];
        for (const q of fQuizzes) {
          const m = q.data?.meta || {};
          const id = m.id || q.id;
          itemLines.push(`    - 📝 ${m.title || "امتحان"} (${q.data?.questions?.length || 0} أسئلة) — id: ${id} — https://basmagi-quiz.vercel.app/quiz/${id}`);
        }
        for (const l of fLessons) {
          const lock = l.password_protected ? " 🔒" : "";
          itemLines.push(`    - 📖 ${l.title}${lock} (${l.section_count || 0} أقسام) — id: ${l.id} — https://basmagi-quiz.vercel.app/lesson/${l.slug || l.id}`);
        }

        const countBadge = `[${fQuizzes.length} امتحان، ${fLessons.length} درس]`;
        if (itemLines.length > 0) {
          output.push(`### 📁 ${pathStr} ${countBadge}\nID: ${f.id}\n${itemLines.join("\n")}`);
        } else {
          output.push(`### 📁 ${pathStr} [فارغ]\nID: ${f.id}`);
        }
      }
    }

    return output.join("\n\n");
  }

  // ── Non-recursive: direct children only ──
  const parts = [course.education_type, course.college, course.year ? `سنة ${course.year}` : null, course.term ? `ترم ${course.term}` : null].filter(Boolean);
  const output: string[] = [`# 🎓 محتوى مادة: ${course.name}\n[${parts.join(" | ")}]\nID: ${courseId}`];

  const [foldersRes, quizzesRes, lessonsRes] = await Promise.all([
    supabase.from("folders").select("id, name").eq("course_id", courseId).is("parent_folder_id", null).order("name", { ascending: true }),
    includeQuizzes
      ? supabase.from("quizzes").select("id, data").eq("course_id", courseId).is("folder_id", null).is("password", null).limit(50)
      : Promise.resolve({ data: [] }),
    includeLessons
      ? supabase.from("lesson_public").select("id, slug, title, password_protected, section_count").eq("course_id", courseId).is("folder_id", null).limit(50)
      : Promise.resolve({ data: [] }),
  ]);

  const folders = foldersRes.data || [];
  const quizzes = quizzesRes.data || [];
  const lessons = lessonsRes.data || [];

  if (isJson) {
    return JSON.stringify({
      course,
      folders,
      quizzes: quizzes.map((q: any) => ({
        id: q.data?.meta?.id || q.id,
        title: q.data?.meta?.title || "امتحان بدون عنوان",
        questionCount: q.data?.questions?.length || 0,
        url: `https://basmagi-quiz.vercel.app/quiz/${q.data?.meta?.id || q.id}`,
      })),
      lessons: lessons.map((l: any) => ({
        ...l,
        url: `https://basmagi-quiz.vercel.app/lesson/${l.slug || l.id}`,
      })),
    }, null, 2);
  }

  if (folders.length > 0) {
    const lines = folders.map((f: any) => `  - 📁 ${f.name}\n    id: ${f.id}\n    (استخدم get_folder_contents لعرض محتوياته)`);
    output.push(`## المجلدات الرئيسية (${folders.length}):\n\n${lines.join("\n\n")}`);
  } else {
    output.push("## المجلدات الرئيسية\nلا توجد مجلدات رئيسية.");
  }

  if (quizzes.length > 0) {
    const lines = quizzes.map((q: any) => {
      const meta = q.data?.meta || {};
      const id = meta.id || q.id || "unknown";
      const title = meta.title || "امتحان بدون عنوان";
      const qCount = q.data?.questions?.length || 0;
      return `  - 📝 ${title} (${qCount} أسئلة)\n    id: ${id}\n    https://basmagi-quiz.vercel.app/quiz/${id}`;
    });
    output.push(`## الامتحانات المباشرة (${quizzes.length}):\n\n${lines.join("\n\n")}`);
  }

  if (lessons.length > 0) {
    const lines = lessons.map((l: any) => {
      const lock = l.password_protected ? " 🔒" : "";
      return `  - 📖 ${l.title}${lock} (${l.section_count || 0} أقسام)\n    id: ${l.id}\n    https://basmagi-quiz.vercel.app/lesson/${l.slug || l.id}`;
    });
    output.push(`## الدروس المباشرة (${lessons.length}):\n\n${lines.join("\n\n")}`);
  }

  output.push("💡 *ملاحظة: لجلب جميع الامتحانات والدروس داخل كل المجلدات المتفرعة في هذه المادة دفعة واحدة، مرر recursive: true.*");
  return output.join("\n\n");
}

async function handleGetFolderContents(args: {
  folderId: string;
  recursive?: boolean;
  include_quizzes?: boolean;
  include_lessons?: boolean;
  format?: string;
}) {
  const folderId = (args?.folderId || "").trim();
  if (!folderId) return "الرجاء تحديد معرف المجلد (folderId).";

  const recursive = Boolean(args?.recursive);
  const includeQuizzes = args?.include_quizzes !== false;
  const includeLessons = args?.include_lessons !== false;
  const isJson = args?.format === "json";

  const { data: folder, error: folderErr } = await supabase
    .from("folders")
    .select("id, name, course_id, parent_folder_id")
    .eq("id", folderId)
    .maybeSingle();

  if (folderErr || !folder) return `لم يتم العثور على مجلد بالمعرف "${folderId}".`;

  if (recursive) {
    // ── Recursive: fetch all descendants ──
    const { data: courseFolders } = await supabase
      .from("folders")
      .select("id, name, parent_folder_id")
      .eq("course_id", folder.course_id);

    const allFolders = courseFolders || [];
    const childrenMap = new Map<string, any[]>();
    for (const f of allFolders) {
      const pid = f.parent_folder_id;
      if (pid) {
        if (!childrenMap.has(pid)) childrenMap.set(pid, []);
        childrenMap.get(pid)!.push(f);
      }
    }

    // BFS to find all descendants
    const descendantFolders: any[] = [];
    const descendantIds = new Set<string>([folderId]);
    const queue = [folderId];
    while (queue.length > 0) {
      const currId = queue.shift()!;
      const kids = childrenMap.get(currId) || [];
      for (const k of kids) {
        if (!descendantIds.has(k.id)) {
          descendantIds.add(k.id);
          descendantFolders.push(k);
          queue.push(k.id);
        }
      }
    }

    const folderIdArray = Array.from(descendantIds);
    const [quizzesRes, lessonsRes] = await Promise.all([
      includeQuizzes
        ? supabase.from("quizzes").select("id, data, folder_id").in("folder_id", folderIdArray).is("password", null)
        : Promise.resolve({ data: [] }),
      includeLessons
        ? supabase.from("lesson_public").select("id, slug, title, folder_id, password_protected, section_count").in("folder_id", folderIdArray)
        : Promise.resolve({ data: [] }),
    ]);

    const allQuizzes = quizzesRes.data || [];
    const allLessons = lessonsRes.data || [];

    if (isJson) {
      return JSON.stringify({
        folder,
        totalSubfolders: descendantFolders.length,
        totalQuizzes: allQuizzes.length,
        totalLessons: allLessons.length,
        subfolders: descendantFolders,
        quizzes: allQuizzes.map((q: any) => ({
          id: q.data?.meta?.id || q.id,
          title: q.data?.meta?.title || "امتحان بدون عنوان",
          folder_id: q.folder_id,
          questionCount: q.data?.questions?.length || 0,
          url: `https://basmagi-quiz.vercel.app/quiz/${q.data?.meta?.id || q.id}`,
        })),
        lessons: allLessons.map((l: any) => ({
          ...l,
          url: `https://basmagi-quiz.vercel.app/lesson/${l.slug || l.id}`,
        })),
      }, null, 2);
    }

    const output: string[] = [
      `# 📁 محتوى مجلد شامل: ${folder.name}\nID: ${folderId} | المادة: ${folder.course_id}\nإجمالي المجلدات الفرعية: ${descendantFolders.length} | إجمالي الامتحانات: ${allQuizzes.length} | إجمالي الدروس: ${allLessons.length}`,
    ];

    // Current folder direct items
    const directQuizzes = allQuizzes.filter((q: any) => q.folder_id === folderId);
    const directLessons = allLessons.filter((l: any) => l.folder_id === folderId);

    if (directQuizzes.length > 0 || directLessons.length > 0) {
      const lines: string[] = [];
      for (const q of directQuizzes) {
        const m = q.data?.meta || {};
        const id = m.id || q.id;
        lines.push(`  - 📝 ${m.title || "امتحان"} (${q.data?.questions?.length || 0} أسئلة) — id: ${id} — https://basmagi-quiz.vercel.app/quiz/${id}`);
      }
      for (const l of directLessons) {
        const lock = l.password_protected ? " 🔒" : "";
        lines.push(`  - 📖 ${l.title}${lock} (${l.section_count || 0} أقسام) — id: ${l.id} — https://basmagi-quiz.vercel.app/lesson/${l.slug || l.id}`);
      }
      output.push(`## 📂 محتويات المجلد مباشرة (${folder.name}):\n${lines.join("\n")}`);
    }

    // Subfolders items
    if (descendantFolders.length > 0) {
      output.push(`## 📁 المجلدات الفرعية المتفرعة (${descendantFolders.length}):`);
      for (const sub of descendantFolders) {
        const subQuizzes = allQuizzes.filter((q: any) => q.folder_id === sub.id);
        const subLessons = allLessons.filter((l: any) => l.folder_id === sub.id);

        const lines: string[] = [];
        for (const q of subQuizzes) {
          const m = q.data?.meta || {};
          const id = m.id || q.id;
          lines.push(`    - 📝 ${m.title || "امتحان"} (${q.data?.questions?.length || 0} أسئلة) — id: ${id} — https://basmagi-quiz.vercel.app/quiz/${id}`);
        }
        for (const l of subLessons) {
          const lock = l.password_protected ? " 🔒" : "";
          lines.push(`    - 📖 ${l.title}${lock} (${l.section_count || 0} أقسام) — id: ${l.id} — https://basmagi-quiz.vercel.app/lesson/${l.slug || l.id}`);
        }

        const badge = `[${subQuizzes.length} امتحان، ${subLessons.length} درس]`;
        if (lines.length > 0) {
          output.push(`### 📁 ${sub.name} ${badge}\nID: ${sub.id}\n${lines.join("\n")}`);
        } else {
          output.push(`### 📁 ${sub.name} [فارغ]\nID: ${sub.id}`);
        }
      }
    }

    return output.join("\n\n");
  }

  // ── Non-recursive: immediate children only ──
  const output: string[] = [`# 📁 محتوى المجلد: ${folder.name}\nID: ${folderId}\nالمادة (course_id): ${folder.course_id}`];

  const [subFoldersRes, quizzesRes, lessonsRes] = await Promise.all([
    supabase.from("folders").select("id, name").eq("parent_folder_id", folderId).order("name", { ascending: true }),
    includeQuizzes
      ? supabase.from("quizzes").select("id, data").eq("folder_id", folderId).is("password", null).limit(50)
      : Promise.resolve({ data: [] }),
    includeLessons
      ? supabase.from("lesson_public").select("id, slug, title, password_protected, section_count").eq("folder_id", folderId).limit(50)
      : Promise.resolve({ data: [] }),
  ]);

  const subFolders = subFoldersRes.data || [];
  const quizzes = quizzesRes.data || [];
  const lessons = lessonsRes.data || [];

  if (isJson) {
    return JSON.stringify({
      folder,
      subFolders,
      quizzes: quizzes.map((q: any) => ({
        id: q.data?.meta?.id || q.id,
        title: q.data?.meta?.title || "امتحان بدون عنوان",
        questionCount: q.data?.questions?.length || 0,
        url: `https://basmagi-quiz.vercel.app/quiz/${q.data?.meta?.id || q.id}`,
      })),
      lessons: lessons.map((l: any) => ({
        ...l,
        url: `https://basmagi-quiz.vercel.app/lesson/${l.slug || l.id}`,
      })),
    }, null, 2);
  }

  if (subFolders.length > 0) {
    const lines = subFolders.map((f: any) => `  - 📁 ${f.name}\n    id: ${f.id}\n    (استخدم get_folder_contents لعرض محتوياته)`);
    output.push(`## المجلدات الفرعية (${subFolders.length}):\n\n${lines.join("\n\n")}`);
  } else {
    output.push("## المجلدات الفرعية\nلا توجد مجلدات فرعية مباشرة.");
  }

  if (quizzes.length > 0) {
    const quizLines = quizzes.map((q: any) => {
      const meta = q.data?.meta || {};
      const id = meta.id || q.id || "unknown";
      const title = meta.title || "امتحان بدون عنوان";
      const qCount = q.data?.questions?.length || 0;
      return `  - 📝 ${title} (${qCount} أسئلة)\n    id: ${id}\n    https://basmagi-quiz.vercel.app/quiz/${id}`;
    });
    output.push(`## الامتحانات (${quizzes.length}):\n\n${quizLines.join("\n\n")}`);
  }

  if (lessons.length > 0) {
    const lines = lessons.map((l: any) => {
      const lock = l.password_protected ? " 🔒" : "";
      return `  - 📖 ${l.title}${lock} (${l.section_count || 0} أقسام)\n    id: ${l.id}\n    https://basmagi-quiz.vercel.app/lesson/${l.slug || l.id}`;
    });
    output.push(`## الدروس (${lessons.length}):\n\n${lines.join("\n\n")}`);
  }

  output.push("💡 *ملاحظة: لجلب جميع الامتحانات والدروس داخل كل المجلدات المتفرعة تحت هذا المجلد، مرر recursive: true.*");
  return output.join("\n\n");
}

async function handleListFolderTree(args: { courseId: string }) {
  const courseId = (args?.courseId || "").trim();
  if (!courseId) return "الرجاء تحديد معرف المادة (courseId).";

  const { data: course, error: cErr } = await supabase
    .from("courses")
    .select("id, name")
    .eq("id", courseId)
    .maybeSingle();

  if (cErr || !course) return `لم يتم العثور على مادة بالمعرف "${courseId}".`;

  const { data: allFolders, error } = await supabase
    .from("folders")
    .select("id, name, parent_folder_id")
    .eq("course_id", courseId)
    .order("name", { ascending: true })
    .limit(500);

  if (error) return `تعذر استرداد مجلدات المادة: ${error.message}`;
  if (!allFolders || allFolders.length === 0) return `# شجرة مجلدات: ${course.name}\n\nلا توجد مجلدات في هذه المادة.`;

  const childrenMap = new Map<string | null, any[]>();
  for (const f of allFolders) {
    const key = f.parent_folder_id || null;
    if (!childrenMap.has(key)) childrenMap.set(key, []);
    childrenMap.get(key)!.push(f);
  }

  const [{ data: quizCounts }, { data: lessonCounts }] = await Promise.all([
    supabase.from("quizzes").select("folder_id").eq("course_id", courseId).is("password", null),
    supabase.from("lesson_public").select("folder_id").eq("course_id", courseId),
  ]);

  const quizCountMap = new Map<string, number>();
  for (const q of quizCounts || []) {
    if (q.folder_id) quizCountMap.set(q.folder_id, (quizCountMap.get(q.folder_id) || 0) + 1);
  }
  const lessonCountMap = new Map<string, number>();
  for (const l of lessonCounts || []) {
    if (l.folder_id) lessonCountMap.set(l.folder_id, (lessonCountMap.get(l.folder_id) || 0) + 1);
  }

  function renderTree(parentId: string | null, depth: number): string[] {
    const children = childrenMap.get(parentId) || [];
    const lines: string[] = [];
    const indent = "  ".repeat(depth);
    for (const f of children) {
      const qc = quizCountMap.get(f.id) || 0;
      const lc = lessonCountMap.get(f.id) || 0;
      const counts = [qc > 0 ? `${qc} امتحان` : null, lc > 0 ? `${lc} درس` : null].filter(Boolean).join("، ");
      lines.push(`${indent}📁 ${f.name}${counts ? ` (${counts})` : ""}\n${indent}   id: ${f.id}`);
      lines.push(...renderTree(f.id, depth + 1));
    }
    return lines;
  }

  return `# شجرة مجلدات: ${course.name}\nID: ${courseId} | إجمالي المجلدات: ${allFolders.length}\n\n${renderTree(null, 0).join("\n")}`;
}

async function fetchQuizData(quizId: string): Promise<any | null> {
  let quizData: any = null;

  // Try fast JSONB filter first (data->meta->>id)
  const { data: byMetaId } = await supabase
    .from("quizzes")
    .select("data")
    .is("password", null)
    .filter("data->meta->>id", "eq", quizId)
    .limit(1)
    .maybeSingle();

  if (byMetaId) {
    quizData = byMetaId.data;
  } else {
    // Fallback to primary key UUID
    const { data: byPk } = await supabase
      .from("quizzes")
      .select("data")
      .is("password", null)
      .eq("id", quizId)
      .maybeSingle();
    if (byPk) quizData = byPk.data;
  }

  return quizData;
}

async function handleGetQuiz(args: { quizId: string; format?: string }) {
  const quizId = (args?.quizId || "").trim();
  if (!quizId) return "الرجاء تحديد معرف الامتحان المطلوب (quizId).";

  const quizData: any = await fetchQuizData(quizId);

  if (!quizData) return `لم يتم العثور على امتحان بالمعرف "${quizId}" (أو قد يكون محمياً بكلمة مرور).`;

  if (args?.format === "json") {
    return JSON.stringify(quizData, null, 2);
  }
  if (args?.format === "outline") {
    return `${outlineQuiz(quizData)}\n\nالمسار: ${quizData.meta?.path || "—"}\nالرابط: ${SITE}/quiz/${quizData.meta?.id || quizId}`;
  }

  const title = quizData.meta?.title || quizData.title || "امتحان";
  const desc = quizData.meta?.description || quizData.description || "";
  const source = quizData.meta?.source || quizData.source || "";
  const questions = quizData.questions || [];

  const formattedQuestions = questions.map((item: any, idx: number) => {
    const opts = (item.options || [])
      .map((opt: string, oIdx: number) => `    ${oIdx}) ${opt}`)
      .join("\n");
    const correct = Array.isArray(item.correct)
      ? item.correct.join(", ")
      : item.correct !== undefined
      ? item.correct
      : "(غير محدد)";
    return `${idx + 1}. ${item.q}\n${opts ? opts + "\n" : ""}   الإجابة الصحيحة: ${correct}${item.explanation ? `\n   التفسير: ${item.explanation}` : ""}${item.answer ? `\n   نموذج الإجابة: ${item.answer}` : ""}`;
  });

  const id = quizData.meta?.id || quizId;
  const sourceLine = source ? `المصدر: ${source}\n` : "";
  return `# 📝 ${title}\n${desc ? desc + "\n\n" : "\n"}${sourceLine}عدد الأسئلة: ${questions.length}\nالرابط المباشر: https://basmagi-quiz.vercel.app/quiz/${id}\n\n${formattedQuestions.join("\n\n")}`;
}

async function handleGetQuizByUrl(args: { url_or_id: string; format?: string }) {
  const raw = (args?.url_or_id || "").trim();
  if (!raw) return "الرجاء تحديد رابط الامتحان أو معرفه.";

  let quizId = raw;
  const urlMatch = raw.match(/\/(?:quiz|q)\/([^/?#]+)/);
  if (urlMatch) quizId = decodeURIComponent(urlMatch[1]);

  return handleGetQuiz({ quizId, format: args?.format });
}

async function handleGetLesson(args: { lessonId: string }) {
  const lessonId = (args?.lessonId || "").trim();
  if (!lessonId) return "الرجاء تحديد معرف الدرس (lessonId).";

  const { data, error } = await supabase
    .from("lesson_public")
    .select("id, slug, title, description, source, section_count, password_protected, created_at, updated_at")
    .or(`id.eq.${lessonId},slug.eq.${lessonId}`)
    .maybeSingle();

  if (error || !data) return `لم يتم العثور على الدرس بالمعرف "${lessonId}".`;

  const protectedNote = data.password_protected ? "\n⚠️ هذا الدرس محمي بكلمة مرور." : "";

  return `# 📖 ${data.title}\n\n${data.description || ""}\n\nالمصدر: ${data.source || "منصة بصمجي"}\nعدد الأقسام: ${data.section_count ?? "غير محدد"}${protectedNote}\n\n💡 *للحصول على المحتوى الكامل للدرس، استخدم get_lesson_content.*\nرابط الدرس: https://basmagi-quiz.vercel.app/lesson/${data.slug || data.id}`;
}

async function handleGetLessonContent(args: { lessonId: string; format?: string }) {
  const lessonId = (args?.lessonId || "").trim();
  if (!lessonId) return "الرجاء تحديد معرف الدرس (lessonId).";

  const { data, error } = await supabase
    .from("lesson_public")
    .select("id, slug, title, description, source, content, password_protected")
    .or(`id.eq.${lessonId},slug.eq.${lessonId}`)
    .maybeSingle();

  if (error || !data) return `لم يتم العثور على الدرس بالمعرف "${lessonId}".`;

  const lessonUrl = `https://basmagi-quiz.vercel.app/lesson/${data.slug || data.id}`;

  if (data.password_protected) {
    return `# ${data.title}\n\n⚠️ هذا الدرس محمي بكلمة مرور ولا يمكن عرض محتواه.\nرابط الدرس: ${lessonUrl}`;
  }

  if (!data.content) return `# ${data.title}\n\nلا يوجد محتوى متاح لهذا الدرس.\nرابط الدرس: ${lessonUrl}`;

  if (args?.format === "outline") {
    return outlineLesson({ ...data.content, title: data.title, description: data.description, source: data.source });
  }

  if (args?.format === "json") {
    return JSON.stringify({
      id: data.id,
      slug: data.slug,
      title: data.title,
      description: data.description,
      source: data.source,
      content: data.content,
      url: lessonUrl,
    }, null, 2);
  }

  const content = data.content;
  const renderedSections: string[] = [];

  if (Array.isArray(content.sections)) {
    for (const [sIdx, section] of content.sections.entries()) {
      const secTitle = section.title || `قسم ${sIdx + 1}`;
      const hiddenNote = section.defaultHidden ? " (مخفي افتراضياً)" : "";
      const blockLines: string[] = [];

      if (Array.isArray(section.blocks)) {
        for (const block of section.blocks) {
          if (!block) continue;
          if (block.type === "markdown") {
            blockLines.push(block.body || "");
          } else if (block.type === "media") {
            blockLines.push(`[${block.kind || "media"}: ${block.url}${block.alt ? ` - ${block.alt}` : ""}]`);
          } else if (block.type === "question") {
            if (block.questionKind === "essay") {
              blockLines.push(`❓ سؤال مقالي: ${block.prompt}\n   الإجابة: ${block.modelAnswer || ""}${block.explanation ? `\n   التفسير: ${block.explanation}` : ""}`);
            } else {
              const opts = (block.options || []).map((o: string, i: number) => `    ${i}) ${o}`).join("\n");
              const correctIdx = Array.isArray(block.correctIndexes)
                ? block.correctIndexes.join(", ")
                : block.correctIndex != null ? block.correctIndex : "?";
              blockLines.push(`❓ سؤال اختياري: ${block.prompt}\n${opts}\n   الإجابة الصحيحة: ${correctIdx}${block.explanation ? `\n   التفسير: ${block.explanation}` : ""}`);
            }
          } else if (block.type === "quizRef") {
            blockLines.push(`[مرجع امتحان: id=${block.quizId}${block.title ? ` - ${block.title}` : ""}]`);
          } else if (block.type === "lesson-reference" || block.type === "lessonRef") {
            blockLines.push(`[مرجع درس: id=${block.lessonId}${block.title ? ` - ${block.title}` : ""}]`);
          }
        }
      } else if (typeof section.content === "string") {
        blockLines.push(section.content);
      }

      renderedSections.push(`### ${secTitle}${hiddenNote}\n\n${blockLines.join("\n\n")}`);
    }
  } else if (typeof content === "string") {
    renderedSections.push(content);
  }

  const body = renderedSections.length > 0 ? renderedSections.join("\n\n---\n\n") : "(لا يوجد محتوى في الأقسام)";
  return `# 📖 ${data.title}\n\n${data.description ? data.description + "\n\n" : ""}المصدر: ${data.source || "منصة بصمجي"}\nرابط الدرس: ${lessonUrl}\n\n${body}`;
}

async function handleListRecentContent(args: { limit?: number; type?: string }) {
  const cap = Math.min(Math.max(1, args?.limit || 15), 50);
  const type = args?.type || "all";
  const output: string[] = ["# أحدث المحتويات المضافة في منصة بصمجي:"];

  if (type === "all" || type === "quizzes") {
    const { data: quizzes } = await supabase
      .from("quizzes")
      .select("id, data, created_at")
      .is("password", null)
      .order("created_at", { ascending: false })
      .limit(cap);

    if (quizzes && quizzes.length > 0) {
      const lines = quizzes.map((q: any) => {
        const m = q.data?.meta || {};
        const id = m.id || q.id;
        const title = m.title || "امتحان بدون عنوان";
        const date = q.created_at ? new Date(q.created_at).toLocaleDateString("ar-EG") : "";
        return `- 📝 ${title} (${q.data?.questions?.length || 0} أسئلة) ${date ? `[${date}]` : ""}\n  id: ${id} — https://basmagi-quiz.vercel.app/quiz/${id}`;
      });
      output.push(`## أحدث الامتحانات:\n${lines.join("\n")}`);
    }
  }

  if (type === "all" || type === "lessons") {
    const { data: lessons } = await supabase
      .from("lesson_public")
      .select("id, slug, title, created_at, section_count, password_protected")
      .order("created_at", { ascending: false })
      .limit(cap);

    if (lessons && lessons.length > 0) {
      const lines = lessons.map((l: any) => {
        const lock = l.password_protected ? " 🔒" : "";
        const date = l.created_at ? new Date(l.created_at).toLocaleDateString("ar-EG") : "";
        return `- 📖 ${l.title}${lock} (${l.section_count || 0} أقسام) ${date ? `[${date}]` : ""}\n  id: ${l.id} — https://basmagi-quiz.vercel.app/lesson/${l.slug || l.id}`;
      });
      output.push(`## أحدث الدروس:\n${lines.join("\n")}`);
    }
  }

  return output.join("\n\n");
}

async function handleGetPlatformStats() {
  const [coursesCount, foldersCount, quizzesCount, lessonsCount, collegesCount] = await Promise.all([
    supabase.from("courses").select("*", { count: "exact", head: true }),
    supabase.from("folders").select("*", { count: "exact", head: true }),
    supabase.from("quizzes").select("*", { count: "exact", head: true }).is("password", null),
    supabase.from("lesson_public").select("*", { count: "exact", head: true }),
    supabase.from("colleges").select("*", { count: "exact", head: true }),
  ]);

  return `# 📊 إحصائيات منصة بصمجي التعليمية:
- 🎓 إجمالي المواد الدراسية: ${coursesCount.count ?? "غير متوفر"}
- 📁 إجمالي المجلدات: ${foldersCount.count ?? "غير متوفر"}
- 📝 إجمالي الامتحانات العامة: ${quizzesCount.count ?? "غير متوفر"}
- 📖 إجمالي الدروس العامة: ${lessonsCount.count ?? "غير متوفر"}
- 🏛️ إجمالي الكليات والمؤسسات: ${collegesCount.count ?? "غير متوفر"}

المنصة مجانية ومفتوحة لجميع الطلاب والمعلمين: https://basmagi-quiz.vercel.app`;
}

function handleGetPrompts(args: { name: string }) {
  const target = (args?.name || "all").trim();
  if (target === "all") {
    return Object.entries(PROMPTS_REGISTRY)
      .map(([key, val]) => `=== [${key}] ===\nالوصف: ${val.description}\n\n${val.text}`)
      .join("\n\n------------------------------------\n\n");
  }
  const prompt = PROMPTS_REGISTRY[target];
  if (!prompt) return `القالب "${target}" غير موجود. القوالب المتاحة:\n- ${Object.keys(PROMPTS_REGISTRY).join("\n- ")}`;
  return `=== [${target}] ===\nالوصف: ${prompt.description}\n\n${prompt.text}`;
}

function formatIssues(what: string, v: { errors: string[]; warnings: string[] }) {
  const lines: string[] = [];
  if (v.errors.length) lines.push(`❌ لم يُحفظ شيء — ${what} يحتوي على ${v.errors.length} خطأ. صحّحها وأعد الاستدعاء:\n` + v.errors.map((e) => `  - ${e}`).join("\n"));
  if (v.warnings.length) lines.push(`⚠️ تنبيهات:\n` + v.warnings.map((w) => `  - ${w}`).join("\n"));
  return lines.join("\n\n");
}

function base64Link(kind: "quiz" | "lesson", data: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  const binary = Array.from(bytes, (b) => String.fromCharCode(b)).join("");
  const b64 = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_");
  return `${SITE}/create-${kind}#data=base64,${b64}`;
}

// Stores the validated payload and returns the short link (or a base64 fallback).
async function saveDraft(kind: "quiz" | "lesson", data: unknown): Promise<{ url: string; short: boolean }> {
  try {
    const nowIso = new Date().toISOString();
    await supabase.from("import_drafts").delete().lt("expires_at", nowIso); // opportunistic cleanup
    const { count } = await supabase.from("import_drafts").select("*", { count: "exact", head: true });
    if ((count ?? 0) > 5000) throw new Error("draft store is full");
    for (let attempt = 0; attempt < 3; attempt++) {
      const code = makeDraftCode();
      const { error } = await supabase.from("import_drafts").insert({
        code, kind, payload: data,
        expires_at: new Date(Date.now() + DRAFT_TTL_HOURS * 3600_000).toISOString(),
      });
      if (!error) return { url: draftUrl(kind, code), short: true };
      if (error.code !== "23505") throw error; // 23505 = code collision → retry
    }
  } catch (_) { /* fall through */ }
  return { url: base64Link(kind, data), short: false };
}

async function handleCreateQuizImportLink(args: any) {
  const v = validateQuiz(args);
  if (!v.ok) return formatIssues("الامتحان", v);
  if (args?.dry_run) return [`✅ (تجربة فقط — لم يُحفظ شيء) الامتحان صالح: ${JSON.stringify(v.stats)}`, formatIssues("الامتحان", v)].filter(Boolean).join("\n\n");
  const { url, short } = await saveDraft("quiz", v.data);
  const s = v.stats!;
  const head = `✅ تم التحقق من الامتحان: ${s.questions} سؤال (اختيار فردي ${s.mcq} · متعدد ${s.multiSelect} · مقالي ${s.essay}).`;
  const how = short
    ? `🔗 رابط قصير صالح ${DRAFT_TTL_HOURS} ساعة (بلا تسجيل دخول). يفتح محرر الامتحان معبّأً؛ لن يُنشر شيء قبل أن يحفظه المستخدم:\n${url}`
    : `🔗 تعذّر إنشاء رابط قصير فاستُخدم رابط الاستيراد الطويل (انسخه كاملاً دون تعديل):\n${url}`;
  return [head, how, formatIssues("الامتحان", v)].filter(Boolean).join("\n\n");
}

async function handleCreateLessonImportLink(args: any) {
  const v = validateLesson(args);
  if (!v.ok) return formatIssues("الدرس", v);
  if (args?.dry_run) return [`✅ (تجربة فقط — لم يُحفظ شيء) الدرس صالح: ${JSON.stringify(v.stats)}`, formatIssues("الدرس", v)].filter(Boolean).join("\n\n");
  const { url, short } = await saveDraft("lesson", v.data);
  const s = v.stats!;
  const head = `✅ تم التحقق من الدرس: ${s.sections} قسم، ${s.blocks} عنصر، ${s.questions} سؤال.`;
  const how = short
    ? `🔗 رابط قصير صالح ${DRAFT_TTL_HOURS} ساعة (بلا تسجيل دخول). يفتح محرر الدرس معبّأً؛ لن يُنشر شيء قبل أن يحفظه المستخدم:\n${url}`
    : `🔗 تعذّر إنشاء رابط قصير فاستُخدم رابط الاستيراد الطويل (انسخه كاملاً دون تعديل):\n${url}`;
  return [head, how, formatIssues("الدرس", v)].filter(Boolean).join("\n\n");
}


function extractCode(raw: string): string {
  const m = String(raw || "").match(/draft=([2-9a-hj-km-np-z]{10})/i) || String(raw || "").trim().match(/^([2-9a-hj-km-np-z]{10})$/i);
  return m ? m[1].toLowerCase() : "";
}

async function loadDraft(code: string) {
  const { data, error } = await supabase.from("import_drafts").select("kind, payload, expires_at").eq("code", code).maybeSingle();
  if (error || !data || new Date(data.expires_at).getTime() < Date.now()) return null;
  return data as { kind: "quiz" | "lesson"; payload: any; expires_at: string };
}

const NO_DRAFT = "❌ المسودة غير موجودة أو انتهت صلاحيتها (72 ساعة). أنشئ مسودة جديدة بـ create_*_import_link أو clone_to_draft.";

async function handleGetImportDraft(args: { code: string; format?: string }) {
  const code = extractCode(args?.code);
  if (!code) return "الرجاء تمرير كود المسودة (10 أحرف) أو رابطها الكامل.";
  const d = await loadDraft(code);
  if (!d) return NO_DRAFT;
  const link = draftUrl(d.kind, code);
  if (args?.format === "json") return JSON.stringify({ kind: d.kind, link, expires_at: d.expires_at, content: d.payload }, null, 2);
  return `# مسودة ${d.kind === "quiz" ? "امتحان" : "درس"} — ${link}\nتنتهي: ${d.expires_at}\n\n${d.kind === "quiz" ? outlineQuiz(d.payload) : outlineLesson(d.payload)}`;
}

async function handleUpdateImportDraft(args: { code: string; patch: any }) {
  const code = extractCode(args?.code);
  if (!code) return "الرجاء تمرير كود المسودة (10 أحرف) أو رابطها الكامل.";
  const d = await loadDraft(code);
  if (!d) return NO_DRAFT;

  const res = applyDraftPatch(d.kind, d.payload, args?.patch);
  if (res.error) return `❌ لم يتغير شيء — ${res.error}`;
  const v: any = d.kind === "quiz" ? validateQuiz({ ...res.data.meta, questions: res.data.questions }) : validateLesson(res.data);
  if (!v.ok) return formatIssues("المسودة بعد التعديل", v);

  const { error } = await supabase.from("import_drafts").update({
    payload: v.data,
    expires_at: new Date(Date.now() + DRAFT_TTL_HOURS * 3600_000).toISOString(),
  }).eq("code", code);
  if (error) return "❌ تعذّر حفظ التعديل، حاول مجدداً.";

  const link = draftUrl(d.kind, code);
  const stats = d.kind === "quiz" ? `${v.stats.questions} سؤال` : `${v.stats.sections} قسم، ${v.stats.questions} سؤال`;
  return [
    `✅ تم تطبيق ${res.applied!.length} تعديل (${res.applied!.join("، ")}). المسودة الآن: ${stats}.`,
    `🔗 نفس الرابط (صلاحيته جُدّدت ${DRAFT_TTL_HOURS} ساعة) — على المستخدم إعادة فتحه/تحديث الصفحة ليرى التعديل:\n${link}`,
    formatIssues("المسودة", v),
  ].filter(Boolean).join("\n\n");
}

async function handleCloneToDraft(args: { type: string; id: string }) {
  const id = String(args?.id || "").trim();
  if (!id) return "الرجاء تحديد id.";
  let input: any, kind: "quiz" | "lesson";
  if (args?.type === "quiz") {
    kind = "quiz";
    const m = id.match(/\/(?:quiz|q)\/([^/?#]+)/);
    const qd = await fetchQuizData(m ? decodeURIComponent(m[1]) : id);
    if (!qd) return `لم يتم العثور على امتحان عام بالمعرف "${id}" (أو أنه محمي بكلمة مرور).`;
    input = quizToDraftInput(qd);
  } else if (args?.type === "lesson") {
    kind = "lesson";
    const slug = id.match(/\/lesson\/([^/?#]+)/)?.[1] || id;
    const { data, error } = await supabase.from("lesson_public")
      .select("title, description, source, content, password_protected")
      .or(`id.eq.${slug},slug.eq.${slug}`).maybeSingle();
    if (error || !data) return `لم يتم العثور على الدرس "${id}".`;
    if (data.password_protected) return "هذا الدرس محمي بكلمة مرور ولا يمكن نسخه.";
    input = lessonToDraftInput(data);
  } else return "type يجب أن يكون quiz أو lesson.";

  const v: any = kind === "quiz" ? validateQuiz(input) : validateLesson(input);
  if (!v.ok) return `❌ المحتوى الأصلي لا يجتاز التحقق الحالي، لذا لم تُنشأ مسودة:\n${v.errors.map((e: string) => `  - ${e}`).join("\n")}`;
  const { url, short } = await saveDraft(kind, v.data);
  return [
    `✅ نُسخ ${kind === "quiz" ? "الامتحان" : "الدرس"} إلى مسودة جديدة (الأصل لم يتغيّر).`,
    short ? `🔗 ${url}` : `🔗 (رابط طويل) ${url}`,
    "عدّل بـ update_import_draft أو راجع المحتوى بـ get_import_draft.",
    "الملخص:\n" + (kind === "quiz" ? outlineQuiz(v.data) : outlineLesson(v.data)),
    formatIssues("المسودة", v),
  ].filter(Boolean).join("\n\n");
}

function handleGetAuthoringGuide(args: { topic?: string }) {
  const topic = (args?.topic || "all").trim();
  if (topic === "all") return Object.values(AUTHORING_GUIDE).join("\n\n---\n\n");
  return AUTHORING_GUIDE[topic] || `topic غير معروف. المتاح: all, ${Object.keys(AUTHORING_GUIDE).join(", ")}`;
}

function handleGetCreatorInfo(args: { section?: string }) {
  const section = (args?.section || "all").trim();
  if (section === "all") return `# منصة إمتحانات بصمجي — المطوّر والمنصة\n\n` + Object.values(CREATOR_INFO).join("\n\n");
  return CREATOR_INFO[section] || `section غير معروف. المتاح: all, ${Object.keys(CREATOR_INFO).join(", ")}`;
}

// GET /draft/<code> → the stored payload (used by the creator pages).
async function handleDraftRequest(code: string, kind: string | null) {
  const json = (obj: unknown, status: number) =>
    new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" } });
  if (!DRAFT_CODE_RE.test(code)) return json({ error: "invalid_code" }, 400);
  const { data, error } = await supabase.from("import_drafts").select("kind, payload, expires_at").eq("code", code).maybeSingle();
  if (error) return json({ error: "lookup_failed" }, 500);
  if (!data || new Date(data.expires_at).getTime() < Date.now()) return json({ error: "not_found_or_expired" }, 404);
  if (kind && data.kind !== kind) return json({ error: "wrong_kind", kind: data.kind }, 409);
  return json({ kind: data.kind, payload: data.payload, expires_at: data.expires_at }, 200);
}

// ── MCP JSON-RPC Handler ────────────────────────────────────────────────────

async function handleRpcRequest(reqBody: any) {
  const { jsonrpc, id, method, params } = reqBody || {};

  if (jsonrpc !== "2.0") {
    return { jsonrpc: "2.0", id: id || null, error: { code: -32600, message: "Invalid Request: must be JSON-RPC 2.0" } };
  }

  switch (method) {
    case "initialize":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {}, prompts: {} },
          serverInfo: { name: "Basmagi Quiz Connector", version: "3.1.0" },
        },
      };

    case "notifications/initialized":
      return null;

    case "ping":
      return { jsonrpc: "2.0", id, result: {} };

    case "tools/list":
      return { jsonrpc: "2.0", id, result: { tools: TOOLS } };

    case "tools/call": {
      const toolName = params?.name;
      const toolArgs = params?.arguments || {};
      let resultText = "";
      let isError = false;

      try {
        switch (toolName) {
          case "search_catalog":            resultText = await handleSearchCatalog(toolArgs);       break;
          case "list_courses":              resultText = await handleListCourses(toolArgs);         break;
          case "list_colleges":             resultText = await handleListColleges(toolArgs);        break;
          case "get_course_contents":       resultText = await handleGetCourseContents(toolArgs);   break;
          case "get_folder_contents":       resultText = await handleGetFolderContents(toolArgs);   break;
          case "list_folder_tree":          resultText = await handleListFolderTree(toolArgs);      break;
          case "get_quiz":                  resultText = await handleGetQuiz(toolArgs);             break;
          case "get_quiz_by_url":           resultText = await handleGetQuizByUrl(toolArgs);        break;
          case "get_lesson":                resultText = await handleGetLesson(toolArgs);           break;
          case "get_lesson_content":        resultText = await handleGetLessonContent(toolArgs);    break;
          case "list_recent_content":       resultText = await handleListRecentContent(toolArgs);   break;
          case "get_platform_stats":        resultText = await handleGetPlatformStats();            break;
          case "get_prompts":               resultText = handleGetPrompts(toolArgs);                break;
          case "create_quiz_import_link":   resultText = await handleCreateQuizImportLink(toolArgs);  break;
          case "create_lesson_import_link": resultText = await handleCreateLessonImportLink(toolArgs); break;
          case "get_creator_info":          resultText = handleGetCreatorInfo(toolArgs);            break;
          case "get_import_draft":          resultText = await handleGetImportDraft(toolArgs);      break;
          case "update_import_draft":       resultText = await handleUpdateImportDraft(toolArgs);   break;
          case "clone_to_draft":            resultText = await handleCloneToDraft(toolArgs);        break;
          case "get_authoring_guide":       resultText = handleGetAuthoringGuide(toolArgs);         break;
          default:
            isError = true;
            resultText = `Unknown tool: ${toolName}`;
        }
      } catch (err: any) {
        isError = true;
        resultText = `Tool execution error in ${toolName}: ${err?.message || err}`;
      }

      return {
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: resultText }], isError },
      };
    }

    case "prompts/list":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          prompts: Object.entries(PROMPTS_REGISTRY).map(([key, val]) => ({
            name: key,
            description: val.description,
            arguments: [],
          })),
        },
      };

    case "prompts/get": {
      const promptName = params?.name;
      const item = PROMPTS_REGISTRY[promptName];
      if (!item) {
        return { jsonrpc: "2.0", id, error: { code: -32602, message: `Prompt not found: ${promptName}` } };
      }
      return {
        jsonrpc: "2.0",
        id,
        result: {
          description: item.description,
          messages: [{ role: "user", content: { type: "text", text: item.text } }],
        },
      };
    }

    default:
      return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
  }
}

// ── HTTP Entrypoint ─────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method === "GET") {
    const url = new URL(req.url);
    const m = url.pathname.match(/\/draft\/([^/]+)\/?$/);
    if (m) return await handleDraftRequest(m[1], url.searchParams.get("kind"));
    return new Response(
      JSON.stringify({
        status: "ok",
        protocol: "mcp-jsonrpc-2.0",
        name: "Basmagi Quiz Model Context Protocol (MCP) Server",
        version: "3.1.0",
        homepage: "https://basmagi-quiz.vercel.app",
        toolsCount: TOOLS.length,
        toolsAvailable: TOOLS.map((t) => t.name),
      }, null, 2),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  if (req.method === "POST") {
    try {
      const body = await req.json();
      const rpcResponse = await handleRpcRequest(body);
      if (rpcResponse === null) return new Response(null, { status: 204, headers: corsHeaders });
      return new Response(JSON.stringify(rpcResponse), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (err: any) {
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: `Parse error: ${err?.message}` } }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  }

  return new Response("Method not allowed", { status: 405, headers: corsHeaders });
});
