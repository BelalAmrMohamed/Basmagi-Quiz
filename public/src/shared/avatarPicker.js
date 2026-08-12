// public/src/shared/avatarPicker.js - Avatar / Thumbnail Picker Modal Controllers
//
// Two separate overlays — #avatarPickerOverlay (profile picture, square)
// and #thumbnailPickerOverlay (cover banner, wide) — each opened by their
// own button (#avatarEditBtn / #thumbnailEditBtn) and each with their own
// full set of controls (presets, Featured picks, upload, camera, remove).
// They used to be one shared overlay switched by a tab strip; separated
// because they're conceptually different pictures with different aspect
// ratios and different crop behavior, and sharing one modal made "which
// picture am I editing right now" a mode flag threaded through every
// handler instead of just being "which overlay is open".
//
// Both overlays share the same *behavior*, though (upload/drop/camera →
// crop step → save → sync), so that behavior is still written once per
// function below and parameterized by a small per-overlay config (MODES),
// rather than duplicating every handler twice.
//
// Crop step: once a file is chosen (upload, drop, or camera capture), the
// picker shows a pan/zoom crop stage (cropperEngine.js) at the target
// aspect ratio before saving — presets and Featured picks skip this since
// they're already pre-shaped. See cropperEngine.js for the interaction
// model (drag to reposition, wheel/pinch/slider to zoom).

import { avatarEngine } from "./avatarEngine.js";
import { CropperController } from "./cropperEngine.js";
import {
  _prompt,
  showNotification,
} from "../components/notifications/notifications.js";
import { getAdminRoleInfo, getToken } from "./adminAuth.js";

// Per-mode behavior + DOM id table. Every function below reads from this
// instead of hardcoding avatar-specific ids/calls, so the two overlays
// stay in lockstep without literally duplicating each handler.
const MODES = {
  avatar: {
    overlayId: "avatarPickerOverlay",
    cardCloseBtnId: "avatarPickerCloseBtn",
    featuredGridId: "avatarFeaturedGrid",
    getFeatured: () => avatarEngine.getFeaturedPictures(),
    get: () => avatarEngine.getAvatar(),
    save: (dataUrl) => avatarEngine.saveAvatar(dataUrl),
    remove: () => avatarEngine.removeAvatar(),
    syncField: "avatarUrl",
    updatedEvent: "avatarUpdated",
    savedMessage: "تم تحديث الصورة الشخصية",
    removedMessage: "تمت إزالة الصورة الشخصية",
    removeBtnLabel: "إزالة الصورة الحالية",
    editBtnId: "avatarEditBtn",
    fileInputId: "avatarFileInput",
    uploadBtnId: "avatarUploadBtn",
    dropzoneId: "avatarDropzone",
    cameraStartBtnId: "avatarCameraStartBtn",
    cameraCaptureBtnId: "avatarCameraCaptureBtn",
    cameraFeedId: "avatarCameraFeed",
    removeBtnId: "avatarRemoveBtn",
    cropStageId: "avatarCropStage",
    cropImgId: "avatarCropImage",
    cropZoomId: "avatarCropZoom",
    cropConfirmBtnId: "avatarCropConfirmBtn",
    cropCancelBtnId: "avatarCropCancelBtn",
    cropStepId: "avatarCropStep",
    pickerBodyId: "avatarPickerBody",
    aspect: 1,
    cropAndCompress: (img, rect) =>
      avatarEngine.cropAndCompressAvatar(img, rect),
  },
  thumbnail: {
    overlayId: "thumbnailPickerOverlay",
    cardCloseBtnId: "thumbnailPickerCloseBtn",
    featuredGridId: "thumbnailFeaturedGrid",
    getFeatured: () => avatarEngine.getFeaturedThumbnails(),
    get: () => avatarEngine.getThumbnail(),
    save: (dataUrl) => avatarEngine.saveThumbnail(dataUrl),
    remove: () => avatarEngine.removeThumbnail(),
    syncField: "thumbnailUrl",
    updatedEvent: "thumbnailUpdated",
    savedMessage: "تم تحديث الصورة المصغرة",
    removedMessage: "تمت إزالة الصورة المصغرة",
    removeBtnLabel: "إزالة الصورة المصغرة الحالية",
    editBtnId: "thumbnailEditBtn",
    fileInputId: "thumbnailFileInput",
    uploadBtnId: "thumbnailUploadBtn",
    dropzoneId: "thumbnailDropzone",
    cameraStartBtnId: "thumbnailCameraStartBtn",
    cameraCaptureBtnId: "thumbnailCameraCaptureBtn",
    cameraFeedId: "thumbnailCameraFeed",
    removeBtnId: "thumbnailRemoveBtn",
    cropStageId: "thumbnailCropStage",
    cropImgId: "thumbnailCropImage",
    cropZoomId: "thumbnailCropZoom",
    cropConfirmBtnId: "thumbnailCropConfirmBtn",
    cropCancelBtnId: "thumbnailCropCancelBtn",
    cropStepId: "thumbnailCropStep",
    pickerBodyId: "thumbnailPickerBody",
    aspect: avatarEngine.THUMBNAIL_WIDTH / avatarEngine.THUMBNAIL_HEIGHT,
    cropAndCompress: (img, rect) =>
      avatarEngine.cropAndCompressThumbnail(img, rect),
  },
};

