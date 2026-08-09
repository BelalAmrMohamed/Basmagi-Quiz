// public/src/features/profile/levelGauge.js
// Renders the level progress as a radial SVG gauge instead of a flat bar.
// Visual tier (color + label) is derived from gameEngine's existing
// LEVEL_CONFIG.getTitles() buckets, so this file owns zero level math —
// it only reads calculateLevel()'s output, which already resets
// pointsInCurrentLevel/progressPercent at each level-up boundary.
//
// Markup is generated once and then only *updated* (stroke-dashoffset,
// text, tier class) on subsequent renders, so the level-up pulse
// animation can restart cleanly via a class toggle without fighting
// an innerHTML rebuild every refreshUI() call.

const SIZE = 132;
const STROKE = 10;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

// Mirrors gameEngine's LEVEL_CONFIG.getTitles() thresholds. Kept in sync
// manually since gameEngine doesn't export tier boundaries, only the
// resolved title string — see renderLevelGauge's title-based fallback.
const TIER_BY_TITLE = {
  "Beginner": { key: "beginner", label: "مبتدئ", from: "#60a5fa", to: "#3b82f6" },
  "Intermediate": { key: "intermediate", label: "متوسط", from: "#34d399", to: "#059669" },
  "Advanced": { key: "advanced", label: "متقدّم", from: "#a78bfa", to: "#7c3aed" },
  "Expert": { key: "expert", label: "خبير", from: "#fb923c", to: "#ea580c" },
  "Master": { key: "master", label: "محترف", from: "#f472b6", to: "#db2777" },
  "Grandmaster": { key: "grandmaster", label: "أسطورة", from: "#fbbf24", to: "#b45309" },
};
const DEFAULT_TIER = { key: "beginner", label: "مبتدئ", from: "#60a5fa", to: "#3b82f6" };

function tierFor(title) {
  return TIER_BY_TITLE[title] || DEFAULT_TIER;
}

function buildGaugeSkeleton(container) {
  container.innerHTML = `
    <div class="level-gauge" role="img">
      <svg viewBox="0 0 ${SIZE} ${SIZE}" class="level-gauge-svg">
        <defs>
          <linearGradient id="levelGaugeGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop class="level-gauge-stop-start" offset="0%" />
            <stop class="level-gauge-stop-end" offset="100%" />
          </linearGradient>
        </defs>
        <circle
          class="level-gauge-track"
          cx="${SIZE / 2}" cy="${SIZE / 2}" r="${RADIUS}"
          fill="none" stroke-width="${STROKE}"
        />
        <circle
          class="level-gauge-fill"
          cx="${SIZE / 2}" cy="${SIZE / 2}" r="${RADIUS}"
          fill="none" stroke-width="${STROKE}" stroke-linecap="round"
          stroke="url(#levelGaugeGradient)"
          stroke-dasharray="${CIRCUMFERENCE}"
          stroke-dashoffset="${CIRCUMFERENCE}"
          transform="rotate(-90 ${SIZE / 2} ${SIZE / 2})"
        />
      </svg>
      <div class="level-gauge-center">
        <span class="level-gauge-number" id="levelGaugeNumber">1</span>
        <span class="level-gauge-tier" id="levelGaugeTier">مبتدئ</span>
      </div>
    </div>
    <div class="level-gauge-info">
      <div class="level-gauge-heading">
        <h3 id="levelGaugeTitle">المستوى 1</h3>
        <span class="level-gauge-pct" id="levelGaugePct">0%</span>
      </div>
      <p class="level-gauge-xp" id="levelGaugeXp">0 / 100 نقطة خبرة</p>
      <p class="level-gauge-remaining" id="levelGaugeRemaining">100 نقطة للمستوى التالي</p>
    </div>
  `;
}

// levelInfo: the object returned by gameEngine.calculateLevel(totalPoints)
export function renderLevelGauge(levelInfo) {
  const container = document.getElementById("identityLevel");
  if (!container) return;

  if (!container.querySelector(".level-gauge")) {
    buildGaugeSkeleton(container);
  }

  const level = levelInfo.level | 0;
  const pct = Math.min(100, Math.max(0, levelInfo.progressPercent || 0));
  const tier = tierFor(levelInfo.title);

  const fill = container.querySelector(".level-gauge-fill");
  const gauge = container.querySelector(".level-gauge");
  const startStop = container.querySelector(".level-gauge-stop-start");
  const endStop = container.querySelector(".level-gauge-stop-end");

  const previousLevel = Number(gauge.dataset.level || 0);
  gauge.dataset.level = String(level);
  gauge.dataset.tier = tier.key;

  if (startStop) startStop.style.stopColor = tier.from;
  if (endStop) endStop.style.stopColor = tier.to;

  const offset = CIRCUMFERENCE * (1 - pct / 100);
  // Force layout so the dashoffset transition always plays, even when
  // going from one full render to another with the same offset target.
  requestAnimationFrame(() => {
    fill.style.strokeDashoffset = String(offset);
  });

  // Level-up pulse: only when we can see this is an actual increase
  // (previousLevel > 0 guards the very first render from firing it).
  if (previousLevel > 0 && level > previousLevel) {
    gauge.classList.remove("level-gauge-leveled-up");
    // Reflow before re-adding so the animation restarts if triggered twice.
    void gauge.offsetWidth;
    gauge.classList.add("level-gauge-leveled-up");
  }

  const numberEl = document.getElementById("levelGaugeNumber");
  const tierEl = document.getElementById("levelGaugeTier");
  const titleEl = document.getElementById("levelGaugeTitle");
  const pctEl = document.getElementById("levelGaugePct");
  const xpEl = document.getElementById("levelGaugeXp");
  const remainingEl = document.getElementById("levelGaugeRemaining");

  if (numberEl) numberEl.textContent = level;
  if (tierEl) tierEl.textContent = tier.label;
  if (titleEl) titleEl.textContent = `المستوى ${level}`;
  if (pctEl) pctEl.textContent = `${Math.round(pct)}%`;
  if (xpEl) {
    xpEl.textContent = `${Math.round(levelInfo.pointsInCurrentLevel || 0).toLocaleString()} / ${Math.round(levelInfo.pointsNeededForNext || 0).toLocaleString()} نقطة خبرة`;
  }
  if (remainingEl) {
    const remaining = Math.max(0, Math.round((levelInfo.pointsNeededForNext || 0) - (levelInfo.pointsInCurrentLevel || 0)));
    remainingEl.textContent = level >= 30
      ? "بلغت أعلى مستوى، استمر للحفاظ على مكانتك!"
      : `${remaining.toLocaleString()} نقطة للمستوى التالي`;
  }

  container.setAttribute(
    "aria-label",
    `المستوى ${level}، ${tier.label}، ${Math.round(pct)}% نحو المستوى التالي`
  );
}