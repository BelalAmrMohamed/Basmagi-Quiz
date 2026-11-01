const {mathjax}=require('mathjax-full/js/mathjax.js');const {TeX}=require('mathjax-full/js/input/tex.js');
const {SVG}=require('mathjax-full/js/output/svg.js');const {liteAdaptor}=require('mathjax-full/js/adaptors/liteAdaptor.js');
const {RegisterHTMLHandler}=require('mathjax-full/js/handlers/html.js');const {AllPackages}=require('mathjax-full/js/input/tex/AllPackages.js');
const ad=liteAdaptor();RegisterHTMLHandler(ad);
const doc=mathjax.document('',{InputJax:new TeX({packages:AllPackages}),OutputJax:new SVG({fontCache:'none'})});
const [,,tex,out]=process.argv;const n=doc.convert(tex,{display:true,em:16,ex:8,containerWidth:80*16});
let s=ad.innerHTML(n).replace(/<mjx-container[^>]*>/,'').replace('</mjx-container>','');
s=s.replace(/currentColor/g,'#FFFFFF');require('fs').writeFileSync(out,s);
