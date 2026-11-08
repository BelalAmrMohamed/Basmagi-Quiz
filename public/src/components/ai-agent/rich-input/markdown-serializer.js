// =============================================================================
// rich-input/markdown-serializer.js
// ProseMirror JSON -> Markdown. Direct port of the 21st.dev component's
// serializer (same output), kept framework-free.
// =============================================================================

function wrap(text, open, close = open) {
  const m = text.match(/^(\s*)([\s\S]*?)(\s*)$/);
  if (!m || !m[2]) return text;
  return `${m[1]}${open}${m[2]}${close}${m[3]}`;
}

function serializeInline(nodes = []) {
  return nodes
    .map((n) => {
      if (n.type === "hardBreak") return "  \n";
      let t = n.text ?? "";
      const marks = (n.marks ?? []).map((m) => m.type);
      if (marks.includes("code")) t = wrap(t, "`");
      if (marks.includes("bold")) t = wrap(t, "**");
      if (marks.includes("italic")) t = wrap(t, "*");
      if (marks.includes("strike")) t = wrap(t, "~~");
      if (marks.includes("underline")) t = wrap(t, "<u>", "</u>");
      return t;
    })
    .join("");
}

function indentLines(text, prefix, firstPrefix = prefix) {
  return text
    .split("\n")
    .map((l, i) => (i === 0 ? firstPrefix : l ? prefix : "") + l)
    .join("\n");
}

function serializeBlock(node) {
  const children = node.content ?? [];
  switch (node.type) {
    case "paragraph":
      return serializeInline(children);
    case "heading":
      return `${"#".repeat(node.attrs?.level ?? 1)} ${serializeInline(children)}`;
    case "bulletList":
      return children
        .map((li) => indentLines(serializeBlocks(li.content ?? [], "\n"), "  ", "- "))
        .join("\n");
    case "orderedList": {
      const start = node.attrs?.start ?? 1;
      return children
        .map((li, i) => {
          const marker = `${start + i}. `;
          return indentLines(serializeBlocks(li.content ?? [], "\n"), " ".repeat(marker.length), marker);
        })
        .join("\n");
    }
    case "blockquote":
      return indentLines(serializeBlocks(children), "> ");
    case "codeBlock": {
      const code = children.map((c) => c.text ?? "").join("");
      const lang = node.attrs?.language && node.attrs.language !== "plaintext" ? node.attrs.language : "";
      return "```" + lang + "\n" + code + "\n```";
    }
    case "horizontalRule":
      return "---";
    default:
      return serializeInline(children);
  }
}

function serializeBlocks(nodes, sep = "\n\n") {
  return nodes.map(serializeBlock).join(sep);
}

/** @param {object} doc ProseMirror JSON document (editor.getJSON()) */
export function toMarkdown(doc) {
  return serializeBlocks(doc.content ?? []).trim();
}
