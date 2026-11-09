// =============================================================================
// supabase/functions/mcp/lib.ts
// Pure helpers for the Basmagi MCP server (no Deno / network globals), so they
// can be unit-tested with plain Node: tests/mcp-lib.test.js
//   - validateQuiz / validateLesson  → { ok, data, errors, warnings, stats }
//   - makeDraftCode                  → short unguessable code for import links
//   - CREATOR_INFO / AUTHORING_GUIDE → static content returned by tools
// =============================================================================

export const SITE = "https://basmagi-quiz.vercel.app";

import { LIMITS as RULE_LIMITS, EMBED_REF_BY_TYPE, NOTEBOOK_RUNTIMES, checkQuiz, checkLesson, checkNotebook, normalizeNotebookContent } from "./content-rules.js";

// Content limits come from the shared rules (single source of truth, same as the
// editor pages and the upload API). `draftBytes` is the only MCP-specific cap.
export const LIMITS = {
  ...RULE_LIMITS,
  draftBytes: 200_000,
};

export type Issues = { errors: string[]; warnings: string[] };

const str = (v: unknown) => (v === undefined || v === null ? "" : String(v)).trim();
const isHttpUrl = (s: string) => /^https?:\/\/\S+$/i.test(s);

// Normalises `correct` / `correctIndex(es)` into a de-duplicated, in-range index list.
function readCorrect(raw: any[], n: number): { idx: number[]; bad: number[] } {
  const all = raw.map(Number).filter((x) => Number.isInteger(x));
  const bad = all.filter((x) => x < 0 || x >= n);
  const idx = [...new Set(all.filter((x) => x >= 0 && x < n))];
  return { idx, bad };
}

// ── Quiz ────────────────────────────────────────────────────────────────────
// The rules themselves live in content-rules.js (shared with the editor pages and
// the upload API). This wrapper only builds the cleaned draft payload.

export function validateQuiz(args: any) {
  const check = checkQuiz(args);
  const errors: string[] = check.errors.map((e: any) => e.message);
  const warnings: string[] = check.warnings.map((w: any) => w.message);

  const title = str(args?.title);
  const description = str(args?.description);
  const source = str(args?.source);

  const rawQs = args?.questions;
  if (!Array.isArray(rawQs) || !rawQs.length) {
    return { ok: false, data: null, errors, warnings, stats: null };
  }

  let mcq = 0, multi = 0, essay = 0;
  const questions = rawQs.map((q: any) => {
    const text = str(q?.q);
    const explanation = str(q?.explanation);
    const hasOptions = Array.isArray(q?.options) && q.options.length > 0;
    const answer = str(q?.answer);

    // Essay / open-ended: no options at all (never invent fake options).
    if (!hasOptions) {
      essay++;
      return { q: text, answer, explanation };
    }

    const options = q.options.map((o: any) => str(o));
    const rawCorrect = Array.isArray(q.correct) ? q.correct : q.correct === undefined || q.correct === null ? [] : [q.correct];
    const { idx } = readCorrect(rawCorrect, options.length);
    const multiSelect = q.multiSelect === true || idx.length > 1;
    if (multiSelect) multi++; else mcq++;

    return {
      q: text,
      options,
      correct: idx,
      multiSelect,
      explanation,
      ...(answer ? { answer } : {}),
    };
  });

  const data = { meta: { title, description, source }, questions };
  const bytes = new TextEncoder().encode(JSON.stringify(data)).length;
  if (bytes > LIMITS.draftBytes) errors.push(`حجم الامتحان ${Math.round(bytes / 1024)}KB يتجاوز ${LIMITS.draftBytes / 1000}KB.`);

  return {
    ok: errors.length === 0,
    data,
    errors,
    warnings,
    stats: { questions: questions.length, mcq, multiSelect: multi, essay, bytes },
  };
}

// ── Notebook ────────────────────────────────────────────────────────────────

// Same shared rules as the editor page and the upload API (checkNotebook).
// Unknown/missing runtimes are errors — never defaulted.
export function validateNotebook(args: any) {
  const check = checkNotebook(args);
  const errors: string[] = check.errors.map((e: any) => e.message);
  const warnings: string[] = check.warnings.map((w: any) => w.message);
  const rawCells = Array.isArray(args?.cells) ? args.cells : Array.isArray(args?.content?.cells) ? args.content.cells : null;
  if (!rawCells || !rawCells.length || errors.length) {
    return { ok: false, data: null, errors, warnings, stats: null };
  }
  const content = normalizeNotebookContent(rawCells, args?.language ?? args?.content?.language, args?.runtime ?? args?.content?.runtime);
  const data = {
    title: str(args?.title),
    description: str(args?.description),
    source: str(args?.source),
    runtime: str(args?.runtime),
    ...(content.language ? { language: content.language } : {}),
    cells: content.cells,
  };
  const bytes = new TextEncoder().encode(JSON.stringify(data)).length;
  if (bytes > LIMITS.draftBytes) {
    errors.push(`حجم المسودة ${Math.round(bytes / 1000)}KB يتجاوز ${LIMITS.draftBytes / 1000}KB.`);
    return { ok: false, data: null, errors, warnings, stats: null };
  }
  return {
    ok: true,
    data,
    errors,
    warnings,
    stats: { challenges: content.cells.filter((c: any) => c.challenge).length, cells: content.cells.length, code: content.cells.filter((c: any) => c.type === "code").length, markdown: content.cells.filter((c: any) => c.type === "markdown").length, bytes },
  };
}