// Per-mode runtime state, keyed the same as MODES. Kept separate from the
// static config above so each overlay's active camera stream / cropper
// instance / pending source image are fully independent — a crop in
// progress on one picture is never affected by opening the other.
const state = {
  avatar: { stream: null, cropper: null, sourceImg: null },
  thumbnail: { stream: null, cropper: null, sourceImg: null },
};

// Featured Pictures / Featured Thumbnails grid — static, pre-made images
// shipped with the site (see avatarEngine.getFeaturedPictures/Thumbnails).
// Rendered directly from their URL (no data-URL conversion, no processing —
// they're already the right shape) so picking one is an instant, local
// operation.
function renderFeaturedGrid(mode) {
  const cfg = MODES[mode];
  const grid = document.getElementById(cfg.featuredGridId);
  if (!grid) return;

  const items = cfg.getFeatured();
  const btnClass =
    mode === "thumbnail"
      ? "avatar-preset-btn thumbnail-preset-btn"
      : "avatar-preset-btn";

  grid.innerHTML = items
    .map(
      (
        item,
      ) => `<button type="button" class="${btnClass}" data-avatar="${item.url}" aria-label="اختيار هذه الصورة المميزة" style="padding:0; overflow:hidden; background:transparent;">
        <img src="${item.url}" alt="" loading="lazy" style="width:100%; height:100%; object-fit:cover;">
      </button>`,
    )
    .join("");

  grid.querySelectorAll(".avatar-preset-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const url = btn.getAttribute("data-avatar");
      applyPicture(mode, url);
    });
  });

  // Async fetch and append Gravatar for admins/owners — avatar mode only;
  // a Gravatar is a face photo, which doesn't make sense as a banner thumbnail.
  if (mode === "avatar") {
    const roleInfo = getAdminRoleInfo();
    if (roleInfo && roleInfo.email) {
      appendGravatarPreset(grid, roleInfo.email);
    }
  }
}

async function appendGravatarPreset(grid, email) {
  try {
    const trimmedEmail = email.trim().toLowerCase();
    const encoder = new TextEncoder();
    const data = encoder.encode(trimmedEmail);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const gravatarUrl = `https://gravatar.com/avatar/${hashHex}?s=256&d=404`;

    const res = await fetch(gravatarUrl);
    if (!res.ok) return;
    const blob = await res.blob();
    const file = new File([blob], "gravatar.jpg", { type: blob.type });
    const dataUrl = await avatarEngine.processImageFile(file);

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "avatar-preset-btn gravatar-preset";
    btn.setAttribute("data-avatar", dataUrl);
    btn.setAttribute("aria-label", "الصورة من البريد");
    btn.style.cssText = "background:transparent; padding:0; overflow:hidden;";
    btn.innerHTML = `<img src="${dataUrl}" style="width:100%; height:100%; object-fit:cover;">`;
    btn.addEventListener("click", () => applyPicture("avatar", dataUrl));

    grid.appendChild(btn);
  } catch (err) {
    console.error("Failed to append gravatar", err);
  }
}

