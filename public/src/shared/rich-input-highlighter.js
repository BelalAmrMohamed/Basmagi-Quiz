// rich-input-highlighter.js
import { detectLang, escHtml, highlightCode } from "./markdown.js";

/*
 * Syntax-highlight mirror + command/mention hover help for native textareas.
 *
 * Layout of this file:
 *   1. Constants
 *   2. Help metadata (commands / mentions) shared by the input mirror and the
 *      rendered chat bubbles
 *   3. Tokenizer  — pure function, no DOM, exported for tests
 *   4. Tooltip controller — one implementation for both surfaces
 *   5. attachRichInputHighlighter  — the live textarea mirror
 *   6. decorateRichContent / attachRichMessageTooltips — rendered Markdown
 *   7. observeRichInputHighlighters — auto-attach by selector
 */

// ─── 1. Constants ───────────────────────────────────────────────────────────

/** Above this the mirror degrades to plain text instead of risking input lag. */
const MAX_HIGHLIGHT_LENGTH = 120_000;
/** Inline patterns are skipped on pathologically long single lines. */
const MAX_INLINE_LINE_LENGTH = 4_000;
const TOOLTIP_SHOW_DELAY_MS = 110;
const CODE_CACHE_LIMIT = 64;

/**
 * Everything that influences glyph advance or line breaking. The mirror must
 * match the textarea on all of these or its glyphs drift away from the native
 * caret/selection. Font features matter for Arabic shaping and ligatures.
 */
const TYPOGRAPHY_PROPS = [
  "fontFamily", "fontSize", "fontWeight", "fontStyle", "fontStretch",
  "fontFeatureSettings", "fontVariantLigatures", "fontKerning", "textRendering",
  "lineHeight", "letterSpacing", "wordSpacing", "textAlign", "textIndent",
  "textTransform", "tabSize", "whiteSpace", "overflowWrap", "wordBreak",
  "lineBreak", "hyphens", "direction", "unicodeBidi", "boxSizing",
  "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
];

