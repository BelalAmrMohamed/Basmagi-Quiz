# Lesson → explainer video (MCP tool `create_lesson_video`) — plan v3 (PAUSED, ready to resume)

> **Executor instructions:** Facts under Verified are checked; treat them as true. Read a file only if you are about to edit it or a Read-only entry lists it. Do not scan or read the whole repo. If something contradicts the plan on contact, fix it and continue; do not stop to re-audit.
> Working prototype code is in `prototype.zip` (unzip into `scripts/video-prototype/`). Its `README.md` marks every file as tested / partial / untested. Start from it; do not rewrite it from scratch.

**Status (2026-11-01):** Paused by the owner until the new AI voice-over feature exists. Everything that does not depend on the voice (steps 1-5, 7-8) can be built now; step 6 plugs the AI voice in later through the interface defined below, so nothing else waits for it. The offline voice (steps 2 and 4) is a working default and the permanent fallback.

Goal: a Claude on the free tier calls one MCP tool and gets an `.mp4` explainer of a Basmagi lesson that looks like a teacher writing on a board, with voice-over, correct math (shown and spoken), and correct Arabic/English mixed speech. The server engine converts the lesson; Claude only runs the kit.
Done when: (1) `create_lesson_video` returns storyboard + kit for any public, non-protected lesson; (2) running the kit in a Claude-style sandbox gives one mp4 per part whose duration matches its audio, with no element outside the frame; (3) a math lesson shows KaTeX equations and speaks them correctly; (4) an Arabic lesson with English terms is spoken with the right voice per word; (5) consecutive sections use different board styles and transitions; (6) a provider other than the offline one can be selected without changing the storyboard or the renderer (step 6).

## What the owner reported after watching the v1 samples (drives v3)

- Manim video: no layout problems. Chromium video: elements fell outside the frame (equation cut off at the bottom). → pagination fix (Decisions → Layout).
- Both videos: word animation poor; not the "writing on a board" (الكتابة على السبورة) look wanted; every scene had the same solid background. → style system (Decisions → Look).
- English voice fine but wants a **male** voice. Arabic voice "straight bad, boring". Math was spoken by the Arabic voice and sounded bad; asked to try English for math. → voices (Decisions → Voices). The Arabic quality problem cannot be fixed offline (measured below); the owner is adding an AI voice feature for it.

## Backend comparison (measured 2026-10-30; same 105 s Arabic math scene, 1280×720, 30 fps, same audio)

| Backend | Install | Render | Arabic / RTL | Equations | Tables, code, lists | Verdict |
|---|---|---|---|---|---|---|
| **Chromium + KaTeX** (frame stepping) | 3 s if a browser exists; `@sparticuz/chromium` from npm supplies one (3 s) | **22.7 s** (static slides) | native | KaTeX 0.16.9 = the site; inline math inside Arabic sentences | native HTML/CSS | **Primary** |
| Remotion 4.0.539 | 21 s, 301 MB | 237 s | native | same | native | Rejected: 10× slower, its Chrome download is blocked, non-MIT license (check terms) |
| Manim 0.22.1 | ~2 min via micromamba; `pip install manim` fails | 25 s | needs 3 workarounds; mixed lines need manual bidi | MathJax SVG; no inline math | manual layout | Fallback + opt-in (owner saw no layout problems in it) |
| skia-canvas | 3 s | 21.5 s | native, correct | MathJax SVG image | manual | Not chosen |
| Motion Canvas, ffmpeg+libass | not tested | | | | | Same class as Remotion / no equations |

Caveat: the 22.7 s figure is for static slides with fade-ins (351 screenshots for 3,203 frames). The write-on animation changes the picture every frame while writing, so expect many more screenshots; step 2 measures it.

## Verified (trust these; do not re-check)

