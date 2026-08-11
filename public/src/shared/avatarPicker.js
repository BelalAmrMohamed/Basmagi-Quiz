// public/src/shared/avatarPicker.js - Avatar / Thumbnail Picker Modal Controller
// Handles the "choose your picture" overlay in two modes — "avatar" (the
// profile picture) and "thumbnail" (the profile banner) — switched via the
// tab strip in the overlay. Each mode has its own default preset avatars
// (generated, not stored, from initials), Featured picks (static shipped
// images), local file upload, and device camera capture; upload/camera/
// remove act on whichever mode is currently active. Mirrors the interaction
// pattern already used by #contactDevOverlay in profile.html.

import { avatarEngine } from "./avatarEngine.js";
import {
  _prompt,
  showNotification,
} from "../components/notifications/notifications.js";
import { getAdminRoleInfo, getToken } from "./adminAuth.js";

let activeStream = null;
let currentMode = "avatar"; // "avatar" | "thumbnail" — which picture the picker is currently editing

// Per-mode behavior table. Every function below reads from this instead of
// hardcoding avatar-specific calls, so "thumbnail" support is a second row
// here rather than a parallel copy of the whole file.
const MODES = {
  avatar: {
    title: "تغيير الصورة الشخصية",
    presetGridId: "avatarPresetGrid",
    presetLabel: "اختر لوناً افتراضياً",
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
  },
  thumbnail: {
    title: "تغيير الصورة المصغرة",
    presetGridId: "avatarPresetGrid",
    presetLabel: "اختر لوناً افتراضياً",
    featuredGridId: "avatarFeaturedGrid",
    getFeatured: () => avatarEngine.getFeaturedThumbnails(),
    get: () => avatarEngine.getThumbnail(),
    save: (dataUrl) => avatarEngine.saveThumbnail(dataUrl),
    remove: () => avatarEngine.removeThumbnail(),
    syncField: "thumbnailUrl",
    updatedEvent: "thumbnailUpdated",
    savedMessage: "تم تحديث الصورة المصغرة",
    removedMessage: "تمت إزالة الصورة المصغرة",
    removeBtnLabel: "إزالة الصورة المصغرة الحالية",
  },
};

function activeConfig() {
  return MODES[currentMode] || MODES.avatar;
}

function getUsername() {
  return localStorage.getItem("username") || "مستخدم";
}

// We use deterministic abstract patterns based on names to populate the grid.
const PRESET_SEEDS = [
  "Alpha",
  "Bravo",
  "Charlie",
  "Delta",
  "Echo",
  "Foxtrot",
  "Golf",
  "Hotel",
];

function renderPresetGrid() {
  const cfg = activeConfig();
  const grid = document.getElementById(cfg.presetGridId);
  if (!grid) return;

  const name = getUsername();

  // Create an array of 8 seeds to generate different patterns
  // The first one is the user's actual username, so their personal pattern is always available.
  const seeds = [name, ...PRESET_SEEDS].slice(0, 8);

  grid.innerHTML = seeds
    .map((seed) => {
      const svg = avatarEngine.generateDefaultAvatarSVG(seed);
      const dataUrl = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
      return `<button type="button" class="avatar-preset-btn" data-avatar="${dataUrl}" aria-label="اختيار هذا الشكل" style="padding:0; overflow:hidden; background:transparent;">
        <img src="${dataUrl}" alt="preset" style="width:100%; height:100%; object-fit:cover;">
      </button>`;
    })
    .join("");

  grid.querySelectorAll(".avatar-preset-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const dataUrl = btn.getAttribute("data-avatar");
      applyPicture(dataUrl);
    });
  });

  // Async fetch and append Gravatar for admins/owners — avatar mode only;
  // a Gravatar is a face photo, which doesn't make sense as a banner thumbnail.
  if (currentMode === "avatar") {
    const roleInfo = getAdminRoleInfo();
    if (roleInfo && roleInfo.email) {
      appendGravatarPreset(grid, roleInfo.email);
    }
  }
}

