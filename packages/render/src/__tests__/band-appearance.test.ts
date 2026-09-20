// Which of the four gap buckets a transition band reads as (#267).
//
// Three things are pinned here and they are different claims. The MAPPING is
// what a craft band's `transitionVocabulary` asserts when it groups a kind,
// written out kind by kind so a default fill that moves a kind into another
// bucket fails here instead of silently regrouping it. The RULE is the
// reference analyzer's own — under luminance 60 a void, over saturation 0.18 a
// colour field — pinned on both axes and at both boundaries, including the
// channel order, which a grey fixture cannot see. And the COMPARISON is what
// the mapping rests on: with nothing authored, what a kind is said to draw and
// what it draws are resolved from one chain and are always the same, so a
// transition with no override cannot produce a finding.

import assert from "node:assert/strict";
import { test } from "node:test";
import { TRANSITION_TYPES, type TransitionType } from "@toony/schema";
import { parseCssColor } from "../contrast.js";
import {
  BAND_COLOR_FIELD_SATURATION,
  BAND_PAGE_BACKGROUND_MIN_VALUE,
  BAND_VOID_VALUE,
  type BandReading,
  bandAppearanceLabel,
  declaredBandAppearance,
  defaultBandBackground,
  drawnBandAppearance,
  GUTTER_MARGIN_FILL,
  layoutTransition,
  resolveBandBackground,
} from "../transition.js";
import { transition } from "./fixtures.js";

/** A plan for `type` with nothing authored on it. */
const bare = (type: TransitionType) => layoutTransition(transition({ id: "t", type }));

/** What a `gutter` filled with `color` draws — the classifier over one colour. */
const drawnFill = (color: string): BandReading =>
  drawnBandAppearance(layoutTransition(transition({ id: "t", type: "gutter", color })));

/**
 * The mapping, written out. `bare` is the bucket the kind draws with no text;
 * `withText` is the bucket the same kind draws once it carries a line, which
 * differs only for the treatments that DRAW that line.
 */
const MAPPING: Record<TransitionType, { bare: BandReading; withText: BandReading }> = {
  "hard-cut": { bare: "page-background", withText: "page-background" },
  gutter: { bare: "page-background", withText: "page-background" },
  fade: { bare: "page-background", withText: "page-background" },
  beat: { bare: "void", withText: "card" },
  "scene-break": { bare: "page-background", withText: "card" },
  "time-skip": { bare: "void", withText: "card" },
  black_band: { bare: "void", withText: "void" },
  title_card: { bare: "void", withText: "card" },
  palette_shift: { bare: "color-field", withText: "color-field" },
  // Neutral grey: over the void ceiling and under the colour-field saturation,
  // so the reference's rule puts it in no bucket — which is why #236's shipped
  // bands leave this kind unclaimed.
  desaturate_repeat: { bare: "unclassified", withText: "unclassified" },
  color_field: { bare: "color-field", withText: "color-field" },
  void: { bare: "void", withText: "void" },
  narration_card: { bare: "void", withText: "card" },
  dialogue_card: { bare: "void", withText: "card" },
  time_card: { bare: "void", withText: "card" },
};

test("bandAppearanceByKind: every kind's default lands in the bucket a band groups it in", () => {
  for (const type of TRANSITION_TYPES) {
    const expected = MAPPING[type];
    assert.equal(declaredBandAppearance(bare(type)), expected.bare, `${type} with no text`);
    const carrying = layoutTransition(transition({ id: "t", type, text: "a line" }));
    assert.equal(declaredBandAppearance(carrying), expected.withText, `${type} carrying text`);
  }
});

