// =============================================================================
// public/src/components/ai-agent/ai-agent-route.js
// Deep-link route for الباشــمبصمج ("the AI agent").
//
//   /ai-agent               canonical, shareable URL
//   /my-content/ai-agent    alias (same behaviour)
//
// Both load the normal «محتواي» (/my-content) SPA view and open the agent
// window already maximized. While the agent window is maximized on the
// my-content view, the address bar shows /ai-agent; restoring, minimizing or
// closing puts the previous URL back (history.replaceState — no new history
// entries, so Back/Forward never fight the window state).
//
// Server side, vercel.json rewrites both paths to api/render-ai-agent.js,
// which serves the SPA shell with the agent's own Open Graph thumbnail so
// shared links get a proper preview (crawlers don't run JS).
//
// Zero imports: loaded by both the lazy FAB path and the main bundle.
// =============================================================================

export const AI_AGENT_PATH = "/ai-agent";
const AI_AGENT_ALIAS = "/my-content/ai-agent";
const AGENT_TITLE = "الباشــمبصمج | منصة امتحانات بصمجي";

/** True for /ai-agent and /my-content/ai-agent (optional trailing slash). */
export function isAIAgentPath(pathname) {
  const p = String(pathname || "").replace(/\/+$/, "") || "/";
  return p === AI_AGENT_PATH || p === AI_AGENT_ALIAS;
}

// ── "Open on load" intent ────────────────────────────────────────────────────
// Decided once, at module load, from the URL the page was opened with. It is
// consumed by the first my-content render that can host the FAB, so later
// re-renders (folder navigation etc.) never re-open a window the user closed.
let pendingOpen = typeof location !== "undefined" && isAIAgentPath(location.pathname);

/** Returns true exactly once if the page was opened on an agent route. */
export function consumeAgentOpenIntent() {
  const v = pendingOpen;
  pendingOpen = false;
  return v;
}

/** True when a just-opened window should start maximized (deep-link open). */
let pendingMaximize = false;
export function requestMaximizedOpen() { pendingMaximize = true; }
export function consumeMaximizedOpen() {
  const v = pendingMaximize;
  pendingMaximize = false;
  return v;
}

// ── URL sync (only for the my-content "home" agent) ──────────────────────────
let savedUrl = null;
let savedTitle = null;

function fallbackUrl() {
  return "/my-content";
}

/** Maximized -> show /ai-agent in the address bar. */
export function enterAgentUrl() {
  try {
    if (isAIAgentPath(location.pathname)) {
      // Opened via the deep link: "previous" is the plain my-content view.
      savedUrl ??= fallbackUrl();
    } else {
      savedUrl = location.pathname + location.search + location.hash;
    }
    savedTitle ??= document.title;
    history.replaceState(history.state, "", AI_AGENT_PATH);
    document.title = AGENT_TITLE;
  } catch { /* history unavailable (sandboxed iframe, etc.) */ }
}

/** Restored / minimized / closed -> put the previous URL + title back. */
export function leaveAgentUrl() {
  try {
    if (isAIAgentPath(location.pathname)) {
      history.replaceState(history.state, "", savedUrl || fallbackUrl());
    }
    if (savedTitle != null) document.title = savedTitle;
  } catch { /* ignore */ }
  savedUrl = null;
  savedTitle = null;
}
