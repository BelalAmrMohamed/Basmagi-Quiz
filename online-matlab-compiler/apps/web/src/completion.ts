// Code autocomplete for notebook code cells.
//
// Providers are registered per runtime id (`NotebookDoc.runtime`). Adding a runtime later
// (Python, C++ …) means writing one `RuntimeCompletion` and calling `registerCompletion()`;
// the editor wiring in main.ts does not change. Unknown runtimes simply get no completions.
import { autocompletion, snippetCompletion } from '@codemirror/autocomplete';
import type { Completion, CompletionContext, CompletionResult, CompletionSource } from '@codemirror/autocomplete';
import type { Extension } from '@codemirror/state';

/** Live information the editor host can offer to providers (all getters are called lazily). */
export interface CompletionHost {
  /** Variables currently in the interpreter workspace. */
  workspace(): { name: string; cls: string; size: string }[];
  /** Source of every code cell, in order (used to find names assigned in the notebook). */
  codeSources(): string[];
  /** Names of files in the current folder (images the user uploaded or the notebook ships). */
  fileNames(): string[];
}

export interface RuntimeCompletion {
  /** Completion sources for one runtime. */
  sources(host: CompletionHost): CompletionSource[];
}

const registry = new Map<string, RuntimeCompletion>();
export function registerCompletion(runtime: string, provider: RuntimeCompletion) { registry.set(runtime, provider); }

/** CodeMirror extension for the given runtime (empty for runtimes without a provider). */
export function completionExtension(runtime: string, host: CompletionHost): Extension {
  const provider = registry.get(runtime);
  if (!provider) return [];
  return autocompletion({
    override: provider.sources(host),
    activateOnTyping: true,
    maxRenderedOptions: 40,
    icons: true,
    tooltipClass: () => 'mlweb-complete',
  });
}

// ---------------------------------------------------------------- MATLAB

const KEYWORDS = ['break', 'case', 'catch', 'continue', 'else', 'elseif', 'end', 'for', 'function', 'global', 'if', 'otherwise', 'persistent', 'return', 'switch', 'try', 'while'];

