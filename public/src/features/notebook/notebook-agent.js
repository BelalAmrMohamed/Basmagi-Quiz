// =============================================================================
// public/src/features/notebook/notebook-agent.js
// Mounts the AI Agent ("الباشــمبصمج") on the notebook page. Context + tools live in
// notebook-agent-tools.js; prompts and slash commands in components/ai-agent/.
// =============================================================================
import { createAIAgentFab } from "../../components/ai-agent/ai-agent.js";
import { NOTEBOOK_PAGE_SYSTEM_PROMPT } from "../../components/ai-agent/ai-agent-default-prompts.js";
import { NOTEBOOK_PAGE_SUGGESTED_PROMPTS } from "../../components/ai-agent/ai-agent-suggested-prompts.js";
import "../../components/ai-agent/ai-agent-actions.js";
import { NOTEBOOK_AGENT_TOOLS, buildNotebookContext, runNotebookTool } from "./notebook-agent-tools.js";

/** Mount the floating agent button. `getHandle` is lazy because the runtime mounts asynchronously. */
export function mountNotebookAgent({ getHandle, notebook, lang }) {
  if (document.querySelector(".notebook-agent-fab") || document.documentElement.classList.contains("embed-mode")) return null;
  const fab = createAIAgentFab({
    pageKey: "notebook",
    placeholder: lang === "ar" ? "اطلب من الباشــمبصمج مساعدتك في هذا الدفتر" : "Ask El-Bashmebasamag about this notebook",
    defaultSystemPrompt: NOTEBOOK_PAGE_SYSTEM_PROMPT,
    suggestedPrompts: NOTEBOOK_PAGE_SUGGESTED_PROMPTS,
    contextPrompt: () => {
      const handle = getHandle();
      return buildNotebookContext({ title: notebook.title, runtime: notebook.runtime, language: lang, cells: handle ? handle.describe() : [] });
    },
    enableTools: true,
    enableFileUpload: true,
    toolNames: NOTEBOOK_AGENT_TOOLS,
    onToolCall: (toolCall) => runNotebookTool(toolCall, { handle: getHandle(), runtime: notebook.runtime }),
  });
  fab.classList.add("notebook-agent-fab");
  document.body.appendChild(fab);
  return fab;
}
