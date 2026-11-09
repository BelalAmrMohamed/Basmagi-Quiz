// =============================================================================
// runtimes/cpp/src/wasm-cache.ts
// Manages the persistent CacheStorage for the ~20MB Wasm-Clang compiler toolchain.
// Guarantees a one-time download with byte-level progress reporting and cleanup.
// =============================================================================

export const CACHE_NAME = 'basmagi-cpp-wasm-v2';
const OLD_CACHE_NAMES = ['basmagi-cpp-wasm-v1'];

/** Origin-absolute cache key. A bare name would resolve against the caller's own URL, so the page and the worker (different paths) would miss each other's entries. */
const keyOf = (name: string) => new URL('/__cpp-wasm/' + name, self.location.origin).href;

export const WASM_ASSETS = [
  { name: 'clang', size: 31214472 },
  { name: 'lld', size: 19490094 },
  { name: 'memfs', size: 345442 },
  { name: 'sysroot.tar', size: 9297920 },
];

export const TOTAL_WASM_SIZE = WASM_ASSETS.reduce((sum, a) => sum + a.size, 0); // ~60 MB (sizes of the binji/wasm-clang master files)

const CDN_BASE = 'https://binji.github.io/wasm-clang/';

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

/** Delete all cached Wasm-Clang assets to free up space (~20MB). */
export async function deleteWasmCache(): Promise<boolean> {
  if (typeof caches === 'undefined') return false;
  try {
    return await caches.delete(CACHE_NAME);
  } catch {
    return false;
  }
}

/**
 * Downloads all Wasm-Clang assets with accurate byte-level progress.
 * Only commits to CacheStorage once all assets are downloaded successfully.
 */
export async function downloadWasmAssets(
  onProgress: (p: DownloadProgress) => void,
  signal?: AbortSignal
): Promise<void> {
  if (typeof caches === 'undefined') {
    throw new Error('CacheStorage is not supported in this browser.');
  }

  let totalLoaded = 0;
  const downloadedResponses: Array<{ name: string; buffer: ArrayBuffer; type: string }> = [];

  for (const asset of WASM_ASSETS) {
    if (signal?.aborted) throw new Error('Download cancelled.');

    const url = `${CDN_BASE}${asset.name}`;
    const response = await fetch(url, { signal });
    if (!response.ok || !response.body) {
      throw new Error(`Failed to fetch ${asset.name}: HTTP ${response.status}`);
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let fileLoaded = 0;

    while (true) {
      if (signal?.aborted) {
        await reader.cancel();
        throw new Error('Download cancelled.');
      }

      const { done, value } = await reader.read();
      if (done) break;

      if (value) {
        chunks.push(value);
        fileLoaded += value.byteLength;
        totalLoaded += value.byteLength;

        const percent = Math.min(100, Math.round((totalLoaded / TOTAL_WASM_SIZE) * 100));
        onProgress({
          loaded: totalLoaded,
          total: TOTAL_WASM_SIZE,
          percent,
          currentFile: asset.name,
        });
      }
    }

    // Combine chunks into single ArrayBuffer
    const fileBuffer = new Uint8Array(fileLoaded);
    let offset = 0;
    for (const chunk of chunks) {
      fileBuffer.set(chunk, offset);
      offset += chunk.byteLength;
    }

    downloadedResponses.push({
      name: asset.name,
      buffer: fileBuffer.buffer,
      type: asset.name.endsWith('.tar') ? 'application/x-tar' : 'application/octet-stream',
    });
  }

  // Commit all downloaded assets atomically to CacheStorage
  for (const old of OLD_CACHE_NAMES) { try { await caches.delete(old); } catch { /* ignore */ } }
  const cache = await caches.open(CACHE_NAME);
  for (const item of downloadedResponses) {
    const res = new Response(item.buffer, {
      headers: {
        'content-type': item.type,
        'content-length': String(item.buffer.byteLength),
      },
    });
    await cache.put(keyOf(item.name), res);
  }
}

