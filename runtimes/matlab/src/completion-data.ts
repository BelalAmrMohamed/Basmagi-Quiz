// =============================================================================
// runtimes/matlab/src/completion-data.ts
// Data for autocomplete: function signatures and docs, constants, and code snippets.
// Ported from the deployed MLWeb runtime, not abbreviated.
// =============================================================================

/** name -> [signature, description] */
export const FUNCTION_DOCS: Record<string, [signature: string, description: string]> = {
  "zeros": [
    "zeros(m, n)",
    "Array of zeros; optional class, e.g. zeros(256, 256, 3, \"uint8\")."
  ],
  "ones": [
    "ones(m, n)",
    "Array of ones."
  ],
  "size": [
    "size(A)",
    "Dimensions of an array."
  ],
  "numel": [
    "numel(A)",
    "Number of elements."
  ],
  "length": [
    "length(A)",
    "Length of the largest dimension."
  ],
  "ndims": [
    "ndims(A)",
    "Number of dimensions."
  ],
  "isempty": [
    "isempty(A)",
    "True if the array has no elements."
  ],
  "class": [
    "class(A)",
    "Class name of a value."
  ],
  "iscell": [
    "iscell(A)",
    "True for cell arrays."
  ],
  "isstruct": [
    "isstruct(A)",
    "True for structs."
  ],
  "isnumeric": [
    "isnumeric(A)",
    "True for numeric values."
  ],
  "ischar": [
    "ischar(A)",
    "True for character arrays."
  ],
  "double": [
    "double(A)",
    "Convert to double."
  ],
  "uint8": [
    "uint8(A)",
    "Convert to uint8 (saturating)."
  ],
  "logical": [
    "logical(A)",
    "Convert to logical."
  ],
  "char": [
    "char(A)",
    "Convert to character array."
  ],
  "abs": [
    "abs(A)",
    "Absolute value."
  ],
  "fix": [
    "fix(A)",
    "Round toward zero."
  ],
  "floor": [
    "floor(A)",
    "Round toward minus infinity."
  ],
  "ceil": [
    "ceil(A)",
    "Round toward plus infinity."
  ],
  "round": [
    "round(A)",
    "Round to nearest integer."
  ],
  "sign": [
    "sign(A)",
    "Sign of each element."
  ],
  "mod": [
    "mod(a, m)",
    "Remainder after division (sign of m)."
  ],
  "rem": [
    "rem(a, m)",
    "Remainder after division (sign of a)."
  ],
  "sqrt": [
    "sqrt(A)",
    "Square root."
  ],
  "exp": [
    "exp(A)",
    "Exponential."
  ],
  "log": [
    "log(A)",
    "Natural logarithm."
  ],
  "log2": [
    "log2(A)",
    "Base-2 logarithm."
  ],
  "log10": [
    "log10(A)",
    "Base-10 logarithm."
  ],
  "sin": [
    "sin(A)",
    "Sine (radians)."
  ],
  "cos": [
    "cos(A)",
    "Cosine (radians)."
  ],
  "tan": [
    "tan(A)",
    "Tangent (radians)."
  ],
  "sum": [
    "sum(A)",
    "Sum of elements."
  ],
  "prod": [
    "prod(A)",
    "Product of elements."
  ],
  "cumsum": [
    "cumsum(A)",
    "Cumulative sum."
  ],
  "mean": [
    "mean(A)",
    "Average value."
  ],
  "max": [
    "max(A)",
    "Largest element."
  ],
  "min": [
    "min(A)",
    "Smallest element."
  ],
  "any": [
    "any(A)",
    "True if any element is non-zero."
  ],
  "all": [
    "all(A)",
    "True if all elements are non-zero."
  ],
  "find": [
    "find(A)",
    "Indices of non-zero elements."
  ],
  "sort": [
    "sort(A)",
    "Sort elements."
  ],
  "linspace": [
    "linspace(a, b, n)",
    "n evenly spaced points between a and b."
  ],
  "reshape": [
    "reshape(A, m, n)",
    "Change the shape of an array."
  ],
  "repmat": [
    "repmat(A, m, n)",
    "Tile an array."
  ],
  "flipud": [
    "flipud(A)",
    "Flip rows (up/down)."
  ],
  "fliplr": [
    "fliplr(A)",
    "Flip columns (left/right)."
  ],
  "rand": [
    "rand(m, n)",
    "Uniform random numbers in (0, 1)."
  ],
  "randi": [
    "randi(imax, m, n)",
    "Random integers from 1 to imax."
  ],
  "struct": [
    "struct(\"name\", value)",
    "Create a struct."
  ],
  "cell": [
    "cell(m, n)",
    "Create an empty cell array."
  ],
  "strcmp": [
    "strcmp(a, b)",
    "Compare strings."
  ],
  "num2str": [
    "num2str(x)",
    "Convert a number to text."
  ],
  "sprintf": [
    "sprintf(fmt, ...)",
    "Format data into text."
  ],
  "fprintf": [
    "fprintf(fmt, ...)",
    "Print formatted text."
  ],
  "disp": [
    "disp(x)",
    "Display a value."
  ],
  "error": [
    "error(msg)",
    "Raise an error."
  ],
  "tic": [
    "tic",
    "Start a stopwatch timer."
  ],
  "toc": [
    "toc",
    "Read the stopwatch timer."
  ],
  "clc": [
    "clc",
    "Clear the command window output."
  ],
  "clear": [
    "clear",
    "Remove variables from the workspace."
  ],
  "clearvars": [
    "clearvars",
    "Remove variables from the workspace."
  ],
  "close": [
    "close all",
    "Close figures."
  ],
  "figure": [
    "figure",
    "Create a figure."
  ],
  "hold": [
    "hold on",
    "Keep the current figure."
  ],
  "format": [
    "format long",
    "Set output display format."
  ],
  "who": [
    "who",
    "List workspace variable names."
  ],
  "whos": [
    "whos",
    "List workspace variables with size and class."
  ],
  "help": [
    "help name",
    "Show help for a function."
  ],
  "doc": [
    "doc name",
    "Show documentation for a function."
  ],
  "lookfor": [
    "lookfor keyword",
    "Search help for a keyword."
  ],
  "imread": [
    "imread(\"file.png\")",
    "Read an image file from the current folder."
  ],
  "imwrite": [
    "imwrite(A, \"file.png\")",
    "Write an image to the current folder."
  ],
  "imshow": [
    "imshow(A)",
    "Display an image."
  ],
  "imtool": [
    "imtool(A)",
    "Open an image in the Image Tool."
  ],
  "imfinfo": [
    "imfinfo(\"file.png\")",
    "Information about an image file."
  ],
  "imcrop": [
    "imcrop(A, [x y w h])",
    "Crop an image."
  ],
  "imresize": [
    "imresize(A, scale)",
    "Resize an image."
  ],
  "imrotate": [
    "imrotate(A, angle)",
    "Rotate an image."
  ],
  "imhist": [
    "imhist(A)",
    "Image histogram counts."
  ],
  "histeq": [
    "histeq(A)",
    "Histogram equalization (grayscale)."
  ],
  "imadd": [
    "imadd(A, B)",
    "Add two images (saturating)."
  ],
  "imsubtract": [
    "imsubtract(A, B)",
    "Subtract two images (saturating)."
  ],
  "imabsdiff": [
    "imabsdiff(A, B)",
    "Absolute difference of two images."
  ],
  "imcomplement": [
    "imcomplement(A)",
    "Complement (negative) of an image."
  ],
  "mat2gray": [
    "mat2gray(A)",
    "Scale values to the range 0–1."
  ],
  "im2double": [
    "im2double(A)",
    "Convert an image to double in 0–1."
  ],
  "im2uint8": [
    "im2uint8(A)",
    "Convert an image to uint8."
  ],
  "im2gray": [
    "im2gray(A)",
    "Convert an RGB image to grayscale."
  ],
  "im2bw": [
    "im2bw(A, level)",
    "Threshold an image to black and white."
  ],
  "rgb2gray": [
    "rgb2gray(A)",
    "RGB to grayscale."
  ],
  "rgb2hsv": [
    "rgb2hsv(A)",
    "RGB to HSV."
  ],
  "rgb2ycbcr": [
    "rgb2ycbcr(A)",
    "RGB to YCbCr."
  ],
  "rgb2ntsc": [
    "rgb2ntsc(A)",
    "RGB to NTSC (YIQ)."
  ]
};

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
  }
];
