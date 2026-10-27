import { detectLang, highlightCode } from "./markdown.js";

/**
 * Adds a syntax-highlight mirror and hover help to a native textarea without
 * replacing its editing surface. The textarea remains responsible for input,
 * selection, keyboard shortcuts, clipboard, and IME composition.
 *
 * @param {object} options
 * @param {HTMLTextAreaElement} options.textarea
 * @param {() => Array<object>} [options.getCommands]
 * @param {() => Array<object>} [options.getMentions]
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

  const originalStyles = {
    color: textarea.style.color,
    caretColor: textarea.style.caretColor,
    webkitTextFillColor: textarea.style.webkitTextFillColor,
    position: textarea.style.position,
    zIndex: textarea.style.zIndex,
    background: textarea.style.background,
  };
  const parent = textarea.parentElement;
  if (!parent) throw new Error("Textarea must be attached to the document before highlighting");
  const wrapper = document.createElement("div");
  wrapper.className = "rich-input-highlighter";
  if (wrapperClass) wrapper.classList.add(...wrapperClass.split(/\s+/).filter(Boolean));
  wrapper.dataset.richInputHighlighter = "";
  parent.insertBefore(wrapper, textarea);
  wrapper.appendChild(textarea);

  const mirror = document.createElement("div");
  mirror.className = "rich-input-highlighter__mirror";
  mirror.setAttribute("aria-hidden", "true");
  wrapper.insertBefore(mirror, textarea);

  const tooltip = document.createElement("div");
  tooltip.className = "rich-input-highlighter__tooltip";
  tooltip.setAttribute("role", "tooltip");
  tooltip.hidden = true;
  document.body.appendChild(tooltip);
  let activeTooltipToken = null;

  textarea.classList.add("rich-input-highlighter__textarea");
  textarea.style.color = "transparent";
  textarea.style.caretColor = "var(--color-text-primary, currentColor)";
  textarea.style.webkitTextFillColor = "transparent";
  textarea.style.position = "relative";
  textarea.style.zIndex = "1";
  textarea.style.background = "transparent";

  const styleProperties = [
    "fontFamily", "fontSize", "fontWeight", "fontStyle", "lineHeight",
    "letterSpacing", "textAlign", "textIndent", "textTransform", "tabSize",
    "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
    "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
    "boxSizing", "direction", "unicodeBidi", "wordSpacing",
  ];

  function findMatches(value) {
    const matches = [];
    const lines = value.split("\n");
    let lineStart = 0;
    let openFence = null;
    lines.forEach((line, index) => {
      const opening = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
      if (!openFence && opening) {
        openFence = {
          start: lineStart,
          marker: opening[1][0],
          length: opening[1].length,
          language: opening[2].trim().split(/\s+/)[0] || "",
          contentStart: lineStart + line.length + (lineStart + line.length < value.length ? 1 : 0),
        };
      } else if (openFence) {
        const closing = line.match(/^ {0,3}(`+|~+)[ \t]*$/);
        if (closing && closing[1][0] === openFence.marker && closing[1].length >= openFence.length) {
          matches.push({
            start: openFence.start,
            end: lineStart + line.length,
            type: "code-block",
            language: openFence.language,
            contentStart: openFence.contentStart,
            contentEnd: lineStart,
          });
          openFence = null;
        }
      }
      lineStart += line.length + (index < lines.length - 1 ? 1 : 0);
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
    }

    const markdownPatterns = [
      { type: "heading", regex: /^ {0,3}#{1,6}[ \t]+[^\n]+/gm, priority: 50 },
      { type: "horizontal-rule", regex: /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/gm, priority: 50 },
      { type: "blockquote", regex: /^ {0,3}>[ \t]?/gm, priority: 40 },
      { type: "unordered-list", regex: /^[ \t]*[-*+](?=[ \t]+)/gm, priority: 45 },
      { type: "ordered-list", regex: /^[ \t]*\d{1,9}[.)](?=[ \t]+)/gm, priority: 45 },
      { type: "task-list", regex: /\[[ xX]\](?=[ \t]|$)/g, priority: 60 },
      { type: "bold", regex: /\*\*(?=\S)([^*\n]*?\S)\*\*|__(?=\S)([^_\n]*?\S)__/g, priority: 30 },
      { type: "italic", regex: /(?<!\*)\*(?!\*)[^*\n]+(?<!\*)\*(?!\*)|(?<!_)_(?!_)[^_\n]+(?<!_)_(?!_)/g, priority: 20 },
      { type: "strikethrough", regex: /~~(?=\S)[^\n]*?\S~~/g, priority: 25 },
      { type: "inline-code", regex: /(`+)(?!`)[^\n]*?\1(?!`)/g, priority: 90 },
      { type: "link", regex: /\[[^\]\n]+\]\([^\s)]+(?:\s+"[^"]*")?\)/g, priority: 35 },
    ];
    for (const { type, regex } of markdownPatterns) {
      for (const match of value.matchAll(regex)) {
        matches.push({ start: match.index, end: match.index + match[0].length, type });
      }
    }

    const commandMap = new Map();
    for (const command of getCommands() || []) {
      const name = String(command.command || "").trim();
      if (name) commandMap.set(name.toLowerCase(), command);
    }
    const commandRegex = /(^|[^\w/])\/([a-z][\w-]*)/gi;
    for (const match of value.matchAll(commandRegex)) {
      const name = match[2].toLowerCase();
      const command = commandMap.get(name);
      if (!command) continue;
      const start = match.index + match[1].length;
      matches.push({
        start,
        end: start + match[0].length - match[1].length,
        type: "command",
        text: match[0].slice(match[1].length),
        help: {
          kind: "command",
          name: `/${command.command}`,
          description: command.description || command.label || "أمر المساعد",
          purpose: command.label || "تنفيذ أمر للمساعد",
          usage: command.placeholder
            ? `/${command.command} ${command.placeholder}`
            : `/${command.command}`,
        },
      });
    }

    const mentionMap = new Map();
    for (const mention of getMentions() || []) {
      const name = String(mention.name || mention.token || "").replace(/^@/, "");
      if (name) mentionMap.set(name.toLowerCase(), mention);
    }
    if (mentionMap.size) {
      const mentionRegex = /(^|[^\w@])@([a-z][\w-]*)/gi;
      for (const match of value.matchAll(mentionRegex)) {
        const mention = mentionMap.get(match[2].toLowerCase());
        if (!mention) continue;
        const start = match.index + match[1].length;
        const text = match[0].slice(match[1].length);
        matches.push({
          start,
          end: start + text.length,
          type: "mention",
          text,
          help: {
            kind: "mention",
            name: `@${mention.name || String(mention.token).replace(/^@/, "")}`,
            description: mention.description || "عنصر سريع للوصول إلى بياناتك",
            purpose: mention.purpose || "إرفاق هذا العنصر بسياق الرسالة ليستخدمه المساعد في إجابته.",
            usage: `اختر @${mention.name || String(mention.token).replace(/^@/, "")} من قائمة الإشارات`,
          },
        });
      }
    }

    // Syntax ranges form a small tree: e.g. inline code can live inside a
    // heading or bold span. Only command/mention tokens inside code are
    // ignored; other contained Markdown is rendered as nested spans.
    const opaqueRanges = matches.filter((match) => match.type === "code-block" || match.type === "inline-code");
    const filtered = matches.filter((match) => {
      if (match.type === "code-block" || match.type === "inline-code") return true;
      return !opaqueRanges.some((range) => match.start >= range.start && match.end <= range.end);
    });
    const priority = Object.fromEntries(markdownPatterns.map(({ type, priority: value }) => [type, value]));
    filtered.sort((a, b) => a.start - b.start || b.end - a.end || (priority[b.type] || 0) - (priority[a.type] || 0));
    const root = { start: -1, end: value.length + 1, children: [] };
    const stack = [root];
    for (const match of filtered) {
      while (stack.length > 1 && match.start >= stack[stack.length - 1].end) stack.pop();
      const parent = stack[stack.length - 1];
      if (match.start < parent.start || match.end > parent.end) continue; // partial overlap
      const sameRange = parent.start === match.start && parent.end === match.end;
      if (sameRange) continue;
      const node = { ...match, children: [] };
      parent.children.push(node);
      stack.push(node);
    }
    return root.children;
  }

  function mirrorStyle() {
    const computed = getComputedStyle(textarea);
    for (const property of styleProperties) {
      mirror.style[property] = computed[property];
    }
    // The mirror is positioned at the textarea's client origin (inside its
    // border) and sized to clientWidth/clientHeight. Keeping the copied
    // textarea border here would add the border a second time before the
    // mirrored text's padding, shifting highlighted glyphs away from the
    // textarea's native caret and selection—most visible with Arabic marks.
    mirror.style.border = "0 solid transparent";
    // clientWidth/clientHeight include padding and exclude borders, so the
    // borderless mirror uses that same inner box regardless of the textarea's
    // own box-sizing mode.
    mirror.style.boxSizing = "border-box";
    mirror.style.width = `${textarea.clientWidth}px`;
    mirror.style.minHeight = `${textarea.clientHeight}px`;
    mirror.style.height = "auto";
    // In RTL, browsers may place the vertical scrollbar on the left. The
    // textarea's client origin includes that gutter, while its clientWidth
    // excludes it; using only the border width made the mirror (and visible
    // selection underneath it) drift horizontally once scrolling began.
    mirror.style.left = `${textarea.clientLeft}px`;
    mirror.style.top = `${textarea.clientTop}px`;
    mirror.style.transform = `translate3d(${-textarea.scrollLeft}px, ${-textarea.scrollTop}px, 0)`;
  }

  function render() {
    const value = textarea.value || "";
    const matches = findMatches(value);
    const fragment = document.createDocumentFragment();
    function appendRange(target, nodes, start, end) {
      let cursor = start;
      for (const match of nodes) {
        if (match.start > cursor) target.appendChild(document.createTextNode(value.slice(cursor, match.start)));
        const token = document.createElement("span");
        token.className = `rich-input-highlight rich-input-highlight--${match.type}`;
        token.dataset.richToken = match.type;
        if (match.help) token._richHelp = match.help;
        if (match.type === "code-block") {
          const codeStart = Math.min(Math.max(match.contentStart, match.start), match.end);
          const codeEnd = Math.min(Math.max(match.contentEnd, codeStart), match.end);
          token.appendChild(document.createTextNode(value.slice(match.start, codeStart)));
          const code = value.slice(codeStart, codeEnd);
          const language = match.language || detectLang(code.trim());
          const template = document.createElement("template");
          template.innerHTML = highlightCode(code, language);
          token.appendChild(template.content);
          token.appendChild(document.createTextNode(value.slice(codeEnd, match.end)));
        } else {
          appendRange(token, match.children || [], match.start, match.end);
        }
        target.appendChild(token);
        cursor = match.end;
      }
      if (cursor < end) target.appendChild(document.createTextNode(value.slice(cursor, end)));
    }

    appendRange(fragment, matches, 0, value.length);
    // The final newline keeps the mirror's last line at the same height as a
    // textarea's trailing empty line without changing what the user edits.
    if (value.endsWith("\n") || !value) fragment.appendChild(document.createTextNode("\u200b"));
    mirror.replaceChildren(fragment);
    mirrorStyle();
  }

  function hideTooltip() {
    if (tooltip.hidden) return;
    tooltip.hidden = true;
    tooltip.replaceChildren();
    activeTooltipToken = null;
  }

  function setTooltipContent(help) {
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
    tooltip.hidden = false;
  }

  function positionTooltip(rect) {
    const padding = 10;
    const tooltipRect = tooltip.getBoundingClientRect();
    const left = Math.max(padding, Math.min(rect.left, window.innerWidth - tooltipRect.width - padding));
    const above = rect.top - tooltipRect.height - 8;
    const top = above >= padding
      ? above
      : Math.min(window.innerHeight - tooltipRect.height - padding, rect.bottom + 8);
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${Math.max(padding, top)}px`;
  }

  function tokenAtPoint(x, y) {
    for (const token of mirror.querySelectorAll("[data-rich-token]")) {
      if (!token._richHelp) continue;
      const range = document.createRange();
      range.selectNodeContents(token);
      for (const rect of range.getClientRects()) {
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
          return { help: token._richHelp, token, rect };
        }
      }
    }
    return null;
  }

  function onPointerMove(event) {
    const match = tokenAtPoint(event.clientX, event.clientY);
    if (!match) {
      hideTooltip();
      return;
    }
    if (activeTooltipToken !== match.token) {
      setTooltipContent(match.help);
      activeTooltipToken = match.token;
    }
    positionTooltip(match.rect);
  }

  function onScroll() {
    mirrorStyle();
    hideTooltip();
  }

  function onWindowChange() {
    mirrorStyle();
    hideTooltip();
  }

  textarea.addEventListener("input", render);
  textarea.addEventListener("scroll", onScroll, { passive: true });
  textarea.addEventListener("pointermove", onPointerMove);
  textarea.addEventListener("pointerleave", hideTooltip);
  window.addEventListener("resize", onWindowChange);
  const resizeObserver = typeof ResizeObserver === "function"
    ? new ResizeObserver(onWindowChange)
    : null;
  resizeObserver?.observe(textarea);
  render();

  return {
    refresh: render,
    destroy() {
      textarea.removeEventListener("input", render);
      textarea.removeEventListener("scroll", onScroll);
      textarea.removeEventListener("pointermove", onPointerMove);
      textarea.removeEventListener("pointerleave", hideTooltip);
      window.removeEventListener("resize", onWindowChange);
      resizeObserver?.disconnect();
      tooltip.remove();
      textarea.classList.remove("rich-input-highlighter__textarea");
      for (const [property, value] of Object.entries(originalStyles)) {
        textarea.style[property] = value;
      }
      wrapper.replaceWith(textarea);
    },
  };
}

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

function positionFloatingTooltip(tooltip, rect) {
  const padding = 10;
  const tooltipRect = tooltip.getBoundingClientRect();
  const left = Math.max(padding, Math.min(rect.left, window.innerWidth - tooltipRect.width - padding));
  const above = rect.top - tooltipRect.height - 8;
  const top = above >= padding
    ? above
    : Math.min(window.innerHeight - tooltipRect.height - padding, rect.bottom + 8);
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${Math.max(padding, top)}px`;
}

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
  const commandMap = new Map();
  for (const command of getCommands() || []) {
    const name = String(command.command || "").trim();
    if (name) commandMap.set(name.toLowerCase(), command);
  }
  const mentionMap = new Map();
  for (const mention of getMentions() || []) {
    const name = String(mention.name || mention.token || "").replace(/^@/, "");
    if (name) mentionMap.set(name.toLowerCase(), mention);
  }
  if (!commandMap.size && !mentionMap.size) return;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.parentElement?.closest("code, pre, a, script, style, [data-rich-token]")) continue;
    if (node.nodeValue?.trim()) textNodes.push(node);
  }

  for (const node of textNodes) {
    const value = node.nodeValue || "";
    const matches = [];
    if (commandMap.size) {
      const regex = /(^|[^\w/])\/([a-z][\w-]*)/gi;
      for (const match of value.matchAll(regex)) {
        const command = commandMap.get(match[2].toLowerCase());
        if (!command) continue;
        const start = match.index + match[1].length;
        matches.push({
          start,
          end: start + match[0].length - match[1].length,
          type: "command",
          help: {
            kind: "command",
            name: `/${command.command}`,
            description: command.description || command.label || "أمر المساعد",
            purpose: command.label || "تنفيذ أمر للمساعد",
            usage: command.placeholder ? `/${command.command} ${command.placeholder}` : `/${command.command}`,
          },
        });
      }
    }
    if (mentionMap.size) {
      const regex = /(^|[^\w@])@([a-z][\w-]*)/gi;
      for (const match of value.matchAll(regex)) {
        const mention = mentionMap.get(match[2].toLowerCase());
        if (!mention) continue;
        const start = match.index + match[1].length;
        const name = mention.name || String(mention.token).replace(/^@/, "");
        matches.push({
          start,
          end: start + match[0].length - match[1].length,
          type: "mention",
          help: {
            kind: "mention",
            name: `@${name}`,
            description: mention.description || "عنصر سريع للوصول إلى بياناتك",
            purpose: mention.purpose || "إرفاق هذا العنصر بسياق الرسالة ليستخدمه المساعد في إجابته.",
            usage: `اختر @${name} من قائمة الإشارات`,
          },
        });
      }
    }
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
  if (!root) return { destroy() {} };
  const tooltip = document.createElement("div");
  tooltip.className = "rich-input-highlighter__tooltip";
  tooltip.id = `rich-message-tooltip-${Math.random().toString(36).slice(2)}`;
  tooltip.setAttribute("role", "tooltip");
  tooltip.hidden = true;
  document.body.appendChild(tooltip);
  let activeToken = null;

  const tokenFrom = (target) => target instanceof Element
    ? target.closest("[data-rich-token][tabindex]")
    : null;

  function hide() {
    if (tooltip.hidden) return;
    tooltip.hidden = true;
    tooltip.replaceChildren();
    activeToken?.removeAttribute("aria-describedby");
    activeToken = null;
  }

  function show(token) {
    if (!token?._richHelp) return;
    if (activeToken !== token) {
      activeToken?.removeAttribute("aria-describedby");
      activeToken = token;
      buildTooltipContent(tooltip, token._richHelp);
      token.setAttribute("aria-describedby", tooltip.id);
    }
    tooltip.hidden = false;
    positionFloatingTooltip(tooltip, token.getBoundingClientRect());
  }

  function onPointerOver(event) {
    const token = tokenFrom(event.target);
    if (token) show(token);
  }
  function onPointerOut(event) {
    const token = tokenFrom(event.target);
    if (token && !token.contains(event.relatedTarget)) hide();
  }
  function onFocusIn(event) {
    const token = tokenFrom(event.target);
    if (token) show(token);
  }
  function onFocusOut(event) {
    const token = tokenFrom(event.target);
    if (token && !token.contains(event.relatedTarget)) hide();
  }
  function onResize() {
    hide();
  }

  root.addEventListener("pointerover", onPointerOver);
  root.addEventListener("pointerout", onPointerOut);
  root.addEventListener("focusin", onFocusIn);
  root.addEventListener("focusout", onFocusOut);
  root.addEventListener("scroll", onResize, { passive: true });
  window.addEventListener("resize", onResize);
  return {
    destroy() {
      root.removeEventListener("pointerover", onPointerOver);
      root.removeEventListener("pointerout", onPointerOut);
      root.removeEventListener("focusin", onFocusIn);
      root.removeEventListener("focusout", onFocusOut);
      root.removeEventListener("scroll", onResize);
      window.removeEventListener("resize", onResize);
      tooltip.remove();
      activeToken = null;
    },
  };
}

/** Keep live mirrors attached to textareas that are added and removed later. */
export function observeRichInputHighlighters({
  root = document.body,
  selector,
  getCommands = () => [],
  getMentions = () => [],
} = {}) {
  if (!root || !selector) return { refresh() {}, destroy() {} };
  const attached = new Map();

  function scan() {
    for (const textarea of root.querySelectorAll(selector)) {
      if (!attached.has(textarea)) {
        attached.set(textarea, attachRichInputHighlighter({
          textarea,
          getCommands,
          getMentions,
          wrapperClass: "rich-input-highlighter--field",
        }));
      }
    }
    for (const [textarea, highlighter] of attached) {
      if (!root.contains(textarea)) {
        highlighter.destroy();
        attached.delete(textarea);
      }
    }
  }

  const observer = new MutationObserver(scan);
  observer.observe(root, { childList: true, subtree: true });
  scan();
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
