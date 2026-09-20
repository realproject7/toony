// Which of the four gap buckets a transition band reads as (#267).
//
// Two things are pinned here and they are different claims. The MAPPING is what
// a craft band's `transitionVocabulary` asserts when it groups a kind, written
// out kind by kind so a default fill that moves a kind into another bucket fails
// here instead of silently regrouping it. The COMPARISON is what the mapping
// rests on: with nothing authored, what a kind is said to draw and what it draws
// are resolved from one chain and are always the same, so a transition with no
// override cannot produce a finding.

import assert from "node:assert/strict";
import { test } from "node:test";
import { TRANSITION_TYPES, type TransitionType } from "@toony/schema";
import { parseCssColor } from "../contrast.js";
import {
  BAND_PAGE_BACKGROUND_MIN_VALUE,
  BAND_VOID_MAX_VALUE,
  type BandAppearance,
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

/**
 * The mapping, written out. `bare` is the bucket the kind draws with no text;
 * `withText` is the bucket the same kind draws once it carries a line, which
 * differs only for the treatments that DRAW that line.
 */
const MAPPING: Record<TransitionType, { bare: BandAppearance; withText: BandAppearance }> = {
  "hard-cut": { bare: "page-background", withText: "page-background" },
  gutter: { bare: "page-background", withText: "page-background" },
  fade: { bare: "page-background", withText: "page-background" },
  beat: { bare: "void", withText: "card" },
  "scene-break": { bare: "page-background", withText: "card" },
  "time-skip": { bare: "void", withText: "card" },
  black_band: { bare: "void", withText: "void" },
  title_card: { bare: "void", withText: "card" },
  palette_shift: { bare: "color-field", withText: "color-field" },
  desaturate_repeat: { bare: "color-field", withText: "color-field" },
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
  // The type LABEL a card treatment always draws is chrome, not the line the
  // panel carries: a text-less card kind is its own bare ground, not a card.
  assert.equal(declaredBandAppearance(bare("beat")), "void");
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
});

test("a gradient band reads at its ends averaged, not at either end", () => {
  // White to black: neither the page's ground nor a void, and a rule reading one
  // end alone would call it whichever end it read.
  const split = layoutTransition(
    transition({
      id: "t",
      type: "gutter",
      gradient: { from: "#ffffff", to: "#000000", direction: "top_bottom" },
    }),
  );
  assert.equal(drawnBandAppearance(split), "color-field");
});

test("the bucket boundaries keep every default fill away from an edge", () => {
  // The windows the defaults leave: the void ceiling sits above the card default
  // and below the darkest color field, the page floor above the lightest color
  // field and at or below the fade default's averaged ends.
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
  assert.ok(value("title_card") < BAND_VOID_MAX_VALUE, "the card ground stays a void");
  assert.ok(value("color_field") > BAND_VOID_MAX_VALUE, "a color field is never a void");
  assert.ok(
    value("desaturate_repeat") < BAND_PAGE_BACKGROUND_MIN_VALUE,
    "the palest color field is never the page's ground",
  );
  assert.ok(
    value("fade") >= BAND_PAGE_BACKGROUND_MIN_VALUE,
    "the fade default is the page's ground",
  );
  // Every default is measurable, so no kind's declared bucket is ever unknown.
  for (const type of TRANSITION_TYPES) {
    assert.notEqual(declaredBandAppearance(bare(type)), null, `${type} has a measurable default`);
  }
});

test("a fill the core cannot measure makes no claim", () => {
  const named = layoutTransition(transition({ id: "t", type: "void", color: "rebeccapurple" }));
  assert.equal(drawnBandAppearance(named), null);
  // The declared side reads the kind's own default, which is always measurable.
  assert.equal(declaredBandAppearance(named), "void");
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
});

test("bandAppearanceLabel words each bucket once", () => {
  assert.equal(bandAppearanceLabel("page-background"), "page background");
  assert.equal(bandAppearanceLabel("color-field"), "color field");
  assert.equal(bandAppearanceLabel("void"), "void");
  assert.equal(bandAppearanceLabel("card"), "card");
});