test("the content-dependent kinds are exactly the card and break treatments", () => {
  const contentDependent = TRANSITION_TYPES.filter(
    (type) => MAPPING[type].bare !== MAPPING[type].withText,
  );
  assert.deepEqual(
    [...contentDependent].sort(),
    [
      "beat",
      "dialogue_card",
      "narration_card",
      "scene-break",
      "time-skip",
      "time_card",
      "title_card",
    ],
    "a kind whose bucket depends on content must be one whose treatment draws the text",
  );
  // The small type label `beat`, `time-skip` and `title_card` draw with no
  // detail is chrome, not the line the panel carries; the other four draw no
  // text at all without one. Either way a text-less card kind is its own bare
  // ground, not a card.
  assert.equal(declaredBandAppearance(bare("beat")), "void");
  assert.equal(declaredBandAppearance(bare("narration_card")), "void");
  assert.equal(declaredBandAppearance(bare("scene-break")), "page-background");
});

test("a transition with no authored override is resolved by exactly one chain", () => {
  for (const type of TRANSITION_TYPES) {
    const plan = bare(type);
    // `defaultBandBackground` is `resolveBandBackground` over the same kind with
    // the authored fields removed — on a plan that has none, the two ARE the same
    // call. A second copy of the precedence chain would diverge here.
    assert.deepEqual(
      resolveBandBackground(plan),
      defaultBandBackground(type),
      `${type}: default background`,
    );
    // Which is why nothing un-overridden can contradict itself.
    assert.equal(declaredBandAppearance(plan), drawnBandAppearance(plan), `${type}: no override`);
  }
});

test("resolveBandBackground reads a hand-built source in the documented order", () => {
  // The source type is public, so a caller can build one the layout never would.
  // `bandFill` beats `color` beats the treatment default, and a gradient beats
  // all three.
  const source = {
    gradient: null,
    bandFill: "#5a6b7a",
    color: "#ff0000",
    treatment: "card" as const,
  };
  assert.deepEqual(resolveBandBackground(source), { kind: "solid", color: "#5a6b7a" });
  assert.deepEqual(resolveBandBackground({ ...source, bandFill: null }), {
    kind: "solid",
    color: "#ff0000",
  });
  assert.deepEqual(resolveBandBackground({ ...source, bandFill: null, color: null }), {
    kind: "solid",
    color: "#15110d",
  });
  const gradient = { from: "#000000", to: "#ffffff", direction: "top_bottom" as const };
  assert.deepEqual(resolveBandBackground({ ...source, gradient }), { kind: "gradient", gradient });
});

test("the rule reads the channels in Rec. 709 order, not any other", () => {
  // Every fixture above is grey, white, black or symmetric in r/b, so all of
  // them survive a transposed channel order. These two do not: green is weighted
  // more than three times red and ten times blue, so a saturated red and a
  // saturated blue of the same shape land in DIFFERENT buckets, and swapping r
  // and b swaps which.
  assert.equal(drawnFill("#ff2000"), "color-field", "a saturated red is well over the void");
  assert.equal(drawnFill("#0020ff"), "void", "the same shape in blue is under it");
  // The finding each one produces is the point: without the channel order, a
  // white-hot void and a near-black colour field both read as clean.
  const redVoid = layoutTransition(transition({ id: "t", type: "void", color: "#ff2000" }));
  assert.equal(declaredBandAppearance(redVoid), "void");
  assert.equal(drawnBandAppearance(redVoid), "color-field");
  const blueField = layoutTransition(
    transition({ id: "t", type: "color_field", color: "#0020ff" }),
  );
  assert.equal(declaredBandAppearance(blueField), "color-field");
  assert.equal(drawnBandAppearance(blueField), "void");
});

test("saturation decides a colour field, and it is the reference's 0.18", () => {
  assert.equal(BAND_COLOR_FIELD_SATURATION, 0.18);
  // `(max - min) / max`, the definition `@toony/export`'s `sampleColor` uses.
  // At value 150, well clear of both luminance boundaries, saturation alone
  // decides: 0.1800 is NOT over the threshold and 0.1801 is.
  //   #969696 is 150 flat; dropping blue to 123 gives (150-123)/150 = 0.18.
  assert.equal(drawnFill("#96967b"), "unclassified", "exactly 0.18 is not over it");
  assert.equal(drawnFill("#96967a"), "color-field", "one step over it is");
  // A neutral mid-value band is in no bucket at all — not a colour field for
  // being mid-value, and not the page's ground for being too dark.
  assert.equal(drawnFill("#9a958c"), "unclassified");
  // And a dark saturated fill is a void first: the void test comes before the
  // saturation test, exactly as the reference's rule lists them.
  assert.equal(drawnFill("#00003c"), "void");
});

