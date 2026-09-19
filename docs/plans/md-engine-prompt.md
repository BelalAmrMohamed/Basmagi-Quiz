I'm continuing work on a quiz app (basmagi-quiz). Please read these two files
carefully before doing anything — they contain the full context of what's
already done and what's left:

1. public/src/shared/markdown.js
2. public/src/shared/markdown-css.js
3. public/src/styles/markdown.css
4. public/src/features/export-quiz/export-to-quiz.js

CONTEXT: Part 1 of a two-part task (restoring drag-to-resize for inline media
in the markdown engine) is COMPLETE and tested — do not redo it. It added:
data-resize-key to every media element, _equipResizableMedia/_scanResizableMedia,
delegated pointer-event drag handlers + a MutationObserver (registered as a
module-load side effect in markdown.js), matching CSS in markdown.css and
markdown-css.js, and all new functions added to export-to-quiz.js's
.toString()-serialization block (which bakes markdown.js's functions into
standalone offline quiz exports — this pattern MUST be preserved for anything
new you add too, or exported quizzes will throw ReferenceErrors).

REMAINING TASK — Part 2 (not started):

Replace the markdown engine's custom JS text-direction detection with the
native HTML `dir="auto"` attribute, for performance. Also review the engine
for other "reinvented wheels" and replace with native HTML/CSS/browser APIs
where applicable (web search for modern equivalents if useful). Constraints:
minimum browser support is Chrome; do NOT alter or break existing functionality.

IMPORTANT — read before changing anything:

The direction-detection system in markdown.js (_ARABIC_REGEX, detectDirection,
_applyDirectionClass, _processByLine, _ownText, _processElement, scanDirections,
plus the .text-rtl/.text-ltr CSS classes they apply) is NOT private to this
file. It's a public API actively imported and called by:
  - quiz.js (scanDirections, multiple call sites)
  - result.js (scanDirections)
  - create-quiz.js (literal "text-rtl" class in a template string)
  - ai-agent-history.js (detectDirection, sets el.dir directly)
  - export-to-quiz.js — which ALSO .toString()-serializes detectDirection,
    scanDirections, _processElement, _processByLine, _applyDirectionClass,
    _ownText into standalone exported quiz HTML files, AND has its own
    separate hardcoded .text-rtl/.text-ltr CSS block (around line 930-945)
    that only sets `direction`, not `text-align`.

So this is not a simple delete-and-replace. You need to:
1. Decide what stays (the exported function names/signatures and the
   .text-rtl/.text-ltr class contract, since external files depend on them
   by name) vs. what gets simplified internally to use dir="auto" instead of
   manual per-line/per-element JS scanning.
2. Note: .text-rtl/.text-ltr in markdown.css/markdown-css.js currently just
   set `direction` + `text-align` (left/right) — this maps cleanly to
   dir="auto" plus CSS logical properties (text-align: start/end), which is
   the kind of "native equivalent" the task wants.
3. There's a legacy nuance: _LABEL_PREFIX_REGEX skips a hardcoded
   "Explanation:"/"Formal answer" prefix before detecting direction, so
   English labels don't force LTR on Arabic content that follows. I already
   checked — no current caller actually constructs those literal prefix
   strings before calling renderMarkdown anymore, so this looks like safely
   -removable legacy code, but verify this yourself with a fresh grep before
   relying on my finding.
4. Whatever you change, if it's one of the functions listed in
   export-to-quiz.js's serialization block (search for ".toString()" in that
   file), you MUST keep it self-contained (no closures over module state
   that isn't also serialized) and update the serialization block to match,
   the same way Part 1 did for the new resize functions.
5. Test with jsdom (available via `npm install jsdom --no-save`) the way
   Part 1 did — set up global.document/window/NodeFilter/etc., import
   markdown.js, and verify: Arabic text still gets RTL, English still gets
   LTR, mixed content, list items/table cells still get independent
   per-block direction, and nothing in quiz.js/result.js/create-quiz.js/
   ai-agent-history.js breaks. Clean up test files and any installed
   node_modules when done.

Also double check whether any other "reinvented wheel" in the engine (syntax
highlighting, table parsing, list nesting) is something the task intends to
be replaced too, or whether those are legitimately custom-format parsing that
has no native equivalent — I lean toward the latter but the person may want
your independent read on it.