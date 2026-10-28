// Short import links from the MCP connector: /create-quiz?draft=<code>
// The payload lives server-side for 72h (table import_drafts); no sign-in involved.
// Returns the draft as a JSON string (the same shape the old #data=base64 flow
// decoded to), or null when there is no ?draft= param. Throws a user-facing
// Error when the draft is missing/expired.

const DRAFT_RE = /^[2-9a-hj-km-np-z]{10}$/;

export function getDraftCodeFromUrl() {
  try {
    const q = new URLSearchParams(window.location.search).get("draft");
    if (q && DRAFT_RE.test(q)) return q;
    const h = new URLSearchParams(window.location.hash.slice(1)).get("draft");
    if (h && DRAFT_RE.test(h)) return h;
  } catch (_) { /* ignore */ }
  return null;
}

export async function fetchImportDraft(kind) {
  const code = getDraftCodeFromUrl();
  if (!code) return null;
  let res;
  try {
    res = await fetch(`/api/mcp/draft/${code}?kind=${encodeURIComponent(kind)}`, { cache: "no-store" });
  } catch (_) {
    throw new Error("تعذّر الاتصال بالخادم لتحميل الرابط المباشر. تحقق من الإنترنت وحاول مجدداً.");
  }
  if (res.status === 404) throw new Error("انتهت صلاحية هذا الرابط (يدوم 72 ساعة) أو لم يعد موجوداً. اطلب من Claude رابطاً جديداً.");
  if (res.status === 409) throw new Error("هذا الرابط يخص نوعاً آخر من المحتوى (امتحان/درس).");
  if (!res.ok) throw new Error("تعذّر تحميل الرابط المباشر.");
  const body = await res.json();
  return JSON.stringify(body.payload);
}
