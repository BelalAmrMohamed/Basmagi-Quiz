/**
 * src/shared/markdown.js
 *
 * Shared Markdown + KaTeX rendering engine (ES Module).
 * Used by both quiz.html and result.html — do NOT add any
 * page-specific logic here.
 *
 * Exports:
 *   renderMarkdown(str)            → HTML string
 *   normalizeLiteralNewlines(str)  → string with real \n chars
 *
 * Side-effects on first import:
 *   • window.copyCodeBlock is registered so inline onclick="…"
 *     attributes on copy buttons can reach it across any page.
 */

// ─── 1. Utility: normalise literal \n two-char sequences ──────────────────────
// JSON round-trips or double-serialisation can leave the literal characters
// backslash + n in a string instead of a real newline.  The renderer splits
// on real newlines only, so fix this up before anything else runs.
export function normalizeLiteralNewlines(text) {
  if (!text || !text.includes("\\n")) return text;
  return text.replace(/\\n/g, "\n");
}

// ─── 2. HTML escaping ─────────────────────────────────────────────────────────
// Internal — escapes for safe insertion into markup.
function escHtml(s) {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─── 3. Inline Markdown formatter ─────────────────────────────────────────────
// Receives an already-escHtml-encoded string; applies spans/tags for
// bold, italic, code, links, images, and inline math ($…$).
function applyInline(s) {
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

// ─── 6. Core renderer ─────────────────────────────────────────────────────────
function _renderMarkdownCore(str) {
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
  str = str.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const safe = escHtml(code.trim());
    const langClass = lang ? ` language-${lang}` : "";
    const langLabel = lang
      ? `<span class="code-lang-label">${escHtml(lang)}</span>`
      : "";
    return stashPush(
      `<div class="code-block-wrapper">` +
        langLabel +
        `<button class="copy-code-btn" onclick="window.copyCodeBlock(this)" aria-label="Copy code">` +
        ICON_COPY +
        `<span class="copy-label">Copy</span>` +
        `</button>` +
        `<pre class="code-block ltr${langClass}"><code>${safe}</code></pre>` +
        `</div>`,
    );
  });

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

  // ── Step 3: Line-by-line block elements ────────────────────────────────────
  const rawLines = str.split("\n");
  const outParts = [];
  let listBuf = [];
  let listTag = null;

  const flushList = () => {
    if (listBuf.length) {
      outParts.push(
        `<${listTag} class="md-list">${listBuf.join("")}</${listTag}>`,
      );
      listBuf = [];
      listTag = null;
    }
  };

  const escapeAroundTokens = (line) => {
    const TOKEN_RE = /(\x00ST\d+\x00)/g;
    return line
      .split(TOKEN_RE)
      .map((part, i) => (i % 2 === 1 ? part : escHtml(part)))
      .join("");
  };

  for (const rawLine of rawLines) {
    if (/\x00ST\d+\x00/.test(rawLine)) {
      flushList();
      outParts.push(escapeAroundTokens(rawLine));
      continue;
    }

    // Horizontal rule  ---  ***  ___
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(rawLine)) {
      flushList();
      outParts.push('<hr class="md-hr">');
      continue;
    }

    // Headings  # … ######
    const hMatch = rawLine.match(/^(#{1,6})\s+(.+)$/);
    if (hMatch) {
      flushList();
      const lvl = hMatch[1].length;
      outParts.push(
        `<h${lvl} class="md-h${lvl}">${applyInline(escHtml(hMatch[2]))}</h${lvl}>`,
      );
      continue;
    }

    // Blockquote  >
    const bqMatch = rawLine.match(/^>\s*(.*)$/);
    if (bqMatch) {
      flushList();
      outParts.push(
        `<blockquote class="md-blockquote">${applyInline(escHtml(bqMatch[1]))}</blockquote>`,
      );
      continue;
    }

    // Unordered list  - / * / +
    const ulMatch = rawLine.match(/^[-*+]\s+(.+)$/);
    if (ulMatch) {
      if (listTag === "ol") flushList();
      listTag = "ul";
      listBuf.push(`<li>${applyInline(escHtml(ulMatch[1]))}</li>`);
      continue;
    }

    // Ordered list  1.
    const olMatch = rawLine.match(/^\d+\.\s+(.+)$/);
    if (olMatch) {
      if (listTag === "ul") flushList();
      listTag = "ol";
      listBuf.push(`<li>${applyInline(escHtml(olMatch[1]))}</li>`);
      continue;
    }

    // Empty line → paragraph break
    if (rawLine.trim() === "") {
      flushList();
      outParts.push("<br>");
      continue;
    }

    // Regular text line
    flushList();
    outParts.push(applyInline(escHtml(rawLine)));
  }

  flushList();

  // ── Step 4: Join lines — insert <br> only between inline segments ──────────
  const BLOCK_START = /^<(h[1-6]|ul|ol|blockquote|hr|div|pre|p)[\s>\/]/;
  const BLOCK_END = /^<\/(h[1-6]|ul|ol|blockquote|div|pre|p)>/;
  const isBlock = (s) =>
    s === undefined ||
    s === "" ||
    s === "<br>" ||
    BLOCK_START.test(s) ||
    BLOCK_END.test(s);

  let result = "";
  for (let i = 0; i < outParts.length; i++) {
    result += outParts[i];
    if (!isBlock(outParts[i]) && !isBlock(outParts[i + 1])) {
      result += "<br>";
    }
  }

  // ── Step 5: Restore stashed blocks ────────────────────────────────────────
  result = result.replace(/\x00ST(\d+)\x00/g, (_, i) => stash[parseInt(i)]);

  return result;
}

// ─── 7. Public renderMarkdown (with error boundary) ───────────────────────────
/**
 * Render a Markdown string to an HTML string.
 * Supports: KaTeX math, GFM tables, fenced code blocks with copy button,
 * headings, blockquotes, lists, bold/italic, links, images.
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
