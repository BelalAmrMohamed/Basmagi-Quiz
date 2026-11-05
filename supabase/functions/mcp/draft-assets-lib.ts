// Pure helpers for MCP notebook-draft workspace files (no Deno/Supabase APIs, unit-tested in Node).
import { NOTEBOOK_ASSET_MIME } from "./content-rules.js";

export const DRAFT_ASSET_BUCKET = "draft-assets";
export const DRAFT_ASSET_MAX_BYTES = 10 * 1024 * 1024;
export const DRAFT_ASSET_MAX_PER_DRAFT = 20 * 1024 * 1024;
export const UPLOAD_TOKEN_TTL_MIN = 15;

const NAME_RE = /^[^\\/:*?"<>|\u0000-\u001f.][^\\/:*?"<>|\u0000-\u001f]{0,99}$/;

export function sanitizeAssetName(raw: unknown): { ok: true; name: string; mime: string } | { ok: false; error: string } {
  const last = String(raw ?? "").split(/[\\/]/).pop()!.trim();
  if (!NAME_RE.test(last)) return { ok: false, error: "Invalid filename (no slashes, not starting with a dot, max 100 chars)." };
  const ext = last.split(".").pop()!.toLowerCase();
  const mime = (NOTEBOOK_ASSET_MIME as Record<string, string>)[ext];
  if (!mime) return { ok: false, error: `Unsupported file type .${ext}. Allowed: ${Object.keys(NOTEBOOK_ASSET_MIME).join(", ")}.` };
  return { ok: true, name: last, mime };
}

/** Real type from magic bytes (so a renamed file cannot slip through). */
export function sniffImageMime(b: Uint8Array): string | null {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "image/gif";
  if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return null;
}

const enc = new TextEncoder();
const b64url = (u: Uint8Array) => btoa(String.fromCharCode(...u)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
async function hmac(secret: string, data: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

/** Short-lived capability to PUT ONE file into ONE draft (used by `curl -T`). */
export async function signUploadToken(secret: string, p: { code: string; name: string }, now = Date.now()) {
  const body = b64url(enc.encode(JSON.stringify({ c: p.code, n: p.name, e: now + UPLOAD_TOKEN_TTL_MIN * 60_000 })));
  return `${body}.${b64url(await hmac(secret, body))}`;
}
export async function verifyUploadToken(secret: string, token: string, now = Date.now()): Promise<{ code: string; name: string } | null> {
  const [body, sig] = String(token || "").split(".");
  if (!body || !sig) return null;
  const want = b64url(await hmac(secret, body));
  if (want.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ sig.charCodeAt(i);
  if (diff) return null;
  try {
    const p = JSON.parse(new TextDecoder().decode(unb64url(body)));
    return p.e > now && typeof p.c === "string" && typeof p.n === "string" ? { code: p.c, name: p.n } : null;
  } catch { return null; }
}

/** https only, no credentials, no localhost / IP literals / internal suffixes (server-side fetch guard). */
export function safeFetchUrl(input: unknown): URL | null {
  let u: URL;
  try { u = new URL(String(input)); } catch { return null; }
  if (u.protocol !== "https:" || u.username || u.password) return null;
  if (u.port && u.port !== "443") return null;
  const h = u.hostname.toLowerCase();
  if (!h.includes(".") || h.includes(":") || /^[0-9.]+$/.test(h)) return null;
  if (h === "localhost" || /\.(local|localhost|internal|lan|home|corp)$/.test(h)) return null;
  return u;
}

/** Google Drive share links -> direct download URL (works for "anyone with the link" files). */
export function driveDirectUrl(input: string): string {
  const m = String(input).match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:[^#]*&)?id=)([A-Za-z0-9_-]{10,})/);
  return m ? `https://drive.usercontent.google.com/download?id=${m[1]}&export=download` : input;
}

export const DRAFT_REASONS: Record<string, string> = {
  file_too_large: "File is larger than 10 MB.",
  draft_too_large: "This draft already holds 20 MB of files (limit).",
  draft_cap_reached: "The temporary draft storage is full right now. Try again later or add the file manually in the workspace.",
  cap_reached: "The platform media storage is full. Ask the admin to clean unused files.",
  empty_file: "The file is empty.",
};
