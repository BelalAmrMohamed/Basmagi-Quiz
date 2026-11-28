// Single source of truth for the AI chat model catalog.
// Imported by BOTH the browser (ai-agent-settings.js, chat-settings.js) and the
// server (api/ai-agent/_providerClients.js, chat.js, bot.js), so the allowlist,
// defaults, lock rules and thinking levels can never drift apart.
// Pure data + pure functions: no DOM, no Node APIs.
//
// Per model:
//   id             exact API model id (prefer "-latest" aliases where they exist)
//   label          shown in the model menu
//   description    one-line hint (Arabic, shown in the menu)
//   platformFree   true  -> may be used with the platform's shared free-tier keys
//                  (unlocked for everyone). false -> needs the user's own key.
//   badge          optional short tag shown next to the label ("Free" badge)
//   effort         thinking levels the model accepts ([] = no thinking menu)

export const EFFORT_VALUES = ["low", "medium", "high", "xhigh"];

export const AI_MODELS = {
  google: [
    { id: "gemini-flash-lite-latest", label: "Gemini Flash-Lite", description: "الأخف وزناً وسريع", platformFree: true, badge: "مجاني", effort: [] },
    { id: "gemini-4-hydrogen", label: "Gemini 4 Hydrogen", description: "أحدث جيل، ذكي وسريع", platformFree: true, badge: "مجاني", effort: ["low", "medium", "high", "xhigh"] },
    { id: "gemini-4-argon", label: "Gemini 4 Argon", description: "الأقوى: تفكير وبرمجة ورياضيات", platformFree: false, badge: "مدفوع", effort: ["low", "medium", "high"] },
  ],
  deepseek: [
    { id: "deepseek-flash", label: "DeepSeek V4.1 Flash", description: "سريع للمحادثة والمهام العامة", platformFree: false, effort: [] },
    { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro", description: "تفكير منطقي وحل معضلات", platformFree: false, effort: [] },
  ],
  // Anthropic publishes no "-latest" aliases for the 5.x generation.
  claude: [
    { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", description: "سريع وخفيف", platformFree: false, effort: [] },
    { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", description: "توازن ذكي", platformFree: false, effort: [] },
    { id: "claude-opus-5-5", label: "Claude Opus 5.5", description: "أداء عالٍ للمهام المعقدة", platformFree: false, effort: [] },
    { id: "claude-fable-5-2", label: "Claude Fable 5.2", description: "الأعلى أداءً", platformFree: false, effort: [] },
  ],
};

// Used with the platform's shared keys when nothing (or something not allowed) is requested.
export const DEFAULT_MODELS = {
  google: "gemini-flash-lite-latest",
  deepseek: "deepseek-flash",
  claude: "claude-haiku-5-5",
};

// Used when the user brings their own key and has not picked a model yet.
export const OWN_KEY_DEFAULT_MODELS = {
  ...DEFAULT_MODELS,
  google: "gemini-4-argon",
};

// Retired ids (old clients / saved browser settings) -> closest current model. Append-only.
export const LEGACY_MODEL_MAP = {
  "gemini-flash-latest": "gemini-4-hydrogen",
  "gemini-3.8-flash": "gemini-4-hydrogen",
  "gemini-2.5-pro": "gemini-4-argon",
  "gemini-3.1-pro-preview": "gemini-4-argon",
  "deepseek-chat": "deepseek-flash",
  "deepseek-reasoner": "deepseek-v4-pro",
  "claude-haiku-4-5-20251001": "claude-haiku-5-5",
  "claude-sonnet-4-6": "claude-sonnet-5-5",
  "claude-opus-4-6": "claude-opus-5-5",
};

export function getModels(provider) {
  return AI_MODELS[provider] || AI_MODELS.google;
}

export function getModelMeta(provider, id) {
  const wanted = LEGACY_MODEL_MAP[id] || id;
  return (AI_MODELS[provider] || []).find((m) => m.id === wanted) || null;
}

/** Validated model id for a request; falls back to `fallback` (default: provider default). */
export function resolveModelId(provider, requested, fallback = DEFAULT_MODELS[provider]) {
  const meta = requested ? getModelMeta(provider, requested) : null;
  return meta ? meta.id : fallback;
}

/** Model for the shared platform keys: the request if it is free-tier safe, else the default. */
export function resolvePlatformModelId(provider, requested) {
  const meta = requested ? getModelMeta(provider, requested) : null;
  return meta && meta.platformFree ? meta.id : DEFAULT_MODELS[provider];
}

/** Thinking levels this model accepts (empty when it has no thinking control). */
export function getEffortLevels(provider, id) {
  return getModelMeta(provider, id)?.effort || [];
}

/** Effort to send upstream, or "" when it is "auto"/unsupported by the model. */
export function resolveEffort(provider, id, effort) {
  return getEffortLevels(provider, id).includes(effort) ? effort : "";
}
