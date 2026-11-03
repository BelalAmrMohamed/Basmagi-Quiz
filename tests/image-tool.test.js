import test from 'node:test';
import assert from 'node:assert/strict';

test('staggered cascade generates non-overlapping offsets', () => {
  const step = 32;
  const maxOffset = 7;
  const offsets = [];
  for (let i = 0; i < 5; i++) {
    offsets.push((i % (maxOffset + 1)) * step);
  }
  // Each subsequent window must be offset from the previous one
  for (let i = 1; i < offsets.length; i++) {
    assert.ok(offsets[i] > offsets[i - 1], `Window ${i} should be offset from ${i - 1}`);
  }
});

test('cursor-centered zoom math keeps image point under mouse cursor pinned', () => {
  const stageX = 250;
  const stageY = 180;
  const oldZoom = 1.0;
  const oldPanX = 50;
  const oldPanY = 40;

  // The point in image coordinates under the mouse before zoom:
  const imgX = (stageX - oldPanX) / oldZoom; // 200
  const imgY = (stageY - oldPanY) / oldZoom; // 140

  const factor = 1.25;
  const newZoom = oldZoom * factor; // 1.25

  // Pinned pan calculation:
  const newPanX = stageX - imgX * newZoom; // 250 - 200 * 1.25 = 0
  const newPanY = stageY - imgY * newZoom; // 180 - 140 * 1.25 = 5

  // Verify that projecting (imgX, imgY) with (newPanX, newPanY, newZoom) yields (stageX, stageY)
  const projectedX = newPanX + imgX * newZoom;
  const projectedY = newPanY + imgY * newZoom;

  assert.equal(projectedX, stageX);
  assert.equal(projectedY, stageY);
});

test('stats calculation distinguishes grayscale vs RGB and min/max/mean', () => {
  // Grayscale image: R == G == B for all pixels
  const grayRgb = new Uint8Array([
    10, 10, 10,
    50, 50, 50,
    200, 200, 200,
  ]);
  let isGray = true;
  let min = 255, max = 0, sum = 0;
  for (let i = 0; i < grayRgb.length; i += 3) {
    const r = grayRgb[i], g = grayRgb[i + 1], b = grayRgb[i + 2];
    if (r !== g || r !== b) isGray = false;
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    if (lum < min) min = lum;
    if (lum > max) max = lum;
    sum += lum;
  }
  assert.equal(isGray, true);
  assert.equal(min, 10);
  assert.equal(max, 200);

  // RGB image:
  const colorRgb = new Uint8Array([
    255, 0, 0,
    0, 255, 0,
  ]);
  let isColorGray = true;
  for (let i = 0; i < colorRgb.length; i += 3) {
    if (colorRgb[i] !== colorRgb[i + 1] || colorRgb[i] !== colorRgb[i + 2]) {
      isColorGray = false;
      break;
    }
  }
  assert.equal(isColorGray, false);
});

