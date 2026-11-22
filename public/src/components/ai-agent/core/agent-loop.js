// =============================================================================
// public/src/components/ai-agent/core/agent-loop.js
// Agentic Multi-Step Loop Orchestrator:
// - Manages multi-turn reasoning and tool invocation cycles.
// - Routes tool execution errors back to the model as role="tool" error results
//   with self-correction guidance. There is NO cap on how many times a tool may
//   be used or retried in a turn: the model decides when it is done.
// - Dispatches parallel tool calls and notifies UI listeners of status changes.
// - Supports clean abort/cancellation at any point in the cycle.
// =============================================================================

// Runaway-loop safety ceiling only (model round-trips in ONE user turn). It is
// deliberately far above any real workflow; pass `maxDepth: Infinity` to lift it.
import { trimContext } from "./context-trim.js";
import { readSse } from "./sse.js";

export const DEFAULT_MAX_DEPTH = 50;
// If the model keeps re-issuing calls that were all already executed, stop after
// this many consecutive steps instead of looping forever.
const MAX_CONSECUTIVE_DUPLICATE_STEPS = 3;

// Read-only tools: they never change the library, so consecutive calls to them
// in one step may run in parallel. Any other tool is a barrier: it runs alone,
// in its original position, after everything before it has finished.
// Pass `parallelSafeTools: new Set()` to run everything strictly in sequence.
export const PARALLEL_SAFE_TOOLS = new Set([
  "search_library",
  "search_youtube",
  "list_youtube",
  "summarize_youtube",
  "parse_item_info",
  "get_user_activity",
  "get_creator_info",
  "get_authoring_guide",
  "fetch_attached_quiz",
  "fetch_attached_lesson",
]);

export async function readChatResponse(response, { signal, onAssistantStream } = {}) {
  const contentType = response.headers?.get?.("content-type") || "";
  if (!contentType.toLowerCase().includes("text/event-stream")) return response.json().catch(() => ({}));
  let text = "";
  let thinking = "";
  let result = null;
  try {
    await readSse(response.body, { signal, onEvent: ({ event, data }) => {
    let payload = {};
    try { payload = JSON.parse(data); } catch { payload = { text: data }; }
    if (event === "text") text += payload.delta || "";
    else if (event === "thinking") thinking += payload.delta || "";
    else if (event === "done") result = payload;
    else if (event === "error") throw new Error(payload.error || "تعذر إكمال الطلب");
    if ((event === "text" || event === "thinking") && typeof onAssistantStream === "function") {
      onAssistantStream({ text, thinking });
    }
    }});
  } catch (error) {
    if (signal?.aborted || error?.name === "AbortError") {
      return { text, ...(thinking ? { thinking } : {}), _streamAborted: true };
    }
    error.partial = { text, thinking };
    throw error;
  }
  if (result) return result;
  if (signal?.aborted) throw signal.reason || new DOMException("Aborted", "AbortError");
  if (!text && !thinking) throw new Error("انتهى تدفق الإجابة قبل اكتماله");
  return { text, ...(thinking ? { thinking } : {}) };
}

// One id per USER message: every model round-trip of that message carries the
// same id, so the server charges the daily quota once per message, not once per
// step (see api/ai-agent/_quota.js).
export function newTurnId() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const b = new Uint8Array(16);
  if (c && typeof c.getRandomValues === "function") c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function sanitizeToolOutput(val) {
  if (val == null) return "";
  if (typeof val === "string") return val;
  try {
    return JSON.stringify(val);
  } catch {
    return String(val);
  }
}

