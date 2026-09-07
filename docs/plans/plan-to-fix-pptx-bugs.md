# Plan: Fix all remaining PPTX export bugs

Scope: `public/src/features/export/export-to-pptx.js` only (~1460 lines).
None of these items were touched in the previous session (media CSS /
settings panel / PDF work) — this plan starts fresh against the file as it
exists in the zip right now. Line numbers below are from that current
state and will drift after each fix lands, so re-grep the anchor strings
(quoted in each item) rather than trusting the numbers once edits start.

Ground rules carried over from the parent plan (`plan-to-update-exports.md`):
- Do NOT touch `export-to-word.js`.
- Windows/`file:///`-opened downloads must keep working — no logic that
  assumes `https://` (relative fetches, `window.location.origin` without a
  fallback, etc.).
- If any fix touches a large serialized/templated block again elsewhere in
  the export pipeline, re-run a dependency audit — not applicable to this
  file specifically (pptx isn't a serialized-functions file like
  `export-to-quiz.js`), but keep the habit in mind if a shared helper gets
  extracted.

Suggested order below is dependency-aware: multi-correct and contrast are
fully independent and safe to do first/in parallel; empty-slides and
progress-granularity touch the same `maybeNewSlide`/chunking machinery so
should be done together; media placeholders and the overflow/markdown-
detection fix both touch the question-image/question-text region and are
easiest to reason about back-to-back; two-column layout is the most
self-contained but also the fiddliest, so it's last.

---

## 1. Multi-correct-answer support

**Bug:** `question.correct` can be an array (e.g. `[0, 2]`) for
multi-select questions, but every comparison in this file treats it as a
scalar, so multi-select questions render with zero options marked correct
and the status badge always reads WRONG (or SKIPPED) even when the user
got a genuinely multi-select question right.

**Where:**
- Line ~1236: `const correctIdx = question.correct ?? question.answer;`
  then line ~1247: `const isCorrect = idx === correctIdx;` — the per-option
  correctness check.
- Line ~1040: `userAns === (question.correct ?? question.answer)` — the
  CORRECT/WRONG status badge, which also assumes `userAns` is a scalar.

**Fix:**
- Add one small helper near the top of the function (alongside
  `sanitizeText`/`hasMarkdownOrMath`, ~line 193 area) rather than inlining
  the array-check twice:
  ```js
  const isOptionCorrect = (correctValue, idx) =>
    Array.isArray(correctValue) ? correctValue.includes(idx) : idx === correctValue;
  ```
- Replace line ~1247 with:
  ```js
  const isCorrect = isOptionCorrect(correctIdx, idx);
  ```
- For the status badge (~line 1040), multi-select correctness means the
  user's answer (which — check `isEssayQuestion`/answer-recording code in
  `shared/rate-answers.js` or wherever `userAnswers[index]` is populated
  for multi-select — is likely itself an array or a single index picked
  from a multi-select UI; **confirm the actual shape of `userAns` for a
  multi-select question before writing this comparison**, since guessing
  wrong here silently reintroduces the same bug in a different spot). Once
  confirmed, the comparison becomes either:
  - array vs array (set equality, order-independent), or
  - if the UI only ever lets the user pick one option even for
    multi-correct questions (i.e. "any one of several correct answers"
    rather than true multi-select), then `isOptionCorrect(correctIdx,
    userAns)` is the fix and no array-vs-array logic is needed at all.
  Do not assume — grep `shared/rate-answers.js`'s `calculateQuizMetrics`
  and the live quiz-taking UI's answer-recording code first; whichever
  shape they use is the shape this file must match, since a mismatch here
  would make the exported PPTX disagree with the score the user actually
  saw on the results page.

**Test:** Build a quiz with at least one question where
`question.correct = [0, 2]`; export from both the create-quiz page
(no `userAnswers`, just answer-key mode) and the results page (with a
`userAnswers` entry that matches all of, some of, and none of the correct
set) — confirm the badge and option highlighting agree with what
`result.html` shows for the same question.

---

## 2. Contrast sweep (remaining unreadable text)

**Bug:** Several `addText`/table-cell calls set `fill` without a paired
explicit `color`, so PptxGenJS/PowerPoint falls back to a default text
color that can end up matching (or nearly matching) the fill — white-on-
white, gray-on-white, or black-on-black in code blocks. Several instances
are already patched (search `// Fix #2a` / `// Fix #2b` — currently 9
occurrences across the score-table and explanation-label code), but the
plan doc flagged this as "finish the remaining ones."

