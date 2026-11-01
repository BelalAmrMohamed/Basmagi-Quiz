// Whiteboard / chalkboard explainer renderer: builds ONE html page per scene.
// Page API (used by paginate.mjs and render.mjs):  window.measure() -> item heights;  window.setT(t) -> state signature (string)
import katex from "katex";

export const STYLES = {
  chalk:      { bg: "chalk",      ink: "#f4f3ec", accent: "#ffd966", title: "#8fe3ff", math: "#ffe58a", hi: "#ff9ec4", pen: "chalk",  frame: "wood" },
  whiteboard: { bg: "white",      ink: "#1c2b3f", accent: "#d7263d", title: "#1565c0", math: "#0b6e4f", hi: "#e67e22", pen: "marker", frame: "metal" },
  notebook:   { bg: "paper",      ink: "#173a8c", accent: "#c0392b", title: "#0b2a6f", math: "#1a237e", hi: "#2e7d32", pen: "pencil", frame: "none" },
  blueprint:  { bg: "blueprint",  ink: "#eaf4ff", accent: "#ffd166", title: "#9fe3ff", math: "#fff3b0", hi: "#7ef0c0", pen: "chalk",  frame: "thin" },
  blackboard: { bg: "black",      ink: "#efefef", accent: "#ff8fab", title: "#ffe066", math: "#a5f3fc", hi: "#b5f5a0", pen: "chalk",  frame: "dark" },
};
export const STYLE_ORDER = ["chalk", "whiteboard", "notebook", "blueprint", "blackboard"];

const noiseSVG = (freq, alpha, seed = 3) => `url("data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='600' height='400'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='${freq}' numOctaves='3' seed='${seed}'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 ${alpha} 0'/></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>`)}")`;
const noiseDark = (freq, alpha, seed = 5) => `url("data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='600' height='400'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='${freq}' numOctaves='3' seed='${seed}'/><feColorMatrix values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 ${alpha} 0'/></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>`)}")`;

const BG = {
  chalk: `background:${noiseSVG(0.9, 0.10)}, radial-gradient(ellipse 60% 40% at 25% 20%, rgba(255,255,255,.06), transparent 70%), radial-gradient(ellipse 50% 30% at 70% 70%, rgba(255,255,255,.05), transparent 70%), radial-gradient(ellipse at 40% 30%, #2f5f4b, #1f4234 65%, #163226);`,
  black: `background:${noiseSVG(0.8, 0.07)}, radial-gradient(ellipse 55% 35% at 30% 25%, rgba(255,255,255,.05), transparent 70%), radial-gradient(ellipse at 45% 35%, #2a2d30, #1a1c1e 70%, #121315);`,
  white: `background:${noiseDark(0.7, 0.05)}, linear-gradient(115deg, rgba(255,255,255,0) 40%, rgba(255,255,255,.75) 46%, rgba(255,255,255,0) 52%), linear-gradient(#f9fbfd, #eef2f6);`,
  paper: `background:${noiseDark(1.1, 0.06)}, repeating-linear-gradient(#0000 0 55px, #9fc3e8 55px 56px), linear-gradient(#fdf8e8, #f6efd6);`,
  blueprint: `background:repeating-linear-gradient(0deg, rgba(255,255,255,.07) 0 1px, transparent 1px 12px), repeating-linear-gradient(90deg, rgba(255,255,255,.07) 0 1px, transparent 1px 12px), repeating-linear-gradient(0deg, rgba(255,255,255,.16) 0 1px, transparent 1px 60px), repeating-linear-gradient(90deg, rgba(255,255,255,.16) 0 1px, transparent 1px 60px), ${noiseSVG(0.9, 0.05)}, radial-gradient(ellipse at 50% 40%, #1b64a6, #0f4c81 75%);`,
};
const FRAME = {
  wood: `<div class="frame wood"></div><div class="tray"><i style="left:120px;background:#f5f5f0"></i><i style="left:210px;background:#ffd966;width:46px"></i><i style="left:330px;background:#ff9ec4;width:30px"></i><span class="eraser"></span></div>`,
  dark: `<div class="frame darkf"></div><div class="tray dark"><i style="left:160px;background:#eee"></i><i style="left:260px;background:#ffe066;width:40px"></i></div>`,
  metal: `<div class="frame metal"></div><div class="tray metalt"><b style="left:140px;background:#1565c0"></b><b style="left:200px;background:#d7263d"></b><b style="left:260px;background:#0b6e4f"></b><b style="left:320px;background:#222"></b></div>`,
  thin: `<div class="frame thinf"></div>`,
  none: `<div class="spiral"></div><div class="margin"></div>`,
};
const PEN = {
  chalk: `<svg width="46" height="46" viewBox="0 0 46 46"><g transform="rotate(35 23 23)"><rect x="19" y="4" width="9" height="34" rx="2.5" fill="#f7f7f2" stroke="#cfcfc4"/><rect x="19" y="32" width="9" height="6" rx="2" fill="#e9e9df"/></g></svg>`,
  marker: `<svg width="52" height="52" viewBox="0 0 52 52"><g transform="rotate(38 26 26)"><rect x="21" y="3" width="11" height="30" rx="3" fill="#1565c0"/><rect x="22" y="31" width="9" height="9" fill="#e8eaed" stroke="#9aa0a6"/><path d="M23 40h7l-2 5h-3z" fill="#1c2b3f"/></g></svg>`,
  pencil: `<svg width="52" height="52" viewBox="0 0 52 52"><g transform="rotate(38 26 26)"><rect x="21" y="3" width="11" height="32" fill="#f4c542"/><rect x="21" y="3" width="11" height="5" fill="#e57373"/><path d="M21 35h11l-5.5 10z" fill="#f2d3a6"/><path d="M24.5 41h4l-2 4z" fill="#333"/></g></svg>`,
};