Repo (paths relative to repo root):
- MCP server is a Deno edge function: `supabase/functions/mcp/index.ts`. `TOOLS` array (e.g. `get_lesson_content` at :238); dispatch `switch (toolName)` at :1500-1519 with `default: Unknown tool`; `serverInfo.version` `"3.1.0"` at :1479; handlers return a string.
- `supabase/functions/mcp/lib.ts`: pure helpers, no Deno globals, imported at index.ts:29-33. `LIMITS` :12, `AUTHORING_GUIDE` :350, `outlineLesson` :424.
- `handleGetLessonContent` (index.ts:1137) reads view `lesson_public` (id, slug, title, description, source, content, course_id, folder_id, password_protected); `content` is NULL when protected.
- Lesson content: `{sections:[{id,title,defaultHidden,blocks[]}]}`; blocks `markdown`, `media`, `question` (mcq|essay), `quizRef`, `lesson-reference` (`api/_validateLesson.js:30-50`). ≤60 sections, markdown ≤20,000 chars.
- Markdown: `$inline$`, `$$display$$`, `\(..\)`, `\[..\]`, GFM tables, code fences, ```` ```passage ```` (`public/src/shared/markdown.js:196, 1766-1844, 2363`). Platform KaTeX 0.16.9.
- No language/subject field on lessons; `courses` has `name`, `education_type` only. Supabase project ref `esdfdzhtavraczrhxnmp` (`vercel.json:104`).
- Real lessons today are Arabic with English terms (e.g. Simplex lesson `76c7857c-02b0-4c61-b60e-9479d8f961be`) and write formulas as **plain text** (`New x_i = Old Row / Pivot Key`), not LaTeX. No LaTeX-heavy lesson exists on the platform (Math 2, Discrete Structure, Probability courses are empty). Use `prototype/fixture.json` / `fixture2.json` for math tests.

Sandbox (Claude cloud sandbox: Python 3.13, 2 cores, 8 GB, no apt):
- Reachable: npm, PyPI, conda-forge, `github.com/.../releases/download/...`, **`raw.githubusercontent.com/<owner>/<repo>/...` files (HTTP 200)**. **Blocked:** Bing/edge-tts, huggingface, Google (fonts, storage.googleapis.com, chrome-for-testing), jsdelivr/unpkg/cdnjs, supabase.co, vercel.app, GitHub API and release listing pages (`api.github.com`, `.../releases/expanded_assets/...` → 403). Consequences: no cloud TTS from inside the sandbox, and server → sandbox file transfer is possible only through a public GitHub repo (raw URLs) or inside the tool result text.
- Chromium: preinstalled at `/opt/pw-browsers/chromium-*/chrome-linux64/chrome` here; otherwise `npm i @sparticuz/chromium playwright-core`, launch with `executablePath: await chromium.executablePath()`, `args: chromium.args` (works, 3 s). Remotion/Playwright browser downloads are blocked.
- Offline TTS: `pip install sherpa-onnx==1.12.40` (**2.0.1 fails**). Models at `https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/<name>.tar.bz2`: `vits-piper-ar_JO-kareem-medium` / `-low` (**the only Arabic voices**; probes for `vits-mms-ar*` returned 404), `kokoro-en-v0_19` (320 MB; speaker ids 5/6 male US, 9/10 male UK), `vits-piper-en_US-{amy,ryan-high,joe,john,norman}-medium`, `vits-piper-en_US-lessac-medium`.
- Scoring ASR: `.../releases/download/asr-models/sherpa-onnx-whisper-small.tar.bz2` (640 MB; for tests only, never in the kit). Arabic diacritizer: `pip install mishkal`. Pitch analysis: `pip install praat-parselmouth`.
- Fonts from npm only: `@fontsource/playpen-sans-arabic` (handwriting-style Arabic + Latin), `@fontsource/aref-ruqaa` (calligraphic titles), `@fontsource/cairo`, `@fontsource/caveat`; woff2 under `node_modules/@fontsource/<name>/files/`.
- `katex.__parse(tex)` (0.16.9) returns a typed AST.
- Not reachable even from outside the sandbox for use inside it: VoiceTuT-TTS (Egyptian Arabic with Arabic↔English switching; weights on Hugging Face, needs a GPU) and `nipponjo/tts-arabic-pytorch` (weights on Google Drive).

Measured voice results (ASR round trip with Whisper-small; lower is better):
- English female Amy 4% error; Lessac 9%; Kokoro 7-10%. Male candidates (all ≈3-10%, remaining errors are digits in the transcript): Kokoro 6 (US), Kokoro 9 (UK), Piper Ryan-high, Piper Joe, John, Norman.
- Arabic kareem-medium: 13-15% raw; **3-4% after `mishkal` diacritization**; kareem-low 19%. Slowing speech does not help.
- English terms read by the Arabic voice: 53-70% error. By an English voice: ~0%.
- Pitch variation (F0 std in semitones): Arabic kareem 2.2 regardless of `noise_scale`/`noise_scale_w` settings (0.667-1.1); English Amy 1.8; Kokoro male 3.4-4.0. So voice-parameter tuning does **not** make the Arabic voice livelier; EQ/compression only changes timbre. This is why the offline Arabic voice is "boring" and why the AI voice feature is needed.

## Decisions

Architecture (unchanged from v2)
- Engine-generated: server code builds storyboard, narration runs and the kit; Claude only runs the kit.
- Primary renderer Chromium + KaTeX; fallback and opt-in Manim (`backend:"manim"`). Whiteboard styles exist **only in the Chromium backend**; the Manim backend keeps a plain look using the style's background colour and ink colours (reason: duplicating the style system doubles the work for a fallback).
- One tool: `create_lesson_video(lessonId, part=1, lessonType="auto"|math|english|arabic|general, language="auto"|ar|en, mathLang="en"|"ar", includeHidden=true, quality="720p30", backend="auto"|"chromium"|"manim", voice="offline"|<provider id>, include_kit=true)`; `readOnlyHint:true`; rejects password-protected lessons like `get_lesson_content`.
- `supabase/functions/mcp/video-engine.ts`: pure TS, no Deno globals, no `npm:` imports; KaTeX `__parse` injected. Kit text in `video-kit.ts` string constants; `include_kit=false` after the first call per conversation.
- Language: Arabic letters >50% → `ar`, else `en`. Type auto: ≥1 math span per 60 words → `math`; course name matching `رياضيات|جبر|تفاضل|فيزياء|math|calculus|algebra|physics` → `math`; `لغة عربية|نحو|بلاغة|أدب|Arabic` → `arabic`; `English|إنجليزي|انجليزي` → `english`; else `general`.
- Parts of ≤ ~750 spoken words (~5 min). Skipped (listed in output): `media`, `quizRef`, `lesson-reference`. Questions: read prompt, pause, reveal correct answer, then explanation. `defaultHidden` sections included.

Layout (fixes the off-screen bug)
- Each scene is a sequence of **board pages**. In the browser, measure every item's height, then fill pages greedily (title repeated at the top of each page). When the next item does not fit, the board is **erased** (sponge sweep right→left, 0.9 s) and a new page starts. An item taller than a page is scaled down (min 0.5). Prototype: `paginate.mjs` (tested on `fixture2.json`: three scenes split into two pages, nothing overflows).
- The erase pause is inserted into the **audio timeline** before the first item of a new page (≥1.2 s of silence), so narration never talks over the erase.
- Item timing comes from each item's audio length, never from fractions of the scene.

Look (the "writing on the board" style)
- Five procedural styles (no image files needed): `chalk` (green board, wooden frame, chalk tray), `whiteboard` (marker colours, metal frame, marker tray), `notebook` (ruled paper, red margin, spiral on the right for RTL), `blueprint` (blue grid, white ink), `blackboard`. Scenes cycle through them in order; `lessonType` can pin one style. Prototype: `board.mjs` (`STYLES`, `STYLE_ORDER`).
- Fonts: Playpen Sans Arabic (body, handwriting feel), Aref Ruqaa (titles), KaTeX for equations coloured with the style's `math` colour. English terms are coloured with the accent colour.
- Write-on animation: text appears **word by word**, each word wiped in along its reading direction (right→left for Arabic, left→right for Latin and equations), timed to the narration of that item (word weight = character count), with a pen / chalk / marker / pencil cursor at the leading edge and a small fixed hand-written wobble per word. Chalk styles add a roughen filter. Lists write bullet by bullet, tables row by row. Prototype `board.mjs`.
- Transitions between scenes: ffmpeg `xfade` of 0.6 s cycling `slideleft`, `circleopen`, `wipeleft`, `fadeblack`, `dissolve` (so every scene change looks different); one re-encode of the joined video (libx264 veryfast crf 20). Each scene clip is `audio length + 0.6 s`; scene audio starts with ≥0.6 s of silence so the transition never covers speech.
- Optional image backgrounds: a storyboard scene may carry `bgImage` (URL on a public GitHub raw path, since the sandbox cannot reach anything else) that replaces the procedural background; prompts for generating such images are in Appendix B. Not required for the feature.
- Performance rule for step 2: measure the render of a 5-minute part. If it exceeds 6 minutes, render the writing phases at 20 fps and duplicate frames, and keep static phases deduplicated.

Voices
- Offline provider (default, permanent fallback): English **Kokoro male, speaker id 6** (US; id 9 UK is the alternative via config); Arabic `kareem-medium` with every Arabic run diacritized by `mishkal`, then EQ + compressor + loudnorm (`pipeline.py` `AR_FX`), optional `atempo` up to 1.1.
- **Math is spoken in English by the English male voice by default** (`mathLang="en"`; the owner suggested it because the Arabic voice reads math badly). `mathLang="ar"` keeps Arabic math phrasing. Inline math inside an Arabic sentence switches voice for the span. (Owner has the A/B samples; if they prefer Arabic math, flip the default constant.)
- Split every narration into script runs; Arabic runs → Arabic voice, Latin runs → English voice; drop a bare Arabic article before a Latin word (`الـ discriminant`); plain-text formulas in Latin text: ` = `→"equals", ` - `→"minus", ` * `→"times", ` / `→"divided by", `x_i`→"x i" (needed for real platform lessons).
- Spoken math from the KaTeX AST (prototype `speech.mjs`, includes fixes found in testing): command names (`\le`, `\to`, `\pm`, `\alpha`, `\pi`…), drop parentheses around ≤3 simple tokens, `f(x)` → "f of x" in English, `\frac{d}{dx}` → "the derivative with respect to x of", integral/sum/limit phrasing, "للمقدار" instead of "لـ" in Arabic. Arabic math uses letter names (إكس, واي, زد), Greek names, "جا/جتا/ظا", MSA number words.

**TTS provider interface (the extension point for the owner's AI voice feature)**
- The storyboard never contains audio. For every item it contains `say: [{lang, text, role?}]` (runs already split by language, numbers already spelled out, math already spoken, Arabic **without** diacritics; each provider adds what it needs).
- A provider turns runs into audio and returns a **manifest**: `{provider, sampleRate, items:[{scene, item, runs:[{file|url, dur}], dur}]}`. The kit only needs, per item, an audio file and its duration; it never inspects how the audio was made.
- Two delivery modes, same manifest:
  1. `local`: the kit synthesizes inside the sandbox (offline provider; needs the models in the Bootstrap recipe).
  2. `remote`: a server-side provider (the AI voice) pre-generates audio, stores it in a **public GitHub repo** under a content hash (`sha256(provider|voice|lang|text)` → file name, so repeated lessons reuse audio), and the tool result lists `{url, dur}` for each run; the kit downloads from `raw.githubusercontent.com` (verified reachable) and skips local synthesis and model downloads. Reason for GitHub: it is the only upload target the sandbox allowlist reaches; embedding audio in the tool result would cost hundreds of thousands of tokens per part.
- `voice` parameter selects the provider; unknown or failing provider → automatic fallback to `offline` with a one-line warning in the run report.
- Provider-specific text prep (diacritics, SSML, dialect hints) lives inside the provider, never in the storyboard.

## Bootstrap recipe for Claude (verbatim into the kit's `setup.sh` and the tool result)

Rule printed at the top: **"Do not conclude that something cannot be installed. Follow this recipe; a failed `pip install manim` or a missing browser is expected and has a fix below."**

1. Work dir `~/lessonvideo`. Idempotent (skip a step if its marker file exists); one status line per step.
2. Probe (10 s): `node -v`, `python3 -V`, `ffmpeg -version`, browser (`ls /opt/pw-browsers/chromium-*/chrome-linux64/chrome`), reachability of npm / PyPI / GitHub.
3. Node: `npm i katex@0.16.9 @fontsource/playpen-sans-arabic @fontsource/aref-ruqaa playwright-core @sparticuz/chromium`; copy the needed woff2 files to `./fonts`. (`mathjax-full@3.2.2` only for the Manim backend.)
4. Browser: preinstalled Chromium if present, else `@sparticuz/chromium`.
5. Offline voice only (`voice="offline"`): `pip install --break-system-packages sherpa-onnx==1.12.40 soundfile numpy mishkal`; download and `tar xjf` `vits-piper-ar_JO-kareem-medium` (67 MB) and `kokoro-en-v0_19` (320 MB) from the release URL above. Skipped entirely in `remote` mode.
6. Manim backend only: download `https://github.com/mamba-org/micromamba-releases/releases/latest/download/micromamba-linux-64`, `chmod +x`, `MAMBA_ROOT_PREFIX=~/mamba ./micromamba create -y -n m -c conda-forge manim` (~2 min; may print "unknown MAMBA_EXE" but the env is created: check `~/mamba/envs/m/bin/manim`); `pip install fonttools brotli`; build merged `Cairo-400.ttf` / `Cairo-700.ttf` with `fontTools.merge` from `@fontsource/cairo` woff2.
7. Known failures and fixes (printed in the kit):
   - `pip install manim` → manimpango build error: use step 6.
   - Remotion/Playwright try to download a browser and hang (blocked): use step 4.
   - `sherpa-onnx` "Failed to convert text to token IDs": version 2.x; pin 1.12.40.
   - Manim `MathTex` → `dvisvgm` not found: use MathJax SVG + `SVGMobject`.
   - Manim `Text("arabic")` is **silently empty** (width 0): prefix every Arabic run with U+200E.
   - Manim `register_font(path)` does nothing unless used as `with register_font(path):`.
   - Manim mixed Arabic/English line in wrong order: one `Text` per script run, `arrange(LEFT)`, trailing `: ، .` as its own run on the left.
   - Inline KaTeX in RTL text appears reversed: wrap in `<span dir="ltr" style="unicode-bidi:isolate">`.
   - Chromium launch fails with missing libs: use `@sparticuz/chromium`; if that fails, Manim backend.

