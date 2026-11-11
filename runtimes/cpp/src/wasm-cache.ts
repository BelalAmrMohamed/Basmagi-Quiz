// =============================================================================
// runtimes/cpp/src/wasm-cache.ts
// Manages the persistent CacheStorage for the ~60 MB Wasm-Clang compiler toolchain.
// Guarantees a one-time download with byte-level progress reporting and cleanup.
// =============================================================================

export const CACHE_NAME = 'basmagi-cpp-wasm-v2';
const OLD_CACHE_NAMES = ['basmagi-cpp-wasm-v1'];

/** Origin-absolute cache key. A bare name would resolve against the caller's own URL, so the page and the worker (different paths) would miss each other's entries. */
const keyOf = (name: string) => new URL('/__cpp-wasm/' + name, self.location.origin).href;

/** `size` = unpacked bytes (what is stored); `gzSize` = bytes of the gzip copy the site hosts (what is downloaded). */
export const WASM_ASSETS = [
  { name: 'clang', size: 31214472, gzSize: 10519130 },
  { name: 'lld', size: 19490094, gzSize: 6705463 },
  { name: 'memfs', size: 345442, gzSize: 18552 },
  { name: 'sysroot.tar', size: 9297920, gzSize: 1812643 },
];

/** Browser storage used once installed (~60 MB). */
export const TOTAL_WASM_SIZE = WASM_ASSETS.reduce((sum, a) => sum + a.size, 0);
/** What is actually downloaded from the site's own gzip copies (~19 MB). The upstream fallback is the full TOTAL_WASM_SIZE. */
export const TOTAL_WASM_DOWNLOAD = WASM_ASSETS.reduce((sum, a) => sum + a.gzSize, 0);

/** Upstream copy, used only when the site's compressed copy is missing or this browser cannot unpack gzip. */
const CDN_BASE = 'https://binji.github.io/wasm-clang/';

/** The site hosts gzip copies in /assets/wasm-clang/, next to the runtime folder this script was loaded from. */
const SCRIPT_URL = typeof document !== 'undefined' && document.currentScript instanceof HTMLScriptElement ? document.currentScript.src : ''; // only readable while the script loads
const gzUrl = (name: string) => new URL(`../wasm-clang/${name}.gz`, SCRIPT_URL || new URL('/assets/notebook-runtime-cpp/', self.location.origin)).href;


export interface DownloadProgress {
  loaded: number;
  total: number;
  percent: number;
  currentFile: string;
}

/** Check if all required Wasm-Clang assets are already cached in CacheStorage. */
export async function isWasmCached(): Promise<boolean> {
  if (typeof caches === 'undefined') return false;
  try {
    const hasCache = await caches.has(CACHE_NAME);
    if (!hasCache) return false;
    const cache = await caches.open(CACHE_NAME);
    for (const asset of WASM_ASSETS) {
      const match = await cache.match(keyOf(asset.name));
      if (!match) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** Retrieve a cached asset buffer from CacheStorage. */
export async function getCachedAsset(name: string): Promise<ArrayBuffer | null> {
  if (typeof caches === 'undefined') return null;
  try {
    const cache = await caches.open(CACHE_NAME);
    const match = await cache.match(keyOf(name));
    if (!match) return null;
    return await match.arrayBuffer();
  } catch {
    return null;
  }
}

/** Delete all cached Wasm-Clang assets to free up space (~60 MB). */
export async function deleteWasmCache(): Promise<boolean> {
  if (typeof caches === 'undefined') return false;
  try {
    return await caches.delete(CACHE_NAME);
  } catch {
    return false;
  }
}

/** gzip -> bytes with the browser's own DecompressionStream; null when the data is not gzip or the browser cannot unpack it. */
async function gunzip(buf: Uint8Array): Promise<ArrayBuffer | null> {
  if (buf.length < 2 || buf[0] !== 0x1f || buf[1] !== 0x8b) return null; // a server may already have unpacked it
  if (typeof DecompressionStream === 'undefined') return null;
  return new Response(new Blob([buf as unknown as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}

/** Stream one URL with byte-level progress; `onBytes` gets each chunk's size. */
async function fetchBytes(url: string, signal: AbortSignal | undefined, onBytes: (n: number) => void): Promise<Uint8Array | null> {
  const response = await fetch(url, { signal });
  if (!response.ok || !response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    if (signal?.aborted) { await reader.cancel(); throw new Error('Download cancelled.'); }
    const { done, value } = await reader.read();
    if (done) break;
    if (value) { chunks.push(value); loaded += value.byteLength; onBytes(value.byteLength); }
  }
  const out = new Uint8Array(loaded);
  let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.byteLength; }
  return out;
}

/**
 * Downloads all Wasm-Clang assets with accurate byte-level progress.
 * Prefers the site's gzip copies (about a third of the size) and unpacks them in the browser; falls back to the upstream
 * files per asset. Only commits to CacheStorage once every asset has arrived.
 */
export async function downloadWasmAssets(
  onProgress: (p: DownloadProgress) => void,
  signal?: AbortSignal
): Promise<void> {
  if (typeof caches === 'undefined') {
    throw new Error('CacheStorage is not supported in this browser.');
  }

  let transferred = 0;
  let expected = TOTAL_WASM_DOWNLOAD; // grows if an asset has to come from upstream uncompressed
  const downloaded: Array<{ name: string; buffer: ArrayBuffer; type: string }> = [];

  for (const asset of WASM_ASSETS) {
    if (signal?.aborted) throw new Error('Download cancelled.');
    const report = (n: number) => {
      transferred += n;
      onProgress({ loaded: transferred, total: expected, percent: Math.min(99, Math.round((transferred / expected) * 100)), currentFile: asset.name });
    };

    let buffer: ArrayBuffer | null = null;
    const before = transferred;
    try {
      const packed = await fetchBytes(gzUrl(asset.name), signal, report);
      if (packed) buffer = await gunzip(packed);
    } catch (e: any) {
      if (signal?.aborted || /cancelled/i.test(String(e?.message))) throw e;
    }
    if (!buffer) {
      // Missing / unreadable compressed copy: count what was spent, then fetch the upstream file as before.
      expected += Math.max(0, asset.size - asset.gzSize) + (transferred - before);
      const raw = await fetchBytes(`${CDN_BASE}${asset.name}`, signal, report);
      if (!raw) throw new Error(`Failed to fetch ${asset.name}`);
      buffer = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
    }
    downloaded.push({ name: asset.name, buffer, type: asset.name.endsWith('.tar') ? 'application/x-tar' : 'application/octet-stream' });
  }

  // Commit all assets atomically to CacheStorage
  for (const old of OLD_CACHE_NAMES) { try { await caches.delete(old); } catch { /* ignore */ } }
  const cache = await caches.open(CACHE_NAME);
  for (const item of downloaded) {
    await cache.put(keyOf(item.name), new Response(item.buffer, {
      headers: { 'content-type': item.type, 'content-length': String(item.buffer.byteLength) },
    }));
  }
  onProgress({ loaded: expected, total: expected, percent: 100, currentFile: '' });
}
