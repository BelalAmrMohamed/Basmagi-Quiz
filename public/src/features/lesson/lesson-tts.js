// ============================================================================
// public/src/features/lesson/lesson-tts.js
// READ-ALOUD — per-section toolbar over window.speechSynthesis.
// ============================================================================
// Client-only: no backend, no new serverless function. Voice + rate live in
// the SAME combined reader-prefs localStorage object as the font/highlight
// choices, not in their own keys (see lesson-reader-prefs.js).
//
// Phase 3 rewrite: the old version spoke a whole section as one utterance
// with no pause/resume and no indication of what was being read. This
// version:
//   - splits each section into per-paragraph/text-block utterances queued
//     in order, instead of one big utterance
//   - exposes real play/pause/resume/stop + speed, reflecting actual
//     SpeechSynthesis state rather than a single "is speaking" toggle
//   - highlights the block currently being spoken via a CSS class (never by
//     injecting markup into the stored lesson content — see
//     tagSpeakableBlocks below) and auto-advances to the next block
//   - scrolls the active block into view
//   - clears highlighting and resets the toolbar on stop/error
//
// Feature-detected throughout: when speechSynthesis is unavailable the
// control is not rendered at all, rather than rendering a toolbar that does
// nothing.
// ============================================================================

import { getReaderPrefs, setReaderPrefs } from "./lesson-reader-prefs.js";