**Where to look (in order of risk):**
1. **`renderTextToImage`'s off-screen CSS** (~lines 291–311) — this is the
   one explicitly called out as needing a re-check, since "black on black
   code blocks" was a reported symptom and this function's `pre`/`code`
   rules are what actually render fenced code blocks into the PNG that
   gets embedded. Current rule:
   ```css
   pre{background:#1e293b;color:#e2e8f0; ...}
   ```
   This looks correct in isolation (light text on dark background) — so
   if black-on-black is still reproducible after this, the actual cause
   is likely the **wrapper's own `color`** (set from the caller's
   `textHex` param, ~line 276: `color: \`#${textHex}\`` on the wrapper)
   bleeding through in some nested context where `pre`'s `color: #e2e8f0`
   isn't specific enough to win, OR a caller is passing a dark `textHex`
   alongside a dark `bgHex` for the *outer* block that happens to contain
   a code fence — check every call site of `renderTextToImage` /
   `addRichBlock` for `bgHex`/`colorHex` pairs that are both dark, not
   just the CSS itself.
2. **Every remaining bare `fill:` without a sibling `color:`** — do a
   fresh `grep -n "fill:" export-to-pptx.js` after the multi-correct fix
   lands (line numbers will have shifted) and manually check each result;
   don't trust the `Fix #2a` comments to mean "this file is now
   exhaustively covered" — they mark spots that were fixed *when found*,
   not a guarantee of completeness.
3. **The options-rendering block** (~lines 1250–1360): `highlightBg` is
   set to `COLORS.correctBg` / `COLORS.userWrong` / `COLORS.surface`
   depending on state, and the plain-text path (~line 1345) does supply
   `color: COLORS.textDark` unconditionally — good — but the
   markdown/math image path (~line 1268) passes `bgHex: highlightBg` into
   `renderTextToImage` without an explicit `textHex`, meaning it silently
   falls back to that function's own default (`COLORS.textDark`). Confirm
   `COLORS.textDark` is actually dark enough to read on **all three**
   possible `highlightBg` values (`correctBg`, `userWrong`, `surface`) —
   if `userWrong` or `correctBg` are themselves mid-tone colors, textDark
   might be a poor default for those combinations specifically, even
   though it's fine on `surface`.

**Fix:** Pair every `fill` with an explicit `color` chosen against that
*specific* fill (not a global default), and pass explicit `textHex` into
every `renderTextToImage`/`addRichBlock` call whose `bgHex` isn't plain
white, rather than relying on the function's own default.

**Test:** Export a quiz with at least one code block inside a
question/option/explanation, plus a results-mode export where at least
one question shows all three highlight states (correct/user-wrong/
neutral) in the same deck — open the resulting .pptx in actual
PowerPoint (or LibreOffice Impress) and visually check every text
element against its background, not just the ones the bug report
happened to mention.

---

## 3. Empty slides

**Bug:** `maybeNewSlide(neededH)` (~line 896) creates a brand new slide
via `addContentSlide()` (~line 480, which itself calls `pptx.addSlide()`
unconditionally) whenever the *estimated* remaining content won't fit.
Because these are all height *estimates* (`estimateTextHeight`,
`img.heightIn`, etc.), it's possible for a continuation slide to be
created defensively and then have less content actually drawn onto it
than expected — or, in the multi-correct/contrast fixes above, an edge
case where a slide is created but an early `return`/`catch` in a
`try` block (e.g. line ~1139's `catch (err)` for a failed image load)
means nothing else gets added before the loop moves to the next
question, which itself calls `addContentSlide()` again unconditionally
at the top (~line 887) — so a slide can end up genuinely blank.

**Where:** `maybeNewSlide` (~line 896) and the top of the per-question
loop (~line 887: `let slide = addContentSlide();`).

**Fix approach — track whether anything was actually drawn on the
current slide, and clean up empty ones after the fact:**
1. PptxGenJS doesn't expose a "was anything added to this slide" query
   directly, so track it manually: introduce a `let contentDrawnOnSlide =
   false;` flag alongside `let slide = addContentSlide();` (~line 887),
   set it to `true` at the *start* of every place that adds real
   content (question image, question text, options, explanation, essay
   answer/score block) — not inside `maybeNewSlide` itself, since
   `maybeNewSlide` only decides *whether* to create a slide, it doesn't
   know if content will actually follow.
2. Every time `maybeNewSlide` creates a **new** slide (i.e. the `if`
   branch at line 897 fires), it implicitly means "the previous slide is
   now considered finished" — at that point, if `contentDrawnOnSlide` is
   still `false` for the slide being replaced, that slide has header/
   footer/background chrome only and nothing else. Delete it via
   PptxGenJS's slide-removal API before creating the replacement (check
   the installed `pptxgenjs@3.12.0`'s docs/typings for
   `pptx.removeSlide()` or equivalent — if no direct removal API exists
   in this version, an alternative is to **defer** calling
   `addContentSlide()` until the first real content write, i.e. make
   `slide` lazily-initialized: `let slide = null;` at loop start, and
   have every content-adding call go through a `getSlide()` accessor that
   creates-if-null instead of eagerly creating at line 887 and again
   inside `maybeNewSlide`). The lazy-accessor approach is safer if the
   library has no slide-removal call, since it avoids ever creating a
   slide speculatively in the first place, rather than creating-then-
   deleting.
