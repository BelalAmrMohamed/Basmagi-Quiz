// =============================
// scripts/commit.js
//
// Backs `npm run commit`. Stages everything and commits it.
//
//   npm run commit -- "Updated quiz page"   → uses that message as-is.
//   npm run commit                          → generates a message from
//                                              what actually changed, e.g.
//                                              "Updated quiz.js, quiz.html,
//                                              & quiz.css. Deleted
//                                              quiz-old.js. Added
//                                              quiz-new.js"
// =============================

import { execFileSync } from "child_process";
import path from "path";

// `npm run commit -- "msg"` forwards "msg" as argv[2] here.
// `npm run commit` (no extra args) leaves argv at length 2.
const customMessage = process.argv.slice(2).join(" ").trim();

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" });
}

// git add -A first, so `git status --porcelain` below reports the final
// staged state (including renames) that's actually about to be committed.
git(["add", "-A"]);

function buildAutoMessage() {
  const statusOutput = git(["status", "--porcelain=v1", "-z"]);

  // --porcelain=v1 -z: NUL-separated records. Each record is
  // "XY <path>", and rename records ("R ") are followed by an extra
  // NUL-separated "<old path>" entry before the next record starts.
  const entries = statusOutput.split("\0").filter(Boolean);

  const added = [];
  const deleted = [];
  const updated = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const statusCode = entry.slice(0, 2);
    const filePath = entry.slice(3);
    const baseName = path.basename(filePath);

    const indexState = statusCode[0]; // staged column (we just `git add -A`ed)

    if (indexState === "R" || indexState === "C") {
      // Rename/copy record: the next entry is the old path. Treat a
      // rename as "added <new>" + "deleted <old>" — clearer in a
      // summary than a single "renamed" bucket, and matches how the
      // other statuses read.
      const oldPath = entries[i + 1];
      i++; // consume the old-path record
      if (oldPath) deleted.push(path.basename(oldPath));
      added.push(baseName);
    } else if (indexState === "A") {
      added.push(baseName);
    } else if (indexState === "D") {
      deleted.push(baseName);
    } else if (indexState === "M" || indexState === "T") {
      updated.push(baseName);
    } else if (indexState === "?") {
      // Untracked, but `git add -A` already staged it above, so this
      // shouldn't occur; handle defensively as "added".
      added.push(baseName);
    }
  }

  if (!added.length && !deleted.length && !updated.length) {
    return null; // nothing staged — let the caller decide what to do
  }

  // "a, b, & c" — Oxford comma, "&" before the last item; a single
  // item is returned bare.
  const joinNames = (names) => {
    if (names.length === 1) return names[0];
    if (names.length === 2) return `${names[0]} & ${names[1]}`;
    return `${names.slice(0, -1).join(", ")}, & ${names[names.length - 1]}`;
  };

  const clauses = [];
  if (updated.length) clauses.push(`Updated ${joinNames(updated)}.`);
  if (deleted.length) clauses.push(`Deleted ${joinNames(deleted)}.`);
  if (added.length) clauses.push(`Added ${joinNames(added)}.`);

  return clauses.join(" ");
}

let message = customMessage;

if (!message) {
  message = buildAutoMessage();
  if (!message) {
    console.log("Nothing to commit — working tree is clean.");
    process.exit(0);
  }
  console.log(`No message given — generated one:\n  "${message}"`);
}

git(["commit", "-m", message]);
console.log("Committed.");