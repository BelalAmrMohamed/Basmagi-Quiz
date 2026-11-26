// Phase 5 tests (Image Processing Toolbox). Expected values are computed by hand; the working is in the comments.
import type { Interp } from '../src/index';
type Run = (name: string, src: string, check: (o: string, I: Interp) => any, expectErr?: string) => void;
type Ctx = { run: Run; val: (I: Interp, n: string) => number[]; eq: (a: any, b: any) => any };

const r = (a: number[], d = 4) => a.map(v => Math.round(v * 10 ** d) / 10 ** d + 0);

export function runPhase5(ctx: Ctx) {
  const { run, val, eq } = ctx;
  const A3 = 'A = [1 2 3; 4 5 6; 7 8 9];';

  console.log('Phase 5a (spatial filtering)');
  // ---- conv2 / filter2 ----
  // full of ones(2): row/col 2-sums with zero padding; rows [1 3 5 3],[5 12 16 9],[11 24 28 15],[7 15 17 9]
  run('conv2 full with ones(2)', `${A3} C = conv2(A, ones(2));`, (_o, I) => eq(val(I, 'C'), [1, 5, 11, 7, 3, 12, 24, 15, 5, 16, 28, 17, 3, 9, 15, 9]));
  // same = full(2:4,2:4) (MATLAB central part), valid = full(2:3,2:3)
  run('conv2 same and valid, even kernel', `${A3} S = conv2(A, ones(2), 'same'); V = conv2(A, ones(2), 'valid');`, (_o, I) => eq([val(I, 'S'), val(I, 'V')], [[12, 24, 15, 16, 28, 17, 9, 15, 9], [12, 24, 16, 28]]));
  // conv2(A,[0 1;0 0],'same')(p,q) = A(p+1,q): [4 5 6;7 8 9;0 0 0]; filter2(...)(p,q) = A(p,q+1): [2 3 0;5 6 0;8 9 0]
  run('conv2 flips the kernel, filter2 does not', `${A3} B = [0 1; 0 0]; C = conv2(A, B, 'same'); F = filter2(B, A);`, (_o, I) => eq([val(I, 'C'), val(I, 'F')], [[4, 7, 0, 5, 8, 0, 6, 9, 0], [2, 5, 8, 3, 6, 9, 0, 0, 0]]));
  // separable form conv2([1 1],[1 1],A,'valid') equals conv2(A,ones(2),'valid')
  run('conv2 separable form', `${A3} V = conv2([1 1], [1 1], A, 'valid');`, (_o, I) => eq(val(I, 'V'), [12, 24, 16, 28]));
  run('conv2 of single stays single, integers give double', `a = conv2(single([1 2]), [1 1]); b = conv2(uint8([1 2]), [1 1]); ca = class(a); cb = class(b);`, (_o, I) => {
    const s = (n: string) => String.fromCharCode(...val(I, n));
    return eq([val(I, 'a'), val(I, 'b'), s('ca'), s('cb')], [[1, 3, 2], [1, 3, 2], 'single', 'double']);
  });
  run('conv2 unknown shape', `x = conv2(1, 1, 'bad');`, () => 0, "Error using conv2: Unknown shape parameter 'bad'. Use 'full', 'same' or 'valid'.");

  // ---- imfilter ----
  // zero pad: every pixel of a 2x2 sees all four values: 100/9 = 11.11 -> 11 (uint8)
  run('imfilter uint8 zero padding rounds, keeps class', `A = uint8([10 20; 30 40]); B = imfilter(A, ones(3)/9); k = strcmp(class(B), 'uint8');`, (_o, I) => eq([val(I, 'B'), val(I, 'k')], [[11, 11, 11, 11], [1]]));
  // replicate: (0,0) = 180/9 = 20, (1,0) = 240/9 = 26.67 -> 27, (0,1) = 210/9 = 23.33 -> 23, (1,1) = 270/9 = 30
  run('imfilter replicate', `A = uint8([10 20; 30 40]); B = imfilter(A, ones(3)/9, 'replicate');`, (_o, I) => eq(val(I, 'B'), [20, 27, 23, 30]));
  // h = [1 0 0]: correlation gives A(p-1) = [0 1 2]; convolution gives A(p+1) = [2 3 0]
  run('imfilter corr vs conv', `A = [1 2 3]; C = imfilter(A, [1 0 0]); V = imfilter(A, [1 0 0], 'conv');`, (_o, I) => eq([val(I, 'C'), val(I, 'V')], [[0, 1, 2], [2, 3, 0]]));
  // symmetric: left neighbour of A(0) is A(0): [1 1 2]*[1 1 1]/... use h=[1 0 0] -> [1 1 2]; circular -> [3 1 2]; pad value 7 -> [7 1 2]
  run('imfilter symmetric, circular and constant padding', `A = [1 2 3]; S = imfilter(A, [1 0 0], 'symmetric'); C = imfilter(A, [1 0 0], 'circular'); K = imfilter(A, [1 0 0], 7);`, (_o, I) => eq([val(I, 'S'), val(I, 'C'), val(I, 'K')], [[1, 1, 2], [3, 1, 2], [7, 1, 2]]));
  // full, h=[1 1] on [1 2;3 4]: row0 = [1 3 2], row1 = [3 7 4]
  run('imfilter full', `A = [1 2; 3 4]; F = imfilter(A, [1 1], 'full');`, (_o, I) => eq(val(I, 'F'), [1, 3, 3, 7, 2, 4]));
  run('imfilter saturates integer output', `A = uint8([200 200]); B = imfilter(A, [1 1]);`, (_o, I) => eq(val(I, 'B'), [255, 200]));
  // channels are 10, 20, 30 constants: 4v/9 = 4.44 -> 4, 8.89 -> 9, 13.33 -> 13
  run('imfilter filters RGB per channel', `A = cat(3, uint8(10*ones(2)), uint8(20*ones(2)), uint8(30*ones(2))); B = imfilter(A, ones(3)/9); s = size(B);`, (_o, I) => eq([val(I, 'B'), val(I, 's')], [[4, 4, 4, 4, 9, 9, 9, 9, 13, 13, 13, 13], [2, 2, 3]]));
  run('imfilter keeps single, uint16, logical classes', `a = class(imfilter(single([1 2]), 1)); b = class(imfilter(uint16([1 2]), 1)); c = class(imfilter(logical([1 0]), 1));`, (_o, I) => {
    const s = (n: string) => String.fromCharCode(...val(I, n));
    return eq([s('a'), s('b'), s('c')], ['single', 'uint16', 'logical']);
  });

  // ---- fspecial ----
  run('fspecial average, sobel, prewitt', `a = fspecial('average'); b = fspecial('average', [1 2]); c = fspecial('sobel'); d = fspecial('prewitt');`, (_o, I) => eq(
    [r(val(I, 'a'), 6), val(I, 'b'), val(I, 'c'), val(I, 'd')],
    [new Array(9).fill(0.111111), [0.5, 0.5], [1, 0, -1, 2, 0, -2, 1, 0, -1], [1, 0, -1, 1, 0, -1, 1, 0, -1]]));
  // laplacian alpha 0.2: corners .2/1.2 = 1/6, edges .8/1.2 = 2/3, center -4/1.2 = -10/3 (sums to 0)
  run('fspecial laplacian and unsharp', `a = fspecial('laplacian'); b = fspecial('unsharp');`, (_o, I) => eq([r(val(I, 'a')), r(val(I, 'b'))],
    [[0.1667, 0.6667, 0.1667, 0.6667, -3.3333, 0.6667, 0.1667, 0.6667, 0.1667], [-0.1667, -0.6667, -0.1667, -0.6667, 4.3333, -0.6667, -0.1667, -0.6667, -0.1667]]));
  // gaussian 3x3, sigma .5: weights 1, e^-2, e^-4 over their sum 1.6146 -> .6193, .0838, .0113
  run('fspecial gaussian default', `g = fspecial('gaussian'); s = sum(g(:));`, (_o, I) => eq([r(val(I, 'g')), r(val(I, 's'))],
    [[0.0113, 0.0838, 0.0113, 0.0838, 0.6193, 0.0838, 0.0113, 0.0838, 0.0113], [1]]));
  // log 3x3 sigma .5: (g*(r^2-.5)/.0625) minus its mean -> center -4.8233, edge 0.8021, corner 0.4037
  run('fspecial log 3x3', `h = fspecial('log', 3, 0.5);`, (_o, I) => eq(r(val(I, 'h'), 3), [0.404, 0.802, 0.404, 0.802, -4.823, 0.802, 0.404, 0.802, 0.404]));
  // disk(1): center 1/pi, edge (pi/6 + sqrt(3)/2*.5 - .5)/pi = .1453, corner .0788/pi = .0251
  run('fspecial disk(1)', `h = fspecial('disk', 1);`, (_o, I) => eq(r(val(I, 'h')), [0.0251, 0.1453, 0.0251, 0.1453, 0.3183, 0.1453, 0.0251, 0.1453, 0.0251]));
  // motion length 4 at 0 degrees: segment [-2,2]: end pixels half covered -> [1 2 2 2 1]/8
  run('fspecial motion', `a = fspecial('motion', 4, 0); b = fspecial('motion'); sa = size(a); sb = size(b);`, (_o, I) => eq([val(I, 'a'), val(I, 'sa'), r(val(I, 'b'), 6), val(I, 'sb')],
    [[0.125, 0.25, 0.25, 0.25, 0.125], [1, 5], new Array(9).fill(0.111111), [1, 9]]));
  run('fspecial unknown type', `h = fspecial('nope');`, () => 0, "Error using fspecial: Unknown filter type 'nope'.");

  // ---- padarray ----
  run('padarray zeros and replicate', `A = [1 2; 3 4]; Z = padarray(A, [1 1]); R = padarray(A, [1 1], 'replicate');`, (_o, I) => eq([val(I, 'Z'), val(I, 'R')],
    [[0, 0, 0, 0, 0, 1, 3, 0, 0, 2, 4, 0, 0, 0, 0, 0], [1, 1, 3, 3, 1, 1, 3, 3, 2, 2, 4, 4, 2, 2, 4, 4]]));
  run('padarray symmetric, circular, pre, post', `A = [1 2 3]; S = padarray(A, [0 2], 'symmetric'); C = padarray(A, [0 2], 'circular'); P = padarray([1 2], [0 2], 9, 'pre'); Q = padarray([1 2], [0 2], 9, 'post');`, (_o, I) => eq(
    [val(I, 'S'), val(I, 'C'), val(I, 'P'), val(I, 'Q')], [[2, 1, 1, 2, 3, 3, 2], [2, 3, 1, 2, 3, 1, 2], [9, 9, 1, 2], [1, 2, 9, 9]]));
  run('padarray keeps class and pads only the given dimensions', `A = padarray(uint8(cat(3, 1, 2)), [1 1]); k = strcmp(class(A), 'uint8'); s = size(A);`, (_o, I) => eq([val(I, 'k'), val(I, 's')], [[1], [3, 3, 2]]));

  // ---- medfilt2 / ordfilt2 ----
  // zero padding, 3x3 median of 1..9: [0 2 0; 2 5 3; 0 5 0] (e.g. (0,0): five zeros and 1,2,4,5 -> 5th smallest = 0)
  run('medfilt2 zero padding', `${A3} M = medfilt2(A);`, (_o, I) => eq(val(I, 'M'), [0, 2, 0, 2, 5, 5, 0, 3, 0]));
  // symmetric: (0,0) window = [1 1 2; 1 1 2; 4 4 5] -> sorted 1 1 1 1 2 2 4 4 5, median 2; center unchanged
  run('medfilt2 symmetric', `${A3} M = medfilt2(A, [3 3], 'symmetric');`, (_o, I) => eq([val(I, 'M')[0], val(I, 'M')[4]], [2, 5]));
  run('medfilt2 removes a salt pixel and keeps uint8', `A = zeros(5, 5, 'uint8'); A(3, 3) = 255; M = medfilt2(A); t = sum(M(:)); k = strcmp(class(M), 'uint8');`, (_o, I) => eq([val(I, 't'), val(I, 'k')], [[0], [1]]));
  // even window [1 2] on [1 2 3 4]: mean of the two middle values: [1.5 2.5 3.5 2]; uint8 rounds: [2 3 4 2]
  run('medfilt2 even window averages the middle pair', `a = medfilt2([1 2 3 4], [1 2]); b = medfilt2(uint8([1 2 3 4]), [1 2]);`, (_o, I) => eq([val(I, 'a'), val(I, 'b')], [[1.5, 2.5, 3.5, 2], [2, 3, 4, 2]]));
  // max filter (order 9) with zero padding: [5 6 6; 8 9 9; 8 9 9]; min filter (order 1): only the center survives
  run('ordfilt2 max and min over ones(3)', `${A3} X = ordfilt2(A, 9, ones(3)); N = ordfilt2(A, 1, ones(3));`, (_o, I) => eq([val(I, 'X'), val(I, 'N')],
    [[5, 8, 8, 6, 9, 9, 6, 9, 9], [0, 0, 0, 0, 1, 0, 0, 0, 0]]));
  // cross domain, order 3 of 5 (median): (1,1) = median(2,4,5,6,8) = 5; (0,1) = median(0,1,2,3,5) = 2
  run('ordfilt2 with a cross-shaped domain', `${A3} M = ordfilt2(A, 3, [0 1 0; 1 1 1; 0 1 0]); a = M(2,2); b = M(1,2);`, (_o, I) => eq([val(I, 'a'), val(I, 'b')], [[5], [2]]));
  // [1 2 3], domain [1 1], offsets [0 10], order 2 (the larger): max(A(p), A(p+1)+10) -> [12 13 10] (outside pixel is 0 + 10)
  run('ordfilt2 with additive offsets', `a = ordfilt2([1 2 3], 2, [1 1], [0 10]);`, (_o, I) => eq(val(I, 'a'), [12, 13, 10]));
  run('ordfilt2 order out of range', `a = ordfilt2([1 2 3], 3, [1 1]);`, () => 0, 'Error using ordfilt2: ORDER must be an integer between 1 and the number of nonzero elements of DOMAIN.');

  // ---- imgaussfilt ----
  // sigma .5 -> 3-tap kernel [e^-2 1 e^-2]/1.2707 = [.1065 .7870 .1065]; impulse response is the separable product
  run('imgaussfilt impulse response', `A = zeros(5); A(3,3) = 1; G = imgaussfilt(A, 0.5); c = G(3,3); e = G(2,3); k = G(2,2);`, (_o, I) => eq([r(val(I, 'c')), r(val(I, 'e')), r(val(I, 'k'))], [[0.6193], [0.0838], [0.0113]]));
  // row [0 0 100 100 100], replicate padding: [0, 10.65, 89.35, 100, 100] -> uint8 [0 11 89 100 100]
  run('imgaussfilt replicates the border and rounds for uint8', `A = uint8([0 0 100 100 100]); G = imgaussfilt(A, 0.5); k = strcmp(class(G), 'uint8');`, (_o, I) => eq([val(I, 'G'), val(I, 'k')], [[0, 11, 89, 100, 100], [1]]));
  run('imgaussfilt FilterSize 1 is the identity', `A = [1 5; 9 2]; G = imgaussfilt(A, 2, 'FilterSize', 1);`, (_o, I) => eq(val(I, 'G'), [1, 9, 5, 2]));

  console.log('Phase 5b (intensity, thresholding, metrics, noise)');
  const str = (I: Interp, n: string) => String.fromCharCode(...val(I, n));
  // ---- stretchlim / imadjust ----
  // 2 pixels of 10, 96 of 20, 2 of 200: cdf(10) = .02 > .01 -> low = 10/255; cdf(20) = .98 < .99, cdf(200) = 1 -> high = 200/255
  const S = 'A = uint8([10 10 20*ones(1,96) 200 200]);';
  run('stretchlim default [0.01 0.99]', `${S} L = stretchlim(A);`, (_o, I) => eq(r(val(I, 'L'), 6), [0.039216, 0.784314]));
  run('stretchlim with tol [0 1] and an RGB image', `${S} L = stretchlim(A, [0 1]); R = stretchlim(cat(3, A, A, A)); s = size(R);`, (_o, I) => eq([r(val(I, 'L'), 6), val(I, 's')], [[0.039216, 0.784314], [2, 3]]));
  // [0 .2 .4 1] with in-range [.2 .4]: (x-.2)/.2 clamped -> [0 0 1 1]
  run('imadjust input range clips and stretches', `a = imadjust(uint8([0 51 102 255]), [0.2 0.4], [0 1]);`, (_o, I) => eq(val(I, 'a'), [0, 0, 255, 255]));
  // gamma 2: squares of [0 .2 .4 1] -> [0 .04 .16 1]*255 = [0 10.2 40.8 255] -> [0 10 41 255]
  run('imadjust gamma', `a = imadjust(uint8([0 51 102 255]), [0 1], [0 1], 2);`, (_o, I) => eq(val(I, 'a'), [0, 10, 41, 255]));
  run('imadjust reversed output range', `a = imadjust(uint8([0 51 255]), [0 1], [1 0]);`, (_o, I) => eq(val(I, 'a'), [255, 204, 0]));
  run('imadjust on double', `a = imadjust([0 0.25 0.5 1], [0.25 0.75]);`, (_o, I) => eq(val(I, 'a'), [0, 0, 0.5, 1]));
  // default range = stretchlim = [10 200]/255: 20 -> (10/190)*255 = 13.42 -> 13
  run('imadjust(I) uses stretchlim', `${S} B = imadjust(A); k = strcmp(class(B), 'uint8');`, (_o, I) => eq([val(I, 'B')[0], val(I, 'B')[2], val(I, 'B')[99], val(I, 'k')[0]], [0, 13, 255, 1]));
  run('imadjust rejects an inverted input range', `a = imadjust(uint8([1 2]), [0.5 0.2]);`, () => 0, 'Error using imadjust: LOW_IN must be less than HIGH_IN.');

  // ---- graythresh / imbinarize ----
  // half 0, half 255: sigma_b^2 is equal for bins 1..255 (1-based), mean index 128 -> 127/255
  run('graythresh ties use the mean index', `t = graythresh(uint8([0 0 0 0 255 255 255 255]));`, (_o, I) => eq(r(val(I, 't'), 6), [0.498039]));
  // values 10 and 200 sit in bins 11 and 201; ties 11..200, mean 105.5 -> 104.5/255; double 0.1 and 0.9 -> 8-bit 26 and 230, bins 27 and 231, ties 27..230, mean 128.5 -> 127.5/255 = .5
  run('graythresh on 10 and 200', `t = graythresh(uint8([10 10 10 200 200 200])); d = graythresh([0.1 0.1 0.9 0.9]);`, (_o, I) => eq([r(val(I, 't'), 6), r(val(I, 'd'), 6)], [[0.409804], [0.5]]));
  run('imbinarize with a level returns logical', `b = imbinarize(uint8([10 100 200]), 0.5); k = strcmp(class(b), 'logical');`, (_o, I) => eq([val(I, 'b'), val(I, 'k')], [[0, 0, 1], [1]]));
  run('imbinarize(I) uses Otsu', `b = imbinarize(uint8([10 10 10 200 200 200]));`, (_o, I) => eq(val(I, 'b'), [0, 0, 0, 1, 1, 1]));

  // ---- immultiply / imdivide / imlincomb ----
  run('immultiply saturates and keeps the integer class', `a = immultiply(uint8([100 200]), 2); b = immultiply(uint8([20 30]), uint8([10 10])); c = immultiply([0.5 2], [2 2]); k = strcmp(class(a), 'uint8');`, (_o, I) => eq([val(I, 'a'), val(I, 'b'), val(I, 'c'), val(I, 'k')], [[200, 255], [200, 255], [1, 4], [1]]));
  // 10/4 = 2.5 -> 3, 15/4 = 3.75 -> 4, 255/4 = 63.75 -> 64; 5/0 saturates to 255 and 0/0 is 0
  run('imdivide rounds and saturates', `a = imdivide(uint8([10 15 255]), 4); b = imdivide(uint8([5 0]), uint8([0 0]));`, (_o, I) => eq([val(I, 'a'), val(I, 'b')], [[3, 4, 64], [255, 0]]));
  // .5*100 + .5*50 = 75; .5*200 + .5*255 = 227.5 -> 228
  run('imlincomb', `A = uint8([100 200]); B = uint8([50 255]); a = imlincomb(0.5, A, 0.5, B); b = imlincomb(2, A, -1, B, 10); c = imlincomb(0.5, A, 0.5, B, 'double');`, (_o, I) => eq([val(I, 'a'), val(I, 'b'), val(I, 'c')], [[75, 228], [160, 155], [75, 227.5]]));

  // ---- statistics and metrics ----
  run('mean2 and std2', `a = mean2([1 2; 3 4]); b = std2([1 2; 3 4]);`, (_o, I) => eq([val(I, 'a'), r(val(I, 'b'), 6)], [[2.5], [1.290994]])); // std = sqrt(5/3)
  // identical -> 1, reversed -> -1; [1 2 3 4] vs [1 3 2 4]: sum of products 4 over sqrt(5*5) -> .8
  run('corr2', `a = corr2([1 2; 3 4], [2 4; 6 8]); b = corr2([1 2; 3 4], [4 3; 2 1]); c = corr2([1 2 3 4], [1 3 2 4]);`, (_o, I) => eq([r(val(I, 'a')), r(val(I, 'b')), r(val(I, 'c'))], [[1], [-1], [0.8]]));
  run('corr2 size mismatch', `a = corr2([1 2], [1 2 3]);`, () => 0, 'Error using corr2: A and B must be the same size.');
  // two equally likely levels -> 1 bit; four -> 2 bits; p = [.75 .25] -> .75*log2(4/3) + .25*2 = .811278
  run('entropy', `a = entropy(uint8([0 0 255 255])); b = entropy(uint8([0 1 2 3])); c = entropy(uint8([0 0 0 255])); d = entropy(logical([1 0 1 0]));`, (_o, I) => eq([val(I, 'a'), val(I, 'b'), r(val(I, 'c'), 6), val(I, 'd')], [[1], [2], [0.811278], [1]]));
  // errors 3 and -4: mse = (9+16)/2 = 12.5; psnr = 10*log10(255^2/12.5) = 37.1617
  run('immse and psnr', `a = uint8([10 20]); b = uint8([13 16]); m = immse(a, b); p = psnr(a, b); q = psnr(a, a);`, (_o, I) => eq([val(I, 'm'), r(val(I, 'p')), val(I, 'q')], [[12.5], [37.1617], [Infinity]]));
  // double [0 .5] vs [0 .6]: mse .005, psnr = 10*log10(200) = 23.0103, snr = 10*log10(.36/.01) = 15.5630
  run('psnr on double with the SNR output', `[p, s] = psnr([0 0.5], [0 0.6]);`, (_o, I) => eq([r(val(I, 'p')), r(val(I, 's'))], [[23.0103], [15.563]]));
  // constant 100 vs 50 (L = 255): (2*100*50 + 6.5025) / (100^2 + 50^2 + 6.5025) = 10006.5025 / 12506.5025 = .8001 (C2 cancels)
  run('ssim', `a = uint8(100*ones(12)); b = uint8(50*ones(12)); s1 = ssim(a, a); s2 = ssim(a, b); [s3, m] = ssim(a, b); z = size(m);`, (_o, I) => eq([r(val(I, 's1')), r(val(I, 's2')), r(val(I, 's3')), val(I, 'z')], [[1], [0.8001], [0.8001], [12, 12]]));

  // ---- imnoise (statistical; rng seeds the generator) ----
  const near = (x: number, y: number, tol: number) => Math.abs(x - y) <= tol || `got ${x} expected ${y} +/- ${tol}`;
  run('imnoise gaussian on a 0.5 image: mean and variance', `rng(1); J = imnoise(0.5*ones(100), 'gaussian', 0.1, 0.01); m = mean2(J); s = std2(J);`, (_o, I) => {
    const a = near(val(I, 'm')[0], 0.6, 0.01); return a === true ? near(val(I, 's')[0], 0.1, 0.01) : a;
  });
  run('imnoise gaussian defaults on uint8 keep the class', `rng(2); J = imnoise(uint8(128*ones(200)), 'gaussian'); m = mean2(J); s = std2(J); k = strcmp(class(J), 'uint8');`, (_o, I) => {
    const a = near(val(I, 'm')[0], 128, 1.5); const b = a === true ? near(val(I, 's')[0], 25.5, 1.5) : a; return b === true ? eq(val(I, 'k'), [1]) : b;
  });
  run('imnoise salt & pepper fraction', `rng(3); J = imnoise(uint8(128*ones(200)), 'salt & pepper', 0.1); lo = mean2(J == 0); hi = mean2(J == 255); k = strcmp(class(J), 'uint8');`, (_o, I) => {
    const a = near(val(I, 'lo')[0] + val(I, 'hi')[0], 0.1, 0.01); const b = a === true ? near(val(I, 'lo')[0], 0.05, 0.01) : a; return b === true ? eq(val(I, 'k'), [1]) : b;
  });
  // speckle on 0.5 with v = .04: noise 0.5*sqrt(12*.04)*(u-.5) has mean 0 and variance .25*.04 = .01
  run('imnoise speckle', `rng(4); J = imnoise(0.5*ones(100), 'speckle'); m = mean2(J); s = std2(J);`, (_o, I) => {
    const a = near(val(I, 'm')[0], 0.5, 0.01); return a === true ? near(val(I, 's')[0], 0.1, 0.01) : a;
  });
  run('imnoise is repeatable with rng', `rng(7); A = imnoise(0.5*ones(5), 'gaussian'); rng(7); B = imnoise(0.5*ones(5), 'gaussian'); same = isequal(A, B);`, (_o, I) => eq(val(I, 'same'), [1]));
  run('imnoise unknown type and poisson', `J = imnoise(0.5, 'poisson');`, () => 0, "Error using imnoise: The 'poisson' noise type is not supported.");
  void str;

  console.log('Phase 5c (edge)');
  const V7 = 'I = zeros(7); I(:, 4:7) = 1;'; // vertical step between columns 3 and 4 (1-based)
  const H7 = 'J = zeros(7); J(4:7, :) = 1;';
  // sobel/prewitt gradient of the step is 0.5 at columns 3 and 4 (1-based) in every row, so b = .25 there. The plateau of two equal
  // maxima is thinned to its second column (b >= left, b > right), and the 1-pixel border is never marked: rows 2..6 of column 4 = 23..27.
  run('edge sobel: one-pixel-wide vertical edge from a vertical step', `${V7} E = edge(I, 'sobel', 0.1); k = strcmp(class(E), 'logical');`, (_o, I) => eq([val(I, 'E').map((v, i) => (v ? i + 1 : 0)).filter(Boolean), val(I, 'k')], [[23, 24, 25, 26, 27], [1]]));
  run('edge sobel on a horizontal step', `${H7} E = edge(J, 'sobel', 0.1);`, (_o, I) => eq(val(I, 'E').map((v, i) => (v ? i + 1 : 0)).filter(Boolean), [11, 18, 25, 32, 39]));
  // default threshold: mean(b) = 14*.25/49 = .0714, cutoff = 4*mean = .2857 > .25 (so nothing is an edge), thresh = sqrt(.2857) = .5345
  run('edge sobel default threshold estimator', `${V7} [E, t] = edge(I); n = nnz(E);`, (_o, I) => eq([r(val(I, 't'), 4), val(I, 'n')], [[0.5345], [0]]));
  run('edge sobel direction option', `${V7} H = edge(I, 'sobel', 0.1, 'horizontal'); V = edge(I, 'sobel', 0.1, 'vertical'); a = nnz(H); b = nnz(V);`, (_o, I) => eq([val(I, 'a'), val(I, 'b')], [[0], [5]]));
  run('edge sobel nothinning keeps both columns of the plateau', `${V7} E = edge(I, 'sobel', 0.1, 'nothinning'); n = nnz(E);`, (_o, I) => eq(val(I, 'n'), [14]));
  run('edge prewitt matches sobel on a step', `${V7} [E, t] = edge(I, 'prewitt', 0.1); [F, u] = edge(I, 'prewitt'); a = find(E)'; n = nnz(F);`, (_o, I) => eq([val(I, 'a'), r(val(I, 'u'), 4), val(I, 'n')], [[23, 24, 25, 26, 27], [0.5345], [0]]));
  // roberts: g1 = I(p,q) - I(p+1,q+1) = -1 and g2 = I(p,q+1) - I(p+1,q) = 1 at column 3 only, so b = 2 there
  // mean(b) = 7 pixels * 2 / 49 = .2857, cutoff = 6*.2857 = 1.7143 < 2, thresh = sqrt(1.7143) = 1.3093; edge at column 3, rows 2..6 = 16..20
  run('edge roberts with the default threshold', `${V7} [E, t] = edge(I, 'roberts'); a = find(E)';`, (_o, I) => eq([val(I, 'a'), r(val(I, 't'), 4)], [[16, 17, 18, 19, 20], [1.3093]]));
  run('edge works on uint8 as on the 0-1 scale', `${V7} A = edge(uint8(255*I), 'sobel', 0.1); B = edge(I, 'sobel', 0.1); same = isequal(A, B);`, (_o, I) => eq(val(I, 'same'), [1]));
  // LoG of a step: positive on the dark side, negative on the bright side; the negative pixel of the crossing is marked (column 6, rows 2..8)
  run('edge log marks the zero crossing of a step', `I = zeros(9); I(:, 6:9) = 1; E = edge(I, 'log', [], 1); a = find(E)';`, (_o, I) => eq(val(I, 'a'), [47, 48, 49, 50, 51, 52, 53]));
  run('edge log returns its threshold', `I = zeros(9); I(:, 6:9) = 1; [E, t] = edge(I, 'log', 0.01, 1); u = t;`, (_o, I) => eq(val(I, 'u'), [0.01]));
  // canny of a step: one pixel per interior row, next to the step; border rows are never edges
  run('edge canny gives a one-pixel-wide line on a step', `I = zeros(9); I(:, 6:9) = 1; E = edge(I, 'canny', [0.1 0.2]); rs = sum(E, 2)'; [rr, cc] = find(E); ok = all(cc >= 5 & cc <= 6);`, (_o, I) => eq([val(I, 'rs'), val(I, 'ok')], [[0, 1, 1, 1, 1, 1, 1, 1, 0], [1]]));
  run('edge canny scalar threshold becomes [0.4t t]', `I = zeros(9); I(:, 6:9) = 1; [E, t] = edge(I, 'canny', 0.5);`, (_o, I) => eq(r(val(I, 't')), [0.2, 0.5]));
  run('edge canny rejects thresholds of 1 or more', `E = edge(zeros(9), 'canny', 1);`, () => 0, 'Error using edge: Canny thresholds must satisfy 0 <= low <= high < 1.');
  run('edge unknown method', `E = edge(zeros(5), 'nope');`, () => 0, "Error using edge: Unknown method 'nope'. Use 'sobel', 'prewitt', 'roberts', 'log' or 'canny'.");
  run('edge rejects RGB input', `E = edge(zeros(5, 5, 3));`, () => 0, 'Error using edge: Expected input number 1, I, to be two-dimensional.');

  console.log('Phase 5d (geometric)');
  const cls = (I: Interp, n: string) => String.fromCharCode(...val(I, n));
  // ---- imresize ----
  // x2 bilinear of [0 10]: sample points u = .75 1.25 1.75 2.25; the first/last mirror onto the edge pixel -> [0 2.5 7.5 10]
  run('imresize bilinear upsampling', `B = imresize([0 10], [1 4], 'bilinear');`, (_o, I) => eq(val(I, 'B'), [0, 2.5, 7.5, 10]));
  // shrink [0 0 10 10]' to 2 with a kernel widened by 2: weights .125 .375 .375 .125 around u = 1.5 and 3.5 (indices mirrored)
  // out1 = 10*.125 = 1.25; out2 = 10*(.375 + .375 + .125) = 8.75. Without antialiasing: plain bilinear at u = 1.5, 3.5 -> [0; 10]
  run('imresize shrinks with anti-aliasing, and Antialiasing false turns it off', `A = [0 0 10 10]'; B = imresize(A, [2 1], 'bilinear'); C = imresize(A, [2 1], 'bilinear', 'Antialiasing', false);`, (_o, I) => eq([val(I, 'B'), val(I, 'C')], [[1.25, 8.75], [0, 10]]));
  // Keys cubic reproduces a ramp where all four neighbours exist: u = 2.25 and 2.75 -> 2.25, 2.75
  run('imresize bicubic reproduces a ramp in the interior', `B = imresize([1 2 3 4], [1 8], 'bicubic'); a = B(4); b = B(5);`, (_o, I) => eq([val(I, 'a'), val(I, 'b')], [[2.25], [2.75]]));
  // weights at x = 1.25 .25 -.75 -1.75: -.0703125 .8671875 .2265625 -.0234375 (sum 1); 255*(.2265625-.0234375) = 51.8 -> 52; mirrored: 255*(.8671875-.0703125) = 203.2 -> 203
  run('imresize bicubic on uint8 rounds and keeps the class', `B = imresize(uint8([0 0 255 255]), [1 8], 'bicubic'); c = class(B); v = [B(1) B(4) B(5)]; r = all(B <= 255);`, (_o, I) => eq([val(I, 'v'), cls(I, 'c'), val(I, 'r')], [[0, 52, 203], 'uint8', [1]]));
  run('imresize bicubic is the default and keeps constants', `B = imresize(5*ones(4), 2); s = size(B); m = [min(B(:)) max(B(:))];`, (_o, I) => eq([val(I, 's'), r(val(I, 'm'), 9)], [[8, 8], [5, 5]]));
  run('imresize output sizes: scale uses ceil, NaN keeps the aspect ratio', `a = size(imresize(ones(3), 1.5)); b = size(imresize(zeros(3, 6), [NaN 4])); c = size(imresize(zeros(3, 6), [4 NaN]));`, (_o, I) => eq([val(I, 'a'), val(I, 'b'), val(I, 'c')], [[5, 5], [2, 4], [4, 8]]));
  run('imresize nearest: x2 is pixel replication, x0.5 keeps the even rows and columns', `A = [1 2; 3 4]; B = imresize(A, 2, 'nearest'); K = kron(A, ones(2)); M = reshape(1:16, 4, 4)'; S = imresize(M, 0.5, 'nearest'); same = isequal(B, K);`, (_o, I) => eq([val(I, 'B'), val(I, 'same'), val(I, 'S')], [[1, 1, 3, 3, 1, 1, 3, 3, 2, 2, 4, 4, 2, 2, 4, 4], [1], [6, 14, 8, 16]]));
  // x0.5: output 1 samples at u = 1.5; the box kernel [-.5, .5) excludes pixel 1 (x = +.5) and includes pixel 2 (x = -.5), so rows/columns 2 and 4 stay: M(2,2) = 6, M(4,2) = 14, M(2,4) = 8, M(4,4) = 16
  // channel 1 [0 10] -> [0 2.5 7.5 10] -> uint8 [0 3 8 10]; channel 2 [20 40] -> [20 25 35 40]
  run('imresize works per channel', `A = cat(3, uint8([0 10]), uint8([20 40])); B = imresize(A, [1 4], 'bilinear'); s = size(B);`, (_o, I) => eq([val(I, 'B'), val(I, 's')], [[0, 3, 8, 10, 20, 25, 35, 40], [1, 4, 2]]));
  run('imresize keeps logical images logical', `B = imresize(logical([0 1]), [1 4], 'bilinear'); k = class(B);`, (_o, I) => eq([val(I, 'B'), cls(I, 'k')], [[0, 0, 1, 1], 'logical']));
  run('imresize rejects unknown methods', `B = imresize(1, 2, 'lanczos3');`, () => 0, "Error using imresize: Unsupported method or option 'lanczos3'. Methods: 'nearest', 'bilinear', 'bicubic'.");

  // ---- imrotate ----
  run('imrotate 90, 180 and -90 are exact', `A = [1 2; 3 4]; a = imrotate(A, 90); b = imrotate(A, 180); c = imrotate(A, -90); d = imrotate(A, 90, 'bicubic');`, (_o, I) => eq([val(I, 'a'), val(I, 'b'), val(I, 'c'), val(I, 'd')],
    [[2, 1, 4, 3], [4, 2, 3, 1], [3, 4, 1, 2], [2, 1, 4, 3]]));
  // 3x3 at 45 degrees, loose: ceil(3*sqrt2) = 5. Output pixel (dx,dy) is inside iff |dx|+|dy| <= 2 (a diamond of 13 pixels); rows have 1 3 5 3 1 pixels
  run('imrotate 45 loose gives a 5x5 diamond', `R = imrotate(ones(3), 45); s = size(R); n = sum(R(:)); r = sum(R, 2)';`, (_o, I) => eq([val(I, 's'), val(I, 'n'), val(I, 'r')], [[5, 5], [13], [1, 3, 5, 3, 1]]));
  // 1x3 row rotated 90 about its center and cropped: only the middle pixel stays inside the frame
  run('imrotate crop keeps the input size', `a = imrotate([1 2 3], 90, 'nearest', 'crop'); b = imrotate([1 2 3; 4 5 6; 7 8 9], 90, 'crop');`, (_o, I) => eq([val(I, 'a'), val(I, 'b')], [[0, 2, 0], [3, 2, 1, 6, 5, 4, 9, 8, 7]]));
  run('imrotate bilinear on a constant uint8 image', `A = uint8(7*ones(9)); B = imrotate(A, 30, 'bilinear', 'crop'); k = class(B); m = max(B(:)); c = B(5, 5);`, (_o, I) => eq([val(I, 'm'), val(I, 'c'), cls(I, 'k')], [[7], [7], 'uint8']));

  // ---- imtranslate ----
  const A3t = 'A = [1 2 3; 4 5 6; 7 8 9];';
  run('imtranslate integer shifts', `${A3t} R = imtranslate(A, [1 0]); D = imtranslate(A, [0 1]); U = imtranslate(A, [-1 -1]);`, (_o, I) => eq([val(I, 'R'), val(I, 'D'), val(I, 'U')],
    [[0, 0, 0, 1, 4, 7, 2, 5, 8], [0, 1, 4, 0, 2, 5, 0, 3, 6], [5, 8, 0, 6, 9, 0, 0, 0, 0]]));
  run('imtranslate FillValues and OutputView full', `${A3t} F = imtranslate(A, [1 0], 'FillValues', 9); G = imtranslate(A, [1 1], 'OutputView', 'full'); H = imtranslate([1 2; 3 4], [-1 0], 'OutputView', 'full');`, (_o, I) => eq([val(I, 'F'), val(I, 'G'), val(I, 'H')],
    [[9, 9, 9, 1, 4, 7, 2, 5, 8], [0, 0, 0, 0, 0, 1, 4, 7, 0, 2, 5, 8, 0, 3, 6, 9], [1, 3, 2, 4, 0, 0]]));
  // shift by half a pixel: out(x) = A(x - .5): [0, (0+10)/2, (10+21)/2 = 15.5] -> uint8 [0 5 16]
  run('imtranslate interpolates fractional shifts and keeps the class', `B = imtranslate(uint8([0 10 21]), [0.5 0]); k = class(B); N = imtranslate([1 2 3], [1.4 0], 'nearest');`, (_o, I) => eq([val(I, 'B'), cls(I, 'k'), val(I, 'N')], [[0, 5, 16], 'uint8', [0, 1, 2]]));

  // ---- loop results of lectures 6 and 8 equal the built-ins ----
  run('loop pixel replication == kron == imresize nearest', `A = [1 2; 3 4]; B = zeros(4, 4); for i = 1:2, for j = 1:2, B(2*i-1:2*i, 2*j-1:2*j) = A(i, j); end, end; ok = isequal(B, kron(A, ones(2))) & isequal(B, imresize(A, 2, 'nearest'));`, (_o, I) => eq(val(I, 'ok'), [1]));
  run('loop vertical flip == flipud, loop transpose == A\', imrotate 90 == rot90', `A = reshape(1:12, 3, 4); B = zeros(3, 4); for i = 1:3, B(i, :) = A(4-i, :); end; T2 = zeros(4, 3); for i = 1:3, for j = 1:4, T2(j, i) = A(i, j); end, end; a = isequal(B, flipud(A)); b = isequal(T2, A'); c = isequal(imrotate(A, 90), rot90(A));`, (_o, I) => eq([val(I, 'a'), val(I, 'b'), val(I, 'c')], [[1], [1], [1]]));

  console.log('Phase 5e (color and indexed images)');
  const rd = (a: number[], d: number) => r(a, d);
  // ---- hsv2rgb ----
  run('hsv2rgb primaries, h = 1 is red, m-by-3 colormaps', `a = hsv2rgb([0 1 1]); b = hsv2rgb([1 1 1]); c = hsv2rgb([0.5 0.5 1]); m = hsv2rgb([0 1 1; 1/3 1 1; 2/3 1 1]);`, (_o, I) => eq(
    [rd(val(I, 'a'), 6), rd(val(I, 'b'), 6), rd(val(I, 'c'), 6), rd(val(I, 'm'), 6)], [[1, 0, 0], [1, 0, 0], [0.5, 1, 1], [1, 0, 0, 0, 1, 0, 0, 0, 1]]));
  // h6 = 3, s = .5: (p, q, v) = (.5, 1, 1)
  run('hsv2rgb on an image, keeps single, rejects uint8', `H = cat(3, 0, 0, 1); a = size(hsv2rgb(H)); b = class(hsv2rgb(single([0 1 1]))); c = hsv2rgb(uint8([0 1 1]));`, () => 0, 'Error using hsv2rgb: Expected input number 1, HSV, to be one of these types: double, single');
  run('rgb2hsv then hsv2rgb reproduces the image', `rgb = uint8(cat(3, [255 0 128 10], [0 255 128 200], [0 0 128 77])); b = hsv2rgb(rgb2hsv(rgb)); d = max(abs(b(:) - reshape(im2double(rgb), [], 1)));`, (_o, I) => (val(I, 'd')[0] < 1 / 255 ? true : `max error ${val(I, 'd')[0]}`));
  // ---- ycbcr2rgb / ntsc2rgb ----
  // Y 16 -> black, 235 -> white; [126 128 128]: 110/219*255 = 128.08 -> 128
  run('ycbcr2rgb anchors on uint8', `a = ycbcr2rgb(uint8([16 128 128])); b = ycbcr2rgb(uint8([235 128 128])); c = ycbcr2rgb(uint8([126 128 128])); k = class(c);`, (_o, I) => eq([val(I, 'a'), val(I, 'b'), val(I, 'c'), cls(I, 'k')], [[0, 0, 0], [255, 255, 255], [128, 128, 128], 'uint8']));
  run('rgb2ycbcr then ycbcr2rgb round trips', `x = cat(3, [0.2 1], [0.5 0], [0.9 0.3]); y = ycbcr2rgb(rgb2ycbcr(x)); d = max(abs(y(:) - x(:))); u = cat(3, uint8([255 40]), uint8([0 200]), uint8([0 120])); v = ycbcr2rgb(rgb2ycbcr(u)); e = max(abs(double(v(:)) - double(u(:))));`, (_o, I) => (val(I, 'd')[0] < 1e-9 && val(I, 'e')[0] <= 3 ? true : `errors ${val(I, 'd')[0]}, ${val(I, 'e')[0]}`));
  // yiq [1 0 0] -> white; red from rgb2ntsc = [.299 .596 .211] -> [.9998 .0004 -.0008 clipped to 0]
  run('ntsc2rgb', `a = ntsc2rgb([1 0 0]); b = ntsc2rgb([0.299 0.596 0.211]);`, (_o, I) => eq([rd(val(I, 'a'), 6), rd(val(I, 'b'), 3)], [[1, 1, 1], [1, 0, 0]]));
  // ---- rgb2lab / lab2rgb (published sRGB D65 values: red 53.2408 80.0925 67.2032; green 87.7347 -86.1827 83.1793; #808080 L = 53.585) ----
  const near3 = (a: number[], b: number[], t: number) => a.every((v, i) => Math.abs(v - b[i]) <= t) || `got ${JSON.stringify(a)} expected ${JSON.stringify(b)}`;
  run('rgb2lab on known colors', `k = rgb2lab([0 0 0]); w = rgb2lab([1 1 1]); r1 = rgb2lab([1 0 0]); g = rgb2lab([0 1 0]); m = rgb2lab(uint8([128 128 128])); u = rgb2lab(uint8([255 0 0])); c = class(u);`, (_o, I) => {
    const t = [near3(val(I, 'k'), [0, 0, 0], 1e-9), near3(val(I, 'w'), [100, 0, 0], 0.01), near3(val(I, 'r1'), [53.2408, 80.0925, 67.2032], 0.01), near3(val(I, 'g'), [87.7347, -86.1827, 83.1793], 0.01), near3(val(I, 'm'), [53.585, 0, 0], 0.01), near3(val(I, 'u'), [53.2408, 80.0925, 67.2032], 0.01)];
    return t.find(x => x !== true) ?? eq(cls(I, 'c'), 'double');
  });
  run('lab2rgb inverts rgb2lab, OutputType uint8, image form', `x = [1 0 0; 0.2 0.5 0.9; 0.5 0.5 0.5]; y = lab2rgb(rgb2lab(x)); d = max(abs(y(:) - x(:))); u = lab2rgb([53.2408 80.0925 67.2032], 'OutputType', 'uint8'); i = lab2rgb(cat(3, 100, 0, 0)); s = size(i);`, (_o, I) => (val(I, 'd')[0] < 1e-5 ? eq([val(I, 'u'), rd(val(I, 'i'), 3), val(I, 's')], [[255, 0, 0], [1, 1, 1], [1, 1, 3]]) : `error ${val(I, 'd')[0]}`));
  // ---- indexed images ----
  // map rows: red, green, blue. X (double, 1-based) = [1 2; 3 1] -> column-major [1 3 2 1]: R = [1 0 0 1], G = [0 0 1 0], B = [0 1 0 0]
  run('ind2rgb: double is 1-based, uint8 is 0-based, indices clamp', `m = [1 0 0; 0 1 0; 0 0 1]; a = ind2rgb([1 2; 3 1], m); b = ind2rgb(uint8([0 1; 2 0]), m); c = ind2rgb([0 5], m); k = class(b); s = size(a);`, (_o, I) => eq(
    [val(I, 'a'), val(I, 'b'), val(I, 'c'), cls(I, 'k'), val(I, 's')], [[1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0], [1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0], [1, 0, 0, 0, 0, 1], 'double', [2, 2, 3]]));
  // round(I*(n-1)): [0 .5 1]*4 -> [0 2 4]; uint8 [0 51 255] -> [0 .2 1]*5 -> [0 1 5]; logical -> [0 63] with 64 levels; map = gray(n)
  run('gray2ind', `[a, m] = gray2ind([0 0.5 1], 5); b = gray2ind(uint8([0 51 255]), 6); c = gray2ind(logical([0 1])); d = gray2ind([0 1], 300); ka = class(a); kd = class(d); s = size(m);`, (_o, I) => eq(
    [val(I, 'a'), val(I, 'm').slice(0, 5), val(I, 's'), val(I, 'b'), val(I, 'c'), cls(I, 'ka'), cls(I, 'kd')], [[0, 2, 4], [0, 0.25, 0.5, 0.75, 1], [5, 3], [0, 1, 5], [0, 63], 'uint8', 'uint16']));
  // intensity .299 R + .587 G + .114 B: white = 1, red = .299 -> uint8 round(76.2) = 76
  run('ind2gray keeps the class of X', `m = [0 0 0; 1 1 1; 1 0 0]; a = ind2gray(uint8([0 1 2]), m); b = ind2gray([1 2 3], m); k = class(a);`, (_o, I) => eq([val(I, 'a'), rd(val(I, 'b'), 3), cls(I, 'k')], [[0, 255, 76], [0, 1, 0.299], 'uint8']));
  run('rgb2ind with a colormap picks the nearest entry', `A = cat(3, uint8([0 250]), uint8([0 250]), uint8([0 250])); [X, m] = rgb2ind(A, [0 0 0; 1 1 1]); k = class(X);`, (_o, I) => eq([val(I, 'X'), val(I, 'm'), cls(I, 'k')], [[0, 1], [0, 1, 0, 1, 0, 1], 'uint8']));
  run('rgb2ind(A, n) with two colors reproduces the image', `A = cat(3, uint8([255 0]), uint8([0 0]), uint8([0 255])); [X, m] = rgb2ind(A, 2); B = round(255*ind2rgb(X, m)); ok = isequal(B, double(A)); s = size(m);`, (_o, I) => eq([val(I, 'ok'), val(I, 's')], [[1], [2, 3]]));
  run('rgb2ind(A, tol) keeps only the colors that occur', `A = cat(3, uint8([255 0]), uint8([0 0]), uint8([0 255])); [X, m] = rgb2ind(A, 0.5); s = size(m);`, (_o, I) => eq(val(I, 's'), [2, 3]));
  run('rgb2ind rejects a bad second argument', `X = rgb2ind(zeros(2, 2, 3), 1.5);`, () => 0, 'Error using rgb2ind: The second argument must be an integer n >= 2, a tolerance in (0, 1] or an m-by-3 colormap.');
  // imshow(X, map): double indices are 1-based (MATLAB), integer classes 0-based
  run('imshow(X, map): double indices are 1-based', `imshow([1 2], [1 0 0; 0 0 1]);`, (_o, I) => eq(Array.from(I.figs.current().axes[0].items[0].rgb), [255, 0, 0, 0, 0, 255]));
  run('imshow(X, map): uint8 indices are 0-based', `imshow(uint8([0 1]), [1 0 0; 0 0 1]);`, (_o, I) => eq(Array.from(I.figs.current().axes[0].items[0].rgb), [255, 0, 0, 0, 0, 255]));

  console.log('Phase 5f (morphology and binary analysis)');
  const find1 = (x: number[]) => x.map((v, i) => (v ? i + 1 : 0)).filter(Boolean);
  // ---- strel ----
  run('strel square, rectangle, diamond, arbitrary', `a = strel('square', 3).Neighborhood; b = size(strel('rectangle', [2 3]).Neighborhood); d = strel('diamond', 2).Neighborhood; c = strel('arbitrary', [1 0; 1 1]).Neighborhood; k = class(a); h = size(strel('square', 3).Height);`, (_o, I) => eq(
    [val(I, 'a'), val(I, 'b'), val(I, 'd'), val(I, 'c'), cls(I, 'k'), val(I, 'h')],
    [new Array(9).fill(1), [2, 3], [0, 0, 1, 0, 0, 0, 1, 1, 1, 0, 1, 1, 1, 1, 1, 0, 1, 1, 1, 0, 0, 0, 1, 0, 0], [1, 1, 0, 1], 'logical', [3, 3]]));
  // disk(1) is a plus; exact disk(3, 0): rows have 1 5 5 7 5 5 1 pixels = 29
  run('strel disk', `a = strel('disk', 1).Neighborhood; b = strel('disk', 3, 0).Neighborhood; n = sum(b(:)); s = size(strel('disk', 5).Neighborhood); r = sum(b, 2)';`, (_o, I) => eq([val(I, 'a'), val(I, 'n'), val(I, 's'), val(I, 'r')], [[0, 1, 0, 1, 1, 1, 0, 1, 0], [29], [11, 11], [1, 5, 5, 7, 5, 5, 1]]));
  run('strel line: horizontal, vertical, 45 degrees, even length', `a = strel('line', 3, 0).Neighborhood; b = strel('line', 3, 90).Neighborhood; c = strel('line', 3, 45).Neighborhood; d = size(strel('line', 4, 0).Neighborhood);`, (_o, I) => eq(
    [val(I, 'a'), val(I, 'b'), val(I, 'c'), val(I, 'd')], [[1, 1, 1], [1, 1, 1], [0, 0, 1, 0, 1, 0, 1, 0, 0], [1, 4]]));
  run('getnhood and strel errors', `a = getnhood(strel('square', 2)); b = getnhood([1 0 2]); k = class(b);`, (_o, I) => eq([val(I, 'a'), val(I, 'b'), cls(I, 'k')], [[1, 1, 1, 1], [1, 0, 1], 'logical']));
  run('strel unknown shape', `s = strel('hexagon', 2);`, () => 0, "Error using strel: Unknown shape 'hexagon'. Use 'square', 'rectangle', 'diamond', 'disk', 'line' or 'arbitrary'.");

  // ---- imerode / imdilate / imopen / imclose ----
  const B5 = 'A = zeros(5); A(2:4, 2:4) = 1;';
  run('binary erosion of a 3x3 block leaves its center; dilation fills the 5x5', `${B5} E = imerode(A, ones(3)); D = imdilate(A, strel('square', 3)); e = find(E)'; d = sum(D(:));`, (_o, I) => eq([val(I, 'e'), val(I, 'd')], [[13], [25]]));
  run('erosion pads with the maximum: ones stay ones at the border', `E = imerode(ones(5), ones(3)); s = sum(E(:)); L = imerode(logical(ones(3)), ones(3)); t = sum(L(:));`, (_o, I) => eq([val(I, 's'), val(I, 't')], [[25], [9]]));
  // dilation reflects the element: ones at offset -1 move the pixel to the left; erosion (logical) pads with true
  run('dilation reflects the structuring element; erosion does not', `a = imdilate(uint8([0 1 0]), [1 0 0]); b = imerode(logical([0 1 0]), [1 0 0]); k = class(b);`, (_o, I) => eq([val(I, 'a'), val(I, 'b'), cls(I, 'k')], [[1, 0, 0], [1, 0, 1], 'logical']));
  // [5 1 7 3 9] with [1 1 1]: erode [1 1 1 3 3], dilate [5 7 7 9 9], open [1 1 3 3 3], close [5 5 7 7 9]
  run('grayscale erode, dilate, open and close keep the class', `A = uint8([5 1 7 3 9]); S = ones(1, 3); e = imerode(A, S); d = imdilate(A, S); o = imopen(A, S); c = imclose(A, S); k = class(c);`, (_o, I) => eq(
    [val(I, 'e'), val(I, 'd'), val(I, 'o'), val(I, 'c'), cls(I, 'k')], [[1, 1, 1, 3, 3], [5, 7, 7, 9, 9], [1, 1, 3, 3, 3], [5, 5, 7, 7, 9], 'uint8']));
  run('imopen removes an isolated pixel, imclose fills a one-pixel hole without growing', `${B5} A(1, 5) = 1; O = imopen(A, ones(3)); n = sum(O(:)); H = zeros(5); H(2:4, 2:4) = 1; H(3, 3) = 0; C = imclose(H, ones(3)); m = sum(C(:)); c = C(3, 3);`, (_o, I) => eq([val(I, 'n'), val(I, 'm'), val(I, 'c')], [[9], [9], [1]]));
  // heights [1 2 3] at offsets -1, 0, +1 on zeros: out(p) = max(A(p-b) + h(b)) over the pixels that exist: [2 3 3]
  run('grayscale dilation with a nonflat element', `d = imdilate([0 0 0], strel('arbitrary', [1 1 1], [1 2 3]));`, (_o, I) => eq(val(I, 'd'), [2, 3, 3]));
  run('morphology works per channel on RGB', `A = zeros(3, 3, 3, 'uint8'); A(2, 2, 2) = 9; D = imdilate(A, ones(3)); s = size(D); t = [sum(sum(D(:, :, 1))) sum(sum(D(:, :, 2)))];`, (_o, I) => eq([val(I, 's'), val(I, 't')], [[3, 3, 3], [0, 81]]));

  // ---- imfill ----
  run('imfill holes fills a closed ring only', `A = zeros(5); A(2:4, 2:4) = 1; A(3, 3) = 0; F = imfill(A, 'holes'); s = sum(F(:)); G = A; G(2, 3) = 0; H = imfill(G, 'holes'); t = sum(H(:)); L = imfill(logical(A), 'holes'); k = class(L);`, (_o, I) => eq([val(I, 's'), val(I, 't'), cls(I, 'k')], [[9], [7], 'logical']));
  // background is 4-connected: a hole whose neighbors touch the outside only diagonally is still a hole
  run('imfill uses 4-connected background', `A = zeros(5); A(2, 2:3) = 1; A(3, 2) = 1; A(3, 4) = 1; A(4, 3:4) = 1; F = imfill(A, 'holes'); c = F(3, 3); s = sum(F(:));`, (_o, I) => eq([val(I, 'c'), val(I, 's')], [[1], [7]]));
  run('imfill fills a grayscale basin', `A = [5 5 5; 5 1 5; 5 5 5]; F = imfill(A, 'holes'); s = sum(F(:)); B = [5 5 5; 5 1 5; 5 5 0]; G = imfill(B, 'holes'); c = G(2, 2);`, (_o, I) => eq([val(I, 's'), val(I, 'c')], [[45], [5]]));

  // ---- bwlabel / bwareaopen / regionprops ----
  // 8-connected: {(1,1),(1,2)} = 1, {(3,2),(4,3)} = 2, {(1,5),(2,5)} = 3, {(5,5)} = 4 (numbered by first pixel met column by column)
  const BW = 'A = [1 1 0 0 1; 0 0 0 0 1; 0 1 0 0 0; 0 0 1 0 0; 0 0 0 0 1];';
  run('bwlabel 8- and 4-connected', `${BW} [L8, n8] = bwlabel(A); [L4, n4] = bwlabel(A, 4); k = class(L8);`, (_o, I) => eq([val(I, 'L8'), val(I, 'n8'), val(I, 'L4'), val(I, 'n4'), cls(I, 'k')], [
    [1, 0, 0, 0, 0, 1, 0, 2, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 3, 3, 0, 0, 4], [4],
    [1, 0, 0, 0, 0, 1, 0, 2, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 4, 4, 0, 0, 5], [5], 'double']));
  run('bwareaopen removes components smaller than P', `${BW} a = sum(sum(bwareaopen(A, 2))); b = sum(sum(bwareaopen(A, 3))); c = sum(sum(bwareaopen(A, 2, 4))); k = class(bwareaopen(A, 2));`, (_o, I) => eq([val(I, 'a'), val(I, 'b'), val(I, 'c'), cls(I, 'k')], [[6], [0], [4], 'logical']));
  // centroid = (mean column, mean row); bounding box = [xmin-.5 ymin-.5 width height]
  run('regionprops Area, Centroid and BoundingBox of a logical image', `${BW} s = regionprops(logical(A), 'Area', 'Centroid', 'BoundingBox'); n = numel(s); a = [s.Area]; c1 = s(1).Centroid; c2 = s(2).Centroid; b2 = s(2).BoundingBox; b3 = s(3).BoundingBox; c4 = s(4).Centroid;`, (_o, I) => eq(
    [val(I, 'n'), val(I, 'a'), val(I, 'c1'), val(I, 'c2'), val(I, 'b2'), val(I, 'b3'), val(I, 'c4')], [[4], [2, 2, 2, 1], [1.5, 1], [2.5, 3.5], [1.5, 2.5, 2, 2], [4.5, 0.5, 1, 2], [5, 5]]));
  run('regionprops on a label matrix and with the default properties', `${BW} L = bwlabel(A); s = regionprops(L); a = s(4).Area; t = regionprops(L, 'Area'); f = isfield(t, 'Centroid'); g = isfield(s, 'BoundingBox');`, (_o, I) => eq([val(I, 'a'), val(I, 'f'), val(I, 'g')], [[1], [0], [1]]));
  run('regionprops rejects unsupported properties', `s = regionprops(logical([1 0]), 'Perimeter');`, () => 0, "Error using regionprops: Unsupported property 'perimeter'. Supported: Area, Centroid, BoundingBox.");
  void find1;
}

