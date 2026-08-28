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
 * @returns {HTMLElement} the settings panel root element
 */
export function createSettingsPanel() {
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

  return panel;
}