// name -> [signature, description]. Only functions the interpreter implements are listed.
const FUNCTIONS: Record<string, [string, string]> = {
  zeros: ['zeros(m, n)', 'Array of zeros; optional class, e.g. zeros(256, 256, 3, "uint8").'],
  ones: ['ones(m, n)', 'Array of ones.'],
  size: ['size(A)', 'Dimensions of an array.'],
  numel: ['numel(A)', 'Number of elements.'],
  length: ['length(A)', 'Length of the largest dimension.'],
  ndims: ['ndims(A)', 'Number of dimensions.'],
  isempty: ['isempty(A)', 'True if the array has no elements.'],
  class: ['class(A)', 'Class name of a value.'],
  iscell: ['iscell(A)', 'True for cell arrays.'],
  isstruct: ['isstruct(A)', 'True for structs.'],
  isnumeric: ['isnumeric(A)', 'True for numeric values.'],
  ischar: ['ischar(A)', 'True for character arrays.'],
  double: ['double(A)', 'Convert to double.'],
  uint8: ['uint8(A)', 'Convert to uint8 (saturating).'],
  logical: ['logical(A)', 'Convert to logical.'],
  char: ['char(A)', 'Convert to character array.'],
  abs: ['abs(A)', 'Absolute value.'],
  fix: ['fix(A)', 'Round toward zero.'],
  floor: ['floor(A)', 'Round toward minus infinity.'],
  ceil: ['ceil(A)', 'Round toward plus infinity.'],
  round: ['round(A)', 'Round to nearest integer.'],
  sign: ['sign(A)', 'Sign of each element.'],
  mod: ['mod(a, m)', 'Remainder after division (sign of m).'],
  rem: ['rem(a, m)', 'Remainder after division (sign of a).'],
  sqrt: ['sqrt(A)', 'Square root.'],
  exp: ['exp(A)', 'Exponential.'],
  log: ['log(A)', 'Natural logarithm.'],
  log2: ['log2(A)', 'Base-2 logarithm.'],
  log10: ['log10(A)', 'Base-10 logarithm.'],
  sin: ['sin(A)', 'Sine (radians).'],
  cos: ['cos(A)', 'Cosine (radians).'],
  tan: ['tan(A)', 'Tangent (radians).'],
  sum: ['sum(A)', 'Sum of elements.'],
  prod: ['prod(A)', 'Product of elements.'],
  cumsum: ['cumsum(A)', 'Cumulative sum.'],
  mean: ['mean(A)', 'Average value.'],
  max: ['max(A)', 'Largest element.'],
  min: ['min(A)', 'Smallest element.'],
  any: ['any(A)', 'True if any element is non-zero.'],
  all: ['all(A)', 'True if all elements are non-zero.'],
  find: ['find(A)', 'Indices of non-zero elements.'],
  sort: ['sort(A)', 'Sort elements.'],
  linspace: ['linspace(a, b, n)', 'n evenly spaced points between a and b.'],
  reshape: ['reshape(A, m, n)', 'Change the shape of an array.'],
  repmat: ['repmat(A, m, n)', 'Tile an array.'],
  flipud: ['flipud(A)', 'Flip rows (up/down).'],
  fliplr: ['fliplr(A)', 'Flip columns (left/right).'],
  rand: ['rand(m, n)', 'Uniform random numbers in (0, 1).'],
  randi: ['randi(imax, m, n)', 'Random integers from 1 to imax.'],
  struct: ['struct("name", value)', 'Create a struct.'],
  cell: ['cell(m, n)', 'Create an empty cell array.'],
  strcmp: ['strcmp(a, b)', 'Compare strings.'],
  num2str: ['num2str(x)', 'Convert a number to text.'],
  sprintf: ['sprintf(fmt, ...)', 'Format data into text.'],
  fprintf: ['fprintf(fmt, ...)', 'Print formatted text.'],
  disp: ['disp(x)', 'Display a value.'],
  error: ['error(msg)', 'Raise an error.'],
  tic: ['tic', 'Start a stopwatch timer.'],
  toc: ['toc', 'Read the stopwatch timer.'],
  clc: ['clc', 'Clear the command window output.'],
  clear: ['clear', 'Remove variables from the workspace.'],
  clearvars: ['clearvars', 'Remove variables from the workspace.'],
  close: ['close all', 'Close figures.'],
  figure: ['figure', 'Create a figure.'],
  hold: ['hold on', 'Keep the current figure.'],
  format: ['format long', 'Set output display format.'],
  who: ['who', 'List workspace variable names.'],
  whos: ['whos', 'List workspace variables with size and class.'],
  help: ['help name', 'Show help for a function.'],
  doc: ['doc name', 'Show documentation for a function.'],
  lookfor: ['lookfor keyword', 'Search help for a keyword.'],
  imread: ['imread("file.png")', 'Read an image file from the current folder.'],
  imwrite: ['imwrite(A, "file.png")', 'Write an image to the current folder.'],
  imshow: ['imshow(A)', 'Display an image.'],
  imtool: ['imtool(A)', 'Open an image in the Image Tool.'],
  imfinfo: ['imfinfo("file.png")', 'Information about an image file.'],
  imcrop: ['imcrop(A, [x y w h])', 'Crop an image.'],
  imresize: ['imresize(A, scale)', 'Resize an image.'],
  imrotate: ['imrotate(A, angle)', 'Rotate an image.'],
  imhist: ['imhist(A)', 'Image histogram counts.'],
  histeq: ['histeq(A)', 'Histogram equalization (grayscale).'],
  imadd: ['imadd(A, B)', 'Add two images (saturating).'],
  imsubtract: ['imsubtract(A, B)', 'Subtract two images (saturating).'],
  imabsdiff: ['imabsdiff(A, B)', 'Absolute difference of two images.'],
  imcomplement: ['imcomplement(A)', 'Complement (negative) of an image.'],
  mat2gray: ['mat2gray(A)', 'Scale values to the range 0–1.'],
  im2double: ['im2double(A)', 'Convert an image to double in 0–1.'],
  im2uint8: ['im2uint8(A)', 'Convert an image to uint8.'],
  im2gray: ['im2gray(A)', 'Convert an RGB image to grayscale.'],
  im2bw: ['im2bw(A, level)', 'Threshold an image to black and white.'],
  rgb2gray: ['rgb2gray(A)', 'RGB to grayscale.'],
  rgb2hsv: ['rgb2hsv(A)', 'RGB to HSV.'],
  rgb2ycbcr: ['rgb2ycbcr(A)', 'RGB to YCbCr.'],
  rgb2ntsc: ['rgb2ntsc(A)', 'RGB to NTSC (YIQ).'],
};
const CONSTANTS: Record<string, string> = { pi: 'The number π.', eps: 'Floating-point precision.', Inf: 'Infinity.', inf: 'Infinity.', NaN: 'Not a number.', nan: 'Not a number.', true: 'Logical true.', false: 'Logical false.' };

