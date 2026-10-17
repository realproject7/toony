// The one answer to "what shape is this cut?" (#260).

import assert from "node:assert/strict";
import { test } from "node:test";

import { PANEL_ASPECT_MAX, PANEL_ASPECT_MIN } from "@toony/schema";
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

test("a declaration outside the schema's bounds is passed over", () => {
  // The schema validator owns the MESSAGE (`panelAspect must be a number between
  // …`); this owns not STAGING it. The studio's episode and reader pages render
  // a project with nothing gating on validity, so a declared 500 here is a
  // 500-column stage and 1e308 an Infinity-tall one — `cutHeightAt` returns
  // exactly that. Every value below is just outside a real bound or not a number
  // at all, and each must reach the same answer as declaring nothing.
  const bad = [
    0,
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    PANEL_ASPECT_MIN - 0.001,
    PANEL_ASPECT_MAX + 0.001,
    500,
    1e308,
  ];
  for (const value of bad) {
    assert.deepEqual(
      resolveCutAspect(value, null),
      { aspect: FALLBACK_CUT_ASPECT, source: "fallback" },
      `${value} was treated as a shape`,
    );
    assert.deepEqual(
      resolveCutAspect(value, PORTRAIT),
      { aspect: 1600 / 1200, source: "image" },
      `${value} was treated as a shape over the art`,
    );
    assert.ok(
      Number.isFinite(cutHeightAt(1000, resolveCutAspect(value, null).aspect)),
      `${value} staged a cut at a height nothing can draw`,
    );
  }
  // A value parsed off disk that is not a number at all cannot coerce through.
  assert.equal(
    resolveCutAspect("5" as unknown as number, null).source,
    "fallback",
    'a string "5" coerced its way through the bounds',
  );
});

test("the bounds themselves are declarable", () => {
  // The other side of the check: what the schema lets an author WRITE must
  // still stage, or the range check has quietly become a house style.
  for (const ok of [PANEL_ASPECT_MIN, PANEL_ASPECT_MAX, 0.3, 1.4327, 3.45]) {
    assert.deepEqual(resolveCutAspect(ok, PORTRAIT), { aspect: ok, source: "declared" });
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
  // existed, so that round trip has to be lossless.
  //
  // Named sizes alone do not prove that, and quietly: 1200x1600, 1000x1400 and
  // every other round shape multiply back EXACTLY, so `Math.floor` and
  // `Math.ceil` pass them too. It is the awkward ratios that carry the claim —
  // 61/7 lands a hair under its integer and 29/7 a hair over — so the sweep
  // below is the test and the two named pairs say which end each covers.
  assert.equal(cutHeightAt(7, resolveCutAspect(undefined, null, 61 / 7).aspect), 61);
  assert.equal(cutHeightAt(7, resolveCutAspect(undefined, null, 29 / 7).aspect), 29);
  assert.equal(cutHeightAt(1200, resolveCutAspect(undefined, null, 1600 / 1200).aspect), 1600);

  let checked = 0;
  for (let width = 1; width <= 400; width++) {
    for (let height = 1; height <= 400; height++) {
      const { aspect } = resolveCutAspect(undefined, null, height / width);
      assert.equal(cutHeightAt(width, aspect), height, `${width}x${height} did not round-trip`);
      checked++;
    }
  }
  assert.equal(checked, 160_000);
});

test("a height is whole pixels and never zero", () => {
  assert.equal(cutHeightAt(1200, 0.3), 360);
  assert.equal(cutHeightAt(832, 3.45), 2870); // the ratio, unsnapped: generation snaps, staging does not
  assert.equal(cutHeightAt(1000, 1.0006), 1001); // rounds, not truncates
  assert.equal(cutHeightAt(10, 0.001), 1); // a zero-height canvas is a crash, not a stage
});
