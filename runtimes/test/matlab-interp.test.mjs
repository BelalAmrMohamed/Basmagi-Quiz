import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const tsxCli = path.join(root, 'matlab/interp/node_modules/tsx/dist/cli.mjs');
const runTs = path.join(root, 'matlab/interp/test/run.ts');

test('MATLAB interpreter test suite passes', () => {
  const r = spawnSync(process.execPath, [tsxCli, runTs], {
    cwd: path.join(root, 'matlab/interp'),
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, `matlab-interp tests failed:\n${r.stdout}\n${r.stderr}`);
});
