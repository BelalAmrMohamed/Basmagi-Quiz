// =============================================================================
// supabase/functions/mcp/index.ts
// Model Context Protocol (MCP) Server for Basmagi Quiz (منصة إمتحانات بصمجي)
// Connects Claude.ai and ChatGPT.com to Basmagi Quiz tools, prompts, and catalog.
//
// Complies with:
//   - MCP JSON-RPC 2.0 (protocol version 2024-11-05)
//   - Zero-tracking / No student auth policy (No Auth required)
//   - Zero impact on Vercel Hobby 12-function cap (runs as Supabase Edge Function)
// =============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";

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

const QUIZ_JSON_INSTRUCTIONS = `Create a quiz from the material I provide. Return one valid JSON object only: no Markdown fences, comments, or extra text.

The object must use this shape:
{
  "meta": {
    "title": "A clear, specific quiz title",
    "description": "A short description of the quiz and what it assesses",
    "source": "The supplied source name, book, URL, or material; use an empty string if none was supplied"
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
- Always provide a meaningful meta.title, meta.description, and meta.source.
- Include a non-empty questions array. Each question needs q and an explanation. For multiple-choice questions, provide options and set correct to the zero-based index of the right option. For a genuinely multi-answer question, set correct to an array of zero-based indexes and multiSelect to true.
- Use {"q":"...","answer":"...","explanation":"..."} for open-ended/essay questions.
- A two-option question can be used for true/false.
- Media is written inline with Markdown syntax: ![description](url) for image, ![audio](url) for audio, ![video](url) for video.`;

const PROMPTS_REGISTRY: Record<string, { description: string; text: string }> = {
  general_purpose_quiz: {
    description: "Standard prompt for generating quizzes from raw study material",
    text: `${QUIZ_JSON_INSTRUCTIONS}\n\nAdapt the question types and difficulty to the supplied subject and audience. For unsolved questions, solve them carefully and explain the reasoning.\n\nNow convert the source material I provide:`,
  },
  english_specializing: {
    description: "Specialized prompt for English grammar, vocabulary, and reading comprehension quizzes",
    text: `${QUIZ_JSON_INSTRUCTIONS}\n\nFor English-language material:\n- Assess skills present (grammar, vocabulary, reading comprehension, usage).\n- Use natural English, plausible distractors, and context-rich examples.\n- For reading questions, include the passage in the question text with Markdown formatting, then ask a focused question about it.\n\nNow convert the English source material I provide:`,
  },
  math_specializing: {
    description: "Specialized prompt for mathematics and science quizzes with LaTeX formula support",
    text: `${QUIZ_JSON_INSTRUCTIONS}\n\nFor mathematics and science material:\n- Preserve mathematical meaning and use correct LaTeX delimiters: $...$ inline and $$...$$ display math.\n- Include a mix of conceptual and computational questions when appropriate.\n- Check calculations and symbolic answers before returning them.\n\nNow convert the mathematics/science source material I provide:`,
  },
  assistant_system_prompt: {
    description: "Official system prompt of El-Bashmebasamag (الباشــمبصمج) the smart platform assistant",
    text: `You are El-Bashmebasamag (الباشــمبصمج), the smart assistant for "Basamgy Exams Platform" (منصة امتحانات بصمجي) — an educational platform that lets users create, browse, and manage exams and lessons.
Explain academic topics accurately. Propose quiz and lesson content cleanly. Always respect zero-based indexing for question options (correct: 0 is the first option).`,
  },
};