// ── Lesson ──────────────────────────────────────────────────────────────────

export function validateLesson(args: any) {
  // publish:true — the server only accepts published-lesson UUIDs in lesson-reference blocks.
  const check = checkLesson(args, { publish: true });
  const errors: string[] = check.errors.map((e: any) => e.message);
  const warnings: string[] = check.warnings.map((w: any) => w.message);

  const title = str(args?.title);
  const description = str(args?.description);
  const source = str(args?.source);

  const rawSections = Array.isArray(args?.sections)
    ? args.sections
    : Array.isArray(args?.content?.sections)
    ? args.content.sections
    : null;
  if (!rawSections || !rawSections.length) {
    return { ok: false, data: null, errors, warnings, stats: null };
  }

  let blocksTotal = 0, questions = 0, markdownChars = 0;
  const sections = rawSections.map((s: any) => {
    const secTitle = str(s?.title);
    const rawBlocks = Array.isArray(s?.blocks)
      ? s.blocks
      : typeof s?.content === "string"
      ? [{ type: "markdown", body: s.content }]
      : [];

    const blocks: any[] = [];
    rawBlocks.forEach((b: any) => {
      if (!b || typeof b !== "object") return;
      const type = b.type || (b.prompt || b.q ? "question" : "markdown");
      blocksTotal++;

      if (type === "markdown") {
        const body = String(b.body ?? b.content ?? "");
        markdownChars += body.length;
        blocks.push({ type: "markdown", body });
      } else if (type === "media") {
        const url = str(b.url);
        const kind = ["image", "audio", "video"].includes(b.kind) ? b.kind : "image";
        blocks.push({ type: "media", url, kind, ...(b.alt ? { alt: str(b.alt).slice(0, 200) } : {}) });
      } else if (type === "quizRef") {
        blocks.push({ type: "quizRef", quizId: str(b.quizId), ...(b.title ? { title: str(b.title).slice(0, 200) } : {}) });
      } else if (type === "lesson-reference" || type === "lessonRef") {
        blocks.push({
          type: "lesson-reference",
          lessonId: str(b.lessonId ?? b.lessonRefId),
          ...(b.title ? { title: str(b.title).slice(0, 200) } : {}),
          ...(b.slug ? { slug: str(b.slug).slice(0, 200) } : {}),
        });
      } else if (EMBED_REF_BY_TYPE[type]) {
        const def = EMBED_REF_BY_TYPE[type];
        blocks.push({
          type: def.type,
          [def.field]: str(b[def.field]),
          ...(b.title ? { title: str(b.title).slice(0, 200) } : {}),
        });
      } else if (type === "question") {
        questions++;
        const prompt = str(b.prompt ?? b.q);
        const explanation = str(b.explanation);
        const hasOptions = Array.isArray(b.options) && b.options.length > 0;
        const isEssay = b.questionKind === "essay" || (!hasOptions && !!(b.modelAnswer || b.answer));

        if (isEssay) {
          const modelAnswer = str(b.modelAnswer ?? b.answer);
          blocks.push({ type: "question", questionKind: "essay", prompt, modelAnswer, ...(explanation ? { explanation } : {}) });
        } else {
          const options = (hasOptions ? b.options : []).map((o: any) => str(o));
          const rawCorrect = Array.isArray(b.correctIndexes)
            ? b.correctIndexes
            : Array.isArray(b.correct)
            ? b.correct
            : Number.isInteger(b.correctIndex)
            ? [b.correctIndex]
            : Number.isInteger(b.correct)
            ? [b.correct]
            : [];
          const { idx } = readCorrect(rawCorrect, options.length);
          const multiSelect = b.multiSelect === true || idx.length > 1;
          blocks.push({
            type: "question",
            questionKind: "mcq",
            prompt,
            options,
            ...(multiSelect ? { multiSelect: true, correctIndexes: idx } : { correctIndex: idx[0] ?? 0 }),
            ...(explanation ? { explanation } : {}),
          });
        }
      }
      // unknown block types are reported by the shared check and not copied
    });

    return { title: secTitle, defaultHidden: Boolean(s?.defaultHidden), blocks };
  });

  const data = { title, description, source, sections };
  const bytes = new TextEncoder().encode(JSON.stringify(data)).length;
  if (bytes > LIMITS.draftBytes && !errors.some((e) => e.includes("حجم الدرس"))) {
    errors.push(`حجم الدرس ${Math.round(bytes / 1024)}KB يتجاوز ${LIMITS.draftBytes / 1000}KB.`);
  }

  return {
    ok: errors.length === 0,
    data,
    errors,
    warnings,
    stats: { sections: sections.length, blocks: blocksTotal, questions, markdownChars, bytes },
  };
}

// ── Draft codes ─────────────────────────────────────────────────────────────

// No 0/O/1/I/l — easy to read aloud. 10 chars × 5 bits ≈ 50 bits of entropy,
// which makes the code an unguessable capability (the platform has no sign-in).
const ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";

export function makeDraftCode(len = 10): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

export const DRAFT_CODE_RE = /^[2-9a-hj-km-np-z]{10}$/;
export const DRAFT_TTL_HOURS = 72;

export function draftUrl(kind: "quiz" | "lesson" | "notebook", code: string) {
  // Every kind opens «محتواي» directly: the item is saved there when the link is opened.
  void kind;
  return `${SITE}/my-content?draft=${code}`;
}

