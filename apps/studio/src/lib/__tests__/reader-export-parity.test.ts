// Reader-vs-export parity for a cut with no linked art (#211).
//
// Lettering an episode before the art exists is a supported workflow, and the
// export draws it: `composeCut` fills a neutral stage of the fallback aspect and
// lays the bubbles onto it. The reader has to show the same thing, and used to
// show "No image yet" instead.
//
// `CutCanvas` is React and cannot run in this node harness, so what runs here is
// the reader's own resolved inputs: `resolveCutArt`'s art for an art-less cut,
// then the shared `cutPlacementFrame`/`layoutCut` the component feeds them to.
// Those are compared against the PIXELS of a real exported raster. The two sides
// are never asserted in isolation: every check reads a number off the reader's
// stage and a pixel off the export's canvas.

import assert from "node:assert/strict";
import { resolve, sep } from "node:path";
import { test } from "node:test";
import { composeCut } from "@toony/export";
import { ARTLESS_CUT_FILL, cutPlacementFrame, GUTTER_MARGIN_FILL, layoutCut } from "@toony/render";
import type { Cut, LetteringOverlay } from "@toony/schema";
import { resolveCutArt } from "../project.js";

/** Export raster width. Every comparison below is scale-free. */
const RASTER_WIDTH = 600;

const WORK_ID = "sunday-market";
const WORK_ROOT = resolve(sep, "workspace", "works", WORK_ID);

/** A cut with nothing linked: the "lettered before the art exists" case. */
function artlessCut(): Cut {
  return { id: "cut-002", image: null, imagePrompt: "", negativePrompt: "" };
}

function bubble(id: string, over: Partial<LetteringOverlay> = {}): LetteringOverlay {
  return {
    id,
    cutId: "cut-002",
    speaker: "Mira",
    kind: "speech",
    text: "The stall opens at six.",
    font: "sans-serif",
    fill: "#ffffff",
    opacity: 1,
    border: null,
    tail: null,
    geometry: { x: 0.08, y: 0.06, width: 0.5, height: 0.14 },
    overflow: false,
    reviewStatus: "human-edited",
    ...over,
  };
}

/** The two bubbles, well clear of each other and of the middle of the frame. */
function bubbles(): LetteringOverlay[] {
  return [
    bubble("ov-top"),
    bubble("ov-bottom", {
      speaker: "Jun",
      text: "Then we are late.",
      geometry: { x: 0.36, y: 0.74, width: 0.55, height: 0.16 },
    }),
  ];
}

/** `#rrggbb` to `[r,g,b]`. */
function rgb(color: string): [number, number, number] {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  assert.ok(m, `expected an opaque hex color, got "${color}"`);
  return [
    Number.parseInt(m[1] as string, 16),
    Number.parseInt(m[2] as string, 16),
    Number.parseInt(m[3] as string, 16),
  ];
}

