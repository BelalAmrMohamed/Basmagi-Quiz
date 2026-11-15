// =============================================================================
// rich-input/code-block-view.js
// Vanilla-DOM node view for code blocks: collapse/expand, a language menu, and
// download + copy buttons above the (syntax-highlighted, editable) code. Port
// of the 21st.dev component's React CodeBlockView.
// =============================================================================
import { icon } from "./icons.js";
import { codeFileName, downloadTextFile } from "../code-file.js";

// `value` is the highlight.js grammar name (what is stored on the node and
// written after the ``` fence). The first block is the original menu; the rest
// is alphabetical. Everything here is highlighted by lowlight's `common` set,
// except MATLAB, PowerShell, Dockerfile, Scala, Dart, Elixir, Haskell and
// Assembly, which come from the lazy-loaded hljs-extra.js pack (TOML uses the
// `ini` grammar through its alias). The "HTML" entry is the `xml` grammar.
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
  { label: "Arduino", value: "arduino" },
  { label: "Assembly (x86)", value: "x86asm" },
  { label: "C", value: "c" },
  { label: "Dart", value: "dart" },
  { label: "Diff", value: "diff" },
  { label: "Dockerfile", value: "dockerfile" },
  { label: "Elixir", value: "elixir" },
  { label: "Go", value: "go" },
  { label: "GraphQL", value: "graphql" },
  { label: "Haskell", value: "haskell" },
  { label: "INI", value: "ini" },
  { label: "Kotlin", value: "kotlin" },
  { label: "Less", value: "less" },
  { label: "Lua", value: "lua" },
  { label: "Makefile", value: "makefile" },
  { label: "Markdown", value: "markdown" },
  { label: "MATLAB", value: "matlab" },
  { label: "Objective-C", value: "objectivec" },
  { label: "Perl", value: "perl" },
  { label: "PHP", value: "php" },
  { label: "PowerShell", value: "powershell" },
  { label: "R", value: "r" },
  { label: "Ruby", value: "ruby" },
  { label: "Rust", value: "rust" },
  { label: "Scala", value: "scala" },
  { label: "SCSS", value: "scss" },
  { label: "Swift", value: "swift" },
  { label: "TOML", value: "toml" },
  { label: "VB.NET", value: "vbnet" },
  { label: "WebAssembly", value: "wasm" },
  { label: "YAML", value: "yaml" },
];

// Fence tags people (and the AI) commonly write -> the grammar names above.
const LANGUAGE_ALIASES = {
  js: "javascript", jsx: "javascript", ts: "typescript", tsx: "typescript", py: "python",
  html: "xml", htm: "xml", svg: "xml", sh: "bash", shell: "bash", zsh: "bash", text: "plaintext", txt: "plaintext",
  "c++": "cpp", cc: "cpp", cxx: "cpp", "c#": "csharp", cs: "csharp",
  yml: "yaml", md: "markdown", ps1: "powershell", pwsh: "powershell", docker: "dockerfile",
  hs: "haskell", ex: "elixir", exs: "elixir", asm: "x86asm", assembly: "x86asm", nasm: "x86asm",
  rs: "rust", rb: "ruby", kt: "kotlin", golang: "go", objc: "objectivec", vb: "vbnet",
  gql: "graphql", make: "makefile", patch: "diff", json5: "json", sc: "scala", pl: "perl",
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
  // Scroll events are captured from everything, including the menu's own list;
  // only close when something OUTSIDE the menu scrolls (page/chat behind it).
  const onScroll = (e) => { if (menu.contains(e.target)) return; close(); };
  function close() {
    menu.remove();
    trigger.setAttribute("aria-expanded", "false");
    trigger.classList.remove("is-open");
    document.removeEventListener("mousedown", onDown);
    document.removeEventListener("keydown", onKey);
    window.removeEventListener("resize", close);
    window.removeEventListener("scroll", onScroll, true);
    if (closeOpenMenu === close) closeOpenMenu = null;
  }
  document.addEventListener("mousedown", onDown);
  document.addEventListener("keydown", onKey);
  window.addEventListener("resize", close);
  window.addEventListener("scroll", onScroll, true);
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
  let downloadTimer = 0;

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

  // Icon-only (the header is tight in a narrow chat panel); the tooltip names
  // the file that will be saved, e.g. "Download code.py".
  const downloadBtn = document.createElement("button");
  downloadBtn.type = "button";
  downloadBtn.className = "rmci-codeblock-btn rmci-codeblock-btn--icon";
  downloadBtn.addEventListener("mousedown", (e) => e.preventDefault());

  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "rmci-codeblock-btn";
  copyBtn.setAttribute("aria-label", "Copy code");
  copyBtn.addEventListener("mousedown", (e) => e.preventDefault());

  right.append(langBtn, downloadBtn, copyBtn);
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
    const fileName = codeFileName(language, node.textContent);
    downloadBtn.setAttribute("aria-label", `Download ${fileName}`);
    downloadBtn.title = `Download ${fileName}`;
    if (!downloadTimer) downloadBtn.innerHTML = icon("download", 14);
  }

  collapseBtn.addEventListener("click", () => updateAttributes({ collapsed: !node.attrs.collapsed }));
  langBtn.addEventListener("click", () => {
    if (langBtn.classList.contains("is-open")) return closeOpenMenu?.();
    openLanguageMenu(langBtn, normalizeLanguage(node.attrs.language), (v) => updateAttributes({ language: v }));
  });
  downloadBtn.addEventListener("click", () => {
    const text = node.textContent;
    if (!text) return; // nothing to save yet
    downloadTextFile(codeFileName(normalizeLanguage(node.attrs.language), text), text);
    downloadBtn.innerHTML = icon("check", 14);
    downloadBtn.classList.add("is-done");
    clearTimeout(downloadTimer);
    downloadTimer = setTimeout(() => {
      downloadTimer = 0;
      downloadBtn.classList.remove("is-done");
      downloadBtn.innerHTML = icon("download", 14);
    }, 1500);
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
      clearTimeout(downloadTimer);
    },
  };
}
