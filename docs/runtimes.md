# Notebook runtimes

One shared notebook UI, one small engine per language. MATLAB and C++ look and behave the same because they run the **same** shell; an engine only runs code and reports results.

```
runtimes/
├── shared/            the whole UI: shell, toolbar, cells, outputs, dialogs, side panel, image tool, i18n, styles/*.css
│   └── engine.ts      the Engine contract (below)
├── matlab/src/        MATLAB engine (interpreter worker, workspace, files, completions, indent)
├── matlab/interp/     the MATLAB interpreter (own tests: `npm test` inside that folder)
├── cpp/src/           C++ engine (cpp-run Edge Function call, diagnostics, completions)
├── build.mjs          esbuild: one target per runtime, writes public/assets/notebook-runtime*/ and build-info.json
└── test/              unit + jsdom tests (including test/parity.test.mjs)
```

## Rules
- Source is TypeScript and CSS in `runtimes/`. Everything under `public/assets/notebook-runtime*/` is **generated**: never edit it, run `npm run build:runtimes` and commit the result.
- Chrome (toolbar, cells, buttons, dialogs, panels, CSS classes) exists only in `runtimes/shared`. Engines never create DOM, classes or CSS files. `test/parity.test.mjs` fails if they do.
- The host contract is fixed: a global (`MLWebNotebook` / `BasmagiCppNotebook`) with `mount({ root, baseUrl, notebook, lang, mode, onChange, onNotice, onInfo })` returning `{ getCells, setCells, destroy }`, plus `window.__mlweb` (`cells, runAll, runCell, files, addFile`). Callers: `notebook-page.js` and `notebook-editor.js`.
- Language-specific logic stays in the engine (`cpp/src`, `matlab/src`). `shared/` must not mention a language.

## Architecture
`mountShell(engine, opts)` (in `shared/shell.ts`) owns the state, render loop, run / stop / run-all, autosave through `onChange` and `window.__mlweb`. It builds the toolbar (`toolbar.ts`), cells (`cell-view.ts`), outputs (`outputs.ts`, one renderer per `Out` kind), markdown (`markdown.ts`), the CodeMirror editor (`editor.ts`), dialogs, the side panel and the image tool. Panels appear only when the engine's `caps` ask for them. Strings come from `i18n.ts` (en/ar; an engine can pass extra translations to `mountShell`).

```
host page ──mount()──▶ <runtime>/src/index.ts ──▶ mountShell(engine, opts)
                                                     │ run(req, sink)
                                                     ▼
                                              engine (language-specific)
```

## Engine contract (`shared/engine.ts`)
```ts
interface Engine {
  id: string; label: string;                       // also kernelDisplay?, language?, mimetype?
  editor: { extensions(): Extension[]; completions?: CompletionSource | CompletionSource[] };
  caps: { workspace: boolean; files: boolean; images: boolean; stdin: boolean; history: boolean };
  exportExt: '.m' | '.cpp'; kernel: string;        // export file extension, Jupyter kernelspec
  run(req: { cells: Cell[]; target: number | 'all'; signal: AbortSignal }, sink: RunSink): Promise<void>;
  runAll?(req, sink): Promise<void>;               // optional batch; otherwise the shell loops and stops at the first error
  reset(): void | Promise<void>; dispose(): void;
  attach?(host: { codeSources(): string[] }): void; // notebook sources, for completions
  addFile?(f: File): Promise<void>; removeFile?(name: string): void; files?: Map<string, ImageFile>;
  prepare?(sources: string[]): Promise<void>;
  help?: {...}; legacyStoreKey?(id: string): string; importAccept?: string;
}
type Out = { k: 'text' | 'err' | 'warn'; s: string } | { k: 'img'; ... } | { k: 'html'; html: string }
         | { k: 'diag'; line: number; col?: number; sev: 'error' | 'warning'; msg: string };
// RunSink: out(o, cell?), clear(cell?), status(text, 'run' | 'error' | 'result'?), vars?(v), files?(), input(req?, cell?)
```
`caps` switches on the panels: `workspace` (variable table), `files` (files strip), `images` (image tool), `history` (command history). `stdin: true` means the engine may call `sink.input()`, which shows the inline Jupyter-style input box. Compiler or interpreter errors with a position should be sent as `diag` outputs.

## Add a runtime in 4 steps
1. **Create `runtimes/<id>/src/engine.ts`** (and `index.ts` that calls `mountShell` and sets `window.<Global> = { mount }`, like `cpp/src/index.ts`).
2. **Add an entry to `public/src/shared/runtime-config.js`** (`label`, `global`, `base`, `kernel`, `codeExts`, `workspaceExts`).
3. **Add a build target in `runtimes/build.mjs`** (`entry`, `outDir`, `globalName`) and the new source folder to `SOURCE_ROOTS`.
4. **Set the `caps`** to the panels the language needs, then run `npm run build:runtimes` and `npm run test:runtimes`.

## Checks
- `npm run typecheck:runtimes`, `npm run test:runtimes`, `npm run build:runtimes` (all from the repo root).
- `test/parity.test.mjs` mounts the real shell with both engines and asserts: identical DOM skeleton (except caps panels), every rendered class has a rule in `shared/styles`, no CSS or class names inside engines, and `build-info.json` matches the current sources (so a stale bundle fails the test).

## C++ specifics
`cpp/src/engine.ts` assembles the cells and calls the `cpp-run` Supabase Edge Function (`supabase/functions/cpp-run`), which compiles through Wandbox, then Piston when `PISTON_TOKEN` is set. Each provider has its own time budget and failures are reported per provider. Autocomplete lives in `cpp/src/completions.ts` and `completion-data.ts`. `node scripts/cpp-run-probe.mjs` times each hop when debugging.

## Challenge cells

A code cell may carry `challenge: { expectedOutput, matchMode?, tolerance?, testStdin?, hint?, solution? }` (schema and limits: `public/src/shared/content-rules.js`, synced with `npm run sync:mcp`).

- Grading is output-only and lives in `runtimes/shared/challenge.ts` (pure, unit-tested). Engines are untouched, except that a cell with `stdinLocked` must use its `stdin` without prompting (C++ `testStdin`).
- UI: `shared/challenge-view.ts` (header, pass/fail banner, author panel in edit mode) + `shared/styles/challenge.css`; strings in `i18n.ts`.
- The shell exposes `describe()` / `runCellAt(n)` on its handle for the notebook AI agent (`public/src/features/notebook/notebook-agent*.js`).
- `solution` is shipped to the browser (learners may reveal it); never put secrets in it.
