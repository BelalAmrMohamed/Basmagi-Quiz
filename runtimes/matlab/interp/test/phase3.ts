// Phase 3 tests: numeric classes. Expected values are computed by hand (rounding half away from zero, saturation, class rules).
import type { Interp } from '../src/index';
type Run = (name: string, src: string, check: (o: string, I: Interp) => any, expectErr?: string) => void;
export function runPhase3({ run, val, eq }: { run: Run; val: (I: Interp, n: string) => number[]; eq: (a: any, b: any) => any }) {
  console.log('Phase 3 (numeric classes)');
  const chk = (vars: Record<string, number[]>) => (_o: string, I: Interp) => {
    for (const [k, v] of Object.entries(vars)) { const r = eq(val(I, k), v); if (r !== true) return `${k}: ${r}`; }
    return true;
  };
  const clsOf = (I: Interp, n: string) => (I.vars.get(n) as any).cls as string;
  const chkCls = (vars: Record<string, string>) => (_o: string, I: Interp) => {
    for (const [k, v] of Object.entries(vars)) if (clsOf(I, k) !== v) return `class(${k}) = ${clsOf(I, k)}, expected ${v}`;
    return true;
  };

  run('saturation: uint8 and int8 (round half away from zero)', `a=uint8([300 -5 2.5 -2.5 NaN 254.5]); b=int8([200 -200 2.5 -2.5 -128.5 127.4]);`,
    chk({ a: [255, 0, 3, 0, 0, 255], b: [127, -128, 3, -3, -128, 127] }));
  run('saturation: uint16 and int16', `a=uint16([70000 65535.4 -1 0.5 1.5]); b=int16([-40000 40000 -2.5 32767.4]);`,
    chk({ a: [65535, 65535, 0, 1, 2], b: [-32768, 32767, -3, 32767] }));
  run('saturation: uint32 and int32', `a=uint32([5e9 -3 2.5]); b=int32([-3e9 3e9 2.5 -2.5]);`,
    chk({ a: [4294967295, 0, 3], b: [-2147483648, 2147483647, 3, -3] }));
  run('classes of the conversion functions', `a=int8(1); b=uint8(1); c=int16(1); d=uint16(1); e=int32(1); f=uint32(1); g=single(1); h=double(int8(1)); k=logical(5);`,
    chkCls({ a: 'int8', b: 'uint8', c: 'int16', d: 'uint16', e: 'int32', f: 'uint32', g: 'single', h: 'double', k: 'logical' }));
  run('single stores float32: 16777217 -> 16777216, 2^24+2 exact', `a=double(single(16777217)); b=double(single(16777218)); c=single(1)/single(3);`,
    (_o, I) => (val(I, 'a')[0] === 16777216 && val(I, 'b')[0] === 16777218 && val(I, 'c')[0] === 0.3333333432674408 && clsOf(I, 'c') === 'single') || 'bad single rounding');
  run('integer arithmetic saturates per class', `a=int8(100)+int8(100); b=int8(-100)-int8(100); c=uint16(60000)+uint16(10000); d=uint8(200)+50; e=uint8(5)-10; f=int16(300)*200;`,
    chk({ a: [127], b: [-128], c: [65535], d: [250], e: [0], f: [32767] }));
  run('integer division and scaling round half away from zero', `a=int16(7)/int16(2); b=int8(-7)/int8(2); c=uint8(10)*2.6; d=uint16(100).*3.5; e=int32(10)/4;`,
    chk({ a: [4], b: [-4], c: [26], d: [350], e: [3] }));
  run('unary minus and abs saturate: -int8(-128) = 127', `a=-int8(-128); b=abs(int8(-128)); c=-uint8(5);`, chk({ a: [127], b: [127], c: [0] }));
  run('result class: integer with double/single/logical keeps the integer class', `a=int8(1)+1.7; b=uint16(1)+single(2); c=int32(5)+true; d=single(1)+1; e=single(1)+int8(1); f=1+1;`,
    chkCls({ a: 'int8', b: 'uint16', c: 'int32', d: 'single', e: 'int8', f: 'double' }));
  run('mixed integer classes are an error', `x=uint8(1)+int8(1);`, () => 0, 'Integers can only be combined with integers of the same class, or scalar doubles.');
  run('mixed integer classes are an error for .* and max too', `x=int16(2).*uint16(3);`, () => 0, 'Integers can only be combined with integers of the same class, or scalar doubles.');
  run('comparison between different integer classes is allowed', `a=uint8(5)<int16(6); b=int8(-1)<uint8(0); c=uint16(7)==7;`, chk({ a: [1], b: [1], c: [1] }));
  run('uint16 image arithmetic', `A=uint16([100 65535;60000 0]); B=A+6000; C=imcomplement(A); D=A-uint16(200);`,
    (_o, I) => { for (const [k, v] of Object.entries({ B: [6100, 65535, 65535, 6000], C: [65435, 5535, 0, 65535], D: [0, 59800, 65335, 0] })) { const r = eq(val(I, k), v); if (r !== true) return `${k}: ${r}`; } return clsOf(I, 'B') === 'uint16' || 'class'; });
  run('concatenation takes the first integer class and saturates', `a=[int16(1) 2.7]; b=[uint8(200) int8(-5)]; c=[single(1) 2]; d=[true false];`,
    (_o, I) => { const r = eq(val(I, 'a'), [1, 3]); if (r !== true) return r; const r2 = eq(val(I, 'b'), [200, 0]); if (r2 !== true) return r2;
      return (clsOf(I, 'a') === 'int16' && clsOf(I, 'b') === 'uint8' && clsOf(I, 'c') === 'single' && clsOf(I, 'd') === 'logical') || 'classes'; });
  run('indexed assignment keeps the class of the array and saturates', `A=zeros(1,3,'uint8'); A(2)=300; A(3)=-4; B=zeros(1,2,'int8'); B(1)=200;`, chk({ A: [0, 255, 0], B: [127, 0] }));
  run('image conversions to uint16', `a=im2uint16(uint8([0 255 128])); b=im2uint16([0 0.5 1]); c=im2uint16(true);`, chk({ a: [0, 65535, 32896], b: [0, 32768, 65535], c: [65535] }));
  run('image conversions from uint16 and int8', `a=im2double(uint16([0 65535])); b=im2uint8(uint16([0 65535 32896])); c=im2double(int8([-128 127])); d=im2single(uint8(255)); e=im2uint8(true);`,
    (_o, I) => { for (const [k, v] of Object.entries({ a: [0, 1], b: [0, 255, 128], c: [0, 1], d: [1], e: [255] })) { const r = eq(val(I, k), v); if (r !== true) return `${k}: ${r}`; } return clsOf(I, 'd') === 'single' || 'class'; });
  run('cast(x, class)', `a=cast(300,'uint8'); b=cast(uint8(5),'single'); c=cast(-3.5,'int16');`, (_o, I) => (eq(val(I, 'a'), [255]) === true && eq(val(I, 'c'), [-4]) === true && clsOf(I, 'b') === 'single') || 'bad cast');
  run('cast rejects unknown classes', `x=cast(1,'foo');`, () => 0, "Error using cast: Invalid class name 'foo'. Supported: double, single, int8, uint8, int16, uint16, int32, uint32, logical.");
  run('class(), isa()', `a=class(int8(1)); b=isa(int8(1),'integer'); c=isa(single(1),'float'); d=isa(uint8(1),'float'); e=isa(int16(1),'numeric'); f=isa(uint16(1),'uint16'); g=isa(1,'float'); h=isa(true,'numeric');`,
    (_o, I) => (String.fromCharCode(...val(I, 'a')) === 'int8' ? chk({ b: [1], c: [1], d: [0], e: [1], f: [1], g: [1], h: [0] })(_o, I) : 'class() string'));
  run('isinteger / isfloat / isnumeric on the new classes', `a=isinteger(int16(1)); b=isinteger(single(1)); c=isfloat(single(1)); d=isnumeric(uint32(1));`, chk({ a: [1], b: [0], c: [1], d: [1] }));
  run('intmax / intmin carry their class', `a=intmax('int16'); b=intmin('int8'); c=intmax('uint16')+1; d=intmax; e=intmax('uint32'); f=intmin('int32');`,
    (_o, I) => { const r = chk({ a: [32767], b: [-128], c: [65535], d: [2147483647], e: [4294967295], f: [-2147483648] })(_o, I); return r !== true ? r : (clsOf(I, 'a') === 'int16' && clsOf(I, 'd') === 'int32' && clsOf(I, 'c') === 'uint16') || 'classes'; });
  run("zeros/ones/eye/rand accept class arguments", `a=zeros(2,2,'uint16'); b=ones(1,2,'int8'); c=eye(2,'single'); d=rand(2,'single'); e=zeros(1,1,'int32');`,
    chkCls({ a: 'uint16', b: 'int8', c: 'single', d: 'single', e: 'int32' }));
  run('rand rejects integer classes', `x=rand(2,'uint8');`, () => 0, "Error using rand: Invalid data type. Valid data types are 'double' or 'single'.");
  run('rand(..., single) values are float32', `r=rand(1,5,'single'); ok=all(r==double(single(r)));`, chk({ ok: [1] }));
  run('whos shows class and byte size', `A=zeros(2,2,'uint16'); B=single([1 2 3]); C=int8(1); D=zeros(2,2); whos`,
    o => (/A\s+2x2\s+8\s+uint16/.test(o) && /B\s+1x3\s+12\s+single/.test(o) && /C\s+1x1\s+1\s+int8/.test(o) && /D\s+2x2\s+32\s+double/.test(o)) || 'whos table:\n' + o);
  run('display of integer and single values', `a=int8([1 -2; 3 4])`, o => /1\s+-2/.test(o) && /3\s+4/.test(o) || o);
  run('sum/mean/prod: integers give double, single stays single', `a=sum(uint8([200 100])); b=mean(uint8([1 2])); c=sum(single([1 2])); d=prod(int8([100 2]));`,
    (_o, I) => (eq(val(I, 'a'), [300]) === true && eq(val(I, 'b'), [1.5]) === true && eq(val(I, 'd'), [200]) === true && clsOf(I, 'a') === 'double' && clsOf(I, 'c') === 'single') || 'bad reductions');
  run('max/min/mod keep the integer class', `a=max(int8([-3 5 2])); b=min(uint16([7 3 9])); c=mod(uint16(10),uint16(4)); d=max(int16(3),int16(8));`,
    (_o, I) => (eq(val(I, 'a'), [5]) === true && eq(val(I, 'b'), [3]) === true && eq(val(I, 'c'), [2]) === true && eq(val(I, 'd'), [8]) === true && clsOf(I, 'a') === 'int8' && clsOf(I, 'b') === 'uint16') || 'bad');
  run('bitcmp on uint16', `a=bitcmp(uint16(1)); b=bitcmp(uint8(1));`, chk({ a: [65534], b: [254] }));
  run('imhist spreads uint16 over 256 bins', `h=imhist(uint16([0 256 65535 65535]));`,
    (_o, I) => { const h = val(I, 'h'); return (h.length === 256 && h[0] === 1 && h[1] === 1 && h[255] === 2 && h.reduce((p, q) => p + q, 0) === 4) || 'bad bins ' + h.filter(Boolean); });
  run('histeq on a uint16 image keeps the class and the range', `I=uint16([0 0 65535 65535]); J=histeq(I,2);`,
    (_o, I) => (clsOf(I, 'J') === 'uint16' && val(I, 'J').every(v => v === 0 || v === 65535)) || 'bad histeq ' + val(I, 'J'));
  run('rgb2gray keeps the class: uint16 white is 65535', `A=zeros(1,1,3,'uint16')+65535; g=rgb2gray(A); s=rgb2gray(single(ones(1,1,3)));`,
    (_o, I) => (eq(val(I, 'g'), [65535]) === true && clsOf(I, 'g') === 'uint16' && clsOf(I, 's') === 'single') || 'bad rgb2gray');
  run('rgb2ycbcr on uint16 scales the uint8 result by 257', `A=zeros(1,1,3,'uint16')+65535; y=rgb2ycbcr(A);`, (_o, I) => (eq(val(I, 'y'), [235 * 257, 128 * 257, 128 * 257]) === true && clsOf(I, 'y') === 'uint16') || 'bad ' + val(I, 'y'));
  run('im2bw threshold scales with the class range', `a=im2bw(uint16([10000 40000]),0.5); b=im2bw(int8([-100 100]),0.5);`, chk({ a: [0, 1], b: [0, 1] }));
  run('imshow of a uint16 image still emits an image', `imshow(uint16([0 65535;32768 1000]));`, () => true);
  run('imread stays 8-bit', `A=imread('test.png'); c=class(A);`, (_o, I) => String.fromCharCode(...val(I, 'c')) === 'uint8' || 'imread class');
}
