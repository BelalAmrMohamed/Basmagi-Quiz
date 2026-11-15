// =============================================================================
// public/src/shared/code-file.js
// Maps a code block's language tag to a download file name ("code.py",
// "Main.java", "Dockerfile", ...) and saves text as a file.
//
// Shared by the Markdown engine (markdown.js, fenced-block "Download" button)
// and the rich input (rich-input/code-block-view.js).
//
// codeFileName() is deliberately self-contained — every lookup table lives
// inside it. export-to-quiz.js inlines it into exported quiz pages with
// .toString() (like detectLang & co. from markdown.js), where module-level
// constants would be undefined.
// =============================================================================

/**
 * @param {string} lang  fence tag / editor language value, any case ("py", "csharp", "xml", ...)
 * @param {string} [code] the block's source — only used to tell HTML/XML/SVG apart and to name Java files
 * @returns {string} a file name, e.g. "code.py"
 */
export function codeFileName(lang, code) {
  const key = String(lang || "").trim().toLowerCase();
  const text = String(code || "");

  // Files that are identified by their whole name, not an extension.
  const NAMED = {
    dockerfile: "Dockerfile", docker: "Dockerfile",
    makefile: "Makefile", make: "Makefile", mk: "Makefile",
  };
  if (NAMED[key]) return NAMED[key];

  const EXT = {
    js: "js", javascript: "js", mjs: "mjs", cjs: "cjs", jsx: "jsx",
    ts: "ts", typescript: "ts", tsx: "tsx",
    py: "py", python: "py",
    java: "java",
    cs: "cs", csharp: "cs", "c#": "cs",
    c: "c", h: "h",
    cpp: "cpp", "c++": "cpp", cc: "cpp", cxx: "cpp", hpp: "hpp", arduino: "ino", ino: "ino",
    go: "go", golang: "go",
    rs: "rs", rust: "rs",
    rb: "rb", ruby: "rb",
    kt: "kt", kotlin: "kt",
    swift: "swift",
    objectivec: "m", objc: "m",
    php: "php", "php-template": "php",
    scala: "scala", sc: "scala",
    dart: "dart",
    ex: "ex", exs: "exs", elixir: "ex",
    hs: "hs", haskell: "hs",
    lua: "lua",
    pl: "pl", perl: "pl",
    r: "r",
    matlab: "m",
    vb: "vb", vbnet: "vb",
    sql: "sql",
    sh: "sh", bash: "sh", shell: "sh", zsh: "sh", fish: "fish",
    ps1: "ps1", psm1: "psm1", psd1: "psd1", powershell: "ps1", pwsh: "ps1",
    asm: "asm", assembly: "asm", nasm: "asm", x86asm: "asm",
    css: "css", scss: "scss", less: "less",
    json: "json", json5: "json5",
    yml: "yml", yaml: "yml", toml: "toml", ini: "ini",
    graphql: "graphql", gql: "graphql",
    md: "md", markdown: "md",
    diff: "diff", patch: "patch",
    wasm: "wat",
    tex: "tex", latex: "tex",
    csv: "csv",
    html: "html", htm: "html", xml: "xml", svg: "svg",
  };
  let ext = EXT[key];

  // The editor's "HTML" option is stored as `xml` (highlight.js's name for the
  // grammar) and authors write ```xml for both markup kinds, so look at the
  // content before choosing between .html / .xml / .svg.
  if (key === "xml" || key === "html" || key === "htm") {
    const HTML_LIKE =
      /^\s*(?:<!doctype\s+html|<(?:html|head|body|div|span|p|h[1-6]|script|style|ul|ol|li|a|img|form|table|section|main|nav|header|footer|button|input|link|meta|label|textarea|select)\b)/i;
    if (/^\s*<svg\b/i.test(text)) ext = "svg";
    else if (/^\s*<\?xml/i.test(text)) ext = "xml";
    else ext = key === "xml" && !HTML_LIKE.test(text) ? "xml" : "html";
  }

  // `javac` insists that a public type lives in a file of the same name.
  if (ext === "java") {
    const m = text.match(
      /\bpublic\s+(?:(?:final|abstract|sealed|strictfp)\s+)*(?:class|interface|enum|record)\s+([A-Za-z_$][\w$]*)/,
    );
    return (m ? m[1] : "code") + ".java";
  }

  return "code." + (ext || "txt");
}

/**
 * Saves `text` as a UTF-8 file named `fileName` via a temporary object URL.
 * A trailing newline is added when missing, as editors/compilers expect.
 */
export function downloadTextFile(fileName, text, mime = "text/plain;charset=utf-8") {
  const body = text.endsWith("\n") ? text : text + "\n";
  const url = URL.createObjectURL(new Blob([body], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
