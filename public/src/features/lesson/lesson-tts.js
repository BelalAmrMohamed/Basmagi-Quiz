// ============================================================================
// public/src/features/lesson/lesson-tts.js
// READ-ALOUD — robust Arabic speechSynthesis support for lesson sections.
// ============================================================================

import { getReaderPrefs, setReaderPrefs } from "./lesson-reader-prefs.js";

const SPEED_STEPS = [0.75, 1, 1.25, 1.5, 1.75, 2];
const ARABIC_RE = /^ar(?:[-_]|$)/i;
const VOICE_WAIT_MS = 1800;

export function isTtsSupported() {
  return typeof window !== "undefined" &&
    typeof window.speechSynthesis !== "undefined" &&
    typeof window.SpeechSynthesisUtterance !== "undefined";
}

/**
 * Reads an arbitrary selected text fragment without creating a lesson-section
 * session. Starting it cancels any active section playback so the user never
 * has two speech streams competing with each other.
 *
 * @param {string} text
 * @returns {Promise<boolean>} true once the browser has accepted the utterance
 */
export async function readText(text) {
  if (!isTtsSupported()) {
    throw new Error("tts_unsupported");
  }

  const cleanText = String(text || "").replace(/\s+/g, " ").trim();
  if (!cleanText) {
    throw new Error("empty_text");
  }

  stopSession();

  const prefs = getReaderPrefs();
  let voices = loadVoices();
  let voice = chooseArabicVoice(prefs, voices);

  if (!voice) {
    installVoicesChangedListener();
    await new Promise((resolve) => window.setTimeout(resolve, VOICE_WAIT_MS));
    voices = loadVoices();
    voice = chooseArabicVoice(prefs, voices);
  }

  const utterance = new window.SpeechSynthesisUtterance(cleanText);
  utterance.rate = Number(prefs.ttsRate) || 1;
  utterance.lang = voice?.lang || "ar-EG";
  if (voice) utterance.voice = voice;

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (ok, error) => {
      if (settled) return;
      settled = true;
      if (ok) resolve(true);
      else reject(error || new Error("tts_failed"));
    };

    utterance.onstart = () => finish(true);
    utterance.onend = () => {
      if (!settled) {
        // A few browsers omit onstart when speech is accepted immediately.
        finish(true);
      }
    };
    utterance.onerror = (event) => {
      if (event?.error === "interrupted" || event?.error === "canceled") {
        return;
      }
      finish(false, new Error(event?.error || "tts_failed"));
    };

    try {
      window.speechSynthesis.speak(utterance);

      // Chrome can report a queued utterance without firing onstart until a
      // later turn. Treat an actively speaking/queued synthesis request as
      // success rather than making the popup appear stuck.
      window.setTimeout(() => {
        if (!settled && (window.speechSynthesis.speaking || window.speechSynthesis.pending)) {
          finish(true);
        }
      }, 80);
    } catch (error) {
      finish(false, error);
    }
  });
}

export function renderTtsControl(sectionId) {
  if (!isTtsSupported()) {
    return (
      `<div class="lesson-tts lesson-tts--unsupported" data-tts-section="${sectionId}">` +
      `<span class="lesson-tts__status" role="status">القراءة الصوتية غير مدعومة في هذا المتصفح.</span>` +
      `</div>`
    );
  }
  return (
    `<div class="lesson-tts" data-tts-section="${sectionId}">` +
    `<button type="button" class="lesson-tts__btn lesson-tts__btn--play" data-tts-action="toggle" aria-label="استماع لهذا القسم" title="استماع">` +
    `<span class="lesson-tts__icon" aria-hidden="true"></span>` +
    `<span class="lesson-tts__label">استماع</span>` +
    `</button>` +
    `<button type="button" class="lesson-tts__btn lesson-tts__btn--stop" data-tts-action="stop" aria-label="إيقاف القراءة" title="إيقاف" hidden>■</button>` +
    `<label class="lesson-tts__speed"><span class="lesson-tts__speed-label">السرعة</span>` +
    `<select class="lesson-tts__speed-select" data-tts-speed aria-label="سرعة القراءة">` +
    SPEED_STEPS.map((s) => `<option value="${s}">${s}×</option>`).join("") +
    `</select></label>` +
    `<span class="lesson-tts__status" role="status" aria-live="polite"></span>` +
    `</div>`
  );
}