// Featured Pictures / Featured Thumbnails grid — static, pre-made images
// shipped with the site (see avatarEngine.getFeaturedPictures/Thumbnails).
// Rendered directly from their URL (no data-URL conversion, no processing —
// they're already the right shape) so picking one is an instant, local
// operation, same as picking a generated preset.
function renderFeaturedGrid() {
  const cfg = activeConfig();
  const grid = document.getElementById(cfg.featuredGridId);
  if (!grid) return;

  const items = cfg.getFeatured();

  grid.innerHTML = items
    .map(
      (
        item,
      ) => `<button type="button" class="avatar-preset-btn" data-avatar="${item.url}" aria-label="اختيار هذه الصورة المميزة" style="padding:0; overflow:hidden; background:transparent;">
        <img src="${item.url}" alt="" loading="lazy" style="width:100%; height:100%; object-fit:cover;">
      </button>`,
    )
    .join("");

  grid.querySelectorAll(".avatar-preset-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const url = btn.getAttribute("data-avatar");
      applyPicture(url);
    });
  });
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
    btn.addEventListener("click", () => applyPicture(dataUrl));

    grid.appendChild(btn);
  } catch (err) {
    console.error("Failed to append gravatar", err);
  }
}

function applyPicture(dataUrl) {
  const cfg = activeConfig();
  const ok = cfg.save(dataUrl);
  if (ok) {
    window.dispatchEvent(new CustomEvent(cfg.updatedEvent));
    showNotification(cfg.savedMessage, "", "success");
    closeAvatarPicker();
    syncPictureToServer(dataUrl);
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
async function syncPictureToServer(dataUrl) {
  const cfg = activeConfig();
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

async function processAndApplyFile(file) {
  if (!file) return;
  try {
    const dataUrl = await avatarEngine.processImageFile(file);
    applyPicture(dataUrl);
  } catch (err) {
    showNotification(err.message || "تعذّر معالجة الصورة", "", "error");
  }
}

async function handleFileInput(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  await processAndApplyFile(file);
  e.target.value = "";
}

async function startCamera() {
  const video = document.getElementById("avatarCameraFeed");
  const captureBtn = document.getElementById("avatarCameraCaptureBtn");
  const startBtn = document.getElementById("avatarCameraStartBtn");
  if (!video) return;

  try {
    activeStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user" },
      audio: false,
    });
    video.srcObject = activeStream;
    video.style.display = "block";
    if (captureBtn) captureBtn.style.display = "inline-flex";
    if (startBtn) startBtn.style.display = "none";
  } catch (err) {
    console.error("Camera access failed:", err);
    showNotification("تعذّر الوصول إلى الكاميرا", "", "error");
  }
}

function stopCamera() {
  if (activeStream) {
    activeStream.getTracks().forEach((track) => track.stop());
    activeStream = null;
  }
  const video = document.getElementById("avatarCameraFeed");
  const captureBtn = document.getElementById("avatarCameraCaptureBtn");
  const startBtn = document.getElementById("avatarCameraStartBtn");
  if (video) {
    video.srcObject = null;
    video.style.display = "none";
  }
  if (captureBtn) captureBtn.style.display = "none";
  if (startBtn) startBtn.style.display = "inline-flex";
}

async function captureFromCamera() {
  const video = document.getElementById("avatarCameraFeed");
  if (!video || !activeStream) return;

  const side = Math.min(video.videoWidth, video.videoHeight);
  const sx = (video.videoWidth - side) / 2;
  const sy = (video.videoHeight - side) / 2;

  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, sx, sy, side, side, 0, 0, 256, 256);

  canvas.toBlob(
    async (blob) => {
      try {
        const file = new File([blob], "camera-avatar.jpg", {
          type: "image/jpeg",
        });
        const dataUrl = await avatarEngine.processImageFile(file);
        applyPicture(dataUrl);
        stopCamera();
      } catch (err) {
        showNotification(err.message || "تعذّر التقاط الصورة", "", "error");
      }
    },
    "image/jpeg",
    0.85,
  );
}

