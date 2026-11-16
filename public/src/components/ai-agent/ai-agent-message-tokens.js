// =============================================================================
// ai-agent-message-tokens.js
// Command/mention token decoration and tooltip for rendered chat bubbles.
//
// Extracted from shared/rich-input-highlighter.js — only the parts that work
// on *rendered* Markdown (decorateMessageTokens) and the shared tooltip logic
// (attachMessageTooltips). The textarea mirror code stays in that file until
// it is fully removed by the Rich Input migration.
//
// CSS classes used here:
//   .ai-agent__token                    — base token span
//   .ai-agent__token--command           — /command tokens
//   .ai-agent__token--mention           — @mention tokens
//   .ai-agent__token-tooltip            — tooltip element (appended to <body>)
//   .ai-agent__token-tooltip__badge     — "أمر" / "إشارة" pill
//   .ai-agent__token-tooltip__badge--command
//   .ai-agent__token-tooltip__badge--mention
//   .ai-agent__token-tooltip__title
//   .ai-agent__token-tooltip__description
//   .ai-agent__token-tooltip__purpose
//   .ai-agent__token-tooltip__usage
// =============================================================================

// ─── Help metadata ────────────────────────────────────────────────────────────

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

const COMMAND_REGEX = /(?<![\p{L}\p{N}_\/])\/([a-z][\w-]*)(?![\p{L}\p{N}_-])/giu;
const MENTION_REGEX = /(?<![\p{L}\p{N}_@])@([a-z][\w-]*)(?![\p{L}\p{N}_-])/giu;

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

// ─── Tooltip ──────────────────────────────────────────────────────────────────

function buildTooltipContent(tooltip, help) {
  const badge = document.createElement("span");
  badge.className = `ai-agent__token-tooltip__badge ai-agent__token-tooltip__badge--${help.kind}`;
  badge.textContent = help.kind === "command" ? "أمر" : "إشارة";
  const title = document.createElement("strong");
  title.className = "ai-agent__token-tooltip__title";
  title.dir = "auto";
  title.textContent = help.name;
  const description = document.createElement("p");
  description.className = "ai-agent__token-tooltip__description";
  description.dir = "auto";
  description.textContent = help.description;
  const purpose = document.createElement("p");
  purpose.className = "ai-agent__token-tooltip__purpose";
  purpose.dir = "auto";
  purpose.textContent = help.purpose;
  tooltip.replaceChildren(badge, title, description, purpose);
  if (help.usage) {
    const usage = document.createElement("code");
    usage.className = "ai-agent__token-tooltip__usage";
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

function createTokenTooltipController(id) {
  const element = document.createElement("div");
  element.className = "ai-agent__token-tooltip";
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
    if (delay && element.hidden) timer = setTimeout(reveal, delay);
    else reveal();
  }

  return {
    element,
    show,
    hide,
    destroy() {
      hide();
      element.remove();
    },
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

const DECORATE_SKIP_SELECTOR = "code, pre, a, script, style, .katex, .math-inline, .math-block, [data-rich-token]";

/**
 * Walk rendered Markdown inside `root` and wrap /command and @mention tokens
 * in styled spans with tooltip data attached. Call after renderMarkdown().
 *
 * @param {Element} root
 * @param {{ getCommands?: () => object[], getMentions?: () => object[] }} options
 */
export function decorateMessageTokens(root, {
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
      token.className = `ai-agent__token ai-agent__token--${match.type}`;
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

/**
 * Attach a single delegated tooltip controller to `root` for all decorated
 * command/mention tokens inside it.
 *
 * @param {Element} root
 * @returns {{ destroy: () => void }}
 */
export function attachMessageTooltips(root) {
  if (!root) return { destroy() { } };
  const tooltip = createTokenTooltipController(`ai-agent-token-tooltip-${Math.random().toString(36).slice(2)}`);

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
