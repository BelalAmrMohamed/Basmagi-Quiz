import { Interp, Host } from '../src/index';

export interface LectureHelpers {
  run: (name: string, src: string, check: (o: string, I: Interp) => any, expectErr?: string) => void;
  todo: (name: string, phase: string) => void;
  val: (I: Interp, n: string) => number[];
  eq: (a: any, b: any) => true | string;
}

export function runLectureTests({ run, todo, val, eq }: LectureHelpers) {
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
  todo('L8 imhist(g) no-output + figure; histeq', 'Phase 4');
  todo('Book labs ch.1-4: peppers.png, edge(G,sobel), title, mean(I,3), imfinfo.BitDepth', 'Phase 5');
  todo('L9 simulated webcam motion detection (imaqhwinfo, videoinput, getsnapshot, pause, beep)', 'Phase 8');
}
