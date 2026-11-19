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
export const DEFAULT_MAX_DEPTH = 50;
// If the model keeps re-issuing calls that were all already executed, stop after
// this many consecutive steps instead of looping forever.
const MAX_CONSECUTIVE_DUPLICATE_STEPS = 3;

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
 * @param {(thinking: string) => void} [params.onThinking]
 * @param {(info: { label: string, kind: string, step?: string }) => void} [params.onStepChange]
 * @param {() => Promise<void>} [params.onHistoryPersist]
 * @param {Set<string>} [params.sessionExecutedTools]
 * @param {number} [params.maxDepth=50] - runaway-loop safety ceiling only
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
    onThinking,
    onStepChange,
    onHistoryPersist,
    sessionExecutedTools = new Set(),
    maxDepth = DEFAULT_MAX_DEPTH,
    toWireMessage,
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
    const wireMessages = history.map((m) => (toWireMessage ? toWireMessage(m) : m));

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
        }),
      });
    } catch (fetchErr) {
      if (signal?.aborted || fetchErr?.name === "AbortError") {
        return { success: false, aborted: true };
      }
      throw fetchErr;
    }

    if (signal?.aborted) return { success: false, aborted: true };

    const data = await response.json().catch(() => ({}));
    if (signal?.aborted) return { success: false, aborted: true };

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

      toolExecutionQueue.push({ tc, card });
    }

    let executedToolsCount = 0;
    let anyErrorsOccurred = false;

    // Execute tools
    for (let i = 0; i < toolExecutionQueue.length; i++) {
      if (signal?.aborted) {
        toolExecutionQueue.slice(i).forEach(({ card }) => {
          if (card?.updateStatus) card.updateStatus("aborted");
        });
        return { success: false, aborted: true };
      }

      const { tc, card } = toolExecutionQueue[i];
      const sig = getToolCallSignature(tc);

      if (sessionExecutedTools.has(sig)) {
        console.warn("[agent-loop] Skipping exact duplicate tool execution:", sig);
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

      sessionExecutedTools.add(sig);
      executedToolsCount++;

      if (typeof onStepChange === "function") {
        const stepLabel = totalTools > 1 ? `أداة ${i + 1}/${totalTools}` : "";
        onStepChange({
          label: "جاري تنفيذ الأداة…",
          kind: "tool",
          step: stepLabel,
        });
      }

      try {
        const resultText = await executeToolCall(tc, signal);
        if (signal?.aborted) {
          if (card?.updateStatus) card.updateStatus("aborted");
          return { success: false, aborted: true };
        }

        const safeResult = sanitizeToolOutput(resultText) || "تم تنفيذ العملية بنجاح.";
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

        if (typeof onHistoryPersist === "function") {
          await onHistoryPersist().catch(() => { });
        }
      } catch (err) {
        if (signal?.aborted) {
          if (card?.updateStatus) card.updateStatus("aborted");
          return { success: false, aborted: true };
        }

        console.error(`[agent-loop] Tool "${tc.name}" failed:`, err);
        anyErrorsOccurred = true;

        const nextRetryNum = (toolErrorCounts.get(tc.name) || 0) + 1;
        toolErrorCounts.set(tc.name, nextRetryNum);

        // Remove from sessionExecutedTools so the model is allowed to retry with fixed args
        sessionExecutedTools.delete(sig);

        const errorMsg = err?.userMessage || err?.agentMessage || err?.message || "فشل تنفيذ الأداة.";
        if (card?.updateStatus) {
          card.updateStatus("error", {
            error: errorMsg,
            retrying: true,
            retryNum: nextRetryNum,
          });
        }

        // Return error back to the model as a tool result so it can fix arguments
        const agentFeedback = `[خطأ في تنفيذ الأداة]: ${err?.agentMessage || err?.message || errorMsg}\nتوجيه للنموذج: قم بفحص المعاملات وتصحيحها وإعادة المحاولة، وإن تعذّر الحل فوضّح للمستخدم ما حدث واسأله عن التفاصيل الناقصة.`;

        history.push({
          role: "tool",
          toolCallId: tc.id,
          toolName: tc.name,
          input: tc.input || {},
          content: agentFeedback,
          isError: true,
        });

        if (typeof onHistoryPersist === "function") {
          await onHistoryPersist().catch(() => { });
        }
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