export function boardCSS(fontBase) {
  return `
@font-face{font-family:Hand;font-weight:400;src:url(${fontBase}/playpen-sans-arabic-arabic-400-normal.woff2);unicode-range:U+0600-06FF,U+0750-077F,U+FB50-FDFF,U+FE70-FEFF,U+200C-200E}
@font-face{font-family:Hand;font-weight:400;src:url(${fontBase}/playpen-sans-arabic-latin-400-normal.woff2);unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+2000-206F,U+2212,U+20AC}
@font-face{font-family:Hand;font-weight:600;src:url(${fontBase}/playpen-sans-arabic-arabic-600-normal.woff2);unicode-range:U+0600-06FF,U+0750-077F,U+FB50-FDFF,U+FE70-FEFF,U+200C-200E}
@font-face{font-family:Hand;font-weight:600;src:url(${fontBase}/playpen-sans-arabic-latin-600-normal.woff2);unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+2000-206F,U+2212,U+20AC}
@font-face{font-family:Ruqaa;font-weight:700;src:url(${fontBase}/aref-ruqaa-arabic-700-normal.woff2);unicode-range:U+0600-06FF,U+0750-077F,U+FB50-FDFF,U+FE70-FEFF,U+200C-200E}
@font-face{font-family:Ruqaa;font-weight:700;src:url(${fontBase}/aref-ruqaa-latin-700-normal.woff2);unicode-range:U+0000-00FF,U+2000-206F}
html,body{margin:0;width:1280px;height:720px;overflow:hidden;background:#000}
#board{position:absolute;inset:0;overflow:hidden;font-family:Hand,sans-serif;color:var(--ink)}
.frame{position:absolute;inset:0;pointer-events:none}
.frame.wood{box-shadow:inset 0 0 0 22px #8b5a2b, inset 0 0 0 26px #5e3b19, inset 0 0 38px 30px rgba(0,0,0,.35);background:linear-gradient(#0000,#0000)}
.frame.darkf{box-shadow:inset 0 0 0 16px #3a3d42, inset 0 0 0 19px #1e2024, inset 0 0 40px 24px rgba(0,0,0,.45)}
.frame.metal{box-shadow:inset 0 0 0 16px #cfd5db, inset 0 0 0 19px #98a1ab, inset 0 0 30px 14px rgba(0,0,0,.12)}
.frame.thinf{box-shadow:inset 0 0 0 14px transparent, inset 0 0 0 16px rgba(255,255,255,.55), inset 0 0 0 19px transparent}
.tray{position:absolute;left:60px;right:60px;bottom:0;height:20px;background:linear-gradient(#a06a35,#6d441d);border-radius:6px 6px 0 0;box-shadow:0 -2px 6px rgba(0,0,0,.35)}
.tray.dark{background:linear-gradient(#4a4e54,#2a2d31)} .tray.metalt{background:linear-gradient(#e6eaee,#a9b1ba)}
.tray i{position:absolute;top:-9px;width:60px;height:10px;border-radius:5px;transform:rotate(-2deg)}
.tray b{position:absolute;top:-22px;width:26px;height:24px;border-radius:5px}
.tray .eraser{position:absolute;right:140px;top:-14px;width:80px;height:16px;border-radius:3px;background:linear-gradient(#e8d9a8 0 60%,#3b3b3b 60%)}
.spiral{position:absolute;right:14px;top:0;bottom:0;width:26px;background:radial-gradient(circle at 13px 13px,#2a2a2a 0 6px,transparent 7px) 0 0/26px 44px repeat-y}
.margin{position:absolute;right:104px;top:0;bottom:0;width:2px;background:#e57373;opacity:.8}
#content{position:absolute;left:96px;right:96px;top:36px;bottom:60px;direction:rtl}
body[data-style=notebook] #content{left:70px;right:132px}
.page{position:absolute;inset:0;visibility:hidden}
.title{font-family:Ruqaa,Hand,serif;font-weight:700;font-size:58px;line-height:1.25;color:var(--title);margin:0 0 6px;padding-bottom:8px;border-bottom:3px dashed color-mix(in srgb,var(--title) 55%,transparent);display:block}
.it{margin:0 0 14px;font-size:40px;line-height:1.55;position:relative}
.it.math{direction:ltr;text-align:center;color:var(--math);font-size:50px;line-height:1.3;padding:6px 0}
.it.line{direction:ltr;text-align:left;color:var(--accent);font-size:36px}
.it.list{padding:0;list-style:none}
.it.list .li{position:relative;padding-right:46px;margin:2px 0}
.it.list .li::before{content:"";position:absolute;right:8px;top:.62em;width:16px;height:16px;border-radius:50%;background:var(--accent)}
.it table{border-collapse:collapse;margin:4px auto;direction:rtl;font-size:34px}
.it td,.it th{border:2.5px solid color-mix(in srgb,var(--ink) 70%,transparent);padding:4px 22px;text-align:center}
.it th{color:var(--accent)}
.w{display:inline-block;white-space:pre}
.w.en{color:var(--accent)} .w.hi{color:var(--hi)}
.w .katex{font-size:1.02em;color:var(--math)}
.chalk-text{filter:url(#rough)}
#pen{position:absolute;left:0;top:0;width:52px;height:52px;visibility:hidden;pointer-events:none;filter:drop-shadow(2px 3px 2px rgba(0,0,0,.35))}
#sponge{position:absolute;top:30px;bottom:50px;width:70px;border-radius:10px;background:linear-gradient(90deg,#e8d38b,#caa96a);box-shadow:0 0 18px rgba(0,0,0,.45);visibility:hidden}
#sponge::after{content:"";position:absolute;inset:6px 0;border-radius:6px;background:repeating-linear-gradient(0deg,rgba(0,0,0,.07) 0 4px,transparent 4px 9px)}
`;
}

