// =============================================================================
// rich-input/code-block-view.js
// Vanilla-DOM node view for code blocks: collapse/expand, a language menu and
// a copy button above the (syntax-highlighted, editable) code. Port of the
// 21st.dev component's React CodeBlockView.
// =============================================================================
import { icon } from "./icons.js";

export const CODE_LANGUAGES = [
  { label: "Plain text", value: "plaintext" },
  { label: "JavaScript", value: "javascript" },
  { label: "TypeScript", value: "typescript" },
  { label: "Python", value: "python" },
  { label: "HTML", value: "xml" },
  { label: "CSS", value: "css" },
  { label: "JSON", value: "json" },
  { label: "Bash", value: "bash" },
  { label: "C++", value: "cpp" },
  { label: "Java", value: "java" },
  { label: "C#", value: "csharp" },
  { label: "SQL", value: "sql" },
];

const LANGUAGE_ALIASES = {
  js: "javascript", jsx: "javascript", ts: "typescript", tsx: "typescript", py: "python",
  html: "xml", sh: "bash", shell: "bash", zsh: "bash", text: "plaintext", txt: "plaintext",
  "c++": "cpp", cc: "cpp", cxx: "cpp", "c#": "csharp", cs: "csharp",
};

const normalizeLanguage = (raw) => LANGUAGE_ALIASES[raw || "plaintext"] ?? (raw || "plaintext");

/** Closes any open language menu (there is at most one at a time). */
let closeOpenMenu = null;

function openLanguageMenu(trigger, current, onPick) {
  closeOpenMenu?.();
  const host = document.body;
  const r = trigger.getBoundingClientRect();
  const menu = document.createElement("div");
  menu.className = "rmci-menu rmci-lang-menu";
  menu.setAttribute("role", "menu");
  menu.dir = "ltr";
  menu.style.position = "fixed";
  menu.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;
  const below = window.innerHeight - r.bottom;
  if (below < 290 && r.top > below) menu.style.bottom = `${window.innerHeight - r.top + 4}px`;
  else menu.style.top = `${r.bottom + 4}px`;

  CODE_LANGUAGES.forEach((l) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "rmci-menu-item rmci-menu-item--compact";
    item.setAttribute("role", "menuitem");
    item.innerHTML = `<span class="rmci-menu-label">${l.label}</span>${l.value === current ? icon("check", 14) : ""}`;
    item.addEventListener("mousedown", (e) => e.preventDefault());
    item.addEventListener("click", () => { onPick(l.value); close(); });
    menu.appendChild(item);
  });

  const onDown = (e) => { if (!menu.contains(e.target) && !trigger.contains(e.target)) close(); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  function close() {
    menu.remove();
    trigger.setAttribute("aria-expanded", "false");
    trigger.classList.remove("is-open");
    document.removeEventListener("mousedown", onDown);
    document.removeEventListener("keydown", onKey);
    window.removeEventListener("resize", close);
    window.removeEventListener("scroll", close, true);
    if (closeOpenMenu === close) closeOpenMenu = null;
  }
  document.addEventListener("mousedown", onDown);
  document.addEventListener("keydown", onKey);
  window.addEventListener("resize", close);
  window.addEventListener("scroll", close, true);
  trigger.setAttribute("aria-expanded", "true");
  trigger.classList.add("is-open");
  host.appendChild(menu);
  closeOpenMenu = close;
}

/**
 * Tiptap `addNodeView` factory. Returns a ProseMirror NodeView.
 * @param {{ node: any, editor: any, getPos: () => number }} props
 */
export function createCodeBlockView({ node: initialNode, editor, getPos }) {
  let node = initialNode;
  let copyTimer = 0;

  const dom = document.createElement("div");
  dom.className = "rmci-codeblock";
  dom.dir = "ltr";

  const header = document.createElement("div");
  header.className = "rmci-codeblock-header";
  header.contentEditable = "false";

  const collapseBtn = document.createElement("button");
  collapseBtn.type = "button";
  collapseBtn.className = "rmci-codeblock-btn";
  collapseBtn.addEventListener("mousedown", (e) => e.preventDefault());

  const right = document.createElement("div");
  right.className = "rmci-codeblock-actions";

  const langBtn = document.createElement("button");
  langBtn.type = "button";
  langBtn.className = "rmci-lang-btn";
  langBtn.setAttribute("aria-haspopup", "menu");
  langBtn.setAttribute("aria-expanded", "false");
  langBtn.setAttribute("aria-label", "Code language");
  langBtn.addEventListener("mousedown", (e) => e.preventDefault());

  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "rmci-codeblock-btn";
  copyBtn.setAttribute("aria-label", "Copy code");
  copyBtn.addEventListener("mousedown", (e) => e.preventDefault());

  right.append(langBtn, copyBtn);
  header.append(collapseBtn, right);

  const pre = document.createElement("pre");
  pre.className = "rmci-codeblock-pre";
  const code = document.createElement("code");
  pre.appendChild(code);

  const fade = document.createElement("div");
  fade.className = "rmci-codeblock-fade";
  fade.contentEditable = "false";

  dom.append(header, pre, fade);

  function updateAttributes(attrs) {
    const pos = getPos();
    if (typeof pos !== "number") return;
    editor.view.dispatch(editor.view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs }));
  }

  function render() {
    const language = normalizeLanguage(node.attrs.language);
    const collapsed = !!node.attrs.collapsed;
    const label = CODE_LANGUAGES.find((l) => l.value === language)?.label ?? language;
    code.className = `hljs language-${language}`;
    pre.dataset.collapsed = String(collapsed);
    pre.classList.toggle("is-collapsed", collapsed);
    fade.hidden = !collapsed;
    collapseBtn.setAttribute("aria-label", collapsed ? "Expand code block" : "Collapse code block");
    collapseBtn.setAttribute("aria-expanded", String(!collapsed));
    collapseBtn.innerHTML = `${icon(collapsed ? "expand" : "collapse", 14)}${collapsed ? "Expand" : "Collapse"}`;
    langBtn.innerHTML = `${label}${icon("chevronDown", 12)}`;
    if (!copyTimer) copyBtn.innerHTML = `${icon("copy", 14)}Copy`;
  }

  collapseBtn.addEventListener("click", () => updateAttributes({ collapsed: !node.attrs.collapsed }));
  langBtn.addEventListener("click", () => {
    if (langBtn.classList.contains("is-open")) return closeOpenMenu?.();
    openLanguageMenu(langBtn, normalizeLanguage(node.attrs.language), (v) => updateAttributes({ language: v }));
  });
  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(node.textContent);
      copyBtn.innerHTML = `${icon("check", 14)}Copied`;
      copyBtn.classList.add("is-done");
      clearTimeout(copyTimer);
      copyTimer = setTimeout(() => {
        copyTimer = 0;
        copyBtn.classList.remove("is-done");
        copyBtn.innerHTML = `${icon("copy", 14)}Copy`;
      }, 2000);
    } catch {
      /* clipboard unavailable */
    }
  });

  render();

  return {
    dom,
    contentDOM: code,
    update(updated) {
      if (updated.type !== node.type) return false;
      node = updated;
      render();
      return true;
    },
    // Header/fade are chrome: ProseMirror must not treat their changes as edits
    // or let their clicks move the selection.
    ignoreMutation: (m) => m.type !== "selection" && !code.contains(m.target) && m.target !== code,
    stopEvent: (e) => header.contains(e.target),
    destroy() {
      clearTimeout(copyTimer);
    },
  };
}
