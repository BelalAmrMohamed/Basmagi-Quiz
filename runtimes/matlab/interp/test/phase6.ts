// Phase 6 tests (performance). 6.1 optimisations must not change any result: hand-computed cases,
// plus differential runs of the fast paths against the general evaluator.
import { Interp, Host } from '../src/index';
import { BUILTINS } from '../src/interp';
import { progressFraction, progressPercent } from '../src/progress';
import { BENCH_CASES, BENCH_REFERENCE_MS, CALIBRATION_REF_MS, bestOf, calibrateMs } from './bench';
type Run = (name: string, src: string, check: (o: string, I: Interp) => any, expectErr?: string) => void;
type Ctx = { run: Run; val: (I: Interp, n: string) => number[]; eq: (a: any, b: any) => any };

/** Everything observable from running `src`: printed text, error message and every variable (class, size, values). */
function outcome(src: string, fast: boolean, inPlace = true): string {
  let out = '';
  const host: Host = { print: s => { out += s; }, warn: s => { out += `[warn ${s}]`; }, readImage: () => null, writeImage: () => {}, showImage: () => {}, newFigure: () => {} };
  const I = new Interp(host);
  I.scalarFastPath = fast;
  I.buffers.inPlace = inPlace;
  let error = '';
  try { I.run(src); } catch (e: any) { error = e.message; }
  // `String` keeps NaN and Inf apart; -0 is spelled out because String(-0) is "0".
  const spell = (v: any): any => (v && v.data instanceof Float64Array
    ? [v.cls, v.dims, Array.from(v.data as Float64Array, x => (Object.is(x, -0) ? '-0' : String(x)))]
    : v && Array.isArray(v.data) ? [v.cls, v.dims, v.data.map(spell)] : v?.cls ?? v);
  return JSON.stringify([out, error, [...I.vars].map(([k, v]) => [k, spell(v)])]);
}

