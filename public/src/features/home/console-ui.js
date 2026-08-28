// ============================================================================
// public/src/features/home/console-ui.js
// DEV CONSOLE UI — the branded, discoverable console-command experience for
// the home page (basmagi.help(), basmagi.perf(), etc). Purely a side-effecting
// module: importing it wires up window.__basmagiCore's registry and runs the
// boot animation. No exports — nothing else in the app depends on its internals.
// ============================================================================

import "../../shared/console-core.js";
import { userProfile } from "../../shared/userProfile.js";
import { getFromStorage } from "../../shared/storage-helpers.js";
import { isAdminAuthenticated, hasAdminSessionHint } from "../../shared/adminAuth.js";
import { getSubscribedCourses } from "../../shared/filterUtils.js";
import { getCategoryTree, getSearchManager } from "./app-state.js";
import { getCourseItemCount } from "./course-count.js";
/*
(function initIndexConsole(global) {
  'use strict';
  const core = global.__basmagiCore;
  if (!core) {
    console.log('%c[basmagi] core runtime missing — console UI skipped.', 'color:#ff5c5c;font-family:monospace;');
    return;
  }
 
  const { THEME, styles, log, rule, printLogo, runBootSequence, registerCommand, registry } = core;
 
  registry.pageId = 'index';
  registry.pageLabel = 'الصفحة الرئيسية';
 
  // --------------------------------------------------------------------------
  // MOCK / LIVE DATA HOOKS
  //   In production, swap these getters for real reads from your app state
  //   (e.g. a store, window.__APP_STATE__, or a small fetch). Kept sync +
  //   defensive so a missing global never throws inside a console.log call.
  // --------------------------------------------------------------------------
  function safe(fn, fallback) {
    try { return fn(); } catch (e) { return fallback; }
  }
 
  function getLoadStats() {
    const nav = safe(() => performance.getEntriesByType('navigation')[0], null);
    return {
      loadMs: nav ? Math.round(nav.duration) : safe(() => Math.round(performance.now()), 0),
      resources: safe(() => performance.getEntriesByType('resource').length, 0),
    };
  }
 
  // `categoryTree` (module-scope, populated async by initApp()) is a FLAT
  // map of key -> node; node.subcategories is an array of sibling keys, not
  // nested objects (see getCourseItemCount above). Counting entries + total
  // exam leaves this way stays accurate and never throws pre-manifest-load.
  function getCategoryTreeStats(tree) {
    if (!tree || typeof tree !== 'object') return { categories: 0, exams: 0 };
    const keys = Object.keys(tree);
    let exams = 0;
    for (const key of keys) {
      const node = tree[key];
      if (node && Array.isArray(node.exams)) exams += node.exams.length;
    }
    return { categories: keys.length, exams };
  }
 
  // --------------------------------------------------------------------------
  // BOOT SEQUENCE — the animated startup, next-level version of the original
  // console.clear() + 3 console.log() calls.
  // --------------------------------------------------------------------------
  function boot() {
    console.clear();
 
    const stats = getLoadStats();
 
    runBootSequence([
      { fn: () => printLogo(), delay: 120 },
      { fn: () => log.title('الصفحة الرئيسية'), delay: 140 },
      { fn: () => log.kv('  session:', safe(() => (global.__APP_STATE__.user ? 'authenticated' : 'guest (no sign-in required for students)'), 'guest (no sign-in required for students)')), delay: 140 },
      { fn: () => {
          log.raw('  ⚡ SYSTEM DIAGNOSTIC', styles.warn);
          log.kv('  page load:', `${stats.loadMs}ms`);
          log.kv('  resources fetched:', String(stats.resources));
          log.dim('  (psst — this is the perf issue we\'re hunting. ask a dev.)');
        }, delay: 140 },
      // { fn: () => log.rule('═', 64), delay: 60 },
      { fn: () => console.log('%cbasmagi.help()%c → show all available commands', styles.cmd, styles.kv), delay: 0 },
    ]);
  }
 
// --------------------------------------------------------------------------
// COMMANDS — visible, documented, discoverable via basmagi.help()
// --------------------------------------------------------------------------
 
  registerCommand('perf', () => {
    const stats = getLoadStats();
    log.rule('═', 60);
    log.title('⚡ Performance Snapshot');
    log.kv('  page load:', `${stats.loadMs}ms`);
    log.kv('  resources:', String(stats.resources));
    log.kv('  DOM nodes:', String(safe(() => document.getElementsByTagName('*').length, 0)));
    log.dim('  Run this after every deploy — we\'re actively chasing a perf bug.');
    log.rule('═', 60);
  }, 'print a live performance snapshot of this page');
 
  registerCommand('theme', () => {
    log.rule('═', 60);
    log.title('🎨 Console Theme');
    Object.entries(THEME).forEach(([name, value]) => {
      console.log(`%c ${name.padEnd(10)} ${value}`, `color:${typeof value === 'string' && value.startsWith('rgb') ? value : THEME.grey}; font-family:monospace;`);
    });
    log.rule('═', 60);
  }, 'preview the color palette used across this console UI');
 
  registerCommand('courses', () => {
    log.rule('═', 60);
    log.title('📚 Subscribed Courses');
    const subscribedIds = safe(() => userProfile.getSubscribedCourseIds(), []);
    const subscribedCourses = safe(() => getSubscribedCourses(getCategoryTree(), subscribedIds), []);
    if (!subscribedCourses || subscribedCourses.length === 0) {
      log.warn('  no subscribed courses yet.');
      log.dim('  subscribe to a course from the home screen to see it here.');
    } else {
      console.table(
        subscribedCourses.map((c) => ({
          name: c.name,
          id: c.id,
          education_type: c.education_type || '-',
          faculty: c.faculty && c.faculty !== 'All' ? c.faculty : '-',
          year: c.year || '-',
          term: c.term || '-',
          items: safe(() => getCourseItemCount(c), '-'),
        })),
      );
    }
    log.rule('═', 60);
  }, 'list your subscribed courses');
 
  registerCommand('stats', () => {
    log.rule('═', 60);
    log.title('📊 Platform Stats');
    const subscribedIds = safe(() => userProfile.getSubscribedCourseIds(), []);
    const userQuizzes = safe(() => JSON.parse(getFromStorage('user_quizzes', '[]')), []);
    const treeStats = getCategoryTreeStats(getCategoryTree());
    log.kv('  subscribed courses:', String(subscribedIds.length));
    log.kv('  categories loaded:', String(treeStats.categories));
    log.kv('  exams in catalog:', String(treeStats.exams));
    log.kv('  your saved quizzes:', String(Array.isArray(userQuizzes) ? userQuizzes.length : 0));
    log.dim(getCategoryTree() ? '  (catalog loaded)' : '  (catalog still loading — try again in a moment)');
    log.rule('═', 60);
  }, 'show a quick summary of your courses, catalog, and saved quizzes');
 
  registerCommand('session', () => {
    log.rule('═', 60);
    log.title('🔐 Session Info');
    const username = safe(() => getFromStorage('username', 'User'), 'User');
    const isAdmin = safe(() => isAdminAuthenticated(), false);
    const hasAdminHint = safe(() => hasAdminSessionHint(), false);
    log.kv('  username:', username);
    log.kv('  admin authenticated:', isAdmin ? 'yes' : 'no');
    log.kv('  admin session hint:', hasAdminHint ? 'yes' : 'no');
    log.dim('  "hint" means a local trace of a past admin session exists, without full re-verification.');
    log.rule('═', 60);
  }, 'show current session / auth status (does not expose credentials)');
 
  registerCommand('pwa', () => {
    log.rule('═', 60);
    log.title('📶 PWA / Offline Status');
    const online = safe(() => navigator.onLine, null);
    const hasSW = safe(() => 'serviceWorker' in navigator, false);
    log.kv('  online:', online === null ? 'unknown' : (online ? 'yes' : 'no (offline)'));
    log.kv('  service worker support:', hasSW ? 'yes' : 'no');
    if (hasSW) {
      safe(() => {
        navigator.serviceWorker.getRegistrations().then((regs) => {
          log.kv('  active registrations:', String(regs.length));
          regs.forEach((r, i) => {
            log.dim(`  [${i}] scope: ${r.scope} — state: ${r.active ? r.active.state : 'n/a'}`);
          });
        });
      }, null);
    }
    log.dim('  (registration lookup above resolves asynchronously)');
    log.rule('═', 60);
  }, 'check service worker registration and online/offline status');
 
  registerCommand('search', (query) => {
    log.rule('═', 60);
    log.title('🔍 Search');
    if (!query) {
      log.warn('  usage: basmagi.search("query")');
      log.rule('═', 60);
      return;
    }
    const searchManager = getSearchManager();
    if (!searchManager) {
      log.warn('  search isn\'t ready yet — the page may still be loading.');
      log.dim('  try again in a moment.');
      log.rule('═', 60);
      return;
    }
    searchManager.search(query);
    const results = safe(() => searchManager.getResults(), []);
    log.kv('  query:', query);
    log.kv('  context:', searchManager.currentContext || 'unknown');
    log.kv('  results:', String(Array.isArray(results) ? results.length : 0));
    log.dim('  (opened the search bar with this query — same as typing it in)');
    log.rule('═', 60);
  }, 'basmagi.search("query") — run a search as if typed into the search bar');
 
  // --------------------------------------------------------------------------
  // GO
  // --------------------------------------------------------------------------
  boot();
 
})(window);
*/