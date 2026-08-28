// =============================================================================
// public/src/components/ai-agent/ai-agent-settings.js
// Settings tab: lets users pick a provider and (optionally) store their own
// API key. Keys are stored client-side ONLY (localStorage via the shared
// storage-helpers), never sent anywhere except as part of a single request
// body to /api/ai-agent/chat, which does not persist them server-side.
// =============================================================================

import { getFromStorage, setInStorage } from "../../shared/storage-helpers.js";

const PROVIDER_STORAGE_KEY = "ai_agent_provider";
const KEY_STORAGE_PREFIX = "ai_agent_key__"; // + provider
const SYSTEM_PROMPT_STORAGE_PREFIX = "ai_agent_system_prompt__"; // + pageKey

const PROVIDERS = [
  { value: "google", label: "Google AI Studio (Gemini)" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "claude", label: "Claude" },
];

export function getSelectedProvider() {
  return getFromStorage(PROVIDER_STORAGE_KEY, "google");
}

function setSelectedProvider(provider) {
  setInStorage(PROVIDER_STORAGE_KEY, provider);
}

/**
 * @returns {{ key: string, hasKey: boolean }} the stored key for the
 *   currently-selected provider, if any.
 */
export function getOwnKey() {
  const provider = getSelectedProvider();
  const key = getFromStorage(`${KEY_STORAGE_PREFIX}${provider}`, "");
  return { key, hasKey: !!key };
}

function setOwnKey(provider, key) {
  setInStorage(`${KEY_STORAGE_PREFIX}${provider}`, key);
}

function clearOwnKey(provider) {
  setInStorage(`${KEY_STORAGE_PREFIX}${provider}`, "");
}

/**
 * @param {string} pageKey - "home" | "result"
 * @param {string} defaultPrompt - the page's default system prompt
 * @returns {string} the stored override, or defaultPrompt if unset/empty
 */
export function getSystemPrompt(pageKey, defaultPrompt) {
  const stored = getFromStorage(`${SYSTEM_PROMPT_STORAGE_PREFIX}${pageKey}`, "");
  return stored || defaultPrompt || "";
}

export function setSystemPrompt(pageKey, value) {
  setInStorage(`${SYSTEM_PROMPT_STORAGE_PREFIX}${pageKey}`, value);
}

export function resetSystemPrompt(pageKey) {
  setInStorage(`${SYSTEM_PROMPT_STORAGE_PREFIX}${pageKey}`, "");
}

/**
 * @param {object} [options]
 * @param {string} [options.pageKey] - "home" | "result"; used to key the
 *   per-page system-prompt storage.
 * @param {string} [options.defaultSystemPrompt] - the page's default prompt,
 *   shown when no override has been saved.
 * @returns {HTMLElement} the settings panel root element
 */