function applyPicture(mode, dataUrl) {
  const cfg = MODES[mode];
  const ok = cfg.save(dataUrl);
  if (ok) {
    window.dispatchEvent(new CustomEvent(cfg.updatedEvent));
    showNotification(cfg.savedMessage, "", "success");
    closePicker(mode);
    syncPictureToServer(mode, dataUrl);
  } else {
    showNotification("تعذّر حفظ الصورة، جرّب صورة أصغر", "", "error");
  }
}

// Persists the avatar/thumbnail to the matching admin_users column for
// admin/dev accounts so it shows up in visitor view (public profile).
// Regular/anonymous users have no DB row — getAdminRoleInfo() returning
// null is the guard for that. Best-effort/fire-and-forget: the local copy
// (avatarEngine, already saved above) is what the owner's own UI always
// shows, so a failed sync here shouldn't interrupt or roll back what the
// user just did.
async function syncPictureToServer(mode, dataUrl) {
  const cfg = MODES[mode];
  const roleInfo = getAdminRoleInfo();
  if (!roleInfo) return;

  const token = getToken();
  if (!token) return;

  try {
    await fetch("/api/admin-stats", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ [cfg.syncField]: dataUrl }),
    });
  } catch (err) {
    console.error("Failed to sync picture to server", err);
  }
}

// ==================== Crop step ====================
// Shown after a file is picked (upload/drop/camera) and before it's
// actually saved — presets/Featured picks bypass this entirely since
// they're already pre-shaped and don't need cropping.

function enterCropStep(mode, sourceImg) {
  const cfg = MODES[mode];
  const s = state[mode];
  s.sourceImg = sourceImg;

  const pickerBody = document.getElementById(cfg.pickerBodyId);
  const cropStep = document.getElementById(cfg.cropStepId);
  if (pickerBody) pickerBody.style.display = "none";
  if (cropStep) cropStep.style.display = "flex";

  const stageEl = document.getElementById(cfg.cropStageId);
  const imgEl = document.getElementById(cfg.cropImgId);
  const zoomSlider = document.getElementById(cfg.cropZoomId);
  if (!stageEl || !imgEl) return;

  if (s.cropper) s.cropper.destroy();
  s.cropper = new CropperController({
    stageEl,
    imgEl,
    onChange: (zoom) => {
      if (zoomSlider) zoomSlider.value = String(zoom);
    },
  });

  // cropStep was just switched from display:none to display:flex above,
  // so the stage (sized via width:100% + aspect-ratio in CSS) hasn't been
  // laid out yet — stageEl.clientWidth/clientHeight would still read 0
  // (or a stale value) if we called load() synchronously here, which
  // makes CropperController._computeBaseScale() compute baseScale as 0
  // and the picked image render at scale(0) — effectively invisible.
  // requestAnimationFrame waits for the browser to commit the display
  // change and run layout first, so the stage reports its real size.
  requestAnimationFrame(() => {
    s.cropper.load(sourceImg);
  });
  if (zoomSlider) zoomSlider.value = "1";
}

function exitCropStep(mode) {
  const cfg = MODES[mode];
  const s = state[mode];
  if (s.cropper) {
    s.cropper.destroy();
    s.cropper = null;
  }
  if (s.sourceImg) {
    avatarEngine.releaseCroppingImage(s.sourceImg);
  }
  s.sourceImg = null;

  const pickerBody = document.getElementById(cfg.pickerBodyId);
  const cropStep = document.getElementById(cfg.cropStepId);
  if (pickerBody) pickerBody.style.display = "";
  if (cropStep) cropStep.style.display = "none";
}

