// =============================================================================
// api/ai-agent/bot.js — WhatsApp Cloud API + Telegram bot webhook handler.
//
// Runs on Vercel Edge Runtime (does NOT count toward the 12 Node.js serverless
// function limit). Pure fetch + JSON — no Node.js built-ins required.
//
// Routes:
//   GET  /api/ai-agent/bot               — Meta webhook verification handshake
//   POST /api/ai-agent/bot               — Incoming WhatsApp messages
//   POST /api/ai-agent/bot?platform=telegram — Incoming Telegram updates
// =============================================================================

export const config = { runtime: "edge" };

// ── Constants ─────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `أنت مساعد ذكاء اصطناعي ودود لمنصة "بصمجي كويز" — منصة تعليمية مصرية متخصصة في الاختبارات وكويزات الكليات والمراجعات.
ساعد المستخدمين في أسئلتهم عن المنصة وشرح المفاهيم الدراسية باختصار ووضوح.
أجب دائماً بالعربية ما لم يكتب المستخدم بلغة أخرى.
كن مختصراً ومفيداً — رسائل واتساب يجب أن تكون قصيرة وسهلة القراءة.`;

const FALLBACK_MESSAGE =
  "عذراً، حدث خطأ مؤقت. يرجى المحاولة مرة أخرى بعد قليل. 🙏";

// ── Key pool (inline — edge modules share no state across requests) ──────────

/** Returns the next Google API key via time-sliced round-robin. */
function getGoogleKey() {
  const raw = process.env.AI_AGENT_GOOGLE_KEYS || "";
  const pool = raw.split(",").map((k) => k.trim()).filter(Boolean);
  if (!pool.length) return null;
  const idx = Math.floor(Date.now() / 3000) % pool.length;
  return pool[idx];
}

// ── Gemini ───────────────────────────────────────────────────────────────────

/**
 * Calls Google Gemini with round-robin key rotation.
 * Retries once on 429/quota errors before giving up.
 * @param {string} userText
 * @returns {Promise<string>} AI reply text
 */
async function generateGeminiReply(userText) {
  // Use current dynamic alias or active version
  const model = "gemini-flash-lite-latest";

  for (let attempt = 0; attempt < 2; attempt++) {
    const key = getGoogleKey();
    if (!key) throw new Error("No Google API keys configured");

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

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

// ── Edge handler (Web Request → Response) ────────────────────────────────────

export default async function handler(req, ctx) {
  const { method } = req;
  const url = new URL(req.url);

  // ── GET — Meta webhook verification ──────────────────────────────────────
  if (method === "GET") {
    const mode      = url.searchParams.get("hub.mode");
    const token     = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      console.log("[bot] WhatsApp webhook verified ✓");
      return new Response(challenge, { status: 200 });
    }

    console.warn("[bot] Webhook verify token mismatch");
    return new Response("Forbidden", { status: 403 });
  }

  if (method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const platform = url.searchParams.get("platform") || "whatsapp";

  // ── Telegram ──────────────────────────────────────────────────────────────
  if (platform === "telegram") {
    const update  = await req.json().catch(() => ({}));
    const message = update.message || update.edited_message;
    const chatId  = message?.chat?.id;
    const text    = message?.text;

    if (chatId && text) {
      const task = processTelegramMessage(chatId, text).catch((err) =>
        console.error("[bot] Telegram async error:", err)
      );
      if (ctx && typeof ctx.waitUntil === "function") {
        ctx.waitUntil(task);
      }
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // ── WhatsApp (default) ────────────────────────────────────────────────────
  const body = await req.json().catch(() => ({}));

  if (body?.object === "whatsapp_business_account" && Array.isArray(body?.entry)) {
    for (const entry of body.entry) {
      const changes = entry?.changes || [];
      for (const change of changes) {
        const val = change?.value;
        const messages = val?.messages || [];
        for (const msg of messages) {
          if (msg?.type === "text") {
            const from = msg.from;
            const text = msg.text?.body;
            if (from && text) {
              const task = processWhatsAppMessage(from, text).catch((err) =>
                console.error("[bot] WhatsApp async error:", err)
              );
              if (ctx && typeof ctx.waitUntil === "function") {
                ctx.waitUntil(task);
              }
            }
          }
        }
      }
    }
  }

  // Always ack Meta immediately
  return new Response("EVENT_RECEIVED", { status: 200 });
}
