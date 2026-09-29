// Shared geometry-based table-of-contents scroll spy.
// Both document ToCs and the lesson ToC use the same reference line, lock
// behavior and scroll/resize lifecycle so active-link behavior cannot drift.

export function createGeometryTocScrollSpy({
  targets,
  onActive,
  onNavigate,
  referenceOffset = null,
  markVisited = null,
}) {
  const items = Array.isArray(targets) ? targets.filter(Boolean) : [];
  if (!items.length) return () => {};

  const offset = referenceOffset ?? Math.max(96, Math.round(window.innerHeight * 0.18));
  items.forEach((target) => {
    target.style.scrollMarginTop = `${offset}px`;
  });

  const getId = (target) => target.dataset.sectionId || target.id;
  let lockedId = null;
  let unlockTimer = null;
  let ticking = false;
  let lastActiveId = null;

  const clearLock = () => {
    lockedId = null;
    if (unlockTimer) {
      clearTimeout(unlockTimer);
      unlockTimer = null;
    }
  };

  const computeActiveId = () => {
    let activeId = getId(items[0]);
    for (const target of items) {
      if (target.getBoundingClientRect().top - offset <= 0) activeId = getId(target);
      else break;
    }
    const doc = document.documentElement;
    if (window.innerHeight + window.scrollY >= doc.scrollHeight - 2) {
      activeId = getId(items[items.length - 1]);
    }
    return activeId;
  };

  const applyActive = (id) => {
    if (id == null || id === lastActiveId) return;
    lastActiveId = id;
    onActive?.(id);
    markVisited?.(id);
  };

  const scheduleUpdate = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      if (!lockedId) applyActive(computeActiveId());
      ticking = false;
    });
  };

  const lockTo = (id) => {
    lockedId = id;
    applyActive(id);
    clearTimeout(unlockTimer);
    unlockTimer = setTimeout(clearLock, 1000);
  };

  const handleWheel = () => clearLock();
  const handleTouchMove = () => clearLock();
  window.addEventListener("scroll", scheduleUpdate, { passive: true });
  window.addEventListener("resize", scheduleUpdate);
  window.addEventListener("wheel", handleWheel, { passive: true });
  window.addEventListener("touchmove", handleTouchMove, { passive: true });

  const cleanup = () => {
    window.removeEventListener("scroll", scheduleUpdate);
    window.removeEventListener("resize", scheduleUpdate);
    window.removeEventListener("wheel", handleWheel);
    window.removeEventListener("touchmove", handleTouchMove);
    clearTimeout(unlockTimer);
  };

  scheduleUpdate();
  return {
    lockTo,
    clearLock,
    cleanup,
    handleNavigate: (id, event) => {
      lockTo(id);
      onNavigate?.(id, event, clearLock);
    },
  };
}
