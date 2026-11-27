# Offline support

Goal: installed users (and anyone with local content) can use `/notebook/new`, saved notebooks, quizzes, lessons and
`/my-content` without a connection. The content itself already lives in `localStorage["user_quizzes"]` / IndexedDB; the
service worker (`public/service-worker.js`) caches the code that renders it.

| Layer | What | Who |
|---|---|---|
| Install | `/offline`, `/`, plain shells `/quiz`, `/lesson`, `/notebook` | everyone |
| Runtime | anything visited (existing strategies) + CDN files (KaTeX, supabase-js, Google Fonts) | everyone |
| `WARM_OFFLINE` | every JS/CSS file of home, quiz, lesson, notebook (list: `dist/offline-manifest.json`, written by `scripts/build-web.mjs`), MATLAB runtime, editor, KaTeX/Google fonts | installed app, local content, or Instant Compiler installed |
| `WARM_OFFLINE` + compiler | C++ runtime | only when cache `basmagi-cpp-wasm-v2` (the ⚡ Instant Compiler) exists |

Offline routing (`offlineShellFor`): `/my-content*` -> `/`; `/notebook/new`, `/notebook/edit/user_notebook_*`,
`?type=user` and `user_*` ids -> the matching shell. Published items (`/quiz/<uuid>`) are server-rendered and still show `/offline`.

Rules: the service worker must only delete caches starting with `basmagi-v`; `basmagi-cpp-wasm-*` holds the ~60 MB compiler.
Shells are cached from their plain URLs only, never from `/quiz/<id>` responses (those carry an injected id).
