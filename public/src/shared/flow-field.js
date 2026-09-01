// public/src/shared/flow-field.js
// Lightweight canvas flow-field background animation.

(function (global) {
  "use strict";

  const PARTICLE_COUNTS = {
    sparse: 600,
    medium: 1200,
    dense: 2000,
  };

  const THEMES = {
    dark: { hueStart: 220, hueRange: 120, saturation: 90, lightness: 62, bg: "18, 18, 18", trailAlpha: 0.06 },
    "dark-slate": { hueStart: 220, hueRange: 120, saturation: 90, lightness: 62, bg: "15, 23, 42", trailAlpha: 0.06 },
    light: { hueStart: 190, hueRange: 150, saturation: 82, lightness: 58, bg: "250, 251, 252", trailAlpha: 0.08 },
  };

  function fieldAngle(x, y, time) {
    const scale = 0.0025;
    return (
      Math.sin(x * scale + time * 0.0007) * Math.PI +
      Math.cos(y * scale + time * 0.0005) * Math.PI +
      Math.sin((x + y) * scale * 0.6 + time * 0.0009) * Math.PI * 0.6 +
      Math.cos((x - y) * scale * 0.4 + time * 0.0006) * Math.PI * 0.4
    );
  }

  let stylesInjected = false;
  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;
    const style = document.createElement("style");
    style.textContent = `
      .flow-field-root { position: fixed; inset: 0; z-index: -1; overflow: hidden; pointer-events: none; }
      .flow-field-canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
      .flow-field-vignette, .flow-field-fade-top, .flow-field-fade-bottom { position: absolute; inset-inline: 0; pointer-events: none; }
      .flow-field-vignette { inset: 0; }
      .flow-field-fade-top { top: 0; height: 10rem; }
      .flow-field-fade-bottom { top: auto; bottom: 0; height: 10rem; }
    `;
    document.head.appendChild(style);
  }

  function mount(container, options = {}) {
    if (!container) throw new Error("FlowField.mount: container element is required");
    injectStyles();

    let theme =
      options.theme ||
      document.documentElement.getAttribute("data-theme") ||
      "light";
    let density = options.density || (global.innerWidth <= 768 ? "sparse" : "medium");
    let config = THEMES[theme] || THEMES.light;
    let count = PARTICLE_COUNTS[density] || PARTICLE_COUNTS.medium;
    const root = document.createElement("div");
    root.className = "flow-field-root";
    const canvas = document.createElement("canvas");
    canvas.className = "flow-field-canvas";
    canvas.setAttribute("aria-hidden", "true");
    const vignette = document.createElement("div");
    vignette.className = "flow-field-vignette";
    const fadeTop = document.createElement("div");
    fadeTop.className = "flow-field-fade-top";
    const fadeBottom = document.createElement("div");
    fadeBottom.className = "flow-field-fade-bottom";
    root.append(canvas, vignette, fadeTop, fadeBottom);
    container.appendChild(root);

    const context = canvas.getContext("2d");
    const dpr = Math.min(global.devicePixelRatio || 1, 1.5);
    let width = 0;
    let height = 0;
    let time = 0;
    let frameId = 0;
    let particles = [];

    function applyBackground() {
      root.style.background = `rgb(${config.bg})`;
      vignette.style.background = `radial-gradient(ellipse 65% 60% at 50% 50%, transparent 20%, rgba(${config.bg}, 0.92) 100%)`;
      fadeTop.style.background = `linear-gradient(to bottom, rgb(${config.bg}), transparent)`;
      fadeBottom.style.background = `linear-gradient(to top, rgb(${config.bg}), transparent)`;
    }

    function spawnParticle() {
      const maxLife = 200 + Math.floor(Math.random() * 300);
      return { x: Math.random() * width, y: Math.random() * height, speed: 1.1 + Math.random() * 1.8, hue: config.hueStart + Math.random() * config.hueRange, life: Math.floor(Math.random() * maxLife), maxLife };
    }

    function resize() {
      width = global.innerWidth;
      height = global.innerHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.fillStyle = `rgb(${config.bg})`;
      context.fillRect(0, 0, width, height);
      particles = Array.from({ length: count }, spawnParticle);
    }

    function render() {
      time += 1;
      context.fillStyle = `rgba(${config.bg}, ${config.trailAlpha})`;
      context.fillRect(0, 0, width, height);
      particles.forEach((particle) => {
        const angle = fieldAngle(particle.x, particle.y, time);
        particle.x += Math.cos(angle) * particle.speed;
        particle.y += Math.sin(angle) * particle.speed;
        particle.life += 1;
        if (particle.life > particle.maxLife) Object.assign(particle, spawnParticle());
        if (particle.x < 0) particle.x += width;
        if (particle.x > width) particle.x -= width;
        if (particle.y < 0) particle.y += height;
        if (particle.y > height) particle.y -= height;
        const progress = particle.life / particle.maxLife;
        const alpha = Math.min(progress * 8, 1) * Math.min((1 - progress) * 6, 1) * 0.9;
        const hue = (particle.hue + (angle / (Math.PI * 2)) * 70 + 360) % 360;
        context.beginPath();
        context.arc(particle.x, particle.y, 1.3, 0, Math.PI * 2);
        context.fillStyle = `hsla(${hue}, ${config.saturation}%, ${config.lightness}%, ${alpha})`;
        context.fill();
      });
      frameId = global.requestAnimationFrame(render);
    }

    applyBackground();
    resize();
    global.addEventListener("resize", resize);
    render();

    return {
      destroy() { global.cancelAnimationFrame(frameId); global.removeEventListener("resize", resize); root.remove(); },
      setTheme(nextTheme) { if (THEMES[nextTheme]) { theme = nextTheme; config = THEMES[theme]; applyBackground(); } },
      setDensity(nextDensity) { if (PARTICLE_COUNTS[nextDensity]) { density = nextDensity; count = PARTICLE_COUNTS[density]; particles = Array.from({ length: count }, spawnParticle); } },
    };
  }

  global.FlowField = { mount, THEMES, PARTICLE_COUNTS };
})(typeof window !== "undefined" ? window : this);

