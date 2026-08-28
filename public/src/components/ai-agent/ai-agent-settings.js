// =============================================================================
// public/src/components/ai-agent/ai-agent-settings.js
// Settings tab: lets users pick a provider and (optionally) store their own
// API key. Keys are stored client-side ONLY (localStorage via the shared
// storage-helpers), never sent anywhere except as part of a single request
// body to /api/ai-agent/chat, which does not persist them server-side.
// =============================================================================

import { getFromStorage, setInStorage } from "../../shared/storage-helpers.js";
import { isAdminAuthenticated } from "../../shared/adminAuth.js";
import { getCachedLevel } from "../../shared/userLevel.js";

const PROVIDER_STORAGE_KEY = "ai_agent_provider";
const KEY_STORAGE_PREFIX = "ai_agent_key__"; // + provider
const SYSTEM_PROMPT_STORAGE_PREFIX = "ai_agent_system_prompt__"; // + pageKey
const LANGUAGE_STORAGE_PREFIX = "ai_agent_language__"; // + pageKey

const LANGUAGES = [
  { value: "auto", label: "تلقائي (بحسب لغتك)" },
  { value: "ar", label: "العربية" },
  { value: "en", label: "English" },
];

// Appended to the system prompt sent to the model — kept short and in
// both languages so it reads correctly regardless of which the model
// currently favors. "auto" adds nothing: the page's own default system
// prompt already tells the model which language to default to, and lets
// it otherwise mirror whatever language the user writes in.
const LANGUAGE_DIRECTIVES = {
  ar: "\n\nمهم: أجب دائمًا باللغة العربية فقط، بغض النظر عن لغة سؤال المستخدم.",
  en: "\n\nImportant: Always respond in English only, regardless of the language the user writes in.",
};

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
 * @param {string} pageKey - "home" | "result"
 * @returns {"auto"|"ar"|"en"}
 */
export function getResponseLanguage(pageKey) {
  return getFromStorage(`${LANGUAGE_STORAGE_PREFIX}${pageKey}`, "auto");
}

export function setResponseLanguage(pageKey, value) {
  setInStorage(`${LANGUAGE_STORAGE_PREFIX}${pageKey}`, value);
}

/**
 * Appends the language directive (if any) for the currently-selected
 * response language to a system prompt. Called from ai-agent-chat.js right
 * before sending, so every request (including tool-enabled ones) respects
 * the user's choice without each page needing to wire this up itself.
 * @param {string} pageKey
 * @param {string} systemPrompt
 * @returns {string}
 */
export function applyResponseLanguage(pageKey, systemPrompt) {
  const lang = getResponseLanguage(pageKey);
  const directive = LANGUAGE_DIRECTIVES[lang];
  return directive ? `${systemPrompt || ""}${directive}` : systemPrompt || "";
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

  // ── Response language select ──
  // Scoped per-page (like the system prompt) since the quizzes on "home"
  // and the result being analyzed on "result" can each be in either
  // language independent of the other page.
  const languageLabel = document.createElement("label");
  languageLabel.className = "ai-agent-field-label";
  languageLabel.textContent = "لغة ردود المساعد";
  panel.appendChild(languageLabel);

  const languageSelect = document.createElement("select");
  languageSelect.className = "ai-agent-provider-select";
  LANGUAGES.forEach(({ value, label }) => {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    languageSelect.appendChild(opt);
  });
  languageSelect.value = getResponseLanguage(pageKey);
  panel.appendChild(languageSelect);

  languageSelect.addEventListener("change", () => {
    setResponseLanguage(pageKey, languageSelect.value);
  });

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
    refreshKeySourceIndicator();
  });

  // ── Save / clear actions ──
  const actions = document.createElement("div");
  actions.className = "ai-agent-settings-actions";

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "ai-agent-btn ai-agent-btn--primary";
  saveBtn.style.width = "auto";
  saveBtn.innerHTML = "<span>حفظ المفتاح</span>";

  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "ai-agent-btn ai-agent-btn--danger";
  clearBtn.style.width = "auto";
  clearBtn.innerHTML = "<span>مسح المفتاح</span>";

  actions.appendChild(saveBtn);
  actions.appendChild(clearBtn);
  panel.appendChild(actions);

  const status = document.createElement("div");
  status.className = "ai-agent-settings-status";
  panel.appendChild(status);

  // ── Key-source indicator ──
  // Mirrors the exact precedence ai-agent-chat.js::sendMessage uses (own
  // key first if saved, otherwise the platform pool via admin/Level 10+
  // auth) so what's shown here always matches what a message will actually
  // use — without making a network call just to render this panel.
  const keySourceIndicator = document.createElement("div");
  keySourceIndicator.className = "ai-agent-key-source";
  panel.appendChild(keySourceIndicator);

  function refreshKeySourceIndicator() {
    const { hasKey } = getOwnKey();
    if (hasKey) {
      keySourceIndicator.className = "ai-agent-key-source ai-agent-key-source--own";
      keySourceIndicator.textContent = "🔑 يتم استخدام مفتاحك الخاص حاليًا";
      return;
    }
    const isAdmin = isAdminAuthenticated();
    const level = getCachedLevel();
    const eligible = isAdmin || (typeof level === "number" && level >= 10);
    if (eligible) {
      keySourceIndicator.className = "ai-agent-key-source ai-agent-key-source--platform";
      keySourceIndicator.textContent = "🌐 يتم استخدام مفتاح المنصة (لا يوجد مفتاح خاص محفوظ)";
    } else {
      keySourceIndicator.className = "ai-agent-key-source ai-agent-key-source--none";
      keySourceIndicator.textContent =
        "⚠️ لا يوجد مفتاح خاص محفوظ، ولا تملك صلاحية استخدام مفتاح المنصة (متاح للمشرفين أو مستخدمي المستوى 10+) — احفظ مفتاحك الخاص أعلاه لاستخدام المساعد.";
    }
  }
  refreshKeySourceIndicator();

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
    refreshKeySourceIndicator();
  });

  clearBtn.addEventListener("click", () => {
    const provider = providerSelect.value;
    clearOwnKey(provider);
    keyInput.value = "";
    status.className = "ai-agent-settings-status ai-agent-settings-status--cleared";
    status.textContent = "تم المسح";
    refreshKeySourceIndicator();
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
  savePromptBtn.className = "ai-agent-btn ai-agent-btn--primary";
  savePromptBtn.style.width = "auto";
  savePromptBtn.innerHTML = "<span>حفظ التعليمات</span>";

  const resetPromptBtn = document.createElement("button");
  resetPromptBtn.type = "button";
  resetPromptBtn.className = "ai-agent-btn ai-agent-btn--danger";
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