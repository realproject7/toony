// The stage the studio draws a cut's artwork on (#98/#215).
//
// Both the read-only preview and the focused editor inset their art layer out of
// the reserved gutter strip, and both do it through `resolveCutStage`. What is
// pinned here is that the inset follows the width it is GIVEN — a project that
// declares a wider strip gets a narrower art layer — because that is the half of
// read-equals-export the studio owns, and the components themselves cannot be
// run in this harness (see the module's own header for why).

import assert from "node:assert/strict";
import { test } from "node:test";
import type { LetteringOverlay } from "@toony/schema";
import { GUTTER_BAND_WIDTH_DEFAULT } from "@toony/schema";
import { resolveCutStage } from "../cut-stage.js";

const W = 800;
const H = 1200;

function overlay(over: Partial<LetteringOverlay> = {}): LetteringOverlay {
  return {
    id: "ov-1",
    cutId: "cut-001",
    speaker: "Mina",
    kind: "speech",
    text: "Still no answer.",
    font: "sans-serif",
    fill: "#ffffff",
    opacity: 1,
    border: null,
    tail: null,
    geometry: { x: 0.04, y: 0.1, width: 0.92, height: 0.2 },
    overflow: false,
    reviewStatus: "human-edited",
    ...over,
  };
}

const gutterBubble = overlay({ placement: "gutter", placementSide: "right" });

/** The percentage in a style value, e.g. `"82%"` → 82. */
function percent(value: unknown): number {
  assert.equal(typeof value, "string");
  const match = /^(-?[\d.]+)%$/.exec(value as string);
  assert.ok(match, `expected a percentage, got ${String(value)}`);
  return Number(match[1]);
}

test("with no gutter bubble the artwork is full bleed and unstyled", () => {
  const stage = resolveCutStage([overlay()], W, H, GUTTER_BAND_WIDTH_DEFAULT);
  assert.equal(stage.reserved, false);
  assert.equal(stage.artStyle, undefined);
  assert.deepEqual(stage.frame.bands, []);
  assert.deepEqual(stage.frame.art, { x: 0, y: 0, width: W, height: H });
});

test("the art layer is inset by the strip width it is GIVEN, not by the default", () => {
  // The reversion this exists to catch: a caller that substitutes the default
  // still produces a plausible stage, and every assertion about the default
  // keeps passing. So each declared width is checked against ITS own inset.
  for (const declared of [0.08, GUTTER_BAND_WIDTH_DEFAULT, 0.3, 0.45]) {
    const stage = resolveCutStage([gutterBubble], W, H, declared);
    assert.equal(stage.reserved, true, `${declared}`);
    assert.ok(stage.artStyle, `${declared}: no inset style`);
    // A right-side strip leaves the art at the left edge, narrower by the strip.
    assert.equal(percent(stage.artStyle.left), 0, `${declared}: art left edge`);
    assert.equal(
      percent(stage.artStyle.width),
      (1 - declared) * 100,
      `${declared}: art layer width`,
    );
    assert.equal(stage.frame.bands[0]?.width, W * declared, `${declared}: reserved strip`);
    assert.equal(stage.artStyle.height, "100%");
    assert.equal(stage.artStyle.position, "absolute");
  }
});

test("a left-side strip pushes the art layer right by exactly the strip", () => {
  for (const declared of [0.08, GUTTER_BAND_WIDTH_DEFAULT, 0.45]) {
    const stage = resolveCutStage(
      [overlay({ placement: "gutter", placementSide: "left" })],
      W,
      H,
      declared,
    );
    assert.ok(stage.artStyle);
    assert.equal(percent(stage.artStyle.left), declared * 100, `${declared}: art left edge`);
    assert.equal(percent(stage.artStyle.width), (1 - declared) * 100, `${declared}: art width`);
  }
});

test("a strip on each side takes its width off both ends of the artwork", () => {
  const declared = 0.2;
  const stage = resolveCutStage(
    [
      overlay({ id: "ov-l", placement: "gutter", placementSide: "left" }),
      overlay({ id: "ov-r", placement: "gutter", placementSide: "right" }),
    ],
    W,
    H,
    declared,
  );
  assert.equal(stage.frame.bands.length, 2);
  assert.ok(stage.artStyle);
  assert.equal(percent(stage.artStyle.left), declared * 100);
  assert.equal(percent(stage.artStyle.width), (1 - 2 * declared) * 100);
});

test("the stage is a pure function of its inputs", () => {
  const a = resolveCutStage([gutterBubble], W, H, 0.3);
  const b = resolveCutStage([gutterBubble], W, H, 0.3);
  assert.deepEqual(a, b);
});
