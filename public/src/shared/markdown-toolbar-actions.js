// ============================================================================
// SHARED MARKDOWN / LATEX TOOLBAR ACTIONS
// ============================================================================
// Pure editor-side formatting used by both create-lesson and create-quiz.
// The global toolbar owns focus, dropdown state and selection capture; this
// module owns the actual text transformation so the two editors cannot drift.
// ============================================================================

function replaceTextareaRange(textarea, start, end, text) {
  textarea.focus();
  textarea.setSelectionRange(start, end);
  const nativeInsert = typeof document.execCommand === "function"
    ? document.execCommand("insertText", false, text)
    : false;
  if (!nativeInsert) {
    const value = textarea.value;
    textarea.value = value.slice(0, start) + text + value.slice(end);
    const cursor = start + text.length;
    textarea.setSelectionRange(cursor, cursor);
  }
}

function resizeTextarea(textarea) {
  textarea.style.height = "auto";
  const maxPx = textarea.id?.startsWith("option-text-") ? 140 : 240;
  const minPx = textarea.id?.startsWith("option-text-") ? 36 : 40;
  const next = Math.min(Math.max(textarea.scrollHeight || minPx, minPx), maxPx);
  textarea.style.height = `${next}px`;
  textarea.style.overflowY = (textarea.scrollHeight || minPx) > maxPx ? "auto" : "hidden";
}

/**
 * Applies one toolbar command to a previously captured textarea selection.
 *
 * @param {{cmd?: string|null, latex?: string|null, extra?: string|number|null, textarea?: HTMLTextAreaElement|null}} payload
 * @returns {boolean} whether an editor mutation was applied
 */
export function applyMarkdownToolbarAction({ cmd = null, latex = null, extra = null, textarea = null } = {}) {
  if (!(textarea instanceof HTMLTextAreaElement) || !document.body.contains(textarea)) return false;

  const start = textarea.selectionStart ?? 0;
  const end = textarea.selectionEnd ?? start;
  const value = textarea.value || "";
  const selected = value.slice(start, end);

  const wrap = (prefix, suffix = prefix, placeholder = "") => {
    const text = selected || placeholder;
    replaceTextareaRange(textarea, start, end, prefix + text + suffix);
    const contentStart = start + prefix.length;
    textarea.setSelectionRange(contentStart, contentStart + text.length);
  };

  const linePrefix = (prefix) => {
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    const lineEnd = end > start ? end : lineStart;
    const affected = value.slice(lineStart, lineEnd);
    const newLines = (affected || "")
      .split("\n")
      .map((line) => (line.startsWith(prefix) ? line : prefix + line))
      .join("\n");
    replaceTextareaRange(textarea, lineStart, lineEnd, newLines);
    textarea.setSelectionRange(lineStart, lineStart + newLines.length);
  };

  if (latex !== null && latex !== undefined) {
    const snippet = selected ? selected + String(latex) : String(latex);
    const inserted = `$${snippet}$`;
    replaceTextareaRange(textarea, start, end, inserted);
    const braceIndex = inserted.indexOf("{}");
    const cursor = braceIndex !== -1
      ? start + braceIndex + 1
      : start + Math.max(0, inserted.length - 1);
    textarea.setSelectionRange(cursor, cursor);
  } else {
    switch (cmd) {
      case "bold":
        wrap("**", "**", "نص غامق");
        break;
      case "italic":
        wrap("*", "*", "نص مائل");
        break;
      case "strike":
        wrap("~~", "~~", "نص مشطوب");
        break;
      case "code":
        wrap("`", "`", "كود");
        break;
      case "codeblock": {
        const text = selected || "كود";
        const inserted = `\`\`\`\n${text}\n\`\`\``;
        replaceTextareaRange(textarea, start, end, inserted);
        const contentStart = start + 4;
        textarea.setSelectionRange(contentStart, contentStart + text.length);
        break;
      }
      case "heading": {
        const level = Math.min(Math.max(Number(extra) || 3, 1), 6);
        linePrefix("#".repeat(level) + " ");
        break;
      }
      case "blockquote":
        linePrefix("> ");
        break;
      case "hr": {
        const inserted = "\n---\n";
        replaceTextareaRange(textarea, start, end, inserted);
        const cursor = start + inserted.length;
        textarea.setSelectionRange(cursor, cursor);
        break;
      }
      case "ul":
        linePrefix("- ");
        break;
      case "ol":
        linePrefix("1. ");
        break;
      case "link": {
        const text = selected || "نص الرابط";
        replaceTextareaRange(textarea, start, end, `[${text}](https://)`);
        const urlStart = start + text.length + 3;
        textarea.setSelectionRange(urlStart, urlStart + "https://".length);
        break;
      }
      case "table": {
        const table = "| العمود 1 | العمود 2 |\n| --- | --- |\n| قيمة | قيمة |";
        const needsLeadingNewline = start > 0 && value[start - 1] !== "\n";
        const inserted = (needsLeadingNewline ? "\n" : "") + table;
        replaceTextareaRange(textarea, start, end, inserted);
        const cursor = start + inserted.length;
        textarea.setSelectionRange(cursor, cursor);
        break;
      }
      case "inlinemath":
        wrap("$", "$", "math");
        break;
      case "blockmath":
        wrap("$$", "$$", "math");
        break;
      case "highlight": {
        const text = selected || "نص مظلل";
        const color = typeof extra === "string" ? extra : "";
        const suffix = color ? `(${color})` : "";
        replaceTextareaRange(textarea, start, end, `==${text}==${suffix}`);
        const contentStart = start + 2;
        textarea.setSelectionRange(contentStart, contentStart + text.length);
        break;
      }
      default:
        return false;
    }
  }

  resizeTextarea(textarea);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  textarea.focus({ preventScroll: true });
  return true;
}

export { replaceTextareaRange };
