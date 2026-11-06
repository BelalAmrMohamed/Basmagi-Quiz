import { mountNotebookShell } from './notebook-shell.js';
import { createCppEditor } from './editor.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../../public/src/shared/public-config.js';
import './style.css';

declare global { interface Window { BasmagiCppNotebook?: { mount: typeof mount }; __mlweb?: { addFile: (file: File) => Promise<void> }; } }
type Args = { root: HTMLElement; notebook: { id: string; cells: any[] }; lang?: string; mode?: string; onChange?: (cells: any[])=>void; onNotice?: (message:string)=>void; onInfo?: ()=>void };
async function execute({cells,target,signal}:{cells:Array<{src:string;stdin?:string}>;target:number|'all';signal:AbortSignal}) {
  const response=await fetch(`${SUPABASE_URL}/functions/v1/cpp-run`,{method:'POST',headers:{apikey:SUPABASE_ANON_KEY,Authorization:`Bearer ${SUPABASE_ANON_KEY}`,'content-type':'application/json'},body:JSON.stringify({cells,target}),signal});
  const data=await response.json().catch(()=>({}));
  if(!response.ok){const error=typeof data.error==='string'?data.error:`Compiler service returned HTTP ${response.status}.`;throw new Error(error);}
  return data;
}
export function mount(opts:Args){
  window.__mlweb={addFile:async()=>{}};
  const shell=mountNotebookShell({root:opts.root,notebook:opts.notebook,lang:opts.lang||'en',mode:opts.mode,onChange:opts.onChange,onNotice:opts.onNotice,onInfo:opts.onInfo,createCodeEditor:createCppEditor,run:execute});
  return {...shell,destroy(){shell.destroy();if(window.__mlweb)delete window.__mlweb;}};
}
window.BasmagiCppNotebook={mount};
