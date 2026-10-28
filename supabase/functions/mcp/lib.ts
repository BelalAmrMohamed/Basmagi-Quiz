// =============================================================================
// supabase/functions/mcp/lib.ts
// Pure helpers for the Basmagi MCP server (no Deno / network globals), so they
// can be unit-tested with plain Node: tests/mcp-lib.test.js
//   - validateQuiz / validateLesson  → { ok, data, errors, warnings, stats }
//   - makeDraftCode                  → short unguessable code for import links
//   - CREATOR_INFO / AUTHORING_GUIDE → static content returned by tools
// =============================================================================

export const SITE = "https://basmagi-quiz.vercel.app";

export const LIMITS = {
  quizTitle: 100,
  quizDescription: 500,
  quizSource: 250,
  quizQuestions: 500,
  optionsMin: 2,
  optionsMax: 8, // lessons (matches the lesson editor)
  quizOptionsMax: 10,
  lessonTitle: 200,
  lessonDescription: 1200,
  lessonSource: 500,
  lessonSections: 60,
  blocksPerSection: 100,
  markdownBody: 20000,
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

export function validateQuiz(args: any) {
  const issues: Issues = { errors: [], warnings: [] };
  const { errors, warnings } = issues;

  const title = str(args?.title);
  if (!title) errors.push("title مطلوب.");
  if (title.length > LIMITS.quizTitle) errors.push(`title أطول من ${LIMITS.quizTitle} حرف (الحالي ${title.length}).`);

  const description = str(args?.description);
  if (description.length > LIMITS.quizDescription) {
    errors.push(`description أطول من ${LIMITS.quizDescription} حرف (الحالي ${description.length}).`);
  }
  if (!description) warnings.push("description فارغ — يُفضّل وصف قصير لما يقيسه الامتحان.");

  const source = str(args?.source);
  if (source && !isHttpUrl(source)) errors.push('source يجب أن يكون رابطاً كاملاً يبدأ بـ https:// (أو اتركه "").');
  if (source.length > LIMITS.quizSource) errors.push(`source أطول من ${LIMITS.quizSource} حرف.`);

  const rawQs = args?.questions;
  if (!Array.isArray(rawQs) || !rawQs.length) {
    errors.push("questions يجب أن تكون مصفوفة غير فارغة.");
    return { ok: false, data: null, errors, warnings, stats: null };
  }
  if (rawQs.length > LIMITS.quizQuestions) errors.push(`عدد الأسئلة يتجاوز ${LIMITS.quizQuestions}.`);

  let mcq = 0, multi = 0, essay = 0, noExplanation = 0;
  const seen = new Map<string, number>();

  const questions = rawQs.map((q: any, i: number) => {
    const n = i + 1;
    const text = str(q?.q);
    if (!text) errors.push(`السؤال ${n}: نص السؤال (q) مفقود.`);
    const explanation = str(q?.explanation);
    if (!explanation) noExplanation++;

    const key = text.toLowerCase().replace(/\s+/g, " ");
    if (key) {
      if (seen.has(key)) warnings.push(`السؤال ${n} مكرر للسؤال ${seen.get(key)}.`);
      else seen.set(key, n);
    }

    const hasOptions = Array.isArray(q?.options) && q.options.length > 0;
    const answer = str(q?.answer);

    // Essay / open-ended: no options at all. (Previously these got fake "نعم/لا" options.)
    if (!hasOptions) {
      if (!answer) {
        errors.push(`السؤال ${n}: لا يملك options ولا answer — أضف خيارات (اختيار من متعدد) أو answer (سؤال مقالي).`);
      }
      essay++;
      return { q: text, answer, explanation };
    }

    const options = q.options.map((o: any) => str(o));
    if (options.length < LIMITS.optionsMin || options.length > LIMITS.quizOptionsMax) {
      errors.push(`السؤال ${n}: عدد الخيارات ${options.length} — المسموح ${LIMITS.optionsMin} إلى ${LIMITS.quizOptionsMax}.`);
    }
    if (options.some((o: string) => !o)) errors.push(`السؤال ${n}: يوجد خيار فارغ.`);
    if (new Set(options.map((o: string) => o.toLowerCase())).size !== options.length) {
      warnings.push(`السؤال ${n}: يحتوي على خيارات مكررة.`);
    }

    const rawCorrect = Array.isArray(q.correct) ? q.correct : q.correct === undefined || q.correct === null ? [] : [q.correct];
    if (!rawCorrect.length) {
      errors.push(`السؤال ${n}: حقل correct مفقود (فهرس الإجابة الصحيحة يبدأ من 0) — لن أخمّن الإجابة.`);
    }
    const { idx, bad } = readCorrect(rawCorrect, options.length);
    if (bad.length) {
      errors.push(`السؤال ${n}: correct=${JSON.stringify(q.correct)} خارج النطاق (الفهارس الصالحة 0..${options.length - 1}).`);
    }
    const wantsMulti = q.multiSelect === true;
    if (wantsMulti && idx.length < 2) {
      warnings.push(`السؤال ${n}: multiSelect=true لكن توجد إجابة صحيحة واحدة فقط.`);
    }
    const multiSelect = wantsMulti || idx.length > 1;
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

  if (noExplanation) warnings.push(`${noExplanation} سؤال بلا explanation — الشرح هو ما يجعل الامتحان تعليمياً.`);

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

// ── Lesson ──────────────────────────────────────────────────────────────────

export function validateLesson(args: any) {
  const issues: Issues = { errors: [], warnings: [] };
  const { errors, warnings } = issues;

  const title = str(args?.title);
  if (!title) errors.push("title مطلوب.");
  if (title.length > LIMITS.lessonTitle) errors.push(`title أطول من ${LIMITS.lessonTitle} حرف.`);
  const description = str(args?.description);
  if (description.length > LIMITS.lessonDescription) errors.push(`description أطول من ${LIMITS.lessonDescription} حرف.`);
  if (!description) warnings.push("description فارغ.");
  const source = str(args?.source);
  if (source && !isHttpUrl(source)) errors.push('source يجب أن يكون رابطاً كاملاً يبدأ بـ https:// (أو اتركه "").');
  if (source.length > LIMITS.lessonSource) errors.push(`source أطول من ${LIMITS.lessonSource} حرف.`);

  const rawSections = Array.isArray(args?.sections)
    ? args.sections
    : Array.isArray(args?.content?.sections)
    ? args.content.sections
    : null;
  if (!rawSections || !rawSections.length) {
    errors.push("sections يجب أن تكون مصفوفة غير فارغة.");
    return { ok: false, data: null, errors, warnings, stats: null };
  }
  if (rawSections.length > LIMITS.lessonSections) errors.push(`عدد الأقسام يتجاوز ${LIMITS.lessonSections}.`);

  let blocksTotal = 0, questions = 0, markdownChars = 0;
  const sections = rawSections.map((s: any, sIdx: number) => {
    const sn = sIdx + 1;
    const secTitle = str(s?.title);
    if (!secTitle) errors.push(`القسم ${sn}: العنوان مطلوب.`);
    if (secTitle.length > 200) errors.push(`القسم ${sn}: العنوان أطول من 200 حرف.`);

    const rawBlocks = Array.isArray(s?.blocks)
      ? s.blocks
      : typeof s?.content === "string"
      ? [{ type: "markdown", body: s.content }]
      : [];
    if (!rawBlocks.length) warnings.push(`القسم ${sn} («${secTitle}») بلا عناصر.`);
    if (rawBlocks.length > LIMITS.blocksPerSection) errors.push(`القسم ${sn}: أكثر من ${LIMITS.blocksPerSection} عنصر.`);

    const blocks: any[] = [];
    rawBlocks.forEach((b: any, bIdx: number) => {
      if (!b || typeof b !== "object") return;
      const at = `القسم ${sn} / العنصر ${bIdx + 1}`;
      const type = b.type || (b.prompt || b.q ? "question" : "markdown");
      blocksTotal++;

      if (type === "markdown") {
        const body = String(b.body ?? b.content ?? "");
        if (!body.trim()) warnings.push(`${at}: نص markdown فارغ.`);
        if (body.length > LIMITS.markdownBody) errors.push(`${at}: النص يتجاوز ${LIMITS.markdownBody} حرف — قسّمه إلى عناصر.`);
        markdownChars += body.length;
        blocks.push({ type: "markdown", body });
      } else if (type === "media") {
        const url = str(b.url);
        if (!url) errors.push(`${at}: رابط الوسائط (url) مفقود.`);
        else if (!isHttpUrl(url) && !url.startsWith("./") && !url.startsWith("/")) errors.push(`${at}: url غير صالح.`);
        const kind = ["image", "audio", "video"].includes(b.kind) ? b.kind : "image";
        blocks.push({ type: "media", url, kind, ...(b.alt ? { alt: str(b.alt).slice(0, 200) } : {}) });
      } else if (type === "quizRef") {
        const quizId = str(b.quizId);
        if (!quizId) errors.push(`${at}: quizId مفقود.`);
        blocks.push({ type: "quizRef", quizId, ...(b.title ? { title: str(b.title).slice(0, 200) } : {}) });
      } else if (type === "lesson-reference" || type === "lessonRef") {
        const lessonId = str(b.lessonId ?? b.lessonRefId);
        if (!lessonId) errors.push(`${at}: lessonId مفقود.`);
        blocks.push({
          type: "lesson-reference",
          lessonId,
          ...(b.title ? { title: str(b.title).slice(0, 200) } : {}),
          ...(b.slug ? { slug: str(b.slug).slice(0, 200) } : {}),
        });
      } else if (type === "question") {
        questions++;
        const prompt = str(b.prompt ?? b.q);
        if (!prompt) errors.push(`${at}: نص السؤال (prompt) مفقود.`);
        const explanation = str(b.explanation).slice(0, 10000);
        const hasOptions = Array.isArray(b.options) && b.options.length > 0;
        const isEssay = b.questionKind === "essay" || (!hasOptions && !!(b.modelAnswer || b.answer));

        if (isEssay) {
          const modelAnswer = str(b.modelAnswer ?? b.answer);
          if (!modelAnswer) errors.push(`${at}: السؤال المقالي يحتاج modelAnswer.`);
          blocks.push({ type: "question", questionKind: "essay", prompt, modelAnswer, ...(explanation ? { explanation } : {}) });
        } else {
          if (!hasOptions) {
            errors.push(`${at}: سؤال بلا options — أضف خيارات أو اجعله مقالياً (questionKind:"essay" + modelAnswer).`);
          }
          const options = (hasOptions ? b.options : []).map((o: any) => str(o));
          if (hasOptions && (options.length < LIMITS.optionsMin || options.length > LIMITS.optionsMax)) {
            errors.push(`${at}: عدد الخيارات ${options.length} — المسموح ${LIMITS.optionsMin} إلى ${LIMITS.optionsMax}.`);
          }
          if (options.some((o: string) => !o)) errors.push(`${at}: يوجد خيار فارغ.`);
          const rawCorrect = Array.isArray(b.correctIndexes)
            ? b.correctIndexes
            : Array.isArray(b.correct)
            ? b.correct
            : Number.isInteger(b.correctIndex)
            ? [b.correctIndex]
            : Number.isInteger(b.correct)
            ? [b.correct]
            : [];
          if (hasOptions && !rawCorrect.length) errors.push(`${at}: correctIndex مفقود (يبدأ من 0) — لن أخمّن الإجابة.`);
          const { idx, bad } = readCorrect(rawCorrect, options.length);
          if (bad.length) errors.push(`${at}: الفهرس الصحيح خارج النطاق 0..${options.length - 1}.`);
          const multiSelect = b.multiSelect === true || idx.length > 1;
          if (!explanation) warnings.push(`${at}: سؤال بلا explanation.`);
          blocks.push({
            type: "question",
            questionKind: "mcq",
            prompt,
            options,
            ...(multiSelect ? { multiSelect: true, correctIndexes: idx } : { correctIndex: idx[0] ?? 0 }),
            ...(explanation ? { explanation } : {}),
          });
        }
      } else {
        errors.push(`${at}: type="${type}" غير معروف (المسموح: markdown, media, quizRef, lesson-reference, question).`);
      }
    });

    return { title: secTitle, defaultHidden: Boolean(s?.defaultHidden), blocks };
  });

  const data = { title, description, source, sections };
  const bytes = new TextEncoder().encode(JSON.stringify(data)).length;
  if (bytes > LIMITS.draftBytes) errors.push(`حجم الدرس ${Math.round(bytes / 1024)}KB يتجاوز ${LIMITS.draftBytes / 1000}KB.`);

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

export function draftUrl(kind: "quiz" | "lesson", code: string) {
  return `${SITE}/create-${kind}?draft=${code}`;
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
- ${SITE}/how-to-create-a-quiz — شرح إنشاء امتحان
- ${SITE}/how-to-upload-a-quiz — شرح رفع امتحان
- ${SITE}/how-to-use-ai-agent — شرح استخدام المساعد الذكي
- ${SITE}/privacy-policy · ${SITE}/terms-of-service`,
};

export const AUTHORING_GUIDE: Record<string, string> = {
  workflow: `# Basmagi — Claude's authoring workflow
1. Call get_authoring_guide topic=quiz|lesson|markdown once per conversation (this text).
2. Source material attached by the user → read it fully; do NOT invent facts. Unsolved questions → solve them carefully, then explain.
3. Build the object, then call create_quiz_import_link / create_lesson_import_link.
   - Result is ONE short link: ${SITE}/create-quiz?draft=<code> (valid ${DRAFT_TTL_HOURS}h, no sign-in needed).
   - If the result lists ERRORS nothing was saved: fix exactly what it says and call again.
   - WARNINGS are saved but worth fixing; mention important ones to the user.
4. Give the user the link as-is (never edit/re-encode it) and tell them to open it, review, then press save/publish in the editor. Nothing is published until they do.
5. Revising: do NOT rebuild and re-send everything.
   - get_import_draft(code) → numbered outline → update_import_draft(code, patch) with only the change (same link stays valid; 1-based positions; atomic).
   - Improve/translate/extend something that already exists: clone_to_draft(type,id), then patch. Inspect originals cheaply with get_quiz / get_lesson_content format="outline".
   - Not sure the content is valid? create_*_import_link with dry_run=true validates without saving.
   - Re-opening an updated link REPLACES whatever is currently in the user's editor, so patch before they start editing, and say so.
6. Check for existing content first with search_catalog to avoid duplicates, and offer to link related lessons/quizzes (quizRef / lesson-reference blocks).
Language: write quiz/lesson text in the language of the source material (usually Arabic). Keep tool arguments (field names) in English.`,

  quiz: `# Quiz schema (create_quiz_import_link)
{ title (≤${LIMITS.quizTitle}), description (≤${LIMITS.quizDescription}), source ("https://…" or ""),
  questions: [ ... ≤${LIMITS.quizQuestions} ] }

Question kinds — decided by which fields exist:
- Single-answer MCQ:  { q, options: [2..${LIMITS.quizOptionsMax} strings], correct: <zero-based int>, explanation }
- Multi-answer MCQ:   { q, options, correct: [0, 2], multiSelect: true, explanation }
- True/False:         { q, options: ["صح","خطأ"], correct: 0|1, explanation }
- Essay/open-ended:   { q, answer: "<model answer>", explanation }   ← NO options key at all

Rules the server enforces: correct is ZERO-based and must be in range (it never guesses a missing answer); options are non-empty and ≤${LIMITS.quizOptionsMax} (lesson questions: ≤${LIMITS.optionsMax}); source must be a real URL or empty.
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

Structure tips: one idea per section; a short markdown intro, the explanation, then 1–3 check-yourself questions at the end of each section; a final "ملخص / مراجعة" section; set defaultHidden:true for long optional material (e.g. worked solutions). Lessons are never scored — questions are for self-check.`,

  markdown: `# Markdown supported in lessons / quizzes
Headings, **bold**/*italic*, lists (nested), blockquotes, links, GFM tables, fenced code blocks (with copy button), images, inline audio/video (\`![audio](url)\`, \`![video](url)\`, YouTube auto-embed), KaTeX math ($inline$, $$display$$), and reading passages:
\`\`\`passage
Long reading text shown as a styled passage…
\`\`\`
Text direction is detected per block, so mixing Arabic and English is fine. Avoid raw HTML. Put formulas in LaTeX, never as images.`,
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
export function applyDraftPatch(kind: "quiz" | "lesson", data: any, patch: any): { data?: any; error?: string; applied?: string[] } {
  if (!patch || typeof patch !== "object") return { error: "patch يجب أن يكون كائناً: { meta?, ops? }." };
  const ops: any[] = Array.isArray(patch.ops) ? patch.ops : [];
  if (!ops.length && !patch.meta) return { error: "patch فارغ — أضف meta أو ops." };
  if (ops.length > MAX_OPS) return { error: `عدد العمليات يتجاوز ${MAX_OPS}.` };

  let d = clone(data);
  const applied: string[] = [];
  const list = kind === "quiz" ? "questions" : "sections";
  const arr = () => d[list] as any[];

  const metaTarget = kind === "quiz" ? (d.meta = d.meta || {}) : d;
  if (patch.meta) {
    for (const k of ["title", "description", "source"]) {
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
        switch (op?.op) {
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

export function lessonToDraftInput(row: any) {
  return {
    title: row?.title || "",
    description: row?.description || "",
    source: /^https?:\/\//i.test(row?.source || "") ? row.source : "",
    sections: row?.content?.sections || [],
  };
}
