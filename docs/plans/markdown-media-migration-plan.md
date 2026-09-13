# Markdown Media Engine + Legacy Migration — Implementation Plan

## STATUS (updated — read this first)

Implementation resumed and completed Section 8, steps 1–4 in full, including
substitute (automated, non-browser) verification passes for both step 3's
syntax check and step 4's export-bundling change — see Done items below.
Currently paused at the start of step 5 (`create-quiz.js` insert-at-cursor
UX). **Nothing destructive has happened**: no Supabase writes, no legacy
code deleted, no UI removed. Everything below is additive — the app should
work exactly as it did before, with the new capability layered in alongside
the old. A real-browser regression pass on `quiz.html`/`result.html`/a
freshly-exported standalone quiz is still recommended before production
migration (Section 7) — see the caveats noted under Done items 7 and 8.

### ✅ Done

1. **New shared module `public/src/shared/media-resolve.js` created.**
   Extracted `getMediaUrlCandidates`, `resolveMediaUrl`, `getMediaMimeType`,
   `isYouTubeUrl`, `getYouTubeVideoId`, `renderMediaElement`, `escapeHtml`
   from `quiz.js` (the more complete of the two prior copies) into one
   module. This is now the single source of truth for media URL resolution.

2. **`quiz.js` updated.** Its local copies of the above helpers were
   replaced with thin wrappers that import from `media-resolve.js` and bind
   `quizBaseUrl`. `renderQuestionImage`/`renderQuestionAudio`/
   `renderQuestionVideo`/`renderQuestionMedia` are **untouched and still
   active** — legacy dedicated-field media rendering still works exactly as
   before. Syntax-checked with `node --check` (passes).

