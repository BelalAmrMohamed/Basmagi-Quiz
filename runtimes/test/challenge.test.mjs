// Challenge grading (pure logic) and the shell wiring: pass/fail banner, reset, stdin lock, hash.
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const root = path.join(import.meta.dirname, '..');
const out = path.join(mkdtempSync(path.join(tmpdir(), 'ch-')), 'b.mjs');
await build({ entryPoints: [path.join(root, 'shared/challenge.ts')], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent' });
const { matches, normalizeOutput, gradeCell, actualOutput, differingLines, cleanChallenge } = await import(pathToFileURL(out).href);

test('normalizeOutput: CRLF, trailing spaces, trailing blank lines', () => {
  assert.equal(normalizeOutput('a  \r\nb\t\r\n\r\n\n'), 'a\nb');
});
test('default (trimmed) mode ignores accidental whitespace but not content', () => {
  const ch = { expectedOutput: 'Hello\nWorld' };
  assert.ok(matches(ch, 'Hello  \r\nWorld\n\n'));
  assert.ok(!matches(ch, 'Hello\n World'));
  assert.ok(!matches(ch, 'hello\nWorld'));
  assert.ok(!matches(ch, ''));
});
test('exact mode only normalizes CRLF', () => {
  const ch = { expectedOutput: 'a\nb\n', matchMode: 'exact' };
  assert.ok(matches(ch, 'a\r\nb\n'));
  assert.ok(!matches(ch, 'a\nb'));
});
test('numeric mode: tolerance on numbers, exact on words', () => {
  const ch = { expectedOutput: 'x =\n   3.14159', matchMode: 'numeric', tolerance: 0.001 };
  assert.ok(matches(ch, 'x =\n 3.1416'));
  assert.ok(!matches(ch, 'x =\n 3.2'));
  assert.ok(!matches(ch, 'y =\n 3.1416'));
  assert.ok(matches({ expectedOutput: '1 2 3', matchMode: 'numeric' }, '1.0000000 2 3'));
  assert.ok(!matches({ expectedOutput: '1 2 3', matchMode: 'numeric' }, '1 2'));
});
test('regex mode is anchored and survives bad patterns', () => {
  const ch = { expectedOutput: 'Total: \\d+', matchMode: 'regex' };
  assert.ok(matches(ch, 'Total: 42\n'));
  assert.ok(!matches(ch, 'Total: 42 items'));
  assert.ok(!matches({ expectedOutput: '(', matchMode: 'regex' }, '('));
});
test('gradeCell uses text outputs only and reports errors', () => {
  const ch = { expectedOutput: '5' };
  const outs = [{ k: 'text', s: '5\n' }, { k: 'warn', s: 'careful' }];
  assert.equal(actualOutput(outs), '5\n');
  assert.equal(gradeCell(ch, outs, false).state, 'pass');
  assert.equal(gradeCell(ch, [{ k: 'text', s: '6\n' }], false).state, 'fail');
  assert.equal(gradeCell(ch, outs, true).state, 'error');
});
test('differingLines and cleanChallenge', () => {
  assert.deepEqual([...differingLines('a\nb\nc', 'a\nX\nc')], [1]);
  assert.deepEqual(cleanChallenge({ expectedOutput: 'x', bogus: 1, matchMode: 'nope', tolerance: 1, hint: ' ' }), { expectedOutput: 'x' });
  assert.equal(cleanChallenge({ expectedOutput: 'x', hideSolution: true }).hideSolution, true);
  assert.equal(cleanChallenge(null), undefined);
});