// ── Static content ──────────────────────────────────────────────────────────

export const CREATOR_INFO: Record<string, string> = {
  profile: `## المطوّر
- الاسم: بلال عمرو محمد (Belal Amr Mohamed)
- الدور: مطوّر برمجيات مستقل، صاحب فكرة منصة «إمتحانات بصمجي» ومصمّمها ومبرمجها بالكامل.
- الفكرة: «بصمجي مشروع مستقل … يبني أدوات عربية عملية، لا تكتفي بترجمة الواجهات بل تفهم كيف يتعامل الناس مع المعرفة والأسئلة.»
- اسم الملف الشخصي على المنصة: @belalamrofficial
- قناة اليوتيوب: «طالب حاسبات» — فيديوهات ومحتوى تقني بالعربية.`,

  links: `## الروابط
- الموقع الشخصي (نبذة وأبرز المشاريع والمهارات): https://belal-amr.vercel.app/
- ملفه على المنصة: ${SITE}/@belalamrofficial
- صفحة «عن المنصة»: ${SITE}/about
- GitHub: https://github.com/BelalAmrMohamed/
- يوتيوب (طالب حاسبات): https://www.youtube.com/@طالب-حاسبات
- مستقل (Mostaql): https://mostaql.com/u/BelalAmrMohamed/portfolio
- Upwork: https://www.upwork.com/freelancers/~0169eeff3e0d6045d8`,

  contact: `## التواصل (للتبليغ عن عطل أو اقتراح)
- واتساب: +20 111 848 2193 — https://wa.me/201118482193
- تيليجرام: @BelalAmrMohamed — https://t.me/BelalAmrMohamed
- البريد الإلكتروني: belalamrofficial@gmail.com
- التبليغ عن سؤال/محتوى: صفحة ${SITE}/reports`,

  platform: `## عن المنصة
- «بصمجي مساحة عربية للتعلّم بالمحاولة: امتحان واضح، إجابة صادقة، ومراجعة تعرف منها أين تقف والخطوة التالية.»
- الدورة الكاملة: أنشئ ← نظّم ← اختبر ← راجع. (إنشاء الامتحانات يدوياً أو بقوالب/ذكاء اصطناعي، تنظيمها في مقررات ومجلدات، حلّها في بيئة تركّز على السؤال، ثم قراءة النتيجة كخريطة للمراجعة.)
- ثلاثة مبادئ: الوضوح قبل الزينة · المحتوى ملك أصحابه · المحاولة جزء من التعلّم.
- مجانية ومفتوحة للطلاب والمعلمين، بلا تسجيل دخول لاستخدام أدوات الإنشاء.
- المشروع مغلق المصدر.
- التقنيات: JavaScript, CSS, Node.js, Supabase (PostgreSQL), Vercel, تطبيق PWA يُثبَّت على الهاتف.
- المساعد الذكي «الباشــمبصمج» داخل المنصة، ومتاح أيضاً على تيليجرام لمناقشة الأسئلة ورفع المحاضرات وتوليد امتحانات كاملة.
- أرقام حيّة (امتحانات، دروس، مقررات، كليات): استخدم get_platform_stats.`,

  pages: `## صفحات مفيدة
- ${SITE}/create-quiz — إنشاء امتحان
- ${SITE}/create-lesson — إنشاء درس
- ${SITE}/how-to-create-content — شرح إنشاء امتحان
- ${SITE}/how-to-upload-content — شرح رفع امتحان
- ${SITE}/how-to-connect-mcp — ربط Claude/ChatGPT بالمنصة (MCP) بالصور
- ${SITE}/how-to-use-ai-agent — شرح استخدام المساعد الذكي
- ${SITE}/privacy-policy · ${SITE}/terms-of-service`,
};