3. **`result.js` updated**, same consolidation as `quiz.js`. This also
   **fixed a real latent bug** noted during planning: `result.js` previously
   had no quiz-folder-relative URL resolution at all (it was missing the
   `baseUrl` branch `quiz.js` had). It now computes `resultBaseUrl =
   new URL("./", window.location.href).href` (identical approach to
   `quiz.js`'s `quizBaseUrl`) and passes it through, so relative media paths
   like `./assets/quiz-media/TEST_1/Part_1.mp4` should now resolve correctly
   on the results page too, where they may not have before. Legacy
   `renderQuestionImage`/`Audio`/`Video`/`Media` are untouched and still
   active. Syntax-checked with `node --check` (passes).

4. **`markdown.js` — new inline media syntax implemented.**
   - `![audio](url)` and `![video](url)` now render real `<audio>`/`<video>`
     elements (or a YouTube iframe for video, auto-detected), reusing the
     existing `![alt](url)` regex site with keyword dispatch. Verified via
     standalone regex tests: case-insensitive (`![AUDIO]` works), and alt
     text that merely *contains* the word "audio"/"video" (e.g. "my audio
     recording") correctly falls through to plain image rendering — only an
     exact keyword match switches modes. This means **zero regression risk**
     to any existing `![...](...)` usage elsewhere (docs screenshots, the 13
     production quizzes with plain images).
   - URL matching was widened from `https?://`-only to also accept
     relative/site-root paths (`./assets/...`, bare relative paths), since
     legacy media data uses those and the old images-only regex never had
     to handle them.
   - Added `renderInlineMediaTag()`, mirroring `quiz.js`'s skeleton-wrapped
     `.media-container` markup and YouTube-iframe branch exactly, so inline
     media should look and behave identically to the old dedicated-field
     version (same CSS classes, same `data-media-raw`/`data-media-candidates`
     attributes for `initMediaSkeletons()` to pick up).
   - Threaded a new optional `mediaBaseUrl` parameter through
     `applyInline(s, options)` → `_renderMarkdownCore(str, options)`,
     updating all 5 internal call sites that invoke `applyInline` (table
     cells, paragraph text lines, headings, blockquotes, list items) to pass
     `{ mediaBaseUrl }` through.

5. **`markdown.js`: `mediaBaseUrl` now threaded all the way to the public
   entry point.** `renderMarkdown(str, options = {})` accepts and forwards
   `{ mediaBaseUrl }` to `_renderMarkdownCore`. Also fixed a gap the original
   plumbing missed: the recursive `_renderMarkdownCore` call inside the
   ` ```passage ``` ` fence handler wasn't forwarding `mediaBaseUrl`, so an
   `![audio](...)`/`![video](...)` tag placed inside a passage block would
   have silently lost quiz-folder-relative URL resolution — fixed alongside
   this edit. The file's header JSDoc already documented the final
   `(str, options)` signature correctly, so no change was needed there.
   Syntax-checked with `node --check` (passes).

6. **`mediaBaseUrl` wired into every real `renderMarkdown(...)` call site**
   in `quiz.js` and `result.js`.
   - `quiz.js`: all 10 call sites now pass `{ mediaBaseUrl: quizBaseUrl }` —
     `renderReadingPassage`, both explanation/feedback branches, `q.q`,
     `getEssayAnswer(q)`, and each option — across **both** question-render
     functions in the file (`buildVerticalQuestionBodyHTML` and
     `buildQuestionBodyHTML`; there are two parallel render paths, not one —
     worth being explicit here for whoever verifies next).
   - `result.js`: all 8 call sites now pass `{ mediaBaseUrl: resultBaseUrl }`
     — `renderReadingPassage`, the essay branch (`userText`, `formalText`,
     explanation), and the MCQ branch (`q.q`, each option, explanation).
   - Syntax-checked both files with `node --check` (both pass).

7. **Automated verification of the new syntax's correctness** (substitute
   for the manual-browser check step 3 called for — no live browser
   available in this environment). Built a jsdom-based smoke test
   (`/home/claude/mdtest/test.mjs`, scratch — not part of the repo) that
   imports the actual `markdown.js`/`media-resolve.js` unmodified and
   exercises `renderMarkdown()` directly. All 8 checks passed: plain-image
   regression guard, relative-path audio/video resolution with
   `mediaBaseUrl`, YouTube auto-embed detection, the "alt text merely
   *contains* audio/video" false-positive guard, case-insensitive keyword
   matching, media-inside-a-passage-fence (validates the recursive
   `_renderMarkdownCore` fix from item 5 above end-to-end), and a
   no-options-arg call (backward compatibility for any untouched legacy
   call site).

   **What this does NOT cover** (still needs a real browser pass): the
   no-reload behavior on answer-select/lock described in Section 1.4 (that's
   a live-DOM-mutation/timing property, not something a one-shot
   `renderMarkdown()` string-output check can exercise), visual/CSS
   rendering, and `initMediaSkeletons()`'s runtime retry behavior when a
   primary candidate URL 404s. Recommend a real-browser pass on both
   `quiz.html` and `result.html` before proceeding to production migration
   (Section 7), even though the syntax itself is now confirmed correct.

8. **`export-to-quiz.js` updated** so exported quizzes also get the new
   inline media syntax. Investigated how the export bundles `renderMarkdown`
   (per Remaining item 2's open question): it's an **inline-copy** approach
   — `_renderMarkdownCore`/`renderMarkdown`/`applyInline`/etc. are
   `.toString()`-serialized directly into the generated `<script>` block of
   the downloaded standalone `.html`, not a shared-module reference (the
   export has no build step and must be a single self-contained file).
   Since `applyInline` now calls `renderInlineMediaTag`, which in turn
   calls into `media-resolve.js`, and neither was previously exported or
   inlined, exported quizzes would have thrown `ReferenceError` on any
   `![audio]`/`![video]` tag. Fixed:
   - Exported `renderInlineMediaTag` and `MD_MEDIA_SKELETON_HTML` from
     `markdown.js` (previously module-private) so they're importable.
   - Verified no naming collision between `media-resolve.js`'s
     `resolveMediaUrl(url, baseUrl)` (quiz-folder-relative resolution) and
     the *already-imported, differently-behaved* `resolveMediaUrl(url)`
     from `media-url.js` (fixed-platform-origin resolution for legacy
     `q.video`/`q.audio` fields) — only imported the 5 non-colliding names
     actually needed (`getMediaUrlCandidates`, `getMediaMimeType`,
     `isYouTubeUrl`, `getYouTubeVideoId`, `YOUTUBE_RE`), not
     `resolveMediaUrl` itself, so both modules' same-purpose-different-
     signature functions coexist safely.
   - Added the `.toString()` inlining block to `export-to-quiz.js`, in
     dependency order (`YOUTUBE_RE` → the 4 media-resolve helpers →
     `MD_MEDIA_SKELETON_HTML` → `renderInlineMediaTag` → `applyInline`).
     Caught a real bug in the first attempt: unlike every other inlined
     dependency in that block (plain `function name() {}` declarations,
     whose `.toString()` is already a self-declaring statement), the 4
     media-resolve helpers are `const name = (...) => {}` arrow-function
     exports — their bare `.toString()` is just an unassigned expression,
     not a declaration. Each had to be wrapped as
     `` const name = ${fn.toString()}; `` instead.
   - Verified no scope collision with the export template's own
     function-local `YOUTUBE_RE` inside `renderQuestionVideo` (that one is
     `const`-scoped to that single method for the *legacy* dedicated-field
     renderer the plan says not to touch — confirmed it doesn't shadow or
     get shadowed by the new module-scope inlined one).
   - **Verified with a second, targeted harness** (not just
     inspection): reproduced the exact inlining pattern in a standalone
     script and executed it with `new Function(...)`, exactly as a
     browser parsing the downloaded `.html`'s `<script>` tag would (no ES
     module system, no shared scope with `export-to-quiz.js` itself). All
     5 checks passed: audio tag renders with correct resolved `src`,
     video tag renders, YouTube URL auto-embeds, plain image is
     unaffected, and the "alt text merely contains audio/video" false-positive
     guard still correctly falls through to `<img>`. This caught that an
     earlier harness draft's failure was its own setup gap (missing
     `window.location`), not a defect in the inlined code — confirmed by
     rerunning with a proper `window.location.origin` stand-in and getting
     matching output to the `renderMarkdown()`-level test in item 7.
   - Syntax-checked with `node --check` (passes).
   - **Not yet done**: actually generating a real exported `.html` file
     from a live quiz with inline media and opening it in a browser — the
     harness proves the JS executes correctly standalone, but hasn't
     confirmed visual/CSS parity or `initMediaSkeletons()` runtime retry
     behavior inside a real downloaded file. Same caveat as item 7 above.

