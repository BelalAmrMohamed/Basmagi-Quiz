import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
await mkdir('../../public/assets/notebook-runtime-cpp',{recursive:true});
await build({entryPoints:['src/index.ts'],bundle:true,minify:true,format:'iife',globalName:'BasmagiCppRuntime',outfile:'../../public/assets/notebook-runtime-cpp/runtime.js',loader:{'.css':'css'},define:{'process.env.NODE_ENV':'"production"'}});
