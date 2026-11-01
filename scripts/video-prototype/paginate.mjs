import { createRequire } from "module"; const { chromium } = createRequire(import.meta.url)("playwright");
import fs from "fs"; import { sceneHTML } from "./board.mjs";
const SB = JSON.parse(fs.readFileSync("storyboard.json")); const cwd = process.cwd();
const FB = "node_modules/@fontsource"; 
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
for (const s of SB.scenes) {
  fs.writeFileSync("_m.html", sceneHTML(s, s.style, "file://" + cwd + "/fonts", "file://" + cwd + "/node_modules/katex/dist"));
  await p.goto("file://" + cwd + "/_m.html"); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(150);
  const m = await p.evaluate(() => window.measure());
  const H = m.heights, avail = m.avail; const pages = [{ items: [0] }]; let used = H[0]; const scale = {};
  for (let i = 1; i < H.length; i++) {
    let h = H[i]; const room = avail - H[0];
    if (h > room) { scale[i] = Math.max(0.5, room / h); h = Math.min(h, room); }
    if (used + h > avail && pages.at(-1).items.length > 1) { pages.push({ items: [0] }); used = H[0]; }
    pages.at(-1).items.push(i); used += h;
  }
  s.pages = pages; s.scale = scale; s.heights = H; console.log(s.id, s.style, "items", H.length, "avail", Math.round(avail), "pages", pages.map((q) => q.items.join("+")).join(" | "));
}
fs.writeFileSync("storyboard.json", JSON.stringify(SB, null, 1)); await b.close();
