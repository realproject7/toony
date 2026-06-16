// Regression test for #32: the cut artwork must actually be composited into the
// exported raster, not dropped to a transparent/black background.
//
// The old synchronous decode (`new Image(); img.src = buf`) set width/height but
// never decoded pixels in @napi-rs/canvas@1.0.0, so drawImage painted nothing and
// the exported cut center came back as RGBA [0,0,0,0]. This test builds a REAL
// solid-color raster, composes a cut from it with an overlay, and asserts an
// uncovered pixel is opaque and matches the source fill — which fails on the old
// decode and passes with loadImage().

import assert from "node:assert/strict";
import { test } from "node:test";
import { createCanvas } from "@napi-rs/canvas";
import type { LetteringOverlay } from "@toony/schema";
import { composeCut } from "../compose.js";

/** A distinctive, unmistakable fill so a match can't be a coincidence. */
const FIXTURE_RGB = { r: 17, g: 199, b: 83 } as const;

/** Build a REAL non-blank PNG fixture: a solid distinctive-color raster. */
function buildSolidColorPngFixture(width: number, height: number): Uint8Array {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = `rgb(${FIXTURE_RGB.r}, ${FIXTURE_RGB.g}, ${FIXTURE_RGB.b})`;
  ctx.fillRect(0, 0, width, height);
  return new Uint8Array(canvas.toBuffer("image/png"));
}

/** A single speech bubble pinned to the top-left so the bottom stays bare. */
function topLeftOverlay(): LetteringOverlay {
  return {
    id: "ov-fixture",
    cutId: "cut-fixture",
    speaker: "Mira",
    kind: "speech",
    text: "Proof that the artwork is really here.",
    font: "sans-serif",
    fill: "#ffffff",
    opacity: 1,
    border: null,
    tail: { x: 0.18, y: 0.38 },
    geometry: { x: 0.05, y: 0.05, width: 0.4, height: 0.15 },
    overflow: false,
    reviewStatus: "draft",
  };
}

test("composeCut composites the cut artwork (uncovered pixel is opaque source color)", async () => {
  const fixture = buildSolidColorPngFixture(240, 336);
  const composed = await composeCut([topLeftOverlay()], fixture, 480);

  const ctx = composed.canvas.getContext("2d");
  // Sample bottom-center: well clear of the top-left bubble, so it must be the
  // raw composited artwork.
  const x = Math.round(composed.width / 2);
  const y = Math.round(composed.height * 0.9);
  const { data } = ctx.getImageData(x, y, 1, 1);
  const [r, g, b, a] = data;

  // The bug: this pixel came back transparent (PNG) / black — alpha 0 / all-zero.
  assert.equal(a, 255, "uncovered cut pixel must be fully opaque, not transparent");
  // Allow tiny scaling/encoding tolerance around the distinctive fill.
  const near = (got: number | undefined, want: number) => Math.abs((got ?? -999) - want) <= 4;
  assert.ok(
    near(r, FIXTURE_RGB.r) && near(g, FIXTURE_RGB.g) && near(b, FIXTURE_RGB.b),
    `uncovered pixel RGB [${r},${g},${b}] must match source fill [${FIXTURE_RGB.r},${FIXTURE_RGB.g},${FIXTURE_RGB.b}]`,
  );
});

test("composeCut without an image falls back to the neutral background", async () => {
  const composed = await composeCut([], null, 200);
  const ctx = composed.canvas.getContext("2d");
  const { data } = ctx.getImageData(2, 2, 1, 1);
  // #eceae6 fallback, fully opaque.
  assert.equal(data[3], 255);
  assert.equal(data[0], 0xec);
  assert.equal(data[1], 0xea);
  assert.equal(data[2], 0xe6);
});
