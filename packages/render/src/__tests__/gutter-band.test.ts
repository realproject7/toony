// The gutter strip's width is the project's, not a constant (#215).
//
// A `placement: gutter` bubble lays out in a reserved strip beside the art. How
// much column that strip takes used to be fixed in this module, so a pack could
// not size the feature its genre is identified by. It is now a declared value
// the layout is given; these tests pin what that value may and may not move.
//
// The strip is reserved in TWO places that must never disagree — `cutPlacementFrame`
// keeps the artwork out of it, `layoutBubble` puts the bubble into it — so most
// of what follows checks one against the other rather than either alone.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GUTTER_BAND_WIDTH_DEFAULT,
  GUTTER_BAND_WIDTH_MAX,
  GUTTER_BAND_WIDTH_MIN,
  type LetteringOverlay,
} from "@toony/schema";
import { cutPlacementFrame, layoutBubble, layoutCut } from "../layout.js";
import { defaultBubbleFontRange, gutterBubbleMinFontSize } from "../text.js";
import { overlay, speechOverlay } from "./fixtures.js";

const W = 800;
const H = 1200;

/** A gutter bubble that fills most of its strip, as both authored packs do. */
function gutter(over: Partial<LetteringOverlay> = {}): LetteringOverlay {
  return overlay({
    id: "g",
    placement: "gutter",
    placementSide: "right",
    geometry: { x: 0.04, y: 0.1, width: 0.92, height: 0.22 },
    ...over,
  });
}

// --- Default unchanged ------------------------------------------------------

test("with no declared width the strip is the default, and declaring it changes nothing", () => {
  for (const side of ["left", "right"] as const) {
    const o = gutter({ placementSide: side });
    const implicit = layoutBubble(o, W, H);
    const explicit = layoutBubble(o, W, H, { gutterBandWidth: GUTTER_BAND_WIDTH_DEFAULT });
    assert.deepEqual(explicit, implicit, `${side}: declaring the default moved the plan`);
    assert.equal(implicit.band?.width, W * GUTTER_BAND_WIDTH_DEFAULT);

    const implicitFrame = cutPlacementFrame([o], W, H);
    const explicitFrame = cutPlacementFrame([o], W, H, GUTTER_BAND_WIDTH_DEFAULT);
    assert.deepEqual(explicitFrame, implicitFrame);
  }
});

test("a declared width leaves an in-panel bubble untouched", () => {
  // Only a gutter bubble reads the strip; everything else must be unmoved, or a
  // project that declares a width would silently reflow its whole episode.
  const wide = layoutBubble(speechOverlay, W, H, { gutterBandWidth: 0.4 });
  assert.deepEqual(wide, layoutBubble(speechOverlay, W, H));
  assert.equal(wide.band, null);
  assert.deepEqual(cutPlacementFrame([speechOverlay], W, H, 0.4), {
    art: { x: 0, y: 0, width: W, height: H },
    bands: [],
  });
});

// --- A pack's width reaches the geometry ------------------------------------

test("a declared width sizes the strip and the art on either side", () => {
  for (const declared of [0.08, 0.25, 0.4]) {
    for (const side of ["left", "right"] as const) {
      const plan = layoutBubble(gutter({ placementSide: side }), W, H, {
        gutterBandWidth: declared,
      });
      const bandW = W * declared;
      assert.ok(plan.band);
      assert.equal(plan.band.width, bandW, `${declared} ${side}: strip width`);
      assert.equal(plan.band.x, side === "left" ? 0 : W - bandW);
      // The art is the rest of the column, and the two never overlap.
      assert.equal(plan.art.width, W - bandW);
      assert.equal(plan.art.x, side === "left" ? bandW : 0);
      assert.equal(plan.art.width + plan.band.width, W);
    }
  }
});

