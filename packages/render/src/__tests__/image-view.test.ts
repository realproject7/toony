// The one place a stored image view becomes source pixels (CMP-01).

import assert from "node:assert/strict";
import { test } from "node:test";
import { imageViewPixels, isWholeImage } from "../image-view.js";

test("a view becomes whole source pixels inside the picture, independent of its resolution", () => {
  assert.deepEqual(imageViewPixels(undefined, 832, 1216), { x: 0, y: 0, width: 832, height: 1216 });
  const half = { x: 0, y: 0.5, width: 1, height: 0.5 };
  assert.deepEqual(imageViewPixels(half, 832, 1216), { x: 0, y: 608, width: 832, height: 608 });
  // The same fractions at twice the resolution pick the same part.
  assert.deepEqual(imageViewPixels(half, 1664, 2432), { x: 0, y: 1216, width: 1664, height: 1216 });
  // Rounding never reaches outside the picture.
  const edge = imageViewPixels(
    { x: 0.333333, y: 0.666667, width: 0.666667, height: 0.333333 },
    7,
    5,
  );
  assert.ok(edge.x + edge.width <= 7 && edge.y + edge.height <= 5);
  assert.ok(isWholeImage(imageViewPixels({ x: 0, y: 0, width: 1, height: 1 }, 10, 20), 10, 20));
  assert.ok(!isWholeImage(imageViewPixels(half, 10, 20), 10, 20));
});
