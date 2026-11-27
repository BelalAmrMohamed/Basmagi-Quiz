// =============================================================================
// runtimes/shared/images.ts
// Canvas helpers for workspace files and figures.
// =============================================================================
import type { ImageFile } from './engine';
import { download } from './dom';
import type { T } from './i18n';

export function rawToCanvas(img: Pick<ImageFile, 'width' | 'height' | 'channels' | 'data' | 'colormap'>): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = img.width; cv.height = img.height;
  const ctx = cv.getContext('2d');
  if (!ctx) return cv; // no canvas support (tests)
  const id = new ImageData(img.width, img.height), n = img.width * img.height;
  for (let i = 0; i < n; i++) {
    if (img.channels === 1 && img.colormap) {
      const c = img.colormap[Math.min(img.colormap.length - 1, img.data[i])];
      id.data[i * 4] = c[0] * 255; id.data[i * 4 + 1] = c[1] * 255; id.data[i * 4 + 2] = c[2] * 255;
    } else if (img.channels === 1) {
      const v = img.data[i];
      id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v;
    } else {
      id.data[i * 4] = img.data[i * 3]; id.data[i * 4 + 1] = img.data[i * 3 + 1]; id.data[i * 4 + 2] = img.data[i * 3 + 2];
    }
    id.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(id, 0, 0);
  return cv;
}

export const rgbToCanvas = (w: number, h: number, rgb: Uint8Array) => rawToCanvas({ width: w, height: h, channels: 3, data: rgb });

export const toBlob = (cv: HTMLCanvasElement, type: string) =>
  new Promise<Blob>((res) => cv.toBlob((b) => res(b as Blob), type, 0.92));

export const rgbToDataUrl = (w: number, h: number, rgb: Uint8Array) => rgbToCanvas(w, h, rgb).toDataURL('image/png');

export async function downloadImage(name: string, img: ImageFile) {
  const ext = (name.split('.').pop() || 'png').toLowerCase();
  const type = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png';
  download(type === 'image/png' && ext !== 'png' ? name.replace(/\.\w+$/, '') + '.png' : name, await toBlob(rawToCanvas(img), type));
}

// ---- Large-image guard (Phase 6.4). The interpreter stores every sample as an 8-byte double, so memory grows 8x. ----
/** Above this many megapixels (1 MP = 1,000,000 pixels) an upload gets a one-time slowness notice. */
export const LARGE_IMAGE_MP = 2;
/** Above this many megapixels an upload is rejected. */
export const MAX_IMAGE_MP = 8;
export type ImageSize = 'ok' | 'large' | 'too-large';
export const megapixels = (w: number, h: number) => (w * h) / 1e6;
/** Exactly 2 MP is ok and exactly 8 MP is accepted (with the notice): the limits are "above". */
export function classifyImageSize(w: number, h: number): ImageSize {
  const px = w * h;
  return px > MAX_IMAGE_MP * 1e6 ? 'too-large' : px > LARGE_IMAGE_MP * 1e6 ? 'large' : 'ok';
}
const fmtMp = (w: number, h: number) => String(Math.round(megapixels(w, h) * 10) / 10);
let largeNoticeShown = false;
/** Test hook: the notice is once per page load. */
export function resetLargeImageNotice() { largeNoticeShown = false; }
export interface ImageGuard { t: T; notify?(message: string): void }
/** Throws for an image above 8 MP; for one above 2 MP tells the user once that pixel loops will be slow. */
export function guardImageSize(w: number, h: number, g: ImageGuard) {
  const size = classifyImageSize(w, h);
  if (size === 'too-large') throw new Error(g.t('Image too large ({w}×{h}, {mp} MP). Images above 8 MP are not accepted: each pixel is stored as an 8-byte double, so memory grows 8 times. Resize the image before uploading it.', { w, h, mp: fmtMp(w, h) }));
  if (size === 'large' && !largeNoticeShown) {
    largeNoticeShown = true;
    g.notify?.(g.t('Large image ({mp} MP): pixel loops will be slow. Consider imresize first.', { mp: fmtMp(w, h) }));
  }
}

/** Decode an uploaded image file into the raw RGB record engines work with. Too-large images are rejected before any pixel buffer is made. */
export async function fileToImage(f: File, guard?: ImageGuard): Promise<ImageFile> {
  const bmp = await createImageBitmap(f);
  try { guardImageSize(bmp.width, bmp.height, guard ?? { t: (en, v) => en.replace(/\{(\w+)\}/g, (_m, k) => String(v?.[k])) }); }
  catch (e) { bmp.close?.(); throw e; }
  const cv = document.createElement('canvas');
  cv.width = bmp.width; cv.height = bmp.height;
  const g = cv.getContext('2d')!;
  g.drawImage(bmp, 0, 0);
  const px = g.getImageData(0, 0, bmp.width, bmp.height).data, n = bmp.width * bmp.height, d = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) { d[i * 3] = px[i * 4]; d[i * 3 + 1] = px[i * 4 + 1]; d[i * 3 + 2] = px[i * 4 + 2]; }
  const ext = (f.name.split('.').pop() || 'png').toLowerCase();
  return {
    width: bmp.width, height: bmp.height, channels: 3, data: d, bitDepth: 24, format: ext === 'jpeg' ? 'jpg' : ext,
    fileSize: f.size, colorType: 'truecolor', filename: '/vfs/' + f.name, fileModDate: new Date(f.lastModified).toUTCString(),
  };
}
