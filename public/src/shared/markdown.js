/**
 * src/shared/markdown.js
 *
 * Shared Markdown + KaTeX rendering engine (ES Module).
 * Used by both quiz.html and result.html — do NOT add any
 * page-specific logic here.
 *
 * Exports:
 * renderMarkdown(str)            → HTML string
 * normalizeLiteralNewlines(str)  → string with real \n chars
 *
 * Side-effects on first import:
 * • window.copyCodeBlock is registered so inline onclick="…"
 * attributes on copy buttons can reach it across any page.
 */

// ─── 1. Utility: normalise literal \n two-char sequences ──────────────────────
// JSON round-trips or double-serialisation can leave the literal characters
// backslash + n in a string instead of a real newline.  The renderer splits
// on real newlines only, so fix this up before anything else runs.
//
// FIX 1: Use a negative lookahead (?![a-zA-Z]) so that LaTeX command names
// like \neq, \nabla, \nu etc. are NOT treated as newlines.  Only the
// two-character sequence \n that is NOT immediately followed by an ASCII
// letter is replaced with a real newline character.
export function normalizeLiteralNewlines(text) {
  if (!text || !text.includes("\\n")) return text;
  return text.replace(/\\n(?![a-zA-Z])/g, "\n");
}

// ─── 2. HTML escaping ─────────────────────────────────────────────────────────
// Internal — escapes for safe insertion into markup.
export function escHtml(s) {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─── 3. Inline Markdown formatter ─────────────────────────────────────────────
// Receives an already-escHtml-encoded string; applies spans/tags for
// bold, italic, code, links, images, and inline math ($…$).
export function applyInline(s) {
  // ── Inline math $…$ ─────────────────────────────────────────────────────
  const iMathStash = [];
  s = s.replace(/\$([^\$\n]+)\$/g, (_, m) => {
    const idx = iMathStash.length;
    // Decode HTML entities so KaTeX receives the original LaTeX source.
    const decoded = m
      .trim()
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
    if (typeof window.katex !== "undefined") {
      try {
        iMathStash.push(
          window.katex.renderToString(decoded, {
            displayMode: false,
            throwOnError: false,
          }),
        );
      } catch {
        iMathStash.push(
          `<span class="math-inline math-raw">$${escHtml(m)}$</span>`,
        );
      }
    } else {
      iMathStash.push(
        `<span class="math-inline math-raw">$${escHtml(m)}$</span>`,
      );
    }
    return `\x01IM${idx}\x01`;
  });

  // ── Inline code ─────────────────────────────────────────────────────────
  s = s.replace(/`([^`\n]+)`/g, '<code class="inline-code">$1</code>');
  // ── Bold + italic combined ───────────────────────────────────────────────
  s = s.replace(/\*\*\*([^*]+)\*\*\*/g, "<strong><em>$1</em></strong>");
  // ── Bold ────────────────────────────────────────────────────────────────
  s = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/__([^_\n]+)__/g, "<strong>$1</strong>");
  // ── Italic ──────────────────────────────────────────────────────────────
  s = s.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
  s = s.replace(/_([^_\n]+)_/g, "<em>$1</em>");
  // ── Strikethrough ───────────────────────────────────────────────────────
  s = s.replace(/~~([^~\n]+)~~/g, "<del>$1</del>");
  // ── Links ───────────────────────────────────────────────────────────────
  s = s.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer" class="md-link">$1</a>',
  );
  // ── Images ──────────────────────────────────────────────────────────────
  s = s.replace(
    /!\[([^\]]*)\]\((https?:\/\/[^\)]+)\)/g,
    '<img src="$2" alt="$1" class="md-img" loading="lazy">',
  );

  // Restore inline math placeholders
  s = s.replace(/\x01IM(\d+)\x01/g, (_, i) => iMathStash[parseInt(i)]);
  return s;
}

// ─── 4. SVG icons (inlined so the module has zero external dependencies) ──────
const ICON_COPY = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14"
  viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
  stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>
  <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
</svg>`;

const ICON_CHECK = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14"
  viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
  stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M20 6 9 17l-5-5"/>
</svg>`;

// ─── 5. Copy-button handler (global registration) ─────────────────────────────
// Buttons use inline onclick="window.copyCodeBlock(this)" so this must be
// on window.  Registering here on module import means whichever page loads
// markdown.js first gets the handler for free.
window.copyCodeBlock = (btn) => {
  const wrapper = btn.closest(".code-block-wrapper");
  if (!wrapper) return;
  const codeEl = wrapper.querySelector("code");
  if (!codeEl) return;

  navigator.clipboard
    .writeText(codeEl.innerText)
    .then(() => {
      const original = btn.innerHTML;
      btn.innerHTML = `${ICON_CHECK}`;
      btn.classList.add("copied");
      btn.setAttribute("aria-label", "Copied!");
      setTimeout(() => {
        btn.innerHTML = original;
        btn.classList.remove("copied");
        btn.setAttribute("aria-label", "Copy code");
      }, 2000);
    })
    .catch(() => {
      // Fallback: select the text so the user can Ctrl+C manually
      const range = document.createRange();
      range.selectNodeContents(codeEl);
      const sel = window.getSelection();
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(range);
      }
    });
};

// ─── 6. Syntax highlighter ────────────────────────────────────────────────────
// Zero-dependency tokeniser that emits <span class="sh-*"> tokens.
// Supports: js/ts, python, css, html/xml, bash/sh, json, sql, java, c/cpp, go,
//           rust, ruby, swift, kotlin, php, csharp, yaml, and plain text.
//
// Strategy: single-pass regex alternation on raw (un-escaped) code.
// Each branch is mutually exclusive and tried in priority order.
// The function returns HTML-escaped, span-wrapped text ready for innerHTML.

const _HL_KEYWORDS = {
  js: new Set([
    "break",
    "case",
    "catch",
    "class",
    "const",
    "continue",
    "debugger",
    "default",
    "delete",
    "do",
    "else",
    "export",
    "extends",
    "finally",
    "for",
    "function",
    "if",
    "import",
    "in",
    "instanceof",
    "let",
    "new",
    "of",
    "return",
    "static",
    "super",
    "switch",
    "throw",
    "try",
    "typeof",
    "var",
    "void",
    "while",
    "with",
    "yield",
    "async",
    "await",
    "from",
    "as",
    "null",
    "undefined",
    "true",
    "false",
    "this",
  ]),
  ts: new Set([
    "break",
    "case",
    "catch",
    "class",
    "const",
    "continue",
    "debugger",
    "default",
    "delete",
    "do",
    "else",
    "export",
    "extends",
    "finally",
    "for",
    "function",
    "if",
    "import",
    "in",
    "instanceof",
    "let",
    "new",
    "of",
    "return",
    "static",
    "super",
    "switch",
    "throw",
    "try",
    "typeof",
    "var",
    "void",
    "while",
    "with",
    "yield",
    "async",
    "await",
    "from",
    "as",
    "null",
    "undefined",
    "true",
    "false",
    "this",
    "type",
    "interface",
    "enum",
    "implements",
    "declare",
    "namespace",
    "abstract",
    "readonly",
    "keyof",
    "infer",
    "never",
    "any",
    "unknown",
    "object",
  ]),
  python: new Set([
    "False",
    "None",
    "True",
    "and",
    "as",
    "assert",
    "async",
    "await",
    "break",
    "class",
    "continue",
    "def",
    "del",
    "elif",
    "else",
    "except",
    "finally",
    "for",
    "from",
    "global",
    "if",
    "import",
    "in",
    "is",
    "lambda",
    "nonlocal",
    "not",
    "or",
    "pass",
    "raise",
    "return",
    "try",
    "while",
    "with",
    "yield",
    "self",
    "cls",
  ]),
  java: new Set([
    "abstract",
    "assert",
    "boolean",
    "break",
    "byte",
    "case",
    "catch",
    "char",
    "class",
    "const",
    "continue",
    "default",
    "do",
    "double",
    "else",
    "enum",
    "extends",
    "final",
    "finally",
    "float",
    "for",
    "goto",
    "if",
    "implements",
    "import",
    "instanceof",
    "int",
    "interface",
    "long",
    "native",
    "new",
    "null",
    "package",
    "private",
    "protected",
    "public",
    "return",
    "short",
    "static",
    "strictfp",
    "super",
    "switch",
    "synchronized",
    "this",
    "throw",
    "throws",
    "transient",
    "try",
    "void",
    "volatile",
    "while",
    "true",
    "false",
  ]),
  csharp: new Set([
    "abstract",
    "as",
    "base",
    "bool",
    "break",
    "byte",
    "case",
    "catch",
    "char",
    "checked",
    "class",
    "const",
    "continue",
    "decimal",
    "default",
    "delegate",
    "do",
    "double",
    "else",
    "enum",
    "event",
    "explicit",
    "extern",
    "false",
    "finally",
    "fixed",
    "float",
    "for",
    "foreach",
    "goto",
    "if",
    "implicit",
    "in",
    "int",
    "interface",
    "internal",
    "is",
    "lock",
    "long",
    "namespace",
    "new",
    "null",
    "object",
    "operator",
    "out",
    "override",
    "params",
    "private",
    "protected",
    "public",
    "readonly",
    "ref",
    "return",
    "sbyte",
    "sealed",
    "short",
    "sizeof",
    "stackalloc",
    "static",
    "string",
    "struct",
    "switch",
    "this",
    "throw",
    "true",
    "try",
    "typeof",
    "uint",
    "ulong",
    "unchecked",
    "unsafe",
    "ushort",
    "using",
    "virtual",
    "void",
    "volatile",
    "while",
    "add",
    "alias",
    "and",
    "ascending",
    "async",
    "await",
    "by",
    "descending",
    "dynamic",
    "equals",
    "file",
    "from",
    "get",
    "global",
    "group",
    "init",
    "into",
    "join",
    "let",
    "managed",
    "nameof",
    "nint",
    "not",
    "notnull",
    "nuint",
    "on",
    "or",
    "orderby",
    "partial",
    "record",
    "remove",
    "required",
    "scoped",
    "select",
    "set",
    "unmanaged",
    "value",
    "var",
    "when",
    "where",
    "with",
    "yield",
  ]),
  c: new Set([
    "auto",
    "break",
    "case",
    "char",
    "const",
    "continue",
    "default",
    "do",
    "double",
    "else",
    "enum",
    "extern",
    "float",
    "for",
    "goto",
    "if",
    "inline",
    "int",
    "long",
    "register",
    "restrict",
    "return",
    "short",
    "signed",
    "sizeof",
    "static",
    "struct",
    "switch",
    "typedef",
    "union",
    "unsigned",
    "void",
    "volatile",
    "while",
    "NULL",
    "true",
    "false",
  ]),
  go: new Set([
    "break",
    "case",
    "chan",
    "const",
    "continue",
    "default",
    "defer",
    "else",
    "fallthrough",
    "for",
    "func",
    "go",
    "goto",
    "if",
    "import",
    "interface",
    "map",
    "package",
    "range",
    "return",
    "select",
    "struct",
    "switch",
    "type",
    "var",
    "nil",
    "true",
    "false",
    "iota",
  ]),
  rust: new Set([
    "as",
    "async",
    "await",
    "break",
    "const",
    "continue",
    "crate",
    "dyn",
    "else",
    "enum",
    "extern",
    "false",
    "fn",
    "for",
    "if",
    "impl",
    "in",
    "let",
    "loop",
    "match",
    "mod",
    "move",
    "mut",
    "pub",
    "ref",
    "return",
    "self",
    "Self",
    "static",
    "struct",
    "super",
    "trait",
    "true",
    "type",
    "union",
    "unsafe",
    "use",
    "where",
    "while",
  ]),
  ruby: new Set([
    "BEGIN",
    "END",
    "alias",
    "and",
    "begin",
    "break",
    "case",
    "class",
    "def",
    "defined",
    "do",
    "else",
    "elsif",
    "end",
    "ensure",
    "false",
    "for",
    "if",
    "in",
    "module",
    "next",
    "nil",
    "not",
    "or",
    "redo",
    "rescue",
    "retry",
    "return",
    "self",
    "super",
    "then",
    "true",
    "undef",
    "unless",
    "until",
    "when",
    "while",
    "yield",
  ]),
  kotlin: new Set([
    "as",
    "break",
    "class",
    "continue",
    "do",
    "else",
    "false",
    "for",
    "fun",
    "if",
    "in",
    "interface",
    "is",
    "null",
    "object",
    "package",
    "return",
    "super",
    "this",
    "throw",
    "true",
    "try",
    "typealias",
    "typeof",
    "val",
    "var",
    "when",
    "while",
    "by",
    "catch",
    "constructor",
    "delegate",
    "dynamic",
    "field",
    "file",
    "finally",
    "get",
    "import",
    "init",
    "param",
    "property",
    "receiver",
    "set",
    "setparam",
    "where",
    "actual",
    "abstract",
    "annotation",
    "companion",
    "crossinline",
    "data",
    "enum",
    "expect",
    "external",
    "final",
    "infix",
    "inline",
    "inner",
    "internal",
    "lateinit",
    "noinline",
    "open",
    "operator",
    "out",
    "override",
    "private",
    "protected",
    "public",
    "reified",
    "sealed",
    "suspend",
    "tailrec",
    "vararg",
  ]),
  swift: new Set([
    "associatedtype",
    "class",
    "deinit",
    "enum",
    "extension",
    "fileprivate",
    "func",
    "import",
    "init",
    "inout",
    "internal",
    "let",
    "open",
    "operator",
    "private",
    "precedencegroup",
    "protocol",
    "public",
    "rethrows",
    "static",
    "struct",
    "subscript",
    "typealias",
    "var",
    "break",
    "case",
    "catch",
    "continue",
    "default",
    "defer",
    "do",
    "else",
    "fallthrough",
    "for",
    "guard",
    "if",
    "in",
    "repeat",
    "return",
    "throw",
    "switch",
    "where",
    "while",
    "Any",
    "as",
    "catch",
    "false",
    "is",
    "nil",
    "rethrows",
    "self",
    "Self",
    "super",
    "throw",
    "throws",
    "true",
    "try",
  ]),
  php: new Set([
    "abstract",
    "and",
    "array",
    "as",
    "break",
    "callable",
    "case",
    "catch",
    "class",
    "clone",
    "const",
    "continue",
    "declare",
    "default",
    "die",
    "do",
    "echo",
    "else",
    "elseif",
    "empty",
    "enddeclare",
    "endfor",
    "endforeach",
    "endif",
    "endswitch",
    "endwhile",
    "eval",
    "exit",
    "extends",
    "final",
    "finally",
    "fn",
    "for",
    "foreach",
    "function",
    "global",
    "goto",
    "if",
    "implements",
    "include",
    "include_once",
    "instanceof",
    "insteadof",
    "interface",
    "isset",
    "list",
    "match",
    "namespace",
    "new",
    "or",
    "print",
    "private",
    "protected",
    "public",
    "readonly",
    "require",
    "require_once",
    "return",
    "static",
    "switch",
    "throw",
    "trait",
    "try",
    "unset",
    "use",
    "var",
    "while",
    "xor",
    "yield",
    "null",
    "true",
    "false",
  ]),
  sql: new Set([
    "SELECT",
    "FROM",
    "WHERE",
    "AND",
    "OR",
    "NOT",
    "INSERT",
    "INTO",
    "VALUES",
    "UPDATE",
    "SET",
    "DELETE",
    "CREATE",
    "TABLE",
    "ALTER",
    "ADD",
    "DROP",
    "INDEX",
    "VIEW",
    "DATABASE",
    "PRIMARY",
    "KEY",
    "FOREIGN",
    "REFERENCES",
    "UNIQUE",
    "CHECK",
    "DEFAULT",
    "CONSTRAINT",
    "JOIN",
    "INNER",
    "LEFT",
    "RIGHT",
    "FULL",
    "OUTER",
    "ON",
    "GROUP",
    "BY",
    "HAVING",
    "ORDER",
    "ASC",
    "DESC",
    "LIMIT",
    "OFFSET",
    "UNION",
    "ALL",
    "DISTINCT",
    "AS",
    "IN",
    "IS",
    "NULL",
    "LIKE",
    "BETWEEN",
    "EXISTS",
    "CASE",
    "WHEN",
    "THEN",
    "ELSE",
    "END",
    "WITH",
    "OVER",
    "PARTITION",
    "FUNCTION",
    "PROCEDURE",
    "BEGIN",
    "COMMIT",
    "ROLLBACK",
    "TRANSACTION",
    "COUNT",
    "SUM",
    "AVG",
    "MIN",
    "MAX",
    "COALESCE",
    "CAST",
    "CONVERT",
    "CONCAT",
  ]),
  bash: new Set([
    "if",
    "then",
    "else",
    "elif",
    "fi",
    "for",
    "in",
    "do",
    "done",
    "while",
    "until",
    "case",
    "esac",
    "function",
    "return",
    "exit",
    "break",
    "continue",
    "export",
    "local",
    "readonly",
    "declare",
    "typeset",
    "unset",
    "source",
    "alias",
    "echo",
    "printf",
    "read",
    "test",
    "true",
    "false",
    "shift",
    "exec",
    "eval",
    "trap",
    "wait",
    "kill",
    "set",
    "unset",
  ]),
};

// Expanded Aliases (Adding complete fallback paths for C#, C++, Python, Ruby, Rust, Go)
_HL_KEYWORDS.javascript = _HL_KEYWORDS.js;
_HL_KEYWORDS.typescript = _HL_KEYWORDS.ts;
_HL_KEYWORDS.cpp = _HL_KEYWORDS.c;
_HL_KEYWORDS["c++"] = _HL_KEYWORDS.c;
_HL_KEYWORDS.cxx = _HL_KEYWORDS.c;
_HL_KEYWORDS.sh = _HL_KEYWORDS.bash;
_HL_KEYWORDS.shell = _HL_KEYWORDS.bash;
_HL_KEYWORDS.zsh = _HL_KEYWORDS.bash;
_HL_KEYWORDS.jsx = _HL_KEYWORDS.js;
_HL_KEYWORDS.tsx = _HL_KEYWORDS.ts;
_HL_KEYWORDS.cs = _HL_KEYWORDS.csharp;
_HL_KEYWORDS["c#"] = _HL_KEYWORDS.csharp;
_HL_KEYWORDS.py = _HL_KEYWORDS.python;
_HL_KEYWORDS.rb = _HL_KEYWORDS.ruby;
_HL_KEYWORDS.kt = _HL_KEYWORDS.kotlin;
_HL_KEYWORDS.rs = _HL_KEYWORDS.rust;
_HL_KEYWORDS.golang = _HL_KEYWORDS.go;

// JS/TS built-ins worth highlighting
const _HL_BUILTINS_JS = new Set([
  "console",
  "Math",
  "Object",
  "Array",
  "String",
  "Number",
  "Boolean",
  "Promise",
  "JSON",
  "Date",
  "RegExp",
  "Error",
  "Map",
  "Set",
  "WeakMap",
  "WeakSet",
  "Symbol",
  "Proxy",
  "Reflect",
  "Intl",
  "URL",
  "fetch",
  "setTimeout",
  "setInterval",
  "clearTimeout",
  "clearInterval",
  "parseInt",
  "parseFloat",
  "isNaN",
  "isFinite",
  "encodeURIComponent",
  "decodeURIComponent",
  "document",
  "window",
  "navigator",
]);

/**
 * Highlight `code` (raw, un-escaped) for the given `lang`.
 * Returns an HTML string with <span class="sh-*"> wrappers.
 * Falls back to escHtml(code) for unrecognised languages.
 */
export function highlightCode(code, lang) {
  const langKey = (lang || "").toLowerCase();

  // Languages with no keyword set get plain escaping
  const isHtmlLike =
    langKey === "html" || langKey === "xml" || langKey === "svg";
  const isCss = langKey === "css" || langKey === "scss" || langKey === "less";
  const isJson = langKey === "json";
  const keywords = _HL_KEYWORDS[langKey] || null;

  if (!isHtmlLike && !isCss && !isJson && !keywords) {
    return escHtml(code);
  }

  // ── HTML / XML highlighter ─────────────────────────────────────────────────
  if (isHtmlLike) {
    return (
      code
        .replace(/&/g, "&amp;")
        .replace(/</g, "\x01LT\x01") // temp placeholder
        // Comments
        .replace(
          /&lt;!--[\s\S]*?--&gt;/g,
          (m) => `<span class="sh-comment">${m}</span>`,
        )
        // Tags — do the real tokenising on the raw-ish string
        .replace(
          /\x01LT\x01(\/?)([A-Za-z][A-Za-z0-9\-:.]*)([\s\S]*?)(\/?)>/g,
          (_, slash, tag, attrs, selfClose) => {
            // Escape attrs
            const safeAttrs = attrs
              .replace(/>/g, "&gt;")
              .replace(
                /([A-Za-z][A-Za-z0-9\-:.]*)(\s*=\s*)("([^"]*?)"|'([^']*?)')/g,
                (__, aName, eq, val) =>
                  `<span class="sh-attr">${escHtml(aName)}</span>` +
                  escHtml(eq) +
                  `<span class="sh-string">${escHtml(val)}</span>`,
              );
            return (
              `&lt;` +
              escHtml(slash) +
              `<span class="sh-tag">${escHtml(tag)}</span>` +
              safeAttrs +
              escHtml(selfClose) +
              `&gt;`
            );
          },
        )
        .replace(/\x01LT\x01/g, "&lt;")
    ); // leftover < not part of a tag
  }

  // ── CSS highlighter ────────────────────────────────────────────────────────
  if (isCss) {
    let out = "";
    const css = code;
    let i = 0;
    const esc = (s) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    while (i < css.length) {
      // Comments /* … */
      if (css[i] === "/" && css[i + 1] === "*") {
        const end = css.indexOf("*/", i + 2);
        const chunk = end === -1 ? css.slice(i) : css.slice(i, end + 2);
        out += `<span class="sh-comment">${esc(chunk)}</span>`;
        i += chunk.length;
        continue;
      }
      // Strings
      if (css[i] === '"' || css[i] === "'") {
        const q = css[i];
        let j = i + 1;
        while (j < css.length && css[j] !== q) {
          if (css[j] === "\\") j++;
          j++;
        }
        const chunk = css.slice(i, j + 1);
        out += `<span class="sh-string">${esc(chunk)}</span>`;
        i = j + 1;
        continue;
      }
      // Numbers with optional units
      const numMatch = css
        .slice(i)
        .match(
          /^-?\d+\.?\d*(%|px|em|rem|vw|vh|vmin|vmax|pt|pc|cm|mm|in|deg|rad|turn|s|ms)?/,
        );
      if (numMatch && numMatch[0].length > 0 && /\d/.test(numMatch[0][0])) {
        out += `<span class="sh-number">${esc(numMatch[0])}</span>`;
        i += numMatch[0].length;
        continue;
      }
      // CSS variables --foo
      const varMatch = css.slice(i).match(/^--[a-zA-Z][a-zA-Z0-9\-_]*/);
      if (varMatch) {
        out += `<span class="sh-variable">${esc(varMatch[0])}</span>`;
        i += varMatch[0].length;
        continue;
      }
      // Properties / selectors / at-rules
      const propMatch = css.slice(i).match(/^@[a-zA-Z\-]+/);
      if (propMatch) {
        out += `<span class="sh-keyword">${esc(propMatch[0])}</span>`;
        i += propMatch[0].length;
        continue;
      }
      out += esc(css[i]);
      i++;
    }
    return out;
  }

  // ── JSON highlighter ───────────────────────────────────────────────────────
  if (isJson) {
    return escHtml(code).replace(
      /("(\\u[a-fA-F0-9]{4}|\\[^u]|[^"\\])*"(\s*:)?|\b(true|false|null)\b|-?\d+\.?\d*([eE][+\-]?\d+)?)/g,
      (match) => {
        if (/^"/.test(match)) {
          if (/:$/.test(match)) return `<span class="sh-attr">${match}</span>`;
          return `<span class="sh-string">${match}</span>`;
        }
        if (/true|false/.test(match))
          return `<span class="sh-keyword">${match}</span>`;
        if (/null/.test(match))
          return `<span class="sh-keyword">${match}</span>`;
        return `<span class="sh-number">${match}</span>`;
      },
    );
  }

  // ── Generic keyword-based highlighter (JS/TS/Python/Java/C/Go/Rust/…) ──────
  // We iterate char-by-char via a single combined regex to keep ordering strict.
  const kw = keywords;
  const isSql = langKey === "sql";
  const isJsLike = [
    "js",
    "ts",
    "jsx",
    "tsx",
    "javascript",
    "typescript",
  ].includes(langKey);

  // Regex alternation (order = priority):
  //  1. Line comment   //…  or  #…  or  --…
  //  2. Block comment  /* … */
  //  3. Template literal `…`       (JS/TS only)
  //  4. Double-quoted string
  //  5. Single-quoted string
  //  6. Number (int, float, hex, binary, octal)
  //  7. Word (identifier/keyword)
  //  8. Operator
  //  9. Everything else (1 char)
  const TOKEN_RE = new RegExp(
    [
      // 1. line comment
      isJsLike
        ? "(\\/\\/[^\\n]*)"
        : langKey === "py" ||
            langKey === "python" ||
            langKey === "rb" ||
            langKey === "ruby" ||
            langKey === "bash" ||
            langKey === "sh" ||
            langKey === "shell" ||
            langKey === "zsh"
          ? "(#[^\\n]*)"
          : isSql
            ? "(--[^\\n]*)"
            : "(\\/\\/[^\\n]*)",
      // 2. block comment
      "(\\/\\*[\\s\\S]*?\\*\\/)",
      // 3. template literal (JS/TS)
      isJsLike ? "(`(?:[^`\\\\]|\\\\.)*`)" : null,
      // 4. double-quoted string
      '("(?:[^"\\\\]|\\\\.)*")',
      // 5. single-quoted string
      "('(?:[^'\\\\]|\\\\.)*')",
      // 6. number (hex, binary, octal, float, int)
      "(\\b0[xX][0-9a-fA-F]+\\b|\\b0[bB][01]+\\b|\\b0[oO][0-7]+\\b|-?\\b\\d+\\.?\\d*(?:[eE][+\\-]?\\d+)?\\b)",
      // 7. identifier / keyword
      "([A-Za-z_$][A-Za-z0-9_$]*)",
      // 8. operator
      "([+\\-*/%&|^~<>!=?:]+)",
    ]
      .filter(Boolean)
      .join("|"),
    "g",
  );

  let result = "";
  let lastIndex = 0;

  for (const m of code.matchAll(TOKEN_RE)) {
    // Append any plain text gap before this match
    if (m.index > lastIndex) {
      result += escHtml(code.slice(lastIndex, m.index));
    }
    lastIndex = m.index + m[0].length;

    const tok = m[0];

    // Determine which group fired.
    // Groups differ by language (JS/TS adds a template-literal capture):
    //   JS/TS:  [lineComment, blockComment, templateLit, dqString, sqString, num, word, op]
    //   Others: [lineComment, blockComment,              dqString, sqString, num, word, op]
    // We use named indices based on whether isJsLike is true.
    const G = isJsLike
      ? {
          lineComment: 1,
          blockComment: 2,
          templateLit: 3,
          dqString: 4,
          sqString: 5,
          num: 6,
          word: 7,
          op: 8,
        }
      : {
          lineComment: 1,
          blockComment: 2,
          templateLit: -1,
          dqString: 3,
          sqString: 4,
          num: 5,
          word: 6,
          op: 7,
        };

    const lineComment = m[G.lineComment];
    const blockComment = m[G.blockComment];
    const templateLit = G.templateLit > 0 ? m[G.templateLit] : undefined;
    const dqString = m[G.dqString];
    const sqString = m[G.sqString];
    const num = m[G.num];
    const word = m[G.word];
    const op = m[G.op];

    if (lineComment || blockComment) {
      result += `<span class="sh-comment">${escHtml(tok)}</span>`;
    } else if (templateLit) {
      // Highlight interpolations ${…} inside template literals
      const inner = tok
        .slice(1, -1)
        .replace(
          /(\$\{)([\s\S]*?)(\})/g,
          (_, open, expr, close) =>
            `<span class="sh-interp">${escHtml(open)}</span>` +
            `<span class="sh-interp-body">${escHtml(expr)}</span>` +
            `<span class="sh-interp">${escHtml(close)}</span>`,
        );
      result += `<span class="sh-string">\`${inner}\`</span>`;
    } else if (dqString || sqString) {
      result += `<span class="sh-string">${escHtml(tok)}</span>`;
    } else if (num) {
      result += `<span class="sh-number">${escHtml(tok)}</span>`;
    } else if (word) {
      const check = isSql ? tok.toUpperCase() : tok;
      if (kw.has(check)) {
        result += `<span class="sh-keyword">${escHtml(tok)}</span>`;
      } else if (isJsLike && _HL_BUILTINS_JS.has(tok)) {
        result += `<span class="sh-builtin">${escHtml(tok)}</span>`;
      } else {
        // Lookahead and Lookbehind for object properties and function calls
        const after = code[lastIndex];
        const before = m.index > 0 ? code[m.index - 1] : "";

        if (after === "(") {
          result += `<span class="sh-function">${escHtml(tok)}</span>`;
        } else if (/[A-Z]/.test(tok[0]) && !isSql) {
          // PascalCase → type/class name
          result += `<span class="sh-type">${escHtml(tok)}</span>`;
        } else if (before === ".") {
          // Preceded by dot → object property
          result += `<span class="sh-property">${escHtml(tok)}</span>`;
        } else {
          result += escHtml(tok);
        }
      }
    } else if (op) {
      result += `<span class="sh-operator">${escHtml(tok)}</span>`;
    } else {
      result += escHtml(tok);
    }
  }

  // Remaining text after last match
  if (lastIndex < code.length) {
    result += escHtml(code.slice(lastIndex));
  }

  return result;
}

