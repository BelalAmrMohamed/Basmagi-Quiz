import { Interp, MatlabError } from '../../../packages/interp/src/index';
import type { Host, RawImage } from '../../../packages/interp/src/index';

const files = new Map<string, RawImage>();
const post = (m: any) => (self as any).postMessage(m);
const extOf = (n: string) => (n.split('.').pop() || 'png').toLowerCase();

const host: Host = {
  print: s => post({ t: 'print', s }),
  warn: s => post({ t: 'warn', s }),
  readImage: p => files.get(p) ?? [...files].find(([k]) => k.toLowerCase() === p.toLowerCase())?.[1] ?? null,
  writeImage(p, img) {
    const base = p.split(/[\\/]/).pop()!;
    const raw: RawImage = { ...img, bitDepth: 8 * img.channels, format: extOf(base) === 'jpg' ? 'jpg' : extOf(base), fileSize: img.data.length,
      colorType: img.channels === 1 ? 'grayscale' : 'truecolor', filename: '/vfs/' + base, fileModDate: new Date().toUTCString() };
    files.set(base, raw); post({ t: 'wrote', name: base, img: raw });
  },
  showImage: (img, o) => post({ t: 'img', w: img.width, h: img.height, rgb: img.rgb, tool: o.tool }),
  newFigure: () => post({ t: 'fig' }),
  clc: () => post({ t: 'clc' }),
  maxPrintElements: 3000,
};
let I = new Interp(host);

function summary() {
  const out: any[] = [];
  for (const [name, v] of I.vars as Map<string, any>) {
    if (v && Array.isArray(v.dims)) out.push({ name, size: v.dims.join('x'), cls: v.cls, bytes: v.data.length * (v.cls === 'double' || v.cls === 'cell' ? 8 : v.cls === 'char' ? 2 : 1) });
    else out.push({ name, size: '1x1', cls: 'struct', bytes: 0 });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

self.onmessage = (e: MessageEvent) => {
  const m = e.data;
  if (m.t === 'putFile') files.set(m.name, m.img);
  else if (m.t === 'delFile') files.delete(m.name);
  else if (m.t === 'reset') { I = new Interp(host); post({ t: 'vars', vars: [] }); }
  else if (m.t === 'run') {
    let error: string | null = null;
    try { I.run(m.src); }
    catch (err: any) { error = err instanceof MatlabError ? err.message : 'Internal error: ' + (err?.message ?? String(err)); }
    post({ t: 'done', id: m.id, error, vars: summary() });
  }
};
post({ t: 'ready' });
