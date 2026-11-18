// =============================================================================
// public/src/components/ai-agent/core/agent-loop.js
// Agentic Multi-Step Loop Orchestrator:
// - Manages multi-turn reasoning and tool invocation cycles.
// - Routes tool execution errors back to the model as role="tool" error results
//   with self-correction guidance, capped at maxToolRetries (2).
// - Dispatches parallel tool calls and notifies UI listeners of status changes.
// - Supports clean abort/cancellation at any point in the cycle.
// =============================================================================

export const DEFAULT_MAX_DEPTH = 8;
export const DEFAULT_MAX_TOOL_RETRIES = 2;

function sanitizeToolOutput(val) {
  if (val == null) return "";
  if (typeof val === "string") return val;
  try {
    return JSON.stringify(val);
  } catch {
    return String(val);
  }
}

function getToolCallSignature(toolCall) {
  const name = toolCall?.name || "";
  const input = toolCall?.input || {};
  const primary = input.title || input.name || input.itemName || input.targetTitle || input.currentTitle || "";
  const secondary = input.destinationFolder || input.parentFolder || input.targetKind || "";
  return `${name}::${String(primary).trim().toLowerCase()}::${String(secondary).trim().toLowerCase()}`;
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
 * @param {number} [params.maxDepth=8]
 * @param {number} [params.maxToolRetries=2]
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
    maxToolRetries = DEFAULT_MAX_TOOL_RETRIES,
    toWireMessage,
  } = params;

  const toolRetryCounts = new Map();
  const activeToolCards = new Map();

  for (let depth = 0; depth < maxDepth; depth++) {
    if (signal?.aborted) {
      return { success: false, aborted: true };
    }

    // Update status
    if (typeof onStepChange === "function") {
      const stepText = depth === 0 ? "" : `خطوة ${depth + 1}`;
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
        await onHistoryPersist().catch(() => {});
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
        await onHistoryPersist().catch(() => {});
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
          content: "تم تنفيذ هذا الإجراء مسبقاً وتخطي التكرار بنجاح.",
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
          await onHistoryPersist().catch(() => {});
        }
      } catch (err) {
        if (signal?.aborted) {
          if (card?.updateStatus) card.updateStatus("aborted");
          return { success: false, aborted: true };
        }

        console.error(`[agent-loop] Tool "${tc.name}" failed:`, err);
        anyErrorsOccurred = true;

        const currentRetries = toolRetryCounts.get(tc.name) || 0;
        const canRetry = currentRetries < maxToolRetries;
        const nextRetryNum = currentRetries + 1;
        toolRetryCounts.set(tc.name, nextRetryNum);

        // Remove from sessionExecutedTools so the model is allowed to retry with fixed args
        sessionExecutedTools.delete(sig);

        const errorMsg = err?.userMessage || err?.agentMessage || err?.message || "فشل تنفيذ الأداة.";
        if (card?.updateStatus) {
          card.updateStatus("error", {
            error: errorMsg,
            retrying: canRetry,
            retryNum: nextRetryNum,
          });
        }

        // Return error back to the model as a tool result so it can fix arguments
        const agentFeedback = canRetry
          ? `[خطأ في تنفيذ الأداة]: ${err?.agentMessage || err?.message || errorMsg}\nتوجيه للنموذج: قم بفحص المعاملات وتصحيحها وإعادة المحاولة.`
          : `[فشل نهائي في الأداة]: ${err?.agentMessage || err?.message || errorMsg}\nتوجيه للنموذج: تم استنفاد محاولات إعادة المحاولة. وضح للمستخدم ما حدث وقدم حلاً بديلاً أو اسأله عن التفاصيل الناقصة.`;

        history.push({
          role: "tool",
          toolCallId: tc.id,
          toolName: tc.name,
          input: tc.input || {},
          content: agentFeedback,
          isError: true,
        });

        if (typeof onHistoryPersist === "function") {
          await onHistoryPersist().catch(() => {});
        }
      }
    }

    if (signal?.aborted) {
      return { success: false, aborted: true };
    }

    // If every tool was a duplicate, stop the loop to avoid infinite cycling
    if (executedToolsCount === 0 && toolCallsToRun.length > 0) {
      console.warn("[agent-loop] All requested tools were duplicates. Halting agent loop.");
      return { success: true };
    }

    // Continue loop: the model will see the tool results on the next iteration
  }

  // Max depth exceeded
  return {
    success: false,
    error: "توقف الباشــمبصمج بعد عدد كبير من خطوات الأدوات المتتالية في نفس الطلب. أعد صياغة طلبك أو قسّمه إلى خطوات أصغر.",
  };
}
