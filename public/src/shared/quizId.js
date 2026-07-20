// public/src/shared/quizId.js
// =============================================================================
// Browser-compatible quiz ID generator.
// Uses the Web Crypto API (SubtleCrypto) to produce the SAME IDs as the
// Node.js version in scripts/lib/quizId.js, which uses:
//   crypto.createHash("sha256").update(relativePath).digest()
// Both produce the same SHA-256 bytes → the same 8-character base32 IDs.
//
// ⚠️  Keep in sync with scripts/lib/quizId.js.
// =============================================================================

const CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const ID_LENGTH = 8;

/**
 * Generates a stable 8-character base32 ID from a canonical relative path.
 * The path must be the same string used by the server-side script, e.g.:
 *   "quizzes/Computer Science/1/2/Math 2/midterm.json"
 *
 * @param {string} relativePath
 * @returns {Promise<string>} 8-character uppercase base32 ID
 */
export async function generateQuizId(relativePath) {
  const encoder = new TextEncoder();
  const data = encoder.encode(relativePath);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = new Uint8Array(hashBuffer);

  let id = "";
  for (let i = 0; i < ID_LENGTH; i++) {
    id += CHARSET[hashArray[i] % CHARSET.length];
  }
  return id;
}
