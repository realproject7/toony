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
import { layoutCut } from "@toony/render";
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

// --- Narration caption legibility, measured on the raster (#186) ------------
//
// The render core proves the caption plate clears WCAG AA using its own model of
// compositing. These tests prove the EXPORTED PIXELS agree: they composite a
// narration caption over real light and real dark artwork and measure the ratio
// between the plate and the ink as actually drawn, with an independent WCAG
// implementation written from the spec.

/** WCAG 2.x relative luminance of an 8-bit sRGB pixel, written from the spec. */
function pixelLuminance(px: readonly [number, number, number]): number {
  const lin = (v: number): number => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(px[0]) + 0.7152 * lin(px[1]) + 0.0722 * lin(px[2]);
}

function pixelContrast(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  const la = pixelLuminance(a);
  const lb = pixelLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** A solid raster of an arbitrary color, standing in for a cut's artwork. */
function solidArt(rgb: readonly [number, number, number], w = 300, h = 420): Uint8Array {
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
  ctx.fillRect(0, 0, w, h);
  return new Uint8Array(canvas.toBuffer("image/png"));
}

/** The narration caption both shipped examples author: a wide band, low in the cut. */
function captionOverlay(over: Partial<LetteringOverlay> = {}): LetteringOverlay {
  return {
    id: "cap",
    cutId: "cut-001",
    speaker: "",
    kind: "narration",
    text: "The light died. The line stayed open.",
    font: "sans-serif",
    fill: "#f5efe2",
    opacity: 1,
    border: null,
    tail: null,
    fontSize: 26,
    geometry: { x: 0.08, y: 0.8, width: 0.84, height: 0.13 },
    overflow: false,
    reviewStatus: "human-edited",
    ...over,
  };
}

/**
 * The plate pixel and the ink pixel of the drawn caption, both read back off the
 * raster. Sampling is confined to the box INSET by the plate's corner radius:
 * outside that inset the artwork still shows through the rounded corners, and a
 * dark corner would masquerade as ink — the measurement would then pass by
 * comparing the plate against the artwork it was supposed to cover.
 *
 * The plate is the caption's left padding (no glyph lands there at any
 * alignment); the ink is the darkest pixel in the inset region — a glyph core,
 * which the caller confirms by checking it against the plan's resolved ink.
 */
function captionPixels(
  canvas: Canvas,
  plan: { box: { x: number; y: number; width: number; height: number }; cornerRadius: number },
): { plate: [number, number, number]; ink: [number, number, number] } {
  const ctx = canvas.getContext("2d");
  const inset = Math.ceil(plan.cornerRadius) + 1;
  const { box } = plan;
  // Text starts at 6% of the box width (the render core's padX), so 3% is inside
  // the plate and clear of every glyph at any alignment.
  const px = ctx.getImageData(
    Math.round(box.x + box.width * 0.03),
    Math.round(box.y + box.height / 2),
    1,
    1,
  ).data;
  const plate: [number, number, number] = [px[0] ?? 0, px[1] ?? 0, px[2] ?? 0];

  const { data } = ctx.getImageData(
    Math.round(box.x + inset),
    Math.round(box.y + inset),
    Math.max(1, Math.round(box.width - 2 * inset)),
    Math.max(1, Math.round(box.height - 2 * inset)),
  );
  let ink: [number, number, number] = plate;
  let darkest = Number.POSITIVE_INFINITY;
  for (let i = 0; i < data.length; i += 4) {
    const candidate: [number, number, number] = [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0];
    const l = pixelLuminance(candidate);
    if (l < darkest) {
      darkest = l;
      ink = candidate;
    }
  }
  return { plate, ink };
}

/** The caption's box in raster pixels, from the same plan the export draws. */
function captionBox(overlay: LetteringOverlay, width: number, height: number) {
  const plan = layoutCut([overlay], width, height)[0];
  assert.ok(plan, "expected a render plan for the caption");
  return plan;
}

/** Assert the sampled "ink" really is the caption's glyph, not something behind it. */
function assertIsResolvedInk(sampled: readonly [number, number, number], textColor: string): void {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(textColor);
  assert.ok(m, `expected an opaque ink, got ${textColor}`);
  for (let c = 0; c < 3; c++) {
    const want = Number.parseInt(m[c + 1] as string, 16);
    assert.ok(
      Math.abs((sampled[c] as number) - want) <= 6,
      `sampled ink [${sampled}] is not the resolved ${textColor} — the darkest pixel in the caption is not a glyph`,
    );
  }
}

test("a narration caption clears WCAG AA over DARK artwork in the raster (#186)", async () => {
  // #101319 is the mean pixel under the caption of examples/dead-air cut-007,
  // where the unplated caption measured 1.12:1.
  const art: [number, number, number] = [0x10, 0x13, 0x19];
  const composed = await composeCut([captionOverlay()], solidArt(art), 480);
  const plan = captionBox(captionOverlay(), composed.width, composed.height);
  const { plate, ink } = captionPixels(composed.canvas, plan);
  assertIsResolvedInk(ink, plan.textColor);
  // The defect, reproduced: this ink on this artwork is the 1.1:1 the issue found.
  assert.ok(pixelContrast(ink, art) < 1.5, "the unplated pairing must genuinely fail");
  const got = pixelContrast(plate, ink);
  assert.ok(got >= 4.5, `caption over dark art measured ${got.toFixed(2)}:1 in the raster`);
});

test("a narration caption clears WCAG AA over LIGHT artwork in the raster (#186)", async () => {
  const composed = await composeCut([captionOverlay()], solidArt([0xe9, 0xe4, 0xda]), 480);
  const plan = captionBox(captionOverlay(), composed.width, composed.height);
  const { plate, ink } = captionPixels(composed.canvas, plan);
  assertIsResolvedInk(ink, plan.textColor);
  const got = pixelContrast(plate, ink);
  assert.ok(got >= 4.5, `caption over light art measured ${got.toFixed(2)}:1 in the raster`);
});

test("a translucent caption plate still clears AA over pure black in the raster (#186)", async () => {
  // A legal-but-faint authored opacity: the render core raises it to the floor,
  // and here the RASTER — 8-bit quantized, composited by the real canvas — is
  // measured to confirm the raised alpha survives to the exported pixels.
  const faint = captionOverlay({ opacity: 0.2 });
  const composed = await composeCut([faint], solidArt([0, 0, 0]), 480);
  const plan = captionBox(faint, composed.width, composed.height);
  assert.ok(plan.fillOpacity > 0.2 && plan.fillOpacity < 1, "expected a raised, translucent plate");
  const { plate, ink } = captionPixels(composed.canvas, plan);
  assertIsResolvedInk(ink, plan.textColor);
  const got = pixelContrast(plate, ink);
  assert.ok(got >= 4.5, `translucent caption over black measured ${got.toFixed(2)}:1`);
});

test("the raster plate matches the SVG compositing model, so studio and export agree (#186)", async () => {
  // The studio draws the SAME plan as an SVG `<path fill fill-opacity>`, which
  // composites source-over exactly like the canvas. Asserting the raster pixel
  // equals that model is what makes the preview and the export the same picture —
  // neither consumer re-derives the plate (#112/#135/#147).
  const art: [number, number, number] = [0x10, 0x13, 0x19];
  const faint = captionOverlay({ opacity: 0.2 });
  const composed = await composeCut([faint], solidArt(art), 480);
  const plan = captionBox(faint, composed.width, composed.height);
  const { plate } = captionPixels(composed.canvas, plan);

  const fillRgb = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(plan.fill);
  assert.ok(fillRgb, `resolved plate fill must be an opaque hex, got ${plan.fill}`);
  const a = plan.fillOpacity;
  for (let c = 0; c < 3; c++) {
    const source = Number.parseInt(fillRgb[c + 1] as string, 16);
    const expected = source * a + (art[c] as number) * (1 - a);
    assert.ok(
      Math.abs((plate[c] as number) - expected) <= 2,
      `channel ${c}: raster ${plate[c]} vs SVG model ${expected.toFixed(1)}`,
    );
  }
});

test("the caption plate is borderless unless the overlay authors a border (#186)", async () => {
  const plain = captionBox(captionOverlay(), 480, 672);
  assert.equal(plain.strokeWidth, 0, "a caption draws no border of its own");
  // examples/last-train authors one; it must survive to the raster path.
  const bordered = captionBox(captionOverlay({ border: { width: 2, color: "#141414" } }), 480, 672);
  assert.equal(bordered.strokeWidth, 2);
  assert.equal(bordered.stroke, "#141414");
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

test("a gutter bubble reserves a white strip; art is not drawn there (#98)", async () => {
  const fixture = buildSolidColorPngFixture(240, 336);
  const gutter: LetteringOverlay = {
    id: "gb",
    cutId: "c",
    speaker: "Mina",
    kind: "speech",
    text: "Hi",
    font: "sans-serif",
    fill: "#ffffff",
    opacity: 1,
    border: null,
    tail: null,
    placement: "gutter",
    placementSide: "right",
    geometry: { x: 0.2, y: 0.7, width: 0.6, height: 0.15 },
    overflow: false,
    reviewStatus: "draft",
  };
  const composed = await composeCut([gutter], fixture, 480);
  const ctx = composed.canvas.getContext("2d");
  // Left (art) sample at the very top should be the source fill (distinctive green).
  const a = ctx.getImageData(4, 4, 1, 1).data;
  assert.ok(
    Math.abs((a[0] ?? 0) - FIXTURE_RGB.r) <= 4 && Math.abs((a[1] ?? 0) - FIXTURE_RGB.g) <= 4,
    `art pixel should be source fill, got [${a[0]},${a[1]},${a[2]}]`,
  );
  // Right band (top, clear of the bubble) is reserved white margin — NOT source art.
  const b = ctx.getImageData(composed.width - 4, 4, 1, 1).data;
  assert.ok(
    (b[0] ?? 0) > 240 && (b[1] ?? 0) > 240 && (b[2] ?? 0) > 240,
    `reserved band should be white margin, got [${b[0]},${b[1]},${b[2]}]`,
  );
});

// --- v3 transitions & SFX render modes (#99) -------------------------------

function craftTransition(over: Partial<import("@toony/schema").Transition>) {
  return {
    id: "t",
    type: "gutter" as const,
    gutterHeight: 8,
    text: null,
    sfx: null,
    agentNote: null,
    humanNote: null,
    image: null,
    reviewStatus: "draft" as const,
    ...over,
  };
}

test("black_band composes a solid black band (#99)", async () => {
  const { composeTransitionBand } = await import("../compose.js");
  const band = composeTransitionBand(craftTransition({ type: "black_band" }), 300);
  assert.ok(band);
  // The floor keeps a small-gutter band visible.
  assert.ok(band.height > 0);
  const ctx = band.canvas.getContext("2d");
  const { data } = ctx.getImageData(Math.round(band.width / 2), Math.round(band.height / 2), 1, 1);
  assert.equal(data[3], 255);
  assert.ok((data[0] ?? 255) < 30 && (data[1] ?? 255) < 30 && (data[2] ?? 255) < 30);
});

test("palette_shift fills the band with Transition.color (#99)", async () => {
  const { composeTransitionBand } = await import("../compose.js");
  const band = composeTransitionBand(
    craftTransition({ type: "palette_shift", color: "#3366cc" }),
    300,
  );
  assert.ok(band);
  const ctx = band.canvas.getContext("2d");
  const { data } = ctx.getImageData(Math.round(band.width / 2), Math.round(band.height / 2), 1, 1);
  const near = (got: number | undefined, want: number) => Math.abs((got ?? -999) - want) <= 2;
  assert.ok(near(data[0], 51) && near(data[1], 102) && near(data[2], 204), `got [${data}]`);
});

test("desaturate_repeat composes a neutral gray band (#99 — true cross-cut deferred)", async () => {
  const { composeTransitionBand } = await import("../compose.js");
  const band = composeTransitionBand(craftTransition({ type: "desaturate_repeat" }), 300);
  assert.ok(band);
  const ctx = band.canvas.getContext("2d");
  const { data } = ctx.getImageData(Math.round(band.width / 2), Math.round(band.height / 2), 1, 1);
  // #9a958c — gray (channels close together, mid-range).
  const [r, g, b] = data;
  assert.equal(data[3], 255);
  assert.ok(Math.abs((r ?? 0) - (g ?? 0)) < 25 && Math.abs((g ?? 0) - (b ?? 0)) < 25);
  assert.ok((r ?? 0) > 100 && (r ?? 0) < 200);
});

/** A bare, large SFX overlay for impact-band sampling. */
function sfxImpactOverlay(over: Partial<LetteringOverlay> = {}): LetteringOverlay {
  return {
    id: "sfx-impact",
    cutId: "c",
    speaker: "",
    kind: "sfx",
    text: "BOOM",
    font: "sans-serif",
    fill: "transparent",
    opacity: 1,
    border: null,
    tail: null,
    geometry: { x: 0.3, y: 0.35, width: 0.3, height: 0.3 },
    overflow: false,
    reviewStatus: "draft",
    ...over,
  };
}

/** Count clearly-dark pixels (speed-lines + burst stroke ink). */
function darkInk(canvas: Canvas): number {
  const ctx = canvas.getContext("2d");
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if ((data[i] ?? 255) < 60 && (data[i + 1] ?? 255) < 60 && (data[i + 2] ?? 255) < 60) n++;
  }
  return n;
}

test("impact_band adds speed-lines + burst that typeset SFX does not (#99)", async () => {
  const typeset = await composeCut([sfxImpactOverlay({ sfxMode: "typeset" })], null, 480);
  const impact = await composeCut([sfxImpactOverlay({ sfxMode: "impact_band" })], null, 480);
  assert.equal(impact.width, 480);
  // The impact decoration paints substantially more dark ink (rays + burst) than
  // the same SFX rendered as plain typeset text.
  assert.ok(
    darkInk(impact.canvas) > darkInk(typeset.canvas) + 200,
    `impact ink ${darkInk(impact.canvas)} should exceed typeset ${darkInk(typeset.canvas)}`,
  );
});

test("impact_band speed-lines reach the panel edges (full-width band)", async () => {
  const impact = await composeCut([sfxImpactOverlay({ sfxMode: "impact_band" })], null, 480);
  const ctx = impact.canvas.getContext("2d");
  // A horizontal ray fans to the left/right edge at the vertical center: sample a
  // column near the left edge across the mid band and expect some dark ink.
  const midY = Math.round(impact.height / 2);
  let edgeInk = 0;
  for (let x = 0; x < 12; x++) {
    for (let dy = -8; dy <= 8; dy++) {
      const { data } = ctx.getImageData(x, midY + dy, 1, 1);
      if ((data[0] ?? 255) < 80 && (data[1] ?? 255) < 80 && (data[2] ?? 255) < 80) edgeInk++;
    }
  }
  assert.ok(edgeInk > 0, "expected speed-line ink near the panel edge");
});

test("impact_band does not paint into a sibling gutter bubble's reserved strip (#99)", async () => {
  // An impact_band SFX plus a right-side gutter bubble on the same cut: the
  // reserved right band must stay clean white margin — the rays/burst span only
  // the inset art, never the strip.
  const gutter: LetteringOverlay = {
    id: "gb",
    cutId: "c",
    speaker: "Mina",
    kind: "speech",
    text: "Hi",
    font: "sans-serif",
    fill: "#ffffff",
    opacity: 1,
    border: null,
    tail: null,
    placement: "gutter",
    placementSide: "right",
    geometry: { x: 0.2, y: 0.05, width: 0.6, height: 0.12 },
    overflow: false,
    reviewStatus: "draft",
  };
  const composed = await composeCut(
    [sfxImpactOverlay({ sfxMode: "impact_band" }), gutter],
    null,
    480,
  );
  const ctx = composed.canvas.getContext("2d");
  // Sample deep in the reserved band, low down (clear of the gutter bubble at top):
  // it must be white margin, not impact ink.
  const x = composed.width - 3;
  const y = Math.round(composed.height * 0.85);
  const { data } = ctx.getImageData(x, y, 1, 1);
  assert.ok(
    (data[0] ?? 0) > 240 && (data[1] ?? 0) > 240 && (data[2] ?? 0) > 240,
    `reserved band should be white, got [${data[0]},${data[1]},${data[2]}]`,
  );
});

// --- v4 interstitial panels + fades + bubble verticalAlign (#115) -----------

function avg(canvas: Canvas, x: number, y: number): [number, number, number] {
  const { data } = canvas.getContext("2d").getImageData(x, y, 1, 1);
  return [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0];
}

test("color_field composes a solid mood fill; void is near-black (#115)", async () => {
  const { composeTransitionBand } = await import("../compose.js");
  const cf = composeTransitionBand(craftTransition({ type: "color_field", color: "#3366cc" }), 300);
  assert.ok(cf);
  const [r, g, b] = avg(cf.canvas, Math.round(cf.width / 2), Math.round(cf.height / 2));
  const near = (got: number, want: number) => Math.abs(got - want) <= 2;
  assert.ok(near(r, 51) && near(g, 102) && near(b, 204), `color_field got [${r},${g},${b}]`);
  const vd = composeTransitionBand(craftTransition({ type: "void" }), 300);
  assert.ok(vd);
  const [vr, vg, vb] = avg(vd.canvas, Math.round(vd.width / 2), Math.round(vd.height / 2));
  assert.ok(vr < 20 && vg < 20 && vb < 20, `void got [${vr},${vg},${vb}]`);
});

test("a v4 text card renders light text and honors verticalAlign (#115)", async () => {
  const { composeTransitionBand } = await import("../compose.js");
  // Light-ink mean Y on the dark card: top-aligned text sits higher than bottom.
  const meanY = (canvas: Canvas): number => {
    const ctx = canvas.getContext("2d");
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let sum = 0;
    let n = 0;
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        const i = (y * canvas.width + x) * 4;
        if ((data[i] ?? 0) > 180 && (data[i + 1] ?? 0) > 180 && (data[i + 2] ?? 0) > 150) {
          sum += y;
          n++;
        }
      }
    }
    return n > 0 ? sum / n : Number.NaN;
  };
  const top = composeTransitionBand(
    craftTransition({
      type: "narration_card",
      text: "Later that night",
      verticalAlign: "top",
      gutterHeight: 400,
    }),
    400,
  );
  const bottom = composeTransitionBand(
    craftTransition({
      type: "narration_card",
      text: "Later that night",
      verticalAlign: "bottom",
      gutterHeight: 400,
    }),
    400,
  );
  assert.ok(top && bottom);
  const topY = meanY(top.canvas);
  const bottomY = meanY(bottom.canvas);
  assert.ok(!Number.isNaN(topY) && !Number.isNaN(bottomY), "expected light text ink in both");
  assert.ok(bottomY - topY > 40, `bottom text (${bottomY}) must sit below top text (${topY})`);
});

