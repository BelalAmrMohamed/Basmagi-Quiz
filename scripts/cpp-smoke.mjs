import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../public/src/shared/public-config.js';
const endpoint = `${process.env.SUPABASE_URL || SUPABASE_URL}/functions/v1/cpp-run`;
const key = process.env.SUPABASE_ANON_KEY || SUPABASE_ANON_KEY;
const cases = [
  { name: 'hello world', cells: [{src:'#include <iostream>\nstd::cout << "hello";'}], target:'all', test:r=>r.sections[0]?.stdout.includes('hello') },
  { name: '2D array', cells: [{src:'#include <iostream>\nint a[2][2]={{1,2},{3,4}}; std::cout << a[1][1];'}], target:'all', test:r=>r.sections[0]?.stdout.includes('4') },
  { name: '3D array', cells: [{src:'#include <iostream>\nint a[2][2][2]={{{1,2},{3,4}},{{5,6},{7,8}}}; std::cout << a[1][0][1];'}], target:'all', test:r=>r.sections[0]?.stdout.includes('6') },
  { name: 'virtual dispatch', cells: [{src:'#include <iostream>\nstruct Base{virtual int f()const=0;virtual ~Base()=default;}; struct Child:Base{int f()const override{return 9;}};'},{src:'Child c; Base* p=&c; std::cout << p->f();'}], target:'all', test:r=>r.sections[1]?.stdout.includes('9') },
  { name: 'cin input', cells: [{src:'#include <iostream>\nint n; std::cin >> n; std::cout << n*2;',stdin:'21'}], target:'all', test:r=>r.sections[0]?.stdout.includes('42') },
  { name: 'diagnostic mapping', cells: [{src:'#include <iostream>\nint main(){\n  this is not valid C++;\n}'}], target:'all', test:r=>!r.ok && /cell-1:3/.test(r.compile) },
];
let failed=0;
for (const c of cases) {
 const response=await fetch(endpoint,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'content-type':'application/json'},body:JSON.stringify({cells:c.cells,target:c.target})});
 const result=await response.json();
 console.log(`\n--- ${c.name} [HTTP ${response.status}] ---`);console.log(JSON.stringify(result,null,2));
 if(!response.ok||!c.test(result)){console.error(`FAIL: ${c.name}`);failed++;}
}
if(failed)process.exitCode=1;else console.log('\nAll C++ runtime smoke cases passed.');
