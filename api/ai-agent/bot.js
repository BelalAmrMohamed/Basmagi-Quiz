// =============================================================================
// api/ai-agent/bot.js — WhatsApp Cloud API + Telegram bot webhook handler.
//
// Runs on standard Node.js Serverless runtime (NOT Edge). This unlocks:
//   - @supabase/supabase-js for conversation history & platform DB search
//   - mammoth for extracting text from user-uploaded .docx files
//   - pdfkit for generating quiz PDF exports
//   - Native Buffer, FormData, and stream handling
//
// Routes:
//   GET  /api/ai-agent/bot               — Meta webhook verification handshake
//   POST /api/ai-agent/bot               — Incoming WhatsApp messages
//   POST /api/ai-agent/bot?platform=telegram — Incoming Telegram updates
//
// Telegram capabilities (this file's main focus):
//   1. Multi-turn conversation memory backed by Supabase (last 12 messages)
//   2. File attachments: images (vision), PDFs, Word .docx, plain text
//   3. Read-only platform DB search (courses, folders, quizzes, lessons)
//   4. Quiz/Lesson file generation (HTML, PDF, Markdown, JSON)
//   5. Gemini function-calling loop with automatic tool dispatch
// =============================================================================

import { createClient } from "@supabase/supabase-js";
import { getNextKey } from "./_keyPool.js";
import { processTelegramInbound } from "./_telegramFiles.js";
import { BOT_TOOLS, executeBotTool } from "./_botTools.js";
import { sendTelegramChatAction } from "./_telegramFiles.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are El-Bashmebasamag (الباشــمبصمج), the smart studying assistant for **منصة امتحانات بصمجي** (Basamgi Exams Platform) — an educational platform that lets users create, share, and manage their own exams and study materials.

Your job:
- Explain any academic topic or question the user asks about, clearly and accurately.
- Help users understand exams, study materials, questions, and college concepts.
- Provide study tips, explanations for tricky questions, and clear step-by-step guidance.
- Always reply in the same language the user writes their message in — if they write in English, reply in English; if they write in Arabic, reply in Arabic; and so on for any other language.
- Format responses cleanly with readable spacing suitable for messaging apps. Use bold text, bullet points, and numbered lists when helpful.
- Be concise, friendly, encouraging, and helpful.

Platform search workflow:
- When the user asks about available courses, subjects, or content, use the search_courses tool to find them.
- Provide direct web links: https://basmagi-quiz.vercel.app/q/{quiz_id} for quizzes, /lesson/{lesson_id} for lessons, /course/{path} for courses.
- Offer to send a standalone interactive .html quiz file for offline studying.
- For Word (.docx) or PowerPoint (.pptx) exports, provide instructions and direct links to the website's export modal.

Quiz creation workflow:
1. When the user asks you to create/generate a quiz, first create the questions and show them a clear preview in chat.
2. Ask the user to confirm (e.g. "تمام", "أنشئ", "yes") and choose the desired format: HTML (for interactive offline use), PDF, Markdown, or JSON (for importing into the platform).
3. Upon confirmation, use the generate_quiz_file tool to create and send the document immediately.

Lesson creation workflow:
1. When asked to create lesson notes/summaries, organize into clear sections.
2. Show a preview and ask for confirmation and format choice (Markdown or JSON).
3. Upon confirmation, use generate_lesson_file to send the document.

File handling:
- When a user sends an image, analyze it with your vision capabilities and help with whatever they ask.
- When a user sends a PDF, read and analyze its contents.
- When a user sends a Word document (.docx), the text is automatically extracted — help with the content.
- When a user sends a text/markdown/json file, its content is included in the message.

Important behavioral rules:
- NEVER generate a file without first showing the user a preview and getting their explicit confirmation.
- Keep responses mobile-friendly — short paragraphs, clear formatting.
- If the user sends something you can't process, politely explain what file types you support.`;

const FALLBACK_MESSAGE =
  "عذراً، حدث خطأ مؤقت. يرجى المحاولة مرة أخرى بعد قليل. 🙏";

const HISTORY_FETCH_LIMIT = 12; // last N messages for context window
const HISTORY_PRUNE_LIMIT = 30; // max messages to keep per chat
const MAX_TOOL_LOOPS = 5; // max function-calling round-trips per request
const GEMINI_MODEL = "gemini-2.5-flash"; // or "gemini-flash-lite-latest"

// ── Supabase client (service_role — server-side only) ────────────────────────

let _supabase = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );
  }
  return _supabase;
}

// ── Key pool ─────────────────────────────────────────────────────────────────

function getGoogleKey() {
  const result = getNextKey("google");
  return result?.key || null;
}

// ── Conversation history (Supabase) ──────────────────────────────────────────

async function fetchChatHistory(chatId) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("telegram_chat_history")
    .select("role, content")
    .eq("chat_id", String(chatId))
    .order("created_at", { ascending: true })
    .limit(HISTORY_FETCH_LIMIT);

  if (error) {
    console.error("[bot] fetchChatHistory error:", error.message);
    return [];
  }
  return data || [];
}

