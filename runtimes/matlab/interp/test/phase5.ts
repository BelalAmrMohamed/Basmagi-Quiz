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
}

