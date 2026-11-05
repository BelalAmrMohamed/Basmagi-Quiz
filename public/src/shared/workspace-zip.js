// =============================================================================
// public/src/shared/workspace-zip.js
// Dependency-free .zip writer/reader (store + deflate) and the notebook bundle
// format: notebook.json + assets/<file>. Used for local export/import so a saved
// notebook never loses its workspace images.
// =============================================================================
const enc = new TextEncoder();
const dec = new TextDecoder();

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** entries: [{ name, data: Uint8Array }] -> Uint8Array (stored, UTF-8 names). */
export function makeZip(entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.name);
    const crc = crc32(e.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true);
    local.setUint32(14, crc, true); local.setUint32(18, e.data.length, true); local.setUint32(22, e.data.length, true);
    local.setUint16(26, name.length, true);
    parts.push(new Uint8Array(local.buffer), name, e.data);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint16(8, 0x0800, true);
    cen.setUint32(16, crc, true); cen.setUint32(20, e.data.length, true); cen.setUint32(24, e.data.length, true);
    cen.setUint16(28, name.length, true); cen.setUint32(42, offset, true);
    central.push(new Uint8Array(cen.buffer), name);
    offset += 30 + name.length + e.data.length;
  }
  const cenSize = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
  end.setUint32(12, cenSize, true); end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of all) { out.set(p, o); o += p.length; }
  return out;
}

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Reads a zip (method 0 or 8). Returns [{ name, data: Uint8Array }]; directories skipped. */
export async function readZip(input) {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input);
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("ملف zip غير صالح.");
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const out = [];
  for (let n = 0; n < count; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error("ملف zip تالف.");
    const method = v.getUint16(p + 10, true);
    const csize = v.getUint32(p + 20, true);
    const nlen = v.getUint16(p + 28, true), xlen = v.getUint16(p + 30, true), clen = v.getUint16(p + 32, true);
    const lho = v.getUint32(p + 42, true);
    const name = dec.decode(b.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + xlen + clen;
    if (name.endsWith("/")) continue;
    const dataStart = lho + 30 + v.getUint16(lho + 26, true) + v.getUint16(lho + 28, true);
    const raw = b.subarray(dataStart, dataStart + csize);
    if (method === 0) out.push({ name, data: raw.slice() });
    else if (method === 8) out.push({ name, data: await inflateRaw(raw) });
    else throw new Error("طريقة ضغط غير مدعومة في ملف zip.");
  }
  return out;
}

const safeName = (s) => String(s || "notebook").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "notebook";

/** meta: { title, description, source, runtime, content }, files: [{ path, blob }] -> Blob */
export async function buildNotebookZip(meta, files) {
  const entries = [{ name: "notebook.json", data: enc.encode(JSON.stringify({ format: "basmagi-notebook-bundle", version: 1, ...meta }, null, 2)) }];
  for (const f of files) entries.push({ name: `assets/${f.path}`, data: new Uint8Array(await f.blob.arrayBuffer()) });
  return new Blob([makeZip(entries)], { type: "application/zip" });
}

/** Returns { meta, files: [File] }. Throws a readable Error for non-bundle zips. */
export async function parseNotebookZip(buffer) {
  const entries = await readZip(buffer);
  const nb = entries.find((e) => e.name === "notebook.json");
  if (!nb) throw new Error("هذا الملف ليس حزمة دفتر (notebook.json غير موجود).");
  const meta = JSON.parse(dec.decode(nb.data));
  const mimeOf = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };
  const files = entries.filter((e) => e.name.startsWith("assets/") && e.name.length > 7).map((e) => {
    const name = e.name.slice(7).split("/").pop();
    return new File([e.data], name, { type: mimeOf[name.split(".").pop().toLowerCase()] || "application/octet-stream" });
  });
  return { meta, files };
}

export function downloadBlob(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
export const bundleFileName = (title) => `${safeName(title)}.notebook.zip`;