async function saveChatMessage(chatId, role, content) {
  const supabase = getSupabase();
  const { error } = await supabase.from("telegram_chat_history").insert({
    chat_id: String(chatId),
    role,
    content: content.slice(0, 8000), // cap storage per message
  });
  if (error) {
    console.error("[bot] saveChatMessage error:", error.message);
  }
}

async function pruneOldHistory(chatId) {
  const supabase = getSupabase();

  // Count total messages for this chat
  const { count, error: countErr } = await supabase
    .from("telegram_chat_history")
    .select("id", { count: "exact", head: true })
    .eq("chat_id", String(chatId));

  if (countErr || !count || count <= HISTORY_PRUNE_LIMIT) return;

  // Delete oldest messages beyond the limit
  const excessCount = count - HISTORY_PRUNE_LIMIT;
  const { data: oldRows } = await supabase
    .from("telegram_chat_history")
    .select("id")
    .eq("chat_id", String(chatId))
    .order("created_at", { ascending: true })
    .limit(excessCount);

  if (oldRows && oldRows.length) {
    const idsToDelete = oldRows.map((r) => r.id);
    await supabase
      .from("telegram_chat_history")
      .delete()
      .in("id", idsToDelete);
  }
}

// ── Gemini with function calling ─────────────────────────────────────────────

/**
 * Calls Gemini with multi-turn history and optional tool calling.
 * Implements the tool-calling loop: if Gemini returns functionCalls, execute
 * them via _botTools.js, append results, and call Gemini again until a final
 * text response is produced.
 *
 * @param {Array} contents - Gemini-format contents array
 * @param {number|string} chatId - for tool execution (sending files)
 * @returns {Promise<string>} final text reply
 */
async function generateGeminiReplyWithTools(contents, chatId) {
  const supabase = getSupabase();

  // Build tool declarations for Gemini
  const toolDeclarations = BOT_TOOLS.map((t) => {
    const decl = { name: t.name, description: t.description };
    if (t.parameters?.properties && Object.keys(t.parameters.properties).length) {
      decl.parameters = t.parameters;
    }
    return decl;
  });

  for (let loop = 0; loop < MAX_TOOL_LOOPS; loop++) {
    const key = getGoogleKey();
    if (!key) throw new Error("No Google API keys configured");

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`;

    const body = {
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents,
      tools: [{ functionDeclarations: toolDeclarations }],
      generationConfig: { maxOutputTokens: 2048, temperature: 0.7 },
    };

    let res;
    for (let attempt = 0; attempt < 2; attempt++) {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.status === 429 && attempt === 0) {
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }
      break;
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Gemini error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    const parts = data?.candidates?.[0]?.content?.parts || [];

    // Check for function calls
    const funcCalls = parts.filter((p) => p.functionCall);
    const textParts = parts.filter((p) => p.text);

    if (funcCalls.length > 0) {
      // Append the model's response (with functionCalls) to contents
      contents.push({
        role: "model",
        parts: parts,
      });

      // Execute each function call and append results
      for (const part of funcCalls) {
        const { name, args } = part.functionCall;
        console.log(`[bot] Tool call: ${name}`, JSON.stringify(args).slice(0, 200));

        let result;
        try {
          // Send typing indicator while processing tools
          await sendTelegramChatAction(chatId, "typing");
          result = await executeBotTool(name, args || {}, chatId, supabase);
        } catch (err) {
          console.error(`[bot] Tool ${name} error:`, err.message);
          result = { error: err.message };
        }

        // Append the function response
        contents.push({
          role: "user",
          parts: [
            {
              functionResponse: {
                name,
                response: result,
              },
            },
          ],
        });
      }

      // Loop back to let Gemini process the tool results
      continue;
    }

    // No function calls — extract final text
    const text = textParts
      .map((p) => p.text)
      .join("")
      .trim();

    return text || FALLBACK_MESSAGE;
  }

  throw new Error("Max tool-calling loops exceeded");
}

// ── WhatsApp Cloud API ────────────────────────────────────────────────────────

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

async function processWhatsAppMessage(from, msgText) {
  try {
    // WhatsApp: no multi-turn memory or tools (stateless, simple replies)
    const key = getGoogleKey();
    if (!key) throw new Error("No Google API keys configured");

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent?key=${key}`;
    const body = {
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: "user", parts: [{ text: msgText }] }],
      generationConfig: { maxOutputTokens: 800, temperature: 0.7 },
    };

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) throw new Error(`Gemini error (${res.status})`);

    const data = await res.json();
    const text = (data?.candidates?.[0]?.content?.parts || [])
      .filter((p) => p.text)
      .map((p) => p.text)
      .join("")
      .trim();

    await sendWhatsAppMessage(from, text || FALLBACK_MESSAGE);
  } catch (err) {
    console.error("[bot] processWhatsAppMessage error:", err);
    await sendWhatsAppMessage(from, FALLBACK_MESSAGE).catch(() => {});
  }
}

// ── Telegram Bot API ──────────────────────────────────────────────────────────