## Storyboard contract (tool output; consumed by the kit)

```json
{ "v":2, "lesson":{"id":"","title":"","lang":"ar|en","type":"math|english|arabic|general","url":""},
  "part":{"i":1,"n":3}, "video":{"w":1280,"h":720,"fps":30}, "backend":"chromium|manim", "voice":"offline|<id>",
  "scenes":[{ "id":"s1","style":"chalk|whiteboard|notebook|blueprint|blackboard","bgImage":null,"items":[
     {"k":"title|text|math|line|list|table|code","md":"","tex":"","items":[],"rows":[],
      "say":[{"lang":"ar|en","text":""}] } ]}],
  "audio":null,
  "skipped":[{"section":"s3","type":"media","why":"url not fetchable"}] }
```
In `remote` mode `audio` is the manifest described above. Page breaks and per-item timings are computed by the kit (it needs the browser for heights) and are never part of the storyboard.

## Steps (each leaves the project working; stop anywhere)

1. **Engine + tool returning a storyboard (no audio).** Unzip the prototype to `scripts/video-prototype/`. Port markdown → items (title, paragraphs with inline math kept, lists, tables, code, questions), language/type detection, style assignment per scene, `say` runs per item (with `mathLang`), parts, `skipped`.
   Edit: `supabase/functions/mcp/video-engine.ts` (new), `supabase/functions/mcp/index.ts` (import, TOOLS entry, switch case, header comment, version → 3.2.0), `scripts/video-engine.test.mjs` (new).
   Read only: `supabase/functions/mcp/lib.ts` (copy `outlineLesson` style), `scripts/video-prototype/speech.mjs`, `sb_build.mjs`.
   Check: `node --experimental-strip-types scripts/video-engine.test.mjs` passes on `fixture2.json` and on the Simplex lesson JSON; deploy the `mcp` function (Supabase connector or `supabase functions deploy mcp`); the tool returns valid JSON.

