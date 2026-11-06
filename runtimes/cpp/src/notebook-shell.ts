import { marked } from 'marked';
import DOMPurify from 'dompurify';

export type NotebookCell = { id: string; type: 'code' | 'markdown'; source: string; stdin?: string };
export type RunSection = { stdout?: string; stderr?: string };
export type RunResponse = { ok: boolean; compile?: string; sections?: RunSection[]; exit?: number; timeMs?: number; provider?: string; truncated?: boolean };
type EditorHandle = { destroy(): void; focus(): void; focusLine?(line: number): void };
type NotebookShellOptions = {
  root: HTMLElement; notebook: { id: string; cells: NotebookCell[] }; lang: string; mode?: string;
  onChange?: (cells: NotebookCell[]) => void; onNotice?: (message: string) => void; onInfo?: () => void;
  createCodeEditor: (args: { host: HTMLElement; source: string; onChange: (source: string) => void; onRunAdvance: () => void; onRunStay: () => void }) => EditorHandle;
  run: (args: { cells: Array<{ src: string; stdin?: string }>; target: number | 'all'; signal: AbortSignal }) => Promise<RunResponse>;
};
const copy = (cells: NotebookCell[]) => cells.map(c => ({ ...c }));
const tr = (lang: string, en: string, ar: string) => lang === 'ar' ? ar : en;
const download = (name: string, body: string) => { const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([body],{type:'application/json'}));a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1500); };