async function sendTelegramMessage(chatId, text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error("[bot] TELEGRAM_BOT_TOKEN not configured");
    return;
  }

  // Telegram has a 4096 character limit per message; split if needed
  const chunks = splitText(text, 4000);

  for (const chunk of chunks) {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: chunk, parse_mode: "Markdown" }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      // If Markdown parsing fails, retry without parse_mode
      if (res.status === 400 && errText.includes("parse")) {
        await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text: chunk }),
        }).catch(() => {});
      } else {
        console.error(`[bot] Telegram send failed (${res.status}): ${errText}`);
      }
    }
  }
}

/**
 * Full Telegram message processing pipeline:
 * 1. Send typing indicator
 * 2. Extract text + attachments from the message
 * 3. Fetch conversation history from Supabase
 * 4. Assemble Gemini contents array with history + current message
 * 5. Run Gemini with tool-calling loop
 * 6. Send reply + persist to history
 * 7. Prune old messages
 */
async function processTelegramMessage(chatId, message) {
  try {
    // 1. Typing indicator
    await sendTelegramChatAction(chatId, "typing");

    // 2. Extract text + file parts from the Telegram message
    let userText = "";
    let inlineParts = [];

    try {
      const inbound = await processTelegramInbound(message);
      userText = inbound.text;
      inlineParts = inbound.parts;
    } catch (extractErr) {
      console.error("[bot] File extraction error:", extractErr.message);
      userText = message.text || message.caption || "";
      // If extraction failed but there's no text either, inform user
      if (!userText) {
        await sendTelegramMessage(chatId, "عذراً، لم أستطع معالجة هذا الملف. الأنواع المدعومة: صور، PDF، Word (.docx)، نصوص. 📎");
        return;
      }
    }

    if (!userText && inlineParts.length === 0) {
      return; // Nothing to process
    }

    // 3. Fetch conversation history
    const history = await fetchChatHistory(chatId);

    // 4. Assemble contents array
    const contents = [];

    // Add history (text-only, no inline parts for old messages)
    for (const msg of history) {
      contents.push({
        role: msg.role === "model" ? "model" : "user",
        parts: [{ text: msg.content }],
      });
    }

    // Add current user message (text + inline file parts)
    const currentParts = [];
    if (userText) {
      currentParts.push({ text: userText });
    }
    currentParts.push(...inlineParts);
    contents.push({ role: "user", parts: currentParts });

    // 5. Generate reply with tool-calling loop
    const reply = await generateGeminiReplyWithTools(contents, chatId);

    // 6. Send reply
    await sendTelegramMessage(chatId, reply);

    // 7. Persist to history (fire-and-forget)
    await saveChatMessage(chatId, "user", userText || "[file attachment]");
    await saveChatMessage(chatId, "model", reply);

    // 8. Prune old history (fire-and-forget)
    pruneOldHistory(chatId).catch((e) =>
      console.error("[bot] prune error:", e.message)
    );
  } catch (err) {
    console.error("[bot] processTelegramMessage error:", err);
    await sendTelegramMessage(chatId, FALLBACK_MESSAGE).catch(() => {});
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Split text into chunks of maxLen, preferring to break at newlines. */
function splitText(text, maxLen) {
  if (!text || text.length <= maxLen) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > maxLen) {
    let breakAt = remaining.lastIndexOf("\n", maxLen);
    if (breakAt < maxLen * 0.5) breakAt = maxLen; // no good newline found
    chunks.push(remaining.slice(0, breakAt));
    remaining = remaining.slice(breakAt).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

// ── Node.js Serverless handler ───────────────────────────────────────────────

export default async function handler(req, res) {
  const { method } = req;
  const url = new URL(req.url, `https://${req.headers.host || "localhost"}`);

  // ── GET — Meta webhook verification ──────────────────────────────────────
  if (method === "GET") {
    const mode      = url.searchParams.get("hub.mode");
    const token     = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      console.log("[bot] WhatsApp webhook verified ✓");
      return res.status(200).send(challenge);
    }

    console.warn("[bot] Webhook verify token mismatch");
    return res.status(403).send("Forbidden");
  }

  if (method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  const platform = url.searchParams.get("platform") || "whatsapp";

  // ── Telegram ──────────────────────────────────────────────────────────────
  if (platform === "telegram") {
    // Acknowledge immediately — processing happens after the response
    res.status(200).json({ ok: true });

    const update = req.body || {};
    const message = update.message || update.edited_message;
    const chatId = message?.chat?.id;

    // Accept text messages, photos, and documents
    const hasContent =
      message?.text ||
      message?.caption ||
      message?.photo ||
      message?.document;

    if (chatId && hasContent) {
      processTelegramMessage(chatId, message).catch((err) =>
        console.error("[bot] Telegram async error:", err)
      );
    }

    return;
  }

  // ── WhatsApp (default) ────────────────────────────────────────────────────
  const body = req.body || {};

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
              processWhatsAppMessage(from, text).catch((err) =>
                console.error("[bot] WhatsApp async error:", err)
              );
            }
          }
        }
      }
    }
  }

  // Always ack Meta immediately
  return res.status(200).send("EVENT_RECEIVED");
}
