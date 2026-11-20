// =============================================================================
import { readSse } from "../../public/src/components/ai-agent/core/sse.js";
// api/ai-agent/_providerClients.js
// Thin adapters that normalize { provider, apiKey, messages } into each
// LLM provider's own request shape, and normalize their responses back to
// a single { text, toolCalls? } shape for the frontend to render.
// `toolCalls` is always an array (possibly empty/absent) — a model turn
// can legitimately request more than one tool call at once, and every
// adapter below must surface all of them, not just the first.
// =============================================================================

/**
 * messages: [{ role: "user"|"assistant"|"tool", content: string, toolCalls?: [...], toolCallId?: string, toolName?: string, isError?: boolean, attachments?: [{mimeType, base64, name}] }, ...]
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
  google: new Set([
    "gemini-flash-latest",
    "gemini-flash-lite-latest",
    "gemini-3.8-flash",
    "gemini-3.1-pro-preview",
    "gemini-2.5-pro", // auto-mapped to gemini-3.1-pro-preview
  ]),
  deepseek: new Set(["deepseek-chat", "deepseek-reasoner"]),
  claude: new Set(["claude-haiku-4-5-20251001", "claude-sonnet-4-6", "claude-opus-4-6"]),
};

export const DEFAULT_MODELS = {
  google: "gemini-flash-lite-latest", // always the lightest free-tier model for shared platform keys
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
    if (provider === "google" && requestedModel === "gemini-2.5-pro") {
      return "gemini-3.1-pro-preview";
    }
    return requestedModel;
  }
  return DEFAULT_MODELS[provider];
}

export function buildGeminiContents(messages) {
  const contents = [];
  for (const m of messages) {
    if (m.role === "tool") {
      const part = {
        functionResponse: {
          name: m.toolName || "tool",
          response: {
            output: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
            ...(m.isError ? { error: true } : {}),
          },
        },
      };
      const last = contents[contents.length - 1];
      if (last && last.role === "user" && last.parts.some((p) => p.functionResponse)) {
        last.parts.push(part);
      } else {
        contents.push({ role: "user", parts: [part] });
      }
      continue;
    }
    if (m.role === "assistant") {
      const parts = [];
      if (m.content) parts.push({ text: m.content });
      if (Array.isArray(m.toolCalls) && m.toolCalls.length) {
        m.toolCalls.forEach((tc) => {
          const sig = tc.thoughtSignature || tc.thought_signature || "skip_thought_signature_validator";
          parts.push({
            functionCall: { name: tc.name, args: tc.input || {} },
            thought_signature: sig,
            thoughtSignature: sig,
          });
        });
      }
      if (!parts.length) parts.push({ text: "" });
      contents.push({ role: "model", parts });
      continue;
    }
    const parts = [{ text: m.content || "" }];
    if (Array.isArray(m.attachments)) {
      m.attachments.forEach((att) => {
        if (att?.base64 && att?.mimeType) {
          parts.push({ inlineData: { mimeType: att.mimeType, data: att.base64 } });
        }
      });
    }
    contents.push({ role: "user", parts });
  }
  return contents;
}

async function callGoogleAIStudio(apiKey, messages, systemPrompt, tools, requestedModel, effort, streamOptions = {}) {
  let model = resolveModel("google", requestedModel);
  if (model === "gemini-2.5-pro") {
    model = "gemini-3.1-pro-preview";
  }
  const action = streamOptions.onEvent ? "streamGenerateContent?alt=sse" : "generateContent";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:${action}&key=${apiKey}`.replace("generateContent&key=", "generateContent?key=");

  const contents = buildGeminiContents(messages);

  const body = { contents };

  if (systemPrompt) {
    body.systemInstruction = { parts: [{ text: systemPrompt }] };
  }

  // includeThoughts asks Gemini to return thought *summaries* as parts flagged
  // `thought: true`. They are kept out of `text` and returned as `thinking`.
  const thinkingConfig = { includeThoughts: true };
  if (effort && ["low", "medium", "high"].includes(effort)) {
    thinkingConfig.thinkingLevel = effort;
  }
  body.generationConfig = { ...(body.generationConfig || {}), thinkingConfig };

  if (Array.isArray(tools) && tools.length) {
    body.tools = [
      {
        functionDeclarations: tools.map((t) => {
          const decl = { name: t.name, description: t.description };
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
    signal: streamOptions.signal,
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    const err = new Error(`Google AI Studio error (${res.status}): ${errBody}`);
    err.upstreamStatus = res.status;
    throw err;
  }

  if (streamOptions.onEvent) {
    streamOptions.onOpen?.();
    let text = "";
    let thinking = "";
    const toolCalls = [];
    await readSse(res.body, { signal: streamOptions.signal, onEvent: ({ data }) => {
      if (!data || data === "[DONE]") return;
      const payload = JSON.parse(data);
      for (const part of payload?.candidates?.[0]?.content?.parts || []) {
        if (part.text && part.thought) {
          thinking += part.text;
          streamOptions.onEvent({ type: "thinking", delta: part.text });
        } else if (part.text) {
          text += part.text;
          streamOptions.onEvent({ type: "text", delta: part.text });
        }
        if (part.functionCall) {
          const call = { id: `call_${Date.now()}_${toolCalls.length}`, name: part.functionCall.name, input: part.functionCall.args || {}, thoughtSignature: part.thoughtSignature || part.thought_signature || undefined };
          toolCalls.push(call);
          streamOptions.onEvent({ type: "toolCall", toolCall: call });
        }
      }
    }});
    const result = { text };
    if (thinking.trim()) result.thinking = thinking.trim();
    if (toolCalls.length) result.toolCalls = toolCalls;
    return result;
  }

  const data = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const text = parts
    .filter((p) => p.text && !p.thought)
    .map((p) => p.text)
    .join("");
  const thinking = parts
    .filter((p) => p.text && p.thought)
    .map((p) => p.text)
    .join("\n\n")
    .trim();
  const funcCallParts = parts.filter((p) => p.functionCall);
  const result = { text };
  if (thinking) result.thinking = thinking;
  if (funcCallParts.length) {
    result.toolCalls = funcCallParts.map((p, idx) => ({
      id: `call_${Date.now()}_${idx}`,
      name: p.functionCall.name,
      input: p.functionCall.args || {},
      thoughtSignature: p.thoughtSignature || p.thought_signature || undefined,
    }));
  }
  return result;
}

async function callDeepSeek(apiKey, messages, systemPrompt, tools, requestedModel, _effort, streamOptions = {}) {
  const chatMessages = messages.map((m) => {
    if (m.role === "tool") {
      return {
        role: "tool",
        tool_call_id: m.toolCallId || m.toolName || "call_default",
        content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      };
    }
    if (m.role === "assistant") {
      const msg = { role: "assistant", content: m.content || "" };
      if (Array.isArray(m.toolCalls) && m.toolCalls.length) {
        msg.tool_calls = m.toolCalls.map((tc, idx) => ({
          id: tc.id || `call_${idx}_${tc.name}`,
          type: "function",
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.input || {}),
          },
        }));
      }
      return msg;
    }
    return { role: m.role, content: m.content || "" };
  });

  if (systemPrompt) {
    chatMessages.unshift({ role: "system", content: systemPrompt });
  }

  const body = {
    model: resolveModel("deepseek", requestedModel),
    messages: chatMessages,
    ...(streamOptions.onEvent ? { stream: true } : {}),
  };

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
    signal: streamOptions.signal,
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    const err = new Error(`DeepSeek error (${res.status}): ${errBody}`);
    err.upstreamStatus = res.status;
    throw err;
  }

  if (streamOptions.onEvent) {
    streamOptions.onOpen?.();
    let text = "";
    const calls = new Map();
    await readSse(res.body, { signal: streamOptions.signal, onEvent: ({ data }) => {
      if (!data || data === "[DONE]") return;
      const payload = JSON.parse(data);
      const delta = payload?.choices?.[0]?.delta || {};
      if (delta.content) { text += delta.content; streamOptions.onEvent({ type: "text", delta: delta.content }); }
      for (const frag of delta.tool_calls || []) {
        const index = Number.isInteger(frag.index) ? frag.index : calls.size;
        const call = calls.get(index) || { id: "", name: "", arguments: "" };
        if (frag.id) call.id = frag.id;
        if (frag.function?.name) call.name += frag.function.name;
        if (frag.function?.arguments) call.arguments += frag.function.arguments;
        calls.set(index, call);
      }
    }});
    const toolCalls = [...calls.values()].filter((call) => call.name).map((call, index) => {
      let input = {};
      try { input = JSON.parse(call.arguments || "{}"); } catch { input = {}; }
      return { id: call.id || `call_${Date.now()}_${index}`, name: call.name, input };
    });
    for (const toolCall of toolCalls) streamOptions.onEvent({ type: "toolCall", toolCall });
    return { text, ...(toolCalls.length ? { toolCalls } : {}) };
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
      return { id: tc.id, name: tc.function.name, input };
    });
  if (parsedCalls.length) {
    result.toolCalls = parsedCalls;
  }
  return result;
}

const CLAUDE_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

async function callClaude(apiKey, messages, systemPrompt, tools, requestedModel, _effort, streamOptions = {}) {
  const claudeMessages = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role === "tool") {
      const toolBlock = {
        type: "tool_result",
        tool_use_id: m.toolCallId || m.toolName || "tool_default",
        content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
        is_error: !!m.isError,
      };
      const lastMsg = claudeMessages[claudeMessages.length - 1];
      if (lastMsg && lastMsg.role === "user" && Array.isArray(lastMsg.content) && lastMsg.content[0]?.type === "tool_result") {
        lastMsg.content.push(toolBlock);
      } else {
        claudeMessages.push({ role: "user", content: [toolBlock] });
      }
      continue;
    }
    if (m.role === "assistant") {
      if (Array.isArray(m.toolCalls) && m.toolCalls.length) {
        const blocks = [];
        if (m.content) blocks.push({ type: "text", text: m.content });
        m.toolCalls.forEach((tc, idx) => {
          blocks.push({
            type: "tool_use",
            id: tc.id || `toolu_${idx}_${tc.name}`,
            name: tc.name,
            input: tc.input || {},
          });
        });
        claudeMessages.push({ role: "assistant", content: blocks });
        continue;
      }
      claudeMessages.push({ role: "assistant", content: m.content || "" });
      continue;
    }
    if (!Array.isArray(m.attachments) || !m.attachments.length) {
      claudeMessages.push({ role: m.role, content: m.content || "" });
      continue;
    }
    const blocks = [{ type: "text", text: m.content || "" }];
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
    });
    claudeMessages.push({ role: m.role, content: blocks });
  }

  const body = {
    model: resolveModel("claude", requestedModel),
    max_tokens: 2048,
    messages: claudeMessages,
    ...(streamOptions.onEvent ? { stream: true } : {}),
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
    signal: streamOptions.signal,
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    const err = new Error(`Claude error (${res.status}): ${errBody}`);
    err.upstreamStatus = res.status;
    throw err;
  }

  if (streamOptions.onEvent) {
    streamOptions.onOpen?.();
    let text = "";
    const calls = new Map();
    await readSse(res.body, { signal: streamOptions.signal, onEvent: ({ event, data }) => {
      if (!data) return;
      const payload = JSON.parse(data);
      if (event === "content_block_start" && payload.content_block?.type === "tool_use") {
        calls.set(payload.index, { id: payload.content_block.id, name: payload.content_block.name, json: "" });
      } else if (event === "content_block_delta") {
        const delta = payload.delta || {};
        if (delta.type === "text_delta" && delta.text) { text += delta.text; streamOptions.onEvent({ type: "text", delta: delta.text }); }
        else if (delta.type === "thinking_delta" && delta.thinking) streamOptions.onEvent({ type: "thinking", delta: delta.thinking });
        else if (delta.type === "input_json_delta") calls.get(payload.index) && (calls.get(payload.index).json += delta.partial_json || "");
      } else if (event === "content_block_stop") {
        const call = calls.get(payload.index);
        if (call && !call.emitted) {
          call.emitted = true;
          let input = {};
          try { input = JSON.parse(call.json || "{}"); } catch { input = {}; }
          call.input = input;
          streamOptions.onEvent({ type: "toolCall", toolCall: { id: call.id, name: call.name, input } });
        }
      }
    }});
    const toolCalls = [...calls.values()].filter((call) => call.name).map((call) => ({ id: call.id, name: call.name, input: call.input || {} }));
    return { text, ...(toolCalls.length ? { toolCalls } : {}) };
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
    result.toolCalls = toolUses.map((tu) => ({ id: tu.id, name: tu.name, input: tu.input || {} }));
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
 * @param {Array<{role:string, content:string, toolCalls?:Array<object>, toolCallId?:string, toolName?:string, isError?:boolean}>} messages
 * @param {string} [systemPrompt]
 * @param {Array<object>} [tools]
 * @param {string} [model]
 * @param {string} [effort]
 * @returns {Promise<{ text: string, toolCalls?: Array<{id?: string, name: string, input: object}>, thinking?: string }>}
 */
export async function callProvider(provider, apiKey, messages, systemPrompt, tools, model, effort, streamOptions) {
  const fn = PROVIDERS[provider];
  if (!fn) throw new Error(`Unsupported provider: ${provider}`);
  return fn(apiKey, messages, systemPrompt, tools, model, effort, streamOptions);
}

export function openProviderStream(provider, apiKey, messages, systemPrompt, tools, model, effort, options) {
  if (!isSupportedProvider(provider)) throw new Error(`Unsupported provider: ${provider}`);
  return callProvider(provider, apiKey, messages, systemPrompt, tools, model, effort, options);
}

export function isSupportedProvider(provider) {
  return Object.prototype.hasOwnProperty.call(PROVIDERS, provider);
}
