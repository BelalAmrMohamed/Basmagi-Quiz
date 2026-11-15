// =============================================================================
// rich-input/markdown-parser.js
// Markdown -> ProseMirror JSON: the inverse of markdown-serializer.js. Used to
// restore a saved answer into the rich input with its formatting. Understands
// exactly what the serializer emits (paragraphs, # headings, bullet / ordered
// lists, > quotes, ``` code blocks, ---, **bold** *italic* ~~strike~~ <u> `code`);
// anything else degrades to plain text, so legacy plain-text answers load fine.
// Every newline inside a paragraph becomes a hard break (a textarea answer
// typed with single line breaks keeps them).
// =============================================================================

const INLINE = /(`+)([\s\S]*?[^`])\1(?!`)|\*\*\*([\s\S]+?)\*\*\*|\*\*([\s\S]+?)\*\*|~~([\s\S]+?)~~|<u>([\s\S]+?)<\/u>|\*([^\s*](?:[\s\S]*?[^\s*])?)\*(?!\*)/;

function inline(text, marks = []) {
  const out = [];
  const push = (t, m) => { if (t) out.push({ type: "text", text: t, ...(m.length ? { marks: m.map((type) => ({ type })) } : {}) }); };
  let rest = text;
  while (rest) {
    const m = INLINE.exec(rest);
    if (!m) { push(rest, marks); break; }
    push(rest.slice(0, m.index), marks);
    if (m[2] !== undefined) push(m[2], [...marks, "code"]);
    else if (m[3] !== undefined) out.push(...inline(m[3], [...marks, "bold", "italic"]));
    else if (m[4] !== undefined) out.push(...inline(m[4], [...marks, "bold"]));
    else if (m[5] !== undefined) out.push(...inline(m[5], [...marks, "strike"]));
    else if (m[6] !== undefined) out.push(...inline(m[6], [...marks, "underline"]));
    else out.push(...inline(m[7], [...marks, "italic"]));
    rest = rest.slice(m.index + m[0].length);
  }
  return out;
}

function paragraph(lines) {
  const content = [];
  lines.forEach((line, i) => {
    if (i) content.push({ type: "hardBreak" });
    content.push(...inline(line.replace(/ {2,}$/, "")));
  });
  return content.length ? { type: "paragraph", content } : { type: "paragraph" };
}

const FENCE = /^\s*```([\w+#.-]*)\s*$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const ITEM = /^(\s*)([-*+]|\d+\.)\s+(.*)$/;
const startsBlock = (l) => FENCE.test(l) || HEADING.test(l) || ITEM.test(l) || /^\s*>/.test(l) || /^\s*---+\s*$/.test(l);

function blocks(lines) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    let m;
    if ((m = FENCE.exec(line))) {
      const body = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) body.push(lines[i++]);
      i++;
      const text = body.join("\n");
      out.push({ type: "codeBlock", attrs: { language: m[1] || null }, ...(text ? { content: [{ type: "text", text }] } : {}) });
    } else if ((m = HEADING.exec(line))) {
      out.push({ type: "heading", attrs: { level: m[1].length }, content: inline(m[2]) });
      i++;
    } else if (/^\s*---+\s*$/.test(line)) {
      out.push({ type: "horizontalRule" });
      i++;
    } else if (/^\s*>/.test(line)) {
      const q = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*> ?/, ""));
      out.push({ type: "blockquote", content: blocks(q) });
    } else if ((m = ITEM.exec(line))) {
      const ordered = /\d/.test(m[2]);
      const baseIndent = m[1].length;
      const items = [];
      while (i < lines.length) {
        const im = ITEM.exec(lines[i]);
        if (!im || im[1].length !== baseIndent || /\d/.test(im[2]) !== ordered) break;
        const width = im[1].length + im[2].length + 1;
        const body = [im[3]];
        i++;
        while (i < lines.length && lines[i].trim() && !(ITEM.exec(lines[i]) && ITEM.exec(lines[i])[1].length <= baseIndent)) {
          body.push(lines[i].slice(Math.min(width, lines[i].length - lines[i].trimStart().length)));
          i++;
        }
        items.push({ type: "listItem", content: blocks(body) });
      }
      out.push(ordered
        ? { type: "orderedList", attrs: { start: parseInt(m[2], 10) || 1 }, content: items }
        : { type: "bulletList", content: items });
    } else {
      const p = [];
      while (i < lines.length && lines[i].trim() && (p.length === 0 || !startsBlock(lines[i]))) p.push(lines[i++]);
      out.push(paragraph(p));
    }
  }
  return out;
}

/** @param {string} markdown @returns {object} ProseMirror JSON doc */
export function parseMarkdown(markdown) {
  const content = blocks(String(markdown ?? "").replace(/\r\n?/g, "\n").split("\n"));
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}
