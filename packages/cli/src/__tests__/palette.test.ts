// Unit tests for the palette-to-words mapping and its prompt clause (#207).
// Pure and deterministic, so the composed prompt is asserted with no provider.
//
// The point of the mapping is that "darker hex" must reach the model as "darker
// words", so the value-word ordering is asserted as a property over a ramp, not
// only as a handful of examples.

import assert from "node:assert/strict";
import { test } from "node:test";
import { appendPaletteClause, describePalette } from "../palette.js";

/** The value words, darkest first. A phrase's rank is its index here. */
const VALUE_ORDER = ["very dark", "dark", "mid-tone", "light", "very light"];

function valueRank(phrase: string): number {
  const rank = VALUE_ORDER.findIndex((word) => phrase.startsWith(`${word} `));
  assert.notEqual(rank, -1, `phrase "${phrase}" starts with no known value word`);
  return rank;
}

test("a hex becomes words, never the hex itself", () => {
  const phrase = describePalette("#1d2130");
  assert.equal(phrase, "very dark desaturated blue color palette");
  assert.doesNotMatch(phrase ?? "", /#|1d2130/);
});

test("the authored genre and pack palettes each map to a usable phrase", () => {
  // Real values: the built-in genre scaffolds and the palettes #207 names.
  assert.equal(describePalette("#191d28"), "very dark desaturated azure blue color palette");
  assert.equal(describePalette("#f3d9e0"), "very light pink color palette");
  assert.equal(describePalette("#d94f3a"), "mid-tone red color palette");
  assert.equal(describePalette("#cfe3d8"), "very light desaturated sea green color palette");
  assert.equal(describePalette("#ffe08a"), "very light vivid orange color palette");
});

test("a dark palette and a light one differ, and differ in the value word", () => {
  // A negative control on the mapping itself: if these collapsed to the same
  // phrase the end-to-end darkness claim would be unsupportable.
  const dark = describePalette("#191d28") ?? "";
  const light = describePalette("#eef5f1") ?? "";
  assert.notEqual(dark, light);
  assert.ok(valueRank(dark) < valueRank(light), `${dark} should rank darker than ${light}`);
});

test("the value word never brightens as the hex darkens", () => {
  // Monotonic over a full grey ramp: the property the darkness claim rests on.
  let previous = valueRank(describePalette("#ffffff") ?? "");
  for (let level = 255; level >= 0; level -= 5) {
    const hex = `#${level.toString(16).padStart(2, "0").repeat(3)}`;
    const rank = valueRank(describePalette(hex) ?? "");
    assert.ok(rank <= previous, `${hex} ranked lighter than the step above it`);
    previous = rank;
  }
  assert.equal(valueRank(describePalette("#000000") ?? ""), 0);
});

test("a near-grey names grey instead of a hue read off noise", () => {
  assert.equal(describePalette("#808080"), "mid-tone neutral grey color palette");
  assert.equal(describePalette("#000000"), "very dark neutral grey color palette");
  assert.equal(describePalette("#ffffff"), "very light neutral grey color palette");
});

test("shorthand, alpha, case, and surrounding space parse to the same phrase", () => {
  const expected = describePalette("#1188cc");
  assert.equal(describePalette("#18c"), expected);
  assert.equal(describePalette("#18cf"), expected);
  assert.equal(describePalette("#1188CC"), expected);
  assert.equal(describePalette("#1188cc80"), expected);
  assert.equal(describePalette("  #1188cc  "), expected);
});

/** The hue name a phrase carries, with the value and saturation words removed. */
function hueName(phrase: string): string {
  return phrase
    .replace(/ color palette$/, "")
    .replace(/^(very dark|very light|mid-tone|dark|light) /, "")
    .replace(/^(desaturated|vivid) /, "");
}

test("each hue sector names a different colour", () => {
  // A saturated sample at the centre of each 30-degree sector, converted from
  // HSL by hand. Asserting the exact set pins the vocabulary: a set that merely
  // has 12 entries could differ by the value word rather than by the hue.
  const names: string[] = [];
  for (let hue = 0; hue < 360; hue += 30) {
    const c = 200;
    const x = Math.round(c * (1 - Math.abs(((hue / 60) % 2) - 1)));
    const channels = [
      [c, x, 0],
      [x, c, 0],
      [0, c, x],
      [0, x, c],
      [x, 0, c],
      [c, 0, x],
    ][Math.floor(hue / 60)] ?? [0, 0, 0];
    const hex = `#${channels.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
    const phrase = describePalette(hex) ?? "";
    assert.match(phrase, / color palette$/, `${hex} produced "${phrase}"`);
    names.push(hueName(phrase));
  }
  assert.deepEqual(names, [
    "red",
    "orange",
    "yellow",
    "yellow-green",
    "green",
    "sea green",
    "teal",
    "azure blue",
    "blue",
    "violet",
    "magenta",
    "pink",
  ]);
});

test("a non-hex palette is the author's own words, used verbatim", () => {
  // The schema validates `palette` as a non-empty string, so a colour written as
  // words is legitimate. Dropping it would leave the field unread all over again.
  assert.equal(describePalette("muted teal and amber"), "muted teal and amber");
  assert.equal(describePalette("  rebeccapurple  "), "rebeccapurple");
});

test("a blank palette contributes nothing", () => {
  assert.equal(describePalette(""), null);
  assert.equal(describePalette("   "), null);
});

test("the clause is appended after the base prompt", () => {
  assert.equal(
    appendPaletteClause("short black bob, amber eyes, rain-soaked alley", "#1d2130"),
    "short black bob, amber eyes, rain-soaked alley, very dark desaturated blue color palette",
  );
});

test("no palette leaves the prompt unchanged", () => {
  const base = "short black bob, amber eyes, rain-soaked alley";
  assert.equal(appendPaletteClause(base, undefined), base);
  assert.equal(appendPaletteClause(base, ""), base);
  assert.equal(appendPaletteClause(base, "   "), base);
});

test("the mapping is deterministic for the same input", () => {
  assert.equal(describePalette("#1d2130"), describePalette("#1d2130"));
  assert.equal(appendPaletteClause("scene", "#cfe3d8"), appendPaletteClause("scene", "#cfe3d8"));
});
