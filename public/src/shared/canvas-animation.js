// ═══════════════════════════════════════════════════════════════════════════════
// public/src/shared/canvas-animation.js
// Lightfall WebGL Background — Vanilla JS port of React Bits <Lightfall />
// GPU-accelerated GLSL shader • Zero external dependencies • Theme-aware
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Constants ───────────────────────────────────────────────────────────────
const MAX_COLORS = 8;
const DPR_CAP = 1.5;

// ─── Theme → Shader Preset Mapping ──────────────────────────────────────────
// Each preset maps the platform's CSS theme tokens into Lightfall shader uniforms.
// `alphaMode 1` = luminance-based alpha (streaks visible, dark areas transparent).
// `alphaMode 0` = constant alpha (standard opaque rendering).
const THEME_PRESETS = {
    dark: {
    colors: ["#3b82f6", "#8b5cf6", "#ec4899"],
    backgroundColor: "#121212",
    speed: 0.5,
    streakCount: 6,
    streakWidth: 1,
    streakLength: 1,
    glow: 1.0,
    density: 0.6,
    twinkle: 1,
    zoom: 1.8,
    backgroundGlow: 0.5,
    opacity: 1,
    alphaMode: 0.0,
    mouseStrength: 0.5,
    mouseRadius: 0.8,
    mouseDampening: 0.15,
  },
  light: {
    colors: ["#818cf8", "#a78bfa", "#f472b6"],
    backgroundColor: "#ffffff",
    speed: 0.3,
    streakCount: 5,
    streakWidth: 1.2,
    streakLength: 1,
    glow: 1.6,
    density: 0.6,
    twinkle: 0.6,
    zoom: 3,
    backgroundGlow: 0.02,
    opacity: 0.85,
    alphaMode: 1.0,
    mouseStrength: 0.4,
    mouseRadius: 0.8,
    mouseDampening: 0.15,
  },
  "dark-slate": {
    colors: ["#6366f1", "#8b5cf6", "#ec4899"],
    backgroundColor: "#0f172a",
    speed: 0.5,
    streakCount: 6,
    streakWidth: 1,
    streakLength: 1,
    glow: 1.0,
    density: 0.6,
    twinkle: 1,
    zoom: 2,
    backgroundGlow: 0.6,
    opacity: 1,
    alphaMode: 0.0,
    mouseStrength: 0.5,
    mouseRadius: 0.8,
    mouseDampening: 0.15,
  },
};

// ─── Color Utilities ─────────────────────────────────────────────────────────

const hexToRGB = (hex) => {
  const c = hex.replace("#", "").padEnd(6, "0");
  return [
    parseInt(c.slice(0, 2), 16) / 255,
    parseInt(c.slice(2, 4), 16) / 255,
    parseInt(c.slice(4, 6), 16) / 255,
  ];
};

/**
 * Prepare a color palette for the shader.
 * Pads to MAX_COLORS entries and computes the average for the mouse-glow tint.
 */
const prepColors = (input) => {
  const base = (
    input && input.length ? input : ["#A6C8FF", "#5227FF", "#FF9FFC"]
  ).slice(0, MAX_COLORS);

  const count = base.length;
  const arr = [];
  for (let i = 0; i < MAX_COLORS; i++) {
    arr.push(hexToRGB(base[Math.min(i, base.length - 1)]));
  }

  const avg = [0, 0, 0];
  for (let i = 0; i < count; i++) {
    avg[0] += arr[i][0];
    avg[1] += arr[i][1];
    avg[2] += arr[i][2];
  }
  avg[0] /= count;
  avg[1] /= count;
  avg[2] /= count;

  return { arr, count, avg };
};

// ─── GLSL Shader Sources ─────────────────────────────────────────────────────
// Copied verbatim from the React Bits Lightfall component (GLSL ES 1.0).
// Only addition: `uAlphaMode` uniform for luminance-based transparency on light themes.

const VERTEX_SOURCE = /* glsl */ `
attribute vec2 position;
attribute vec2 uv;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const FRAGMENT_SOURCE = /* glsl */ `
precision highp float;

uniform vec3  iResolution;
uniform vec2  iMouse;
uniform float iTime;

