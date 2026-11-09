// =============================================================================
// public/src/features/notebook/notebook-agent-tools.js
// Pure (DOM-free) part of the notebook AI agent: the context text sent every turn and the
// client-side tool dispatcher. Every change is validated with the shared content rules and
// applied through the runtime handle (getCells / setCells / describe / runCellAt).
// =============================================================================
import { checkNotebook, normalizeChallenge } from "../../shared/content-rules.js";

export const NOTEBOOK_AGENT_TOOLS = ["notebook_add_cell", "notebook_edit_cell", "notebook_delete_cell", "notebook_run_cell"];

const SOURCE_CAP = 1500;
const CONTEXT_CAP = 14000;
const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}\n…[truncated ${s.length - n} chars]` : s);
const fail = (message) => Object.assign(new Error(message), { userMessage: message });

/** Text sent with every turn: what the notebook currently contains. */
export function buildNotebookContext({ title, runtime, language, cells }) {
  const head = `Current notebook: "${title}" · runtime: ${runtime === "cpp" ? "C++17 (online compiler)" : "MATLAB-style (browser subset)"} · language: ${language}\nCells are numbered from 1; use these numbers in tool calls. ${cells.length} cells:`;
  let used = head.length;
  const blocks = [];
  for (const c of cells) {
    const lines = [`--- Cell ${c.n} [${c.type}${c.challenge ? " · CHALLENGE" : ""}] ---`, clip(c.source, SOURCE_CAP)];
    if (c.challenge) lines.push(`Challenge: expected output (${c.challenge.matchMode}):\n${clip(c.challenge.expectedOutput, 400)}\nStatus: ${c.challenge.status}`);
    if (c.output) lines.push(`Latest output${c.failed ? " (HAS ERRORS)" : ""}:\n${clip(c.output, 600)}`);
    else if (c.type === "code") lines.push("(not run yet)");
    const block = lines.join("\n");
    if (used + block.length > CONTEXT_CAP) { blocks.push(`… ${cells.length - blocks.length} more cells omitted (context limit)`); break; }
    used += block.length; blocks.push(block);
  }
  return `${head}\n${blocks.join("\n")}`;
}

function validateCells(runtime, cells) {
  const check = checkNotebook({ title: "x", runtime, cells });
  if (check.errors.length) throw fail(check.errors.slice(0, 3).map((e) => e.message).join(" "));
}

function cellNumber(value, count) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > count) throw fail(`رقم الخلية غير صالح: ${value}. المتاح من 1 إلى ${count}.`);
  return n;
}

const plain = (c) => ({ type: c.type, source: c.source, ...(typeof c.stdin === "string" ? { stdin: c.stdin } : {}), ...(c.challenge ? { challenge: c.challenge } : {}) });

/**
 * Tool dispatcher. `handle` is the runtime handle (getCells/setCells/describe/runCellAt).
 * Pure with respect to the DOM so it can be unit-tested with a fake handle.
 */
export async function runNotebookTool(toolCall, { handle, runtime }) {
  if (!handle) throw fail("الدفتر غير جاهز بعد.");
  const input = toolCall?.input || {};
  const cells = handle.getCells().map(plain);
  switch (toolCall?.name) {
    case "notebook_add_cell": {
      const type = input.type === "code" ? "code" : "markdown";
      const cell = { type, source: String(input.source ?? "") };
      if (input.challenge !== undefined && input.challenge !== null) {
        if (type !== "code") throw fail("التحدي مسموح لخلايا الكود فقط.");
        cell.challenge = normalizeChallenge(input.challenge, runtime);
      }
      const at = input.position === undefined || input.position === null ? cells.length : cellNumber(input.position, cells.length + 1) - 1;
      cells.splice(at, 0, cell);
      validateCells(runtime, cells);
      handle.setCells(cells);
      return `✅ أُضيفت خلية ${type === "code" ? "كود" : "نص"}${cell.challenge ? " (تحدي)" : ""} برقم ${at + 1}.`;
    }
    case "notebook_edit_cell": {
      const n = cellNumber(input.cell, cells.length);
      const cell = { ...cells[n - 1] };
      if (input.source !== undefined) cell.source = String(input.source);
      if (input.removeChallenge) delete cell.challenge;
      else if (input.challenge !== undefined && input.challenge !== null) {
        if (cell.type !== "code") throw fail("التحدي مسموح لخلايا الكود فقط.");
        cell.challenge = normalizeChallenge(input.challenge, runtime);
      }
      cells[n - 1] = cell;
      validateCells(runtime, cells);
      handle.setCells(cells);
      return `✅ عُدّلت الخلية ${n}.`;
    }
    case "notebook_delete_cell": {
      const n = cellNumber(input.cell, cells.length);
      if (cells.length === 1) throw fail("لا يمكن حذف الخلية الوحيدة في الدفتر.");
      cells.splice(n - 1, 1);
      handle.setCells(cells);
      return `✅ حُذفت الخلية ${n}.`;
    }
    case "notebook_run_cell": {
      const n = cellNumber(input.cell, cells.length);
      const r = await handle.runCellAt(n);
      if (!r) throw fail(`الخلية ${n} ليست خلية كود.`);
      const status = r.challenge ? `\nحالة التحدي: ${r.challenge.status}` : "";
      return `▶ شُغّلت الخلية ${n}${r.failed ? " (فيها أخطاء)" : ""}.${status}\nالناتج:\n${r.output || "(لا يوجد ناتج)"}`;
    }
    default:
      throw fail(`أداة غير معروفة: ${toolCall?.name}`);
  }
}

