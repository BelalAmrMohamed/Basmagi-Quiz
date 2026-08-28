// =============================================================================
// api/ai-agent/_providerClients.js
// Thin adapters that normalize { provider, apiKey, messages } into each
// LLM provider's own request shape, and normalize their responses back to
// a single { text, toolCall? } shape for the frontend to render.
// =============================================================================

/**
 * messages: [{ role: "user"|"assistant", content: string }, ...]
 */

async function callGoogleAIStudio(apiKey, messages, systemPrompt, tools) {
  // We Must use the lightest available model
  const model = "gemini-3.5-flash-lite";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const body = { contents };

  if (systemPrompt) {
    body.systemInstruction = { parts: [{ text: systemPrompt }] };
  }

  if (Array.isArray(tools) && tools.length) {
    body.tools = [
      {
        functionDeclarations: tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.input_schema,
        })),
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

async function callClaude(apiKey, messages, systemPrompt, tools) {
  const body = {
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
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