let session = null;
let voicesChangedInstalled = false;
let cachedVoices = [];

function loadVoices() {
  if (!isTtsSupported()) return [];
  const voices = window.speechSynthesis.getVoices();
  if (voices.length) cachedVoices = voices;
  return voices.length ? voices : cachedVoices;
}

function getArabicVoices(voices = loadVoices()) {
  return voices.filter((voice) => ARABIC_RE.test(voice?.lang || ""));
}

function chooseArabicVoice(prefs, voices) {
  const arabicVoices = getArabicVoices(voices);
  if (!arabicVoices.length) return null;
  if (prefs?.ttsVoiceURI) {
    const preferred = arabicVoices.find((voice) => voice.voiceURI === prefs.ttsVoiceURI);
    if (preferred) return preferred;
  }
  return arabicVoices.find((voice) => /^ar-EG/i.test(voice.lang || "")) ||
    arabicVoices.find((voice) => /^ar-SA/i.test(voice.lang || "")) ||
    arabicVoices.find((voice) => /^ar/i.test(voice.lang || "")) ||
    arabicVoices[0];
}

function setStatus(toolbar, message, kind = "") {
  const status = toolbar?.querySelector(".lesson-tts__status");
  if (!status) return;
  status.textContent = message || "";
  status.classList.toggle("is-error", kind === "error");
  status.classList.toggle("is-loading", kind === "loading");
}

function clearHighlight(root) {
  root?.querySelectorAll(".lesson-tts-block--active").forEach((el) => el.classList.remove("lesson-tts-block--active"));
}

function resetToolbar(toolbar) {
  if (!toolbar) return;
  const playBtn = toolbar.querySelector(".lesson-tts__btn--play");
  const stopBtn = toolbar.querySelector(".lesson-tts__btn--stop");
  if (playBtn) {
    playBtn.classList.remove("is-speaking", "is-paused");
    const label = playBtn.querySelector(".lesson-tts__label");
    if (label) label.textContent = "استماع";
    playBtn.setAttribute("aria-label", "استماع لهذا القسم");
  }
  if (stopBtn) stopBtn.hidden = true;
  setStatus(toolbar, "");
}

function setToolbarSpeaking(toolbar) {
  const playBtn = toolbar?.querySelector(".lesson-tts__btn--play");
  const stopBtn = toolbar?.querySelector(".lesson-tts__btn--stop");
  if (playBtn) {
    playBtn.classList.add("is-speaking");
    playBtn.classList.remove("is-paused");
    const label = playBtn.querySelector(".lesson-tts__label");
    if (label) label.textContent = "إيقاف مؤقت";
    playBtn.setAttribute("aria-label", "إيقاف القراءة مؤقتاً");
  }
  if (stopBtn) stopBtn.hidden = false;
}

function setToolbarPaused(toolbar) {
  const playBtn = toolbar?.querySelector(".lesson-tts__btn--play");
  const stopBtn = toolbar?.querySelector(".lesson-tts__btn--stop");
  if (playBtn) {
    playBtn.classList.add("is-paused");
    playBtn.classList.remove("is-speaking");
    const label = playBtn.querySelector(".lesson-tts__label");
    if (label) label.textContent = "متابعة";
    playBtn.setAttribute("aria-label", "متابعة القراءة");
  }
  if (stopBtn) stopBtn.hidden = false;
}

function stopSession(clearStatusText = true) {
  const current = session;
  const preservedStatus = !clearStatusText
    ? current?.toolbar?.querySelector(".lesson-tts__status")?.textContent || ""
    : "";
  const preservedKind = !clearStatusText
    ? current?.toolbar?.querySelector(".lesson-tts__status")?.classList.contains("is-error") ? "error" : ""
    : "";
  session = null;
  if (isTtsSupported()) {
    try { window.speechSynthesis.cancel(); } catch (_) { }
  }
  if (current) {
    clearHighlight(current.root);
    resetToolbar(current.toolbar);
    if (preservedStatus) setStatus(current.toolbar, preservedStatus, preservedKind);
  }
}

