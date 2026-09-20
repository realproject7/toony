import assert from "node:assert/strict";
import { test } from "node:test";

import { approximateMeasure, gutterBubbleMinFontSize } from "@toony/render";
import type { BubbleGeometry, EpisodeBundle, LetteringOverlay } from "@toony/schema";
import { encodePng, makeSolidRaster } from "../__fixtures__/images.js";
import { CRAFT_MAX_LINE_CHARS } from "../craft-lint.js";
import { lintBubbleOverflow } from "../overflow-lint.js";

function overlay(
  id: string,
  cutId: string,
  text: string,
  geometry: BubbleGeometry,
): LetteringOverlay {
  return {
    id,
    cutId,
    speaker: "",
    kind: "speech",
    text,
    font: "sans",
    fill: "",
    opacity: 1,
    border: null,
    tail: null,
    geometry,
    overflow: false,
    reviewStatus: "draft",
  };
}

function bundle(cutId: string, overlays: LetteringOverlay[]): EpisodeBundle {
  return {
    episode: {
      schemaVersion: 1,
      id: "ep-001",
      title: "Ep",
      sequence: [{ type: "cut", id: cutId }],
    },
    cuts: [{ id: cutId, image: null, imagePrompt: "", negativePrompt: "" }],
    transitions: [],
    lettering: overlays,
  };
}

const TINY_BOX: BubbleGeometry = { x: 0.1, y: 0.1, width: 0.05, height: 0.03 };
const BIG_BOX: BubbleGeometry = { x: 0.05, y: 0.05, width: 0.8, height: 0.7 };

test("long text in a tiny box overflows and is reported as a warning", () => {
  const o = overlay(
    "ov-1",
    "cut-001",
    "This is a very long line that cannot fit a tiny box.",
    TINY_BOX,
  );
  const findings = lintBubbleOverflow(bundle("cut-001", [o]), () => null);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.code, "lettering/overflow");
  assert.equal(findings[0]?.severity, "warning");
  assert.equal(findings[0]?.targetId, "ov-1");
});

test("short text in a big box does not overflow", () => {
  const o = overlay("ov-1", "cut-001", "Hi", BIG_BOX);
  assert.deepEqual(
    lintBubbleOverflow(bundle("cut-001", [o]), () => null),
    [],
  );
});

test("a cut with no overlays produces no findings", () => {
  assert.deepEqual(
    lintBubbleOverflow(bundle("cut-001", []), () => null),
    [],
  );
});

test("a readable image's header dimensions drive the layout", () => {
  // Short text in a big box fits under the portrait fallback, but the same
  // overlay overflows when the cut's real image is 2x2 px (the box collapses to
  // ~1px). The flip proves the resolver's bytes — not the fallback — set the size.
  const o = overlay("ov-1", "cut-001", "Hi", BIG_BOX);
  assert.deepEqual(
    lintBubbleOverflow(bundle("cut-001", [o]), () => null),
    [],
  );

  const tiny = encodePng(makeSolidRaster(2, 2, 3, 128));
  const findings = lintBubbleOverflow(bundle("cut-001", [o]), () => tiny);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.code, "lettering/overflow");
});

// --- The gutter strip the lint measures against (#215) ----------------------

test("the overflow lint measures a gutter bubble against the PROJECT's strip", () => {
  // The whole point of a pack being able to widen the strip: text that does not
  // fit the default one, and did fit nothing else, fits when the project says
  // the strip is wider. A lint stuck on the constant would keep reporting it.
  const o = overlay("ov-g", "cut-001", "This line needs more column than the default strip.", {
    x: 0.04,
    y: 0.1,
    width: 0.92,
    height: 0.03,
  });
  const gutter: LetteringOverlay = { ...o, placement: "gutter", placementSide: "right" };
  const b = bundle("cut-001", [gutter]);
  assert.equal(
    lintBubbleOverflow(b, () => null).length,
    1,
    "expected the default strip to be tight",
  );
  assert.deepEqual(
    lintBubbleOverflow(b, () => null, { gutterBandWidth: 0.45 }),
    [],
  );
  // An in-panel bubble is untouched by the declared strip.
  const inPanel = bundle("cut-001", [o]);
  assert.deepEqual(
    lintBubbleOverflow(inPanel, () => null, { gutterBandWidth: 0.45 }),
    lintBubbleOverflow(inPanel, () => null),
  );
});

test("a gutter bubble's auto-fit floor can hold a craft-length line in its strip", () => {
  // `gutterBubbleMinFontSize` is derived from the craft line-length limit, and
  // that limit lives in THIS package — the render core cannot import it. So the
  // derivation is checked here, by measuring a line of exactly that length at
  // the floor against the text column a strip-filling gutter bubble has. If
  // either number moves, this fails rather than the two quietly drifting apart.
  const line = "e".repeat(CRAFT_MAX_LINE_CHARS); // a body glyph: the common case
  for (const frameWidth of [600, 1200, 2400]) {
    // The floor is capped at the default strip, so that is where it binds; a
    // narrower strip lowers it in proportion and stays inside its own column.
    const bandWidth = frameWidth * 0.18;
    const box = bandWidth * 0.92; // what both authored packs set
    const column = box - 2 * Math.max(2, box * 0.06); // the layout's own padding
    const width = approximateMeasure(line, gutterBubbleMinFontSize(bandWidth, frameWidth));
    assert.ok(
      width <= column,
      `a ${CRAFT_MAX_LINE_CHARS}-character line needs ${width.toFixed(1)}px in a ${column.toFixed(1)}px column`,
    );
  }
});
