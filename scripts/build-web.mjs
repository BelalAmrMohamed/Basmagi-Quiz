// =============================================================================
// scripts/build-web.mjs
// Bundles the home page's ES modules + CSS into public/dist/ so a first visit
// needs a handful of requests instead of ~200 (see PERFORMANCE_PLAN.md, phase B).
//
//   node scripts/build-web.mjs          production build (minified)
//   node scripts/build-web.mjs --watch  rebuild on change (dev)
//
// Per page: dist/pages/<page>.js + .css (same stable-name/no-cache rule as home.*).
// Output (public/dist, git-ignored, produced by Vercel's buildCommand):
//   home.js           single stable-named entry (theme-controller, flow-field,
//                     index-entrypoint, side-menu, PWA init). Served with no-cache
//                     (cheap 304) so a deploy is picked up immediately.
//   chunks/*-<hash>.js  shared / lazily imported code. Content-hashed => immutable.
//   home.css          every local stylesheet linked from index.html, in the same order.
// The original files in public/src stay deployed: pages that are not bundled yet
// (quiz, lesson, create-*, ...) and runtime fetches of CSS files still use them.
// =============================================================================
import { build, context } from "esbuild";
import { readFile, rm, mkdir, writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const pub = path.join(root, "public");
const out = path.join(pub, "dist");
const watch = process.argv.includes("--watch");

// One entry => everything the home page needs on first paint is a single file;
// only genuinely lazy code (dynamic import()) becomes separate chunks.
// Order mirrors the <script type="module"> order that index.html used to have.
const ENTRY_ORDER = [
  "src/shared/theme-controller.js",
  "src/shared/flow-field.js",
  "src/features/home/index-entrypoint.js",
  "src/components/side-menu/side-menu.js",
];

// import.meta.url would point at dist/chunks/... after bundling, which breaks
// `new URL("./x.css", import.meta.url)`. Pin it to the file's original URL.
const pinImportMeta = {
  name: "pin-import-meta-url",
  setup(b) {
    b.onLoad({ filter: /public[\\/]src[\\/].*\.js$/ }, async (args) => {
      let src = await readFile(args.path, "utf8");
      if (!src.includes("import.meta.url")) return null;
      const rel = "/" + path.relative(pub, args.path).split(path.sep).join("/");
      src = src.replaceAll("import.meta.url", `(location.origin + ${JSON.stringify(rel)})`);
      return { contents: src, loader: "js" };
    });
  },
};

// Local stylesheets, in the exact order index.html used to link them (order matters for the cascade).
const HOME_CSS = [
  "src/styles/themes.css",
  "src/features/home/index.css",
  "src/components/quiz-info-modal/quiz-info-modal.css",
  "src/features/home/user-quizzes-trash-panel.css",
  "src/components/download-quiz-modal/download-quiz-modal.css",
  "src/styles/advanced-liquid-metal-animations.css",
  "src/components/side-menu/side-menu.css",
  "src/features/home/item-dropdown-menu.css",
  "src/components/tooltip/tooltip.css",
  "src/components/ai-agent/ai-agent.css",
  "src/styles/markdown.css",
  "src/features/lesson/lesson.css",
  "src/shared/doc-toc.css",
  "src/components/notifications/notifications.css",
  "src/features/home/search.css",
  "src/components/offline-banner/offline-banner.css",
  "src/features/home/sign-in.css",
  "src/features/home/hive-tokens.css",
  "src/features/home/hive.css",
  "src/features/home/cards-v2.css",
  "src/features/home/user-course-card.css",
];
const shared = { bundle: true, minify: !watch, sourcemap: watch ? "inline" : false, logLevel: "info", legalComments: "none" };

async function run() {
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });

  // Generated entry (kept out of public/ so it is never deployed).
  const tmp = await mkdtemp(path.join(tmpdir(), "basmagi-web-"));
  const entryFile = path.join(tmp, "home-entry.js");
  await writeFile(entryFile, [
    ...ENTRY_ORDER.map((f) => `import ${JSON.stringify(path.join(pub, f))};`),
    `import { initPWAWithBanner } from ${JSON.stringify(path.join(pub, "src/shared/pwa-manager.js"))};`,
    `document.addEventListener("DOMContentLoaded", () =>`,
    `  initPWAWithBanner(window.SUPABASE_URL ? \`${"$"}{window.SUPABASE_URL}/rest/v1/\` : ""));`,
  ].join("\n"));

  // One entry (+ one CSS file) per HTML page, from scripts/page-bundles.json
  // (generated once from each page's old <script>/<link> tags, in document order).
  const pages = JSON.parse(await readFile(path.join(import.meta.dirname, "page-bundles.json"), "utf8"));
  const jsEntries = { home: entryFile };
  const cssEntries = {};
  const homeCss = path.join(tmp, "home-css.css");
  await writeFile(homeCss, HOME_CSS.map((h) => `@import ${JSON.stringify(path.join(pub, h))};`).join("\n"));
  cssEntries.home = homeCss;
  for (const [name, { js, css }] of Object.entries(pages)) {
    if (js.length) {
      const f = path.join(tmp, `page-${name}.js`);
      await writeFile(f, js.map((m) => `import ${JSON.stringify(path.join(pub, m))};`).join("\n"));
      jsEntries[`pages/${name}`] = f;
    }
    if (css.length) {
      const f = path.join(tmp, `page-${name}.css`);
      await writeFile(f, css.map((m) => `@import ${JSON.stringify(path.join(pub, m))};`).join("\n"));
      cssEntries[`pages/${name}`] = f;
    }
  }

  const jsOpts = {
    ...shared,
    entryPoints: jsEntries,
    outdir: out,
    entryNames: "[dir]/[name]",
    chunkNames: "chunks/[name]-[hash]",
    format: "esm",
    splitting: true,
    target: "es2022",
    plugins: [pinImportMeta],
    external: ["/assets/*", "/src/*", "http://*", "https://*"],
    metafile: true,
  };
  const cssOpts = {
    ...shared,
    entryPoints: cssEntries,
    outdir: out,
    entryNames: "[dir]/[name]",
    // Relative url(...) in bundled CSS (e.g. KaTeX fonts) are copied to dist/assets/ with hashed names.
    loader: { ".woff2": "file", ".woff": "file", ".ttf": "file", ".png": "file", ".jpg": "file", ".jpeg": "file", ".svg": "file", ".gif": "file", ".webp": "file" },
    assetNames: "assets/[name]-[hash]",
    publicPath: "/dist",
    external: ["/assets/*", "/src/*", "http://*", "https://*", "data:*"],
  };

  if (watch) {
    await (await context(jsOpts)).watch();
    await (await context(cssOpts)).watch();
    return;
  }
  const res = await build(jsOpts);
  await build(cssOpts);
  await writeFile(path.join(out, "meta.json"), JSON.stringify(Object.keys(res.metafile.outputs), null, 1));
}

run().catch((e) => { console.error(e); process.exit(1); });
