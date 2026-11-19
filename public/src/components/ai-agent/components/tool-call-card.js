// =============================================================================
// public/src/components/ai-agent/components/tool-call-card.js
// Agentic Tool-Call Card UI Component:
// Displays tool invocations with real-time status (pending, running, success, error),
// live elapsed execution timer, collapsible arguments, and structured results.
// =============================================================================

import { getToolMeta } from "../core/tool-registry.js";

const SPINNER_SVG = `<svg class="ai-agent-tool-card__spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10" stroke-opacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10"/></svg>`;
const CHECK_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>`;
const ERROR_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
const STOP_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><rect width="8" height="8" x="8" y="8" rx="1.5"/></svg>`;
const CHEVRON_SVG = `<svg class="ai-agent-tool-card__chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>`;

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Creates an interactive Tool-Call card element.
 * @param {object} cfg
 * @param {string} cfg.id
 * @param {string} cfg.name - Tool name (e.g. create_notebook, edit_item)
 * @param {object} cfg.input - Tool input arguments
 * @param {"pending"|"running"|"success"|"error"|"aborted"} [cfg.status="running"]
 * @param {string} [cfg.result=""]
 * @param {string} [cfg.error=""]
 * @returns {HTMLElement & { updateStatus: (status: string, data?: {result?: string, error?: string, retrying?: boolean, retryNum?: number}) => void }}
 */