2. **Kit v1: board renderer + offline voice.** `video-kit.ts` constants: `setup.sh` (recipe 1-5), `paginate.mjs`, `audio.py` (per-item synth through the provider interface, timeline with erase pauses and ≥0.6 s scene lead-in, master audio), `render.mjs` (from `board.mjs`: per-scene mp4 written to a temp name then renamed, `xfade` join, audio mux), `run.sh` printing a one-line report. Start with two styles (`chalk`, `whiteboard`) to prove the pipeline.
   Edit: `supabase/functions/mcp/video-kit.ts` (new), `video-engine.ts`, `index.ts`.
   Read only: `scripts/video-prototype/board.mjs`, `paginate.mjs`, `pipeline.py`, `bk_chromium.mjs`.
   Check: following only the tool output in a clean sandbox, `fixture2.json` gives an mp4 whose `ffprobe` duration equals audio + 0.6 s; extract frames at the end of every page: nothing outside the frame; 5-minute-part render time recorded (apply the 20 fps rule if > 6 min).

3. **Math shown and spoken.** Port `speech.mjs` to `video-engine.ts` (`mathToSpeech(tex, lang, parse)`; `MATH_SPEECH` tables as plain objects); golden tests from `t_speech.mjs` plus ≥15 more (matrices, cases, `\text{}`, nested fractions, `\sum_{i=1}^{n}`); display math with `displayMode:true`; `aligned` blocks become one item per row.
   Edit: `video-engine.ts`, `video-kit.ts`, `scripts/video-engine.test.mjs`.
   Read only: `scripts/video-prototype/speech.mjs`, `t_speech.mjs`.
   Check: golden tests pass; render `fixture.json`; look at 3 frames (inline math inside an Arabic sentence, a fraction, a stepped derivation).