interface Raster {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** Read one raster pixel as `[r,g,b,a]`. */
function pixel(raster: Raster, x: number, y: number): [number, number, number, number] {
  const i = (y * raster.width + x) * 4;
  return [
    raster.data[i] ?? -1,
    raster.data[i + 1] ?? -1,
    raster.data[i + 2] ?? -1,
    raster.data[i + 3] ?? -1,
  ];
}

/** Whether a raster pixel is `color`, allowing for encode/scale rounding. */
function isColor(raster: Raster, x: number, y: number, color: string): boolean {
  const [r, g, b, a] = pixel(raster, x, y);
  const want = rgb(color);
  return (
    a === 255 &&
    Math.abs(r - want[0]) <= 2 &&
    Math.abs(g - want[1]) <= 2 &&
    Math.abs(b - want[2]) <= 2
  );
}

/**
 * Count the pixels in a raster rect that are NOT the neutral paper, which is to
 * say the lettering. The rect is given in fractions of the frame, which is how
 * the reader's stage expresses every position it draws.
 */
function inkInFraction(
  raster: Raster,
  frac: { x: number; y: number; width: number; height: number },
): { ink: number; total: number } {
  const x0 = Math.round(frac.x * raster.width);
  const y0 = Math.round(frac.y * raster.height);
  const x1 = Math.min(raster.width, Math.round((frac.x + frac.width) * raster.width));
  const y1 = Math.min(raster.height, Math.round((frac.y + frac.height) * raster.height));
  let ink = 0;
  let total = 0;
  for (let y = Math.max(0, y0); y < y1; y++) {
    for (let x = Math.max(0, x0); x < x1; x++) {
      total++;
      if (!isColor(raster, x, y, ARTLESS_CUT_FILL)) ink++;
    }
  }
  return { ink, total };
}

/** Compose an art-less cut and read its pixels back. */
async function exportRaster(overlays: LetteringOverlay[]): Promise<Raster> {
  const composed = await composeCut(overlays, null, RASTER_WIDTH);
  const ctx = composed.canvas.getContext("2d");
  const { data } = ctx.getImageData(0, 0, composed.width, composed.height);
  return { width: composed.width, height: composed.height, data };
}

test("the reader's art-less stage is the shape the export rasterizes (#211)", async () => {
  const art = await resolveCutArt(WORK_ID, WORK_ROOT, artlessCut());
  // The reader draws no artwork, so the stage IS the whole comparison.
  assert.equal(art.src, null);

  const raster = await exportRaster(bubbles());
  // The reader's stage is a CSS `aspect-ratio: art.width / art.height` box; the
  // raster's shape is measured off the canvas it actually produced. 1.414 vs 1.4
  // is what these were before, which put every normalized position 1% off.
  assert.equal(raster.height, Math.round(raster.width * (art.height / art.width)));
});

test("the reader's art-less paper is the color the export fills (#211)", async () => {
  const raster = await exportRaster(bubbles());
  // Mid-frame, between the two bubbles: bare paper in both. `ARTLESS_CUT_FILL` is
  // what the reader's blank art layer is painted with, and this asserts the
  // exported pixels there are that same color.
  const x = Math.round(raster.width * 0.5);
  const y = Math.round(raster.height * 0.5);
  assert.ok(
    isColor(raster, x, y, ARTLESS_CUT_FILL),
    `exported paper at mid-frame was [${pixel(raster, x, y).join(",")}], not ${ARTLESS_CUT_FILL}`,
  );
});

test("the export's lettering lands where the reader places it (#211)", async () => {
  const art = await resolveCutArt(WORK_ID, WORK_ROOT, artlessCut());
  const overlays = bubbles();
  // The reader's own layout call, at its own stage dimensions.
  const plans = layoutCut(overlays, art.width, art.height);
  assert.equal(plans.length, overlays.length);

  const raster = await exportRaster(overlays);
  for (const plan of plans) {
    // The middle third of the reader's bubble box, as a fraction of ITS stage,
    // read on the export's raster. At mid-height the balloon spans the full box
    // width (the rounded corners only cut the top and bottom), so every pixel of
    // this rect must be bubble, not paper.
    const { ink, total } = inkInFraction(raster, {
      x: plan.box.x / art.width,
      y: (plan.box.y + plan.box.height / 3) / art.height,
      width: plan.box.width / art.width,
      height: plan.box.height / 3 / art.height,
    });
    assert.ok(total > 0, `bubble ${plan.id} mapped to an empty region of the raster`);
    assert.ok(
      ink / total > 0.98,
      `bubble ${plan.id}: only ${ink}/${total} exported pixels inside the reader's box are lettering`,
    );
  }

  // The negative control: the band the reader leaves as bare paper between the
  // two bubbles. Without it the check above would also pass for an export that
  // flooded the whole frame.
  const [upper, lower] = [...plans].sort((a, b) => a.box.y - b.box.y);
  assert.ok(upper && lower && plans.length === 2);
  const gapTop = (upper.box.y + upper.box.height) / art.height;
  const gapBottom = lower.box.y / art.height;
  assert.ok(gapBottom - gapTop > 0.1, "the fixture must leave a bare band between its bubbles");
  // Inset so the balloon strokes, which straddle the box edge, stay outside.
  const gap = inkInFraction(raster, {
    x: 0,
    y: gapTop + 0.02,
    width: 1,
    height: gapBottom - gapTop - 0.04,
  });
  assert.ok(gap.total > 0);
  assert.equal(gap.ink, 0, `${gap.ink} exported pixels of lettering where the reader draws none`);
});

test("an art-less gutter cut reserves the same strip in the reader and the export (#211)", async () => {
  const art = await resolveCutArt(WORK_ID, WORK_ROOT, artlessCut());
  const overlays = [
    bubble("ov-gutter", {
      kind: "narration",
      text: "Later, the market empties.",
      placement: "gutter",
      placementSide: "right",
      geometry: { x: 0.1, y: 0.3, width: 0.8, height: 0.2 },
    }),
  ];
  // The reader insets its blank art layer to this rect and leaves the band as
  // reading margin, the same call `CutCanvas` makes to place its art layer.
  const frame = cutPlacementFrame(overlays, art.width, art.height);
  const band = frame.bands[0];
  assert.ok(band && frame.bands.length === 1);

  const raster = await exportRaster(overlays);
  // Inside the reader's art rect: neutral paper. Inside the reserved band, clear
  // of the bubble: reading margin. Both sampled off the raster at the centre of
  // the rect the reader's own frame puts them in.
  const artX = Math.round(((frame.art.x + frame.art.width / 2) / art.width) * raster.width);
  const bandX = Math.round(((band.x + band.width / 2) / art.width) * raster.width);
  const y = Math.round(raster.height * 0.05);
  assert.ok(
    isColor(raster, artX, y, ARTLESS_CUT_FILL),
    `exported art rect was [${pixel(raster, artX, y).join(",")}], not ${ARTLESS_CUT_FILL}`,
  );
  assert.ok(
    isColor(raster, bandX, y, GUTTER_MARGIN_FILL),
    `exported gutter band was [${pixel(raster, bandX, y).join(",")}], not ${GUTTER_MARGIN_FILL}`,
  );
});
