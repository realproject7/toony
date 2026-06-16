// A deterministic, DOM-free text width measurer.
//
// The text layout (./text) is deterministic GIVEN a `measure` function. In a
// browser the editor/export can inject a real `canvas.measureText`-backed
// measurer for pixel-accurate fit. But the studio preview (#7) renders on the
// SERVER (Next.js server components) where there is no canvas, and the layout
// must still be deterministic and reproducible. This module provides an
// average-advance-width measurer driven by a small per-character metric table
// (fractions of the em), so wrapping/auto-fit is stable across server and
// client without any platform dependency.
//
// This is intentionally an approximation, not a font shaper: it is good enough
// to wrap dialogue sensibly and pick a fitting font size, and — crucially —
// every consumer that does NOT inject its own measurer gets the SAME numbers.

import type { MeasureWidth } from "./text.js";

// Advance width of a character as a fraction of the font size (em), for a
// proportional sans-serif. Buckets keep the table small while capturing the
// big width classes (narrow punctuation, wide caps, the default body glyph).
const WIDE = 0.95; // W M m @ %
const CAP = 0.7; // upper-case + wide lower-case
const BODY = 0.52; // default lower-case / digit advance
const NARROW = 0.3; // i l j t f r punctuation
const THIN = 0.27; // . , ' ` : ; | ! spaces handled separately
const SPACE = 0.3;

const WIDE_CHARS = new Set("WMm@%".split(""));
const NARROW_CHARS = new Set("iIlfjtr()[]{}/\\".split(""));
const THIN_CHARS = new Set(".,'`:;|! ".split(""));

function charEm(ch: string): number {
  if (ch === " ") return SPACE;
  if (THIN_CHARS.has(ch)) return THIN;
  if (WIDE_CHARS.has(ch)) return WIDE;
  if (NARROW_CHARS.has(ch)) return NARROW;
  // Upper-case letters and digits read wider than lower-case body glyphs.
  if (ch >= "A" && ch <= "Z") return CAP;
  if (ch >= "0" && ch <= "9") return CAP;
  return BODY;
}

/**
 * Approximate the rendered width of `text` at `fontSize` px. Bold text is
 * ~6% wider than regular, matching how a heavier weight advances. Deterministic
 * and platform-independent: identical inputs always yield identical widths.
 */
export const approximateMeasure: MeasureWidth = (text, fontSize, fontWeight = 400) => {
  let em = 0;
  for (const ch of text) em += charEm(ch);
  const weightFactor = fontWeight === 700 ? 1.06 : 1;
  return em * fontSize * weightFactor;
};
