// ============================================================================
// public/src/features/home/landing-screen.js
// LANDING SCREEN — first-visit welcome overlay with glassmorphism card +
// confetti particle canvas.  Shown only once (gated by localStorage flag
// "first_visit_complete").  On dismiss it calls finalizeAppRender() so the
// rest of the app starts up exactly as it would on a returning-visitor load.
// ============================================================================
// BUG FIX (resize listener leak): the original initLandingParticles() added
// window.addEventListener("resize", resize) but the cleanup path that
// cancelled the RAF loop (checking !canvas.parentElement) never called
// window.removeEventListener("resize", resize), so the listener leaked for
// the life of the page.  Fixed here: the resize function is captured in a
// variable and removeEventListener is called inside the same MutationObserver
// callback that cancels the RAF loop — both are now removed together.
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
 * Build and display the first-visit landing overlay.
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
      /* ── Full-viewport overlay ─────────────────────────────────────────── */
      .landing-overlay {
        position: fixed;
        inset: 0;
        z-index: var(--z-overlay, 4000);
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(0, 0, 0, 0.45);
        backdrop-filter: blur(6px);
        -webkit-backdrop-filter: blur(6px);
        animation: landingFadeIn 0.5s ease both;
        padding: 20px;
      }

      /* ── Particle canvas behind the card ───────────────────────────────── */
      .landing-particles {
        position: absolute;
        inset: 0;
        pointer-events: none;
        z-index: 0;
      }

      /* ── Glassmorphism card ────────────────────────────────────────────── */
      .landing-card {
        position: relative;
        z-index: 1;
        width: 100%;
        max-width: 480px;
        border-radius: var(--radius-2xl, 24px);
        padding: 44px 36px 36px;
        text-align: center;
        direction: rtl;

        background: var(--glass-bg-light, rgba(255,255,255,0.65));
        backdrop-filter: var(--glass-blur, blur(12px));
        -webkit-backdrop-filter: var(--glass-blur, blur(12px));
        border: 1px solid var(--glass-border, rgba(255,255,255,0.12));
        box-shadow:
          var(--shadow-xl),
          0 0 60px rgba(99,102,241,0.12),
          var(--glass-inset, inset 0 1px 0 rgba(255,255,255,0.1));

        animation: landingCardPop 0.6s 0.15s cubic-bezier(0.175,0.885,0.32,1.275) both;
        overflow: hidden;
      }

      /* Gradient border ring via pseudo-element */
      .landing-card::before {
        content: "";
        position: absolute;
        inset: 0;
        border-radius: inherit;
        padding: 2px;
        background: var(--gradient-accent);
        -webkit-mask:
          linear-gradient(#fff 0 0) content-box,
          linear-gradient(#fff 0 0);
        -webkit-mask-composite: xor;
        mask:
          linear-gradient(#fff 0 0) content-box,
          linear-gradient(#fff 0 0);
        mask-composite: exclude;
        pointer-events: none;
        z-index: 0;
      }

      /* Soft radial glow behind the emoji */
      .landing-card::after {
        content: "";
        position: absolute;
        top: -30px;
        left: 50%;
        transform: translateX(-50%);
        width: 220px;
        height: 140px;
        background: radial-gradient(ellipse at center, rgba(99,102,241,0.12) 0%, transparent 70%);
        pointer-events: none;
        z-index: 0;
      }

      /* ── Animated welcome emoji ────────────────────────────────────────── */
      .landing-emoji {
        position: relative;
        z-index: 1;
        font-size: 3.5rem;
        line-height: 1;
        margin-bottom: 8px;
        display: inline-block;
        animation: landingEmojiBounce 2s ease-in-out infinite;
        filter: drop-shadow(0 4px 12px rgba(99,102,241,0.25));
      }

      /* ── Title ─────────────────────────────────────────────────────────── */
      .landing-title {
        position: relative;
        z-index: 1;
        font-family: "Tajawal", "IBM Plex Sans Arabic", sans-serif;
        font-size: var(--font-size-2xl, 1.5rem);
        font-weight: 800;
        color: var(--color-text-primary);
        margin-bottom: 6px;
        letter-spacing: -0.02em;
        line-height: 1.3;
        animation: landingSlideUp 0.5s 0.3s ease both;
      }

      /* ── Subtitle ──────────────────────────────────────────────────────── */
      .landing-subtitle {
        position: relative;
        z-index: 1;
        font-size: var(--font-size-sm, 0.875rem);
        font-weight: 500;
        color: var(--color-text-secondary);
        margin-bottom: 28px;
        line-height: 1.6;
        animation: landingSlideUp 0.5s 0.4s ease both;
      }

      /* ── Feature pills row ─────────────────────────────────────────────── */
      .landing-features {
        position: relative;
        z-index: 1;
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 8px;
        margin-bottom: 28px;
        animation: landingSlideUp 0.5s 0.5s ease both;
      }
      .landing-feature-pill {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 5px 14px;
        border-radius: var(--radius-full, 9999px);
        font-size: 0.78rem;
        font-weight: 600;
        background: rgba(99,102,241,0.08);
        color: var(--color-accent, #6366f1);
        border: 1px solid rgba(99,102,241,0.15);
        white-space: nowrap;
      }

      /* ── Button area ───────────────────────────────────────────────────── */
      .landing-actions {
        position: relative;
        z-index: 1;
        display: flex;
        flex-direction: column;
        gap: 12px;
        animation: landingSlideUp 0.5s 0.55s ease both;
      }

      /* Primary CTA */
      .landing-btn-primary {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        padding: 15px 28px;
        border: none;
        border-radius: var(--radius-lg, 12px);
        font-family: inherit;
        font-size: 1rem;
        font-weight: 700;
        color: #fff;
        cursor: pointer;
        background: var(--gradient-accent);
        background-size: 200% 200%;
        box-shadow:
          0 4px 15px rgba(99,102,241,0.35),
          inset 0 1px 0 rgba(255,255,255,0.2);
        transition: transform 0.25s var(--ease-spring, cubic-bezier(0.34,1.56,0.64,1)),
                    box-shadow 0.25s ease;
        overflow: hidden;
      }
      .landing-btn-primary:hover {
        transform: translateY(-2px) scale(1.02);
        box-shadow:
          0 8px 25px rgba(99,102,241,0.45),
          inset 0 1px 0 rgba(255,255,255,0.25);
      }
      .landing-btn-primary:active {
        transform: translateY(0) scale(0.98);
      }

      /* Shimmer sweep on the primary button */
      .landing-btn-primary::after {
        content: "";
        position: absolute;
        top: 0;
        left: -100%;
        width: 60%;
        height: 100%;
        background: linear-gradient(
          90deg,
          transparent 0%,
          rgba(255,255,255,0.25) 50%,
          transparent 100%
        );
        animation: landingBtnShimmer 3s 1s ease-in-out infinite;
        pointer-events: none;
      }

      /* Secondary / Skip */
      .landing-btn-secondary {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 12px 28px;
        border: 1.5px solid var(--color-border, #e5e7eb);
        border-radius: var(--radius-lg, 12px);
        background: transparent;
        font-family: inherit;
        font-size: 0.9rem;
        font-weight: 600;
        color: var(--color-text-secondary);
        cursor: pointer;
        transition: all 0.25s ease;
      }
      .landing-btn-secondary:hover {
        border-color: var(--color-primary, #6366f1);
        color: var(--color-primary, #6366f1);
        background: var(--color-hover-overlay, rgba(99,102,241,0.06));
      }

      /* ── Keyframes ─────────────────────────────────────────────────────── */
      @keyframes landingFadeIn {
        from { opacity: 0; }
        to   { opacity: 1; }
      }
      @keyframes landingCardPop {
        from {
          opacity: 0;
          transform: translateY(30px) scale(0.92);
        }
        to {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
      }
      @keyframes landingSlideUp {
        from {
          opacity: 0;
          transform: translateY(16px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
      @keyframes landingEmojiBounce {
        0%, 100% { transform: translateY(0) rotate(0deg); }
        25%      { transform: translateY(-8px) rotate(-4deg); }
        50%      { transform: translateY(0) rotate(0deg); }
        75%      { transform: translateY(-4px) rotate(3deg); }
      }
      @keyframes landingBtnShimmer {
        0%   { left: -100%; }
        40%  { left: 120%; }
        100% { left: -100%; }
      }

      /* ── Responsive ────────────────────────────────────────────────────── */
      @media (max-width: 520px) {
        .landing-card {
          padding: 32px 22px 28px;
          max-width: 100%;
          border-radius: var(--radius-xl, 16px);
        }
        .landing-emoji { font-size: 2.8rem; }
        .landing-title { font-size: var(--font-size-xl, 1.25rem); }
        .landing-subtitle { font-size: 0.82rem; }
        .landing-btn-primary { font-size: 0.92rem; padding: 13px 20px; }
        .landing-btn-secondary { font-size: 0.82rem; padding: 10px 18px; }
        .landing-feature-pill { font-size: 0.72rem; padding: 4px 10px; }
      }
    `;
    document.head.appendChild(style);
  }

  // ── Build overlay DOM ──────────────────────────────────────────────────
  const overlay = document.createElement("div");
  overlay.className = "landing-overlay";
  overlay.id = "landingOverlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "شاشة الترحيب");

  // Particle canvas
  const particleCanvas = document.createElement("canvas");
  particleCanvas.className = "landing-particles";
  overlay.appendChild(particleCanvas);

  // Card
  const card = document.createElement("div");
  card.className = "landing-card";

  // Emoji
  const emoji = document.createElement("div");
  emoji.className = "landing-emoji";
  emoji.setAttribute("aria-hidden", "true");
  emoji.textContent = "🎓";

  // Title
  const titleEl = document.createElement("h2");
  titleEl.className = "landing-title";
  titleEl.textContent = "أهلاً بيك في منصة امتحانات بصمجي!";

  // Subtitle
  const subtitleEl = document.createElement("p");
  subtitleEl.className = "landing-subtitle";
  subtitleEl.textContent =
    "منصة مجانية بالكامل — إختبر نفسك في مواد الكلية وجهّز نفسك للامتحان.";

  // Feature pills
  const features = document.createElement("div");
  features.className = "landing-features";
  const featureItems = [
    { icon: "📚", text: "مكتبة امتحانات شاملة" },
    { icon: "⚡", text: "بدون تسجيل دخول" },
    { icon: "🏆", text: "تتبع تقدمك" },
  ];
  featureItems.forEach(({ icon, text }) => {
    const pill = document.createElement("span");
    pill.className = "landing-feature-pill";
    pill.textContent = `${icon} ${text}`;
    features.appendChild(pill);
  });

  // Buttons
  const actions = document.createElement("div");
  actions.className = "landing-actions";

  const primaryBtn = document.createElement("button");
  primaryBtn.className = "landing-btn-primary";
  primaryBtn.id = "landingStartBtn";
  primaryBtn.innerHTML = `<span>🚀</span><span>مستعد للبدأ؟ قم بإعداد حسابك بدون إيميل</span>`;
  primaryBtn.onclick = () => {
    if (window.location.hash) {
      sessionStorage.setItem("intended_redirect_hash", window.location.hash);
    }
    window.location.href = "onboarding.html";
  };

  const secondaryBtn = document.createElement("button");
  secondaryBtn.className = "landing-btn-secondary";
  secondaryBtn.id = "landingSkipBtn";
  secondaryBtn.innerHTML = `<span>تخطي</span><span style="font-size:1.1em">←</span>`;
  secondaryBtn.onclick = () => {
    localStorage.setItem("first_visit_complete", "true");
    // Animate out
    overlay.style.transition = "opacity 0.35s ease";
    overlay.style.opacity = "0";
    setTimeout(() => {
      overlay.remove();
      callFinalizeAppRender();
    }, 350);
  };

  actions.appendChild(primaryBtn);
  actions.appendChild(secondaryBtn);

  card.appendChild(emoji);
  card.appendChild(titleEl);
  card.appendChild(subtitleEl);
  card.appendChild(features);
  card.appendChild(actions);
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  // ── Confetti / sparkle particle system ─────────────────────────────────
  requestAnimationFrame(() => {
    initLandingParticles(particleCanvas);
  });

  // Focus trap — focus the primary button
  primaryBtn.focus();
}

/**
 * Lightweight confetti-like particle system for the landing overlay.
 * Draws small shapes (circles, stars, diamonds) that float & drift.
 *
 * BUG FIX: the resize handler is now stored in a local variable so that
 * removeEventListener can remove the *same* function reference that was
 * passed to addEventListener.  The MutationObserver cleanup path now calls
 * window.removeEventListener("resize", resize) alongside cancelAnimationFrame,
 * preventing a listener leak for the page's lifetime after the overlay is gone.
 */
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

  const PARTICLE_COUNT = 45;
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

  // BUG FIX: cleanup when overlay is removed from the DOM — cancel both the
  // RAF loop AND the resize listener (the original only cancelled the RAF loop,
  // leaving window.addEventListener("resize", resize) active forever).
  const observer = new MutationObserver(() => {
    if (!document.getElementById("landingOverlay")) {
      cancelAnimationFrame(animFrame);
      window.removeEventListener("resize", resize); // ← the missing fix
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true });
}
