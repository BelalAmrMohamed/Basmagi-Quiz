// =============================================================================
// runtimes/shared/images.ts
// Canvas helpers for workspace files and figures.
// =============================================================================
import type { ImageFile } from './engine';
import { download } from './dom';

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

/** Decode an uploaded image file into the raw RGB record engines work with. */
export async function fileToImage(f: File): Promise<ImageFile> {
  const bmp = await createImageBitmap(f);
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