// Applies currentMode's copy (title, remove-button label, active tab) to
// the shared overlay chrome. Called on open and on every tab switch.
function applyModeToOverlay() {
  const cfg = activeConfig();

  const titleEl = document.getElementById("avatarPickerTitle");
  if (titleEl) titleEl.textContent = cfg.title;

  const presetLabelEl = document.querySelector(
    `#${cfg.presetGridId}`,
  )?.previousElementSibling;
  if (presetLabelEl) presetLabelEl.textContent = cfg.presetLabel;

  const removeBtn = document.getElementById("avatarRemoveBtn");
  if (removeBtn) removeBtn.textContent = cfg.removeBtnLabel;
  // Restore the icon that textContent just wiped — rebuild it once here
  // rather than re-querying the SVG markup from the DOM.
  if (removeBtn) {
    removeBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>${cfg.removeBtnLabel}`;
  }

  document.querySelectorAll(".avatar-picker-tab").forEach((tab) => {
    const isActive = tab.dataset.mode === currentMode;
    tab.classList.toggle("is-active", isActive);
    tab.setAttribute("aria-selected", isActive ? "true" : "false");
  });

  renderPresetGrid();
  renderFeaturedGrid();
}

export function openAvatarPicker(mode = "avatar") {
  const overlay = document.getElementById("avatarPickerOverlay");
  if (!overlay) return;

  currentMode = MODES[mode] ? mode : "avatar";
  applyModeToOverlay();

  overlay.style.display = "flex";
  requestAnimationFrame(() => overlay.classList.add("open"));
}

export function closeAvatarPicker() {
  const overlay = document.getElementById("avatarPickerOverlay");
  if (!overlay) return;
  stopCamera();
  overlay.classList.remove("open");
  setTimeout(() => {
    overlay.style.display = "none";
  }, 200);
}

export function initAvatarPicker() {
  const editBtn = document.getElementById("avatarEditBtn");
  const thumbnailEditBtn = document.getElementById("thumbnailEditBtn");
  const overlay = document.getElementById("avatarPickerOverlay");
  const closeBtn = document.getElementById("avatarPickerCloseBtn");
  const fileInput = document.getElementById("avatarFileInput");
  const uploadBtn = document.getElementById("avatarUploadBtn");
  const dropzone = document.getElementById("avatarDropzone");
  const cameraStartBtn = document.getElementById("avatarCameraStartBtn");
  const cameraCaptureBtn = document.getElementById("avatarCameraCaptureBtn");
  const removeBtn = document.getElementById("avatarRemoveBtn");
  const tabs = document.querySelectorAll(".avatar-picker-tab");

  if (!overlay) return; // Guard: only wire up on pages that have the picker

  editBtn &&
    editBtn.addEventListener("click", () => openAvatarPicker("avatar"));
  thumbnailEditBtn &&
    thumbnailEditBtn.addEventListener("click", () =>
      openAvatarPicker("thumbnail"),
    );
  closeBtn && closeBtn.addEventListener("click", closeAvatarPicker);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeAvatarPicker();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay.classList.contains("open"))
      closeAvatarPicker();
  });

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      if (tab.dataset.mode === currentMode) return;
      stopCamera(); // switching modes mid-capture would apply to the wrong target
      currentMode = MODES[tab.dataset.mode] ? tab.dataset.mode : "avatar";
      applyModeToOverlay();
    });
  });

  uploadBtn &&
    uploadBtn.addEventListener("click", () => fileInput && fileInput.click());
  fileInput && fileInput.addEventListener("change", handleFileInput);

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
      await processAndApplyFile(file);
    });
  }

  cameraStartBtn && cameraStartBtn.addEventListener("click", startCamera);
  cameraCaptureBtn &&
    cameraCaptureBtn.addEventListener("click", captureFromCamera);

  removeBtn &&
    removeBtn.addEventListener("click", () => {
      const cfg = activeConfig();
      cfg.remove();
      window.dispatchEvent(new CustomEvent(cfg.updatedEvent));
      showNotification(cfg.removedMessage, "", "success");
      closeAvatarPicker();
      // Clear the server-side copy too, so a removed picture doesn't keep
      // showing up in visitor view after it's gone from the owner's own UI.
      syncPictureToServer(null);
    });
}