test("the strip the art is kept out of is the strip the bubble is laid into", () => {
  // The one invariant a second copy of the width would break: the cut-level
  // reservation and the per-bubble placement are derived from the same value.
  for (const declared of [0.05, 0.18, 0.33, 0.5]) {
    for (const side of ["left", "right"] as const) {
      const o = gutter({ placementSide: side });
      const frame = cutPlacementFrame([o], W, H, declared);
      const plan = layoutBubble(o, W, H, { gutterBandWidth: declared });
      assert.deepEqual(frame.bands, [plan.band], `${declared} ${side}: reserved vs placed strip`);
      assert.deepEqual(frame.art, plan.art, `${declared} ${side}: art rect`);
      // And the box really sits inside it.
      assert.ok(plan.band);
      assert.ok(plan.box.x >= plan.band.x - 1e-9);
      assert.ok(plan.box.x + plan.box.width <= plan.band.x + plan.band.width + 1e-9);
    }
  }
});

test("layoutCut passes the declared width down to every bubble on the cut", () => {
  const declared = 0.3;
  const o = gutter();
  const [plan] = layoutCut([o], W, H, { gutterBandWidth: declared });
  assert.ok(plan);
  assert.deepEqual(plan, layoutBubble(o, W, H, { gutterBandWidth: declared, cutArt: plan.art }));
  assert.equal(plan.band?.width, W * declared);
});

test("an impact_band SFX spans the art a WIDER strip leaves, not the old one", () => {
  // The cut-level art rect is what a full-width SFX spans; it has to follow the
  // declared strip or the burst would run into the lettering margin.
  const declared = 0.35;
  const plans = layoutCut(
    [
      overlay({ id: "impact", kind: "sfx", sfxMode: "impact_band", text: "BOOM" }),
      gutter({ placementSide: "right" }),
    ],
    W,
    H,
    { gutterBandWidth: declared },
  );
  const impact = plans.find((p) => p.id === "impact");
  assert.ok(impact);
  assert.equal(impact.box.x, 0);
  assert.equal(impact.box.width, W * (1 - declared));
  for (const ray of impact.impact?.rays ?? []) {
    assert.ok(ray.x1 <= W * (1 - declared) + 1 && ray.x2 <= W * (1 - declared) + 1);
  }
});

// --- Normalized geometry still means "a share of the strip" -----------------

test("a gutter bubble's normalized geometry is a share of the strip at any width", () => {
  const geometry = { x: 0.25, y: 0.1, width: 0.5, height: 0.2 };
  for (const declared of [GUTTER_BAND_WIDTH_MIN, 0.18, 0.3, GUTTER_BAND_WIDTH_MAX]) {
    for (const side of ["left", "right"] as const) {
      const plan = layoutBubble(gutter({ geometry, placementSide: side }), W, H, {
        gutterBandWidth: declared,
      });
      assert.ok(plan.band);
      // The SAME fractions of the strip, whatever the strip is worth in px.
      assert.equal(plan.box.width / plan.band.width, geometry.width);
      assert.equal((plan.box.x - plan.band.x) / plan.band.width, geometry.x);
      assert.equal(plan.box.height / plan.band.height, geometry.height);
    }
  }
});

test("a width outside the declarable range still yields a drawable strip", () => {
  // `validateWebtoonValue` rejects these, but a caller can reach the layout
  // without it; a band wider than the column would make the art rect negative.
  for (const bad of [0, -1, 5, Number.NaN, Number.POSITIVE_INFINITY]) {
    const plan = layoutBubble(gutter(), W, H, { gutterBandWidth: bad });
    assert.ok(plan.band);
    assert.ok(plan.band.width > 0 && plan.band.width <= W * GUTTER_BAND_WIDTH_MAX, `bad=${bad}`);
    assert.ok(plan.art.width > 0, `bad=${bad}: art rect collapsed`);
    assert.deepEqual(cutPlacementFrame([gutter()], W, H, bad).bands, [plan.band]);
  }
});

// --- The auto-fit floor is reachable inside the strip -----------------------

