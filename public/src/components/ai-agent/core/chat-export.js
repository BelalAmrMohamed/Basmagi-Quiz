export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

export function createExportHelpers({ getHistory, creatorCardModelSummary, resultCardModelSummary }) {
  function extractQuizTitle(value) {
    if (!value || typeof value !== "object") return "امتحان";
    for (const key of ["title", "name", "quizTitle", "quizName"]) {
      if (typeof value[key] === "string" && value[key].trim()) return value[key].trim();
    }
    for (const child of Object.values(value)) {
      if (child && typeof child === "object") {
        const title = extractQuizTitle(child);
        if (title !== "امتحان") return title;
      }
    }
    return "امتحان";
  }

  function sanitizeToolOutput(content) {
    if (typeof content !== "string") return String(content ?? "");
    if (content.startsWith("[CREATOR_CARD]")) return creatorCardModelSummary(content);
    const resultSummary = resultCardModelSummary(content);
    if (resultSummary !== content) return resultSummary;
    const trimmed = content.trim();
    const looksLikeQuizPayload = trimmed.startsWith("بيانات الامتحان") ||
      (trimmed.startsWith("{") && /questions|quiz|امتحان/i.test(trimmed)) ||
      (trimmed.length > 800 && /questions|quiz|امتحان|أسئلة/i.test(trimmed));
    if (!looksLikeQuizPayload) return content;
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    const jsonCandidate = firstBrace >= 0 && lastBrace > firstBrace
      ? trimmed.slice(firstBrace, lastBrace + 1)
      : trimmed.replace(/^بيانات الامتحان\s*:?\s*/i, "");
    try { return `[تم الحصول على بيانات امتحان: ${extractQuizTitle(JSON.parse(jsonCandidate))}]`; }
    catch {
      const titleMatch = content.match(/(?:title|name|اسم الامتحان)\s*["'=:]+\s*([^,"'{}\n]+)/i);
      return `[تم الحصول على بيانات امتحان: ${titleMatch?.[1]?.trim() || "امتحان"}]`;
    }
  }

  function getExportMessages() {
    return getHistory().map((message) => ({
      role: message.role,
      type: message.type || undefined,
      toolName: message.toolName || undefined,
      content: message.type === "tool-result" ? sanitizeToolOutput(message.content) : String(message.content ?? ""),
    }));
  }
  function getTranscript() {
    return getExportMessages().map((message) => {
      const label = message.type === "tool-result" ? "🔧 النظام" : message.role === "user" ? "أنت" : "الباشــمبصمج";
      return `${label}: ${message.content}`;
    }).join("\n\n");
  }
  function getHtmlExport() {
    const body = getExportMessages().map((message) =>
      `<article><strong>${escapeHtml(message.type === "tool-result" ? "النظام" : message.role === "user" ? "أنت" : "الباشــمبصمج")}</strong><p>${escapeHtml(message.content).replace(/\n/g, "<br>")}</p></article>`
    ).join("");
    return `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><title>محادثة الباشــمبصمج</title><style>body{font:16px/1.8 sans-serif;max-width:800px;margin:40px auto;padding:0 20px;color:#1f2937}article{border-bottom:1px solid #ddd;padding:12px 0}strong{color:#2563eb}</style><body>${body}</body></html>`;
  }
  function getJsonExport() { return JSON.stringify({ version: 1, messages: getExportMessages() }, null, 2); }
  return { extractQuizTitle, sanitizeToolOutput, getExportMessages, getTranscript, getHtmlExport, getJsonExport };
}