let flowFieldInstance = null;
function initFlowField() {
  // Any stray leftover node from a previous mount/destroy cycle (e.g. this
  // ran once already this page load) must be cleared before re-mounting,
  // otherwise a second canvas gets appended alongside a still-referenced
  // stale one. `document.getElementById` also matters here because
  // `flowFieldInstance` is only an in-memory reference — the DOM node it
  // points at may already have been detached by something else.
  const enabled = document.documentElement.getAttribute("data-animations") !== "disabled";
  if (enabled && !flowFieldInstance) {
    document.getElementById("flow-field-bg")?.remove();
    const container = document.createElement("div");
    container.id = "flow-field-bg";
    document.body.insertBefore(container, document.body.firstChild);
    const currentTheme =
      document.documentElement.getAttribute("data-theme") || "light";
    flowFieldInstance = FlowField.mount(container, { theme: currentTheme });
  } else if (!enabled && flowFieldInstance) {
    flowFieldInstance.destroy();
    document.getElementById("flow-field-bg")?.remove();
    flowFieldInstance = null;
  }
}

// Reacting to [data-animations]/[data-theme] purely through a
// MutationObserver is asynchronous by spec (it batches into a microtask
// and can coalesce several rapid attribute writes — e.g. quickly toggling
// the switch off/on/off — into a single callback that only sees the FINAL
// value, silently swallowing intermediate transitions). That made rapid or
// repeated toggling appear to "do nothing" until a full reload re-ran the
// synchronous boot call below. Reacting to the toggle directly via a
// custom event (dispatched synchronously, same tick, right after the
// attribute is set) makes every single toggle apply immediately and
// deterministically; the MutationObserver stays only as a fallback for any
// other code path that flips the attribute without dispatching the event
// (e.g. a future integration, or manual devtools edits).
function reactToAnimationsChange() {
  if (flowFieldInstance && document.documentElement.getAttribute("data-theme")) {
    flowFieldInstance.setTheme(document.documentElement.getAttribute("data-theme"));
  }
  initFlowField();
}

function bootFlowField() {
  initFlowField();
  document.addEventListener("quiz:animations-changed", reactToAnimationsChange);
  new MutationObserver((mutations) => {
    if (mutations.some((mutation) => mutation.attributeName === "data-animations" || mutation.attributeName === "data-theme")) {
      reactToAnimationsChange();
    }
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-animations", "data-theme"] });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bootFlowField);
else bootFlowField();

export { initFlowField };