import { Canvas, FontLibrary, loadImage } from "skia-canvas"; import fs from "fs"; import { spawn } from "child_process";
const L = JSON.parse(fs.readFileSync("layout.json")); const out = process.argv[2] || "out_skia.mp4";
FontLibrary.use("Cairo", ["Cairo-400.ttf"]); FontLibrary.use("CairoB", ["Cairo-700.ttf"]);
const W = L.w, H = L.h, FPS = L.fps; const t0 = Date.now();
// preload equation images (MathJax SVG)
const imgs = {};
for (const s of L.scenes) for (const it of s.items) if (it.svg) { let svg = fs.readFileSync(it.svg, "utf8");
  svg = svg.replace(/width="[^"]+ex"/, (m) => m).replace(/style="[^"]*"/, ""); const ex = svg.match(/width="([\d.]+)ex" height="([\d.]+)ex"/); const w = ex ? parseFloat(ex[1]) * 16 * 1.9 : 400, h = ex ? parseFloat(ex[2]) * 16 * 1.9 : 80;
  svg = svg.replace(/width="[\d.]+ex" height="[\d.]+ex"/, `width="${w}" height="${h}"`); imgs[it.svg] = { img: await loadImage(Buffer.from(svg)), w, h }; }
const cv = new Canvas(W, H); const ctx = cv.getContext("2d");
function frame(s, t) {
  ctx.fillStyle = "#0f1320"; ctx.fillRect(0, 0, W, H);
  ctx.direction = "rtl"; ctx.textAlign = "right"; ctx.textBaseline = "top";
  ctx.fillStyle = "#7cc4ff"; ctx.font = "54px CairoB"; ctx.fillText(s.title, W - 72, 40);
  let y = 150;
  for (const it of s.items) {
    const p = Math.min(1, Math.max(0, (t - it.t) / 0.5)); ctx.globalAlpha = p; const yy = y + (1 - p) * 14;
    if (it.k === "m") { const im = imgs[it.svg]; ctx.drawImage(im.img, (W - im.w) / 2, yy, im.w, im.h); y += im.h + 14; }
    else if (it.k === "l") { ctx.direction = "ltr"; ctx.textAlign = "left"; ctx.fillStyle = "#ffd479"; ctx.font = "34px Cairo"; ctx.fillText(it.v, 72, yy); ctx.direction = "rtl"; ctx.textAlign = "right"; y += 60; }
    else { ctx.fillStyle = "#eef1f8"; ctx.font = "38px Cairo"; ctx.fillText(it.v, W - 72, yy); y += 62; }
    ctx.globalAlpha = 1;
  }
}
if (process.argv[3] === "still") { const s = L.scenes[+process.argv[4]]; frame(s, 99); await cv.saveAs("skia_still.png"); process.exit(0); }
const ff = spawn("ffmpeg", ["-loglevel", "error", "-y", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-", "-i", "master.wav", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "tmp_" + out], { stdio: ["pipe", "inherit", "inherit"] });
let frames = 0, shots = 0, prevSig = null, prevBuf = null;
for (const s of L.scenes) { const n = Math.round(s.dur * FPS);
  for (let f = 0; f < n; f++) { const t = f / FPS; const sig = s.items.map((it) => Math.min(1, Math.max(0, (t - it.t) / 0.5)).toFixed(3)).join(",");
    if (sig !== prevSig || !prevBuf) { frame(s, t); prevBuf = await cv.toBuffer("jpeg", { quality: 0.92 }); prevSig = sig; shots++; }
    if (!ff.stdin.write(prevBuf)) await new Promise((r) => ff.stdin.once("drain", r)); frames++; } }
ff.stdin.end(); await new Promise((r) => ff.on("close", r)); fs.renameSync("tmp_" + out, out);
console.log(JSON.stringify({ backend: "skia-canvas", frames, screenshots: shots, wall_s: ((Date.now() - t0) / 1000).toFixed(1) }));
