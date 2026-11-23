// =============================================================================
// public/src/features/home/connect-card.js
// «اربط مساعدك» hint rendered INSIDE the empty state of «محتواي» (root level,
// only when the user has no content at all). Shows the MCP server URL with a
// copy button and a link to the guide. Not shown anywhere else.
// =============================================================================

const MCP_URL = "https://basmagi-quiz.vercel.app/api/mcp";

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** @returns {HTMLElement} */
export function createConnectHint() {
  const el = document.createElement("div");
  el.className = "connect-hint";
  el.innerHTML = `
    <p>أو أنشئ محتواك من محاضراتك بالذكاء الاصطناعي: اربط Claude أو ChatGPT أو Gemini بالمنصة مرة واحدة بهذا الرابط، فيُحفظ ما يُنشئه هنا مباشرة.</p>
    <div class="connect-hint__url" dir="ltr">
      <code>${MCP_URL}</code>
      <button type="button" class="connect-hint__copy">نسخ</button>
    </div>
    <a class="connect-hint__link" href="/how-to-connect-mcp" target="_blank" rel="noopener noreferrer">شاهد شرح الربط</a>
  `;

  const copyBtn = el.querySelector(".connect-hint__copy");
  copyBtn.addEventListener("click", async () => {
    const ok = await copyText(MCP_URL);
    copyBtn.textContent = ok ? "تم النسخ" : "انسخ يدوياً";
    setTimeout(() => { copyBtn.textContent = "نسخ"; }, 2000);
  });
  return el;
}
