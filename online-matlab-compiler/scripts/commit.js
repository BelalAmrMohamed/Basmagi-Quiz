// =============================
// scripts/commit.js
//
// Backs `npm run commit`. Stages everything and commits it.
//
//   npm run commit -- "Updated quiz page"   → uses that message as-is.
//   npm run commit                          → generates a message from
//                                              what actually changed, e.g.
//                                              "Updated quiz.js, quiz.html,
//                                              & quiz.css. Renamed quiz-old.js
//                                              to quiz-new.js. Moved
//                                              helpers.js to lib/helpers.js.
//                                              Deleted old-notes.md. Added
//                                              quiz-new-page.js"
// =============================

import { execFileSync } from "child_process";
import { categorizeStatus, buildChangeMessage } from "./git-changes.js";

// `npm run commit -- "msg"` forwards "msg" as argv[2] here.
// `npm run commit` (no extra args) leaves argv at length 2.
const customMessage = process.argv.slice(2).join(" ").trim();

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" });
}

// git add -A first, so `git status --porcelain` below reports the final
// staged state (including renames) that's actually about to be committed.
git(["add", "-A"]);

// A custom message must not bypass the empty-commit guard. Git treats an
// empty commit as an error by default; make both invocation styles report
// the same friendly result instead.
const stagedStatus = git(["status", "--porcelain=v1", "-z"]);
if (!stagedStatus) {
  console.log("Nothing to commit — working tree is clean.");
  process.exit(0);
}

function buildAutoMessage(statusOutput) {
  // --porcelain=v1 -z: NUL-separated records. Each record is
  // "XY <path>", and rename records ("R ") are followed by an extra
  // NUL-separated "<old path>" entry before the next record starts.
  const buckets = categorizeStatus(statusOutput);
  return buildChangeMessage(buckets); // null if nothing staged
}

let message = customMessage;

if (!message) {
  message = buildAutoMessage(stagedStatus);
}

git(["commit", "-m", message]);
console.log(`git commit -m "${message}"`);