// ── MCP Tools Registry ──────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "search_catalog",
    description:
      "Search public educational content on Basmagi Platform: courses, folders, quizzes, and lessons by keyword.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Keyword or topic to search for (e.g. 'anatomy', 'جراحة', 'data structures')",
        },
        scope: {
          type: "string",
          enum: ["all", "quizzes", "lessons", "courses", "folders"],
          description: "Optional filter to restrict search scope. Defaults to 'all'.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_quiz",
    description:
      "Fetch the complete questions, options, answers, and explanations of a public quiz by its ID.",
    inputSchema: {
      type: "object",
      properties: {
        quizId: {
          type: "string",
          description: "The unique identifier of the quiz (UUID or slug).",
        },
      },
      required: ["quizId"],
    },
  },
  {
    name: "get_lesson",
    description:
      "Fetch the complete markdown content, sections, and embedded questions of a public lesson by its ID or slug.",
    inputSchema: {
      type: "object",
      properties: {
        lessonId: {
          type: "string",
          description: "The unique identifier or slug of the lesson.",
        },
      },
      required: ["lessonId"],
    },
  },
  {
    name: "get_prompts",
    description:
      "Retrieve ready-to-use prompt templates for generating quizzes and lessons matching Basmagi Platform standards.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          enum: [
            "all",
            "general_purpose_quiz",
            "english_specializing",
            "math_specializing",
            "assistant_system_prompt",
          ],
          description: "The name of the prompt template to retrieve, or 'all'.",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "create_quiz_import_link",
    description:
      "Validates a generated quiz and generates a 1-click import URL that opens directly in Basmagi Quiz Creator with questions pre-loaded.",
    inputSchema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Quiz title.",
        },
        description: {
          type: "string",
          description: "Brief description of the quiz.",
        },
        source: {
          type: "string",
          description: "Source material reference (optional).",
        },
        questions: {
          type: "array",
          description: "Array of question objects.",
          items: {
            type: "object",
            properties: {
              q: { type: "string", description: "Question text (supports Markdown and $LaTeX$)" },
              options: {
                type: "array",
                items: { type: "string" },
                description: "Array of option texts for multiple choice.",
              },
              correct: {
                type: "array",
                items: { type: "integer" },
                description: "0-based indices of correct options (e.g. [1] or [0, 2]).",
              },
              multiSelect: {
                type: "boolean",
                description: "Whether multiple options can be chosen (checkboxes vs radio).",
              },
              answer: {
                type: "string",
                description: "Model answer for open-ended/essay questions.",
              },
              explanation: {
                type: "string",
                description: "Explanation of why the answer is correct.",
              },
            },
            required: ["q"],
          },
        },
      },
      required: ["title", "questions"],
    },
  },
  {
    name: "get_creator_info",
    description: "Read the public profile and contact links of Basamgy's creator, Belal Amr Mohamed.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
];

// ── Tool Call Implementations ───────────────────────────────────────────────

