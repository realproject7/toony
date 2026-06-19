// Tests for the v4 interstitial-panel presets (#117): values are stable, in
// range, ordered as the clock ladder, and the typed helpers resolve correctly.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
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
  SPACING_PRESET_NAMES,
  SPACING_PRESETS,
  STANDARD_CANVAS_WIDTH_PX,
  spacingPx,
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
