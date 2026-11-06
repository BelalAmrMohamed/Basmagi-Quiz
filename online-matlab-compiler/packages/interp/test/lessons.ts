import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Interp, Host, RawImage } from '../src/index';
// @ts-ignore
import { loadLessons } from '../../../apps/web/lessons.mjs';
const W = path.join(import.meta.dirname, '../../../apps/web');
const assets = JSON.parse(readFileSync(path.join(W, 'assets/assets.json'), 'utf8'));
const lessons = loadLessons(path.join(W, 'lessons'));
let bad = 0;
for (const L of lessons) {
  const files = new Map<string, RawImage>();
  for (const [n, a] of Object.entries<any>(assets)) { const { b64, ...r } = a; files.set(n.toLowerCase(), { ...r, data: new Uint8Array(Buffer.from(b64, 'base64')) }); }
  let out = '', imgs = 0;
  const host: Host = { print: s => { out += s; }, warn: s => { out += '[warn] ' + s; },
    readImage: p => files.get(p.toLowerCase()) ?? null,
    writeImage: (p, img) => { files.set(p.toLowerCase(), { ...img, bitDepth: 8 * img.channels, format: 'png', fileSize: img.data.length, colorType: img.channels === 1 ? 'grayscale' : 'truecolor', filename: '/vfs/' + p, fileModDate: '' } as RawImage); },
    showImage: () => { imgs++; }, newFigure: () => {}, maxPrintElements: 3000 };
  const I = new Interp(host); const t0 = performance.now(); const errs: string[] = [];
  L.cells.forEach((c: any, i: number) => { if (c.type !== 'code') return;
    if (/^% your answer here\s*$/.test(c.src)) return;
    try { I.run(c.src); } catch (e: any) { errs.push(`cell ${i}: ${e.message}\n    ${c.src.split('\n')[0].slice(0, 70)}`); } });
  console.log(`${errs.length ? 'FAIL' : 'ok  '} ${L.id}: ${L.cells.length} cells, ${imgs} images, ${(performance.now() - t0).toFixed(0)} ms`);
  for (const e of errs) console.log('   ' + e);
  bad += errs.length;
}
process.exit(bad ? 1 : 0);
