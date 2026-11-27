// =============================================================================
// runtimes/matlab/src/completion-data.ts
// Data for autocomplete: function signatures and docs, constants, and code snippets.
// Ported from the deployed MLWeb runtime, not abbreviated.
// =============================================================================

import { FUNCTION_DOCS } from '../interp/src/docs';
export { FUNCTION_DOCS };

/** name -> description */
export const CONSTANT_DOCS: Record<string, string> = {
  "pi": "The number π.",
  "eps": "Floating-point precision.",
  "Inf": "Infinity.",
  "inf": "Infinity.",
  "NaN": "Not a number.",
  "nan": "Not a number.",
  "true": "Logical true.",
  "false": "Logical false."
};

/** Snippet templates use ${name} for placeholders and ${} for the final cursor. */
export const SNIPPETS: Array<{ template: string; label: string; detail: string; type: string; boost?: number }> = [
  {
    "template": "if ${condition}\n\t${}\nend",
    "label": "if",
    "detail": "if … end",
    "type": "keyword",
    "boost": 2
  },
  {
    "template": "if ${condition}\n\t${}\nelse\n\t${}\nend",
    "label": "ifelse",
    "detail": "if … else … end",
    "type": "keyword"
  },
  {
    "template": "for ${i} = ${1}:${n}\n\t${}\nend",
    "label": "for",
    "detail": "for loop",
    "type": "keyword",
    "boost": 2
  },
  {
    "template": "while ${condition}\n\t${}\nend",
    "label": "while",
    "detail": "while loop",
    "type": "keyword",
    "boost": 2
  },
  {
    "template": "switch ${value}\n\tcase ${1}\n\t\t${}\n\totherwise\n\t\t${}\nend",
    "label": "switch",
    "detail": "switch … case … end",
    "type": "keyword",
    "boost": 2
  },
  {
    "template": "function ${out} = ${name}(${in})\n\t${}\nend",
    "label": "function",
    "detail": "function definition",
    "type": "keyword",
    "boost": 2
  },
  {
    "template": "try\n\t${}\ncatch ${err}\n\t${}\nend",
    "label": "try",
    "detail": "try … catch … end",
    "type": "keyword"
  },
  {"template": "for ${i} = 1:size(${I}, 1)\n\tfor ${j} = 1:size(${I}, 2)\n\t\t${}\n\tend\nend", "label": "pixelloop", "detail": "nested pixel loop", "type": "keyword"},
  {"template": "figure; imhist(${I});\ntitle('Histogram');", "label": "histplot", "detail": "histogram plot", "type": "keyword"},
  {"template": "vid = videoinput('winvideo', 1, 'MJPG_640x480');\npreview(vid);\nT = 6; S = 0.5;\nbg = rgb2gray(getsnapshot(vid));\nwhile true\n\tg = rgb2gray(getsnapshot(vid));\n\td = abs(double(g) - double(bg));\n\tif sum(d(:)) > T * numel(d) * S\n\t\tdisp('Motion detected!'); beep;\n\tend\n\tpause(0.1);\nend", "label": "motiondetect", "detail": "motion detection loop (simulated camera)", "type": "keyword"},
  {"template": "F = fftshift(fft2(double(${I})));\nimshow(mat2gray(log(1 + abs(F))));", "label": "spectrum", "detail": "Fourier spectrum display", "type": "keyword"}
];
