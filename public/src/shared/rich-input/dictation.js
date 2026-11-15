// =============================================================================
// rich-input/dictation.js
// Voice dictation (Web Speech API) with the live volume wave — the single
// implementation shared by the AI Agent chat and the quiz / lesson essay
// fields, so the mic looks and behaves the same everywhere.
//
//   const d = createDictation({ getText, setText, focus, onError, onActiveChange });
//   rich.endSlot.append(d.micBtn, d.waveEl);   // micBtn is null when unsupported
//   d.firefoxWarningEl                          // null unless Firefox (accuracy note)
//   d.isActive() / d.start() / d.stop()
//
// While dictating, micBtn hides and waveEl (same 36x36 slot) shows; clicking
// the wave stops dictation and leaves the transcript for review. The wave bars
// follow the real microphone level (a separate getUserMedia/AnalyserNode
// stream, since SpeechRecognition exposes no amplitude) and fall back to the
// CSS bounce animation when that is unavailable. Styles live in ai-agent.css
// (.ai-agent-mic-btn, .ai-agent-dictation-wave*, .ai-agent-firefox-warning).
// Dictated text is appended after whatever was already typed.
// =============================================================================
const MIC_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v1a7 7 0 0 1-14 0v-1"/><line x1="12" x2="12" y1="19" y2="22"/></svg>';
// Plain X the mic swaps to while dictating (kept for the aria/title state).
const CANCEL_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';

// navigator.brave.isBrave() is async; resolve it once for the whole page so an
// early mic click can't race detection and request the microphone twice.
let isBraveBrowser = /brave/i.test(navigator.userAgent || "");
const braveDetection = navigator.brave && typeof navigator.brave.isBrave === "function"
  ? navigator.brave.isBrave()
    .then((result) => { isBraveBrowser = !!result; return isBraveBrowser; })
    .catch((error) => { console.warn("[dictation] Brave browser detection failed:", error); return isBraveBrowser; })
  : Promise.resolve(isBraveBrowser);

/**
 * @param {object} options
 * @param {() => string} options.getText current plain text of the field
 * @param {(value: string) => void} options.setText write the live transcript into the field
 * @param {() => void} [options.focus] focus the field (after the user stops dictation)
 * @param {(message: string) => void} [options.onError] visible error for the user
 * @param {(active: boolean) => void} [options.onActiveChange] dictation started / ended
 */