test("both luminance boundaries sit where the constants say, inclusive as written", () => {
  assert.equal(BAND_VOID_VALUE, 60);
  assert.equal(BAND_PAGE_BACKGROUND_MIN_VALUE, 190);
  // The coefficients sum to one, so a grey of N reads at exactly N. The void
  // ceiling is the reference's "UNDER luminance 60", so 60 itself is not a void.
  assert.equal(drawnFill("#3b3b3b"), "void", "59 is under the ceiling");
  assert.equal(drawnFill("#3c3c3c"), "unclassified", "60 is not under it");
  // The page floor is inclusive, so a grey of exactly 190 is the page's ground.
  assert.equal(drawnFill("#bdbdbd"), "unclassified", "189 is below the floor");
  assert.equal(drawnFill("#bebebe"), "page-background", "190 is on it");
});

test("the page floor is the round middle of the window the defaults leave", () => {
  // Unlike the other two numbers this one is not the reference's, so it is
  // derived: above the only default that must stay unclassified, at or below the
  // darkest page ground the renderer draws, and rounded to the middle of that.
  const value = (type: TransitionType): number => {
    const background = defaultBandBackground(type);
    const of = (color: string): number => {
      const c = parseCssColor(color);
      assert.ok(c, `${color} must be measurable`);
      return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    };
    return background.kind === "solid"
      ? of(background.color)
      : (of(background.gradient.from) + of(background.gradient.to)) / 2;
  };
  const low = value("desaturate_repeat");
  const high = value("fade");
  assert.ok(low > BAND_VOID_VALUE, "the window's floor is above the void ceiling");
  assert.ok(
    BAND_PAGE_BACKGROUND_MIN_VALUE > low && BAND_PAGE_BACKGROUND_MIN_VALUE <= high,
    `${BAND_PAGE_BACKGROUND_MIN_VALUE} must be in (${low}, ${high}]`,
  );
  assert.equal(
    BAND_PAGE_BACKGROUND_MIN_VALUE,
    Math.round((low + high) / 2 / 10) * 10,
    "the constant is the round value nearest the window's middle",
  );
  // Every default is measurable, so no kind's declared bucket is ever unknown.
  for (const type of TRANSITION_TYPES) {
    assert.notEqual(declaredBandAppearance(bare(type)), null, `${type} has a measurable default`);
  }
});

test("an authored fill moves the band into another bucket", () => {
  // A void filled with the page's own reading white.
  const whiteVoid = layoutTransition(transition({ id: "t", type: "void", color: "#ffffff" }));
  assert.equal(declaredBandAppearance(whiteVoid), "void");
  assert.equal(drawnBandAppearance(whiteVoid), "page-background");
  // A color field at void luminance (about 26) — the fill the rebuilt pack's
  // scaffold shipped before it was re-authored.
  const darkField = layoutTransition(
    transition({ id: "t", type: "color_field", color: "#161a24" }),
  );
  assert.equal(declaredBandAppearance(darkField), "color-field");
  assert.equal(drawnBandAppearance(darkField), "void");
  // An authored gradient wins over the fill, so it moves the band the same way.
  const blackGutter = layoutTransition(
    transition({
      id: "t",
      type: "gutter",
      gradient: { from: "#000000", to: "#0a0a0a", direction: "top_bottom" },
    }),
  );
  assert.equal(declaredBandAppearance(blackGutter), "page-background");
  assert.equal(drawnBandAppearance(blackGutter), "void");
});

