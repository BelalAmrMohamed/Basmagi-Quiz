export function toPersistedMessages(historyToPersist) {
  return historyToPersist.filter((message) => !message.hidden).map(({ role, content, attachments, type, toolName, toolCallId, toolCalls, isError, input, thinking }) => {
    const first = attachments?.[0];
    const firstLabel = first?.name || first?.title;
    return {
      role, content,
      ...(type ? { type } : {}),
      ...(toolName ? { toolName } : {}),
      ...(toolCallId ? { toolCallId } : {}),
      ...(Array.isArray(toolCalls) && toolCalls.length ? { toolCalls } : {}),
      ...(isError ? { isError: true } : {}),
      ...(input ? { input } : {}),
      ...(thinking ? { thinking } : {}),
      ...(firstLabel ? { attachmentName: firstLabel } : {}),
      ...(first?.kind ? { attachmentKind: first.kind } : {}),
      ...(first?.itemType ? { attachmentItemType: first.itemType } : {}),
      ...(first?.summary ? { attachmentSummary: first.summary } : {}),
    };
  });
}

export function serializeWireMessage(m, { expandPlatformAttachment, prependUndoNotes }) {
  if (m.role === "tool" || m.type === "tool-result") {
    return {
      role: "tool", toolCallId: m.toolCallId || `call_legacy_${m.toolName || "tool"}`,
      toolName: m.toolName || "tool", content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      isError: !!m.isError,
    };
  }
  const fileAttachments = (m.attachments || []).filter((a) => a.kind === "file" || (!a.kind && a.base64))
    .map(({ mimeType, base64, name }) => ({ mimeType, base64, name }));
  const platformAttachments = (m.attachments || []).filter((a) => ["quiz", "lesson", "course", "folder"].includes(a.kind));
  const expandedContext = platformAttachments.map(expandPlatformAttachment).join("\n\n");
  let effectiveContent = expandedContext ? [m.content, expandedContext].filter(Boolean).join("\n\n") : (m.content || "");
  if (m.isSlashCommand || (m.role === "user" && typeof effectiveContent === "string" && effectiveContent.trim().startsWith("/"))) {
    const cmdName = m.slashCmdName || effectiveContent.trim().match(/^\/([^\s]+)/)?.[1] || "";
    const directive = m.slashDirective || "نفّذ المطلوب واستدعِ الأداة فوراً دون طلب تأكيد";
    effectiveContent = `${effectiveContent}\n\n[توجيه تنفيذي مباشر: هذا طلب صريح ومباشر عبر أمر Slash (/${cmdName}). ${directive}].`;
  }
  if (m.role === "user" && Array.isArray(m.undoNotes) && m.undoNotes.length) effectiveContent = prependUndoNotes(effectiveContent, m.undoNotes);
  const out = { role: m.role, content: effectiveContent };
  if (fileAttachments.length) out.attachments = fileAttachments;
  if (Array.isArray(m.toolCalls) && m.toolCalls.length) out.toolCalls = m.toolCalls;
  return out;
}
