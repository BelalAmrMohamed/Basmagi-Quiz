# C++ Runtime: Implementation Plan

## Decisions (all resolved)
- **Runtime ids:** `matlab` and `cpp`.
- **MATLAB runtime:** untouched. Its `runtime.js` stays a built artifact. The uploaded `online-matlab-compiler` is the standalone site and has no `MLWebNotebook.mount` embed layer, so it is not used. Do not add it to Basmagi.
- **C++ runtime:** new Basmagi-owned source in `runtimes/cpp/` (TypeScript + esbuild). It builds to `public/assets/notebook-runtime-cpp/{runtime.js,runtime.css}` and is committed, like the MATLAB build. It exposes `window.BasmagiCppNotebook.mount`, with the same contract as `MLWebNotebook.mount`.
- **Execution:** Supabase Edge Function `cpp-run` calls a remote compiler. The primary provider is Wandbox (gcc, no key). Piston (`emkc.org`) is used only if the secret `PISTON_TOKEN` is set, because its public API now requires authorization (educational, low-volume use is allowed). Apply for the token in parallel; this does not block the work.
- **Cell model:** Jupyter-style, implemented by **replay**. A remote compiler is stateless, so every run assembles one program from cells 1..k. Output of earlier cells is discarded, and only cell k's output is shown.
- **`cin`:** a remote run cannot prompt interactively. Each code cell has an optional "Input (cin)" textarea. It is saved in the notebook as an optional `stdin` string on code cells (≤ 4000 chars, `cpp` only).
- **Selector:** visible on `/notebook/new` and locked after the first save. "Edit a copy" keeps the runtime.
- **Compiler flags:** fixed `-std=c++17 -Wall -Wextra -O1`.

## Phase 1: DB, rules, sync
1. Add the migration `supabase/migrations/20261106100000_notebooks_cpp_runtime.sql`. It drops `notebooks_runtime_check` (use `IF EXISTS`), re-adds it as `CHECK (runtime IN ('matlab','cpp'))`, and updates the column comment.
2. Add the quota table. `cpp_run_quota(ip_hash text, window_start timestamptz, n int, PRIMARY KEY(ip_hash, window_start))` has RLS on and no policies. The security-definer function `cpp_run_hit(p_key text, p_limit int, p_window_s int) returns boolean` does an atomic upsert-increment per fixed window. It also deletes rows older than 2 days, and it is executable by `service_role` only.
3. In `public/src/shared/content-rules.js`:
   - Set `NOTEBOOK_RUNTIMES = ["matlab","cpp"]`.
   - In `normalizeNotebookContent`, keep an optional `stdin` string on cells when the notebook is `cpp` (it currently drops unknown keys). Pass the runtime into the function.
   - In `checkNotebook`, check `stdin` is a string of at most 4000 chars, add a `CELL_STDIN_INVALID` error, and add a limit constant `LIMITS.notebookCellStdin`.
4. Update every caller of `normalizeNotebookContent` (`api/_validateNotebook.js`, `notebook-editor-model.js`, `supabase/functions/mcp/lib.ts`) to pass the runtime.
5. Run `npm run sync:mcp`. This syncs `content-rules.js` to the MCP function and `notebook-convert.js` to `scripts/lib`.
6. Add `cpp` to `RUNTIME_CONFIG` in `public/src/shared/runtime-config.js`:
   ```
   cpp: { label:"C++", codeExts:[".cpp",".cc",".cxx",".h",".hpp"], workspaceExts:[],
          global:"BasmagiCppNotebook", base:"/assets/notebook-runtime-cpp/", kernel:"xcpp17" }
   ```
   Also add `global`, `base` and `kernel` to the existing `matlab` entry.

## Phase 2: Edge function `supabase/functions/cpp-run/`
Files: `index.ts`, `assemble.js` (pure ESM, imported by both Deno and `node --test`), `providers.ts`, `ratelimit.ts`.

**Request** (POST JSON): `{ cells: [{ src, stdin }], target: <index> | "all" }`. It contains code cells only, with the order preserved. The client numbers them 1..n as `[k]`.
- Caps: ≤ 200 cells, total src ≤ 128 KB, total stdin ≤ 32 KB.
- Reject otherwise with 413.

**Response:**
`{ ok, compile, sections:[{stdout,stderr}], exit, signal, timeMs, truncated, provider }`
- Output is truncated to 64 KB per stream.
- Compile failure returns `ok:false` with the diagnostics and empty sections.

