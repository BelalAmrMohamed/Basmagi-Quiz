# MLWeb: Image Processing Course Coverage and Performance UX — Implementation Plan

**Audience:** the developer (or AI coding agent) implementing this. **Repo:** `basmagi`. **Product:** MLWeb, the MATLAB-style notebook runtime for the COMP421/ACS352 Image Processing course (Minia University).

This plan contains no open questions. Every decision is already made in section 2. Follow the phases in order; each phase is one commit and must leave all test suites green.

## 0. Ground rules

- **Edit sources only.** Work in `runtimes/matlab/**` (interpreter, engine, worker), `runtimes/shared/**` (notebook UI), tests, and docs. `public/assets/notebook-runtime/runtime.js` and `worker.js` are generated. Never edit them by hand; regenerate with `npm run build:runtimes` (root) at the end of every phase and commit the result together with `runtimes/build-info.json`.
- **Commands per phase:**
  - `cd runtimes/matlab/interp && npm test`
  - `npm run typecheck:runtimes && npm run test:runtimes` (root)
  - `node --test tests/notebook*.test.js` (root)
- **Registration pattern:** builtins are registered in `runtimes/matlab/interp/src/interp.ts` with `def('name1 name2', (a, nargout, I) => V[])` (see line \~336). Values are column-major N-d tensors `T = { cls, dims, data: Float64Array }` from `values.ts`. Helpers: `mk`, `num`, `str`, `toStr`, `T_`, `err`, `ew`, `sat`.
- **Fidelity rule:** follow MathWorks documented behavior (1-based, column-major, class semantics, saturation and rounding). Error messages use the existing style `Error using <fn>: ...`. Every deliberate deviation from MATLAB is written in the function's help text under "Differences from MATLAB".
- **No new runtime dependencies.** No change to the behavior of builtins that already work, except where a phase says so (`imhist` with no output, `imresize` bicubic, class rules).
- **Per-function checklist (definition of done for each new function):** implementation, one entry in `FUNCTION_DOCS` (signature plus English description), included in the group item in `help.ts` (English and Arabic), and at least one test with hand-verified numbers (small 2x2 to 5x5 inputs whose result is computed by hand, not by running the new code).

## 1. Findings (verified by running the current interpreter)

### 1.1 What the course uses

Sources read: Lecture 6–9 `.m` and PDF files, and `Book.pdf` (chapters 1–4 with programming labs). Lectures 1–5 were verified by the course owner and are not repeated here.

| Lecture | Constructs used | Status today |
| --- | --- | --- |
| 6 (zoom: replication, zero-order hold) | nested `for`, slice assign `b(i,j,:)=a(i,j,:)`, `imwrite` then `imread` round trip, user functions that call `imtool`, uint8 arithmetic | Works. Only slow on large images |
| 7 (K-times zoom, brightness, contrast, negative) | per-pixel loops with `+`, `*`, `255-x` on uint8 (saturation) | Works |
| 8 (histogram, rotate, flip, transpose, slicing) | `imhist(g)` **with no output**, `figure`, `histeq`, auto-growing arrays `B(i,j,:)=...` with undefined `B`, `A(:,:,1)'`, `&&` conditions, `K(i,j,:)=[0,0,255]` | Only `imhist(g)` fails: *"plotting is not available yet"* |
| 9 (slicing, webcam, motion detection) | `imaqhwinfo`, `videoinput`, `preview`, `getsnapshot`, `closepreview`, `while (true)`, `pause`, `beep`, `sum(BGS(:))`, `numel`, `abs` on uint8 | `pause`, `beep` and all video functions missing |
| Book labs (ch. 1–4) | `peppers.png`, `edge(G,'sobel')`, `title`, `figure; imshow`, `mean(I,3)`, `imfinfo(...).BitDepth`, `[r,c,ch]=size`, `fprintf`, `rgb2hsv`, `rgb2ycbcr`, `im2double` | `edge`, `title` missing; the sample image is named `pepper.png`, not `peppers.png` |

### 1.2 Verified missing (each returned *"Unrecognized function or variable"* or a parse error)

