// =============================================================================
// public/src/features/home/youtube-split.js
// Two-pane layout shared by the playlist window (video | list/description) and
// the video window (video | description). The side pane's width is clamped and
// remembered per device. DOM only; the clamping maths is in youtube-window-utils.
// =============================================================================

import { clampSplit, readSplit, writeSplit } from "./youtube-window-utils.js";

function el(tag, className) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  return n;
}

/**
 * @param {HTMLElement} pane  flex row that holds `main`
 * @param {HTMLElement} main  the video column
 * @param {HTMLElement} side  the side column (list or description)
 * @returns {{divider: HTMLElement, show: () => void, hide: () => void, isShown: () => boolean}}
 */
export function attachSplit(pane, main, side) {
  const divider = el("div", "ytw-divider");
  divider.setAttribute("role", "separator");
  divider.setAttribute("aria-orientation", "vertical");
  divider.setAttribute("aria-label", "تغيير عرض اللوحة الجانبية");
  divider.tabIndex = 0;

  let listW = readSplit();
  const sideIsStart = () => side.getBoundingClientRect().left < main.getBoundingClientRect().left;
  const apply = (w) => {
    const total = pane.getBoundingClientRect().width;
    const v = total > 0 ? clampSplit(w, total) : w;
    pane.style.setProperty("--ytw-list-w", `${v}px`);
    return v;
  };
  pane.style.setProperty("--ytw-list-w", `${listW}px`);

  divider.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    divider.setPointerCapture?.(e.pointerId);
    pane.classList.add("is-splitting");
    const onMove = (ev) => {
      const r = pane.getBoundingClientRect();
      listW = apply(sideIsStart() ? ev.clientX - r.left : r.right - ev.clientX);
    };
    const onUp = () => {
      divider.removeEventListener("pointermove", onMove);
      divider.removeEventListener("pointerup", onUp);
      divider.removeEventListener("pointercancel", onUp);
      pane.classList.remove("is-splitting");
      writeSplit(listW);
    };
    divider.addEventListener("pointermove", onMove);
    divider.addEventListener("pointerup", onUp);
    divider.addEventListener("pointercancel", onUp);
  });
  divider.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const grow = (e.key === "ArrowRight") === !sideIsStart();
    listW = apply(listW + (grow ? 24 : -24));
    writeSplit(listW);
  });

  const show = () => {
    if (!main.parentNode) pane.append(main);
    if (!divider.isConnected) pane.append(divider);
    if (!side.isConnected) pane.append(side);
    pane.classList.add("has-side");
    requestAnimationFrame(() => { listW = apply(listW); });
  };
  const hide = () => {
    divider.remove();
    side.remove();
    pane.classList.remove("has-side");
  };
  return { divider, show, hide, isShown: () => side.isConnected };
}