export function createDictation({ getText, setText, focus, onError, onActiveChange }) {
  const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition || null;
  // Firefox has no SpeechRecognition in stable, but if a flagged build exposes
  // it the accuracy warning must still show ("if Firefox, warn").
  const isFirefox = /firefox/i.test(navigator.userAgent || "");

  let recognition = null;
  let isDictating = false;
  let finalizedText = "";
  let baseTextBeforeDictation = "";
  let hasRetriedAfterNetworkError = false;

  let audioCtx = null;
  let analyserNode = null;
  let micStream = null;
  let meterRafId = null;

  const waveEl = document.createElement("button");
  waveEl.type = "button";
  waveEl.className = "ai-agent-dictation-wave";
  waveEl.hidden = true;
  waveEl.setAttribute("aria-label", "جارِ الاستماع — اضغط للإلغاء");
  waveEl.title = "جارِ الاستماع — اضغط للإلغاء";
  waveEl.innerHTML = `
    <span class="ai-agent-dictation-wave-bars" aria-hidden="true">
      <span></span><span></span><span></span><span></span><span></span>
    </span>
  `;
  const waveBarEls = [...waveEl.querySelectorAll(".ai-agent-dictation-wave-bars span")];

  let micBtn = null;
  if (SpeechRecognitionCtor) {
    micBtn = document.createElement("button");
    micBtn.type = "button";
    micBtn.className = "ai-agent-mic-btn";
    micBtn.setAttribute("aria-label", "بدء الإملاء الصوتي");
    micBtn.title = "إملاء صوتي";
    micBtn.innerHTML = MIC_ICON_SVG;
  }

  let firefoxWarningEl = null;
  if (isFirefox) {
    firefoxWarningEl = document.createElement("div");
    firefoxWarningEl.className = "ai-agent-firefox-warning";
    firefoxWarningEl.textContent =
      "⚠️ الإملاء الصوتي قد يكون غير دقيق على متصفح Firefox — يُفضّل استخدام متصفح آخر (مثل Chrome) لنتائج أفضل.";
  }

  function composeDictationValue(interim) {
    const finalPart = finalizedText.trim();
    const interimPart = (interim || "").trim();
    const dictated = [finalPart, interimPart].filter(Boolean).join(" ");
    const base = baseTextBeforeDictation.trim();
    return [base, dictated].filter(Boolean).join(base ? " " : "");
  }

  // Mic button and wave swap 1-for-1 in the same slot; the owner reacts to the
  // rest of its row through onActiveChange.
  function setDictationUiState(dictating) {
    isDictating = dictating;
    if (micBtn) {
      micBtn.innerHTML = dictating ? CANCEL_ICON_SVG : MIC_ICON_SVG;
      micBtn.setAttribute("aria-label", dictating ? "إلغاء الإملاء الصوتي" : "بدء الإملاء الصوتي");
      micBtn.title = dictating ? "إلغاء الإملاء" : "إملاء صوتي";
      micBtn.classList.toggle("ai-agent-mic-btn--active", dictating);
      micBtn.hidden = dictating;
    }
    waveEl.hidden = !dictating;
    onActiveChange?.(dictating);
  }

  /** Opens a mic stream purely for volume metering (best-effort). */
  async function startMicMetering() {
    if (!navigator.mediaDevices?.getUserMedia) return;
    await braveDetection;
    if (isBraveBrowser || !isDictating) return;
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AudioContextCtor();
      const source = audioCtx.createMediaStreamSource(micStream);
      analyserNode = audioCtx.createAnalyser();
      analyserNode.fftSize = 64;
      analyserNode.smoothingTimeConstant = 0.6;
      source.connect(analyserNode);

      const data = new Uint8Array(analyserNode.frequencyBinCount);
      // Real volume data takes over from the CSS keyframe loop.
      waveEl.classList.add("ai-agent-dictation-wave--live");

      const tick = () => {
        if (!analyserNode) return;
        analyserNode.getByteTimeDomainData(data);
        // Per-bar RMS over a distinct slice so the bars move independently.
        const sliceSize = Math.floor(data.length / waveBarEls.length);
        waveBarEls.forEach((bar, i) => {
          let sum = 0;
          const start = i * sliceSize;
          const end = start + sliceSize;
          for (let j = start; j < end; j++) {
            const centered = (data[j] - 128) / 128;
            sum += centered * centered;
          }
          const rms = Math.sqrt(sum / sliceSize);
          const level = Math.min(1, 0.15 + rms * 3.2);
          bar.style.transform = `scaleY(${level.toFixed(3)})`;
        });
        meterRafId = requestAnimationFrame(tick);
      };
      tick();
    } catch (err) {
      console.error("[dictation] Mic metering unavailable:", err);
      audioCtx = null;
      analyserNode = null;
      micStream = null;
    }
  }

  function stopMicMetering() {
    if (meterRafId) cancelAnimationFrame(meterRafId);
    meterRafId = null;
    analyserNode = null;
    if (micStream) {
      micStream.getTracks().forEach((track) => track.stop());
      micStream = null;
    }
    if (audioCtx) {
      audioCtx.close().catch(() => { });
      audioCtx = null;
    }
    waveEl.classList.remove("ai-agent-dictation-wave--live");
    waveBarEls.forEach((bar) => { bar.style.transform = ""; });
  }

  /** Halts the microphone; the field's text is left as it is. */
  function stop() {
    if (recognition) {
      try {
        recognition.stop();
      } catch (err) {
        console.error("[dictation] SpeechRecognition stop failed:", err);
      }
    }
    stopMicMetering();
    setDictationUiState(false);
  }

  function start(isRetry = false) {
    if (!SpeechRecognitionCtor || isDictating) return;

    finalizedText = "";
    baseTextBeforeDictation = getText();
    // Fresh retry budget per mic press; only the retry path itself keeps the flag.
    if (!isRetry) hasRetriedAfterNetworkError = false;

    const session = new SpeechRecognitionCtor();
    recognition = session;
    session.lang = document.documentElement?.lang === "en" ? "en-US" : "ar-EG";
    session.continuous = true;
    session.interimResults = true;

    session.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) finalizedText = `${finalizedText} ${result[0].transcript}`.trim();
        else interim += result[0].transcript;
      }
      setText(composeDictationValue(interim));
    };

    session.onerror = (event) => {
      if (recognition !== session) return;
      console.error("[dictation] SpeechRecognition error:", event.error);
      // "no-speech"/"aborted" are routine (silence timeout, the user's own cancel).
      if (event.error === "no-speech" || event.error === "aborted") {
        stopMicMetering();
        setDictationUiState(false);
        return;
      }
      // Network errors can be transient on every browser: one clean retry.
      if (event.error === "network" && !hasRetriedAfterNetworkError) {
        hasRetriedAfterNetworkError = true;
        stopMicMetering();
        setDictationUiState(false);
        try {
          start(true);
        } catch (err) {
          console.error("[dictation] SpeechRecognition retry failed:", err);
        }
        return;
      }
      let message = "تعذر استخدام الإملاء الصوتي. حاول مرة أخرى.";
      if (event.error === "network") {
        message = isBraveBrowser
          ? "تعذّر الاتصال بخدمة التعرف الصوتي بعد إعادة المحاولة. تحقق من اتصالك وإعدادات Shields في Brave، ثم حاول مجدداً."
          : "تعذر الوصول إلى خدمة التعرف الصوتي (قد يكون بسبب مانع إعلانات أو مشكلة في الاتصال). حاول مرة أخرى أو اكتب رسالتك.";
      }
      onError?.(message);
      stopMicMetering();
      setDictationUiState(false);
    };

    session.onend = () => {
      if (recognition !== session) return;
      // The browser can end the session itself (silence timeout): never leave
      // the UI stuck in the listening state.
      if (isDictating) {
        stopMicMetering();
        setDictationUiState(false);
      }
    };

    try {
      recognition.start();
      setDictationUiState(true);
      startMicMetering();
    } catch (err) {
      console.error("[dictation] SpeechRecognition start failed:", err);
      onError?.("تعذر بدء الإملاء الصوتي.");
    }
  }

  // Mic / cancel and the wave: stop only halts the mic and leaves the text.
  micBtn?.addEventListener("click", () => {
    if (isDictating) {
      stop();
      focus?.();
    } else {
      start();
    }
  });
  waveEl.addEventListener("click", () => {
    stop();
    focus?.();
  });

  return {
    micBtn,
    waveEl,
    firefoxWarningEl,
    supported: !!SpeechRecognitionCtor,
    isActive: () => isDictating,
    start,
    stop,
  };
}
