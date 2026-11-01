import fs from "fs"; import { narrate } from "./speech.mjs";
const f = JSON.parse(fs.readFileSync("fixture2.json")); const mathLang = process.env.MATHLANG || "en";
const ORDER = ["chalk","whiteboard","notebook","blueprint","blackboard"];
f.scenes.forEach((s, si) => { s.style = ORDER[si % ORDER.length];
  for (const it of s.items) {
    let md = "";
    if (it.k === "title" || it.k === "text") md = it.md;
    else if (it.k === "math") md = "$$" + it.tex + "$$";
    else if (it.k === "line") md = it.md;
    else if (it.k === "list") md = it.items.join(". ");
    else if (it.k === "table") md = it.say;
    it.runs = narrate(md, f.lesson.lang, { mathLang });
  } });
fs.writeFileSync("storyboard.json", JSON.stringify(f, null, 1));
console.log("scenes", f.scenes.length, "mathLang", mathLang);
