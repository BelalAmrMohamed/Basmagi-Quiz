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
  ],
  "atan": [
    "atan(x)",
    "Inverse tangent in radians."
  ],
  "atan2": [
    "atan2(y, x)",
    "Four-quadrant inverse tangent in radians."
  ],
  "sinh": [
    "sinh(x)",
    "Hyperbolic sine."
  ],
  "cosh": [
    "cosh(x)",
    "Hyperbolic cosine."
  ],
  "tanh": [
    "tanh(x)",
    "Hyperbolic tangent."
  ],
  "power": [
    "power(a, b)",
    "Elementwise power, same as a .^ b."
  ],
  "hypot": [
    "hypot(a, b)",
    "Square root of a.^2 + b.^2, elementwise."
  ],
  "isnan": [
    "isnan(A)",
    "Logical mask of NaN elements."
  ],
  "isinf": [
    "isinf(A)",
    "Logical mask of Inf elements."
  ],
  "isfinite": [
    "isfinite(A)",
    "Logical mask of finite elements."
  ],
  "idivide": [
    "idivide(a, b, opt)",
    "Integer division with rounding option: 'fix' (default), 'floor', 'ceil', 'round'."
  ],
  "bitand": [
    "bitand(a, b)",
    "Bitwise AND of non-negative integers."
  ],
  "bitor": [
    "bitor(a, b)",
    "Bitwise OR of non-negative integers."
  ],
  "bitxor": [
    "bitxor(a, b)",
    "Bitwise XOR of non-negative integers."
  ],
  "bitshift": [
    "bitshift(a, k)",
    "Shift bits left (k > 0) or right (k < 0)."
  ],
  "bitcmp": [
    "bitcmp(a)",
    "Bitwise complement (uint8 by default)."
  ],
  "xor": [
    "xor(a, b)",
    "Logical exclusive OR."
  ],
  "median": [
    "median(A, dim)",
    "Median value along a dimension; 'all' for the whole array."
  ],
  "mode": [
    "mode(A, dim)",
    "Most frequent value; the smallest wins ties."
  ],
  "std": [
    "std(A, opt, dim)",
    "Standard deviation (normalized by N-1; opt = 1 normalizes by N)."
  ],
  "var": [
    "var(A, opt, dim)",
    "Variance (normalized by N-1; opt = 1 normalizes by N)."
  ],
  "cumprod": [
    "cumprod(A, dim)",
    "Cumulative product."
  ],
  "cummax": [
    "cummax(A, dim)",
    "Cumulative maximum."
  ],
  "cummin": [
    "cummin(A, dim)",
    "Cumulative minimum."
  ],
  "diff": [
    "diff(A, n, dim)",
    "Differences between adjacent elements."
  ],
  "norm": [
    "norm(A, p)",
    "Vector p-norm (default 2) or matrix 1, 2, Inf and 'fro' norm."
  ],
  "dot": [
    "dot(a, b)",
    "Dot product of two vectors."
  ],
  "cross": [
    "cross(a, b)",
    "Cross product of two 3-element vectors."
  ],
  "trace": [
    "trace(A)",
    "Sum of the diagonal of a square matrix."
  ],
  "det": [
    "det(A)",
    "Determinant of a square matrix."
  ],
  "inv": [
    "inv(A)",
    "Matrix inverse; warns when the matrix is singular."
  ],
  "rank": [
    "rank(A)",
    "Rank of a matrix from its singular values."
  ],
  "nnz": [
    "nnz(A)",
    "Number of nonzero elements."
  ],
  "range": [
    "range(A, dim)",
    "Maximum minus minimum."
  ],
  "eye": [
    "eye(n)",
    "Identity matrix; eye(m, n) is rectangular."
  ],
  "magic": [
    "magic(n)",
    "Magic square of order n."
  ],
  "diag": [
    "diag(v, k)",
    "Build a diagonal matrix from a vector, or extract a diagonal from a matrix."
  ],
  "tril": [
    "tril(A, k)",
    "Lower triangular part of a matrix."
  ],
  "triu": [
    "triu(A, k)",
    "Upper triangular part of a matrix."
  ],
  "meshgrid": [
    "[X, Y] = meshgrid(x, y)",
    "2-D grid coordinates from vectors x and y."
  ],
  "ndgrid": [
    "[X, Y] = ndgrid(x, y)",
    "Grid coordinates in ndgrid (row, column) orientation."
  ],
  "randn": [
    "randn(m, n)",
    "Normally distributed random numbers. Seeded by rng; the sequence differs from MATLAB."
  ],
  "rng": [
    "rng(seed)",
    "Seed the random generator. Sequences are deterministic in MLWeb but do not match MATLAB."
  ],
  "logspace": [
    "logspace(a, b, n)",
    "n points logarithmically spaced between 10^a and 10^b."
  ],
  "colon": [
    "colon(a, b)",
    "Same as a:b; colon(a, s, b) is a:s:b."
  ],
  "cat": [
    "cat(dim, A, B, ...)",
    "Concatenate arrays along a dimension."
  ],
  "horzcat": [
    "horzcat(A, B, ...)",
    "Concatenate horizontally, same as [A, B]."
  ],
  "vertcat": [
    "vertcat(A, B, ...)",
    "Concatenate vertically, same as [A; B]."
  ],
  "kron": [
    "kron(A, B)",
    "Kronecker product. kron(A, ones(z)) is pixel replication zoom by z."
  ],
  "permute": [
    "permute(A, order)",
    "Rearrange the dimensions of an array."
  ],
  "squeeze": [
    "squeeze(A)",
    "Remove singleton dimensions."
  ],
  "circshift": [
    "circshift(A, k, dim)",
    "Circularly shift elements."
  ],
  "flip": [
    "flip(A, dim)",
    "Reverse the order of elements along a dimension."
  ],
  "rot90": [
    "rot90(A, k)",
    "Rotate a matrix by k*90 degrees counterclockwise."
  ],
  "sub2ind": [
    "sub2ind(sz, i, j)",
    "Subscripts to linear index."
  ],
  "ind2sub": [
    "[i, j] = ind2sub(sz, idx)",
    "Linear index to subscripts."
  ],
  "unique": [
    "[u, i, j] = unique(A)",
    "Sorted unique values with index outputs."
  ],
  "histc": [
    "histc(x, edges)",
    "Count values in bins defined by edges."
  ],
  "accumarray": [
    "accumarray(subs, vals)",
    "Accumulate (sum) values by subscript."
  ],
  "hist": [
    "[n, x] = hist(data, k)",
    "Histogram counts and centers for k bins (numeric form; drawing arrives with plotting)."
  ],
  "isequal": [
    "isequal(a, b, ...)",
    "True if all inputs have the same size and values."
  ],
  "isequaln": [
    "isequaln(a, b, ...)",
    "Like isequal but NaN values compare equal."
  ],
  "ismember": [
    "ismember(a, S)",
    "True where elements of a occur in S."
  ],
  "islogical": [
    "islogical(x)",
    "True for logical arrays."
  ],
  "isreal": [
    "isreal(x)",
    "True for real-valued arrays."
  ],
  "isfloat": [
    "isfloat(x)",
    "True for floating-point arrays."
  ],
  "isinteger": [
    "isinteger(x)",
    "True for integer-class arrays."
  ],
  "isrow": [
    "isrow(x)",
    "True for a row vector."
  ],
  "iscolumn": [
    "iscolumn(x)",
    "True for a column vector."
  ],
  "isvector": [
    "isvector(x)",
    "True for a 1-by-N or N-by-1 array."
  ],
  "isscalar": [
    "isscalar(x)",
    "True for a 1-by-1 array."
  ],
  "ismatrix": [
    "ismatrix(x)",
    "True for a 2-D array."
  ],
  "intmax": [
    "intmax('uint8')",
    "Largest integer of a class (default int32)."
  ],
  "intmin": [
    "intmin('uint8')",
    "Smallest integer of a class (default int32)."
  ],
  "realmax": [
    "realmax",
    "Largest finite double."
  ],
  "realmin": [
    "realmin",
    "Smallest normalized double."
  ],
  "flintmax": [
    "flintmax",
    "Largest consecutive integer in double precision."
  ],
  "strcat": [
    "strcat(a, b, ...)",
    "Concatenate strings."
  ],
  "strrep": [
    "strrep(s, old, new)",
    "Replace substrings."
  ],
  "strsplit": [
    "strsplit(s, delim)",
    "Split a string into a cell array."
  ],
  "strjoin": [
    "strjoin(C, delim)",
    "Join a cell array of strings."
  ],
  "strtrim": [
    "strtrim(s)",
    "Remove leading and trailing whitespace."
  ],
  "upper": [
    "upper(s)",
    "Convert to upper case."
  ],
  "lower": [
    "lower(s)",
    "Convert to lower case."
  ],
  "strcmpi": [
    "strcmpi(a, b)",
    "Case-insensitive string comparison."
  ],
  "strncmp": [
    "strncmp(a, b, n)",
    "Compare the first n characters."
  ],
  "strncmpi": [
    "strncmpi(a, b, n)",
    "Case-insensitive comparison of the first n characters."
  ],
  "str2double": [
    "str2double(s)",
    "Convert text to a number; NaN when it is not numeric."
  ],
  "str2num": [
    "str2num(s)",
    "Convert text holding numbers or a simple matrix to numbers (no eval)."
  ],
  "int2str": [
    "int2str(x)",
    "Round to the nearest integer and format as text."
  ],
  "mat2str": [
    "mat2str(A)",
    "Matrix as text, e.g. [1 2;3 4]."
  ],
  "pause": [
    "pause(s)",
    "Wait s seconds (at most 5 s per call)."
  ],
  "beep": [
    "beep",
    "Play a short tone."
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
