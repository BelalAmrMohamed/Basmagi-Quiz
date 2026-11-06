import { readFileSync, existsSync, writeFileSync, statSync } from 'node:fs';
import { PNG } from 'pngjs';
import { Interp, Host, RawImage } from '../src/index';
import path from 'node:path';

const A = path.join(import.meta.dirname, 'assets');
let out = '', shown: any[] = [], figs = 0, written: Record<string, any> = {}, warns: string[] = [];
const host: Host = {
  print: s => { out += s; },
  warn: s => warns.push(s),
  readImage(p) {
    const base = path.basename(p); const fp = path.join(A, base);
    if (written[base]) { const w = written[base]; return { ...w, filename: '/vfs/' + base, fileSize: 0, format: 'png', bitDepth: 8 * w.channels, colorType: w.channels === 1 ? 'grayscale' : 'truecolor' } as RawImage; }
    if (p !== base || !existsSync(fp)) return null;
    const png = PNG.sync.read(readFileSync(fp)); const gray = /gray/.test(base);
    const ch = gray ? 1 : 3, d = new Uint8Array(png.width * png.height * ch);
    for (let i = 0; i < png.width * png.height; i++) for (let k = 0; k < ch; k++) d[i * ch + k] = png.data[i * 4 + (gray ? 0 : k)];
    return { width: png.width, height: png.height, channels: ch as 1 | 3, data: d, bitDepth: 8 * ch, format: 'png', fileSize: statSync(fp).size, colorType: gray ? 'grayscale' : 'truecolor', filename: '/vfs/' + base, fileModDate: '02-Nov-2026 10:00:00' };
  },
  writeImage(p, img) { written[path.basename(p)] = img; },
  showImage(img, o) { shown.push({ w: img.width, h: img.height, tool: o.tool, fig: figs }); },
  newFigure() { figs++; },
  maxPrintElements: 3000,
};
let pass = 0, fail = 0;
function run(name: string, src: string, check: (o: string, I: Interp) => any, expectErr?: string) {
  out = ''; shown = []; figs = 0; warns = [];
  const I = new Interp(host), t0 = performance.now();
  let res: any;
  try { I.run(src); res = expectErr ? 'no error thrown' : check(out, I); } catch (e: any) { res = expectErr ? (e.message === expectErr ? true : `wrong error: ${e.message}`) : 'THREW: ' + e.message; }
  const ms = (performance.now() - t0).toFixed(0);
  if (res === true) { pass++; console.log(`  ok   ${name} (${ms} ms)`); } else { fail++; console.log(`  FAIL ${name}: ${res}\n--- output ---\n${out.slice(0, 600)}`); }
}
const val = (I: Interp, n: string) => Array.from((I.vars.get(n) as any).data);
const eq = (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b) || `got ${JSON.stringify(a)} expected ${JSON.stringify(b)}`;

console.log('Core language');
run('uint8 saturation', `a = uint8(200); b = a + 100; c = a - 250; d = uint8(7)/2;`, (_o, I) => eq([val(I, 'b'), val(I, 'c'), val(I, 'd')], [[255], [0], [4]]));
run('average-method trap (sum saturates before /3)', `a = uint8([200 200 200]); s = (a(1)+a(2)+a(3))/3; ok = a(1)/3+a(2)/3+a(3)/3;`, (_o, I) => eq([val(I, 's'), val(I, 'ok')], [[85], [201]]));
run('matrix literal whitespace', `x = [1 -2 3]; y = [1 - 2]; z = [1, 2; 3, 4]'; w = x(end:-1:1);`, (_o, I) => eq([val(I, 'x'), val(I, 'y'), val(I, 'z'), val(I, 'w')], [[1, -2, 3], [-1], [1, 2, 3, 4], [3, -2, 1]]));
run('display formats', `x = 5\ny = [1 2 3]\nz = uint8([1 2;30 4])\ns = 'hello'\nw = 0.5\n`, o => eq(o, "x = 5\ny =\n\n     1     2     3\n\nz =\n\n   1   2\n  30   4\n\ns = hello\nw = 0.5000\n"));
run('semicolon / comma rules', `a = 1; b = 2, c = 3;`, o => eq(o, 'b = 2\n'));
run('functions + multiple outputs', `function [s,p] = sp(a,b)\n s=a+b; p=a*b;\nend\n[q,r] = sp(3,4);`, (_o, I) => eq([val(I, 'q'), val(I, 'r')], [[7], [12]]));
run('if/while/for/break', `t=0; for i=1:10, if mod(i,2)==0, continue; end, t=t+i; if i>6, break; end, end; k=0; while k<3, k=k+1; end`, (_o, I) => eq([val(I, 't'), val(I, 'k')], [[16], [3]]));
run('growth + range assignment', `A = zeros(4,4,'uint8'); A(2:3,2:3) = 9; B(2,3) = 5; C = []; C(3) = 1;`, (_o, I) => eq([val(I, 'A'), val(I, 'B'), val(I, 'C')], [[0,0,0,0,0,9,9,0,0,9,9,0,0,0,0,0], [0,0,0,0,0,5], [0,0,1]]));

