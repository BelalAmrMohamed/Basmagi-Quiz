// =============================================================================
// public/src/components/ai-agent/core/item-patch-engine.js
// Pure (DOM-free) patch engine for in-place modifications to quizzes,
// lessons, and notebooks. Mirrors and shares the exact behavior of the
// MCP server's applyDraftPatch (supabase/functions/mcp/lib.ts).
// =============================================================================

const MAX_OPS = 200;

function clone(x) {
  return JSON.parse(JSON.stringify(x));
}

function clip(str, max = 40) {
  const s = String(str || "");
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

export function replaceTextDeep(node, find, rep, count = { n: 0 }) {
  return _replaceTextDeep(node, find, rep, count);
}

function _replaceTextDeep(node, find, rep, count) {
  if (typeof node === "string") {
    const parts = node.split(find);
    count.n += parts.length - 1;
    return parts.join(rep);
  }
  if (Array.isArray(node)) {
    return node.map((x) => _replaceTextDeep(x, find, rep, count));
  }
  if (node && typeof node === "object") {
    const o = {};
    for (const k of Object.keys(node)) {
      o[k] = _replaceTextDeep(node[k], find, rep, count);
    }
    return o;
  }
  return node;
}

/**
 * Applies a patch object: { meta?, ops? } to quiz / lesson / notebook data.
 * Pure function: does not mutate `data`.
 * @param {"quiz"|"lesson"|"notebook"} kind
 * @param {object} data
 * @param {object} patch
 * @returns {{ data?: object, error?: string, applied?: string[] }}
 */
export function applyDraftPatch(kind, data, patch) {
  if (!patch || typeof patch !== "object") {
    return { error: "patch يجب أن يكون كائناً: { meta?, ops? }." };
  }
  const ops = Array.isArray(patch.ops) ? patch.ops : [];
  if (!ops.length && !patch.meta) {
    return { error: "patch فارغ — أضف meta أو ops." };
  }
  if (ops.length > MAX_OPS) {
    return { error: `عدد العمليات يتجاوز ${MAX_OPS}.` };
  }

  let d = clone(data);
  const applied = [];
  const list = kind === "quiz" ? "questions" : kind === "notebook" ? "cells" : "sections";
  const arr = () => d[list];

  if (patch.meta) {
    const allowedKeys =
      kind === "notebook"
        ? ["title", "description", "source", "runtime"]
        : ["title", "description", "source"];
    for (const k of allowedKeys) {
      if (patch.meta[k] !== undefined) {
        if (d.meta && typeof d.meta === "object") {
          d.meta[k] = patch.meta[k];
        }
        d[k] = patch.meta[k];
        applied.push(`meta.${k}`);
      }
    }
  }

  const idx = (v, len, name, allowEnd = false) => {
    const n = Number(v);
    const max = allowEnd ? len + 1 : len;
    if (!Number.isInteger(n) || n < 1 || n > max) {
      throw new Error(`${name}=${JSON.stringify(v)} خارج النطاق 1..${max}.`);
    }
    return n - 1;
  };

  const move = (a, from, to) => {
    const [x] = a.splice(from, 1);
    a.splice(to, 0, x);
  };

  const blocksOf = (s) => {
    const sec = arr()[s];
    if (!Array.isArray(sec.blocks)) {
      sec.blocks = typeof sec.content === "string" ? [{ type: "markdown", body: sec.content }] : [];
    }
    return sec.blocks;
  };

  try {
    ops.forEach((op, i) => {
      const at = `العملية ${i + 1} (${op?.op})`;
      try {
        const opKind = /_(question|questions)$/.test(op?.op)
          ? "quiz"
          : /_(cell|cells)$/.test(op?.op)
          ? "notebook"
          : /_(section|sections|block|blocks)$/.test(op?.op)
          ? "lesson"
          : "any";

        switch (opKind === "any" || opKind === kind ? op?.op : "__wrong_kind__") {
          case "replace_text": {
            if (typeof op.find !== "string" || !op.find) throw new Error("find مطلوب.");
            const c = { n: 0 };
            d = replaceTextDeep(d, op.find, String(op.replace ?? ""), c);
            if (!c.n) throw new Error(`النص «${clip(op.find, 40)}» غير موجود.`);
            applied.push(`replace_text ×${c.n}`);
            break;
          }
          // quiz
          case "set_question": {
            const k = idx(op.at, arr().length, "at");
            arr()[k] = op.question;
            applied.push(`set_question ${k + 1}`);
            break;
          }
          case "insert_question": {
            const k = idx(op.at, arr().length, "at", true);
            arr().splice(k, 0, op.question);
            applied.push(`insert_question ${k + 1}`);
            break;
          }
          case "append_questions": {
            if (!Array.isArray(op.questions)) throw new Error("questions مصفوفة مطلوبة.");
            arr().push(...op.questions);
            applied.push(`append_questions ×${op.questions.length}`);
            break;
          }
          case "delete_question": {
            const k = idx(op.at, arr().length, "at");
            arr().splice(k, 1);
            applied.push(`delete_question ${k + 1}`);
            break;
          }
          case "move_question": {
            move(arr(), idx(op.at, arr().length, "at"), idx(op.to, arr().length, "to"));
            applied.push("move_question");
            break;
          }
          // notebook cells
          case "set_cell": {
            const k = idx(op.at, arr().length, "at");
            arr()[k] = op.cell;
            applied.push(`set_cell ${k + 1}`);
            break;
          }
          case "insert_cell": {
            const k = idx(op.at, arr().length, "at", true);
            arr().splice(k, 0, op.cell);
            applied.push(`insert_cell ${k + 1}`);
            break;
          }
          case "append_cells": {
            if (!Array.isArray(op.cells)) throw new Error("cells مصفوفة مطلوبة.");
            arr().push(...op.cells);
            applied.push(`append_cells ×${op.cells.length}`);
            break;
          }
          case "delete_cell": {
            const k = idx(op.at, arr().length, "at");
            arr().splice(k, 1);
            applied.push(`delete_cell ${k + 1}`);
            break;
          }
          case "move_cell": {
            move(arr(), idx(op.at, arr().length, "at"), idx(op.to, arr().length, "to"));
            applied.push("move_cell");
            break;
          }
          // lesson sections
          case "set_section": {
            const k = idx(op.at, arr().length, "at");
            arr()[k] = op.section;
            applied.push(`set_section ${k + 1}`);
            break;
          }
          case "insert_section": {
            const k = idx(op.at, arr().length, "at", true);
            arr().splice(k, 0, op.section);
            applied.push(`insert_section ${k + 1}`);
            break;
          }
          case "append_sections": {
            if (!Array.isArray(op.sections)) throw new Error("sections مصفوفة مطلوبة.");
            arr().push(...op.sections);
            applied.push(`append_sections ×${op.sections.length}`);
            break;
          }
          case "delete_section": {
            const k = idx(op.at, arr().length, "at");
            arr().splice(k, 1);
            applied.push(`delete_section ${k + 1}`);
            break;
          }
          case "move_section": {
            move(arr(), idx(op.at, arr().length, "at"), idx(op.to, arr().length, "to"));
            applied.push("move_section");
            break;
          }
          // lesson blocks (section = 1-based section number)
          case "set_block": {
            const s = idx(op.section, arr().length, "section");
            const b = blocksOf(s);
            b[idx(op.at, b.length, "at")] = op.block;
            applied.push(`set_block ${s + 1}.${op.at}`);
            break;
          }
          case "insert_block": {
            const s = idx(op.section, arr().length, "section");
            const b = blocksOf(s);
            b.splice(idx(op.at, b.length, "at", true), 0, op.block);
            applied.push(`insert_block ${s + 1}.${op.at}`);
            break;
          }
          case "append_blocks": {
            const s = idx(op.section, arr().length, "section");
            if (!Array.isArray(op.blocks)) throw new Error("blocks مصفوفة مطلوبة.");
            blocksOf(s).push(...op.blocks);
            applied.push(`append_blocks ×${op.blocks.length} → ${s + 1}`);
            break;
          }
          case "delete_block": {
            const s = idx(op.section, arr().length, "section");
            const b = blocksOf(s);
            b.splice(idx(op.at, b.length, "at"), 1);
            applied.push(`delete_block ${s + 1}.${op.at}`);
            break;
          }
          case "move_block": {
            const s = idx(op.section, arr().length, "section");
            const b = blocksOf(s);
            move(b, idx(op.at, b.length, "at"), idx(op.to, b.length, "to"));
            applied.push(`move_block ${s + 1}`);
            break;
          }
          default:
            throw new Error(
              `عملية غير معروفة (${op?.op}). المتاح: ${
                kind === "quiz"
                  ? "set_question, insert_question, append_questions, delete_question, move_question, replace_text"
                  : kind === "notebook"
                  ? "set_cell, insert_cell, append_cells, delete_cell, move_cell, replace_text"
                  : "set_section, insert_section, append_sections, delete_section, move_section, set_block, insert_block, append_blocks, delete_block, move_block, replace_text"
              }.`
            );
        }
      } catch (e) {
        throw new Error(`${at}: ${e.message}`);
      }
    });
    return { data: d, applied };
  } catch (err) {
    return { error: err.message };
  }
}
