// =============================================================================
// tests/sidebar-drift.test.js
// Guards against sidebar drift: verifies that all 9 app pages and
// documents-shell.js strictly match the canonical single-source partial in
// scripts/partials/sidebar.html.
// =============================================================================

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildAll,
  APP_PAGES,
  DOCUMENTS_SHELL_FILE,
  SENTINEL_START,
  SENTINEL_END,
  PARTIAL_PATH,
} from "../scripts/build-sidebar.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

test("buildAll({ write: false }) reports 0 stale files (run `npm run sidebar:build`)", () => {
  const { results, staleCount, total } = buildAll({ write: false });
  assert.equal(total, 10, "Must check all 9 app pages and documents-shell.js");
  const stale = results.filter((r) => r.stale).map((r) => r.file);
  assert.deepEqual(
    stale,
    [],
    `Sidebar drift detected in: ${stale.join(", ")}. Run 'npm run sidebar:build' to sync from scripts/partials/sidebar.html`
  );
  assert.equal(staleCount, 0, "No files should be stale");
});

test("all 9 app pages contain the sentinel-wrapped canonical sidebar with proper active states", () => {
  for (const item of APP_PAGES) {
    const fullPath = path.join(ROOT, item.file);
    assert.ok(fs.existsSync(fullPath), `${item.file} does not exist`);
    const content = fs.readFileSync(fullPath, "utf8");

    // Structural integrity checks
    assert.ok(content.includes("</head>"), `${item.file} is missing </head>`);
    assert.ok(content.includes("<body"), `${item.file} is missing <body`);
    assert.ok(content.includes(".css"), `${item.file} is missing stylesheet references`);

    assert.ok(content.includes(SENTINEL_START), `${item.file} is missing ${SENTINEL_START}`);
    assert.ok(content.includes(SENTINEL_END), `${item.file} is missing ${SENTINEL_END}`);

    // Verify critical controls are in the file
    assert.ok(content.includes('id="sideMenuBackdrop"'), `${item.file} is missing #sideMenuBackdrop`);
    assert.ok(content.includes('id="sidebar"'), `${item.file} is missing #sidebar`);
    assert.ok(content.includes('id="bottomNav"'), `${item.file} is missing #bottomNav`);
    assert.ok(content.includes('id="navSidebarAvatar"'), `${item.file} is missing #navSidebarAvatar`);
    assert.ok(content.includes('id="themeControlsToggle"'), `${item.file} is missing #themeControlsToggle`);

    // Verify anti-flash script is present
    assert.ok(
      content.includes("window.__sidebarExpandedInit = expanded;"),
      `${item.file} is missing synchronous anti-flash expand initializer`
    );

    // Verify pinned action link to /docs is present on every app page
    assert.match(
      content,
      /<a href="\/docs" class="menu-item" data-tooltip="الأدلة والمساعدة">/,
      `${item.file} is missing pinned /docs action link`
    );

    // Verify page-specific active state
    if (item.activeNav === "home") {
      assert.match(content, /<a href="\/" class="menu-item active"[^>]*data-tooltip="الصفحة الرئيسية"/);
    }
    if (item.activeNav === "create-quiz") {
      assert.match(content, /<a href="create-quiz" class="menu-item active"[^>]*data-tooltip="إنشاء امتحانات"/);
    }
    if (item.activeNav === "create-lesson") {
      assert.match(content, /<a href="create-lesson" class="menu-item active"[^>]*data-tooltip="إنشاء دروس"/);
    }
    if (item.activeNav === "create-notebook") {
      assert.match(content, /<a href="\/notebook\/new" class="menu-item active"[^>]*data-tooltip="إنشاء دفاتر"/);
      assert.match(content, /<a href="\/notebook\/new" class="bottom-nav-item active"[^>]*data-bottom-nav="notebook"/);
    }
    if (item.activeNav === "settings") {
      assert.match(content, /<a href="settings" class="menu-item active"[^>]*data-tooltip="الإعدادات"/);
    }
  }
});