run('index-out-of-range message matches MATLAB', `x = [1 2 3]; y = x(5);`, () => 0, 'Index exceeds the number of array elements. Index must not exceed 3.');
run('undefined variable message', `y = nothere + 1;`, () => 0, "Unrecognized function or variable 'nothere'.");

console.log('Section 1 (real files)');
const sec = readFileSync(path.join(A, 'Section_1.m'), 'utf8').replace(/\r\n/g, '\n');
// un-comment exactly the example-code lines of the lecture script
const CODE = /^%\s*((?:x|y) = imread\(|imshow\(|figure,|imtool\(|size\(|imfinfo\(|imwrite\()(.*)$/;
const lines = sec.split('\n').map(l => { const m = CODE.exec(l); return m ? m[1] + m[2] : l; });
const full = lines.join('\n');
run('script as written in class: imshow(a) uses undefined a -> same error MATLAB gives', full, () => 0, "Unrecognized function or variable 'a'.");
const fixed = full.replace(/^imshow\(a\);$/m, 'imshow(x);');
run('Section_1.m end to end (incl. Windows-path imread)', fixed, (o, I) => {
  if (!/ans =\n\n   200   200     3\n\n/.test(o)) return 'size(x) output wrong';
  if (!/ans =\n\n   200   200\n\n/.test(o)) return 'size(y) output wrong';
  if (!/struct with fields:/.test(o) || !/ColorType: 'truecolor'/.test(o) || !/ColorType: 'grayscale'/.test(o)) return 'imfinfo output wrong';
  if (shown.length !== 8 || figs !== 2) return `shown=${shown.length} figs=${figs}`;
  if (!written['newTest.png'] || !written['newTestGray.png']) return 'imwrite missing';
  if (!warns.some(w => w.includes('using \'test.png\''))) return 'no path-fallback warning';
  return true;
});
run('command syntax: imfinfo \'test.png\'', `imfinfo 'test.png'\nx = imread('test.png');\nwhos`, o => /Width: 200/.test(o) && /x\s+200x200x3\s+120000\s+uint8/.test(o) || 'bad output');
run('imwrite -> imread round trip is lossless', `x = imread('test.png'); imwrite(x,'rt.png'); z = imread('rt.png'); d = sum(abs(double(z(:))-double(x(:))));`, (_o, I) => eq(val(I, 'd'), [0]));
run('command syntax mid-line + quoted args', `x=imread('test.png'); hold on; imfinfo 'test.png', clear x\nwho`, o => /Width: 200/.test(o) || 'bad: ' + o.slice(0,80));
run('3-D matrix display is capped (no browser freeze)', `x = imread('test.png')`, o => (o.length < 400 && /200×200×3 uint8 array/.test(o)) || 'not capped: ' + o.length);
run('indexing a part: x(1:3,1:3,1)', `x = imread('test.png'); x(1:2,1:3,1)`, o => /^ans =\n\n/.test(o) && o.split('\n').length === 6 || 'bad: ' + JSON.stringify(o));

console.log('Lectures 2-4 style scripts');
run('L2 brightness loop on grayscale saturates like MATLAB', `a=imread('testgray.png'); b=a; for i=1:size(a,1), for j=1:size(a,2), b(i,j)=b(i,j)+50; end, end; c=a+50; d=sum(abs(double(b(:))-double(c(:)))); m=max(b(:));`, (_o, I) => eq([val(I, 'd'), val(I, 'm')], [[0], [255]]));
run('L3 gradient loops 256x256', `A=zeros(256,256,'uint8'); for i=1:256, for j=1:256, A(i,j)=j-1; end, end; imtool(A); imwrite(A,'Gray1.png'); imfinfo 'Gray1.png', r=A(1,:);`, (o, I) => { const r = val(I, 'r'); return r[0] === 0 && r[255] === 255 && /Width: 256/.test(o) || 'bad gradient'; });
run('L3 color squares (nested loops, 3 channels)', `A=zeros(300,300,3,'uint8'); for i=1:300, for j=1:300, A(i,j,1)=255; A(i,j,2)=0; A(i,j,3)=0; end, end; for i=61:240, for j=61:240, A(i,j,1)=0; A(i,j,2)=255; A(i,j,3)=0; end, end; for i=121:180, for j=121:180, A(i,j,1)=0; A(i,j,2)=0; A(i,j,3)=255; end, end; p=[A(1,1,1) A(100,100,2) A(150,150,3) A(150,150,1)];`, (_o, I) => eq(val(I, 'p'), [255, 255, 255, 0]));
run('L4 crop: loop method == range method == imcrop', `a=imread('test.png'); b=zeros(50,100,3,'uint8'); r=61; for i=1:size(b,1), c=61; for j=1:size(b,2), b(i,j,1:3)=a(r,c,1:3); c=c+1; end, r=r+1; end; b2=a(61:110,61:160,1:3); b3=imcrop(a,[61 61 99 49]); d1=sum(abs(double(b(:))-double(b2(:)))); d2=sum(abs(double(b3(:))-double(b2(:)))); sz=size(b3);`, (_o, I) => eq([val(I, 'd1'), val(I, 'd2'), val(I, 'sz')], [[0], [0], [50, 100, 3]]));
run('L4 colour spaces: classes and shapes', `a=imread('test.png'); h=rgb2hsv(a); y=rgb2ycbcr(a); n=rgb2ntsc(a); H=h(:,:,1); c1=class(h); c2=class(y); c3=class(n); mx=max(h(:)); mn=min(h(:));`, (o, I) => { const m = (I.vars.get('c1') as any); return String.fromCharCode(...val(I, 'c1') as number[]) === 'double' && String.fromCharCode(...val(I, 'c2') as number[]) === 'uint8' && String.fromCharCode(...val(I, 'c3') as number[]) === 'double' && (val(I, 'mx')[0] as number) <= 1 && (val(I, 'mn')[0] as number) >= 0 || 'bad classes/ranges'; });
run('rgb2gray(test.png) vs provided testgray.png', `a=imread('test.png'); g=rgb2gray(a); t=imread('testgray.png'); d=max(abs(double(g(:))-double(t(:))));`, (_o, I) => { const d = val(I, 'd')[0] as number; console.log(`       max |rgb2gray - testgray.png| = ${d}`); return d <= 1 || `differs by ${d}`; });
run('midterm Q2 processImage (lightness method)', `function processImage(imgName, startX, startY, height, width, brightnessValue)
  a = imread(imgName);
  c = a(startY:startY+height-1, startX:startX+width-1, :);
  c = double(c);
  g = uint8((max(c,[],3) + min(c,[],3)) / 2);
  g = g + brightnessValue;
  imshow(g);
  imwrite(g, 'result.png');
end
processImage('test.png', 10, 20, 60, 50, 30);
r = imread('result.png'); s = size(r);`, (_o, I) => eq(val(I, 's'), [60, 50]));
run('Tier-2: resize / rotate / im2double / imhist', `a=imread('testgray.png'); b=imresize(a,0.5,'nearest'); c=imrotate(a,90); d=im2double(a); h=imhist(a); s=[size(b) size(c) numel(h) sum(h)]; m=max(d(:));`, (_o, I) => eq([val(I, 's'), val(I, 'm')[0] <= 1], [[100, 100, 200, 200, 256, 40000], true]));

console.log('Core extras');
run('switch case and otherwise', `x=2; switch x\ncase 1\ny=10;\ncase 2\ny=20;\notherwise\ny=30;\nend`, (_o, I) => eq(val(I, 'y'), [20]));
run('switch break exits switch and continue reaches loop', `s=0; for i=1:4, switch i, case 2, continue; case 3, break; otherwise, s=s+i; end, s=s+10; end`, (_o, I) => eq(val(I, 's'), [35]));
run('cell literal, contents indexing, assignment and cell constructor', `C={1,'hi';[2 3],false}; a=C{1}; C{3}=9; b=C{3}; d=C(4); e=iscell(C); F=cell(2,3);`, (_o, I) => eq([val(I, 'a'), val(I, 'b'), val(I, 'e'), val(I, 'F')], [[1], [9], [1], []]) && (I.vars.get('d') as any).cls === 'cell' && (I.vars.get('F') as any).dims.join(',') === '2,3');
run('multidimensional cell indexing and end', `C={1,2;3,4}; x=C{2,2}; C{1,2}=9; y=C{end}; R=C(2,:);`, (_o, I) => eq([val(I, 'x'), val(I, 'y')], [[4], [4]]) && (I.vars.get('R') as any).data.map((v: any) => v.data[0]).join(',') === '3,4');
run('cell assignment preserves value semantics', `C={1}; D=C; D{1}=2; x=C{1}; y=D{1};`, (_o, I) => eq([val(I, 'x'), val(I, 'y')], [[1], [2]]));
run('struct field read, write and nested fields', `s=struct('x',5); s.y='ok'; s.nested.value=7; a=s.x; b=s.y; c=s.nested.value;`, (_o, I) => eq([val(I, 'a'), val(I, 'c')], [[5], [7]]) && String.fromCharCode(...val(I, 'b')) === 'ok');
run('nested struct assignment preserves value semantics', `a=struct('child',struct('v',1)); b=a; b.child.v=2; x=a.child.v; y=b.child.v;`, (_o, I) => eq([val(I, 'x'), val(I, 'y')], [[1], [2]]));
run('imfinfo struct field access', `info=imfinfo('test.png'); w=info.Width;`, (_o, I) => eq(val(I, 'w'), [200]));
run('histeq preserves class and shape, returns transform', `a=uint8([0 0 255 255]); [b,t]=histeq(a,2); c=double([0 .5 1]); d=histeq(c,3); st=size(t);`, (_o, I) => eq([val(I, 'b'), val(I, 'd'), val(I, 'st')], [[0, 0, 255, 255], [0, 0.5, 1], [256, 1]]));
run('help command exposes feature documentation', `help histeq`, o => /histogram equalization/.test(o));
run('constants and while true/break', `k=0; while true, k=k+1; if k>=3, break; end, end; t=true; f=false(1,2); p=pi>3;`, (_o, I) => eq([val(I, 'k'), val(I, 't'), val(I, 'f'), val(I, 'p')], [[3], [1], [0, 0], [1]]));
run('any/all/find/sort/cumsum/prod/linspace', `a=[3 1 2]; [s,i]=sort(a); f=find(a>1); c=cumsum(a); p=prod(a); l=linspace(0,1,5); an=any(a>2); al=all(a>2);`, (_o, I) => eq([val(I,'s'),val(I,'i'),val(I,'f'),val(I,'c'),val(I,'p'),val(I,'l'),val(I,'an'),val(I,'al')], [[1,2,3],[2,3,1],[1,3],[3,4,6],[6],[0,0.25,0.5,0.75,1],[1],[0]]));
run('reshape/repmat/flip', `a=reshape(1:6,2,3); b=repmat([1 2],2,2); c=fliplr([1 2 3]); d=flipud([1;2]);`, (_o, I) => eq([val(I,'a'),val(I,'b'),val(I,'c'),val(I,'d')], [[1,2,3,4,5,6],[1,1,2,2,1,1,2,2],[3,2,1],[2,1]]));
run('image arithmetic saturates', `a=uint8([250 10]); b=imadd(a,uint8(10)); c=imsubtract(a,uint8(20)); d=imabsdiff(a,uint8(20)); e=imcomplement(a); m=mat2gray([0 5 10]);`, (_o, I) => eq([val(I,'b'),val(I,'c'),val(I,'d'),val(I,'e'),val(I,'m')], [[255,20],[230,0],[230,10],[5,245],[0,0.5,1]]));
run('command syntax with unquoted filename: imtool test.png / imshow testgray.png', `imtool test.png\nimshow testgray.png`, () => shown.length === 2 && shown[0].tool === true && shown[1].tool === false || JSON.stringify(shown));
run('error() raises', `error('boom %d', 5);`, () => true, 'boom 5');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
