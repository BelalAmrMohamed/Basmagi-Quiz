// public/src/components/quiz-info-modal/info-model.js
// Pure (no DOM, no network) helpers shared by the quiz / lesson / notebook
// info modals: source + date normalisation, quiz-path parsing, and the
// common model the shared renderer (buildInfoBodyHtml) consumes.

export const EDU_TYPE_LABELS = {
  University: "جامعي",
  High: "ثانوي",
  Middle: "إعدادي",
  Primary: "إبتدائي",
  Featured: "مادة مميزة",
};

/** Catalog flag, not a real source: `platform` (any case) means "no source". */
export function normalizeSource(value) {
  const s = String(value ?? "").trim();
  if (!s || /^platform$/i.test(s)) return null;
  return s;
}

const pad2 = (n) => String(n).padStart(2, "0");

/**
 * Any stored date → "YYYY-MM-DD" (or null). Accepts ISO strings, Date objects,
 * en-US "M/D/YYYY[, time]" strings and "YYYY-MM-DD - …" legacy strings.
 */
export function formatInfoDate(raw) {
  if (raw === null || raw === undefined || raw === "") return null;
  if (raw instanceof Date) {
    return Number.isNaN(raw.getTime()) ? null : `${raw.getFullYear()}-${pad2(raw.getMonth() + 1)}-${pad2(raw.getDate())}`;
  }
  const s = String(raw).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (m) return `${m[3]}-${pad2(m[1])}-${pad2(m[2])}`;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : formatInfoDate(new Date(t));
}

/** Full timestamp for a hover tooltip, or "". */
export function infoDateTitle(raw) {
  if (!raw) return "";
  const t = raw instanceof Date ? raw.getTime() : Date.parse(String(raw));
  return Number.isNaN(t) ? "" : new Date(t).toLocaleString("en-US");
}

const ROOT_SEGMENTS = {
  University: { eduType: "University", labels: ["college", "year", "term", "course"] },
  "Featured Courses": { eduType: "Featured", labels: ["course"] },
  "Primary-Schools": { eduType: "Primary", labels: ["year", "term", "course"] },
  "Primary School": { eduType: "Primary", labels: ["year", "term", "course"] },
  "Middle-Schools": { eduType: "Middle", labels: ["year", "term", "course"] },
  "Middle School": { eduType: "Middle", labels: ["year", "term", "course"] },
  "Secondary-Schools": { eduType: "High", labels: ["year", "term", "course"] },
  "High School": { eduType: "High", labels: ["year", "term", "course"] },
};

/**
 * Parses a quiz path ("University/College/3/1/Data Mining/Sub/quiz.json",
 * optionally "…/quizzes/…" or "?path=…") into classification, course and
 * folders. `hasFile` drops the trailing file name. Unknown layouts return
 * `{ course: lastFolder }` so callers never show a term/year as the course.
 */
export function parseQuizPath(rawPath, { hasFile = true } = {}) {
  const empty = { eduType: null, college: null, year: null, term: null, course: "", folders: [] };
  if (!rawPath) return empty;
  let raw = String(rawPath);
  try {
    const q = raw.indexOf("?");
    if (q !== -1) {
      const p = new URLSearchParams(raw.slice(q + 1)).get("path");
      raw = p ? decodeURIComponent(p) : raw.slice(0, q);
    }
  } catch (_) { /* keep raw */ }
  const parts = raw.split("/").map((p) => p.trim()).filter(Boolean);
  const rootIdx = parts.findIndex((p) => ROOT_SEGMENTS[p]);
  if (rootIdx === -1) {
    const dirs = hasFile ? parts.slice(0, -1) : parts;
    const meaningful = dirs.filter((p) => !/^\d+$/.test(p) && p.toLowerCase() !== "quizzes");
    return { ...empty, course: meaningful[meaningful.length - 1] || "" };
  }
  const { eduType, labels } = ROOT_SEGMENTS[parts[rootIdx]];
  const rest = parts.slice(rootIdx + 1, hasFile ? -1 : undefined);
  const out = { ...empty, eduType };
  labels.forEach((label, i) => {
    if (rest[i] === undefined) return;
    if (label === "year" || label === "term") out[label] = rest[i];
    else out[label] = rest[i];
  });
  out.folders = rest.slice(labels.length);
  return out;
}

const present = (v) => v !== null && v !== undefined && v !== "";

/**
 * Normalised model for the shared renderer.
 * @param {"quiz"|"lesson"|"notebook"} kind
 * @param {object} i  flat input; every field optional
 */
export function buildInfoModel(kind, i = {}) {
  const college = present(i.college) && i.college !== "All" ? String(i.college) : null;
  const eduType = i.eduTypeLabel || (i.eduType ? EDU_TYPE_LABELS[i.eduType] || i.eduType : null);
  const folders = (i.folders || []).map((f) => String(f).trim()).filter(Boolean);
  const created = formatInfoDate(i.createdAt);
  let updated = formatInfoDate(i.updatedAt);
  if (updated && updated === created) updated = null;
  return {
    kind,
    title: i.title || "",
    description: i.description || "",
    local: Boolean(i.local),
    passwordProtected: i.passwordProtected === true,
    classification: [
      ["نوع التعليم", eduType],
      ["الكلية", college],
      ["العام", present(i.year) ? String(i.year) : null],
      ["الترم", present(i.term) ? String(i.term) : null],
    ].filter(([, v]) => present(v)),
    course: i.course ? String(i.course).trim() : "",
    folders,
    created,
    createdTitle: infoDateTitle(i.createdAt),
    updated,
    updatedTitle: infoDateTitle(i.updatedAt),
    source: normalizeSource(i.source),
    link: i.link || null,
    linkLabel: i.linkLabel || "",
    linkAsText: Boolean(i.linkAsText),
    engagement: typeof i.engagementCount === "number" ? { count: i.engagementCount, label: i.engagementLabel || "" } : null,
    pills: i.pills || [],
    specific: (i.specific || []).filter((r) => present(r[1])),
    specificTitle: i.specificTitle || "",
    id: i.id ? String(i.id) : "",
  };
}
