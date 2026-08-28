// =============================================================================
// api/ai-agent/_providerClients.js
// Thin adapters that normalize { provider, apiKey, messages } into each
// LLM provider's own request shape, and normalize their responses back to
// a single { text } shape for the frontend to render.
// =============================================================================

/**
 * messages: [{ role: "user"|"assistant", content: string }, ...]
 */

async function callGoogleAIStudio(apiKey, messages) {
  // Model name per Google's deprecation notice (gemini-2.0-flash was
  // retired). Kept as a named const so it's a one-line update if Google
  // deprecates this one too.
  const model = "gemini-flash-latest";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`Google AI Studio error (${res.status}): ${errBody}`);
  }

  const data = await res.json();
  const text =
    data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
  return { text };
}

async function callDeepSeek(apiKey, messages) {
  const res = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`DeepSeek error (${res.status}): ${errBody}`);
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content || "";
  return { text };
}

async function callClaude(apiKey, messages) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`Claude error (${res.status}): ${errBody}`);
  }

  const data = await res.json();
  const text = (data?.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
  return { text };
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
 * @returns {Promise<{ text: string }>}
 */
export async function callProvider(provider, apiKey, messages) {
  const fn = PROVIDERS[provider];
  if (!fn) throw new Error(`Unsupported provider: ${provider}`);
  return fn(apiKey, messages);
}

export function isSupportedProvider(provider) {
  return Object.prototype.hasOwnProperty.call(PROVIDERS, provider);
}