function collectSpeakableBlocks(section) {
  const SELECTOR = "p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th, figcaption";
  const blocks = [];
  section.querySelectorAll(".lesson-block--markdown").forEach((markdownBlock) => {
    markdownBlock.querySelectorAll(SELECTOR).forEach((el) => {
      if (el.querySelector(SELECTOR)) return;
      const text = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (text) blocks.push({ el, text });
    });
  });
  return blocks;
}

function continueAfterVoiceChange() {
  if (!session?.waitingForVoices) return;
  const current = session;
  session.waitingForVoices = false;
  const voices = loadVoices();
  const voice = chooseArabicVoice(getReaderPrefs(), voices);
  if (!voice) {
    setStatus(current.toolbar, "لم يتوفر صوت عربي في المتصفح. ثبّت صوتًا عربيًا من إعدادات النظام ثم أعد المحاولة.", "error");
    stopSession(false);
    return;
  }
  setStatus(current.toolbar, "");
  setToolbarSpeaking(current.toolbar);
  speakNext();
}

function installVoicesChangedListener() {
  if (voicesChangedInstalled || !isTtsSupported()) return;
  voicesChangedInstalled = true;
  window.speechSynthesis.addEventListener("voiceschanged", () => {
    cachedVoices = window.speechSynthesis.getVoices();
    continueAfterVoiceChange();
  });
}

function prepareArabicVoice(toolbar) {
  const initial = loadVoices();
  const current = chooseArabicVoice(getReaderPrefs(), initial);
  if (current) return current;

  // Browsers can expose a partial voice list first and add the Arabic voice
  // later through `voiceschanged`. Keep listening in either case instead of
  // treating a non-Arabic first batch as the final answer.
  installVoicesChangedListener();
  setStatus(
    toolbar,
    initial.length
      ? "جارٍ البحث عن صوت عربي…"
      : "جارٍ تجهيز الصوت العربي…",
    "loading",
  );
  if (!session) return null;
  session.waitingForVoices = true;
  window.setTimeout(() => {
    if (!session?.waitingForVoices) return;
    session.waitingForVoices = false;
    const voice = chooseArabicVoice(getReaderPrefs(), loadVoices());
    if (!voice) {
      setStatus(session.toolbar, "لم يستطع المتصفح تحميل صوت عربي. تأكد من تثبيت صوت عربي ثم أعد المحاولة.", "error");
      stopSession(false);
    } else {
      setStatus(session.toolbar, "");
      setToolbarSpeaking(session.toolbar);
      speakNext();
    }
  }, VOICE_WAIT_MS);
  return null;
}

function speakNext() {
  if (!session || session.waitingForVoices) return;
  const next = session.blocks[session.index + 1];
  if (!next) {
    stopSession();
    return;
  }
  session.index += 1;
  clearHighlight(session.root);
  next.el.classList.add("lesson-tts-block--active");
  const reducedMotion = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  next.el.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "center" });

  const prefs = getReaderPrefs();
  const voice = chooseArabicVoice(prefs, loadVoices());
  if (!voice) {
    setStatus(session.toolbar, "لم يتوفر صوت عربي للقراءة.", "error");
    stopSession(false);
    return;
  }

  const utterance = new window.SpeechSynthesisUtterance(next.text);
  utterance.rate = Number(prefs.ttsRate) || 1;
  utterance.voice = voice;
  utterance.lang = voice.lang || "ar-EG";
  utterance.onend = () => {
    if (session) speakNext();
  };
  utterance.onerror = (event) => {
    if (!session) return;
    if (event.error === "interrupted" || event.error === "canceled") return;
    console.error("[lesson-tts] speech error:", event.error);
    setStatus(session.toolbar, "حدث خطأ أثناء القراءة الصوتية. حاول مرة أخرى.", "error");
    stopSession(false);
  };

  try {
    window.speechSynthesis.speak(utterance);
  } catch (error) {
    console.error("[lesson-tts] speechSynthesis.speak failed:", error);
    setStatus(session.toolbar, "تعذر بدء القراءة الصوتية في هذا المتصفح.", "error");
    stopSession(false);
  }
}

