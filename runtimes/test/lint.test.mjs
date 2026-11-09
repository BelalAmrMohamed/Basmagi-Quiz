// Live-lint tests: MATLAB scanner and C++ Lezer-tree linter.
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const root = path.join(import.meta.dirname, '..');
const out = path.join(mkdtempSync(path.join(tmpdir(), 'lint-')), 'b.mjs');
await build({
  stdin: { contents: "export { scanMatlab } from './matlab/src/lint'; export { cppLint } from './cpp/src/lint'; export { cpp } from '@codemirror/lang-cpp'; export { EditorState } from '@codemirror/state';", resolveDir: root, loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent',
});
const { scanMatlab, cppLint, cpp, EditorState } = await import(pathToFileURL(out).href);
const M = { unmatched: (c) => `un${c}`, unclosed: (c) => `open${c}`, mismatch: (o, c) => `${o}${c}`, string: 'str' };
const msgs = (s) => scanMatlab(s, M).map((d) => d.message);

test('matlab: valid code is clean', () => {
  assert.deepEqual(msgs("x = [1 2 3]';\ny = a' * b';\ns = 'it''s';\nz = {1, 'a b'}; % (comment\nf(x(1), [2 3])"), []);
  assert.deepEqual(msgs("[a 'x']\nA = [1 2 ...\n 3 4];\n%{\n( unclosed in block\n%}\n"), []);
});
test('matlab: bracket and string errors', () => {
  assert.deepEqual(msgs('y = (1 + 2'), ['open(']);
  assert.deepEqual(msgs('y = 1 + 2)'), ['un)']);
  assert.deepEqual(msgs('y = [1 2)'), ['open[', '[)']);
  assert.deepEqual(msgs("disp('hello"), ['open(', 'str']);
  assert.deepEqual(msgs('x = (1\ny = 2'), ['open(']);
});

const cppDiags = (src) => cppLint('Syntax error')(EditorState.create({ doc: src, extensions: [cpp()] }));
test('cpp: valid code is clean', () => {
  assert.equal(cppDiags('#include <iostream>\nint main() {\n  int x = 1;\n  return x;\n}\n').length, 0);
});
test('cpp: broken code reports syntax errors', () => {
  assert.ok(cppDiags('int main() {\n  int x = 1\n  return x;\n}\n').length > 0);
  assert.ok(cppDiags('int main() {\n  foo(1, 2;\n}\n').length > 0);
  assert.ok(cppDiags('int main() {\n  return 0;\n').length > 0);
});