export const AUTHORING_GUIDE: Record<string, string> = {
  workflow: `# Basmagi — Claude's authoring workflow
1. Call get_authoring_guide topic=quiz|lesson|markdown once per conversation (this text).
2. Source material attached by the user → read it fully; do NOT invent facts. Unsolved questions → solve them carefully, then explain.\n   - User gave a FOLDER or several files to convert (e.g. a shared Google Drive folder)? Call get_authoring_guide topic=convert first: it says how to decide quiz vs lesson vs notebook per file, when to confirm with the user, and how to report.
3. Build the object, then call create_quiz_import_link / create_lesson_import_link / create_notebook_import_link (topic=notebook for executable MATLAB-style or C++17 notebooks).
   - Result is ONE short link: ${SITE}/my-content?draft=<code> (valid ${DRAFT_TTL_HOURS}h, no sign-in needed).
   - If the result lists ERRORS nothing was saved: fix exactly what it says and call again.
   - The errors are the SAME checks the editor page and the upload step run, so a draft that passes here will not fail later. Each error names the question/block and how to fix it.
   - WARNINGS are saved but worth fixing; mention important ones to the user.
4. Give the user the link as-is (never edit/re-encode it) and tell them to open it: the item is saved straight into their «محتواي» and shown there with a «جديد» badge (no editor step, no confirmation, no admin review). It is saved in their own browser only, not published to the public platform. Edit a draft with update_import_draft BEFORE they open the link; once opened, the item lives in «محتواي» and the draft is gone.
5. Revising: do NOT rebuild and re-send everything.
   - get_import_draft(code) → numbered outline → update_import_draft(code, patch) with only the change (same link stays valid; 1-based positions; atomic).
   - Improve/translate/extend something that already exists: clone_to_draft(type,id), then patch. Inspect originals cheaply with get_quiz / get_lesson_content format="outline".
   - Not sure the content is valid? create_*_import_link with dry_run=true validates without saving.
   - Patching only works while the link is unopened: opening it saves the item into the user's «محتواي» and deletes the draft. To change an already-opened item, create a new draft (the user can delete the old one).
6. Check for existing content first with search_catalog to avoid duplicates, and offer to link related lessons/quizzes (quizRef / lesson-reference / notebook-reference / folder-reference / course-reference blocks).
Language: write quiz/lesson text in the language of the source material (usually Arabic). Keep tool arguments (field names) in English.`,

  quiz: `# Quiz schema (create_quiz_import_link)
{ title (≤${LIMITS.quizTitle}), description (≤${LIMITS.quizDescription}), source ("https://…" or ""),
  questions: [ ... ≤${LIMITS.quizQuestions} ] }

Question kinds — decided by which fields exist:
- Single-answer MCQ:  { q, options: [2..${LIMITS.quizOptionsMax} strings], correct: <zero-based int>, explanation }
- Multi-answer MCQ:   { q, options, correct: [0, 2], multiSelect: true, explanation }
- True/False:         { q, options: ["صح","خطأ"] (Arabic quiz) or ["True","False"] (English quiz), correct: 0|1, explanation }
- Essay/open-ended:   { q, answer: "<model answer>", explanation }   ← NO options key at all

Rules the server enforces (identical to the editor page and the upload check): correct is ZERO-based and must be in range (it never guesses a missing answer); options are non-empty and ≤${LIMITS.quizOptionsMax} (lesson questions: ≤${LIMITS.optionsMax}); an essay question MUST have a non-empty answer; source must be a real https:// link or empty "" — never a sentence (e.g. never "generated by AI").
True/False options must be in the quiz's language: ["صح","خطأ"] for Arabic, ["True","False"] for English. "correct" is 0 or 1.
Math: every formula, variable, exponent, fraction, root, Greek letter or math symbol in q/options/answer/explanation/lesson bodies must be LaTeX: $...$ inline, $$...$$ display. Never plain text (x^2, sqrt(x), 1/2, x², √, ≤). Escape backslashes in JSON (\\\\frac).
Quality rules: one unambiguous correct answer; plausible distractors of similar length; don't put "all of the above" unless needed; shuffle the position of correct answers (don't make them all 0/1); every question gets a teaching explanation; vary difficulty; no duplicate questions.
Inline Markdown works in q / options / explanation: **bold**, \`code\`, $x^2$ inline and $$...$$ block LaTeX, GFM tables, ![alt](url) images, ![audio](url), ![video](url) (YouTube auto-embeds).`,

  lesson: `# Lesson schema (create_lesson_import_link)
{ title (≤${LIMITS.lessonTitle}), description (≤${LIMITS.lessonDescription}), source ("https://…" or ""),
  sections: [ { title, defaultHidden?: bool, blocks: [ ... ≤${LIMITS.blocksPerSection} ] } ]  (≤${LIMITS.lessonSections} sections) }

Block types:
- { type:"markdown", body }                       — body ≤${LIMITS.markdownBody} chars; split long text into several blocks
- { type:"media", kind:"image|audio|video", url, alt? }
- { type:"question", questionKind:"mcq", prompt, options, correctIndex | correctIndexes+multiSelect, explanation }
- { type:"question", questionKind:"essay", prompt, modelAnswer, explanation? }
- { type:"quizRef", quizId, title? }               — embed an existing quiz (find ids with search_catalog)
- { type:"lesson-reference", lessonId, title?, slug? }
- { type:"notebook-reference", notebookId, title? } — link-out card to a published notebook (UUID from search_catalog)
- { type:"folder-reference", folderId, title? }     — link-out card to a course folder (UUID)
- { type:"course-reference", courseId, title? }     — link-out card to a course (UUID)

Structure tips: one idea per section; a short markdown intro, the explanation, then 1–3 check-yourself questions at the end of each section; a final "ملخص / مراجعة" section; set defaultHidden:true for long optional material (e.g. worked solutions). Lessons are never scored — questions are for self-check. lesson-reference blocks need the UUID of a PUBLISHED lesson (get it from search_catalog). Math: every formula, variable, exponent, fraction, root, Greek letter or math symbol in q/options/answer/explanation/lesson bodies must be LaTeX: $...$ inline, $$...$$ display. Never plain text (x^2, sqrt(x), 1/2, x², √, ≤). Escape backslashes in JSON (\\\\frac).`,

  notebook: `# Notebook schema (create_notebook_import_link)
{ title (≤${LIMITS.notebookTitle}), description (≤${LIMITS.notebookDescription}), source ("https://…" or ""),
  runtime: "${NOTEBOOK_RUNTIMES.join('" | "')}"  (REQUIRED — never defaulted; unknown values are rejected),
  cells: [ { id?: "cell-1", type: "markdown" | "code", source: string, stdin?: string, challenge?: Challenge } ]  (≤${LIMITS.notebookCells} cells, each source ≤${LIMITS.notebookCellSource} chars, stdin ≤4000 chars on C++ code cells, whole notebook ≤${LIMITS.notebookBytes / 1000}KB) }

## Challenges (interactive coding exercises)
A code cell with a \`challenge\` object becomes a graded exercise: the learner edits the cell (its \`source\` is the STARTER code), presses Run, and gets a green "Output matches expected result!" banner or a side-by-side Actual vs Expected diff. Grading looks ONLY at what the program prints (stdout), never at the code text, so any correct approach passes.
Challenge = { expectedOutput: string (required, ≤${LIMITS.challengeExpected}), matchMode?: "trimmed"|"exact"|"numeric"|"regex", tolerance?: number (numeric only), testStdin?: string (C++ only), hint?: string (≤${LIMITS.challengeHint}), solution?: string (model solution code, ≤${LIMITS.challengeSolution}) }
- trimmed (default): ignores CRLF, trailing spaces on each line and trailing blank lines — use it unless you have a reason.
- numeric: tokens split on whitespace; numbers match within tolerance (default 1e-6, relative for |b|>1), words must match exactly. Use for floating-point results (e.g. MATLAB prints 3.1416).
- regex: expectedOutput is a regular expression that must match the WHOLE normalized output (no ^ $ needed).
- exact: only CRLF→LF normalization. Rarely needed.
- C++ with cin: set testStdin; the learner is never prompted, the cell is always graded against it. MATLAB has no stdin.
- solution: learners can reveal it after their first run (with a confirmation before they pass). It ships to the browser, so treat it as public. Provide one whenever a typical learner could get stuck.
Authoring rules: (1) MATLAB output looks like "x =\n\n     5\n" when a statement has no semicolon, but disp(5) prints "5": derive expectedOutput by carefully tracing the SOLUTION code under the real runtime rules, or use numeric/regex mode when unsure; (2) the challenge must have ONE observable answer (avoid random numbers, timing, and addresses); (3) put the task statement in the markdown cell just above the code cell; (4) starter code should compile/run (e.g. comments + a TODO), a failing run is fine; (5) earlier cells of a C++ notebook replay on each run, so only the challenge cell's own stdout is graded; (6) always dry_run first — validation errors name CHALLENGE_* codes.

Runtime limits (tell learners the truth): "matlab" is a browser-based EDUCATIONAL MATLAB-style subset, NOT MathWorks MATLAB. "cpp" runs C++17 through an online community compiler: code is sent for execution, needs internet, is not stored, and does not support file I/O or interactive prompts. The notebook replays earlier cells for each run and only shows the selected cell output; use //@global or const declarations for shared globals. Each C++ code cell may include a stdin string (≤4000 chars).

C++ replay example (cells share declarations and run statements in order):
- Cell 1: struct Point { int x; }; (declaration is hoisted)
- Cell 2: Point p{3}; std::cout << p.x; (replayed with cell 1 on every run)

Authoring tips:
- Alternate short markdown explanations with small runnable code cells; one idea per cell; prefer 5–40 lines per code cell.
- Markdown is Arabic-friendly (direction detected per block); code, comments in code and output are always left-to-right. Avoid raw HTML. Math in LaTeX ($...$ / $$...$$).
- Image examples may only use the bundled sample images (test.png, testgray.png, pepper.png, Test2.png, GrayTest1.png, BinaryImage.png, GrayscaleImage.png, ColorImage.png, test_lookup.gif); learners can upload their own.
- Your own images (png/jpg/webp/gif; names are used exactly as written, never renamed): after create_notebook_import_link, attach each file the cells use to the SAME draft code — cells then use imread("cat.png") / ![](cat.png). Pick by size: ≤ ~200 KB → add_workspace_asset (base64: you must write every character, so never for bigger files); a public image link or a Drive file shared "Anyone with the link" → add_workspace_asset_from_url (server downloads it, any size ≤10 MB); a file on a disk you can run commands on (user attachment under /mnt/user-data/uploads, Claude Code / Cowork) → request_asset_upload and run the curl it returns. If none works (private Drive file, blocked network), do NOT skip silently: tell the user which images to add themselves (workspace panel → Upload, or Import from Google Drive in the editor). Limits: 10 MB per file, 20 MB per draft; files are temporary (they expire with the 72h draft) and are copied into the user's browser workspace for the notebook when they open the link.
- Only authored source is stored. Learner outputs/edits stay in the learner's browser (autosave) and are never graded or synced.
- Notebooks need NO admin approval: opening the link saves the notebook into the user's «محتواي» like quizzes and lessons.`,

  convert: `# Converting existing files / a whole folder (Google Drive, uploads, links)
Use this when the user shares a folder or several files (usually from Google Drive) and asks to convert / upload / move them to Basmagi. YOU decide what each file becomes — never push everything into one type.

## 1. Inventory (read-only, nothing created yet)
- List the folder RECURSIVELY with the Drive tools (search by parent folder, then each sub-folder). Keep for every item: name, mimeType, its own link (webViewLink) and folder path.
- Read each file's real content (Google Docs/Slides/Sheets and PDFs through the Drive read/download tools; scanned PDFs and images visually). If a file cannot be read (no text, no access, video/audio without a transcript) do NOT guess from its name: mark it "skipped" with the reason.
- Run search_catalog on the titles to spot content already on Basmagi (avoid duplicates; offer quizRef / lesson-reference links instead).

## 2. Classify every item
- Questions with choices/answers: past exams, midterms, question banks, worksheets, MCQ / true-false / essay sets (solved or unsolved) → QUIZ (create_quiz_import_link).
- Explanatory material: lecture slides, notes, summaries, book chapters, study guides, articles, solved examples → LESSON (create_lesson_import_link), each section ending with 1–3 check questions.
- Runnable MATLAB code: .m scripts and MATLAB labs → NOTEBOOK with runtime "matlab". C++ source and C++ Jupyter notebooks → NOTEBOOK with runtime "cpp" (create_notebook_import_link).
- Lecture or lab that mixes explanation with MANY questions → a lesson for the explanation + a separate quiz for the questions (after the quiz is published, a quizRef block can link it); only a few questions → keep them inside the lesson as question blocks. Ask when unsure.
- Code in other languages (Python, C, Java, JavaScript, SQL, and non-C++ Jupyter files) → NOT a runnable notebook. Offer a lesson with code in fenced blocks and say clearly that it will not run.
- Videos, audio, images only, zips, raw-data sheets, duplicates, drafts → skip, listed under "skipped" with the reason (a public https video/audio/image URL may be embedded as a media block inside a lesson).
- Rules of thumb: one exam file = one quiz; one lecture = one lesson; never merge unrelated files; split very large files into several drafts instead of truncating (respect the schema limits).
- Keep the source language (usually Arabic). Never invent questions, facts or code that are not in the file (solving unsolved questions and writing explanations is expected).
- source = the file's own Drive link (webViewLink); use the folder link only when one draft is built from several files.

## 3. Verify with the user BEFORE creating (ask ONCE)
- Send one compact table: file → proposed type (+ runtime) → proposed title → short reason. Ask only about what is ambiguous or unsupported and say which items you will do as proposed.
- Ask first when: the folder has more than about 5 items, an item fits two types, an item is unsupported code language (other than MATLAB or C++), or the user did not say which types they want.
- Do not ask (convert, then show the table) when the user already specified the types, said "just do it / convert everything", or the folder is small and every item is clearly one type.

## 4. Create
- One item at a time: read the file → build → dry_run if unsure → create_*_import_link → keep the link. Fix ERRORS and retry; mention important WARNINGS. For big results create the draft, then refine with update_import_draft instead of re-sending.
- A notebook that uses images from the folder: attach them with the asset tools described in the notebook guide (add_workspace_asset_from_url works with the Drive share link when the file is shared \"Anyone with the link\"); list in the final report any image the user must add by hand.
- Each item gets its own draft link; drafts live ${DRAFT_TTL_HOURS}h, so tell the user to open them soon. Opening a link saves that item straight into their «محتواي» (no editor step, no admin review for notebooks).

## 5. Final report
One table: file → type → draft link → warnings. Then "skipped" (with reasons) and anything needing the user's decision. Never say something was published.`,

  markdown: `# Markdown supported in lessons / quizzes
Headings, **bold**/*italic*, lists (nested), blockquotes, links, GFM tables, fenced code blocks (with copy button), images, inline audio/video (\`![audio](url)\`, \`![video](url)\`, YouTube auto-embed), KaTeX math ($inline$, $$display$$), and reading passages:
\`\`\`passage
Long reading text shown as a styled passage…
\`\`\`
Text direction is detected per block, so mixing Arabic and English is fine. Avoid raw HTML. Put formulas in LaTeX, never as images. Math: every formula, variable, exponent, fraction, root, Greek letter or math symbol in q/options/answer/explanation/lesson bodies must be LaTeX: $...$ inline, $$...$$ display. Never plain text (x^2, sqrt(x), 1/2, x², √, ≤). Escape backslashes in JSON (\\\\frac).`,
};

