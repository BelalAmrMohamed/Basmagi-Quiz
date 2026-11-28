// Turns raw provider failures (long, English, JSON-heavy) into short Arabic
// messages a normal user can act on, while keeping the full raw error as a
// copyable `debug` string for developers. Returns null when the error is not
// recognised, so callers keep their existing behaviour for unknown errors.
import { getModelMeta, AI_MODELS } from "../../public/src/shared/ai-models.js";

const PROVIDER_NAMES = { google: "Google Gemini", deepseek: "DeepSeek", claude: "Claude (Anthropic)" };

function redact(text) {
  return String(text || "")
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, "AIza***")
    .replace(/sk-ant-[0-9A-Za-z_-]{10,}/g, "sk-ant-***")
    .replace(/\bsk-[0-9A-Za-z_-]{16,}/g, "sk-***");
}

function parseBody(raw) {
  const start = raw.indexOf("{");
  if (start === -1) return null;
  try { return JSON.parse(raw.slice(start)); } catch { return null; }
}

function retrySeconds(body, raw) {
  const info = (body?.error?.details || []).find((d) => /RetryInfo/.test(d?.["@type"] || ""));
  const fromInfo = parseFloat(info?.retryDelay);
  if (Number.isFinite(fromInfo)) return fromInfo;
  const m = /retry in\s+(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?/i.exec(raw);
  if (m && (m[1] || m[2] || m[3])) return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0);
  return null;
}

function waitText(sec) {
  if (!sec) return "";
  if (sec < 90) return " حاول بعد لحظات.";
  if (sec < 3600) return ` حاول بعد حوالي ${Math.ceil(sec / 60)} دقيقة.`;
  const h = Math.round(sec / 3600);
  return h <= 1 ? " حاول بعد حوالي ساعة." : h === 2 ? " حاول بعد حوالي ساعتين." : ` حاول بعد حوالي ${h} ساعات.`;
}

function freeModelNames() {
  return AI_MODELS.google.filter((m) => m.platformFree).map((m) => m.label).join(" أو ");
}

/** Full technical text for the "copy debug info" button (secrets redacted). */
export function buildDebugInfo(err, { provider, model } = {}) {
  const raw = redact(err?.message || String(err || ""));
  const body = parseBody(raw);
  const pretty = body ? JSON.stringify(body, null, 2) : raw;
  return [
    `provider: ${provider || "?"}`,
    `model: ${model || "?"}`,
    `http_status: ${err?.upstreamStatus ?? "none"}`,
    err?.cause?.code ? `network_cause: ${err.cause.code}` : null,
    `time: ${new Date().toISOString()}`,
    "",
    pretty,
  ].filter((l) => l !== null).join("\n");
}

/**
 * @returns {{ message: string, code: string, status: number, debug: string } | null}
 */
export function describeProviderError(err, { provider, model, ownKey = false } = {}) {
  const status = err?.upstreamStatus;
  if (!status) return null;
  const raw = String(err?.message || "");
  const body = parseBody(raw);
  const apiMsg = String(body?.error?.message || body?.error || body?.message || "");
  const text = `${apiMsg} ${raw}`;
  const label = getModelMeta(provider, model)?.label || model || "هذا النموذج";
  const who = PROVIDER_NAMES[provider] || "مزوّد الذكاء الاصطناعي";
  const wait = waitText(retrySeconds(body, raw));
  const done = (code, message) => ({ code, message, status, debug: buildDebugInfo(err, { provider, model }) });

  // Invalid / missing credentials (all providers).
  if (status === 401 || (status === 400 && /API key not valid|API_KEY_INVALID|API key expired/i.test(text))) {
    return ownKey
      ? done("invalid_key", `مفتاح API الخاص بك غير صالح أو منتهي. تأكد من نسخه كاملًا من ${who} ثم حدّثه من الإعدادات.`)
      : done("platform_key_invalid", "حدثت مشكلة في إعدادات الخدمة المجانية. حاول لاحقًا أو استخدم مفتاحك الخاص.");
  }
  if (status === 402 || /credit balance is too low|insufficient balance/i.test(text)) {
    return done("no_credit", ownKey
      ? `رصيد حسابك في ${who} غير كافٍ. اشحن الرصيد أو فعّل الفوترة ثم حاول مرة أخرى.`
      : "الخدمة المجانية غير متاحة مؤقتًا. حاول لاحقًا أو استخدم مفتاحك الخاص.");
  }
  if (status === 403) {
    return done("permission_denied", `مفتاحك لا يملك صلاحية استخدام "${label}"، أو الخدمة غير متاحة في بلدك. جرّب نموذجًا آخر أو راجع إعدادات المفتاح في ${who}.`);
  }
  if (status === 404) {
    return done("model_unavailable", `النموذج "${label}" غير متاح حاليًا لهذا المفتاح. اختر نموذجًا آخر من القائمة.`);
  }
  if (status === 429) {
    // Google answers a paid-only model on a free key with quota "limit: 0".
    if (provider === "google" && ownKey && /limit:\s*0\b/.test(text)) {
      return done("model_needs_paid_plan", `النموذج "${label}" غير متاح في الخطة المجانية لمفتاحك. فعّل الفوترة في Google AI Studio لاستخدامه، أو اختر ${freeModelNames()} فهي تعمل مجانًا.`);
    }
    if (!ownKey) {
      return done("platform_busy", "الخدمة المجانية المشتركة وصلت للحد المسموح مؤقتًا بسبب كثرة الاستخدام. حاول بعد قليل، أو أضف مفتاح API الخاص بك من الإعدادات للاستخدام دون انتظار.");
    }
    const daily = /per day|daily|PerDay/i.test(text);
    return done("rate_limited", `${daily ? "وصل مفتاحك إلى حدّه اليومي" : "أرسلت طلبات كثيرة بسرعة على مفتاحك"} (${who}).${wait || " انتظر قليلًا ثم حاول مرة أخرى."} يمكنك أيضًا تجربة نموذج آخر.`);
  }
  if (status === 503 || status === 529 || status === 500) {
    return done("provider_overloaded", `خوادم ${who} مشغولة حاليًا. حاول مرة أخرى بعد لحظات أو جرّب نموذجًا آخر.`);
  }
  return null; // unknown: caller keeps the original message
}
