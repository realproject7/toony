import assert from "node:assert/strict";
import { test } from "node:test";
import {
  balloonOutline,
  balloonPathD,
  defaultBalloonRadius,
  speechTailGeometry,
} from "../geometry.js";

test("defaultBalloonRadius is proportional and capped below half the shorter side", () => {
  assert.equal(defaultBalloonRadius(100, 200), 40); // 0.4 * 100
  assert.equal(defaultBalloonRadius(10, 10), 4);
  assert.equal(defaultBalloonRadius(0, 0), 0);
});

test("speechTailGeometry returns null when the tip is inside the box", () => {
  const tail = speechTailGeometry(0, 0, 100, 100, { x: 50, y: 50 });
  assert.equal(tail, null);
});

test("speechTailGeometry anchors a downward tail on the bottom edge", () => {
  const tail = speechTailGeometry(0, 0, 100, 100, { x: 50, y: 140 });
  assert.ok(tail);
  // Both base points sit exactly on the bottom edge (y = 100).
  assert.equal(tail.base1.y, 100);
  assert.equal(tail.base2.y, 100);
  assert.equal(tail.tip.x, 50);
  assert.equal(tail.tip.y, 140);
  assert.ok(tail.base1.x < tail.base2.x);
});

test("speechTailGeometry anchors a rightward tail on the right edge", () => {
  const tail = speechTailGeometry(0, 0, 100, 100, { x: 160, y: 50 });
  assert.ok(tail);
  assert.equal(tail.base1.x, 100);
  assert.equal(tail.base2.x, 100);
});

test("tail mouth never lands inside a rounded corner", () => {
  // Tail aimed past the bottom-right corner; the mouth must stay on the flat
  // span [r, size - r] of the bottom edge.
  const r = defaultBalloonRadius(100, 100);
  const tail = speechTailGeometry(0, 0, 100, 100, { x: 130, y: 130 }, r);
  assert.ok(tail);
  // Dominant axis here is equal; falls into the vertical branch (bottom edge).
  for (const base of [tail.base1, tail.base2]) {
    if (base.y === 100) {
      assert.ok(base.x >= r - 1e-9, `${base.x} >= ${r}`);
      assert.ok(base.x <= 100 - r + 1e-9, `${base.x} <= ${100 - r}`);
    }
  }
});

test("balloonOutline with no tail is a closed rounded rectangle (4 arcs)", () => {
  const cmds = balloonOutline(0, 0, 100, 60, null);
  const arcs = cmds.filter((c) => c.k === "A");
  assert.equal(arcs.length, 4);
  assert.equal(cmds[0]?.k, "M");
});

test("balloonOutline folds a bottom tail into the bottom edge as a detour", () => {
  const tail = speechTailGeometry(0, 0, 100, 60, { x: 50, y: 100 });
  const cmds = balloonOutline(0, 0, 100, 60, tail);
  // The tip appears as one of the line vertices.
  const hasTip = cmds.some((c) => c.k === "L" && c.x === tail?.tip.x && c.y === tail?.tip.y);
  assert.ok(hasTip);
});

test("balloonPathD is deterministic and closed", () => {
  const cmds = balloonOutline(10, 20, 80, 40, null);
  const d1 = balloonPathD(cmds);
  const d2 = balloonPathD(balloonOutline(10, 20, 80, 40, null));
  assert.equal(d1, d2);
  assert.ok(d1.startsWith("M "));
  assert.ok(d1.endsWith("Z"));
  assert.ok(d1.includes("A "));
});
