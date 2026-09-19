// ============================================================================
// public/src/features/lesson/lesson-reader-prefs.js
// READER PREFERENCES — font family, highlight color, and TTS voice/rate.
// ============================================================================
// ONE combined localStorage key for all of it (deliberately not three
// separate keys — see the lessons plan's Phase 2 step 9), so the whole
// reader-prefs object is read and written atomically and Phase 4 has a
// single place to look.
//
// These are reader choices, not author choices: `lessons.reader_prefs_default`
// supplies the author's optional starting point, and anything the reader
// picks here overrides it for that reader only, on this device only.
// ============================================================================

import { getFromStorage, setInStorage } from "../../shared/storage-helpers.js";

const READER_PREFS_KEY = "lesson_reader_prefs";

// Font choices are intentionally a small curated set rather than a free-text
// family, so a stored value can never inject arbitrary CSS into the inline
// style attribute the viewer sets (see applyReaderPrefs below).
export const FONT_CHOICES = [
  { id: "default", label: "الخط الافتراضي", value: "" },
  { id: "tajawal", label: "Tajawal", value: '"Tajawal", sans-serif' },
  { id: "cairo", label: "Cairo", value: '"Cairo", sans-serif' },
  { id: "amiri", label: "Amiri (نسخ)", value: '"Amiri", serif' },
  { id: "inter", label: "Inter", value: '"Inter", sans-serif' },
];

export const HIGHLIGHT_CHOICES = [
  { id: "yellow", label: "أصفر", value: "rgba(250, 204, 21, 0.38)" },
  { id: "green", label: "أخضر", value: "rgba(34, 197, 94, 0.30)" },
  { id: "blue", label: "أزرق", value: "rgba(59, 130, 246, 0.30)" },
  { id: "pink", label: "وردي", value: "rgba(236, 72, 153, 0.30)" },
];

export function buildDefaultReaderPrefs() {
  return { fontId: "default", highlightId: "yellow", ttsVoiceURI: "", ttsRate: 1 };
}

/**
 * Reads the combined prefs object, falling back to the author-set default
 * from `lessons.reader_prefs_default` for any field the reader hasn't
 * explicitly chosen yet.
 *
 * @param {object|null} authorDefaults - lesson.reader_prefs_default
 */
export function getReaderPrefs(authorDefaults = null) {
  const base = { ...buildDefaultReaderPrefs(), ...(authorDefaults || {}) };
  try {
    const raw = getFromStorage(READER_PREFS_KEY, null);
    if (!raw) return base;
    const parsed = JSON.parse(raw);
    return { ...base, ...(parsed && typeof parsed === "object" ? parsed : {}) };
  } catch (err) {
    console.error("[lesson-reader-prefs] Could not read prefs:", err);
    return base;
  }
}

/** Merges a partial update into the stored prefs object and persists it. */
export function setReaderPrefs(patch) {
  const next = { ...getReaderPrefs(), ...(patch || {}) };
  try {
    setInStorage(READER_PREFS_KEY, JSON.stringify(next));
  } catch (err) {
    console.error("[lesson-reader-prefs] Could not save prefs:", err);
  }
  return next;
}

/**
 * Applies font/highlight prefs to a container as inline CSS variables.
 *
 * Scoped to the lesson container on purpose: --md-font-family and
 * --md-highlight-color are the shared markdown engine's hooks (see
 * markdown-css.js), so setting them here changes only this subtree and
 * leaves every other renderMarkdown() call site on the platform untouched.
 *
 * Values come from the curated maps above rather than from storage
 * directly, so a hand-edited localStorage value can't inject CSS.
 *
 * @param {HTMLElement} container
 * @param {object} prefs
 */
export function applyReaderPrefs(container, prefs) {
  if (!container) return;
  const font = FONT_CHOICES.find((f) => f.id === prefs?.fontId);
  const highlight = HIGHLIGHT_CHOICES.find((h) => h.id === prefs?.highlightId);

  if (font && font.value) container.style.setProperty("--md-font-family", font.value);
  else container.style.removeProperty("--md-font-family");

  if (highlight) container.style.setProperty("--md-highlight-color", highlight.value);
  else container.style.removeProperty("--md-highlight-color");
}
