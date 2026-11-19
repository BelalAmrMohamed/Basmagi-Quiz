// =============================================================================
// core/undo.js
// Small pure helpers for "undo this tool call" (Phase 5). No DOM, no storage.
//
// A tool handler receives `ctx` as its second argument and may call
//   ctx.registerUndo({ label, run, isStale })
//   - label:   short Arabic text, e.g. «استعادة "امتحان 1"»
//   - run:     () => void | {ok:false, reason} | Promise<…>; performs the undo
//   - isStale: () => boolean; true when the item changed after the tool ran, so
//              an undo would overwrite newer work (the button is then disabled)
// Handlers that never call it are unaffected.
// =============================================================================

/** Stable text fingerprint of a JSON-able value (used to detect later edits). */
export function fingerprint(value) {
  return JSON.stringify(value ?? null);
}

/** True when `current` is still exactly what `fp` (see fingerprint) recorded. */
export function isUnchangedSince(current, fp) {
  return fingerprint(current) === fp;
}

/**
 * Builds the ctx passed to a handler.
 * @param {{ setUndo?: Function } | null | undefined} card
 * @param {(label: string) => void} [onUndone] called after a successful undo
 */
export function createToolContext(card, onUndone) {
  return {
    registerUndo({ label, run, isStale } = {}) {
      if (!card || typeof card.setUndo !== "function" || typeof run !== "function") return;
      const wrapped = async () => {
        const res = await run();
        if (res && res.ok === false) return res;
        if (typeof onUndone === "function") onUndone(label);
        return { ok: true };
      };
      card.setUndo(label || "تراجع", wrapped, typeof isStale === "function" ? isStale : () => false);
    },
  };
}

/** Prepends «[the user undid: …]» lines to a user message so the model knows. */
export function prependUndoNotes(content, notes) {
  if (!Array.isArray(notes) || notes.length === 0) return content;
  const lines = notes.map((n) => `[قام المستخدم بالتراجع عن: ${n}]`).join("\n");
  return `${lines}\n\n${content || ""}`;
}
