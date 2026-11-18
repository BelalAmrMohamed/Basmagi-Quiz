// =============================================================================
// public/src/components/ai-agent/ai-agent-suggested-prompts.js
// Default "quick prompt" chips shown above the chat input before the user
// sends their first message — one tap fills + sends that exact text.
// Modernized for multi-tool agentic workflows: chaining search, creation,
// in-place editing, folder organization, interactive notebooks, and lessons.
// =============================================================================

export const HOME_PAGE_SUGGESTED_PROMPTS = [
  "أنشئ مجلدًا جديدًا لمادة 'الذكاء الاصطناعي'، واصنع بداخله درسًا تأسيسيًا وامتحانًا تدريبيًا عليه.",
  "ابحث في المكتبة عن موضوع 'التفاضل والتكامل' وافحصه، ثم أنشئ لي منه امتحانًا شاملاً مع شروحات نموذجية.",
  "افحص آخر امتحان أو درس أنشأته، وراجع جودة الأسئلة وحسّن المشتتات وأضف شروحات علمية مباشرة.",
  "أنشئ دفتر أكواد تفاعلي بلغة C++ يشرح الخوارزميات مع خلايا برمجية جاهزة للتنفيذ وتحديات ذكية.",
  "حوّل محتوى آخر درس عندي إلى امتحان اختيار من متعدد ومجموعة بطاقات استذكار سريعة (Flashcards).",
  "نظّم محتواي: أنشئ مادة باسم 'العلوم الطبية' وانقل كل الامتحانات والدروس المرتبطة إليها.",
];

// Create-quiz page ("إنشاء امتحان") — scoped to the single in-progress
// quiz on that page, with deep generation, auditing, and restructuring tools.
export const CREATE_QUIZ_PAGE_SUGGESTED_PROMPTS = [
  "حلل الأسئلة الحالية، وأضف 3 أسئلة جديدة تغطي الثغرات مع تفسيرات علمية دقيقة لكل إجابة.",
  "حوّل هذا الملف المرفق إلى امتحان متكامل (اختيار من متعدد، إكمال، ومقالي بنموذج إجابة معتمد).",
  "راجع صياغة الأسئلة الحالية وطوّر الخيارات الضعيفة واكتب شروحات وافية لجميع الإجابات.",
  "أضف أسئلة إكمال فراغات باستخدام {{blank}} وسؤالاً مقالياً بنموذج تصحيح ذكي للتقييم التلقائي.",
];

// Notebook page ("دفتر الأكواد") — interactive execution, bug fixing, and challenges.
export const NOTEBOOK_PAGE_SUGGESTED_PROMPTS = [
  "شغّل خلايا الكود بالترتيب، وحلل المخرجات، وأصلح أي خطأ برمجي يظهر في التنفيذ تلقائيًا.",
  "أضف خلية شرح ماركداون جديدة تليها خلية كود تطبيقية تحل المسألة خطوة بخطوة.",
  "حوّل آخر جزء برمجي إلى تحدٍ تفاعلي (Challenge) مع اختبارات تحقق وتلميحات تدريجية.",
  "راجع كفاءة الكود المقترح واقترح تحسينات للأداء (Optimization) مع شرح التعديلات.",
];

// Lesson page ("عرض الدرس") — concept mastery, interactive extraction, and flashcards.
export const LESSON_PAGE_SUGGESTED_PROMPTS = [
  "استخرج أهم المفاهيم من هذا الدرس وأنشئ لي امتحانًا تفاعليًا متدرج الصعوبة لاختبار استيعابي.",
  "اصنع لي دفتر أكواد عملي يطبق المفاهيم البرمجية/الرياضية المشروحة في هذا الدرس خطوة بخطوة.",
  "لخّص الدرس في نقاط مكثفة، وأنشئ بطاقات استذكار (Flashcards) لمراجعة المفاهيم الأساسية.",
  "اشرح لي الجزء الأكثر تعقيدًا في هذا الدرس بمثال واقعي مدعوم بسؤال فحص فهم سريع.",
];

// Create-lesson page ("إنشاء / تحرير درس") — structured authoring with embedded assessments.
export const CREATE_LESSON_PAGE_SUGGESTED_PROMPTS = [
  "أنشئ قسماً تعليمياً متكاملاً يتضمن شرحاً غنياً بالماركداون ومثالاً تطبيقياً وسؤال فحص فهم مضمّن.",
  "حوّل هذا الملف المرفق إلى هيكل درس تفاعلي مقسّم إلى أقسام تدريجية مدعومة بالأسئلة.",
  "أضف أسئلة اختيار من متعدد وإكمال فراغات مدمجة بين أقسام الدرس لتعزيز تفاعل الطالب.",
  "راجع ترابط الأقسام وصياغة المحتوى التعليمي، واقترح أمثلة توضيحية إضافية للأفكار الصعبة.",
];

/**
 * Builds dynamic suggested prompts based on the user's exam performance.
 * Employs multi-tool reasoning: error diagnostics, remedial tests, and flashcards.
 * @param {object} summary - same shape as resultSummaryForAI in result.js
 * @returns {string[]}
 */
export function buildResultSuggestedPrompts(summary) {
  const percentage = typeof summary?.percentage === "number" ? summary.percentage : 100;
  const hasErrors = Array.isArray(summary?.questions) && summary.questions.some((q) => q.isCorrect === false);

  if (hasErrors && percentage < 60) {
    return [
      "حلل جميع الأسئلة التي أخطأت فيها واشرح لي سبب الخطأ والمفهوم الصحيح بالتفصيل.",
      "أنشئ لي امتحانًا تعويضيًا يركز تحديدًا على المفاهيم التي تعثرت فيها فقط لإتقانها.",
      "اصنع لي بطاقات استذكار (Flashcards) للنقاط والقوانين التي خسرت فيها درجات.",
      "ارسم لي خطة مذاكرة مكثفة لعلاج نقاط الضعف التي ظهرت في هذا الامتحان.",
    ];
  }

  if (hasErrors) {
    return [
      "اشرح لي الأسئلة غير الصحيحة، وكيف أميز بين الإجابة الصحيحة وأقرب مشتت ذكي.",
      "أنشئ لي 3 أسئلة تدريبية بديلة عن نفس الجزئيات التي أخطأت فيها للتأكد من فهمي.",
      "لخّص لي الفروق الجوهرية في المفاهيم التي التبست عليّ في هذا الاختبار.",
    ];
  }

  // High score / Perfect score
  return [
    "حللت الامتحان بنجاح كبير! أنشئ لي امتحان تحدي متقدم بأسئلة تفكير عليا في نفس المادة.",
    "اصنع لي درساً أو دفتر أكواد متقدماً يوسع معرفتي بمستوى أعلى من هذا الامتحان.",
    "لخّص لي أهم الأفكار المتقدمة وتطبيقاتها العملية في سوق العمل المرتبطة بهذا الموضوع.",
  ];
}
