// =============================================================================
// rich-input/source-field.js
// Upgrades a markdown authoring <textarea> (create-quiz / create-lesson
// `.md-source`) into a flat Tiptap field in "source mode" (see rich-input.js):
// no per-field toolbar or bottom bar, no box of its own — the page's field
// wrapper draws the border, and the page's ONE global markdown bar formats
// whichever field has focus.
//
// The returned host element takes over the textarea's id / classes / dir and is
// textarea-compatible for the page code (value, selectionStart/End,
// setSelectionRange, focus, "input" events) plus `replaceRange()` for the bar.
// `value` is the exact markdown source — never parsed or re-serialised.
// =============================================================================
import { createRichInput } from "./rich-input.js";

const instances = new WeakMap(); // host element -> rich input instance
const live = new Set(); // hosts, so editors whose DOM a re-render threw away get destroyed

/** @param {HTMLTextAreaElement} textarea  @param {{maxHeight?: number, minHeight?: number}} [opts]  @returns {HTMLElement} the host */
export function mountSourceField(textarea, { maxHeight = 240, minHeight = 0 } = {}) {
  if (!textarea || !textarea.parentNode) return textarea;
  if (instances.has(textarea)) return textarea;
  sweep();
  const rich = createRichInput({
    sourceMode: true,
    placeholder: textarea.getAttribute("placeholder") || "",
    direction: "auto",
    maxHeight,
  });
  const host = rich.host;
  host.id = textarea.id;
  host.className += ` ${textarea.className}`;
  host.setAttribute("dir", textarea.getAttribute("dir") || "auto");
  if (minHeight) host.style.minHeight = `${minHeight}px`;
  host.value = textarea.value;
  host.disabled = textarea.disabled;
  textarea.replaceWith(rich.el);
  instances.set(host, rich);
  live.add(host);
  return host;
}

export function getSourceField(host) {
  return instances.get(host) || null;
}

function sweep() {
  for (const host of live) {
    const rich = instances.get(host);
    if (rich && !rich.el.isConnected) { rich.destroy(); instances.delete(host); live.delete(host); }
  }
}