// ── Draft outline / patch / clone ───────────────────────────────────────────
// All human-facing numbers are 1-based (matching error messages and get_quiz text);
// `correct` / `correctIndex` stay zero-based, as everywhere else.

const clip = (s: unknown, n = 90) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
};

export function outlineQuiz(data: any): string {
  const qs: any[] = data?.questions || [];
  const lines = qs.map((q, i) => {
    const hasOpts = Array.isArray(q.options) && q.options.length > 0;
    const c = Array.isArray(q.correct) ? q.correct.join(",") : q.correct;
    const kind = !hasOpts ? "essay" : Array.isArray(q.correct) && q.correct.length > 1 ? "multi" : "mcq";
    return `${i + 1}. [${kind}${hasOpts ? ` ${q.options.length} opts, correct=${c}` : ""}${q.explanation ? "" : ", no explanation"}] ${clip(q.q)}`;
  });
  const m = data?.meta || {};
  return `title: ${m.title || ""}\ndescription: ${clip(m.description, 160)}\nsource: ${m.source || "(none)"}\nquestions: ${qs.length}\n\n${lines.join("\n")}`;
}

export function outlineLesson(data: any): string {
  const secs: any[] = data?.sections || [];
  const out = secs.map((s, i) => {
    const blocks: any[] = Array.isArray(s.blocks) ? s.blocks : typeof s.content === "string" ? [{ type: "markdown", body: s.content }] : [];
    const bl = blocks.map((b, j) => {
      const label = b.type === "markdown" ? clip(b.body, 70)
        : b.type === "media" ? `${b.kind || "image"} ${clip(b.url, 50)}`
        : b.type === "question" ? `${b.questionKind || "mcq"}: ${clip(b.prompt ?? b.q, 60)}`
        : b.type === "quizRef" ? `quiz ${b.quizId}`
        : b.type === "lesson-reference" || b.type === "lessonRef" ? `lesson ${b.lessonId ?? b.lessonRefId}`
        : EMBED_REF_BY_TYPE[b.type] ? `${EMBED_REF_BY_TYPE[b.type].type.replace("-reference", "")} ${b[EMBED_REF_BY_TYPE[b.type].field]}`
        : "";
      return `   ${i + 1}.${j + 1} [${b.type}] ${label}`;
    });
    return `${i + 1}. ${s.title || "(untitled)"}${s.defaultHidden ? " (hidden)" : ""}\n${bl.join("\n")}`;
  });
  const total = secs.reduce((n, s) => n + (Array.isArray(s.blocks) ? s.blocks.length : 0), 0);
  return `title: ${data?.title || ""}\ndescription: ${clip(data?.description, 160)}\nsource: ${data?.source || "(none)"}\nsections: ${secs.length}, blocks: ${total}\n\n${out.join("\n")}`;
}

