// ============================================================================
// READER PREFERENCES — one shared state source for every lesson preference UI.
// ============================================================================
// The lesson page and its information modal both bind to this module. The
// persisted localStorage object is the source of truth; same-tab writes also
// dispatch a dedicated event so every mounted control updates immediately.

import { getFromStorage, setInStorage } from "../../shared/storage-helpers.js";

const READER_PREFS_KEY = "lesson_reader_prefs";
const PREFS_EVENT = "lesson-reader-prefs-change";

export const FONT_CHOICES = [
  { id: "default", label: "الخط الافتراضي", value: "" },
  { id: "tajawal", label: "Tajawal", value: '"Tajawal", sans-serif' },
  { id: "cairo", label: "Cairo", value: '"Cairo", sans-serif' },
  { id: "amiri", label: "Amiri (نسخ)", value: '"Amiri", serif' },
  { id: "inter", label: "Inter", value: '"Inter", sans-serif' },
];

export function normalizeFontId(fontId) {
  return FONT_CHOICES.some((item) => item.id === fontId) ? fontId : "default";
}

export const WIDTH_CHOICES = [
  { id: "comfortable", label: "مريح", value: "820px" },
  { id: "wide", label: "عريض", value: "1080px" },
  { id: "narrow", label: "ضيق", value: "640px" },
];

export const TEXT_SIZE_CHOICES = [
  { id: "medium", label: "متوسط", value: "1rem" },
  { id: "large", label: "كبير", value: "1.125rem" },
  { id: "xlarge", label: "كبير جداً", value: "1.25rem" },
];

export function buildDefaultReaderPrefs() {
  return {
    fontId: "default",
    ttsVoiceURI: "",
    ttsRate: 1,
    widthId: "comfortable",
    textSizeId: "medium",
    focusMode: false,
  };
}

function sanitizeReaderPrefs(value) {
  const raw = value && typeof value === "object" ? value : {};
  const result = { ...buildDefaultReaderPrefs() };

  result.fontId = normalizeFontId(raw.fontId);
  if (WIDTH_CHOICES.some((item) => item.id === raw.widthId)) result.widthId = raw.widthId;
  if (TEXT_SIZE_CHOICES.some((item) => item.id === raw.textSizeId)) result.textSizeId = raw.textSizeId;
  if (typeof raw.ttsVoiceURI === "string") result.ttsVoiceURI = raw.ttsVoiceURI;
  if (Number.isFinite(Number(raw.ttsRate))) result.ttsRate = Math.min(2, Math.max(0.5, Number(raw.ttsRate)));
  if (typeof raw.focusMode === "boolean") result.focusMode = raw.focusMode;

  return result;
}

/**
 * Reads the global reader preferences. Author defaults only seed a field when
 * there is no reader-level choice stored for that field.
 */
export function getReaderPrefs(authorDefaults = null) {
  const base = sanitizeReaderPrefs({ ...buildDefaultReaderPrefs(), ...(authorDefaults || {}) });
  try {
    const raw = getFromStorage(READER_PREFS_KEY, null);
    if (!raw) return base;
    const parsed = JSON.parse(raw);
    const sanitized = sanitizeReaderPrefs({ ...base, ...(parsed && typeof parsed === "object" ? parsed : {}) });
    if (parsed && typeof parsed === "object" && Object.prototype.hasOwnProperty.call(parsed, "highlightId")) {
      setInStorage(READER_PREFS_KEY, JSON.stringify(sanitized));
    }
    return sanitized;
  } catch (err) {
    console.error("[lesson-reader-prefs] Could not read prefs:", err);
    return base;
  }
}

/** Persists a partial update and immediately notifies every mounted control. */
export function setReaderPrefs(patch, authorDefaults = null) {
  const next = sanitizeReaderPrefs({ ...getReaderPrefs(authorDefaults), ...(patch || {}) });
  try {
    setInStorage(READER_PREFS_KEY, JSON.stringify(next));
  } catch (err) {
    console.error("[lesson-reader-prefs] Could not save prefs:", err);
  }
  window.dispatchEvent(new CustomEvent(PREFS_EVENT, { detail: next }));
  return next;
}

/**
 * Binds any reader-preference control set to the shared source of truth.
 * Controls use data-reader-pref values so the modal can have completely
 * different markup/classes without duplicating preference logic.
 *
 * @param {HTMLElement} root
 * @param {HTMLElement} lessonEl
 * @param {object|null} authorDefaults
 * @returns {()=>void}
 */
export function equipReaderPrefs(root, lessonEl, authorDefaults = null) {
  if (!root || !lessonEl) return () => {};

  const sync = (prefs) => {
    root.querySelectorAll('[data-reader-pref="font"]').forEach((el) => { el.value = prefs.fontId; });
    root.querySelectorAll('[data-reader-pref="width"]').forEach((el) => { el.value = prefs.widthId; });
    root.querySelectorAll('[data-reader-pref="text-size"]').forEach((el) => { el.value = prefs.textSizeId; });
    root.querySelectorAll('[data-reader-pref="focus"]').forEach((el) => { el.checked = Boolean(prefs.focusMode); });
    applyReaderPrefs(lessonEl, prefs);
  };

  const onPrefEvent = (event) => sync(event.detail || getReaderPrefs(authorDefaults));
  const onStorage = (event) => {
    if (event.key === READER_PREFS_KEY) sync(getReaderPrefs(authorDefaults));
  };

  root.querySelectorAll('[data-reader-pref="font"]').forEach((el) => {
    el.addEventListener("change", (event) => setReaderPrefs({ fontId: event.target.value }, authorDefaults));
  });
  root.querySelectorAll('[data-reader-pref="width"]').forEach((el) => {
    el.addEventListener("change", (event) => setReaderPrefs({ widthId: event.target.value }, authorDefaults));
  });
  root.querySelectorAll('[data-reader-pref="text-size"]').forEach((el) => {
    el.addEventListener("change", (event) => setReaderPrefs({ textSizeId: event.target.value }, authorDefaults));
  });
  root.querySelectorAll('[data-reader-pref="focus"]').forEach((el) => {
    el.addEventListener("change", (event) => setReaderPrefs({ focusMode: Boolean(event.target.checked) }, authorDefaults));
  });

  window.addEventListener(PREFS_EVENT, onPrefEvent);
  window.addEventListener("storage", onStorage);
  sync(getReaderPrefs(authorDefaults));

  return () => {
    window.removeEventListener(PREFS_EVENT, onPrefEvent);
    window.removeEventListener("storage", onStorage);
  };
}

export function applyReaderPrefs(container, prefs) {
  if (!container) return;
  const font = FONT_CHOICES.find((item) => item.id === normalizeFontId(prefs?.fontId));
  const width = WIDTH_CHOICES.find((item) => item.id === prefs?.widthId) || WIDTH_CHOICES[0];
  const textSize = TEXT_SIZE_CHOICES.find((item) => item.id === prefs?.textSizeId) || TEXT_SIZE_CHOICES[0];

  if (font?.value) container.style.setProperty("--md-font-family", font.value);
  else container.style.removeProperty("--md-font-family");

  // Manual markdown highlights are author-defined and retain their authored
  // colors; there is no reader-level highlight preference anymore.
  container.style.setProperty("--lesson-reading-width", width.value);
  container.style.setProperty("--lesson-reading-text-size", textSize.value);
  container.classList.toggle("lesson-view--focus", Boolean(prefs?.focusMode));
}
