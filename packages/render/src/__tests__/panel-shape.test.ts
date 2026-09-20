// The one answer to "what shape is this cut?" (#260).

import assert from "node:assert/strict";
import { test } from "node:test";

import { FALLBACK_CUT_ASPECT } from "../layout.js";
import { cutHeightAt, resolveCutAspect } from "../panel-shape.js";

const PORTRAIT = { width: 1200, height: 1600 };

test("a declared shape is the answer, even when the cut has art", () => {
  // The declaration wins because this answers what the cut is MEANT to be —
  // which is the side a mismatch is measured against. Consumers that stage a
  // cut WITH art never ask (they use the art), so this precedence cannot
  // re-shape a page.
  assert.deepEqual(resolveCutAspect(0.3, null), { aspect: 0.3, source: "declared" });
  assert.deepEqual(resolveCutAspect(0.3, PORTRAIT), { aspect: 0.3, source: "declared" });
});

test("with no declaration the art's own shape is the answer", () => {
  assert.deepEqual(resolveCutAspect(undefined, PORTRAIT), {
    aspect: 1600 / 1200,
    source: "image",
  });
  assert.deepEqual(resolveCutAspect(undefined, { width: 832, height: 248 }), {
    aspect: 248 / 832,
    source: "image",
  });
});

test("with neither, the fallback — and a caller may bring its own", () => {
  assert.deepEqual(resolveCutAspect(undefined, null), {
    aspect: FALLBACK_CUT_ASPECT,
    source: "fallback",
  });
  assert.deepEqual(resolveCutAspect(undefined, null, 1600 / 1200), {
    aspect: 1600 / 1200,
    source: "fallback",
  });
});

test("a declaration that is not a positive finite number is passed over", () => {
  // The schema validator owns that message (`panelAspect must be a number
  // between …`); propagating it as a shape would turn one defect into a canvas
  // nothing can draw on.
  for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.deepEqual(
      resolveCutAspect(bad, null),
      { aspect: FALLBACK_CUT_ASPECT, source: "fallback" },
      `${bad} was treated as a shape`,
    );
    assert.deepEqual(
      resolveCutAspect(bad, PORTRAIT),
      { aspect: 1600 / 1200, source: "image" },
      `${bad} was treated as a shape over the art`,
    );
  }
});

test("art with an axis of zero is not art", () => {
  for (const dims of [
    { width: 0, height: 100 },
    { width: 100, height: 0 },
    { width: 0, height: 0 },
  ]) {
    assert.deepEqual(resolveCutAspect(undefined, dims), {
      aspect: FALLBACK_CUT_ASPECT,
      source: "fallback",
    });
  }
});

test("a caller's fallback SIZE survives the round trip through an aspect", () => {
  // `@toony/lint` stages an undeclared art-less cut by handing its documented
  // fallback canvas in as a RATIO and multiplying back out. A cut that declares
  // nothing must land on exactly the canvas it landed on before the declaration
  // existed, so that round trip has to be lossless — at the shipped size and at
  // every other shape a caller might document.
  const sizes: [number, number][] = [
    [1200, 1600],
    [1000, 1400],
    [1200, 1601],
    [833, 1193],
    [3, 7],
    [1, 1],
    [1920, 1],
  ];
  for (const [width, height] of sizes) {
    const { aspect } = resolveCutAspect(undefined, null, height / width);
    assert.equal(cutHeightAt(width, aspect), height, `${width}x${height} did not round-trip`);
  }
});

test("a height is whole pixels and never zero", () => {
  assert.equal(cutHeightAt(1200, 0.3), 360);
  assert.equal(cutHeightAt(832, 3.45), 2870); // the ratio, unsnapped: generation snaps, staging does not
  assert.equal(cutHeightAt(1000, 1.0006), 1001); // rounds, not truncates
  assert.equal(cutHeightAt(10, 0.001), 1); // a zero-height canvas is a crash, not a stage
});