function confirmCrop(mode) {
  const cfg = MODES[mode];
  const s = state[mode];
  if (!s.cropper || !s.sourceImg) return;

  try {
    const rect = s.cropper.getCropRect();
    const dataUrl = cfg.cropAndCompress(s.sourceImg, rect);
    exitCropStep(mode);
    applyPicture(mode, dataUrl);
  } catch (err) {
    showNotification(err.message || "تعذّر قص الصورة", "", "error");
  }
}

// ==================== File intake (upload / drop / camera) ====================

async function processAndApplyFile(mode, file) {
  if (!file) return;
  try {
    const sourceImg = await avatarEngine.loadImageForCropping(file);
    enterCropStep(mode, sourceImg);
  } catch (err) {
    showNotification(err.message || "تعذّر معالجة الصورة", "", "error");
  }
}

async function handleFileInput(mode, e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  await processAndApplyFile(mode, file);
  e.target.value = "";
}

async function startCamera(mode) {
  const cfg = MODES[mode];
  const s = state[mode];
  const video = document.getElementById(cfg.cameraFeedId);
  const captureBtn = document.getElementById(cfg.cameraCaptureBtnId);
  const startBtn = document.getElementById(cfg.cameraStartBtnId);
  if (!video) return;

  try {
    s.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user" },
      audio: false,
    });
    video.srcObject = s.stream;
    video.style.display = "block";
    if (captureBtn) captureBtn.style.display = "inline-flex";
    if (startBtn) startBtn.style.display = "none";
  } catch (err) {
    console.error("Camera access failed:", err);
    showNotification("تعذّر الوصول إلى الكاميرا", "", "error");
  }
}

function stopCamera(mode) {
  const cfg = MODES[mode];
  const s = state[mode];
  if (s.stream) {
    s.stream.getTracks().forEach((track) => track.stop());
    s.stream = null;
  }
  const video = document.getElementById(cfg.cameraFeedId);
  const captureBtn = document.getElementById(cfg.cameraCaptureBtnId);
  const startBtn = document.getElementById(cfg.cameraStartBtnId);
  if (video) {
    video.srcObject = null;
    video.style.display = "none";
  }
  if (captureBtn) captureBtn.style.display = "none";
  if (startBtn) startBtn.style.display = "inline-flex";
}

async function captureFromCamera(mode) {
  const cfg = MODES[mode];
  const s = state[mode];
  const video = document.getElementById(cfg.cameraFeedId);
  if (!video || !s.stream) return;

  // Capture the full camera frame (no pre-crop) and hand it straight to
  // the same crop step upload/drop use — lets the user reposition/zoom
  // a camera shot exactly like any other source image, instead of the
  // old fixed center-square capture.
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  canvas.toBlob(
    async (blob) => {
      try {
        const file = new File([blob], "camera-capture.jpg", {
          type: "image/jpeg",
        });
        const sourceImg = await avatarEngine.loadImageForCropping(file);
        stopCamera(mode);
        enterCropStep(mode, sourceImg);
      } catch (err) {
        showNotification(err.message || "تعذّر التقاط الصورة", "", "error");
      }
    },
    "image/jpeg",
    0.92,
  );
}

// ==================== Overlay open/close ====================

function openPicker(mode) {
  const cfg = MODES[mode];
  const overlay = document.getElementById(cfg.overlayId);
  if (!overlay) return;

  renderFeaturedGrid(mode);

  overlay.style.display = "flex";
  requestAnimationFrame(() => overlay.classList.add("open"));
}

function closePicker(mode) {
  const cfg = MODES[mode];
  const overlay = document.getElementById(cfg.overlayId);
  if (!overlay) return;
  stopCamera(mode);
  exitCropStep(mode);
  overlay.classList.remove("open");
  setTimeout(() => {
    overlay.style.display = "none";
  }, 200);
}

// Back-compat named exports (openAvatarPicker/closeAvatarPicker previously
// took a mode argument for the shared overlay) — kept as thin wrappers so
// any other module importing them by name still works unchanged.
export function openAvatarPicker(mode = "avatar") {
  openPicker(MODES[mode] ? mode : "avatar");
}
export function closeAvatarPicker(mode = "avatar") {
  closePicker(MODES[mode] ? mode : "avatar");
}

