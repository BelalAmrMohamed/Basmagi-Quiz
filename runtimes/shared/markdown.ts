// =============================================================================
// runtimes/shared/markdown.ts
// Markdown cells: marked + KaTeX math, sanitized with DOMPurify.
// =============================================================================
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import katex from 'katex';

const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));

function math(tex: string, display: boolean): string {
  try {
    return katex.renderToString(tex, { displayMode: display, throwOnError: false, strict: 'ignore' });
  } catch {
    return esc(tex);
  }
}

let hooked = false;
function ensureHook() {
  if (hooked) return;
  hooked = true;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node instanceof Element && node.tagName === 'A' && node.getAttribute('href')) {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
  });
}

/** Markdown source -> sanitized HTML. Code spans/blocks are protected from math parsing. */
export function renderMarkdown(src: string): string {
  ensureHook();
  const code: string[] = [], tex: string[] = [];
  const protectedSrc = src
    .replace(/```[\s\S]*?```|`[^`\n]+`/g, (m) => `${code.push(m) - 1}`)
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, t) => `${tex.push(math(t.trim(), true)) - 1}`)
    .replace(/\$([^$\n]+?)\$/g, (_, t) => `${tex.push(math(t.trim(), false)) - 1}`)
    .replace(/(\d+)/g, (_, i) => code[+i]);
  const html = marked.parse(protectedSrc, { async: false, gfm: true, breaks: false }) as string;
  const withMath = html.replace(/(\d+)/g, (_, i) => tex[+i]);
  const clean = DOMPurify.sanitize(withMath, { USE_PROFILES: { html: true, mathMl: true, svg: true } });
  return clean.replace(/<(p|h[1-6]|li)>/g, '<$1 dir="auto">');
}
