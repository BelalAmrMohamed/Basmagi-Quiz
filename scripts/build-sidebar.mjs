#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

export const SENTINEL_START = "<!-- START: Unified Sidebar & Navigation -->";
export const SENTINEL_END = "<!-- END: Unified Sidebar & Navigation -->";

export const APP_PAGES = [
  { file: "public/index.html", activeNav: "home" },
  { file: "public/create-quiz.html", activeNav: "create-quiz" },
  { file: "public/create-lesson.html", activeNav: "create-lesson" },
  { file: "public/lesson.html", activeNav: "none" },
  { file: "public/notebook.html", activeNav: "create-notebook" },
  { file: "public/profile.html", activeNav: "profile" },
  { file: "public/reports.html", activeNav: "reports" },
  { file: "public/result.html", activeNav: "none" },
  { file: "public/settings.html", activeNav: "settings" },
];

export const DOCUMENTS_SHELL_FILE = "public/src/features/documents/documents-shell.js";
export const PARTIAL_PATH = path.join(ROOT, "scripts/partials/sidebar.html");

export function getCanonicalTemplate() {
  return fs.readFileSync(PARTIAL_PATH, "utf8");
}

export function renderAppSidebar({ activeNav = "none" } = {}) {
  let template = getCanonicalTemplate();

  // Clear slots
  template = template.replace("<!-- DOCS_MENU_SLOT -->", "");
  template = template.replace("<!-- DOCS_PINNED_ACTION_SLOT -->", "");

  if (activeNav === "home") {
    template = template.replace(
      /(<!-- NAV_ITEM:home -->\s*<a href="\/" class="menu-item)(")/,
      '$1 active" aria-current="page"'
    );
    template = template.replace(
      /(<!-- BOTTOM_NAV_ITEM:home -->\s*<a href="\/" class="bottom-nav-item)(")/,
      '$1 active" aria-current="page"'
    );
  } else if (activeNav === "create-quiz") {
    template = template.replace(
      /(<!-- NAV_ITEM:create-quiz -->\s*<a href="create-quiz" class="menu-item)(")/,
      '$1 active" aria-current="page"'
    );
  } else if (activeNav === "create-lesson") {
    template = template.replace(
      /(<!-- NAV_ITEM:create-lesson -->\s*<a href="create-lesson" class="menu-item)(")/,
      '$1 active" aria-current="page"'
    );
  } else if (activeNav === "create-notebook") {
    template = template.replace(
      /(<!-- NAV_ITEM:notebook -->\s*<a href="\/notebook\/new" class="menu-item)(")/,
      '$1 active" aria-current="page"'
    );
    template = template.replace(
      /(<!-- BOTTOM_NAV_ITEM:notebook -->\s*<a href="\/notebook\/new" class="bottom-nav-item)(")/,
      '$1 active" aria-current="page"'
    );
  } else if (activeNav === "profile") {
    template = template.replace(
      /(<!-- NAV_ITEM:profile -->\s*<a href="profile" class="side-menu-profile-dropdown-item)(")/,
      '$1 active" aria-current="page"'
    );
    template = template.replace(
      /(<!-- BOTTOM_NAV_ITEM:profile -->\s*<a href="profile" class="bottom-nav-item) (bottom-nav-item-profile")/i,
      '$1 active $2 aria-current="page"'
    );
  } else if (activeNav === "reports") {
    template = template.replace(
      /(<!-- NAV_ITEM:reports -->\s*<a href="reports" class="side-menu-profile-dropdown-item)(")/,
      '$1 active" aria-current="page"'
    );
  } else if (activeNav === "settings") {
    template = template.replace(
      /(<!-- (?:NAV|PINNED)_ITEM:settings -->\s*<a href="settings" class="menu-item)(")/,
      '$1 active" aria-current="page"'
    );
    template = template.replace(
      /(<!-- BOTTOM_NAV_ITEM:settings -->\s*<a href="settings" class="bottom-nav-item)(")/,
      '$1 active" aria-current="page"'
    );
  }

  return template;
}

export function renderDocsShellSidebar() {
  const template = getCanonicalTemplate();

  // Extract from backdrop up to bottom nav closing tag (excluding anti-flash at top & avatar at bottom)
  const backdropIdx = template.indexOf('<div class="side-menu-backdrop"');
  if (backdropIdx === -1) {
    throw new Error("Could not find side-menu-backdrop in sidebar partial");
  }

  const bottomNavEndMarker = "<!-- End of Bottom Navigation Bar -->";
  const bottomNavEndIdx = template.indexOf(bottomNavEndMarker);
  if (bottomNavEndIdx === -1) {
    throw new Error("Could not find End of Bottom Navigation Bar in sidebar partial");
  }

  let markup = template.slice(backdropIdx, bottomNavEndIdx + bottomNavEndMarker.length);
  markup = markup.replace("<!-- DOCS_MENU_SLOT -->", "");
  markup = markup.replace("<!-- DOCS_PINNED_ACTION_SLOT -->", "");

  // On doc pages, /docs is already part of the docs navigation menu (DOCS_GROUPS).
  // Remove the pinned /docs link from .sidebar-pinned-actions to avoid duplicate /docs links.
  markup = markup.replace(
    /\s*<!-- PINNED_ITEM:docs -->[\s\S]*?<!-- END_PINNED_ITEM:docs -->/i,
    ""
  );

  return markup;
}

