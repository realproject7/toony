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
import { type Canvas, createCanvas } from "@napi-rs/canvas";
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

// --- v2 WYSIWYG consumer-field parity (#81) --------------------------------
// These lock that the export canvas actually HONORS the resolved render-plan
// style fields (so the raster matches the studio SVG), not just that bubbles
// appear. A regression that dropped a field in drawBubble would fail here.

/** A large, bare (tailless, borderless) speech bubble for legible text sampling. */
function styledOverlay(over: Partial<LetteringOverlay>): LetteringOverlay {
  return {
    id: "ov-style",
    cutId: "cut-style",
    speaker: "",
    kind: "speech",
    text: "HELLO",
    font: "sans-serif",
    fill: "#ffffff",
    opacity: 1,
    border: null,
    tail: null,
    fontSize: 40,
    geometry: { x: 0.08, y: 0.35, width: 0.84, height: 0.3 },
    overflow: false,
    reviewStatus: "draft",
    ...over,
  };
}

test("export honors the resolved textColor (#81)", async () => {
  // Red text on the white bubble: if drawBubble ignored b.textColor it would draw
  // the per-kind dark default, so red glyph pixels would be absent.
  const composed = await composeCut([styledOverlay({ textColor: "#ff0000" })], null, 480);
  const ctx = composed.canvas.getContext("2d");
  const { data } = ctx.getImageData(0, 0, composed.width, composed.height);
  let redInk = 0;
  for (let i = 0; i < data.length; i += 4) {
    if ((data[i] ?? 0) > 180 && (data[i + 1] ?? 0) < 90 && (data[i + 2] ?? 0) < 90) redInk++;
  }
  assert.ok(redInk > 50, `expected red textColor glyph pixels, found ${redInk}`);
});

/** Mean x of "ink" (clearly darker than the light bubble/background) pixels. */
function inkMeanX(canvas: Canvas): number {
  const ctx = canvas.getContext("2d");
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let sumX = 0;
  let n = 0;
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const i = (y * canvas.width + x) * 4;
      // Dark ink: the black text. Bubble fill (white) and bg (#eceae6) are light.
      if ((data[i] ?? 255) < 80 && (data[i + 1] ?? 255) < 80 && (data[i + 2] ?? 255) < 80) {
        sumX += x;
        n++;
      }
    }
  }
  return n > 0 ? sumX / n : Number.NaN;
}

test("export honors textAlign: left text sits left of right-aligned text (#81)", async () => {
  const left = await composeCut(
    [styledOverlay({ textColor: "#000000", textAlign: "left" })],
    null,
    480,
  );
  const right = await composeCut(
    [styledOverlay({ textColor: "#000000", textAlign: "right" })],
    null,
    480,
  );
  const leftX = inkMeanX(left.canvas);
  const rightX = inkMeanX(right.canvas);
  assert.ok(!Number.isNaN(leftX) && !Number.isNaN(rightX), "expected ink in both renders");
  // Same text, same box — only the anchor differs, so left must sit clearly left.
  assert.ok(
    rightX - leftX > 30,
    `left-aligned ink (${leftX}) must be left of right-aligned (${rightX})`,
  );
});

// --- Bubble grammar consumption (#93) --------------------------------------

test("export composes the new bubble kinds/tones without error", async () => {
  const base = (over: Partial<LetteringOverlay>): LetteringOverlay => ({
    id: "g",
    cutId: "c",
    speaker: "X",
    kind: "speech",
    text: "hello",
    font: "sans-serif",
    fill: "#ffffff",
    opacity: 1,
    border: null,
    tail: null,
    geometry: { x: 0.1, y: 0.1, width: 0.5, height: 0.2 },
    overflow: false,
    reviewStatus: "draft",
    ...over,
  });
  // narration (borderless caption), beat (ellipsis), ambient, and a scalloped
  // shout + jagged aggressive with an off-panel tailTarget all compose to a real
  // raster of the expected size (they consume the shared render plan).
  const overlays = [
    base({
      id: "n",
      kind: "narration",
      speaker: "",
      geometry: { x: 0.05, y: 0.05, width: 0.9, height: 0.12 },
    }),
    base({
      id: "b",
      kind: "beat",
      text: "",
      geometry: { x: 0.4, y: 0.4, width: 0.2, height: 0.12 },
    }),
    base({
      id: "a",
      kind: "ambient",
      text: "psst",
      geometry: { x: 0.6, y: 0.7, width: 0.25, height: 0.1 },
    }),
    base({
      id: "s",
      kind: "shout",
      text: "HEY",
      tone: "aggressive",
      tailTarget: { x: 1.4, y: 0.5 },
    }),
  ];
  const composed = await composeCut(overlays, null, 480);
  assert.equal(composed.width, 480);
  assert.ok(composed.height > 0);
});

// --- Transition band color (#98) -------------------------------------------

test("composeTransitionBand fills the band with Transition.color when set", async () => {
  const { composeTransitionBand } = await import("../compose.js");
  const band = composeTransitionBand(
    {
      id: "t",
      type: "gutter",
      gutterHeight: 60,
      text: null,
      sfx: null,
      agentNote: null,
      humanNote: null,
      image: null,
      reviewStatus: "draft",
      color: "#3366cc",
    },
    300,
  );
  assert.ok(band);
  const ctx = band.canvas.getContext("2d");
  const { data } = ctx.getImageData(Math.round(band.width / 2), Math.round(band.height / 2), 1, 1);
  // #3366cc = (51, 102, 204), opaque.
  assert.equal(data[3], 255);
  const near = (got: number | undefined, want: number) => Math.abs((got ?? -999) - want) <= 2;
  assert.ok(
    near(data[0], 51) && near(data[1], 102) && near(data[2], 204),
    `got [${data[0]},${data[1]},${data[2]}]`,
  );
});
