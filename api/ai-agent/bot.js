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
// Telegram capabilities:
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

// Vercel serverless function max duration (up to 60s for tool loops & file generation)
export const maxDuration = 60;

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
const PRIMARY_GEMINI_MODEL = "gemini-3.8-flash";
const FALLBACK_GEMINI_MODELS = ["gemini-flash-latest", "gemini-flash-lite-latest"];

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
  // Fetch most recent messages descending, then reverse for chronological order
  const { data, error } = await supabase
    .from("telegram_chat_history")
    .select("role, content")
    .eq("chat_id", String(chatId))
    .order("created_at", { ascending: false })
    .limit(HISTORY_FETCH_LIMIT);

  if (error) {
    console.error("[bot] fetchChatHistory error:", error.message);
    return [];
  }
  return (data || []).reverse();
}

async function saveChatMessage(chatId, role, content) {
  const supabase = getSupabase();
  const { error } = await supabase.from("telegram_chat_history").insert({
    chat_id: String(chatId),
    role,
    content: (content || "").slice(0, 8000), // cap storage per message
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

// ── Normalization: Strict Alternating Gemini Turns ───────────────────────────

/**
 * Builds a strictly alternating contents array for Gemini:
 * - Drops any leading model messages (Gemini requires first turn to be 'user')
 * - Merges consecutive turns of the same role
 * - Appends currentParts to the final user turn
 */
function buildAlternatingContents(history, currentParts) {
  const turns = [];

  for (const msg of history) {
    if (!msg.content?.trim()) continue;
    const role = msg.role === "model" ? "model" : "user";
    const lastTurn = turns[turns.length - 1];

    if (lastTurn && lastTurn.role === role) {
      lastTurn.parts.push({ text: msg.content });
    } else {
      turns.push({
        role,
        parts: [{ text: msg.content }],
      });
    }
  }

  // Ensure first turn is from "user"
  while (turns.length > 0 && turns[0].role !== "user") {
    turns.shift();
  }

  // Append current turn (always "user")
  const lastTurn = turns[turns.length - 1];
  if (lastTurn && lastTurn.role === "user") {
    lastTurn.parts.push(...currentParts);
  } else {
    turns.push({
      role: "user",
      parts: currentParts,
    });
  }

  return turns;
}

// ── Gemini with function calling ─────────────────────────────────────────────

/**
 * Calls Gemini with multi-turn history and optional tool calling.
 * Implements the tool-calling loop: if Gemini returns functionCalls, execute
 * them via _botTools.js, append results as a single user turn, and call Gemini
 * again until a final text response is produced.
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

  const modelsToTry = [PRIMARY_GEMINI_MODEL, ...FALLBACK_GEMINI_MODELS];

  for (let loop = 0; loop < MAX_TOOL_LOOPS; loop++) {
    let res = null;
    let data = null;
    let lastError = null;

    for (const model of modelsToTry) {
      const key = getGoogleKey();
      if (!key) throw new Error("No Google API keys configured");

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
      const body = {
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents,
        tools: [{ functionDeclarations: toolDeclarations }],
        generationConfig: { maxOutputTokens: 4096, temperature: 0.7 },
      };

      try {
        res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        if (res.status === 429) {
          // Rate limited on this key, rotate key and retry once
          const retryKey = getGoogleKey();
          const retryUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${retryKey}`;
          res = await fetch(retryUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
        }

        if (res.ok) {
          data = await res.json();
          break; // successfully got response from this model
        } else {
          const errText = await res.text().catch(() => "");
          lastError = new Error(`Gemini ${model} error (${res.status}): ${errText}`);
          console.warn(`[bot] Model ${model} failed (${res.status}), trying fallback...`);
        }
      } catch (networkErr) {
        lastError = networkErr;
        console.warn(`[bot] Network error on ${model}:`, networkErr.message);
      }
    }

    if (!data) {
      throw lastError || new Error("All Gemini models failed");
    }

    const parts = data?.candidates?.[0]?.content?.parts || [];
    const funcCalls = parts.filter((p) => p.functionCall);
    const textParts = parts.filter((p) => p.text);

    if (funcCalls.length > 0) {
      // Append the model's response (with functionCalls) to contents
      contents.push({
        role: "model",
        parts: parts,
      });

      // Execute all function calls and collect results
      const responseParts = [];
      for (const part of funcCalls) {
        const { name, args } = part.functionCall;
        console.log(`[bot] Tool call: ${name}`, JSON.stringify(args).slice(0, 200));

        let result;
        try {
          await sendTelegramChatAction(chatId, "typing");
          result = await executeBotTool(name, args || {}, chatId, supabase);
        } catch (err) {
          console.error(`[bot] Tool ${name} error:`, err.message);
          result = { error: err.message };
        }

        responseParts.push({
          functionResponse: {
            name,
            response: result,
          },
        });
      }

      // Append ALL tool results in a SINGLE user turn to preserve alternation
      contents.push({
        role: "user",
        parts: responseParts,
      });

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

  // Telegram has a 4096 character limit per message; split safely
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
      if (
        res.status === 400 &&
        (errText.toLowerCase().includes("parse") || errText.includes("entities"))
      ) {
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
 * 4. Assemble strict alternating Gemini contents array with history + current message
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
      if (!userText) {
        await sendTelegramMessage(
          chatId,
          "عذراً، لم أستطع معالجة هذا الملف. الأنواع المدعومة: صور، PDF، Word (.docx)، نصوص. 📎"
        );
        return;
      }
    }

    if (!userText && inlineParts.length === 0) {
      return; // Nothing to process
    }

    // 3. Fetch conversation history
    const history = await fetchChatHistory(chatId);

    // 4. Assemble current parts
    const currentParts = [];
    if (userText) {
      currentParts.push({ text: userText });
    }
    currentParts.push(...inlineParts);

    // Build strict alternating contents for Gemini
    const contents = buildAlternatingContents(history, currentParts);

    // 5. Generate reply with tool-calling loop
    const reply = await generateGeminiReplyWithTools(contents, chatId);

    // 6. Send reply
    await sendTelegramMessage(chatId, reply);

    // 7. Persist to history
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
    if (breakAt < maxLen * 0.5) breakAt = maxLen;
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
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
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

  // Safe body parsing
  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }
  body = body || {};

  // ── Telegram ──────────────────────────────────────────────────────────────
  if (platform === "telegram") {
    const update = body;
    const message = update.message || update.edited_message;
    const chatId = message?.chat?.id;

    const hasContent =
      message?.text ||
      message?.caption ||
      message?.photo ||
      message?.document;

    if (chatId && hasContent) {
      try {
        // Await execution so Vercel Serverless environment does NOT freeze prematurely!
        await processTelegramMessage(chatId, message);
      } catch (err) {
        console.error("[bot] Telegram handler error:", err);
      }
    }

    return res.status(200).json({ ok: true });
  }

  // ── WhatsApp (default) ────────────────────────────────────────────────────
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
              try {
                await processWhatsAppMessage(from, text);
              } catch (err) {
                console.error("[bot] WhatsApp async error:", err);
              }
            }
          }
        }
      }
    }
  }

  // Always ack Meta immediately
  return res.status(200).send("EVENT_RECEIVED");
}
