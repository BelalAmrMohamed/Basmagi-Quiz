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
    disclaimer: "This MATLAB-style notebook runs in your browser. Your work is kept on your device and never sent to a server or counted in scores.",
    disclaimerCpp: "C++ code is sent to an online compiler to run. It is not stored, requires an internet connection, and your notebook work itself stays on this device.",
    invalid: "Invalid notebook link.", loadFailed: "Could not load the notebook.", runtimeFailed: "Could not load the notebook runtime. Check your connection and retry.", mountFailed: "Could not run the notebook in this browser.",
  },
  ar: {
    loading: "جاري تحميل الدفتر…", retry: "إعادة المحاولة", home: "العودة إلى الصفحة الرئيسية",
    disclaimer: "يعمل دفتر MATLAB التعليمي داخل متصفحك. يبقى عملك على جهازك ولا يُرسل إلى خادم ولا يُحتسب في الدرجات.",
    disclaimerCpp: "يُرسل كود C++ إلى مترجم عبر الإنترنت لتشغيله. لا يُخزّن الكود، ويتطلب التشغيل اتصالاً بالإنترنت، بينما يبقى عملك في الدفتر على هذا الجهاز.",
    invalid: "رابط الدفتر غير صالح.", loadFailed: "تعذر تحميل الدفتر.", runtimeFailed: "تعذر تحميل بيئة تشغيل الدفتر. تحقق من اتصالك ثم أعد المحاولة.", mountFailed: "تعذر تشغيل الدفتر في هذا المتصفح.",
  },
};
export const notebookText = (lang, key, runtime) => { const strings=STRINGS[lang]||STRINGS.en; return runtime === "cpp" && key === "disclaimer" ? strings.disclaimerCpp : strings[key]; };
