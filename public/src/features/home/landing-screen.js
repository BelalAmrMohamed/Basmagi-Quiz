// ============================================================================
// public/src/features/home/landing-screen.js
// LANDING SCREEN — first-visit welcome page: full-viewport, minimal/bold,
// with an ambient particle canvas behind a single headline + two actions.
// Shown only once (gated by localStorage flag "first_visit_complete"). On
// dismiss it calls finalizeAppRender() so the rest of the app starts up
// exactly as it would on a returning-visitor load.
// ============================================================================
//
// DESIGN NOTE (full-screen, not a modal): this used to be a centered
// glassmorphism card floating over a dimmed/blurred backdrop — modal chrome
// that made sense for an overlay sitting on top of other content, but there
// is no "other content" here: this is the very first thing a first-time
// visitor sees, rendered into an empty #app container before the rest of
// the app has mounted (see renderLandingScreen()'s caller in navigation.js).
// So it's now a true full-viewport page: fills 100vw/100vh, no rounded
// corners, no dimmed backdrop, no card shadow — just one continuous surface.
// Content is intentionally minimal: one headline, one line of support copy,
// one hero visual, two actions. The old feature-pill row and card-within-
// card framing are gone; anything worth telling a first-time visitor now
// lives in the headline or gets discovered inside the app itself.
// ============================================================================

import { container } from "./dom-refs.js";

// finalizeAppRender is imported from navigation.js (circular-safe: navigation
// imports landing-screen which imports navigation — ES modules handle
// live-binding cycles correctly, so the call inside the setTimeout/onclick
// below always resolves to the real function by the time it fires).
// We use a deferred dynamic import here to avoid a hard static-import cycle
// that would prevent either module from resolving.  The delay is zero so it
// fires in the microtask queue immediately after the overlay fade-out.
async function callFinalizeAppRender() {
  const { finalizeAppRender } = await import("./navigation.js");
  finalizeAppRender();
}

/**
 * Build and display the first-visit landing page.
 * Called by initApp() when "first_visit_complete" is absent from localStorage.
 */
