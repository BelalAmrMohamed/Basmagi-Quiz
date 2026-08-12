// public/src/shared/cropperEngine.js - Vanilla pan/zoom image cropper
//
// Self-contained replacement for the react-easy-crop interaction pattern
// (drag to reposition, pinch/wheel/slider to zoom, fixed-aspect viewport),
// built with plain DOM + pointer events since this codebase has no React
// build step. Used by avatarPicker.js for both the avatar (square) and
// thumbnail (wide banner) crop steps — the aspect ratio is the only thing
// that differs between the two, passed in via `aspect`.
//
// Model: the source <img> is drawn at natural size inside a CSS-transformed
// layer (translate + scale), and the viewport is a fixed-size, overflow:
// hidden window over it — same mental model as react-easy-crop. Dragging
// the image and changing zoom just update the transform; the actual pixel
// crop rectangle (in source-image coordinates) is only computed once, on
// confirm, from the final transform state.

const MIN_ZOOM = 1; // 1 = image just covers the viewport, can't zoom out further
const MAX_ZOOM = 4;

export class CropperController {
  // stageEl: the fixed-size viewport element (overflow:hidden), aspect
  //   ratio and size are controlled entirely by CSS on this element.
  // imgEl: the <img> that gets transformed (must be a child of stageEl).
  // onChange(zoom): optional callback fired after zoom changes (e.g. to
  //   sync an external slider's value).
  constructor({ stageEl, imgEl, onChange }) {
    this.stageEl = stageEl;
    this.imgEl = imgEl;
    this.onChange = onChange || (() => {});

    this.naturalWidth = 0;
    this.naturalHeight = 0;
    this.baseScale = 1; // scale at zoom=1 that makes the image cover the stage
    this.zoom = 1;
    this.offsetX = 0; // px, in stage coordinates
    this.offsetY = 0;

    this._dragging = false;
    this._dragStart = null;
    this._pointers = new Map(); // active pointers, for pinch-zoom
    this._pinchStartDist = null;
    this._pinchStartZoom = null;

    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._onWheel = this._onWheel.bind(this);
  }

  // Loads a source image (already-decoded <img>/HTMLImageElement, e.g.
  // from avatarEngine.loadImageForCropping) into the stage, resets pan/zoom
  // to a centered fit-cover, and wires up interaction listeners.
  load(sourceImg) {
    this.naturalWidth = sourceImg.naturalWidth || sourceImg.width;
    this.naturalHeight = sourceImg.naturalHeight || sourceImg.height;

    this.imgEl.src = sourceImg.src;
    this.imgEl.style.width = `${this.naturalWidth}px`;
    this.imgEl.style.height = `${this.naturalHeight}px`;

    this._computeBaseScale();
    this.zoom = 1;
    this.offsetX = 0;
    this.offsetY = 0;
    this._applyTransform();
    this._bindEvents();
  }

  // Recomputes baseScale from the stage's current rendered size — call
  // this if the stage can resize after load() (e.g. modal reflow), then
  // re-apply the transform so the image still covers the viewport.
  handleResize() {
    if (!this.naturalWidth) return;
    this._computeBaseScale();
    this._clampOffset();
    this._applyTransform();
  }

  _computeBaseScale() {
    const stageW = this.stageEl.clientWidth;
    const stageH = this.stageEl.clientHeight;
    // "Cover" fit: scale so the image's smaller-relative-to-stage side
    // exactly fills the stage, same as CSS background-size:cover.
    this.baseScale = Math.max(
      stageW / this.naturalWidth,
      stageH / this.naturalHeight,
    );
  }

  _bindEvents() {
    if (this._bound) return;
    this._bound = true;
    this.stageEl.addEventListener("pointerdown", this._onPointerDown);
    window.addEventListener("pointermove", this._onPointerMove);
    window.addEventListener("pointerup", this._onPointerUp);
    window.addEventListener("pointercancel", this._onPointerUp);
    this.stageEl.addEventListener("wheel", this._onWheel, { passive: false });
  }

  destroy() {
    if (!this._bound) return;
    this._bound = false;
    this.stageEl.removeEventListener("pointerdown", this._onPointerDown);
    window.removeEventListener("pointermove", this._onPointerMove);
    window.removeEventListener("pointerup", this._onPointerUp);
    window.removeEventListener("pointercancel", this._onPointerUp);
    this.stageEl.removeEventListener("wheel", this._onWheel);
    this._pointers.clear();
  }

