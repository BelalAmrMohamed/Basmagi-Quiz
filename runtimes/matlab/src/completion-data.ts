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
    "Convert to uint8: round half away from zero, saturate to 0–255, NaN becomes 0."
  ],
  "int8": [
    "int8(A)",
    "Convert to int8: round half away from zero, saturate to −128…127, NaN becomes 0."
  ],
  "uint16": [
    "uint16(A)",
    "Convert to uint16: round half away from zero, saturate to 0–65535, NaN becomes 0."
  ],
  "int16": [
    "int16(A)",
    "Convert to int16: round half away from zero, saturate to −32768…32767, NaN becomes 0."
  ],
  "uint32": [
    "uint32(A)",
    "Convert to uint32: round half away from zero, saturate to 0…4294967295, NaN becomes 0."
  ],
  "int32": [
    "int32(A)",
    "Convert to int32: round half away from zero, saturate to −2147483648…2147483647, NaN becomes 0."
  ],
  "single": [
    "single(A)",
    "Convert to single precision (values are rounded to float32)."
  ],
  "cast": [
    "cast(A, 'newclass')",
    "Convert A to double, single, int8, uint8, int16, uint16, int32, uint32 or logical."
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
    "Close the current figure, figure n (close(n)) or all figures. Cards already shown stay in the output."
  ],
  "figure": [
    "figure(n)",
    "Create a new figure, or select figure n. Window properties such as 'Name' are ignored."
  ],
  "hold": [
    "hold on",
    "Keep the current items when plotting again (hold off replaces them)."
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
    "imshow(A, [lo hi])",
    "Display an image; [lo hi] or [] (data min and max) sets the gray display range, imshow(X, map) shows an indexed image."
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
    "B = imresize(A, scale | [m n], method, 'Antialiasing', tf)",
    "Resize an image; scale is a factor (size rounded up) or [rows cols] (one may be NaN). Methods: 'nearest', 'bilinear', 'bicubic' (default). Shrinking with bilinear or bicubic widens the kernel (anti-aliasing) unless 'Antialiasing', false. The class of A is kept."
  ],
  "imrotate": [
    "B = imrotate(A, angle, method, bbox)",
    "Rotate an image counterclockwise by angle degrees about its center. method: 'nearest' (default), 'bilinear', 'bicubic'; bbox: 'loose' (default, whole rotated image) or 'crop' (same size as A). Uncovered pixels are 0."
  ],
  "imhist": [
    "[counts, x] = imhist(I, n)",
    "Image histogram; without outputs it draws one bar per bin (256, or 2 for logical images) on a 0-255 axis."
  ],
  "conv2": [
    "C = conv2(A, B, shape)",
    "2-D convolution; shape is 'full' (default), 'same' or 'valid'. conv2(v1, v2, A) convolves the columns with v1 and the rows with v2. Result is double (single if an input is single)."
  ],
  "filter2": [
    "Y = filter2(h, A, shape)",
    "2-D correlation with the kernel h; shape is 'same' (default), 'full' or 'valid'. Result is double (single if an input is single)."
  ],
  "imfilter": [
    "B = imfilter(A, h, options)",
    "Filter an image with kernel h (correlation by default). Options: 'conv', 'replicate', 'symmetric', 'circular', a number for constant padding (default 0), 'same' (default), 'full'. The output keeps the class of A (rounded and saturated for integers); RGB images are filtered per channel."
  ],
  "fspecial": [
    "h = fspecial(type, ...)",
    "Filter kernels: 'average' [3 3], 'gaussian' [3 3] sigma 0.5, 'laplacian' alpha 0.2, 'log' [5 5] sigma 0.5, 'prewitt', 'sobel', 'disk' radius 5, 'motion' len 9 theta 0, 'unsharp' alpha 0.2."
  ],
  "padarray": [
    "B = padarray(A, padsize, padval, direction)",
    "Pad an array: padval is a number (default 0), 'replicate', 'symmetric' or 'circular'; direction is 'both' (default), 'pre' or 'post'. The class of A is kept."
  ],
  "medfilt2": [
    "B = medfilt2(A, [m n], padopt)",
    "Median filter of an m x n window (default [3 3]). padopt is 'zeros' (default), 'symmetric' or 'indexed'. For an even window the two middle values are averaged. The class of A is kept."
  ],
  "ordfilt2": [
    "B = ordfilt2(A, order, domain, S, padopt)",
    "Order-statistic filter: the order-th smallest of the pixels where domain is nonzero (optionally plus offsets S). padopt is 'zeros' (default) or 'symmetric'. ordfilt2(A,1,ones(3)) is a minimum filter."
  ],
  "imgaussfilt": [
    "B = imgaussfilt(A, sigma, 'FilterSize', n, 'Padding', p)",
    "Gaussian smoothing with standard deviation sigma (default 0.5; [rows columns] if two values). The default kernel size is 2*ceil(2*sigma)+1 and the border is replicated. The class of A is kept."
  ],
  "stretchlim": [
    "lowhigh = stretchlim(I, tol)",
    "Intensity limits (0 to 1) that clip the fraction tol = [low high] of the pixels (default [0.01 0.99]); one column per channel for RGB."
  ],
  "imadjust": [
    "J = imadjust(I, [lin_lo lin_hi], [lout_lo lout_hi], gamma)",
    "Map intensities from the input range to the output range with a gamma curve. Ranges are on the 0-1 scale; [] means default (stretchlim, [0 1]); a 2x3 range adjusts each RGB channel. The class of I is kept."
  ],
  "graythresh": [
    "level = graythresh(I)",
    "Otsu's global threshold of an image as a double in [0, 1] (256-bin histogram; ties use the mean bin)."
  ],
  "imbinarize": [
    "BW = imbinarize(I, level)",
    "Logical image that is true where I is above the level (0 to 1). Without level the Otsu threshold from graythresh is used."
  ],
  "immultiply": [
    "Z = immultiply(X, Y)",
    "Element-wise product with saturation; an integer image times a double keeps the integer class."
  ],
  "imdivide": [
    "Z = imdivide(X, Y)",
    "Element-wise quotient, rounded and saturated for integer classes (x/0 saturates, 0/0 is 0)."
  ],
  "imlincomb": [
    "Z = imlincomb(k1, A1, k2, A2, ..., k, outclass)",
    "Linear combination k1*A1 + k2*A2 + ... (+ k), computed in double, then rounded and saturated to the class of A1 (or outclass)."
  ],
  "mean2": [
    "m = mean2(A)",
    "Mean of all elements of A."
  ],
  "std2": [
    "s = std2(A)",
    "Standard deviation of all elements of A (normalized by N-1)."
  ],
  "corr2": [
    "r = corr2(A, B)",
    "Correlation coefficient of two images of the same size."
  ],
  "entropy": [
    "e = entropy(I)",
    "Entropy -sum(p.*log2(p)) of the 256-bin histogram of an image (2 bins for logical), in bits."
  ],
  "immse": [
    "err = immse(X, Y)",
    "Mean squared error between two images of the same size."
  ],
  "psnr": [
    "[peaksnr, snr] = psnr(A, ref, peakval)",
    "Peak signal-to-noise ratio in dB; the peak is 255 for uint8, 65535 for uint16 and 1 for double, unless peakval is given. The second output is the SNR."
  ],
  "ssim": [
    "[ssimval, ssimmap] = ssim(A, ref)",
    "Structural similarity index (11x11 Gaussian window, sigma 1.5, K = [0.01 0.03]); returns the mean over the whole image and the local map."
  ],
  "imnoise": [
    "J = imnoise(I, type, ...)",
    "Add noise: 'gaussian' (mean 0, variance 0.01), 'salt & pepper' (density 0.05) or 'speckle' (variance 0.04), on the 0-1 scale. Seeded through rng; the class of I is kept."
  ],
  "edge": [
    "[BW, thresh] = edge(I, method, thresh, ...)",
    "Edges of a grayscale image as a logical image. Methods: 'sobel' (default), 'prewitt' and 'roberts' (options 'horizontal', 'vertical', 'both', 'nothinning'), 'log' (thresh, sigma = 2) and 'canny' (thresh scalar or [low high], sigma = sqrt(2)). The second output is the threshold used."
  ],
  "imtranslate": [
    "B = imtranslate(A, [tx ty], method, 'FillValues', v, 'OutputView', view)",
    "Shift an image tx columns right and ty rows down (negative values go the other way). method: 'linear' (default), 'nearest', 'cubic'; OutputView 'same' (default) or 'full'; uncovered pixels use FillValues (default 0)."
  ],
  "hsv2rgb": [
    "rgb = hsv2rgb(hsv)",
    "Convert HSV (hue, saturation, value, each 0 to 1) to RGB. Accepts an M-by-N-by-3 image or an m-by-3 colormap of class double or single."
  ],
  "ycbcr2rgb": [
    "rgb = ycbcr2rgb(ycbcr)",
    "Convert YCbCr to RGB (inverse of rgb2ycbcr). Accepts uint8, uint16, double or single; the result has the class of the input."
  ],
  "ntsc2rgb": [
    "rgb = ntsc2rgb(yiq)",
    "Convert NTSC (YIQ) to RGB (inverse of rgb2ntsc); the result is clipped to 0-1."
  ],
  "rgb2lab": [
    "lab = rgb2lab(rgb)",
    "Convert sRGB to CIE L*a*b* with the D65 white point; L is 0 to 100. Accepts uint8, uint16, double or single (M-by-N-by-3 or m-by-3); the result is double (single for single input)."
  ],
  "lab2rgb": [
    "rgb = lab2rgb(lab, 'OutputType', type)",
    "Convert CIE L*a*b* (sRGB, D65) to RGB; the result is double in 0-1 unless OutputType is 'uint8', 'uint16' or 'single'."
  ],
  "rgb2ind": [
    "[X, map] = rgb2ind(RGB, n | tol | map)",
    "Convert an RGB image to an indexed image with n colors, a uniform-quantization tolerance, or a given colormap. X holds 0-based indices (uint8, or uint16 above 256 colors); map is m-by-3 in 0-1. No dithering."
  ],
  "ind2rgb": [
    "RGB = ind2rgb(X, map)",
    "Convert an indexed image to RGB (double). Indices of class double or single are 1-based; integer classes are 0-based. Out-of-range indices are clamped."
  ],
  "gray2ind": [
    "[X, map] = gray2ind(I, n)",
    "Convert a grayscale image to an indexed image with n gray levels (default 64): X = round(I*(n-1)), uint8 (uint16 above 256), and map = gray(n)."
  ],
  "ind2gray": [
    "I = ind2gray(X, map)",
    "Convert an indexed image to grayscale using the colormap intensities (0.299 R + 0.587 G + 0.114 B); the result has the class of X."
  ],
  "strel": [
    "se = strel(shape, ...)",
    "Structuring element: strel('square', w), 'rectangle' [m n], 'diamond' r, 'disk' r (n = 4 approximates, 0 is exact), 'line' len deg, 'arbitrary' nhood (height). Returns a struct with Neighborhood and Height."
  ],
  "getnhood": [
    "nhood = getnhood(se)",
    "Neighborhood (logical matrix) of a structuring element; a numeric array is returned as logical."
  ],
  "imerode": [
    "J = imerode(I, se)",
    "Erosion: the minimum over the neighborhood; pixels outside the image count as the maximum of the class. Binary and grayscale, per channel for RGB; se is a strel or a 0/1 array."
  ],
  "imdilate": [
    "J = imdilate(I, se)",
    "Dilation: the maximum over the (reflected) neighborhood; pixels outside the image count as the minimum of the class. Binary and grayscale, per channel for RGB."
  ],
  "imopen": [
    "J = imopen(I, se)",
    "Opening: erosion followed by dilation with the same structuring element."
  ],
  "imclose": [
    "J = imclose(I, se)",
    "Closing: dilation followed by erosion with the same structuring element."
  ],
  "imfill": [
    "J = imfill(I, 'holes')",
    "Fill holes: background pixels not connected (4-connected) to the border become foreground. Also fills grayscale basins."
  ],
  "bwlabel": [
    "[L, num] = bwlabel(BW, conn)",
    "Label connected components (conn 4 or 8, default 8); labels are numbered in the order their first pixel is met scanning column by column."
  ],
  "bwareaopen": [
    "BW2 = bwareaopen(BW, P, conn)",
    "Remove connected components that have fewer than P pixels (conn 4 or 8, default 8)."
  ],
  "regionprops": [
    "s = regionprops(L, 'Area', 'Centroid', 'BoundingBox')",
    "Measure the regions of a label matrix (or a logical image, labeled 8-connected). Returns a struct array with Area, Centroid [x y] and BoundingBox [x y width height]."
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
    "Convert an image to double in 0–1 (integer classes are scaled by their range, e.g. uint16 by 65535)."
  ],
  "im2single": [
    "im2single(A)",
    "Convert an image to single in 0–1 (integer classes are scaled by their range)."
  ],
  "im2uint8": [
    "im2uint8(A)",
    "Convert an image to uint8, scaling from the range of its class (double/single 0–1 become 0–255)."
  ],
  "im2uint16": [
    "im2uint16(A)",
    "Convert an image to uint16, scaling from the range of its class (double/single 0–1 become 0–65535, uint8 values are multiplied by 257)."
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
    "Histogram with k bins; without outputs it draws the bars. Matrix data is pooled."
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
  ],
  "clf": [
    "clf",
    "Clear the current figure."
  ],
  "subplot": [
    "subplot(m, n, p)",
    "Select cell p of an m-by-n grid of axes (also subplot(mnp)). A different grid replaces the old axes."
  ],
  "title": [
    "title(text)",
    "Title of the current axes."
  ],
  "xlabel": [
    "xlabel(text)",
    "Label of the x axis."
  ],
  "ylabel": [
    "ylabel(text)",
    "Label of the y axis."
  ],
  "drawnow": [
    "drawnow",
    "Show pending figure changes now (at most one update per figure every 100 ms)."
  ],
  "plot": [
    "plot(x, y, 'r--o')",
    "Line plot of vectors or matrix columns; several x, y, spec groups and 'LineWidth', 'Color' are accepted."
  ],
  "bar": [
    "bar(x, y, width)",
    "Bar chart; matrix columns are drawn side by side."
  ],
  "stem": [
    "stem(x, y)",
    "Stem plot; accepts a line spec and 'filled'."
  ],
  "histogram": [
    "histogram(data, nbins)",
    "Draw a histogram with equal-width bins (default: ceil(log2(n)) + 1). No output object."
  ],
  "scatter": [
    "scatter(x, y, size, color)",
    "Scatter plot with one marker size and color; accepts 'filled'."
  ],
  "axis": [
    "axis([x1 x2 y1 y2])",
    "Set axis limits, or axis tight / equal / image / square / off / on / auto / normal."
  ],
  "xlim": [
    "xlim([lo hi])",
    "Set or query the x limits; xlim auto resets them."
  ],
  "ylim": [
    "ylim([lo hi])",
    "Set or query the y limits; ylim auto resets them."
  ],
  "grid": [
    "grid on",
    "Show or hide grid lines."
  ],
  "legend": [
    "legend('a', 'b')",
    "Name the plotted series; legend off removes the legend. The position is chosen automatically."
  ],
  "imagesc": [
    "imagesc(C, [lo hi])",
    "Display a matrix scaled through the colormap (default: an approximation of parula)."
  ],
  "image": [
    "image(C)",
    "Display values as colormap rows (double: 1-based, integers: 0-based), or an RGB array."
  ],
  "colormap": [
    "colormap(map)",
    "Set the figure colormap by name (gray, jet, hot, bone, hsv, parula) or an m-by-3 matrix."
  ],
  "colorbar": [
    "colorbar",
    "Show the color scale of the current axes; colorbar off hides it."
  ],
  "text": [
    "text(x, y, str)",
    "Write text at data coordinates."
  ],
  "gray": [
    "gray(m)",
    "Gray colormap, m-by-3 (default m = 256)."
  ],
  "jet": [
    "jet(m)",
    "Jet colormap, m-by-3 (default m = 256)."
  ],
  "hot": [
    "hot(m)",
    "Black-red-yellow-white colormap, m-by-3 (default m = 256)."
  ],
  "bone": [
    "bone(m)",
    "Gray colormap with a blue tint, m-by-3 (default m = 256)."
  ],
  "hsv": [
    "hsv(m)",
    "Hue circle colormap, m-by-3 (default m = 256)."
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
