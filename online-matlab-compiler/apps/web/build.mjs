// Host build for the notebook runtime.
//
// GENERATED OUTPUT — do not hand-edit anything under public/assets/notebook-runtime/.
// Regenerate with (from the repo root):  npm run build:notebook-runtime
//
// Emits, for the Basmagi-Quiz host site (no standalone deployment):
//   runtime.js            IIFE bundle exposing window.MLWebNotebook.mount(opts)
//   runtime.css           styles scoped under the `.mlweb` root class
//   worker.js             the Web Worker running the MATLAB-style interpreter
//   assets/<name>.json    one sample image per file (loaded on demand by the runtime)
//   assets/manifest.json  list of available asset names
import { build, transform } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

const here = import.meta.dirname;
const out = path.resolve(here, '../../../public/assets/notebook-runtime');
rmSync(out, { recursive: true, force: true });
mkdirSync(path.join(out, 'assets'), { recursive: true });

const common = { bundle: true, write: false, format: 'iife', target: 'es2022', minify: true, legalComments: 'none' };
const [worker, runtime] = await Promise.all([
  build({ ...common, entryPoints: [path.join(here, 'src/worker.ts')] }),
  build({ ...common, entryPoints: [path.join(here, 'src/main.ts')] }),
]);
writeFileSync(path.join(out, 'worker.js'), worker.outputFiles[0].text);
writeFileSync(path.join(out, 'runtime.js'), runtime.outputFiles[0].text);

// CSS: theme variables are already host-scoped; everything after the marker is nested under `.mlweb`.
const src = readFileSync(path.join(here, 'src/style.css'), 'utf8');
const [head, scoped] = src.split('/*SCOPED*/');
const css = await transform(`${head}\n.mlweb {\n${scoped}\n}\n`, { loader: 'css', target: 'chrome90', minify: true });
writeFileSync(path.join(out, 'runtime.css'), css.code);

const assets = JSON.parse(readFileSync(path.join(here, 'assets/assets.json'), 'utf8'));
const names = Object.keys(assets).sort();
for (const name of names) writeFileSync(path.join(out, 'assets', name + '.json'), JSON.stringify(assets[name]));
writeFileSync(path.join(out, 'assets/manifest.json'), JSON.stringify(names));

const kb = f => (readFileSync(path.join(out, f)).length / 1024).toFixed(0) + ' KB';
console.log(`notebook-runtime -> ${path.relative(process.cwd(), out) || out} | runtime.js ${kb('runtime.js')} | runtime.css ${kb('runtime.css')} | worker.js ${kb('worker.js')} | ${names.length} assets`);
