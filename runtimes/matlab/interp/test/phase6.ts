// Phase 6 tests (performance). 6.1 optimisations must not change any result: hand-computed cases,
// plus differential runs of the fast paths against the general evaluator.
import { Interp, Host } from '../src/index';
type Run = (name: string, src: string, check: (o: string, I: Interp) => any, expectErr?: string) => void;
type Ctx = { run: Run; val: (I: Interp, n: string) => number[]; eq: (a: any, b: any) => any };

/** Everything observable from running `src`: printed text, error message and every variable (class, size, values). */
function outcome(src: string, fast: boolean): string {
  let out = '';
  const host: Host = { print: s => { out += s; }, warn: s => { out += `[warn ${s}]`; }, readImage: () => null, writeImage: () => {}, showImage: () => {}, newFigure: () => {} };
  const I = new Interp(host);
  I.scalarFastPath = fast;
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
  const same = (name: string, programs: string[]) => run(name, '', () => {
    const bad = programs.filter(p => outcome(p, true) !== outcome(p, false));
    if (bad.length) throw new Error(`${bad.length}/${programs.length} differ, e.g. ${bad.slice(0, 3).map(p => `\n${p}\n fast: ${outcome(p, true)}\n slow: ${outcome(p, false)}`).join('')}`);
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
}
