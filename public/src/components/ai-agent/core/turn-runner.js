// =============================================================================
// core/turn-runner.js
// Runs ONE user turn end to end: resolves context and auth, drives the agent
// loop, executes tool calls (with undo support) and reports everything back
// through callbacks. It has NO DOM access, so ai-agent-chat.js only supplies
// the UI pieces (see `ui` below) and this file can be tested in plain Node.
//
// Extracted from resendLastUserTurn() in ai-agent-chat.js with no behaviour
// change (Phase 6a of docs/plans/ai-agent-improvements-plan.md).
// =============================================================================

import { runAgentLoop, newTurnId } from "./agent-loop.js";
import { createToolContext } from "./undo.js";

export const ATTACHMENT_TOOLS = ["fetch_attached_quiz", "fetch_attached_lesson"];

/**
 * @param {object} deps
 * @param {object[]} deps.history  live conversation (mutated by the loop)
 * @param {AbortSignal} deps.signal
 * @param {Set<string>} deps.sessionExecutedTools
 * @param {string[]} deps.pendingUndoNotes  labels of undone changes; pushed to by undo
 * @param {object} deps.settings
 * @param {string} deps.settings.provider
 * @param {string} [deps.settings.model]
 * @param {string} [deps.settings.effort]
 * @param {string} [deps.settings.ownKey]
 * @param {boolean} deps.settings.hasOwnKey
 * @param {string} deps.settings.systemPrompt
 * @param {boolean} [deps.settings.enableTools]
 * @param {string[]} [deps.settings.toolNames]
 * @param {string|Function|null} [deps.settings.contextPrompt]
 * @param {object[]|Function|null} [deps.settings.contextSummary]
 * @param {object} deps.auth  { isAdminAuthenticated, getAdminToken, isJwtExpired, getUserToken }
 * @param {(url: string) => string} deps.apiUrl
 * @param {(m: object) => object} deps.serializeWireMessage
 * @param {Function} [deps.onToolCall]
 * @param {() => Function|null} [deps.getAttachmentToolHandler]
 * @param {(text: string) => (HTMLElement|null)} deps.renderResultCard
 * @param {(text: string) => (HTMLElement|null)} deps.renderCreatorCard
 * @param {() => Promise<void>} deps.persist  saves the conversation
 * @param {object} deps.ui  DOM-side callbacks:
 *   onThinking(thinking), onAssistantMessage(text, thinking), setStep({label,kind,step}),
 *   resetToolGroup(), addToolCard(tc) -> card, flushResultCards(cards), showError(msg), finish()
 */
export async function runTurn(deps) {
  const {
    history, signal, sessionExecutedTools, pendingUndoNotes, settings, auth, apiUrl, serializeWireMessage,
    onToolCall, getAttachmentToolHandler, renderResultCard, renderCreatorCard, persist, ui,
  } = deps;

  // One id per user message: the server charges the daily quota once per turnId
  // (every model round-trip of this message reuses it, so extra steps are free).
  const turnId = newTurnId();
  // Tool cards of this turn by call id, so a handler's registerUndo() can reach its card.
  const cardsByCallId = new Map();
  // Result cards produced by this turn's tools; flushed below the response in `finally`.
  const pendingResultCards = [];

  const hasOwnKey = !!settings.hasOwnKey;

  const resolvedContextPrompt =
    typeof settings.contextPrompt === "function" ? settings.contextPrompt() : settings.contextPrompt;
  const resolvedContextSummary =
    typeof settings.contextSummary === "function" ? settings.contextSummary() : settings.contextSummary;
  const summaryText =
    Array.isArray(resolvedContextSummary) && resolvedContextSummary.length
      ? `امتحانات المستخدم الحالية:\n${resolvedContextSummary
        .map((q) => `- ${q.title} (${q.questionCount} سؤال، ${q.types || "غير محدد"})`)
        .join("\n")}`
      : "";
  const combinedContext = [resolvedContextPrompt, summaryText].filter(Boolean).join("\n\n");

  try {
    let authToken = null;
    if (!hasOwnKey) {
      const adminToken = auth.isAdminAuthenticated() ? auth.getAdminToken() : null;
      const adminUsable = !!adminToken && !auth.isJwtExpired(adminToken);
      authToken = adminUsable ? adminToken : await auth.getUserToken();
    }
    const useOwnKeyNow = hasOwnKey && !authToken;

    const loopResult = await runAgentLoop({
      history,
      systemPrompt: settings.systemPrompt,
      provider: settings.provider,
      model: settings.model,
      effort: settings.effort || undefined,
      useOwnKey: useOwnKeyNow,
      ownKey: useOwnKeyNow ? settings.ownKey : undefined,
      authToken,
      enableTools: settings.enableTools,
      toolNames: settings.toolNames || undefined,
      turnId,
      signal,
      apiUrl,
      toWireMessage: (m) => {
        const wire = serializeWireMessage(m);
        if (m === history[0] && combinedContext && wire.role === "user") {
          wire.content = [combinedContext, wire.content].filter(Boolean).join("\n\n");
        }
        return wire;
      },
      sessionExecutedTools,
      onThinking: (thinking) => ui.onThinking(thinking),
      onAssistantMessage: (text, thinking) => ui.onAssistantMessage(text, thinking),
      onAssistantStream: ui.onAssistantStream,
      onStepChange: (info) => {
        // A new thinking phase = new agent step: reset group so next batch gets its own wrapper.
        if (info?.kind === "thinking") ui.resetToolGroup();
        ui.setStep(info);
      },
      onToolCallStart: (tc) => {
        const card = ui.addToolCard(tc);
        if (tc.id) cardsByCallId.set(tc.id, card);
        return card;
      },
      executeToolCall: async (toolCall) => {
        const attachmentHandler = getAttachmentToolHandler ? getAttachmentToolHandler() : null;
        const handler = ATTACHMENT_TOOLS.includes(toolCall?.name) && attachmentHandler ? attachmentHandler : onToolCall;
        if (typeof handler !== "function") {
          throw new Error(`لا يوجد معالج متاح للأداة: ${toolCall?.name}`);
        }
        // Second argument: handlers may call ctx.registerUndo(...) (see core/undo.js).
        const ctx = createToolContext(cardsByCallId.get(toolCall?.id), (label) => pendingUndoNotes.push(label));
        const resultText = await handler(toolCall, ctx);
        if (resultText) {
          const resultCard = renderResultCard(resultText);
          const creatorCard = resultCard ? null : renderCreatorCard(resultText);
          if (resultCard || creatorCard) {
            pendingResultCards.push(resultCard || creatorCard);
          }
        }
        return resultText;
      },
      onHistoryPersist: async () => {
        try {
          await persist();
        } catch (histErr) {
          console.error("[ai-agent-chat] failed to save conversation:", histErr);
        }
      },
    });

    if (loopResult?.error) {
      ui.showError(loopResult.error);
    }
    return loopResult;
  } catch (err) {
    if (err?.name === "AbortError" || signal?.aborted) {
      return { success: false, aborted: true };
    }
    console.error("[ai-agent-chat] request failed:", err);
    ui.showError("تعذر الاتصال بالخادم. حاول مرة أخرى.");
    return { success: false, error: "request failed" };
  } finally {
    // Cards go at the very bottom of this response (after the final text),
    // also when the turn errored or was stopped after items were created.
    ui.flushResultCards(pendingResultCards);
    ui.finish();
  }
}
