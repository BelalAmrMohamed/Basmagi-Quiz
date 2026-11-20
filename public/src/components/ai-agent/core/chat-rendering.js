export function createMessageRenderer(deps) {
  const {
    document, messagesEl, renderMarkdown, decorateMessageTokens, getPageActions, getQuickAccessMentionDefinitions,
    pageKey, options, openAttachmentPreviewModal, iconForAttachment, addCopyButton, addSpeakButton, addEditButton,
    onBranchConversation, resetErrorDedup,
  } = deps;

function appendMessage(role, content, attachmentsForDisplay, historyIndex) {
  // Wrapper around the bubble itself — copy/edit controls live in this
  // wrapper, BELOW the bubble, rather than inside/on top of it (an
  // earlier version pinned them absolutely inside the bubble's own
  // bottom-right corner, which visually sat "on" the message text; see
  // the request that reverted this). The wrapper shares the bubble's
  // own alignment (flex-start for user/right, flex-end for
  // assistant/left, per .ai-agent-msg--user/--assistant) so the
  // controls end up under the correct edge of the bubble, not
  // full-width under the whole message column.
  const wrap = document.createElement("div");
  wrap.className = `ai-agent-msg-wrap ai-agent-msg-wrap--${role}`;

  const el = document.createElement("div");
  el.className = `ai-agent-msg ai-agent-msg--${role}`;

  if (Array.isArray(attachmentsForDisplay) && attachmentsForDisplay.length) {
    attachmentsForDisplay.forEach((att) => {
      const label = att?.name || att?.title;
      if (!label) return;
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "ai-agent-msg-attachment";
      chip.innerHTML = iconForAttachment(att.kind ? att : { kind: "file" });
      const nameSpan = document.createElement("span");
      nameSpan.className = "ai-agent-msg-attachment-name";
      nameSpan.textContent = label;
      chip.appendChild(nameSpan);
      // Same preview as a pending tile (see buildAttachmentTile) — a sent
      // message's attachment carries the same {kind, title|name, summary,
      // payload} shape, whether it's a fresh in-memory `history` entry or
      // one reloaded from IndexedDB history (see toPersistedMessages/
      // loadConversation, which both preserve at least kind+name/title).
      chip.addEventListener("click", (e) => {
        e.stopPropagation();
        openAttachmentPreviewModal(att);
      });
      el.appendChild(chip);
    });
  }

  if (content) {
    // Both roles render through the same markdown pipeline now — a user
    // prompt containing e.g. a fenced code block, a list, or **bold**
    // should render just like an assistant reply does, not show up as
    // raw markdown syntax. renderMarkdown() already handles per-line
    // RTL/LTR direction internally (via scanDirections/_processElement),
    // so this also keeps the "mixed Arabic/English line" behavior that
    // _processByLine used to provide directly.
    el.insertAdjacentHTML("beforeend", renderMarkdown(content));
    decorateMessageTokens(el, {
      getCommands: () => getPageActions(pageKey, options.actions),
      getMentions: getQuickAccessMentionDefinitions,
    });
  }

  wrap.appendChild(el);

  // Controls row — copy (+ edit, for user messages) — sits BELOW the
  // bubble as a sibling inside `wrap`, not layered inside/on top of the
  // bubble itself. Only created when there's at least one control to
  // show, so a bubble with neither (e.g. an assistant message that
  // somehow has no copy-able content) doesn't reserve empty space for
  // nothing.
  let controls = null;
  function ensureControls() {
    if (!controls) {
      controls = document.createElement("div");
      controls.className = `ai-agent-msg-controls ai-agent-msg-controls--${role}`;
      wrap.appendChild(controls);
    }
    return controls;
  }

  if (content) {
    addCopyButton(ensureControls(), content);
    if (role === "assistant") {
      addSpeakButton(ensureControls(), content);
    }
  }
  // Edit is only offered for user prompts with real text and a known
  // position in `history` (loadConversation's re-render also supplies
  // this — see below), and only when the caller actually wants
  // branching (onBranchConversation supplied) — otherwise the button
  // would be dead UI on pages that don't opt in.
  if (role === "user" && content && typeof historyIndex === "number" && onBranchConversation) {
    addEditButton(ensureControls(), el, historyIndex);
  }

  if (messagesEl.querySelector(".ai-agent-msg--empty")) {
    messagesEl.innerHTML = "";
  }
  messagesEl.appendChild(wrap);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  resetErrorDedup();
  return el;
}

function buildThinkingBlock(text) {
  const d = document.createElement("details");
  d.className = "ai-agent-thinking";
  const sum = document.createElement("summary");
  sum.className = "ai-agent-thinking-summary";
  sum.innerHTML = '<span>Thought process</span><svg class="ai-agent-thinking-chevron" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
  const body = document.createElement("div");
  body.className = "ai-agent-thinking-body";
  body.innerHTML = renderMarkdown(text);
  d.append(sum, body);
  return d;
}

function appendThinkingBlock(text) {
  const wrap = document.createElement("div");
  wrap.className = "ai-agent-msg-wrap ai-agent-msg-wrap--assistant";
  wrap.appendChild(buildThinkingBlock(text));
  messagesEl.appendChild(wrap);
}

  return { appendMessage, buildThinkingBlock, appendThinkingBlock };
}
