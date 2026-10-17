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

/**
 * Prose long enough to exhaust the auto-fit descent in a short gutter box, so
 * the plan's `fontSize` IS the floor and `overflow` is true. Wrappable, not one
 * long token: the wrap has to be able to use the column it is given.
 */
const EXHAUSTING_PROSE = "the rain kept on and nobody came to the door ".repeat(6);

/** Prose that fits at every strip width below, so the size it fits AT is the subject. */
const FITTING_PROSE =
  "the rain kept on and nobody came to the door at all that night or the next one either";

/** A box short enough that the auto-fit descent runs out of room vertically. */
const SHORT_BOX = { x: 0.04, y: 0.1, width: 0.92, height: 0.06 };

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

test("a degenerate canvas reserves no strip at all", () => {
  // A zero-width rect is truthy, so reporting it as a band would have a consumer
  // inset its artwork out of a margin that does not exist — where before the
  // strip existed it drew full-bleed. On a zero-width cut there is no strip.
  for (const side of ["left", "right"] as const) {
    const frame = cutPlacementFrame([gutter({ placementSide: side })], 0, H);
    assert.deepEqual(frame.bands, [], `${side}: a zero-width canvas reported a strip`);
    assert.equal(frame.art.x, 0);
    assert.ok(frame.art.width > 0, "the art rect must stay drawable");
  }
  // And a canvas with width still reserves one, so the guard is about zero and
  // not about switching the feature off.
  assert.equal(cutPlacementFrame([gutter()], W, H).bands.length, 1);
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
  // Text that nothing fits, in a box short enough that the descent runs out:
  // the size on the plan is then the floor itself, not a size that happened to
  // fit above it.
  const o = gutter({ text: EXHAUSTING_PROSE, geometry: SHORT_BOX });
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

test("the floor scales down with a narrow strip and is capped at the default", () => {
  // A floor that rose with the strip would hand back the column a pack just
  // bought. So below the default it scales in proportion — a 0.05 strip cannot
  // honour the 0.18 floor — and at or above the default it stops. BOTH halves
  // are swept: a sweep that only sampled above the cap would pass just as well
  // on an implementation that had no cap at all.
  const band = (declared: number) => W * declared;
  const base = gutterBubbleMinFontSize(band(GUTTER_BAND_WIDTH_DEFAULT), W);
  let previous = 0;
  for (const narrower of [GUTTER_BAND_WIDTH_MIN, 0.08, 0.12, 0.15]) {
    const floor = gutterBubbleMinFontSize(band(narrower), W);
    assert.ok(floor < base, `${narrower}: a narrower strip must lower the floor with it`);
    assert.ok(floor > previous, `${narrower}: the floor did not follow the strip down`);
    previous = floor;
  }
  for (const wider of [0.2, 0.25, 0.4, GUTTER_BAND_WIDTH_MAX]) {
    assert.equal(gutterBubbleMinFontSize(band(wider), W), base, `${wider}: the cap did not hold`);
  }

  // …and the layout really descends to that number at a narrow strip too, not
  // only at the default the test above uses.
  const height = Math.round(W * 2);
  const o = gutter({ text: EXHAUSTING_PROSE, geometry: SHORT_BOX });
  for (const narrow of [0.12, 0.15]) {
    const plan = layoutBubble(o, W, height, { gutterBandWidth: narrow });
    assert.equal(plan.overflow, true, `${narrow}: the fixture must exhaust the descent`);
    assert.ok(plan.band);
    assert.equal(plan.text.fontSize, gutterBubbleMinFontSize(plan.band.width, W));
    assert.ok(plan.text.fontSize < base, `${narrow}: the narrow strip kept the default floor`);
  }
});

test("a wider strip buys room for a longer line", () => {
  // The point of the cap: the same prose is set LARGER and stacks into fewer
  // lines as the strip grows. Wrappable text, because a single unbreakable token
  // cannot use extra column at all — see the non-monotonic case below.
  const height = Math.round(W * 2);
  const o = gutter({
    text: FITTING_PROSE,
    geometry: { x: 0.04, y: 0.1, width: 0.92, height: 0.3 },
  });
  const sweep = [GUTTER_BAND_WIDTH_MIN, 0.08, 0.12, GUTTER_BAND_WIDTH_DEFAULT, 0.25, 0.4];
  let lastFont = 0;
  const lines: number[] = [];
  for (const declared of sweep) {
    const plan = layoutBubble(o, W, height, { gutterBandWidth: declared });
    assert.equal(plan.overflow, false, `${declared}: the fixture must fit`);
    assert.ok(plan.text.fontSize > lastFont, `${declared}: a wider strip set no larger`);
    lastFont = plan.text.fontSize;
    lines.push(plan.text.lines.length);
  }
  // Line count falls across the sweep. Not at every step: below a point the box
  // HEIGHT caps the size before the strip's width does, and the wrap is unmoved.
  for (let i = 1; i < lines.length; i++) {
    assert.ok((lines[i] ?? 0) <= (lines[i - 1] ?? 0), `${sweep[i]}: a wider strip held less text`);
  }
  assert.ok(
    (lines.at(-1) ?? 0) < (lines[0] ?? 0),
    "the widest strip held no more than the narrowest",
  );
});

test("a single unbreakable token can fit a narrow strip and not a middling one", () => {
  // Recorded, not asserted away. A balloon's corner radius grows with its box
  // and therefore with the strip, while the vertical padding the arcs are
  // measured from does not — so between about 0.10 and 0.18 the arc takes more
  // column than the wider strip hands back, and a token that cannot be wrapped
  // out of the arc's way stops fitting before it starts fitting again. Prose
  // does not hit it (the test above), and docs/PACK_FORMAT.md warns a band
  // author who is lettering something unbreakable.
  const token = gutter({
    text: "e".repeat(24),
    geometry: { x: 0.04, y: 0.1, width: 0.92, height: 0.6 },
  });
  const overflowAt = (declared: number) =>
    layoutBubble(token, 1600, 694, { gutterBandWidth: declared }).overflow;
  assert.equal(overflowAt(0.08), false);
  assert.equal(overflowAt(0.12), true, "the dip is gone: PACK_FORMAT.md's warning is now wrong");
  assert.equal(overflowAt(GUTTER_BAND_WIDTH_DEFAULT), true);
  assert.equal(overflowAt(0.25), false);
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

test("a gutter-placed impact_band SFX keeps the height floor: its box is the art", () => {
  // `placement: "gutter"` with `sfxMode: "impact_band"` is schema-valid, and the
  // impact box is overwritten with the cut's ART rect — so the bubble is not in
  // the strip at all, and the strip's floor would be the wrong one to give it.
  // Pinned against the same SFX in panel, which is the geometry it really has.
  const height = Math.round(W * 3);
  const impact = { text: EXHAUSTING_PROSE, kind: "sfx" as const, sfxMode: "impact_band" as const };
  const inPanel = layoutBubble(overlay({ id: "s", ...impact }), W, height);
  const inGutter = layoutBubble(
    overlay({ id: "s", ...impact, placement: "gutter", placementSide: "right" }),
    W,
    height,
  );
  assert.equal(inPanel.overflow, true, "the fixture must exhaust the descent");
  assert.equal(inGutter.overflow, true);
  assert.ok(inGutter.band, "the plan still reports the strip it declared");
  assert.equal(
    inGutter.text.fontSize,
    inPanel.text.fontSize,
    "a full-width SFX took the strip's floor although its box is the artwork",
  );
  assert.ok(inGutter.text.fontSize > gutterBubbleMinFontSize(inGutter.band.width, W));
});

// --- What the floor change moves, and what it leaves alone ------------------
//
// The amended AC 2: byte-for-byte holds for a project with no gutter bubble and
// for every gutter bubble that already fitted, and NOT for one that overflowed
// at every size — which is the bug the ticket was opened about. "Before" is the
// old floor, `defaultBubbleFontRange(height).minFontSize`, so both halves can be
// pinned here without a second copy of the renderer to compare against.

test("a gutter bubble that fitted before the floor moved is unchanged by it", () => {
  // The descent walks DOWN from the maximum and returns the first size that
  // fits, reading the floor only as a stop. A size at or above the old floor is
  // one the old descent reached and returned too, so lowering the stop cannot
  // have moved it.
  const o = gutter({ text: "Hey." });
  for (const aspect of [0.58, 1.0, 1.4, 2.0, 3.0]) {
    const height = Math.round(W * aspect);
    const plan = layoutBubble(o, W, height, {});
    assert.equal(plan.overflow, false, `aspect ${aspect}`);
    assert.ok(
      plan.text.fontSize >= defaultBubbleFontRange(height).minFontSize,
      `aspect ${aspect}: fitted at ${plan.text.fontSize}, below the pre-#215 floor`,
    );
  }
});

test("a gutter bubble that overflowed at every size now fits, smaller", () => {
  // The exception, measured rather than asserted. The romance case from the
  // ticket: a 1200x1275 cut, the default strip, a line that did not fit at any
  // size the old descent could reach — 28.05px and flagged, now 26.75px and not.
  const frameWidth = 1200;
  const frameHeight = 1275;
  const o = gutter({
    text: "Still no answer from the other side.",
    geometry: { x: 0.04, y: 0.1, width: 0.92, height: 0.12 },
  });
  const oldFloor = defaultBubbleFontRange(frameHeight).minFontSize;

  // Before: the old floor was the smallest size the descent could try, and the
  // line did not fit at it — so no size it could reach fitted, and the plan came
  // back flagged. Pinning the size makes that the layout's own answer.
  const atOldFloor = layoutBubble({ ...o, fontSize: oldFloor }, frameWidth, frameHeight);
  assert.equal(atOldFloor.overflow, true, "the fixture must not fit at the pre-#215 floor");

  // After: it fits, at a size strictly below that floor. Smaller text is the
  // whole of what an author sees change, and only on a bubble that was reporting
  // overflow before.
  const now = layoutBubble(o, frameWidth, frameHeight);
  assert.equal(now.overflow, false, "the line still does not fit");
  assert.ok(now.text.fontSize < oldFloor, `fitted at ${now.text.fontSize}, not below ${oldFloor}`);
  assert.ok(now.band);
  assert.ok(now.text.fontSize >= gutterBubbleMinFontSize(now.band.width, frameWidth));
});

test("an in-panel bubble's floor is untouched by the gutter floor", () => {
  const height = Math.round(W * 3);
  const long = { ...speechOverlay, text: EXHAUSTING_PROSE };
  const plan = layoutBubble(long, W, height);
  assert.equal(plan.overflow, true);
  assert.equal(plan.text.fontSize, defaultBubbleFontRange(height).minFontSize);
});
