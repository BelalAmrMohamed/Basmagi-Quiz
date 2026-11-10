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
const { assemble } = await import('data:text/javascript;base64,' + Buffer.from(out).toString('base64'));

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
