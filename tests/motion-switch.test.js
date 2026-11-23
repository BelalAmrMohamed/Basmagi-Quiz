import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

// The platform's own switch is <html data-motion="reduced"> (High-Performance Mode): the USER
// controls it. theme-controller.js is the only file allowed to read the OS preference — it uses
// it as that switch's default. Everything else must key off html[data-motion="reduced"].
//
// LEGACY is a ratchet: files that still use `prefers-reduced-motion` and have not been migrated
// yet. New files may never be added to it, and a file that no longer uses the media query must
// be removed from it (the test fails until it is).
const BRIDGE = "public/src/shared/theme-controller.js";
const LEGACY = [
  "public/about.html",
  "public/assets/notebook-runtime-cpp/runtime.css",
  "public/assets/notebook-runtime/runtime.css",
  // Generated from docs-src/shells/_head.html, whose inline script still reads the OS preference. Migrating that
  // one shell removes this entry together with how-to-*, privacy-policy and terms-of-service.
  "public/docs.html",
  "public/how-to-connect-mcp.html",
  "public/how-to-create-content.html",
  "public/how-to-upload-content.html",
  "public/how-to-use-ai-agent.html",
  "public/lesson.html",
  "public/notebook.html",
  "public/offline.html",
  "public/onboarding.html",
  "public/privacy-policy.html",
  "public/quiz.html",
  "public/reports.html",
  "public/settings.html",
  "public/src/components/quiz-info-modal/quiz-info-modal-css.js",
  "public/src/components/quiz-info-modal/quiz-info-modal.css",
  "public/src/components/telegram-bot-card/telegram-bot-card.css",
  "public/src/features/documents/about-stats.js",
  "public/src/features/documents/about.css",
  "public/src/features/documents/doc-steps.css",
  "public/src/features/home/cards-v2.css",
  "public/src/features/home/hive.css",
  "public/src/features/home/user-course-card.css",
  "public/src/features/lesson/lesson-tts.js",
  "public/src/features/lesson/lesson.css",
  "public/src/features/notebook/image-tool-window.css",
  "public/src/features/notebook/notebook-editor.css",
  "public/src/features/notebook/notebook.css",
  "public/src/features/profile/profile.css",
  "public/src/features/profile/profile.js",
  "public/src/shared/flow-field.js",
  "public/src/shared/hover-spotlight.js",
  "public/src/shared/rich-input/rich-input.css",
  "public/terms-of-service.html",
];

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const EXT = /\.(js|mjs|css|html)$/;
const SKIP = new Set(["node_modules", ".git", "vendor", "dist"]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (EXT.test(name)) out.push(full);
  }
  return out;
}

const users = walk(join(ROOT, "public"))
  .filter((f) => readFileSync(f, "utf8").includes("prefers-reduced-motion"))
  .map((f) => relative(ROOT, f).split(sep).join("/"))
  .sort();

test("only theme-controller (the bridge) and the not-yet-migrated legacy files use prefers-reduced-motion", () => {
  const unexpected = users.filter((f) => f !== BRIDGE && !LEGACY.includes(f));
  assert.deepEqual(unexpected, [], "use html[data-motion=\"reduced\"] instead of prefers-reduced-motion");
});

test("legacy allowlist has no stale entries (remove a file once it is migrated)", () => {
  const stale = LEGACY.filter((f) => !users.includes(f));
  assert.deepEqual(stale, []);
});

test("floating windows, AI agent and YouTube surfaces never read the OS preference", () => {
  const owned = users.filter((f) => /src\/(components\/ai-agent|features\/home\/youtube|shared\/floating-window)/.test(f));
  assert.deepEqual(owned, []);
});

test("window stylesheets disable all motion under html[data-motion=\"reduced\"]", () => {
  for (const [file, sel] of [
    ["public/src/components/ai-agent/ai-agent-window.css", ".aiw *"],
    ["public/src/features/home/youtube-video-modal.css", ".ytw *"],
  ]) {
    const css = readFileSync(join(ROOT, file), "utf8");
    assert.ok(css.includes(`html[data-motion="reduced"] ${sel}`), `${file} lacks the data-motion block`);
    assert.match(css, /transition:\s*none\s*!important/);
  }
});
