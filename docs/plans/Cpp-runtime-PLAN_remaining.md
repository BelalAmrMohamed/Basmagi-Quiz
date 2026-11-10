# Remaining recommendations (not done yet)
1. Multi-line paste: when a pasted block has #includes + functions + main, offer "Split into cells" (split on top-level declarations).
2. Compiler warm-up indicator: show a small dot/progress while clang/lld compile in the worker the first time.
3. Brotli/gzip the toolchain assets served from the CDN to cut first download.
4. "Expected output" challenges for quiz notebooks (compare stdout, show diff).
5. Step debugger / variable watch (needs DWARF or instrumentation; large).
6. Verify wasm out-of-bounds trap message in a real desktop browser (the sandbox Chromium crashes on any wasm OOB, so only tested in Node).
