// Times every hop of the C++ run path so a slow or failing link is obvious.
//   node scripts/cpp-run-probe.mjs                 # Wandbox + the deployed Edge Function
//   PISTON_TOKEN=... node scripts/cpp-run-probe.mjs # also probes Piston
// Needs outbound internet. Nothing is written or changed.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../public/src/shared/public-config.js';
import { assemble } from '../supabase/functions/cpp-run/assemble.js';

const HELLO = '#include <iostream>\n\nusing namespace std;\n\nint main(){\n    cout << "Hello World";\n    return 0;\n}\n';
const program = assemble([{ src: HELLO, stdin: '' }], 'all');

async function probe(name, url, init, ms = 30000) {
  const t = performance.now();
  try {
    const r = await fetch(url, { ...init, signal: AbortSignal.timeout(ms) });
    const text = await r.text();
    console.log(`${name.padEnd(30)} HTTP ${r.status}  ${(performance.now() - t).toFixed(0)} ms  ${text.length} bytes`);
    return { r, text };
  } catch (e) {
    console.log(`${name.padEnd(30)} FAILED (${e.name}: ${e.message})  after ${(performance.now() - t).toFixed(0)} ms`);
  }
}
const json = (body, headers = {}) => ({ method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

await probe('wandbox list.json', 'https://wandbox.org/api/list.json');
const w = await probe('wandbox compile (gcc-head)', 'https://wandbox.org/api/compile.json', json({ compiler: 'gcc-head', code: program, 'compiler-option-raw': '-std=c++17\n-Wall\n-Wextra\n-O1', stdin: '', save: false }));
if (w) console.log('  ->', w.text.slice(0, 300).replace(/\s+/g, ' '));
if (process.env.PISTON_TOKEN) {
  const p = await probe('piston execute', 'https://emkc.org/api/v2/piston/execute', json({ language: 'c++', version: '*', files: [{ content: program }], stdin: '' }, { authorization: `Bearer ${process.env.PISTON_TOKEN}` }));
  if (p) console.log('  ->', p.text.slice(0, 300).replace(/\s+/g, ' '));
} else console.log('piston                         skipped (set PISTON_TOKEN to probe it)');
const f = await probe('edge function cpp-run', `${process.env.SUPABASE_URL || SUPABASE_URL}/functions/v1/cpp-run`, json({ cells: [{ src: HELLO, stdin: '' }], target: 'all' }, { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${SUPABASE_ANON_KEY}` }));
if (f) console.log('  ->', f.text.slice(0, 400));