export function isTtsSupported() {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

const SPEED_STEPS = [0.75, 1, 1.25, 1.5, 1.75, 2];

/** Markup for one section's read-aloud toolbar, or "" when unsupported. */
export function renderTtsControl(sectionId) {
  if (!isTtsSupported()) return "";
  return (
    `<div class="lesson-tts" data-tts-section="${sectionId}">` +
    `<button type="button" class="lesson-tts__btn lesson-tts__btn--play" data-tts-action="toggle" ` +
    `aria-label="استماع لهذا القسم" title="استماع">` +
    `<span class="lesson-tts__icon" aria-hidden="true"></span>` +
    `<span class="lesson-tts__label">استماع</span>` +
    `</button>` +
    `<button type="button" class="lesson-tts__btn lesson-tts__btn--stop" data-tts-action="stop" ` +
    `aria-label="إيقاف القراءة" title="إيقاف" hidden>■</button>` +
    `<label class="lesson-tts__speed">` +
    `<span class="lesson-tts__speed-label">السرعة</span>` +
    `<select class="lesson-tts__speed-select" data-tts-speed aria-label="سرعة القراءة">` +
    SPEED_STEPS.map((s) => `<option value="${s}">${s}×</option>`).join("") +
    `</select>` +
    `</label>` +
    `</div>`
  );
}

/**
 * One shared playback session — speechSynthesis has a single global queue,
 * so only one section can be "active" across the whole page at a time, the
 * same constraint the old version had. Held as module state (not per-button
 * data) because the highlight/auto-advance loop needs to reach across
 * button, queue and root on every utterance boundary.
 */
let session = null;

function stopSession() {
  if (!session) return;
  const { root } = session;
  window.speechSynthesis.cancel();
  clearHighlight(root);
  resetToolbar(session.toolbar);
  session = null;
}

function clearHighlight(root) {
  root.querySelectorAll(".lesson-tts-block--active").forEach((el) => el.classList.remove("lesson-tts-block--active"));
}

function resetToolbar(toolbar) {
  if (!toolbar) return;
  const playBtn = toolbar.querySelector(".lesson-tts__btn--play");
  const stopBtn = toolbar.querySelector(".lesson-tts__btn--stop");
  if (playBtn) {
    playBtn.classList.remove("is-speaking", "is-paused");
    playBtn.querySelector(".lesson-tts__label").textContent = "استماع";
    playBtn.setAttribute("aria-label", "استماع لهذا القسم");
  }
  if (stopBtn) stopBtn.hidden = true;
}

/**
 * Splits a section's rendered content into an ordered list of speakable
 * blocks, tagging each with a stable index via a data attribute rather than
 * mutating the stored lesson content — the tag lives only on the rendered
 * DOM node for the lifetime of this paint(), same as every other
 * interactive-wiring step in this feature (see equipQuestionBlocks).
 *
 * Only text-bearing block-level elements are collected (paragraphs, list
 * items, headings, blockquotes, table cells) and only from markdown
 * content — buttons, nav, quiz controls, the ToC and decorative elements
 * are excluded by construction since we only walk `.lesson-block--markdown`
 * subtrees.
 *
 * @param {HTMLElement} section
 * @returns {HTMLElement[]}
 */
function collectSpeakableBlocks(section) {
  const SELECTOR = "p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th, figcaption";
  const blocks = [];
  section.querySelectorAll(".lesson-block--markdown").forEach((markdownBlock) => {
    markdownBlock.querySelectorAll(SELECTOR).forEach((el) => {
      // Skip a container whose own text is fully owned by a nested match
      // (e.g. a <li> that itself contains <p>s) to avoid reading the same
      // words twice.
      if (el.querySelector(SELECTOR)) return;
      const text = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (text) blocks.push({ el, text });
    });
  });
  return blocks;
}

/**
 * Starts (or restarts) reading a section from its first block.
 *
 * @param {HTMLElement} root - the lesson container (for clearing any other
 *   section's highlight/toolbar state before taking over the shared queue)
 * @param {HTMLElement} section
 * @param {HTMLElement} toolbar
 */
function startSection(root, section, toolbar) {
  window.speechSynthesis.cancel();
  clearHighlight(root);
  document.querySelectorAll(".lesson-tts").forEach((t) => {
    if (t !== toolbar) resetToolbar(t);
  });

  const blocks = collectSpeakableBlocks(section);
  if (blocks.length === 0) return;

  session = {
    root,
    section,
    sectionId: section.dataset.sectionId,
    toolbar,
    blocks,
    index: -1,
    paused: false,
  };
  setToolbarSpeaking(toolbar);
  speakNext();
}

function setToolbarSpeaking(toolbar) {
  const playBtn = toolbar.querySelector(".lesson-tts__btn--play");
  const stopBtn = toolbar.querySelector(".lesson-tts__btn--stop");
  if (playBtn) {
    playBtn.classList.add("is-speaking");
    playBtn.classList.remove("is-paused");
    playBtn.querySelector(".lesson-tts__label").textContent = "إيقاف مؤقت";
    playBtn.setAttribute("aria-label", "إيقاف القراءة مؤقتاً");
  }
  if (stopBtn) stopBtn.hidden = false;
}

function setToolbarPaused(toolbar) {
  const playBtn = toolbar.querySelector(".lesson-tts__btn--play");
  if (playBtn) {
    playBtn.classList.add("is-paused");
    playBtn.classList.remove("is-speaking");
    playBtn.querySelector(".lesson-tts__label").textContent = "متابعة";
    playBtn.setAttribute("aria-label", "متابعة القراءة");
  }
}

function speakNext() {
  if (!session) return;
  session.index += 1;
  const next = session.blocks[session.index];
  if (!next) {
    // Reached the end of the section: stop cleanly rather than leaving a
    // "paused at the last block" toolbar state behind.
    stopSession();
    return;
  }

  clearHighlight(session.root);
  next.el.classList.add("lesson-tts-block--active");
  next.el.scrollIntoView({ behavior: "smooth", block: "center" });

  const prefs = getReaderPrefs();
  const utterance = new SpeechSynthesisUtterance(next.text);
  utterance.rate = Number(prefs.ttsRate) || 1;

  if (prefs.ttsVoiceURI) {
    const voice = window.speechSynthesis.getVoices().find((v) => v.voiceURI === prefs.ttsVoiceURI);
    if (voice) utterance.voice = voice;
  }

  utterance.addEventListener("end", () => {
    // A stop/cancel between "end" firing and this handler running would
    // have already cleared `session` — guard so we don't resurrect it.
    if (!session) return;
    speakNext();
  });
  utterance.addEventListener("error", (event) => {
    // "interrupted"/"canceled" are expected outcomes of our own cancel()
    // calls (stop, section switch, page navigation) — not failures, so
    // they shouldn't blow away a session another action just started.
    if (event.error === "interrupted" || event.error === "canceled") return;
    console.error("[lesson-tts] speech error:", event.error);
    stopSession();
  });

  window.speechSynthesis.speak(utterance);
}

/**
 * Wires every section's read-aloud toolbar inside `root`: play/pause/resume
 * toggle, stop, and the speed selector.
 *
 * `root.innerHTML` is fully replaced on every paint() (e.g. after a reader
 * answers a question), so a session started before that rerender is now
 * pointing at detached nodes — `session.section`/`session.blocks[].el` no
 * longer exist in the live document even though speechSynthesis itself
 * keeps talking right through the DOM swap. Rather than silently losing
 * the toolbar's play/pause state (or worse, highlighting/scrolling nodes
 * nobody can see), we re-resolve the session onto the new DOM by section
 * id and re-collect its blocks, continuing highlighting from the same
 * block index the old session was on.
 *
 * @param {HTMLElement} root
 */
export function equipTts(root) {
  if (!root || !isTtsSupported()) return;

  if (session) {
    if (!root.contains(session.section)) {
      // The DOM was swapped out from under an active session — reattach it
      // to the equivalent section/blocks in the new tree if we can, rather
      // than treating a routine rerender as a reason to stop speaking.
      const sectionId = session.sectionId;
      const newSection = sectionId
        ? root.querySelector(`.lesson-section[data-section-id="${CSS.escape(sectionId)}"]`)
        : null;
      if (newSection && window.speechSynthesis.speaking) {
        const newBlocks = collectSpeakableBlocks(newSection);
        session.root = root;
        session.section = newSection;
        session.blocks = newBlocks;
        // Best-effort: re-apply the highlight to the block at the same
        // index. If the new content has fewer blocks (unlikely mid-lesson,
        // but not impossible), just skip the highlight rather than throw.
        const current = newBlocks[session.index];
        if (current) current.el.classList.add("lesson-tts-block--active");
      } else {
        stopSession();
      }
    }
  }

  const prefs = getReaderPrefs();

  root.querySelectorAll(".lesson-tts").forEach((toolbar) => {
    const speedSelect = toolbar.querySelector("[data-tts-speed]");
    if (speedSelect) speedSelect.value = String(Number(prefs.ttsRate) || 1);

    // Re-reflect an in-progress session's toolbar state onto its (possibly
    // just-reattached, see above) section's toolbar in the new tree.
    if (session && session.section && toolbar.dataset.ttsSection === session.sectionId) {
      session.toolbar = toolbar;
      if (session.paused) setToolbarPaused(toolbar);
      else setToolbarSpeaking(toolbar);
    }

    toolbar.querySelector('[data-tts-action="toggle"]')?.addEventListener("click", () => {
      const section = toolbar.closest(".lesson-section");
      if (!section) return;

      // Compare by section id, not object identity: a rerender replaces
      // every DOM node, so `session.section` may already have been
      // reattached (see the reattachment branch above) to a *different*
      // element instance than the one `closest()` just found, even though
      // it represents "the same section" for the reader's purposes.
      const isThisSection = Boolean(session) && session.sectionId === section.dataset.sectionId;

      if (isThisSection && !session.paused && window.speechSynthesis.speaking) {
        window.speechSynthesis.pause();
        session.paused = true;
        setToolbarPaused(toolbar);
        return;
      }
      if (isThisSection && session.paused) {
        window.speechSynthesis.resume();
        session.paused = false;
        setToolbarSpeaking(toolbar);
        return;
      }
      // Different section (or nothing playing): (re)start from the top of
      // this section, since resuming mid-way into a section we weren't
      // already tracking has no well-defined position.
      startSection(root, section, toolbar);
    });

    toolbar.querySelector('[data-tts-action="stop"]')?.addEventListener("click", () => {
      stopSession();
    });

    speedSelect?.addEventListener("change", (e) => {
      const rate = Number(e.target.value) || 1;
      setTtsRate(rate);
      // Apply immediately to the block being spoken right now: a
      // SpeechSynthesisUtterance's rate can't be changed in place once
      // queued/speaking, so re-speak the current block at the new rate.
      // cancel() fires the outgoing utterance's "error" event with
      // error "interrupted"/"canceled", which the handler above already
      // ignores — so we drive the restart explicitly here rather than
      // relying on that event to chain into speakNext().
      if (session && session.toolbar === toolbar && !session.paused) {
        session.index -= 1;
        window.speechSynthesis.cancel();
        speakNext();
      }
    });
  });
}

/** Persists a rate change into the combined reader-prefs object. */
export function setTtsRate(rate) {
  setReaderPrefs({ ttsRate: Number(rate) || 1 });
}

/** Persists a voice change into the combined reader-prefs object. */
export function setTtsVoice(voiceURI) {
  setReaderPrefs({ ttsVoiceURI: voiceURI || "" });
}