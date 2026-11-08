// =============================================================================
// public/src/components/ai-agent/ai-agent-settings.js
// Settings tab: lets users pick a provider and (optionally) store their own
// API key. Keys are stored client-side ONLY (localStorage via the shared
// storage-helpers), never sent anywhere except as part of a single request
// body to /api/ai-agent/chat, which does not persist them server-side.
// =============================================================================

import { createTelegramBotCard } from "../telegram-bot-card/telegram-bot-card.js";
import { getFromStorage, setInStorage } from "../../shared/storage-helpers.js";
import { isAdminAuthenticated } from "../../shared/adminAuth.js";

const PROVIDER_STORAGE_KEY = "ai_agent_provider";
const KEY_STORAGE_PREFIX = "ai_agent_key__"; // + provider
const SYSTEM_PROMPT_STORAGE_PREFIX = "ai_agent_system_prompt__"; // + pageKey
const MODEL_STORAGE_PREFIX = "ai_agent_model__"; // + provider
const EFFORT_STORAGE_PREFIX = "ai_agent_effort__"; // + provider

// Per-provider model catalog. The FIRST entry in each list is always the
// "default" — the fast and reliable model the provider offers.
const MODELS_BY_PROVIDER = {
  google: [
    { value: "gemini-flash-lite-latest", label: "Gemini Flash-Lite", description: "الأخف وزناً ومتاح مجاناً" },
    { value: "gemini-flash-latest", label: "Gemini Flash", description: "سريع ومتعدد الوسائط" },
    { value: "gemini-3.8-flash", label: "Gemini 3.8 Flash", description: "مهام برمجية معقدة" },
    { value: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro", description: "تفكير متقدم وتحليل منطقي" },
  ],
  deepseek: [
    { value: "deepseek-chat", label: "DeepSeek Chat", description: "محادثة ومهام عامة" },
    { value: "deepseek-reasoner", label: "DeepSeek Reasoner", description: "تفكير منطقي وحل معضلات" },
  ],
  claude: [
    { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", description: "سريع وخفيف" },
    { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", description: "توازن ذكي" },
    { value: "claude-opus-4-6", label: "Claude Opus 4.6", description: "أعلى أداء" },
  ],
};

export const EFFORT_LEVELS = [
  { value: "auto", label: "تلقائي (افتراضي)", hint: "يحدد النموذج عمق التفكير آلياً" },
  { value: "low", label: "منخفض (Low)", hint: "تفكير سريع وموجز" },
  { value: "medium", label: "متوسط (Medium)", hint: "تفكير متوازن" },
  { value: "high", label: "عالي (High)", hint: "تفكير عميق وتفصيلي" },
];

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
  const { hasKey } = getOwnKey();
  if (provider === "google" && !hasKey) {
    return "gemini-flash-lite-latest";
  }
  let model = getFromStorage(`${MODEL_STORAGE_PREFIX}${provider}`, "");
  if (provider === "google" && model === "gemini-2.5-pro") {
    model = "gemini-3.1-pro-preview";
    setInStorage(`${MODEL_STORAGE_PREFIX}${provider}`, model);
  }
  return model || (MODELS_BY_PROVIDER[provider] && MODELS_BY_PROVIDER[provider][0]?.value) || "";
}

export function setSelectedModel(provider, model) {
  const { hasKey } = getOwnKey();
  if (provider === "google" && !hasKey) {
    setInStorage(`${MODEL_STORAGE_PREFIX}${provider}`, "gemini-flash-lite-latest");
    return;
  }
  if (provider === "google" && model === "gemini-2.5-pro") {
    model = "gemini-3.1-pro-preview";
  }
  setInStorage(`${MODEL_STORAGE_PREFIX}${provider}`, model || "");
}

export function getSelectedEffort(provider = getSelectedProvider()) {
  return getFromStorage(`${EFFORT_STORAGE_PREFIX}${provider}`, "auto");
}

export function setSelectedEffort(provider, effort) {
  setInStorage(`${EFFORT_STORAGE_PREFIX}${provider}`, effort || "auto");
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
 * Whether the AI Helper can actually be used right now. Platform-key access
 * is open to everyone (admins uncapped, everyone else subject to a daily
 * quota enforced server-side — see AI_AGENT_DAILY_LIMIT in
 * api/ai-agent/chat.js), so this always returns true; kept as a named
 * function rather than inlined `true` since ai-agent-chat.js still calls
 * it as its eligibility check at the two call sites that predate this
 * change.
 * @returns {boolean}
 */
export function isAiHelperAvailable() {
  // Platform-key access is now open to everyone (admins uncapped, everyone
  // else subject to a server-enforced daily quota — see AI_AGENT_DAILY_LIMIT
  // in api/ai-agent/chat.js). There's no client-side way to know remaining
  // quota without a round trip, so this just reflects "the feature exists
  // for this user"; a 429 from the backend surfaces the actual cap.
  return true;
}

/**
 * @param {object} [options]
 * @param {string} [options.pageKey] - "home" | "result"; used to key the
 *   per-page system-prompt storage.
 * @param {string} [options.defaultSystemPrompt] - the page's default prompt,
 *   shown when no override has been saved.
 * @returns {HTMLElement} the settings panel root element
 */
// Suffixed onto every field id this function generates below, so two
// panel instances on the same page (unlikely today — see call site — but
// cheap to guard against) never collide on duplicate ids/label `for`
// targets.
let settingsPanelInstanceCounter = 0;

export function createSettingsPanel(options = {}) {
  const { pageKey = "default", defaultSystemPrompt = "", onKeyChanged = null } = options;
  const instanceId = `ai-agent-settings-${settingsPanelInstanceCounter++}`;
  const panel = document.createElement("div");
  panel.className = "ai-agent-panel ai-agent-settings-panel";

  const note = document.createElement("div");
  note.className = "ai-agent-settings-note";
  note.textContent =
    "لن يتم تخزين مفتاحك على خوادمنا — يُحفظ فقط على متصفحك.";
  panel.appendChild(note);

  // ── Provider select ──
  const providerLabel = document.createElement("label");
  providerLabel.className = "ai-agent-field-label";
  providerLabel.textContent = "مزوّد الذكاء الاصطناعي";
  providerLabel.htmlFor = `${instanceId}-provider`;
  panel.appendChild(providerLabel);

  const providerSelect = document.createElement("select");
  providerSelect.id = `${instanceId}-provider`;
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
  modelLabel.htmlFor = `${instanceId}-model`;
  panel.appendChild(modelLabel);

  const modelSelect = document.createElement("select");
  modelSelect.id = `${instanceId}-model`;
  modelSelect.className = "ai-agent-provider-select";
  panel.appendChild(modelSelect);

  function refreshModelSelectAvailability() {
    const { hasKey } = getOwnKey();
    const provider = providerSelect.value;
    if (!hasKey && provider === "google") {
      modelSelect.value = "gemini-flash-lite-latest";
    }
    modelSelect.disabled = !hasKey;
    modelSelect.title = hasKey
      ? ""
      : "اختيار النموذج متاح فقط عند استخدام مفتاح API الخاص بك. المستخدمون العاديون يستخدمون Gemini Flash-Lite.";
  }

  function loadModelsForCurrentProvider() {
    const provider = providerSelect.value;
    const { hasKey } = getOwnKey();
    modelSelect.innerHTML = "";
    const models = getModelsForProvider(provider);
    models.forEach(({ value, label }) => {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = (!hasKey && value !== "gemini-flash-lite-latest") ? `🔒 ${label}` : label;
      modelSelect.appendChild(opt);
    });
    modelSelect.value = getSelectedModel() || (models[0] && models[0].value) || "";
    refreshModelSelectAvailability();
  }
  loadModelsForCurrentProvider();

  modelSelect.addEventListener("change", () => {
    setSelectedModel(providerSelect.value, modelSelect.value);
    if (typeof onKeyChanged === "function") onKeyChanged();
  });

  // ── Effort select (Thinking / Reasoning depth) ──
  const effortGroup = document.createElement("div");
  effortGroup.className = "ai-agent-settings-field-group";

  const effortLabel = document.createElement("label");
  effortLabel.className = "ai-agent-field-label";
  effortLabel.textContent = "مستوى التفكير / الجهد (Reasoning Effort)";
  effortLabel.htmlFor = `${instanceId}-effort`;
  effortGroup.appendChild(effortLabel);

  const effortSelect = document.createElement("select");
  effortSelect.id = `${instanceId}-effort`;
  effortSelect.className = "ai-agent-provider-select";
  EFFORT_LEVELS.forEach(({ value, label }) => {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    effortSelect.appendChild(opt);
  });
  effortSelect.value = getSelectedEffort(providerSelect.value);
  effortSelect.addEventListener("change", () => {
    setSelectedEffort(providerSelect.value, effortSelect.value);
    if (typeof onKeyChanged === "function") onKeyChanged();
  });
  effortGroup.appendChild(effortSelect);
  panel.appendChild(effortGroup);

  function refreshEffortAvailability() {
    // Show effort selection for Google provider (and reasoning models)
    const isGoogle = providerSelect.value === "google";
    effortGroup.style.display = isGoogle ? "block" : "none";
    effortSelect.value = getSelectedEffort(providerSelect.value);
  }
  refreshEffortAvailability();

  // ── Own key input ──
  // NOTE: the response-language select that used to live here was removed
  // per product decision — response language is now left entirely to the
  // model to infer (from the conversation itself, or an explicit ask in
  // the user's own prompt) rather than a separate setting.
  const keyLabel = document.createElement("label");
  keyLabel.className = "ai-agent-field-label";
  keyLabel.textContent = "مفتاح API الخاص بك (اختياري)";
  keyLabel.htmlFor = `${instanceId}-key`;
  panel.appendChild(keyLabel);

  const keyInput = document.createElement("input");
  keyInput.id = `${instanceId}-key`;
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
    refreshEffortAvailability();
    status.textContent = "";
    refreshKeySourceIndicator();
    updateKeyActionsVisibility();
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

  // Save / Clear are only surfaced when they're actually actionable:
  //   - nothing saved and nothing typed → both hidden (nothing to do)
  //   - nothing saved but the user is typing → Save appears alone
  //   - a saved value sits in the field untouched → Clear appears alone
  //   - an existing saved value was edited → both appear (Save persists
  //     the new value, Clear drops the stored one)
  function updateKeyActionsVisibility() {
    const { key: savedKey, hasKey: hasSavedKey } = getOwnKey();
    const typed = keyInput.value.trim();
    if (!hasSavedKey && typed === "") {
      saveBtn.hidden = true;
      clearBtn.hidden = true;
      return;
    }
    saveBtn.hidden = !(typed !== "" && (typed !== savedKey || !hasSavedKey));
    clearBtn.hidden = !hasSavedKey;
  }
  updateKeyActionsVisibility();

  keyInput.addEventListener("input", () => {
    updateKeyActionsVisibility();
    // Any keystroke invalidates whichever status message is showing.
    status.textContent = "";
  });

  // ── Key-source indicator ──
  // Mirrors the exact precedence ai-agent-chat.js::sendMessage uses (own
  // key first if saved, otherwise the platform pool — open to everyone,
  // admins uncapped, everyone else subject to a daily quota enforced
  // server-side) so what's shown here always matches what a message will
  // actually use — without making a network call just to render this panel.
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
    keySourceIndicator.className = "ai-agent-key-source ai-agent-key-source--platform";
    keySourceIndicator.textContent = isAdmin
      ? "🌐 يتم استخدام مفتاح المنصة — بلا حد استخدام يومي (حساب مشرف)."
      : "🌐 يتم استخدام مفتاح المنصة — يوجد حد استخدام يومي (لا يوجد مفتاح خاص محفوظ). احفظ مفتاحك الخاص أعلاه لاستخدام غير محدود.";
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
    refreshModelSelectAvailability();
    updateKeyActionsVisibility();
    if (typeof onKeyChanged === "function") onKeyChanged();
  });

  clearBtn.addEventListener("click", () => {
    const provider = providerSelect.value;
    clearOwnKey(provider);
    keyInput.value = "";
    status.className = "ai-agent-settings-status ai-agent-settings-status--cleared";
    status.textContent = "تم المسح";
    refreshKeySourceIndicator();
    refreshModelSelectAvailability();
    updateKeyActionsVisibility();
    if (typeof onKeyChanged === "function") onKeyChanged();
  });

  // ── System prompt (editable, page-scoped) ──
  const promptLabel = document.createElement("label");
  promptLabel.className = "ai-agent-field-label";
  promptLabel.textContent = "تعليمات النظام (System Prompt)";
  promptLabel.htmlFor = `${instanceId}-system-prompt`;
  panel.appendChild(promptLabel);

  const promptTextarea = document.createElement("textarea");
  promptTextarea.id = `${instanceId}-system-prompt`;
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

  // ── Access from phone and external apps ──
  const tgSection = document.createElement("div");
  tgSection.className = "ai-agent-telegram-settings-section";
  const tgHeading = document.createElement("h4");
  tgHeading.textContent = "الوصول من الهاتف والتطبيقات الخارجية";
  tgSection.append(tgHeading, createTelegramBotCard({ variant: "compact", showFeatures: false }));
  panel.appendChild(tgSection);

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