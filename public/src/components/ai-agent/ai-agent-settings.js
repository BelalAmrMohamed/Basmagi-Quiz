// =============================================================================
// public/src/components/ai-agent/ai-agent-settings.js
// Settings of الباشــمبصمج: provider, the user's own API key, the custom system
// prompt and the phone/Telegram access card. Keys are stored client-side ONLY
// (localStorage via the shared storage-helpers), never sent anywhere except as part
// of a single request body to /api/ai-agent/chat, which does not persist them.
//
// The VIEW (createSettingsPanel) is shown INSIDE the agent window, not in a modal:
// ai-agent.js mounts it with openWindowLayer() (ai-agent-window.js). Model and
// reasoning-effort are NOT settings anymore — they live in the chat's model bar
// (core/chat-settings.js), which still reads them through the storage helpers
// exported below (getSelectedModel / getSelectedEffort / …).
// =============================================================================

import { createTelegramBotCard } from "../telegram-bot-card/telegram-bot-card.js";
import { getFromStorage, setInStorage } from "../../shared/storage-helpers.js";
import { isAdminAuthenticated } from "../../shared/adminAuth.js";
import { getModels, getModelMeta, getEffortLevels, DEFAULT_MODELS, OWN_KEY_DEFAULT_MODELS } from "../../shared/ai-models.js";

const PROVIDER_STORAGE_KEY = "ai_agent_provider";
const KEY_STORAGE_PREFIX = "ai_agent_key__"; // + provider
const SYSTEM_PROMPT_STORAGE_PREFIX = "ai_agent_system_prompt__"; // + pageKey
const MODEL_STORAGE_PREFIX = "ai_agent_model__"; // + provider
const EFFORT_STORAGE_PREFIX = "ai_agent_effort__"; // + provider

// The model catalog lives in ../../shared/ai-models.js (shared with the server,
// so the allowlist, defaults, lock rules and thinking levels cannot drift).
export const EFFORT_LEVELS = [
  { value: "auto", label: "تلقائي (افتراضي)", hint: "يحدد النموذج عمق التفكير آلياً" },
  { value: "low", label: "منخفض (Low)", hint: "تفكير سريع وموجز" },
  { value: "medium", label: "متوسط (Medium)", hint: "تفكير متوازن" },
  { value: "high", label: "عالي (High)", hint: "تفكير عميق وتفصيلي" },
  { value: "xhigh", label: "فائق (XHigh)", hint: "أقصى عمق تفكير (Hydrogen فقط)" },
];

/** Effort options valid for one model (empty = the model has no thinking control). */
export function getEffortLevelsForModel(provider, model) {
  const allowed = getEffortLevels(provider, model);
  return EFFORT_LEVELS.filter((e) => e.value === "auto" ? allowed.length > 0 : allowed.includes(e.value));
}

const PROVIDERS = [
  { value: "google", label: "Gemini", sub: "Google AI Studio", keyHint: "AIza…" },
  { value: "deepseek", label: "DeepSeek", sub: "DeepSeek", keyHint: "sk-…" },
  { value: "claude", label: "Claude", sub: "Anthropic", keyHint: "sk-ant-…" },
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
  return getModels(provider).map((m) => ({
    value: m.id, label: m.label, description: m.description, badge: m.badge, platformFree: m.platformFree,
  }));
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
  const stored = getFromStorage(`${MODEL_STORAGE_PREFIX}${provider}`, "");
  const meta = stored ? getModelMeta(provider, stored) : null; // also maps retired ids
  // Platform keys: only free-tier-safe models; everything else needs the user's own key.
  if (!hasKey && provider === "google") return meta?.platformFree ? meta.id : DEFAULT_MODELS.google;
  if (meta) {
    if (meta.id !== stored) setInStorage(`${MODEL_STORAGE_PREFIX}${provider}`, meta.id);
    return meta.id;
  }
  return (hasKey ? OWN_KEY_DEFAULT_MODELS : DEFAULT_MODELS)[provider] || "";
}

