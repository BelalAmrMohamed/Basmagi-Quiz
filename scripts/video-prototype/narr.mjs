import fs from "fs"; import { narrate } from "./speech.mjs";
const f=JSON.parse(fs.readFileSync("fixture.json"));
const out=f.scenes.map(s=>({id:s.id,runs:narrate(s.md,f.lesson.lang)}));
fs.writeFileSync("narr.json",JSON.stringify(out,null,1));
for(const s of out){console.log("##",s.id);for(const r of s.runs)console.log(" ",r.lang,"|",r.text);}