// Key-order-independent JSON, so {a:1,b:2} and {b:2,a:1} are the same call.
function stableStringify(val) {
  if (val === null || typeof val !== "object") return JSON.stringify(val) ?? "null";
  if (Array.isArray(val)) return `[${val.map(stableStringify).join(",")}]`;
  return `{${Object.keys(val)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(val[k])}`)
    .join(",")}}`;
}

// A call is a duplicate ONLY if its name AND its complete input are identical.
// (The old signature looked at just a title/name field, so e.g. every
// search_library call, which has none, shared one signature and the second
// search was silently skipped as a "duplicate".)
function getToolCallSignature(toolCall) {
  const name = toolCall?.name || "";
  let input = "";
  try {
    input = stableStringify(toolCall?.input || {});
  } catch {
    input = String(Math.random());
  }
  return `${name}::${input}`;
}

// Marks the cards of every call from `fromIndex` on as aborted (the call at
// `fromIndex` itself is the one that was running when the user stopped).
function markAborted(queue, fromIndex) {
  for (let j = fromIndex; j < queue.length; j++) {
    const card = queue[j].card;
    if (card?.updateStatus) card.updateStatus("aborted");
  }
}

/**
 * Executes a full agent turn, handling recursive model calls and tool executions.
 *
 * @param {object} params
 * @param {Array<object>} params.history - Live conversation history array
 * @param {string} params.systemPrompt
 * @param {string} params.provider
 * @param {string} [params.model]
 * @param {string} [params.effort]
 * @param {boolean} [params.useOwnKey]
 * @param {string} [params.ownKey]
 * @param {string} [params.authToken]
 * @param {boolean} [params.enableTools=true]
 * @param {string[]} [params.toolNames]
 * @param {AbortSignal} params.signal
 * @param {(url: string) => string} params.apiUrl
 * @param {(toolCall: object, signal: AbortSignal) => Promise<string>} params.executeToolCall
 * @param {(toolCall: object) => object} [params.onToolCallStart] - Returns tool card instance
 * @param {(text: string, thinking?: string) => void} [params.onAssistantMessage]
 * @param {(partial: {text: string, thinking: string}) => void} [params.onAssistantStream]
 * @param {(thinking: string) => void} [params.onThinking]
 * @param {(info: { label: string, kind: string, step?: string }) => void} [params.onStepChange]
 * @param {() => Promise<void>} [params.onHistoryPersist]
 * @param {Set<string>} [params.sessionExecutedTools]
 * @param {number} [params.maxDepth=50] - runaway-loop safety ceiling only
 * @param {Set<string>} [params.parallelSafeTools] - read-only tool names whose
 *   consecutive calls in one step run in parallel (default PARALLEL_SAFE_TOOLS).
 * @param {string} [params.turnId] - one uuid per user message, sent on every step
 *   (the server charges the daily quota once per turnId). Generated when omitted.
 * @returns {Promise<{ success: boolean, aborted?: boolean, error?: string }>}
 */
export async function runAgentLoop(params) {
  const {
    history,
    systemPrompt,
    provider,
    model,
    effort,
    useOwnKey,
    ownKey,
    authToken,
    enableTools = true,
    toolNames,
    signal,
    apiUrl,
    executeToolCall,
    onToolCallStart,
    onAssistantMessage,
    onAssistantStream,
    onThinking,
    onStepChange,
    onHistoryPersist,
    sessionExecutedTools = new Set(),
    maxDepth = DEFAULT_MAX_DEPTH,
    toWireMessage,
    turnId = newTurnId(),
    parallelSafeTools = PARALLEL_SAFE_TOOLS,
  } = params;

  const toolErrorCounts = new Map(); // informational only: never blocks a retry
  const activeToolCards = new Map();
  let consecutiveDuplicateSteps = 0;

  for (let depth = 0; depth < maxDepth; depth++) {
    if (signal?.aborted) {
      return { success: false, aborted: true };
    }

    // Update status
    if (typeof onStepChange === "function") {
      const stepText = depth === 0 ? "" : `Step ${depth + 1}`;
      onStepChange({
        label: depth === 0 ? "Endeavoring…" : "Striving…",
        kind: "thinking",
        step: stepText,
      });
    }

    // Build wire messages
    // Wire copy only: old tool results / attachments are trimmed, `history` is untouched.
    const wireMessages = trimContext(
      history.map((m) => (toWireMessage ? toWireMessage(m) : m)),
      { debug: !!globalThis.__AI_AGENT_DEBUG_CONTEXT__ },
    );

    // Request from backend
    const headers = { "Content-Type": "application/json" };
    if (authToken) headers.Authorization = `Bearer ${authToken}`;

    let response;
    try {
      response = await fetch(apiUrl("/api/ai-agent/chat"), {
        method: "POST",
        headers,
        signal,
        body: JSON.stringify({
          provider,
          model: model || undefined,
          effort: effort || undefined,
          messages: wireMessages,
          useOwnKey: !!useOwnKey,
          ownKey: useOwnKey ? ownKey : undefined,
          systemPrompt,
          enableTools,
          toolNames: toolNames || undefined,
          turnId,
          stream: true,
        }),
      });
    } catch (fetchErr) {
      if (signal?.aborted || fetchErr?.name === "AbortError") {
        return { success: false, aborted: true };
      }
      throw fetchErr;
    }

    let data;
    try {
      data = await readChatResponse(response, { signal, onAssistantStream });
    } catch (streamErr) {
      if (streamErr.partial?.text || streamErr.partial?.thinking) {
        history.push({ role: "assistant", content: streamErr.partial.text || "", ...(streamErr.partial.thinking ? { thinking: streamErr.partial.thinking } : {}) });
        if (typeof onHistoryPersist === "function") await onHistoryPersist().catch(() => { });
      }
      if (signal?.aborted || streamErr?.name === "AbortError") return { success: false, aborted: true };
      return { success: false, error: streamErr.message || "تعذر إكمال الطلب" };
    }
    if (signal?.aborted || data._streamAborted) {
      if (data.text || data.thinking) {
        history.push({ role: "assistant", content: data.text || "", ...(data.thinking ? { thinking: data.thinking } : {}) });
        if (typeof onHistoryPersist === "function") await onHistoryPersist().catch(() => { });
      }
      return { success: false, aborted: true };
    }

    if (!response.ok) {
      const detailMsg = data.detail ? `${data.error || "خطأ"}: ${data.detail}` : data.error || "تعذر إكمال الطلب";
      return { success: false, error: detailMsg };
    }

    // Thinking
    if (data.thinking && typeof onThinking === "function") {
      onThinking(data.thinking);
    }

    // Assistant text
    if (data.text) {
      if (typeof onAssistantMessage === "function") {
        onAssistantMessage(data.text, data.thinking);
      }
      history.push({
        role: "assistant",
        content: data.text,
        ...(data.thinking ? { thinking: data.thinking } : {}),
      });
      if (typeof onHistoryPersist === "function") {
        await onHistoryPersist().catch(() => { });
      }
    }

    // Tool calls to run
    const toolCallsToRun = Array.isArray(data.toolCalls)
      ? data.toolCalls
      : data.toolCall?.name
        ? [data.toolCall]
        : [];

    // If no tools requested, the agent is done!
    if (!toolCallsToRun.length) {
      return { success: true };
    }

    // If assistant had tools but no text, record assistant message in history
    if (!data.text) {
      history.push({
        role: "assistant",
        content: "",
        toolCalls: toolCallsToRun,
        ...(data.thinking ? { thinking: data.thinking } : {}),
      });
      if (typeof onHistoryPersist === "function") {
        await onHistoryPersist().catch(() => { });
      }
    } else {
      // Attach toolCalls metadata to the last assistant message
      const lastMsg = history[history.length - 1];
      if (lastMsg && lastMsg.role === "assistant") {
        lastMsg.toolCalls = toolCallsToRun;
      }
    }

    // Initialize UI cards for all parallel tool calls
    const toolExecutionQueue = [];
    const totalTools = toolCallsToRun.length;

    for (let i = 0; i < totalTools; i++) {
      const tc = toolCallsToRun[i];
      const callId = tc.id || `call_${Date.now()}_${i}_${tc.name}`;
      tc.id = callId;

      let card = null;
      if (typeof onToolCallStart === "function") {
        card = onToolCallStart(tc);
        if (card) {
          activeToolCards.set(callId, card);
        }
      }

      toolExecutionQueue.push({ tc, card, index: i });
    }

    let executedToolsCount = 0;

    // Split the calls into segments: a run of consecutive read-only calls is one
    // parallel batch; every other call is a barrier segment of its own.
    const segments = [];
    for (const entry of toolExecutionQueue) {
      const safe = parallelSafeTools.has(entry.tc.name);
      const last = segments[segments.length - 1];
      if (safe && last && last.parallel) last.entries.push(entry);
      else segments.push({ parallel: safe, entries: [entry] });
    }

    // Runs one call; never throws (errors come back as { ok: false }), and never
    // touches history or cards, so a batch can run it concurrently.
    const runOne = async (entry) => {
      try {
        return { ok: true, resultText: await executeToolCall(entry.tc, signal) };
      } catch (err) {
        return { ok: false, err };
      }
    };

    for (const segment of segments) {
      const startIdx = segment.entries[0].index;
      if (signal?.aborted) {
        markAborted(toolExecutionQueue, startIdx);
        return { success: false, aborted: true };
      }

      // Decide duplicates BEFORE anything runs, so two identical calls in one
      // batch do not both execute.
      const plan = segment.entries.map((entry) => {
        const sig = getToolCallSignature(entry.tc);
        if (sessionExecutedTools.has(sig)) return { entry, sig, duplicate: true };
        sessionExecutedTools.add(sig);
        return { entry, sig, duplicate: false };
      });
      const toRun = plan.filter((p) => !p.duplicate);
      executedToolsCount += toRun.length;

      if (toRun.length && typeof onStepChange === "function") {
        const first = toRun[0].entry.index + 1;
        const lastNo = toRun[toRun.length - 1].entry.index + 1;
        let stepLabel = "";
        if (totalTools > 1) stepLabel = toRun.length > 1 ? `أدوات ${first}–${lastNo}/${totalTools}` : `أداة ${first}/${totalTools}`;
        onStepChange({ label: "جاري تنفيذ الأداة…", kind: "tool", step: stepLabel });
      }

      const outcomes = new Map();
      if (toRun.length) {
        const results = await Promise.all(toRun.map((p) => runOne(p.entry)));
        toRun.forEach((p, k) => outcomes.set(p, results[k]));
      }

      if (signal?.aborted) {
        markAborted(toolExecutionQueue, startIdx);
        return { success: false, aborted: true };
      }

      // Apply the results to history and cards SEQUENTIALLY, in the original call
      // order: tool replies must stay paired with, and ordered like, the calls.
      for (const p of plan) {
        const { tc, card } = p.entry;

        if (p.duplicate) {
          console.warn("[agent-loop] Skipping exact duplicate tool execution:", p.sig);
          if (card?.updateStatus) {
            card.updateStatus("success", { result: "تم تنفيذ هذا الإجراء مسبقاً بنجاح." });
          }
          history.push({
            role: "tool",
            toolCallId: tc.id,
            toolName: tc.name,
            input: tc.input || {},
            content: "تم تنفيذ هذا الإجراء بنفس المعاملات مسبقاً في هذا الطلب، فلم يُكرَّر. تابع بقية المطلوب أو أجب المستخدم.",
          });
          continue;
        }

        const outcome = outcomes.get(p);
        if (outcome.ok) {
          const safeResult = sanitizeToolOutput(outcome.resultText) || "تم تنفيذ العملية بنجاح.";
          if (card?.updateStatus) {
            card.updateStatus("success", { result: safeResult });
          }
          history.push({
            role: "tool",
            toolCallId: tc.id,
            toolName: tc.name,
            input: tc.input || {},
            content: safeResult,
          });
          continue;
        }

        const err = outcome.err;
        console.error(`[agent-loop] Tool "${tc.name}" failed:`, err);

        const nextRetryNum = (toolErrorCounts.get(tc.name) || 0) + 1;
        toolErrorCounts.set(tc.name, nextRetryNum);

        // Remove from sessionExecutedTools so the model is allowed to retry with fixed args
        sessionExecutedTools.delete(p.sig);

        const errorMsg = err?.userMessage || err?.agentMessage || err?.message || "فشل تنفيذ الأداة.";
        // An error that changing arguments cannot fix (nonRetryable) must not show the
        // auto-correct badge nor invite the model to retry.
        const canRetry = !err?.nonRetryable;
        if (card?.updateStatus) {
          card.updateStatus("error", {
            error: errorMsg,
            retrying: canRetry,
            retryNum: nextRetryNum,
          });
        }

        // Return error back to the model as a tool result so it can fix arguments
        const agentFeedback = canRetry
          ? `[خطأ في تنفيذ الأداة]: ${err?.agentMessage || err?.message || errorMsg}\nتوجيه للنموذج: قم بفحص المعاملات وتصحيحها وإعادة المحاولة، وإن تعذّر الحل فوضّح للمستخدم ما حدث واسأله عن التفاصيل الناقصة.`
          : `[خطأ في تنفيذ الأداة]: ${err?.agentMessage || err?.message || errorMsg}\nتوجيه للنموذج: هذا الخطأ لا يُحل بتغيير المعاملات، فلا تعد المحاولة ولا تصفه بأنه عطل تقني مؤقت. اذكر للمستخدم بوضوح ما الذي فشل ولماذا.`;

        history.push({
          role: "tool",
          toolCallId: tc.id,
          toolName: tc.name,
          input: tc.input || {},
          content: agentFeedback,
          isError: true,
        });
      }

      // Persist once per segment (not once per call).
      if (typeof onHistoryPersist === "function") {
        await onHistoryPersist().catch(() => { });
      }
    }

    if (signal?.aborted) {
      return { success: false, aborted: true };
    }

    // Duplicates no longer end the turn on their own (the model gets a "already
    // done" tool result and can finish or continue). Only a model stuck
    // re-issuing the same finished calls several steps in a row is stopped.
    if (executedToolsCount === 0 && toolCallsToRun.length > 0) {
      consecutiveDuplicateSteps++;
      if (consecutiveDuplicateSteps >= MAX_CONSECUTIVE_DUPLICATE_STEPS) {
        console.warn("[agent-loop] Model kept repeating already-executed tools. Halting agent loop.");
        return { success: true };
      }
    } else {
      consecutiveDuplicateSteps = 0;
    }

    // Continue loop: the model will see the tool results on the next iteration
  }

  // Max depth exceeded
  return {
    success: false,
    error: "توقف الباشــمبصمج بعد عدد كبير من خطوات الأدوات المتتالية في نفس الطلب. أعد صياغة طلبك أو قسّمه إلى خطوات أصغر.",
  };
}
