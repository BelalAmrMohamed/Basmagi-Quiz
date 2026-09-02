// =============================================================================
// api/ai-agent/_providerClients.js
// Thin adapters that normalize { provider, apiKey, messages } into each
// LLM provider's own request shape, and normalize their responses back to
// a single { text, toolCalls? } shape for the frontend to render.
// `toolCalls` is always an array (possibly empty/absent) — a model turn
// can legitimately request more than one tool call at once, and every
// adapter below must surface all of them, not just the first.
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

// Per-provider allowlists for the optional client-supplied `model`
// override (see chat.js's handler + ai-agent-settings.js's
// MODELS_BY_PROVIDER, which this list mirrors). Validated server-side
// rather than trusting the client string outright, since it's interpolated
// directly into the Google request URL below — an unchecked value there
// would be an open redirect/SSRF-shaped bug, not just a "wrong model"
// bug. An unrecognized/omitted value always falls back to the provider's
// own lightest/cheapest/latest default, exactly as if this feature didn't
// exist.
const ALLOWED_MODELS = {
  google: new Set(["gemini-flash-lite-latest", "gemini-flash-latest", "gemini-2.5-pro"]),
  deepseek: new Set(["deepseek-chat", "deepseek-reasoner"]),
  claude: new Set(["claude-haiku-4-5-20251001", "claude-sonnet-4-6", "claude-opus-4-6"]),
};

const DEFAULT_MODELS = {
  google: "gemini-flash-lite-latest", // dynamic "-latest" pointer — always the provider's current lightest model
  deepseek: "deepseek-chat",
  claude: "claude-haiku-4-5-20251001",
};

/**
 * @param {"google"|"deepseek"|"claude"} provider
 * @param {string} [requestedModel] - client-supplied override, if any
 * @returns {string} a validated model id, safe to interpolate/send as-is
 */
function resolveModel(provider, requestedModel) {
  if (requestedModel && ALLOWED_MODELS[provider]?.has(requestedModel)) {
    return requestedModel;
  }
  return DEFAULT_MODELS[provider];
}

async function callGoogleAIStudio(apiKey, messages, systemPrompt, tools, requestedModel) {
  // Defaults to the lightest, cheapest, latest available model — see
  // resolveModel()/DEFAULT_MODELS above — but honors a validated
  // client-supplied override (Settings tab's model picker).
  const model = resolveModel("google", requestedModel);
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
  const funcCalls = parts.filter((p) => p.functionCall).map((p) => p.functionCall);
  const result = { text };
  if (funcCalls.length) {
    result.toolCalls = funcCalls.map((fc) => ({ name: fc.name, input: fc.args || {} }));
  }
  return result;
}

async function callDeepSeek(apiKey, messages, systemPrompt, tools, requestedModel) {
  const chatMessages = messages.map((m) => ({ role: m.role, content: m.content }));
  if (systemPrompt) {
    chatMessages.unshift({ role: "system", content: systemPrompt });
  }

  const body = {
    model: resolveModel("deepseek", requestedModel),
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
  const toolCalls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
  const parsedCalls = toolCalls
    .filter((tc) => tc?.function)
    .map((tc) => {
      let input = {};
      try {
        input = JSON.parse(tc.function.arguments || "{}");
      } catch {
        input = {};
      }
      return { name: tc.function.name, input };
    });
  if (parsedCalls.length) {
    result.toolCalls = parsedCalls;
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

async function callClaude(apiKey, messages, systemPrompt, tools, requestedModel) {
  const body = {
    model: resolveModel("claude", requestedModel),
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
  const toolUses = blocks.filter((b) => b.type === "tool_use");
  if (toolUses.length) {
    result.toolCalls = toolUses.map((tu) => ({ name: tu.name, input: tu.input || {} }));
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
 * @param {string} [model] - optional client-requested model id (Settings
 *   tab's model picker); validated against ALLOWED_MODELS above and
 *   silently falls back to the provider's own lightest/cheapest/latest
 *   default (DEFAULT_MODELS) when omitted or not recognized.
 * @returns {Promise<{ text: string, toolCalls?: Array<{name: string, input: object}> }>}
 */
export async function callProvider(provider, apiKey, messages, systemPrompt, tools, model) {
  const fn = PROVIDERS[provider];
  if (!fn) throw new Error(`Unsupported provider: ${provider}`);
  return fn(apiKey, messages, systemPrompt, tools, model);
}

export function isSupportedProvider(provider) {
  return Object.prototype.hasOwnProperty.call(PROVIDERS, provider);
}