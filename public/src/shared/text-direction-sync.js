// ============================================================================
// public/src/shared/text-direction-sync.js
// Keeps the CSS `direction` of every <textarea dir="auto"> / <input dir="auto">
// in step with the language of its text.
//
// Why: in an RTL page those fields inherit `direction: rtl` and
// `unicode-bidi: plaintext`. English text then PAINTS left-to-right, but
// Chromium's Shift+Arrow handling still follows the element's RTL direction,
// so Shift+→ extends the selection to the left and Shift+← to the right
// (plain arrow navigation is unaffected). Giving the element the direction its
// text actually has makes selection behave natively again.
// ============================================================================

const RTL_CHAR = /[֐-ࣿיִ-﷿ﹰ-﻿]/;
const LTR_CHAR = /[A-Za-zÀ-ɏͰ-ϿЀ-ӿ]/;

/** "rtl" | "ltr" from the first strong character, or null when there is none. */
export function detectTextDirection(value) {
  for (const ch of String(value || "")) {
    if (RTL_CHAR.test(ch)) return "rtl";
    if (LTR_CHAR.test(ch)) return "ltr";
  }
  return null;
}

function sync(el) {
  if (!(el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement)) return;
  if (el.getAttribute("dir") !== "auto") return;
  const dir = detectTextDirection(el.value);
  if (dir) {
    if (el.style.direction !== dir) el.style.direction = dir;
  } else if (el.style.direction) {
    el.style.direction = "";
  }
}

let installed = false;
export function installTextDirectionSync() {
  if (installed || typeof document === "undefined") return;
  installed = true;
  document.addEventListener("input", (e) => sync(e.target), true);
  document.addEventListener("focusin", (e) => sync(e.target), true);
}

installTextDirectionSync();
