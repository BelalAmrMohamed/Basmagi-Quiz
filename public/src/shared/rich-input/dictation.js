// =============================================================================
// rich-input/dictation.js
// Voice dictation (Web Speech API) for a rich input: adds a mic button to its
// bottom bar and live-transcribes into it, appended after what is already
// typed. Framework-free; the button is only added when the browser supports
// SpeechRecognition. (The AI Agent chat keeps its own richer mic UI with the
// volume wave; this is the lightweight shared version.)
// =============================================================================
const MIC = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v1a7 7 0 0 1-14 0v-1"/><line x1="12" x2="12" y1="19" y2="22"/></svg>';
const STOP = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';

/**
 * @param {{ endSlot: HTMLElement, host: HTMLElement & { value: string }, focus: Function }} rich createRichInput() result
 * @param {{ onError?: (message: string) => void }} [options]
 * @returns {{ stop: () => void, supported: boolean } }
 */
export function attachDictation(rich, { onError } = {}) {
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition || null;
  if (!Ctor) return { stop() {}, supported: false };

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "rmci-icon-btn rmci-mic-btn";
  rich.endSlot.appendChild(btn);

  let recognition = null;
  let listening = false;
  let finalized = "";
  let base = "";
  let retried = false;

  const paint = () => {
    btn.innerHTML = listening ? STOP : MIC;
    btn.classList.toggle("is-listening", listening);
    btn.setAttribute("aria-pressed", String(listening));
    const label = listening ? "إيقاف الإملاء الصوتي" : "إملاء صوتي";
    btn.title = label;
    btn.setAttribute("aria-label", label);
  };
  const compose = (interim) => {
    const spoken = [finalized.trim(), (interim || "").trim()].filter(Boolean).join(" ");
    return [base.trim(), spoken].filter(Boolean).join(base.trim() ? " " : "");
  };
  const finish = () => { listening = false; paint(); };
  const stop = () => {
    const r = recognition;
    recognition = null;
    try { r?.stop(); } catch { /* already stopped */ }
    finish();
  };

  function start(isRetry = false) {
    if (listening || rich.host.disabled) return;
    finalized = "";
    base = rich.host.value;
    if (!isRetry) retried = false;
    const session = new Ctor();
    recognition = session;
    session.lang = document.documentElement?.lang === "en" ? "en-US" : "ar-EG";
    session.continuous = true;
    session.interimResults = true;
    session.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalized = `${finalized} ${e.results[i][0].transcript}`.trim();
        else interim += e.results[i][0].transcript;
      }
      const next = compose(interim);
      rich.host.value = next;
      // Programmatic value changes are silent (like a textarea), so tell listeners.
      rich.host.dispatchEvent(new Event("input", { bubbles: true }));
    };
    session.onerror = (e) => {
      if (recognition !== session) return;
      if (e.error === "no-speech" || e.error === "aborted") return finish();
      if (e.error === "network" && !retried) {
        retried = true;
        finish();
        try { start(true); } catch { /* reported below on next attempt */ }
        return;
      }
      finish();
      onError?.(e.error === "network"
        ? "تعذر الوصول إلى خدمة التعرف الصوتي. تحقق من الاتصال أو اكتب إجابتك."
        : "تعذر استخدام الإملاء الصوتي. حاول مرة أخرى.");
    };
    session.onend = () => { if (recognition === session) finish(); };
    try {
      session.start();
      listening = true;
      paint();
    } catch (err) {
      console.error("[rich-input] dictation start failed:", err);
      onError?.("تعذر بدء الإملاء الصوتي.");
    }
  }

  btn.addEventListener("mousedown", (e) => e.preventDefault());
  btn.addEventListener("click", () => { if (listening) { stop(); rich.focus("end"); } else start(); });
  paint();
  return { stop, supported: true };
}
