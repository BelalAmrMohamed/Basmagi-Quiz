// ============================================================================
// LESSON PANEL MANAGER — one shared open/close mechanism for lesson panels.
// ============================================================================
// Every popover/drawer registers its own toggle + panel pair here. The manager
// owns the cross-panel behavior: only one panel can be open at a time, an
// outside click closes the active panel, and Escape closes it too. Individual
// feature modules only provide the small open/close state adapter appropriate
// for their markup (hidden attribute, class-based drawer, etc.).

const registrations = new Set();
let installed = false;

function findRegistration(target, key) {
  for (const registration of registrations) {
    if (registration[key]?.contains?.(target)) return registration;
  }
  return null;
}

function closeAll(except = null) {
  registrations.forEach((registration) => {
    if (registration === except || !registration.isOpen()) return;
    registration.setOpen(false);
  });
}

function handleDocumentClick(event) {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;

  const toggleRegistration = findRegistration(target, "toggle");
  if (toggleRegistration) {
    event.preventDefault();
    const nextOpen = !toggleRegistration.isOpen();
    closeAll(toggleRegistration);
    toggleRegistration.setOpen(nextOpen);
    return;
  }

  const panelRegistration = findRegistration(target, "panel");
  if (panelRegistration) return;

  closeAll();
}

function handleDocumentKeydown(event) {
  if (event.key !== "Escape") return;
  closeAll();
}

function install() {
  if (installed) return;
  installed = true;
  // Bubble-phase click is intentional: button handlers inside a registered
  // panel are allowed to run normally, while the single manager handles the
  // toggle itself. The panel containment check then prevents accidental close.
  document.addEventListener("click", handleDocumentClick);
  document.addEventListener("keydown", handleDocumentKeydown);
}

/**
 * @param {{toggle: HTMLElement, panel: HTMLElement, isOpen:()=>boolean, setOpen:(open:boolean)=>void}} config
 * @returns {()=>void} unregister
 */
export function registerLessonPanel(config) {
  if (!config?.toggle || !config?.panel || typeof config.isOpen !== "function" || typeof config.setOpen !== "function") {
    return () => {};
  }
  install();
  registrations.add(config);
  return () => {
    registrations.delete(config);
  };
}

export function closeLessonPanels() {
  closeAll();
}
