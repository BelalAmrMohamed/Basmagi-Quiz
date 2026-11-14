import{c as p}from"./chunk-TCOY2X2A.js";var c=t=>typeof t=="string"?t:t==null?"":String(t);function d(t){let e=!!(t&&t.meta&&t.notebook),n=(e?t.notebook?.content:t?.content)||{},o=(Array.isArray(n.cells)?n.cells:[]).map((a,r)=>({id:c(a?.id)||`cell-${r+1}`,type:a?.type==="code"?"code":"markdown",source:c(a?.source),...typeof a?.stdin=="string"?{stdin:a.stdin}:{},...a?.challenge&&typeof a.challenge=="object"?{challenge:a.challenge}:{}})),l=c(e?t.meta?.title:t?.title).trim()||"Untitled notebook",s=c(e?t.meta?.description:t?.description).trim();return{id:c(t?.id||t?.meta?.id),slug:c(t?.slug),title:l,description:s,source:c(e?t.meta?.source:t?.source).trim(),runtime:c(e?t.notebook?.runtime:t?.runtime)||"matlab",language:p(n.language,{title:l,description:s,cells:o}),createdAt:(e?t.meta?.createdAt:t?.created_at)||null,updatedAt:(e?t.meta?.updatedAt:t?.updated_at)||null,createdBy:e?null:t?.created_by||t?.createdBy||null,courseId:e?null:t?.course_id||t?.courseId||null,folderId:e?null:t?.folder_id||t?.folderId||null,eduType:e?null:t?.education_type||null,college:e?null:t?.college||null,year:e?null:t?.year??null,term:e?null:t?.term??null,local:e,cells:o,assets:Array.isArray(n.assets)?n.assets:[]}}function g(t){let e=d(t),n=e.cells.filter(l=>l.type==="code"),o=n.reduce((l,s)=>l+(s.source?s.source.split(`
`).length:0),0);return{id:e.id,title:e.title,description:e.description,source:e.source,runtime:e.runtime,language:e.language,cellCount:e.cells.length,codeCount:n.length,markdownCount:e.cells.length-n.length,codeLines:o,createdAt:e.createdAt,updatedAt:e.updatedAt,createdBy:e.createdBy,local:e.local,slug:e.slug,courseId:e.courseId,folderId:e.folderId,eduType:e.eduType,college:e.college,year:e.year,term:e.term}}function b(t){let e=g(t);return`Interactive MATLAB-style notebook \u2014 ${e.cellCount} cells (${e.codeCount} code, ${e.markdownCount} text), language: ${e.language==="ar"?"Arabic":"English"}.`}function h(t){let e=d(t);return{description:e.description,passwordProtected:!1,content:{type:"notebook",title:e.title,source:e.source,runtime:e.runtime,language:e.language,note:`Executable educational notebook (${m(e.runtime)}). Cells are in order; 'code' cells are ${e.runtime==="cpp"?"C++":"MATLAB"} code, 'markdown' cells are explanations.`,cells:e.cells.map((n,o)=>({n:o+1,type:n.type,source:n.source,...typeof n.stdin=="string"?{stdin:n.stdin}:{},...n.challenge?{challenge:n.challenge}:{}}))}}}var u=t=>t.split(`
`).map((e,n,o)=>n<o.length-1?e+`
`:e);function x(t){let e=t?.cells&&t?.title!==void 0&&!t.meta?t:d(t);return{nbformat:4,nbformat_minor:5,metadata:{title:e.title,kernelspec:e.runtime==="cpp"?{name:"xcpp17",display_name:"C++17",language:"C++"}:{name:"matlab",display_name:"MATLAB (educational subset)",language:"matlab"},language_info:e.runtime==="cpp"?{name:"C++",file_extension:".cpp",mimetype:"text/x-c++src"}:{name:"matlab",file_extension:".m",mimetype:"text/x-matlab"},basmagi:{title:e.title,runtime:e.runtime,language:e.language,description:e.description,source:e.source}},cells:e.cells.map((n,o)=>{let l=(n.id||`cell-${o+1}`).replace(/[^A-Za-z0-9_-]/g,"-").slice(0,64)||`cell-${o+1}`;return n.type==="code"?{id:l,cell_type:"code",metadata:{...n.stdin!==void 0?{stdin:n.stdin}:{},...n.challenge?{challenge:n.challenge}:{}},execution_count:null,source:u(n.source),outputs:[]}:{id:l,cell_type:"markdown",metadata:{},source:u(n.source)}})}}var m=t=>t==="cpp"?"C++":"MATLAB (educational subset)";function y(t){let e=t?.cells&&t?.title!==void 0&&!t.meta?t:d(t);return{format:"basmagi-notebook",version:1,title:e.title,description:e.description,source:e.source,runtime:e.runtime,language:e.language,createdAt:e.createdAt,updatedAt:e.updatedAt,cells:e.cells.map(n=>({type:n.type,source:n.source,...typeof n.stdin=="string"?{stdin:n.stdin}:{},...n.challenge?{challenge:n.challenge}:{}})),assets:e.assets}}function $(t){let e=t?.cells&&t?.title!==void 0&&!t.meta?t:d(t),n=[`// ${e.title}`];e.description&&n.push(...e.description.split(`
`).map(o=>`// ${o}`)),e.source&&n.push(`// Source: ${e.source}`),n.push("// Exported from Basmagi Quiz (C++ notebook).","");for(let o of e.cells)if(o.type==="code")n.push("//%%",o.source.replace(/\s+$/,""),"");else{let l=o.source.replace(/\s+$/,"").split(`
`);if(!l.some(s=>s.trim()))continue;n.push("//%%",...l.map(s=>s.trim()?`// ${s}`:"//"),"")}return n.join(`
`).replace(/\n{3,}/g,`

`).replace(/\s+$/,"")+`
`}function k(t){let e=t?.cells&&t?.title!==void 0&&!t.meta?t:d(t),n=[`% ${e.title}`];e.description&&n.push(...e.description.split(`
`).map(o=>`% ${o}`)),e.source&&n.push(`% Source: ${e.source}`),n.push("% Exported from Basmagi Quiz (educational MATLAB-style notebook).","");for(let o of e.cells)if(o.type==="code")n.push("%%",o.source.replace(/\s+$/,""),"");else{let l=o.source.replace(/\s+$/,"").split(`
`),s=l.findIndex(a=>a.trim());if(s===-1)continue;n.push(`%% ${l[s].replace(/^#+\s*/,"").trim()}`);for(let a of l.slice(s+1))n.push(a.trim()?`% ${a}`:"%");n.push("")}return n.join(`
`).replace(/\n{3,}/g,`

`).replace(/\s+$/,"")+`
`}var i=t=>c(t).replace(/[&<>"]/g,e=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"})[e]);function A(t,{renderMarkdown:e}={}){let n=t?.cells&&t?.title!==void 0&&!t.meta?t:d(t),o=n.language==="ar",l=r=>typeof e=="function"?e(r):`<p>${i(r).replace(/\n/g,"<br>")}</p>`,s=0,a=n.cells.map(r=>r.type==="markdown"?`<section class="md">${l(r.source)}</section>`:(s+=1,`<section class="code"><span class="prompt">In [${s}]:</span><pre dir="ltr">${i(r.source)}</pre></section>`)).join(`
`);return`<!doctype html>
<html lang="${n.language}" dir="${o?"rtl":"ltr"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${i(n.title)}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
<style>
  :root { color-scheme: light; }
  body { font: 16px/1.65 system-ui, -apple-system, "Segoe UI", Tahoma, sans-serif; color: #1d2433; max-width: 900px; margin: 0 auto; padding: 28px 18px 60px; }
  h1.title { margin: 0 0 4px; font-size: 1.9rem; }
  .desc { color: #5b6475; margin: 0 0 6px; }
  .meta { color: #667085; font-size: .85rem; margin-bottom: 22px; }
  .md img { max-width: 100%; }
  .md pre, .md code { background: #f0f2f7; border-radius: 4px; }
  .md code { padding: 1px 5px; } .md pre { padding: 10px 12px; overflow: auto; direction: ltr; text-align: left; }
  .code { display: grid; grid-template-columns: 74px minmax(0, 1fr); gap: 8px; margin: 10px 0; direction: ltr; }
  .code .prompt { color: #307fc1; font: 12.5px/1.8 ui-monospace, Menlo, Consolas, monospace; text-align: right; padding-top: 8px; }
  .code pre { margin: 0; padding: 10px 12px; background: #f6f7fb; border: 1px solid #dce2ed; border-radius: 4px; font: 13.5px/1.6 ui-monospace, Menlo, Consolas, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
  .md { margin: 8px 0; }
  @media print { body { padding: 0; } .code pre { break-inside: avoid; } h1, h2, h3 { break-after: avoid; } }
</style>
</head>
<body>
<h1 class="title">${i(n.title)}</h1>
${n.description?`<p class="desc">${i(n.description)}</p>`:""}
<div class="meta">${n.source?`<a href="${i(n.source)}">${i(n.source)}</a> \xB7 `:""}${n.cells.length} cells \xB7 ${m(n.runtime)}</div>
${a}
</body>
</html>
`}function C(t,e="notebook"){return c(t).replace(/[\\/:*?"<>|\u0000-\u001f]+/g," ").replace(/\s+/g," ").trim().slice(0,80)||e}export{d as a,g as b,b as c,h as d,x as e,m as f,y as g,$ as h,k as i,A as j,C as k};