const SNIPPETS: Completion[] = [
  snippetCompletion('if ${condition}\n\t${}\nend', { label: 'if', detail: 'if … end', type: 'keyword', boost: 2 }),
  snippetCompletion('if ${condition}\n\t${}\nelse\n\t${}\nend', { label: 'ifelse', detail: 'if … else … end', type: 'keyword' }),
  snippetCompletion('for ${i} = ${1}:${n}\n\t${}\nend', { label: 'for', detail: 'for loop', type: 'keyword', boost: 2 }),
  snippetCompletion('while ${condition}\n\t${}\nend', { label: 'while', detail: 'while loop', type: 'keyword', boost: 2 }),
  snippetCompletion('switch ${value}\n\tcase ${1}\n\t\t${}\n\totherwise\n\t\t${}\nend', { label: 'switch', detail: 'switch … case … end', type: 'keyword', boost: 2 }),
  snippetCompletion('function ${out} = ${name}(${in})\n\t${}\nend', { label: 'function', detail: 'function definition', type: 'keyword', boost: 2 }),
  snippetCompletion('try\n\t${}\ncatch ${err}\n\t${}\nend', { label: 'try', detail: 'try … catch … end', type: 'keyword' }),
];

const ASSIGN = /^[ \t]*([A-Za-z_]\w*)[ \t]*(?:\([^)=]*\))?[ \t]*=(?!=)/gm;
const MULTI_ASSIGN = /^[ \t]*\[([^\]=\n]*)\][ \t]*=(?!=)/gm;
const FOR_VAR = /^[ \t]*for[ \t]+\(?[ \t]*([A-Za-z_]\w*)[ \t]*=/gm;
const FUNC_DEF = /^[ \t]*function[ \t]+(?:(?:\[([^\]]*)\]|([A-Za-z_]\w*))[ \t]*=[ \t]*)?([A-Za-z_]\w*)[ \t]*(?:\(([^)]*)\))?/gm;

/** Names a notebook defines itself: assignments, loop variables, and function names/arguments. */
export function scanDefinedNames(sources: string[]): { vars: Set<string>; functions: Set<string> } {
  const vars = new Set<string>(), functions = new Set<string>();
  const ident = (s: string) => s.split(/[\s,]+/).filter(x => /^[A-Za-z_]\w*$/.test(x));
  for (const src of sources) {
    const text = src.replace(/%.*$/gm, '');
    for (const m of text.matchAll(ASSIGN)) vars.add(m[1]);
    for (const m of text.matchAll(MULTI_ASSIGN)) ident(m[1]).forEach(n => vars.add(n));
    for (const m of text.matchAll(FOR_VAR)) vars.add(m[1]);
    for (const m of text.matchAll(FUNC_DEF)) {
      functions.add(m[3]);
      ident(m[1] ?? m[2] ?? '').forEach(n => vars.add(n));
      ident(m[4] ?? '').forEach(n => vars.add(n));
    }
  }
  for (const k of KEYWORDS) vars.delete(k);
  return { vars, functions };
}

