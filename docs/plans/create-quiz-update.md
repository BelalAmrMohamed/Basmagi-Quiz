## Context

You are working on the quiz creator page for an Arabic educational platform called بصمجي. The three key files are:
- `d:\Code projects\Websites\منصة إمتحانات بصمجي\public\create-quiz.html`
- `d:\Code projects\Websites\منصة إمتحانات بصمجي\public\src\features\create\create-quiz.js`
- `d:\Code projects\Websites\منصة إمتحانات بصمجي\public\src\features\create\create-quiz.css`

The page is RTL (Arabic), IBM Plex Sans Arabic. There is NO browser preview available — inspect code directly, reason carefully about layout from the CSS, and double-check every selector you touch is used consistently across all three files before changing it. The project runs on `npm run dev`.

## Goal

Reduce the overall **vertical height** of the quiz creator form (question cards, metadata cards, option rows, modals — everywhere content stacks vertically), without removing any actual functionality or data fields. This is a density pass, not a feature change.

## Tasks

### 1. Merge elements that don't need to be separate
Look for adjacent labels, headers, hint text, and containers that currently each take their own line/row but could share one. Common patterns to look for: a label directly above its input where they could sit inline or the label could become a smaller inline/floating label; a heading + description paragraph that could combine into one shorter line; a card header row that has room to also hold a control (e.g. a toggle or count) instead of stacking it below.

### 2. Delete elements/labels that are genuinely redundant
Look for: labels that just repeat what the input's placeholder or icon already communicates; helper/hint text that restates something obvious; wrapper divs with no styling purpose that just add vertical margin; duplicate headings where a parent section already labels the same thing.
**Caution:** don't delete anything that's the only accessible label for a form field (check for `aria-label`/`for` before removing a visible `<label>`) — convert it to visually-hidden instead of deleting outright if needed.

### 3. Shrink elements that are oversized
Look for hardcoded paddings/margins/min-heights on cards, buttons, and form groups that are larger than needed for the actual content (common leftover from earlier, roomier designs). Reduce `padding`, `margin-bottom`, `gap`, and `min-height` values where they're clearly generous rather than functional. Where a fixed height forces empty space (e.g. a textarea with a large fixed `rows` or `min-height` regardless of content), consider making it auto-sizing instead (`field-sizing: content`, a resize observer, or reducing the default `rows`).

### 4. Flatten deeply-nested repeating structures
The clearest example: each question's options (MCQ choices, true/false, etc.) are likely built from multiple nested wrapper elements per option (e.g. a wrapper div → a row div → a checkbox/radio → a label → an input → a delete button, each with their own padding/margin). Audit `renderQuestion`/`renderOptions`/`rerenderOptions` (or equivalent) in `create-quiz.js` and the corresponding CSS, and collapse each option down to the minimum number of wrapping elements needed (ideally one flex row per option) while keeping all controls (select/correct-marker, text input, delete button) functional and accessible. Apply the same audit to any other per-item repeating card (e.g. question cards themselves, template cards, entry-screen tiles) if they have similar unnecessary nesting.

### 5. Remove unnecessary separators/dividers
Look for `<hr>`, `.divider`, `border-top`/`border-bottom` rules, or empty spacer elements used purely to create a visual break between sections that are already visually distinct via card boundaries, background color, or spacing. Remove separators that don't add real information, keeping ones that meaningfully group related fields inside an already-large card.

### 6. Merge buttons into dropdowns where sensible
Look for rows of 3+ individual buttons performing related-but-infrequent actions (e.g. secondary/destructive actions on a question card, export options, etc.) that could collapse into a single "⋮" (more actions) button with a dropdown menu, similar to the pattern already used for the entry-screen tile menu (`.entry-item-menu`) or the top menu bar's dropdowns (`.menu-dropdown`). Don't collapse primary, frequently-used actions (e.g. "add option", "delete question" if it's a common action) — only genuinely secondary/rare ones.

## Constraints

- Do not remove any functionality — every action, field, and piece of data currently reachable must remain reachable after the change (moving it into a dropdown or making a label implicit is fine; deleting the capability is not).
- Do not break `aria-label`, `for`/`id` pairing, or keyboard shortcuts that already exist — carry them over to whatever replaces the old markup.
- Keep RTL correctness (`right`/`left`, `margin-right` vs `margin-left`, icon mirroring) intact for anything you touch.
- After each file edit, re-grep for the old class/id names you changed or removed to make sure no other reference (JS `getElementById`/`querySelector`, inline `onclick`, or another CSS rule) still depends on them.
- Work incrementally: do one category (e.g. all of #4's option-flattening) fully across HTML/JS/CSS before moving to the next, rather than touching all three files shallowly across every category at once.

## Deliverable

A summary at the end listing, per file, what was merged/deleted/shrunk/flattened/de-nested, so it can be spot-checked against the running dev server.