4. **Arabic and mixed-language narration.** Run segmentation, article dropping, plain-text-formula rules, number words (ar/en, decimals, negatives, percent), English abbreviation/acronym prep (`e.g.`, `i.e.`, `vs.`, years, ordinals, spelled-out acronyms), per-type presets (`math`: rate 0.9; `english`: vocabulary tables read row by row; `arabic`: tashkeel kept on screen).
   Edit: `video-engine.ts`, `video-kit.ts`, `scripts/video-engine.test.mjs`.
   Read only: `scripts/video-prototype/speech.mjs`, `pipeline.py`.
   Check: ≥30 mixed sentences give the expected run lists; render the Simplex lesson end to end; Arabic runs ≥4 words stay ≤10% error under the ASR round trip (test script kept out of the kit).

5. **Style polish.** All five styles, write-on animation with pen cursors, chalk roughen filter, sponge erase, `xfade` transition cycle, optional `bgImage`. Produce a contact sheet (one frame per style) and review it.
   Edit: `video-kit.ts` (board page), `scripts/video-prototype/board.mjs` (reference copy).
   Read only: `scripts/video-prototype/board.mjs`.
   Check: contact sheet shows five distinct backgrounds; consecutive scenes differ in style and transition; Arabic words appear right-to-left, equations left-to-right; pen sits at the writing edge.

