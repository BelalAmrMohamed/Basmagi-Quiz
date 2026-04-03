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

// ─── 6. Core renderer ─────────────────────────────────────────────────────────
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
    // Horizontal rule  ---  ***  ___
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
