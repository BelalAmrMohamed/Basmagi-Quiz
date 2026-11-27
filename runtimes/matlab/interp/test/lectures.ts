import { Interp, Host } from '../src/index';

export interface LectureHelpers {
  run: (name: string, src: string, check: (o: string, I: Interp) => any, expectErr?: string) => void;
  todo: (name: string, phase: string) => void;
  val: (I: Interp, n: string) => number[];
  eq: (a: any, b: any) => true | string;
  /** Images and figures posted by the current run. */
  lecture: { shown: any[]; plots: { id: number; spec: any }[] };
}

export function runLectureTests({ run, todo, val, eq, lecture }: LectureHelpers) {
  console.log('Lectures 5-9 & Book labs');

  // Lecture 5: gray conversion methods + binary thresholding
  run('L5 gray methods (average, lightness, weighted) on pepper.png', `
    a = imread('pepper.png');
    [r, c, ~] = size(a);
    b1 = zeros(r, c, 'uint8');
    b2 = zeros(r, c, 'uint8');
    b3 = zeros(r, c, 'uint8');
    for i = 1:r
      for j = 1:c
        b1(i,j) = a(i,j,1)/3 + a(i,j,2)/3 + a(i,j,3)/3;
        b2(i,j) = (max(a(i,j,:))/2) + (min(a(i,j,:))/2);
        b3(i,j) = a(i,j,1)*0.3 + a(i,j,2)*0.59 + a(i,j,3)*0.11;
      end
    end
    sz = [size(b1); size(b2); size(b3)];
    p1 = b1(1,1); p2 = b2(1,1); p3 = b3(1,1);
  `, (_o, I) => {
    const sz = val(I, 'sz');
    return eq(sz, [200, 200, 200, 200, 200, 200]) === true && val(I, 'p1')[0] >= 0 && val(I, 'p2')[0] >= 0 && val(I, 'p3')[0] >= 0;
  });

  // Lecture 6: pixel replication and zero-order hold zoom on Test1.png & GrayTest1.png
  run('L6 pixel-replication zoom on Test1.png with slice assign & imwrite round-trip', `
    function z = zoomMethod_1(img, f)
      [r, c, ch] = size(img);
      z = zeros(r*f, c*f, ch, 'uint8');
      for i = 1:r
        for j = 1:c
          for ki = 0:f-1
            for kj = 0:f-1
              z((i-1)*f+1+ki, (j-1)*f+1+kj, :) = img(i, j, :);
            end
          end
        end
      end
      imtool(z);
    end
    a = imread('Test1.png');
    b = zoomMethod_1(a, 2);
    imwrite(b, 'l6_zoom.png');
    rt = imread('l6_zoom.png');
    diffSum = sum(abs(double(b(:)) - double(rt(:))));
    sz = size(b);
    p1 = [a(1,1,1) b(1,1,1) b(2,2,1)];
  `, (_o, I) => eq([val(I, 'sz'), val(I, 'diffSum'), val(I, 'p1')[0] === val(I, 'p1')[1] && val(I, 'p1')[1] === val(I, 'p1')[2]], [[400, 400, 3], [0], true]));

  // Lecture 7: brightness, contrast, negative on uint8
  run('L7 brightness, contrast, negative loops on Test1.png', `
    a = imread('Test1.png');
    [r, c, ch] = size(a);
    bright = zeros(r, c, ch, 'uint8');
    contrast = zeros(r, c, ch, 'uint8');
    neg = zeros(r, c, ch, 'uint8');
    for i = 1:r
      for j = 1:c
        bright(i,j,:) = a(i,j,:) + 50;
        contrast(i,j,:) = a(i,j,:) * 1.5;
        neg(i,j,:) = 255 - a(i,j,:);
      end
    end
    dBright = sum(abs(double(bright(:)) - double(uint8(double(a(:)) + 50))));
    dNeg = sum(abs(double(neg(:)) - double(255 - a(:))));
    sz = size(bright);
  `, (_o, I) => eq([val(I, 'dBright'), val(I, 'dNeg'), val(I, 'sz')], [[0], [0], [200, 200, 3]]));

  // Lecture 8: auto-growing arrays, transpose of channel slice, &&, slicing on Test3/Test4/Test5
  run('L8 auto-growing B, A(:,:,1) transpose, && slicing on Test3/4/5', `
    A = imread('Test3.png');
    T = A(:,:,1)';
    B(2,3,:) = A(2,3,:);
    K = imread('Test4.png');
    for i = 1:20
      for j = 1:20
        if i <= 10 && j <= 10
          K(i,j,:) = [0, 0, 255];
        end
      end
    end
    t5 = imread('Test5.png');
    p5 = imread('pepper.png');
    d5 = sum(abs(double(t5(:)) - double(p5(:))));
    szT = size(T);
    szB = size(B);
    px = [K(5,5,1) K(5,5,2) K(5,5,3)];
  `, (_o, I) => eq([val(I, 'd5'), val(I, 'szT'), val(I, 'szB'), val(I, 'px')], [[0], [200, 200], [2, 3, 3], [0, 0, 255]]));

  // Pending Phase 4 / 5 / 8 lecture items
  // 2x3 image: levels 50, 100, 150 appear 3, 2 and 1 times
  run('L8 imhist(g) no-output + figure; histeq', `
    g = uint8([50 50 100; 50 100 150]);
    figure; imhist(g)
    h = histeq(g);
    figure; imhist(h)
    figure; imshow(h)
    [c, x] = imhist(g);
    n = [c(51) c(101) c(151) sum(c) numel(x)];
    m = [h(1,1) < h(1,3), h(1,3) < h(2,3), h(2,3)];
  `, (o, I) => {
    const p = lecture.plots, bars = p[0]?.spec.axes[0].items[0];
    if (o !== '' || p.length !== 2 || lecture.shown.length !== 1) return `output=${JSON.stringify(o)} plots=${p.length} images=${lecture.shown.length}`;
    return eq([p.map((q: any) => q.id), lecture.shown[0].fig, bars.t, bars.x.length, [bars.y[50], bars.y[100], bars.y[150]], val(I, 'n'), val(I, 'm')], [[1, 2], 3, 'bar', 256, [3, 2, 1], [3, 2, 1, 6, 256], [1, 1, 255]]);
  });
  run('L8 imhist and histeq on testgray.png, each in its own figure', `
    g = imread('testgray.png');
    imshow(g), figure, imhist(g)
    figure, imhist(histeq(g))
  `, () => eq([lecture.shown.map((s: any) => s.fig), lecture.plots.map((q: any) => q.id), lecture.plots.map((q: any) => q.spec.axes[0].items[0].y.reduce((a: number, b: number) => a + b, 0))], [[1], [2, 3], [40000, 40000]]));
  // Book labs, chapter 1: peppers.png (aliased to the course picture) -> rgb2gray -> edge(G,'sobel') -> three figures with titles
  run('Book labs ch.1-4: peppers.png, rgb2gray, edge(G,sobel), figure/imshow/title, mean(I,3), imfinfo.BitDepth', `
    I = imread('peppers.png');
    figure; imshow(I); title('Original');
    G = rgb2gray(I);
    figure; imshow(G); title('Gray');
    E = edge(G, 'sobel');
    figure; imshow(E); title('Sobel edges');
    M = mean(I, 3);
    info = imfinfo('peppers.png');
    bd = info.BitDepth;
    sg = size(G); se = size(E); sm = size(M); ne = nnz(E); ce = strcmp(class(E), 'logical');
  `, (o, I) => {
    // title() turns an image figure into a plot figure with an image item, so the three figures arrive as plots
    const pl = lecture.plots;
    if (o !== '') return `unexpected output ${JSON.stringify(o)}`;
    if (pl.length !== 3) return `expected 3 figures, got ${pl.length} (images posted: ${lecture.shown.length})`;
    const items = pl.map((q: any) => q.spec.axes[0].items[0]), [w, h] = [items[0].w, items[0].h];
    return eq([pl.map((q: any) => q.id), pl.map((q: any) => q.spec.axes[0].title), items.map((i: any) => i.t), items.every((i: any) => i.w === w && i.h === h), val(I, 'sg'), val(I, 'se'), val(I, 'sm'), val(I, 'bd'), val(I, 'ce'), val(I, 'ne')[0] > 0],
      [[1, 2, 3], ['Original', 'Gray', 'Sobel edges'], ['image', 'image', 'image'], true, [h, w], [h, w], [h, w], [24], [1], true]);
  });
  // L9 simulated webcam motion detection: see phase8.ts
}
