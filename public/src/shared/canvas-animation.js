// public/src/shared/canvas-animation.js - Modular Canvas Background Animation System
// Integrates with theme system and provides performance optimization

export class CanvasAnimationController {
  constructor() {
    this.canvas = null;
    this.ctx = null;
    this.particlesArray = [];
    this.animationId = null;
    this.w = 0;
    this.h = 0;
    this.isEnabled = true;
    this.currentTheme = "light";

    // Mouse interaction object
    this.mouse = {
      x: null,
      y: null,
      radius: 150, // Interaction radius
    };

    // Theme-specific colors - FIXED: Light theme now uses proper light background
    this.themeColors = {
      light: {
        background: "#fafbfc", // FIXED: Changed from '#050505' to match theme
        particles: "rgba(99, 102, 241, 0.6)",
        connections: "rgba(139, 92, 246, 0.4)",
      },
      "dark-slate": {
        background: "#0f172a",
        particles: "rgba(99, 102, 241, 0.8)",
        connections: "rgba(139, 92, 246, 0.5)",
      },
      dark: {
        background: "#121212",
        particles: "rgba(59, 130, 246, 0.8)",
        connections: "rgba(139, 92, 246, 0.5)",
      },
    };
  }

  init() {
    // Create canvas element
    this.canvas = document.createElement("canvas");
    this.canvas.id = "canvas-bg";
    this.canvas.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      z-index: -1;
      pointer-events: none;
    `;

    // Insert canvas as first child of body
    document.body.insertBefore(this.canvas, document.body.firstChild);

    this.ctx = this.canvas.getContext("2d", { alpha: false });

    // Set initial dimensions
    this.resize();

    // Setup event listeners
    this.setupEventListeners();

    // Detect current theme
    this.updateTheme();

    // Check if animations are enabled
    this.checkAnimationState();

    // Start animation if enabled
    if (this.isEnabled) {
      this.start();
    }
  }

  setupEventListeners() {
    // Track mouse position
    window.addEventListener("mousemove", (event) => {
      this.mouse.x = event.x;
      this.mouse.y = event.y;
    });

    // Remove mouse interaction when cursor leaves window
    window.addEventListener("mouseout", () => {
      this.mouse.x = null;
      this.mouse.y = null;
    });

    // Handle resize
    window.addEventListener("resize", () => {
      this.resize();
      this.initParticles();
    });

    // Listen for theme changes
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.attributeName === "data-theme") {
          this.updateTheme();
          // Redraw immediately with new theme colors
          if (this.isEnabled) {
            this.clearCanvas();
          }
        }
        if (mutation.attributeName === "data-animations") {
          this.checkAnimationState();
        }
      });
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "data-animations"],
    });
  }

  resize() {
    this.w = this.canvas.width = window.innerWidth;
    this.h = this.canvas.height = window.innerHeight;
  }

  updateTheme() {
    const theme =
      document.documentElement.getAttribute("data-theme") || "light";
    this.currentTheme = theme;
  }

  checkAnimationState() {
    const animationsEnabled =
      document.documentElement.getAttribute("data-animations") !== "disabled";

    if (animationsEnabled && !this.isEnabled) {
      this.isEnabled = true;
      this.start();
    } else if (!animationsEnabled && this.isEnabled) {
      this.isEnabled = false;
      this.stop();
    }
  }

  initParticles() {
    this.particlesArray = [];

    // Adjust particle count based on screen size for performance
    const numberOfParticles = Math.min((this.w * this.h) / 6000, 700);

    for (let i = 0; i < numberOfParticles; i++) {
      this.particlesArray.push(this.createParticle());
    }
  }

  createParticle() {
    return {
      x: Math.random() * this.w,
      y: Math.random() * this.h,
      directionX: Math.random() * 1 - 0.5,
      directionY: Math.random() * 1 - 0.5,
      size: Math.random() * 2 + 1,
    };
  }

  updateParticle(particle) {
    // Wall Bounce
    if (particle.x > this.w || particle.x < 0) {
      particle.directionX = -particle.directionX;
    }
    if (particle.y > this.h || particle.y < 0) {
      particle.directionY = -particle.directionY;
    }

    // Mouse Collision / Repulsion
    if (this.mouse.x !== null && this.mouse.y !== null) {
      const dx = this.mouse.x - particle.x;
      const dy = this.mouse.y - particle.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < this.mouse.radius) {
        if (this.mouse.x < particle.x && particle.x < this.w - 10) {
          particle.x += 3;
        }
        if (this.mouse.x > particle.x && particle.x > 10) {
          particle.x -= 3;
        }
        if (this.mouse.y < particle.y && particle.y < this.h - 10) {
          particle.y += 3;
        }
        if (this.mouse.y > particle.y && particle.y > 10) {
          particle.y -= 3;
        }
      }
    }

    // Move particle
    particle.x += particle.directionX;
    particle.y += particle.directionY;
  }

  drawParticle(particle) {
    const colors = this.themeColors[this.currentTheme];

    this.ctx.beginPath();
    this.ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2, false);
    this.ctx.fillStyle = colors.particles;
    this.ctx.fill();
  }

  connectParticles() {
    const colors = this.themeColors[this.currentTheme];
    const maxDistance = (this.w / 7) * (this.h / 7);

    for (let a = 0; a < this.particlesArray.length; a++) {
      for (let b = a + 1; b < this.particlesArray.length; b++) {
        const particleA = this.particlesArray[a];
        const particleB = this.particlesArray[b];

        const distanceSquared =
          (particleA.x - particleB.x) * (particleA.x - particleB.x) +
          (particleA.y - particleB.y) * (particleA.y - particleB.y);

        if (distanceSquared < maxDistance) {
          const opacity = 1 - distanceSquared / 20000;
          this.ctx.strokeStyle = colors.connections
            .replace("0.5)", `${opacity})`)
            .replace("0.4)", `${opacity})`);
          this.ctx.lineWidth = 1;
          this.ctx.beginPath();
          this.ctx.moveTo(particleA.x, particleA.y);
          this.ctx.lineTo(particleB.x, particleB.y);
          this.ctx.stroke();
        }
      }
    }
  }

  clearCanvas() {
    const colors = this.themeColors[this.currentTheme];
    this.ctx.fillStyle = colors.background;
    this.ctx.fillRect(0, 0, this.w, this.h);
  }

  animate() {
    if (!this.isEnabled) return;

    // Clear with theme background
    this.clearCanvas();

    // Update and draw particles
    for (let i = 0; i < this.particlesArray.length; i++) {
      this.updateParticle(this.particlesArray[i]);
      this.drawParticle(this.particlesArray[i]);
    }

    // Draw connections
    this.connectParticles();

    this.animationId = requestAnimationFrame(() => this.animate());
  }

  start() {
    if (this.isEnabled && !this.animationId) {
      this.initParticles();
      this.animate();
    }
  }

  stop() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }

    // FIXED: Clear canvas and hide it to restore body background
    if (this.canvas) {
      this.canvas.style.display = "none";
    }
  }

  destroy() {
    this.stop();

    if (this.canvas && this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
    }

    this.canvas = null;
    this.ctx = null;
    this.particlesArray = [];
  }
}

// Auto-initialize when DOM is ready
let animationInstance = null;

function initCanvasAnimation() {
  // Only initialize if animations are enabled
  const animationsEnabled =
    document.documentElement.getAttribute("data-animations") !== "disabled";

  if (animationsEnabled && !animationInstance) {
    animationInstance = new CanvasAnimationController();
    animationInstance.init();
  } else if (!animationsEnabled && animationInstance) {
    animationInstance.destroy();
    animationInstance = null;
  }
}

// FIXED: Listen for animation state changes to handle runtime toggles
function setupAnimationStateListener() {
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.attributeName === "data-animations") {
        // Re-run initialization when animation state changes
        initCanvasAnimation();
      }
    });
  });

  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-animations"],
  });
}

// FIXED: Better initialization timing
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    initCanvasAnimation();
    setupAnimationStateListener();
  });
} else {
  // DOM already loaded, wait a bit for theme to be applied
  setTimeout(() => {
    initCanvasAnimation();
    setupAnimationStateListener();
  }, 0);
}

// Export for manual control if needed
export { animationInstance, initCanvasAnimation };