uniform vec3  uColor0;
uniform vec3  uColor1;
uniform vec3  uColor2;
uniform vec3  uColor3;
uniform vec3  uColor4;
uniform vec3  uColor5;
uniform vec3  uColor6;
uniform vec3  uColor7;
uniform int   uColorCount;

uniform vec3  uBgColor;
uniform vec3  uMouseColor;
uniform float uSpeed;
uniform int   uStreakCount;
uniform float uStreakWidth;
uniform float uStreakLength;
uniform float uGlow;
uniform float uDensity;
uniform float uTwinkle;
uniform float uZoom;
uniform float uBgGlow;
uniform float uOpacity;
uniform float uMouseEnabled;
uniform float uMouseStrength;
uniform float uMouseRadius;
uniform float uAlphaMode;

varying vec2 vUv;

vec3 palette(float h) {
  int count = uColorCount;
  if (count < 1) count = 1;
  int idx = int(floor(clamp(h, 0.0, 0.999999) * float(count)));
  if (idx <= 0) return uColor0;
  if (idx == 1) return uColor1;
  if (idx == 2) return uColor2;
  if (idx == 3) return uColor3;
  if (idx == 4) return uColor4;
  if (idx == 5) return uColor5;
  if (idx == 6) return uColor6;
  return uColor7;
}

vec3 tanhv(vec3 x) {
  vec3 e = exp(-2.0 * x);
  return (1.0 - e) / (1.0 + e);
}

vec2 sceneC(vec2 frag, vec2 r) {
  vec2 P = (frag + frag - r) / r.x;
  float z = 0.0;
  float d = 1e3;
  vec4 O = vec4(0.0);
  for (int k = 0; k < 39; k++) {
    if (d <= 1e-4) break;
    O = z * normalize(vec4(P, uZoom, 0.0)) - vec4(0.0, 4.0, 1.0, 0.0) / 4.5;
    d = 1.0 - sqrt(length(O * O));
    z += d;
  }
  return vec2(O.x, atan(O.z, O.y));
}

void mainImage(out vec4 o, vec2 C) {
  vec2 r = iResolution.xy;
  vec2 uv0 = (C + C - r) / r.x;
  float T = 0.1 * iTime * uSpeed + 9.0;
  float angRings = max(1.0, floor(6.28318530718 * max(uDensity, 0.05) + 0.5));
  vec2 Y = vec2(5e-3, 6.28318530718 / angRings);

  vec2 c0 = sceneC(C, r);
  vec2 cdx = sceneC(C + vec2(1.0, 0.0), r);
  vec2 cdy = sceneC(C + vec2(0.0, 1.0), r);
  vec2 dCx = cdx - c0;
  vec2 dCy = cdy - c0;
  dCx.y -= 6.28318530718 * floor(dCx.y / 6.28318530718 + 0.5);
  dCy.y -= 6.28318530718 * floor(dCy.y / 6.28318530718 + 0.5);
  vec2 fw = abs(dCx) + abs(dCy);
  C = c0;

  vec2 P = vec2(2.0, 1.0) * uv0 - (r / r.x) * vec2(0.0, 1.0);
  vec4 O = vec4(uBgColor * 90.0 * uBgGlow / (1e3 * dot(P, P) + 6.0), 0.0);

  float mGlow = 0.0;
  if (uMouseEnabled > 0.5) {
    vec2 mN = (iMouse + iMouse - r) / r.x;
    float md = length(uv0 - mN);
    mGlow = exp(-md * md / max(uMouseRadius * uMouseRadius, 1e-4)) * uMouseStrength;
    O.rgb += uMouseColor * mGlow * 0.25;
  }

  float zr = 5e-4 * uStreakWidth;
  vec2 rr = vec2(max(length(fw), 1e-5));
  float tail = 19.0 / max(uStreakLength, 0.05);

  for (int m = 0; m < 16; m++) {
    if (m >= uStreakCount) break;
    float jf = float(m) + 1.0;
    float ic = fract(sin(dot(vec2(jf, floor(C.x / Y.x + 0.5)), vec2(7.0, 11.0)) * 73.0));
    vec2 Pp = C - (T + T * ic) * vec2(0.0, 1.0);
    Pp -= floor(Pp / Y + 0.5) * Y;
    float h = fract(8663.0 * ic);
    vec3 col = palette(h);
    float weight = mix(1.5, 1.0 + sin(T + 7.0 * h + 4.0), uTwinkle);
    weight *= (1.0 + mGlow * 2.0);
    vec2 inner = vec2(length(max(Pp, vec2(-1.0, 0.0))), length(Pp) - zr) - zr;
    vec2 sm = vec2(1.0) - smoothstep(-rr, rr, inner);
    O.rgb += dot(sm, vec2(exp(tail * Pp.y), 3.0)) * col * weight;
    C.x += Y.x / 8.0;
  }

  vec3 colr = sqrt(tanhv(max(O.rgb * uGlow - vec3(0.04, 0.08, 0.02), 0.0)));

  // Alpha mode: 0 = constant (dark themes), 1 = luminance-based (light theme)
  float lum = dot(colr, vec3(0.299, 0.587, 0.114));
  float alpha = mix(uOpacity, min(lum * uOpacity * 2.5, 1.0), uAlphaMode);
  o = vec4(colr, alpha);
}