/** Is the cursor (end of `prefix`) in code, inside a string literal, or in a comment? */
export function lexState(prefix: string): { kind: 'code' | 'string' | 'comment'; quote?: string; start?: number } {
  let quote = '', start = 0;
  for (let i = 0; i < prefix.length; i++) {
    const ch = prefix[i];
    if (quote) {
      if (ch === quote) { if (prefix[i + 1] === quote) i++; else quote = ''; }
      continue;
    }
    if (ch === '%') return { kind: 'comment' };
    if (ch === '"') { quote = ch; start = i + 1; continue; }
    if (ch === "'") {
      // After an identifier, closing bracket or another transpose a quote is the transpose operator.
      let j = i - 1; while (j >= 0 && (prefix[j] === ' ' || prefix[j] === '\t')) j--;
      const prev = j >= 0 ? prefix[j] : '';
      if (prev && (/[\w)\]}.']/.test(prev)) && j === i - 1) continue;
      quote = ch; start = i + 1;
    }
  }
  return quote ? { kind: 'string', quote, start } : { kind: 'code' };
}

function matlabSources(host: CompletionHost): CompletionSource[] {
  const fixed: Completion[] = [
    ...KEYWORDS.map(k => ({ label: k, type: 'keyword', boost: -1 } as Completion)),
    ...SNIPPETS,
    ...Object.entries(FUNCTIONS).map(([name, [sig, info]]) => ({ label: name, type: 'function', detail: sig, info, boost: 0 } as Completion)),
    ...Object.entries(CONSTANTS).map(([name, info]) => ({ label: name, type: 'constant', info, boost: -2 } as Completion)),
  ];

  const code: CompletionSource = (context: CompletionContext): CompletionResult | null => {
    const word = context.matchBefore(/[A-Za-z_]\w*/);
    if (!word && !context.explicit) return null;
    const line = context.state.doc.lineAt(context.pos);
    const prefix = line.text.slice(0, context.pos - line.from);
    if (lexState(prefix).kind !== 'code') return null;
    // Field access (s.name) and numbers (1e5) are not completed.
    if (word && /[\w)\]}]\.$/.test(prefix.slice(0, word.from - line.from))) return null;
    if (word && /\d/.test(prefix[word.from - line.from - 1] ?? '')) return null;

    const ws = host.workspace();
    const wsNames = new Set(ws.map(v => v.name));
    const { vars, functions } = scanDefinedNames(host.codeSources());
    const dynamic: Completion[] = [
      ...ws.map(v => ({ label: v.name, type: 'variable', detail: `${v.cls} ${v.size}`, boost: 4 } as Completion)),
      ...[...vars].filter(n => !wsNames.has(n)).map(n => ({ label: n, type: 'variable', detail: 'notebook', boost: 3 } as Completion)),
      ...[...functions].map(n => ({ label: n, type: 'function', detail: 'notebook function', boost: 3 } as Completion)),
    ];
    return { from: word ? word.from : context.pos, options: [...dynamic, ...fixed], validFor: /^[A-Za-z_]\w*$/ };
  };

  // File names inside a string: imread('te|')
  const files: CompletionSource = (context: CompletionContext): CompletionResult | null => {
    const line = context.state.doc.lineAt(context.pos);
    const prefix = line.text.slice(0, context.pos - line.from);
    const st = lexState(prefix);
    if (st.kind !== 'string' || st.start === undefined) return null;
    if (!/\b(?:imread|imwrite|imfinfo|imtool|imshow|exist|load|save|delete)\s*\(\s*(?:[^()]*,\s*)?$/.test(prefix.slice(0, st.start - 1)) && !context.explicit) return null;
    const names = host.fileNames();
    if (!names.length) return null;
    return { from: line.from + st.start, options: names.map(n => ({ label: n, type: 'text', detail: 'file' } as Completion)), validFor: /^[^'"]*$/ };
  };

  return [code, files];
}

registerCompletion('matlab', { sources: matlabSources });