- **Plotting:** `plot bar stem hist subplot title xlabel ylabel axis grid legend colormap colorbar clf drawnow text line imagesc image`; `imhist` with no output.
- **Language:** anonymous functions and handles (`@`), `cellfun`, `arrayfun`, `try/catch e`, `%{ %}` block comments, `nargin`, `nargout`, `exist`, `global`, struct arrays, matrix `*` `/` `\` `^` (the runtime throws "not supported yet").
- **Math and arrays:** `atan atan2 sinh median mode std var cumprod diff unique cat horzcat vertcat eye randn magic diag tril triu inv det trace rank isequal islogical isnan isinf isrow isvector isscalar flip rot90 circshift kron permute squeeze meshgrid sub2ind ind2sub bitand bitor bitxor bitshift histc accumarray nnz norm dot cross intmax intmin realmax`.
- **Strings:** `strcat strrep strsplit strtrim upper lower strcmpi str2double str2num int2str mat2str fieldnames isfield`.
- **Classes:** only `double uint8 logical char` exist. `uint16 int8 int16 int32 single` are missing (`Cls` in `values.ts`).
- **Image Processing Toolbox:** `edge imfilter fspecial conv2 filter2 medfilt2 ordfilt2 imgaussfilt imnoise imadjust stretchlim graythresh imbinarize immultiply imdivide imlincomb imtranslate padarray strel imerode imdilate imopen imclose imfill bwlabel bwareaopen regionprops hsv2rgb ycbcr2rgb ntsc2rgb rgb2lab lab2rgb rgb2ind ind2rgb gray2ind ind2gray immse psnr ssim mean2 std2 corr2 entropy fft fft2 ifft ifft2 fftshift ifftshift dct2 idct2`, and `imresize(...,'bicubic')` (currently warns and falls back to bilinear).
- **Samples:** `Test1.png`, `Test3.png`, `Test4.png`, `Test5.png` (used by lectures 6, 8, 9) are not in `public/assets/notebook-runtime/assets/manifest.json`.

### 1.3 Performance baseline (Node, sandbox machine)

Lecture 7 brightness loop, `b(i,j,:)=a(i,j,:)+50` over a 200x200x3 image (40,000 iterations): **\~444 ms** (about 11 µs per iteration). A 512x512x3 image is about 262,000 iterations, which is roughly 3 s in Node and 2–3x that in a browser worker. The worker run is fully synchronous: no progress is shown, Stop terminates the worker and resets the workspace, and the limit is a fixed 60 s (`runtimes/matlab/src/engine.ts`). Lecture 9's `while (true)` can only end by Stop or the 60 s limit.

## 2. Resolved decisions

- **D1 Scope tiers.** P0 = used by lectures 1–9 or the book labs. P1 = necessary or common in any introductory image-processing course (filtering, edges, thresholding, morphology, noise, geometric transforms, color conversion, frequency domain). P2 = optional, only after P0 and P1 pass. Implement P0 and P1 completely; skip P2 unless explicitly listed as "do".
- **D2 Plotting.** Own SVG renderer, no chart library. New output kind `plot` rendered by a new `runtimes/shared/plot-view.ts` built with `createElementNS` (avoids the DOMPurify path used by `html` outputs). Colors come from existing CSS variables so light/dark themes work.
- **D3 Class model.** Keep `Float64Array` storage for every class; add classes by value rules (rounding and saturation), not by new typed arrays.
- **D4 Complex numbers.** Add an optional imaginary array `im?: Float64Array` to `T`, supported only by the functions listed in Phase 7. Any other function receiving a complex value throws `<fn>: complex values are not supported`.
- **D5 Video.** The camera is **simulated** (deterministic demo scene) so the Lecture 9 program runs unchanged. Real-camera access is out of scope because a synchronous worker cannot await `getUserMedia`, and `SharedArrayBuffer` needs cross-origin isolation headers that would affect the whole site.
- **D6 Stop behavior.** Keep terminate-and-reset (no cooperative cancel is possible without `SharedArrayBuffer`). Improve the message and add a time-limit selector (Phase 6).
- **D7 Sample images.** Do not ship MathWorks demo images (`cameraman.tif`, `coins.png`, and so on) because of licensing. Only the course files listed in Phase 0 plus the `peppers.png` alias.
- **D8 Out of scope.** `input()`/`keyboard` (cannot block in the synchronous worker), wavelets, `imwarp`/`imtransform`, `containers.Map`, classdef, file I/O other than images, 3-D plotting (`surf`, `mesh`, `contour`), real camera.

## 3. Phases

### Phase 0 — Fixtures and test harness

**Files:** `runtimes/matlab/interp/test/`, `public/assets/notebook-runtime/assets/`, `runtimes/test/`.

1. Copy the complete Lecture 5–9 `.m` programs into `interp/test/assets/lectures/` (uncommented, one file per example block) and add `interp/test/lectures.ts`. Each block runs through the existing harness (`run(name, src, check)` pattern in `test/run.ts`) with golden checks on output sizes and a few hand-verified pixel values. Blocks that need not-yet-implemented features start as `todo` entries and are switched on in the phase that implements them.
2. Add sample images by converting the files below to the existing `*.png.json` format (copy the structure of `GrayTest1.png.json`: `format, fileSize, filename, fileModDate, channels, colorType, bitDepth, width, height, b64`) and register them in `assets/manifest.json`:
   - `Test1.png` — Drive file id `1f5ZitBPnNXb4tT8_k7BkOziQyLWsBK1v` (https://drive.google.com/file/d/1f5ZitBPnNXb4tT8\_k7BkOziQyLWsBK1v/view)
   - `Test3.png` — `1ejvFDwrQsWenlNIkgHnlLCbighr2ZnCb`
   - `Test4.png` — `1G-RqYeIgPw6eJS-kAtTZpNNUJpUNg7uL`
   - `Test5.png` — byte-identical size (85,539 B) to `pepper.png`; compare SHA-256 and, if equal, register it as an alias of `pepper.png` rather than duplicating the data.
3. **Alias `peppers.png`** to `pepper.png`: in `runtimes/matlab/src/worker.ts` (`host.readImage`) and in the engine's image pre-loader (`loadFor` in `engine.ts`, which scans the code for file names), so `imread('peppers.png')` and `imfinfo('peppers.png')` work unchanged. Add an alias table (`peppers.png` → `pepper.png`, `Test5.png` → `pepper.png` if the SHA-256 check above passes).
4. Add `interp/test/bench.ts` (used in Phase 6) with these cases at 256x256x3 and 512x512x3: Lecture 7 brightness loop, Lecture 6 pixel-replication zoom, Lecture 8 rotate-90 loop, Lecture 8 slicing loop, and a `histeq` plus `imhist` run. It prints milliseconds per case.
5. Wire the interpreter tests into the repo test chain: add `runtimes/test/matlab-interp.test.mjs` that spawns `npx tsx matlab/interp/test/run.ts` and asserts exit code 0, and append it to the `test` script in `runtimes/package.json`.

**Done when:** the new tests run in `npm run test:runtimes`; the baseline numbers are recorded in the commit message.

### Phase 1 — Language features (`parser.ts`, `interp.ts`, `values.ts`)

P0 first, then P1.

1. **Block comments** `%{ ... %}` (the markers alone on their own lines) in the lexer.
2. **try/catch with identifier:** `try ... catch ME ... end`; `ME.message`, `ME.identifier`; `rethrow(ME)`; `error(id, fmt, ...)` and `error(fmt, ...)`; `warning(fmt, ...)` printing through `host.warn`.
3. **Function handles and anonymous functions:** `@(x,y) expr`, `@name`; closures capture variables by value at creation; call with `f(args)`; handles are storable in variables, cells, and struct fields; `feval`, `func2str`, `isa(x,'function_handle')`.
4. **cellfun / arrayfun** with `'UniformOutput', false|true` (handle and function-name forms, multiple outputs).
5. **Function context:** `nargin`, `nargout`, `exist('name','var')`, `varargin`, `varargout`, `return`, subfunctions defined later in the same cell (already work; keep).
6. **Matrix operators:** `*` (matrix product with MATLAB dimension errors: `Error using *: Incorrect dimensions for matrix multiplication...`), `/` and `\` (Gaussian elimination with partial pivoting; warning `Matrix is singular to working precision.` when a pivot is below 1e-12 relative), `^` (scalar exponent: integer powers by repeated squaring on square matrices), `.'`. Class rule: integer-class operands in matrix operations are rejected as in MATLAB.
7. **Struct arrays:** `s(2).f = v`, `s = struct('a', {1,2,3})`, `numel(s)`, `s(i)`, `[s.f]` and `{s.f}` comma-separated lists, `isfield`, `fieldnames`, `rmfield`, `isstruct` on arrays. This is required by `regionprops`.
8. **Display parity:** verify and add golden tests for `x = ...` display of double, uint8, logical, char, and empty matrices (column alignment; common scale factor lines are **not** implemented; document in help).
9. **`global` and `persistent`:** P2, skip.