### ⏳ Remaining (in order)

1. **`create-quiz.js` + `create-quiz.html`** — build the insert-at-cursor
   UX (file drop/paste inserts a markdown media tag into the focused
   textarea instead of writing to a dedicated `q.image`/`q.audio`/`q.video`
   field). Not started. Legacy dropzone/chip UI is untouched and still
   fully functional in the meantime.

2. **`ai-prompts.js`** — update the AI agent's JSON example to embed media
   inline via the new syntax instead of emitting `"audio"`/`"video"` keys.
   Not started.

3. **Supabase backup, migration script, verification, then legacy code
   deletion** (Section 7 of this plan) — **not started, and per the
   original instruction, the backup must be taken and presented before any
   migration write happens.** No Supabase writes of any kind have occurred
   yet; production data is untouched.

4. Final regression pass across the 20 previously-affected production
   quizzes plus a freshly-authored test quiz.

### Notes for whoever picks this back up

- `media-resolve.js`, `markdown.js`, `quiz.js`, `result.js`, and
  `export-to-quiz.js` have all been modified in place in this working copy
  (not shared as standalone downloads this round) — diff against the
  original zip/repo to see exact changes if needed.
- `quiz.js` and `result.js` still contain their old `renderQuestionMedia`
  family functions, fully intact — do not delete these until a real-browser
  regression pass (see item 7/8's caveats above) confirms the new syntax
  works end-to-end, per the plan's original sequencing in Section 8.
- `export-to-quiz.js`'s legacy `renderQuestionImage`/`renderQuestionAudio`/
  `renderQuestionVideo`/`renderQuestionMedia` methods (the ones baked into
  the exported quiz's own `quizApp` object, used for the dedicated
  `q.image`/`q.audio`/`q.video` fields) are likewise untouched and fully
  intact — same "don't delete until verified" rule applies here.
- The `export-to-quiz.js`, `create-quiz.js`, and `ai-prompts.js` files in
  the shared zip are **unmodified** — none of that work has started.


## 0. Why this plan exists before any code changes

`Claude.md` labels the migration "Step 3," implying the markdown engine already
supports embedded audio/video. It doesn't. Verified in the codebase:

- `public/src/shared/markdown.js` only implements `![alt](url)` **image**
  syntax (line ~113-118), producing a real `<img>`. There is no audio/video
  tag, fence, or renderer anywhere in the file.
- `_SKIP_TAGS` already lists `AUDIO`/`VIDEO`/`IFRAME`/`SOURCE` so the
  RTL/LTR direction engine won't destroy them — this is *preparatory*
  infrastructure for embedded media, not evidence it's implemented.
- `export-to-quiz.js`'s `renderQuestionMedia` (cited in `docs/issues.md` as
  "learn from this") still reads legacy `q.image`/`q.audio`/`q.video` — it
  demonstrates the non-reloading DOM pattern, not markdown-embedded media.
