I need to refactor and significantly improve the export features of my educational quiz platform. The current implementation uses heavy client-side libraries (like jsPDF) which freeze the browser, struggle with Arabic text, break KaTeX math equations, and clip horizontal code blocks.

Here is the master plan for the update. Please execute this step-by-step:

1. Redo the PDF Export (Native Print Method)
- Remove `jsPDF` and any heavy HTML-to-canvas image rendering libraries used for PDF from all pages that use it (index.html, create-quiz.html, and result.html).
- Implement a hidden `<iframe>` approach. When the user clicks "Export PDF", clone the quiz DOM into a hidden iframe, inject the necessary CSS, and trigger `iframe.contentWindow.print()` so the user can use the native "Save as PDF" browser dialog.
- Add specific `@media print` CSS rules to the iframe: ensure code blocks (`<pre>`, `<code>`) have `white-space: pre-wrap` and `word-break: break-word` so they wrap instead of causing horizontal scrolling or clipping.
- Make sure code-block (which usually have horizontal scrolling) are rendered correctly in the pdf.
- You can view the way the `ai-agent` exports chat as pdf, it's a good way, and it never failed for me.

2. Consolidate HTML Exports
- Delete the static "Answers Only" `.html` export.
- Keep only the "Interactive Quiz" `.html` export, but update its internal code to include a "Show All Answers" toggle button at the top. This allows the single file to act as both a test and an answer key.

3. Consolidate Text Exports
- Delete the Plain Text (`.txt`) export feature entirely. 
- Keep the Markdown (`.md`) export as the only text-based option.

4. PPTX & Word Export Performance
- For PPTX and Word exports, if heavy loops/generation are still required, refactor the loops using asynchronous chunking (e.g., `await new Promise(r => setTimeout(r, 0))` between questions). 
- Update the `.dl-modal-card` UI to show a real-time progress bar (percentage) during PPTX/Word generation.
- Add a functional "Cancel" button using `AbortController` to safely halt the generation process if it takes too long.

5. Add a Settings Modal
Before generating the PDF, Word, PPTX, or MD files, show a modal allowing the user to configure these settings:
- Include correct answers (Yes/No)
- Include the user's answers (Yes/No - only show this option if exporting from the Results page)
- Include explanations/feedback (Yes/No)
- Answer Key Placement (Below each question / Grouped on the last page)

Please start with Step 1 (the hidden iframe PDF export) and provide the updated JavaScript and CSS for that implementation first.