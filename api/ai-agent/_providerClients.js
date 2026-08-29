// =============================================================================
// api/ai-agent/_providerClients.js
// Thin adapters that normalize { provider, apiKey, messages } into each
// LLM provider's own request shape, and normalize their responses back to
// a single { text, toolCall? } shape for the frontend to render.
// =============================================================================

/**
 * messages: [{ role: "user"|"assistant", content: string, attachments?: [{mimeType, base64, name}] }, ...]
 *
 * `attachments` is only ever meaningful on user-role messages (a file the
 * user just uploaded). Each provider adapter below either forwards it
 * natively (Google, Claude) or ignores it (DeepSeek — see chat.js's
 * extractAttachmentText, which folds a text-extracted version of the file
 * into `content` itself before DeepSeek ever sees the message, so DeepSeek
 * always just sees plain text and never needs to look at `attachments`).
 */

async function callGoogleAIStudio(apiKey, messages, systemPrompt, tools) {
  // We Must use the lightest available model
  const model = "gemini-3.5-flash-lite";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const contents = messages.map((m) => {
    const parts = [{ text: m.content }];
    if (Array.isArray(m.attachments)) {
      m.attachments.forEach((att) => {
        if (att?.base64 && att?.mimeType) {
          parts.push({ inlineData: { mimeType: att.mimeType, data: att.base64 } });
        }
      });
    }
    return { role: m.role === "assistant" ? "model" : "user", parts };
  });

  const body = { contents };

  if (systemPrompt) {
    body.systemInstruction = { parts: [{ text: systemPrompt }] };
  }

  if (Array.isArray(tools) && tools.length) {
    body.tools = [
      {
        functionDeclarations: tools.map((t) => {
          const decl = { name: t.name, description: t.description };
          // Only attach `parameters` when there's at least one declared
          // property. Gemini's proto-based schema is known to be picky
          // about JSON-Schema shapes it doesn't expect (see the union-type
          // note on CREATE_QUIZ_TOOL's `correct` field in _tools.js) —
          // rather than assume an empty `{type:"object", properties:{}}`
          // round-trips cleanly through every SDK version, just omit
          // `parameters` altogether for schemas with nothing to declare
          // (e.g. RESET_QUIZ_PAGE_TOOL). A function with no parameters is
          // valid without a `parameters` field at all.
          if (t.input_schema?.properties && Object.keys(t.input_schema.properties).length) {
            decl.parameters = t.input_schema;
          }
          return decl;
        }),
      },
    ];
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    const err = new Error(`Google AI Studio error (${res.status}): ${errBody}`);
    err.upstreamStatus = res.status;
    throw err;
  }

  const data = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const text = parts
    .filter((p) => p.text)
    .map((p) => p.text)
    .join("");
  const funcCall = parts.find((p) => p.functionCall)?.functionCall;
  const result = { text };
  if (funcCall) {
    result.toolCall = { name: funcCall.name, input: funcCall.args || {} };
  }
  return result;
}

async function callDeepSeek(apiKey, messages, systemPrompt, tools) {
  const chatMessages = messages.map((m) => ({ role: m.role, content: m.content }));
  if (systemPrompt) {
    chatMessages.unshift({ role: "system", content: systemPrompt });
  }

  const body = {
    model: "deepseek-chat",
    messages: chatMessages,
  };

  // DeepSeek uses an OpenAI-compatible tools/tool_choice shape.
  if (Array.isArray(tools) && tools.length) {
    body.tools = tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }));
  }

  const res = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    const err = new Error(`DeepSeek error (${res.status}): ${errBody}`);
    err.upstreamStatus = res.status;
    throw err;
  }

  const data = await res.json();
  const message = data?.choices?.[0]?.message;
  const text = message?.content || "";
  const result = { text };
  const toolCall = message?.tool_calls?.[0];
  if (toolCall?.function) {
    let input = {};
    try {
      input = JSON.parse(toolCall.function.arguments || "{}");
    } catch {
      input = {};
    }
    result.toolCall = { name: toolCall.function.name, input };
  }
  return result;
}

// Claude's /v1/messages content blocks: "image" wants source.media_type in
// {jpeg,png,gif,webp}; anything else (PDFs, mainly — the only other file
// type Claude accepts natively) goes through the "document" block instead.
const CLAUDE_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

async function callClaude(apiKey, messages, systemPrompt, tools) {
  const body = {
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    messages: messages.map((m) => {
      if (!Array.isArray(m.attachments) || !m.attachments.length) {
        return { role: m.role, content: m.content };
      }
      const blocks = [{ type: "text", text: m.content }];
      m.attachments.forEach((att) => {
        if (!att?.base64 || !att?.mimeType) return;
        if (CLAUDE_IMAGE_MIME_TYPES.has(att.mimeType)) {
          blocks.push({
            type: "image",
            source: { type: "base64", media_type: att.mimeType, data: att.base64 },
          });
        } else if (att.mimeType === "application/pdf") {
          blocks.push({
            type: "document",
            source: { type: "base64", media_type: att.mimeType, data: att.base64 },
          });
        }
        // Other mime types (docx/pptx) are handled upstream in chat.js via
        // extractAttachmentText, which turns them into plain text folded
        // into `content` before this function is ever called — nothing
        // left to attach here for those.
      });
      return { role: m.role, content: blocks };
    }),
  };

  if (systemPrompt) {
    body.system = systemPrompt;
  }

  if (Array.isArray(tools) && tools.length) {
    body.tools = tools;
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    const err = new Error(`Claude error (${res.status}): ${errBody}`);
    err.upstreamStatus = res.status;
    throw err;
  }

  const data = await res.json();
  const blocks = data?.content || [];
  const text = blocks
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
  const result = { text };
  const toolUse = blocks.find((b) => b.type === "tool_use");
  if (toolUse) {
    result.toolCall = { name: toolUse.name, input: toolUse.input || {} };
  }
  return result;
}

const PROVIDERS = {
  google: callGoogleAIStudio,
  deepseek: callDeepSeek,
  claude: callClaude,
};

/**
 * @param {"google"|"deepseek"|"claude"} provider
 * @param {string} apiKey
 * @param {Array<{role:string, content:string}>} messages
 * @param {string} [systemPrompt]
 * @param {Array<object>} [tools]
 * @returns {Promise<{ text: string, toolCall?: {name: string, input: object} }>}
 */
export async function callProvider(provider, apiKey, messages, systemPrompt, tools) {
  const fn = PROVIDERS[provider];
  if (!fn) throw new Error(`Unsupported provider: ${provider}`);
  return fn(apiKey, messages, systemPrompt, tools);
}

export function isSupportedProvider(provider) {
  return Object.prototype.hasOwnProperty.call(PROVIDERS, provider);
}