  setZoom(nextZoom, focalPoint = null) {
    const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom));
    if (clamped === this.zoom) return;

    // Zoom around a focal point (pointer/pinch center, or stage center for
    // the slider) so zooming doesn't visually jump the image around —
    // keep the same source pixel under the focal point before and after.
    const stageRect = this.stageEl.getBoundingClientRect();
    const fx = focalPoint ? focalPoint.x - stageRect.left : stageRect.width / 2;
    const fy = focalPoint ? focalPoint.y - stageRect.top : stageRect.height / 2;

    const scaleRatio = clamped / this.zoom;
    this.offsetX = fx - (fx - this.offsetX) * scaleRatio;
    this.offsetY = fy - (fy - this.offsetY) * scaleRatio;

    this.zoom = clamped;
    this._clampOffset();
    this._applyTransform();
    this.onChange(this.zoom);
  }

  _onPointerDown(e) {
    this.stageEl.setPointerCapture(e.pointerId);
    this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this._pointers.size === 1) {
      this._dragging = true;
      this._dragStart = {
        x: e.clientX,
        y: e.clientY,
        offsetX: this.offsetX,
        offsetY: this.offsetY,
      };
    } else if (this._pointers.size === 2) {
      // Second finger down: switch from drag to pinch.
      this._dragging = false;
      const pts = Array.from(this._pointers.values());
      this._pinchStartDist = this._distance(pts[0], pts[1]);
      this._pinchStartZoom = this.zoom;
    }
  }

  _onPointerMove(e) {
    if (!this._pointers.has(e.pointerId)) return;
    this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this._pointers.size === 2) {
      const pts = Array.from(this._pointers.values());
      const dist = this._distance(pts[0], pts[1]);
      if (this._pinchStartDist) {
        const center = {
          x: (pts[0].x + pts[1].x) / 2,
          y: (pts[0].y + pts[1].y) / 2,
        };
        const nextZoom =
          this._pinchStartZoom * (dist / this._pinchStartDist);
        this.setZoom(nextZoom, center);
      }
      return;
    }

    if (this._dragging && this._dragStart) {
      this.offsetX = this._dragStart.offsetX + (e.clientX - this._dragStart.x);
      this.offsetY = this._dragStart.offsetY + (e.clientY - this._dragStart.y);
      this._clampOffset();
      this._applyTransform();
    }
  }

  _onPointerUp(e) {
    this._pointers.delete(e.pointerId);
    if (this._pointers.size < 2) {
      this._pinchStartDist = null;
      this._pinchStartZoom = null;
    }
    if (this._pointers.size === 0) {
      this._dragging = false;
      this._dragStart = null;
    }
  }

  _onWheel(e) {
    e.preventDefault();
    const delta = -e.deltaY * 0.0015;
    this.setZoom(this.zoom + this.zoom * delta, { x: e.clientX, y: e.clientY });
  }

  _distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  // Keeps the image covering the stage at all times — offset can't drag
  // the image's edge past the stage's edge, at the current zoom level.
  _clampOffset() {
    const stageW = this.stageEl.clientWidth;
    const stageH = this.stageEl.clientHeight;
    const scaledW = this.naturalWidth * this.baseScale * this.zoom;
    const scaledH = this.naturalHeight * this.baseScale * this.zoom;

    const maxOffsetX = Math.max(0, (scaledW - stageW) / 2);
    const maxOffsetY = Math.max(0, (scaledH - stageH) / 2);

    this.offsetX = Math.min(maxOffsetX, Math.max(-maxOffsetX, this.offsetX));
    this.offsetY = Math.min(maxOffsetY, Math.max(-maxOffsetY, this.offsetY));
  }

  _applyTransform() {
    const scale = this.baseScale * this.zoom;
    // Image is centered in the stage by CSS (position:absolute; top/left:50%;
    // margin negative half its natural size — see .cropper-image in
    // profile.css), so the transform here only needs translate+scale on
    // top of that centering, not an explicit centering offset itself.
    this.imgEl.style.transform =
      `translate(${this.offsetX}px, ${this.offsetY}px) scale(${scale})`;
  }

  // Computes the crop rectangle in the SOURCE image's own pixel
  // coordinates, from the current pan/zoom transform. This is what gets
  // passed to avatarEngine.cropAndCompress*().
  getCropRect() {
    const stageW = this.stageEl.clientWidth;
    const stageH = this.stageEl.clientHeight;
    const scale = this.baseScale * this.zoom;

    // Stage-space top-left of the *displayed* image, given it's centered
    // in the stage before translate/scale, then panned by offsetX/Y.
    const displayedW = this.naturalWidth * scale;
    const displayedH = this.naturalHeight * scale;
    const imageLeftInStage = (stageW - displayedW) / 2 + this.offsetX;
    const imageTopInStage = (stageH - displayedH) / 2 + this.offsetY;

    // The stage's own top-left, in the same displayed-image space, is
    // (0,0) — so the visible crop's top-left within the *displayed*
    // image is simply the negative of the image's position in the stage.
    const cropLeftInDisplayed = -imageLeftInStage;
    const cropTopInDisplayed = -imageTopInStage;

    // Convert from displayed-image pixels back to source-image pixels.
    const sx = cropLeftInDisplayed / scale;
    const sy = cropTopInDisplayed / scale;
    const sw = stageW / scale;
    const sh = stageH / scale;

    // Clamp defensively — pointer/pinch math can overshoot by sub-pixel
    // amounts at the extremes, and drawImage with an out-of-bounds source
    // rect throws rather than silently clipping.
    return {
      x: Math.max(0, Math.min(sx, this.naturalWidth - sw)),
      y: Math.max(0, Math.min(sy, this.naturalHeight - sh)),
      width: Math.min(sw, this.naturalWidth),
      height: Math.min(sh, this.naturalHeight),
    };
  }
}