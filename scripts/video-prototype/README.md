# Prototype code for the lesson-video feature (state at pause, 2026-11-01). Starting point, not production code.

STATUS KEY: [tested] ran and output checked | [partial] ran, output not fully checked | [untested] written, never executed end to end

## Speech / narration (JS)
- speech.mjs [tested]   markdown -> narration runs [{lang,text}]; LaTeX -> spoken ar/en via katex.__parse; opts {mathLang}
- t_speech.mjs [tested] 12 math cases for ar and en (turn into golden tests)
- narr.mjs, narr2.mjs [tested]  fixture.json -> narr*.json (narr2 writes both mathLang variants)
- fixture.json [tested] Arabic math lesson with real LaTeX + English terms (5 scenes). fixture2.json [partial] same + table/list scene, item-based, for the board renderer

## Voice (Python)
- vo.py [tested]       sherpa-onnx TTS (VITS/piper, Kokoro), Whisper ASR scoring, F0 stats (parselmouth), ffmpeg fx()
- pipeline.py [tested] speak(runs,cfg): Arabic = mishkal diacritics + kareem-medium + EQ/compressor/loudnorm; English = Kokoro male sid 6; run joins and pauses
- run_vo1..4,6.py [tested] experiments behind the numbers in the plan (CER via ASR round trip, male English candidates)

## Renderers (Node / Python)
- page.mjs + bk_chromium.mjs [tested]  v1 slide renderer (Chromium, setT(t), screenshots only on change, ffmpeg pipe)
- bk_manim.py + run_manim.sh [tested]  Manim renderer with the Arabic workarounds (LRM prefix, per-run bidi, `with register_font`)
- bk_skia.mjs [tested]  skia-canvas renderer (evidence only; not chosen)
- tex2svg.js [tested]   MathJax SVG converter (white fill)
- board.mjs [UNTESTED rendering]  v2 whiteboard/chalkboard explainer page builder: 5 procedural styles, handwriting fonts, word-by-word write-on reveal with a pen cursor, page/erase logic. Only its measure() was executed.
- sb_build.mjs [tested] fixture2 -> storyboard.json (runs per item, style per scene, MATHLANG env)
- paginate.mjs [tested] measures item heights in Chromium, splits into board pages (title repeated per page), scales oversized items. Output on fixture2: s3 and s4 and s6 split into 2 pages, none overflow.
- make_layout.py [tested for v1 only]

## Not written yet
- audio.py (per-item synth, timeline with erase pauses, master audio), render.mjs for board.mjs (per-scene mp4 + ffmpeg xfade + audio mux)

Setup: npm i katex@0.16.9 mathjax-full@3.2.2 @fontsource/cairo @fontsource/playpen-sans-arabic @fontsource/aref-ruqaa playwright-core @sparticuz/chromium ; copy the woff2 files to ./fonts
       pip install sherpa-onnx==1.12.40 soundfile numpy mishkal praat-parselmouth ; models: see plan "Bootstrap"