3. Apply the same lazy pattern inside `maybeNewSlide`'s own continuation-
   slide creation (~line 898) so a continuation slide reserved
   "defensively" for content that estimation predicted wouldn't fit,
   but that ends up fitting anyway on the original slide, is never
   created to begin with. This requires restructuring `maybeNewSlide` to
   not eagerly call `addContentSlide()` — instead have it just record
   "the next content write needs a fresh slide" and let the lazy
   accessor honor that flag.
4. Re-verify the CTA slide (~line 1396, `addContentSlide()` unconditional)
   and title slide (~line 491) are unaffected — they always have content
   immediately after creation in the current code, so they're not part of
   this bug, but confirm they still render correctly once `addContentSlide`
   semantics change (if the lazy-accessor refactor changes its signature/
   behavior, every direct caller needs re-checking, not just the
   per-question loop).

**Test:** Build a quiz that reliably hits the estimation-vs-actual gap —
e.g. a mix of very short True/False questions immediately followed by a
question with a large image, so several `maybeNewSlide` calls fire in
sequence — export and manually count slides vs. questions; there should
be no slide with only the header/footer/background and no question
content. Also test the "failed image load" path (point a question's
`image` at a URL that will 404) to confirm the `catch` branch at line
~1139 doesn't leave a dangling empty slide before falling back to
text-only rendering.

---

## 4. Long-question overflow + markdown-detection misses

**Bug (two symptoms, possibly two separate root causes — get a repro
string from the user if at all possible before guessing further):**
(a) a long question's text gets cut off, and (b) separately, text that
*should* have been markdown-rendered wasn't.

**Where:** `hasMarkdownOrMath` (~line 208) is the single gate deciding
image-path (`renderTextToImage`) vs. native-text path
(`estimateTextHeight` + `addText`) for every rich-text block in the file
(question text via `addRichBlock`, options, essay answers, explanations).

**Fix — harden both independently, since either could be the cause and
they're cheap to both fix regardless:**

