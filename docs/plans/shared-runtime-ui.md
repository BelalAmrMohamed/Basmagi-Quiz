# Shared Runtime UI (readable source, no hand-edited build output)

## Rules for every phase
- Source is TypeScript and CSS in `runtimes/`. Files in `public/assets/notebook-runtime*/` are **generated only**, never hand-edited, and are committed after `npm run build:runtimes`.
- Keep the host contract unchanged: global `MLWebNotebook` / `BasmagiCppNotebook`, `mount({root, baseUrl, notebook, lang, mode, onChange, onNotice, onInfo})`, returning `{getCells, setCells, destroy}`, plus `window.__mlweb` (`cells, runAll, runCell, files, addFile`). Callers: `notebook-page.js:136`, `notebook-editor.js:166`. Output paths and `runtime-config.js` stay as they are.
- Chrome (toolbar, cells, buttons, dialogs, panels) exists **only** in `runtimes/shared/ui`. Engines never create their own CSS classes or chrome.
- Read only the files each phase lists.

## [x] Phase 1: Build pipeline
1. Create `runtimes/package.json`, merging the C++ dependencies and adding `@codemirror/legacy-modes`, `katex` and `esbuild`. Add `tsconfig.json`.
2. Write `runtimes/build.mjs` with two targets, `matlab` and `cpp`. It outputs to `public/assets/notebook-runtime/{runtime.js,runtime.css,worker.js}` and `public/assets/notebook-runtime-cpp/{runtime.js,runtime.css}`. It also writes `build-info.json` with a SHA-256 of all `runtimes/**` sources.
3. Copy `online-matlab-compiler/packages/interp` to `runtimes/matlab/interp` (with its tests).
4. Replace the stub `build:notebook-runtime` in `package.json` with `build:runtimes`. Keep `build:cpp-runtime` as an alias.

**Done when:** `npm run build:runtimes` succeeds and the C++ notebook behaves as before.

## [] Phase 2: Shared UI (`runtimes/shared/`)
Inputs: `online-matlab-compiler/apps/web/src/main.ts` (structure) and `public/assets/notebook-runtime/runtime.css` (styles). For behavior missing from the old source, run `npx prettier public/assets/notebook-runtime/runtime.js > /tmp/mlweb.pretty.js` and search for the anchors `mlweb-imtool`, `export-formats`, `i.lang===` and `MLWebNotebook={mount`.

Engine contract, in `shared/engine.ts`:
```ts
type Out = {k:'text'|'err'|'warn';s:string} | {k:'img';/*as MATLAB*/} | {k:'html';html:string}
        | {k:'diag';line:number;col?:number;sev:'error'|'warning';msg:string};
interface Engine {
  id: string; label: string;
  editor: { extensions(): Extension[]; completions?: CompletionSource };
  caps: { workspace:boolean; files:boolean; images:boolean; stdin:boolean; history:boolean };
  exportExt: '.m'|'.cpp'; kernel: string;
  run(req:{cells:Cell[]; target:number|'all'; signal:AbortSignal}, sink:{out(o:Out):void; status(t:string,k?:'run'|'error'):void; vars?(v:any[]):void}): Promise<void>;
  runAll?(...): Promise<void>;          // optional batch; shell loops cell by cell if absent
  reset(): void|Promise<void>; addFile?(f:File): Promise<void>; dispose(): void;
}
```
Create these files:
- `shell.ts`: state, render loop, run/stop/run-all, autosave via `onChange`, `setCells`/`getCells`/`destroy`, `window.__mlweb`.
- `toolbar.ts`, `cell-view.ts`: Shift+Enter, Ctrl+Enter, the insert row, the cell menu.
- `outputs.ts`: one renderer per `Out` kind.
- `markdown.ts`: marked, DOMPurify, katex.
- `editor.ts`: a CodeMirror factory. Shared theme and highlight style, line numbers, no line-wrap, `indentWithTab`. It takes extensions from the engine.
- `dialogs.ts`: confirm, help, and a text prompt (used for stdin).
- `side-panel.ts`: the workspace table, files strip and history. Each part renders only if its `caps` flag is true.
- `image-tool.ts`: the imtool window with resize, minimize and maximize. Rendered only if `caps.images` is true.
- `export-dialog.ts` and `i18n.ts` (en/ar; engines may add strings).
- `styles/*.css`: split the rules of `runtime.css` by area (tokens, toolbar, cells, outputs, editor, dialogs, side-panel, imtool). **Keep class names and the `.mlweb` root exactly**, so the look is identical.

