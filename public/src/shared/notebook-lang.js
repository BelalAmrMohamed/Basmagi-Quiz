// Notebook UI language (en|ar). Notebooks carry an explicit `language`; when it
// is missing (older notebooks) it is inferred from the title/description/text cells.
export const NOTEBOOK_LANGS = ["en", "ar"];

const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿ]/g;
const LATIN = /[A-Za-z]/g;

export function normalizeNotebookLang(value) {
  const v = String(value || "").toLowerCase();
  return NOTEBOOK_LANGS.includes(v) ? v : "";
}

/** "ar" when Arabic letters outnumber Latin letters in the prose (markdown cells, title, description), else "en". */
export function detectNotebookLang({ title = "", description = "", cells = [] } = {}) {
  const prose = [title, description, ...cells.filter((c) => c && c.type !== "code").map((c) => c.source || "")].join("\n");
  const ar = (prose.match(ARABIC) || []).length;
  const en = (prose.match(LATIN) || []).length;
  return ar > en ? "ar" : "en";
}

export function resolveNotebookLang(explicit, info) {
  return normalizeNotebookLang(explicit) || detectNotebookLang(info);
}

const STRINGS = {
  en: {
    loading: "Loading notebook…", retry: "Retry", home: "Back to home",
    disclaimer: "This notebook runs entirely in your browser with an educational MATLAB-style interpreter — not the original MATLAB. Your work is kept on your device and never sent to a server or counted in scores.",
    invalid: "Invalid notebook link.", loadFailed: "Could not load the notebook.", runtimeFailed: "Could not load the notebook runtime. Check your connection and retry.", mountFailed: "Could not run the notebook in this browser.",
  },
  ar: {
    loading: "جاري تحميل الدفتر…", retry: "إعادة المحاولة", home: "العودة إلى الصفحة الرئيسية",
    disclaimer: "يعمل هذا الدفتر داخل متصفحك فقط بمفسّر تعليمي بأسلوب MATLAB — وليس MATLAB الأصلي. عملك محفوظ محلياً على جهازك ولا يُرسل إلى أي خادم ولا يُحتسب في الدرجات.",
    invalid: "رابط الدفتر غير صالح.", loadFailed: "تعذر تحميل الدفتر.", runtimeFailed: "تعذر تحميل بيئة تشغيل الدفتر. تحقق من اتصالك ثم أعد المحاولة.", mountFailed: "تعذر تشغيل الدفتر في هذا المتصفح.",
  },
};
export const notebookText = (lang, key) => (STRINGS[lang] || STRINGS.en)[key];
