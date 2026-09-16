## Summary of investigation so far

I extracted the project and traced all three issues to root causes in the code. I ran out of tool budget before finishing the CSS width investigation (issue 3, second half), but here's everything confirmed:

### 1. `نسخ لامتحاناتي` — no animation, instant menu close, duplicate copies

**Root cause: missing `e.stopPropagation()`.**

In `root-view.js` and `category-view.js`, the course/folder card has `card.onclick = () => renderCategory(...)`. The dropdown's `copyMine`/`copyToMine` button (and its siblings `copyLink`, `shareLink`) never call `e.stopPropagation()` in their `onclick` handlers — unlike the identically-shaped buttons in `exam-card.js`, which all do. So the click bubbles up to the card and triggers navigation (`renderCategory()` rewrites `container.innerHTML`), destroying the menu and button mid-copy. That's why:
- The spinner/loading state never shows (DOM is torn down before it can render).
- The menu appears to "quit instantly."
- The copy (`copyCategoryTreeToUserQuizzes`, a detached async call) keeps running in the background and lands "after a while."

**Compounding bug — race condition enabling duplicates:** `hasSameLevelCollision()` is checked against an in-memory `userQuizzes` snapshot taken at the start of each call, and `getFromStorage`/`setInStorage` are synchronous, unguarded `localStorage` calls with no locking. If the user reopens the menu and clicks again before the first copy's `setInStorage` has landed, the second call reads the same stale snapshot, also passes the collision check, and also writes — producing multiple copies.

**Fix direction:** add `e.stopPropagation()` to every button inside these two dropdowns (matching `exam-card.js`'s pattern), and add a simple in-flight guard (e.g. disable/track a "copy in progress for this node" flag, or re-check collision against freshly-read storage right before the write) to close the race window.

### 2. Right-click menu vs. `.exam-more-btn` dropdown — both open at once

**Root cause: two independent overlay systems that don't know about each other.**

- `#userQuizContextMenu` (right-click menu) is closed only by a `document`-level `click` listener registered once in `initContextMenu()`.
- `.exam-more-btn`'s `onclick` (in `user-quiz-card.js`) calls `e.stopPropagation()` before opening `.exam-dropdown-menu` via `openExamDropdownMenu()`.
- Because propagation is stopped, that click never reaches the `document` listener that would hide `#userQuizContextMenu`.
- `openExamDropdownMenu()`'s own cleanup (`closeAllExamDropdownMenus()`) only removes `.exam-dropdown-menu` elements — it has no idea `#userQuizContextMenu` exists.
- Symmetrically, `showContextMenu()` never calls `closeAllExamDropdownMenus()` either.

Each system correctly closes duplicates *of itself* but neither closes the other.

**Fix direction:** make the two systems mutually aware — e.g. have `showContextMenu()` call `closeAllExamDropdownMenus()` before opening, and have `openExamDropdownMenu()` (or the `.exam-more-btn` handlers) hide `#userQuizContextMenu` before opening. Cleanest is probably a single shared "close any open overlay" helper both call first.

### 3. `.copyAiPromptBtn` arrow + button width in `.create-quiz-inline-modal`

**Arrow animation under `data-motion="reduced"`:** confirmed the interaction — `themes.css`'s high-performance mode forces `animation-duration: 0.001ms !important` and `animation-iteration-count: 1 !important` (not `animation: none`) on all non-excluded elements, including `.create-quiz-modal__prompt-hint-arrow`. The keyframe (`create-quiz-modal-arrow-bounce`) and the element's own `transition` on `transform`/`opacity` both remain technically "active" but compressed to near-zero duration, with no `animation-fill-mode` set. This is exactly the kind of setup that produces visible snapping/flicker or a stuck mid-bounce frame in real browsers (animation state and the coinciding CSS transition can race at sub-millisecond durations). This element should be added to the `:not(...)` exclusion list in `themes.css` (like `.ai-agent-typing`, spinners, etc. already are) so it's either fully suppressed or handled with an explicit `animation: none` override scoped to reduced motion, rather than relying on the generic near-zero-duration squash.

**Button too wide:** I did not find a conflicting/duplicate CSS rule — there's only one `.create-quiz-modal__copy-prompt-btn` definition, and the arrow span is `position: absolute` so it's out of flow and shouldn't affect the button's width. This looks like a genuine sizing/spacing issue in the single existing rule (`padding: 4px 10px`, `gap: 6px`, `font-size: 0.7rem` combined with the icon) rather than a code conflict — I was about to check the `.create-quiz-modal__header`/flex-parent context for a stretch cause when I ran out of tool calls. I'd want to load this in an actual browser/screenshot next to confirm whether it's a flex-stretch issue or just needs tighter padding.

---

### Proposed implementation plan

1. **Copy race + lost feedback (root-view.js, category-view.js)**
   - Add `e.stopPropagation()` to `copyMine`/`copyToMine`, `copyLink`, `shareLink` (and `unsubscribe`) handlers, mirroring `exam-card.js`.
   - Add a guard against overlapping copy calls for the same node (disable the trigger while `withCopyButtonLoadingState` is active is already done for the *button*, but doesn't prevent a second menu-open + click cycle from firing a fresh call — consider a small in-memory "copy in progress" set keyed by node id, checked before starting a new copy).
   - Optionally: re-read `userQuizzes` from storage immediately before each `setInStorage` write (read-modify-write closer together) to shrink the race window further.

2. **Overlay exclusivity (exam-dropdown-menu.js, user-quizzes-folders.js)**
   - Introduce a shared "close any open overlay" call that both `openExamDropdownMenu()` and `showContextMenu()` invoke before opening their own UI, so opening one always closes the other.

3. **Prompt button/arrow (themes.css, index.css)**
   - Add `.create-quiz-modal__prompt-hint-arrow` (and its `*`) to the reduced-motion exclusion list in `themes.css`, with an explicit reduced-motion rule (`animation: none` and instant `opacity: 0`/no transform) rather than relying on the generic 0.001ms squash.
   - Re-check/tighten `.create-quiz-modal__copy-prompt-btn` sizing (padding/gap) once confirmed visually; verify it isn't being stretched by `.create-quiz-modal__header`'s flex layout.

Let me know if you'd like me to proceed with implementing these fixes, or first visually confirm the arrow/button-width behavior in a live render before touching the CSS.