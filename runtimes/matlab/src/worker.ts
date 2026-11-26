// =============================================================================
// runtimes/matlab/src/worker.ts
// Web Worker: runs the MATLAB-subset interpreter off the main thread.
// Built to public/assets/notebook-runtime/worker.js and loaded by engine.ts.
// Messages in : putFile | delFile | reset | run
// Messages out: ready | print | warn | img | fig | clc | wrote | vars | done
// =============================================================================
import { Interp, MatlabError } from '../interp/src/index';
import type { Host, RawImage } from '../interp/src/index';

const files = new Map<string, RawImage>();
const post = (m: any) => (self as any).postMessage(m);
const extOf = (n: string) => (n.split('.').pop() || 'png').toLowerCase();

const IMAGE_ALIASES: Record<string, string> = {
  'peppers.png': 'pepper.png',
  'test5.png': 'pepper.png',
};
const lookupFile = (p: string): RawImage | null =>
  files.get(p) ?? [...files].find(([k]) => k.toLowerCase() === p.toLowerCase())?.[1] ?? null;

const host: Host = {
  print: (s) => post({ t: 'print', s }),
  warn: (s) => post({ t: 'warn', s }),
  readImage: (p) => {
    const direct = lookupFile(p);
    if (direct) return direct;
    const alias = IMAGE_ALIASES[p.toLowerCase()];
    return alias ? lookupFile(alias) : null;
  },
  writeImage(p, img) {
    const base = p.split(/[\\/]/).pop()!;
    const raw: RawImage = {
      ...img, bitDepth: 8 * img.channels, format: extOf(base) === 'jpg' ? 'jpg' : extOf(base), fileSize: img.data.length,
      colorType: img.channels === 1 ? 'grayscale' : 'truecolor', filename: '/vfs/' + base, fileModDate: new Date().toUTCString(),
    };
    files.set(base, raw);
    post({ t: 'wrote', name: base, img: raw });
  },
  showImage: (img, o) => post({ t: 'img', w: img.width, h: img.height, rgb: img.rgb, tool: o.tool, name: o.name }),
  newFigure: () => post({ t: 'fig' }),
  clc: () => post({ t: 'clc' }),
  maxPrintElements: 3000,
};
let interp = new Interp(host);

function summary() {
  const out: any[] = [];
  for (const [name, v] of interp.vars as Map<string, any>) {
    if (!v) continue;
    if (v.cls === 'struct') out.push({ name, size: (v.dims ?? [1, 1]).join('x'), cls: 'struct', bytes: 0 });
    else if (v.cls === 'function_handle') out.push({ name, size: '1x1', cls: 'function_handle', bytes: 0 });
    else if (Array.isArray(v.dims)) out.push({ name, size: v.dims.join('x'), cls: v.cls, bytes: v.data.length * (v.cls === 'double' || v.cls === 'cell' ? 8 : v.cls === 'char' ? 2 : 1) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

self.onmessage = (e: MessageEvent) => {
  const m = e.data;
  if (m.t === 'putFile') files.set(m.name, m.img);
  else if (m.t === 'delFile') files.delete(m.name);
  else if (m.t === 'reset') { interp = new Interp(host); post({ t: 'vars', vars: [] }); }
  else if (m.t === 'run') {
    let error: string | null = null;
    try { interp.run(m.src); }
    catch (err: any) { error = err instanceof MatlabError ? err.message : 'Internal error: ' + (err?.message ?? String(err)); }
    post({ t: 'done', id: m.id, error, vars: summary() });
  }
};
post({ t: 'ready' });
