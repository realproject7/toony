// Moving and resizing a cut's frame over its picture (CMP-02).

import assert from "node:assert/strict";
import { test } from "node:test";
import { dragFrame, FRAME_MIN, frameEdges, isWholeFrame, WHOLE_FRAME } from "../frame-math.js";

const half = { x: 0, y: 0.5, width: 1, height: 0.5 };

test("a frame moves and resizes inside its picture and never below the smallest size", () => {
  assert.deepEqual(dragFrame(half, "move", 0, 0.3), half, "it cannot leave the picture");
  assert.deepEqual(dragFrame(half, "move", 0, -0.2), { ...half, y: 0.3 });
  const taller = dragFrame(half, "n", 0, -0.25);
  assert.equal(taller.y, 0.25);
  assert.equal(taller.height, 0.75);
  const tiny = dragFrame(half, "s", 0, -0.9);
  assert.ok(Math.abs(tiny.height - FRAME_MIN) < 1e-9);
  const corner = dragFrame(half, "nw", 0.2, 0.1);
  assert.deepEqual(
    [corner.x, corner.y, corner.width, corner.height].map((n) => Math.round(n * 100) / 100),
    [0.2, 0.6, 0.8, 0.4],
  );
  assert.deepEqual(frameEdges(half), { top: false, bottom: true });
  assert.ok(isWholeFrame(WHOLE_FRAME));
  assert.ok(!isWholeFrame(half));
});