**Tests:** one per item, plus the Lecture 8/9 constructs (`catch e`, handle-based `cellfun(@numel, ...)`).

### Phase 2 — Core math, array and string library

Register in `interp.ts` (split into `interp/src/lib-math.ts`, `lib-array.ts`, `lib-string.ts` if `interp.ts` passes \~1200 lines; each file exports a `register(def)` function).

| Group | Functions |
| --- | --- |
| Elementwise | `atan atan2 sinh cosh tanh power hypot isnan isinf isfinite idivide bitand bitor bitxor bitshift bitcmp xor sign` |
| Reductions (all accept a `dim` argument, and `'all'` where MATLAB does) | `median mode std var cumprod cummax cummin diff norm dot cross trace det inv rank nnz range` plus `dim` support verified for existing `sum prod mean min max any all cumsum`; `[m,i]=max/min`; `[s,i]=sort(...,'descend')` |
| Construction | `eye magic diag tril triu meshgrid ndgrid randn rng logspace colon cat horzcat vertcat kron permute squeeze circshift flip rot90 sub2ind ind2sub` and `[r,c]=find(...)`, `find(x,n)` |
| Sets and counting | `unique` (with `i,j` outputs), `histc`, `accumarray` (sum), `hist` numeric form `[n,x]=hist(data,k)`, `isequal`, `ismember` |
| Predicates | `islogical isreal isfloat isinteger isa isrow iscolumn isvector isscalar ismatrix isnumeric` (exists) |
| Constants | `intmax intmin realmax realmin flintmax` (class-aware once Phase 3 lands) |
| Strings and output | `strcat strrep strsplit strjoin strtrim upper lower strcmpi strncmp str2double str2num` (numbers and simple matrices only; no `eval`) `int2str mat2str`, `num2str` for matrices and `%g` precision, `sprintf/fprintf` with vector recycling and `%g %e %s %c %%` |
| Time and sound | `pause(s)` (busy-wait capped at 5 s per call; it calls the progress tick of Phase 6 every 100 ms so the elapsed timer keeps moving), `beep` (host call, plays an 880 Hz tone for 150 ms through WebAudio on the main thread), `tic/toc` (exist) |