test("documents-shell.js contains the canonical docs sidebar without duplicate /docs or /settings links", () => {
  const shellPath = path.join(ROOT, DOCUMENTS_SHELL_FILE);
  const shellJs = fs.readFileSync(shellPath, "utf8");

  assert.ok(shellJs.includes("const sidebarMarkup = `"), "documents-shell.js missing const sidebarMarkup");
  assert.ok(shellJs.includes('id="sideMenuBackdrop"'), "documents-shell.js missing #sideMenuBackdrop");
  assert.ok(shellJs.includes('id="sidebar"'), "documents-shell.js missing #sidebar");
  assert.ok(shellJs.includes('id="bottomNav"'), "documents-shell.js missing #bottomNav");
  assert.ok(shellJs.includes('id="themeControlsToggle"'), "documents-shell.js missing #themeControlsToggle");

  // Verify no duplicate /docs or /settings links in documents-shell.js sidebar markup
  const markupMatch = shellJs.match(/const sidebarMarkup = `([\s\S]*?)`;/);
  assert.ok(markupMatch, "sidebarMarkup regex match failed");
  const markup = markupMatch[1];
  const asideMatch = markup.match(/<aside[\s\S]*?<\/aside>/);
  assert.ok(asideMatch, "<aside> block missing in sidebarMarkup");
  const aside = asideMatch[0];

  // In <aside>, /docs is omitted from pinned actions because DOCS_GROUPS supplies it once in the navigation
  const docsInAside = (aside.match(/href="\/docs"/g) || []).length;
  assert.equal(docsInAside, 0, "Doc pages <aside> must not contain pinned /docs (DOCS_GROUPS provides it once)");

  // In <aside>, settings link must appear exactly once in pinned actions
  const settingsInAside = (aside.match(/href="settings"/g) || []).length;
  assert.equal(settingsInAside, 1, "Doc pages <aside> must contain exactly one settings link");

  // Verify documents-shell.js does not append a duplicate sidebar-pinned-actions block
  assert.equal(
    (shellJs.match(/class="sidebar-pinned-actions"/g) || []).length,
    1,
    "documents-shell.js must contain only one sidebar-pinned-actions declaration"
  );

  // Verify theme-controls-section precedes docs-menu-section in documents-shell.js
  assert.ok(
    shellJs.includes('themeSection.insertAdjacentHTML("afterend", docsSectionHtml)'),
    "documents-shell.js must insert docs section after theme-controls-section so theme controls sit directly under account"
  );
});

test("canonical template in scripts/partials/sidebar.html contains all expected navigation links", () => {
  const template = fs.readFileSync(PARTIAL_PATH, "utf8");

  assert.ok(template.includes('href="/"'), "missing home link");
  assert.ok(template.includes('href="/my-content"'), "missing my-content link");
  assert.ok(template.includes('href="create-quiz"'), "missing create-quiz link");
  assert.ok(template.includes('href="create-lesson"'), "missing create-lesson link");
  assert.ok(template.includes('href="/notebook/new"'), "missing notebook link");
  assert.ok(template.includes('href="profile"'), "missing profile link");
  assert.ok(template.includes('href="reports"'), "missing reports link");
  assert.ok(template.includes('href="/docs"'), "missing docs link");
  assert.ok(template.includes('href="settings"'), "missing settings link");
  assert.ok(template.includes('class="bottom-nav"'), "missing bottom navigation bar");

  // Verify mobile bottom nav order: profile -> home -> my-content -> notebook -> settings -> more
  const bottomNavMatch = template.match(/<nav class="bottom-nav"[\s\S]*?<\/nav>/);
  assert.ok(bottomNavMatch, "bottom-nav block missing");
  const bottomNav = bottomNavMatch[0];
  const myContentPos = bottomNav.indexOf('href="/my-content"');
  const notebookPos = bottomNav.indexOf('href="/notebook/new"');
  const homePos = bottomNav.indexOf('href="/"');
  const settingsPos = bottomNav.indexOf('href="settings"');
  assert.ok(myContentPos > homePos && notebookPos > myContentPos && settingsPos > notebookPos,
    "bottom-nav must order /my-content and /notebook/new between home and settings");
  assert.ok(!bottomNav.includes('href="create-quiz"'), "bottom-nav must not include create-quiz");
  assert.ok(!bottomNav.includes('href="create-lesson"'), "bottom-nav must not include create-lesson");
});
