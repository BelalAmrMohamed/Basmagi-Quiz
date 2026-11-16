// =============================================================================
// rich-input/essay-field.js
// Turns essay answer <textarea data-essay-field> elements (quiz + lesson pages)
// into the shared rich markdown input, with the same voice dictation (mic +
// live volume wave) as the AI Agent chat.
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
import { createDictation } from "./dictation.js";

const live = new Set();

/** Destroys editors whose DOM was thrown away by a re-render. */
function sweep() {
  for (const inst of live) {
    if (!inst.el.isConnected) { inst.destroy(); live.delete(inst); }
  }
}

export function mountEssayFields(root = document, { onError } = {}) {
  sweep();
  root.querySelectorAll("textarea[data-essay-field]").forEach((ta) => mountEssayField(ta, { onError }));
}

/**
 * Replaces ONE textarea with the full rich markdown input (formatting toolbar,
 * mic + volume wave). Returns the rich-input instance (`rich.host` is the
 * textarea stand-in, `rich.destroy()` tears it down). Used directly by the
 * lesson comment forms, which manage their own lifetime.
 * @param {HTMLTextAreaElement} ta
 * @param {{ onError?: (msg: string) => void, maxHeight?: number, hideControlsWhenDisabled?: boolean, essay?: boolean }} [o]
 */
export function mountEssayField(ta, { onError, maxHeight = 360, hideControlsWhenDisabled = true, essay = true } = {}) {
  {
    const rich = createRichInput({
      placeholder: ta.getAttribute("placeholder") || "",
      direction: "auto",
      maxHeight,
      initialMarkdown: ta.value,
      hideControlsWhenDisabled,
    });
    const host = rich.host;
    host.id = ta.id;
    host.className += ` ${ta.className}`;
    const inline = ta.getAttribute("oninput");
    if (inline) host.setAttribute("oninput", inline); // legacy inline handler keeps working
    if (essay) rich.el.classList.add("rmci-root--essay");

    // Same mic + live volume wave as the AI Agent chat (shared dictation.js).
    const dictation = createDictation({
      getText: () => host.value,
      setText: (value) => {
        host.value = value;
        host.dispatchEvent(new Event("input", { bubbles: true })); // programmatic writes are silent
      },
      focus: () => rich.focus("end"),
      onError,
    });
    if (dictation.micBtn) rich.endSlot.appendChild(dictation.micBtn);
    rich.endSlot.appendChild(dictation.waveEl);

    const disabled = ta.disabled;
    ta.replaceWith(rich.el);
    if (dictation.firefoxWarningEl) rich.el.before(dictation.firefoxWarningEl);
    host.disabled = disabled;

    // Locking the answer (after "check") must also end a running dictation.
    const lockWatch = new MutationObserver(() => {
      if (host.disabled && dictation.isActive()) dictation.stop();
    });
    lockWatch.observe(rich.el, { attributes: true, attributeFilter: ["class"] });
    const destroy = rich.destroy;
    rich.destroy = () => {
      lockWatch.disconnect();
      dictation.stop();
      dictation.firefoxWarningEl?.remove();
      destroy();
    };
    live.add(rich);
    return rich;
  }
}
