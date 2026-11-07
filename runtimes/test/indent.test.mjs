import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import path from 'node:path';

const out = await build({ absWorkingDir: path.join(import.meta.dirname, '..'), entryPoints: ['matlab/src/indent.ts'], bundle: true, write: false, format: 'esm' });
const mod = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
const { levelAfterLine, levelOfLine, lineWords } = mod;

test('block openers indent the next line, end dedents', () => {
  const src = ['for i=1:3', 'if i>1', 'disp(i)', 'end', 'end'];
  assert.equal(levelAfterLine(src, 0), 1);
  assert.equal(levelAfterLine(src, 1), 2);
  assert.equal(levelOfLine(src, 3), 1);
  assert.equal(levelOfLine(src, 4), 0);
  assert.equal(levelAfterLine(src, 4), 0);
});
test('else/elseif sit one level out; switch/case nest two levels', () => {
  const a = ['if x', 'y=1', 'else', 'y=2', 'end'];
  assert.equal(levelOfLine(a, 2), 0); assert.equal(levelAfterLine(a, 2), 1);
  const s = ['switch k', 'case 1', 'a=1', 'case 2', 'a=2', 'otherwise', 'a=3', 'end'];
  assert.deepEqual([1, 3, 5].map((i) => levelOfLine(s, i)), [1, 1, 1]);
  assert.equal(levelAfterLine(s, 1), 2);
  assert.equal(levelOfLine(s, 7), 0);
});
test('end inside brackets, strings and comments is ignored', () => {
  assert.deepEqual(lineWords("x = a(end) % end"), ['x', 'a']);
  assert.deepEqual(lineWords("s = 'end'; t = a'"), ['s', 't', 'a']);
  assert.equal(levelAfterLine(['if a(end)==1'], 0), 1);
  assert.equal(levelAfterLine(['if x, y=1, end'], 0), 0);
});

test('indent guides: blank lines inherit the smaller neighbouring indent', async () => {
  const out = await build({ absWorkingDir: path.join(import.meta.dirname, '..'), entryPoints: ['shared/indent-guides.ts'], bundle: true, write: false, format: 'esm', platform: 'neutral', external: ['@codemirror/*'] });
  const g = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text.replace(/from "(@codemirror\/[^"]+)"/g, (_, m) => `from "${import.meta.resolve(m)}"`)).toString('base64'));
  assert.deepEqual(g.guideLevels(['if x', '    a', '', '        b', 'end'], 4, 4), [0, 1, 1, 2, 0]);
});
