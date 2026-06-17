import assert from "node:assert/strict";
import { test } from "node:test";
import { approximateMeasure } from "../measure.js";
import { defaultBubbleFontRange, layoutBubbleText, wrapText } from "../text.js";

test("approximateMeasure is deterministic and scales with font size", () => {
  const a = approximateMeasure("Hello world", 20);
  const b = approximateMeasure("Hello world", 20);
  assert.equal(a, b);
  assert.ok(approximateMeasure("Hello", 40) > approximateMeasure("Hello", 20));
});

test("approximateMeasure: bold is wider than regular", () => {
  assert.ok(approximateMeasure("Hello", 20, 700) > approximateMeasure("Hello", 20, 400));
});

test("wrapText keeps an over-long single word on its own line", () => {
  const lines = wrapText(approximateMeasure, "supercalifragilistic", 10, 20);
  assert.equal(lines.length, 1);
  assert.equal(lines[0], "supercalifragilistic");
});

test("wrapText breaks across words to respect maxWidth", () => {
  const lines = wrapText(approximateMeasure, "one two three four five", 60, 20);
  assert.ok(lines.length > 1);
  assert.deepEqual(lines.join(" ").split(/\s+/), ["one", "two", "three", "four", "five"]);
});

test("empty text wraps to a single empty line", () => {
  assert.deepEqual(wrapText(approximateMeasure, "   ", 100, 20), [""]);
});

test("layoutBubbleText picks the largest font that fits and is deterministic", () => {
  const opts = { minFontSize: 8, maxFontSize: 40 };
  const a = layoutBubbleText(approximateMeasure, "Short line", 300, 120, opts);
  const b = layoutBubbleText(approximateMeasure, "Short line", 300, 120, opts);
  assert.deepEqual(a, b);
  assert.equal(a.overflow, false);
  assert.ok(a.fontSize <= 40 && a.fontSize >= 8);
});

test("layoutBubbleText flags overflow when text cannot fit at min font", () => {
  const out = layoutBubbleText(
    approximateMeasure,
    "This is a very long sentence with many words that cannot possibly fit in a tiny box",
    40,
    20,
    { minFontSize: 8, maxFontSize: 12 },
  );
  assert.equal(out.overflow, true);
});

test("defaultBubbleFontRange scales with render height", () => {
  const small = defaultBubbleFontRange(200);
  const big = defaultBubbleFontRange(800);
  assert.ok(big.maxFontSize > small.maxFontSize);
  assert.ok(small.minFontSize >= 1);
});

test("a fixed fontSize skips auto-fit", () => {
  const out = layoutBubbleText(approximateMeasure, "Hello", 300, 120, {
    minFontSize: 8,
    maxFontSize: 40,
    fontSize: 24,
  });
  assert.equal(out.fontSize, 24);
});
