import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import path from 'node:path';

const out = await build({ absWorkingDir: path.join(import.meta.dirname, '..'), entryPoints: ['matlab/src/completions.ts'], bundle: true, write: false, format: 'esm' });
const { scanNotebook, lineContext, matlabCompletions } = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
const { EditorState } = await import('@codemirror/state');

test('scanNotebook finds assigned vars, loop vars, functions and their args', () => {
  const r = scanNotebook(['a = 1; % b = 2\nfor k = 1:3\nend\n[p, q] = size(a);\nfunction [o1] = foo(in1, in2)\nend']);
  assert.deepEqual([...r.vars].sort(), ['a', 'in1', 'in2', 'k', 'o1', 'p', 'q']);
  assert.deepEqual([...r.functions], ['foo']);
});
test('lineContext tells strings, comments, transpose', () => {
  assert.equal(lineContext("x = 1 % hi").kind, 'comment');
  assert.equal(lineContext("imread('te").kind, 'string');
  assert.equal(lineContext("y = a'").kind, 'code');
});
function run(src, host) {
  const [ids, files] = matlabCompletions(host);
  const state = EditorState.create({ doc: src });
  const ctx = { state, pos: src.length, explicit: false, matchBefore: (re) => { const m = src.match(new RegExp('(?:' + re.source + ')$')); return m ? { from: src.length - m[0].length, to: src.length, text: m[0] } : null; } };
  return { ids: ids(ctx), files: files(ctx) };
}
test('identifier source offers workspace vars, notebook names, signatures; file source only in file calls', () => {
  const host = { workspace: () => [{ name: 'img', cls: 'uint8', size: '4x4x3', bytes: 1 }], codeSources: () => ['mine = 3'], fileNames: () => ['test.png'] };
  const r = run('re', host).ids;
  const labels = r.options.map((o) => o.label);
  for (const l of ['img', 'mine', 'rgb2gray', 'if', 'pi']) assert.ok(labels.includes(l), l);
  assert.equal(r.options.find((o) => o.label === 'rgb2gray').detail, 'rgb2gray(A)');
  assert.equal(run("imread('te", host).files.options[0].label, 'test.png');
  assert.equal(run("disp('te", host).files, null);
  assert.equal(run('s.fi', host).ids, null);
});
