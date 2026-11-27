// Phase 8: simulated camera and video (Lecture 9). Real webcams are impossible in a synchronous worker (plan D5),
// so every device renders the same deterministic demo scene driven by the run's elapsed time.
import { V, S, T, mk, num, str, toStr, isT, isS, isStr, mkStruct, scalarOf } from './values';
import { Def, err } from './lib-common';
import type { Builtin } from './lib-common';

export const VIDEO_NOTICE = 'Camera is simulated (demo scene). Real webcams are not available in MLWeb.\nالكاميرا محاكاة (مشهد تجريبي). كاميرات الويب الحقيقية غير متاحة في MLWeb.\n';
const FORMATS = ['MJPG_640x360', 'MJPG_640x480', 'MJPG_1280x720'];
export const STATIC_SECONDS = 2, CYCLE_SECONDS = 12;

interface Dev { w: number; h: number; running: boolean; previewFig: number }
const devs = new WeakMap<object, Map<number, Dev>>();
const noticed = new WeakSet<object>();

/** One RGB frame (uint8, H x W x 3) of the demo scene at `elapsedSec` since the run started. */
export function sceneFrame(w: number, h: number, elapsedSec: number): T {
  const out = mk('uint8', [h, w, 3]), n = w * h;
  const phase = ((elapsedSec % CYCLE_SECONDS) + CYCLE_SECONDS) % CYCLE_SECONDS;
  const rw = Math.round(w * 0.3), rh = Math.round(h * 0.5), y0 = Math.round((h - rh) / 2);
  const x0 = phase < STATIC_SECONDS ? NaN : Math.round(-rw + ((phase - STATIC_SECONDS) / (CYCLE_SECONDS - STATIC_SECONDS)) * (w + rw));
  for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) {
    const p = y + h * x, inRect = x0 === x0 && x >= x0 && x < x0 + rw && y >= y0 && y < y0 + rh;
    if (inRect) { out.data[p] = 245; out.data[p + n] = 245; out.data[p + 2 * n] = 245; }
    else { out.data[p] = Math.round(40 + 60 * x / w); out.data[p + n] = Math.round(40 + 60 * y / h); out.data[p + 2 * n] = 90; }
  }
  return out;
}

export function registerVideo(B: Record<string, Builtin>, def: Def) {
  const table = (I: object) => { let m = devs.get(I); if (!m) devs.set(I, m = new Map()); return m; };
  const notice = (I: any) => { if (!noticed.has(I)) { noticed.add(I); I.host.print(VIDEO_NOTICE); } };
  const parseRes = (fmt: string): [number, number] => {
    const m = /(\d+)x(\d+)/i.exec(fmt); return m ? [+m[1], +m[2]] : [640, 480];
  };
  const cellOf = (xs: string[]): V => ({ cls: 'cell', dims: [1, xs.length], data: xs.map(x => str(x)) } as any);
  const mkObj = (I: any, kind: string, w: number, h: number, extra: Record<string, V> = {}): S => {
    const t = table(I), id = t.size + 1; t.set(id, { w, h, running: false, previewFig: 0 });
    const s = mkStruct([], [1, 1]);
    Object.assign(s.data[0], { Name: str(kind), VideoResolution: mk('double', [1, 2], Float64Array.of(w, h)), Running: str('off'), DeviceID_: num(id) }, extra);
    s.keys = Object.keys(s.data[0]); return s;
  };
  const devOf = (I: any, v: V | undefined, fn: string): Dev => {
    const id = v && isS(v) && v.data[0].DeviceID_ ? (v.data[0].DeviceID_ as T).data[0] : 0;
    return table(I).get(id) ?? err(`Error using ${fn}: Invalid or deleted camera object.`);
  };
  const adaptorCheck = (a: V[], fn: string) => { if (a[0] && isStr(a[0]) && toStr(a[0]).toLowerCase() !== 'winvideo') err(`Error using ${fn}: Unknown adaptor '${toStr(a[0])}'. Only 'winvideo' is available (simulated camera).`); };

  def('imaqhwinfo', (a, _n, I) => {
    notice(I);
    const s = mkStruct([], [1, 1]), r = s.data[0];
    if (!a.length) Object.assign(r, { InstalledAdaptors: cellOf(['winvideo']) });
    else if (a.length === 1) { adaptorCheck(a, 'imaqhwinfo'); Object.assign(r, { AdaptorName: str('winvideo'), DeviceIDs: { cls: 'cell', dims: [1, 1], data: [num(1)] } as any }); }
    else { adaptorCheck(a, 'imaqhwinfo'); Object.assign(r, { DeviceName: str('Simulated Camera'), DefaultFormat: str(FORMATS[1]), SupportedFormats: cellOf(FORMATS), DeviceID: num(1) }); }
    s.keys = Object.keys(r); return [s];
  });
  def('videoinput', (a, _n, I) => {
    notice(I); adaptorCheck(a, 'videoinput');
    const fmt = a[2] && isStr(a[2]) ? toStr(a[2]) : FORMATS[1], [w, h] = parseRes(fmt);
    return [mkObj(I, 'Simulated Camera', w, h, { VideoFormat: str(fmt) })];
  });
  def('webcam', (_a, _n, I) => { notice(I); const o = mkObj(I, 'Simulated Camera', 640, 480); table(I).get((o.data[0].DeviceID_ as T).data[0])!.running = true; return [o]; });
  const frame = (I: any, v: V | undefined, fn: string): T => {
    notice(I);
    const d = devOf(I, v, fn), img = sceneFrame(d.w, d.h, (I.clock() - I.runStartMs) / 1000);
    if (d.previewFig) {
      const prev = I.figs.curId; B.figure([num(d.previewFig)], 0, I); B.imshow([img], 0, I); if (prev && prev !== d.previewFig) B.figure([num(prev)], 0, I);
    }
    return img;
  };
  def('getsnapshot', (a, _n, I) => [frame(I, a[0], 'getsnapshot')]);
  def('snapshot', (a, _n, I) => [frame(I, a[0], 'snapshot')]);
  def('preview', (a, _n, I) => {
    notice(I); const d = devOf(I, a[0], 'preview');
    if (!d.previewFig) { B.figure([], 0, I); d.previewFig = I.figs.curId; }
    B.imshow([sceneFrame(d.w, d.h, (I.clock() - I.runStartMs) / 1000)], 0, I); return [];
  });
  def('closepreview', (a, _n, I) => {
    const m = table(I);
    for (const d of (a.length ? [devOf(I, a[0], 'closepreview')] : [...m.values()])) if (d.previewFig) { B.close([num(d.previewFig)], 0, I); d.previewFig = 0; }
    return [];
  });
  const setRun = (name: string, on: boolean) => def(name, (a, _n, I) => { devOf(I, a[0], name).running = on; return []; });
  setRun('start', true); setRun('stop', false);
  def('isrunning', (a, _n, I) => [num(+devOf(I, a[0], 'isrunning').running, 'logical')]);
  const prevDelete = B.delete;
  def('delete', (a, n, I) => {
    if (a[0] && isS(a[0]) && a[0].data[0]?.DeviceID_) { const d = devOf(I, a[0], 'delete'); if (d.previewFig) B.close([num(d.previewFig)], 0, I); table(I).delete((a[0].data[0].DeviceID_ as T).data[0]); return []; }
    return prevDelete ? prevDelete(a, n, I) : err("Unrecognized function or variable 'delete'.");
  });
  void scalarOf; void isT;
}
