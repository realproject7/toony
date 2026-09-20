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
import { DEFAULT_OVERFLOW_FALLBACK, lintBubbleOverflow } from "../overflow-lint.js";

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

function bundle(cutId: string, overlays: LetteringOverlay[], panelAspect?: number): EpisodeBundle {
  return {
    episode: {
      schemaVersion: 1,
      id: "ep-001",
      title: "Ep",
      sequence: [{ type: "cut", id: cutId }],
    },
    cuts: [
      {
        id: cutId,
        image: null,
        imagePrompt: "",
        negativePrompt: "",
        ...(panelAspect === undefined ? {} : { panelAspect }),
      },
    ],
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

// --- The shape the cut declares (#260) --------------------------------------
//
// Every cut in a pack's genre scaffold is art-less, so before #260 a declared
// shape reached nothing here and every one of them was measured on the 1200x1600
// fallback. The two fixtures below are the same narration line in a strip box,
// differing only in how much of the cut the box takes, and they fail in opposite
// directions — which is why both are here. The whole error is in the stage: what
// fits a box depends on the font floor, and that floor is derived from the
// render HEIGHT.

/** A narration line long enough that the font floor decides whether it fits. */
const NARRATION = "The market wakes before the city does, and the fish are already gone by seven.";

/** Box heights, as a fraction of the cut, that discriminate between stages. */
const MISSED_BOX: BubbleGeometry = { x: 0.05, y: 0.05, width: 0.9, height: 0.08 };
const FALSE_POSITIVE_BOX: BubbleGeometry = { x: 0.05, y: 0.05, width: 0.9, height: 0.05 };

test("a TALL declared cut is measured at its own shape, not the fallback", () => {
  // The missed detection the ticket was opened about: the box holds the line on
  // the portrait fallback, and does not hold it on the 2.6-of-a-width panel the
  // pack actually asks for. Lint passed it, and only a render found it.
  const o = overlay("ov-1", "cut-001", NARRATION, MISSED_BOX);
  assert.deepEqual(
    lintBubbleOverflow(bundle("cut-001", [o]), () => null),
    [],
    "the fixture must fit the fallback stage, or it proves nothing",
  );

  const findings = lintBubbleOverflow(bundle("cut-001", [o], 2.6), () => null);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.code, "lettering/overflow");
  assert.equal(findings[0]?.targetId, "ov-1");
});

test("a SHORT declared cut is too, and that CLEARS a finding", () => {
  // The same defect in the other direction, and the reason this is a stage fix
  // rather than a stricter check: on the fallback the line does not fit, on the
  // 0.3-of-a-width strip the pack declares it does. Reporting it was wrong.
  const o = overlay("ov-1", "cut-001", NARRATION, FALSE_POSITIVE_BOX);
  assert.equal(
    lintBubbleOverflow(bundle("cut-001", [o]), () => null).length,
    1,
    "the fixture must overflow the fallback stage, or it proves nothing",
  );
  assert.deepEqual(
    lintBubbleOverflow(bundle("cut-001", [o], 0.3), () => null),
    [],
  );
});

test("a cut that HAS art is measured at the art, whatever it declares", () => {
  // The page takes a panel's height from the image it was generated at; nothing
  // re-cuts an image to match a declaration made after it. So a declaration must
  // not re-stage a cut that already carries art — if it did, this lint would be
  // measuring bubbles against a page that does not exist.
  //
  // The art is sized so the two answers DIFFER: the line fits this 300x400
  // panel and does not fit the 300x780 one a declared 2.6 would stage. A
  // fixture where both overflow would pass whichever shape won.
  const o = overlay("ov-1", "cut-001", NARRATION, MISSED_BOX);
  const art = encodePng(makeSolidRaster(300, 400, 3, 128));
  assert.equal(layoutBubble(o, 300, Math.round(300 * 2.6)).overflow, true);
  assert.deepEqual(
    lintBubbleOverflow(bundle("cut-001", [o]), () => art),
    [],
  );
  assert.deepEqual(
    lintBubbleOverflow(bundle("cut-001", [o], 2.6), () => art),
    [],
  );
});

/**
 * The first canvas height at which this overlay's overflow flips, read off the
 * render core itself rather than pinned here — so the boundary is re-derived if
 * the measurer or the font floor ever moves.
 */
function flipHeight(o: LetteringOverlay, width: number): number {
  for (let h = 201; h <= 4000; h++) {
    if (layoutBubble(o, width, h).overflow !== layoutBubble(o, width, h - 1).overflow) return h;
  }
  throw new Error("no flip height in range: this fixture no longer discriminates by one pixel");
}

test("a cut that declares nothing is staged at the fallback SIZE, to the pixel", () => {
  // The back-compat claim, made sharp. An art-less cut declaring nothing now
  // reaches its height through a ratio — `fallback.height / fallback.width`
  // multiplied back out — and "close enough" is not the claim: it must be the
  // same canvas it was before, exactly. Asserted at a height where one pixel
  // changes the answer, so an off-by-one cannot hide.
  const o = overlay("ov-1", "cut-001", NARRATION, FALSE_POSITIVE_BOX);
  const width = DEFAULT_OVERFLOW_FALLBACK.width;
  const flip = flipHeight(o, width);
  const b = bundle("cut-001", [o]);

  const at = lintBubbleOverflow(b, () => null, { fallback: { width, height: flip } });
  const below = lintBubbleOverflow(b, () => null, { fallback: { width, height: flip - 1 } });
  assert.notEqual(at.length, below.length, "the fixture stopped discriminating one pixel");
  assert.equal(at.length > 0, layoutBubble(o, width, flip).overflow);
  assert.equal(below.length > 0, layoutBubble(o, width, flip - 1).overflow);

  // And on the SHIPPED fallback, the size this lint has always used.
  assert.equal(
    lintBubbleOverflow(b, () => null).length > 0,
    layoutBubble(o, DEFAULT_OVERFLOW_FALLBACK.width, DEFAULT_OVERFLOW_FALLBACK.height).overflow,
  );
});

test("a header claiming a zero axis falls back rather than laying out on nothing", () => {
  // Shared with the panel-shape check through `readCutDimensions`: a 0x0 header
  // is not a cut size. The fixture is one that FITS the fallback stage, so a
  // lint that took the header at face value collapses every box to nothing and
  // reports — a check that compared two overflowing results would pass either
  // way.
  const o = overlay("ov-1", "cut-001", NARRATION, MISSED_BOX);
  const zero = encodePng(makeSolidRaster(0, 0, 3, 128));
  assert.deepEqual(
    lintBubbleOverflow(bundle("cut-001", [o]), () => null),
    [],
  );
  assert.deepEqual(
    lintBubbleOverflow(bundle("cut-001", [o]), () => zero),
    [],
  );
});