function startSection(root, section, toolbar) {
  stopSession();
  const blocks = collectSpeakableBlocks(section);
  if (!blocks.length) {
    setStatus(toolbar, "لا يوجد نص قابل للقراءة في هذا القسم.", "error");
    return;
  }

  session = {
    root,
    section,
    sectionId: section.dataset.sectionId,
    toolbar,
    blocks,
    index: -1,
    paused: false,
    waitingForVoices: false,
  };
  document.querySelectorAll(".lesson-tts").forEach((other) => {
    if (other !== toolbar) resetToolbar(other);
  });
  // The stop control stays hidden while the browser is still resolving a
  // voice. It becomes visible only after speech has actually been started
  // (or when the session is paused), matching the control's active-state
  // contract.
  resetToolbar(toolbar);
  // Keep the initial voice lookup on the click call stack. Some mobile
  // browsers are stricter about user activation than desktop browsers.
  const voice = prepareArabicVoice(toolbar);
  if (!session || !voice) return;
  setStatus(toolbar, "");
  speakNext();
}

export function equipTts(root) {
  if (!root) return;
  if (isTtsSupported()) installVoicesChangedListener();
  root.querySelectorAll(".lesson-tts").forEach((toolbar) => {
    if (toolbar.classList.contains("lesson-tts--unsupported")) return;
    const speedSelect = toolbar.querySelector("[data-tts-speed]");
    if (speedSelect) speedSelect.value = String(Number(getReaderPrefs().ttsRate) || 1);

    if (session?.sectionId === toolbar.dataset.ttsSection) {
      session.toolbar = toolbar;
      if (session.paused) setToolbarPaused(toolbar); else setToolbarSpeaking(toolbar);
    }

    toolbar.querySelector('[data-tts-action="toggle"]')?.addEventListener("click", () => {
      const section = toolbar.closest(".lesson-section");
      if (!section) return;
      const sameSection = session?.sectionId === section.dataset.sectionId;
      if (sameSection && session?.waitingForVoices) return;
      if (sameSection && session && !session.paused && window.speechSynthesis.speaking) {
        window.speechSynthesis.pause();
        session.paused = true;
        setToolbarPaused(toolbar);
        return;
      }
      if (sameSection && session?.paused) {
        window.speechSynthesis.resume();
        session.paused = false;
        setToolbarSpeaking(toolbar);
        return;
      }
      startSection(root, section, toolbar);
    });

    toolbar.querySelector('[data-tts-action="stop"]')?.addEventListener("click", () => stopSession());

    speedSelect?.addEventListener("change", (event) => {
      const rate = Number(event.target.value) || 1;
      setTtsRate(rate);
      if (session?.toolbar === toolbar && !session.paused) {
        session.index -= 1;
        try { window.speechSynthesis.cancel(); } catch (_) { }
        speakNext();
      }
    });
  });

  if (session && !root.contains(session.section)) {
    const newSection = root.querySelector(`.lesson-section[data-section-id="${CSS.escape(session.sectionId)}"]`);
    if (newSection && window.speechSynthesis.speaking) {
      session.root = root;
      session.section = newSection;
      session.blocks = collectSpeakableBlocks(newSection);
      session.toolbar = newSection.querySelector(`.lesson-tts[data-tts-section="${CSS.escape(session.sectionId)}"]`);
      if (session.blocks[session.index]) session.blocks[session.index].el.classList.add("lesson-tts-block--active");
    } else if (session) {
      stopSession();
    }
  }
}

export function setTtsRate(rate) {
  setReaderPrefs({ ttsRate: Number(rate) || 1 });
}

export function setTtsVoice(voiceURI) {
  setReaderPrefs({ ttsVoiceURI: voiceURI || "" });
}
