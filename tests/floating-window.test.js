import test from "node:test";
import assert from "node:assert/strict";
import {
  cornerFromPoint, cornerRect, resolveOverlap, clampToViewport, readCorner,
  layoutMinimized, pillMetrics, effectiveViewportHeight, isMotionDisabled,
  createFloatingStack, dockAction, dockOrder, FLOAT_Z_BASE,
} from "../public/src/shared/floating-window.js";

test("cornerFromPoint picks the nearest corner", () => {
  assert.equal(cornerFromPoint(10, 10, 1000, 800), "top-left");
  assert.equal(cornerFromPoint(900, 700, 1000, 800), "bottom-right");
  assert.equal(cornerFromPoint(900, 10, 1000, 800), "top-right");
});

test("cornerRect places a pill with margins and bottom inset", () => {
  assert.deepEqual(cornerRect("bottom-right", 300, 48, 1000, 800), { left: 684, top: 736 });
  assert.deepEqual(cornerRect("top-left", 300, 48, 1000, 800), { left: 16, top: 16 });
  assert.equal(cornerRect("bottom-left", 300, 48, 400, 800, { margin: 8, bottomInset: 66 }).top, 678);
});

test("resolveOverlap stacks bottom pills upward and top pills downward", () => {
  const pill = { left: 684, top: 736, width: 300, height: 48 };
  const other = { left: 684, top: 736, width: 300, height: 48 };
  assert.equal(resolveOverlap(pill, [other], "bottom-right", 800).top, 680);
  const topPill = { left: 16, top: 16, width: 300, height: 48 };
  assert.equal(resolveOverlap(topPill, [{ ...topPill }], "top-left", 800).top, 72);
  assert.equal(resolveOverlap(pill, [{ left: 0, top: 0, width: 10, height: 10 }], "bottom-right", 800).top, 736);
});

test("clampToViewport keeps the window reachable", () => {
  assert.deepEqual(clampToViewport(2000, 2000, 300, 48, 1000, 800), { left: 692, top: 744 });
  assert.deepEqual(clampToViewport(-50, -50, 300, 48, 1000, 800), { left: 8, top: 8 });
});

test("readCorner falls back for bad values", () => {
  assert.equal(readCorner("k", "bottom-right", { getItem: () => "nope" }), "bottom-right");
  assert.equal(readCorner("k", "bottom-right", { getItem: () => "top-left" }), "top-left");
});

// ── Minimized-pill layout (all pills laid out together) ─────────────────────
const VW = 1000, VH = 800;
const pill = (id, corner, order) => ({ id, corner, order, width: 300, height: 48 });
const D = pillMetrics(VW);

test("layoutMinimized: a lone pill sits in its corner", () => {
  const out = layoutMinimized([pill("ai", "bottom-left", 1)], VW, VH, D);
  assert.deepEqual(out.ai, { left: 16, top: 736 });
});

test("layoutMinimized: pills in one bottom corner stack upward in arrival order", () => {
  const out = layoutMinimized([pill("yt", "bottom-left", 2), pill("ai", "bottom-left", 1)], VW, VH, D);
  assert.equal(out.ai.top, 736);
  assert.equal(out.yt.top, 680);
});

test("layoutMinimized: top corners stack downward", () => {
  const out = layoutMinimized([pill("a", "top-right", 1), pill("b", "top-right", 2)], VW, VH, D);
  assert.equal(out.a.top, 16);
  assert.equal(out.b.top, 72);
});

test("A2 regression: when the AI pill leaves the corner the YouTube pill drops back", () => {
  const stacked = layoutMinimized([pill("ai", "bottom-left", 1), pill("yt", "bottom-left", 2)], VW, VH, D);
  assert.equal(stacked.yt.top, 680);
  // AI pill moves to another corner (it arrives last there): YouTube's slot is recomputed.
  const moved = layoutMinimized([pill("ai", "bottom-right", 3), pill("yt", "bottom-left", 2)], VW, VH, D);
  assert.equal(moved.yt.top, 736);
  assert.equal(moved.ai.top, 736);
  // And the other direction: YouTube leaves, AI stays put.
  const ytAway = layoutMinimized([pill("ai", "bottom-left", 1), pill("yt", "top-left", 4)], VW, VH, D);
  assert.equal(ytAway.ai.top, 736);
  assert.equal(ytAway.yt.top, 16);
});

