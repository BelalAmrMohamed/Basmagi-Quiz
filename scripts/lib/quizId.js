// scripts/lib/quizId.js
// =============================================================================
// Shared deterministic 8-char Base32 ID generator.
//
// Used by scripts/migrate-local-quizzes-to-db.js when migrating a legacy
// local quiz file into the DB, so the migrated row's derived ID matches
// what public/src/shared/quizId.js (the browser-side counterpart used as a
// fallback in quizManifest.js) would compute for the same input.
//
// Algorithm:
//   1. Compute SHA-256 of the input string.
//   2. For each of the 8 output positions: charset[ hash[i] % 32 ].
//
// ⚠️  Do NOT change this function without also updating
//     public/src/shared/quizId.js — they must stay in sync, or IDs will
//     differ between server-side (migration) and client-side generation.
// =============================================================================

import crypto from "crypto";

const CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; // 32 chars → indices 0-31
const ID_LENGTH = 8;

/**
 * Generates a deterministic 8-character ID from a path string.
 *
 * The path must be relative to `public/data/` and use forward slashes,
 * exactly as stored in the manifest. Examples:
 *
 *   Quiz file:   "quizzes/College/1/1/Subject/quiz-title.json"
 *   Course dir:  "quizzes/College/1/1/Subject"
 *   Subfolder:   "quizzes/College/1/1/Subject/Subfolder"
 *
 * @param {string} relativePath  Forward-slash path relative to public/data/
 * @returns {string}             8-character uppercase alphanumeric ID
 */
export function generateQuizId(relativePath) {
  const hash = crypto.createHash("sha256").update(relativePath).digest();
  let id = "";
  for (let i = 0; i < ID_LENGTH; i++) {
    id += CHARSET[hash[i] % CHARSET.length];
  }
  return id;
}