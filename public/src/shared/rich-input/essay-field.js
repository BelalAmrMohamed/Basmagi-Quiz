// =============================================================================
// rich-input/essay-field.js
// Turns essay answer <textarea data-essay-field> elements (quiz + lesson pages)
// into the shared rich markdown input, with voice dictation.
//
//   markup:  <textarea data-essay-field id=".." class=".." placeholder="..">saved markdown</textarea>
//   after inserting the markup:  mountEssayFields(containerElement)
//
// The textarea is replaced by the rich input's host element, which keeps the
// textarea's id and classes and the same members the pages already use:
//   host.value      plain text (use for "is it empty?")
//   host.markdown   the answer as markdown  <- store / grade this
//   host.disabled   lock it: stays rendered, read-only, toolbar + mic hidden
//   "input" event   fired on every user edit
// Calling mountEssayFields again is safe (already-mounted fields are skipped,
// and editors whose DOM was thrown away by a re-render are destroyed).
// =============================================================================
import { createRichInput } from "./rich-input.js";
import { attachDictation } from "./dictation.js";

const live = new Set();

export function mountEssayFields(root = document, { onError } = {}) {
  for (const inst of live) {
    if (!inst.el.isConnected) { inst.destroy(); live.delete(inst); }
  }
  root.querySelectorAll("textarea[data-essay-field]").forEach((ta) => {
    const rich = createRichInput({
      placeholder: ta.getAttribute("placeholder") || "",
      direction: "auto",
      maxHeight: 360,
      initialMarkdown: ta.value,
      hideControlsWhenDisabled: true,
    });
    const host = rich.host;
    host.id = ta.id;
    host.className += ` ${ta.className}`;
    const inline = ta.getAttribute("oninput");
    if (inline) host.setAttribute("oninput", inline); // legacy inline handler keeps working
    rich.el.classList.add("rmci-root--essay");
    attachDictation(rich, { onError });
    const disabled = ta.disabled;
    ta.replaceWith(rich.el);
    host.disabled = disabled;
    live.add(rich);
  });
}
