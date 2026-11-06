// =============================
// scripts/git-changes.js
//
// Shared helper: turns `git status --porcelain=v1 -z` into categorized
// buckets of file changes (added / deleted / updated / renamed / moved /
// moved & renamed). Used by both commit.js and release.js so the two
// scripts describe changes the same way.
// =============================

import path from "path";

export function categorizeStatus(statusOutput) {
  const entries = statusOutput.split("\0").filter(Boolean);

  const added = [];
  const deleted = [];
  const updated = [];
  const renamed = []; // same directory, new file name
  const moved = []; // same file name, new directory
  const movedAndRenamed = []; // both directory and name changed

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const statusCode = entry.slice(0, 2);
    const filePath = entry.slice(3);
    const baseName = path.basename(filePath);

    const indexState = statusCode[0]; // staged column

    if (indexState === "R" || indexState === "C") {
      const oldPath = entries[i + 1];
      i++; // consume the old-path record

      if (!oldPath) {
        added.push(baseName);
        continue;
      }

      const oldBaseName = path.basename(oldPath);
      const oldDir = path.dirname(oldPath);
      const newDir = path.dirname(filePath);
      const dirChanged = oldDir !== newDir;
      const nameChanged = oldBaseName !== baseName;

      if (dirChanged && nameChanged) {
        movedAndRenamed.push(`${oldPath} to ${filePath}`);
      } else if (dirChanged) {
        moved.push(`${baseName} to ${newDir}/`);
      } else {
        renamed.push(`${oldBaseName} to ${baseName}`);
      }
    } else if (indexState === "A") {
      added.push(baseName);
    } else if (indexState === "D") {
      deleted.push(baseName);
    } else if (indexState === "M" || indexState === "T") {
      updated.push(baseName);
    } else if (indexState === "?") {
      added.push(baseName);
    }
  }

  return { added, deleted, updated, renamed, moved, movedAndRenamed };
}

// "a, b, & c" — Oxford comma, "&" before the last item; a single item is
// returned bare.
export function joinNames(names) {
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} & ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, & ${names[names.length - 1]}`;
}

export function buildChangeMessage(buckets) {
  const {
    added,
    deleted,
    updated,
    renamed,
    moved,
    movedAndRenamed,
  } = buckets;

  const nothingChanged =
    !added.length &&
    !deleted.length &&
    !updated.length &&
    !renamed.length &&
    !moved.length &&
    !movedAndRenamed.length;

  if (nothingChanged) return null;

  const clauses = [];
  if (updated.length) clauses.push(`Updated ${joinNames(updated)}.`);
  if (renamed.length) clauses.push(`Renamed ${joinNames(renamed)}.`);
  if (moved.length) clauses.push(`Moved ${joinNames(moved)}.`);
  if (movedAndRenamed.length)
    clauses.push(`Moved & renamed ${joinNames(movedAndRenamed)}.`);
  if (deleted.length) clauses.push(`Deleted ${joinNames(deleted)}.`);
  if (added.length) clauses.push(`Added ${joinNames(added)}.`);

  return clauses.join(" ");
}