`rand/randn/randi` accept `rng(seed)` and `rand('seed',n)`; seeded sequences are deterministic within MLWeb (they do not match MATLAB's generator; documented).

**Tests:** each function with a hand-computed example; error-message tests for dimension mismatches.

### Phase 3 — Numeric classes

**Files:** `values.ts` (`Cls`, `sat`, `outCls`, `mk`), `interp.ts` conversions and display.

1. Extend `Cls` with `int8 uint16 int16 uint32 int32 single`. `sat(cls, v)` rounds half away from zero and clamps to the class range (NaN becomes 0 for integer classes); `single` stores `Math.fround(v)`.
2. `outCls(a,b)`: integer class with `double`/`single`/`logical` gives the integer class; the same integer class gives itself; two different integer classes throw `Integers can only be combined with integers of the same class, or scalar doubles.`; `single` with `double` gives `single`.
3. Conversion functions `int8 uint16 int16 uint32 int32 single cast` and the existing `double uint8`; `im2uint16`, `im2single`; extend `im2double`/`im2uint8` for the new classes (scale by the class range).
4. `class()`, `isa(x,'integer'|'float'|'numeric')`, `intmax/intmin('int16')`, `zeros(...,'uint16')` and `ones/eye/rand` class arguments, `whos` class column, workspace byte sizes.
5. `imread` keeps 8-bit output. Do not add 16-bit decoding.

**Tests:** saturation tables per class, mixed-class errors, `uint16` image arithmetic, `single` rounding.

### Phase 4 — Figures and plotting

**Files:** new `runtimes/matlab/interp/src/figures.ts` (figure state), changes to `interp.ts` (`Host` interface), `matlab/src/worker.ts`, `matlab/src/engine.ts`, `shared/engine.ts` (new `Out` kind), `shared/outputs.ts`, new `shared/plot-view.ts`, `shared/styles/`.

**Model (`figures.ts`):**

```
Figure { id, rows, cols, axes: Axes[] }
Axes   { r, c, items: Item[], title, xlabel, ylabel, xlim, ylim, grid, legend[], hold, colormap, equal, off }
Item   = image{w,h,rgb,range?} | line{x[],y[],spec} | bar{x[],y[],width} | stem{x[],y[]} | scatter{x[],y[]}
```

`figure` creates a new figure and makes it current; `figure(n)` selects or creates figure n; `close all` and `clf` clear; `subplot(m,n,p)` (also the 3-digit form) selects an axes. Without `hold on`, a new plotting call on an axes replaces its items.

**Host contract:** add `Host.figure(spec)` (replace-by-id) next to `showImage`. The worker posts `{t:'figure', id, spec}`. The engine converts it to `sink.out({k:'plot', fig:id, spec})`. Mirror the existing replace-by-figure behavior of `img` outputs for `plot` (look at how `fig` numbering is handled in `engine.ts` line \~96 and `outputs.ts`) so a re-plot into the same figure replaces its card instead of appending.

**Flush rule:** figures are posted at the end of the cell run, on `drawnow`, on `pause`, and when `figure` or `imtool` is called, only if changed since the last post. Posting is throttled to one message per 100 ms per figure.

**Backward compatibility:** `imshow(I)` and `imtool(I)` behave exactly as today when the current figure has one axes holding one image and no decorations (it still emits the existing `img` output). As soon as `title`, `xlabel`, `ylabel`, `axis`, `colorbar`, `subplot` with more than one cell, or a second item is used, the figure is emitted as a `plot` output.

**Functions:**

| Tier | Functions |
| --- | --- |
| P0 | `figure clf close(all) subplot title xlabel ylabel imshow(I) imshow(I,[lo hi]) imshow(I,[]) imhist` (see below) `drawnow` |
| P1 | `plot` (vectors, matrix columns, several series, LineSpec such as `'r--o'`, `'LineWidth'`), `bar`, `stem`, `hist(data,k)` (draws), `histogram` (simple form: data and bin count), `scatter`, `axis([x1 x2 y1 y2])`, `axis tight/equal/off/on/square`, `xlim`, `ylim`, `grid on/off`, `hold on/off` (currently a no-op), `legend(...)`, `imagesc`, `image`, `colormap(name or Nx3)`, `colorbar`, `text(x,y,str)`, `gray jet hot bone hsv` (colormap generators returning Nx3) |
| P2, skip | `montage imshowpair surf mesh contour area pie` |

**`imhist` (replaces the current error):** `imhist(I)` with no output draws a bar chart of the 256 bin counts (2 bins for logical images) on x = 0..255 with a gray-ramp strip under the axis, then the figure is emitted like any other. `imhist(I,n)` uses n bins. `[counts,x] = imhist(I)` keeps working. The existing `histeq` and `imhist` tests must still pass.

**Renderer (`plot-view.ts`):** responsive SVG (`viewBox`, width 100%), "nice numbers" tick generation (1/2/5 steps, 4–8 ticks), axis labels, title, legend box, grid, line, bar and stem marks, image panels drawn with `<image>` from a canvas data URL with `image-rendering: pixelated`, `subplot` grid layout with shared figure title area. Colors via CSS variables (add them to the existing runtime stylesheet in both themes). Add a small "Save PNG" button per figure (render SVG to canvas, `toBlob`).

**Export:** `.ipynb` export (`public/src/shared/notebook-export.js`) must write `plot` outputs as `image/svg+xml` display data; add a test in `tests/notebook-export.test.js`.

**Tests:** figure-state unit tests (subplot index math, hold semantics, replace behavior), `imhist` no-output on `testgray.png` posts exactly one figure with 256 bars, renderer test in `runtimes/test/` (jsdom or the existing DOM test setup) checking tick labels and element counts, and the Lecture 8 blocks switched from `todo` to active.

### Phase 5 — Image Processing Toolbox (P0 then P1)

Implement in `interp/src/lib-ipt.ts` (split further into `lib-filter.ts`, `lib-morph.ts`, `lib-color.ts` if large). Every function accepts uint8, uint16, double, single and logical where MATLAB does, and returns the MATLAB class.

**5.1 Intensity and thresholding**

- `imadjust(I,[lin_lo lin_hi],[lout_lo lout_hi],gamma)` and `imadjust(I)` (uses `stretchlim`); `stretchlim(I,[0.01 0.99])`.
- `graythresh(I)`: Otsu on a 256-bin histogram; maximize between-class variance, take the mean index of ties, return `(t-1)/255` as a double in \[0,1\]. `imbinarize(I)` (global Otsu) and `imbinarize(I,level)`; `'adaptive'` is P2, skip. `im2bw` exists (keep).
- `immultiply imdivide imlincomb` (saturating, class rules of Phase 3), `histeq(I,n)` extension, `mean2 std2 corr2 entropy` (entropy: `-sum(p.*log2(p))` over a 256-bin histogram, zero bins skipped), `immse psnr`, `ssim` (11x11 Gaussian window, sigma 1.5, K = \[0.01 0.03\], L from class; return the global mean).

**5.2 Spatial filtering**

- `conv2(A,B,shape)` with `'full'`, `'same'`, `'valid'`; `filter2` (correlation).
- `imfilter(I,h,options)`: correlation by default; options `'conv'`, `'replicate'`, `'symmetric'`, `'circular'`, numeric pad value, `'same'`, `'full'`; output class equals input class with rounding and saturation for integer classes; works per channel for RGB.
- `fspecial`: `average` (default 3x3), `gaussian` (default \[3 3\], sigma 0.5, normalized to sum 1), `laplacian` (alpha 0.2), `log` (\[5 5\], 0.5), `prewitt`, `sobel`, `disk` (radius 5), `motion` (len 9, theta 0), `unsharp` (alpha 0.2). Formulas as in the MathWorks `fspecial` reference.
- `medfilt2(I,[m n],padopt)` (default \[3 3\], zero padding, `'symmetric'` option), `ordfilt2(I,order,domain)`, `imgaussfilt(I,sigma)` (kernel size `2*ceil(2*sigma)+1`, replicate padding), `padarray(A,padsize,padval|'replicate'|'symmetric'|'circular',direction)`. `imsharpen`, `nlfilter`, `blockproc`, `colfilt` are P2, skip.

**5.3 Edges**

- `edge(I,method,thresh,...)` for `'sobel'` (default), `'prewitt'`, `'roberts'`, `'log'`, `'canny'` (Gaussian smoothing, gradient, non-maximum suppression, hysteresis with default thresholds derived from the gradient histogram as documented by MathWorks); `'zerocross'` is P2, skip. Return logical; support `[BW,thresh]=edge(...)` and a scalar threshold. Where the MathWorks reference leaves a default threshold estimator undocumented, use the documented scale factors and list the difference in the help text. Tests use synthetic step-edge images (a 7x7 image with a vertical step must give a one-pixel-wide vertical edge for sobel).

**5.4 Geometric**

- `imresize`: implement true `'bicubic'` (Keys kernel a = -0.5) and apply the kernel-widening anti-aliasing MATLAB uses when shrinking for `bilinear` and `bicubic` (document the option `'Antialiasing', false`); keep `'nearest'`; remove the "not implemented" warning. Add the `[m n]` and scale forms if any are missing.
- `imrotate(I,angle,method,'crop'|'loose')`: verify and complete both bounding boxes and the `nearest`/`bilinear`/`bicubic` methods.
- `imtranslate(I,[tx ty])`, `imcrop(I,[x y w h])` (non-interactive form), `rot90`, `flip`, `circshift`, `kron` (Phase 2). Verify against the Lecture 6/8 loop results: pixel replication equals `kron(A,ones(z))`; vertical flip equals `flipud`; transpose equals `A'`.

**5.5 Color**

`hsv2rgb ycbcr2rgb ntsc2rgb rgb2lab lab2rgb` (D65 white point, sRGB), `rgb2ind ind2rgb gray2ind ind2gray` (with Nx3 colormaps from Phase 4), and the existing `rgb2gray rgb2hsv rgb2ycbcr rgb2ntsc im2double im2uint8`. Round-trip tests (`rgb2hsv` then `hsv2rgb`) must reproduce the input within 1/255.

**5.6 Noise**

`imnoise(I,'gaussian',m,v)` (defaults 0 and 0.01 on the \[0,1\] scale), `'salt & pepper'` (density 0.05), `'speckle'` (variance 0.04); poisson is P2, skip. Seeded through `rng`. Tests are statistical (mean and variance within tolerance, salt-and-pepper fraction within 1 percentage point).

**5.7 Morphology and binary analysis**

- `strel('square'|'rectangle'|'diamond'|'disk'|'line'|'arbitrary', ...)` returned as a struct with `Neighborhood` and `Height`; `getnhood`.
- `imerode imdilate imopen imclose` for binary and grayscale (erosion pads with the maximum, dilation with the minimum, as documented), `imfill(BW,'holes')`, `bwlabel(BW,4|8)` (two-pass with union-find, returns `[L,num]`), `bwareaopen`, `regionprops(L,'Area','Centroid','BoundingBox')` (struct array from Phase 1; also accepts a logical image). `bwperim` and `bwmorph` are P2, skip.

**Tests (all of 5.x):** hand-computed 3x3 to 6x6 cases per function, class-preservation tests, RGB per-channel tests, and the book-lab pipeline from chapter 1 (`rgb2gray`, `edge(G,'sobel')`, `figure; imshow; title`) running end to end on `pepper.png` and producing three figures.

### Phase 6 (Important: Give it real effort. Implement on multiple goes) — Performance and UX for long runs

This phase targets the biggest user pain: pixel loops that run for seconds with no feedback.

**6.1 Interpreter speed (`interp.ts`, `parser.ts`)**

1. Profile first: `node --cpu-prof` on `bench.ts`; record the top 5 hot spots in the commit message.
2. Apply, in this order, re-measuring after each: (a) scalar fast path for expressions made of numeric literals, scalar variables, and scalar-subscript reads, evaluated without allocating a tensor; (b) direct-access paths for `A(i,j)`, `A(i,j,k)`, `A(i,j,:)` reads and writes (in place, no whole-array copy; a copy happens only when a variable shares storage with another variable, tracked with a copy-on-write flag set on whole-variable assignment `b = a`); (c) `for` over a range without materializing the range vector; (d) resolve variable names to slots once per script or function instead of per access (closure-compile the AST).
3. **Target:** at least 3x faster on every `bench.ts` case, and the 512x512x3 Lecture 7 loop in 1 s or less in Node. All earlier semantics tests must stay green (uint8 saturation, auto-growth, `end` in ranges).

**6.2 Progress and live status**

1. Add `Host.tick?(info)`. The interpreter checks the clock at loop back-edges every 4096 iterations and calls `tick` at most every 100 ms with `{ line, loops: [{iter,total}...], elapsedMs }`.
2. The worker posts `{t:'progress', ...}` (throttled); the engine calls `sink.status('Running… line N · P% · T s', 'run')`. Percent for nested loops = `(outerIter-1 + innerFraction) / outerTotal`; when a loop's trip count is unknown (`while`), show only elapsed time.
3. In the cell footer (`shared/cell-view.ts` / `shared/toolbar.ts`): a thin progress bar plus elapsed timer once a run exceeds 1.5 s; the Stop button becomes visually primary after 5 s.
4. After 5 s of run time, show one non-blocking tip per session: "Per-pixel loops are slow in the browser. Vectorized code such as `b = a + 50;` runs the same operation in one step." (English and Arabic through `shared/i18n.ts`).
5. Streaming already works for `print`/`img`; additionally send `rgb` buffers as **transferables** in `worker.ts` (`postMessage(msg, [buffer])`) to avoid copies.

**6.3 Time limit and Stop**

- Keep the 60 s default; add a toolbar selector (60 s, 120 s, 300 s) stored in `localStorage` and read by `engine.ts` (`TIME_LIMIT_MS`).
- Keep terminate-and-reset on Stop or timeout (D6) but change the message to: "Execution stopped. The workspace was reset; use Run all to rebuild it." (English and Arabic).
- `while (true)` loops with `pause` (Lecture 9) must be stoppable at any moment and must end with the same message.

**6.4 Large-image guard (`shared/images.ts`, engine `addFile`)**

Images above 2 MP show a one-time notice: "Large image (N MP): pixel loops will be slow. Consider imresize first." Images above 8 MP are rejected with a clear message that suggests resizing before upload (uint8 samples are stored as 8-byte doubles, so memory grows 8x).

**Tests:** `bench.ts` thresholds as a node test with a generous ceiling (fails only on a 2x regression); a unit test for the tick throttle and percent computation; an engine test with a fake worker (the engine already supports `createWorker`) checking status text, timeout, and Stop message.

### Phase 7 — Frequency domain (complex support)

Implement D4. Add `im?: Float64Array` to `T`; helpers `isComplex`, `cplx(re, im)`. Supported in this phase only: `fft ifft fft2 ifft2 fftshift ifftshift abs angle real imag conj isreal`, unary minus, `+ - .* ./ *` (matrix), `exp(1i*x)` and the literals `1i`/`1j`, `sum`, `mean`, indexing and assignment, and `disp` (format `a + bi`). `fft` and `fft2` accept length/size padding arguments (`fft2(I,m,n)`) and a `dim` argument for `fft`. Algorithm: radix-2 Cooley–Tukey for power-of-two lengths, Bluestein for other lengths; `ifft` of conjugate-symmetric input returns real data when MATLAB does (`'symmetric'` option). `dct2/idct2` are P2, skip. The usual spectrum display idiom `imshow(mat2gray(log(1+abs(F))))` must work end to end.

**Tests:** known transforms (impulse gives a flat spectrum, a constant gives a single DC bin), `ifft2(fft2(I))` round trip within 1e-9, a 6-point (non-power-of-two) transform against hand-computed values.

### Phase 8 — Simulated camera and video (Lecture 9)

**Files:** `interp/src/lib-video.ts`, `matlab/src/worker.ts`, `matlab/src/engine.ts`.

1. Functions: `imaqhwinfo` (no arguments returns a struct with `InstalledAdaptors = {'winvideo'}`; `imaqhwinfo('winvideo')` returns `AdaptorName` and `DeviceIDs = {1}`; `imaqhwinfo('winvideo',1)` returns `DeviceName`, `DefaultFormat`, `SupportedFormats = {'MJPG_640x360','MJPG_640x480','MJPG_1280x720'}`), `videoinput(adaptor, id, format)` (parses the resolution from the format string; default 640x480), `preview(vid)`, `closepreview`, `getsnapshot(vid)` returning a uint8 RGB image, `start stop delete isrunning`, and the modern `webcam()` / `snapshot(cam)` aliases.
2. **Demo scene (deterministic):** a static gradient background, plus a rectangle that enters, crosses, and leaves the frame on a 12 s cycle (position derived from the run's elapsed time, so calls are reproducible per run). Frames in the first 2 s are always static so the background reference frame is clean. With the Lecture 9 default values (`T = 6`, `S = 0.5`) the program prints `Motion detected!` once the rectangle appears and does not print it while the scene is static.
3. `preview` shows a live figure (Phase 4 mechanism) updated on each `getsnapshot`; `closepreview` removes it.
4. A fixed notice appears in the cell output the first time any video function runs: "Camera is simulated (demo scene). Real webcams are not available in MLWeb." (English and Arabic).
5. `pause` and `beep` come from Phase 2; the Lecture 9 motion-detection program must run unchanged until Stop, with the progress timer visible.

**Tests:** `imaqhwinfo` struct fields; `getsnapshot` size matches the format string; two snapshots taken before 2 s are identical; the difference sum exceeds `T*numel` once the rectangle is in view; the Lecture 9 program, run with a 3 s budget through the fake-worker engine test, emits at least one `Motion detected!` line.

### Phase 9 — Docs, help, completions, samples, release

1. **Single source of docs:** move the `FUNCTION_DOCS` data into `interp/src/docs.ts` (exported), re-export it from `matlab/src/completion-data.ts`, and make the `help`/`doc`/`lookfor` builtin read from it (replace the hard-coded `descriptions` object in `interp.ts`). `help fname` prints the signature, the description, and the "Differences from MATLAB" line.
2. **`help.ts` groups** (each an English + Arabic item): Plotting and figures, Language (handles, try/catch, struct arrays), Math and arrays, Strings, Numeric classes, Spatial filtering, Edges, Morphology, Color spaces, Noise, Frequency domain, Video (simulated).
3. **Completions and snippets** (`completion-data.ts`): signatures for every new function and snippets for the lecture idioms (nested pixel loop, histogram plot, motion-detection loop).
4. Update `README.md` and `CHANGELOG.md` (supported-function table, "Differences from MATLAB" list, simulated camera note).
5. Add the new tests to the `test` scripts; run the full verification below; commit the regenerated bundles and `runtimes/build-info.json`.

## 4. Final verification (definition of done)

1. `cd runtimes/matlab/interp && npm test` passes with no `todo` blocks left for P0/P1 items.
2. `npm run typecheck:runtimes`, `npm run test:runtimes`, `node --test tests/notebook*.test.js` pass; the "bundle matches sources" check (via `runtimes/build-info.json`) passes after `npm run build:runtimes`.
3. Manual QA in the browser (Vercel dev), one pass each, English and Arabic UI, light and dark theme:
   - Lecture 6: pixel replication and zero-order-hold zoom on `Test1.png` and `GrayTest1.png`, including the `zoomMethod_1/2` functions.
   - Lecture 7: brightness, contrast, combined, negative on `pepper.png`/`testgray.png`; the progress bar and elapsed timer appear on 512x512 inputs.
   - Lecture 8: `imhist(g)` renders a 256-bar histogram; `figure; imhist(g)`; per-channel `histeq`; rotate, flip, transpose; slicing examples on `Test3/4/5.png`.
   - Lecture 9: slicing examples; motion detection with the simulated camera; Stop works and the message and reset behave as in Phase 6.3.
   - Book labs (chapters 1–4) run as written (`peppers.png`, `edge`, `title`, `mean(I,3)`, `imfinfo`).
   - Each Phase 5 family once: `imfilter` + `fspecial`, `edge` (all methods), `graythresh` + `imbinarize`, `imerode`/`imdilate`, `bwlabel` + `regionprops`, `imnoise`, `fft2` spectrum display.
4. Performance: `bench.ts` shows at least 3x improvement over the Phase 0 baseline; the Lecture 7 loop on 512x512x3 finishes in 1 s or less in Node and in under 6 s in the browser worker on a mid-range laptop.
5. Every new function has code, docs, help-group inclusion, and a hand-verified test (section 0 checklist).