async function handleSearchCatalog(args: { query: string; scope?: string }) {
  const query = (args?.query || "").trim();
  if (!query) {
    return "الرجاء تحديد كلمة بحث صالحة.";
  }

  const scope = args?.scope || "all";
  const searchPattern = `%${query}%`;
  const sections: string[] = [];

  // 1. Quizzes
  if (scope === "all" || scope === "quizzes") {
    const { data: quizzes, error } = await supabase
      .from("quizzes")
      .select("data, created_at")
      .is("password", null)
      .limit(10);

    if (!error && quizzes) {
      const matched = quizzes
        .map((row: any) => row.data)
        .filter((d: any) => {
          const title = d?.meta?.title || d?.title || "";
          const desc = d?.meta?.description || d?.description || "";
          return (
            title.toLowerCase().includes(query.toLowerCase()) ||
            desc.toLowerCase().includes(query.toLowerCase())
          );
        });

      if (matched.length > 0) {
        const lines = matched.slice(0, 5).map((q: any) => {
          const id = q.meta?.id || q.id || "unknown";
          const title = q.meta?.title || q.title || "امتحان بدون عنوان";
          const qCount = q.questions?.length || 0;
          return `  - [امتحان] ${title} (${qCount} أسئلة) — id: ${id} — الرابط: https://quiz.basmagi.com/quiz/${id}`;
        });
        sections.push(`امتحانات مطابقة:\n${lines.join("\n")}`);
      }
    }
  }

  // 2. Lessons
  if (scope === "all" || scope === "lessons") {
    const { data: lessons, error } = await supabase
      .from("lesson_public")
      .select("id, slug, title, description")
      .ilike("title", searchPattern)
      .limit(5);

    if (!error && lessons && lessons.length > 0) {
      const lines = lessons.map((l: any) => {
        return `  - [درس] ${l.title} — id: ${l.id} — الرابط: https://quiz.basmagi.com/lesson/${l.slug || l.id}`;
      });
      sections.push(`دروس مطابقة:\n${lines.join("\n")}`);
    }
  }

  // 3. Courses
  if (scope === "all" || scope === "courses") {
    const { data: courses, error } = await supabase
      .from("courses")
      .select("id, name, education_type, college")
      .ilike("name", searchPattern)
      .limit(5);

    if (!error && courses && courses.length > 0) {
      const lines = courses.map((c: any) => {
        return `  - [مادة] ${c.name} (${c.college || c.education_type || "عام"}) — id: ${c.id}`;
      });
      sections.push(`مواد دراسية مطابقة:\n${lines.join("\n")}`);
    }
  }

  // 4. Folders
  if (scope === "all" || scope === "folders") {
    const { data: folders, error } = await supabase
      .from("folders")
      .select("id, name, course_id")
      .ilike("name", searchPattern)
      .limit(5);

    if (!error && folders && folders.length > 0) {
      const lines = folders.map((f: any) => `  - [مجلد] ${f.name} — id: ${f.id}`);
      sections.push(`مجلدات مطابقة:\n${lines.join("\n")}`);
    }
  }

  if (sections.length === 0) {
    return `لم يتم العثور على نتائج تطابق "${query}" في منصة بصمجي.`;
  }

  return `نتائج البحث عن "${query}":\n\n${sections.join("\n\n")}`;
}

async function handleGetQuiz(args: { quizId: string }) {
  const quizId = (args?.quizId || "").trim();
  if (!quizId) return "الرجاء تحديد معرف الامتحان المطلوب (quizId).";

  // Check quizzes table by data->meta->id or primary key
  const { data, error } = await supabase
    .from("quizzes")
    .select("data, created_at")
    .is("password", null)
    .limit(100);

  if (error || !data) {
    return `تعذر استرداد بيانات الامتحان: ${error?.message || "غير موجود"}`;
  }

  const found = data.find((row: any) => {
    const qData = row.data;
    return qData?.meta?.id === quizId || qData?.id === quizId;
  });

  if (!found || !found.data) {
    return `لم يتم العثور على امتحان بالمعرف "${quizId}". قد يكون الامتحان خاصاً أو محذوفاً.`;
  }

  const q = found.data;
  const title = q.meta?.title || q.title || "امتحان";
  const desc = q.meta?.description || q.description || "";
  const questions = q.questions || [];

  const formattedQuestions = questions.map((item: any, idx: number) => {
    const opts = (item.options || [])
      .map((opt: string, oIdx: number) => `    ${oIdx}) ${opt}`)
      .join("\n");
    const correct = Array.isArray(item.correct)
      ? item.correct.join(", ")
      : item.correct !== undefined
      ? item.correct
      : "(غير محدد)";
    return `${idx + 1}. ${item.q}\n${opts ? opts + "\n" : ""}   الإجابة الصحيحة: ${correct}${
      item.explanation ? `\n   التفسير: ${item.explanation}` : ""
    }${item.answer ? `\n   نموذج الإجابة: ${item.answer}` : ""}`;
  });

  return `# ${title}\n${desc ? desc + "\n\n" : "\n"}عدد الأسئلة: ${questions.length}\n\n${formattedQuestions.join(
    "\n\n"
  )}`;
}