- `docs/issues.md` (the author's own notes) confirms the sequencing:
  fix quiz-page media reload bug → build markdown media embedding → *then*
  migrate + delete legacy code. Step 1 is done (see below). Step 2 is not.

Production data checked directly via Supabase (`esdfdzhtavraczrhxnmp`):
**215 quizzes total, 20 contain legacy media** (13 `image`, 5 `audio`,
6 `video` — some questions have more than one). All confined to the
question-level `image`/`audio`/`video` fields; none found hiding in
`options[]` or `explanation` as raw URLs.

Prerequisite already satisfied: `quiz.js`'s `buildQuestionBodyHTML` already
splits `mediaHTML` into persistent DOM siblings outside `.reloadable-context`,
so media never unmounts/reloads on interaction (see comments at quiz.js:2102-2109).
The new markdown-embedded renderer must preserve this property.

---

## 1. New Markdown Media Syntax

### 1.1 Syntax design

Extend the existing image syntax family rather than inventing something
unrelated, so it reads naturally next to `![alt](url)`:

```
![img](url)                → image (alias of the existing ![alt](url); "img" literal or any alt text ending without a type keyword)
![audio](url)               → <audio>
![video](url)               → <video> or YouTube embed (auto-detected)
```

Concretely, reuse the **same bracket-paren shape**, and dispatch on a literal
type keyword in the alt-text position:

- `![audio](https://example.com/clip.mp3)`
- `![video](https://example.com/clip.mp4)`
- `![video](https://www.youtube.com/watch?v=XXXXXXXXXXX)` — YouTube URLs auto-embed via iframe, same detection regex already used in `quiz.js`/`result.js`.
- `![alt text](https://example.com/photo.jpg)` — unchanged, existing image behavior. Alt text other than the literal `audio`/`video` keywords is always treated as an image (matches current behavior, zero regressions on the 13 quizzes with images and on all prose usage of `![...]()` elsewhere, e.g. `docs/issues.md`'s own screenshots).

Rationale for reusing `![type](url)` instead of a new fence/tag:
- Keeps one mental model ("media is an image-like markdown link") instead of three.
- Trivial to migrate legacy data into: `` `![audio](${q.audio})` ``.
- Keeps parsing localized to the existing image regex site in `markdown.js`,
  minimizing surface area for new bugs.
- Explicit `audio`/`video` keyword avoids the fragility of extension-sniffing
  every media URL (which the current `create-quiz.js` dropzone already does
  for uploads, but shouldn't have to for parsing untrusted markdown text —
  a `.mp3` URL with query params or a CDN path with no extension should
  still work, since the type is stated, not inferred).

### 1.2 Where this can appear

Per `docs/issues.md`: "This will allow quiz creators to add multiple pieces
of media to each question or add media to options, explanations, and formal
answers." So the new syntax must work anywhere `renderMarkdown()` is already
called on quiz content: `q.q` (question body), `q.passage`, `q.options[]`,
`q.explanation`/`q.desc`/`q.info`, `q.answer` (essay formal answer/model answer).
No special-casing per field — if `renderMarkdown()` runs on it, media tags work
in it. This is a natural consequence of implementing it inside `markdown.js`
itself rather than as a pre/post-processing step tied to `q.q` specifically.

### 1.3 Renderer implementation (`markdown.js`)

Currently (line ~113-118):
```js
s = s.replace(
  /!\[([^\]]*)\]\((https?:\/\/[^\)]+)\)/g,
  (_, alt, url) => `<img src="${safeUrl(url)}" alt="${safeUrl(alt)}" class="md-img" loading="lazy">`,
);
```

Two problems to fix while extending it:
1. It only matches `https?://` URLs — legacy data includes relative paths
   like `./assets/quiz-media/TEST_1/Part_1.mp4` (quiz-folder-relative) and
   `./assets/...` (site-root-relative). The regex must accept those too,
   matching what `getMediaUrlCandidates()` in `quiz.js`/`result.js` already
   handles at render time.
2. The URL resolution logic (`getMediaUrlCandidates`, `resolveMediaUrl`,
   `getMediaMimeType`, YouTube detection) currently lives duplicated in both
   `quiz.js` and `result.js`, already diverged (see 2.1). This must become
   ONE shared module that `markdown.js` also imports, or the new syntax will
   immediately fork into a third copy.

**New shared module: `public/src/shared/media-resolve.js`**
Extract from `quiz.js` (the more complete of the two copies — it has
`quizBaseUrl` co-location resolution, which `result.js` lacks and should
have had all along):
- `getMediaUrlCandidates(url, baseUrl)` — `baseUrl` replaces the module-level
  `quizBaseUrl` global so this is usable from any caller.
- `resolveMediaUrl(url, baseUrl)`
- `getMediaMimeType(url)`
- `isYouTubeUrl(url)`, `getYouTubeVideoId(url)`
- `escapeHtml` reused from wherever it already lives, or included locally.

`quiz.js` and `result.js` both import from this module instead of keeping
private copies. This also fixes the latent divergence bug where `result.js`
always cache-busts audio/video src on every render (fine, one-shot page) but
lacks `quizBaseUrl` resolution, meaning quiz-folder-relative video paths like
`./assets/quiz-media/TEST_1/Part_1.mp4` may fail to resolve correctly on the
results page today — worth a quick manual check during implementation.

**In `markdown.js`**, replace the images block with:

```js
import { getMediaUrlCandidates, resolveMediaUrl, getMediaMimeType, isYouTubeUrl, getYouTubeVideoId } from "./media-resolve.js";

// ── Media (images / audio / video / YouTube) ──────────────────────────────
// ![alt](url)          -> <img>                 (unchanged legacy behavior)
// ![audio](url)        -> <audio> with skeleton
// ![video](url)        -> <video> or YouTube iframe, auto-detected
const MEDIA_URL_RE = /(https?:\/\/[^\s)]+|\.{0,2}\/[^\s)]+)/; // http(s) OR relative/site-root path
s = s.replace(
  /!\[(audio|video|[^\]]*)\]\((\S+?)\)/g,
  (full, kind, url) => {
    if (kind !== "audio" && kind !== "video") {
      // existing image path, unchanged
      return `<img src="${safeUrl(url)}" alt="${safeUrl(kind)}" class="md-img" loading="lazy">`;
    }
    return renderInlineMediaTag(kind, url, quizBaseUrlForMarkdown);
  },
);
```

`renderInlineMediaTag(kind, url, baseUrl)` (new function in `markdown.js`,
built directly from the existing logic in `quiz.js`'s
`renderQuestionAudio`/`renderQuestionVideo`/`renderMediaElement`):
- For `video`, checks `isYouTubeUrl` first → renders the same iframe markup
  (`youtube-embed`, `allow="accelerometer; autoplay; ..."`, `loading="lazy"`)
  already used in `quiz.js`/`export-to-quiz.js`/`result.js`.
- Otherwise renders `<audio>`/`<video>` via the shared `renderMediaElement`
  equivalent, wrapped in `.media-container` + `MEDIA_SKELETON_HTML` so the
  existing skeleton/loading CSS and `initMediaSkeletons()` logic in `quiz.js`
  keep working unmodified — inline media must look and behave identically
  to the current dedicated-field media, or it's a regression for the 20
  quizzes with existing media.
- `quizBaseUrlForMarkdown`: `markdown.js` doesn't currently know about
  per-quiz base URLs. `renderMarkdown()` needs an optional second parameter
  (`renderMarkdown(str, { mediaBaseUrl } = {})`) that callers (`quiz.js`,
  `result.js`, `export-to-quiz.js`, `create-quiz.js` preview) pass through.
  All existing call sites keep working with the default (no base URL —
  behaves like an absolute/site-root URL only, matching current non-quiz
  usages of `renderMarkdown` elsewhere in the app, e.g. any static pages).

### 1.4 Skeleton / non-reload behavior inside markdown-rendered content

This is the trickiest part, because it's the entire reason media was pulled
*out* of the body in the first place (issues.md's documented reload bug).

`quiz.js`'s current fix works by **never re-rendering the media DOM nodes**:
`buildQuestionBodyHTML` returns `mediaHTML` as a value the caller places in
a persistent sibling, while `renderQuestion()` only replaces
`.reloadable-context.innerHTML` on each interaction. With media embedded
*inside* markdown-rendered question/option/explanation text, that split no
longer exists — the media tag lives inside whatever `innerHTML` gets replaced.

Mitigation, in order of preference:
1. **Question body (`q.q`) itself is not part of `.reloadable-context` today**
   (confirmed: `reloadableHeaderHTML` — which contains `q.q` via
   `renderMarkdown(q.q)` — is rendered once per question change, not on every
   button press within the *same* question; re-render happens on
   answer-select for the feedback panel, not on the header). Need to verify
   this precisely per interaction type (locking an answer, toggling
   bookmark/flag, checking essay) — if any of these currently re-render the
   header along with the reloadable content, that's exactly the "any embedded
   media in the header will now reload" case, and it needs the same DOM-diff
   treatment as media sections get today.
2. For **options and explanation**, which do live inside content that gets
   replaced when a question is locked/answered (feedback panel, correct/wrong
   classes), embedded media in an option or explanation *will* reload every
   time the surrounding container's `innerHTML` is replaced (e.g., every time
   `isLocked` flips). Given quizzes rarely put media in options today (0 found
   in production), and the immediate migration need is only for `q.image`/
   `q.audio`/`q.video` on the question body — recommend implementing full
   markdown-embedded media rendering everywhere (so options *can* carry it
   per the feature ask), but scoping the *no-reload guarantee* explicitly to
   the question body/passage on first pass, and documenting the options/
   explanation reload behavior as a known, minor limitation to revisit if it
   becomes a real problem (nothing in production exercises it yet).
3. Regardless of (2), the `<audio>`/`<video>` element itself should carry
   `data-media-raw`/`data-media-candidates` and go through the same
   `initMediaSkeletons()` re-scan pattern so that even if a re-render
   *does* happen, playback position isn't silently expected to persist
   (browsers will reset playback position on re-creation regardless — that's
   an unavoidable consequence of the container's `innerHTML` being replaced,
   not something the skeleton logic can prevent).

This means: **before shipping**, manually test a quiz with `![audio](...)`
embedded directly in a question's `explanation` field, verify whether locking
the answer restarts playback. If yes, that's an acceptable known limitation
(matches what would happen with legacy fields too, if they were ever put in
the explanation — which they structurally can't be today). Document this in
the AI prompt / create-quiz UI copy so quiz authors know to prefer the
question body/passage for anything that needs to play continuously.

### 1.5 `_renderMarkdownCore` vs `applyInline` — confirm single implementation path

`markdown.js` has two layers (`applyInline`, used for simple single-line
contexts, and `_renderMarkdownCore`, the full block renderer used by
`renderMarkdown`). Need to confirm during implementation whether the image
regex at line ~113-118 is inside `applyInline` (looks that way from context)
and whether `_renderMarkdownCore` calls `applyInline` for every text run —
if the media regex is added only to `applyInline`, that should be the single
source of truth reached by all rendering paths. Verify no second, separate
image-rendering codepath exists elsewhere in `_renderMarkdownCore` that would
need the same treatment (the syntax-highlighter's fake `![alt](url)` styling
inside code fences at line ~582 is NOT a real renderer — confirmed it's
decorative highlighting for displaying markdown-as-code in code blocks, not
an actual media embed path, so it's out of scope).

---

## 2. `quiz.js` changes

1. Replace local `getMediaUrlCandidates`/`resolveMediaUrl`/`getMediaMimeType`/
   `isYouTubeUrl`/`getYouTubeVideoId`/`renderMediaElement` with imports from
   the new `media-resolve.js` (2.1 above). Pass `quizBaseUrl` explicitly at
   each call site instead of relying on the module-level variable, OR keep
   the module-level `quizBaseUrl` in `quiz.js` and pass it into `renderMarkdown()`
   calls as `{ mediaBaseUrl: quizBaseUrl }` — simplest path, minimal diff.
2. Every `renderMarkdown(q.q)`, `renderMarkdown(q.explanation)`, per-option
   `renderMarkdown(opt)`, `renderMarkdown(getEssayAnswer(q))`, etc. gets the
   `{ mediaBaseUrl: quizBaseUrl }` option added.
3. **Delete** `renderQuestionMedia`, `renderQuestionImage`, `renderQuestionAudio`,
   `renderQuestionVideo`, `wrapMedia`, and the `mediaHTML` plumbing in
   `buildQuestionBodyHTML` and its two call sites (quiz.js:1844, 2166) —
   media now arrives already embedded in the markdown-rendered strings, no
   separate render/placement step needed.
   - **Do this only after step 1 (new syntax) is verified working**, and only
     as part of the actual migration step (Section 4), not before — until
     the DB migration runs, quizzes in production still rely on this legacy
     path 100% of the time.
4. `isLargeFormatQuestion` currently checks `q?.passage || q?.audio || q?.video`
   (line 348) to decide layout. After migration, `q.audio`/`q.video` won't
   exist anymore. Decide replacement heuristic — likely: does the *rendered*
   `q.q`/`q.passage` markdown contain a media tag? Cheapest check: test the
   raw markdown string for the `![audio](` / `![video](` / `![...](` pattern
   before rendering, rather than parsing the rendered DOM. Add a small
   `containsMedia(markdownStr)` helper (regex test, not full parse) used
   for this layout decision only.
5. `initMediaSkeletons(root)` currently scans `.media-container` elements
   that were placed by the old dedicated renderer. After migration, the new
   inline media renderer must still wrap its output in `.media-container`
   with the same skeleton markup so this function keeps working unmodified
   against the new markup (confirmed compatible by design in 1.3).

## 3. `result.js` changes

Simpler than `quiz.js` because `result.js` renders once per page load (no
interactive re-render at all — confirmed by reading the review-card
generation loop, which runs once in the `DOMContentLoaded` handler and is
never re-invoked afterward).

1. Same as quiz.js: replace local media-resolve copies with the shared
   module import (this also fixes the `quizBaseUrl`-resolution gap noted
   in 1.3 — `result.js` currently lacks it entirely).
2. Add `{ mediaBaseUrl }` to the `renderMarkdown()` calls for `q.q`,
   `q.explanation`, `opt` (options), `getEssayAnswer(q)`, `userAns`.
   `result.js` needs its own source for `mediaBaseUrl` — check how it
   currently resolves the quiz's base path (likely via `manifestEntry` or
   `getManifest()`, same data quiz.js uses for `quizBaseUrl`) and wire it
   the same way.
3. **Delete** `renderQuestionMedia`, `renderQuestionImage`, `renderQuestionAudio`,
   `renderQuestionVideo` and their two call sites (result.js:983, 1083) —
   again, only as part of the migration step, not before.
4. No skeleton/reload concerns here since there's no re-render — inline
   media can use a simpler variant without the skeleton wrapper if desired,
   though reusing the same wrapper keeps visual consistency with quiz.js and
   costs nothing extra.

## 4. `export-to-quiz.js` changes

This generates **static, standalone HTML exports** (a quiz someone downloads
and opens outside the platform) — confirmed by the file's self-contained
inline-string-template structure (`renderQuestionMedia`, `escapeHTML`, etc.
duplicated yet again, this time inline inside a giant template string, not
importable as an ES module).

Because this output is a static file with no build step at export time, it
can't `import` the shared `media-resolve.js` module — the resolve/render
logic must be **inlined into the export template string** (as it already is
today), but updated to:
1. Include the new `renderMarkdown` media-tag handling — meaning the
   markdown renderer shipped inside this static export template must be
   the *updated* `markdown.js` logic, not the current copy. Check how
   `export-to-quiz.js` currently bundles `renderMarkdown` into the exported
   HTML (likely inlines the whole module as a string) — the update should
   flow through automatically once `markdown.js` itself is updated, *if*
   that's how it's bundled; verify this during implementation rather than
   assuming.
2. Once confirmed, **delete** `renderQuestionMedia` and its three helpers
   here too, same migration-gated timing as quiz.js/result.js.
3. No skeleton/reload concern: static exports have no live interaction with
   Supabase-backed re-renders; if the export's markdown renderer is the
   same as the platform's, the same "options/explanation reload" caveat
   from 1.4 applies equally here, and is equally low-risk given 0 production
   quizzes use media in options.

## 5. `create-quiz.js` changes

### 5.1 What stays
- `compressImageFile`, `detectMediaTypeFromFile`, `MEDIA_MIME_MAP`,
  `MEDIA_MAX_SIZE`, `MEDIA_EXT_MAP`, `uploadCombinedMediaFile`'s actual
  Supabase Storage upload logic — all of this is about **getting a file
  into storage and getting a URL back**, which is orthogonal to how that
  URL is referenced in text. None of this is legacy; it's needed regardless
  of field-based or markdown-based storage.

### 5.2 What changes
- `renderCombinedMediaSection`, `setupCombinedMediaListeners`,
  `rerenderCombinedMedia`, `addMediaFromLinkInput`, `removeQuestionMedia`,
  `updateMediaPreview`/`updateImagePreview`/`updateAudioPreview`/
  `updateVideoPreview`, and the dropzone UI in `create-quiz.html` (the
  `.media-dropzone`, chip UI, per-type preview containers) are being
  **removed** as legacy per `Claude.md`'s "remove the old dedicated media
  dropzone UI" instruction.
- Replacement UX: insert a media markdown tag directly into whichever text
  field currently has focus (question body / option / explanation / formal
  answer textarea), at the cursor position, when a file is dropped/selected
  or a link is submitted:
  1. On file drop/select: compress (if image) → `uploadCombinedMediaFile`
     (unchanged) → get back a storage URL → insert
     `![audio](url)`/`![video](url)`/`![alt](url)` at the cursor of the
     currently-focused textarea using `detectMediaTypeFromFile` to pick the
     tag kind.
  2. On pasted link: `detectMediaTypeFromUrl` (already exists) picks the
     tag kind, insert the markdown tag at cursor the same way.
  3. Needs a small dropzone/paste-target attached per textarea (question
     body, each option, explanation, formal answer) rather than one combined
     dropzone per question — or, simpler: keep ONE dropzone per question but
     require the author to click into the target field first (last-focused
     textarea tracked in a module-level variable), inserting into whichever
     field had focus when the file was dropped/link submitted. This is a
     smaller UI change than rebuilding per-field dropzones and matches how
     most markdown editors with paste-to-embed work.
- `q.image`/`q.audio`/`q.video` are no longer read from or written to new
  quizzes at all after this ships — `getActiveMediaFields`,
  `isLargeFormatQuestion`'s legacy-field check, and the JSON-building code
  at lines ~4385/4515 (`if (q.video?.trim()) out.video = q.video`, etc.)
  all get removed as part of this same change, since new quizzes should
  never write these fields again (per `docs/issues.md`: "Users shouldn't be
  able to create Legacy... objects").
- Needs UI copy/hint update in the dropzone (or its replacement) explaining
  the new insert-at-cursor behavior, since this is a real workflow change
  for anyone who used the old chip-based UI before.

## 6. `ai-prompts.js` changes

Simple once the syntax is settled: update the JSON example in
`English_Specializing_Prompt` (and any other prompt using `"audio"`/`"video"`
example keys — confirmed at least one at line ~62 and ~73) to instead show
the markdown tag embedded directly in `"q"` or `"explanation"`:

```
"q": "Choose the correct form: 'She ___ to the gym every Monday.'\n\n![audio](https://example.com/audio/present-simple.mp3)",
```

removing `"audio": "..."` / `"video": "..."` as separate JSON keys entirely,
and adding a short instruction line telling the model to embed media inline
using `![audio](url)` / `![video](url)` rather than emitting dedicated
fields. Should be a single, isolated diff — low risk, do this last.

---

## 7. Database Migration (only after 1–6 are built and verified)

### 7.1 Backup (mandatory first step, before any writes)
Full logical backup of the `basmagi-quiz` Supabase project
(`esdfdzhtavraczrhxnmp`) — specifically the `quizzes` table's `data` column
for all 215 rows, since that's the only table this migration touches. I'll
present the backup (row count, checksum or full dump) before running
anything further, per your original instruction.

### 7.2 Migration logic
For each of the 20 affected quizzes, for each question with `image`/`audio`/
`video`:
1. Build the markdown tag: `![audio](${q.audio})` / `![video](${q.video})` /
   `![${altTextOrDefault}](${q.image})` (image alt text: reuse "Question
   context image" default from current `renderQuestionImage`, since legacy
   image objects never carried alt text).
2. Append the tag(s) to `q.q` (question body) — the field the legacy
   renderer visually placed media next to. Order: image, then audio, then
   video, matching current `renderQuestionMedia`'s concatenation order,
   each on its own line for clean markdown separation.
3. Delete the `image`/`audio`/`video` keys from the question object.
4. Write the updated `data` jsonb back.

This should run as a single SQL `UPDATE` using `jsonb_set`/`jsonb_path_query`
transformations (or, more safely given the nested array-of-objects shape and
the need for per-question string concatenation, a small one-off Node script
using the Supabase client, run once, that reads all 215 rows, transforms in
JS, and writes back only the 20 changed rows) — recommend the script
approach over raw SQL jsonb surgery, since string concatenation onto `q.q`
per-array-element is awkward in pure SQL and much clearer to review as JS
given this only runs once.

### 7.3 Verification before cleanup
After migration, before deleting any legacy code:
1. Re-run the media-field-existence query from Section 0 — should return
   0 for all three fields.
2. Manually load at least one migrated quiz of each media type (image,
   audio, video, YouTube-video) on `quiz.html` and `result.html` using the
   *new* markdown-based rendering, confirm visual/functional parity with
   how it looked before migration (screenshots before/after recommended).
3. Only then proceed to delete `renderQuestionMedia` and related legacy
   functions per Sections 2–5.

---

## 8. Suggested build order

1. `media-resolve.js` shared module (extract, don't yet delete originals).
2. `markdown.js` media tag support + `renderMarkdown(str, {mediaBaseUrl})` param.
3. Wire `mediaBaseUrl` through `quiz.js` and `result.js` render calls
   (additive — legacy dedicated-field rendering still active in parallel).
4. Manual test: hand-craft a quiz question with `![audio](...)`/`![video](...)`
   in `q.q` directly in a test quiz row, confirm rendering + no-reload
   behavior on `quiz.html`, confirm rendering on `result.html`.
5. `create-quiz.js` insert-at-cursor UX (new quizzes can now be authored
   with the new syntax natively).
6. `ai-prompts.js` update.
7. Supabase backup, then migration script, then verification (Section 7).
8. Delete legacy code: `renderQuestionMedia` family in `quiz.js`,
   `result.js`, `export-to-quiz.js`; dropzone chip UI in `create-quiz.js`/
   `create-quiz.html`; legacy field read/write in `create-quiz.js`'s
   JSON-building code.
9. Final regression pass across all 20 previously-affected quizzes plus a
   freshly-authored test quiz using only the new UI.

---

## 9. Follow-up issue (separate from the media migration): Start Screen UI Unresponsive

**Reported:** `create-quiz.html` start screen — `.entry-item-new`, `.entry-item-draft`,
`.entry-item`, and `.entry-item-more-wrap` menus are all unresponsive to
clicks. No console errors on click.

**Investigation done (no code changed — read-only):**

1. Confirmed `.entry-item-new` is static markup with
   `onclick="chooseEntryAction('new')"`; `.entry-item-draft`/`.entry-item`/
   `.entry-item-more-wrap` are generated dynamically by
   `create-quiz.js` (~line 993-1039) with inline `onclick` handlers
   (`toggleEntryItemMenu`, `renameEntryItem`, `chooseEntryAction`, etc.),
   all exposed on `window.*`. Since clicking produces **zero console
   errors** (a call to an undefined `window.*` function from an inline
   `onclick` would throw a visible `ReferenceError`), the handlers
   themselves are very likely intact and attached correctly — something is
   more likely intercepting the click before it reaches the element.
2. Checked every `position: fixed`/`inset: 0` full-viewport element in
   `create-quiz.css` and `side-menu.css` for a stacking/pointer-events
   problem:
   - `.loading-overlay` (`z-index: 2000`) — starts `display:none` inline in
     HTML; `showLoading()`/`hideLoading()` calls in `create-quiz.js` are all
     inside user-triggered save/import flows, not page init, so it shouldn't
     be stuck open on a fresh load. Not yet ruled out for a *specific*
     repro path (e.g. if the user previously triggered an import/save that
     errored between `showLoading()` and its `hideLoading()`).
   - `.side-menu-backdrop` (`z-index: calc(var(--z-overlay,500) - 1)`) —
     correctly guarded with `opacity:0; pointer-events:none` by default,
     only `pointer-events:auto` when `.visible` is added. Low suspicion.
   - **`.modal-overlay` (`z-index: 5000` — highest z-index found on the
     page) — this is the leading suspect.** Three instances exist
     (`#statsModal`, `#previewModal`, `#importModal`), all `display:none`
     inline in the static HTML, but the CSS rule itself has **no
     `pointer-events:none` fallback and no `display:none` baked into the
     class** — visibility is entirely dependent on JS correctly toggling
     the inline style/class every time. If any code path shows one of these
     (e.g. `showPreviewModal`/`showStatsModal`/an import-flow error) and
     then fails to hide it again — most likely because an error was thrown
     *between* the show call and the matching hide call, or because closing
     the modal only fades opacity without resetting `display` — the
     resulting element would sit invisibly (or near-invisibly) on top of
     the entire page at the highest z-index in the app, silently absorbing
     every click with no console error, exactly matching the reported
     symptom.
   - The screenshot's live DOM snapshot also shows `<aside class="sidebar"
     ... aria-hidden="false" ...>` where the static HTML source has
     `aria-hidden="true"` by default — confirming *some* JS toggled sidebar
     state at runtime in that session, though the sidebar itself is a
     narrow fixed rail (`z-index:500`, well below the modal's `5000`) and
     unlikely to be the actual blocker on its own.

**Not yet done (next steps for whoever continues this):**

1. **Reproduce live in a browser** (I do not have one in this environment)
   and run, from the console: `document.elementFromPoint(x, y)` at the
   coordinates of one of the unresponsive buttons. Whatever element that
   returns *is* the thing eating the click — this single check will likely
   confirm or rule out the `.modal-overlay` hypothesis immediately, far
   faster than further static reading.
2. If it confirms a stuck `.modal-overlay`: check `getComputedStyle()` on
   `#statsModal`/`#previewModal`/`#importModal` for `display`/`opacity`/
   `visibility`, identify which one is stuck open, then find the
   show/hide function pair for that specific modal in `create-quiz.js` and
   look for a code path that shows it without a matching hide — especially
   any `try`/`catch` around an async import or stats-fetch flow where the
   `hideLoading()`/close call sits in a `finally` for one modal but not
   another (worth checking whether all three modals' close paths
   consistently use `finally` or only some do).
3. If `elementFromPoint` instead returns the actual clicked entry-item
   button (ruling out an overlay), the next hypothesis is that
   `setupEventListeners`/whatever re-renders the entry-item grid after data
   loads is replacing the DOM nodes (e.g. via `innerHTML =`) *after* initial
   listener setup in a way that orphans the originally-clicked elements —
   though inline `onclick=` attributes are normally immune to this specific
   failure mode (they're re-parsed fresh from the HTML string every time,
   unlike `addEventListener`-based wiring), so this is a weaker hypothesis
   than the overlay one.

This section was investigated but not fixed — the environment here has no
live browser to confirm the hypothesis against actual computed styles/hit-
testing, and the chat is wrapping up per the user's request. Start with
step 1 above in a real browser session; it should immediately confirm or
rule out the leading `.modal-overlay` hypothesis.