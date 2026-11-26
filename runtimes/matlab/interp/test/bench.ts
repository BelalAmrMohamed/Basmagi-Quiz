import { readFileSync, existsSync } from 'node:fs';
import { PNG } from 'pngjs';
import path from 'node:path';
import { Interp, Host, RawImage } from '../src/index';

const A = path.join(import.meta.dirname, 'assets');
const host: Host = {
  print: () => {},
  warn: () => {},
  readImage(p) {
    const base = path.basename(p);
    const fp = path.join(A, base);
    if (!existsSync(fp)) return null;
    const png = PNG.sync.read(readFileSync(fp));
    const gray = /gray/.test(base);
    const ch = gray ? 1 : 3;
    const d = new Uint8Array(png.width * png.height * ch);
    for (let i = 0; i < png.width * png.height; i++) {
      for (let k = 0; k < ch; k++) d[i * ch + k] = png.data[i * 4 + (gray ? 0 : k)];
    }
    return {
      width: png.width, height: png.height, channels: ch as 1 | 3, data: d,
      bitDepth: 8 * ch, format: 'png', fileSize: 0,
      colorType: gray ? 'grayscale' : 'truecolor', filename: '/vfs/' + base,
    };
  },
  writeImage: () => {},
  showImage: () => {},
  newFigure: () => {},
  maxPrintElements: 3000,
};

export interface BenchCase {
  name: string;
  size: number;
  src: string;
}

export const BENCH_CASES: BenchCase[] = [256, 512].flatMap((N) => [
  {
    name: `L7 brightness loop (${N}x${N}x3)`,
    size: N,
    src: `a = uint8(mod(reshape(1:${N * N * 3}, ${N}, ${N}, 3), 256));
b = zeros(${N}, ${N}, 3, 'uint8');
for i = 1:${N}
  for j = 1:${N}
    b(i,j,:) = a(i,j,:) + 50;
  end
end`,
  },
  {
    name: `L6 pixel-replication zoom 2x (${N / 2}x${N / 2}x3 -> ${N}x${N}x3)`,
    size: N,
    src: `H = ${N / 2}; W = ${N / 2};
a = uint8(mod(reshape(1:${(N / 2) * (N / 2) * 3}, H, W, 3), 256));
b = zeros(${N}, ${N}, 3, 'uint8');
for i = 1:H
  for j = 1:W
    b(2*i-1, 2*j-1, :) = a(i,j,:);
    b(2*i-1, 2*j,   :) = a(i,j,:);
    b(2*i,   2*j-1, :) = a(i,j,:);
    b(2*i,   2*j,   :) = a(i,j,:);
  end
end`,
  },
  {
    name: `L8 rotate-90 loop (${N}x${N}x3)`,
    size: N,
    src: `a = uint8(mod(reshape(1:${N * N * 3}, ${N}, ${N}, 3), 256));
b = zeros(${N}, ${N}, 3, 'uint8');
for i = 1:${N}
  for j = 1:${N}
    b(j, ${N} - i + 1, :) = a(i, j, :);
  end
end`,
  },
  {
    name: `L8 slicing loop (${N}x${N}x3)`,
    size: N,
    src: `a = uint8(mod(reshape(1:${N * N * 3}, ${N}, ${N}, 3), 256));
for i = 1:${N}
  for j = 1:${N}
    if i <= 20 && j <= 20
      a(i,j,:) = [0, 0, 255];
    end
  end
end`,
  },
  {
    name: `histeq + imhist (${N}x${N})`,
    size: N,
    src: `g = uint8(mod(reshape(1:${N * N}, ${N}, ${N}), 256));
j = histeq(g);
h = imhist(j);`,
  },
]);

export function runBench(): Record<string, number> {
  const results: Record<string, number> = {};
  for (const c of BENCH_CASES) {
    const I = new Interp(host);
    const t0 = performance.now();
    I.run(c.src);
    const ms = performance.now() - t0;
    results[c.name] = ms;
    console.log(`${c.name.padEnd(52)} ${ms.toFixed(1)} ms`);
  }
  return results;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  runBench();
}
