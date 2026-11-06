// =============================================================================
// runtimes/build.mjs
// Builds every notebook runtime from its readable source in this folder into
// public/assets/. The files in public/assets/notebook-runtime*/ are GENERATED:
// never edit them by hand, edit the sources here and run `npm run build:runtimes`.
//
//   node build.mjs          build all targets
//   node build.mjs cpp      build one target
//
// After a build it writes runtimes/build-info.json (a hash of all runtime sources)
// so a test can detect "sources changed but the bundle was not rebuilt".
// =============================================================================
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = import.meta.dirname;
const assets = path.resolve(here, '../public/assets');

/** One entry per runtime. `skip` = not migrated yet; its committed bundle is left untouched. */
const TARGETS = {
  cpp: {
    entry: 'cpp/src/index.ts',
    outDir: 'notebook-runtime-cpp',
    globalName: 'BasmagiCppRuntime',
  },
  matlab: {
    skip: 'MATLAB source is migrated in Phase 3; public/assets/notebook-runtime/ stays as committed until then.',
  },
};

// Everything that can change a bundle's content. Add new source roots here.
const SOURCE_ROOTS = ['shared', 'cpp/src', 'matlab/src', 'matlab/interp/src'];
const SOURCE_FILES = ['package.json', 'package-lock.json', 'build.mjs', 'tsconfig.json'];

async function runTarget(name, t) {
  if (t.skip) { console.log(`- ${name}: skipped (${t.skip})`); return; }
  const outDir = path.join(assets, t.outDir);
  await mkdir(outDir, { recursive: true });
  await build({
    absWorkingDir: here,
    entryPoints: [t.entry],
    bundle: true,
    minify: true,
    format: 'iife',
    globalName: t.globalName,
    outfile: path.join(outDir, 'runtime.js'),
    loader: { '.css': 'css' },
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  console.log(`- ${name}: built -> public/assets/${t.outDir}/`);
}

async function listFiles(dir) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return []; }
  const files = [];
  for (const e of entries) {
    if (e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) files.push(...await listFiles(p));
    else files.push(p);
  }
  return files;
}

/** SHA-256 over all sources. Line endings are normalised so Windows (CRLF) and Linux give the same hash. */
export async function hashSources() {
  const files = [...SOURCE_FILES.map((f) => path.join(here, f))];
  for (const r of SOURCE_ROOTS) files.push(...await listFiles(path.join(here, r)));
  const hash = createHash('sha256');
  for (const f of files.sort()) {
    let text;
    try { text = await readFile(f, 'utf8'); } catch { continue; }
    hash.update(path.relative(here, f).split(path.sep).join('/') + '\n');
    hash.update(text.replace(/\r\n/g, '\n') + '\n');
  }
  return hash.digest('hex');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const only = process.argv[2];
  if (only && !TARGETS[only]) { console.error(`Unknown target "${only}". Targets: ${Object.keys(TARGETS).join(', ')}`); process.exit(1); }
  for (const [name, t] of Object.entries(TARGETS)) if (!only || only === name) await runTarget(name, t);
  const info = { sourcesSha256: await hashSources(), builtTargets: Object.entries(TARGETS).filter(([, t]) => !t.skip).map(([n]) => n) };
  await writeFile(path.join(here, 'build-info.json'), JSON.stringify(info, null, 2) + '\n');
  console.log('build-info.json written');
}
