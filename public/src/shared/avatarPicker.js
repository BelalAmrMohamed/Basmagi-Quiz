// public/src/shared/avatarPicker.js - Avatar Picker Modal Controller
// Handles the "choose your avatar" overlay: default preset avatars
// (generated, not stored, from initials), local file upload, and
// device camera capture. Mirrors the interaction pattern already used
// by #contactDevOverlay in profile.html.

import { avatarEngine } from "./avatarEngine.js";
import { prompt_user, showNotification } from "../components/notifications/notifications.js";
import { getAdminRoleInfo, getToken } from "./adminAuth.js";

let activeStream = null;

function getUsername() {
  return localStorage.getItem("username") || "مستخدم";
}

// Preset palette as [from, to] gradient pairs, matching avatarEngine's
// DEFAULT_AVATAR_PALETTE styling so presets and the generated fallback
// avatar look like one consistent family instead of two different systems.
const PRESET_GRADIENTS = [
  ["#818cf8", "#4f46e5"],
  ["#a78bfa", "#7c3aed"],
  ["#f472b6", "#db2777"],
  ["#fbbf24", "#d97706"],
  ["#34d399", "#059669"],
  ["#60a5fa", "#2563eb"],
  ["#f87171", "#dc2626"],
  ["#2dd4bf", "#0d9488"],
];

function renderPresetGrid() {
  const grid = document.getElementById("avatarPresetGrid");
  if (!grid) return;

  const name = getUsername();
  const initial = avatarEngine.initialForName(name);

  grid.innerHTML = PRESET_GRADIENTS
    .map(([from, to], i) => {
      const gradId = `presetGrad${i}`;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="${gradId}" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="${from}"/><stop offset="100%" stop-color="${to}"/></linearGradient></defs><rect width="100" height="100" rx="50" fill="url(#${gradId})"/><circle cx="50" cy="50" r="44" fill="none" stroke="#ffffff" stroke-opacity="0.25" stroke-width="1.5"/><text x="50" y="52" font-family="IBM Plex Sans Arabic, sans-serif" font-size="40" font-weight="700" fill="#ffffff" text-anchor="middle" dominant-baseline="central">${initial}</text></svg>`;
      const dataUrl = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
      return `<button type="button" class="avatar-preset-btn" data-avatar="${dataUrl}" style="background:linear-gradient(135deg, ${from}, ${to});" aria-label="اختيار هذا التدرج">${initial}</button>`;
    })
    .join("");

  grid.querySelectorAll(".avatar-preset-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const dataUrl = btn.getAttribute("data-avatar");
      applyAvatar(dataUrl);
    });
  });

  // Async fetch and append Gravatar for admins/owners
  const roleInfo = getAdminRoleInfo();
  if (roleInfo && roleInfo.email) {
    appendGravatarPreset(grid, roleInfo.email);
  }
}

async function appendGravatarPreset(grid, email) {
  try {
    const trimmedEmail = email.trim().toLowerCase();
    const encoder = new TextEncoder();
    const data = encoder.encode(trimmedEmail);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
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
    btn.addEventListener("click", () => applyAvatar(dataUrl));
    
    grid.appendChild(btn);
  } catch(err) {
    console.error("Failed to append gravatar", err);
  }
}

function applyAvatar(dataUrl) {
  const ok = avatarEngine.saveAvatar(dataUrl);
  if (ok) {
    window.dispatchEvent(new CustomEvent("avatarUpdated"));
    showNotification("تم تحديث الصورة الشخصية", "", "success");
    closeAvatarPicker();
    syncAvatarToServer(dataUrl);
  } else {
    showNotification("تعذّر حفظ الصورة، جرّب صورة أصغر", "", "error");
  }
}

// Persists the avatar to admin_users.avatar_url for admin/dev accounts so
// it shows up in visitor view (public profile). Regular/anonymous users
// have no DB row — getAdminRoleInfo() returning null is the guard for that.
// Best-effort/fire-and-forget: the local avatar (avatarEngine, already
// saved above) is what the owner's own UI always shows, so a failed sync
// here shouldn't interrupt or roll back what the user just did.
async function syncAvatarToServer(dataUrl) {
  const roleInfo = getAdminRoleInfo();
  if (!roleInfo) return;

  const token = getToken();
  if (!token) return;

  try {
    await fetch("/api/admin-stats", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({ avatarUrl: dataUrl }),
    });
  } catch (err) {
    console.error("Failed to sync avatar to server", err);
  }
}

async function processAndApplyFile(file) {
  if (!file) return;
  try {
    const dataUrl = await avatarEngine.processImageFile(file);
    applyAvatar(dataUrl);
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
        const file = new File([blob], "camera-avatar.jpg", { type: "image/jpeg" });
        const dataUrl = await avatarEngine.processImageFile(file);
        applyAvatar(dataUrl);
        stopCamera();
      } catch (err) {
        showNotification(err.message || "تعذّر التقاط الصورة", "", "error");
      }
    },
    "image/jpeg",
    0.85,
  );
}

export function openAvatarPicker() {
  const overlay = document.getElementById("avatarPickerOverlay");
  if (!overlay) return;
  renderPresetGrid();

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
  const overlay = document.getElementById("avatarPickerOverlay");
  const closeBtn = document.getElementById("avatarPickerCloseBtn");
  const fileInput = document.getElementById("avatarFileInput");
  const uploadBtn = document.getElementById("avatarUploadBtn");
  const dropzone = document.getElementById("avatarDropzone");
  const cameraStartBtn = document.getElementById("avatarCameraStartBtn");
  const cameraCaptureBtn = document.getElementById("avatarCameraCaptureBtn");
  const removeBtn = document.getElementById("avatarRemoveBtn");

  if (!overlay) return; // Guard: only wire up on pages that have the picker

  editBtn && editBtn.addEventListener("click", openAvatarPicker);
  closeBtn && closeBtn.addEventListener("click", closeAvatarPicker);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeAvatarPicker();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay.classList.contains("open")) closeAvatarPicker();
  });

  uploadBtn && uploadBtn.addEventListener("click", () => fileInput && fileInput.click());
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

      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (!file) return;
      await processAndApplyFile(file);
    });
  }

  cameraStartBtn && cameraStartBtn.addEventListener("click", startCamera);
  cameraCaptureBtn && cameraCaptureBtn.addEventListener("click", captureFromCamera);

  removeBtn &&
    removeBtn.addEventListener("click", () => {
      avatarEngine.removeAvatar();
      window.dispatchEvent(new CustomEvent("avatarUpdated"));
      showNotification("تمت إزالة الصورة الشخصية", "", "success");
      closeAvatarPicker();
      // Clear the server-side copy too, so a removed avatar doesn't keep
      // showing up in visitor view after it's gone from the owner's own UI.
      syncAvatarToServer(null);
    });
}