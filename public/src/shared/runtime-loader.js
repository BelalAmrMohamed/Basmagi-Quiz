import { RUNTIME_CONFIG } from './runtime-config.js';
const promises = new Map();
export function loadRuntime(id) {
 const config=RUNTIME_CONFIG[id]; if(!config) return Promise.reject(new Error('runtime missing'));
 const present=window[config.global]; if(present?.mount)return Promise.resolve(present);
 if(promises.has(id))return promises.get(id);
 const promise=new Promise((resolve,reject)=>{let css=document.querySelector(`link[data-runtime-css=\"${id}\"]`);if(!css){css=document.createElement('link');css.rel='stylesheet';css.href=`${config.base}runtime.css`;css.dataset.runtimeCss=id;document.head.append(css);}const script=document.createElement('script');script.src=`${config.base}runtime.js`;script.async=true;script.onload=()=>window[config.global]?.mount?resolve(window[config.global]):reject(new Error('runtime missing'));script.onerror=()=>reject(new Error('runtime failed to load'));document.head.append(script);}).catch(e=>{promises.delete(id);throw e;});promises.set(id,promise);return promise;
}