function wireModeControls(mode) {
  const cfg = MODES[mode];
  const editBtn = document.getElementById(cfg.editBtnId);
  const overlay = document.getElementById(cfg.overlayId);
  const closeBtn = document.getElementById(cfg.cardCloseBtnId);
  const fileInput = document.getElementById(cfg.fileInputId);
  const uploadBtn = document.getElementById(cfg.uploadBtnId);
  const dropzone = document.getElementById(cfg.dropzoneId);
  const cameraStartBtn = document.getElementById(cfg.cameraStartBtnId);
  const cameraCaptureBtn = document.getElementById(cfg.cameraCaptureBtnId);
  const removeBtn = document.getElementById(cfg.removeBtnId);
  const cropConfirmBtn = document.getElementById(cfg.cropConfirmBtnId);
  const cropCancelBtn = document.getElementById(cfg.cropCancelBtnId);
  const zoomSlider = document.getElementById(cfg.cropZoomId);

  if (!overlay) return false; // Guard: only wire up on pages that have this picker

  editBtn && editBtn.addEventListener("click", () => openPicker(mode));
  closeBtn && closeBtn.addEventListener("click", () => closePicker(mode));
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closePicker(mode);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay.classList.contains("open"))
      closePicker(mode);
  });

  uploadBtn &&
    uploadBtn.addEventListener("click", () => fileInput && fileInput.click());
  fileInput &&
    fileInput.addEventListener("change", (e) => handleFileInput(mode, e));

  if (dropzone) {
    // dragenter/dragover must both preventDefault, or the browser's own
    // "open this file" navigation runs instead of firing "drop".
    let dragDepth = 0; // counts nested enter/leave so a drag over a child
    // element (the button, the hint text) doesn't
    // prematurely clear the active state on dragleave.

    dropzone.addEventListener("dragenter", (e) => {
      e.preventDefault();
      dragDepth++;
      dropzone.classList.add("drag-over");
    });

    dropzone.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    });

    dropzone.addEventListener("dragleave", (e) => {
      e.preventDefault();
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) dropzone.classList.remove("drag-over");
    });

    dropzone.addEventListener("drop", async (e) => {
      e.preventDefault();
      dragDepth = 0;
      dropzone.classList.remove("drag-over");

      const file =
        e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (!file) return;
      await processAndApplyFile(mode, file);
    });
  }

  cameraStartBtn &&
    cameraStartBtn.addEventListener("click", () => startCamera(mode));
  cameraCaptureBtn &&
    cameraCaptureBtn.addEventListener("click", () => captureFromCamera(mode));

  removeBtn &&
    removeBtn.addEventListener("click", () => {
      const cfg2 = MODES[mode];
      cfg2.remove();
      window.dispatchEvent(new CustomEvent(cfg2.updatedEvent));
      showNotification(cfg2.removedMessage, "", "success");
      closePicker(mode);
      // Clear the server-side copy too, so a removed picture doesn't keep
      // showing up in visitor view after it's gone from the owner's own UI.
      syncPictureToServer(mode, null);
    });

  cropConfirmBtn &&
    cropConfirmBtn.addEventListener("click", () => confirmCrop(mode));
  cropCancelBtn &&
    cropCancelBtn.addEventListener("click", () => {
      exitCropStep(mode);
      // Cancelling the crop returns to the picker's main screen rather
      // than closing the whole overlay — the user may just want to pick
      // a different source image instead of abandoning the flow.
    });

  zoomSlider &&
    zoomSlider.addEventListener("input", () => {
      const s = state[mode];
      if (s.cropper) s.cropper.setZoom(parseFloat(zoomSlider.value));
    });

  // Re-fit the crop stage if the modal reflows while a crop is in
  // progress (e.g. orientation change on mobile).
  window.addEventListener("resize", () => {
    const s = state[mode];
    if (s.cropper) s.cropper.handleResize();
  });

  return true;
}

export function initAvatarPicker() {
  const wiredAvatar = wireModeControls("avatar");
  const wiredThumbnail = wireModeControls("thumbnail");
  return wiredAvatar || wiredThumbnail;
}