const MAX_OPS = 200;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

function replaceTextDeep(node: any, find: string, rep: string, count: { n: number }): any {
  if (typeof node === "string") {
    const parts = node.split(find);
    count.n += parts.length - 1;
    return parts.join(rep);
  }
  if (Array.isArray(node)) return node.map((x) => replaceTextDeep(x, find, rep, count));
  if (node && typeof node === "object") {
    const o: any = {};
    for (const k of Object.keys(node)) o[k] = replaceTextDeep(node[k], find, rep, count);
    return o;
  }
  return node;
}

// Applies patch = { meta?, ops?[] } to stored draft data. Pure; returns the NEW raw data
// (still to be validated by validateQuiz/validateLesson) or { error }.
export function applyDraftPatch(kind: "quiz" | "lesson" | "notebook", data: any, patch: any): { data?: any; error?: string; applied?: string[] } {
  if (!patch || typeof patch !== "object") return { error: "patch يجب أن يكون كائناً: { meta?, ops? }." };
  const ops: any[] = Array.isArray(patch.ops) ? patch.ops : [];
  if (!ops.length && !patch.meta) return { error: "patch فارغ — أضف meta أو ops." };
  if (ops.length > MAX_OPS) return { error: `عدد العمليات يتجاوز ${MAX_OPS}.` };

  let d = clone(data);
  const applied: string[] = [];
  const list = kind === "quiz" ? "questions" : kind === "notebook" ? "cells" : "sections";
  const arr = () => d[list] as any[];

  const metaTarget = kind === "quiz" ? (d.meta = d.meta || {}) : d;
  if (patch.meta) {
    for (const k of kind === "notebook" ? ["title", "description", "source", "runtime"] : ["title", "description", "source"]) {
      if (patch.meta[k] !== undefined) { metaTarget[k] = patch.meta[k]; applied.push(`meta.${k}`); }
    }
  }

  const idx = (v: any, len: number, name: string, allowEnd = false): number => {
    const n = Number(v);
    const max = allowEnd ? len + 1 : len;
    if (!Number.isInteger(n) || n < 1 || n > max) throw new Error(`${name}=${JSON.stringify(v)} خارج النطاق 1..${max}.`);
    return n - 1;
  };
  const move = (a: any[], from: number, to: number) => { const [x] = a.splice(from, 1); a.splice(to, 0, x); };
  const blocksOf = (s: number) => {
    const sec = arr()[s];
    if (!Array.isArray(sec.blocks)) sec.blocks = typeof sec.content === "string" ? [{ type: "markdown", body: sec.content }] : [];
    return sec.blocks as any[];
  };

  try {
    ops.forEach((op, i) => {
      const at = `العملية ${i + 1} (${op?.op})`;
      try {
        const opKind = /_(question|questions)$/.test(op?.op) ? "quiz"
          : /_(cell|cells)$/.test(op?.op) ? "notebook"
          : /_(section|sections|block|blocks)$/.test(op?.op) ? "lesson" : "any";
        // An op that belongs to another content kind falls through to the default (unknown-op) error.
        switch (opKind === "any" || opKind === kind ? op?.op : "__wrong_kind__") {
          case "replace_text": {
            if (typeof op.find !== "string" || !op.find) throw new Error("find مطلوب.");
            const c = { n: 0 };
            d = replaceTextDeep(d, op.find, String(op.replace ?? ""), c);
            if (!c.n) throw new Error(`النص «${clip(op.find, 40)}» غير موجود.`);
            applied.push(`replace_text ×${c.n}`);
            break;
          }
          // quiz
          case "set_question": { const k = idx(op.at, arr().length, "at"); arr()[k] = op.question; applied.push(`set_question ${k + 1}`); break; }
          case "insert_question": { const k = idx(op.at, arr().length, "at", true); arr().splice(k, 0, op.question); applied.push(`insert_question ${k + 1}`); break; }
          case "append_questions": { if (!Array.isArray(op.questions)) throw new Error("questions مصفوفة مطلوبة."); arr().push(...op.questions); applied.push(`append_questions ×${op.questions.length}`); break; }
          case "delete_question": { const k = idx(op.at, arr().length, "at"); arr().splice(k, 1); applied.push(`delete_question ${k + 1}`); break; }
          case "move_question": { move(arr(), idx(op.at, arr().length, "at"), idx(op.to, arr().length, "to")); applied.push(`move_question`); break; }
          // notebook cells
          case "set_cell": { const k = idx(op.at, arr().length, "at"); arr()[k] = op.cell; applied.push(`set_cell ${k + 1}`); break; }
          case "insert_cell": { const k = idx(op.at, arr().length, "at", true); arr().splice(k, 0, op.cell); applied.push(`insert_cell ${k + 1}`); break; }
          case "append_cells": { if (!Array.isArray(op.cells)) throw new Error("cells مصفوفة مطلوبة."); arr().push(...op.cells); applied.push(`append_cells ×${op.cells.length}`); break; }
          case "delete_cell": { const k = idx(op.at, arr().length, "at"); arr().splice(k, 1); applied.push(`delete_cell ${k + 1}`); break; }
          case "move_cell": { move(arr(), idx(op.at, arr().length, "at"), idx(op.to, arr().length, "to")); applied.push(`move_cell`); break; }
          // lesson sections
          case "set_section": { const k = idx(op.at, arr().length, "at"); arr()[k] = op.section; applied.push(`set_section ${k + 1}`); break; }
          case "insert_section": { const k = idx(op.at, arr().length, "at", true); arr().splice(k, 0, op.section); applied.push(`insert_section ${k + 1}`); break; }
          case "append_sections": { if (!Array.isArray(op.sections)) throw new Error("sections مصفوفة مطلوبة."); arr().push(...op.sections); applied.push(`append_sections ×${op.sections.length}`); break; }
          case "delete_section": { const k = idx(op.at, arr().length, "at"); arr().splice(k, 1); applied.push(`delete_section ${k + 1}`); break; }
          case "move_section": { move(arr(), idx(op.at, arr().length, "at"), idx(op.to, arr().length, "to")); applied.push(`move_section`); break; }
          // lesson blocks (section = 1-based section number)
          case "set_block": { const s = idx(op.section, arr().length, "section"); const b = blocksOf(s); b[idx(op.at, b.length, "at")] = op.block; applied.push(`set_block ${s + 1}.${op.at}`); break; }
          case "insert_block": { const s = idx(op.section, arr().length, "section"); const b = blocksOf(s); b.splice(idx(op.at, b.length, "at", true), 0, op.block); applied.push(`insert_block ${s + 1}.${op.at}`); break; }
          case "append_blocks": { const s = idx(op.section, arr().length, "section"); if (!Array.isArray(op.blocks)) throw new Error("blocks مصفوفة مطلوبة."); blocksOf(s).push(...op.blocks); applied.push(`append_blocks ×${op.blocks.length} → ${s + 1}`); break; }
          case "delete_block": { const s = idx(op.section, arr().length, "section"); const b = blocksOf(s); b.splice(idx(op.at, b.length, "at"), 1); applied.push(`delete_block ${s + 1}.${op.at}`); break; }
          case "move_block": { const s = idx(op.section, arr().length, "section"); const b = blocksOf(s); move(b, idx(op.at, b.length, "at"), idx(op.to, b.length, "to")); applied.push(`move_block ${s + 1}`); break; }
          default: throw new Error(`عملية غير معروفة. المتاح: ${kind === "quiz"
            ? "set_question, insert_question, append_questions, delete_question, move_question, replace_text"
            : kind === "notebook"
            ? "set_cell, insert_cell, append_cells, delete_cell, move_cell, replace_text"
            : "set_section, insert_section, append_sections, delete_section, move_section, set_block, insert_block, append_blocks, delete_block, move_block, replace_text"}.`);
        }
      } catch (e: any) {
        throw new Error(`${at}: ${e.message}`);
      }
    });
  } catch (e: any) {
    return { error: e.message };
  }
  return { data: d, applied };
}

