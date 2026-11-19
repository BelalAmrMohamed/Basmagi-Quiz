// =============================================================================
// core/context-trim.js
// Pure helper that shrinks the WIRE copy of the conversation sent on every agent
// step. The persisted `history` is never modified (callers pass wire messages).
//
// Rules (see docs/plans/ai-agent-improvements-plan.md, Phase 4):
//  - "Current turn" = the last non-tool user message and everything after it.
//    It is never trimmed.
//  - Older tool results over TOOL_RESULT_LIMIT chars become their first
//    TOOL_RESULT_KEEP chars + "…[trimmed N chars]". The message, its toolCallId
//    and its position stay, so call/reply pairing is intact.
//  - File attachments (base64) are kept only for the last KEEP_ATTACHMENT_TURNS
//    user turns; earlier ones become a text marker.
//  - Size guard: if the estimated request is still over MAX_WIRE_BYTES, drop the
//    oldest remaining (older-than-current) attachments first.
//  - Stage 2 (opt-in, `trimOldToolInputs`): heavy `input` payloads of older
//    assistant toolCalls are replaced by a short summary. id / name /
//    thoughtSignature are never touched.
//  - Never drops a message and never touches history[0]'s content.
// =============================================================================

export const TOOL_RESULT_LIMIT = 600;
export const TOOL_RESULT_KEEP = 300;
export const KEEP_ATTACHMENT_TURNS = 2;
export const MAX_WIRE_BYTES = 3.5 * 1024 * 1024;

export const HEAVY_INPUT_TOOLS = new Set([
  "create_quiz", "create_lesson", "create_notebook", "edit_item", "edit_quiz", "create_flashcards",
]);

/** Approximate JSON size of the messages (base64 counted at its string length). */
export function estimateWireBytes(messages) {
  let total = 0;
  for (const m of messages || []) {
    if (typeof m?.content === "string") total += m.content.length;
    else if (m?.content != null) total += JSON.stringify(m.content).length;
    for (const a of m?.attachments || []) total += (a.base64?.length || 0) + (a.name?.length || 0) + 40;
    if (m?.toolCalls) total += JSON.stringify(m.toolCalls).length;
    total += 40; // envelope
  }
  return total;
}

function lastUserIndex(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") return i;
  }
  return -1;
}

function attachmentMarker(atts) {
  return atts.map((a) => `[attachment: ${a.name || "file"}]`).join(" ");
}

function stripAttachments(m) {
  const { attachments, ...rest } = m;
  const marker = attachmentMarker(attachments);
  const content = [typeof m.content === "string" ? m.content : "", marker].filter(Boolean).join("\n");
  return { ...rest, content };
}

/** Short stand-in for a heavy tool input: identifying scalars + array counts. */
export function summarizeToolInput(input) {
  if (!input || typeof input !== "object") return input;
  const out = {};
  for (const [k, v] of Object.entries(input)) {
    if (Array.isArray(v)) out[`${k}_count`] = v.length;
    else if (typeof v === "string") out[k] = v.length > 80 ? `${v.slice(0, 80)}…` : v;
    else if (typeof v === "number" || typeof v === "boolean") out[k] = v;
    else if (v && typeof v === "object") out[`${k}_trimmed`] = true;
  }
  out._trimmed = true;
  return out;
}

/**
 * @param {object[]} messages wire messages (not mutated)
 * @param {{trimOldToolInputs?: boolean, maxBytes?: number, debug?: boolean}} [opts]
 * @returns {object[]} a new array (unchanged messages are reused by reference)
 */
export function trimContext(messages, opts = {}) {
  if (!Array.isArray(messages) || messages.length === 0) return messages;
  const { trimOldToolInputs = false, maxBytes = MAX_WIRE_BYTES } = opts;
  const before = opts.debug ? estimateWireBytes(messages) : 0;
  const curIdx = lastUserIndex(messages);
  if (curIdx <= 0) return messages; // single turn: nothing is "older"

  // User turns, newest first; the last KEEP_ATTACHMENT_TURNS keep their base64.
  const userIdxs = [];
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i]?.role === "user") userIdxs.push(i);
  const keepAttach = new Set(userIdxs.slice(0, KEEP_ATTACHMENT_TURNS));

  let out = messages.map((m, i) => {
    if (i >= curIdx || !m) return m;
    let next = m;
    if (m.role === "tool" && typeof m.content === "string" && m.content.length > TOOL_RESULT_LIMIT) {
      next = { ...m, content: `${m.content.slice(0, TOOL_RESULT_KEEP)}…[trimmed ${m.content.length - TOOL_RESULT_KEEP} chars]` };
    } else if (m.role === "user" && m.attachments?.length && !keepAttach.has(i)) {
      next = stripAttachments(m);
    } else if (trimOldToolInputs && m.role === "assistant" && Array.isArray(m.toolCalls)) {
      next = {
        ...m,
        toolCalls: m.toolCalls.map((tc) => (HEAVY_INPUT_TOOLS.has(tc.name) && !tc.input?._trimmed ? { ...tc, input: summarizeToolInput(tc.input) } : tc)),
      };
    }
    return next;
  });

  // Size guard: oldest attachments first, never the current turn.
  if (estimateWireBytes(out) > maxBytes) {
    for (let i = 0; i < curIdx && estimateWireBytes(out) > maxBytes; i++) {
      if (out[i]?.role === "user" && out[i].attachments?.length) out[i] = stripAttachments(out[i]);
    }
  }

  if (opts.debug) console.debug(`[context-trim] wire bytes ${before} -> ${estimateWireBytes(out)}`);
  return out;
}
