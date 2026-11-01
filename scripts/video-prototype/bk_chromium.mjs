import { createRequire } from "module"; const { chromium } = createRequire(import.meta.url)("playwright"); import fs from "fs"; import { spawn } from "child_process"; import { sceneHTML } from "./page.mjs";
const L = JSON.parse(fs.readFileSync("layout.json")); const out = process.argv[2] || "out_chromium.mp4";
const t0 = Date.now();
const ff = spawn("ffmpeg", ["-loglevel","error","-y","-f","image2pipe","-framerate",String(L.fps),"-c:v","mjpeg","-i","-","-i","master.wav","-c:v","libx264","-preset","veryfast","-crf","20","-pix_fmt","yuv420p","-c:a","aac","-shortest","-movflags","+faststart","tmp_"+out], { stdio: ["pipe","inherit","inherit"] });
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: L.w, height: L.h } });
let frames = 0, shots = 0, prevSig = null, prevBuf = null;
for (const s of L.scenes) {
  fs.writeFileSync("_scene.html", sceneHTML(s)); await p.goto("file://" + process.cwd() + "/_scene.html"); await p.evaluate(() => document.fonts.ready);
  const n = Math.round(s.dur * L.fps);
  for (let f = 0; f < n; f++) {
    const sig = await p.evaluate((t) => window.setT(t), f / L.fps);
    if (sig !== prevSig || !prevBuf) { prevBuf = await p.screenshot({ type: "jpeg", quality: 92 }); prevSig = sig; shots++; }
    if (!ff.stdin.write(prevBuf)) await new Promise((r) => ff.stdin.once("drain", r));
    frames++;
  }
}
ff.stdin.end(); await new Promise((r) => ff.on("close", r)); await b.close();
fs.renameSync("tmp_" + out, out);
console.log(JSON.stringify({ backend: "chromium", frames, screenshots: shots, wall_s: ((Date.now() - t0) / 1000).toFixed(1) }));
