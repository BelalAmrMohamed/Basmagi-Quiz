// Starts `vercel dev` with the variables from .env.local (or .env) already in
// the environment. `vercel dev` does not reliably hand the root .env.local to
// function processes; the children inherit this process's environment instead.
// Handles a UTF-8 BOM, UTF-16 files (Notepad on Windows), CRLF, quotes and
// `export` prefixes. Prints which required names are empty, never the values.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

export function decodeEnvFile(buf) {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString("utf16le");
  if (buf[0] === 0xfe && buf[1] === 0xff) {
    const sw = Buffer.from(buf.subarray(2));
    sw.swap16();
    return sw.toString("utf16le");
  }
  return buf.toString("utf8").replace(/^﻿/, "");
}

export function parseEnv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, "");
    out[m[1]] = v;
  }
  return out;
}

const REQUIRED = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_KEY", "JWT_SECRET", "DEVELOPERS_EMAILS"];

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("dev-vercel.mjs")) {
  const root = process.cwd();
  const file = [".env.local", ".env"].map((n) => path.join(root, n)).find((p) => fs.existsSync(p));
  if (!file) console.warn("[dev] no .env.local found; relying on the linked Vercel project.");
  else {
    const vars = parseEnv(decodeEnvFile(fs.readFileSync(file)));
    for (const [k, v] of Object.entries(vars)) if (process.env[k] === undefined) process.env[k] = v;
    console.log(`[dev] loaded ${Object.keys(vars).length} variables from ${path.basename(file)}`);
  }
  const empty = REQUIRED.filter((n) => !process.env[n] && !(n === "SUPABASE_SERVICE_KEY" && process.env.SUPABASE_SERVICE_ROLE_KEY));
  if (empty.length) console.warn("[dev] empty or missing: " + empty.join(", "));
  const bin = process.platform === "win32" ? "vercel.cmd" : "vercel";
  const child = spawn(bin, ["dev", "--listen", "8080", ...process.argv.slice(2)], { stdio: "inherit", env: process.env, shell: process.platform === "win32" });
  child.on("exit", (c) => process.exit(c ?? 0));
}
