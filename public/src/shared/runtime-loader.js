import { RUNTIME_CONFIG } from './runtime-config.js';
const promises = new Map();
const stylePromises = new Map();

function loadStylesheet(id, config) {
 const href=new URL(`${config.base}runtime.css`,document.baseURI).href;
 let css=document.querySelector(`link[data-runtime-css="${id}"]`);
 if(!css)css=[...document.querySelectorAll('link[rel="stylesheet"]')].find(link=>link.href===href);
 if(css&&!css.dataset.runtimeCss&&!css.sheet){css.remove();css=null;}
 if(css?.dataset.runtimeCssReady==="true"||(css&&!css.dataset.runtimeCss&&css.sheet))return Promise.resolve();
 if(stylePromises.has(id))return stylePromises.get(id);
 if(!css){css=document.createElement('link');css.rel='stylesheet';css.href=href;css.dataset.runtimeCss=id;}
 const link=css;
 const promise=new Promise((resolve,reject)=>{
  link.addEventListener('load',()=>{link.dataset.runtimeCssReady="true";resolve();},{once:true});
  link.addEventListener('error',()=>reject(new Error('runtime styles failed to load')),{once:true});
  if(!link.isConnected)document.head.append(link);
 }).catch(error=>{stylePromises.delete(id);if(link.dataset.runtimeCss===id)link.remove();throw error;});
 stylePromises.set(id,promise);
 return promise;
}

export function loadRuntime(id) {
 const config=RUNTIME_CONFIG[id]; if(!config) return Promise.reject(new Error('runtime missing'));
 if(promises.has(id))return promises.get(id);
 const promise=loadStylesheet(id,config).then(()=>{
  const present=window[config.global]; if(present?.mount)return present;
  return new Promise((resolve,reject)=>{
   const script=document.createElement('script');script.src=`${config.base}runtime.js`;script.async=true;
   script.onload=()=>window[config.global]?.mount?resolve(window[config.global]):reject(new Error('runtime missing'));
   script.onerror=()=>reject(new Error('runtime failed to load'));
   document.head.append(script);
  });
 }).catch(error=>{promises.delete(id);throw error;});
 promises.set(id,promise);return promise;
}