**Done when:** `tsc --noEmit` passes and a jsdom test mounts the shell with a fake engine.

## [] Phase 3: MATLAB engine on the shared UI
Create `runtimes/matlab/src/{index.ts,engine.ts,completions.ts,indent.ts,worker.ts}`.
- `engine.ts` wraps the interpreter worker, with a 60 s limit, workspace vars, and image and file handling. Caps are all true except `stdin`.
- `completions.ts`: port `matlabCompletionSource` from the old `main.ts`.
- `indent.ts`: auto-indent on Enter after `if/for/while/switch/function`, and dedent on `end/else/elseif/case/otherwise`. The zip has no `scripts/runtime-patches`, so implement it natively here. Delete the patch mechanism if it exists in your working copy.
- The entry sets `window.MLWebNotebook = { mount }`.

**Done when:** all items in the manual checklist below pass for MATLAB.

## [] Phase 4: C++ engine on the shared UI
- `runtimes/cpp/src/engine.ts` keeps only the existing `execute` (the `cpp-run` Edge Function call), the cell assembly, and `@codemirror/lang-cpp`. Caps: all false except `stdin`.
- Compiler errors become `{k:'diag'}` outputs, which the shared UI renders. The stdin request uses the shared prompt dialog. Compile status uses `sink.status`.
- **Delete** `runtimes/cpp/src/notebook-shell.ts` and `style.css`. `public/assets/notebook-runtime-cpp/runtime.css` is now just the shared CSS.
- Update the imports in `tests/notebook-runtime-cpp.test.js`, `cpp-assemble.test.js` and `cpp-providers.test.js` only.

**Done when:** the checklist passes for C++, and its cells, toolbar and menus look identical to MATLAB.

## [] Phase 5: Tests that can actually fail
Replace the string-grep `tests/notebook-shell-parity.test.js` with:
1. jsdom tests mounting the **real** shell with the MATLAB engine and the C++ engine (fake `run`). Assert that the DOM skeleton (toolbar, cell, output and menu elements and classes) is identical, differing only by the engine's `caps` panels.
2. Every class used in the rendered DOM must be defined in the shared CSS.
3. Fail if `runtimes/cpp/src` or `runtimes/matlab/src` contains a `.css` file or a `className=`/`class:` outside `shared/`.
4. Freshness: recompute the hash of the `runtimes/**` sources and compare it with `build-info.json`.
5. Add `npm run test:runtimes`.

## [] Phase 6: Cleanup and docs
1. Delete `online-matlab-compiler/` from this repo only after Phases 3 to 5 are green.
2. Add `docs/runtimes.md`: the architecture, the Engine contract, and "add a runtime in 4 steps":
   - Create `runtimes/<id>/src/engine.ts`.
   - Add an entry to `runtime-config.js`.
   - Add a build target in `build.mjs`.
   - Set the `caps`.
3. Update `PROJECT_STRUCTURE.md`.

---

## Manual checklist (Phases 3 and 4, light/dark, phone width, Arabic)
- [ ] The toolbar is the same, with Run all, Stop and the "more" menu. The status text is right.
- [ ] Cell hover tools, the cell menu, the insert row and Shift+Enter all work.
- [ ] Code cells have line numbers, no wrap, correct highlighting and autocomplete.
- [ ] Markdown cells show math and edit/preview correctly.
- [ ] The help and confirm dialogs and the export dialog look the same.
- [ ] MATLAB only: the workspace panel, the files strip, the image tool, and indent on Enter.
- [ ] C++ only: the stdin prompt and the compiler error display.

A word on cost: Phase 2 is the largest. If your credits run out mid-phase, ask the agent to commit what it has and list the files it hasn't written yet. Then re-run it with only that list.