**`assemble.js`**
1. `splitCell(src)` is a scanner over top-level code. It ignores `//` and `/* */` comments, strings, char literals and raw strings, and tracks `() [] {}` depth. It splits segments at a depth-0 `;`, or at a closing `}` at depth 0. It joins a trailing `;` after `}`. For `class/struct/union/enum` heads it runs to the next depth-0 `;`.
2. Each segment is classified as **decl** (hoisted to global scope, in order) or **stmt** (placed in `main`, in order):
   - decl: lines starting with `#` (with `\` continuations), `using`, `typedef`, `namespace`, `template`, `class/struct/union/enum`, `extern "C"`.
   - decl: function definitions. These match `^[^=;{]*\)\s*(const|noexcept|override|final|\s)*(->[^={;]+)?(:[^;{]*)?\{`, and the first word is not `if/for/while/switch/do/try/else/catch`. This also covers out-of-class constructors with init lists.
   - decl: top-level declarations that start with `const`, `constexpr`, `static const` or `inline`. These are needed for array sizes and for use inside functions.
   - decl: any segment immediately preceded by a `//@global` comment line.
   - stmt: everything else, including variables and expression statements. Statements such as `else {…}` stay in order and adjacent.
3. `assemble(cells, target)` builds the program in this order:
   - The harness `#include <iostream>`, `<sstream>`, `<exception>`.
   - All cells' decls, each preceded by `#line <origLine> "cell-<k>"`.
   - `int main(){ try{ … } catch(const std::exception&e){ std::cerr<<"terminate: "<<e.what(); } catch(...){ std::cerr<<"terminate: unknown exception"; } return 0; }`
4. Inside `main`, for each cell 1..target (all cells if target is `"all"`):
   - Declare `std::istringstream __nb_in_k(R"<d>(…)<d>")`. Pick a delimiter `<d>` not present in the content.
   - Run `std::cin.clear(); std::cin.rdbuf(__nb_in_k.rdbuf());` so each cell reads only its own stdin.
   - Emit `#line` and the cell's stmts.
   - Emit the marker `std::cout<<"\x1e@@NB:k@@\x1e"<<std::flush; std::cerr<<"\x1e@@NB:k@@\x1e";`.
5. If a cell defines `main`, rename it to `__nb_main_<k>` and call it at that cell's slot: `(0,nullptr)` if it has parameters, otherwise no arguments.
6. `splitSections(stdout, stderr)` splits both streams by the markers into per-cell sections, and returns only the target section (or all of them).

**Providers**
- `wandbox`: POST `https://wandbox.org/api/compile.json` with `{compiler, code, "compiler-option-raw":"-std=c++17 -Wall -Wextra -O1", save:false}`.
  - Resolve the newest stable `gcc-*` C++ compiler from `GET /api/list.json`, cache it for 1 h in memory, and fall back to `gcc-head`.
  - Map `compiler_error`/`compiler_message`, `program_output`, `program_error`, `status` and `signal` to the response shape.
  - The smoke script prints the raw JSON; adjust the field mapping if it differs.
- `piston` (only with `PISTON_TOKEN`): POST `https://emkc.org/api/v2/piston/execute` with `{language:"c++", version:"*", files:[{content}]}` and the `Authorization` header.
- Order: wandbox, then piston. Retry once on network error, 429 or 5xx. Use an `AbortController` with a 20 s total timeout.

**`index.ts`**
- Keep the default `verify_jwt` (the client sends the anon key).
- CORS allow-list from the `ALLOWED_ORIGINS` secret, defaulting to `https://basmagi-quiz.vercel.app` plus `http://localhost:8080` and `http://localhost:8081`.
- IP from `cf-connecting-ip`, then the first `x-forwarded-for` entry. Hash it with SHA-256 and `IP_SALT`; never store raw IPs.
- Call `cpp_run_hit` with 20 runs/min per hash, 300 runs/day per hash, and a global key `*` at 4000 runs/day. Return 429 with `Retry-After`.
- Never log source or stdin.

## Phase 3: C++ runtime `runtimes/cpp/`
- **Layout:** `package.json` (own deps: `esbuild`, `typescript`, `codemirror`, `@codemirror/{state,view,commands,language,autocomplete,lang-cpp}`, `marked`, `dompurify`), `build.mjs`, and `src/{index,cells,editor,run,markdown,i18n}.ts` plus `src/style.css`.
- **Root scripts:** add `build:cpp-runtime` that runs `npm ci --prefix runtimes/cpp && npm run build --prefix runtimes/cpp`, and `"typecheck:cpp"`. Do not touch `build:notebook-runtime`.
- **`mount(opts)`** takes `{root, baseUrl, notebook, lang, mode?, onChange?, onNotice?, onInfo?}` and returns `{getCells, setCells, destroy}`.
  - `getCells` returns `{id,type,source,stdin?}`.
  - `destroy` also removes `window.__mlweb`.
  - On mount, set `window.__mlweb = { addFile: async()=>{} }` so the existing workspace bridge calls are harmless.
- **Targeted read:** grep `public/assets/notebook-runtime/runtime.js` for `__mlwebExport|__mlwebImport|toolbar-menu-items|onInfo|onChange` and copy exactly how the menu invokes those hooks. Copy the `:root` token block and the cell, toolbar and menu styles from `runtime.css`, prefixing classes with `cppnb-`.
- **Menu:** keep the class `.toolbar-menu-items` on the menu container. The "Edit a copy" and Drive injections depend on it. The menu items are Import…, Export…, Notebook info, and Reset outputs.
- **Editor:** CodeMirror 6 with C++ highlighting, built-in smart indent (4 spaces), no line wrapping (horizontal scroll), `indentWithTab`, and autocomplete over a static list of C++ keywords and common `std` names. Editors, outputs and compiler messages are always `dir=ltr`. In `ar`, the UI is RTL.
- **Cells:**
  - Markdown cells render with `marked` + `DOMPurify`.
  - Code cells show a `[k]` ordinal, an "Input (cin)" collapsible textarea, and an output area.
  - The output area has stdout (pre), stderr (red), a status chip (`Compiling…`, `Running…`, `Exit n`, time, provider), and a collapsible compiler warnings/errors block.
  - Rewrite diagnostics `cell-K:line:col` to "Cell K, line N". Clicking one focuses that line in cell K.
- **Edit mode:** add, delete, move and change the type of cells, and call `onChange(cells)`.
- **View mode:** learners can edit and run. Edits autosave to `localStorage` under `basmagi:nb:<id>:v1`, with a "Reset notebook" menu item.
- **Run:**
  - Shift+Enter runs cell k and moves to the next cell.
  - Ctrl+Enter runs cell k and stays.
  - "Run all" sends one request with `target:"all"`.
  - Requests go through `fetch(SUPABASE_URL + "/functions/v1/cpp-run")` with the `apikey` and `Authorization` headers using `SUPABASE_ANON_KEY` from `public-config.js`. Inline these two values at build time.
  - Support abort via `AbortController`, with a 25 s client timeout.
  - Show 429, offline and failure messages in `en`/`ar`.
  - A cell with an empty source is skipped.
  - Outputs are in memory only.
- **Info text** (tooltip and info modal): earlier cells are re-run on every run (their output is hidden); notebook variables are visible to later cells but not inside functions; use `const` globals or `//@global`; no file I/O; `cin` reads from the cell's Input field.

## Phase 4: Integration in Basmagi pages
1. New `public/src/shared/runtime-loader.js` with `loadRuntime(id)`. It looks up `global` and `base` in `RUNTIME_CONFIG`, caches one promise per runtime, and rejects with "runtime missing" if `window[global]?.mount` is absent. Replace the duplicated loaders in `notebook-page.js` and `notebook-editor.js` with it.
2. `notebook-page.js`:
   - Use `notebook.runtime` for loading and for `baseUrl`.
   - Where it currently maps cells to `{type, source}` (export, copy, files-strip meta), use a shared `cellToPlain(c)` helper that includes `stdin`.
3. `notebook-editor.js`:
   - Replace the hard-coded `runtime:"matlab"` and `RUNTIME_BASE`.
   - Add the `cellToPlain` helper in its `onChange`, `currentCells` and export mappings.
   - Make the `#cnbRuntime` change handler call `mountEditor()` again, keeping the cells and showing a notice.
   - Disable `#cnbRuntime` when `editId` exists (the lock).
4. `notebook-editor-model.js`: default new-notebook cells for the `cpp` runtime stay `[{type:"code",source:""}]`; keep `runtime` and `stdin` in the state mapping.
5. `public/notebook.html`: unhide `#cnbRuntime`, add `<option value="cpp">C++</option>`, and add a visible label (en/ar).
6. `notebook-lang.js`: split `disclaimer` per runtime. The `cpp` text (en/ar) must say that code is sent to an online compiler to run, is not stored, needs internet, and that the work itself is kept on the device. Grep `public/` for the old "never sent to a server" claim and make it MATLAB-only.
7. Runtime label: wherever the runtime is displayed (`notebook-card-view.js`, `api/_og/notebook.js`, `notebook.html` meta), grep `MATLAB` and make it come from `RUNTIME_CONFIG[runtime].label`.
8. Import/export:
   - `public/src/shared/notebook-convert.js`, `notebookFromFile`: `.cpp/.cc/.cxx/.h/.hpp` becomes one code cell with runtime `cpp`; `.ipynb` is `cpp` when its kernelspec/language_info says C++, otherwise `matlab`; `.m` is unchanged.
   - `notebook-file-import.js`: update the supported-files message.
   - `notebook-export.js`: write a runtime-aware `.ipynb` kernelspec (`xcpp17` / C++), and include `stdin` in the notebook JSON.
   - Run `npm run sync:mcp`.
9. MCP authoring guide in `supabase/functions/mcp/lib.ts`: where the notebook cell format is described (around the `runtime:` line), add a short C++ paragraph covering the replay semantics, `//@global`, `stdin`, and one example cell pair.

## Phase 5: Tests, seed, docs
- `tests/cpp-assemble.test.js` (`node --test`) covers:
  - class + `main`;
  - class in cell 1 used by cell 2;
  - `const` hoisting and `//@global`;
  - `}`, `;` and `//` inside strings, chars and raw strings;
  - ctor with init list;
  - template function;
  - lambda statement;
  - `if/else` and `do/while` stay adjacent;
  - `#define` with continuation;
  - `main` renaming;
  - stdin delimiter escaping;
  - `#line` mapping;
  - limit rejection;
  - `splitSections`.
- `tests/cpp-providers.test.js`: mocked `fetch` for Wandbox and Piston mapping, retry, fallback, truncation, and 429 from the quota.
- `tests/notebook-runtime-cpp.test.js`: `cpp` accepted, unknown runtime rejected, `stdin` kept and validated, `routeFile("cpp","a.cpp") === "code"`, and convert/export round trip.
- Playwright (as before): mock `**/functions/v1/cpp-run`. Verify the run flow, Shift+Enter, error-line jump, the `cin` field, selector lock after save, and the "Edit a copy" menu entry still injecting.
- Seed two C++ notebooks in `scripts/seed-notebooks.mjs`:
  - "2D & 3D arrays" (declaration, nested loops, passing to functions);
  - "OOP: classes, inheritance, encapsulation, polymorphism" (virtual functions, abstract class, `vector<Base*>`).
- Update `CHANGELOG.md`, `PROJECT_STRUCTURE.md` (via `npm run map`) and the README runtime section.

## Phase 6: Deploy and verify
```
supabase db push
supabase secrets set IP_SALT=<random 32+ chars> ALLOWED_ORIGINS=https://basmagi-quiz.vercel.app [PISTON_TOKEN=...] --project-ref esdfdzhtavraczrhxnmp
supabase functions deploy cpp-run --project-ref esdfdzhtavraczrhxnmp
npm run build:cpp-runtime
```
Add `scripts/cpp-smoke.mjs`. It calls the deployed function with 6 programs: hello world; 2D array; 3D array; inheritance + virtual dispatch; a `cin` read; and a deliberate compile error. It asserts the outputs and the `Cell K, line N` mapping, and prints the raw provider JSON. Run it after the deploy.

## Acceptance criteria
1. A new notebook can be created as C++, saved, reopened, published, and the selector is locked after the first save.
2. The two seed notebooks run correctly with real g++ output.
3. A class from cell 1 is used by cell 3, and "Run all" does a single request.
4. A compile error links to the right cell and line.
5. `cin` works via the Input field.
6. The 21st request within a minute from one IP returns 429 and the UI shows a clear message.
7. A MATLAB notebook is unchanged. MATLAB-only tests (`npm test`) pass.

## Known limits (documented in the UI)
- Needs internet, and depends on a free community service (no SLA).
- Earlier cells are re-run on every run, so `rand()`/time output can differ between runs.
- Non-const notebook variables are not visible inside functions defined in cells.
- No file I/O and no interactive `cin` prompt.