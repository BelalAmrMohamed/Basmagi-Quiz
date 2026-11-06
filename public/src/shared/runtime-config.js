// =============================================================================
// public/src/shared/runtime-config.js
// What each notebook runtime accepts. New runtimes (Python, C++ …) add an entry here;
// import / sync / Drive code routes files through routeFile() and never hard-codes extensions.
// =============================================================================
export const RUNTIME_CONFIG = {
  matlab: {
    label: "MATLAB", global: "MLWebNotebook", base: "/assets/notebook-runtime/", kernel: "matlab",
    codeExts: [".m", ".ipynb"],                          // imported as notebook cells
    workspaceExts: [".png", ".jpg", ".jpeg", ".webp", ".gif"], // go to the workspace "Current Folder"
  },
  cpp: { label: "C++", global: "BasmagiCppNotebook", base: "/assets/notebook-runtime-cpp/", kernel: "xcpp17", codeExts: [".cpp", ".cc", ".cxx", ".h", ".hpp"], workspaceExts: [] },
};

const ext = (name) => { const m = String(name || "").toLowerCase().match(/\.[a-z0-9]+$/); return m ? m[0] : ""; };

/** @returns {"bundle"|"code"|"workspace"|"unsupported"} */
export function routeFile(runtime, name) {
  const n = String(name || "").toLowerCase();
  if (n.endsWith(".notebook.zip")) return "bundle";
  const cfg = RUNTIME_CONFIG[runtime] || RUNTIME_CONFIG.matlab;
  const e = ext(n);
  if (cfg.codeExts.includes(e)) return "code";
  if (cfg.workspaceExts.includes(e)) return "workspace";
  return "unsupported";
}

export const workspaceMime = (name) => ({ ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" }[ext(name)] || "application/octet-stream");