export function injectSidebarIntoHtml(html, renderedSidebar) {
  // 1. If already wrapped in sentinels, replace strictly within sentinels
  const sentinelRegex =
    /<!-- START: Unified Sidebar & Navigation -->[\s\S]*?<!-- END: Unified Sidebar & Navigation -->/;
  if (sentinelRegex.test(html)) {
    return html.replace(
      sentinelRegex,
      `${SENTINEL_START}\n${renderedSidebar}\n    ${SENTINEL_END}`
    );
  }

  // 2. Safety: The actual <body> tag is ALWAYS strictly after </head>!
  const headEndIndex = html.indexOf("</head>");
  if (headEndIndex === -1) {
    throw new Error("Could not find </head> tag in HTML");
  }

  const afterHead = html.slice(headEndIndex);
  const bodyMatch = afterHead.match(/<body\b[^>]*>/i);
  if (!bodyMatch) {
    throw new Error("Could not find <body> tag after </head> in HTML");
  }

  const actualBodyIndex = headEndIndex + bodyMatch.index;
  const bodyTag = bodyMatch[0];
  const headAndBodyOpen = html.slice(0, actualBodyIndex + bodyTag.length);
  const bodyContent = html.slice(actualBodyIndex + bodyTag.length);

  // In bodyContent, find the legacy sidebar block.
  // The sidebar starts right at the beginning of bodyContent (or after leading whitespace/newlines)
  // And ends after the bottom-nav avatar script (if present) or after the bottom-nav </nav>.
  const bottomNavIdx = bodyContent.indexOf('class="bottom-nav"');
  if (bottomNavIdx === -1) {
    throw new Error("Could not find bottom-nav in body content");
  }

  const bottomNavClose = bodyContent.indexOf("</nav>", bottomNavIdx);
  if (bottomNavClose === -1) {
    throw new Error("Could not find </nav> for bottom-nav");
  }

  let sidebarEndIndex = bottomNavClose + 6; // after </nav>

  // Check if an avatar inline script immediately follows </nav>
  // e.g. <!-- End of Bottom Navigation Bar --> ... <script> ... </script>
  const afterBottomNav = bodyContent.slice(sidebarEndIndex);
  const avatarScriptMatch = afterBottomNav.match(
    /^\s*(?:<!--[\s\S]*?-->\s*)*<script\b[^>]*>[\s\S]*?<\/script>/i
  );

  if (avatarScriptMatch) {
    sidebarEndIndex += avatarScriptMatch[0].length;
  }

  const remainingBodyContent = bodyContent.slice(sidebarEndIndex);

  const updatedHtml = `${headAndBodyOpen}\n    ${SENTINEL_START}\n${renderedSidebar}\n    ${SENTINEL_END}\n${remainingBodyContent}`;

  // Sanity assertions to prevent any corrupted output
  if (!updatedHtml.includes("</head>")) {
    throw new Error("Integrity check failed: </head> missing!");
  }
  if (!updatedHtml.includes(bodyTag)) {
    throw new Error("Integrity check failed: <body> tag missing!");
  }
  if (!updatedHtml.includes(".css")) {
    throw new Error("Integrity check failed: Stylesheet reference missing!");
  }
  if (!updatedHtml.includes(SENTINEL_START) || !updatedHtml.includes(SENTINEL_END)) {
    throw new Error("Integrity check failed: Sentinels missing!");
  }

  return updatedHtml;
}

export function updateDocumentsShellSource(currentSource, renderedDocsMarkup) {
  const markupRegex = /const sidebarMarkup = `[\s\S]*?`;/;
  if (!markupRegex.test(currentSource)) {
    throw new Error("Could not find const sidebarMarkup declaration in documents-shell.js");
  }

  return currentSource.replace(
    markupRegex,
    `const sidebarMarkup = \`\n${renderedDocsMarkup}\n\`;`
  );
}

export function buildAll({ write = true, check = false } = {}) {
  const results = [];
  let staleCount = 0;

  // Process 9 App HTML pages
  for (const target of APP_PAGES) {
    const fullPath = path.join(ROOT, target.file);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Target file not found: ${target.file}`);
    }

    const originalContent = fs.readFileSync(fullPath, "utf8");
    const rendered = renderAppSidebar({ activeNav: target.activeNav });
    const updatedContent = injectSidebarIntoHtml(originalContent, rendered);

    const isStale = originalContent !== updatedContent;
    if (isStale) {
      staleCount++;
      if (write) {
        fs.writeFileSync(fullPath, updatedContent, "utf8");
      }
    }

    results.push({
      file: target.file,
      stale: isStale,
    });
  }

  // Process documents-shell.js
  const docShellPath = path.join(ROOT, DOCUMENTS_SHELL_FILE);
  if (fs.existsSync(docShellPath)) {
    const originalShell = fs.readFileSync(docShellPath, "utf8");
    const docsMarkup = renderDocsShellSidebar();
    const updatedShell = updateDocumentsShellSource(originalShell, docsMarkup);

    const isStale = originalShell !== updatedShell;
    if (isStale) {
      staleCount++;
      if (write) {
        fs.writeFileSync(docShellPath, updatedShell, "utf8");
      }
    }

    results.push({
      file: DOCUMENTS_SHELL_FILE,
      stale: isStale,
    });
  }

  if (check) {
    if (staleCount > 0) {
      console.error(
        `sidebar: ${staleCount} file(s) differ from canonical partial. Run 'npm run sidebar:build' to sync.`
      );
      for (const r of results.filter((x) => x.stale)) {
        console.error(`  - ${r.file}`);
      }
      process.exit(1);
    } else {
      console.log(`sidebar: all ${results.length} files up to date with single-source partial.`);
    }
  }

  return { results, staleCount, total: results.length };
}

// CLI entry point
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (isMain) {
  const check = process.argv.includes("--check");
  const result = buildAll({ write: !check, check });
  if (!check) {
    console.log(`sidebar: updated ${result.total} files (${result.staleCount} were modified).`);
  }
}