async function handleGetLesson(args: { lessonId: string }) {
  const lessonId = (args?.lessonId || "").trim();
  if (!lessonId) return "الرجاء تحديد معرف الدرس (lessonId).";

  // Query lesson_public
  const { data, error } = await supabase
    .from("lesson_public")
    .select("id, slug, title, description, source, created_at")
    .or(`id.eq.${lessonId},slug.eq.${lessonId}`)
    .maybeSingle();

  if (error || !data) {
    return `لم يتم العثور على الدرس بالمعرف أو الرابط "${lessonId}".`;
  }

  return `# ${data.title}\n\n${data.description || ""}\n\nالمصدر: ${data.source || "منصة بصمجي"}\nرابط الدرس: https://quiz.basmagi.com/lesson/${data.slug || data.id}`;
}

function handleGetPrompts(args: { name: string }) {
  const target = (args?.name || "all").trim();
  if (target === "all") {
    return Object.entries(PROMPTS_REGISTRY)
      .map(
        ([key, val]) =>
          `=== [${key}] ===\nالوصف: ${val.description}\n\n${val.text}`
      )
      .join("\n\n------------------------------------\n\n");
  }

  const prompt = PROMPTS_REGISTRY[target];
  if (!prompt) {
    return `القالب "${target}" غير موجود. القوالب المتاحة:\n- ${Object.keys(
      PROMPTS_REGISTRY
    ).join("\n- ")}`;
  }

  return `=== [${target}] ===\nالوصف: ${prompt.description}\n\n${prompt.text}`;
}

function handleCreateQuizImportLink(args: any) {
  if (!args || !args.title || !Array.isArray(args.questions) || !args.questions.length) {
    return "بيانات الامتحان غير مكتملة. يجب توفير title ومصفوفة questions.";
  }

  const normalizedQuiz = {
    meta: {
      title: args.title,
      description: args.description || "",
      source: args.source || "توليد Claude / ChatGPT",
    },
    questions: args.questions.map((q: any) => {
      let correct = q.correct;
      if (typeof correct === "number") correct = [correct];
      if (!Array.isArray(correct) && !q.answer) correct = [0];

      return {
        q: q.q,
        options: q.options || ["نعم", "لا"],
        correct: correct,
        multiSelect: Boolean(q.multiSelect || (Array.isArray(correct) && correct.length > 1)),
        explanation: q.explanation || "",
        ...(q.answer ? { answer: q.answer } : {}),
      };
    }),
  };

  const jsonString = JSON.stringify(normalizedQuiz);
  // Safe UTF-8 Base64 encoding for Arabic text
  const bytes = new TextEncoder().encode(jsonString);
  const binary = Array.from(bytes, (b) => String.fromCharCode(b)).join("");
  const base64Data = btoa(binary);

  const importUrl = `https://quiz.basmagi.com/create-quiz#data=base64,${base64Data}`;

  return `✅ تم التحقق من هيكل الامتحان بنجاح (${normalizedQuiz.questions.length} سؤال).\n\n🔗 **رابط الفتح والاستيراد المباشر بضغطة واحدة:**\n${importUrl}\n\n(عند فتح هذا الرابط، ستفتح المنصة مباشرة ومعها كافة الأسئلة والخيارات والتفسيرات في صفحة المحرر جاهزة للبدء أو الحفظ في مكتبتك دون تسجيل دخول).`;
}

function handleGetCreatorInfo() {
  return `معلومات مطور منصة إمتحانات بصمجي:
- المطور: بلال عمرو محمد (Belal Amr Mohamed)
- نبذة: مطور برمجيات ومؤسس منصة امتحانات بصمجي التعليمية المجانية والمفتوحة للطلاب.
- الموقع الشخصي ومعرض الأعمال: https://belalamr.me
- صفحة من نحن على المنصة: https://quiz.basmagi.com/about
- GitHub: https://github.com/BelalAmrMohamed`;
}