export function setSelectedModel(provider, model) {
  const { hasKey } = getOwnKey();
  const meta = getModelMeta(provider, model);
  if (provider === "google" && !hasKey && !meta?.platformFree) {
    setInStorage(`${MODEL_STORAGE_PREFIX}${provider}`, DEFAULT_MODELS.google);
    return;
  }
  setInStorage(`${MODEL_STORAGE_PREFIX}${provider}`, meta?.id || "");
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

/** True when the user saved their own prompt for this page (an empty override means "default"). */
export function hasCustomSystemPrompt(pageKey) {
  return !!getFromStorage(`${SYSTEM_PROMPT_STORAGE_PREFIX}${pageKey}`, "");
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

// ── Settings view ─────────────────────────────────────────────────────────────
const ICON_BACK = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>';
const ICON_EYE = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const ICON_EYE_OFF = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.9 4.24A10.9 10.9 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.2"/><path d="M6.6 6.6A17.4 17.4 0 0 0 2 12s3.6 7 10 7a10.6 10.6 0 0 0 5.4-1.5"/><path d="m2 2 20 20"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';
const ICON_LOCK = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';

// Unsaved system-prompt edits survive closing and reopening the view (in memory only).
const promptDrafts = new Map(); // pageKey -> text

// Suffixed onto every generated id so two views on one page never collide.
let settingsPanelInstanceCounter = 0;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function group(id, title, description) {
  const section = el("section", "ai-set-group");
  section.setAttribute("aria-labelledby", id);
  const head = el("div", "ai-set-group-head");
  const h = el("h3", "ai-set-group-title", title);
  h.id = id;
  head.appendChild(h);
  if (description) head.appendChild(el("p", "ai-set-group-desc", description));
  section.appendChild(head);
  return section;
}

/**
 * @param {object} [options]
 * @param {string} [options.pageKey] - "home" | "result" | …; keys the per-page system prompt.
 * @param {string} [options.defaultSystemPrompt] - the page's default prompt (shown until the user saves their own).
 * @param {() => void} [options.onKeyChanged] - fired after the provider or the saved key changes
 *   (the chat refreshes its availability gate and model bar).
 * @param {() => void} [options.onBack] - the back button.
 * @returns {HTMLElement} the settings view root (header with a back button + scrollable sections)
 */
export function createSettingsPanel(options = {}) {
  const { pageKey = "default", defaultSystemPrompt = "", onKeyChanged = null, onBack = null } = options;
  const id = `ai-set-${settingsPanelInstanceCounter++}`;
  const notify = () => { if (typeof onKeyChanged === "function") onKeyChanged(); };

  const root = el("div", "ai-set");
  root.dir = "rtl";

  // ── Header ──
  const header = el("div", "ai-set-header");
  const backBtn = el("button", "ai-set-back");
  backBtn.type = "button";
  backBtn.setAttribute("aria-label", "رجوع إلى المحادثة");
  backBtn.innerHTML = `${ICON_BACK}<span>رجوع</span>`;
  backBtn.addEventListener("click", () => { if (typeof onBack === "function") onBack(); });
  const title = el("h2", "ai-set-title", "الإعدادات");
  title.id = `${id}-title`;
  header.append(backBtn, title);
  root.appendChild(header);

  const scroll = el("div", "ai-set-scroll");
  const content = el("div", "ai-set-content");
  scroll.appendChild(content);
  root.appendChild(scroll);

  // ══ 1) Provider + own key ══
  const connect = group(`${id}-g-connect`, "المزوّد ومفتاح API", "اختر مزوّد الذكاء الاصطناعي، وأضف مفتاحك الخاص إن أردت استخدامًا بلا حد يومي من المنصة.");
  const connectCard = el("div", "ai-set-card");

  const sourceBox = el("div", "ai-set-source");
  const sourceDot = el("span", "ai-set-source-dot");
  sourceDot.setAttribute("aria-hidden", "true");
  const sourceCopy = el("div", "ai-set-source-copy");
  const sourceTitle = el("strong", "ai-set-source-title");
  const sourceText = el("span", "ai-set-source-text");
  sourceCopy.append(sourceTitle, sourceText);
  sourceBox.append(sourceDot, sourceCopy);
  connectCard.appendChild(sourceBox);

  const providerSet = el("fieldset", "ai-set-fieldset");
  providerSet.appendChild(el("legend", "ai-set-label", "المزوّد"));
  const providerRow = el("div", "ai-set-segments");
  PROVIDERS.forEach(({ value, label, sub }) => {
    const choice = el("label", "ai-set-segment");
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = `${id}-provider`;
    radio.value = value;
    radio.checked = value === getSelectedProvider();
    choice.append(radio, el("span", "ai-set-segment-name", label), el("span", "ai-set-segment-sub", sub));
    providerRow.appendChild(choice);
  });
  providerSet.appendChild(providerRow);
  connectCard.appendChild(providerSet);

  const keyField = el("div", "ai-set-field");
  const keyLabel = el("label", "ai-set-label", "مفتاح API الخاص بك (اختياري)");
  keyLabel.htmlFor = `${id}-key`;
  const keyWrap = el("div", "ai-set-input-wrap");
  const keyInput = document.createElement("input");
  keyInput.id = `${id}-key`;
  keyInput.type = "password";
  keyInput.className = "ai-set-input";
  keyInput.dir = "ltr";
  keyInput.autocomplete = "off";
  keyInput.spellcheck = false;
  keyInput.setAttribute("autocapitalize", "off");
  keyInput.setAttribute("aria-describedby", `${id}-key-hint ${id}-key-status`);
  const eyeBtn = el("button", "ai-set-icon-btn");
  eyeBtn.type = "button";
  eyeBtn.setAttribute("aria-label", "إظهار المفتاح");
  eyeBtn.setAttribute("aria-pressed", "false");
  eyeBtn.innerHTML = ICON_EYE;
  eyeBtn.addEventListener("click", () => {
    const show = keyInput.type === "password";
    keyInput.type = show ? "text" : "password";
    eyeBtn.setAttribute("aria-pressed", String(show));
    eyeBtn.setAttribute("aria-label", show ? "إخفاء المفتاح" : "إظهار المفتاح");
    eyeBtn.innerHTML = show ? ICON_EYE_OFF : ICON_EYE;
  });
  keyWrap.append(keyInput, eyeBtn);
  const keyHint = el("p", "ai-set-hint");
  keyHint.id = `${id}-key-hint`;
  keyHint.innerHTML = `${ICON_LOCK}<span>يُحفظ المفتاح على متصفحك فقط ولا نخزّنه على خوادمنا.</span>`;
  keyField.append(keyLabel, keyWrap, keyHint);
  connectCard.appendChild(keyField);

  const keyActions = el("div", "ai-set-actions");
  const saveBtn = el("button", "ai-set-btn ai-set-btn--primary", "حفظ المفتاح");
  saveBtn.type = "button";
  const clearBtn = el("button", "ai-set-btn ai-set-btn--danger", "مسح المفتاح");
  clearBtn.type = "button";
  keyActions.append(saveBtn, clearBtn);
  connectCard.appendChild(keyActions);
  const keyStatus = el("div", "ai-set-status");
  keyStatus.id = `${id}-key-status`;
  keyStatus.setAttribute("role", "status");
  connectCard.appendChild(keyStatus);

  connect.appendChild(connectCard);
  content.appendChild(connect);

  function setStatus(node, text, kind = "") {
    node.className = `ai-set-status${kind ? ` ai-set-status--${kind}` : ""}`;
    node.textContent = text;
  }
  const currentProvider = () => providerRow.querySelector("input:checked")?.value || getSelectedProvider();

  // Mirrors the precedence ai-agent-chat.js::sendMessage uses (own key first, otherwise the
  // platform pool: admins uncapped, everyone else under a server-enforced daily quota).
  function refreshSource() {
    const { hasKey } = getOwnKey();
    const isAdmin = !hasKey && isAdminAuthenticated();
    sourceBox.dataset.source = hasKey ? "own" : "platform";
    sourceTitle.textContent = hasKey ? "تستخدم مفتاحك الخاص" : "تستخدم مفتاح المنصة";
    sourceText.textContent = hasKey
      ? "الطلبات تُحسب على حسابك لدى المزوّد، دون حد يومي من المنصة."
      : isAdmin
        ? "بلا حد استخدام يومي (حساب مشرف)."
        : "يوجد حد استخدام يومي. احفظ مفتاحك الخاص لاستخدام غير محدود.";
  }

  // Save / clear only appear when they can do something:
  //   nothing saved, nothing typed → both hidden · typing → Save · saved and untouched → Clear ·
  //   saved value edited → both.
  function refreshKeyActions() {
    const { key: savedKey, hasKey } = getOwnKey();
    const typed = keyInput.value.trim();
    saveBtn.hidden = !(typed !== "" && (typed !== savedKey || !hasKey));
    clearBtn.hidden = !hasKey;
    keyActions.hidden = saveBtn.hidden && clearBtn.hidden;
  }

  function loadKeyForProvider() {
    keyInput.value = getOwnKey().key;
    keyInput.placeholder = PROVIDERS.find((p) => p.value === currentProvider())?.keyHint || "";
  }

  providerRow.addEventListener("change", () => {
    setSelectedProvider(currentProvider());
    loadKeyForProvider();
    setStatus(keyStatus, "");
    refreshSource();
    refreshKeyActions();
    notify(); // the model bar lists the new provider's models
  });

  keyInput.addEventListener("input", () => { setStatus(keyStatus, ""); refreshKeyActions(); });
  keyInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !saveBtn.hidden) { e.preventDefault(); saveBtn.click(); }
  });
  saveBtn.addEventListener("click", () => {
    const key = keyInput.value.trim();
    if (!key) { setStatus(keyStatus, "أدخل مفتاحًا صالحًا أولًا", "error"); return; }
    setOwnKey(currentProvider(), key);
    setStatus(keyStatus, "تم حفظ المفتاح ✓", "saved");
    refreshSource();
    refreshKeyActions();
    notify();
  });
  clearBtn.addEventListener("click", () => {
    clearOwnKey(currentProvider());
    keyInput.value = "";
    setStatus(keyStatus, "تم مسح المفتاح", "cleared");
    refreshSource();
    refreshKeyActions();
    notify();
  });
  loadKeyForProvider();
  refreshSource();
  refreshKeyActions();

  // ══ 2) System prompt ══
  const promptGroup = group(`${id}-g-prompt`, "تعليمات المساعد", "تحدّد شخصية المساعد وأسلوب ردوده في هذه الصفحة. يمكنك تعديلها أو العودة إلى الافتراضية.");
  const promptCard = el("div", "ai-set-card");
  const promptTop = el("div", "ai-set-field-top");
  const promptLabel = el("label", "ai-set-label", "التعليمات (System Prompt)");
  promptLabel.htmlFor = `${id}-prompt`;
  const promptBadge = el("span", "ai-set-badge");
  promptTop.append(promptLabel, promptBadge);

  const promptArea = document.createElement("textarea");
  promptArea.id = `${id}-prompt`;
  promptArea.className = "ai-set-input ai-set-textarea";
  promptArea.rows = 8;
  promptArea.dir = "auto";
  promptArea.setAttribute("aria-describedby", `${id}-prompt-meta ${id}-prompt-status`);
  const savedPrompt = () => getSystemPrompt(pageKey, defaultSystemPrompt);
  promptArea.value = promptDrafts.has(pageKey) ? promptDrafts.get(pageKey) : savedPrompt();

  const promptMeta = el("div", "ai-set-meta");
  promptMeta.id = `${id}-prompt-meta`;
  const promptCount = el("span", "ai-set-count");
  const promptDirty = el("span", "ai-set-dirty", "تعديلات غير محفوظة");
  promptMeta.append(promptCount, promptDirty);

  const promptActions = el("div", "ai-set-actions");
  const savePromptBtn = el("button", "ai-set-btn ai-set-btn--primary", "حفظ التعليمات");
  savePromptBtn.type = "button";
  const resetPromptBtn = el("button", "ai-set-btn ai-set-btn--quiet", "استعادة الافتراضية");
  resetPromptBtn.type = "button";
  promptActions.append(savePromptBtn, resetPromptBtn);
  const promptStatus = el("div", "ai-set-status");
  promptStatus.id = `${id}-prompt-status`;
  promptStatus.setAttribute("role", "status");

  function refreshPromptState() {
    const dirty = promptArea.value.trim() !== savedPrompt().trim();
    promptCount.textContent = `${promptArea.value.length.toLocaleString("ar-EG")} حرف`;
    promptDirty.hidden = !dirty;
    savePromptBtn.disabled = !dirty;
    const custom = hasCustomSystemPrompt(pageKey);
    promptBadge.textContent = custom ? "مخصّصة" : "افتراضية";
    promptBadge.classList.toggle("ai-set-badge--on", custom);
    resetPromptBtn.disabled = !custom && promptArea.value.trim() === (defaultSystemPrompt || "").trim();
    if (dirty) promptDrafts.set(pageKey, promptArea.value); else promptDrafts.delete(pageKey);
  }
  promptArea.addEventListener("input", () => { setStatus(promptStatus, ""); refreshPromptState(); });
  savePromptBtn.addEventListener("click", () => {
    const value = promptArea.value.trim();
    // Saving the default text unchanged is the same as having no override.
    if (!value || value === (defaultSystemPrompt || "").trim()) resetSystemPrompt(pageKey);
    else setSystemPrompt(pageKey, value);
    promptDrafts.delete(pageKey);
    refreshPromptState();
    setStatus(promptStatus, "تم حفظ التعليمات ✓", "saved");
  });
  resetPromptBtn.addEventListener("click", () => {
    resetSystemPrompt(pageKey);
    promptDrafts.delete(pageKey);
    promptArea.value = defaultSystemPrompt || "";
    refreshPromptState();
    setStatus(promptStatus, "عادت التعليمات إلى الافتراضية", "cleared");
  });
  refreshPromptState();

  promptCard.append(promptTop, promptArea, promptMeta, promptActions, promptStatus);
  promptGroup.appendChild(promptCard);
  content.appendChild(promptGroup);

  // ══ 3) Phone / external apps ══
  const phoneGroup = group(`${id}-g-phone`, "الوصول من الهاتف والتطبيقات الخارجية");
  const phoneCard = el("div", "ai-set-card ai-set-card--flush");
  phoneCard.appendChild(createTelegramBotCard({ variant: "compact", showFeatures: false }));
  phoneGroup.appendChild(phoneCard);
  content.appendChild(phoneGroup);

  root.focusTarget = backBtn;
  return root;
}
