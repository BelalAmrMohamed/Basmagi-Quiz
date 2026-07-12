// ============================================================================
// src/shared/console-core.js
// منصة إمتحانات بصمجي — Console Runtime
// ============================================================================

/*!
 *  This is the SHARED core loaded on every page. It provides:
 *    - theming / ascii-safe styled logging helpers
 *    - a boot sequence animator (used by every page's banner)
 *    - a global command registry -> window.basmagy
 *    - a couple of hidden, undocumented surprises
 *
 *  Each page (index.js, dashboard.js, creat-quiz.js, settings.js, sign-in.js)
 *  loads this core FIRST, then registers its own page-specific commands and
 *  fires its own boot banner. See `index.js` for an example.
 * ============================================================================
 */

(function initBasmagyConsoleCore(global) {
  'use strict';

  // Avoid double-init if the core script is accidentally injected twice
  if (global.__BASMAGY_CONSOLE_CORE__) return;
  global.__BASMAGY_CONSOLE_CORE__ = true;

  // --------------------------------------------------------------------------
  // 1. THEME
  // --------------------------------------------------------------------------
  const THEME = {
    green: 'rgb(87, 255, 141)',
    greenDim: 'rgba(87, 255, 141, 0.55)',
    greenFaint: 'rgba(87, 255, 141, 0.18)',
    neonGreen: 'rgb(87, 255, 141)',
    amber: 'rgb(255, 184, 92)',
    red: 'rgb(255, 92, 92)',
    blue: 'rgb(92, 176, 255)',
    magenta: 'rgb(214, 92, 255)',
    ink: '#0a0a0a',
    panel: '#111214',
    grey: '#a3a3a3',
    greyDim: '#6b6b6b',
    white: '#f3f3f3',
  };

  const mono = 'font-family: "Fira Code", "Cascadia Code", Consolas, monospace;';

  const styles = {
    banner: `color:${THEME.green}; font-size:26px; font-weight:bold; ${mono}
      text-shadow: 0 0 8px ${THEME.green}, 0 0 18px ${THEME.greenDim};
      background:${THEME.ink}; padding:14px 18px; border-radius:6px;
      border:1px solid ${THEME.greenFaint};`,
    title: `color:${THEME.green}; font-size:22px; font-weight:bold; ${mono}
      text-shadow:0 0 10px ${THEME.green}; background:${THEME.ink};
      padding:10px 16px; border-radius:6px; border:1px solid ${THEME.greenFaint};`,
    subtitle: `color:${THEME.grey}; font-size:13px; ${mono}
      background:${THEME.panel}; padding:4px 10px; border-left:3px solid ${THEME.green};`,
    status: `color:${THEME.green}; font-size:12px; ${mono} font-style:italic;`,
    warn: `color:${THEME.amber}; font-size:12px; ${mono}`,
    error: `color:${THEME.red}; font-size:12px; ${mono} font-weight:bold;`,
    info: `color:${THEME.blue}; font-size:12px; ${mono}`,
    dim: `color:${THEME.greyDim}; font-size:11px; ${mono}`,
    kv: `color:${THEME.white}; font-size:12px; ${mono}`,
    kvKey: `color:${THEME.green}; font-size:12px; ${mono} font-weight:bold;`,
    tag: (c) => `color:${c}; background:${THEME.ink}; ${mono} font-size:11px;
      padding:2px 6px; border-radius:3px; border:1px solid ${c};`,
    cmd: `color:${THEME.magenta}; ${mono} font-size:12px; font-weight:bold;`,
    rule: `color:${THEME.greenFaint}; ${mono} font-size:10px;`,
  };

  function rule(char, len) {
    return (char || '─').repeat(len || 62);
  }

  // --------------------------------------------------------------------------
  // 2. LOW-LEVEL LOG HELPERS
  // --------------------------------------------------------------------------
  const log = {
    banner: (txt) => console.log(`%c${txt}`, styles.banner),
    title: (txt) => console.log(`%c${txt}`, styles.title),
    sub: (txt) => console.log(`%c${txt}`, styles.subtitle),
    status: (txt) => console.log(`%c${txt}`, styles.status),
    warn: (txt) => console.log(`%c${txt}`, styles.warn),
    error: (txt) => console.log(`%c${txt}`, styles.error),
    info: (txt) => console.log(`%c${txt}`, styles.info),
    dim: (txt) => console.log(`%c${txt}`, styles.dim),
    rule: (char, len) => console.log(`%c${rule(char, len)}`, styles.rule),
    kv: (key, value) => console.log(`%c${key}%c ${value}`, styles.kvKey, styles.kv),
    raw: (txt, style) => console.log(`%c${txt}`, style),
  };

const LOGO = "منصة إمتحانات بصمجي";

  const LOGO_Style = `
    display: inline-block;
    color: ${THEME.white};
    font-size: 32px;
    font-weight: 900;
    font-family: "Cairo", "Tajawal", "Segoe UI", "Fira Code", monospace;
    text-shadow: 
        0px 2px 4px rgba(0,0,0,0.9),
        0px 0px 8px ${THEME.neonGreen}, 
        0px 0px 16px ${THEME.neonGreen},
        0px 0px 30px ${THEME.neonGreen};
    background-color: #050505;
    background-image: repeating-linear-gradient(
        0deg,
        transparent,
        transparent 2px,
        rgba(255, 255, 255, 0.04) 2px,
        rgba(255, 255, 255, 0.04) 4px
    );
    padding: 15px 30px;
    border-right: 6px solid ${THEME.neonGreen};
    border-left: 2px solid ${THEME.neonGreen};
    border-radius: 6px;
    box-shadow: 0px 4px 15px rgba(0, 0, 0, 0.5);
    line-height: 1.6;
    margin: 10px 0;
  `;

  function printLogo() {
    console.log(`%c${LOGO}`, LOGO_Style);
  }

  // --------------------------------------------------------------------------
  // 3. BOOT SEQUENCE ENGINE
  //    A tiny "typewriter/async log" runner so every page can define a list
  //    of boot lines with delays, without re-writing timing logic each time.
  // --------------------------------------------------------------------------
  function runBootSequence(steps, onDone) {
    let i = 0;
    function next() {
      if (i >= steps.length) {
        if (typeof onDone === 'function') onDone();
        return;
      }
      const step = steps[i++];
      try {
        step.fn();
      } catch (e) {
        /* never let a boot-log cosmetic error break the host page */
      }
      setTimeout(next, step.delay || 90);
    }
    next();
  }

  // --------------------------------------------------------------------------
  // 4. GLOBAL COMMAND REGISTRY  ->  window.basmagy
  //    Pages register commands via basmagy.__registerCommands(pageId, {..}).
  //    window.basmagy.help() prints a nicely formatted, categorized command
  //    list built from whatever the current page registered + shared core
  //    commands (about, theme, easter eggs listing, etc).
  // --------------------------------------------------------------------------
  const registry = {
    pageId: null,
    pageLabel: null,
    commands: {}, // name -> { fn, desc, hidden }
  };

  function registerCommand(name, fn, desc, hidden) {
    registry.commands[name] = { fn, desc: desc || '', hidden: !!hidden };
    global.basmagy[name] = fn;
  }

  // This should dynamically pull the version from the service-worker, or from the package.json if possible.
  const BUILD_TAG = 'core@6.0.11';

  function printHelp() {
    log.rule('═', 64);
    log.title(' 📖  Console Command Reference');
    log.sub(`  current page: ${registry.pageLabel || 'unknown'}`);
    log.rule('═', 64);

    const visible = Object.entries(registry.commands).filter(([, c]) => !c.hidden);
    visible.forEach(([name, c]) => {
      console.log(`%cbasmagy.${name}()%c  →  ${c.desc}`, styles.cmd, styles.kv);
    });

    log.rule('─', 64);
    log.dim('  💡 tip: some commands only exist on certain pages.');
    log.dim('  💡 tip: not everything is listed here... keep exploring 👀');
    log.rule('═', 64);
  }

  function printAbout() {
    log.rule('═', 64);
    printLogo();
    log.sub('  منصة إمتحانات بصمجي');
    log.kv('  build:', BUILD_TAG);
    log.kv('  engine:', 'basmagy-console-core.js (shared console runtime)');
    log.kv('  page:', registry.pageLabel || 'unknown');
    log.dim('  يا فاتح الكونسول وسايب المنهج يضيع.. الكود ده مكتوب بحب وإحساس بديع');
    log.rule('═', 64);
  }

  // --------------------------------------------------------------------------
  // 5. HIDDEN EASTER EGGS (not printed in help — must be discovered)
  // --------------------------------------------------------------------------

  function __devSignature() {
    console.table([
      { role: 'Frontend', note: 'إذا وصلت هنا، يبقى أنت فضولي فعلاً 👀' },
      { role: 'Status', note: 'no bugs were harmed in the making of this easter egg' },
    ]);
  }
  Object.defineProperty(global, '__basmagy_dev', {
    value: __devSignature,
    enumerable: false, // hidden from for-in / autocomplete-ish enumeration
    configurable: false,
  });

  // --------------------------------------------------------------------------
  // 6. PUBLIC API
  // --------------------------------------------------------------------------
  global.basmagy = global.basmagy || {};
  global.basmagy.help = printHelp;
  global.basmagy.about = printAbout;

  global.__basmagyCore = {
    THEME,
    styles,
    mono,
    log,
    rule,
    printLogo,
    runBootSequence,
    registerCommand,
    registry,
  };

})(window);