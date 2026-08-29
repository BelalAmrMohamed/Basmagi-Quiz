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
const MODEL_STORAGE_PREFIX = "ai_agent_model__"; // + provider

// Per-provider model catalog. The FIRST entry in each list is always the
// "default" — deliberately the lightest/cheapest/latest model the provider
// offers, mirroring api/ai-agent/_providerClients.js's own hardcoded
// choice, so a user who never opens this dropdown still gets the same
// default behavior as before this feature existed. `value: ""` means
// "let the backend decide" (i.e. use its own default pointer) rather than
// pinning a specific model string from the client — this is the initial/
// unset state and is what an empty/never-saved selection resolves to.
//
// Google uses a dynamic "-latest" pointer (gemini-flash-lite-latest) that
// the provider itself keeps pointed at its current lightest model, so no
// version number ever goes stale here. DeepSeek and Claude don't publish
// that kind of alias, so their entries are the latest hardcoded snapshot
// versions available at time of writing — see _providerClients.js, which
// this list is kept in sync with.
const MODELS_BY_PROVIDER = {
  google: [
    { value: "", label: "الأخف والأحدث تلقائيًا (gemini-flash-lite-latest)" },
    { value: "gemini-flash-lite-latest", label: "Gemini Flash-Lite (الأخف)" },
    { value: "gemini-flash-latest", label: "Gemini Flash" },
    { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro (الأقوى)" },
  ],
  deepseek: [
    { value: "", label: "الأخف والأحدث تلقائيًا (deepseek-chat)" },
    { value: "deepseek-chat", label: "DeepSeek Chat (الأخف)" },
    { value: "deepseek-reasoner", label: "DeepSeek Reasoner (الأقوى)" },
  ],
  claude: [
    { value: "", label: "الأخف والأحدث تلقائيًا (claude-haiku-4-5)" },
    { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5 (الأخف)" },
    { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
    { value: "claude-opus-4-6", label: "Claude Opus 4.6 (الأقوى)" },
  ],
};

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
 * @returns {Array<{value: string, label: string}>} the model catalog for
 *   the given provider, falling back to google's list shape for an
 *   unrecognized provider so callers never get `undefined`.
 */
export function getModelsForProvider(provider) {
  return MODELS_BY_PROVIDER[provider] || MODELS_BY_PROVIDER.google;
}

/**
 * @returns {string} the currently-selected model for the currently-selected
 *   provider, or "" (meaning "use the provider's own default") if unset.
 *   Cleared automatically per-provider — switching providers never leaks
 *   one provider's model id into another's request.
 */
export function getSelectedModel() {
  const provider = getSelectedProvider();
  return getFromStorage(`${MODEL_STORAGE_PREFIX}${provider}`, "");
}

export function setSelectedModel(provider, model) {
  setInStorage(`${MODEL_STORAGE_PREFIX}${provider}`, model || "");
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
 * Whether the AI Helper can actually be used right now, without a network
 * round-trip: either the user has saved their own API key (any provider),
 * or they have platform access (admin, or a cached Level 10+ user level).
 * Mirrors the exact precedence sendMessage() in ai-agent-chat.js uses when
 * deciding which key to send — this is the same eligibility check
 * refreshKeySourceIndicator() below already computes for the Settings
 * tab's key-source line, factored out so the Chat tab (ai-agent-chat.js)
 * can show an upfront "unavailable" placeholder instead of only surfacing
 * this as a backend error after the user tries to send a message.
 * @returns {boolean}
 */
export function isAiHelperAvailable() {
  const { hasKey } = getOwnKey();
  if (hasKey) return true;
  const isAdmin = isAdminAuthenticated();
  const level = getCachedLevel();
  return isAdmin || (typeof level === "number" && level >= 10);
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
  const { pageKey = "default", defaultSystemPrompt = "", onKeyChanged = null } = options;
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

  // ── Model select ──
  // Scoped per-provider (not per-page) — a user's model preference for
  // "Google" should follow them from the home page's chat to the result
  // page's chat, same as the provider and own-key choices already do.
  const modelLabel = document.createElement("label");
  modelLabel.className = "ai-agent-field-label";
  modelLabel.textContent = "النموذج (Model)";
  panel.appendChild(modelLabel);

  const modelSelect = document.createElement("select");
  modelSelect.className = "ai-agent-provider-select";
  panel.appendChild(modelSelect);

  function loadModelsForCurrentProvider() {
    const provider = providerSelect.value;
    modelSelect.innerHTML = "";
    getModelsForProvider(provider).forEach(({ value, label }) => {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = label;
      modelSelect.appendChild(opt);
    });
    modelSelect.value = getSelectedModel();
  }
  loadModelsForCurrentProvider();

  modelSelect.addEventListener("change", () => {
    setSelectedModel(providerSelect.value, modelSelect.value);
    if (typeof onKeyChanged === "function") onKeyChanged();
  });

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
    loadModelsForCurrentProvider();
    status.textContent = "";
    refreshKeySourceIndicator();
    if (typeof onKeyChanged === "function") onKeyChanged();
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
    if (isAiHelperAvailable()) {
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
    if (typeof onKeyChanged === "function") onKeyChanged();
  });

  clearBtn.addEventListener("click", () => {
    const provider = providerSelect.value;
    clearOwnKey(provider);
    keyInput.value = "";
    status.className = "ai-agent-settings-status ai-agent-settings-status--cleared";
    status.textContent = "تم المسح";
    refreshKeySourceIndicator();
    if (typeof onKeyChanged === "function") onKeyChanged();
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