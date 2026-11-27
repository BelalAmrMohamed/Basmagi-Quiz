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

/** Reference timings (ms, best of several runs on the machine the ceilings were set on) after Phase 6.1c. */
export const BENCH_REFERENCE_MS: Record<string, number> = {
  'L7 brightness loop (256x256x3)': 117,
  'L6 pixel-replication zoom 2x (128x128x3 -> 256x256x3)': 70,
  'L8 rotate-90 loop (256x256x3)': 58,
  'L8 slicing loop (256x256x3)': 31,
  'histeq + imhist (256x256)': 12.5,
  'L7 brightness loop (512x512x3)': 340,
  'L6 pixel-replication zoom 2x (256x256x3 -> 512x512x3)': 195,
  'L8 rotate-90 loop (512x512x3)': 242,
  'L8 slicing loop (512x512x3)': 58,
  'histeq + imhist (512x512)': 33,
};

/** Fixed pure-JS workload, so a slower machine raises the ceilings instead of failing the benchmark test. */
export function calibrateMs(): number {
  let best = Infinity;
  for (let r = 0; r < 5; r++) {
    const t0 = performance.now();
    const a = new Float64Array(1 << 20);
    let s = 0;
    for (let k = 0; k < 8; k++) for (let i = 0; i < a.length; i++) { a[i] = a[i] * 0.5 + i; s += a[i]; }
    if (s === -1) console.log(s);
    best = Math.min(best, performance.now() - t0);
  }
  return best;
}
/** calibrateMs() on the reference machine. */
export const CALIBRATION_REF_MS = 15;

/** Best of `runs` runs of one case, in ms. */
export function bestOf(c: BenchCase, runs = 3): number {
  let best = Infinity;
  for (let r = 0; r < runs; r++) {
    const I = new Interp(host);
    const t0 = performance.now();
    I.run(c.src);
    best = Math.min(best, performance.now() - t0);
  }
  return best;
}

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
