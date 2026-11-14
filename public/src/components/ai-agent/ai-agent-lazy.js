// Lightweight stand-in for ai-agent.js's createAIAgentFab.
// The real AI agent (chat UI, tools, markdown, uploads: ~400 KB) is only
// downloaded the first time someone clicks the button, instead of on every
// page load. Markup/classes are identical to the real FAB so CSS and callers
// (fab.classList.add(...), appendChild) behave the same.
let agentModule = null;
function loadAgent() {
  // Resolve only once the window's CSS is ready too, so every caller
  // (FAB, attach launcher, lesson view) opens a fully styled window.
  agentModule ??= import("./ai-agent.js")
    .then(async (m) => { await m.ensureAIAgentStyles(); return m; })
    .catch((err) => {
      agentModule = null; // allow retry after a network failure
      throw err;
    });
  return agentModule;
}

export function createAIAgentFab(options = {}) {
  const fab = document.createElement("button");
  fab.type = "button";
  fab.className = "ai-agent-fab";
  fab.setAttribute("aria-label", "افتح الباشــمبصمج");
  fab.title = "الباشــمبصمج";
  fab.innerHTML = `<img src="/assets/images/el-bash-mebasmag--no-bg.png" alt="" class="ai-agent-fab-logo" aria-hidden="true">`;
  const warm = () => { loadAgent().catch(() => {}); };
  fab.addEventListener("pointerenter", warm, { once: true });
  fab.addEventListener("focus", warm, { once: true });
  fab.addEventListener("click", async () => {
    if (fab.getAttribute("aria-busy") === "true") return;
    fab.setAttribute("aria-busy", "true"); // CSS shows a spinner ring
    try {
      const m = await loadAgent();
      m.openAIAgentModal(options, fab);
    } catch (err) {
      console.error("[ai-agent] failed to load", err);
    } finally {
      fab.removeAttribute("aria-busy");
    }
  });
  return fab;
}

export { loadAgent as loadAIAgentModule };