export function runPhase6(ctx: Ctx) {
  const { run, val, eq } = ctx;
  /** Runs every program both ways and reports the first few that differ. */
  const same = (name: string, programs: string[], reference = (p: string) => outcome(p, false)) => run(name, '', () => {
    const bad = programs.filter(p => outcome(p, true) !== reference(p));
    if (bad.length) throw new Error(`${bad.length}/${programs.length} differ, e.g. ${bad.slice(0, 3).map(p => `\n${p}\n got: ${outcome(p, true)}\n expected: ${reference(p)}`).join('')}`);
    return true;
  });

  console.log('Phase 6.1a (scalar fast path)');
  // 200+100 saturates to 255; 3-200 to 0; int8 -(-128) to 127; 7/2 = 3.5 rounds away from zero to 4
  run('scalar uint8/int arithmetic saturates and rounds', `u = uint8(200); a = u + 100; b = uint8(3) - u; m = int8(-128); c = -m; d = uint8(7) / 2; k = [isa(a,'uint8') isa(c,'int8') isa(d,'uint8')];`,
    (_o, I) => eq([val(I, 'a'), val(I, 'b'), val(I, 'c'), val(I, 'd'), val(I, 'k')], [[255], [0], [127], [4], [1, 1, 1]]));
  // A = [1 3 5; 2 4 6]: A(end)=6, A(end,1)=2, A(1,end-1)=3, A(end-1,end)=5, v(v(1)+end-3)=v(2)=20
  run('scalar subscript reads with end and nesting', `A = [1 3 5; 2 4 6]; v = [2 20 30]; i = 1; a = A(end) + 0; b = A(end,i) + 0; c = A(i,end-1) + 0; d = A(end-1,end) + 0; e = v(v(1)+end-3) + 0;`,
    (_o, I) => eq(['a', 'b', 'c', 'd', 'e'].map(n => val(I, n)[0]), [6, 2, 3, 5, 20]));
  // N = reshape(1:24,2,3,4): N(2,end) folds pages: column 12 of a 2x12 view = 24; N(end,2,3) = 2 + 2 + 12 = 16
  run('scalar subscripts fold trailing dimensions', `N = reshape(1:24, 2, 3, 4); a = N(2,end) + 0; b = N(end,2,3) * 1; c = N(1,2,3,1) + 0;`,
    (_o, I) => eq([val(I, 'a'), val(I, 'b'), val(I, 'c')], [[24], [16], [15]]));
  run('comparisons and logical operators give logical', `i = 3; j = 25; a = i <= 20 && j <= 20; b = i > 5 || ~(j == 0); k = [islogical(a) islogical(b)];`,
    (_o, I) => eq([val(I, 'a'), val(I, 'b'), val(I, 'k')], [[0], [1], [1, 1]]));
  run('short circuit skips an invalid right side', `x = 0; a = x ~= 0 && x(5) > 1; b = x == 0 || missing_name > 1;`, (_o, I) => eq([val(I, 'a'), val(I, 'b')], [[0], [1]]));
  run('functions in a scalar expression run exactly once', `z = 1 + noisy(2) + 3;
function y = noisy(x)
  fprintf('call\\n');
  y = x;
end`, (o, I) => eq([o, val(I, 'z')], ['call\n', [6]]));
  run('a variable hides a function of the same name', `mod = [5 6]; z = mod(2) + 1;`, (_o, I) => eq(val(I, 'z'), [7]));
  run('assigned scalar is independent of its source', `x = 5; y = x; y = y + 1; A = [1 2]; b = A(2); A(2) = 9;`, (_o, I) => eq([val(I, 'x'), val(I, 'y'), val(I, 'b')], [[5], [6], [2]]));
  run('mixed integer classes still error', `x = uint8(1) + int8(1);`, () => 0, 'Integers can only be combined with integers of the same class, or scalar doubles.');
  run('out of bounds still errors', `A = [1 2; 3 4]; x = A(3,1) + 1;`, () => 0, 'Index in position 1 exceeds array bounds. Index must not exceed 2.');

  const defs = `d0 = 0; d1 = 1; dn = -2.5; dnan = NaN; dinf = Inf; u = uint8(200); u3 = uint8(3); i8 = int8(-100); i16 = int16(7); i32 = int32(-2147483647); s = single(0.1); t = true; f = false; c = 'a'; M = [1 2; 3 4]; z = []; q = {1};`;
  const names = ['d0', 'd1', 'dn', 'dnan', 'dinf', 'u', 'u3', 'i8', 'i16', 'i32', 's', 't', 'f', 'c', 'M', 'z', 'q', '2'];
  const ops = ['+', '-', '*', '/', '\\', '^', '.*', './', '.^', '<', '<=', '>', '>=', '==', '~=', '&', '|', '&&', '||'];
  same('differential: every binary operator over every operand class', ops.flatMap(op => names.flatMap(a => names.map(b => `${defs} r = ${a} ${op} ${b};`))));
  same('differential: unary operators, nesting and conditions', names.flatMap(a => [
    `${defs} r = -${a};`, `${defs} r = +${a};`, `${defs} r = ~${a};`, `${defs} r = -(${a} + u3) * 2;`, `${defs} r = ~(${a} > d0) | ${a} == d1;`,
    `${defs} r = 0; if ${a}, r = 1; end`, `${defs} r = 0; while ${a} && r < 3, r = r + 1; end`, `${defs} r = ${a} + M + ${a};`,
  ]));
  const arrays = `M = [1 2 3; 4 5 6]; N = uint8(reshape(1:24, 2, 3, 4)); v = [10 20 30]; L = logical([1 0 1]); w = 'xyz'; z = []; i = 2; h = @(x) x + 1; q = {7, 8};`;
  const subs = ['1', '2', '3', '6', '7', '24', '25', '0', '-1', '1.5', 'NaN', 'i', 'i-1', '2*i-1', 'end', 'end-1', 'end+1', 'end/2', 't', 'true', 'i>1', 'v(1)/10', 'M(1,end-2)', 'N(end)', "'a'", 'uint8(2)', 'z', 'nope', 'numel(v)'];
  same('differential: scalar subscript reads', ['M', 'N', 'v', 'L', 'w', 'z', 'i', 'h', 'q'].flatMap(a => subs.flatMap(x => [
    `${arrays} t = 1; r = ${a}(${x});`, `${arrays} t = 1; r = ${a}(${x}, 1) + 1;`, `${arrays} t = 1; r = ${a}(2, ${x});`, `${arrays} t = 1; r = ${a}(1, 2, ${x}) * 2;`, `${arrays} t = 1; r = -${a}(${x}, ${x}, 1, 1);`,
  ])));
  same('differential: end inside function arguments and ranges', ['M(min(end, 9))', 'v(max(end-1, 1)) + 1', 'v(end-1:end)', 'M(end, min(i, end))', 'v(v(end)/10)'].map(x => `${arrays} r = ${x};`));

  console.log('Phase 6.1b (direct element access and copy-on-write)');
  const data = (I: Interp, n: string) => (I.vars.get(n) as any).data as Float64Array;
  // reshape(1:12,2,2,3): pixel (2,1) holds 2, 6, 10; writing pixel (1,2) hits linear positions 3, 7, 11
  run('pixel read and write A(i,j,:)', `A = reshape(1:12, 2, 2, 3); p = A(2,1,:); sz = size(p); A(1,2,:) = [100 110 120];`,
    (_o, I) => eq([val(I, 'p'), val(I, 'sz'), val(I, 'A')], [[2, 6, 10], [1, 1, 3], [1, 2, 100, 4, 5, 6, 110, 8, 9, 10, 120, 12]]));
  // 300 -> 255, -5 -> 0, 2.5 -> 3
  run('direct writes saturate to the class of the destination', `A = zeros(3, 3, 3, 'uint8'); A(1,1,:) = [300 -5 2.5]; A(2,2,1) = 999; A(27) = -1; p = A(1,1,:); q = A(2,2,1); k = isa(A, 'uint8');`,
    (_o, I) => eq([val(I, 'p'), val(I, 'q'), val(I, 'k')], [[255, 0, 3], [255], [1]]));
  run('wrong pixel size still errors', `A = zeros(3, 3, 3); A(1,1,:) = [1 2];`, () => 0, 'Unable to perform assignment because the size of the left side is 1×1×3 and the size of the right side is 1×2.');
  run('writes happen in place until the array is shared', '', () => {
    const I = new Interp({ print: () => {}, readImage: () => null, writeImage: () => {}, showImage: () => {}, newFigure: () => {} });
    I.run('a = zeros(10, 10, 3);');
    const first = data(I, 'a');
    I.run('a(2,3,1) = 5; a(4,5,:) = 7; a(9) = 1; a(2,:,1) = 3; a(3,:,1) = 4; a(5,:,2) = 1;'); // the last three take the general path
    if (data(I, 'a') !== first) throw new Error('an unshared array was copied');
    I.run('b = a;');
    if (data(I, 'b') !== first) throw new Error('b = a copied the data');
    I.run('a(1) = 42;');
    const mine = data(I, 'a');
    I.run('a(2) = 43;');
    return eq([mine !== first, data(I, 'a') === mine, data(I, 'b') === first, first[0], first[1]], [true, true, true, 0, 3]);
  });
  // Every way a second holder can appear: each x is written afterwards, the original must keep its first element (1)
  run('small arrays are copies too', `a = [1 2 3]; b = a; b(1) = -1; c = {a}; x = c{1}; x(2) = -1; y = c{1};`, (_o, I) => eq([val(I, 'a'), val(I, 'y')], [[1, 2, 3], [1, 2, 3]]));
  // the 5x6 array has no other holder when the loop starts; the columns of the original sum to 1+...+30 = 465
  run('a for loop keeps iterating the original array', `a = reshape(1:30, 5, 6); t = 0; for col = a, a(:) = 0; t = t + sum(col); end`, (_o, I) => eq([val(I, 't'), val(I, 'a')[29]], [[465], 0]));
  run('writing a copy never changes the original', `
a = reshape(1:30, 5, 6);
b = a; b(1) = -1;
c = {a}; x = c{1}; x(1) = -1; r1 = c{1}(1);
s.f = a; y = s.f; y(1,1) = -1; r2 = s.f(1);
f = @() a; z = f(); z(1) = -1; w = f(); r3 = w(1);
m = [a]; m(1) = -1;
n = reshape(a, 5, 6); n(1) = -1;
[p, q] = pair(a); p(1) = -1; r4 = q(1);
g = poke(a);
h = pokeFirst(a, a);
r = [r1 r2 r3 r4 b(1) g(1) h(1)];
a2 = reshape(1:30, 5, 6); same = a2; same(1,1) = -1; keep = a2(1);
function v = poke(v)
  v(1) = -1;
end
function [p, q] = pair(v)
  p = v; q = v;
end
function v = pokeFirst(varargin)
  v = varargin{1}; v(1) = -1;
end`, (_o, I) => eq([val(I, 'r'), val(I, 'keep')], [[1, 1, 1, 1, -1, -1, -1], [1]]));

  const shapes = `A = reshape(1:60, 4, 5, 3); U = uint8(reshape(1:60, 4, 5, 3)); G = reshape(1:20, 4, 5); S = [1 2; 3 4]; F = reshape(1:48, 2, 2, 3, 4); L = G > 7; w = 'abcdefghijklmnopqrstu'; v = 1:20; z = []; E = zeros(2, 2, 0); i = 2; q = {1, 2}; h = @(x) x;`;
  const targets = ['A', 'U', 'G', 'S', 'F', 'L', 'w', 'v', 'z', 'E', 'i', 'q', 'h', 'nope'];
  const forms = ['(2)', '(end)', '(61)', '(2,3)', '(i,end)', '(5,6)', '(1,2,3)', '(i,i,1)', '(2,2,4)', '(2,3,:)', '(i,end,:)', '(end,1,:)', '(i+1,2*i,:)', '(0,1,:)', '(9,9,:)', '(1.5,1,:)', '(i>1,1,:)', '(1,1,1,2)', '(numel(v),1)', '(1:2,3,:)', '(:,1,:)'];
  same('differential: element and pixel reads', targets.flatMap(t => forms.map(f => `${shapes} r = ${t}${f};`)));
  const values = ['7', '-300', '2.5', 'uint8(200)', "'Z'", 'true', '[10 20 30]', '[10; 20; 30]', 'reshape([7 8 9], 1, 1, 3)', '[1 2]', '[]', 'A(1,1,:)', 'A', '{1}'];
  same('differential: element and pixel writes', targets.flatMap(t => forms.flatMap(f => values.map(x => `${shapes} ${t}${f} = ${x};`))));

  // Random programs that alias arrays in every supported way, then write into them.
  let seed = 12345;
  const rand = (n: number) => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return (seed >>> 16) % n; };
  const pick = <X>(xs: X[]) => xs[rand(xs.length)];
  // `side` x `side` x 3 arrays: 12 elements (below the tracking limit) and 48 (above it)
  const statement = (side: number): string => {
    const [X, Y, Z] = [pick(['a', 'b', 'd']), pick(['a', 'b', 'd']), pick(['a', 'b', 'd'])];
    const i = 1 + rand(side), j = 1 + rand(side), k = 1 + rand(3), n = 1 + rand(3 * side * side), x = rand(300) - 20;
    return pick([
      `${X} = ${Y};`, `${X} = ${Y};`, `${X}(${i},${j},${k}) = ${x};`, `${X}(${i},${j},:) = ${Y}(${j},${i},:);`, `${X}(${n}) = ${x};`, `${X}(${i},:,${k}) = ${x};`,
      `c{1} = ${X};`, `${X} = c{1};`, `c{2} = ${X}; c{2}(${n}) = ${x};`, `s.f = ${X};`, `${X} = s.f;`, `s.f(${n}) = ${x};`,
      `${X} = poke(${Y}, ${n}, ${x});`, `[${X}, ${Y}] = both(${Z}, ${Z});`, `[${X}, ${Y}] = swap(${X}, ${Y});`, `f = @() ${X};`, `${X} = f();`, `g = @(m) m; ${X} = g(${Y});`,
      `${X} = [${Y}];`, `${X} = reshape(${Y}, ${side}, ${side}, 3);`, `${X} = double(${Y});`, `${X} = im2double(${Y});`, `${X} = squeeze(${Y});`, `${X} = permute(${Y}, [1 2 3]);`, `${X} = cat(3, ${Y});`,
      `${X} = ${Y}; ${X}(${n}) = ${x}; ${Y}(${n}) = ${x + 1};`, `for col = ${X}(:,:,1), ${X}(${n}) = ${x}; acc = acc + sum(col); end`,
      `for col = ${X}, ${X}(:) = ${x}; acc = acc + sum(col(:)); end`,
      `try, ${X}(${n}) = ${x}; error('x'); catch, ${Y} = ${X}; end`,
    ]);
  };
  const programs = Array.from({ length: 1500 }, (_, p) => { const side = p % 2 ? 2 : 4; return `a = reshape(1:${3 * side * side}, ${side}, ${side}, 3); b = uint8(a); d = a * 2; c = {a, b}; s.f = d; f = @() a; acc = 0;
${Array.from({ length: 25 }, () => statement(side)).join('\n')}
function v = poke(v, n, x)
  v(n) = x;
end
function [p, q] = both(p, q)
  p(1) = p(1) + 1; q(2) = q(2) + 2;
end
function [p, q] = swap(m, n)
  p = n; q = m;
end`; });
  same('differential: copy-on-write against copying on every write', programs, p => outcome(p, false, false));
  run('random programs run to completion', '', () => eq(programs.filter(p => JSON.parse(outcome(p, true))[1] !== '').length, 0));

  run('no builtin writes into its argument', '', () => {
    const bad = new Set<string>();
    const I = new Interp({ print: () => {}, readImage: () => null, writeImage: () => {}, showImage: () => {}, newFigure: () => {} });
    for (const make of ['mod(reshape(1:30, 5, 6) * 7, 11) / 11', 'uint8(mod(reshape(1:75, 5, 5, 3) * 37, 256))', 'logical(mod(reshape(1:30, 5, 6), 3))', '[0.9 0.1 0.5 0.3 0.7 0.2 0.8 0.4 0.6 1 0 0.35 0.65 0.15 0.85 0.45 0.55 0.25 0.75 0.05]']) {
      for (const name of Object.keys(BUILTINS).filter(n => n !== 'pause')) for (const call of ['(a)', '(a, a)', '(a, 1)', '(a, 2, 1)', "(a, 'replicate')"]) {
        I.vars.clear();
        I.run(`a = ${make};`);
        const held = data(I, 'a'), before = held.slice();
        try { I.run(`r = ${name}${call};`); } catch { /* most calls are invalid; only the argument matters */ }
        if (held.some((x, i) => !Object.is(x, before[i]))) bad.add(name);
      }
    }
    return eq([...bad], []);
  });

  console.log('Phase 6.1c (for over a range without building it)');
  run('range loops: negative and fractional steps', `a = []; for k = 10:-3:1, a(end+1) = k; end; b = []; for x = 0:0.25:1, b(end+1) = x; end; c = isa(x, 'double');`,
    (_o, I) => eq([val(I, 'a'), val(I, 'b'), val(I, 'c')], [[10, 7, 4, 1], [0, 0.25, 0.5, 0.75, 1], [1]]));
  run('empty and NaN ranges run no iterations and leave the variable alone', `k = 7; n = 0; for k = 5:1, n = n + 1; end; for k = 1:0:5, n = n + 1; end; for k = 1:NaN, n = n + 1; end; for k = NaN:3, n = n + 1; end`,
    (_o, I) => eq([val(I, 'k'), val(I, 'n')], [[7], [0]]));
  // the body changes both the bound and the loop variable; neither changes the 3 iterations
  run('bounds are fixed on entry and assigning the loop variable does not skip', `n = 3; a = []; for i = 1:n, a(end+1) = i; n = 10; i = 99; end`,
    (_o, I) => eq([val(I, 'a'), val(I, 'i'), val(I, 'n')], [[1, 2, 3], [99], [10]]));
  run('each bound is evaluated once, in order', `for i = noisy(1):noisy(2):noisy(5), end
function y = noisy(x)
  fprintf('%d;', x);
  y = x;
end`, (o, I) => eq([o, val(I, 'i')], ['1;2;5;', [5]]));
  run('a kept loop value does not follow the loop', `for i = 1:3, if i == 1, y = i; c = {i}; end, end; z = c{1};`, (_o, I) => eq([val(I, 'y'), val(I, 'z'), val(I, 'i')], [[1], [1], [3]]));
  // 1e12 doubles cannot be allocated, so these finish only if the range is never built
  run('huge and infinite ranges can be left with break', `for a = 1:1e12, if a > 3, break; end, end; for b = ((5:Inf)), if b > 7, break; end, end; for c = 0:-2:-Inf, if c < -5, break; end, end`,
    (_o, I) => eq([val(I, 'a'), val(I, 'b'), val(I, 'c')], [[4], [8], [-6]]));
  const bounds = ['0', '1', '3', '-2', '2.5', '0.1', 'NaN', 'uint8(3)', 'int8(-2)', 'true', "'c'", '[2 3]', '[]'];
  const heads = bounds.flatMap(a => bounds.flatMap(b => [`${a}:${b}`, `(${a}:${b})`, ...bounds.map(st => `${a}:${st}:${b}`)]));
  // brackets make the loop go through the general path, which builds the array first
  same('differential: range loops against loops over the built array', heads.map(h => `acc = []; i = -7; for i = ${h}\n acc(end+1) = i; k = class(i); end`),
    p => outcome(p.replace(/for i = (.*)\n/, 'for i = [$1]\n'), true));

  console.log('Phase 6.1 (benchmark ceilings)');
  // A ceiling is 2.5x the reference time (2x regression plus noise) times how much slower this machine is on a fixed JS
  // workload, with a 40 ms floor. The pre-Phase-6 timings of the 512 loops were 2.5-4.5x the references, so they fail.
  const machine = Math.min(8, Math.max(1, calibrateMs() / CALIBRATION_REF_MS));
  for (const c of BENCH_CASES) {
    const ref = BENCH_REFERENCE_MS[c.name];
    run(`bench: ${c.name} is within its ceiling`, '', () => {
      if (ref === undefined) throw new Error('no reference time for this case');
      const ceiling = Math.max(40, 2.5 * ref * machine);
      let ms = bestOf(c, 2);
      if (ms > ceiling) ms = Math.min(ms, bestOf(c, 3)); // one more chance before failing on a noisy run
      if (ms > ceiling) throw new Error(`${ms.toFixed(0)} ms > ceiling ${ceiling.toFixed(0)} ms (reference ${ref} ms, machine x${machine.toFixed(2)})`);
      return true;
    });
  }

  console.log('Phase 6.2a (progress ticks)');
  type Info = { line: number; loops: { iter: number; total: number }[]; elapsedMs: number };
  /** Runs `src` with a recording `tick`. `step` moves a fake clock forward on every read; reads are counted. */
  const ticked = (src: string, o: { mask?: number; interval?: number; step?: number; tick?: boolean; realClock?: boolean } = {}) => {
    const infos: Info[] = [];
    let t = 0, reads = 0;
    const host: Host = { print: () => {}, warn: () => {}, readImage: () => null, writeImage: () => {}, showImage: () => {}, newFigure: () => {} };
    if (o.tick !== false) host.tick = info => { infos.push(info); };
    const I = new Interp(host);
    I.tickMask = o.mask ?? 4095;
    I.tickIntervalMs = o.interval ?? 100;
    if (!o.realClock) I.clock = () => { reads++; return (t += o.step ?? 10); };
    I.run(src);
    return { infos, reads, I };
  };
  const loopsOf = (i: Info) => i.loops.map(l => `${l.iter}/${l.total}`).join(' ');
  run('tick: sent at most every 100 ms of clock time', '', () => {
    const { infos } = ticked('for i = 1:1000, end', { mask: 0 });
    // the clock moves 10 ms per read: one read at the start, then one per iteration
    const gaps = infos.slice(1).map((x, i) => x.elapsedMs - infos[i].elapsedMs);
    return eq([infos.length >= 99, gaps.every(g => g === 100), infos[0].elapsedMs >= 100], [true, true, true]);
  });
  run('tick: the clock is read only every 4096th iteration', '', () => {
    const a = ticked('for i = 1:4095, end'), b = ticked('for i = 1:4096, end'), c = ticked('k = 0; while k < 8192, k = k + 1; end');
    return eq([a.reads, b.reads, c.reads], [1, 2, 3]); // 1 = the read at the start of the run
  });
  run('tick: without host.tick the clock is never read in a loop', '', () => eq(ticked('for i = 1:20000, end', { mask: 0, tick: false }).reads, 1));
  run('tick: line, nesting and trip counts', '', () => {
    const { infos } = ticked('for i = 1:3\n  for j = 1:4\n    x = 1;\n  end\nend', { mask: 0, interval: 0, step: 1 });
    return eq([infos.length, loopsOf(infos[0]), loopsOf(infos[1]), loopsOf(infos[infos.length - 1]), infos.slice(0, 6).map(x => x.line)],
      [15, '1/3', '1/3 1/4', '3/3 4/4', [1, 2, 2, 2, 2, 1]]);
  });
  run('tick: while, 1:Inf and a materialized array', '', () => {
    const w = ticked('k = 0; while k < 3, k = k + 1; end', { mask: 0, interval: 0 }).infos;
    const inf = ticked('for i = 1:Inf, if i > 2, break; end, end', { mask: 0, interval: 0 }).infos;
    const arr = ticked('for v = [5 6 7], end', { mask: 0, interval: 0 }).infos;
    const nan = ticked('for i = 1:NaN, end', { mask: 0, interval: 0 }).infos;
    return eq([w.map(loopsOf), inf.map(loopsOf), arr.map(loopsOf), nan.length], [['1/Infinity', '2/Infinity', '3/Infinity'], ['1/Infinity', '2/Infinity', '3/Infinity'], ['1/3', '2/3', '3/3'], 0]);
  });
  run('tick: loops left by break, return and an error are not reported later', '', () => {
    const { infos } = ticked(`function f()
  for q = 1:3, return; end
end
for i = 1:3
  for b = 1:2, break; end
  f();
  try, for j = 1:2, error('x'); end, catch, end
end`, { mask: 0, interval: 0 });
    const per = (i: number) => [`${i}/3`, `${i}/3 1/2`, `${i}/3 1/3`, `${i}/3 1/2`];
    return eq([infos.map(loopsOf), infos.map(x => x.line)], [[1, 2, 3].flatMap(per), [4, 5, 2, 7, 4, 5, 2, 7, 4, 5, 2, 7]]);
  });
  run('tick: array and while loops left by break or return are not reported later', '', () => {
    const { infos } = ticked(`function f()
  while true, return; end
end
for i = 1:2
  for v = [7 8], break; end
  while true, break; end
  f();
  x = 1;
end`, { mask: 0, interval: 0 });
    const per = (i: number) => [`${i}/2`, `${i}/2 1/2`, `${i}/2 1/Infinity`, `${i}/2 1/Infinity`];
    return eq(infos.map(loopsOf), [1, 2].flatMap(per));
  });
  run('tick: pause reports progress', '', () => {
    const n = ticked('pause(0.25)', { realClock: true }).infos.length; // real clock: about 2 ticks in 250 ms
    return n >= 1 && n <= 3 ? true : eq(n, 2);
  });
  const pct = (...l: [number, number][]) => progressPercent(l.map(([iter, total]) => ({ iter, total })));
  run('percent: one loop', '', () => eq([pct([1, 10]), pct([3, 10]), pct([10, 10]), pct([1, 1])], [0, 20, 90, 0]));
  run('percent: nested loops are (outerIter-1 + innerFraction) / outerTotal', '', () => eq([pct([2, 4], [3, 5]), pct([1, 2], [1, 2], [2, 2]), progressFraction([{ iter: 2, total: 4 }, { iter: 3, total: 5 }])],
    [35, 12, 0.35]));
  run('percent: unknown counts', '', () => eq([pct(), pct([1, Infinity]), pct([5, NaN]), pct([1, 0]), pct([1, Infinity], [3, 4]), pct([2, 4], [1, Infinity]), pct([2, 4], [7, 0])],
    [null, null, null, null, null, 25, 25]));

  console.log('Older bugs fixed with 6.3');
  // Fewer subscripts than dimensions fold the trailing ones, but the shape stays 2x2x2. A(2,3) is row 2 of the 2x4 view = A(2,1,2).
  run('A(i,j) = v on a 3-D array keeps its shape', `A = zeros(2,2,2); A(1,1) = 5; A(2,3) = 7; A(2,4) = 9; s = size(A); p = [A(1,1,1) A(2,1,2) A(2,2,2) sum(A(:))];`,
    (_o, I) => eq([val(I, 's'), val(I, 'p')], [[2, 2, 2], [5, 7, 9, 21]]));
  run('A(i,j) = v beyond the folded size is still an error', `A = zeros(2,2,2); A(1,5) = 1;`, () => true, 'Unable to resize array with fewer subscripts than dimensions.');
  run('plain 2-D growth is unchanged', `B = zeros(2,2); B(3,3) = 1; C = 1:3; C(5) = 9; s = [size(B) size(C)];`, (_o, I) => eq(val(I, 's'), [3, 3, 1, 5]));
  run('for over a cell gives 1x1 cells (columns of a 2-row cell are n-by-1 cells)', `a = [1 2 3]; k = zeros(1,2); i = 0; for m = {a, 'x'}, i = i + 1; k(i) = iscell(m) * 10 + numel(m{1}); end
sz = []; for m = {1,2;3,4}, sz(end+1) = m{2}; sz(end+1) = size(m, 1); end; e = 0; for m = {}, e = e + 1; end; r = [k sz e];`,
    (_o, I) => eq(val(I, 'r'), [13, 11, 3, 2, 4, 2, 0]));
  run('for over a cell: the variable is a cell even for a one-element cell', `a = 1; for m = {a}, end; r = [iscell(m) size(m)];`, (_o, I) => eq(val(I, 'r'), [1, 1, 1]));
  run('t.g{1} = x creates the struct, the field and the cell, and reads back', `x = 4; t.g{1} = x; y = t.g{1}; t.g{3} = 6; r = [y numel(t.g) isempty(t.g{2}) t.g{3}];`,
    (_o, I) => eq(val(I, 'r'), [4, 3, 1, 6]));
  run('c{k} = x grows a missing, empty or short cell (row, column, 2-D)', `a{2} = 5; b = {}; b{1} = 4; c = {1}; c{3} = 2; d = []; d{2} = 1; e = cell(2,1); e{4} = 3; f = {}; f{2,3} = 8;
r = [size(a) size(b) size(c) size(d) size(e) size(f) f{2,3} isempty(f{1,1})];`,
    (_o, I) => eq(val(I, 'r'), [1, 2, 1, 1, 1, 3, 1, 2, 4, 1, 2, 3, 8, 1]));
  run('c{k} = x on a matrix cell cannot grow along an ambiguous dimension', `c = cell(2,2); c{7} = 1;`, () => true, 'Attempt to grow array along ambiguous dimension.');
  run('nested brace and field assignment still work', `c = {{1}}; c{1}{1} = 7; s.a = {2}; s.a{2} = 3; r = [c{1}{1} s.a{1} s.a{2}];`, (_o, I) => eq(val(I, 'r'), [7, 2, 3]));
}