// ─── 7. Core renderer ─────────────────────────────────────────────────────────
export function _renderMarkdownCore(str) {
  const stash = [];
  const stashPush = (html) => {
    const idx = stash.length;
    stash.push(html);
    return `\x00ST${idx}\x00`;
  };

  // ── Step 0: Auto-wrap bare LaTeX lines ─────────────────────────────────────
  // Some quiz data embeds LaTeX commands without $ delimiters.
  // Detect lines that contain known commands but no $ or ` and wrap them.
  const BARE_LATEX_CMD_RE =
    /\\(?:frac|sqrt|sum|int|prod|lim|pm|mp|cdot|times|div|leq|geq|neq|approx|equiv|infty|partial|alpha|beta|gamma|delta|epsilon|theta|lambda|mu|nu|pi|sigma|phi|psi|omega|vec|hat|bar|tilde|dot|binom|mathbb|mathbf|mathrm|mathit)\b/;
  if (BARE_LATEX_CMD_RE.test(str)) {
    str = str.replace(/^(?![^\n]*[$`])([^\n]+)$/gm, (line) =>
      BARE_LATEX_CMD_RE.test(line) ? `$${line.trim()}$` : line,
    );
  }

  // ── Step 1: Block math $$…$$ ───────────────────────────────────────────────
  str = str.replace(/\$\$([\s\S]*?)\$\$/g, (_, m) => {
    let rendered;
    if (typeof window.katex !== "undefined") {
      try {
        rendered = window.katex.renderToString(m.trim(), {
          displayMode: true,
          throwOnError: false,
        });
      } catch {
        rendered = `<span class="math-raw">$$${escHtml(m)}$$</span>`;
      }
    } else {
      rendered = `<span class="math-raw">$$${escHtml(m)}$$</span>`;
    }
    return stashPush(`<div class="math-block">${rendered}</div>`);
  });

  // ── Step 2: Fenced code blocks ```lang\n…\n``` ─────────────────────────────
  // Wraps each block in .code-block-wrapper so the Copy button has a parent.
  str = str.replace(
    /```([a-zA-Z0-9_+#.-]*)\n?([\s\S]*?)```/g,
    (_, lang, code) => {
      const highlighted = highlightCode(code.trim(), lang);
      const langClass = lang ? ` language-${lang}` : "";

      const langLabel = lang
        ? `<span class="code-lang-label">${escHtml(lang)}</span>`
        : "";

      return stashPush(
        `<div class="code-block-wrapper">` +
          langLabel +
          `<button class="copy-code-btn"
                 onclick="window.copyCodeBlock(this)"
                 aria-label="Copy code">` +
          ICON_COPY +
          `<span class="copy-label">Copy</span>` +
          `</button>` +
          `<pre class="code-block ltr${langClass}"><code>${highlighted}</code></pre>` +
          `</div>`,
      );
    },
  );
  // ── Step 2b: GFM Tables ────────────────────────────────────────────────────
  // Must run BEFORE the line-by-line loop — str.split("\n") would destroy
  // the multi-line table structure.
  //
  // Captures:
  //   Group 1 — header row  (| … |)
  //   Group 2 — separator   (| :---: | etc.)
  //   Group 3 — body rows   (zero or more | … | lines)
  str = str.replace(
    /^(\|.+\|)\n(\|[-| :]+\|)\n((?:\|.+\|(?:\n|$))*)/gm,
    (_, headerRow, _sepRow, bodyRows) => {
      const parseRow = (row) =>
        row
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((cell) => applyInline(escHtml(cell.trim())));

      const headers = parseRow(headerRow);
      const rows = bodyRows.trim().split("\n").filter(Boolean).map(parseRow);

      const thead =
        "<thead><tr>" +
        headers.map((h) => `<th>${h}</th>`).join("") +
        "</tr></thead>";

      const tbody =
        "<tbody>" +
        rows
          .map((r) => "<tr>" + r.map((c) => `<td>${c}</td>`).join("") + "</tr>")
          .join("") +
        "</tbody>";

      return stashPush(
        `<div class="md-table-wrapper">` +
          `<table class="md-table">${thead}${tbody}</table>` +
          `</div>`,
      );
    },
  );

  // ── Step 3: Tokenize lines ─────────────────────────────────────────────────
  // Each raw line is classified into one of: stash | hr | heading | blockquote
  //   | list | blank | text
  //
  // FIX 2: List regexes now allow leading whitespace (\s*) so that indented
  // bullet/number lines are correctly detected as nested list items.
  //
  // FIX 4: Instead of emitting bare lines joined later with <br>, we collect
  // consecutive text lines into <p> segments and rely on CSS margins for
  // spacing.  Adjacent text lines (no blank between them) join into the same
  // paragraph with a space, matching GFM paragraph semantics.

  const rawLines = str.split("\n");

  // Helper: escape HTML around stash tokens that appear on the same line as
  // other text (safety measure; in practice stash tokens are always alone).
  const escapeAroundTokens = (line) => {
    const TOKEN_RE = /(\x00ST\d+\x00)/g;
    return line
      .split(TOKEN_RE)
      .map((part, i) => (i % 2 === 1 ? part : escHtml(part)))
      .join("");
  };

  // Tokenize
  const lineTokens = rawLines.map((line) => {
    // Stash placeholder — pass through verbatim (with surrounding text escaped)
    if (/\x00ST\d+\x00/.test(line)) {
      return { type: "stash", html: escapeAroundTokens(line) };
    }
    // Horizontal rule  ---  *** ___
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      return { type: "hr" };
    }
    // Headings  # … ######
    const hMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (hMatch) {
      return { type: "heading", level: hMatch[1].length, content: hMatch[2] };
    }
    // Blockquote  >
    const bqMatch = line.match(/^>\s*(.*)$/);
    if (bqMatch) {
      return { type: "blockquote", content: bqMatch[1] };
    }
    // FIX 2: Unordered list item — leading spaces captured for indent level
    const ulMatch = line.match(/^(\s*)[-*+]\s+(.+)$/);
    if (ulMatch) {
      return {
        type: "list",
        listType: "ul",
        indent: ulMatch[1].length,
        content: ulMatch[2],
      };
    }
    // FIX 2: Ordered list item — leading spaces captured for indent level
    const olMatch = line.match(/^(\s*)\d+\.\s+(.+)$/);
    if (olMatch) {
      return {
        type: "list",
        listType: "ol",
        indent: olMatch[1].length,
        content: olMatch[2],
      };
    }
    // Blank line
    if (line.trim() === "") {
      return { type: "blank" };
    }
    // Regular inline text
    return { type: "text", content: line };
  });

  // ── Step 4: Group tokens into rendering segments ───────────────────────────
  // Segments are:
  //   { type: "para",  html }        — one or more text lines → <p>
  //   { type: "list",  items }        — one or more list items (nest-aware)
  //   { type: "block", html }         — single self-contained block element

  const segments = [];
  let ti = 0;

  while (ti < lineTokens.length) {
    const tok = lineTokens[ti];

    // ── Blank lines between segments are simply dropped ──────────────────
    // Paragraph separation is achieved by the segment boundary itself
    // (each <p> or block element carries its own CSS margin).
    if (tok.type === "blank") {
      ti++;
      continue;
    }

    // ── Text lines → paragraph ───────────────────────────────────────────
    // FIX 4: Consecutive text lines form one <p> (joined with a space).
    // A blank line ends the paragraph accumulation, creating a new segment
    // for the next run of text lines.
    if (tok.type === "text") {
      const lines = [];
      while (ti < lineTokens.length && lineTokens[ti].type === "text") {
        lines.push(applyInline(escHtml(lineTokens[ti].content)));
        ti++;
      }
      segments.push({
        type: "block",
        html: `<p class="md-p">${lines.join(" ")}</p>`,
      });
      continue;
    }

    // ── List items → list segment ─────────────────────────────────────────
    // FIX 3: Blank lines between list items are absorbed as long as the
    // next non-blank token is also a list item.  This keeps a numbered list
    // with blank-line-separated entries as a single <ol> instead of
    // resetting to item 1 for every sub-group.
    if (tok.type === "list") {
      const items = [];
      while (ti < lineTokens.length) {
        if (lineTokens[ti].type === "list") {
          items.push(lineTokens[ti]);
          ti++;
        } else if (lineTokens[ti].type === "blank") {
          // Peek ahead past all consecutive blanks
          let j = ti + 1;
          while (j < lineTokens.length && lineTokens[j].type === "blank") j++;
          if (j < lineTokens.length && lineTokens[j].type === "list") {
            // There is a list item after the blanks — absorb the blanks
            ti = j;
          } else {
            // No more list items ahead — end this list segment
            break;
          }
        } else {
          // Non-blank, non-list token — end of list
          break;
        }
      }
      segments.push({ type: "list", items });
      continue;
    }

    // ── Block tokens: stash, hr, heading, blockquote ─────────────────────
    let blockHtml = "";
    if (tok.type === "stash") {
      blockHtml = tok.html;
    } else if (tok.type === "hr") {
      blockHtml = '<hr class="md-hr">';
    } else if (tok.type === "heading") {
      const lvl = tok.level;
      blockHtml = `<h${lvl} class="md-h${lvl}">${applyInline(escHtml(tok.content))}</h${lvl}>`;
    } else if (tok.type === "blockquote") {
      blockHtml = `<blockquote class="md-blockquote">${applyInline(escHtml(tok.content))}</blockquote>`;
    }
    segments.push({ type: "block", html: blockHtml });
    ti++;
  }

  // ── Step 4b: Nested list renderer ─────────────────────────────────────────
  // FIX 2: Renders a flat array of list-item tokens into properly nested
  // <ul>/<ol> elements by tracking indent levels recursively.
  //
  // Algorithm: renderLevel() claims items whose indent equals the indent of
  // the first item it sees.  Any item with a greater indent triggers a
  // recursive call (sub-list appended inside the current <li>).  Any item
  // with a smaller indent is left for the caller.  If the list-type changes
  // at the same indent level the current list is closed and a new one opens.
  function renderNestedList(items) {
    if (!items.length) return "";

    function renderLevel(startIdx, levelIndent) {
      if (startIdx >= items.length || items[startIdx].indent < levelIndent) {
        return { html: "", nextIdx: startIdx };
      }

      const firstIndent = items[startIdx].indent;
      const tag = items[startIdx].listType;
      let html = `<${tag} class="md-list">`;
      let i = startIdx;

      while (i < items.length) {
        const item = items[i];

        // Go back up — shallower item belongs to an ancestor list
        if (item.indent < firstIndent) break;

        // Same depth but different list type (ul ↔ ol) — close and restart
        if (item.indent === firstIndent && item.listType !== tag) break;

        // Deeper item without a preceding same-level item — malformed input;
        // surface it at current level as a safety fallback
        if (item.indent > firstIndent) break;

        // ── Emit <li> for this item ────────────────────────────────────
        let liContent = applyInline(escHtml(item.content));
        i++;

        // If the next item is more indented, it forms a nested sub-list
        // that is appended inside the current <li> before it is closed.
        if (i < items.length && items[i].indent > firstIndent) {
          const sub = renderLevel(i, items[i].indent);
          liContent += sub.html;
          i = sub.nextIdx;
        }

        html += `<li>${liContent}</li>`;
      }

      html += `</${tag}>`;
      return { html, nextIdx: i };
    }

    // Loop in case the top-level items alternate between ul and ol types
    let result = "";
    let i = 0;
    while (i < items.length) {
      const { html, nextIdx } = renderLevel(i, items[i].indent);
      result += html;
      if (nextIdx <= i) break; // safety guard against infinite loop
      i = nextIdx;
    }
    return result;
  }

  // ── Step 5: Assemble final HTML ────────────────────────────────────────────
  let result = "";
  for (const seg of segments) {
    if (seg.type === "list") {
      result += renderNestedList(seg.items);
    } else {
      result += seg.html;
    }
  }

  // ── Step 6: Restore stashed blocks ────────────────────────────────────────
  result = result.replace(/\x00ST(\d+)\x00/g, (_, i) => stash[parseInt(i)]);

  return result;
}

// ─── 7. Public renderMarkdown (with error boundary) ───────────────────────────
/**
 * Render a Markdown string to an HTML string.
 * Supports: KaTeX math, GFM tables, fenced code blocks with copy button,
 * headings, blockquotes, nested lists, bold/italic, links, images.
 *
 * @param {string} str — Raw Markdown input.
 * @returns {string}   — Safe HTML string ready for innerHTML.
 */
export function renderMarkdown(str) {
  if (!str) return "";
  try {
    return _renderMarkdownCore(str);
  } catch (err) {
    console.error("[markdown-handler] renderMarkdown error:", err);
    return escHtml(str).replace(/\n/g, "<br>");
  }
}
