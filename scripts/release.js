// =============================
// scripts/release.js
//
// Backs `npm run release`. Figures out the next version, writes a new
// section into CHANGELOG.md, commits it, and creates a git tag.
//
//   npm run release                 → bumps the PATCH version
//                                      (1.4.2 -> 1.4.3)
//   npm run release -- --minor      → bumps the MINOR version
//                                      (1.4.2 -> 1.5.0)
//   npm run release -- --major      → bumps the MAJOR version
//                                      (1.4.2 -> 2.0.0)
//   npm run release -- 2.3.0        → uses that exact version, ignoring
//                                      whatever's in the changelog
//
// The changelog entry's bullets come from two sources:
//   - a summary of files added/deleted/updated/renamed/moved since the
//     last tag (same categorization commit.js uses)
//   - the commit messages since the last tag
//
// Requires CHANGELOG.md to exist in "Keep a Changelog" format, i.e.
// version sections that look like:
//
//   ## [1.4.2] - 2026-09-01
//   ### Added
//   - Some bullet
// =============================

import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { categorizeStatus, joinNames } from "./git-changes.js";

const CHANGELOG_PATH = path.resolve("CHANGELOG.md");

const rawArgs = process.argv.slice(2);

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function gitOrNull(args) {
  try {
    return git(args);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------
// 1. Figure out the current version from CHANGELOG.md and the next one.
// ---------------------------------------------------------------------

function readChangelog() {
  if (!fs.existsSync(CHANGELOG_PATH)) {
    console.error(
      "No CHANGELOG.md found at project root. Create one in Keep a " +
        "Changelog format first (a '## [x.y.z] - date' section), or run " +
        "with an explicit version and I'll still need a file to write into."
    );
    process.exit(1);
  }
  return fs.readFileSync(CHANGELOG_PATH, "utf8");
}

// Matches the first "## [1.2.3]" heading in the file — that's the latest
// documented release, since new entries always get inserted at the top.
const VERSION_HEADING_RE = /^##\s*\[(\d+)\.(\d+)\.(\d+)\]/m;

function getLatestDocumentedVersion(changelogText) {
  const match = changelogText.match(VERSION_HEADING_RE);
  if (!match) {
    console.error(
      "Couldn't find a '## [x.y.z]' version heading in CHANGELOG.md. " +
        "Add one for the current version, or pass an explicit version " +
        "to start from, e.g. `npm run release -- 1.0.0`."
    );
    process.exit(1);
  }
  return { major: +match[1], minor: +match[2], patch: +match[3] };
}

function bump(version, kind) {
  if (kind === "major") return { major: version.major + 1, minor: 0, patch: 0 };
  if (kind === "minor")
    return { major: version.major, minor: version.minor + 1, patch: 0 };
  return { major: version.major, minor: version.minor, patch: version.patch + 1 };
}

function versionToString(v) {
  return `${v.major}.${v.minor}.${v.patch}`;
}

function parseExplicitVersion(str) {
  const cleaned = str.replace(/^v/, "");
  const match = cleaned.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  return { major: +match[1], minor: +match[2], patch: +match[3] };
}

// argv is either: nothing, --minor, --major, or an explicit "x.y.z" / "vx.y.z"
const explicitArg = rawArgs.find((a) => !a.startsWith("--"));
const bumpFlag = rawArgs.includes("--major")
  ? "major"
  : rawArgs.includes("--minor")
  ? "minor"
  : "patch";

const changelogText = readChangelog();

let nextVersion;
if (explicitArg) {
  const parsed = parseExplicitVersion(explicitArg);
  if (!parsed) {
    console.error(
      `"${explicitArg}" doesn't look like a version (expected x.y.z, ` +
        `optionally prefixed with v).`
    );
    process.exit(1);
  }
  nextVersion = parsed;
} else {
  const current = getLatestDocumentedVersion(changelogText);
  nextVersion = bump(current, bumpFlag);
}

const versionString = versionToString(nextVersion);
const tagName = `v${versionString}`;

// Bail early and clearly if this tag already exists, rather than letting
// `git tag` fail after we've already rewritten the changelog.
if (gitOrNull(["rev-parse", "-q", "--verify", `refs/tags/${tagName}`])) {
  console.error(`Tag ${tagName} already exists. Pick a different version.`);
  process.exit(1);
}

// ---------------------------------------------------------------------
// 2. Collect what's changed since the last tag: file summary + commits.
// ---------------------------------------------------------------------

// Most recent reachable tag, if any (works whether or not tags are
// annotated). Null on a repo with no tags yet.
const lastTag = gitOrNull(["describe", "--tags", "--abbrev=0"]);

const fileStatusOutput = git(["status", "--porcelain=v1", "-z"]);
const buckets = categorizeStatus(fileStatusOutput);

const fileBullets = [];
if (buckets.added.length) fileBullets.push(`Added ${joinNames(buckets.added)}`);
if (buckets.updated.length)
  fileBullets.push(`Updated ${joinNames(buckets.updated)}`);
if (buckets.renamed.length)
  fileBullets.push(`Renamed ${joinNames(buckets.renamed)}`);
if (buckets.moved.length) fileBullets.push(`Moved ${joinNames(buckets.moved)}`);
if (buckets.movedAndRenamed.length)
  fileBullets.push(`Moved & renamed ${joinNames(buckets.movedAndRenamed)}`);
if (buckets.deleted.length)
  fileBullets.push(`Deleted ${joinNames(buckets.deleted)}`);

// Commit messages since the last tag (or the whole history if there's no
// tag yet). Skip merge commits and drop anything already staged for this
// release commit itself (there isn't one yet, so this is just history).
const logRange = lastTag ? `${lastTag}..HEAD` : "HEAD";
const commitLogRaw = gitOrNull(["log", logRange, "--no-merges", "--pretty=%s"]);
const commitBullets = commitLogRaw
  ? commitLogRaw.split("\n").map((l) => l.trim()).filter(Boolean)
  : [];

// De-dupe: a commit message produced by commit.js's auto-summary often
// says almost the same thing as the file-change summary above. Keep both
// sections, since commit messages carry intent that the file list can't,
// but drop exact duplicate lines.
const seen = new Set(fileBullets);
const dedupedCommitBullets = commitBullets.filter((line) => {
  if (seen.has(line)) return false;
  seen.add(line);
  return true;
});

const allBullets = [...fileBullets, ...dedupedCommitBullets];

if (!allBullets.length) {
  console.log(
    "Nothing to release — no uncommitted file changes and no commits " +
      `since ${lastTag || "the start of history"}.`
  );
  process.exit(0);
}

// ---------------------------------------------------------------------
// 3. Write the new changelog section.
// ---------------------------------------------------------------------

const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

const newSection =
  `## [${versionString}] - ${today}\n` +
  `### Changed\n` +
  allBullets.map((b) => `- ${b}`).join("\n") +
  `\n\n`;

// Insert right after "## [Unreleased]" if present, otherwise right
// before the first existing "## [x.y.z]" heading, otherwise at the end
// of the file.
function insertSection(text, section) {
  const unreleasedRe = /^##\s*\[Unreleased\][^\n]*\n/m;
  const unreleasedMatch = text.match(unreleasedRe);
  if (unreleasedMatch) {
    const insertAt = unreleasedMatch.index + unreleasedMatch[0].length;
    return text.slice(0, insertAt) + "\n" + section + text.slice(insertAt);
  }

  const versionMatch = text.match(VERSION_HEADING_RE);
  if (versionMatch) {
    return (
      text.slice(0, versionMatch.index) +
      section +
      text.slice(versionMatch.index)
    );
  }

  return text.trimEnd() + "\n\n" + section;
}

const updatedChangelog = insertSection(changelogText, newSection);
fs.writeFileSync(CHANGELOG_PATH, updatedChangelog);

// ---------------------------------------------------------------------
// 4. Commit the changelog and tag the release.
// ---------------------------------------------------------------------

git(["add", CHANGELOG_PATH]);
git(["commit", "-m", `Release ${tagName}`]);
git(["tag", "-a", tagName, "-m", `Release ${tagName}`]);

console.log(`Released ${tagName}`);
console.log(`- CHANGELOG.md updated with ${allBullets.length} item(s)`);
console.log(`- committed as "Release ${tagName}"`);
console.log(`- tagged ${tagName} (run \`git push --follow-tags\` to publish)`);
