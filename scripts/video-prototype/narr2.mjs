import fs from "fs"; import { narrate } from "./speech.mjs";
const f=JSON.parse(fs.readFileSync("fixture.json"));
for (const ml of ["ar","en"]) fs.writeFileSync(`narr_math_${ml}.json`,JSON.stringify(f.scenes.map(s=>({id:s.id,runs:narrate(s.md,f.lesson.lang,{mathLang:ml})})),null,1));
