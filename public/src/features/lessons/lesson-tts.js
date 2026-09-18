// ============================================================================
// public/src/features/lessons/lesson-tts.js
// READ-ALOUD — per-section play/pause via window.speechSynthesis.
// ============================================================================
// Client-only: no backend, no new serverless function (see the lessons
// plan's Phase 2 step 9). Voice + rate live in the SAME combined
// reader-prefs localStorage object as the font/highlight choices, not in
// their own keys.
//
// Feature-detected: when speechSynthesis is unavailable the control is not
// rendered at all, rather than rendering a button that does nothing.
// ============================================================================

import { getReaderPrefs, setReaderPrefs } from "./lesson-reader-prefs.js";

export function isTtsSupported() {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/** Markup for one section's play/pause control, or "" when unsupported. */
export function renderTtsControl(sectionId) {
  if (!isTtsSupported()) return "";
  return (
    `<button type="button" class="lesson-tts__btn" data-tts-section="${sectionId}" ` +
    `aria-label="استماع لهذا القسم" title="استماع">` +
    `<span class="lesson-tts__icon" aria-hidden="true"></span>` +
    `<span class="lesson-tts__label">استماع</span>` +
    `</button>`
  );
}

let activeButton = null;

/**
 * Wires every per-section read-aloud button inside `root`.
 *
 * Reads the section's rendered text content (not its markdown source) so
 * the reader hears the prose without syntax markers, and skips the ToC and
 * the embedded-question controls.
 *
 * @param {HTMLElement} root
 */
export function equipTts(root) {
  if (!root || !isTtsSupported()) return;

  root.querySelectorAll(".lesson-tts__btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const section = btn.closest(".lesson-section");
      if (!section) return;

      // Same button while speaking -> stop. Any other state -> restart from
      // this section, since speechSynthesis has one global queue and
      // leaving a half-spoken previous section queued behind it would be
      // confusing.
      const isThisSpeaking = activeButton === btn && window.speechSynthesis.speaking;
      window.speechSynthesis.cancel();
      resetButtons(root);
      if (isThisSpeaking) {
        activeButton = null;
        return;
      }

      const text = extractSpeakableText(section);
      if (!text) return;

      const prefs = getReaderPrefs();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = Number(prefs.ttsRate) || 1;

      if (prefs.ttsVoiceURI) {
        const voice = window.speechSynthesis
          .getVoices()
          .find((v) => v.voiceURI === prefs.ttsVoiceURI);
        if (voice) utterance.voice = voice;
      }

      utterance.addEventListener("end", () => {
        resetButtons(root);
        activeButton = null;
      });
      utterance.addEventListener("error", () => {
        resetButtons(root);
        activeButton = null;
      });

      activeButton = btn;
      btn.classList.add("is-speaking");
      btn.querySelector(".lesson-tts__label").textContent = "إيقاف";
      window.speechSynthesis.speak(utterance);
    });
  });
}

function resetButtons(root) {
  root.querySelectorAll(".lesson-tts__btn").forEach((b) => {
    b.classList.remove("is-speaking");
    const label = b.querySelector(".lesson-tts__label");
    if (label) label.textContent = "استماع";
  });
}

function extractSpeakableText(section) {
  const clone = section.cloneNode(true);
  clone
    .querySelectorAll(".lesson-tts__btn, .lesson-toc, .lesson-question__options, .lesson-quiz-ref__link")
    .forEach((el) => el.remove());
  return (clone.textContent || "").replace(/\s+/g, " ").trim();
}

/** Persists a rate change into the combined reader-prefs object. */
export function setTtsRate(rate) {
  setReaderPrefs({ ttsRate: Number(rate) || 1 });
}

/** Persists a voice change into the combined reader-prefs object. */
export function setTtsVoice(voiceURI) {
  setReaderPrefs({ ttsVoiceURI: voiceURI || "" });
}