export function createSettingsPanel(options = {}) {
  const { pageKey = "default", defaultSystemPrompt = "" } = options;
  const panel = document.createElement("div");
  panel.className = "ai-agent-panel ai-agent-settings-panel";

  const note = document.createElement("div");
  note.className = "ai-agent-settings-note";
  note.textContent =
    "لن يتم تخزين مفتاحك على خوادمنا — يُحفظ فقط على جهازك ويُستخدم مباشرة عند إرسال رسائلك.";
  panel.appendChild(note);

  // ── Provider select ──
  const providerLabel = document.createElement("label");
  providerLabel.className = "ai-agent-field-label";
  providerLabel.textContent = "مزوّد الذكاء الاصطناعي";
  panel.appendChild(providerLabel);

  const providerSelect = document.createElement("select");
  providerSelect.className = "ai-agent-provider-select";
  PROVIDERS.forEach(({ value, label }) => {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    providerSelect.appendChild(opt);
  });
  providerSelect.value = getSelectedProvider();
  panel.appendChild(providerSelect);

  // ── Own key input ──
  const keyLabel = document.createElement("label");
  keyLabel.className = "ai-agent-field-label";
  keyLabel.textContent = "مفتاح API الخاص بك (اختياري)";
  panel.appendChild(keyLabel);

  const keyInput = document.createElement("input");
  keyInput.type = "password";
  keyInput.className = "ai-agent-key-input";
  keyInput.placeholder = "sk-...";
  keyInput.autocomplete = "off";
  panel.appendChild(keyInput);

  function loadKeyForCurrentProvider() {
    const { key } = getOwnKey();
    keyInput.value = key;
  }
  loadKeyForCurrentProvider();

  providerSelect.addEventListener("change", () => {
    setSelectedProvider(providerSelect.value);
    loadKeyForCurrentProvider();
    status.textContent = "";
  });

  // ── Save / clear actions ──
  const actions = document.createElement("div");
  actions.className = "ai-agent-settings-actions";

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "exam-action-btn exam-action-btn--primary";
  saveBtn.style.width = "auto";
  saveBtn.innerHTML = "<span>حفظ المفتاح</span>";

  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "exam-action-btn exam-action-btn--danger";
  clearBtn.style.width = "auto";
  clearBtn.innerHTML = "<span>مسح المفتاح</span>";

  actions.appendChild(saveBtn);
  actions.appendChild(clearBtn);
  panel.appendChild(actions);

  const status = document.createElement("div");
  status.className = "ai-agent-settings-status";
  panel.appendChild(status);

  saveBtn.addEventListener("click", () => {
    const provider = providerSelect.value;
    const key = keyInput.value.trim();
    if (!key) {
      status.className = "ai-agent-settings-status";
      status.textContent = "أدخل مفتاحًا صالحًا أولاً";
      return;
    }
    setOwnKey(provider, key);
    status.className = "ai-agent-settings-status ai-agent-settings-status--saved";
    status.textContent = "تم الحفظ ✓";
  });

  clearBtn.addEventListener("click", () => {
    const provider = providerSelect.value;
    clearOwnKey(provider);
    keyInput.value = "";
    status.className = "ai-agent-settings-status ai-agent-settings-status--cleared";
    status.textContent = "تم المسح";
  });

  // ── System prompt (editable, page-scoped) ──
  const promptLabel = document.createElement("label");
  promptLabel.className = "ai-agent-field-label";
  promptLabel.textContent = "تعليمات النظام (System Prompt)";
  panel.appendChild(promptLabel);

  const promptTextarea = document.createElement("textarea");
  promptTextarea.className = "ai-agent-system-prompt-input";
  promptTextarea.rows = 6;
  promptTextarea.value = getSystemPrompt(pageKey, defaultSystemPrompt);
  panel.appendChild(promptTextarea);

  const promptActions = document.createElement("div");
  promptActions.className = "ai-agent-settings-actions";

  const savePromptBtn = document.createElement("button");
  savePromptBtn.type = "button";
  savePromptBtn.className = "exam-action-btn exam-action-btn--primary";
  savePromptBtn.style.width = "auto";
  savePromptBtn.innerHTML = "<span>حفظ التعليمات</span>";

  const resetPromptBtn = document.createElement("button");
  resetPromptBtn.type = "button";
  resetPromptBtn.className = "exam-action-btn exam-action-btn--danger";
  resetPromptBtn.style.width = "auto";
  resetPromptBtn.innerHTML = "<span>إعادة تعيين للافتراضي</span>";

  promptActions.appendChild(savePromptBtn);
  promptActions.appendChild(resetPromptBtn);
  panel.appendChild(promptActions);

  const promptStatus = document.createElement("div");
  promptStatus.className = "ai-agent-settings-status";
  panel.appendChild(promptStatus);

  savePromptBtn.addEventListener("click", () => {
    setSystemPrompt(pageKey, promptTextarea.value.trim());
    promptStatus.className = "ai-agent-settings-status ai-agent-settings-status--saved";
    promptStatus.textContent = "تم الحفظ ✓";
  });

  resetPromptBtn.addEventListener("click", () => {
    resetSystemPrompt(pageKey);
    promptTextarea.value = defaultSystemPrompt || "";
    promptStatus.className = "ai-agent-settings-status ai-agent-settings-status--cleared";
    promptStatus.textContent = "تمت الإعادة للافتراضي";
  });

  return panel;
}
