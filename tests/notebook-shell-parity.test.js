// tests/notebook-shell-parity.test.js
// Regression + parity coverage: verifies that both runtimes expose the
// same surface (a .mount function) and that the C++ runtime's source
// delegates to mountNotebookShell rather than re-implementing the shell.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('MATLAB built artifact exposes MLWebNotebook.mount', () => {
  const artifactPath = resolve(ROOT, 'public/assets/notebook-runtime/runtime.js');
  assert.ok(existsSync(artifactPath), `MATLAB runtime artifact missing: ${artifactPath}`);
  const src = readFileSync(artifactPath, 'utf8');
  assert.ok(
    src.includes('MLWebNotebook') && src.includes('mount'),
    'MLWebNotebook.mount not found in built MATLAB runtime artifact'
  );
});

test('C++ built artifact exposes BasmagiCppNotebook.mount', () => {
  const artifactPath = resolve(ROOT, 'public/assets/notebook-runtime-cpp/runtime.js');
  assert.ok(existsSync(artifactPath), `C++ runtime artifact missing: ${artifactPath}`);
  const src = readFileSync(artifactPath, 'utf8');
  assert.ok(
    src.includes('BasmagiCppNotebook') && src.includes('mount'),
    'BasmagiCppNotebook.mount not found in built C++ runtime artifact'
  );
});

test('C++ source delegates to mountNotebookShell (not a reimplementation)', () => {
  const shellSrc = resolve(ROOT, 'runtimes/cpp/src/notebook-shell.ts');
  const indexSrc = resolve(ROOT, 'runtimes/cpp/src/index.ts');
  assert.ok(existsSync(shellSrc), 'notebook-shell.ts missing');
  assert.ok(existsSync(indexSrc), 'runtimes/cpp/src/index.ts missing');
  const indexContent = readFileSync(indexSrc, 'utf8');
  assert.ok(
    indexContent.includes('mountNotebookShell'),
    'runtimes/cpp/src/index.ts must call mountNotebookShell'
  );
  const shellContent = readFileSync(shellSrc, 'utf8');
  assert.ok(
    shellContent.includes('export function mountNotebookShell'),
    'notebook-shell.ts must export mountNotebookShell'
  );
});

test('mountNotebookShell accepts required option keys (contract check)', () => {
  const shellSrc = resolve(ROOT, 'runtimes/cpp/src/notebook-shell.ts');
  const src = readFileSync(shellSrc, 'utf8');
  // Verify the documented interface fields are present in the source
  for (const field of ['root', 'notebook', 'lang', 'mode', 'onChange', 'onNotice', 'onInfo', 'createCodeEditor', 'run']) {
    assert.ok(src.includes(field), `mountNotebookShell option "${field}" not found in notebook-shell.ts`);
  }
});

test('both runtimes are listed in RUNTIME_CONFIG with global and base fields', async () => {
  const { RUNTIME_CONFIG } = await import('../public/src/shared/runtime-config.js');
  for (const id of ['matlab', 'cpp']) {
    const cfg = RUNTIME_CONFIG[id];
    assert.ok(cfg, `RUNTIME_CONFIG missing entry for "${id}"`);
    assert.ok(typeof cfg.global === 'string' && cfg.global.length > 0, `RUNTIME_CONFIG.${id}.global must be a non-empty string`);
    assert.ok(typeof cfg.base === 'string' && cfg.base.startsWith('/'), `RUNTIME_CONFIG.${id}.base must start with /`);
    assert.ok(typeof cfg.kernel === 'string' && cfg.kernel.length > 0, `RUNTIME_CONFIG.${id}.kernel must be a non-empty string`);
  }
});

test('C++ runtime sets window.__mlweb shim on mount to satisfy workspace bridge', () => {
  const indexSrc = resolve(ROOT, 'runtimes/cpp/src/index.ts');
  const src = readFileSync(indexSrc, 'utf8');
  assert.ok(src.includes('__mlweb'), 'C++ index.ts must set window.__mlweb shim');
  assert.ok(src.includes('addFile'), '__mlweb shim must include addFile to satisfy the workspace bridge');
});

test('notebook-shell.ts renders toolbar-menu-items class (menu injection contract)', () => {
  const shellSrc = resolve(ROOT, 'runtimes/cpp/src/notebook-shell.ts');
  const src = readFileSync(shellSrc, 'utf8');
  assert.ok(
    src.includes('toolbar-menu-items'),
    'notebook-shell.ts must render an element with class "toolbar-menu-items" for menu injection compatibility'
  );
});

test('notebook-shell.ts calls onInfo hook (Notebook info menu entry)', () => {
  const shellSrc = resolve(ROOT, 'runtimes/cpp/src/notebook-shell.ts');
  const src = readFileSync(shellSrc, 'utf8');
  assert.ok(src.includes('onInfo'), 'notebook-shell.ts must wire the onInfo hook');
});

test('notebook-shell.ts supports RTL layout for Arabic lang', () => {
  const shellSrc = resolve(ROOT, 'runtimes/cpp/src/notebook-shell.ts');
  const src = readFileSync(shellSrc, 'utf8');
  assert.ok(src.includes("lang==='ar'") || src.includes("lang === 'ar'"), 'notebook-shell.ts must set RTL direction for Arabic');
});

test('notebook-shell.ts adds hover class on mouseenter (cell hover parity)', () => {
  const shellSrc = resolve(ROOT, 'runtimes/cpp/src/notebook-shell.ts');
  const src = readFileSync(shellSrc, 'utf8');
  assert.ok(
    src.includes('mouseenter') && src.includes('is-hovered'),
    'notebook-shell.ts must add is-hovered class on mouseenter for cell hover parity with MATLAB shell'
  );
  assert.ok(
    src.includes('mouseleave'),
    'notebook-shell.ts must remove is-hovered class on mouseleave'
  );
});

test('style.css defines hover ring for .nb-cell.is-hovered', () => {
  const cssPath = resolve(ROOT, 'runtimes/cpp/src/style.css');
  assert.ok(existsSync(cssPath), 'runtimes/cpp/src/style.css missing');
  const src = readFileSync(cssPath, 'utf8');
  assert.ok(
    src.includes('is-hovered'),
    'style.css must define styles for .nb-cell.is-hovered'
  );
  assert.ok(
    src.includes('--nb-ring'),
    'style.css hover ring must reference --nb-ring token'
  );
});
