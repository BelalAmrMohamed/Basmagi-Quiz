import { readFileSync, existsSync, writeFileSync, statSync } from 'node:fs';
import { PNG } from 'pngjs';
import { Interp, Host, RawImage } from '../src/index';
import path from 'node:path';
import { runLectureTests } from './lectures';
import { runPhase2 } from './phase2';
import { runPhase3 } from './phase3';
import { runPhase4 } from './phase4';
import { runPhase5 } from './phase5';
import { runPhase6 } from './phase6';
import { runPhase7 } from './phase7';
import { runPhase8 } from './phase8';

const A = path.join(import.meta.dirname, 'assets');
const ALIASES: Record<string, string> = { 'peppers.png': 'pepper.png', 'test5.png': 'pepper.png' };
let out = '', shown: any[] = [], plots: { id: number; spec: any }[] = [], figs = 0, written: Record<string, any> = {}, warns: string[] = [];
const host: Host = {
  print: s => { out += s; },
  warn: s => warns.push(s),
  readImage(p) {
    const rawBase = path.basename(p);
    const base = ALIASES[rawBase.toLowerCase()] ?? rawBase;
    const fp = path.join(A, base);
    if (written[rawBase]) { const w = written[rawBase]; return { ...w, filename: '/vfs/' + rawBase, fileSize: 0, format: 'png', bitDepth: 8 * w.channels, colorType: w.channels === 1 ? 'grayscale' : 'truecolor' } as RawImage; }
    if (p !== rawBase || !existsSync(fp)) return null;
    const png = PNG.sync.read(readFileSync(fp)); const gray = /gray/.test(base);
    const ch = gray ? 1 : 3, d = new Uint8Array(png.width * png.height * ch);
    for (let i = 0; i < png.width * png.height; i++) for (let k = 0; k < ch; k++) d[i * ch + k] = png.data[i * 4 + (gray ? 0 : k)];
    return { width: png.width, height: png.height, channels: ch as 1 | 3, data: d, bitDepth: 8 * ch, format: 'png', fileSize: statSync(fp).size, colorType: gray ? 'grayscale' : 'truecolor', filename: '/vfs/' + rawBase, fileModDate: '02-Nov-2026 10:00:00' };
  },
  writeImage(p, img) { written[path.basename(p)] = img; },
  showImage(img, o) { shown.push({ w: img.width, h: img.height, tool: o.tool, name: o.name, fig: o.fig ?? figs }); },
  newFigure() { figs++; },
  figure(id, spec) { plots.push({ id, spec }); },
  maxPrintElements: 3000,
};
let pass = 0, fail = 0, todoCount = 0;
function todo(name: string, phase: string) { todoCount++; console.log(`  todo ${name} [${phase}]`); }
function run(name: string, src: string, check: (o: string, I: Interp) => any, expectErr?: string) {
  out = ''; shown = []; plots = []; figs = 0; warns = [];
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
  // imshow calls into one figure are coalesced: fig1 (x) posts at line 52, fig2 (x) at line 56, fig3 (y) when imtool starts, then 2 imtool windows.
  if (shown.length !== 5 || figs !== 2 || shown.map((s: any) => s.fig).join() !== '1,2,3,3,3') return `shown=${shown.length} figs=${figs} ids=${shown.map((s: any) => s.fig)}`;
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
run('imtool window is named after the variable or file (MATLAB: "Image Tool 1 - A")', `A=zeros(4,4,'uint8'); imtool(A); imtool(A+1); imtool('test.png'); imtool test.png; imshow(A);`, () => eq(shown.map((x: any) => x.name), ['A', undefined, 'test.png', 'test.png', 'A']));
run('error() raises', `error('boom %d', 5);`, () => true, 'boom 5');

console.log('Phase 1 (language features)');
run('block comments %{ ... %} strip lines and keep line numbers', `
x = 1;
%{
this is ignored
y = does_not_exist();
  %{
  nested comment
  %}
still ignored
%}
y = x + 2;
`, (_o, I) => eq([val(I, 'x'), val(I, 'y')], [[1], [3]]));

run('try/catch with identifier, MException, error(id,fmt), rethrow, warning', `
msg1 = ''; id1 = '';
try
  error('MyPkg:BadVal', 'bad value %d', 42);
catch e
  msg1 = e.message;
  id1 = e.identifier;
end
msg2 = '';
try
  try
    error('inner err');
  catch ME
    rethrow(ME);
  end
catch outer
  msg2 = outer.message;
end
warning('low %s', 'mem');
`, (_o, I) => {
  const m1 = String.fromCharCode(...val(I, 'msg1'));
  const i1 = String.fromCharCode(...val(I, 'id1'));
  const m2 = String.fromCharCode(...val(I, 'msg2'));
  return eq([m1, i1, m2, warns], ['bad value 42', 'MyPkg:BadVal', 'inner err', ['low mem']]);
});

run('function handles, closures by value, feval, func2str, isa', `
k = 10;
f = @(x, y) x + y + k;
k = 999;
r1 = f(2, 3);
g = @sqrt;
r2 = feval(g, 16);
r3 = feval('abs', -7);
s1 = func2str(g);
C = {@(x) x*2};
r4 = C{1}(5);
st.fn = @(x) x + 1;
r5 = st.fn(8);
isH = [isa(f, 'function_handle') isa(g, 'function_handle') isa(r1, 'function_handle')];
`, (_o, I) => {
  const s1 = String.fromCharCode(...val(I, 's1'));
  return eq([val(I, 'r1'), val(I, 'r2'), val(I, 'r3'), s1, val(I, 'r4'), val(I, 'r5'), val(I, 'isH')], [[15], [4], [7], 'sqrt', [10], [9], [1, 1, 0]]);
});

run('cellfun and arrayfun with UniformOutput true/false and multiple outputs', `
C = {[1 2], [3 4 5]; [6], [7 8 9 10]};
u = cellfun(@numel, C);
nu = cellfun(@(x) x + 1, C, 'UniformOutput', false);
A = [1 4 9];
sq = arrayfun(@sqrt, A);
function [a, b] = pair(x), a = x; b = x*10; end
[p1, p2] = arrayfun(@pair, [2 3]);
v1 = nu{2, 2};
`, (_o, I) => eq([val(I, 'u'), val(I, 'sq'), val(I, 'p1'), val(I, 'p2'), val(I, 'v1')], [[2, 1, 3, 4], [1, 2, 3], [2, 3], [20, 30], [8, 9, 10, 11]]));

run('nargin, nargout, exist, varargin, varargout, return', `
function varargout = flex(a, varargin)
  ex1 = exist('a', 'var');
  ex0 = exist('nope', 'var');
  ni = nargin;
  no = nargout;
  varargout = {ni, no, numel(varargin), ex1, ex0};
  if a < 0, return; end
end
[ni, no, nv, ex1, ex0] = flex(1, 'x', 'y');
exTop = exist('ni', 'var');
exBuilt = exist('sum', 'builtin');
`, (_o, I) => eq([val(I, 'ni'), val(I, 'no'), val(I, 'nv'), val(I, 'ex1'), val(I, 'ex0'), val(I, 'exTop'), val(I, 'exBuilt')], [[3], [5], [2], [1], [0], [1], [5]]));

run('matrix operators *, /, \\, ^, .\' and singular/integer checks', `
A = [2 1; 1 3];
b = [5; 10];
x = A \\ b;
y = b' / A';
p2 = A ^ 2;
p0 = A ^ 0;
pm1 = A ^ -1;
tr = [1 2; 3 4].';
errInt = false;
try
  z = uint8([1 2; 3 4]) * uint8([1 2; 3 4]);
catch
  errInt = true;
end
S = [1 2; 2 4] \\ [3; 6];
`, (_o, I) => {
  const x = val(I, 'x'), y = val(I, 'y'), p2 = val(I, 'p2'), p0 = val(I, 'p0'), pm1 = val(I, 'pm1'), tr = val(I, 'tr');
  const close = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-9);
  return close(x, [1, 3]) && close(y, [1, 3]) && eq(p2, [5, 5, 5, 10]) === true && eq(p0, [1, 0, 0, 1]) === true && close(pm1, [0.6, -0.2, -0.2, 0.4]) && eq(tr, [1, 2, 3, 4]) === true && val(I, 'errInt')[0] === 1 && warns.some(w => w.includes('singular'));
});