1. **`hasMarkdownOrMath` regex gaps.** Current regex:
   ```js
   /\$|[*_]{1,3}[^\s]|~~[^\s]|`|^#{1,6}\s|^\s*[-*+]\s|^\s*\d+\.\s|\|/m
   ```
   Cross-check this against **every** markdown syntax the create-quiz
   editor actually allows — don't assume this list is exhaustive. Check
   `shared/markdown.js`'s `_renderMarkdownCore`/`renderMarkdown` for
   syntax it handles that this regex doesn't test for. Concrete gaps to
   check for specifically:
   - Reference-style or bracketed links `[text](url)` — no `[`/`]`/`(`
     pattern in the regex at all.
   - Images `![alt](url)` — same gap.
   - Blockquotes `> text` — no `^\s*>` pattern (the off-screen CSS at
     line ~302 explicitly styles `blockquote`, so the renderer supports
     it, meaning this is very likely a real gap, not just theoretical).
   - Multi-`$$`-block display math spanning multiple lines — the `m`
     flag makes `^`/`$` match per-line, but `\$` alone should still catch
     any single `$`, so this is probably fine; double check block math
     that uses a different delimiter convention if the editor supports
     one (e.g. `\[...\]`).
   - HTML entities or raw inline HTML the editor might pass through.
   Add any confirmed-missing token patterns to the regex.

2. **`estimateTextHeight`'s formula for long plain strings.** (~line 223)
   The formula assumes a fixed average-character-width ratio (`0.55 × em`)
   and a flat `+20%`-ish safety margin (the docstring says "+20%" but the
   actual implementation only adds a flat `+0.1` inches, not a
   percentage — re-read the code vs. its own docstring, they've drifted:
   the comment describes a proportional safety margin that isn't what the
   code does). For **long** strings specifically, small per-line
   under-estimates compound over many lines, so a flat `+0.1in` safety
   margin that might be fine for a 2-line string is negligible for a
   20-line one. Fix: make the safety margin scale with line count, e.g.
   `lines * lineHeightIn * 1.08 + 0.1` (an actual ~8% per-line margin
   instead of a fixed constant), and reconcile the docstring to match
   whatever the real formula ends up being so this drift doesn't happen
   again.
   Also double-check `charsPerLine`'s `0.55 × em` constant against the
   actual font PptxGenJS renders with by default — if the deck's real
   body font is wider than assumed, every estimate is systematically low
   regardless of string length, which would explain cutoffs that
   correlate with question length rather than with any specific markdown
   syntax.

3. **Instrument, don't just guess.** Since this bug was reported without
   a repro string, add a `console.warn` (dev-only, or gated behind an
   existing debug flag if one exists in this codebase — check for one
   before adding a new one) whenever `estimateTextHeight`'s result is
   within some small margin of causing a `maybeNewSlide` break, so if the
   bug recurs during the verification pass, the actual failing string and
   its estimated-vs-needed height are both visible in the console instead
   of requiring another blind guess.

**Test:** Construct a question with: (a) a long blockquote, (b) a long
plain paragraph (300+ chars, no markdown at all) at a small font size to
maximize line count, (c) an inline link. Export and confirm all three
render fully, wrap correctly, and (a)/(c) go through the image path while
(b) stays on the fast native-text path (check via the console
instrumentation above, or a temporary log, during testing — remove
before shipping if it's not gated behind a debug flag).

---

## 5. Uneven two-column option layout

**Bug:** `useTwoCols` (~line 1240, active when `options.length > 3` and
no option has markdown/math) alternates options A/C/E/G/I into column 1
and B/D/F/H/J into column 2. Each option's height is computed
independently (`estimateTextHeight(plain, 12, colWidth - 0.2)`,
~line 1322), so if e.g. option A is short and option B is long, column
2's row 1 is taller than column 1's row 1 — but every subsequent row's Y
position is still computed by naive accumulation, not by tracking each
column's *own* running height, so later rows misalign vertically between
the two columns (matches the reported screenshot).

**Where:** The `col`/`row`/`optY` calculation (~lines 1326–1359).
Current logic, condensed:
```js
const col = idx % 2;
const row = Math.floor(idx / 2);
if (col === 0) maybeNewSlide(optH + 0.06);
const optX = MARGIN + col * (colWidth + 0.2);
const optY = useTwoCols && col === 1
  ? currentY - (optH + 0.06)   // assumes col 1's optH equals col 0's optH — wrong when they differ
  : currentY;
slide.addText(plain, { x: optX, y: optY, w: colWidth, h: optH, ... });
if (!useTwoCols || col === 1 || idx === options.length - 1) {
  currentY += optH + 0.06;      // advances by the LAST option's height, not the row's tallest
}
```
Two compounding bugs: (1) `optY` for column 1 assumes column 1's height
equals column 0's height in the same row (it subtracts `optH` — column
1's own height — from `currentY`, which was already advanced by column
0's height at the *previous* iteration's `maybeNewSlide` call, not by
this row's actual max); (2) `currentY` advances by whichever option was
rendered last in the row (`col === 1`'s `optH`), not by
`Math.max(colHeightLeft, colHeightRight)`.

**Fix — compute both cells' heights before drawing either:**
Restructure the loop to process options in pairs (row-major) instead of
one at a time:
```js
for (let row = 0; row * 2 < options.length; row++) {
  const leftIdx = row * 2;
  const rightIdx = row * 2 + 1;
  const hasRight = rightIdx < options.length;

  const leftText = `${String.fromCharCode(65 + leftIdx)}. ${sanitizeText(String(options[leftIdx]))}`;
  const leftH = Math.max(estimateTextHeight(leftText, 12, colWidth - 0.2), 0.35);

  let rightText = "", rightH = 0;
  if (hasRight) {
    rightText = `${String.fromCharCode(65 + rightIdx)}. ${sanitizeText(String(options[rightIdx]))}`;
    rightH = Math.max(estimateTextHeight(rightText, 12, colWidth - 0.2), 0.35);
  }

  const rowH = Math.max(leftH, rightH);
  maybeNewSlide(rowH + 0.06);

  // draw left cell at (MARGIN, currentY, colWidth, rowH) — use rowH, not leftH,
  // so both cells in the row are the same drawn height even if their text is shorter
  // draw right cell at (MARGIN + colWidth + 0.2, currentY, colWidth, rowH) if hasRight

  currentY += rowH + 0.06;
}
```
This needs the existing per-option highlight-state logic (`isCorrect`,
`isUserSel`, `highlightBg`/`borderColor`/`borderWidth` computation,
~lines 1250–1262) pulled into a small per-option helper that returns the
box styling, called once for `leftIdx` and once for `rightIdx`, so the
row-pair restructuring doesn't have to duplicate that logic inline twice.
Keep the existing markdown/math branch (`anyMdOrMath`, image-based
rendering) completely separate — this fix only applies to the plain-text
`useTwoCols` path, since the markdown path already disables two-column
layout entirely (`useTwoCols = !anyMdOrMath && options.length > 3`).

**Test:** A question with 6+ short, plain-text options where lengths vary
noticeably (e.g. "Yes" vs. a full sentence) in a pattern that would have
broken the old alternating logic — confirm every row's two cells are the
same height and the row below starts at a consistent Y regardless of the
row above's content length. Also test an odd option count (5, 7) to
confirm the last unpaired option in the final row renders correctly
without a phantom empty right cell.

---

## 6. Video / audio / YouTube handling

**Bug:** No handling at all today — PPTX can't embed remote playable
video/audio, and no placeholder or link is drawn, so the slide simply
lacks any indication a video/audio question even had media.

**Where:** Insert into the per-question slide loop right where
`question.image` is currently handled (~lines 1084–1146), as its own
step — probably right after the image block and before question text, or
combined into the same "media" section if a question could theoretically
have both an image and a video (check whether the schema allows that; if
not, this is a simple `if/else if`).

**Fix — mirror the approach already used for PDF/HTML export (item 1 of
the parent plan, already shipped in `export-to-html.js`), for
consistency across formats and because the YouTube-thumbnail trick is
already proven there:**
1. Reuse (or extract to a shared module, since it's about to be needed in
   a third file) the `resolveMediaUrl` + YouTube-ID-extraction logic
   currently duplicated between `export-to-quiz.js` and
   `export-to-html.js`. Given this is now needed in a *third* file,
   this is the point where extracting a shared
   `shared/media-url.js` (or similar) stops being a "consider it" nice-
   to-have (as the parent plan's audit noted) and becomes worth doing —
   a third duplicate copy is the point where the duplication itself
   becomes the bigger risk.
2. **YouTube:** fetch the same `https://img.youtube.com/vi/{id}/hqdefault.jpg`
   thumbnail used elsewhere, `getImageDimensions` it (the helper already
   in this file, ~line 364), and `slide.addImage()` it exactly like the
   existing question-image code path does — then layer a hyperlinked text
   run over/under it: PptxGenJS supports `hyperlink: { url }` on a text
   run (already used for the CTA slide's link, ~line 1427), so add a
   small "▶ Watch on YouTube" text box with that hyperlink option
   positioned just below the thumbnail image.
3. **Direct video/audio files (non-YouTube):** no thumbnail is available,
   so draw a labeled rounded-rectangle placeholder (reuse
   `pptx.shapes.ROUNDED_RECTANGLE`, already used elsewhere in this file
   for the status badge, ~line 1050) with a centered icon/label ("🎬
   Video" or "🎵 Audio") and the same hyperlink-text-run trick pointing at
   the resolved absolute URL, so at least clicking it in PowerPoint opens
   the file/stream in a browser.
4. Height/layout: treat this as its own `maybeNewSlide`-gated block with a
   fixed height (e.g. thumbnail-derived height for YouTube, a fixed
   ~1.2in placeholder height for direct files) — don't try to reuse
   `estimateTextHeight` for this, it's not a text block.
5. Respect the existing side-by-side-vs-stacked layout decision already
   made for images (~line 1097's `isWide` branch) — for consistency,
   simplest first pass is to always stack media above the question text
   (skip the side-by-side special case for video/audio; images already
   have that logic and mixing image-style side-by-side layout with a
   video placeholder is unnecessary complexity for a first pass).

**Test:** A quiz with one YouTube-video question, one direct-video-file
question, one audio question, and one question with none of the above —
confirm each renders its correct placeholder/thumbnail, the hyperlink
actually opens the right URL when clicked in PowerPoint/Impress, and the
no-media question is completely unaffected (no leftover blank space).

---

## 7. Progress bar granularity

**Bug:** Progress only updates every `PPTX_RENDER_CHUNK` (= 3) questions
(~line 872, 1381–1390), plus fixed jumps to 90%/100% for the CTA slide +
file write (~lines 1439, 1444). For decks with several consecutive
html2canvas-rendered (markdown/math) questions — which are meaningfully
slower per-question than the plain-text path — this reads as jumpy:
long pause, then a jump of several percent at once.

**Where:** `PPTX_RENDER_CHUNK` constant (~line 872) and the progress-
report block at the end of the per-question loop (~lines 1381–1390).

**Fix:**
1. Reduce `PPTX_RENDER_CHUNK` from 3 to 1 — report (and yield) after
   *every* question, not every third one. The existing yield
   (`await new Promise((r) => setTimeout(r, 0))`, ~line 1389) is what
   lets Cancel and repaints actually happen, so reporting more often also
   directly improves cancel responsiveness, not just visual smoothness —
   worth doing regardless of whether the granularity complaint alone
   would justify it.
2. If per-question yielding at chunk=1 turns out to add measurable
   overhead on very large quizzes (test this — don't assume), a middle
   ground is to keep chunking for the *yield* (still every question is
   fine, `setTimeout(r,0)` is cheap) but make the *reported percentage*
   itself finer-grained by weighting each question's contribution by
   whether it needs an html2canvas render or not, rather than assuming
   uniform per-question cost — e.g. maintain a running "estimated total
   work units" (plain-text question = 1 unit, markdown/math question =
   ~3–4 units, calibrate empirically) computed once up front from the
   `questions` array, then report `completedUnits / totalUnits * 85`
   instead of `(index+1) / totalQuestions * 85`. This directly fixes the
   "reads as stalled during a run of markdown questions" symptom, since
   the reported percentage will genuinely reflect that those questions
   take proportionally longer, rather than assuming uniform cost per
   question and having the bar "lie" by jumping when a batch of harder
   questions finally finishes.
3. Add a small sub-progress increment for the CDN-library-loading phase
   at the very start (currently jumps straight from 0 to the first
   chunk's percentage once `loadPptxGen`/`loadHtml2Canvas`/
   `warmKatexFonts` finish) — e.g. `onProgress(3)` right after
   `loadPptxGen()` resolves and `onProgress(6)` after
   `warmKatexFonts()`/`loadHtml2Canvas()` (only load html2canvas eagerly
   here if the quiz is known up front to contain markdown/math content;
   otherwise this call itself becomes wasted network/parse time on plain
   quizzes — check how `loadHtml2Canvas` is currently invoked, lazily on
   first need or eagerly at the top, before adding an eager progress tick
   for it).

**Test:** A large (30+) question deck with a deliberate mix — a run of
10 plain-text questions, then a run of 10 markdown/math-heavy questions,
then 10 more plain — watch the progress bar and confirm it advances
roughly evenly rather than stalling through the markdown run and then
jumping. Also re-test Cancel responsiveness specifically during the
markdown-heavy run (click cancel mid-run and measure how many additional
questions render before it actually stops) to confirm the granularity
change didn't regress the existing cancellation behavior.

---

## Suggested execution order (recap)

1. Multi-correct support (independent, low-risk)
2. Contrast sweep (independent, low-risk, but needs real PowerPoint/
   Impress visual verification, not just code review)
3. Empty slides + Progress granularity (touch the same
   `maybeNewSlide`/chunking machinery — do together to avoid re-touching
   it twice)
4. Media placeholders + Overflow/markdown-detection (both touch the
   question-image/question-text region of the per-question loop — do
   back-to-back)
5. Two-column layout (self-contained but fiddliest — last, so it isn't
   rushed)

After all six are done, this file's own top-of-file `/* === Issues === */`
comment block (~lines 6–12) should be deleted or updated to reflect
current state — it currently lists a different, older set of issues
(RTL flipping, copy-button rendering, language-badge placement, score-
table position) that the `Fix #1`–`Fix #5` comments elsewhere in the file
claim are already resolved; leaving a stale "known issues" comment at the
top of the file is itself worth cleaning up once this pass is complete,
since it's actively misleading about what's still broken vs. already
fixed.
