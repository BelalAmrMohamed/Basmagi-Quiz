// shared HTML builder (used by Chromium backend and for static capability shots)
import fs from "fs"; import katex from "katex";
export const CSS = `
@font-face{font-family:Cairo;font-weight:400;src:url(node_modules/@fontsource/cairo/files/cairo-arabic-400-normal.woff2);unicode-range:U+0600-06FF,U+0750-077F,U+FB50-FDFF,U+FE70-FEFF,U+200C-200E,U+2010-2011,U+204F,U+2E41,U+FB50-FDFF}
@font-face{font-family:Cairo;font-weight:400;src:url(node_modules/@fontsource/cairo/files/cairo-latin-400-normal.woff2);unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+2074,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}
@font-face{font-family:Cairo;font-weight:700;src:url(node_modules/@fontsource/cairo/files/cairo-arabic-700-normal.woff2);unicode-range:U+0600-06FF,U+0750-077F,U+FB50-FDFF,U+FE70-FEFF,U+200C-200E}
@font-face{font-family:Cairo;font-weight:700;src:url(node_modules/@fontsource/cairo/files/cairo-latin-700-normal.woff2);unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+2000-206F,U+2212}
html,body{margin:0;background:#0f1320;color:#eef1f8;font-family:Cairo,sans-serif}
body{width:1280px;height:720px;box-sizing:border-box;padding:48px 72px;direction:rtl;overflow:hidden}
h1{font-size:54px;margin:0 0 28px;color:#7cc4ff;font-weight:700}
.it{font-size:38px;line-height:1.5;margin:10px 0;opacity:0}
.it.m{direction:ltr;text-align:center;font-size:44px}
.it.l{direction:ltr;text-align:left;font-size:34px;color:#ffd479}
.katex{font-size:1.15em}
`;
export function sceneHTML(s) {
  const items = s.items.map((it, i) => {
    if (it.k === "m") return `<div class="it m" data-t="${it.t}">${katex.renderToString(it.v, { displayMode: true })}</div>`;
    if (it.k === "l") return `<div class="it l" data-t="${it.t}">${it.v}</div>`;
    return `<div class="it" data-t="${it.t}">${it.v}</div>`;
  }).join("\n");
  return `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="node_modules/katex/dist/katex.min.css"><style>${CSS}</style></head><body><h1>${s.title}</h1>${items}
<script>window.setT=(t)=>{let sig=[];document.querySelectorAll('.it').forEach(e=>{const p=Math.min(1,Math.max(0,(t-parseFloat(e.dataset.t))/0.5));e.style.opacity=p;e.style.transform='translateY('+((1-p)*14)+'px)';sig.push(p.toFixed(3))});return sig.join(',')}</script></body></html>`;
}
