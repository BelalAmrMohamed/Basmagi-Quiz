// =============================================================================
// runtimes/tiptap-vendor/hljs-extra.js
// Extra highlight.js grammars for the AI Agent's rich input, on top of the
// `common` set that lowlight ships (see ./index.js). Built by build.mjs into
// public/assets/vendor/tiptap/hljs-extra.js (an ES module); the rich input
// loads it lazily next to tiptap.js and registers every export with lowlight,
// so a missing/failed load only costs highlighting for these languages.
//
// TOML needs no entry here: highlight.js highlights it with its `ini` grammar
// (alias "toml"), which `common` already contains.
//
// `highlight.js` is resolved from runtimes/node_modules (already installed as
// a dependency of lowlight/katex); the grammars are plain functions that take
// the core instance as an argument, so any 11.x release works with lowlight.
// =============================================================================
export { default as matlab } from 'highlight.js/lib/languages/matlab';
export { default as powershell } from 'highlight.js/lib/languages/powershell';
export { default as dockerfile } from 'highlight.js/lib/languages/dockerfile';
export { default as scala } from 'highlight.js/lib/languages/scala';
export { default as dart } from 'highlight.js/lib/languages/dart';
export { default as elixir } from 'highlight.js/lib/languages/elixir';
export { default as haskell } from 'highlight.js/lib/languages/haskell';
export { default as x86asm } from 'highlight.js/lib/languages/x86asm';
