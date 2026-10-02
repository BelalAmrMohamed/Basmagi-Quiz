// =============================================================================
// api/ai-agent/bot.js
// WhatsApp Cloud API + Telegram bot webhook handler.
//
// Routes:
//   GET  /api/ai-agent/bot  — Meta webhook verification handshake
//   POST /api/ai-agent/bot  — Incoming WhatsApp messages from Meta
//   POST /api/ai-agent/bot?platform=telegram — Incoming Telegram updates
//
// Design notes:
//   • The POST handler acknowledges Meta's webhook with 200 immediately, then
//     processes the AI reply asynchronously (fire-and-forget) so we never
//     time-out the webhook even on slow Gemini calls.
//   • Gemini keys are pulled from the existing round-robin pool in _keyPool.js.
//     If a key returns 429 / quota-exhausted we rotate to the next one and
//     retry once before falling back to an Arabic error message.
//   • No CORS or JWT needed — Meta/Telegram hit the endpoint directly.
// =============================================================================

import { getNextKey } from "./_keyPool.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `أنت مساعد ذكاء اصطناعي ودود لمنصة "بصمجي كويز" — منصة تعليمية مصرية متخصصة في الاختبارات وكويزات الكليات والمراجعات.
ساعد المستخدمين في أسئلتهم عن المنصة وشرح المفاهيم الدراسية باختصار ووضوح.
أجب دائماً بالعربية ما لم يكتب المستخدم بلغة أخرى.
كن مختصراً ومفيداً — رسائل واتساب يجب أن تكون قصيرة وسهلة القراءة.`;

const FALLBACK_MESSAGE =
  "عذراً، حدث خطأ مؤقت. يرجى المحاولة مرة أخرى بعد قليل. 🙏";

// ── Gemini ───────────────────────────────────────────────────────────────────

/**
 * Calls Google Gemini with round-robin key rotation.
 * Retries once on 429/quota errors before giving up.
 * @param {string} userText
 * @returns {Promise<string>} AI reply text
 */
async function generateGeminiReply(userText) {
  const model = "gemini-2.0-flash-lite"; // lightest/cheapest model for chat

  for (let attempt = 0; attempt < 2; attempt++) {
    const keyInfo = getNextKey("google");
    if (!keyInfo) throw new Error("No Google API keys configured");

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${keyInfo.key}`;

    const body = {
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: "user", parts: [{ text: userText }] }],
      generationConfig: { maxOutputTokens: 800, temperature: 0.7 },
    };

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    // 429 = quota exhausted on this key — wait briefly and retry with next slot
    if (res.status === 429 && attempt === 0) {
      await new Promise((r) => setTimeout(r, 300));
      continue;
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Gemini error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    const text = (data?.candidates?.[0]?.content?.parts || [])
      .filter((p) => p.text)
      .map((p) => p.text)
      .join("")
      .trim();

    return text || FALLBACK_MESSAGE;
  }

  throw new Error("All Gemini key attempts exhausted");
}

// ── WhatsApp Cloud API ────────────────────────────────────────────────────────

/**
 * Sends a text message back to the user via WhatsApp Cloud API.
 * @param {string} to   Sender phone number (E.164, e.g. "201556882189")
 * @param {string} text Message body
 */
async function sendWhatsAppMessage(to, text) {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

  if (!phoneNumberId || !accessToken) {
    console.error("[bot] WhatsApp credentials not configured");
    return;
  }

  const url = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;
  const body = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: { body: text },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.error(`[bot] WhatsApp send failed (${res.status}): ${errText}`);
  }
}

/**
 * Fire-and-forget: generate AI reply and send it back via WhatsApp.
 * @param {string} from    Sender phone number
 * @param {string} msgText User message
 */
async function processWhatsAppMessage(from, msgText) {
  try {
    const reply = await generateGeminiReply(msgText);
    await sendWhatsAppMessage(from, reply);
  } catch (err) {
    console.error("[bot] processWhatsAppMessage error:", err);
    // Best-effort fallback — ignore if this also fails
    await sendWhatsAppMessage(from, FALLBACK_MESSAGE).catch(() => {});
  }
}

// ── Telegram Bot API ──────────────────────────────────────────────────────────

/**
 * Sends a text message back to the user via Telegram Bot API.
 * @param {number|string} chatId Telegram chat ID
 * @param {string}        text   Message body
 */
async function sendTelegramMessage(chatId, text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error("[bot] TELEGRAM_BOT_TOKEN not configured");
    return;
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.error(`[bot] Telegram send failed (${res.status}): ${errText}`);
  }
}

/**
 * Fire-and-forget: generate AI reply and send it back via Telegram.
 * @param {number|string} chatId
 * @param {string}        msgText
 */
async function processTelegramMessage(chatId, msgText) {
  try {
    const reply = await generateGeminiReply(msgText);
    await sendTelegramMessage(chatId, reply);
  } catch (err) {
    console.error("[bot] processTelegramMessage error:", err);
    await sendTelegramMessage(chatId, FALLBACK_MESSAGE).catch(() => {});
  }
}

// ── Vercel handler ────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  // ── GET — Meta webhook verification ──────────────────────────────────────
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      console.log("[bot] WhatsApp webhook verified ✓");
      res.status(200).send(challenge);
      return;
    }

    console.warn("[bot] Webhook verify token mismatch or wrong mode");
    res.status(403).send("Forbidden");
    return;
  }

  // ── POST — Incoming message ───────────────────────────────────────────────
  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  const platform = req.query["platform"] || "whatsapp";

  // ── Telegram ────────────────────────────────────────────────────────────
  if (platform === "telegram") {
    // Telegram expects 200 within 60 s — send it immediately
    res.status(200).json({ ok: true });

    const update = req.body || {};
    const message = update.message || update.edited_message;
    if (!message) return;

    const chatId = message?.chat?.id;
    const text = message?.text;
    if (!chatId || !text) return;

    processTelegramMessage(chatId, text).catch((err) =>
      console.error("[bot] Telegram async error:", err)
    );
    return;
  }

  // ── WhatsApp (default) ───────────────────────────────────────────────────

  // Meta retries aggressively if we don't ack with 200 fast
  res.status(200).send("EVENT_RECEIVED");

  const body = req.body || {};

  // Only handle whatsapp_business_account events
  if (body.object !== "whatsapp_business_account") return;

  const entry = body.entry?.[0];
  const changes = entry?.changes?.[0];
  const value = changes?.value;
  const messages = value?.messages;

  if (!Array.isArray(messages) || messages.length === 0) return;

  const msg = messages[0];

  // Only handle incoming text messages — ignore status receipts, images, etc.
  if (msg.type !== "text") return;

  const from = msg.from; // E.164 phone number string
  const text = msg.text?.body;
  if (!from || !text) return;

  // Process asynchronously — 200 already sent
  processWhatsAppMessage(from, text).catch((err) =>
    console.error("[bot] WhatsApp async error:", err)
  );
}
