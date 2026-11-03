const CLEAR_OUTPUT_LABELS = new Set([
  "Clear cell output",
  "مسح مخرجات الخلية",
]);

const TEXT = {
  en: {
    clear: "Clear outputs",
    cleared: "Notebook outputs cleared.",
    failed: "Could not clear all outputs.",
  },
  ar: {
    clear: "مسح المخرجات",
    cleared: "تم مسح مخرجات الدفتر.",
    failed: "تعذر مسح جميع المخرجات.",
  },
};

let button;
let status;
let messageTimer;

function currentText() {
  const lang = document.getElementById("contentArea")?.lang || document.documentElement.lang;
  return TEXT[lang.toLowerCase().startsWith("ar") ? "ar" : "en"];
}

function getClearActions(root) {
  return [...root.querySelectorAll(".cell-menu-items button")]
    .filter((item) => CLEAR_OUTPUT_LABELS.has(item.textContent.trim()));
}

function updateControl(root) {
  const actions = root.querySelector("#actions");
  if (!actions) return;

  if (!button || !button.isConnected) {
    button = document.createElement("button");
    button.type = "button";
    button.id = "clear-notebook-outputs";
    button.addEventListener("click", () => clearOutputs(root));
    const runAll = actions.querySelector("#runall");
    if (runAll) runAll.after(button);
    else actions.append(button);

    status = document.createElement("span");
    status.className = "notebook-output-status";
    status.setAttribute("aria-live", "polite");
    status.hidden = true;
    button.after(status);
  }

  const text = currentText();
  button.textContent = text.clear;
  button.setAttribute("aria-label", text.clear);
  button.title = text.clear;
  button.disabled = getClearActions(root).length === 0;
}

function announce(message, isError = false) {
  if (!status?.isConnected) return;
  clearTimeout(messageTimer);
  status.hidden = false;
  status.textContent = message;
  status.setAttribute("role", isError ? "alert" : "status");
  status.classList.toggle("is-error", isError);
  messageTimer = window.setTimeout(() => {
    if (status?.isConnected) status.hidden = true;
  }, 4000);
}

function clearOutputs(root) {
  if (!button || button.disabled) return;

  button.disabled = true;
  try {
    const limit = root.querySelectorAll(".cell").length;
    for (let count = 0; count < limit; count += 1) {
      const action = getClearActions(root)[0];
      if (!action) break;
      action.click();
    }

    const remaining = getClearActions(root).length;
    if (remaining) {
      throw new Error(`${remaining} cell output(s) remain.`);
    }
    announce(currentText().cleared);
  } catch (error) {
    console.error("[notebook] could not clear all outputs:", error);
    announce(`${currentText().failed} ${error instanceof Error ? error.message : String(error)}`, true);
  } finally {
    updateControl(root);
  }
}

function observeRuntime() {
  const root = document.querySelector(".mlweb");
  if (root) updateControl(root);

  const observer = new MutationObserver((records) => {
    const runtimeRoot = document.querySelector(".mlweb");
    if (!runtimeRoot) return;
    if (!button?.isConnected || records.some((record) => record.target.id === "nb" || record.target.id === "actions")) {
      updateControl(runtimeRoot);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

observeRuntime();
