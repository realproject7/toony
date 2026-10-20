// A cut's image view (CMP-01): fractions of the picture, inside it, with a
// usable size. Older cuts without one stay valid.

import assert from "node:assert/strict";
import { test } from "node:test";
import { IssueCollector } from "../errors.js";
import { validateCutValue } from "../validate.js";

function issues(imageView: unknown): string[] {
  const c = new IssueCollector();
  validateCutValue(
    { id: "cut-001", image: null, imagePrompt: "", negativePrompt: "", imageView },
    "cut",
    c,
  );
  return c.result().issues.map((issue) => issue.code);
}

test("an image view lies inside the picture and keeps a usable size", () => {
  assert.deepEqual(issues(undefined), []);
  assert.deepEqual(issues({ x: 0, y: 0, width: 1, height: 1 }), []);
  assert.deepEqual(issues({ x: 0, y: 2 / 3, width: 1, height: 1 / 3 }), []);
  for (const bad of [
    { x: 0, y: 0.6, width: 1, height: 0.5 },
    { x: -0.1, y: 0, width: 0.5, height: 0.5 },
    { x: 0, y: 0, width: 0.01, height: 0.5 },
    { x: 0, y: 0, width: Number.NaN, height: 0.5 },
    { x: 0, y: 0, width: 1, height: 1, zoom: 2 },
    [0, 0, 1, 1],
    "top",
  ]) {
    assert.deepEqual(issues(bad), ["cut.image-view"], JSON.stringify(bad));
  }
});