test("a gutter line that fits a short cut still fits a tall one (#215)", () => {
  // The defect: the auto-fit floor came off the cut's HEIGHT while the strip
  // comes off its WIDTH, so the taller the cut the less its gutter dialogue
  // could hold — backwards, since a taller panel has MORE margin beside it.
  const o = gutter({ text: "Say something." });
  const short = layoutBubble(o, W, Math.round(W * 0.58), {});
  assert.equal(short.overflow, false, "the fixture must fit at a short aspect");
  for (const aspect of [1.0, 1.4, 2.0, 3.0]) {
    const tall = layoutBubble(o, W, Math.round(W * aspect), {});
    assert.equal(tall.overflow, false, `aspect ${aspect}: the same line stopped fitting`);
  }
});

test("the floor a gutter bubble may descend to comes off the width, not the height", () => {
  const o = gutter({ text: "x".repeat(400) }); // nothing fits: the floor is used
  const heightFloor = (h: number) => defaultBubbleFontRange(h).minFontSize;
  let floor: number | null = null;
  for (const aspect of [1.0, 1.4, 2.0, 3.0]) {
    const height = Math.round(W * aspect);
    const plan = layoutBubble(o, W, height, {});
    assert.equal(plan.overflow, true, `aspect ${aspect}: the fixture must exhaust the descent`);
    assert.ok(plan.band);
    assert.equal(plan.text.fontSize, gutterBubbleMinFontSize(plan.band.width, W));
    assert.ok(plan.text.fontSize < heightFloor(height), `aspect ${aspect}: floor not lowered`);
    // The same floor at every aspect: that is the defect this fixes.
    floor ??= plan.text.fontSize;
    assert.equal(plan.text.fontSize, floor, `aspect ${aspect}: the floor moved with the height`);
  }
});

test("a wider strip buys room for a longer line, not a bigger minimum", () => {
  // A floor that rose with the strip would hand back the column a pack just
  // bought, so a narrower strip lowers the floor and a wider one does not raise
  // it — and the text a gutter bubble can hold never falls as the strip grows.
  const height = Math.round(W * 2);
  const o = gutter({ text: "x".repeat(400) });
  const floorFor = (declared: number) =>
    layoutBubble(o, W, height, { gutterBandWidth: declared }).text.fontSize;
  const base = floorFor(GUTTER_BAND_WIDTH_DEFAULT);
  assert.ok(floorFor(0.08) < base, "a narrower strip must lower the floor with it");
  for (const wider of [0.25, 0.4, GUTTER_BAND_WIDTH_MAX]) {
    assert.equal(floorFor(wider), base, `${wider}: a wider strip raised the floor`);
  }
  // And the room itself grows: the same text wraps to no more lines than before.
  let previous = Number.POSITIVE_INFINITY;
  for (const declared of [GUTTER_BAND_WIDTH_DEFAULT, 0.25, 0.4, GUTTER_BAND_WIDTH_MAX]) {
    const lines = layoutBubble(o, W, height, { gutterBandWidth: declared }).text.lines.length;
    assert.ok(lines <= previous, `${declared}: a wider strip held less text`);
    previous = lines;
  }
});

test("the floor only ever drops, so a bubble that already fits keeps its size", () => {
  // The descent walks DOWN from the maximum and returns the first size that
  // fits. A size at or above the old height-derived floor is therefore one the
  // old descent also reached and also returned: lowering the floor cannot have
  // changed it. Asserting that is how "already fits → unchanged" is pinned
  // without a second implementation of the descent to compare against.
  const o = gutter({ text: "Hey." });
  for (const aspect of [0.58, 1.0, 1.4, 2.0]) {
    const height = Math.round(W * aspect);
    const plan = layoutBubble(o, W, height, {});
    assert.equal(plan.overflow, false, `aspect ${aspect}`);
    assert.ok(
      plan.text.fontSize >= defaultBubbleFontRange(height).minFontSize,
      `aspect ${aspect}: fitted at ${plan.text.fontSize}, below the pre-#215 floor`,
    );
  }
});

test("an in-panel bubble's floor is untouched by the gutter floor", () => {
  const height = Math.round(W * 3);
  const long = { ...speechOverlay, text: "x".repeat(400) };
  const plan = layoutBubble(long, W, height);
  assert.equal(plan.overflow, true);
  assert.equal(plan.text.fontSize, defaultBubbleFontRange(height).minFontSize);
});