6. **AI voice provider (BLOCKED until the owner's AI voice feature exists; build everything else first).** Implement `remote` mode: manifest in the tool result, GitHub-raw audio download in the kit, `voice` parameter routing, automatic fallback to offline. Wire the owner's provider behind the interface above.
   Edit: `supabase/functions/mcp/index.ts`, `video-engine.ts`, `video-kit.ts`, the provider module the owner supplies.
   Read only: the owner's AI voice module (its entry points only).
   Check: same lesson rendered with `voice="offline"` and with the AI voice differs only in audio; with the provider forced to fail the run falls back to offline with a warning; second run of the same lesson reuses cached audio files.

7. **Manim fallback/opt-in.** Recipe step 6 in `setup.sh`; `render_manim.py` from `bk_manim.py` with the three workarounds; plain style (style colours only); tables/code as monospace `Text`; inline math as a separate line.
   Edit: `video-kit.ts`, `video-engine.ts` (backend switch).
   Read only: `scripts/video-prototype/bk_manim.py`, `tex2svg.js`, `run_manim.sh`.
   Check: `backend:"manim"` on `fixture.json` gives an mp4 with no empty Arabic lines (assert every `Text` width > 0 in `render_manim.py`).

8. **Docs and release.** Add the tool to the `index.ts` header list; add a `video` topic to `AUTHORING_GUIDE` (when to call, loop over `part`, `include_kit=false` after the first call, `voice` values); save this plan to `docs/plans/lesson-video-export-plan.md`.
   Edit: `supabase/functions/mcp/index.ts`, `supabase/functions/mcp/lib.ts`.
   Read only: none.
   Check: `tools/list` shows the tool; `get_authoring_guide topic=video` returns the text.

## Out of scope

- Download button in the web UI (`public/src/features/home/lesson-download.js`).
- Image/audio/video blocks, quiz embedding, lesson cross-references.
- Improving the offline Arabic voice further (measured: parameters do not help; a better voice comes from the AI voice feature).
- Chalk-writing sound effects, background music, captions/SRT, branding, server-side caching of rendered videos.
- Remotion, skia-canvas, Motion Canvas, libass.

## Appendix A — what is and is not verified in the prototype

- Tested end to end: Chromium v1 slide renderer, Manim renderer, voice pipeline (`pipeline.py`), spoken-math generator, ASR scoring.
- Partially tested: `board.mjs` (style/animation page) — only height measurement and pagination ran. Its visuals, pen positioning, erase sweep and write-on timing have **never been rendered**; step 2 must render and review frames before trusting it.
- Not written: `audio.py` and `render.mjs` for the board renderer (described in step 2).
- The sandbox facts come from this cloud sandbox; the free claude.ai sandbox is assumed equal, which the kit's probe step verifies at run time.

## Appendix B — optional background-image prompts (for an image generator such as Nano Banana; 16:9, 1280×720, no text, no people, empty centre)

- chalk: "Empty classroom green chalkboard with a wooden frame and a chalk tray at the bottom, faint eraser smudges, soft light, no writing, flat front view, 16:9"
- whiteboard: "Clean white classroom whiteboard with aluminium frame and a marker tray holding blue, red, green markers, soft glare, no writing, flat front view, 16:9"
- notebook: "Close-up of a cream lined notebook page with a red margin on the right and spiral binding on the right edge, subtle paper grain, no writing, 16:9"
- blueprint: "Engineering blueprint paper, deep blue with fine white grid lines, subtle corner title block outline with no text, 16:9"
- blackboard: "Dark slate blackboard with a thin metal frame and light chalk dust haze, no writing, flat front view, 16:9"