test("a to_white top_bottom fade lightens the bottom edge of a void panel (#115)", async () => {
  const { composeTransitionBand } = await import("../compose.js");
  const band = composeTransitionBand(
    craftTransition({
      type: "void",
      gutterHeight: 600,
      fade: { type: "to_white", direction: "top_bottom", length: 300 },
    }),
    300,
  );
  assert.ok(band);
  const [tr] = avg(band.canvas, Math.round(band.width / 2), 5); // top: still dark
  const bottom = avg(band.canvas, Math.round(band.width / 2), band.height - 3); // bottom: faded to white
  assert.ok(tr < 30, `top should stay dark, got ${tr}`);
  assert.ok(
    bottom[0] > 200 && bottom[1] > 200 && bottom[2] > 200,
    `bottom should be white, got [${bottom}]`,
  );
});

test("composeCut bubble text honors verticalAlign (#115)", async () => {
  const tall = (v: "top" | "bottom"): LetteringOverlay => ({
    id: "vb",
    cutId: "c",
    speaker: "",
    kind: "narration",
    text: "one",
    font: "sans-serif",
    fill: "#ffffff",
    opacity: 1,
    border: null,
    tail: null,
    fontSize: 32,
    verticalAlign: v,
    geometry: { x: 0.1, y: 0.1, width: 0.8, height: 0.7 },
    overflow: false,
    reviewStatus: "draft",
  });
  const darkInkMeanY = (canvas: Canvas): number => {
    const ctx = canvas.getContext("2d");
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let sum = 0;
    let n = 0;
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        const i = (y * canvas.width + x) * 4;
        if ((data[i] ?? 255) < 90 && (data[i + 1] ?? 255) < 90 && (data[i + 2] ?? 255) < 90) {
          sum += y;
          n++;
        }
      }
    }
    return n > 0 ? sum / n : Number.NaN;
  };
  const top = await composeCut([tall("top")], null, 400);
  const bottom = await composeCut([tall("bottom")], null, 400);
  const topY = darkInkMeanY(top.canvas);
  const bottomY = darkInkMeanY(bottom.canvas);
  assert.ok(!Number.isNaN(topY) && !Number.isNaN(bottomY), "expected text ink in both");
  assert.ok(bottomY - topY > 40, `bottom-aligned text (${bottomY}) must sit below top (${topY})`);
});