test("a card kind carrying text is a card whatever it is filled with", () => {
  for (const color of ["#ffffff", "#5a6b7a", "#0a0a0a"]) {
    const plan = layoutTransition(
      transition({ id: "t", type: "narration_card", text: "a line", color }),
    );
    assert.equal(drawnBandAppearance(plan), "card", `card text over ${color}`);
    assert.equal(declaredBandAppearance(plan), "card", `card text over ${color}`);
  }
  // A kind whose treatment draws no text is NOT a card, whatever it carries: a
  // `color_field` renders the same bare field with a note on it as without one.
  const noted = layoutTransition(
    transition({ id: "t", type: "color_field", humanNote: "a production note" }),
  );
  assert.equal(drawnBandAppearance(noted), "color-field");
  // A card kind's note is drawn, so it DOES move the bucket — faithful to the
  // render, and the reason an annotated `beat` is grouped differently.
  const annotated = layoutTransition(
    transition({ id: "t", type: "beat", humanNote: "a production note" }),
  );
  assert.equal(drawnBandAppearance(annotated), "card");
  assert.equal(drawnBandAppearance(bare("beat")), "void");
});

test("a gradient band reads at its ends averaged, not at either end", () => {
  // White to black: neither the page's ground nor a void, and a rule reading one
  // end alone would call it whichever end it read. Averaged it is 127.5 at zero
  // saturation, which is in no bucket.
  const split = layoutTransition(
    transition({
      id: "t",
      type: "gutter",
      gradient: { from: "#ffffff", to: "#000000", direction: "top_bottom" },
    }),
  );
  assert.equal(drawnBandAppearance(split), "unclassified");
  // Saturation is averaged over the ends too: a saturated end and a grey end
  // average below the threshold, so neither end alone decides that either.
  const halfSaturated = layoutTransition(
    transition({
      id: "t",
      type: "gutter",
      gradient: { from: "#96967a", to: "#969696", direction: "top_bottom" },
    }),
  );
  assert.equal(drawnBandAppearance(halfSaturated), "unclassified");
});

test("a fill the core cannot measure makes no claim", () => {
  const named = layoutTransition(transition({ id: "t", type: "void", color: "rebeccapurple" }));
  assert.equal(drawnBandAppearance(named), null);
  // The declared side reads the kind's own default, which is always measurable.
  assert.equal(declaredBandAppearance(named), "void");
  // But a card kind is a card before any colour is read, so an unparseable fill
  // on one is not null.
  const unreadableCard = layoutTransition(
    transition({ id: "t", type: "narration_card", text: "a line", color: "rebeccapurple" }),
  );
  assert.equal(drawnBandAppearance(unreadableCard), "card");
});

test("a translucent fill is read over the page's own ground", () => {
  // `GUTTER_MARGIN_FILL` is the ground a band is drawn onto, and the only
  // surface under one that is never artwork.
  assert.deepEqual(parseCssColor(GUTTER_MARGIN_FILL), { r: 255, g: 255, b: 255, a: 1 });
  // Black at a tenth opacity over white is a very light band, not a void.
  const faint = layoutTransition(transition({ id: "t", type: "void", color: "#0000001a" }));
  assert.equal(drawnBandAppearance(faint), "page-background");
  // At full opacity the same colour is the void it declares.
  const solid = layoutTransition(transition({ id: "t", type: "void", color: "#000000ff" }));
  assert.equal(drawnBandAppearance(solid), "void");
  // Saturation is read off the COMPOSITED colour too: a saturated red at a tenth
  // opacity over white is a pale pink with little colour left in it.
  const wash = layoutTransition(transition({ id: "t", type: "color_field", color: "#ff00001a" }));
  assert.equal(drawnBandAppearance(wash), "page-background");
});

test("bandAppearanceLabel words each reading once", () => {
  assert.equal(bandAppearanceLabel("page-background"), "page background");
  assert.equal(bandAppearanceLabel("color-field"), "color field");
  assert.equal(bandAppearanceLabel("void"), "void");
  assert.equal(bandAppearanceLabel("card"), "card");
  assert.equal(bandAppearanceLabel("unclassified"), "none of the four buckets");
});
