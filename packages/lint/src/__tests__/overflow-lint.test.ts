import assert from "node:assert/strict";
import { test } from "node:test";

import { gutterBubbleMinFontSize, layoutBubble } from "@toony/render";
import {
  type BubbleGeometry,
  type EpisodeBundle,
  GUTTER_BAND_WIDTH_DEFAULT,
  type LetteringOverlay,
} from "@toony/schema";
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

// The cut sizes and box heights both facts below are measured over. Real
// shapes: portrait and landscape cuts, a square one, and boxes from a one-line
// strip label to one filling most of the strip.
const FLOOR_SWEEP_CUTS: [number, number][] = [
  [1200, 1275],
  [1200, 694],
  [800, 1120],
  [1600, 694],
  [1200, 2400],
  [900, 900],
];
const FLOOR_SWEEP_HEIGHTS = [0.06, 0.08, 0.12, 0.2, 0.35, 0.5, 0.7, 0.85];

/**
 * A strip-filling gutter bubble whose text is `chars` body glyphs on one line,
 * pinned to the auto-fit FLOOR of the default strip. One unbreakable token, so
 * the wrap cannot rescue it: this is the worst case for a line of that length.
 */
function atTheFloor(
  chars: number,
  frameWidth: number,
  geometryHeight: number,
  over: Partial<LetteringOverlay> = {},
): LetteringOverlay {
  const bandWidth = frameWidth * GUTTER_BAND_WIDTH_DEFAULT;
  return {
    ...overlay("ov-floor", "cut-001", "e".repeat(chars), {
      x: 0.04,
      y: 0.1,
      width: 0.92, // what both authored packs set; an authoring habit, not a rule
      height: geometryHeight,
    }),
    placement: "gutter",
    placementSide: "right",
    fontSize: gutterBubbleMinFontSize(bandWidth, frameWidth),
    ...over,
  };
}

test("squared off, a gutter balloon holds a craft-length line at its auto-fit floor", () => {
  // `gutterBubbleMinFontSize` is derived from the craft line-length limit, and
  // that limit lives in THIS package — the render core cannot import it. So the
  // derivation is checked here, and through the REAL layout rather than a second
  // copy of its padding arithmetic: if either number moves, or the padding or
  // the measurer does, this fails instead of the two drifting apart.
  //
  // With the corners squared the box padding is the whole story, and the
  // derivation holds everywhere.
  for (const [frameWidth, frameHeight] of FLOOR_SWEEP_CUTS) {
    for (const height of FLOOR_SWEEP_HEIGHTS) {
      const plan = layoutBubble(
        atTheFloor(CRAFT_MAX_LINE_CHARS, frameWidth, height, { cornerRadius: 0 }),
        frameWidth,
        frameHeight,
      );
      assert.equal(
        plan.overflow,
        false,
        `${frameWidth}x${frameHeight} box height ${height}: a ${CRAFT_MAX_LINE_CHARS}-character line did not fit at the floor`,
      );
    }
  }
});

test("a rounded gutter balloon holds fewer, and the docs say so", () => {
  // The other half of the same claim, because the comment on the fraction and
  // docs/PACK_FORMAT.md both state it: a balloon's corner arcs take a further
  // bite out of the first and last lines (#210), the bite grows with the corner
  // radius, and the radius grows with the box. So the default ROUNDED balloon
  // does not hold a craft-length line at the floor everywhere...
  const roundedFailures = FLOOR_SWEEP_CUTS.flatMap(([w, h]) =>
    FLOOR_SWEEP_HEIGHTS.filter(
      (height) => layoutBubble(atTheFloor(CRAFT_MAX_LINE_CHARS, w, height), w, h).overflow,
    ),
  );
  assert.ok(
    roundedFailures.length > 0,
    "the arcs no longer bite: the fraction can be re-derived without them, and the docs' caveat is now wrong",
  );

  // ...and what it does hold is this, measured over the same sweep. A lower
  // bound, not a promise of exactly sixteen: it may only ever rise.
  const FLOOR_LINE_CHARS = 16;
  assert.ok(FLOOR_LINE_CHARS < CRAFT_MAX_LINE_CHARS);
  for (const [frameWidth, frameHeight] of FLOOR_SWEEP_CUTS) {
    for (const height of FLOOR_SWEEP_HEIGHTS) {
      const plan = layoutBubble(
        atTheFloor(FLOOR_LINE_CHARS, frameWidth, height),
        frameWidth,
        frameHeight,
      );
      assert.equal(
        plan.overflow,
        false,
        `${frameWidth}x${frameHeight} box height ${height}: even ${FLOOR_LINE_CHARS} characters did not fit at the floor`,
      );
    }
  }
});