const TABLE_SEPARATOR = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
const HIGHLIGHT_COLOR = /^[a-z0-9#]{1,20}$/i;

/** One live highlighter per textarea; attaching twice would nest wrappers. */
const instances = new WeakMap();

// ─── 2. Help metadata ───────────────────────────────────────────────────────

const commandName = (command) => String(command?.command ?? "").trim().replace(/^\//, "");
const mentionName = (mention) => String(mention?.name ?? mention?.token ?? "").trim().replace(/^@/, "");

function describeCommand(command) {
  const name = commandName(command);
  return {
    kind: "command",
    name: `/${name}`,
    description: command.description || command.label || "أمر المساعد",
    purpose: command.label || "تنفيذ أمر للمساعد",
    usage: command.placeholder ? `/${name} ${command.placeholder}` : `/${name}`,
  };
}

function describeMention(mention) {
  const name = mentionName(mention);
  return {
    kind: "mention",
    name: `@${name}`,
    description: mention.description || "عنصر سريع للوصول إلى بياناتك",
    purpose: mention.purpose || "إرفاق هذا العنصر بسياق الرسالة ليستخدمه المساعد في إجابته.",
    usage: `اختر @${name} من قائمة الإشارات`,
  };
}

function buildHelpIndex(getCommands, getMentions) {
  const commands = new Map();
  for (const command of getCommands?.() || []) {
    const name = commandName(command);
    if (name) commands.set(name.toLowerCase(), command);
  }
  const mentions = new Map();
  for (const mention of getMentions?.() || []) {
    const name = mentionName(mention);
    if (name) mentions.set(name.toLowerCase(), mention);
  }
  return { commands, mentions };
}

// Unicode-aware boundaries: `\w` is ASCII-only, so Arabic letters used to count
// as "not a word character" and `اكتب/help` / `name@help` were treated as tokens.
const COMMAND_REGEX = /(?<![\p{L}\p{N}_\/])\/([a-z][\w-]*)(?![\p{L}\p{N}_-])/giu;
const MENTION_REGEX = /(?<![\p{L}\p{N}_@])@([a-z][\w-]*)(?![\p{L}\p{N}_-])/giu;

/** Command / mention occurrences in plain text, shared by input and chat bubbles. */
function findHelpTokens(text, index) {
  const tokens = [];
  if (index.commands.size && text.includes("/")) {
    for (const match of text.matchAll(COMMAND_REGEX)) {
      const command = index.commands.get(match[1].toLowerCase());
      if (command) {
        tokens.push({
          start: match.index,
          end: match.index + match[0].length,
          type: "command",
          help: describeCommand(command),
        });
      }
    }
  }
  if (index.mentions.size && text.includes("@")) {
    for (const match of text.matchAll(MENTION_REGEX)) {
      const mention = index.mentions.get(match[1].toLowerCase());
      if (mention) {
        tokens.push({
          start: match.index,
          end: match.index + match[0].length,
          type: "mention",
          help: describeMention(mention),
        });
      }
    }
  }
  return tokens;
}

// ─── 3. Tokenizer ───────────────────────────────────────────────────────────

/*
 * `open` / `close` are the lengths of the delimiter text at either end of a
 * token (`**`, a backtick run, `](url)` …). They're rendered dimmed so the
 * content reads first — color/opacity only, never weight or size, because
 * anything that changes glyph metrics would desync the mirror from the caret.
 *
 * `needs` is a cheap substring pre-check so a line without any `*` or `_`
 * never pays for the emphasis regexes.
 */
const BLOCK_PATTERNS = [
  { type: "heading", regex: /^ {0,3}#{1,6}[ \t]+[^\n]+/gm, priority: 50, markers: (t) => [t.match(/^ {0,3}#{1,6}[ \t]+/)[0].length, 0] },
  { type: "horizontal-rule", regex: /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/gm, priority: 50 },
  { type: "blockquote", regex: /^ {0,3}(?:>[ \t]?)+/gm, priority: 40 },
  { type: "unordered-list", regex: /^[ \t]*[-*+](?=[ \t]+)/gm, priority: 45 },
  { type: "ordered-list", regex: /^[ \t]*\d{1,9}[.)](?=[ \t]+)/gm, priority: 45 },
  // Only a checkbox right after a list marker is a task; a stray "[ ]" in
  // prose used to be highlighted as one.
  { type: "task-list", regex: /(?<=^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+)\[[ xX]\](?=[ \t]|$)/gm, priority: 60 },
  { type: "math-block", regex: /\$\$[\s\S]+?\$\$/g, priority: 95 },
];

const INLINE_PATTERNS = [
  { type: "bold-italic", needs: ["***"], regex: /(?<![*\\])\*\*\*(?=[^\s*])[^*\n]+?(?<=[^\s*])\*\*\*(?!\*)/g, priority: 31, markers: () => [3, 3] },
  // May contain single `*` (nested italic), which the old `[^*]` body rejected.
  { type: "bold", needs: ["**", "__"], regex: /(?<![*\\])\*\*(?=[^\s*])(?:[^*\n]|\*(?!\*))+?(?<=\S)\*\*(?!\*)|(?<![\w\\])__(?=[^\s_])(?:[^_\n]|_(?!_))+?(?<=\S)__(?!\w)/g, priority: 30, markers: () => [2, 2] },
  // Underscore emphasis uses word boundaries, exactly like applyInline(), so
  // `snake_case_name` is not italic.
  { type: "italic", needs: ["*", "_"], regex: /(?<![*\\])\*(?![*\s])(?:[^*\n]|\*\*[^*\n]+\*\*)+?(?<!\s)\*(?!\*)|(?<![\w\\])_(?![_\s])[^_\n]+?(?<![\s_])_(?![\w_])/g, priority: 20, markers: () => [1, 1] },
  { type: "strikethrough", needs: ["~~"], regex: /~~(?=[^\s~])[^~\n]+?(?<=\S)~~/g, priority: 25, markers: () => [2, 2] },
  // ==text== and ==text==(color) — same grammar as applyInline().
  { type: "highlight", needs: ["=="], regex: /==[^=\n]+?==(?:\([a-zA-Z0-9#]{1,20}\))?/g, priority: 26, markers: (t) => [2, 2 + (/\([a-zA-Z0-9#]{1,20}\)$/.exec(t)?.[0].length || 0)] },
  { type: "inline-code", needs: ["`"], regex: /(`+)(?!`)[^\n]*?\1(?!`)/g, priority: 90, markers: (_t, m) => [m[1].length, m[1].length] },
  // $x$ — pandoc rules (no space inside the delimiters, no digit after the
  // closing one) so "costs $5 and $10" is not math.
  { type: "math", needs: ["$"], regex: /(?<![\\$])\$(?=[^\s$])[^$\n]*?(?<=[^\s\\$])\$(?![\d$])/g, priority: 94, markers: () => [1, 1] },
  { type: "image", needs: ["!["], regex: /!\[[^\]\n]*\]\([^\s)]+\)/g, priority: 36, markers: (t) => [2, t.length - t.indexOf("](")] },
  { type: "link", needs: ["]("], regex: /(?<!!)\[[^\]\n]+\]\([^\s)]+(?:[ \t]+"[^"]*")?\)/g, priority: 35, markers: (t) => [1, t.length - t.indexOf("](")] },
];

const PRIORITY = Object.fromEntries([...BLOCK_PATTERNS, ...INLINE_PATTERNS].map(({ type, priority }) => [type, priority]));

// Spans whose contents are literal text: nothing else is highlighted inside.
// Lower rank wins when two of them overlap (a fence beats an inline `code`).
const OPAQUE_RANK = { "code-block": 0, "math-block": 1, "inline-code": 2, math: 3 };

/**
 * Parse text into a tree of syntax tokens.
 * Pure (no DOM) so it can be unit-tested and reused.
 *
 * @param {string} value
 * @param {{commands?: object[], mentions?: object[]}} [providers]
 */
export function tokenizeRichInput(value, { commands = [], mentions = [] } = {}) {
  return tokenize(value, buildHelpIndex(() => commands, () => mentions));
}

function tokenize(value, helpIndex) {
  const matches = [];
  const lines = value.split("\n");
  const lineStarts = new Array(lines.length);
  const inFence = new Array(lines.length).fill(false);

  // ── Fenced code (``` / ~~~), line-based so an unclosed fence runs to EOF ──
  let offset = 0;
  let openFence = null;
  lines.forEach((line, index) => {
    lineStarts[index] = offset;
    const opening = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    // A backtick fence's info string can't contain a backtick: "```a```" is
    // inline code, not a fence.
    const isFenceOpen = opening && !(opening[1][0] === "`" && opening[2].includes("`"));
    if (!openFence && isFenceOpen) {
      openFence = {
        start: offset,
        firstLine: index,
        marker: opening[1][0],
        length: opening[1].length,
        language: opening[2].trim().split(/\s+/)[0] || "",
        contentStart: offset + line.length + (offset + line.length < value.length ? 1 : 0),
      };
    } else if (openFence) {
      const closing = line.match(/^ {0,3}(`+|~+)[ \t]*$/);
      if (closing && closing[1][0] === openFence.marker && closing[1].length >= openFence.length) {
        matches.push({
          start: openFence.start,
          end: offset + line.length,
          type: "code-block",
          language: openFence.language,
          contentStart: openFence.contentStart,
          contentEnd: offset,
        });
        for (let i = openFence.firstLine; i <= index; i++) inFence[i] = true;
        openFence = null;
      }
    }
    offset += line.length + (index < lines.length - 1 ? 1 : 0);
  });
  if (openFence) {
    matches.push({
      start: openFence.start,
      end: value.length,
      type: "code-block",
      language: openFence.language,
      contentStart: openFence.contentStart,
      contentEnd: value.length,
    });
    for (let i = openFence.firstLine; i < lines.length; i++) inFence[i] = true;
  }

  const push = (pattern, match, base) => {
    const text = match[0];
    const token = { start: base + match.index, end: base + match.index + text.length, type: pattern.type };
    if (pattern.markers) [token.open, token.close] = pattern.markers(text, match);
    matches.push(token);
  };

  // ── Block-level (anchored, so cheap over the whole document) ─────────────
  for (const pattern of BLOCK_PATTERNS) {
    for (const match of value.matchAll(pattern.regex)) push(pattern, match, 0);
  }

  // ── Inline, line by line: none of these span lines, and skipping fenced
  //    or absurdly long lines bounds the worst-case regex cost. ─────────────
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (inFence[i] || !line || line.length > MAX_INLINE_LINE_LENGTH) continue;
    for (const pattern of INLINE_PATTERNS) {
      if (!pattern.needs.some((needle) => line.includes(needle))) continue;
      for (const match of line.matchAll(pattern.regex)) push(pattern, match, lineStarts[i]);
    }
  }

  // ── Tables: a header row directly above a |---|---| separator ─────────────
  for (let i = 0; i < lines.length - 1; i++) {
    if (inFence[i] || inFence[i + 1]) continue;
    if (!lines[i].includes("|") || !lines[i + 1].includes("|") || !TABLE_SEPARATOR.test(lines[i + 1])) continue;
    matches.push({ start: lineStarts[i + 1], end: lineStarts[i + 1] + lines[i + 1].length, type: "table-rule" });
    const rows = [i];
    let next = i + 2;
    while (next < lines.length && !inFence[next] && lines[next].trim() && lines[next].includes("|")) rows.push(next++);
    for (const row of rows) {
      for (const pipe of lines[row].matchAll(/(?<!\\)\|/g)) {
        matches.push({ start: lineStarts[row] + pipe.index, end: lineStarts[row] + pipe.index + 1, type: "table-pipe" });
      }
    }
    i = next - 1;
  }

  // ── Commands / mentions ──────────────────────────────────────────────────
  const helpTokens = findHelpTokens(value, helpIndex);
  if (helpTokens.length) {
    // `[x](/explain)` is a URL, not the assistant command.
    const urlRanges = matches
      .filter((m) => m.type === "link" || m.type === "image")
      .map((m) => [m.end - m.close, m.end]);
    for (const token of helpTokens) {
      if (!urlRanges.some(([from, to]) => token.start >= from && token.end <= to)) matches.push(token);
    }
  }

  // ── Resolve literal spans, then nest everything else into a tree ─────────
  const accepted = matches
    .filter((m) => m.type in OPAQUE_RANK)
    .sort((a, b) => OPAQUE_RANK[a.type] - OPAQUE_RANK[b.type] || a.start - b.start)
    .reduce((list, candidate) => {
      if (!list.some((kept) => candidate.start < kept.end && candidate.end > kept.start)) list.push(candidate);
      return list;
    }, [])
    .sort((a, b) => a.start - b.start);

  const insideLiteral = (m) => {
    let lo = 0;
    let hi = accepted.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (accepted[mid].start <= m.start) lo = mid + 1;
      else hi = mid - 1;
    }
    const container = accepted[hi];
    return !!container && m.start >= container.start && m.end <= container.end;
  };
  const flat = accepted.concat(matches.filter((m) => !(m.type in OPAQUE_RANK) && !insideLiteral(m)));

  flat.sort((a, b) => a.start - b.start || b.end - a.end || (PRIORITY[b.type] || 0) - (PRIORITY[a.type] || 0));
  const root = { start: -1, end: value.length + 1, children: [] };
  const stack = [root];
  for (const match of flat) {
    while (stack.length > 1 && match.start >= stack[stack.length - 1].end) stack.pop();
    const parent = stack[stack.length - 1];
    if (match.start < parent.start || match.end > parent.end) continue; // partial overlap
    if (parent.start === match.start && parent.end === match.end) continue; // duplicate range
    const node = { ...match, children: [] };
    parent.children.push(node);
    stack.push(node);
  }
  return root.children;
}

// ─── 4. Tooltip controller ──────────────────────────────────────────────────

function buildTooltipContent(tooltip, help) {
  const badge = document.createElement("span");
  badge.className = `rich-input-highlighter__badge rich-input-highlighter__badge--${help.kind}`;
  badge.textContent = help.kind === "command" ? "أمر" : "إشارة";
  const title = document.createElement("strong");
  title.className = "rich-input-highlighter__title";
  title.dir = "auto";
  title.textContent = help.name;
  const description = document.createElement("p");
  description.className = "rich-input-highlighter__description";
  description.dir = "auto";
  description.textContent = help.description;
  const purpose = document.createElement("p");
  purpose.className = "rich-input-highlighter__purpose";
  purpose.dir = "auto";
  purpose.textContent = help.purpose;
  tooltip.replaceChildren(badge, title, description, purpose);
  if (help.usage) {
    const usage = document.createElement("code");
    usage.className = "rich-input-highlighter__usage";
    usage.dir = "auto";
    usage.textContent = help.usage;
    tooltip.appendChild(usage);
  }
}

function positionTooltip(tooltip, rect) {
  const padding = 10;
  const box = tooltip.getBoundingClientRect();
  const centered = rect.left + rect.width / 2 - box.width / 2;
  const left = Math.max(padding, Math.min(centered, window.innerWidth - box.width - padding));
  const above = rect.top - box.height - 8;
  const top = above >= padding
    ? above
    : Math.min(window.innerHeight - box.height - padding, rect.bottom + 8);
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${Math.max(padding, top)}px`;
}

/**
 * One tooltip element + show/hide logic, used by both the textarea mirror and
 * the rendered-message delegate (they previously carried two copies).
 */
function createTooltipController(id) {
  const element = document.createElement("div");
  element.className = "rich-input-highlighter__tooltip";
  element.setAttribute("role", "tooltip");
  if (id) element.id = id;
  element.hidden = true;
  document.body.appendChild(element);

  let anchor = null;
  let timer = 0;

  function hide() {
    clearTimeout(timer);
    timer = 0;
    anchor = null;
    if (element.hidden) return;
    element.hidden = true;
    element.replaceChildren();
  }

  /**
   * @param {object} key      identity of the hovered token (re-hover = reposition only)
   * @param {object} help
   * @param {() => DOMRect} getRect  measured at reveal time, so a delayed show lands on the token's current position
   * @param {number} [delay]
   */
  function show(key, help, getRect, delay = 0) {
    if (anchor === key) {
      if (!element.hidden) positionTooltip(element, getRect());
      return;
    }
    clearTimeout(timer);
    anchor = key;
    const reveal = () => {
      timer = 0;
      buildTooltipContent(element, help);
      element.hidden = false;
      positionTooltip(element, getRect());
    };
    // Only delay the first reveal; sliding from one token to the next is instant.
    if (delay && element.hidden) timer = setTimeout(reveal, delay);
    else reveal();
  }

  return {
    element,
    show,
    hide,
    get anchor() { return anchor; },
    destroy() {
      hide();
      element.remove();
    },
  };
}

// ─── 5. Live textarea mirror ────────────────────────────────────────────────

/**
 * Re-parenting a node resets its scroll offset and drops focus/selection, so
 * wrapping (and unwrapping) a textarea that's being typed in must put those back.
 */
function preservingEditorState(textarea, move) {
  const hadFocus = document.activeElement === textarea;
  const { selectionStart, selectionEnd, selectionDirection, scrollTop, scrollLeft } = textarea;
  move();
  textarea.scrollTop = scrollTop;
  textarea.scrollLeft = scrollLeft;
  if (!hadFocus) return;
  textarea.focus({ preventScroll: true });
  try { textarea.setSelectionRange(selectionStart, selectionEnd, selectionDirection); } catch { /* detached */ }
}

const codeCache = new Map();
/** Highlighting a fence is the costliest step; typing elsewhere shouldn't redo it. */
function highlightCodeCached(code, language) {
  const key = `${language}\u0000${code}`;
  const hit = codeCache.get(key);
  if (hit !== undefined) {
    codeCache.delete(key);
    codeCache.set(key, hit);
    return hit;
  }
  let html;
  try {
    html = highlightCode(code, language || detectLang(code.trim()));
  } catch {
    html = escHtml(code);
  }
  codeCache.set(key, html);
  if (codeCache.size > CODE_CACHE_LIMIT) codeCache.delete(codeCache.keys().next().value);
  return html;
}

/**
 * Adds a syntax-highlight mirror and hover help to a native textarea without
 * replacing its editing surface. The textarea remains responsible for input,
 * selection, keyboard shortcuts, clipboard, and IME composition.
 *
 * Programmatic `textarea.value = …` / `setRangeText()` are picked up
 * automatically; `refresh()` is only needed after the command/mention
 * providers or the textarea's styling change.
 *
 * @param {object} options
 * @param {HTMLTextAreaElement} options.textarea
 * @param {() => Array<object>} [options.getCommands]
 * @param {() => Array<object>} [options.getMentions]
 * @param {string} [options.wrapperClass] extra class(es) for the wrapper element
 * @returns {{ refresh: () => void, destroy: () => void }}
 */
export function attachRichInputHighlighter({
  textarea,
  getCommands = () => [],
  getMentions = () => [],
  wrapperClass = "",
} = {}) {
  if (!(textarea instanceof HTMLTextAreaElement)) {
    throw new TypeError("attachRichInputHighlighter requires a textarea");
  }
  const existing = instances.get(textarea);
  if (existing) return existing;
  const parent = textarea.parentElement;
  if (!parent) throw new Error("Textarea must be attached to the document before highlighting");

  const originalStyles = {
    color: textarea.style.color,
    caretColor: textarea.style.caretColor,
    webkitTextFillColor: textarea.style.webkitTextFillColor,
    position: textarea.style.position,
    zIndex: textarea.style.zIndex,
    background: textarea.style.background,
  };

  const wrapper = document.createElement("div");
  wrapper.className = "rich-input-highlighter";
  if (wrapperClass) wrapper.classList.add(...wrapperClass.split(/\s+/).filter(Boolean));
  wrapper.dataset.richInputHighlighter = "";
  preservingEditorState(textarea, () => {
    parent.insertBefore(wrapper, textarea);
    wrapper.appendChild(textarea);
  });

  const mirror = document.createElement("div");
  mirror.className = "rich-input-highlighter__mirror";
  mirror.setAttribute("aria-hidden", "true");
  wrapper.insertBefore(mirror, textarea);

  textarea.classList.add("rich-input-highlighter__textarea");
  textarea.style.color = "transparent";
  textarea.style.caretColor = "var(--color-text-primary, currentColor)";
  textarea.style.webkitTextFillColor = "transparent";
  textarea.style.position = "relative";
  textarea.style.zIndex = "1";
  textarea.style.background = "transparent";

  const tooltip = createTooltipController();

  let destroyed = false;
  let lastValue = null;
  let helpTokens = [];
  let renderQueued = false;
  let typographyQueued = false;
  let pointerFrame = 0;
  let pointerX = 0;
  let pointerY = 0;

  // ── Mirror geometry ──────────────────────────────────────────────────────

  /**
   * Copy font/box metrics onto the mirror. Runs on EVERY render (as the
   * original did), not just on resize: a textarea's padding, font-size or
   * line-height can change through a class on an ancestor (expanded composer,
   * :focus-within, breakpoints) without any event on the textarea itself, and
   * a stale metric shows up as selection/caret drifting off the text line.
   * Writes are skipped when nothing changed, so the steady-state cost is one
   * computed-style read.
   */
  const appliedTypography = {};
  function syncTypography() {
    const computed = getComputedStyle(textarea);
    for (const property of TYPOGRAPHY_PROPS) {
      const value = computed[property];
      if (appliedTypography[property] === value) continue;
      appliedTypography[property] = value;
      mirror.style[property] = value;
    }
    // `dir="auto"` resolves per content; the computed `direction` alone doesn't
    // carry that, so mirror the attribute too.
    const dirAttr = textarea.getAttribute("dir");
    if (dirAttr) mirror.setAttribute("dir", dirAttr);
    else mirror.removeAttribute("dir");
    // The mirror sits at the textarea's client origin (inside its border), so
    // it must not paint the copied border a second time.
    mirror.style.border = "0 solid transparent";
    // clientWidth/Height include padding and exclude borders, so a borderless
    // border-box mirror matches the textarea's inner box in any box-sizing mode.
    mirror.style.boxSizing = "border-box";
    mirror.style.height = "auto";
    syncGeometry();
  }

  /**
   * Cheap per-render/per-scroll sync. A new scrollbar changes clientWidth,
   * which changes wrapping — so this must track every render. In RTL the
   * scrollbar can sit on the left, which is what clientLeft captures.
   */
  function syncGeometry() {
    mirror.style.width = `${textarea.clientWidth}px`;
    mirror.style.minHeight = `${textarea.clientHeight}px`;
    mirror.style.left = `${textarea.clientLeft}px`;
    mirror.style.top = `${textarea.clientTop}px`;
    mirror.style.transform = `translate3d(${-textarea.scrollLeft}px, ${-textarea.scrollTop}px, 0)`;
  }

  function scheduleTypography() {
    if (typographyQueued || destroyed) return;
    typographyQueued = true;
    queueMicrotask(() => {
      typographyQueued = false;
      if (!destroyed) syncTypography();
    });
  }

  // ── Rendering ────────────────────────────────────────────────────────────

  function buildFragment(value) {
    const fragment = document.createDocumentFragment();
    if (value.length > MAX_HIGHLIGHT_LENGTH) {
      fragment.appendChild(document.createTextNode(value));
      return fragment;
    }
    const tree = tokenize(value, buildHelpIndex(getCommands, getMentions));

    const markerNode = (text) => {
      const marker = document.createElement("span");
      marker.className = "rich-input-highlighter__marker";
      marker.textContent = text;
      return marker;
    };

    function appendRange(target, nodes, start, end) {
      let cursor = start;
      for (const match of nodes) {
        if (match.start > cursor) target.appendChild(document.createTextNode(value.slice(cursor, match.start)));
        const token = document.createElement("span");
        token.className = `rich-input-highlight rich-input-highlight--${match.type}`;
        token.dataset.richToken = match.type;
        if (match.help) {
          token._richHelp = match.help;
          helpTokens.push(token);
        }

        if (match.type === "code-block") {
          const codeStart = Math.min(Math.max(match.contentStart, match.start), match.end);
          const codeEnd = Math.min(Math.max(match.contentEnd, codeStart), match.end);
          token.appendChild(document.createTextNode(value.slice(match.start, codeStart)));
          const template = document.createElement("template");
          template.innerHTML = highlightCodeCached(value.slice(codeStart, codeEnd), match.language);
          token.appendChild(template.content);
          token.appendChild(document.createTextNode(value.slice(codeEnd, match.end)));
        } else if (match.type === "highlight") {
          const color = /\(([a-zA-Z0-9#]{1,20})\)$/.exec(value.slice(match.start, match.end))?.[1];
          if (color && HIGHLIGHT_COLOR.test(color) && CSS.supports("color", color)) {
            token.style.setProperty("--md-highlight-color", color);
          }
          appendDelimited(token, match);
        } else if (match.type === "math-block" || match.type === "math") {
          token.appendChild(document.createTextNode(value.slice(match.start, match.end)));
        } else {
          appendDelimited(token, match);
        }
        target.appendChild(token);
        cursor = match.end;
      }
      if (cursor < end) target.appendChild(document.createTextNode(value.slice(cursor, end)));
    }

    // Dim the delimiters; fall back to a plain render when a child token would
    // straddle one (so we never split a token's text in the wrong place).
    function appendDelimited(token, match) {
      const open = match.open || 0;
      const close = match.close || 0;
      const innerStart = match.start + open;
      const innerEnd = match.end - close;
      const children = match.children || [];
      const splittable = open + close > 0
        && innerStart <= innerEnd
        && children.every((child) => child.start >= innerStart && child.end <= innerEnd);
      if (!splittable) {
        appendRange(token, children, match.start, match.end);
        return;
      }
      if (open) token.appendChild(markerNode(value.slice(match.start, innerStart)));
      appendRange(token, children, innerStart, innerEnd);
      if (close) token.appendChild(markerNode(value.slice(innerEnd, match.end)));
    }

    appendRange(fragment, tree, 0, value.length);
    return fragment;
  }

  function render() {
    const value = textarea.value || "";
    lastValue = value;
    helpTokens = [];
    tooltip.hide();

    let fragment;
    try {
      fragment = buildFragment(value);
    } catch (error) {
      // The textarea's own text is transparent, so a render failure must never
      // leave the mirror empty — fall back to unstyled text.
      console.error("[rich-input-highlighter] render failed; showing plain text", error);
      helpTokens = [];
      fragment = document.createDocumentFragment();
      fragment.appendChild(document.createTextNode(value));
    }
    // The final newline keeps the mirror's last line at the same height as a
    // textarea's trailing empty line without changing what the user edits.
    if (value.endsWith("\n") || !value) fragment.appendChild(document.createTextNode("​"));
    mirror.replaceChildren(fragment);
    syncTypography();
  }

  /** Coalesces programmatic edits into one render before the next paint. */
  function scheduleRender() {
    if (renderQueued || destroyed) return;
    renderQueued = true;
    queueMicrotask(() => {
      renderQueued = false;
      if (!destroyed && (textarea.value || "") !== lastValue) render();
    });
  }

  // ── Hover help ───────────────────────────────────────────────────────────

  function rectsOf(token) {
    return token.getClientRects();
  }

  function hitTest(x, y) {
    for (const token of helpTokens) {
      for (const rect of rectsOf(token)) {
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return { token, rect };
      }
    }
    return null;
  }

  function probePointer() {
    pointerFrame = 0;
    const hit = hitTest(pointerX, pointerY);
    if (!hit) {
      tooltip.hide();
      return;
    }
    tooltip.show(
      hit.token,
      hit.token._richHelp,
      () => hitTest(pointerX, pointerY)?.rect || hit.token.getBoundingClientRect(),
      TOOLTIP_SHOW_DELAY_MS,
    );
  }

  function onPointerMove(event) {
    if (event.pointerType === "touch") return; // no hover on touch; avoids popups mid-scroll
    pointerX = event.clientX;
    pointerY = event.clientY;
    if (!helpTokens.length) {
      tooltip.hide();
      return;
    }
    if (!pointerFrame) pointerFrame = requestAnimationFrame(probePointer);
  }

  function onScroll() {
    syncGeometry();
    tooltip.hide();
  }

  function onResize() {
    scheduleTypography();
    tooltip.hide();
  }

  function onKeydown(event) {
    // Escape dismisses hover content without affecting the page (WCAG 1.4.13).
    if (event.key === "Escape") tooltip.hide();
  }

  // ── Programmatic edits ───────────────────────────────────────────────────
  // `input` only fires for user edits. Assigning `.value` (e.g. clearing the
  // box after sending) or calling setRangeText() used to leave a stale mirror
  // until someone remembered to call refresh().
  const valueDescriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");
  if (valueDescriptor?.get && valueDescriptor?.set) {
    Object.defineProperty(textarea, "value", {
      configurable: true,
      enumerable: valueDescriptor.enumerable,
      get() { return valueDescriptor.get.call(this); },
      set(next) {
        valueDescriptor.set.call(this, next);
        scheduleRender();
      },
    });
  }
  const nativeSetRangeText = HTMLTextAreaElement.prototype.setRangeText;
  textarea.setRangeText = function patchedSetRangeText(...args) {
    const result = nativeSetRangeText.apply(this, args);
    scheduleRender();
    return result;
  };
  const form = textarea.form;
  const onFormReset = () => scheduleRender();
  form?.addEventListener("reset", onFormReset);

  // ── Wiring ───────────────────────────────────────────────────────────────

  const hideTooltip = () => tooltip.hide();
  textarea.addEventListener("input", render);
  textarea.addEventListener("scroll", onScroll, { passive: true });
  textarea.addEventListener("pointermove", onPointerMove);
  textarea.addEventListener("pointerleave", hideTooltip);
  textarea.addEventListener("pointerdown", hideTooltip);
  textarea.addEventListener("blur", hideTooltip);
  textarea.addEventListener("focus", scheduleTypography);
  textarea.addEventListener("keydown", onKeydown);
  window.addEventListener("resize", onResize);

  const resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(onResize) : null;
  resizeObserver?.observe(textarea);
  // Class/style/dir changes (theme switch, font picker, autosize) change metrics
  // without a resize; web-font loads change glyph advances.
  const attributeObserver = typeof MutationObserver === "function"
    ? new MutationObserver(scheduleTypography)
    : null;
  attributeObserver?.observe(textarea, { attributes: true, attributeFilter: ["class", "style", "dir", "lang"] });
  const fonts = document.fonts;
  fonts?.addEventListener?.("loadingdone", scheduleTypography);

  render();

  const api = {
    refresh() {
      if (destroyed) return;
      render();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      instances.delete(textarea);
      cancelAnimationFrame(pointerFrame);
      textarea.removeEventListener("input", render);
      textarea.removeEventListener("scroll", onScroll);
      textarea.removeEventListener("pointermove", onPointerMove);
      textarea.removeEventListener("pointerleave", hideTooltip);
      textarea.removeEventListener("pointerdown", hideTooltip);
      textarea.removeEventListener("blur", hideTooltip);
      textarea.removeEventListener("focus", scheduleTypography);
      textarea.removeEventListener("keydown", onKeydown);
      window.removeEventListener("resize", onResize);
      form?.removeEventListener("reset", onFormReset);
      fonts?.removeEventListener?.("loadingdone", scheduleTypography);
      resizeObserver?.disconnect();
      attributeObserver?.disconnect();
      tooltip.destroy();
      // Drop the instance-level overrides so the prototype's behavior returns.
      delete textarea.value;
      delete textarea.setRangeText;
      textarea.classList.remove("rich-input-highlighter__textarea");
      for (const [property, value] of Object.entries(originalStyles)) textarea.style[property] = value;
      if (wrapper.parentNode) preservingEditorState(textarea, () => wrapper.replaceWith(textarea));
    },
  };
  instances.set(textarea, api);
  return api;
}

// ─── 6. Rendered Markdown ───────────────────────────────────────────────────

const DECORATE_SKIP_SELECTOR = "code, pre, a, script, style, .katex, .math-inline, .math-block, [data-rich-token]";

/**
 * Adds the same live command/mention tokens and hover help to rendered
 * Markdown without touching code, links, or the source message string.
 * Call after inserting renderMarkdown() output into the message bubble.
 */
export function decorateRichContent(root, {
  getCommands = () => [],
  getMentions = () => [],
} = {}) {
  if (!root) return;
  const index = buildHelpIndex(getCommands, getMentions);
  if (!index.commands.size && !index.mentions.size) return;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.parentElement?.closest(DECORATE_SKIP_SELECTOR)) continue;
    if (node.nodeValue?.trim()) textNodes.push(node);
  }

  for (const node of textNodes) {
    const value = node.nodeValue || "";
    const matches = findHelpTokens(value, index);
    if (!matches.length) continue;

    matches.sort((a, b) => a.start - b.start || a.end - b.end);
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    for (const match of matches) {
      if (match.start < cursor) continue;
      if (match.start > cursor) fragment.appendChild(document.createTextNode(value.slice(cursor, match.start)));
      const token = document.createElement("span");
      token.className = `rich-input-highlight rich-input-highlight--${match.type}`;
      token.dataset.richToken = match.type;
      token._richHelp = match.help;
      token.tabIndex = 0;
      token.setAttribute("aria-label", `${match.help.name}. ${match.help.description}`);
      token.textContent = value.slice(match.start, match.end);
      fragment.appendChild(token);
      cursor = match.end;
    }
    if (cursor < value.length) fragment.appendChild(document.createTextNode(value.slice(cursor)));
    node.replaceWith(fragment);
  }
}

/** One delegated, shared tooltip controller for the chat's rendered messages. */
export function attachRichMessageTooltips(root) {
  if (!root) return { destroy() { } };
  const tooltip = createTooltipController(`rich-message-tooltip-${Math.random().toString(36).slice(2)}`);

  const tokenFrom = (target) => target instanceof Element
    ? target.closest("[data-rich-token][tabindex]")
    : null;

  let describedToken = null;
  function hide() {
    describedToken?.removeAttribute("aria-describedby");
    describedToken = null;
    tooltip.hide();
  }

  function show(token) {
    if (!token?._richHelp) return;
    if (describedToken !== token) {
      describedToken?.removeAttribute("aria-describedby");
      describedToken = token;
      token.setAttribute("aria-describedby", tooltip.element.id);
    }
    tooltip.show(token, token._richHelp, () => token.getBoundingClientRect());
  }

  const onPointerOver = (event) => { const token = tokenFrom(event.target); if (token) show(token); };
  const onPointerOut = (event) => {
    const token = tokenFrom(event.target);
    if (token && !token.contains(event.relatedTarget)) hide();
  };
  const onFocusIn = onPointerOver;
  const onFocusOut = onPointerOut;
  const onKeydown = (event) => { if (event.key === "Escape") hide(); };

  root.addEventListener("pointerover", onPointerOver);
  root.addEventListener("pointerout", onPointerOut);
  root.addEventListener("focusin", onFocusIn);
  root.addEventListener("focusout", onFocusOut);
  root.addEventListener("keydown", onKeydown);
  root.addEventListener("scroll", hide, { passive: true });
  window.addEventListener("resize", hide);
  return {
    destroy() {
      root.removeEventListener("pointerover", onPointerOver);
      root.removeEventListener("pointerout", onPointerOut);
      root.removeEventListener("focusin", onFocusIn);
      root.removeEventListener("focusout", onFocusOut);
      root.removeEventListener("keydown", onKeydown);
      root.removeEventListener("scroll", hide);
      window.removeEventListener("resize", hide);
      hide();
      tooltip.destroy();
    },
  };
}

// ─── 7. Auto-attach ─────────────────────────────────────────────────────────

/** Keep live mirrors attached to textareas that are added and removed later. */
export function observeRichInputHighlighters({
  root = document.body,
  selector,
  getCommands = () => [],
  getMentions = () => [],
} = {}) {
  if (!root || !selector) return { refresh() { }, destroy() { } };
  const attached = new Map();

  function attach(textarea) {
    if (attached.has(textarea) || !(textarea instanceof HTMLTextAreaElement) || !textarea.parentElement) return;
    attached.set(textarea, attachRichInputHighlighter({
      textarea,
      getCommands,
      getMentions,
      wrapperClass: "rich-input-highlighter--field",
    }));
  }

  function sweepRemoved() {
    for (const [textarea, highlighter] of attached) {
      if (!textarea.isConnected || !root.contains(textarea)) {
        highlighter.destroy();
        attached.delete(textarea);
      }
    }
  }

  // This observer watches a whole subtree (often document.body) while the chat
  // streams tokens into it, so it must stay O(changed nodes): inspect only what
  // was added, and only sweep for removals when something was actually removed.
  // (It used to re-run querySelectorAll over the entire root on every mutation.)
  const observer = new MutationObserver((records) => {
    let removed = false;
    for (const record of records) {
      if (record.removedNodes.length) removed = true;
      for (const node of record.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        if (node.matches(selector)) attach(node);
        for (const textarea of node.querySelectorAll(selector)) attach(textarea);
      }
    }
    if (removed && attached.size) sweepRemoved();
  });
  observer.observe(root, { childList: true, subtree: true });
  for (const textarea of root.querySelectorAll(selector)) attach(textarea);

  return {
    refresh() {
      for (const highlighter of attached.values()) highlighter.refresh();
    },
    destroy() {
      observer.disconnect();
      for (const highlighter of attached.values()) highlighter.destroy();
      attached.clear();
    },
  };
}