// Public quiz row → draft input (drops platform-only meta: id, path, author_id, createdAt, stats).
export function quizToDraftInput(quizData: any) {
  const m = quizData?.meta || {};
  return {
    title: m.title || quizData?.title || "",
    description: m.description || quizData?.description || "",
    source: /^https?:\/\//i.test(m.source || "") ? m.source : "",
    questions: (quizData?.questions || []).map((q: any) => ({ ...q })),
  };
}

export function notebookToDraftInput(row: any) {
  return {
    title: row?.title || "",
    description: row?.description || "",
    source: /^https?:\/\//i.test(row?.source || "") ? row.source : "",
    runtime: row?.runtime || "",
    cells: (row?.content?.cells || []).map((c: any) => ({ type: c.type, source: c.source, ...(typeof c.stdin === "string" ? { stdin: c.stdin } : {}), ...(c.challenge ? { challenge: c.challenge } : {}) })),
  };
}

export function outlineNotebook(data: any): string {
  const cells: any[] = data?.cells || data?.content?.cells || [];
  const lines = cells.map((c, i) => `${i + 1}. [${c.type}${c.challenge ? " 🏁challenge" : ""}] ${clip(c.source, 80)}`);
  return `title: ${data?.title || ""}\ndescription: ${clip(data?.description, 160)}\nsource: ${data?.source || "(none)"}\nruntime: ${data?.runtime || "(none)"}\ncells: ${cells.length}\n\n${lines.join("\n")}`;
}

export function lessonToDraftInput(row: any) {
  return {
    title: row?.title || "",
    description: row?.description || "",
    source: /^https?:\/\//i.test(row?.source || "") ? row.source : "",
    sections: row?.content?.sections || [],
  };
}
