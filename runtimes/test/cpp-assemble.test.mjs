import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import path from 'node:path';
import { writeFileSync, rmSync } from 'node:fs';
const here = import.meta.dirname;
const f = path.join(here, '..', '_cpp-assemble-entry.ts');
writeFileSync(f, `export * from './cpp/src/assemble';`);
const out = (await build({ absWorkingDir: path.join(here, '..'), entryPoints: ['_cpp-assemble-entry.ts'], bundle: true, write: false, format: 'esm' })).outputFiles[0].text;
rmSync(f);
const { assemble, isPrototype, cellRuns } = await import('data:text/javascript;base64,' + Buffer.from(out).toString('base64'));

const io = '#include <iostream>\nint n; std::cin >> n;';

test('<sstream> is only pulled in when <iostream> is included (it must not leak std::cout)', () => {
  assert.ok(!assemble([{ src: 'int x = 1;' }]).includes('<sstream>'));
  assert.ok(assemble([{ src: io }]).includes('<sstream>'));
});
test('tryCatch:false emits no try block (the in-browser clang has exceptions disabled)', () => {
  const code = assemble([{ src: 'int x = 1;' }], 'all', { tryCatch: false });
  assert.ok(!/\btry\b/.test(code) && !code.includes('catch'));
  assert.ok(/\btry\b/.test(assemble([{ src: 'int x = 1;' }])));
});
test('live cells read the real stdin; other cells keep their stored input', () => {
  const code = assemble([{ src: io, stdin: '5', live: false }, { src: 'std::cin >> n;', live: true }], 'all', { tryCatch: false });
  assert.ok(code.includes('std::streambuf* __nb_cin_buf = std::cin.rdbuf();'));
  assert.equal((code.match(/std::cin\.rdbuf\(__nb_cin_buf\)/g) || []).length, 1); // restored once, for the live cell
  assert.ok(code.includes('std::istringstream'));
});
test('unbuffered output keeps the prompt visible when the run pauses for input', () => {
  assert.ok(assemble([{ src: io }], 'all', { unbuffered: true }).includes('setvbuf(stdout, nullptr, _IONBF, 0)'));
  assert.ok(!assemble([{ src: io }]).includes('setvbuf'));
});

test('forward declarations are hoisted to the global section (before any main), calls and constructors are not', () => {
  const yes = ['string getName();', 'int add(int a, int b);', 'int add(int, int);', 'void f(const string& s, double x = 2.0);', 'double avg(int arr[], int n);', 'vector<int> make(vector<int>& v);', 'map<string, vector<int>> build(const vector<string>& names);'];
  const no = ['Point p(3, 4);', 'Counter c(5);', 'vector<int> v(n);', 'cout << f(x);', 'return foo(x);', 'x = foo(1);', 'foo(x);', 'cin >> f(x);', 'int y = f(2);', 'string s("abc");'];
  for (const t of yes) assert.ok(isPrototype(t), t);
  for (const t of no) assert.ok(!isPrototype(t), t);
});
test('a prototype in its own cell is visible to a main defined in the next cell', () => {
  const code = assemble([{ src: '#include <iostream>\nusing namespace std;' }, { src: 'string getName();' }, { src: 'int main() { cout << getName(); }' }, { src: 'string getName() { return "x"; }' }], 'all', { tryCatch: false });
  const proto = code.indexOf('string getName();'), mainDef = code.indexOf('__nb_main_3()'), entry = code.indexOf('int main(){');
  assert.ok(proto > 0 && proto < mainDef && mainDef < entry, 'prototype is global and precedes the cell main');
  assert.ok(!code.slice(entry).includes('string getName();'), 'not repeated inside main');
});
test('a cell main that falls off its end returns 0 like a real main', () => {
  const code = assemble([{ src: 'int main() { int x = 1; }' }], 'all', { tryCatch: false });
  assert.match(code, /int __nb_main_1\(\) \{ int x = 1;\s+return 0;\/\*nb\*\/ \}/);
  assert.ok(!assemble([{ src: 'void main() { }' }], 'all').includes('return 0;/*nb*/'));
});
test('cellRuns tells running cells from declaration-only cells', () => {
  assert.equal(cellRuns('string getName() { return "x"; }'), false);
  assert.equal(cellRuns('#include <iostream>\nusing namespace std;'), false);
  assert.equal(cellRuns('string getName();'), false);
  assert.equal(cellRuns('int main() { }'), true);
  assert.equal(cellRuns('int x = 1;'), true);
});