export function renderLandingScreen() {
  if (!container) return;
  container.setAttribute("aria-busy", "false");
  container.innerHTML = "";

  // ── Inject scoped styles + keyframes ────────────────────────────────────
  const styleId = "landing-screen-styles";
  if (!document.getElementById(styleId)) {
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      /* ── Full-viewport page (not a modal — see header note) ─────────────── */
      .landing-page {
        position: fixed;
        inset: 0;
        z-index: var(--z-overlay, 4000);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        background: var(--color-background, #fafbfc);
        animation: landingFadeIn 0.4s ease both;
      }

      /* Soft directional wash so the page doesn't feel flat — sits behind
         the particle canvas, in front of the plain background color. */
      .landing-page::before {
        content: "";
        position: absolute;
        inset: 0;
        z-index: 0;
        background:
          radial-gradient(ellipse 900px 600px at 50% -10%, rgba(99,102,241,0.16) 0%, transparent 60%),
          radial-gradient(ellipse 700px 500px at 100% 100%, rgba(139,92,246,0.10) 0%, transparent 55%),
          radial-gradient(ellipse 700px 500px at 0% 100%, rgba(236,72,153,0.08) 0%, transparent 55%);
        pointer-events: none;
      }

      /* ── Particle canvas — full-bleed ambient motion ─────────────────────── */
      .landing-particles {
        position: absolute;
        inset: 0;
        z-index: 0;
        pointer-events: none;
      }

      /* ── Content column ───────────────────────────────────────────────── */
      .landing-content {
        position: relative;
        z-index: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        direction: rtl;
        width: 100%;
        max-width: 640px;
        padding: 0 24px;
      }

      /* ── Hero mark: bold graduation-cap glyph, not a small emoji ─────── */
      .landing-hero-mark {
        position: relative;
        width: 96px;
        height: 96px;
        margin-bottom: 32px;
        border-radius: var(--radius-2xl, 24px);
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--gradient-accent);
        box-shadow:
          0 20px 50px -12px rgba(99,102,241,0.45),
          inset 0 1px 0 rgba(255,255,255,0.25);
        animation: landingMarkPop 0.7s 0.1s var(--ease-spring, cubic-bezier(0.34,1.56,0.64,1)) both;
      }
      .landing-hero-mark svg {
        width: 48px;
        height: 48px;
        stroke: #fff;
        fill: none;
        stroke-width: 1.8;
      }

      /* ── Headline: the one bold visual element ───────────────────────────── */
      .landing-headline {
        position: relative;
        z-index: 1;
        font-family: "Tajawal", "IBM Plex Sans Arabic", sans-serif;
        font-size: clamp(2rem, 7vw, 3.5rem);
        font-weight: 900;
        line-height: 1.15;
        letter-spacing: -0.02em;
        margin: 0 0 16px;
        color: var(--color-text-primary);
        animation: landingSlideUp 0.5s 0.25s ease both;
      }
      .landing-headline .accent {
        background: var(--gradient-accent);
        -webkit-background-clip: text;
        background-clip: text;
        -webkit-text-fill-color: transparent;
      }

      /* ── Support line: one sentence, done ─────────────────────────────── */
      .landing-support {
        position: relative;
        z-index: 1;
        font-size: var(--font-size-lg, 1.125rem);
        font-weight: 500;
        color: var(--color-text-secondary);
        line-height: 1.6;
        margin: 0 0 44px;
        max-width: 460px;
        animation: landingSlideUp 0.5s 0.35s ease both;
      }

      /* ── Actions ───────────────────────────────────────────────────────── */
      .landing-actions {
        position: relative;
        z-index: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 14px;
        width: 100%;
        max-width: 380px;
        animation: landingSlideUp 0.5s 0.45s ease both;
      }

      .landing-btn-primary {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        width: 100%;
        padding: 17px 28px;
        border: none;
        border-radius: var(--radius-lg, 12px);
        font-family: inherit;
        font-size: 1.05rem;
        font-weight: 800;
        color: #fff;
        cursor: pointer;
        background: var(--gradient-accent);
        box-shadow:
          0 10px 30px -6px rgba(99,102,241,0.5),
          inset 0 1px 0 rgba(255,255,255,0.2);
        transition: transform 0.25s var(--ease-spring, cubic-bezier(0.34,1.56,0.64,1)),
                    box-shadow 0.25s ease;
        overflow: hidden;
      }
      .landing-btn-primary:hover {
        transform: translateY(-2px) scale(1.015);
        box-shadow:
          0 14px 36px -6px rgba(99,102,241,0.6),
          inset 0 1px 0 rgba(255,255,255,0.25);
      }
      .landing-btn-primary:active {
        transform: translateY(0) scale(0.98);
      }
      .landing-btn-primary::after {
        content: "";
        position: absolute;
        top: 0;
        left: -100%;
        width: 60%;
        height: 100%;
        background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.25) 50%, transparent 100%);
        animation: landingBtnShimmer 3.2s 1s ease-in-out infinite;
        pointer-events: none;
      }

      .landing-btn-secondary {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 10px 20px;
        border: none;
        background: transparent;
        font-family: inherit;
        font-size: 0.9rem;
        font-weight: 600;
        color: var(--color-text-tertiary);
        cursor: pointer;
        transition: color 0.2s ease;
      }
      .landing-btn-secondary:hover {
        color: var(--color-text-secondary);
      }

      /* ── Keyframes ─────────────────────────────────────────────────────── */
      @keyframes landingFadeIn {
        from { opacity: 0; }
        to   { opacity: 1; }
      }
      @keyframes landingMarkPop {
        from { opacity: 0; transform: scale(0.7) rotate(-8deg); }
        to   { opacity: 1; transform: scale(1) rotate(0deg); }
      }
      @keyframes landingSlideUp {
        from { opacity: 0; transform: translateY(16px); }
        to   { opacity: 1; transform: translateY(0); }
      }
      @keyframes landingBtnShimmer {
        0%   { left: -100%; }
        40%  { left: 120%; }
        100% { left: -100%; }
      }

      /* ── Responsive ────────────────────────────────────────────────────── */
      @media (max-width: 520px) {
        .landing-hero-mark { width: 76px; height: 76px; margin-bottom: 24px; border-radius: var(--radius-xl, 16px); }
        .landing-hero-mark svg { width: 38px; height: 38px; }
        .landing-support { font-size: 0.95rem; margin-bottom: 36px; }
        .landing-btn-primary { font-size: 0.98rem; padding: 15px 22px; }
      }

      @media (max-height: 640px) {
        .landing-hero-mark { width: 64px; height: 64px; margin-bottom: 18px; }
        .landing-headline { font-size: clamp(1.6rem, 6vw, 2.4rem); margin-bottom: 10px; }
        .landing-support { margin-bottom: 26px; }
      }
    `;
    document.head.appendChild(style);
  }

  // ── Build page DOM ───────────────────────────────────────────────────────
  const page = document.createElement("div");
  page.className = "landing-page";
  page.id = "landingOverlay";
  page.setAttribute("role", "dialog");
  page.setAttribute("aria-modal", "true");
  page.setAttribute("aria-label", "شاشة الترحيب");

  // Particle canvas
  const particleCanvas = document.createElement("canvas");
  particleCanvas.className = "landing-particles";
  page.appendChild(particleCanvas);

  // Content column
  const content = document.createElement("div");
  content.className = "landing-content";

  // Hero mark — graduation-cap glyph in a bold gradient tile, replacing the
  // small bouncing emoji with something that reads clearly at a large size.
  const heroMark = document.createElement("div");
  heroMark.className = "landing-hero-mark";
  heroMark.setAttribute("aria-hidden", "true");
  heroMark.innerHTML = `
    <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round">
      <path d="M22 10 12 5 2 10l10 5 10-5Z" />
      <path d="M6 12v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5" />
      <path d="M22 10v6" />
    </svg>`;

  // Headline — one bold statement, split so the platform name reads as the
  // accent-colored focal point.
  const headline = document.createElement("h1");
  headline.className = "landing-headline";
  headline.innerHTML = `أهلاً بيك في <span class="accent">بصمجي</span>`;

  // Support line — single sentence, no feature-pill list.
  const support = document.createElement("p");
  support.className = "landing-support";
  support.textContent =
    "مكتبة امتحانات مجانية بالكامل لمواد كليتك — بدون تسجيل دخول، وبدون تعقيد.";

  // Actions
  const actions = document.createElement("div");
  actions.className = "landing-actions";

  const primaryBtn = document.createElement("button");
  primaryBtn.className = "landing-btn-primary";
  primaryBtn.id = "landingStartBtn";
  primaryBtn.innerHTML = `<span>🚀</span><span>ابدأ الآن</span>`;
  primaryBtn.onclick = () => {
    if (window.location.hash) {
      sessionStorage.setItem("intended_redirect_hash", window.location.hash);
    }
    window.location.href = "onboarding";
  };

  const secondaryBtn = document.createElement("button");
  secondaryBtn.className = "landing-btn-secondary";
  secondaryBtn.id = "landingSkipBtn";
  secondaryBtn.innerHTML = `<span>تخطي</span><span style="font-size:1.1em">←</span>`;
  secondaryBtn.onclick = () => {
    localStorage.setItem("first_visit_complete", "true");
    // Animate out
    page.style.transition = "opacity 0.35s ease";
    page.style.opacity = "0";
    setTimeout(() => {
      page.remove();
      callFinalizeAppRender();
    }, 350);
  };

  actions.appendChild(primaryBtn);
  actions.appendChild(secondaryBtn);

  content.appendChild(heroMark);
  content.appendChild(headline);
  content.appendChild(support);
  content.appendChild(actions);
  page.appendChild(content);
  document.body.appendChild(page);

  // ── Confetti / sparkle particle system ─────────────────────────────────
  requestAnimationFrame(() => {
    initLandingParticles(particleCanvas);
  });

  // Focus trap — focus the primary button
  primaryBtn.focus();
}

/**
 * Lightweight confetti-like particle system for the landing page.
 * Draws small shapes (circles, stars, diamonds) that float & drift. */
function initLandingParticles(canvas) {
  if (!canvas || !canvas.parentElement) return;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // Capture the resize handler in a variable so we can removeEventListener
  // with the exact same function reference later (the bug: the original code
  // never called removeEventListener at all).
  const resize = () => {
    canvas.width = canvas.parentElement.clientWidth;
    canvas.height = canvas.parentElement.clientHeight;
  };
  resize();
  window.addEventListener("resize", resize);

  // Full-viewport canvas now (previously scoped to behind a ~480px card) —
  // scale particle count with area so density looks the same as before
  // rather than looking sparse on a full screen or overwhelming on mobile.
  const area = canvas.width * canvas.height;
  const PARTICLE_COUNT = Math.round(Math.min(Math.max(area / 14000, 30), 90));
  const COLORS = [
    "rgba(99,102,241,0.55)", // indigo
    "rgba(139,92,246,0.50)", // violet
    "rgba(236,72,153,0.45)", // pink
    "rgba(16,185,129,0.45)", // emerald
    "rgba(245,158,11,0.40)", // amber
    "rgba(59,130,246,0.45)", // blue
  ];

  const particles = Array.from({ length: PARTICLE_COUNT }, () => ({
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height,
    vx: (Math.random() - 0.5) * 0.4,
    vy: (Math.random() - 0.5) * 0.3 - 0.15, // slight upward bias
    size: Math.random() * 4 + 2,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    opacity: Math.random() * 0.6 + 0.3,
    rotation: Math.random() * Math.PI * 2,
    rotationSpeed: (Math.random() - 0.5) * 0.02,
    shape: Math.floor(Math.random() * 3), // 0=circle, 1=diamond, 2=star
    pulseOffset: Math.random() * Math.PI * 2,
  }));

  let animFrame;
  const draw = () => {
    if (!canvas.parentElement) {
      cancelAnimationFrame(animFrame);
      return;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const t = Date.now() * 0.001;

    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.rotation += p.rotationSpeed;

      // Wrap around edges
      if (p.x < -10) p.x = canvas.width + 10;
      if (p.x > canvas.width + 10) p.x = -10;
      if (p.y < -10) p.y = canvas.height + 10;
      if (p.y > canvas.height + 10) p.y = -10;

      const pulse = 0.8 + Math.sin(t * 1.5 + p.pulseOffset) * 0.2;

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.globalAlpha = p.opacity * pulse;
      ctx.fillStyle = p.color;

      const s = p.size * pulse;

      if (p.shape === 0) {
        // Circle
        ctx.beginPath();
        ctx.arc(0, 0, s, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.shape === 1) {
        // Diamond
        ctx.beginPath();
        ctx.moveTo(0, -s);
        ctx.lineTo(s * 0.7, 0);
        ctx.lineTo(0, s);
        ctx.lineTo(-s * 0.7, 0);
        ctx.closePath();
        ctx.fill();
      } else {
        // 4-point star
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
          const r = i % 2 === 0 ? s : s * 0.4;
          const angle = (i * Math.PI) / 4;
          const method = i === 0 ? "moveTo" : "lineTo";
          ctx[method](Math.cos(angle) * r, Math.sin(angle) * r);
        }
        ctx.closePath();
        ctx.fill();
      }

      ctx.restore();
    }

    animFrame = requestAnimationFrame(draw);
  };

  draw();

  const observer = new MutationObserver(() => {
    if (!document.getElementById("landingOverlay")) {
      cancelAnimationFrame(animFrame);
      window.removeEventListener("resize", resize); // ← the missing fix
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true });
}