/** Runtime-neutral notebook UI. Language adapters provide only CodeMirror and execution. */
export function mountNotebookShell(opts: NotebookShellOptions) {
  const { root, notebook, lang } = opts, mode=opts.mode||'view', storeKey=`basmagi:nb:${notebook.id}:v1`;
  let cells=copy(notebook.cells||[]), activeController:AbortController|null=null;
  if(mode!=='edit')try{const saved=JSON.parse(localStorage.getItem(storeKey)||'null');if(Array.isArray(saved?.cells))cells=saved.cells;}catch{}
  const editors=new Map<string,EditorHandle>(), outputs=new Map<string,{stdout:HTMLPreElement;stderr:HTMLPreElement;status:HTMLElement;diagnostics:HTMLElement}>();
  const shell=document.createElement('div');shell.className='nb-shell';shell.dir=lang==='ar'?'rtl':'ltr';root.replaceChildren(shell);
  const notify=(message:string)=>opts.onNotice?.(message);
  const save=()=>{const value=copy(cells);opts.onChange?.(value);if(mode!=='edit')try{localStorage.setItem(storeKey,JSON.stringify({cells:value}));}catch{notify(tr(lang,'Could not save edits on this device.','تعذر حفظ التعديلات على هذا الجهاز.'));}};
  const codeCells=()=>cells.map((cell,index)=>({cell,index})).filter(x=>x.cell.type==='code');
  const codeOrdinal=(index:number)=>codeCells().findIndex(x=>x.index===index)+1;
  const button=(text:string,action:()=>void,cls='')=>{const b=document.createElement('button');b.type='button';b.textContent=text;if(cls)b.className=cls;b.addEventListener('click',action);return b;};
  const refreshEditors=()=>{for(const editor of editors.values())editor.destroy();editors.clear();outputs.clear();render();};
  const requestStdin=(item:{cell:NotebookCell;index:number},ordinal:number)=>new Promise<string|null>(resolve=>{
    const dialog=document.createElement('dialog');dialog.className='nb-stdin-dialog';
    const form=document.createElement('form');form.method='dialog';
    const heading=document.createElement('h2');heading.textContent=tr(lang,`Standard input · Cell ${ordinal}`,`الإدخال القياسي · الخلية ${ordinal}`);
    const description=document.createElement('p');description.textContent=tr(lang,'Enter the lines this cell reads from cin. Each cell gets its own input.','أدخل الأسطر التي تقرؤها هذه الخلية عبر cin. لكل خلية إدخال مستقل.');
    const label=document.createElement('label');label.htmlFor=`cpp-stdin-${item.cell.id}`;label.textContent=tr(lang,'Input for this cell','إدخال هذه الخلية');
    const textarea=document.createElement('textarea');textarea.id=label.htmlFor;textarea.dir='ltr';textarea.rows=6;textarea.maxLength=4000;textarea.value=item.cell.stdin||'';
    const actions=document.createElement('div');actions.className='nb-dialog-actions';
    const cancel=button(tr(lang,'Cancel','إلغاء'),()=>dialog.close('cancel'));
    const submit=button(tr(lang,'Run cell','تشغيل الخلية'),()=>{});
    submit.type='submit';submit.className='nb-run-all';actions.append(cancel,submit);form.append(heading,description,label,textarea,actions);dialog.append(form);shell.append(dialog);
    dialog.addEventListener('close',()=>{const value=dialog.returnValue==='run'?textarea.value:null;dialog.remove();resolve(value);},{once:true});
    form.addEventListener('submit',event=>{event.preventDefault();dialog.close('run');});
    dialog.showModal();textarea.focus();
  });
  const run=async(target:number|'all')=>{
    const active=codeCells().filter(x=>x.cell.source.trim());
    if(target!=='all'&&cells[target]?.type==='code'&&!cells[target].source.trim()){outputs.get(cells[target].id)?.status&&(outputs.get(cells[target].id)!.status.textContent=tr(lang,'Empty cell skipped','تم تجاوز الخلية الفارغة'));return;}
    if(!active.length)return;
    const targetActive=target==='all'?'all':active.findIndex(x=>x.index===target);
    if(targetActive!=='all'&&targetActive<0)return;
    const selected=targetActive==='all'?active:[active[targetActive as number]];
    for(const item of selected){
      // Ask at run time, like a notebook stdin request, and scope input to one cell.
      if(!/(?:\bstd\s*::\s*)?\bcin\b/.test(item.cell.source))continue;
      const value=await requestStdin(item,codeOrdinal(item.index));
      if(value===null)return;
      item.cell.stdin=value;save();
    }
    activeController?.abort();const controller=new AbortController();activeController=controller;let timedOut=false;const timeout=window.setTimeout(()=>{timedOut=true;controller.abort();},25000);
    for(const item of active){const output=outputs.get(item.cell.id);if(output){output.status.textContent=tr(lang,'Compiling…','جارٍ التجميع…');output.status.className='nb-run-status is-running';output.diagnostics.replaceChildren();}}
    shell.querySelectorAll<HTMLButtonElement>('[data-run]').forEach(b=>b.disabled=true);
    const stop=shell.querySelector<HTMLButtonElement>('[data-stop]');if(stop)stop.hidden=false;
    try{
      const result=await opts.run({cells:active.map(x=>({src:x.cell.source,stdin:x.cell.stdin||''})),target:targetActive,signal:controller.signal});
      const sections=result.sections||[];
      active.forEach((item,i)=>{if(targetActive!=='all'&&i!==targetActive)return;const output=outputs.get(item.cell.id);if(!output)return;const section=sections[targetActive==='all'?i:0]||{};output.stdout.textContent=section.stdout||'';output.stderr.textContent=section.stderr||'';output.status.textContent=!result.ok?tr(lang,'Compile error', 'خطأ في التجميع'):`${tr(lang,'Exit','الخروج')} ${result.exit??0} · ${result.timeMs??0}ms · ${result.provider||''}${result.truncated?' · output truncated':''}`;output.status.className='nb-run-status';});
      if(result.compile){const targetOutput=targetActive==='all'?active:active.filter((_,i)=>i===targetActive);for(const item of targetOutput){const details=document.createElement('details');details.className='nb-compiler-details';const summary=document.createElement('summary');summary.textContent=tr(lang,'Compiler messages','رسائل المترجم');const pre=document.createElement('pre');pre.dir='ltr';pre.textContent=result.compile.replace(/cell-(\d+):(\d+)(?::\d+)?/g,(_,k,line)=>`Cell ${k}, line ${line}`);details.append(summary,pre);const match=/cell-(\d+):(\d+)/.exec(result.compile);if(match){const k=Number(match[1])-1,code=active[k],line=Number(match[2]);if(code){details.append(button(`Cell ${code.index+1}, line ${line}`,()=>editors.get(code.cell.id)?.focusLine?.(line)));}}outputs.get(item.cell.id)?.diagnostics.append(details);}}
    }catch(error){if((error as Error)?.name!=='AbortError'){const message=(error as Error)?.message||tr(lang,'Compiler request failed.','فشل طلب المترجم.');notify(message);const output=target==='all'?active:active.filter(x=>x.index===target);for(const item of output){const status=outputs.get(item.cell.id)?.status;if(status){status.textContent=message;status.className='nb-run-status is-error';}}}}
    finally{if(activeController===controller)activeController=null;shell.querySelectorAll<HTMLButtonElement>('[data-run]').forEach(b=>b.disabled=false);if(stop)stop.hidden=true;}
  };
  const addCell=(type:'code'|'markdown',at=cells.length)=>{const cell:NotebookCell={id:crypto.randomUUID(),type,source:type==='markdown'?'## Heading':'',...(type==='code'?{stdin:''}:{})};cells.splice(Math.max(0,Math.min(at,cells.length)),0,cell);save();render();editors.get(cell.id)?.focus();};
  const exportIpynb=()=>{const lines=(source:string)=>source.split('\n').map((line,i,a)=>i<a.length-1?line+'\n':line);const doc={nbformat:4,nbformat_minor:5,metadata:{kernelspec:{name:'xcpp17',display_name:'C++17',language:'C++'},language_info:{name:'C++',file_extension:'.cpp',mimetype:'text/x-c++src'}},cells:cells.map(c=>c.type==='code'?{cell_type:'code',metadata:{...(c.stdin!==undefined?{stdin:c.stdin}:{})},execution_count:null,source:lines(c.source),outputs:[]}:{cell_type:'markdown',metadata:{},source:lines(c.source)})};download(`${notebook.id||'notebook'}.ipynb`,JSON.stringify(doc,null,2));};
  const clearOutputs=()=>{for(const o of outputs.values()){o.stdout.textContent='';o.stderr.textContent='';o.diagnostics.replaceChildren();o.status.textContent='';}};
  const render=()=>{
    for(const editor of editors.values())editor.destroy();editors.clear();outputs.clear();shell.replaceChildren();
    const toolbar=document.createElement('header');toolbar.className='nb-toolbar';
    toolbar.append(button(tr(lang,'+ Code','+ كود'),()=>addCell('code',selectedIndex()+1),'nb-add'),button(tr(lang,'+ Text','+ نص'),()=>addCell('markdown',selectedIndex()+1),'nb-add'),button(tr(lang,'▶ Run all','▶ تشغيل الكل'),()=>void run('all'),'nb-run-all'),button(tr(lang,'Clear outputs','مسح المخرجات'),clearOutputs,'nb-clear-outputs'));
    const isBusy=()=>!!activeController;
    const stop=button(tr(lang,'■ Stop','■ إيقاف'),()=>activeController?.abort(),'nb-stop');stop.dataset.stop='';stop.hidden=!isBusy();toolbar.append(stop);
    const menu=document.createElement('details');menu.className='toolbar-menu nb-more';const summary=document.createElement('summary');summary.textContent=tr(lang,'More','المزيد');menu.append(summary);const menuItems=document.createElement('div');menuItems.className='toolbar-menu-items';
    const item=(label:string,action:()=>void)=>{const b=button(label,()=>{menu.open=false;action();});b.setAttribute('role','menuitem');menuItems.append(b);};
    const importButton=button(tr(lang,'Import…','استيراد…'),()=>{const input=document.createElement('input');input.type='file';input.accept='.cpp,.cc,.cxx,.h,.hpp,.ipynb,.notebook.zip';input.onchange=()=>input.files?.[0]&&window.__mlwebImport?.(input.files[0]);input.click();});
    item(tr(lang,'Import…','استيراد…'),()=>importButton.click());item(tr(lang,'Export as .ipynb','تصدير كـ .ipynb'),exportIpynb);item(tr(lang,'Export notebook + files (.zip)','تصدير الدفتر والملفات (.zip)'),()=>void window.__mlwebExport?.zip?.());item(tr(lang,'Notebook info','معلومات الدفتر'),()=>opts.onInfo?.());item(tr(lang,'Help and shortcuts','المساعدة والاختصارات'),()=>showHelp());item(tr(lang,'Reset notebook','إعادة الدفتر'),()=>{if(!confirm(tr(lang,'Reset this notebook to its published version?','إعادة الدفتر إلى نسخته المنشورة؟')))return;localStorage.removeItem(storeKey);cells=copy(notebook.cells||[]);clearOutputs();save();render();});menu.append(menuItems);toolbar.append(menu);shell.append(toolbar);
    const cellList=document.createElement('div');cellList.className='nb-cells';cells.forEach((cell,index)=>cellList.append(renderCell(cell,index)));shell.append(cellList);
  };
  function selectedIndex(){const selected=shell.querySelector<HTMLElement>('.nb-cell.is-selected');return Number(selected?.dataset.index??cells.length-1);}
  const showHelp=()=>{const dialog=document.createElement('dialog');dialog.className='nb-help';dialog.innerHTML=`<form method="dialog"><button class="nb-help-close" aria-label="Close">×</button></form><h2>${tr(lang,'Notebook shortcuts','اختصارات الدفتر')}</h2><p>${tr(lang,'Shift+Enter runs the selected code cell and advances. Ctrl+Enter runs it in place. Earlier cells replay on each run; use const globals or //@global for shared declarations. A cell that uses cin asks for its own input when it runs.','Shift+Enter يشغّل الخلية وينتقل للتالية. Ctrl+Enter يشغّلها في مكانها. تُعاد الخلايا السابقة عند كل تشغيل؛ استخدم const أو //@global للمشاركة. عند تشغيل خلية تستخدم cin سيُطلب إدخالها الخاص.')}</p>`;shell.append(dialog);dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal();};
  const renderCell=(cell:NotebookCell,index:number)=>{
    const card=document.createElement('section');card.className='nb-cell';card.dataset.index=String(index);card.tabIndex=-1;card.addEventListener('focusin',()=>{shell.querySelectorAll('.nb-cell').forEach(x=>x.classList.remove('is-selected'));card.classList.add('is-selected');});
    const header=document.createElement('div');header.className='nb-cell-tools';const ordinal=codeOrdinal(index);const badge=document.createElement('span');badge.className='nb-cell-ordinal';badge.textContent=cell.type==='code'?`[${ordinal}]`:tr(lang,'Text','نص');header.append(badge);
    if(cell.type==='code')header.append(button(tr(lang,'▶ Run','▶ تشغيل'),()=>void run(index),'nb-run-cell'));
    const cellMenu=document.createElement('details');cellMenu.className='nb-cell-menu';const menuSummary=document.createElement('summary');menuSummary.textContent='⋯';menuSummary.setAttribute('aria-label',tr(lang,'Cell actions','إجراءات الخلية'));const cellItems=document.createElement('div');cellItems.className='nb-cell-menu-items';const cellAction=(label:string,fn:()=>void)=>{cellItems.append(button(label,()=>{cellMenu.open=false;fn();}));};cellAction(tr(lang,'Insert code cell above','إدراج خلية كود قبلها'),()=>addCell('code',index));cellAction(tr(lang,'Insert text cell above','إدراج خلية نص قبلها'),()=>addCell('markdown',index));cellAction(tr(lang,'Duplicate cell','تكرار الخلية'),()=>{cells.splice(index+1,0,{...cell,id:crypto.randomUUID()});save();render();});cellAction(tr(lang,'Move cell up','تحريك للأعلى'),()=>move(index,-1));cellAction(tr(lang,'Move cell down','تحريك للأسفل'),()=>move(index,1));cellAction(cell.type==='code'?tr(lang,'Convert to text','تحويل لنص'):tr(lang,'Convert to code','تحويل لكود'),()=>{cell.type=cell.type==='code'?'markdown':'code';if(cell.type==='markdown')delete cell.stdin;save();render();});cellAction(tr(lang,'Delete cell','حذف الخلية'),()=>{cells.splice(index,1);if(!cells.length)cells.push({id:crypto.randomUUID(),type:'code',source:''});save();render();});cellMenu.append(menuSummary,cellItems);header.append(cellMenu);card.append(header);
    if(cell.type==='markdown'){
      const rendered=document.createElement('div');rendered.className='nb-markdown';rendered.innerHTML=DOMPurify.sanitize(marked.parse(cell.source,{async:false}));card.append(rendered);
      const edit=document.createElement('details');edit.className='nb-markdown-edit';const editSummary=document.createElement('summary');editSummary.textContent=tr(lang,'Edit text','تعديل النص');const textarea=document.createElement('textarea');textarea.value=cell.source;textarea.oninput=()=>{cell.source=textarea.value;rendered.innerHTML=DOMPurify.sanitize(marked.parse(cell.source,{async:false}));save();};edit.append(editSummary,textarea);card.append(edit);
    }else{
      const host=document.createElement('div');host.className='nb-code-editor';card.append(host);
      const editor=opts.createCodeEditor({host,source:cell.source,onChange:value=>{cell.source=value;save();},onRunAdvance:()=>{void run(index).then(()=>{const next=cells.findIndex((c,i)=>i>index&&c.type==='code');if(next>=0)editors.get(cells[next].id)?.focus();});},onRunStay:()=>void run(index)});editors.set(cell.id,editor);
      const out=document.createElement('div');out.className='nb-output';const stdout=document.createElement('pre');stdout.className='nb-stdout';stdout.dir='ltr';const stderr=document.createElement('pre');stderr.className='nb-stderr';stderr.dir='ltr';const status=document.createElement('span');status.className='nb-run-status';const diagnostics=document.createElement('div');diagnostics.className='nb-diagnostics';out.append(status,stdout,stderr,diagnostics);card.append(out);outputs.set(cell.id,{stdout,stderr,status,diagnostics});
    }
    const insert=document.createElement('div');insert.className='nb-insert-row';insert.setAttribute('role','group');insert.append(button(tr(lang,'+ Code','+ كود'),()=>addCell('code',index+1)),button(tr(lang,'+ Text','+ نص'),()=>addCell('markdown',index+1)));card.append(insert);return card;
  };
  function move(index:number,delta:number){const to=index+delta;if(to<0||to>=cells.length)return;[cells[index],cells[to]]=[cells[to],cells[index]];save();render();}
  const setCells=(next:NotebookCell[])=>{cells=copy(next);save();render();};
  render();
  return {getCells:()=>copy(cells),setCells,destroy(){activeController?.abort();for(const editor of editors.values())editor.destroy();editors.clear();shell.remove();}};
}
declare global { interface Window { __mlwebImport?: (file:File)=>void|Promise<void>; __mlwebExport?: {zip?:()=>void|Promise<void>}; } }