test("a full-panel gradient fills top→bottom from the plan (#115)", async () => {
  const { composeTransitionBand } = await import("../compose.js");
  const band = composeTransitionBand(
    craftTransition({
      type: "color_field",
      gradient: { from: "#000000", to: "#ffffff", direction: "top_bottom" },
      gutterHeight: 400,
    }),
    300,
  );
  assert.ok(band);
  const top = avg(band.canvas, Math.round(band.width / 2), 3);
  const bottom = avg(band.canvas, Math.round(band.width / 2), band.height - 3);
  // top_bottom: from(#000) at top → to(#fff) at bottom.
  assert.ok(top[0] < 40 && top[1] < 40 && top[2] < 40, `top should be dark, got [${top}]`);
  assert.ok(
    bottom[0] > 215 && bottom[1] > 215 && bottom[2] > 215,
    `bottom should be light, got [${bottom}]`,
  );
  // bottom_up flips it.
  const flip = composeTransitionBand(
    craftTransition({
      type: "color_field",
      gradient: { from: "#000000", to: "#ffffff", direction: "bottom_up" },
      gutterHeight: 400,
    }),
    300,
  );
  assert.ok(flip);
  const ftop = avg(flip.canvas, Math.round(flip.width / 2), 3);
  assert.ok(ftop[0] > 215, `bottom_up top should be light, got [${ftop}]`);
});