export function createToolCallCard(cfg) {
  const { id, name, input = {}, status = "running", result = "", error = "" } = cfg;
  const meta = getToolMeta(name);

  const card = document.createElement("div");
  card.className = "ai-agent-tool-card";
  card.dataset.toolCallId = id || name;
  card.dataset.status = status;

  let currentStatus = status;
  let startTime = Date.now();
  let timerInterval = null;

  const header = document.createElement("div");
  header.className = "ai-agent-tool-card__header";

  const iconWrap = document.createElement("span");
  iconWrap.className = "ai-agent-tool-card__icon";

  const titleGroup = document.createElement("div");
  titleGroup.className = "ai-agent-tool-card__title-group";

  const title = document.createElement("span");
  title.className = "ai-agent-tool-card__title";
  const primaryInput = input.title || input.name || input.targetTitle || input.itemName || input.id || input.folder || "";
  title.textContent = primaryInput ? `${meta.label}: ${primaryInput}` : meta.label;

  const badge = document.createElement("span");
  badge.className = "ai-agent-tool-card__badge";
  badge.textContent = name;

  titleGroup.append(title, badge);

  const metaGroup = document.createElement("div");
  metaGroup.className = "ai-agent-tool-card__meta";

  const timerEl = document.createElement("span");
  timerEl.className = "ai-agent-tool-card__timer";

  const toggleBtn = document.createElement("button");
  toggleBtn.type = "button";
  toggleBtn.className = "ai-agent-tool-card__toggle";
  toggleBtn.setAttribute("aria-label", "تفاصيل الأداة");
  toggleBtn.setAttribute("aria-expanded", "false");
  toggleBtn.innerHTML = CHEVRON_SVG;

  // Undo (Phase 5): handlers register it via setUndo(); shown on success only.
  let undoSpec = null;
  const undoBtn = document.createElement("button");
  undoBtn.type = "button";
  undoBtn.className = "ai-agent-tool-card__undo";
  undoBtn.hidden = true;

  metaGroup.append(timerEl, undoBtn, toggleBtn);
  header.append(iconWrap, titleGroup, metaGroup);

  const body = document.createElement("div");
  body.className = "ai-agent-tool-card__body";
  body.hidden = true;

  const argsSection = document.createElement("div");
  argsSection.className = "ai-agent-tool-card__section";
  argsSection.innerHTML = `
    <span class="ai-agent-tool-card__section-title">المدخلات (Parameters):</span>
    <pre class="ai-agent-tool-card__code"><code>${escapeHtml(JSON.stringify(input, null, 2))}</code></pre>
  `;
  body.appendChild(argsSection);

  const resultSection = document.createElement("div");
  resultSection.className = "ai-agent-tool-card__section ai-agent-tool-card__section--result";
  resultSection.hidden = !result && !error;
  body.appendChild(resultSection);

  card.append(header, body);

  function updateIcon() {
    card.dataset.status = currentStatus;
    if (currentStatus === "running") {
      iconWrap.innerHTML = SPINNER_SVG;
      iconWrap.className = "ai-agent-tool-card__icon ai-agent-tool-card__icon--running";
    } else if (currentStatus === "success") {
      iconWrap.innerHTML = CHECK_SVG;
      iconWrap.className = "ai-agent-tool-card__icon ai-agent-tool-card__icon--success";
    } else if (currentStatus === "error") {
      iconWrap.innerHTML = ERROR_SVG;
      iconWrap.className = "ai-agent-tool-card__icon ai-agent-tool-card__icon--error";
    } else if (currentStatus === "aborted") {
      iconWrap.innerHTML = STOP_SVG;
      iconWrap.className = "ai-agent-tool-card__icon ai-agent-tool-card__icon--aborted";
    } else {
      iconWrap.innerHTML = '<span class="ai-agent-tool-card__dot"></span>';
      iconWrap.className = "ai-agent-tool-card__icon ai-agent-tool-card__icon--pending";
    }
  }

  function startTimer() {
    startTime = Date.now();
    timerInterval = setInterval(() => {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      timerEl.textContent = `${elapsed}s`;
    }, 100);
  }

  function stopTimer() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    const total = ((Date.now() - startTime) / 1000).toFixed(1);
    timerEl.textContent = `${total}s`;
  }

  header.addEventListener("click", () => {
    const isExpanded = !body.hidden;
    body.hidden = isExpanded;
    toggleBtn.setAttribute("aria-expanded", String(!isExpanded));
    card.classList.toggle("is-expanded", !isExpanded);
  });

  function refreshUndoState() {
    if (!undoSpec || undoSpec.done || undoSpec.busy) return;
    let stale = false;
    try {
      stale = !!undoSpec.isStale();
    } catch {
      stale = false;
    }
    undoBtn.disabled = stale;
    undoBtn.title = stale ? "تم تعديل العنصر بعد هذه العملية، لذا لا يمكن التراجع دون فقدان التعديلات الأحدث." : undoSpec.label;
  }

  function renderUndo() {
    if (!undoSpec) return;
    undoBtn.hidden = false;
    undoBtn.textContent = "تراجع";
    refreshUndoState();
  }

  undoBtn.addEventListener("click", async (e) => {
    e.stopPropagation(); // don't toggle the card
    if (!undoSpec || undoSpec.done || undoSpec.busy || undoBtn.disabled) return;
    undoSpec.busy = true;
    undoBtn.disabled = true;
    try {
      const res = await undoSpec.run();
      if (res && res.ok === false) throw new Error(res.reason || "تعذر التراجع.");
      undoSpec.done = true;
      undoBtn.hidden = true;
      card.dataset.reverted = "true";
      const note = document.createElement("div");
      note.className = "ai-agent-tool-card__reverted";
      note.textContent = "تم التراجع عن هذه العملية.";
      body.appendChild(note);
      body.hidden = false;
      card.classList.add("is-expanded");
    } catch (err) {
      undoSpec.busy = false;
      undoBtn.disabled = false;
      undoBtn.title = err?.message || "تعذر التراجع.";
    } finally {
      if (undoSpec) undoSpec.busy = false;
    }
  });
  card.addEventListener("mouseenter", refreshUndoState);
  card.addEventListener("focusin", refreshUndoState);

  /**
   * Registers an undo action for this call. The button appears once the card
   * reaches "success" (handlers run before that status is set).
   * @param {string} label
   * @param {() => any} run
   * @param {() => boolean} [isStale]
   */
  card.setUndo = function setUndo(label, run, isStale = () => false) {
    undoSpec = { label, run, isStale, done: false, busy: false };
    if (currentStatus === "success") renderUndo();
  };

  card.updateStatus = function updateStatus(nextStatus, data = {}) {
    currentStatus = nextStatus;
    updateIcon();
    if (nextStatus === "success") renderUndo();
    else if (nextStatus === "error" || nextStatus === "aborted") {
      undoSpec = null;
      undoBtn.hidden = true;
    }

    if (nextStatus === "running") {
      startTimer();
    } else {
      stopTimer();
    }

    if (nextStatus === "success" && data.result) {
      resultSection.hidden = false;
      resultSection.innerHTML = `
        <span class="ai-agent-tool-card__section-title">النتيجة:</span>
        <div dir="auto" class="ai-agent-tool-card__output">${escapeHtml(data.result)}</div>
      `;
    } else if (nextStatus === "error") {
      resultSection.hidden = false;
      const retryBadge = data.retrying
        ? `<span class="ai-agent-tool-card__retry-badge">جاري محاولة التصحيح التلقائي...</span>`
        : "";
      resultSection.innerHTML = `
        <span class="ai-agent-tool-card__section-title">ملاحظات التنفيذ:</span>
        <div class="ai-agent-tool-card__error-box">
          <p>${escapeHtml(data.error || "تعذر تنفيذ العملية.")}</p>
          ${retryBadge}
        </div>
      `;
      // Auto-expand card on error so diagnostics are visible
      body.hidden = false;
      toggleBtn.setAttribute("aria-expanded", "true");
      card.classList.add("is-expanded");
    } else if (nextStatus === "aborted") {
      resultSection.hidden = false;
      resultSection.innerHTML = `<div class="ai-agent-tool-card__aborted-box">تم إلغاء تنفيذ هذه الأداة.</div>`;
    }
  };

  updateIcon();
  if (currentStatus === "running") {
    startTimer();
  } else if (result || error) {
    card.updateStatus(currentStatus, { result, error });
  }

  return card;
}