void main() {
  vec4 color;
  mainImage(color, vUv * iResolution.xy);
  gl_FragColor = color;
}
`;

// ─── WebGL Utilities ─────────────────────────────────────────────────────────

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error(
      "Lightfall: shader compile error:",
      gl.getShaderInfoLog(shader),
    );
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function linkProgram(gl, vsSource, fsSource) {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSource);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSource);
  if (!vs || !fs) return null;

  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);

  // Shaders can be freed after linking
  gl.detachShader(prog, vs);
  gl.detachShader(prog, fs);
  gl.deleteShader(vs);
  gl.deleteShader(fs);

  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error("Lightfall: program link error:", gl.getProgramInfoLog(prog));
    gl.deleteProgram(prog);
    return null;
  }
  return prog;
}

// ─── LightfallController ────────────────────────────────────────────────────
// Replaces CanvasAnimationController with a WebGL shader pipeline.
// Same public API: init(), start(), stop(), destroy(), updateTheme(), checkAnimationState()

export class CanvasAnimationController {
  constructor() {
    /** @type {HTMLDivElement|null} */
    this.container = null;
    /** @type {HTMLCanvasElement|null} */
    this.canvas = null;
    /** @type {WebGLRenderingContext|WebGL2RenderingContext|null} */
    this.gl = null;
    /** @type {WebGLProgram|null} */
    this.program = null;

    this.uniformLocs = {};
    this.positionBuffer = null;
    this.uvBuffer = null;
    this.positionAttrib = -1;
    this.uvAttrib = -1;

    this.rafId = null;
    this.isEnabled = true;
    this.currentTheme = "dark";
    this.dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);

    // Mouse tracking with exponential dampening
    this.mouseTarget = [0, 0];
    this.mouseCurrent = [0, 0];
    this.mouseDampening = 0.15;
    this.lastFrameTime = 0;

    // Bound loop callback (avoids creating closures every frame)
    this._boundLoop = (t) => this._loop(t);

    // Cleanup references
    this._boundOnResize = null;
    this._boundOnPointerMove = null;
    this._themeObserver = null;
    this._reducedMotionQuery = null;
    this._resizeTimer = null;
  }

  // ── Public API ────────────────────────────────────────────────────────────

  init() {
    // Build DOM: <div id="canvas-bg" class="lightfall-container"><canvas></canvas></div>
    this.container = document.createElement("div");
    this.container.id = "canvas-bg";
    this.container.className = "lightfall-container";
    this.container.style.cssText =
      "position:fixed;top:0;left:0;width:100%;height:100%;z-index:-1;pointer-events:none;";

    this.canvas = document.createElement("canvas");
    this.canvas.style.cssText = "width:100%;height:100%;display:block;";
    this.container.appendChild(this.canvas);

    document.body.insertBefore(this.container, document.body.firstChild);

    // Respect prefers-reduced-motion
    this._reducedMotionQuery = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    );
    if (this._reducedMotionQuery.matches) {
      this.isEnabled = false;
      this.container.style.display = "none";
    }
    this._reducedMotionQuery.addEventListener("change", (e) => {
      if (e.matches) {
        this.isEnabled = false;
        this.stop();
      } else {
        this.checkAnimationState();
      }
    });

    // Initialize WebGL pipeline
    if (!this._initWebGL()) {
      console.warn(
        "Lightfall: WebGL unavailable — falling back to static CSS background.",
      );
      this.container.style.display = "none";
      return;
    }

    // Handle WebGL context loss gracefully
    this.canvas.addEventListener(
      "webglcontextlost",
      (e) => {
        e.preventDefault();
        if (this.rafId) {
          cancelAnimationFrame(this.rafId);
          this.rafId = null;
        }
      },
      false,
    );

    // Detect theme and apply preset
    this.updateTheme();

    // Check animation toggle state
    this.checkAnimationState();

    // Wire event listeners
    this._setupListeners();

    // Initial sizing
    this._resize();

    // Start rendering if enabled
    if (this.isEnabled) {
      this.start();
    }
  }

  start() {
    if (this.isEnabled && !this.rafId && this.gl) {
      this.container.style.display = "";
      this.canvas.style.display = "block";
      this.lastFrameTime = 0;
      this.rafId = requestAnimationFrame(this._boundLoop);
    }
  }

  stop() {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.container) {
      // Paint the correct theme background on <body> BEFORE hiding the canvas
      // to prevent a flash of wrong color during the switchover.
      const theme =
        document.documentElement.getAttribute("data-theme") || "dark";
      const bgMap = {
        light: "#fafbfc",
        "dark-slate": "#0f172a",
        dark: "#121212",
      };
      // Temporarily suppress the CSS transition so the color applies instantly
      document.body.style.transition = "none";
      document.body.style.backgroundColor = bgMap[theme] || bgMap.dark;
      // Force a reflow so the browser paints the solid background NOW
      void document.body.offsetHeight;
      // Now it's safe to hide the canvas — no visible gap
      this.container.style.display = "none";
      // Restore the CSS transition for future theme switches
      requestAnimationFrame(() => {
        document.body.style.transition = "";
        document.body.style.backgroundColor = "";
      });
    }
  }

  destroy() {
    this.stop();

    // Remove listeners
    if (this._boundOnResize) {
      window.removeEventListener("resize", this._boundOnResize);
    }
    if (this._boundOnPointerMove) {
      window.removeEventListener("pointermove", this._boundOnPointerMove);
    }
    if (this._themeObserver) {
      this._themeObserver.disconnect();
      this._themeObserver = null;
    }
    if (this._resizeTimer) {
      clearTimeout(this._resizeTimer);
    }

    // Free WebGL resources
    const gl = this.gl;
    if (gl) {
      if (this.positionBuffer) gl.deleteBuffer(this.positionBuffer);
      if (this.uvBuffer) gl.deleteBuffer(this.uvBuffer);
      if (this.program) gl.deleteProgram(this.program);

      const ext = gl.getExtension("WEBGL_lose_context");
      if (ext) ext.loseContext();
    }

    // Remove from DOM
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }

    // Null everything
    this.container = null;
    this.canvas = null;
    this.gl = null;
    this.program = null;
    this.uniformLocs = {};
    this.positionBuffer = null;
    this.uvBuffer = null;
  }

  updateTheme() {
    const theme = document.documentElement.getAttribute("data-theme") || "dark";
    this.currentTheme = theme;
    const preset = THEME_PRESETS[theme] || THEME_PRESETS.dark;
    this._applyPreset(preset);
  }

  checkAnimationState() {
    const enabled =
      document.documentElement.getAttribute("data-animations") !== "disabled";
    const motionOK =
      !this._reducedMotionQuery || !this._reducedMotionQuery.matches;

    if (enabled && motionOK && !this.isEnabled) {
      this.isEnabled = true;
      this.start();
    } else if ((!enabled || !motionOK) && this.isEnabled) {
      this.isEnabled = false;
      this.stop();
    }
  }

  // ── Private — WebGL Bootstrap ─────────────────────────────────────────────

  _initWebGL() {
    const opts = {
      alpha: true,
      antialias: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: "low-power",
      depth: false,
      stencil: false,
    };

    this.gl =
      this.canvas.getContext("webgl2", opts) ||
      this.canvas.getContext("webgl", opts) ||
      this.canvas.getContext("experimental-webgl", opts);

    if (!this.gl) return false;
    const gl = this.gl;

    // Compile & link shaders
    this.program = linkProgram(gl, VERTEX_SOURCE, FRAGMENT_SOURCE);
    if (!this.program) return false;

    gl.useProgram(this.program);

    // Full-screen triangle geometry (more efficient than a quad)
    this.positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    );

    this.uvBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([0, 0, 2, 0, 0, 2]),
      gl.STATIC_DRAW,
    );

    // Attribute locations
    this.positionAttrib = gl.getAttribLocation(this.program, "position");
    this.uvAttrib = gl.getAttribLocation(this.program, "uv");

    // Cache all uniform locations
    const names = [
      "iResolution",
      "iMouse",
      "iTime",
      "uColor0",
      "uColor1",
      "uColor2",
      "uColor3",
      "uColor4",
      "uColor5",
      "uColor6",
      "uColor7",
      "uColorCount",
      "uBgColor",
      "uMouseColor",
      "uSpeed",
      "uStreakCount",
      "uStreakWidth",
      "uStreakLength",
      "uGlow",
      "uDensity",
      "uTwinkle",
      "uZoom",
      "uBgGlow",
      "uOpacity",
      "uMouseEnabled",
      "uMouseStrength",
      "uMouseRadius",
      "uAlphaMode",
    ];
    for (const n of names) {
      this.uniformLocs[n] = gl.getUniformLocation(this.program, n);
    }

    return true;
  }

  // ── Private — Uniform Management ──────────────────────────────────────────

  _applyPreset(preset) {
    this.mouseDampening = preset.mouseDampening || 0.15;

    const gl = this.gl;
    if (!gl || !this.program) return;
    gl.useProgram(this.program);

    // Streak colors
    const { arr, count, avg } = prepColors(preset.colors);
    for (let i = 0; i < MAX_COLORS; i++) {
      const loc = this.uniformLocs[`uColor${i}`];
      if (loc) gl.uniform3fv(loc, arr[i]);
    }
    gl.uniform1i(this.uniformLocs.uColorCount, count);
    gl.uniform3fv(this.uniformLocs.uMouseColor, avg);

    // Background
    gl.uniform3fv(this.uniformLocs.uBgColor, hexToRGB(preset.backgroundColor));

    // Effect parameters
    gl.uniform1f(this.uniformLocs.uSpeed, preset.speed);
    gl.uniform1i(
      this.uniformLocs.uStreakCount,
      Math.max(1, Math.min(16, Math.round(preset.streakCount))),
    );
    gl.uniform1f(this.uniformLocs.uStreakWidth, preset.streakWidth);
    gl.uniform1f(this.uniformLocs.uStreakLength, preset.streakLength);
    gl.uniform1f(this.uniformLocs.uGlow, preset.glow);
    gl.uniform1f(this.uniformLocs.uDensity, preset.density);
    gl.uniform1f(this.uniformLocs.uTwinkle, preset.twinkle);
    gl.uniform1f(this.uniformLocs.uZoom, preset.zoom);
    gl.uniform1f(this.uniformLocs.uBgGlow, preset.backgroundGlow);
    gl.uniform1f(this.uniformLocs.uOpacity, preset.opacity);
    gl.uniform1f(this.uniformLocs.uAlphaMode, preset.alphaMode);

    // Mouse (always enabled per user preference)
    gl.uniform1f(this.uniformLocs.uMouseEnabled, 1.0);
    gl.uniform1f(this.uniformLocs.uMouseStrength, preset.mouseStrength);
    gl.uniform1f(this.uniformLocs.uMouseRadius, preset.mouseRadius);
  }

  // ── Private — Event Listeners ─────────────────────────────────────────────

  _setupListeners() {
    // Debounced resize
    this._boundOnResize = () => {
      if (this._resizeTimer) clearTimeout(this._resizeTimer);
      this._resizeTimer = setTimeout(() => this._resize(), 80);
    };
    window.addEventListener("resize", this._boundOnResize);

    // Pointer tracking (on window — canvas has pointer-events: none)
    this._boundOnPointerMove = (e) => {
      const x = e.clientX * this.dpr;
      const y = (window.innerHeight - e.clientY) * this.dpr;
      this.mouseTarget[0] = x;
      this.mouseTarget[1] = y;
      if (this.mouseDampening <= 0) {
        this.mouseCurrent[0] = x;
        this.mouseCurrent[1] = y;
      }
    };
    window.addEventListener("pointermove", this._boundOnPointerMove);

    // Theme + animation toggle observer
    this._themeObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.attributeName === "data-theme") this.updateTheme();
        if (m.attributeName === "data-animations") this.checkAnimationState();
      }
    });
    this._themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "data-animations"],
    });
  }

  // ── Private — Resize ──────────────────────────────────────────────────────

  _resize() {
    if (!this.canvas || !this.gl) return;

    const w = window.innerWidth;
    const h = window.innerHeight;

    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);

    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);

    if (this.program) {
      this.gl.useProgram(this.program);
      this.gl.uniform3fv(this.uniformLocs.iResolution, [
        this.canvas.width,
        this.canvas.height,
        1,
      ]);
    }
  }

  // ── Private — Render Loop ─────────────────────────────────────────────────

  _loop(t) {
    if (!this.isEnabled || !this.gl || !this.program) {
      this.rafId = null;
      return;
    }
    this.rafId = requestAnimationFrame(this._boundLoop);

    const gl = this.gl;
    gl.useProgram(this.program);

    // Advance time
    gl.uniform1f(this.uniformLocs.iTime, t * 0.001);

    // Dampen mouse position
    if (this.mouseDampening > 0) {
      if (!this.lastFrameTime) this.lastFrameTime = t;
      const dt = (t - this.lastFrameTime) / 1000;
      this.lastFrameTime = t;

      const tau = Math.max(1e-4, this.mouseDampening);
      const factor = Math.min(1, 1 - Math.exp(-dt / tau));

      this.mouseCurrent[0] +=
        (this.mouseTarget[0] - this.mouseCurrent[0]) * factor;
      this.mouseCurrent[1] +=
        (this.mouseTarget[1] - this.mouseCurrent[1]) * factor;
    } else {
      this.mouseCurrent[0] = this.mouseTarget[0];
      this.mouseCurrent[1] = this.mouseTarget[1];
      this.lastFrameTime = t;
    }
    gl.uniform2fv(this.uniformLocs.iMouse, this.mouseCurrent);

    // Bind geometry
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.enableVertexAttribArray(this.positionAttrib);
    gl.vertexAttribPointer(this.positionAttrib, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuffer);
    gl.enableVertexAttribArray(this.uvAttrib);
    gl.vertexAttribPointer(this.uvAttrib, 2, gl.FLOAT, false, 0, 0);

    // Draw full-screen triangle
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Auto-initialization — mirrors the legacy module's bootstrap pattern so every
// page that loads <script type="module" src="canvas-animation.js"> just works.
// ═══════════════════════════════════════════════════════════════════════════════

let animationInstance = null;

function initCanvasAnimation() {
  const enabled =
    document.documentElement.getAttribute("data-animations") !== "disabled";

  if (enabled && !animationInstance) {
    animationInstance = new CanvasAnimationController();
    animationInstance.init();
  } else if (!enabled && animationInstance) {
    animationInstance.destroy();
    animationInstance = null;
  }
}

// Listen for runtime toggles of the data-animations attribute
function setupAnimationStateListener() {
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.attributeName === "data-animations") {
        initCanvasAnimation();
      }
    }
  });
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-animations"],
  });
}

// Boot
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    initCanvasAnimation();
    setupAnimationStateListener();
  });
} else {
  setTimeout(() => {
    initCanvasAnimation();
    setupAnimationStateListener();
  }, 0);
}

export { animationInstance, initCanvasAnimation };