// ── MCP JSON-RPC Handler ────────────────────────────────────────────────────

async function handleRpcRequest(reqBody: any) {
  const { jsonrpc, id, method, params } = reqBody || {};

  if (jsonrpc !== "2.0") {
    return {
      jsonrpc: "2.0",
      id: id || null,
      error: { code: -32600, message: "Invalid Request: jsonrpc must be '2.0'" },
    };
  }

  switch (method) {
    case "initialize":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: {
            tools: {},
            prompts: {},
          },
          serverInfo: {
            name: "Basmagi Quiz Connector",
            version: "1.0.0",
          },
        },
      };

    case "notifications/initialized":
      return null; // Notifications return no response

    case "ping":
      return {
        jsonrpc: "2.0",
        id,
        result: {},
      };

    case "tools/list":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          tools: TOOLS,
        },
      };

    case "tools/call": {
      const toolName = params?.name;
      const toolArgs = params?.arguments || {};
      let resultText = "";
      let isError = false;

      try {
        switch (toolName) {
          case "search_catalog":
            resultText = await handleSearchCatalog(toolArgs);
            break;
          case "get_quiz":
            resultText = await handleGetQuiz(toolArgs);
            break;
          case "get_lesson":
            resultText = await handleGetLesson(toolArgs);
            break;
          case "get_prompts":
            resultText = handleGetPrompts(toolArgs);
            break;
          case "create_quiz_import_link":
            resultText = handleCreateQuizImportLink(toolArgs);
            break;
          case "get_creator_info":
            resultText = handleGetCreatorInfo();
            break;
          default:
            isError = true;
            resultText = `Unknown tool: ${toolName}`;
            break;
        }
      } catch (err: any) {
        isError = true;
        resultText = `Tool execution error: ${err?.message || err}`;
      }

      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [
            {
              type: "text",
              text: resultText,
            },
          ],
          isError,
        },
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
        return {
          jsonrpc: "2.0",
          id,
          error: { code: -32602, message: `Prompt not found: ${promptName}` },
        };
      }
      return {
        jsonrpc: "2.0",
        id,
        result: {
          description: item.description,
          messages: [
            {
              role: "user",
              content: {
                type: "text",
                text: item.text,
              },
            },
          ],
        },
      };
    }

    default:
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      };
  }
}

// ── HTTP Entrypoint ─────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  // CORS Preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  const url = new URL(req.url);

  // SSE Transport support for Claude.ai / Stream clients
  const acceptHeader = req.headers.get("Accept") || "";
  if (req.method === "GET" && acceptHeader.includes("text/event-stream")) {
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        // Send initial connection event
        controller.enqueue(
          encoder.encode(`event: endpoint\ndata: ${url.pathname}\n\n`)
        );
        // Keep-alive ping
        const intervalId = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(`event: ping\ndata: {}\n\n`));
          } catch {
            clearInterval(intervalId);
          }
        }, 15000);
      },
    });

    return new Response(stream, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  // Info page for browsers visiting GET /
  if (req.method === "GET") {
    return new Response(
      JSON.stringify(
        {
          name: "Basmagi Quiz Model Context Protocol (MCP) Server",
          status: "online",
          version: "1.0.0",
          documentation: "https://quiz.basmagi.com",
          toolsAvailable: TOOLS.map((t) => t.name),
        },
        null,
        2
      ),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  // JSON-RPC Handling (POST)
  if (req.method === "POST") {
    try {
      const body = await req.json();
      const rpcResponse = await handleRpcRequest(body);

      if (rpcResponse === null) {
        return new Response(null, { status: 204, headers: corsHeaders });
      }

      return new Response(JSON.stringify(rpcResponse), {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      });
    } catch (err: any) {
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: `Parse error: ${err?.message}` },
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
  }

  return new Response("Method not allowed", {
    status: 405,
    headers: corsHeaders,
  });
});
