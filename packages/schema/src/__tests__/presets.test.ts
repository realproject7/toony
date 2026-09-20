// Tests for the v4 interstitial-panel presets (#117): values are stable, in
// range, ordered as the clock ladder, and the typed helpers resolve correctly.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GUTTER_BAND_WIDTH_DEFAULT,
  GUTTER_BAND_WIDTH_MAX,
  GUTTER_BAND_WIDTH_MIN,
  isMoodColor,
  isPanelHeightPreset,
  isSpacingPreset,
  MOOD_COLOR_NAMES,
  MOOD_COLORS,
  moodColorHex,
  PANEL_FOLD_SLICE_PX,
  PANEL_HEIGHT_PRESET_NAMES,
  PANEL_HEIGHT_PRESETS,
  panelHeightPx,
  resolveGutterBandWidth,
  SPACING_PRESET_NAMES,
  SPACING_PRESETS,
  STANDARD_CANVAS_WIDTH_PX,
  spacingPx,
  validateGutterBandWidth,
} from "../presets.js";

test("spacing presets hold the documented clock-ladder values (§5)", () => {
  assert.deepEqual(SPACING_PRESETS, {
    tight: 120,
    beat: 250,
    cut: 500,
    pause: 700,
    timeskip: 1600,
  });
});

test("spacing presets are positive integers and strictly increase in ladder order", () => {
  let prev = 0;
  for (const name of SPACING_PRESET_NAMES) {
    const px = SPACING_PRESETS[name];
    assert.ok(Number.isInteger(px) && px > 0, `${name} must be a positive integer`);
    assert.ok(px > prev, `${name} (${px}) must exceed the previous preset (${prev})`);
    prev = px;
  }
});

test("panel-height presets hold the documented values and increase S→Impact (§5)", () => {
  assert.deepEqual(PANEL_HEIGHT_PRESETS, { S: 400, M: 800, L: 1600, Impact: 2000 });
  let prev = 0;
  for (const name of PANEL_HEIGHT_PRESET_NAMES) {
    const px = PANEL_HEIGHT_PRESETS[name];
    assert.ok(Number.isInteger(px) && px > 0);
    assert.ok(px > prev, `${name} must increase`);
    prev = px;
  }
});

test("the fold-slice threshold sits between M and L panel heights (§1)", () => {
  assert.equal(PANEL_FOLD_SLICE_PX, 1200);
  assert.ok(PANEL_HEIGHT_PRESETS.M < PANEL_FOLD_SLICE_PX);
  assert.ok(PANEL_FOLD_SLICE_PX < PANEL_HEIGHT_PRESETS.L);
  assert.equal(STANDARD_CANVAS_WIDTH_PX, 800);
});

test("every mood-color preset has a valid #rrggbb hex (§2)", () => {
  assert.deepEqual(Object.keys(MOOD_COLORS).sort(), [...MOOD_COLOR_NAMES].sort());
  for (const name of MOOD_COLOR_NAMES) {
    assert.match(MOOD_COLORS[name], /^#[0-9a-f]{6}$/, `${name} must be a 6-digit lowercase hex`);
  }
  // The emotion coding anchors: dread is near-black, shock is pure white.
  assert.equal(MOOD_COLORS["dread-black"], "#0a0a0a");
  assert.equal(MOOD_COLORS["shock-white"], "#ffffff");
});

test("type-guards accept documented names and reject others", () => {
  for (const n of SPACING_PRESET_NAMES) assert.equal(isSpacingPreset(n), true);
  for (const n of PANEL_HEIGHT_PRESET_NAMES) assert.equal(isPanelHeightPreset(n), true);
  for (const n of MOOD_COLOR_NAMES) assert.equal(isMoodColor(n), true);
  assert.equal(isSpacingPreset("huge"), false);
  assert.equal(isPanelHeightPreset("XL"), false);
  assert.equal(isMoodColor("anger"), false);
  assert.equal(isMoodColor(42), false);
});

test("resolver helpers return the mapped values", () => {
  assert.equal(spacingPx("cut"), 500);
  assert.equal(panelHeightPx("Impact"), 2000);
  assert.equal(moodColorHex("calm-blue"), "#3f6fa3");
});

// --- Gutter band width (#215) -----------------------------------------------

test("the default gutter strip is the width it has been since #98", () => {
  // A project that declares nothing must render on exactly this strip, so the
  // number is pinned rather than left to drift with the resolver.
  assert.equal(GUTTER_BAND_WIDTH_DEFAULT, 0.18);
  assert.ok(GUTTER_BAND_WIDTH_MIN < GUTTER_BAND_WIDTH_DEFAULT);
  assert.ok(GUTTER_BAND_WIDTH_DEFAULT < GUTTER_BAND_WIDTH_MAX);
  // One strip at the maximum still leaves half the column as artwork; two of
  // them take the whole cut, which is why this is the ceiling and not higher.
  assert.ok(GUTTER_BAND_WIDTH_MAX < 1);
  assert.ok(GUTTER_BAND_WIDTH_MAX * 2 >= 1);
});

test("an absent or unusable declared strip resolves to the default", () => {
  for (const absent of [undefined, null, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(resolveGutterBandWidth(absent as number | undefined), GUTTER_BAND_WIDTH_DEFAULT);
  }
  assert.equal(
    resolveGutterBandWidth("0.3" as unknown as number),
    GUTTER_BAND_WIDTH_DEFAULT,
    "a string is not a declared width",
  );
});

test("a declared strip is used as declared, and one out of range is clamped", () => {
  for (const declared of [GUTTER_BAND_WIDTH_MIN, 0.12, 0.3, GUTTER_BAND_WIDTH_MAX]) {
    assert.equal(resolveGutterBandWidth(declared), declared);
  }
  // Out of range never reaches a renderer through `validateWebtoonValue`, but a
  // direct caller can still hand one over; it must not produce a strip that
  // swallows the artwork or one too narrow to draw.
  assert.equal(resolveGutterBandWidth(0), GUTTER_BAND_WIDTH_MIN);
  assert.equal(resolveGutterBandWidth(-2), GUTTER_BAND_WIDTH_MIN);
  assert.equal(resolveGutterBandWidth(1), GUTTER_BAND_WIDTH_MAX);
  assert.equal(resolveGutterBandWidth(9), GUTTER_BAND_WIDTH_MAX);
});

test("validateGutterBandWidth accepts the declarable range and nothing else", () => {
  assert.equal(validateGutterBandWidth(undefined), null);
  for (const good of [GUTTER_BAND_WIDTH_MIN, 0.18, GUTTER_BAND_WIDTH_MAX]) {
    assert.equal(validateGutterBandWidth(good), null, `${good} should be declarable`);
  }
  for (const bad of [0, -0.1, 0.04, 0.51, 1, Number.NaN, "0.2" as unknown as number]) {
    const error = validateGutterBandWidth(bad);
    assert.ok(error !== null, `${String(bad)} should be rejected`);
    assert.match(error, /gutterBandWidth/);
  }
  // The name is the caller's, so a pack manifest can point at its own field.
  assert.match(validateGutterBandWidth(9, "genres.0.gutterBandWidth") ?? "", /^genres\.0\./);
});