test("layoutMinimized: AI plus two YouTube pills in one corner never overlap and keep arrival order", () => {
  const items = [pill("yt-2", "bottom-right", 3), pill("ai", "bottom-right", 1), pill("yt-1", "bottom-right", 2)];
  const out = layoutMinimized(items, VW, VH, D);
  assert.deepEqual([out.ai.top, out["yt-1"].top, out["yt-2"].top], [736, 680, 624]);
  assert.deepEqual(layoutMinimized(items.slice().reverse(), VW, VH, D), out); // deterministic
});

test("layoutMinimized: removing a middle pill closes the gap", () => {
  const out = layoutMinimized([pill("ai", "bottom-right", 1), pill("yt-2", "bottom-right", 3)], VW, VH, D);
  assert.equal(out["yt-2"].top, 680);
});

test("layoutMinimized: on a phone bottom pills clear the bottom nav and opposite corners do not overlap", () => {
  const m = pillMetrics(390, { navHeight: 54 });
  assert.equal(m.width, 300);
  assert.equal(m.bottomOffset, 66);
  const out = layoutMinimized([pill("a", "bottom-left", 1), pill("b", "bottom-right", 2)], 390, 800, m);
  assert.equal(out.a.top, 800 - 48 - 66);
  // 300px pills cannot sit side by side in 390px: the later one stacks instead of overlapping.
  assert.equal(out.b.top, out.a.top - 56);
});

test("pillMetrics honours safe-area insets", () => {
  const m = pillMetrics(390, { safe: { bottom: 20, left: 12 } });
  assert.equal(m.bottomOffset, 54 + 12 + 20);
  assert.equal(m.marginLeft, 12);
  assert.equal(pillMetrics(1200).bottomOffset, 16);
});

test("effectiveViewportHeight lifts pills above the on-screen keyboard", () => {
  assert.equal(effectiveViewportHeight(800, 500, 0), 500);
  assert.equal(effectiveViewportHeight(800, undefined), 800);
  assert.equal(effectiveViewportHeight(800, 900, 0), 800);
  const kb = layoutMinimized([pill("a", "bottom-left", 1)], 390, effectiveViewportHeight(800, 500), pillMetrics(390));
  assert.equal(kb.a.top, 500 - 48 - 66);
});

test("isMotionDisabled follows only html[data-motion] (the user's High-Performance switch)", () => {
  assert.equal(isMotionDisabled({ dataMotion: "reduced" }), true);
  assert.equal(isMotionDisabled({ dataMotion: "normal", osReduced: true }), false);
  assert.equal(isMotionDisabled(), false);
});

// ── Shared z-order: the window you click goes on top, AI or YouTube ─────────
test("floating stack: the clicked window becomes the front, whatever its kind", () => {
  const s = createFloatingStack();
  s.raise("ai-agent"); s.raise("youtube-1"); s.raise("youtube-2");
  assert.deepEqual(s.ids(), ["ai-agent", "youtube-1", "youtube-2"]);
  s.raise("ai-agent"); // click the AI window
  assert.equal(s.zOf("ai-agent"), FLOAT_Z_BASE + 2);
  assert.ok(s.zOf("ai-agent") > s.zOf("youtube-1") && s.zOf("youtube-1") < s.zOf("youtube-2"));
  s.raise("youtube-1"); // then a YouTube window
  assert.deepEqual(s.ids(), ["youtube-2", "ai-agent", "youtube-1"]);
  assert.equal(s.topZ(), s.zOf("youtube-1"));
});

test("floating stack: closing a window closes the gap and z stays inside the band", () => {
  const s = createFloatingStack(6000, 6003);
  ["a", "b", "c"].forEach((id) => s.raise(id));
  s.remove("b");
  assert.equal(s.zOf("c"), 6001);
  for (let i = 0; i < 10; i++) s.raise(`w${i}`);
  assert.ok(s.topZ() <= 6003);
});

test("dockAction: dock when any window is open, restore when all are docked", () => {
  assert.equal(dockAction([]), "none");
  assert.equal(dockAction([true, false]), "minimize");
  assert.equal(dockAction([true, true]), "restore");
});

test("dockOrder: oldest-opened first, so pills read in opening order", () => {
  const items = [
    { id: "ai-agent", openedSeq: 3 },
    { id: "yt-1", openedSeq: 1 },
    { id: "yt-2", openedSeq: 2 },
  ];
  assert.deepEqual(dockOrder(items).map((i) => i.id), ["yt-1", "yt-2", "ai-agent"]);
  assert.equal(items[0].id, "ai-agent"); // input untouched
});

test("dockOrder: ties fall back to id for a stable result", () => {
  assert.deepEqual(dockOrder([{ id: "b", openedSeq: 1 }, { id: "a", openedSeq: 1 }]).map((i) => i.id), ["a", "b"]);
});
