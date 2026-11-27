// Phase 2 tests: core math, array and string library. Expected values are computed by hand.
import type { Interp } from '../src/index';
type Run = (name: string, src: string, check: (o: string, I: Interp) => any, expectErr?: string) => void;
export function runPhase2({ run, val, eq }: { run: Run; val: (I: Interp, n: string) => number[]; eq: (a: any, b: any) => any }) {
  console.log('Phase 2 (core math, array and string library)');
  const chk = (vars: Record<string, number[]>) => (_o: string, I: Interp) => {
    for (const [k, v] of Object.entries(vars)) { const r = eq(val(I, k), v); if (r !== true) return `${k}: ${r}`; }
    return true;
  };
  const s = (I: Interp, n: string) => String.fromCharCode(...val(I, n));
  run('elementwise: hypot, sign, xor, isnan/isfinite', `h=hypot(3,4); sg=sign([-2 0 5]); x=xor([1 0],[1 1]); n=isnan([1 NaN]); f=isfinite([1 Inf]);`,
    chk({ h: [5], sg: [-1, 0, 1], x: [0, 1], n: [0, 1], f: [1, 0] }));
  run('atan2(1,1) = pi/4', `a=atan2(1,1);`, (_o, I) => Math.abs(val(I, 'a')[0] - Math.PI / 4) < 1e-12 || 'bad');
  run('bit ops: 12&10=8, 12|10=14, 12^10=6, shifts', `a=bitand(12,10); b=bitor(12,10); c=bitxor(12,10); d=bitshift(1,3); e=bitshift(8,-2);`, chk({ a: [8], b: [14], c: [6], d: [8], e: [2] }));
  run('median/mode/std/var and column-wise median', `m=median([3 1 4 1 5]); mo=mode([1 2 2 3 3]); sd=std([2 4 4 4 5 5 7 9],1); v=var([1 2 3 4]); mm=median([1 2;3 4]);`,
    chk({ m: [3], mo: [2], sd: [2], v: [5 / 3], mm: [2, 3] }));
  run('diff, cumprod, cummax, cummin', `d=diff([1 4 9 16]); c=cumprod([1 2 3 4]); cm=cummax([1 3 2 5 4]); cn=cummin([5 3 4 1 2]);`,
    chk({ d: [3, 5, 7], c: [1, 2, 6, 24], cm: [1, 3, 3, 5, 5], cn: [5, 3, 3, 1, 1] }));
  run('linear algebra: det, inv, trace, rank, norm, dot, cross', `d=det([1 2;3 4]); i=inv([2 0;0 4]); t=trace([1 2;3 4]); r=rank([1 2;2 4]); n=norm([3 4]); p=dot([1 2 3],[4 5 6]); c=cross([1 0 0],[0 1 0]);`,
    chk({ d: [-2], i: [0.5, 0, 0, 0.25], t: [5], r: [1], n: [5], p: [32], c: [0, 0, 1] }));
  run('construction: eye, magic(3), diag, tril, triu', `e=eye(2); m=magic(3); d=diag([1 2]); l=tril([1 2;3 4]); u=triu([1 2;3 4]);`,
    chk({ e: [1, 0, 0, 1], m: [8, 3, 4, 1, 5, 9, 6, 7, 2], d: [1, 0, 0, 2], l: [1, 3, 0, 4], u: [1, 0, 2, 4] }));
  run('meshgrid, kron, rot90, circshift, flip, permute', `[X,Y]=meshgrid(1:3,1:2); k=kron([1 2],[1;1]); r=rot90([1 2;3 4]); c=circshift(1:5,2); f=flip([1 2 3]); p=permute([1 2;3 4],[2 1]);`,
    chk({ X: [1, 1, 2, 2, 3, 3], Y: [1, 2, 1, 2, 1, 2], k: [1, 1, 2, 2], r: [2, 1, 4, 3], c: [4, 5, 1, 2, 3], f: [3, 2, 1], p: [1, 2, 3, 4] }));
  run('kron(A,ones(z)) equals pixel-replication zoom', `A=[1 2;3 4]; K=kron(A,ones(2)); Z=zeros(4,4); for i=1:2, for j=1:2, Z(2*i-1:2*i,2*j-1:2*j)=A(i,j); end, end; d=sum(abs(K(:)-Z(:)));`, chk({ d: [0] }));
  run('sub2ind / ind2sub / find with [r,c] and n', `k=sub2ind([3 4],2,3); [i,j]=ind2sub([3 4],8); [r,c]=find([0 1;1 0]); f=find([0 1 1 1],2);`,
    chk({ k: [8], i: [2], j: [3], r: [2, 1], c: [1, 2], f: [2, 3] }));
  run('sets and counting: unique indices, histc, accumarray, ismember, isequal', `[u,i,j]=unique([3 1 1 2]); h=histc([1 2 2 3 3 3],1:3); a=accumarray([1;2;1],[10;20;30]); m=ismember([1 5],[1 2 3]); q=isequal([1 2],[1 2]); n=isequal([1 2],[1 3]);`,
    chk({ u: [1, 2, 3], j: [3, 1, 1, 2], h: [1, 2, 3], a: [40, 20], m: [1, 0], q: [1], n: [0] }));
  run('hist numeric form [n,x]=hist(data,k)', `[n,x]=hist([1 2 2 3 3 3 4],4);`, (_o, I) => { const n = val(I, 'n'); return (n.length === 4 && n.reduce((p, q) => p + q, 0) === 7) || 'bad counts ' + n; });
  run('predicates', `a=isrow([1 2 3]); b=iscolumn([1;2]); c=isvector([1 2;3 4]); d=isscalar(5); e=islogical(true); f=isreal(3); g=isfloat(uint8(1)); h=ismatrix(ones(2,2,2));`,
    chk({ a: [1], b: [1], c: [0], d: [1], e: [1], f: [1], g: [0], h: [0] }));
  run('constants: realmax, realmin, flintmax', `a=realmax; b=realmin; f=flintmax;`, chk({ a: [Number.MAX_VALUE], b: [2.2250738585072014e-308], f: [9007199254740992] }));
  run('strings: strcat, strrep, strsplit/strjoin, strtrim, upper, lower, strcmpi, strncmp', `a=strcat('ab','cd'); b=strrep('hello','l','L'); c=strjoin(strsplit('a,b,c',','),'-'); d=strtrim('  hi '); e=upper('ab'); f=lower('AB'); g=strcmpi('Ab','aB'); h=strncmp('hello','help',3);`,
    (_o, I) => (s(I, 'a') === 'abcd' && s(I, 'b') === 'heLLo' && s(I, 'c') === 'a-b-c' && s(I, 'd') === 'hi' && s(I, 'e') === 'AB' && s(I, 'f') === 'ab' && val(I, 'g')[0] === 1 && val(I, 'h')[0] === 1) || 'bad');
  run('conversions: str2double, str2num, int2str, mat2str, num2str', `a=str2double('3.5'); b=str2double('x'); c=str2num('[1 2 3]'); d=int2str(2.6); e=mat2str([1 2;3 4]); f=num2str(pi,8);`,
    (_o, I) => (val(I, 'a')[0] === 3.5 && Number.isNaN(val(I, 'b')[0]) && eq(val(I, 'c'), [1, 2, 3]) === true && s(I, 'd') === '3' && s(I, 'e') === '[1 2;3 4]' && s(I, 'f') === '3.1415927') || `bad ${s(I, 'e')} ${s(I, 'f')}`);
  run('sprintf recycles the format over a vector', `a=sprintf('%d,',[1 2 3]); b=sprintf('%g|%s;',1.5,'ab'); c=sprintf('%5.2f%%',12.345); d=sprintf('%e',12345.678);`,
    (_o, I) => (s(I, 'a') === '1,2,3,' && s(I, 'b') === '1.5|ab;' && s(I, 'c') === '12.35%' && s(I, 'd') === '1.234568e+04') || `bad ${s(I, 'a')} ${s(I, 'b')} ${s(I, 'c')} ${s(I, 'd')}`);
  run('fprintf recycles over a vector', `fprintf('%d-%d\\n',[1 2 3 4]);`, o => o === '1-2\n3-4\n' || JSON.stringify(o));
  run('rng(seed) makes rand/randn/randi deterministic', `rng(7); a=rand(1,3); b=randn(1,2); c=randi(10,1,3); rng(7); a2=rand(1,3); b2=randn(1,2); c2=randi(10,1,3); ok=isequal(a,a2)&&isequal(b,b2)&&isequal(c,c2);`, chk({ ok: [1] }));
  run('pause and beep run without a host', `pause(0.01); beep; x=1;`, chk({ x: [1] }));
  run('dim argument on sum/mean/max/any/cumsum', `a=sum([1 2;3 4],2); m=mean([1 2;3 4],2); mx=max([1 5;3 2],[],2); an=any([0 1;0 0],2); cs=cumsum([1 2;3 4],2);`,
    chk({ a: [3, 7], m: [1.5, 3.5], mx: [5, 3], an: [1, 0], cs: [1, 3, 3, 7] }));
  run('[m,i]=max and [s,i]=sort descend', `[m,i]=max([3 9 2]); [so,k]=sort([3 1 2],'descend');`, chk({ m: [9], i: [2], so: [3, 2, 1], k: [1, 3, 2] }));
}
