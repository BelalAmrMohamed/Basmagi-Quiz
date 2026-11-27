// Phase 8 tests (simulated camera). Scene rules: static for the first 2 s of a 12 s cycle; then a rectangle crosses the frame.
import { Interp, Host } from '../src/index';
type Run = (name: string, src: string, check: (o: string, I: any) => any, expectErr?: string) => void;
type Ctx = { run: Run; val: (I: any, n: string) => number[]; eq: (a: any, b: any) => any };

export const LECTURE9 = `vid = videoinput('winvideo', 1, 'MJPG_640x480');
preview(vid);
T = 6; S = 0.5;
bg = rgb2gray(getsnapshot(vid));
while true
  g = rgb2gray(getsnapshot(vid));
  d = abs(double(g) - double(bg));
  if sum(d(:)) > T * numel(d) * S
    disp('Motion detected!'); beep;
  end
  pause(0.1);
end`;

/** Runs `src` with a fake clock that advances `stepMs` per reading; a print containing `stopOn` ends the run (the Stop button). */
function exec(src: string, stepMs = 5, stopOn = ''): { out: string; I: Interp; error: string } {
  let out = '', now = 0;
  const host: Host = { print: s => { out += s; if (stopOn && out.includes(stopOn)) throw new Error('STOP'); }, readImage: () => null, writeImage: () => {}, showImage: () => {}, newFigure: () => {}, figure: () => {} };
  const I = new Interp(host); I.clock = () => (now += stepMs);
  let error = ''; try { I.run(src); } catch (e: any) { error = e.message; }
  return { out, I, error };
}
const v = (I: Interp, n: string) => Array.from((I.vars.get(n) as any).data) as number[];

export function runPhase8(ctx: Ctx) {
  const { run, eq } = ctx;
  console.log('Phase 8 (simulated camera)');
  run('imaqhwinfo fields', `a = imaqhwinfo; b = imaqhwinfo('winvideo'); c = imaqhwinfo('winvideo', 1); n1 = a.InstalledAdaptors{1}; n2 = b.AdaptorName; d = b.DeviceIDs{1}; f = c.SupportedFormats; nf = numel(f); f2 = f{2}; dn = c.DeviceName;`,
    (_o, I) => eq([(I.vars.get('n1') as any).data.length, (I.vars.get('n2') as any).data.length, v(I, 'd'), v(I, 'nf'), String.fromCharCode(...v(I, 'f2'))], [8, 8, [1], [3], 'MJPG_640x480']));
  run('notice is printed once', `a = imaqhwinfo; b = imaqhwinfo('winvideo');`, o => eq(o.split('Camera is simulated').length - 1, 1));
  run('getsnapshot size follows the format', `v = videoinput('winvideo', 1, 'MJPG_1280x720'); I = getsnapshot(v); s = size(I); c = class(I); w = videoinput('winvideo',1); t = size(getsnapshot(w));`,
    (_o, I) => eq([v(I, 's'), v(I, 't'), String.fromCharCode(...v(I, 'c'))], [[720, 1280, 3], [480, 640, 3], 'uint8']));
  run('snapshots before 2 s are identical, differ later', `v = videoinput('winvideo', 1, 'MJPG_640x360'); a = getsnapshot(v); b = getsnapshot(v); same = isequal(a, b);`, (_o, I) => eq(v(I, 'same'), [1]));
  // Moving rectangle: at 6 s the rectangle is mid-frame; the gray difference sum exceeds T*numel.
  {
    const { I, error } = exec(`v = videoinput('winvideo', 1, 'MJPG_640x480'); bg = double(rgb2gray(getsnapshot(v))); pause(1.5); pause(1.5); pause(1.5); pause(1.5); g = double(rgb2gray(getsnapshot(v))); d = sum(abs(g(:) - bg(:))); lim = 6 * numel(g);`, 5);
    const ok = !error && v(I, 'd')[0] > v(I, 'lim')[0];
    console.log(ok ? '  ok   rectangle in view exceeds T*numel' : `  FAIL rectangle in view exceeds T*numel: ${error} d=${error ? '' : v(I, 'd')[0]}`);
    if (ok) (globalThis as any).__p8 = ((globalThis as any).__p8 ?? 0) + 1; else (globalThis as any).__p8f = 1;
  }
  {
    const { out, error } = exec(LECTURE9, 5, 'Motion detected!');
    const ok = error === 'STOP' && out.includes('Motion detected!') && out.split('Motion detected!').length - 1 === 1 && out.indexOf('Motion detected!') > out.indexOf('Camera is simulated');
    console.log(ok ? '  ok   Lecture 9 program emits Motion detected! once the rectangle appears' : `  FAIL Lecture 9 program: error=${error} out=${out.slice(0, 200)}`);
    if (!ok) (globalThis as any).__p8f = 1;
  }
  {
    // static scene: no detection during the first 1.5 s (fake clock only reaches that far)
    const { out } = exec(LECTURE9.replace('while true', 'for k = 1:12').replace(/pause\(0\.1\)/, 'pause(0.1)'), 5);
    const ok = !out.includes('Motion detected!');
    console.log(ok ? '  ok   no motion while the scene is static' : '  FAIL no motion while the scene is static');
    if (!ok) (globalThis as any).__p8f = 1;
  }
  run('webcam / snapshot aliases and start/stop/isrunning', `c = webcam; s = snapshot(c); z = size(s); v = videoinput('winvideo'); a = isrunning(v); start(v); b = isrunning(v); stop(v); d = isrunning(v); delete(v);`,
    (_o, I) => eq([v(I, 'z'), v(I, 'a'), v(I, 'b'), v(I, 'd')], [[480, 640, 3], [0], [1], [0]]));
  run('closepreview', `v = videoinput('winvideo'); preview(v); closepreview(v); closepreview;`, () => true);
}