export function sceneHTML(scene, style, fontBase, katexBase) {
  const S = STYLES[style];
  const wordsHTML = (md) => {
    // tokens: $math$ stay whole; otherwise split on spaces
    const toks = []; const re = /\$([^$]+)\$|(\S+)/g; let m;
    while ((m = re.exec(md))) toks.push(m[1] != null ? { math: m[1] } : { t: m[2] });
    return toks.map((k) => k.math != null
      ? `<span class="w" data-wt="${Math.max(3, Math.round(k.math.length * 0.7))}" dir="ltr" style="unicode-bidi:isolate">${katex.renderToString(k.math)}</span>`
      : `<span class="w${/[A-Za-z]/.test(k.t) && !/[؀-ۿ]/.test(k.t) ? " en" : ""}" data-wt="${Math.max(1, k.t.length)}">${k.t.replace(/&/g, "&amp;").replace(/</g, "&lt;")} </span>`).join("");
  };
  const clean = (s) => String(s).replace(/[*_`#>]+/g, "");
  const items = scene.items.map((it, i) => {
    const cls = `it ${it.k}`; const attr = `data-i="${i}" data-k="${it.k}"`;
    if (it.k === "title") return `<h1 class="title it" ${attr}>${wordsHTML(clean(it.md))}</h1>`;
    if (it.k === "text") return `<div class="${cls}" ${attr}>${wordsHTML(clean(it.md))}</div>`;
    if (it.k === "math") return `<div class="${cls}" ${attr}><span class="w" data-wt="${Math.max(6, it.tex.length)}" dir="ltr">${katex.renderToString(it.tex, { displayMode: true })}</span></div>`;
    if (it.k === "line") return `<div class="${cls}" ${attr}><span class="w" data-wt="${it.md.length}" dir="ltr">${it.md}</span></div>`;
    if (it.k === "list") return `<div class="${cls}" ${attr}>${it.items.map((l) => `<div class="li" data-chunk="1">${wordsHTML(clean(l))}</div>`).join("")}</div>`;
    if (it.k === "table") return `<div class="${cls}" ${attr}><table>${it.rows.map((r, ri) => `<tr data-chunk="1">${r.map((c) => (ri === 0 ? `<th>${c}</th>` : `<td>${c}</td>`)).join("")}</tr>`).join("")}</table></div>`;
    return "";
  }).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${katexBase}/katex.min.css"><style>${boardCSS(fontBase)}
body{--ink:${S.ink};--accent:${S.accent};--title:${S.title};--math:${S.math};--hi:${S.hi}}
#board{${BG[S.bg]}}
</style></head><body data-style="${style}">
<svg width="0" height="0" style="position:absolute"><filter id="rough"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="2" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="2.2"/></filter></svg>
<div id="board">${FRAME[S.frame]}<div id="content"><div id="measure" style="position:absolute;visibility:hidden;left:0;right:0;top:0">${items}</div><div id="pages"></div></div><div id="sponge"></div><div id="pen">${PEN[S.pen]}</div></div>
<script>
const CFG=${JSON.stringify({ pen: S.pen, chalk: S.pen === "chalk" })};
window.measure=()=>{const out=[];document.querySelectorAll('#measure > .it').forEach(e=>out.push(e.getBoundingClientRect().height+14));return {heights:out,avail:document.getElementById('content').getBoundingClientRect().height}};
// timeline injected by renderer: window.plan = {items:[{t0,dur,page,scale}], pages:[{start,eraseAt}], erase:0.9}
window.build=(plan)=>{window.plan=plan;const pagesEl=document.getElementById('pages');const src=[...document.querySelectorAll('#measure > .it')];
  plan.pages.forEach((p,pi)=>{const el=document.createElement('div');el.className='page';el.dataset.p=pi;
    // title repeats on every page after first (static)
    p.items.forEach(ii=>{const c=src[ii].cloneNode(true);c.dataset.i=ii;if(CFG.chalk)c.classList.add('chalk-text');el.appendChild(c)});
    pagesEl.appendChild(el)});
  window.chunks={};document.querySelectorAll('#pages .it').forEach(it=>{const ii=+it.dataset.i;const ch=[...it.querySelectorAll('.w,[data-chunk]')].filter(e=>!(e.closest('[data-chunk]')&&e.matches('.w')&&e.closest('[data-chunk]')!==e&&false));
    // for list/table: chunk = row/li; else words
    let parts=[...it.querySelectorAll('[data-chunk]')]; if(!parts.length) parts=[...it.querySelectorAll('.w')];
    const wts=parts.map(e=>{const own=e.matches('.w')?+e.dataset.wt:[...e.querySelectorAll('.w')].reduce((a,w)=>a+(+w.dataset.wt||1),0)||6;return own});
    window.chunks[ii]={parts,wts,total:wts.reduce((a,b)=>a+b,0),el:it}});
  // titles on later pages: show static copy of title (item 0)
  };
const clamp=(x,a=0,b=1)=>Math.min(b,Math.max(a,x));
const pen=()=>document.getElementById('pen');
window.setT=(t)=>{const P=window.plan;let sig=[];const penEl=pen();let penPos=null;
  // which page
  let cur=0;for(let i=0;i<P.pages.length;i++){if(t>=P.pages[i].start)cur=i}
  const pg=P.pages[cur];const eraseP=(cur<P.pages.length-1||P.final)?clamp((t-(cur<P.pages.length-1?P.pages[cur+1].start-P.erase:P.endErase))/P.erase):0;
  document.querySelectorAll('.page').forEach(el=>{el.style.visibility=(+el.dataset.p===cur)?'visible':'hidden'});
  const pageEl=document.querySelector('.page[data-p="'+cur+'"]');
  // erase sweep (right -> left)
  const W=pageEl.parentElement.getBoundingClientRect().width;
  pageEl.style.clipPath=eraseP>0?'inset(-20px '+(eraseP*100).toFixed(2)+'% -20px -20px)':'none';
  const sp=document.getElementById('sponge');
  if(eraseP>0&&eraseP<1){sp.style.visibility='visible';sp.style.left=(1280-96-eraseP*(1280-192)-35)+'px'}else sp.style.visibility='hidden';
  sig.push(cur,eraseP.toFixed(3));
  pageEl.querySelectorAll('.it').forEach(it=>{const ii=+it.dataset.i;const pl=P.items[ii];const ck=window.chunks[ii];
    const first=ii===0;const p=clamp((t-pl.t0)/(Math.max(0.3,pl.dur*0.9)));
    // scale for oversized items
    if(pl.scale&&pl.scale<1){it.style.transformOrigin='top right';it.style.transform='scale('+pl.scale+')'}
    if(t<pl.t0&&!(cur>0&&ii===0)){it.style.visibility='hidden';sig.push(0);return}
    it.style.visibility='visible';
    const prog=(cur>0&&ii===0)?1:p;sig.push(prog.toFixed(3));
    if(ck){let acc=0;ck.parts.forEach((part,k)=>{const a=acc/ck.total,b=(acc+ck.wts[k])/ck.total;acc+=ck.wts[k];
      const f=clamp((prog-a)/(b-a));
      const isLTR=getComputedStyle(part).direction==='ltr'||part.classList.contains('en')||part.closest('.math,.line');
      part.style.clipPath=f>=1?'none':(isLTR?'inset(-10px '+((1-f)*100).toFixed(1)+'% -10px 0)':'inset(-10px 0 -10px '+((1-f)*100).toFixed(1)+'%)');
      part.style.opacity=f>0?1:0;
      if(f>0&&f<1&&prog<1){const r=part.getBoundingClientRect();const br=document.getElementById('board').getBoundingClientRect();
        const x=isLTR?r.left+f*r.width:r.right-f*r.width;penPos=[x-br.left,r.top-br.top+r.height*0.55]}
      // tiny hand-written wobble, fixed per chunk
      if(part.matches('.w')&&!part.dataset.rot){part.dataset.rot=((((k*37+ii*11)%7)-3)*0.35).toFixed(2);part.style.transform='rotate('+part.dataset.rot+'deg)'}
    })}
  });
  if(penPos){const wob=Math.sin(t*22)*2;penEl.style.visibility='visible';
    const px=penPos[0]+wob, py=penPos[1]+Math.cos(t*17)*1.5;
    penEl.style.transform='translate('+(px-6)+'px,'+(py-40)+'px)';sig.push(Math.round(px),Math.round(py))}else{penEl.style.visibility='hidden'}
  return sig.join(',')};
</script></body></html>`;
}
