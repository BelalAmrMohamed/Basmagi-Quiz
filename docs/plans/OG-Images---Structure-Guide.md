## Implementation plan

### Track 1 — Course & Folder OG image Arabic layout bugs

**First, a scoping question I can't resolve by reading code:** I couldn't visually render Satori's actual output here (no way to execute `@vercel/og` in this environment), so my diagnosis below is from static code reading + the specific corruption patterns visible in your screenshots — not a confirmed root cause for every line. Treat item 3 below as a hypothesis to verify, not a confirmed bug.

**Bug 1 — Folder title truncation breaks on Arabic (confirmed via code read):**
`truncateTitle()` (line 764-766) does a raw `.slice(0, maxChars-1)` on the source string before any bidi-aware processing, then appends `"…"`. For Arabic (RTL) text, the first N characters in storage order are the *visual end* of the sentence, not the start — slicing there and appending an ellipsis produces a truncation point and ellipsis placement that reads backwards/mid-phrase, exactly like image 2's garbled folder title.
- Fix: truncate Arabic titles from the *end of the visual reading order*, which for RTL storage-order text is actually the *start* of the string, not the end. Concretely: for Arabic, take `title.slice(-(maxChars - 1))` (last N chars in storage order) and prepend `"…"` rather than appending it — since RTL storage-order start = visual right edge = where "continues from earlier" reads naturally, and storage-order end = visual left edge = the natural place to see the phrase's true beginning. This needs to be verified visually once implemented, since bidi truncation is easy to get subtly backwards.
- Apply the same fix to `truncateDescription` if descriptions can be Arabic (check its call site — line 324 doesn't gate on `isArabic` currently).

**Bug 2 — Mixed-script `في <course name>` row (confirmed via code read):**
The parent-course line hardcodes `flexDirection: isArabic ? "row-reverse" : "row"` based on the *folder's* language, but the course name itself can be pure Latin (as in your screenshot: folder name is Arabic, course name "Data Structures and Algorithms" is Latin). Row-reversing a line whose two children have different intrinsic scripts produces the exact backwards look in image 2.
- Fix: compute a *separate* `isArabicCourseName = detectArabic(parentCourseLine)` and decide the row's flex direction based on that (or, more robustly, always keep "في"/"in" adjacent to its own natural reading position rather than reversing the whole row — e.g., render "في" then the course name in a row that's `row-reverse` only when *both* segments share the same script direction as the page).
- This is the same class of bug as Bug 1: script-direction assumptions computed once from the wrong source (`rawTitle`/folder) and applied to content with a different, independent script (course name, description, etc).

**Bug 3 (unconfirmed, flag for visual verification) — `نوع التعليم:` same-script label possibly still misrendering:**
Code reading didn't reveal an obvious mechanism for this specific line to break, since it's plain same-script Arabic with no mixed content and no truncation. Before spending implementation time here, actually render this course's OG image (regenerate it locally with `@vercel/og`'s dev tooling, or hit the live `/api/og?course=...` endpoint after Bug 1/2 fixes ship) and re-screenshot — it's possible this row was a visual side-effect of Bug 2's mis-reversed row above it shifting baseline/alignment, and simply disappears once Bug 2 is fixed, rather than being an independent third bug.

**Suggested order:** fix Bug 2 first (smaller, more mechanical, and its row sits directly above the questionable `نوع التعليم` row — good natural checkpoint to re-screenshot), then Bug 1, then re-verify Bug 3 is still reproducible before writing any fix for it.

---

### Track 2 — Move-to dialog guide

**Scoping question for you, not something I can resolve from the file alone:** the specific bug your bullet describes (`.move-to-dialog-rail` pieces visually disconnected) matches a bug that a code comment says was *already fixed* by replacing that exact class with `.move-to-dialog-branch` + `.move-to-dialog-elbow`, and I can't find any live reference to the old class anywhere in HTML/CSS/JS. Before I plan further work here, it'd help to know: is `image.png` (the YouTube-comments reference you mentioned but didn't upload) showing the dialog *after* this fix landed, or is this description based on an older observation? If the fix is already live and working, this track may just need the newer "context-map style" visual upgrade (see below) rather than a disconnection bug fix.

**If the disconnection bug is still actually reproducible** (i.e., the zip I have is ahead of what's deployed, or there's a residual seam at nested elbow/branch junctions specifically): I'd need an actual screenshot of the *current* rendered dialog to diagnose further — I can't tell from CSS alone whether `.move-to-dialog-elbow`'s stub genuinely meets `.move-to-dialog-branch`'s border pixel-for-pixel at every depth without seeing it rendered.

**The bigger ask — "context map" style redesign:**
This is a materially different visual target from "connected lines" — a context/dependency-map style diagram (per your `docs/map/context-map.md` reference, which I don't have access to render as an image, but the filename and framing suggest a node-and-edge graph layout) is a different UI paradigm from an indented tree-with-rails list. Concretely:
- An indented rail tree (current design) reads top-to-bottom, one path at a time, connectors are purely decorative scaffolding on an otherwise linear list.
- A context-map style view implies nodes as discrete boxes/cards connected by explicit edges, potentially non-linear layout (siblings side-by-side, not just stacked) — closer to an org chart or dependency graph than a file-tree UI.
- Worth deciding explicitly which one you actually want, since "YouTube comment threads" (still fundamentally a nested indented list, just with better-drawn connectors) and "context map of a project" (a graph-layout diagram) are quite different amounts of engineering effort — the former is a CSS/connector-geometry refinement on the existing `.move-to-dialog-branch` structure; the latter is closer to a new component built on something like a simple force-directed or manually-positioned node graph, which has real complexity around auto-layout, edge routing, and how deep folder nesting scales visually before it becomes unreadable as a graph.

**My suggestion:** given the existing `.move-to-dialog-branch`/`.move-to-dialog-elbow` system is recent, documented, and reasonably solid infrastructure, I'd treat "YouTube-comments-style connected lines" as an incremental polish pass on top of it (verify/fix any remaining elbow-to-branch seams, maybe soften corner radii where the elbow meets the branch line) — and treat the "context map" framing as a separate, much larger future redesign to scope only once you've confirmed that's really the direction you want over the tree-list paradigm, rather than bundling both into one plan.

---

**What I need from you to make Track 2 concrete:** a current screenshot of the move-to dialog as it renders today (not the OG images), so I can check whether `.move-to-dialog-branch`'s fix is actually working, and the actual `image.png`/`image-4.png` reference images if you want me to plan toward that specific target rather than guessing at what "context map" and "YouTube comments" mean from filenames alone.