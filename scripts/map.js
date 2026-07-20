// scripts/map.js
// The generated file will be in: docs/context-map.txt
// > node scripts/map.js

const fs = require("fs");
const path = require("path");

// Settings

// The path of the output map
ouputMapPath = "docs/context-map.txt"

// Files/Folders to ignore
const IGNORE_NAMES = [
  ".git",
  ".vscode",
  "quizzes",
  "images",
  "LICENSE",
  "README.md",
  "_config.yml",
  "Context Map.txt",
  "google0c1df2c3df22a824.html",
];

// Extensions to ignore
const IGNORE_EXT = [];

// Files to keep even if they have an ignored extension
const EXCEPTION_NAMES = ["README.md", "robots.txt"];

// End of Settings

function generateTree() {
  const scriptDir = __dirname;
  const parentDir = path.dirname(scriptDir);
  const outputFile = path.join(parentDir, ouputMapPath);

  const outputStream = fs.createWriteStream(outputFile, { encoding: "utf-8" });
  outputStream.write(`${path.basename(parentDir)}/\n`);

  function walkDir(currentPath, prefix = "") {
    // Get all items and filter them
    let allItems = fs.readdirSync(currentPath).filter((item) => {
      // Filter out ignored names and hidden files
      if (IGNORE_NAMES.includes(item) || item.startsWith(".")) return false;

      // Filter out ignored extensions, unless the file is in EXCEPTION_NAMES
      const isIgnoredExt = IGNORE_EXT.some((ext) => item.endsWith(ext));
      const isException = EXCEPTION_NAMES.includes(item);

      return !isIgnoredExt || isException;
    });

    // Split into files and folders
    const files = allItems
      .filter((item) => fs.statSync(path.join(currentPath, item)).isFile())
      .sort();
    const dirs = allItems
      .filter((item) => fs.statSync(path.join(currentPath, item)).isDirectory())
      .sort();

    // Combine: Files first, then Folders
    const sortedItems = [...files, ...dirs];

    sortedItems.forEach((item, i) => {
      const isLast = i === sortedItems.length - 1;
      const connector = isLast ? "└── " : "├── ";
      const fullPath = path.join(currentPath, item);

      if (fs.statSync(fullPath).isDirectory()) {
        outputStream.write(`${prefix}${connector}${item}/\n`);
        const newPrefix = prefix + (isLast ? "    " : "│   ");
        walkDir(fullPath, newPrefix);
      } else {
        outputStream.write(`${prefix}${connector}${item}\n`);
      }
    });
  }

  walkDir(parentDir);
  outputStream.end();
  console.log(`Done! Check: ${outputFile}.`);
}

generateTree();