run('struct arrays, comma-separated lists [s.f]/{s.f}, isfield, fieldnames, rmfield', `
s(2).f = 20;
s(1).f = 10;
s(2).g = 99;
arr = [s.f];
cel = {s.f};
s2 = struct('a', {1, 2, 3}, 'b', 5);
arr2 = [s2.a];
n2 = numel(s2);
sub = s2(2:3);
ns = numel(sub);
isf = [isfield(s, 'f') isfield(s, 'nope') isstruct(s2)];
fns = fieldnames(s);
s3 = rmfield(s, 'g');
hasG = isfield(s3, 'g');
`, (_o, I) => {
  const fns = (I.vars.get('fns') as any).data.map((x: any) => String.fromCharCode(...x.data));
  return eq([val(I, 'arr'), val(I, 'arr2'), val(I, 'n2'), val(I, 'ns'), val(I, 'isf'), fns, val(I, 'hasG')], [[10, 20], [1, 2, 3], [3], [2], [1, 0, 1], ['f', 'g'], [0]]);
});

run('display parity golden tests (double, uint8, logical, char 2D, empty)', `
a = [1 20; 300 4]
b = uint8([1 2; 3 4])
c = logical([1 0; 0 1])
d = ['ab'; 'cd']
e = []
`, o => eq(o, "a =\n\n     1    20\n   300     4\n\nb =\n\n  1  2\n  3  4\n\nc =\n\n  1  0\n  0  1\n\nd =\n\n    ab\n    cd\n\ne = [](0×0)\n"));

runPhase2({ run, val, eq });
runPhase3({ run, val, eq });
runPhase4({ run, val, eq, get shown() { return shown; }, get plots() { return plots; } });
runPhase5({ run, val, eq });
runPhase6({ run, val, eq });
runPhase7({ run, val, eq });
runPhase8({ run, val, eq });
runLectureTests({ run, todo, val, eq, lecture: { get shown() { return shown; }, get plots() { return plots; } } });

if ((globalThis as any).__p8f) fail++;
pass += (globalThis as any).__p8 ?? 0;
console.log(`\n${pass} passed, ${fail} failed${todoCount ? `, ${todoCount} todo` : ''}`);
process.exit(fail ? 1 : 0);
